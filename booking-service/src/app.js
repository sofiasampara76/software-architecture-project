require('dotenv').config();
const express = require('express');
const bookingRoutes = require('./routes/bookingRoutes');

const app = express();
const INSTANCE_ID = process.env.INSTANCE_ID || 'booking-service';

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', instance: INSTANCE_ID, timestamp: new Date().toISOString() });
});

app.use('/', bookingRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
