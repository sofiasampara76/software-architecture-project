const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'paymentdb',
  user: process.env.DB_USER || 'payment_user',
  password: process.env.DB_PASSWORD || 'payment_pass',
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

async function waitForDb(maxAttempts = 20) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] PostgreSQL ready');
      return;
    } catch (err) {
      console.warn(`[db] Not ready (attempt ${i}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('PostgreSQL did not become ready in time');
}

module.exports = { pool, waitForDb };
