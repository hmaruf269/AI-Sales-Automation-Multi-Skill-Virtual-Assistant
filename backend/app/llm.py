"""Model routing, bounded retries, optional provider fallback, usage recording and budget enforcement.

Every model call in the application goes through `run_llm`, which talks to Hermes. Costs recorded here are
application estimates from the owner-maintained pricing table; they are not provider billing.
"""
import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.app_settings import get_setting
from app.config import get_settings
from app.hermes import HermesClient, HermesError, RunResult
from app.models import ModelConfig, UsageRecord, WorkflowRun

log = logging.getLogger("llm")
_sleep = time.sleep
_clients: dict[str, HermesClient] = {}


class LLMUnavailable(Exception):
    """The call could not be attempted (not configured, no model chosen, unpriced under a budget)."""


class BudgetExceeded(Exception):
    pass


class LLMFailed(Exception):
    pass


@dataclass
class LLMResult:
    text: str
    model: ModelConfig
    hermes_run_id: str
    via_fallback: bool
    tool_calls: dict


def get_client(agent: str) -> HermesClient:
    if agent not in _clients:
        s = get_settings()
        url, key = (s.hermes_research_url, s.hermes_research_key) if agent == "research" else (s.hermes_writer_url, s.hermes_writer_key)
        _clients[agent] = HermesClient(url, key, poll_seconds=s.hermes_poll_seconds)
    return _clients[agent]


def set_client(agent: str, client: HermesClient | None) -> None:
    if client is None:
        _clients.pop(agent, None)
    else:
        _clients[agent] = client


def provider_configured(provider: str) -> bool:
    s = get_settings()
    return {"openai": s.openai_configured, "kimi": s.kimi_configured}.get(provider, False)


def hermes_provider_id(provider: str) -> str:
    s = get_settings()
    return {"openai": s.hermes_openai_provider, "kimi": s.hermes_kimi_provider}[provider]


def _app_provider(hermes_provider: str, default: str) -> str:
    s = get_settings()
    return {s.hermes_openai_provider: "openai", s.hermes_kimi_provider: "kimi"}.get(hermes_provider, default)


def resolve_models(db: Session, workflow_type: str, explicit_model_id: int | None = None) -> list[ModelConfig]:
    """Primary model, then at most one fallback. An explicit per-task choice overrides the workflow mapping."""
    mapping = get_setting(db, "workflow_models")
    entry = mapping.get(workflow_type) or mapping.get("default") or {}
    primary_id = explicit_model_id or entry.get("model_id")
    if not primary_id:
        raise LLMUnavailable("No model is selected for this workflow. Choose one under Settings > Models.")
    primary = db.get(ModelConfig, primary_id)
    if not primary or not primary.enabled:
        raise LLMUnavailable("The selected model no longer exists or is disabled. Choose another under Settings > Models.")
    chain = [primary]
    fallback_id = entry.get("fallback_model_id")
    if get_setting(db, "fallback_enabled") and fallback_id and fallback_id != primary.id:
        fallback = db.get(ModelConfig, fallback_id)
        if fallback and fallback.enabled and provider_configured(fallback.provider):
            chain.append(fallback)
    return chain


def _period_starts(db: Session) -> tuple[datetime, datetime]:
    tz = ZoneInfo(get_setting(db, "timezone"))
    now = datetime.now(tz)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)  # noqa: E731
    return to_utc(day), to_utc(day.replace(day=1))


def spend_since(db: Session, start: datetime, schedule_id: int | None = None) -> float:
    q = select(func.coalesce(func.sum(UsageRecord.estimated_cost), 0.0)).where(UsageRecord.created_at >= start)
    if schedule_id is not None:
        q = q.join(WorkflowRun, WorkflowRun.id == UsageRecord.workflow_run_id).where(WorkflowRun.schedule_id == schedule_id)
    return float(db.scalar(q) or 0.0)


def budget_status(db: Session) -> dict:
    budget = get_setting(db, "budget")
    day_start, month_start = _period_starts(db)
    unpriced = db.scalar(select(func.count(UsageRecord.id)).where(
        UsageRecord.created_at >= month_start, UsageRecord.estimated_cost.is_(None)))
    return {
        "currency": budget["currency"],
        "inflight_allowance_pct": budget["inflight_allowance_pct"],
        "daily": {"limit": budget["daily"], "spent": round(spend_since(db, day_start), 6)},
        "monthly": {"limit": budget["monthly"], "spent": round(spend_since(db, month_start), 6)},
        "unpriced_records_this_month": unpriced or 0,
    }


def check_budget(db: Session, *, inflight: bool = False) -> None:
    """New work stops at the limit; a workflow already in flight may use the configured small allowance."""
    status = budget_status(db)
    factor = 1 + (status["inflight_allowance_pct"] or 0) / 100 if inflight else 1
    for period in ("daily", "monthly"):
        limit = status[period]["limit"]
        if limit is not None and status[period]["spent"] >= limit * factor:
            raise BudgetExceeded(
                f"The {period} budget of {limit:.2f} {status['currency']} has been reached "
                f"(estimated spend {status[period]['spent']:.2f}). Raise the budget in Settings to continue.")


def budgets_active(db: Session) -> bool:
    budget = get_setting(db, "budget")
    return budget["daily"] is not None or budget["monthly"] is not None


