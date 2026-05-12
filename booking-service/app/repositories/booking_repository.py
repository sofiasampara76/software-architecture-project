import psycopg2.extras
from app.config.database import get_db


def _dict(cursor_row) -> dict:
    return dict(cursor_row)


def create_booking(user_id: str, event_id: str, quantity: int) -> dict:
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO bookings (user_id, event_id, quantity, status) "
                "VALUES (%s, %s, %s, 'pending') RETURNING *",
                (user_id, event_id, quantity),
            )
            row = cur.fetchone()
            conn.commit()
            return _dict(row)


def get_booking_by_id(booking_id: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,))
            row = cur.fetchone()
            return _dict(row) if row else None


def get_bookings_by_user(user_id: str) -> list[dict]:
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM bookings WHERE user_id = %s ORDER BY created_at DESC",
                (user_id,),
            )
            return [_dict(r) for r in cur.fetchall()]


def update_booking_status(booking_id: str, status: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "UPDATE bookings SET status = %s, updated_at = NOW() WHERE id = %s RETURNING *",
                (status, booking_id),
            )
            row = cur.fetchone()
            conn.commit()
            return _dict(row) if row else None


def get_event_capacity(event_id: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM event_capacity WHERE event_id = %s", (event_id,))
            row = cur.fetchone()
            return _dict(row) if row else None


def reserve_seats_optimistic(event_id: str, quantity: int, total_seats: int) -> dict:
    """
    Atomically reserve seats using optimistic locking on the version column.
    Returns:
        {"success": True, "capacity": {...}}
        {"success": False, "reason": "insufficient_seats", "available": int}
        {"success": False, "reason": "concurrent_modification"}
    """
    with get_db() as conn:
        conn.autocommit = False
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM event_capacity WHERE event_id = %s", (event_id,))
                capacity = cur.fetchone()

                if capacity is None:
                    cur.execute(
                        "INSERT INTO event_capacity (event_id, total_seats, reserved_seats, version) "
                        "VALUES (%s, %s, 0, 0) "
                        "ON CONFLICT (event_id) DO UPDATE SET total_seats = EXCLUDED.total_seats "
                        "RETURNING *",
                        (event_id, total_seats),
                    )
                    capacity = cur.fetchone()

                capacity = _dict(capacity)
                available = capacity["total_seats"] - capacity["reserved_seats"]

                if available < quantity:
                    conn.rollback()
                    return {"success": False, "reason": "insufficient_seats", "available": available}

                # Optimistic lock: only update if version is unchanged since we read it
                cur.execute(
                    "UPDATE event_capacity "
                    "SET reserved_seats = reserved_seats + %s, version = version + 1 "
                    "WHERE event_id = %s AND version = %s AND (total_seats - reserved_seats) >= %s "
                    "RETURNING *",
                    (quantity, event_id, capacity["version"], quantity),
                )
                updated = cur.fetchone()

                if updated is None:
                    conn.rollback()
                    return {"success": False, "reason": "concurrent_modification"}

                conn.commit()
                return {"success": True, "capacity": _dict(updated)}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.autocommit = True


def release_seats(event_id: str, quantity: int) -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE event_capacity "
                "SET reserved_seats = GREATEST(0, reserved_seats - %s), version = version + 1 "
                "WHERE event_id = %s",
                (quantity, event_id),
            )
            conn.commit()
