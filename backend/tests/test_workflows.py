from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import KnowledgeItem, ModelConfig, WorkflowRun
from app import workflows


def test_workflow_persists_hermes_output_as_unauthorised_suggestion(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Local = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(workflows, "SessionLocal", Local)

    with Local() as db:
        model = ModelConfig(provider="openai", model_id="configured-model", enabled=True)
        db.add(model)
        db.add(KnowledgeItem(category="moq", title="T-shirt MOQ", text="1,000 pieces", approved=True))
        db.commit()
        run = workflows.create_workflow_run(
            db, workflow_type="outreach_drafts", title="Draft", input_text="Draft an email", model_config_id=model.id,
        )
        run_id = run.id

    def fake_run_llm(db, **kwargs):
        return SimpleNamespace(
            text="Draft only", hermes_run_id="run_123", model=db.get(ModelConfig, kwargs["run"].model_config_id),
            via_fallback=False, tool_calls={},
        )

    monkeypatch.setattr(workflows, "run_llm", fake_run_llm)
    workflows.execute_workflow_run(run_id)

    with Local() as db:
        completed = db.get(WorkflowRun, run_id)
        assert completed.status == "completed"
        assert completed.result["text"] == "Draft only"
        assert completed.result["external_actions_authorised"] is False
        assert any("no external action" in event.message.lower() for event in completed.events)
