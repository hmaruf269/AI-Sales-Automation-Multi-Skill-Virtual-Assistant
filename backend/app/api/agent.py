from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.app_settings import get_setting, set_setting
from app.config import get_settings
from app.db import get_db
from app.llm import budget_status, get_client
from app.models import ModelConfig, UsageRecord, WorkflowRun
from app.security import current_session
from app.workflows import (
    WORKFLOW_INSTRUCTIONS,
    create_workflow_run,
    dispatch_workflow,
    request_cancel,
    retry_workflow,
)

router = APIRouter(prefix="/api", tags=["agent"], dependencies=[Depends(current_session)])


class RunInput(BaseModel):
    type: str
    title: str = ""
    input: str = Field(min_length=1, max_length=100_000)
    model_config_id: int | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class ModelInput(BaseModel):
    provider: Literal["openai", "kimi"]
    model_id: str = Field(min_length=1, max_length=200)
    label: str = ""
    enabled: bool = True
    input_price_per_mtok: float | None = Field(default=None, ge=0)
    output_price_per_mtok: float | None = Field(default=None, ge=0)
    cached_input_price_per_mtok: float | None = Field(default=None, ge=0)
    currency: str = "USD"
    pricing_note: str = ""


class RoutingInput(BaseModel):
    workflow_models: dict[str, dict[str, int | None]]
    fallback_enabled: bool = False
    max_retries: int = Field(default=2, ge=0, le=5)


def _model(row: ModelConfig) -> dict:
    return {
        "id": row.id, "provider": row.provider, "model_id": row.model_id, "label": row.label,
        "enabled": row.enabled, "input_price_per_mtok": row.input_price_per_mtok,
        "output_price_per_mtok": row.output_price_per_mtok,
        "cached_input_price_per_mtok": row.cached_input_price_per_mtok, "currency": row.currency,
        "pricing_updated_at": row.pricing_updated_at, "pricing_note": row.pricing_note,
    }


def serialize_run(db: Session, run: WorkflowRun) -> dict:
    usage = db.scalars(select(UsageRecord).where(UsageRecord.workflow_run_id == run.id).order_by(UsageRecord.id.desc())).all()
    llm_usage = next((u for u in usage if u.category.startswith("llm_")), None)
    estimated = sum(u.estimated_cost or 0 for u in usage) if any(u.estimated_cost is not None for u in usage) else None
    status = "queued" if run.status == "retrying" else run.status
    return {
        "id": run.id, "type": run.type, "title": run.title, "status": status,
        "progress": run.progress, "progress_message": run.progress_message,
        "steps": [{"label": e.message, "status": "failed" if e.level == "error" else "done", "detail": None} for e in run.events[-12:]],
        "result_summary": (run.result or {}).get("text"), "result": run.result or {},
        "result_links": [], "sources": run.sources or [],
        "error": ({"message": run.error, "recovery": run.recovery_hint or None, "retryable": run.status in {"failed", "paused"}} if run.error else None),
        "served_by": ({"provider": llm_usage.category.removeprefix("llm_"), "model": llm_usage.model, "via_fallback": llm_usage.via_fallback} if llm_usage else None),
        "approval_ids": [], "can_pause": False,
        "can_resume": run.status == "paused", "can_cancel": run.status in {"queued", "running", "retrying", "paused"},
        "can_retry": run.status in {"failed", "cancelled", "paused"}, "estimated_cost": estimated,
        "created_at": run.created_at, "updated_at": run.finished_at or run.started_at or run.created_at,
    }


@router.get("/system/status")
def system_status():
    s = get_settings()
    research, writer = get_client("research"), get_client("writer")
    return {
        "mode": "demo" if s.hermes_is_stub else "live",
        "app_version": "0.2.0",
        "timezone": s.default_timezone,
        "emergency_pause": {"paused": False, "reason": "", "since": None},
        "hermes": {
            "version_pin": s.hermes_version_pin,
            "research": "connected" if research.health() else "disconnected",
            "writer": "connected" if writer.health() else "disconnected",
        },
        "providers": {
            "openai": {"configured": s.openai_configured, "enabled_models": 0},
            "kimi": {"configured": s.kimi_configured, "enabled_models": 0},
        },
    }


@router.get("/agent/capabilities")
def hermes_capabilities(agent: Literal["research", "writer"] = "research"):
    try:
        return get_client(agent).capabilities()
    except Exception as exc:
        raise HTTPException(503, f"Hermes {agent} is unavailable: {exc}") from exc


