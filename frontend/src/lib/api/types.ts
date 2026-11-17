/**
 * Domain types shared by the HTTP client and the demo client.
 * These are the contract with the FastAPI backend — see docs/frontend-api-contracts.md.
 * All timestamps are ISO-8601 strings in UTC; the UI renders them in the owner's timezone.
 */

export type ID = number;
export type ISODate = string;

export type DataMode = "live" | "demo";
export type ConnectionStatus = "connected" | "disconnected" | "needs_reauth" | "error";
/** Model preference chosen when starting a task. "auto" uses the per-workflow routing in Settings. */
export type ModelPreference = "auto" | "openai" | "kimi";
export type ProviderKey = "openai" | "kimi";

export interface SourceLink {
  url: string;
  title?: string;
  /** True only when the backend itself fetched the page and confirmed it loaded. */
  verified?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- system & auth

export interface SessionInfo {
  authenticated: boolean;
  owner?: { name: string; email: string };
  /** Sent back as X-CSRF-Token on every non-GET request. */
  csrf_token?: string;
}

export interface SystemStatus {
  mode: DataMode;
  app_version: string;
  timezone: string;
  emergency_pause: { paused: boolean; reason: string; since: ISODate | null };
  hermes: {
    version_pin: string;
    research: ConnectionStatus;
    writer: ConnectionStatus;
  };
  providers: Record<ProviderKey, { configured: boolean; enabled_models: number }>;
}

// ---------------------------------------------------------------- workflows

export type WorkflowType =
  | "buyer_research"
  | "outreach_drafts"
  | "reply_summary"
  | "reply_analysis"
  | "follow_up"
  | "blog_ideas"
  | "blog_generate"
  | "task_create"
  | "daily_summary"
  | "general_research";

export type WorkflowStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_WORKFLOW: WorkflowStatus[] = ["completed", "failed", "cancelled"];

export interface WorkflowStep {
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
}

export interface WorkflowRun {
  id: ID;
  type: WorkflowType;
  title: string;
  status: WorkflowStatus;
  /** 0–100, or null when progress is not measurable. */
  progress: number | null;
  progress_message?: string | null;
  steps: WorkflowStep[];
  result_summary: string | null;
  /** Partial or final structured results to link to (e.g. research job, blog post). */
  result_links: { label: string; href: string }[];
  sources: SourceLink[];
  error: { message: string; recovery: string | null; retryable: boolean } | null;
  /** The provider/model that actually served the run (after any fallback). */
  served_by: { provider: ProviderKey; model: string; via_fallback: boolean } | null;
  approval_ids: ID[];
  can_pause: boolean;
  can_resume: boolean;
  can_cancel: boolean;
  can_retry: boolean;
  estimated_cost: number | null;
  created_at: ISODate;
  updated_at: ISODate;
}

// ---------------------------------------------------------------- overview

export interface ActivityItem {
  id: string;
  kind: "lead" | "email_sent" | "reply" | "approval" | "workflow" | "blog" | "task" | "error";
  title: string;
  detail?: string;
  href?: string;
  at: ISODate;
}

export interface UpcomingItem {
  id: string;
  kind: "follow_up" | "task" | "meeting";
  title: string;
  detail?: string;
  href?: string;
  due_at: ISODate;
  priority?: TaskPriority;
}

export interface Overview {
  counts: {
    total_leads: number;
    interested_buyers: number;
    replies_needing_attention: number;
    pending_approvals: number;
    running_workflows: number;
  };
  spend_today: {
    estimated: number;
    currency: string;
    daily_budget: number | null;
    /** Usage records with no configured price, so excluded from the estimate. */
    unpriced_records: number;
  };
  recent_activity: ActivityItem[];
  upcoming: UpcomingItem[];
}

// ---------------------------------------------------------------- chat

export interface ChatThread {
  id: ID;
  title: string;
  last_preview: string;
  updated_at: ISODate;
}

export interface Attachment {
  id: ID;
  filename: string;
  size: number;
  content_type: string;
}

export interface ChatMessage {
  id: ID;
  thread_id: ID;
  role: "owner" | "assistant" | "system";
  content: string;
  attachments: Attachment[];
  workflow_run_id: ID | null;
  approval_ids: ID[];
  /** True when the assistant could not map the request to a supported workflow. */
  unsupported: boolean;
  created_at: ISODate;
}

export interface CommandSuggestion {
  id: string;
  label: string;
  example: string;
  description: string;
  workflow_type: WorkflowType;
}

export interface SendChatMessageInput {
  content: string;
  model: ModelPreference;
  attachment_ids: ID[];
}

export interface SendChatMessageResult {
  messages: ChatMessage[];
  workflow_run: WorkflowRun | null;
}

// ---------------------------------------------------------------- research

export type ResearchMode = "one_time" | "ongoing";
export type ResearchJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "blocked";

export interface ResearchCriteria {
  product: string;
  industry: string;
  countries: string[];
  buyer_type: string;
}

export interface ResearchLimits {
  max_runtime_minutes: number;
  /** Estimated spend ceiling per day (ongoing) or per run (one-time). */
  spend_limit: number | null;
  /** Ongoing only: how often a new research pass starts. */
  interval_hours: number | null;
  concurrency: number;
}

export interface ResearchJobInput {
  name: string;
  mode: ResearchMode;
  criteria: ResearchCriteria;
  /** Optional. One-time jobs stop when reached; ongoing jobs never require a fixed lead count. */
  result_target: number | null;
  limits: ResearchLimits;
  model: ModelPreference;
}

export interface ResearchJob extends ResearchJobInput {
  id: ID;
  status: ResearchJobStatus;
  pause_reason: string;
  progress: {
    searches: number;
    pages_checked: number;
    candidates: number;
    new_leads: number;
    duplicates_skipped: number;
    emails_verified: number;
  };
  spent_today: number;
  spent_total: number;
  last_run_at: ISODate | null;
  next_run_at: ISODate | null;
  current_run_id: ID | null;
  error: string | null;
  created_at: ISODate;
}

export type EmailEvidenceStatus = "verified_on_source" | "unverified" | "not_found" | "owner_entered" | "bounced";

export interface ResearchResult {
  id: ID;
  job_id: ID;
  company: string;
  website: string;
  country: string;
  /** Only an address that is publicly listed. Never generated. */
  email: string | null;
  email_status: EmailEvidenceStatus;
  email_evidence: string | null;
  relevance: string;
  sources: SourceLink[];
  missing_info: string[];
  duplicate_of_lead_id: ID | null;
  saved_lead_id: ID | null;
  found_at: ISODate;
}

// ---------------------------------------------------------------- CRM

export type LeadStatus = "new" | "contacted" | "replied" | "interested" | "won" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "replied", "interested", "won", "lost"];

