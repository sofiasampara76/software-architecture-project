const { pool } = require('../config/db');

async function createBooking(userId, eventId, quantity) {
  const result = await pool.query(
    `INSERT INTO bookings (user_id, event_id, quantity, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [userId, eventId, quantity]
  );
  return result.rows[0];
}

async function updateBookingStatus(bookingId, status) {
  const result = await pool.query(
    `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, bookingId]
  );
  return result.rows[0] || null;
}

async function getBookingById(id) {
  const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getBookingsByUser(userId) {
  const result = await pool.query(
    'SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

async function getEventCapacity(eventId) {
  const result = await pool.query(
    'SELECT * FROM event_capacity WHERE event_id = $1',
    [eventId]
  );
  return result.rows[0] || null;
}

async function _getOrCreateCapacity(client, eventId, totalSeats) {
  const existing = await client.query(
    'SELECT * FROM event_capacity WHERE event_id = $1',
    [eventId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO event_capacity (event_id, total_seats, reserved_seats, version)
     VALUES ($1, $2, 0, 0)
     ON CONFLICT (event_id) DO UPDATE SET total_seats = EXCLUDED.total_seats
     RETURNING *`,
    [eventId, totalSeats]
  );
  return created.rows[0];
}

// Optimistic locking: atomically reserves seats.
// Returns { success: true, capacity } or { success: false, reason }
async function reserveSeatsOptimistic(eventId, quantity, totalSeats) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const capacity = await _getOrCreateCapacity(client, eventId, totalSeats);
    const available = capacity.total_seats - capacity.reserved_seats;

    if (available < quantity) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_seats', available };
    }

    // Only succeeds if version hasn't changed since we read it (optimistic lock)
    const updated = await client.query(
      `UPDATE event_capacity
       SET reserved_seats = reserved_seats + $1, version = version + 1
       WHERE event_id = $2 AND version = $3 AND (total_seats - reserved_seats) >= $1
       RETURNING *`,
      [quantity, eventId, capacity.version]
    );

    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'concurrent_modification' };
    }

    await client.query('COMMIT');
    return { success: true, capacity: updated.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function releaseSeats(eventId, quantity) {
  await pool.query(
    `UPDATE event_capacity
     SET reserved_seats = GREATEST(0, reserved_seats - $1), version = version + 1
     WHERE event_id = $2`,
    [quantity, eventId]
  );
}

module.exports = {
  createBooking,
  updateBookingStatus,
  getBookingById,
  getBookingsByUser,
  getEventCapacity,
  reserveSeatsOptimistic,
  releaseSeats,
};