def estimate_cost(cfg: ModelConfig | None, usage: dict) -> float | None:
    if cfg is None or cfg.input_price_per_mtok is None or cfg.output_price_per_mtok is None:
        return None
    inp, out = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
    cached = min(int(usage.get("cache_read_tokens") or 0), inp)
    if cfg.cached_input_price_per_mtok is not None:
        cost = (inp - cached) * cfg.input_price_per_mtok + cached * cfg.cached_input_price_per_mtok
    else:
        cost = inp * cfg.input_price_per_mtok
    return round((cost + out * cfg.output_price_per_mtok) / 1_000_000, 6)


def record_units(db: Session, category: str, units: int, run: WorkflowRun | None, provider: str = "", note: str = "") -> None:
    if units <= 0:
        return
    price = get_setting(db, "unit_prices").get(category)
    db.add(UsageRecord(
        category=category, provider=provider, units=units, workflow_run_id=run.id if run else None,
        estimated_cost=round(price * units, 6) if price is not None else None, note=note))
    db.commit()


def _record(db: Session, cfg: ModelConfig, result: RunResult, run: WorkflowRun | None, via_fallback: bool) -> None:
    if db.scalar(select(UsageRecord.id).where(UsageRecord.hermes_run_id == result.run_id, UsageRecord.category.like("llm_%"))):
        return  # an idempotent replay of a run that was already accounted for
    served = _app_provider(result.served_provider, cfg.provider)
    served_cfg = db.scalar(select(ModelConfig).where(
        ModelConfig.provider == served, ModelConfig.model_id == result.served_model)) or (
        cfg if (served, result.served_model) == (cfg.provider, cfg.model_id) else None)
    hermes_switched = (served, result.served_model) != (cfg.provider, cfg.model_id)
    db.add(UsageRecord(
        category=f"llm_{served}", provider=result.served_provider, model=result.served_model,
        workflow_run_id=run.id if run else None, hermes_run_id=result.run_id,
        input_tokens=int(result.usage.get("input_tokens") or 0),
        output_tokens=int(result.usage.get("output_tokens") or 0),
        cache_read_tokens=int(result.usage.get("cache_read_tokens") or 0),
        estimated_cost=estimate_cost(served_cfg, result.usage),
        via_fallback=via_fallback or hermes_switched,
        note="" if result.status == "completed" else f"run {result.status}"))
    db.commit()
    for tool, category in (("web_search", "search"), ("web_extract", "extraction")):
        record_units(db, category, result.tool_calls.get(tool, 0), run, provider="hermes-web")
    if not result.tool_counts_known and run is not None:
        from app.workflows import log_event
        log_event(db, run, "Search/extraction call counts were not observable for this run; usage for them is not recorded.", "warning")


def run_llm(db: Session, *, workflow_type: str, agent: str, instructions: str, input: str, idem: str,
            run: WorkflowRun | None = None, inflight: bool = False, timeout: float | None = None,
            on_event: Optional[Callable[[dict], None]] = None) -> LLMResult:
    client = get_client(agent)
    if not client.configured:
        raise LLMUnavailable(f"The Hermes {agent} service is not configured (HERMES_{agent.upper()}_URL).")
    chain = resolve_models(db, workflow_type, run.model_config_id if run else None)
    if not provider_configured(chain[0].provider):
        raise LLMUnavailable(f"No server-side API key is configured for {chain[0].provider}. Add it to the Hermes environment.")
    max_retries = int(get_setting(db, "llm_max_retries"))
    timeout = timeout or get_settings().hermes_run_timeout_seconds
    last_error: Exception | None = None

    def cancelled() -> bool:
        if run is None:
            return False
        db.refresh(run, ["cancel_requested"])
        return run.cancel_requested

    for position, cfg in enumerate(chain):
        if budgets_active(db) and estimate_cost(cfg, {}) is None:
            raise LLMUnavailable(
                f"Model '{cfg.model_id}' has no price configured, so the budget cannot be enforced. "
                "Enter its prices under Settings > Models or remove the budget.")
        check_budget(db, inflight=inflight or position > 0)
        key = "app-" + hashlib.sha256(f"{idem}|{cfg.id}".encode()).hexdigest()
        for attempt in range(max_retries + 1):
            try:
                result = client.run(
                    input=input, instructions=instructions, provider=hermes_provider_id(cfg.provider),
                    model=cfg.model_id, idempotency_key=key, timeout=timeout, on_event=on_event, should_cancel=cancelled)
                _record(db, cfg, result, run, via_fallback=position > 0)
                return LLMResult(result.output, cfg, result.run_id, position > 0, result.tool_calls)
            except HermesError as exc:
                last_error = exc
                if getattr(exc, "result", None) is not None:
                    _record(db, cfg, exc.result, run, via_fallback=position > 0)
                if exc.code == "cancelled":
                    raise LLMFailed(str(exc)) from exc
                if exc.retryable and attempt < max_retries:
                    _sleep(min(exc.retry_after or 2 ** (attempt + 1), 30))
                    continue
                log.warning("model call failed: %s", exc, extra={"workflow_run_id": run.id if run else None})
                break
        if position + 1 < len(chain) and run is not None:
            from app.workflows import log_event
            log_event(db, run, f"{cfg.provider}/{cfg.model_id} failed ({last_error}); trying the configured fallback.", "warning")
    raise LLMFailed(f"Model call failed after bounded retries: {last_error}")
