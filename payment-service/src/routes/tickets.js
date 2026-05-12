const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/ticketController');

const router = express.Router();

router.get('/tickets/me',             requireAuth, ctrl.getMyTickets);
router.get('/tickets/:id',            requireAuth, ctrl.getTicket);
router.get('/tickets/:id/pdf',        requireAuth, ctrl.downloadTicketPdf);

// CQRS / Event Sourcing introspection — handy for the demo
router.get('/events',                 ctrl.listEvents);
router.post('/admin/replay',          ctrl.replay);

module.exports = router;
