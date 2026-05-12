require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');

const eventRoutes = require('./routes/events');
const { connectWithRetry } = require('./db');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(morgan('combined'));

// Health check — always available
app.get('/health', (req, res) => {
  const state = mongoose.connection.readyState;
  const stateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: 'ok',
    service: 'catalog-service',
    db: stateMap[state] || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/events', eventRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use(errorHandler);

// Connect to MongoDB then start server
connectWithRetry().then(() => {
  app.listen(PORT, () => {
    console.log(`[catalog-service] Listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('[catalog-service] Fatal: could not connect to MongoDB:', err.message);
  process.exit(1);
});