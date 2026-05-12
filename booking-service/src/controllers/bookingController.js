const service = require('../services/bookingService');
const repo = require('../repositories/bookingRepository');

const INSTANCE_ID = process.env.INSTANCE_ID || 'booking-service';

function userId(req) {
  return req.user.id || req.user.userId || req.user.sub;
}

async function getCart(req, res) {
  try {
    const cart = await service.getCart(userId(req));
    res.json({ ...cart, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve cart' });
  }
}

async function addToCart(req, res) {
  const { eventId, quantity = 1 } = req.body;
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });
  if (!Number.isInteger(quantity) || quantity < 1)
    return res.status(400).json({ error: 'quantity must be a positive integer' });

  try {
    const cart = await service.addToCart(userId(req), eventId, quantity);
    res.json({ ...cart, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function removeFromCart(req, res) {
  try {
    const cart = await service.removeFromCart(userId(req), req.params.eventId);
    res.json({ ...cart, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove item from cart' });
  }
}

async function clearCart(req, res) {
  try {
    await service.clearCart(userId(req));
    res.json({ message: 'Cart cleared', servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear cart' });
  }
}

async function createBooking(req, res) {
  const { eventId, quantity = 1, totalSeats } = req.body;
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });
  if (!Number.isInteger(quantity) || quantity < 1)
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  if (!totalSeats || !Number.isInteger(totalSeats) || totalSeats < 1)
    return res.status(400).json({ error: 'totalSeats is required and must be a positive integer' });

  try {
    const booking = await service.checkout(userId(req), eventId, quantity, totalSeats);
    res.status(201).json({ ...booking, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function getBooking(req, res) {
  try {
    const booking = await repo.getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.user_id !== userId(req))
      return res.status(403).json({ error: 'Access denied' });
    res.json({ ...booking, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve booking' });
  }
}

async function getMyBookings(req, res) {
  try {
    const bookings = await repo.getBookingsByUser(userId(req));
    res.json({ bookings, servedBy: INSTANCE_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve bookings' });
  }
}

module.exports = { getCart, addToCart, removeFromCart, clearCart, createBooking, getBooking, getMyBookings };
