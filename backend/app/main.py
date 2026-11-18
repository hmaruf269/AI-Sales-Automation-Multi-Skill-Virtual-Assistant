from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.auth import router as auth_router
from app.bootstrap import ensure_gemini_free_model
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.security import configure_logging, ensure_owner


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_owner(db)
        ensure_gemini_free_model(db)
    yield


app = FastAPI(
    title="AI Sales Automation API",
    version="0.2.0",
    description="Single-owner sales automation backend powered by the official Hermes Agent Runs API.",
    lifespan=lifespan,
)

s = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[s.public_base_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)
app.include_router(auth_router)
app.include_router(agent_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "sales-assistant-backend", "version": app.version}
