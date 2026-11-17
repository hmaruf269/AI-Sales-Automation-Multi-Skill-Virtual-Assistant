import copy
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Setting

DEFAULTS: dict[str, Any] = {
    "timezone": None,  # falls back to DEFAULT_TIMEZONE
    "emergency_pause": False,
    "budget": {"daily": None, "monthly": None, "inflight_allowance_pct": 10, "currency": "USD"},
    # workflow type -> {"model_id": int, "fallback_model_id": int | None}; "default" applies to the rest.
    "workflow_models": {},
    "fallback_enabled": False,
    "llm_max_retries": 2,
    # Per-unit estimates for non-LLM paid services, entered by the owner with the date they were checked.
    "unit_prices": {"search": None, "extraction": None, "verification": None, "browser": None, "updated_at": None},
    "auto_reply": {"enabled": False, "topics": []},
    "research": {"max_leads_per_run": 10},
    "reminders": {"owner_email": "", "account_id": None},
    "blog": {"image_generation_enabled": False},
}


def get_setting(db: Session, key: str) -> Any:
    row = db.get(Setting, key)
    default = copy.deepcopy(DEFAULTS.get(key))
    if row is None:
        value = default
    elif isinstance(default, dict) and isinstance(row.value, dict):
        value = {**default, **row.value}
    else:
        value = row.value
    if key == "timezone" and not value:
        return get_settings().default_timezone
    return value


def set_setting(db: Session, key: str, value: Any) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
    db.flush()


def all_settings(db: Session) -> dict[str, Any]:
    return {key: get_setting(db, key) for key in DEFAULTS}
