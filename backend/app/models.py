from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow

LEAD_STATUSES = ["new", "contacted", "replied", "interested", "won", "lost"]
REPLY_CLASSES = ["interested", "not_interested", "requesting_information", "automatic", "unsubscribe", "unclear"]
KNOWLEDGE_CATEGORIES = [
    "factory_profile", "product", "pricing", "moq", "production_capacity",
    "delivery_time", "payment_terms", "certification", "sales_statement",
]
USAGE_CATEGORIES = ["llm_openai", "llm_kimi", "search", "extraction", "verification", "browser"]


def pk() -> Mapped[int]:
    return mapped_column(Integer, primary_key=True, autoincrement=True)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime, default=utcnow, nullable=False)


class Owner(Base):
    __tablename__ = "owners"
    id: Mapped[int] = pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(400))
    created_at: Mapped[datetime] = created()


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[int] = pk()
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = created()


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = pk()
    ip: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = created()


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ModelConfig(Base):
    """A provider model the owner has enabled. Model ids and prices are data, never constants in code."""
    __tablename__ = "model_configs"
    __table_args__ = (UniqueConstraint("provider", "model_id"),)
    id: Mapped[int] = pk()
    provider: Mapped[str] = mapped_column(String(20))  # openai | kimi
    model_id: Mapped[str] = mapped_column(String(200))
    label: Mapped[str] = mapped_column(String(200), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    input_price_per_mtok: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    output_price_per_mtok: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cached_input_price_per_mtok: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    pricing_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pricing_note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = created()


class UsageRecord(Base):
    __tablename__ = "usage_records"
    __table_args__ = (Index("ix_usage_created", "created_at"),)
    id: Mapped[int] = pk()
    category: Mapped[str] = mapped_column(String(30), index=True)
    provider: Mapped[str] = mapped_column(String(60), default="")
    model: Mapped[str] = mapped_column(String(200), default="")
    workflow_run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    hermes_run_id: Mapped[str] = mapped_column(String(80), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    units: Mapped[int] = mapped_column(Integer, default=0)
    # App-side estimate from the pricing table; None when no price is configured. Never provider billing.
    estimated_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    via_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = created()


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[int] = pk()
    type: Mapped[str] = mapped_column(String(50), index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    # queued | running | completed | failed | cancelled | blocked
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    progress_message: Mapped[str] = mapped_column(String(500), default="")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str] = mapped_column(Text, default="")
    recovery_hint: Mapped[str] = mapped_column(String(500), default="")
    model_config_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    schedule_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    events: Mapped[list["WorkflowEvent"]] = relationship(cascade="all, delete-orphan", order_by="WorkflowEvent.id")


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"
    id: Mapped[int] = pk()
    run_id: Mapped[int] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(10), default="info")
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Schedule(Base):
    """Recurring workflow definition. Celery beat's tick is the only thing that ever fires these."""
    __tablename__ = "schedules"
    id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(200))
    workflow_type: Mapped[str] = mapped_column(String(50))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | paused
    interval_minutes: Mapped[int] = mapped_column(Integer, default=1440)
    max_runtime_seconds: Mapped[int] = mapped_column(Integer, default=900)
    concurrency: Mapped[int] = mapped_column(Integer, default=1)
    daily_spend_limit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    daily_search_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pause_reason: Mapped[str] = mapped_column(String(300), default="")
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = created()


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = pk()
    role: Mapped[str] = mapped_column(String(12))  # owner | assistant | system
    content: Mapped[str] = mapped_column(Text)
    workflow_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created()


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"
    id: Mapped[int] = pk()
    category: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(300))
    fields: Mapped[dict] = mapped_column(JSON, default=dict)
    text: Mapped[str] = mapped_column(Text, default="")
    # Only approved items are ever given to a model as business facts.
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_reply_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    created_at: Mapped[datetime] = created()


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id: Mapped[int] = pk()
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(120), default="")
    stored_path: Mapped[str] = mapped_column(String(500))
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(300))
    name_key: Mapped[str] = mapped_column(String(300), index=True)
    website: Mapped[str] = mapped_column(String(500), default="")
    # Normalised host; unique across the whole database when present.
    domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    country: Mapped[str] = mapped_column(String(80), default="", index=True)
    industry: Mapped[str] = mapped_column(String(200), default="")
    buyer_type: Mapped[str] = mapped_column(String(120), default="")
    relevant_products: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    relevance: Mapped[str] = mapped_column(Text, default="")
    lead_source: Mapped[str] = mapped_column(String(200), default="")
    missing_info: Mapped[list] = mapped_column(JSON, default=list)
    outreach_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    follow_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    researched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = created()
    contacts: Mapped[list["Contact"]] = relationship(cascade="all, delete-orphan")
    sources: Mapped[list["LeadSource"]] = relationship(cascade="all, delete-orphan")
    notes: Mapped[list["Note"]] = relationship(cascade="all, delete-orphan", order_by="Note.id.desc()")


