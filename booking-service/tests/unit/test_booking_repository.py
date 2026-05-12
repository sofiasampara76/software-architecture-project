"""Unit tests for booking_repository — all DB calls are mocked."""
import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch, call
from datetime import datetime

import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_cursor(rows=None, rowcount=1):
    cur = MagicMock()
    cur.fetchone.return_value = rows[0] if rows else None
    cur.fetchall.return_value = rows or []
    cur.rowcount = rowcount
    cur.__enter__ = lambda s: s
    cur.__exit__ = MagicMock(return_value=False)
    return cur


def _make_conn(cursor):
    conn = MagicMock()
    conn.cursor.return_value = cursor
    conn.autocommit = True
    return conn


@contextmanager
def _fake_get_db(conn):
    yield conn


BOOKING_ROW = {
    "id": "bk-1",
    "user_id": "u-1",
    "event_id": "e-1",
    "quantity": 2,
    "status": "pending",
    "created_at": datetime(2026, 1, 1),
    "updated_at": datetime(2026, 1, 1),
}

CAPACITY_ROW = {
    "event_id": "e-1",
    "total_seats": 10,
    "reserved_seats": 0,
    "version": 0,
}


# ─────────────────────────────────────────────────────────────────────────────
# create_booking
# ─────────────────────────────────────────────────────────────────────────────

class TestCreateBooking:
    def test_inserts_and_returns_booking(self):
        cur = _make_cursor([BOOKING_ROW])
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.create_booking("u-1", "e-1", 2)

        assert result["id"] == "bk-1"
        assert result["status"] == "pending"
        conn.commit.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# get_booking_by_id
# ─────────────────────────────────────────────────────────────────────────────

class TestGetBookingById:
    def test_returns_booking_when_found(self):
        cur = _make_cursor([BOOKING_ROW])
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.get_booking_by_id("bk-1")
        assert result["id"] == "bk-1"

    def test_returns_none_when_not_found(self):
        cur = _make_cursor([])
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.get_booking_by_id("nonexistent")
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# get_bookings_by_user
# ─────────────────────────────────────────────────────────────────────────────

class TestGetBookingsByUser:
    def test_returns_all_user_bookings(self):
        rows = [BOOKING_ROW, {**BOOKING_ROW, "id": "bk-2"}]
        cur = _make_cursor(rows)
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.get_bookings_by_user("u-1")
        assert len(result) == 2

    def test_returns_empty_list_when_no_bookings(self):
        cur = _make_cursor([])
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.get_bookings_by_user("u-none")
        assert result == []


# ─────────────────────────────────────────────────────────────────────────────
# reserve_seats_optimistic
# ─────────────────────────────────────────────────────────────────────────────

class TestReserveSeatsOptimistic:
    def _make_optimistic_conn(self, capacity_row, updated_row):
        """Conn whose cursor returns capacity then updated (or None) for the UPDATE."""
        cur = MagicMock()
        cur.__enter__ = lambda s: s
        cur.__exit__ = MagicMock(return_value=False)
        # fetchone calls: first SELECT, then UPDATE
        cur.fetchone.side_effect = [capacity_row, updated_row]
        conn = MagicMock()
        conn.cursor.return_value = cur
        conn.autocommit = True
        return conn, cur

    def test_success_when_seats_available_and_version_unchanged(self):
        updated = {**CAPACITY_ROW, "reserved_seats": 2, "version": 1}
        conn, _ = self._make_optimistic_conn(CAPACITY_ROW, updated)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.reserve_seats_optimistic("e-1", 2, 10)

        assert result["success"] is True
        assert result["capacity"]["version"] == 1
        conn.commit.assert_called_once()

    def test_insufficient_seats(self):
        full_cap = {**CAPACITY_ROW, "reserved_seats": 10}
        conn, _ = self._make_optimistic_conn(full_cap, None)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.reserve_seats_optimistic("e-1", 1, 10)

        assert result["success"] is False
        assert result["reason"] == "insufficient_seats"
        assert result["available"] == 0
        conn.rollback.assert_called_once()

    def test_concurrent_modification_when_version_changes(self):
        """UPDATE affects 0 rows — another request changed the version first."""
        conn, _ = self._make_optimistic_conn(CAPACITY_ROW, None)  # UPDATE returns None

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            result = repo.reserve_seats_optimistic("e-1", 1, 10)

        assert result["success"] is False
        assert result["reason"] == "concurrent_modification"
        conn.rollback.assert_called_once()

    def test_rollback_on_unexpected_exception(self):
        cur = MagicMock()
        cur.__enter__ = lambda s: s
        cur.__exit__ = MagicMock(return_value=False)
        cur.execute.side_effect = Exception("DB gone")
        conn = MagicMock()
        conn.cursor.return_value = cur
        conn.autocommit = True

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            with pytest.raises(Exception, match="DB gone"):
                repo.reserve_seats_optimistic("e-1", 1, 10)
        conn.rollback.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# release_seats
# ─────────────────────────────────────────────────────────────────────────────

class TestReleaseSeats:
    def test_decrements_reserved_seats(self):
        cur = _make_cursor()
        conn = _make_conn(cur)

        with patch("app.repositories.booking_repository.get_db", lambda: _fake_get_db(conn)):
            from app.repositories import booking_repository as repo
            repo.release_seats("e-1", 2)

        execute_args = cur.execute.call_args
        assert "GREATEST" in execute_args[0][0]
        assert execute_args[0][1] == (2, "e-1")
        conn.commit.assert_called_once()
