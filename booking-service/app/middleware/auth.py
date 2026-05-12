import os
import httpx
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:3001")
_security = HTTPBearer()


def validate_token(credentials: HTTPAuthorizationCredentials = Security(_security)) -> dict:
    token = credentials.credentials
    try:
        response = httpx.get(
            f"{AUTH_SERVICE_URL}/validate",
            params={"token": token},
            timeout=5.0,
        )
        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        response.raise_for_status()
        return response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        raise HTTPException(status_code=503, detail="Authentication service unavailable")
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Authentication service unavailable")
