"""Unit tests for booking_service — Redis, Catalog HTTP, Kafka, and repo all mocked."""
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures / constants
# ─────────────────────────────────────────────────────────────────────────────

MOCK_EVENT = {"id": "e-1", "name": "Rock Concert", "availableSeats": 100, "price": 50.0}
MOCK_BOOKING = {
    "id": "bk-1",
    "user_id": "u-1",
    "event_id": "e-1",
    "quantity": 2,
    "status": "pending",
    "created_at": "2026-01-01T00:00:00",
    "updated_at": "2026-01-01T00:00:00",
}

EMPTY_CART = {"userId": "u-1", "items": []}
CART_WITH_ITEM = {
    "userId": "u-1",
    "items": [{"eventId": "e-1", "quantity": 2, "eventName": "Rock Concert", "price": 50.0}],
}


def _mock_redis(stored: dict | None = None) -> MagicMock:
    store = {}
    if stored:
        store.update({k: json.dumps(v) for k, v in stored.items()})
    m = MagicMock()
    m.get.side_effect = lambda k: store.get(k)
    m.set.side_effect = lambda k, v, ex=None: store.update({k: v})
    m.delete.side_effect = lambda k: store.pop(k, None)
    m._store = store
    return m


# ─────────────────────────────────────────────────────────────────────────────
# get_cart
# ─────────────────────────────────────────────────────────────────────────────

class TestGetCart:
    def test_returns_empty_cart_for_new_user(self):
        r = _mock_redis()
        with patch("app.services.booking_service.get_redis", return_value=r):
            from app.services import booking_service as svc
            cart = svc.get_cart("u-1")
        assert cart == {"userId": "u-1", "items": []}

    def test_returns_existing_cart_from_redis(self):
        r = _mock_redis({"cart:u-1": CART_WITH_ITEM})
        with patch("app.services.booking_service.get_redis", return_value=r):
            from app.services import booking_service as svc
            cart = svc.get_cart("u-1")
        assert len(cart["items"]) == 1
        assert cart["items"][0]["eventId"] == "e-1"


# ─────────────────────────────────────────────────────────────────────────────
# add_to_cart
# ─────────────────────────────────────────────────────────────────────────────

class TestAddToCart:
    def _patch(self, redis_store=None, event=MOCK_EVENT):
        r = _mock_redis(redis_store)
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = event
        mock_resp.raise_for_status.return_value = None
        return r, mock_resp

    def test_adds_new_item_to_empty_cart(self):
        r, resp = self._patch()
        with (
            patch("app.services.booking_service.get_redis", return_value=r),
            patch("httpx.get", return_value=resp),
        ):
            from app.services import booking_service as svc
            cart = svc.add_to_cart("u-1", "e-1", 2)
        assert len(cart["items"]) == 1
        assert cart["items"][0] == {"eventId": "e-1", "quantity": 2, "eventName": "Rock Concert", "price": 50.0}

    def test_increments_quantity_for_existing_item(self):
        r, resp = self._patch({"cart:u-1": CART_WITH_ITEM})
        with (
            patch("app.services.booking_service.get_redis", return_value=r),
            patch("httpx.get", return_value=resp),
        ):
            from app.services import booking_service as svc
            cart = svc.add_to_cart("u-1", "e-1", 3)
        assert cart["items"][0]["quantity"] == 5

    def test_raises_404_when_event_not_found(self):
        r = _mock_redis()
        not_found_resp = MagicMock(status_code=404)
        not_found_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404 Not Found", request=MagicMock(), response=not_found_resp
        )
        with (
            patch("app.services.booking_service.get_redis", return_value=r),
            patch("httpx.get", return_value=not_found_resp),
        ):
            from app.services import booking_service as svc
            with pytest.raises(HTTPException) as exc:
                svc.add_to_cart("u-1", "bad-event", 1)
        assert exc.value.status_code == 404

    def test_raises_503_when_catalog_unreachable(self):
        r = _mock_redis()
        with (
            patch("app.services.booking_service.get_redis", return_value=r),
            patch("httpx.get", side_effect=httpx.ConnectError("refused")),
        ):
            from app.services import booking_service as svc
            with pytest.raises(HTTPException) as exc:
                svc.add_to_cart("u-1", "e-1", 1)
        assert exc.value.status_code == 503

    def test_raises_422_when_not_enough_seats(self):
        r, resp = self._patch(event={**MOCK_EVENT, "availableSeats": 1})
        with (
            patch("app.services.booking_service.get_redis", return_value=r),
            patch("httpx.get", return_value=resp),
        ):
            from app.services import booking_service as svc
            with pytest.raises(HTTPException) as exc:
                svc.add_to_cart("u-1", "e-1", 5)
        assert exc.value.status_code == 422
        assert "seats" in exc.value.detail.lower()


