const axios = require('axios');
const { redis, cartKey, CART_TTL } = require('../config/redis');
const { sendReserveTicketCommand } = require('../config/kafka');
const repo = require('../repositories/bookingRepository');

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3002';

async function getCart(userId) {
  const data = await redis.get(cartKey(userId));
  return data ? JSON.parse(data) : { userId, items: [] };
}

async function addToCart(userId, eventId, quantity) {
  let eventData;
  try {
    const { data } = await axios.get(`${CATALOG_SERVICE_URL}/events/${eventId}`, {
      timeout: 5000,
    });
    eventData = data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      throw Object.assign(new Error('Event not found'), { statusCode: 404 });
    }
    throw Object.assign(new Error('Catalog service unavailable'), { statusCode: 503 });
  }

  const available = eventData.availableSeats ?? eventData.available_seats ?? 0;
  if (available < quantity) {
    throw Object.assign(
      new Error(`Not enough seats. Available: ${available}`),
      { statusCode: 422 }
    );
  }

  const cart = await getCart(userId);
  const idx = cart.items.findIndex((i) => i.eventId === eventId);
  if (idx >= 0) {
    cart.items[idx].quantity += quantity;
  } else {
    cart.items.push({
      eventId,
      quantity,
      eventName: eventData.name || eventData.title || '',
      price: eventData.price || 0,
    });
  }

  await redis.set(cartKey(userId), JSON.stringify(cart), 'EX', CART_TTL);
  return cart;
}

async function removeFromCart(userId, eventId) {
  const cart = await getCart(userId);
  cart.items = cart.items.filter((i) => i.eventId !== eventId);
  await redis.set(cartKey(userId), JSON.stringify(cart), 'EX', CART_TTL);
  return cart;
}

async function clearCart(userId) {
  await redis.del(cartKey(userId));
}

async function checkout(userId, eventId, quantity, totalSeats) {
  const result = await repo.reserveSeatsOptimistic(eventId, quantity, totalSeats);

  if (!result.success) {
    if (result.reason === 'insufficient_seats') {
      throw Object.assign(
        new Error(`Not enough seats. Available: ${result.available}`),
        { statusCode: 422 }
      );
    }
    // reason === 'concurrent_modification'
    throw Object.assign(
      new Error('Booking conflict: another reservation was made simultaneously. Please try again.'),
      { statusCode: 409 }
    );
  }

  const booking = await repo.createBooking(userId, eventId, quantity);

  try {
    await sendReserveTicketCommand(booking);
  } catch (err) {
    // Booking stays in 'pending' — ticketing service processes it when Kafka recovers
    console.error('Kafka send failed, booking queued locally:', err.message);
  }

  return booking;
}

module.exports = { getCart, addToCart, removeFromCart, clearCart, checkout };
