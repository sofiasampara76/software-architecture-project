const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/bookingController');

const router = express.Router();

router.get('/cart', authenticate, ctrl.getCart);
router.post('/cart/items', authenticate, ctrl.addToCart);
router.delete('/cart/items/:eventId', authenticate, ctrl.removeFromCart);
router.delete('/cart', authenticate, ctrl.clearCart);

router.post('/bookings', authenticate, ctrl.createBooking);
router.get('/bookings/me', authenticate, ctrl.getMyBookings);
router.get('/bookings/:id', authenticate, ctrl.getBooking);

module.exports = router;
