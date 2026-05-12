jest.mock('axios');
jest.mock('../../src/config/redis', () => ({
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  cartKey: (uid) => `cart:${uid}`,
  CART_TTL: 86400,
}));
jest.mock('../../src/config/kafka', () => ({
  sendReserveTicketCommand: jest.fn(),
  connectProducer: jest.fn(),
  disconnectProducer: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
}));
jest.mock('../../src/repositories/bookingRepository');

const axios = require('axios');
const { redis } = require('../../src/config/redis');
const { sendReserveTicketCommand } = require('../../src/config/kafka');
const repo = require('../../src/repositories/bookingRepository');
const service = require('../../src/services/bookingService');

const EVENT = { id: 'event-1', name: 'Rock Concert', availableSeats: 100, price: 50 };
const BOOKING = { id: 'bk-1', user_id: 'user-1', event_id: 'event-1', quantity: 2, status: 'pending' };

describe('bookingService', () => {
  describe('getCart', () => {
    it('returns empty cart when Redis has no data', async () => {
      redis.get.mockResolvedValueOnce(null);
      const cart = await service.getCart('user-1');
      expect(cart).toEqual({ userId: 'user-1', items: [] });
    });

    it('returns parsed cart from Redis', async () => {
      const stored = { userId: 'user-1', items: [{ eventId: 'event-1', quantity: 2 }] };
      redis.get.mockResolvedValueOnce(JSON.stringify(stored));
      const cart = await service.getCart('user-1');
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].eventId).toBe('event-1');
    });
  });

  describe('addToCart', () => {
    beforeEach(() => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue('OK');
    });

    it('adds a new item to an empty cart', async () => {
      axios.get.mockResolvedValueOnce({ data: EVENT });
      const cart = await service.addToCart('user-1', 'event-1', 2);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({ eventId: 'event-1', quantity: 2 });
      expect(redis.set).toHaveBeenCalled();
    });

    it('increments quantity if same event already in cart', async () => {
      const existing = { userId: 'user-1', items: [{ eventId: 'event-1', quantity: 1, price: 50, eventName: 'Rock Concert' }] };
      redis.get.mockResolvedValueOnce(JSON.stringify(existing));
      axios.get.mockResolvedValueOnce({ data: EVENT });

      const cart = await service.addToCart('user-1', 'event-1', 3);
      expect(cart.items[0].quantity).toBe(4);
    });

    it('throws 404 when catalog returns 404', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 404 } });
      await expect(service.addToCart('user-1', 'bad-event', 1)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Event not found',
      });
    });

    it('throws 503 when catalog is unreachable', async () => {
      axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.addToCart('user-1', 'event-1', 1)).rejects.toMatchObject({
        statusCode: 503,
      });
    });

    it('throws 422 when not enough seats available', async () => {
      axios.get.mockResolvedValueOnce({ data: { ...EVENT, availableSeats: 1 } });
      await expect(service.addToCart('user-1', 'event-1', 5)).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining('Not enough seats'),
      });
    });
  });

  describe('removeFromCart', () => {
    it('removes the specified event from cart', async () => {
      const existing = {
        userId: 'user-1',
        items: [
          { eventId: 'event-1', quantity: 2 },
          { eventId: 'event-2', quantity: 1 },
        ],
      };
      redis.get.mockResolvedValueOnce(JSON.stringify(existing));
      redis.set.mockResolvedValueOnce('OK');

      const cart = await service.removeFromCart('user-1', 'event-1');
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].eventId).toBe('event-2');
    });
  });

  describe('clearCart', () => {
    it('deletes the cart key from Redis', async () => {
      redis.del.mockResolvedValueOnce(1);
      await service.clearCart('user-1');
      expect(redis.del).toHaveBeenCalledWith('cart:user-1');
    });
  });

  describe('checkout', () => {
    it('creates booking and sends Kafka command on success', async () => {
      repo.reserveSeatsOptimistic.mockResolvedValueOnce({
        success: true,
        capacity: { reserved_seats: 2, version: 1 },
      });
      repo.createBooking.mockResolvedValueOnce(BOOKING);
      sendReserveTicketCommand.mockResolvedValueOnce({ bookingId: BOOKING.id });

      const result = await service.checkout('user-1', 'event-1', 2, 100);

      expect(repo.reserveSeatsOptimistic).toHaveBeenCalledWith('event-1', 2, 100);
      expect(repo.createBooking).toHaveBeenCalledWith('user-1', 'event-1', 2);
      expect(sendReserveTicketCommand).toHaveBeenCalledWith(BOOKING);
      expect(result).toEqual(BOOKING);
    });

    it('throws 422 when not enough seats', async () => {
      repo.reserveSeatsOptimistic.mockResolvedValueOnce({
        success: false,
        reason: 'insufficient_seats',
        available: 0,
      });
      await expect(service.checkout('user-1', 'event-1', 2, 5)).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(repo.createBooking).not.toHaveBeenCalled();
    });

    it('throws 409 on optimistic lock conflict (race condition)', async () => {
      repo.reserveSeatsOptimistic.mockResolvedValueOnce({
        success: false,
        reason: 'concurrent_modification',
      });
      await expect(service.checkout('user-1', 'event-1', 1, 10)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('conflict'),
      });
      expect(repo.createBooking).not.toHaveBeenCalled();
    });

    it('still returns booking even if Kafka send fails', async () => {
      repo.reserveSeatsOptimistic.mockResolvedValueOnce({ success: true, capacity: {} });
      repo.createBooking.mockResolvedValueOnce(BOOKING);
      sendReserveTicketCommand.mockRejectedValueOnce(new Error('Kafka unavailable'));

      const result = await service.checkout('user-1', 'event-1', 2, 100);
      expect(result).toEqual(BOOKING);
    });
  });
});
