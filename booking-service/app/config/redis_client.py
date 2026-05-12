import os
import redis

_client: redis.Redis | None = None

CART_PREFIX = "cart:"
CART_TTL = 86400  # 24 hours


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", 6379)),
            decode_responses=True,
        )
    return _client


def cart_key(user_id: str) -> str:
    return f"{CART_PREFIX}{user_id}"
