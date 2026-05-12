#!/bin/bash
# wait-for-rs.sh — waits until the replica set has a primary, then exits 0
# Used as a depends_on condition for the catalog-service container

set -e

HOST="${1:-mongo-primary}"
PORT="${2:-27017}"
MAX_ATTEMPTS="${3:-30}"

echo "Waiting for MongoDB replica set primary at $HOST:$PORT..."

for i in $(seq 1 $MAX_ATTEMPTS); do
  PRIMARY=$(mongosh --host "$HOST" --port "$PORT" --quiet --eval \
    "try { rs.status().members.find(m => m.state === 1)?.name || '' } catch(e) { '' }" 2>/dev/null || echo "")

  if [ -n "$PRIMARY" ]; then
    echo "Primary found: $PRIMARY (attempt $i)"
    exit 0
  fi

  echo "Attempt $i/$MAX_ATTEMPTS — no primary yet, retrying in 2s..."
  sleep 2
done

echo "ERROR: No primary elected after $MAX_ATTEMPTS attempts"
exit 1
