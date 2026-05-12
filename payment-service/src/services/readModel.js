const { pool } = require('../config/db');
const { buildTicketArtifacts } = require('./ticketFactory');

// Applies a single event to the read model. Idempotent per (booking_id, event_type)
// so the consumer and the replay script can both call it safely.
async function applyEvent(event) {
  const { event_type: type, payload } = event;

  if (type === 'TicketGeneratedEvent') {
    const exists = await pool.query('SELECT 1 FROM tickets WHERE booking_id = $1', [payload.bookingId]);
    if (exists.rows.length) return;

    const { qrPayload, pdfBuffer } = await buildTicketArtifacts({
      ticketId: payload.ticketId,
      bookingId: payload.bookingId,
      userId:   payload.userId,
      eventId:  payload.eventId,
      quantity: payload.quantity,
      amount:   Number(payload.amount || 0),
    });

    await pool.query(
      `INSERT INTO tickets
         (id, booking_id, user_id, event_id, quantity, amount, status, qr_payload, pdf, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PAID', $7, $8, $9)
       ON CONFLICT (booking_id) DO NOTHING`,
      [
        payload.ticketId,
        payload.bookingId,
        payload.userId,
        payload.eventId,
        payload.quantity,
        payload.amount || 0,
        qrPayload,
        pdfBuffer,
        payload.issuedAt || new Date().toISOString(),
      ]
    );
    return;
  }

  // PaymentFailedEvent: don't materialise a ticket; nothing to project.
  // PaymentProcessedEvent / ReserveTicketCommand: informational on this projection.
}

async function rebuildFromScratch(eventStore) {
  await pool.query('TRUNCATE TABLE tickets');
  let count = 0;
  await eventStore.streamAllEvents(async (ev) => {
    await applyEvent(ev);
    count += 1;
  });
  return { eventsReplayed: count };
}

module.exports = { applyEvent, rebuildFromScratch };
