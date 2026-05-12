jest.mock('../../src/config/db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
  initDb: jest.fn(),
}));

const { pool } = require('../../src/config/db');
const repo = require('../../src/repositories/bookingRepository');

const BOOKING = {
  id: 'booking-uuid-1',
  user_id: 'user-1',
  event_id: 'event-1',
  quantity: 2,
  status: 'pending',
  created_at: new Date(),
  updated_at: new Date(),
};

describe('bookingRepository', () => {
  describe('createBooking', () => {
    it('inserts a booking and returns it', async () => {
      pool.query.mockResolvedValueOnce({ rows: [BOOKING] });
      const result = await repo.createBooking('user-1', 'event-1', 2);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bookings'), [
        'user-1',
        'event-1',
        2,
      ]);
      expect(result).toEqual(BOOKING);
    });
  });

  describe('getBookingById', () => {
    it('returns a booking when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [BOOKING] });
      const result = await repo.getBookingById('booking-uuid-1');
      expect(result).toEqual(BOOKING);
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const result = await repo.getBookingById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getBookingsByUser', () => {
    it('returns all bookings for a user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [BOOKING, { ...BOOKING, id: 'booking-uuid-2' }] });
      const result = await repo.getBookingsByUser('user-1');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when user has no bookings', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const result = await repo.getBookingsByUser('user-none');
      expect(result).toEqual([]);
    });
  });

  describe('updateBookingStatus', () => {
    it('updates booking status and returns updated row', async () => {
      const updated = { ...BOOKING, status: 'confirmed' };
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      const result = await repo.updateBookingStatus('booking-uuid-1', 'confirmed');
      expect(result.status).toBe('confirmed');
    });
  });

  describe('reserveSeatsOptimistic', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);
    });

    it('successfully reserves seats when version matches', async () => {
      const capacity = { event_id: 'event-1', total_seats: 10, reserved_seats: 0, version: 0 };
      const updatedCapacity = { ...capacity, reserved_seats: 2, version: 1 };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [capacity] }) // SELECT (existing capacity)
        .mockResolvedValueOnce({ rowCount: 1, rows: [updatedCapacity] }) // UPDATE
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await repo.reserveSeatsOptimistic('event-1', 2, 10);

      expect(result.success).toBe(true);
      expect(result.capacity.reserved_seats).toBe(2);
      expect(result.capacity.version).toBe(1);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns insufficient_seats when not enough seats available', async () => {
      const capacity = { event_id: 'event-1', total_seats: 5, reserved_seats: 4, version: 3 };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [capacity] }) // SELECT
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await repo.reserveSeatsOptimistic('event-1', 3, 5);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('insufficient_seats');
      expect(result.available).toBe(1);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns concurrent_modification when version has changed (race condition)', async () => {
      const capacity = { event_id: 'event-1', total_seats: 10, reserved_seats: 0, version: 0 };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [capacity] }) // SELECT — version=0
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // UPDATE — another request changed version first
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await repo.reserveSeatsOptimistic('event-1', 1, 10);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('concurrent_modification');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('creates capacity record when none exists and then reserves', async () => {
      const newCapacity = { event_id: 'event-1', total_seats: 10, reserved_seats: 0, version: 0 };
      const updatedCapacity = { ...newCapacity, reserved_seats: 1, version: 1 };

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT — no existing capacity
        .mockResolvedValueOnce({ rows: [newCapacity] }) // INSERT capacity
        .mockResolvedValueOnce({ rowCount: 1, rows: [updatedCapacity] }) // UPDATE
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await repo.reserveSeatsOptimistic('event-1', 1, 10);

      expect(result.success).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back and re-throws on unexpected DB error', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('DB connection lost')); // SELECT throws

      await expect(repo.reserveSeatsOptimistic('event-1', 1, 10)).rejects.toThrow('DB connection lost');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('releaseSeats', () => {
    it('decrements reserved_seats for an event', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      await repo.releaseSeats('event-1', 2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('reserved_seats = GREATEST'),
        [2, 'event-1']
      );
    });
  });
});
