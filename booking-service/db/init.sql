-- Booking Service database schema

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tracks reserved seat counts per event; version column enables optimistic locking
CREATE TABLE IF NOT EXISTS event_capacity (
  event_id VARCHAR(255) PRIMARY KEY,
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  reserved_seats INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seats >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT seats_not_exceeded CHECK (reserved_seats <= total_seats)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