class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[int] = pk()
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(200), default="")
    # Lower-cased address; unique across the whole database so one buyer is never approached twice.
    email: Mapped[Optional[str]] = mapped_column(String(320), unique=True, nullable=True)
    # verified_on_source | unverified | owner_entered | bounced
    email_status: Mapped[str] = mapped_column(String(30), default="unverified")
    email_source_url: Mapped[str] = mapped_column(String(1000), default="")
    email_evidence: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = created()


class LeadSource(Base):
    __tablename__ = "lead_sources"
    id: Mapped[int] = pk()
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(500), default="")
    # True only when the backend itself fetched the page and confirmed it loads.
    fetched_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    workflow_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created()


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = pk()
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Suppression(Base):
    """Global no-contact list. A row with only `domain` blocks every address at that domain."""
    __tablename__ = "suppressions"
    id: Mapped[int] = pk()
    email: Mapped[Optional[str]] = mapped_column(String(320), unique=True, nullable=True)
    domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    reason: Mapped[str] = mapped_column(String(30))  # unsubscribe | bounce | manual | no_contact
    detail: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = created()


class EmailAccount(Base):
    __tablename__ = "email_accounts"
    id: Mapped[int] = pk()
    address: Mapped[str] = mapped_column(String(320), unique=True)
    provider: Mapped[str] = mapped_column(String(20))  # gmail | microsoft | imap_smtp | demo
    # "alias" sends through its parent mailbox and never has its own inbox or credentials.
    kind: Mapped[str] = mapped_column(String(10), default="mailbox")
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("email_accounts.id", ondelete="CASCADE"), nullable=True)
    # connected | disconnected | needs_reauth | error
    status: Mapped[str] = mapped_column(String(20), default="disconnected")
    sender_name: Mapped[str] = mapped_column(String(200), default="")
    signature: Mapped[str] = mapped_column(Text, default="")
    credentials_enc: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    daily_limit: Mapped[int] = mapped_column(Integer, default=40)
    hourly_limit: Mapped[int] = mapped_column(Integer, default=10)
    window_start: Mapped[str] = mapped_column(String(5), default="09:00")
    window_end: Mapped[str] = mapped_column(String(5), default="17:00")
    send_days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Dhaka")
    sync_cursor: Mapped[str] = mapped_column(String(300), default="")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = created()