export interface Lead {
  id: ID;
  company: string;
  website: string;
  country: string;
  industry: string;
  buyer_type: string;
  products: string;
  status: LeadStatus;
  contact_email: string | null;
  email_status: EmailEvidenceStatus;
  sender_account_id: ID | null;
  sender_address: string | null;
  last_contact_at: ISODate | null;
  next_follow_up_at: ISODate | null;
  suppressed: boolean;
  created_at: ISODate;
}

export interface LeadFilters {
  q?: string;
  status?: LeadStatus | "";
  country?: string;
  sender_account_id?: ID | "";
  sort?: "created_at" | "company" | "last_contact_at" | "next_follow_up_at";
}

export interface Contact {
  id: ID;
  name: string;
  role: string;
  email: string | null;
  email_status: EmailEvidenceStatus;
  email_source_url: string | null;
  email_evidence: string | null;
}

export interface TimelineItem {
  id: string;
  kind: "email_out" | "email_in" | "status" | "note" | "research" | "approval" | "suppression";
  title: string;
  detail?: string;
  status?: string;
  at: ISODate;
}

export interface FollowUpStep {
  step: number;
  label: string;
  delay_days: number;
  status: OutboundStatus;
  scheduled_at: ISODate | null;
  sent_at: ISODate | null;
}

export interface Note {
  id: ID;
  body: string;
  created_at: ISODate;
}

export interface LeadDetail extends Lead {
  relevance: string;
  missing_info: string[];
  sources: SourceLink[];
  contacts: Contact[];
  timeline: TimelineItem[];
  notes: Note[];
  conversation_id: ID | null;
  sequence: { name: string; status: SequenceState; stop_reason: string | null; steps: FollowUpStep[] } | null;
  research_history: { job_id: ID; job_name: string; found_at: ISODate; relevance: string }[];
  suppression: { suppressed: boolean; reason: SuppressionReason | null; since: ISODate | null; scope: "email" | "domain" | null };
}

export interface LeadUpdate {
  status?: LeadStatus;
  next_follow_up_at?: ISODate | null;
  outreach_paused?: boolean;
}

