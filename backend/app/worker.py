"""Celery worker entrypoint: celery -A app.worker.celery_app worker -l INFO."""
from celery import Celery

from app.config import get_settings
from app.workflows import execute_workflow_run

settings = get_settings()
celery_app = Celery("sales_assistant", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.default_timezone,
)


@celery_app.task(name="app.run_workflow", bind=True, autoretry_for=(), acks_late=True)
def run_workflow_task(self, run_id: int) -> None:
    execute_workflow_run(run_id)
