import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.routers.booking_router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialise DB (no Redis/Kafka connections needed at import time)
    from app.config.database import init_db
    init_db()
    yield


def create_app() -> FastAPI:
    instance_id = os.getenv("INSTANCE_ID", "booking-service")
    app = FastAPI(title="Booking Service", version="1.0.0", lifespan=lifespan)

    @app.get("/health")
    def health():
        import datetime
        return {"status": "ok", "instance": instance_id, "timestamp": datetime.datetime.now(datetime.UTC).isoformat()}

    app.include_router(router)
    return app


app = create_app()
