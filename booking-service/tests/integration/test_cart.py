"""Integration tests for cart endpoints via FastAPI TestClient."""
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

MOCK_USER = {"id": "user-123", "email": "user@test.com"}
MOCK_EVENT = {"id": "event-1", "name": "Jazz Night", "availableSeats": 50, "price": 30.0}


def _make_redis_mock(redis_store: dict | None = None):
    store: dict = {}
    if redis_store:
        store.update({k: json.dumps(v) for k, v in redis_store.items()})
    r = MagicMock()
    r.get.side_effect = lambda k: store.get(k)
    r.set.side_effect = lambda k, v, ex=None: store.update({k: v})
    r.delete.side_effect = lambda k: store.pop(k, None)
    return r


def _make_app(redis_store: dict | None = None):
    """FastAPI app with all external deps patched."""
    r = _make_redis_mock(redis_store)

    from app.main import create_app
    from app.middleware.auth import validate_token

    app = create_app()
    app.dependency_overrides[validate_token] = lambda: MOCK_USER

    # Patch get_redis at the point where it is USED (booking_service namespace)
    patches = [
        patch("app.services.booking_service.get_redis", return_value=r),
        patch("app.config.database.init_db"),
        patch("app.config.kafka.send_reserve_ticket_command", return_value={}),
    ]
    return app, patches, r


# ─────────────────────────────────────────────────────────────────────────────
# /health
# ─────────────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_200(self):
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"


# ─────────────────────────────────────────────────────────────────────────────
# GET /cart
# ─────────────────────────────────────────────────────────────────────────────

class TestGetCart:
    def test_returns_empty_cart_for_new_user(self):
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2]:
            with TestClient(app) as client:
                res = client.get("/cart")
        assert res.status_code == 200
        assert res.json()["items"] == []
        assert res.json()["userId"] == MOCK_USER["id"]

    def test_returns_existing_cart_items(self):
        cart = {"userId": "user-123", "items": [{"eventId": "e-1", "quantity": 2, "eventName": "J", "price": 30.0}]}
        app, patches, _ = _make_app({"cart:user-123": cart})
        with patches[0], patches[1], patches[2]:
            with TestClient(app) as client:
                res = client.get("/cart")
        assert res.status_code == 200
        assert len(res.json()["items"]) == 1

    def test_returns_401_without_auth(self):
        from app.main import create_app
        app = create_app()
        with patch("app.config.database.init_db"):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.get("/cart")
        assert res.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────────────
# POST /cart/items
# ─────────────────────────────────────────────────────────────────────────────

class TestAddToCart:
    def _http_patch(self, event=MOCK_EVENT):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = event
        mock_resp.raise_for_status.return_value = None
        return patch("httpx.get", return_value=mock_resp)

    def test_adds_item_and_returns_cart(self):
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2], self._http_patch():
            with TestClient(app) as client:
                res = client.post("/cart/items", json={"eventId": "event-1", "quantity": 2})
        assert res.status_code == 200
        assert res.json()["items"][0]["eventId"] == "event-1"

    def test_defaults_quantity_to_1(self):
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2], self._http_patch():
            with TestClient(app) as client:
                res = client.post("/cart/items", json={"eventId": "event-1"})
        assert res.status_code == 200
        assert res.json()["items"][0]["quantity"] == 1

    def test_returns_422_for_invalid_quantity(self):
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2]:
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/cart/items", json={"eventId": "event-1", "quantity": 0})
        assert res.status_code == 422

    def test_returns_404_when_event_not_found(self):
        import httpx as _httpx
        not_found_resp = MagicMock(status_code=404)
        not_found_resp.raise_for_status.side_effect = _httpx.HTTPStatusError(
            "404 Not Found", request=MagicMock(), response=not_found_resp
        )
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2], patch("httpx.get", return_value=not_found_resp):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/cart/items", json={"eventId": "bad-event", "quantity": 1})
        assert res.status_code == 404

    def test_returns_422_when_not_enough_seats(self):
        sparse_event = {**MOCK_EVENT, "availableSeats": 1}
        app, patches, _ = _make_app()
        with patches[0], patches[1], patches[2], self._http_patch(event=sparse_event):
            with TestClient(app, raise_server_exceptions=False) as client:
                res = client.post("/cart/items", json={"eventId": "event-1", "quantity": 10})
        assert res.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /cart/items/{event_id}
# ─────────────────────────────────────────────────────────────────────────────

class TestRemoveFromCart:
    def test_removes_specified_event(self):
        cart = {
            "userId": "user-123",
            "items": [
                {"eventId": "e-1", "quantity": 2, "eventName": "A", "price": 10.0},
                {"eventId": "e-2", "quantity": 1, "eventName": "B", "price": 20.0},
            ],
        }
        app, patches, _ = _make_app({"cart:user-123": cart})
        with patches[0], patches[1], patches[2]:
            with TestClient(app) as client:
                res = client.delete("/cart/items/e-1")
        assert res.status_code == 200
        assert len(res.json()["items"]) == 1
        assert res.json()["items"][0]["eventId"] == "e-2"


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /cart
# ─────────────────────────────────────────────────────────────────────────────

class TestClearCart:
    def test_clears_cart_and_deletes_redis_key(self):
        app, patches, r = _make_app()
        with patches[0], patches[1], patches[2]:
            with TestClient(app) as client:
                res = client.delete("/cart")
        assert res.status_code == 200
        assert "cleared" in res.json()["message"].lower()
        r.delete.assert_called_once_with("cart:user-123")
