const { Kafka, logLevel } = require('kafkajs');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'payment-service',
  brokers,
  logLevel: logLevel.NOTHING,
  retry: { initialRetryTime: 1000, retries: 20 },
});

const TOPICS = {
  RESERVE: process.env.KAFKA_TOPIC_RESERVE || 'ReserveTicketCommand',
  TICKET:  process.env.KAFKA_TOPIC_TICKET  || 'TicketGeneratedEvent',
  PAYMENT: process.env.KAFKA_TOPIC_PAYMENT || 'PaymentProcessedEvent',
};

function makeProducer() {
  return kafka.producer({ allowAutoTopicCreation: true });
}

function makeConsumer() {
  return kafka.consumer({
    groupId: process.env.KAFKA_GROUP_ID || 'payment-ticketing-service',
    allowAutoTopicCreation: true,
  });
}

module.exports = { kafka, TOPICS, makeProducer, makeConsumer };
