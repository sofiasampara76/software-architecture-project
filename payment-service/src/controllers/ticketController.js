const { pool } = require('../config/db');
const eventStore = require('../services/eventStore');
const readModel = require('../services/readModel');

async function getMyTickets(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT id, booking_id, event_id, quantity, amount, status, qr_payload, created_at
         FROM tickets
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ tickets: rows });
  } catch (err) { next(err); }
}

async function getTicket(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, booking_id, user_id, event_id, quantity, amount, status, qr_payload, created_at
         FROM tickets
        WHERE id = $1 OR booking_id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const ticket = rows[0];
    if (ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(ticket);
  } catch (err) { next(err); }
}

async function downloadTicketPdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT user_id, pdf FROM tickets WHERE id = $1 OR booking_id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ticket-${id}.pdf"`);
    res.send(rows[0].pdf);
  } catch (err) { next(err); }
}

async function listEvents(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    const offset = parseInt(req.query.offset || '0', 10);
    const events = await eventStore.listEvents({ limit, offset });
    res.json({ events, count: events.length });
  } catch (err) { next(err); }
}

async function replay(req, res, next) {
  try {
    const result = await readModel.rebuildFromScratch(eventStore);
    res.json({ status: 'ok', ...result });
  } catch (err) { next(err); }
}

module.exports = { getMyTickets, getTicket, downloadTicketPdf, listEvents, replay };
