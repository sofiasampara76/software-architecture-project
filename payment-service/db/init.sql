-- Payment & Ticketing Service — Event Sourcing + CQRS read model

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────────────────────────────────────────────────────────────────
-- WRITE SIDE: append-only event store
-- Every state change is an immutable event keyed by booking_id (aggregate).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
  id           BIGSERIAL PRIMARY KEY,
  aggregate_id UUID        NOT NULL,
  event_type   VARCHAR(64) NOT NULL,
  payload      JSONB       NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_aggregate ON payment_events(aggregate_id);
CREATE INDEX IF NOT EXISTS idx_events_type      ON payment_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_occurred  ON payment_events(occurred_at);

-- Idempotency: one TicketGenerated event per booking (replays are still allowed
-- because the replay script TRUNCATEs the read model and re-applies events;
-- the consumer enforces idempotency separately by checking this table).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ticket_per_booking
  ON payment_events(aggregate_id)
  WHERE event_type = 'TicketGeneratedEvent';

-- ───────────────────────────────────────────────────────────────────
-- READ SIDE: denormalised ticket view (CQRS)
-- Rebuilt from the event log; safe to TRUNCATE and replay at any time.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          UUID         PRIMARY KEY,
  booking_id  UUID         NOT NULL UNIQUE,
  user_id     VARCHAR(255) NOT NULL,
  event_id    VARCHAR(255) NOT NULL,
  quantity    INTEGER      NOT NULL,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      VARCHAR(32)  NOT NULL,
  qr_payload  TEXT         NOT NULL,
  pdf         BYTEA        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user    ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_booking ON tickets(booking_id);
