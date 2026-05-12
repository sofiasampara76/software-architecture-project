// CLI replay: rebuild the read model from the event log.
// Run: docker exec -it payment-service node src/scripts/replay.js

require('dotenv').config();

const { waitForDb } = require('../config/db');
const eventStore = require('../services/eventStore');
const { rebuildFromScratch } = require('../services/readModel');

(async () => {
  try {
    await waitForDb();
    const result = await rebuildFromScratch(eventStore);
    console.log(`Replay finished: replayed ${result.eventsReplayed} events.`);
    process.exit(0);
  } catch (err) {
    console.error('Replay failed:', err);
    process.exit(1);
  }
})();