class Sequence(Base):
    __tablename__ = "sequences"
    id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(200))
    # Follow-up steps only: [{"delay_days": 4, "guidance": "..."}]. Step 0 is always the first email.
    steps: Mapped[list] = mapped_column(JSON, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = pk()
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    # One outreach conversation per contact, enforced by the database, across every sender account.
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), unique=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("email_accounts.id"), index=True)
    sequence_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sequences.id"), nullable=True)
    subject: Mapped[str] = mapped_column(String(500), default="")
    provider_thread_id: Mapped[str] = mapped_column(String(300), default="", index=True)
    # draft | active | replied | stopped | closed
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    stop_reason: Mapped[str] = mapped_column(String(100), default="")
    approval_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_inbound_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = created()
    messages: Mapped[list["Message"]] = relationship(cascade="all, delete-orphan", order_by="Message.id")
    company: Mapped[Company] = relationship()
    contact: Mapped[Contact] = relationship()
    account: Mapped[EmailAccount] = relationship()


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = pk()
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    direction: Mapped[str] = mapped_column(String(3))  # out | in
    kind: Mapped[str] = mapped_column(String(12), default="initial")  # initial | followup | reply | inbound
    step: Mapped[int] = mapped_column(Integer, default=0)
    from_addr: Mapped[str] = mapped_column(String(320), default="")
    to_addr: Mapped[str] = mapped_column(String(320), default="")
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # out: draft | approved | queued | sending | sent | failed | bounced | cancelled | needs_review | simulated
    # in:  received
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(String(1000), default="")
    # Deterministic per logical send; also the RFC Message-ID so a retry can find an already-delivered copy.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(120), unique=True, nullable=True)
    rfc_message_id: Mapped[str] = mapped_column(String(300), default="", index=True)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    in_reply_to: Mapped[str] = mapped_column(String(300), default="")
    approval_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    classification: Mapped[str] = mapped_column(String(30), default="")
    classification_reason: Mapped[str] = mapped_column(String(500), default="")
    classified_by: Mapped[str] = mapped_column(String(20), default="")  # rule | model
    escalate: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()

    __table_args__ = (UniqueConstraint("conversation_id", "provider_message_id", name="uq_msg_provider"),)


class Approval(Base):
    """Owner authorisation bound to a hash of exactly what was reviewed."""
    __tablename__ = "approvals"
    id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(30), index=True)  # outreach_bundle | reply | meeting | blog_publish
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    # pending | approved | rejected | invalidated
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    decided_by: Mapped[str] = mapped_column(String(40), default="")  # owner | auto_reply_policy
    invalid_reason: Mapped[str] = mapped_column(String(300), default="")
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = created()


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | in_progress | done
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low | normal | high | urgent
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    recurrence: Mapped[str] = mapped_column(String(10), default="none")  # none | daily | weekly | monthly
    recurrence_interval: Mapped[int] = mapped_column(Integer, default=1)
    remind_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reminder_channel: Mapped[str] = mapped_column(String(20), default="dashboard")  # dashboard | email
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    history: Mapped[list] = mapped_column(JSON, default=list)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = created()


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(120), unique=True, nullable=True)
    created_at: Mapped[datetime] = created()


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    id: Mapped[int] = pk()
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Dhaka")
    attendees: Mapped[list] = mapped_column(JSON, default=list)
    # draft | pending_approval | confirmed | failed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="draft")
    provider: Mapped[str] = mapped_column(String(20), default="local")  # local | google
    provider_event_id: Mapped[str] = mapped_column(String(300), default="")
    invites_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = created()


class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[int] = pk()
    kind: Mapped[str] = mapped_column(String(30), unique=True)  # wordpress | google_calendar
    status: Mapped[str] = mapped_column(String(20), default="disconnected")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    credentials_enc: Mapped[str] = mapped_column(Text, default="")
    last_error: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BlogPost(Base):
    __tablename__ = "blog_posts"
    id: Mapped[int] = pk()
    topic: Mapped[str] = mapped_column(String(500), default="")
    title: Mapped[str] = mapped_column(String(300), default="")
    outline: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    seo_title: Mapped[str] = mapped_column(String(300), default="")
    meta_description: Mapped[str] = mapped_column(String(500), default="")
    social_captions: Mapped[list] = mapped_column(JSON, default=list)
    # idea | draft | scheduled | publishing | published | failed
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    cms: Mapped[str] = mapped_column(String(30), default="wordpress")
    cms_post_id: Mapped[str] = mapped_column(String(100), default="")
    published_url: Mapped[str] = mapped_column(String(1000), default="")
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approval_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = created()