@router.get("/agent/readiness")
def hermes_readiness(agent: Literal["research", "writer"] = "research"):
    try:
        return get_client(agent).readiness()
    except Exception as exc:
        raise HTTPException(503, f"Hermes {agent} readiness failed: {exc}") from exc


@router.get("/agent/model-options")
def hermes_model_options(agent: Literal["research", "writer"] = "research", refresh: bool = False):
    try:
        return get_client(agent).model_options(refresh=refresh)
    except Exception as exc:
        raise HTTPException(503, f"Hermes model discovery failed: {exc}") from exc


@router.get("/agent/skills")
def hermes_skills(agent: Literal["research", "writer"] = "research"):
    return get_client(agent).skills()


@router.get("/agent/toolsets")
def hermes_toolsets(agent: Literal["research", "writer"] = "research"):
    return get_client(agent).toolsets()


@router.get("/agent/workflow-types")
def workflow_types():
    return [{"type": key, "description": value} for key, value in WORKFLOW_INSTRUCTIONS.items()]


@router.post("/agent/runs", status_code=202)
@router.post("/workflow-runs", status_code=202)
def start_run(payload: RunInput, db: Session = Depends(get_db)):
    if payload.model_config_id is not None and not db.get(ModelConfig, payload.model_config_id):
        raise HTTPException(422, "Selected model does not exist.")
    try:
        run = create_workflow_run(db, workflow_type=payload.type, title=payload.title, input_text=payload.input,
                                  model_config_id=payload.model_config_id, params=payload.params)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    dispatch_workflow(run.id)
    return serialize_run(db, run)


@router.get("/workflow-runs")
@router.get("/agent/runs")
def list_runs(status: str = "", limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    query = select(WorkflowRun).order_by(WorkflowRun.id.desc()).limit(limit)
    if status:
        query = query.where(WorkflowRun.status == status)
    return [serialize_run(db, row) for row in db.scalars(query).all()]


@router.get("/workflow-runs/{run_id}")
@router.get("/agent/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found.")
    return serialize_run(db, run)


@router.post("/workflow-runs/{run_id}/cancel")
@router.post("/agent/runs/{run_id}/cancel")
def cancel_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found.")
    return serialize_run(db, request_cancel(db, run))


@router.post("/workflow-runs/{run_id}/retry")
@router.post("/agent/runs/{run_id}/retry")
def retry_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Workflow run not found.")
    try:
        retry_workflow(db, run)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return serialize_run(db, run)


@router.get("/models")
def list_models(db: Session = Depends(get_db)):
    return [_model(row) for row in db.scalars(select(ModelConfig).order_by(ModelConfig.provider, ModelConfig.label)).all()]


@router.post("/models", status_code=201)
def add_model(payload: ModelInput, db: Session = Depends(get_db)):
    if db.scalar(select(ModelConfig).where(ModelConfig.provider == payload.provider, ModelConfig.model_id == payload.model_id)):
        raise HTTPException(409, "This provider/model is already configured.")
    row = ModelConfig(**payload.model_dump())
    if payload.input_price_per_mtok is not None or payload.output_price_per_mtok is not None:
        from app.db import utcnow
        row.pricing_updated_at = utcnow()
    db.add(row); db.commit(); db.refresh(row)
    return _model(row)


@router.get("/settings/model-routing")
def get_routing(db: Session = Depends(get_db)):
    return {"workflow_models": get_setting(db, "workflow_models"), "fallback_enabled": get_setting(db, "fallback_enabled"), "max_retries": get_setting(db, "llm_max_retries")}


@router.put("/settings/model-routing")
def update_routing(payload: RoutingInput, db: Session = Depends(get_db)):
    ids = {row.id for row in db.scalars(select(ModelConfig)).all()}
    for key, route in payload.workflow_models.items():
        if key != "default" and key not in WORKFLOW_INSTRUCTIONS:
            raise HTTPException(422, f"Unknown workflow type: {key}")
        for field in ("model_id", "fallback_model_id"):
            value = route.get(field)
            if value is not None and value not in ids:
                raise HTTPException(422, f"{key}.{field} references a missing model.")
    set_setting(db, "workflow_models", payload.workflow_models)
    set_setting(db, "fallback_enabled", payload.fallback_enabled)
    set_setting(db, "llm_max_retries", payload.max_retries)
    db.commit()
    return payload


@router.get("/usage/budget-status")
def usage_budget(db: Session = Depends(get_db)):
    return budget_status(db)
