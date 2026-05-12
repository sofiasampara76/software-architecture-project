import os
import psycopg2
import psycopg2.pool
import psycopg2.extras
from contextlib import contextmanager

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def init_pool() -> None:
    global _pool
    _pool = psycopg2.pool.ThreadedConnectionPool(
        minconn=1,
        maxconn=10,
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME", "bookingdb"),
        user=os.getenv("DB_USER", "booking_user"),
        password=os.getenv("DB_PASSWORD", "booking_pass"),
    )


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    if _pool is None:
        init_pool()
    return _pool


@contextmanager
def get_db():
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


def init_db() -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bookings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR(255) NOT NULL,
                    event_id VARCHAR(255) NOT NULL,
                    quantity INTEGER NOT NULL CHECK (quantity > 0),
                    status VARCHAR(50) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS event_capacity (
                    event_id VARCHAR(255) PRIMARY KEY,
                    total_seats INTEGER NOT NULL CHECK (total_seats > 0),
                    reserved_seats INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seats >= 0),
                    version INTEGER NOT NULL DEFAULT 0,
                    CONSTRAINT seats_not_exceeded CHECK (reserved_seats <= total_seats)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)")
        conn.commit()
