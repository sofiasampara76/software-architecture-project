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
  sendReserveTicketCommand: jest.fn().mockResolvedValue({}),
  connectProducer: jest.fn(),
  disconnectProducer: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
}));
jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { pool } = require('../../src/config/db');
const { sendReserveTicketCommand } = require('../../src/config/kafka');
const app = require('../../src/app');

const MOCK_USER = { id: 'user-123', email: 'user@test.com' };
const BOOKING = {
  id: 'bk-uuid-1',
  user_id: 'user-123',
  event_id: 'event-1',
  quantity: 2,
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  axios.get.mockImplementation((url) => {
    if (url.includes('/validate')) return Promise.resolve({ data: MOCK_USER });
    return Promise.reject(new Error('Unexpected URL'));
  });
});

// Helper: set up pool.connect mock for reserveSeatsOptimistic
function mockSuccessfulReservation(quantity = 2) {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValueOnce(mockClient);

  const capacity = { event_id: 'event-1', total_seats: 100, reserved_seats: 0, version: 0 };
  const updated = { ...capacity, reserved_seats: quantity, version: 1 };

  mockClient.query
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rows: [capacity] }) // SELECT
    .mockResolvedValueOnce({ rowCount: 1, rows: [updated] }) // UPDATE
    .mockResolvedValueOnce(undefined); // COMMIT

  return mockClient;
}

function mockFailedReservationInsufficient() {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValueOnce(mockClient);

  const capacity = { event_id: 'event-1', total_seats: 1, reserved_seats: 1, version: 2 };
  mockClient.query
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rows: [capacity] }) // SELECT
    .mockResolvedValueOnce(undefined); // ROLLBACK

  return mockClient;
}

function mockFailedReservationConflict() {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValueOnce(mockClient);

  const capacity = { event_id: 'event-1', total_seats: 10, reserved_seats: 0, version: 0 };
  mockClient.query
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rows: [capacity] }) // SELECT
    .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // UPDATE — version mismatch
    .mockResolvedValueOnce(undefined); // ROLLBACK

  return mockClient;
}

describe('POST /bookings', () => {
  it('creates a booking and returns 201', async () => {
    mockSuccessfulReservation();
    pool.query.mockResolvedValueOnce({ rows: [BOOKING] }); // INSERT booking
    sendReserveTicketCommand.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 2, totalSeats: 100 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: BOOKING.id,
      user_id: 'user-123',
      event_id: 'event-1',
      status: 'pending',
    });
    expect(sendReserveTicketCommand).toHaveBeenCalled();
  });

  it('returns 400 when eventId is missing', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ quantity: 1, totalSeats: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when totalSeats is missing', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/totalSeats/);
  });

  it('returns 422 when no seats available', async () => {
    mockFailedReservationInsufficient();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 5, totalSeats: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/seats/i);
  });

  it('returns 409 on concurrent booking race condition (optimistic lock)', async () => {
    mockFailedReservationConflict();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 1, totalSeats: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/conflict/i);
  });

  it('still returns 201 even if Kafka send fails', async () => {
    mockSuccessfulReservation();
    pool.query.mockResolvedValueOnce({ rows: [BOOKING] });
    sendReserveTicketCommand.mockRejectedValueOnce(new Error('Kafka down'));

    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer valid-token')
      .send({ eventId: 'event-1', quantity: 2, totalSeats: 100 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .post('/bookings')
      .send({ eventId: 'event-1', quantity: 1, totalSeats: 10 });
    expect(res.status).toBe(401);
  });
});

describe('GET /bookings/:id', () => {
  it('returns booking to its owner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BOOKING] });
    const res = await request(app)
      .get(`/bookings/${BOOKING.id}`)
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(BOOKING.id);
  });

  it('returns 404 when booking does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/bookings/nonexistent-id')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
  });

  it('returns 403 when booking belongs to another user', async () => {
    const otherBooking = { ...BOOKING, user_id: 'other-user-456' };
    pool.query.mockResolvedValueOnce({ rows: [otherBooking] });
    const res = await request(app)
      .get(`/bookings/${BOOKING.id}`)
      .set('Authorization', 'Bearer valid-token'); // MOCK_USER.id = 'user-123'
    expect(res.status).toBe(403);
  });
});

describe('GET /bookings/me', () => {
  it('returns all bookings for the authenticated user', async () => {
    const bookings = [BOOKING, { ...BOOKING, id: 'bk-uuid-2' }];
    pool.query.mockResolvedValueOnce({ rows: bookings });
    const res = await request(app)
      .get('/bookings/me')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(2);
  });

  it('returns empty array when user has no bookings', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/bookings/me')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.bookings).toEqual([]);
  });
});

describe('Race condition simulation', () => {
  it('two concurrent bookings of last seat: one wins, one gets 409', async () => {
    // Request 1: version=0, UPDATE succeeds (gets the seat)
    const client1 = { query: jest.fn(), release: jest.fn() };
    const capacity = { event_id: 'event-1', total_seats: 1, reserved_seats: 0, version: 0 };
    const updated = { ...capacity, reserved_seats: 1, version: 1 };
    client1.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [capacity] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [updated] })
      .mockResolvedValueOnce(undefined);

    // Request 2: same version=0, but UPDATE affects 0 rows (version was bumped by request 1)
    const client2 = { query: jest.fn(), release: jest.fn() };
    client2.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [capacity] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce(undefined);

    pool.connect
      .mockResolvedValueOnce(client1)
      .mockResolvedValueOnce(client2);

    pool.query.mockResolvedValueOnce({ rows: [BOOKING] }); // INSERT for successful booking

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/bookings')
        .set('Authorization', 'Bearer valid-token')
        .send({ eventId: 'event-1', quantity: 1, totalSeats: 1 }),
      request(app)
        .post('/bookings')
        .set('Authorization', 'Bearer valid-token')
        .send({ eventId: 'event-1', quantity: 1, totalSeats: 1 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One 201 (success) and one 409 (conflict)
    expect(statuses).toEqual([201, 409]);
  });
});
