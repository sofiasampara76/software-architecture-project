// Mocks are hoisted before any require — Jest processes jest.mock() before module loading
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  initDb: jest.fn(),
}));
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
jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { redis } = require('../../src/config/redis');
const app = require('../../src/app');

const MOCK_USER = { id: 'user-123', email: 'user@test.com' };
const EVENT = { id: 'event-1', name: 'Jazz Night', availableSeats: 50, price: 30 };

beforeEach(() => {
  // Default: auth validates successfully
  axios.get.mockImplementation((url) => {
    if (url.includes('/validate')) return Promise.resolve({ data: MOCK_USER });
    if (url.includes('/events/')) return Promise.resolve({ data: EVENT });
    return Promise.reject(new Error('Unexpected URL: ' + url));
  });
});

describe('GET /health', () => {
  it('returns 200 with instance info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });
});

describe('GET /cart', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await request(app).get('/cart');
    expect(res.status).toBe(401);
  });

  it('returns empty cart for user with no items', async () => {
    redis.get.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/cart')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.userId).toBe(MOCK_USER.id);
  });

  it('returns existing cart items from Redis', async () => {
    const cartData = {
      userId: 'user-123',
      items: [{ eventId: 'event-1', quantity: 2, eventName: 'Jazz Night', price: 30 }],
    };
    redis.get.mockResolvedValueOnce(JSON.stringify(cartData));

    const res = await request(app)
      .get('/cart')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].eventId).toBe('event-1');
  });

  it('returns 401 for expired token', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 401 } });
    const res = await request(app)
      .get('/cart')
      .set('Authorization', 'Bearer expired');
    expect(res.status).toBe(401);
  });
});

describe('POST /cart/items', () => {
  beforeEach(() => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
  });

  it('adds item to cart and returns updated cart', async () => {
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ eventId: 'event-1', quantity: 2 });
  });

  it('defaults quantity to 1 when not provided', async () => {
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1' });
    expect(res.status).toBe(200);
    expect(res.body.items[0].quantity).toBe(1);
  });

  it('returns 400 when eventId is missing', async () => {
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ quantity: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/eventId/);
  });

  it('returns 400 when quantity is invalid', async () => {
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when event does not exist in catalog', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/validate')) return Promise.resolve({ data: MOCK_USER });
      return Promise.reject({ response: { status: 404 } });
    });
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'nonexistent', quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 422 when not enough seats', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/validate')) return Promise.resolve({ data: MOCK_USER });
      return Promise.resolve({ data: { ...EVENT, availableSeats: 1 } });
    });
    const res = await request(app)
      .post('/cart/items')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 10 });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /cart/items/:eventId', () => {
  it('removes item from cart', async () => {
    const cartData = {
      userId: 'user-123',
      items: [
        { eventId: 'event-1', quantity: 2 },
        { eventId: 'event-2', quantity: 1 },
      ],
    };
    redis.get.mockResolvedValueOnce(JSON.stringify(cartData));
    redis.set.mockResolvedValueOnce('OK');

    const res = await request(app)
      .delete('/cart/items/event-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].eventId).toBe('event-2');
  });
});

describe('DELETE /cart', () => {
  it('clears the entire cart', async () => {
    redis.del.mockResolvedValueOnce(1);
    const res = await request(app)
      .delete('/cart')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cleared/i);
    expect(redis.del).toHaveBeenCalledWith('cart:user-123');
  });
});
