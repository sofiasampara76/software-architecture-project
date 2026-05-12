import os
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_producer = None


def _make_producer():
    from kafka import KafkaProducer

    brokers = os.getenv("KAFKA_BROKERS", "localhost:9092").split(",")
    return KafkaProducer(
        bootstrap_servers=brokers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8") if k else None,
        retries=3,
    )


def get_producer():
    global _producer
    if _producer is None:
        _producer = _make_producer()
    return _producer


def send_reserve_ticket_command(booking: dict[str, Any]) -> dict:
    producer = get_producer()
    created_at = booking.get("created_at")
    ts = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)

    message = {
        "bookingId": str(booking["id"]),
        "userId": booking["user_id"],
        "eventId": booking["event_id"],
        "quantity": booking["quantity"],
        "timestamp": ts,
    }

    future = producer.send("ReserveTicketCommand", key=str(booking["id"]), value=message)
    try:
        future.get(timeout=5)
    except Exception as e:
        logger.error("Kafka send failed: %s", e)
        raise
    return message
