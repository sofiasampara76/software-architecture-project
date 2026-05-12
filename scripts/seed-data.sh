#!/usr/bin/env bash
# End-to-end smoke test against the running stack (via Traefik on :80).
# Registers a user, logs in, creates an event, books, and fetches the ticket.

set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost}"
EMAIL="${SEED_EMAIL:-demo$(date +%s)@apzdemo.com}"
PASSWORD="${SEED_PASSWORD:-demo-pass-1}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
hr()   { printf '%s\n' "------------------------------------------------------------"; }

bold "1) Register user: $EMAIL"
curl -sS -X POST "$GATEWAY/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true
echo; hr

bold "2) Login"
LOGIN_BODY=$(curl -sS -X POST "$GATEWAY/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN_BODY"
TOKEN=$(echo "$LOGIN_BODY" | sed -nE 's/.*"access_token":"([^"]+)".*/\1/p')
if [[ -z "$TOKEN" ]]; then echo "Login failed — no token"; exit 1; fi
bold "   -> token: ${TOKEN:0:24}..."
hr

bold "3) Create event in catalog"
EVENT_BODY=$(curl -sS -X POST "$GATEWAY/catalog/events" \
  -H 'Content-Type: application/json' \
  -d '{
        "title":"APZ Demo Concert",
        "description":"Architecture-resilient gig",
        "date":"2026-12-01T18:00:00Z",
        "totalSeats":100,
        "availableSeats":100,
        "price":20.0,
        "category":"concert"
      }')
echo "$EVENT_BODY"
EVENT_ID=$(echo "$EVENT_BODY" | sed -nE 's/.*"_id":"([^"]+)".*/\1/p')
if [[ -z "$EVENT_ID" ]]; then echo "Event creation failed"; exit 1; fi
bold "   -> event id: $EVENT_ID"
hr

bold "4) Add ticket to cart"
curl -sS -X POST "$GATEWAY/booking/cart/items" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"eventId\":\"$EVENT_ID\",\"quantity\":2}"
echo; hr

bold "5) Checkout (produces ReserveTicketCommand -> Kafka)"
BOOKING_BODY=$(curl -sS -X POST "$GATEWAY/booking/bookings" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"eventId\":\"$EVENT_ID\",\"quantity\":2,\"totalSeats\":100}")
echo "$BOOKING_BODY"
hr

bold "6) Wait 3s for payment-service to consume and generate the ticket..."
sleep 3
hr

bold "7) Fetch user tickets (CQRS read-model)"
curl -sS "$GATEWAY/payment/tickets/me" -H "Authorization: Bearer $TOKEN"
echo; hr

bold "8) Inspect event log (Event Sourcing)"
curl -sS "$GATEWAY/payment/events?limit=20"
echo; hr

bold "Seed complete. Token printed above for further manual testing."
echo "  export TOKEN=$TOKEN"
