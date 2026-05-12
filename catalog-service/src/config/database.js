const mongoose = require('mongoose');

let isReadOnly = false;

const MONGO_URI = process.env.MONGO_URI ||
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017,127.0.0.1:27018,127.0.0.1:27019/catalogdb?replicaSet=rs0';

const connect = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 2000,
    });
    console.log('[MongoDB] Connected to Replica Set');
    isReadOnly = false;
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    process.exit(1);
  }
};

// Monitor topology changes to detect read-only state
mongoose.connection.on('connected', () => {
  console.log('[MongoDB] Connection established');
  isReadOnly = false;
});

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected');
});

// Detect when replica set loses write capability (no primary)
mongoose.connection.on('error', (err) => {
  if (
    err.message.includes('not primary') ||
    err.message.includes('NotWritablePrimary') ||
    err.message.includes('no primary')
  ) {
    console.warn('[MongoDB] Replica set lost primary — entering READ-ONLY mode');
    isReadOnly = true;
  }
});

// Also hook into the Mongoose client topology events
mongoose.connection.on('fullsetup', () => {
  console.log('[MongoDB] Full replica set connected');
  isReadOnly = false;
});

const getReadOnlyStatus = () => isReadOnly;

const setReadOnly = (val) => { isReadOnly = val; };

module.exports = { connect, getReadOnlyStatus, setReadOnly };