// ---------------------------------------------------------------- email

export type EmailProvider = "gmail" | "microsoft" | "imap_smtp";
export type OutboundStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "bounced"
  | "cancelled"
  | "simulated";
export type ReplyClass =
  | "interested"
  | "not_interested"
  | "requesting_information"
  | "automatic"
  | "unsubscribe"
  | "unclear";
export type SequenceState = "draft" | "pending_approval" | "active" | "completed" | "stopped";

export interface EmailAccount {
  id: ID;
  address: string;
  provider: EmailProvider;
  /** Aliases send through their parent mailbox; they have no inbox or credentials of their own. */
  kind: "mailbox" | "alias";
  parent_id: ID | null;
  parent_address: string | null;
  status: ConnectionStatus;
  sender_name: string;
  signature: string;
  daily_limit: number;
  hourly_limit: number;
  window_start: string;
  window_end: string;
  /** 0 = Monday … 6 = Sunday */
  send_days: number[];
  timezone: string;
  sent_today: number;
  last_sync_at: ISODate | null;
  last_error: string | null;
}

export interface EmailAccountUpdate {
  sender_name?: string;
  signature?: string;
  daily_limit?: number;
  hourly_limit?: number;
  window_start?: string;
  window_end?: string;
  send_days?: number[];
  timezone?: string;
}

export interface ImapSmtpInput {
  address: string;
  sender_name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  /** Write-only. Sent once to the backend, encrypted there, never returned. */
  password: string;
}

export interface AliasInput {
  parent_id: ID;
  address: string;
  sender_name: string;
}

export interface ConversationSummary {
  id: ID;
  lead_id: ID;
  company: string;
  contact_name: string;
  contact_email: string;
  account_id: ID;
  account_address: string;
  subject: string;
  snippet: string;
  status: "draft" | "active" | "replied" | "stopped" | "closed";
  classification: ReplyClass | null;
  needs_attention: boolean;
  unread: boolean;
  last_message_at: ISODate;
}

export interface EmailMessage {
  id: ID;
  direction: "in" | "out";
  kind: "initial" | "followup" | "reply" | "inbound";
  from: string;
  to: string;
  subject: string;
  body: string;
  status: OutboundStatus | "received";
  error: string | null;
  sent_at: ISODate | null;
  created_at: ISODate;
  classification: ReplyClass | null;
  classification_reason: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: EmailMessage[];
  ai_summary: string | null;
  escalation_reason: string | null;
  suggested_reply: { subject: string; body: string; based_on_facts: string[]; missing_facts: string[] } | null;
  pending_reply_approval_id: ID | null;
  sequence: { name: string; status: SequenceState; stop_reason: string | null; steps: FollowUpStep[] } | null;
}

export interface InboxFilters {
  account_id?: ID | "";
  filter?: "all" | "attention" | "unread";
  q?: string;
}

export interface ReplyDraftInput {
  subject: string;
  body: string;
}

// ---------------------------------------------------------------- approvals

export type ApprovalKind = "outreach" | "follow_up_sequence" | "sales_reply" | "blog_publish" | "meeting_invite";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "invalidated";

export interface ApprovalItem {
  id: ID;
  label: string;
  recipient: string | null;
  recipient_name: string | null;
  company: string | null;
  subject: string;
  body: string;
  /** Human-readable timing, e.g. "Immediately after approval, within sending window" or "4 days after previous step". */
  schedule: string;
  scheduled_at: ISODate | null;
  editable: boolean;
  /** Warnings the backend computed at review time (suppressed, duplicate, missing facts…). */
  warnings: string[];
}

export interface Approval {
  id: ID;
  kind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  /** The exact external action that will happen on approval. */
  action: string;
  sender: { account_id: ID; address: string; sender_name: string; kind: "mailbox" | "alias" } | null;
  recipients: string[];
  items: ApprovalItem[];
  schedule_summary: string;
  is_batch: boolean;
  /** Hash of recipients, content, sender and sequence. Approval is rejected by the backend if it no longer matches. */
  content_hash: string;
  related: { label: string; href: string }[];
  invalid_reason: string | null;
  created_at: ISODate;
  decided_at: ISODate | null;
}

export interface ApproveInput {
  content_hash: string;
  /** For batches: the items the owner reviewed and is approving. Excluded items are returned to draft. */
  item_ids: ID[];
}

// ---------------------------------------------------------------- tasks & calendar

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "done";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export type ReminderChannel = "none" | "dashboard" | "email";

