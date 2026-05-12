import json
import logging

import httpx
from fastapi import HTTPException

from app.config.redis_client import get_redis, cart_key, CART_TTL
from app.config import kafka as kafka_config
from app.repositories import booking_repository as repo

CATALOG_SERVICE_URL_ENV = "CATALOG_SERVICE_URL"

logger = logging.getLogger(__name__)


def _catalog_url() -> str:
    import os
    return os.getenv(CATALOG_SERVICE_URL_ENV, "http://localhost:3002")


# ── Cart ──────────────────────────────────────────────────────────────────────

def get_cart(user_id: str) -> dict:
    r = get_redis()
    data = r.get(cart_key(user_id))
    return json.loads(data) if data else {"userId": user_id, "items": []}


def add_to_cart(user_id: str, event_id: str, quantity: int) -> dict:
    try:
        response = httpx.get(f"{_catalog_url()}/events/{event_id}", timeout=5.0)
        response.raise_for_status()
        event = response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Event not found")
        raise HTTPException(status_code=503, detail="Catalog service unavailable")
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Catalog service unavailable")

    available = event.get("availableSeats") or event.get("available_seats") or 0
    if available < quantity:
        raise HTTPException(
            status_code=422,
            detail=f"Not enough seats. Available: {available}",
        )

    cart = get_cart(user_id)
    items: list = cart["items"]

    idx = next((i for i, x in enumerate(items) if x["eventId"] == event_id), None)
    if idx is not None:
        items[idx]["quantity"] += quantity
    else:
        items.append(
            {
                "eventId": event_id,
                "quantity": quantity,
                "eventName": event.get("name") or event.get("title") or "",
                "price": event.get("price") or 0.0,
            }
        )

    r = get_redis()
    r.set(cart_key(user_id), json.dumps(cart), ex=CART_TTL)
    return cart


def remove_from_cart(user_id: str, event_id: str) -> dict:
    cart = get_cart(user_id)
    cart["items"] = [i for i in cart["items"] if i["eventId"] != event_id]
    r = get_redis()
    r.set(cart_key(user_id), json.dumps(cart), ex=CART_TTL)
    return cart


def clear_cart(user_id: str) -> None:
    get_redis().delete(cart_key(user_id))


# ── Booking ───────────────────────────────────────────────────────────────────

def checkout(user_id: str, event_id: str, quantity: int, total_seats: int) -> dict:
    result = repo.reserve_seats_optimistic(event_id, quantity, total_seats)

    if not result["success"]:
        if result["reason"] == "insufficient_seats":
            raise HTTPException(
                status_code=422,
                detail=f"Not enough seats. Available: {result['available']}",
            )
        # concurrent_modification — optimistic lock failed
        raise HTTPException(
            status_code=409,
            detail="Booking conflict: another reservation was made simultaneously. Please try again.",
        )

    booking = repo.create_booking(user_id, event_id, quantity)

    try:
        kafka_config.send_reserve_ticket_command(booking)
    except Exception as exc:
        # Booking is created in DB (pending); ticketing service processes it when Kafka recovers
        logger.error("Kafka send failed, booking stays pending: %s", exc)

    return booking
