require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('./src/models/Event');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017,localhost:27018,localhost:27019/catalogdb?replicaSet=rs0';

const sampleEvents = [
  {
    title: 'Okean Elzy Live in Lviv',
    description: 'Epic rock concert in the heart of Lviv.',
    date: new Date('2025-09-15T19:00:00Z'),
    venue: 'Lviv Arena',
    totalSeats: 5000,
    availableSeats: 4820,
    price: 450,
    category: 'concert',
  },
  {
    title: 'TEDx Lviv 2025',
    description: 'Ideas worth spreading — local edition.',
    date: new Date('2025-10-05T10:00:00Z'),
    venue: 'Lviv Palace of Arts',
    totalSeats: 300,
    availableSeats: 120,
    price: 200,
    category: 'conference',
  },
  {
    title: 'Hamlet — Lviv Drama Theatre',
    description: "Shakespeare's tragedy in a modern interpretation.",
    date: new Date('2025-11-20T18:30:00Z'),
    venue: 'Lviv National Academic Drama Theatre',
    totalSeats: 500,
    availableSeats: 48,
    price: 150,
    category: 'theater',
  },
  {
    title: 'FC Shakhtar vs Dynamo Kyiv',
    description: 'Ukrainian Premier League Derby',
    date: new Date('2025-08-31T17:00:00Z'),
    venue: 'Lviv Olympic Stadium',
    totalSeats: 35000,
    availableSeats: 12500,
    price: 100,
    category: 'sport',
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Connected to MongoDB');
  await Event.deleteMany({});
  console.log('Cleared existing events');
  const inserted = await Event.insertMany(sampleEvents);
  console.log(`Seeded ${inserted.length} events:`);
  inserted.forEach((e) => console.log(`  [${e._id}] ${e.title}`));
  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
