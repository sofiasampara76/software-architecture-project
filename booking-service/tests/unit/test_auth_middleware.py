"""Unit tests for the auth middleware (validate_token dependency)."""
from unittest.mock import patch, MagicMock

import httpx
import pytest
from fastapi import HTTPException


def _call_validate(token: str | None = "good-token") -> dict:
    """Import and call the middleware directly (bypasses FastAPI DI)."""
    from app.middleware.auth import validate_token
    from fastapi.security import HTTPAuthorizationCredentials

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return validate_token(creds)


class TestValidateToken:
    def test_returns_user_on_valid_token(self):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {"id": "user-1", "email": "a@b.com"}
        mock_resp.raise_for_status.return_value = None

        with patch("httpx.get", return_value=mock_resp):
            user = _call_validate("valid")
        assert user["id"] == "user-1"

    def test_raises_401_when_auth_returns_401(self):
        mock_resp = MagicMock(status_code=401)
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401", request=MagicMock(), response=mock_resp
        )

        with patch("httpx.get", return_value=mock_resp):
            with pytest.raises(HTTPException) as exc:
                _call_validate("expired")
        assert exc.value.status_code == 401

    def test_raises_503_when_auth_service_unreachable(self):
        with patch("httpx.get", side_effect=httpx.ConnectError("refused")):
            with pytest.raises(HTTPException) as exc:
                _call_validate("any")
        assert exc.value.status_code == 503

    def test_raises_503_on_unexpected_http_error(self):
        mock_resp = MagicMock(status_code=500)
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=mock_resp
        )

        with patch("httpx.get", return_value=mock_resp):
            with pytest.raises(HTTPException) as exc:
                _call_validate("token")
        assert exc.value.status_code == 503
