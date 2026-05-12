from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class CartItem(BaseModel):
    eventId: str
    quantity: int
    eventName: str = ""
    price: float = 0.0


class CartResponse(BaseModel):
    userId: str
    items: list[CartItem] = []
    servedBy: Optional[str] = None


class AddToCartRequest(BaseModel):
    eventId: str
    quantity: int = Field(default=1, ge=1)


class CreateBookingRequest(BaseModel):
    eventId: str
    quantity: int = Field(default=1, ge=1)
    totalSeats: int = Field(ge=1)


class BookingResponse(BaseModel):
    id: str
    user_id: str
    event_id: str
    quantity: int
    status: str
    created_at: datetime
    updated_at: datetime
    servedBy: Optional[str] = None