# ─────────────────────────────────────────────────────────────────────────────
# remove_from_cart / clear_cart
# ─────────────────────────────────────────────────────────────────────────────

class TestCartMutations:
    def test_remove_from_cart_filters_event(self):
        multi_cart = {
            "userId": "u-1",
            "items": [
                {"eventId": "e-1", "quantity": 2, "eventName": "A", "price": 10.0},
                {"eventId": "e-2", "quantity": 1, "eventName": "B", "price": 20.0},
            ],
        }
        r = _mock_redis({"cart:u-1": multi_cart})
        with patch("app.services.booking_service.get_redis", return_value=r):
            from app.services import booking_service as svc
            cart = svc.remove_from_cart("u-1", "e-1")
        assert len(cart["items"]) == 1
        assert cart["items"][0]["eventId"] == "e-2"

    def test_clear_cart_deletes_redis_key(self):
        r = _mock_redis({"cart:u-1": CART_WITH_ITEM})
        with patch("app.services.booking_service.get_redis", return_value=r):
            from app.services import booking_service as svc
            svc.clear_cart("u-1")
        r.delete.assert_called_once_with("cart:u-1")


# ─────────────────────────────────────────────────────────────────────────────
# checkout
# ─────────────────────────────────────────────────────────────────────────────

class TestCheckout:
    def test_success_creates_booking_and_sends_kafka(self):
        with (
            patch("app.services.booking_service.repo.reserve_seats_optimistic",
                  return_value={"success": True, "capacity": {"version": 1}}),
            patch("app.services.booking_service.repo.create_booking", return_value=MOCK_BOOKING),
            patch("app.services.booking_service.kafka_config.send_reserve_ticket_command",
                  return_value={}) as mock_kafka,
        ):
            from app.services import booking_service as svc
            result = svc.checkout("u-1", "e-1", 2, 100)
        assert result == MOCK_BOOKING
        mock_kafka.assert_called_once_with(MOCK_BOOKING)

    def test_raises_422_on_insufficient_seats(self):
        with patch("app.services.booking_service.repo.reserve_seats_optimistic",
                   return_value={"success": False, "reason": "insufficient_seats", "available": 0}):
            from app.services import booking_service as svc
            with pytest.raises(HTTPException) as exc:
                svc.checkout("u-1", "e-1", 2, 1)
        assert exc.value.status_code == 422

    def test_raises_409_on_optimistic_lock_conflict(self):
        with patch("app.services.booking_service.repo.reserve_seats_optimistic",
                   return_value={"success": False, "reason": "concurrent_modification"}):
            from app.services import booking_service as svc
            with pytest.raises(HTTPException) as exc:
                svc.checkout("u-1", "e-1", 1, 10)
        assert exc.value.status_code == 409
        assert "conflict" in exc.value.detail.lower()

    def test_booking_created_even_if_kafka_fails(self):
        with (
            patch("app.services.booking_service.repo.reserve_seats_optimistic",
                  return_value={"success": True, "capacity": {}}),
            patch("app.services.booking_service.repo.create_booking", return_value=MOCK_BOOKING),
            patch("app.services.booking_service.kafka_config.send_reserve_ticket_command",
                  side_effect=Exception("Kafka down")),
        ):
            from app.services import booking_service as svc
            result = svc.checkout("u-1", "e-1", 2, 100)
        # Should still return the booking (stays 'pending', ticketing picks up later)
        assert result == MOCK_BOOKING
