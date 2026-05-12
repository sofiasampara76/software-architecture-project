const { validationResult } = require('express-validator');
const eventService = require('../services/eventService');
const { getReadOnlyStatus } = require('../config/database');

const handleError = (err, res) => {
  if (err.isReadOnly) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Catalog is in read-only mode. Write operations are temporarily unavailable.',
      readOnly: true,
    });
  }

  const status = err.statusCode || 500;
  return res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.message,
    message: err.message,
  });
};

// GET /events
const getEvents = async (req, res) => {
  try {
    const { category, upcoming, page, limit } = req.query;
    const result = await eventService.getAllEvents({ category, upcoming, page, limit });
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
};

// GET /events/:id
const getEvent = async (req, res) => {
  try {
    const event = await eventService.getEventById(req.params.id);
    res.json(event);
  } catch (err) {
    handleError(err, res);
  }
};

// POST /events
const createEvent = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation Error', details: errors.array() });
  }

  try {
    const event = await eventService.createEvent(req.body);
    res.status(201).json(event);
  } catch (err) {
    handleError(err, res);
  }
};

// PUT /events/:id
const updateEvent = async (req, res) => {
  try {
    const event = await eventService.updateEvent(req.params.id, req.body);
    res.json(event);
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /events/:id
const deleteEvent = async (req, res) => {
  try {
    await eventService.deleteEvent(req.params.id);
    res.status(204).send();
  } catch (err) {
    handleError(err, res);
  }
};

// POST /events/:id/reserve  — internal endpoint for Booking Service
const reserveSeats = async (req, res) => {
  try {
    const { quantity = 1 } = req.body;
    const event = await eventService.reserveSeats(req.params.id, quantity);
    res.json({ success: true, availableSeats: event.availableSeats, event });
  } catch (err) {
    handleError(err, res);
  }
};

// GET /health
const health = async (req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const mongoose = require('mongoose');

  res.json({
    status: 'ok',
    service: 'catalog-service',
    db: {
      state: dbState[mongoose.connection.readyState],
      readOnly: getReadOnlyStatus(),
    },
    timestamp: new Date().toISOString(),
  });
};

module.exports = { getEvents, getEvent, createEvent, updateEvent, deleteEvent, reserveSeats, health };