export interface Task {
  id: ID;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: ISODate | null;
  recurrence: Recurrence;
  recurrence_interval: number;
  remind_at: ISODate | null;
  reminder_channel: ReminderChannel;
  history: { at: ISODate; action: string }[];
  completed_at: ISODate | null;
  created_at: ISODate;
}

export type TaskInput = Pick<
  Task,
  "title" | "description" | "priority" | "due_at" | "recurrence" | "recurrence_interval" | "remind_at" | "reminder_channel"
> & { status?: TaskStatus };

export interface Attendee {
  email: string;
  name: string;
  response: "needs_action" | "accepted" | "declined" | "tentative";
}

export interface CalendarEvent {
  id: ID;
  title: string;
  description: string;
  location: string;
  start_at: ISODate;
  end_at: ISODate;
  timezone: string;
  attendees: Attendee[];
  status: "draft" | "pending_approval" | "confirmed" | "cancelled" | "failed";
  provider: "local" | "google";
  invites_sent: boolean;
  approval_id: ID | null;
  error: string | null;
}

export interface MeetingInput {
  title: string;
  description: string;
  location: string;
  start_at: ISODate;
  end_at: ISODate;
  timezone: string;
  attendees: { email: string; name: string }[];
  /** When true, the backend creates an approval; invitations are only sent after the owner approves it. */
  send_invites: boolean;
}

// ---------------------------------------------------------------- blog

export type BlogStatus = "idea" | "draft" | "pending_approval" | "scheduled" | "published" | "failed";

export interface BlogPost {
  id: ID;
  topic: string;
  keywords: string[];
  title: string;
  outline: string;
  body: string;
  seo_title: string;
  meta_description: string;
  social_captions: { platform: string; text: string }[];
  status: BlogStatus;
  cms: "wordpress";
  cms_draft: { uploaded: boolean; cms_post_id: string | null; uploaded_at: ISODate | null; edit_url: string | null };
  scheduled_at: ISODate | null;
  published_url: string | null;
  published_at: ISODate | null;
  approval_id: ID | null;
  error: string | null;
  updated_at: ISODate;
}

export type BlogPostUpdate = Partial<
  Pick<BlogPost, "topic" | "keywords" | "title" | "outline" | "body" | "seo_title" | "meta_description" | "social_captions">
>;

export interface BlogIdea {
  title: string;
  angle: string;
  keywords: string[];
}

export type BlogGeneratePart = "outline" | "article" | "seo" | "captions";

// ---------------------------------------------------------------- knowledge

export type KnowledgeCategory =
  | "factory_profile"
  | "product"
  | "pricing"
  | "moq"
  | "production_capacity"
  | "delivery_time"
  | "payment_terms"
  | "certification"
  | "sales_statement";

export interface KnowledgeItem {
  id: ID;
  category: KnowledgeCategory;
  title: string;
  fields: Record<string, string>;
  /** Only approved items are used by the assistant as business facts. */
  approved: boolean;
  /** Whether this fact may be used in automatic replies (when auto-reply mode is on). */
  auto_reply_allowed: boolean;
  updated_at: ISODate;
}

export type KnowledgeItemInput = Pick<KnowledgeItem, "category" | "title" | "fields" | "approved" | "auto_reply_allowed">;

export interface KnowledgeDocument {
  id: ID;
  filename: string;
  size: number;
  status: "processing" | "ready" | "failed";
  extracted_chars: number;
  approved: boolean;
  error: string | null;
  uploaded_at: ISODate;
}

export interface KnowledgeOverview {
  items: KnowledgeItem[];
  documents: KnowledgeDocument[];
  /** Gaps the assistant will ask the owner about instead of guessing. */
  missing: { category: KnowledgeCategory; message: string }[];
  /** Questions the assistant could not answer from approved facts. */
  open_questions: { id: ID; question: string; context: string; asked_at: ISODate }[];
}

// ---------------------------------------------------------------- automations

export type AutomationType =
  | "buyer_research"
  | "email_follow_ups"
  | "reply_analysis"
  | "daily_summary"
  | "recurring_tasks"
  | "blog_schedule";

export interface AutomationRun {
  id: ID;
  started_at: ISODate;
  finished_at: ISODate | null;
  status: WorkflowStatus;
  summary: string;
  error: string | null;
}

