require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const { pool, waitForDb } = require('./config/db');
const ticketRoutes = require('./routes/tickets');
const { errorHandler } = require('./middleware/errorHandler');
const consumer = require('./consumers/reserveTicketConsumer');

const app = express();
const PORT = parseInt(process.env.PORT || '3003', 10);

app.use(express.json());
app.use(morgan('combined'));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: process.env.SERVICE_NAME || 'payment-service',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', ticketRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

async function applySchema() {
  const sqlPath = path.join(__dirname, '..', 'db', 'init.sql');
  if (!fs.existsSync(sqlPath)) {
    console.warn('[bootstrap] init.sql not found — skipping schema apply');
    return;
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('[bootstrap] Schema applied');
}

async function bootstrap() {
  await waitForDb();
  await applySchema();

  // Start HTTP first so /health is up while Kafka is still bootstrapping.
  const server = app.listen(PORT, () => {
    console.log(`[payment-service] HTTP listening on :${PORT}`);
  });

  // Start Kafka consumer in the background; if Kafka isn't ready yet the kafkajs
  // retry logic will keep trying. Don't crash the HTTP server on first failure.
  consumer.start().catch((err) => {
    console.error('[kafka] consumer crashed:', err.message);
  });

  const shutdown = async (signal) => {
    console.log(`[shutdown] received ${signal}`);
    server.close();
    await consumer.stop();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
