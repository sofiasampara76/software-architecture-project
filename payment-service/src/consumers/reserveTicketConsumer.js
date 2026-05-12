const { v4: uuidv4 } = require('uuid');

const { TOPICS, makeConsumer, makeProducer } = require('../config/kafka');
const { append, hasTicketGenerated } = require('../services/eventStore');
const { chargeCard } = require('../services/paymentMock');
const { applyEvent } = require('../services/readModel');

let consumer = null;
let producer = null;

async function start() {
  consumer = makeConsumer();
  producer = makeProducer();

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.RESERVE, fromBeginning: true });

  console.log(`[kafka] Consumer subscribed to ${TOPICS.RESERVE}`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString() || '{}';
      let cmd;
      try {
        cmd = JSON.parse(raw);
      } catch (err) {
        console.error('[kafka] Malformed message, skipping:', err.message);
        return;
      }
      console.log(`[kafka] ← ${topic}@${partition}:${message.offset}`, cmd);

      try {
        await handleReserveTicket(cmd);
      } catch (err) {
        // Important: rethrow so Kafka does NOT commit offset.
        // Restart the service → it will reprocess this message from the saved offset.
        console.error('[kafka] Handler failed, offset NOT committed:', err.message);
        throw err;
      }
    },
  });
}

async function handleReserveTicket(cmd) {
  const { bookingId, userId, eventId, quantity } = cmd;
  if (!bookingId || !userId || !eventId) {
    console.warn('[handler] Skipping incomplete command:', cmd);
    return;
  }

  if (await hasTicketGenerated(bookingId)) {
    console.log(`[handler] Booking ${bookingId} already has a ticket — idempotent skip.`);
    return;
  }

  const amount = Number(cmd.amount ?? 10 * Number(quantity || 1));
  const charge = chargeCard({ userId, amount });

  if (!charge.success) {
    const failed = await append(bookingId, 'PaymentFailedEvent', {
      bookingId, userId, amount, reason: charge.reason, occurredAt: new Date().toISOString(),
    });
    await producer.send({
      topic: TOPICS.PAYMENT,
      messages: [{ key: bookingId, value: JSON.stringify({ type: 'PaymentFailedEvent', ...failed.payload }) }],
    });
    return;
  }

  const paid = await append(bookingId, 'PaymentProcessedEvent', {
    bookingId, userId, amount, chargeId: charge.chargeId, occurredAt: new Date().toISOString(),
  });
  await producer.send({
    topic: TOPICS.PAYMENT,
    messages: [{ key: bookingId, value: JSON.stringify({ type: 'PaymentProcessedEvent', ...paid.payload }) }],
  });

  const ticketId = uuidv4();
  const ticketEvent = await append(bookingId, 'TicketGeneratedEvent', {
    ticketId,
    bookingId,
    userId,
    eventId,
    quantity: Number(quantity || 1),
    amount,
    issuedAt: new Date().toISOString(),
  });

  await applyEvent(ticketEvent);

  await producer.send({
    topic: TOPICS.TICKET,
    messages: [{ key: bookingId, value: JSON.stringify({ type: 'TicketGeneratedEvent', ...ticketEvent.payload }) }],
  });

  console.log(`[handler] ✓ Ticket ${ticketId} generated for booking ${bookingId}`);
}

async function stop() {
  try { if (consumer) await consumer.disconnect(); } catch (_) {}
  try { if (producer) await producer.disconnect(); } catch (_) {}
}

module.exports = { start, stop, handleReserveTicket };
