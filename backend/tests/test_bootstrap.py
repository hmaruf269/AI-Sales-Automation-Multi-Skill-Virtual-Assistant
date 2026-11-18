from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.app_settings import get_setting, set_setting
from app.bootstrap import ensure_gemini_free_model
from app.config import get_settings
from app.db import Base
from app.models import ModelConfig


def local_session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'bootstrap.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_enabled_gemini_is_seeded_and_becomes_default(tmp_path, monkeypatch):
    settings = get_settings().model_copy(update={"gemini_configured": True})
    monkeypatch.setattr("app.bootstrap.get_settings", lambda: settings)
    with local_session(tmp_path) as db:
        first = ensure_gemini_free_model(db)
        second = ensure_gemini_free_model(db)
        models = db.scalars(select(ModelConfig)).all()

        assert first is not None
        assert second.id == first.id
        assert len(models) == 1
        assert first.provider == "gemini"
        assert first.model_id == "gemini-3.5-flash-lite"
        assert get_setting(db, "workflow_models")["default"]["model_id"] == first.id


def test_existing_default_route_is_preserved(tmp_path, monkeypatch):
    settings = get_settings().model_copy(update={"gemini_configured": True})
    monkeypatch.setattr("app.bootstrap.get_settings", lambda: settings)
    with local_session(tmp_path) as db:
        existing = ModelConfig(provider="openai", model_id="existing", enabled=True)
        db.add(existing)
        db.flush()
        set_setting(db, "workflow_models", {"default": {"model_id": existing.id, "fallback_model_id": None}})
        db.commit()

        ensure_gemini_free_model(db)

        assert get_setting(db, "workflow_models")["default"]["model_id"] == existing.id


def test_disabled_gemini_does_not_seed(tmp_path, monkeypatch):
    settings = get_settings().model_copy(update={"gemini_configured": False})
    monkeypatch.setattr("app.bootstrap.get_settings", lambda: settings)
    with local_session(tmp_path) as db:
        assert ensure_gemini_free_model(db) is None
        assert db.scalar(select(ModelConfig)) is None