export interface Automation {
  id: ID;
  type: AutomationType;
  name: string;
  description: string;
  enabled: boolean;
  status: "active" | "paused" | "error" | "blocked";
  pause_reason: string;
  schedule: string;
  timezone: string;
  last_run: AutomationRun | null;
  next_run_at: ISODate | null;
  accounts: { id: ID; address: string; status: ConnectionStatus }[];
  limits: { label: string; value: string }[];
  stop_conditions: string[];
  history: AutomationRun[];
  /** Whether this automation sends or publishes externally (affected by the emergency pause). */
  outgoing: boolean;
}

// ---------------------------------------------------------------- usage & costs

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  estimated_cost: number | null;
  runs: number;
}

export interface UsageSummary {
  currency: string;
  timezone: string;
  providers: { key: ProviderKey; label: string; configured: boolean; today: TokenUsage; month: TokenUsage }[];
  services: {
    key: "search" | "extraction" | "verification" | "browser";
    label: string;
    configured: boolean;
    unit_label: string;
    unit_price: number | null;
    today_units: number;
    month_units: number;
    today_cost: number | null;
    month_cost: number | null;
  }[];
  budget: {
    daily_limit: number | null;
    monthly_limit: number | null;
    daily_spent: number;
    monthly_spent: number;
    inflight_allowance_pct: number;
  };
  alerts: { level: "info" | "warning" | "critical"; message: string }[];
  by_workflow: { workflow_type: WorkflowType; label: string; runs: number; tokens: number; estimated_cost: number | null }[];
  unpriced_records: number;
}

export interface ModelPricing {
  id: ID;
  provider: ProviderKey;
  model_id: string;
  label: string;
  enabled: boolean;
  /** Prices per 1M tokens, entered by the owner from the provider's pricing page. Null = not configured. */
  input_price_per_mtok: number | null;
  output_price_per_mtok: number | null;
  cached_input_price_per_mtok: number | null;
  currency: string;
  pricing_updated_at: ISODate | null;
  pricing_source: string;
}

export type ModelPricingInput = Omit<ModelPricing, "id">;

export interface UnitPrices {
  search: number | null;
  extraction: number | null;
  verification: number | null;
  browser: number | null;
  updated_at: ISODate | null;
}

export interface BudgetSettings {
  daily: number | null;
  monthly: number | null;
  inflight_allowance_pct: number;
  currency: string;
  alert_at_pct: number;
}

// ---------------------------------------------------------------- settings

export interface OwnerProfile {
  name: string;
  email: string;
  timezone: string;
}

export interface ModelRouting {
  fallback_enabled: boolean;
  max_retries: number;
  workflows: {
    workflow_type: WorkflowType | "default";
    label: string;
    model_id: ID | null;
    fallback_model_id: ID | null;
  }[];
}

export interface ProviderConfigStatus {
  key: ProviderKey;
  label: string;
  hermes_provider: string;
  /** Whether a key is present on the server. The key itself is never sent to the browser. */
  configured: boolean;
  last_checked_at: ISODate | null;
  last_check_ok: boolean | null;
  last_check_message: string | null;
}

export interface ResearchProviderStatus {
  search_backend: string;
  extract_backend: string;
  configured: boolean;
  paid: boolean;
  note: string;
}

export interface IntegrationStatus {
  kind: "google_calendar" | "wordpress";
  status: ConnectionStatus;
  account: string | null;
  /** Non-secret configuration, e.g. WordPress site URL and username. */
  details: Record<string, string>;
  credential_set: boolean;
  last_error: string | null;
}

export interface WordPressInput {
  site_url: string;
  username: string;
  /** Write-only application password. Never returned by the backend. */
  application_password: string;
}

export interface Suppression {
  id: ID;
  email: string | null;
  domain: string | null;
  reason: SuppressionReason;
  detail: string;
  created_at: ISODate;
}
export type SuppressionReason = "unsubscribe" | "bounce" | "manual" | "no_contact";

export interface NotificationSettings {
  default_reminder_channel: ReminderChannel;
  owner_email: string;
  reminder_account_id: ID | null;
  notify: {
    replies_needing_attention: boolean;
    approvals_pending: boolean;
    workflow_failed: boolean;
    budget_alerts: boolean;
    daily_summary: boolean;
  };
}

export interface AutoReplySettings {
  enabled: boolean;
  /** Only these topics may be answered automatically, and only with knowledge items marked auto_reply_allowed. */
  topics: string[];
}

export interface AppNotification {
  id: ID;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  created_at: ISODate;
}
