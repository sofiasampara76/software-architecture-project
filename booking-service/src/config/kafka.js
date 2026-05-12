const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: process.env.INSTANCE_ID || 'booking-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 300, retries: 5 },
});

const producer = kafka.producer();
let producerConnected = false;

async function connectProducer() {
  try {
    await producer.connect();
    producerConnected = true;
    console.log(`[${process.env.INSTANCE_ID}] Kafka producer connected`);
  } catch (err) {
    console.error('Kafka producer connection failed:', err.message);
  }
}

async function sendReserveTicketCommand(booking) {
  if (!producerConnected) {
    throw new Error('Kafka producer not connected');
  }

  const message = {
    bookingId: booking.id,
    userId: booking.user_id,
    eventId: booking.event_id,
    quantity: booking.quantity,
    timestamp: new Date().toISOString(),
  };

  await producer.send({
    topic: 'ReserveTicketCommand',
    messages: [{ key: booking.id, value: JSON.stringify(message) }],
  });

  return message;
}

async function disconnectProducer() {
  if (producerConnected) {
    await producer.disconnect();
    producerConnected = false;
  }
}

function isConnected() {
  return producerConnected;
}

module.exports = { connectProducer, sendReserveTicketCommand, disconnectProducer, isConnected };
