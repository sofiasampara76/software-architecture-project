"""Integration tests for booking endpoints + race condition demo."""
import json
import threading
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

MOCK_USER = {"id": "user-123", "email": "user@test.com"}
BOOKING = {
    "id": "bk-uuid-1",
    "user_id": "user-123",
    "event_id": "event-1",
    "quantity": 2,
    "status": "pending",
    "created_at": datetime(2026, 1, 1),
    "updated_at": datetime(2026, 1, 1),
}


def _make_client(repo_overrides: dict | None = None):
    """
    Build a TestClient with:
    - auth dependency overridden to return MOCK_USER
    - Redis mocked (empty store)
    - DB init mocked
    - Kafka send mocked
    - Optional repo function patches passed as {fn_name: mock}
    """
    r = MagicMock()
    r.get.return_value = None
    r.set.return_value = None
    r.delete.return_value = None

    from app.main import create_app
    from app.middleware.auth import validate_token

    app = create_app()
    app.dependency_overrides[validate_token] = lambda: MOCK_USER

    ctx_managers = [
        patch("app.config.redis_client.get_redis", return_value=r),
        patch("app.config.database.init_db"),
        patch("app.config.kafka.send_reserve_ticket_command", return_value={}),
    ]
    if repo_overrides:
        for fn, mock in repo_overrides.items():
            ctx_managers.append(patch(f"app.repositories.booking_repository.{fn}", mock))
            ctx_managers.append(patch(f"app.services.booking_service.repo.{fn}", mock))

    return app, ctx_managers


# ─────────────────────────────────────────────────────────────────────────────
# POST /bookings
# ─────────────────────────────────────────────────────────────────────────────

class TestCreateBooking:
    def test_creates_booking_returns_201(self):
        reserve = MagicMock(return_value={"success": True, "capacity": {"version": 1}})
        create = MagicMock(return_value=BOOKING)
        app, patches = _make_client({"reserve_seats_optimistic": reserve, "create_booking": create})
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            with TestClient(app) as client:
                res = client.post("/bookings", json={"eventId": "event-1", "quantity": 2, "totalSeats": 100})
        assert res.status_code == 201
        body = res.json()
        assert body["id"] == BOOKING["id"]
        assert body["status"] == "pending"

    def test_returns_422_missing_eventId(self):
        app, patches = _make_client()
        with patches[0], patches[1], patches[2]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/bookings", json={"quantity": 1, "totalSeats": 10})
        assert res.status_code == 422

    def test_returns_422_missing_totalSeats(self):
        app, patches = _make_client()
        with patches[0], patches[1], patches[2]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/bookings", json={"eventId": "e-1", "quantity": 1})
        assert res.status_code == 422

    def test_returns_422_when_no_seats_available(self):
        reserve = MagicMock(return_value={"success": False, "reason": "insufficient_seats", "available": 0})
        app, patches = _make_client({"reserve_seats_optimistic": reserve})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/bookings", json={"eventId": "event-1", "quantity": 5, "totalSeats": 1})
        assert res.status_code == 422
        assert "seats" in res.json()["detail"].lower()

    def test_returns_409_on_optimistic_lock_conflict(self):
        reserve = MagicMock(return_value={"success": False, "reason": "concurrent_modification"})
        app, patches = _make_client({"reserve_seats_optimistic": reserve})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/bookings", json={"eventId": "event-1", "quantity": 1, "totalSeats": 10})
        assert res.status_code == 409
        assert "conflict" in res.json()["detail"].lower()

    def test_returns_201_even_when_kafka_fails(self):
        reserve = MagicMock(return_value={"success": True, "capacity": {}})
        create = MagicMock(return_value=BOOKING)
        app, patches = _make_client({"reserve_seats_optimistic": reserve, "create_booking": create})
        kafka_patch = patch("app.config.kafka.send_reserve_ticket_command", side_effect=Exception("Kafka down"))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], kafka_patch:
            with TestClient(app) as client:
                res = client.post("/bookings", json={"eventId": "event-1", "quantity": 2, "totalSeats": 100})
        assert res.status_code == 201

    def test_returns_401_without_auth_header(self):
        from app.main import create_app
        app = create_app()
        with patch("app.config.database.init_db"):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/bookings", json={"eventId": "e-1", "quantity": 1, "totalSeats": 10})
        assert res.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────────────
# GET /bookings/:id
# ─────────────────────────────────────────────────────────────────────────────

class TestGetBooking:
    def test_returns_own_booking(self):
        get_by_id = MagicMock(return_value=BOOKING)
        app, patches = _make_client({"get_booking_by_id": get_by_id})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app) as client:
                res = client.get(f"/bookings/{BOOKING['id']}")
        assert res.status_code == 200
        assert res.json()["id"] == BOOKING["id"]

    def test_returns_404_when_not_found(self):
        get_by_id = MagicMock(return_value=None)
        app, patches = _make_client({"get_booking_by_id": get_by_id})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.get("/bookings/nonexistent")
        assert res.status_code == 404

    def test_returns_403_when_booking_belongs_to_other_user(self):
        other_booking = {**BOOKING, "user_id": "other-user-999"}
        get_by_id = MagicMock(return_value=other_booking)
        app, patches = _make_client({"get_booking_by_id": get_by_id})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.get(f"/bookings/{BOOKING['id']}")
        assert res.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# GET /bookings/me
# ─────────────────────────────────────────────────────────────────────────────

class TestGetMyBookings:
    def test_returns_all_user_bookings(self):
        get_by_user = MagicMock(return_value=[BOOKING, {**BOOKING, "id": "bk-2"}])
        app, patches = _make_client({"get_bookings_by_user": get_by_user})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app) as client:
                res = client.get("/bookings/me")
        assert res.status_code == 200
        assert len(res.json()["bookings"]) == 2

    def test_returns_empty_list_when_no_bookings(self):
        get_by_user = MagicMock(return_value=[])
        app, patches = _make_client({"get_bookings_by_user": get_by_user})
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with TestClient(app) as client:
                res = client.get("/bookings/me")
        assert res.status_code == 200
        assert res.json()["bookings"] == []


# ─────────────────────────────────────────────────────────────────────────────
# Race condition test — optimistic locking demo
# ─────────────────────────────────────────────────────────────────────────────

class TestRaceCondition:
    def test_two_concurrent_bookings_of_last_seat_one_wins_one_conflicts(self):
        """
        Simulates two simultaneous POST /bookings for the last available seat.

        Request-1: reserve_seats_optimistic → success (gets the seat, version bumped)
        Request-2: reserve_seats_optimistic → concurrent_modification (version already changed)

        Expected: one 201 Created, one 409 Conflict.
        """
        call_count = 0

        def reserve_side_effect(event_id, quantity, total_seats):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"success": True, "capacity": {"version": 1}}
            return {"success": False, "reason": "concurrent_modification"}

        reserve = MagicMock(side_effect=reserve_side_effect)
        create = MagicMock(return_value=BOOKING)
        app, patches = _make_client({"reserve_seats_optimistic": reserve, "create_booking": create})

        results = []

        def make_request(client):
            res = client.post(
                "/bookings",
                json={"eventId": "event-1", "quantity": 1, "totalSeats": 1},
            )
            results.append(res.status_code)

        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            with TestClient(app, raise_server_exceptions=False) as client:
                t1 = threading.Thread(target=make_request, args=(client,))
                t2 = threading.Thread(target=make_request, args=(client,))
                t1.start()
                t2.start()
                t1.join()
                t2.join()

        assert sorted(results) == [201, 409], f"Expected [201, 409], got {sorted(results)}"
