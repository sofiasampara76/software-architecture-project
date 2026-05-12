const Event = require('../models/Event');
const { setReadOnly } = require('../config/database');

/**
 * Wraps a MongoDB write operation and catches NotWritablePrimary errors,
 * switching the service into read-only mode automatically.
 */
const safeWrite = async (operation) => {
  try {
    return await operation();
  } catch (err) {
    if (
      err.message?.includes('not primary') ||
      err.message?.includes('NotWritablePrimary') ||
      err.codeName === 'NotWritablePrimary' ||
      err.code === 10107
    ) {
      setReadOnly(true);
      const readOnlyError = new Error('Database is in read-only mode — no primary available');
      readOnlyError.isReadOnly = true;
      throw readOnlyError;
    }
    throw err;
  }
};

const getAllEvents = async ({ category, upcoming, page = 1, limit = 20 } = {}) => {
  const filter = {};

  if (category) filter.category = category;
  if (upcoming === 'true') filter.date = { $gte: new Date() };

  const skip = (page - 1) * limit;

  const [events, total] = await Promise.all([
    Event.find(filter).sort({ date: 1 }).skip(skip).limit(Number(limit)),
    Event.countDocuments(filter),
  ]);

  return {
    events,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
  };
};

const getEventById = async (id) => {
  const event = await Event.findById(id);
  if (!event) {
    const err = new Error('Event not found');
    err.statusCode = 404;
    throw err;
  }
  return event;
};

const createEvent = async (data) => {
  return safeWrite(async () => {
    const event = new Event({
      ...data,
      availableSeats: data.availableSeats ?? data.totalSeats,
    });
    return event.save();
  });
};

const updateEvent = async (id, data) => {
  return safeWrite(async () => {
    const event = await Event.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    return event;
  });
};

const deleteEvent = async (id) => {
  return safeWrite(async () => {
    const event = await Event.findByIdAndDelete(id);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    return event;
  });
};

/**
 * Atomically decrement availableSeats — called by Booking Service.
 * Uses findOneAndUpdate with $inc and a floor condition to prevent overselling.
 */
const reserveSeats = async (id, quantity = 1) => {
  return safeWrite(async () => {
    const event = await Event.findOneAndUpdate(
      { _id: id, availableSeats: { $gte: quantity } },
      { $inc: { availableSeats: -quantity } },
      { new: true }
    );
    if (!event) {
      const err = new Error('Not enough available seats');
      err.statusCode = 409;
      throw err;
    }
    return event;
  });
};

module.exports = {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  reserveSeats,
};
