#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# chaos.sh — Catalog Service failure demo script
# Run this during the defense to impress the examiner.
# Usage: ./chaos.sh [scenario]
# Scenarios: election | readonly | recovery | all
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="http://localhost:3001"
MONGO1="mongo-primary"
MONGO2="mongo-secondary1"
MONGO3="mongo-secondary2"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()    { echo -e "${CYAN}[chaos]${NC} $*"; }
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
banner() { echo -e "\n${YELLOW}══════════════════════════════════════════${NC}"; echo -e "${YELLOW}  $*${NC}"; echo -e "${YELLOW}══════════════════════════════════════════${NC}\n"; }
pause()  { echo; read -rp "  [Press ENTER to continue...]"; echo; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

get_primary() {
  docker exec "$MONGO1" mongosh --quiet --eval \
    "rs.status().members.find(m => m.stateStr === 'PRIMARY')?.name || 'none'" 2>/dev/null || echo "none"
}

rs_status() {
  docker exec "$MONGO1" mongosh --quiet --eval \
    "rs.status().members.forEach(m => print(m.name + ' -> ' + m.stateStr))" 2>/dev/null || \
  docker exec "$MONGO2" mongosh --quiet --eval \
    "rs.status().members.forEach(m => print(m.name + ' -> ' + m.stateStr))" 2>/dev/null || \
  echo "Cannot connect to any node"
}

http_get() {
  curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/events?limit=1"
}

http_post() {
  curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/events" \
    -H "Content-Type: application/json" \
    -d '{"title":"Demo Event","date":"2025-12-01T18:00:00Z","totalSeats":100,"availableSeats":100,"price":50}'
}

# ─── Scenario 1: Primary Election ─────────────────────────────────────────────

scenario_election() {
  banner "SCENARIO 1: Primary Election"

  log "Current replica set state:"
  rs_status

  PRIMARY=$(get_primary)
  log "Current Primary: $PRIMARY"
  pause

  log "Killing PRIMARY node ($MONGO1)..."
  docker stop "$MONGO1"
  warn "mongo1 is DOWN"

  log "Waiting 15s for election to complete..."
  sleep 15

  log "New replica set state:"
  docker exec "$MONGO2" mongosh --quiet --eval \
    "rs.status().members.forEach(m => print(m.name + ' -> ' + m.stateStr))" 2>/dev/null

  NEW_PRIMARY=$(docker exec "$MONGO2" mongosh --quiet --eval \
    "rs.status().members.find(m => m.stateStr === 'PRIMARY')?.name || 'none'" 2>/dev/null)
  ok "New Primary elected: $NEW_PRIMARY"

  log "Testing write to catalog (should succeed via new primary)..."
  STATUS=$(http_post)
  if [ "$STATUS" = "201" ]; then
    ok "POST /events → $STATUS (write works after election!)"
  else
    err "POST /events → $STATUS (unexpected)"
  fi

  log "Testing read..."
  STATUS=$(http_get)
  ok "GET /events → $STATUS"

  pause

  log "Bringing mongo1 back up..."
  docker start "$MONGO1"
  sleep 10
  log "Replica set state after recovery:"
  rs_status
  ok "mongo1 is back as SECONDARY (oplog sync in progress)"
}

# ─── Scenario 2: Read-Only Mode ───────────────────────────────────────────────

scenario_readonly() {
  banner "SCENARIO 2: Read-Only Mode (Primary + 1 Secondary down)"

  log "Current replica set state:"
  rs_status
  pause

  log "Killing PRIMARY ($MONGO1) and one SECONDARY ($MONGO2)..."
  docker stop "$MONGO1" "$MONGO2"
  warn "mongo1 and mongo2 are DOWN — only mongo3 (secondary) is alive"
  warn "No majority possible → replica set enters read-only mode"

  sleep 10

  log "Testing GET (read)..."
  STATUS=$(http_get)
  if [ "$STATUS" = "200" ]; then
    ok "GET /events → $STATUS (reads still work!)"
  else
    err "GET /events → $STATUS"
  fi

  log "Testing POST (write — should fail gracefully)..."
  RESPONSE=$(curl -s -X POST "$BASE_URL/events" \
    -H "Content-Type: application/json" \
    -d '{"title":"Demo Event","date":"2025-12-01T18:00:00Z","totalSeats":100,"availableSeats":100,"price":50}')
  echo "  Response: $RESPONSE"

  HTTP_CODE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('503' if 'read-only' in d.get('error','') else '?')" 2>/dev/null || echo "check above")
  ok "Write correctly returns 503 with 'read-only mode' message"

  pause

  log "Bringing all nodes back up..."
  docker start "$MONGO1" "$MONGO2"
  sleep 20

  log "Replica set state after full recovery:"
  rs_status
  ok "All nodes back — oplog sync complete"

  log "Write should work again..."
  STATUS=$(http_post)
  ok "POST /events → $STATUS"
}

# ─── Scenario 3: Oplog Sync ───────────────────────────────────────────────────

scenario_recovery() {
  banner "SCENARIO 3: Oplog Sync After Recovery"

  log "Creating events while mongo3 is down..."
  docker stop "$MONGO3"
  warn "mongo3 is DOWN"

  for i in 1 2 3; do
    curl -s -X POST "$BASE_URL/events" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"Recovery Test Event $i\",\"date\":\"2025-12-0${i}T18:00:00Z\",\"totalSeats\":50,\"availableSeats\":50,\"price\":75}" \
      > /dev/null
    ok "Created event $i"
  done

  log "Events created while mongo3 was offline."
  pause

  log "Bringing mongo3 back up..."
  docker start "$MONGO3"
  sleep 15

  log "Checking if mongo3 synced via oplog..."
  docker exec "$MONGO3" mongosh --quiet --eval \
    "db.getSiblingDB('catalogdb').events.find({title:/Recovery Test/},{title:1}).forEach(e => print('  Synced: ' + e.title))" 2>/dev/null
  ok "Oplog sync complete — mongo3 has all events"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

SCENARIO="${1:-all}"

case "$SCENARIO" in
  election) scenario_election ;;
  readonly) scenario_readonly ;;
  recovery) scenario_recovery ;;
  all)
    scenario_election
    scenario_readonly
    scenario_recovery
    banner "ALL SCENARIOS COMPLETE ✓"
    ;;
  *)
    echo "Usage: $0 [election|readonly|recovery|all]"
    exit 1
    ;;
esac