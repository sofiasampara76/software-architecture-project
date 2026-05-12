#!/usr/bin/env bash
# Chaos demo — pick a scenario by index (or run all in sequence with: chaos.sh all).
#
# Scenarios:
#   1) Mongo primary down                — Catalog stays writable after election
#   2) Mongo primary + secondary1 down   — Catalog turns read-only, GET still works
#   3) Booking instance 1 down           — Cart survives via Redis on instance 2
#   4) Auth Redis down                   — JWT still validates locally (no blacklist)
#   5) Payment service down mid-flow     — Kafka holds the message; on restart, replay
#   6) Replay event log                  — TRUNCATE tickets table, replay events
#
# Usage:  ./scripts/chaos.sh           # interactive menu
#         ./scripts/chaos.sh 1         # run scenario 1
#         ./scripts/chaos.sh all       # run all in order

set -uo pipefail

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
hr()    { printf '%s\n' "============================================================"; }
pause() { read -rp "Press <Enter> to continue..." _; }

scenario_1() {
  hr; bold "Scenario 1 — Mongo primary down, election promotes secondary"
  docker stop mongo-primary
  warn "Sleeping 15s for election..."
  sleep 15
  bold "Posting a new event after election:"
  curl -sS -X POST http://localhost/catalog/events -H 'Content-Type: application/json' -d '{
    "title":"Post-Election Show","date":"2026-12-31T20:00:00Z",
    "totalSeats":50,"availableSeats":50,"price":15,"category":"concert"}' | sed 's/^/  /'
  echo
  green "If POST succeeded -> election worked: a secondary became primary."
  warn "Bringing mongo-primary back..."
  docker start mongo-primary >/dev/null
}

scenario_2() {
  hr; bold "Scenario 2 — Mongo primary + secondary1 down -> READ-ONLY"
  docker stop mongo-primary mongo-secondary1
  warn "Sleeping 15s..."; sleep 15
  bold "GET still works:"
  curl -sS http://localhost/catalog/events | head -c 300; echo
  bold "POST should fail with 503 read-only:"
  curl -sS -X POST http://localhost/catalog/events -H 'Content-Type: application/json' -d '{
    "title":"Should Fail","date":"2026-12-31T20:00:00Z","totalSeats":1,"availableSeats":1,"price":1
  }' | sed 's/^/  /'
  echo
  warn "Restoring nodes..."
  docker start mongo-primary mongo-secondary1 >/dev/null
}

scenario_3() {
  hr; bold "Scenario 3 — Kill booking-service-1, cart survives on booking-service-2"
  warn "Make sure you logged in and have TOKEN exported. (Run ./scripts/seed-data.sh first.)"
  if [[ -z "${TOKEN:-}" ]]; then warn "No TOKEN — skipping."; return; fi
  bold "Current cart (note 'servedBy'):"
  curl -sS http://localhost/booking/cart -H "Authorization: Bearer $TOKEN"; echo
  docker stop booking-service-1
  warn "Sleeping 3s for Traefik to drop the unhealthy backend..."
  sleep 3
  bold "Cart again (Traefik should round-robin to booking-service-2):"
  curl -sS http://localhost/booking/cart -H "Authorization: Bearer $TOKEN"; echo
  docker start booking-service-1 >/dev/null
}

scenario_4() {
  hr; bold "Scenario 4 — Kill auth-redis: JWT validates locally, no blacklist"
  docker stop auth-redis
  warn "Sleeping 3s..."; sleep 3
  bold "Validate token (should still work, but blacklist disabled):"
  curl -sS "http://localhost/auth/validate?token=${TOKEN:-MISSING_TOKEN}" | sed 's/^/  /'; echo
  docker start auth-redis >/dev/null
}

scenario_5() {
  hr; bold "Scenario 5 — Kill payment-service mid-flow, Kafka buffers the message"
  if [[ -z "${TOKEN:-}" ]]; then warn "No TOKEN — run seed-data.sh first."; return; fi
  if [[ -z "${EVENT_ID:-}" ]]; then warn "Set EVENT_ID before running this."; return; fi

  docker stop payment-service
  warn "Posting a checkout while payment-service is DOWN..."
  curl -sS -X POST http://localhost/booking/bookings \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    -d "{\"eventId\":\"$EVENT_ID\",\"quantity\":1,\"totalSeats\":100}"
  echo
  warn "Inspecting the Kafka topic — message should be waiting:"
  docker exec -it kafka kafka-console-consumer --bootstrap-server localhost:9092 \
    --topic ReserveTicketCommand --from-beginning --timeout-ms 4000 || true
  bold "Bringing payment-service back..."
  docker start payment-service >/dev/null
  warn "Sleeping 10s for consumer to drain offset..."
  sleep 10
  bold "Tickets (should now include the late one):"
  curl -sS http://localhost/payment/tickets/me -H "Authorization: Bearer $TOKEN" | sed 's/^/  /'; echo
}

scenario_6() {
  hr; bold "Scenario 6 — Replay event log to rebuild the CQRS read model"
  bold "Event log before:"
  curl -sS "http://localhost/payment/events?limit=5" | sed 's/^/  /'; echo
  bold "Triggering replay (TRUNCATE tickets + reapply events):"
  curl -sS -X POST http://localhost/payment/admin/replay | sed 's/^/  /'; echo
  if [[ -n "${TOKEN:-}" ]]; then
    bold "Tickets after replay:"
    curl -sS http://localhost/payment/tickets/me -H "Authorization: Bearer $TOKEN" | sed 's/^/  /'; echo
  fi
}

run() {
  case "$1" in
    1) scenario_1 ;;
    2) scenario_2 ;;
    3) scenario_3 ;;
    4) scenario_4 ;;
    5) scenario_5 ;;
    6) scenario_6 ;;
    *) echo "Unknown scenario: $1"; exit 1 ;;
  esac
}

if [[ $# -eq 0 ]]; then
  cat <<EOF
Chaos demo — pick a scenario:
  1) Mongo primary down (election)
  2) Mongo primary + secondary1 down (read-only)
  3) booking-service-1 down (cart survives)
  4) auth-redis down (local JWT validation)
  5) payment-service down mid-flow (Kafka buffer + offset resume)
  6) Replay event log

Type a number, or 'all':
EOF
  read -r choice
  if [[ "$choice" == "all" ]]; then
    for i in 1 2 3 4 5 6; do run "$i"; pause; done
  else
    run "$choice"
  fi
elif [[ "$1" == "all" ]]; then
  for i in 1 2 3 4 5 6; do run "$i"; done
else
  run "$1"
fi
