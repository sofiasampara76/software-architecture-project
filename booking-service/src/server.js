require('dotenv').config();
const app = require('./app');
const { initDb } = require('./config/db');
const { redis } = require('./config/redis');
const { connectProducer, disconnectProducer } = require('./config/kafka');

const PORT = parseInt(process.env.PORT) || 3000;
const INSTANCE_ID = process.env.INSTANCE_ID || 'booking-service';

async function start() {
  await initDb();
  await redis.connect();
  await connectProducer();

  const server = app.listen(PORT, () => {
    console.log(`${INSTANCE_ID} listening on port ${PORT}`);
  });

  async function shutdown() {
    console.log(`${INSTANCE_ID} shutting down...`);
    server.close();
    await redis.quit();
    await disconnectProducer();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
