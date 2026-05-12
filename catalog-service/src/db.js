const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo-primary:27017,mongo-secondary1:27017,mongo-secondary2:27017/catalogdb?replicaSet=rs0';

async function connectWithRetry(attempt = 1) {
  try {
    console.log(`[db] Connecting to MongoDB (attempt ${attempt})...`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000, heartbeatFrequencyMS: 2000 });
    console.log('[db] Connected to MongoDB Replica Set');
    mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
  } catch (err) {
    if (attempt >= 10) throw new Error(`Could not connect after 10 attempts: ${err.message}`);
    console.warn(`[db] Retrying in 5s... (${err.message})`);
    await new Promise(r => setTimeout(r, 5000));
    return connectWithRetry(attempt + 1);
  }
}

function isReadOnlyError(err) {
  if (!err) return false;
  // Mongo server errors that mean "this node can't accept writes"
  const codes = [10107, 13435, 11600, 91];
  const msgs = [
    'not primary',
    'notwritableprimary',
    'no primary',
    'no suitable servers',
    'server selection timed out',
    'getaddrinfo enotfound',
    'econnrefused',
    'enotfound',
  ];
  // Node-level network errors (DNS / connection) when the configured host is gone
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT'].includes(err.code)) return true;
  if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoServerSelectionError') return true;
  if (codes.includes(err.code)) return true;
  const m = (err.message || '').toLowerCase();
  return msgs.some((s) => m.includes(s));
}

module.exports = { connectWithRetry, isReadOnlyError };
