import os
from fastapi import APIRouter, Depends, HTTPException

from app.middleware.auth import validate_token
from app.models.schemas import (
    AddToCartRequest,
    CartResponse,
    CreateBookingRequest,
    BookingResponse,
)
from app.services import booking_service as svc
from app.repositories import booking_repository as repo

router = APIRouter()
INSTANCE_ID = os.getenv("INSTANCE_ID", "booking-service")


def _uid(user: dict) -> str:
    return user.get("user") or user.get("id") or user.get("userId") or user.get("sub") or ""


# ── Cart ──────────────────────────────────────────────────────────────────────

@router.get("/cart")
def get_cart(user: dict = Depends(validate_token)):
    cart = svc.get_cart(_uid(user))
    cart["servedBy"] = INSTANCE_ID
    return cart


@router.post("/cart/items")
def add_to_cart(body: AddToCartRequest, user: dict = Depends(validate_token)):
    cart = svc.add_to_cart(_uid(user), body.eventId, body.quantity)
    cart["servedBy"] = INSTANCE_ID
    return cart


@router.delete("/cart/items/{event_id}")
def remove_from_cart(event_id: str, user: dict = Depends(validate_token)):
    cart = svc.remove_from_cart(_uid(user), event_id)
    cart["servedBy"] = INSTANCE_ID
    return cart


@router.delete("/cart")
def clear_cart(user: dict = Depends(validate_token)):
    svc.clear_cart(_uid(user))
    return {"message": "Cart cleared", "servedBy": INSTANCE_ID}


# ── Bookings ──────────────────────────────────────────────────────────────────

@router.post("/bookings", status_code=201)
def create_booking(body: CreateBookingRequest, user: dict = Depends(validate_token)):
    booking = svc.checkout(_uid(user), body.eventId, body.quantity, body.totalSeats)
    return {**booking, "servedBy": INSTANCE_ID}


@router.get("/bookings/me")
def get_my_bookings(user: dict = Depends(validate_token)):
    bookings = repo.get_bookings_by_user(_uid(user))
    return {"bookings": bookings, "servedBy": INSTANCE_ID}


@router.get("/bookings/{booking_id}")
def get_booking(booking_id: str, user: dict = Depends(validate_token)):
    booking = repo.get_booking_by_id(booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["user_id"] != _uid(user):
        raise HTTPException(status_code=403, detail="Access denied")
    return {**booking, "servedBy": INSTANCE_ID}
