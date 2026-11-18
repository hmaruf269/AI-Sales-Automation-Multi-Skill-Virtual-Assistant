"""Idempotent application defaults for an owner starting with Gemini free tier."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.app_settings import get_setting, set_setting
from app.config import get_settings
from app.models import ModelConfig


def ensure_gemini_free_model(db: Session) -> ModelConfig | None:
    """Create and route the bundled Gemini model once its server key is enabled.

    Existing model and routing choices always win, so restarting or later editing
    Settings never overwrites owner configuration.
    """
    settings = get_settings()
    if not settings.gemini_configured:
        return None

    model = db.scalar(select(ModelConfig).where(
        ModelConfig.provider == "gemini",
        ModelConfig.model_id == settings.gemini_default_model,
    ))
    if model is None:
        model = ModelConfig(
            provider="gemini",
            model_id=settings.gemini_default_model,
            label="Gemini 3.5 Flash-Lite (free tier)",
            enabled=True,
            input_price_per_mtok=0,
            output_price_per_mtok=0,
            currency="USD",
            pricing_note=(
                "Google AI Studio free-tier token price. If billing is enabled for this key, "
                "replace these zero estimates with the current paid-tier prices."
            ),
        )
        db.add(model)
        db.flush()

    routing = get_setting(db, "workflow_models")
    if not routing.get("default", {}).get("model_id"):
        routing["default"] = {"model_id": model.id, "fallback_model_id": None}
        set_setting(db, "workflow_models", routing)

    db.commit()
    return model
