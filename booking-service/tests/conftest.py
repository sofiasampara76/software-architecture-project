"""
Shared fixtures and helpers for the booking-service test suite.

All external infrastructure (PostgreSQL, Redis, Kafka, Auth/Catalog HTTP calls) is
mocked so the tests run without any running services.
"""
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


MOCK_USER = {"id": "user-123", "email": "user@test.com"}
MOCK_EVENT = {"id": "event-1", "name": "Rock Concert", "availableSeats": 100, "price": 50.0}
MOCK_BOOKING = {
    "id": "bk-uuid-1",
    "user_id": "user-123",
    "event_id": "event-1",
    "quantity": 2,
    "status": "pending",
    "created_at": "2026-01-01T00:00:00",
    "updated_at": "2026-01-01T00:00:00",
}


@pytest.fixture()
def mock_redis():
    """In-memory Redis replacement backed by a plain dict."""
    store: dict = {}
    m = MagicMock()
    m.get.side_effect = lambda k: store.get(k)
    m.set.side_effect = lambda k, v, ex=None: store.update({k: v})
    m.delete.side_effect = lambda k: store.pop(k, None)
    m._store = store  # expose for assertions
    return m


@pytest.fixture()
def auth_headers():
    return {"Authorization": "Bearer valid-token"}


@pytest.fixture()
def app_client(mock_redis):
    """
    FastAPI TestClient with all external deps patched:
      - auth validate_token dependency → returns MOCK_USER
      - Redis → mock_redis fixture
      - DB get_db → MagicMock (individual tests set query return values)
      - Kafka send → MagicMock (no-op)
    """
    from app.main import create_app
    from app.middleware.auth import validate_token

    test_app = create_app()
    test_app.dependency_overrides[validate_token] = lambda: MOCK_USER

    with (
        patch("app.config.redis_client._client", mock_redis),
        patch("app.config.redis_client.get_redis", return_value=mock_redis),
        patch("app.config.database.init_db"),
        patch("app.config.kafka.send_reserve_ticket_command", return_value={}),
    ):
        with TestClient(test_app, raise_server_exceptions=False) as client:
            yield client
