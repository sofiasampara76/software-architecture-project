const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'bookingdb',
  user: process.env.DB_USER || 'booking_user',
  password: process.env.DB_PASSWORD || 'booking_pass',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        event_id VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_capacity (
        event_id VARCHAR(255) PRIMARY KEY,
        total_seats INTEGER NOT NULL CHECK (total_seats > 0),
        reserved_seats INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seats >= 0),
        version INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT seats_not_exceeded CHECK (reserved_seats <= total_seats)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`);

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
