const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect', () => console.log(`[${process.env.INSTANCE_ID}] Redis connected`));
redis.on('error', (err) => console.error('Redis error:', err.message));

const CART_PREFIX = 'cart:';
const CART_TTL = 86400; // 24 hours in seconds

function cartKey(userId) {
  return `${CART_PREFIX}${userId}`;
}

module.exports = { redis, cartKey, CART_TTL };
