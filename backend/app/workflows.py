"""Durable application workflows executed through the official Hermes Runs API.

Hermes performs reasoning and tool use. This module owns application policy: persistence,
budgets, progress, cancellation, approved business context, and the boundary that prevents
model output from becoming an authorised external action.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal, utcnow
from app.llm import BudgetExceeded, LLMFailed, LLMUnavailable, run_llm
from app.models import KnowledgeItem, WorkflowEvent, WorkflowRun
from app.safety import UNTRUSTED_RULES

log = logging.getLogger("workflows")
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="workflow")

WORKFLOW_INSTRUCTIONS: dict[str, str] = {
    "general_research": "Research the owner's question. Cite public sources and clearly separate verified facts from inference.",
    "buyer_research": (
        "Research relevant business buyers using public sources. Never generate or infer email addresses. "
        "Return company name, website, country, any email literally found on a public page, source URLs, "
        "missing information, and a concise relevance explanation."
    ),
    "outreach_drafts": (
        "Draft sales outreach for owner review. Use only the approved business facts supplied. "
        "Do not send messages, promise discounts, invent prices, certifications, capacity, or delivery dates."
    ),
    "reply_summary": "Summarise the supplied inbound messages, highlight decisions needed, and do not send any reply.",
    "reply_analysis": (
        "Classify the supplied message as interested, not_interested, requesting_information, automatic, "
        "unsubscribe, or unclear. Explain the classification and escalate uncertainty."
    ),
    "follow_up": "Prepare follow-up suggestions for owner approval. Never send them or bypass suppression checks.",
    "blog_ideas": "Create useful blog ideas and outlines. Do not claim SEO rankings or unsupported business facts.",
    "blog_generate": "Draft blog content from approved facts. Publishing always requires a separate owner approval.",
    "task_create": "Extract a proposed task and reminder. Do not send invitations or notifications.",
    "daily_summary": "Summarise the supplied daily activity and surface failures, approvals, replies, and budget risk.",
}


def log_event(db: Session, run: WorkflowRun, message: str, level: str = "info") -> None:
    db.add(WorkflowEvent(run_id=run.id, level=level, message=message[:4000]))
    db.commit()


def approved_business_context(db: Session) -> str:
    rows = db.scalars(select(KnowledgeItem).where(KnowledgeItem.approved.is_(True)).order_by(KnowledgeItem.category, KnowledgeItem.id)).all()
    if not rows:
        return "No approved business facts are available. Ask the owner instead of filling gaps."
    parts = []
    for row in rows:
        value = row.text.strip() or "; ".join(f"{k}: {v}" for k, v in (row.fields or {}).items() if str(v).strip())
        if value:
            parts.append(f"[{row.category}] {row.title}: {value}")
    return "\n".join(parts)[:24000] or "No approved business facts are available. Ask the owner instead of filling gaps."


def create_workflow_run(
    db: Session,
    *,
    workflow_type: str,
    title: str,
    input_text: str,
    model_config_id: int | None = None,
    params: dict[str, Any] | None = None,
) -> WorkflowRun:
    if workflow_type not in WORKFLOW_INSTRUCTIONS:
        raise ValueError(f"Unsupported workflow type: {workflow_type}")
    clean = (input_text or "").strip()
    if not clean:
        raise ValueError("input_text is required")
    run = WorkflowRun(
        type=workflow_type,
        title=(title or WORKFLOW_INSTRUCTIONS[workflow_type].split(".", 1)[0])[:300],
        params={**(params or {}), "input_text": clean},
        model_config_id=model_config_id,
        status="queued",
        progress=0,
        progress_message="Queued",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    log_event(db, run, "Workflow queued.")
    return run


def _event_callback(db: Session, run: WorkflowRun):
    def receive(event: dict) -> None:
        name = str(event.get("event") or event.get("type") or "progress")
        if name == "tool.started":
            tool = str(event.get("tool") or "tool")
            run.progress = min(max(run.progress, 20), 85)
            run.progress_message = f"Hermes is running {tool}"
            log_event(db, run, f"Hermes tool started: {tool}")
        elif name == "tool.completed":
            tool = str(event.get("tool") or "tool")
            run.progress = min(max(run.progress + 10, 35), 90)
            run.progress_message = f"Completed {tool}"
            log_event(db, run, f"Hermes tool completed: {tool}", "warning" if event.get("error") else "info")
        elif name in {"message.interim", "assistant.commentary"}:
            text = str(event.get("text") or "").strip()
            if text:
                run.progress_message = text[:500]
                log_event(db, run, text[:2000])
        elif name.startswith("subagent."):
            log_event(db, run, f"Hermes {name}: {event.get('summary') or event.get('status') or ''}".strip())
        db.commit()
    return receive


def execute_workflow_run(run_id: int) -> None:
    db = SessionLocal()
    run: WorkflowRun | None = None
    try:
        run = db.get(WorkflowRun, run_id)
        if not run or run.status not in {"queued", "retrying"}:
            return
        run.status = "running"
        run.started_at = utcnow()
        run.progress = 5
        run.progress_message = "Connecting to Hermes"
        run.error = ""
        run.recovery_hint = ""
        db.commit()
        log_event(db, run, "Hermes execution started.")

        base = WORKFLOW_INSTRUCTIONS[run.type]
        instructions = (
            "You are the reasoning engine inside a single-owner sales assistant. "
            "You may research and draft, but you are not authorised to send email, publish, invite attendees, "
            "change CRM records, or make commercial commitments. Return suggestions and evidence for review.\n\n"
            f"{UNTRUSTED_RULES}\n\nWORKFLOW POLICY:\n{base}\n\nAPPROVED BUSINESS FACTS:\n"
            f"{approved_business_context(db)}"
        )
        result = run_llm(
            db,
            workflow_type=run.type,
            agent="research" if run.type in {"buyer_research", "general_research"} else "writer",
            instructions=instructions,
            input=str(run.params.get("input_text") or ""),
            idem=f"workflow:{run.id}",
            run=run,
            on_event=_event_callback(db, run),
        )
        run.status = "completed"
        run.progress = 100
        run.progress_message = "Completed"
        run.result = {
            "text": result.text,
            "hermes_run_id": result.hermes_run_id,
            "provider": result.model.provider,
            "model": result.model.model_id,
            "via_fallback": result.via_fallback,
            "tool_calls": result.tool_calls,
            "external_actions_authorised": False,
        }
        run.finished_at = utcnow()
        db.commit()
        log_event(db, run, "Workflow completed. Output is a suggestion; no external action was authorised.")
    except BudgetExceeded as exc:
        if run:
            run.status, run.error, run.recovery_hint = "paused", str(exc), "Raise the application budget or wait for the next budget period."
            run.finished_at = utcnow(); db.commit(); log_event(db, run, str(exc), "warning")
    except LLMUnavailable as exc:
        if run:
            run.status, run.error, run.recovery_hint = "failed", str(exc), "Configure Hermes and a workflow model, then retry."
            run.finished_at = utcnow(); db.commit(); log_event(db, run, str(exc), "error")
    except LLMFailed as exc:
        if run:
            cancelled = run.cancel_requested
            run.status = "cancelled" if cancelled else "failed"
            run.error = str(exc)
            run.recovery_hint = "Review Hermes readiness and the event log, then retry." if not cancelled else ""
            run.finished_at = utcnow(); db.commit(); log_event(db, run, str(exc), "error")
    except Exception as exc:
        log.exception("workflow crashed", extra={"workflow_run_id": run_id})
        if run:
            run.status, run.error, run.recovery_hint = "failed", "The workflow crashed.", "Review structured backend logs before retrying."
            run.finished_at = utcnow(); db.commit(); log_event(db, run, f"Unhandled error: {exc}", "error")
    finally:
        db.close()


def dispatch_workflow(run_id: int) -> None:
    if get_settings().worker_mode == "celery":
        from app.worker import celery_app
        celery_app.send_task("app.run_workflow", args=[run_id])
    else:
        _executor.submit(execute_workflow_run, run_id)


def request_cancel(db: Session, run: WorkflowRun) -> WorkflowRun:
    if run.status not in {"queued", "running", "retrying", "paused"}:
        return run
    run.cancel_requested = True
    if run.status in {"queued", "paused"}:
        run.status = "cancelled"
        run.finished_at = utcnow()
    run.progress_message = "Cancellation requested"
    db.commit()
    log_event(db, run, "Owner requested cancellation.", "warning")
    return run


def retry_workflow(db: Session, run: WorkflowRun) -> WorkflowRun:
    if run.status not in {"failed", "cancelled", "paused"}:
        raise ValueError("Only failed, cancelled, or paused workflows can be retried.")
    run.status = "retrying"
    run.cancel_requested = False
    run.progress = 0
    run.progress_message = "Queued for retry"
    run.error = ""
    run.recovery_hint = ""
    run.started_at = None
    run.finished_at = None
    db.commit()
    log_event(db, run, "Workflow queued for retry.")
    dispatch_workflow(run.id)
    return run
