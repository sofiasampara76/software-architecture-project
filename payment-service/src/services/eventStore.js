const { pool } = require('../config/db');

async function append(aggregateId, eventType, payload) {
  const { rows } = await pool.query(
    `INSERT INTO payment_events (aggregate_id, event_type, payload)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, aggregate_id, event_type, payload, occurred_at`,
    [aggregateId, eventType, JSON.stringify(payload)]
  );
  return rows[0];
}

async function hasTicketGenerated(bookingId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM payment_events
      WHERE aggregate_id = $1 AND event_type = 'TicketGeneratedEvent'
      LIMIT 1`,
    [bookingId]
  );
  return rows.length > 0;
}

async function listEvents({ limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, aggregate_id, event_type, payload, occurred_at
       FROM payment_events
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function streamAllEvents(handler) {
  const client = await pool.connect();
  try {
    const cursor = await client.query(
      `SELECT id, aggregate_id, event_type, payload, occurred_at
         FROM payment_events
         ORDER BY id ASC`
    );
    for (const row of cursor.rows) {
      await handler(row);
    }
  } finally {
    client.release();
  }
}

module.exports = { append, hasTicketGenerated, listEvents, streamAllEvents };
