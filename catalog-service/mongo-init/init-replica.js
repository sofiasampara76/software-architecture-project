// mongo-init/init-replica.js
// This runs inside mongo-primary after startup to initialize the replica set.
// Executed via: mongosh --file /docker-entrypoint-initdb.d/init-replica.js

rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo-primary:27017",   priority: 2, votes: 1 },
    { _id: 1, host: "mongo-secondary1:27017", priority: 1, votes: 1 },
    { _id: 2, host: "mongo-secondary2:27017", priority: 1, votes: 1 },
  ],
});

// Wait for election to complete
let status;
let attempts = 0;
do {
  sleep(1000);
  status = rs.status();
  attempts++;
  print(`Waiting for replica set... attempt ${attempts}`);
} while (
  status.members.every(m => m.stateStr !== "PRIMARY") && attempts < 30
);

if (attempts < 30) {
  print("Replica set initialized successfully!");
  print(JSON.stringify(rs.status().members.map(m => ({ host: m.name, state: m.stateStr })), null, 2));
} else {
  print("WARNING: Timed out waiting for PRIMARY election");
}
