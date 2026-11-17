import { ApiError, type ApiClient } from "./client";
import type * as T from "./types";

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Query): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/**
 * Talks to the FastAPI backend through the same-origin /api proxy (next.config.ts).
 * Authentication is an HttpOnly session cookie; mutating requests carry the CSRF token from /api/auth/session.
 * No provider credentials ever pass through this client except write-only form fields the owner types in.
 */
export class HttpApiClient implements ApiClient {
  readonly mode = "live" as const;
  private csrf: string | undefined;

  constructor(private readonly base = "/api", private readonly timeoutMs = 30_000) {}

  private async request<R>(method: string, path: string, body?: unknown, init?: { raw?: boolean; form?: FormData }): Promise<R> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET" && this.csrf) headers["X-CSRF-Token"] = this.csrf;
    if (body !== undefined && !init?.form) headers["Content-Type"] = "application/json";
    let resp: Response;
    try {
      resp = await fetch(`${this.base}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        body: init?.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      throw new ApiError(aborted ? "The server took too long to respond." : "Cannot reach the server.", 0, aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      let message = `Request failed (${resp.status}).`;
      let code = "";
      let fieldErrors: Record<string, string> = {};
      try {
        const data = await resp.json();
        // FastAPI: {"detail": "..."} or {"detail": [{loc, msg}]}; app errors: {"detail": {"message","code","fields"}}
        const detail = data?.detail;
        if (typeof detail === "string") message = detail;
        else if (Array.isArray(detail)) {
          message = "Some fields are invalid.";
          for (const e of detail) fieldErrors[String(e.loc?.[e.loc.length - 1] ?? "")] = String(e.msg ?? "");
        } else if (detail && typeof detail === "object") {
          message = detail.message ?? message;
          code = detail.code ?? "";
          fieldErrors = detail.fields ?? {};
        }
      } catch {
        /* non-JSON error body */
      }
      if (resp.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
        window.dispatchEvent(new CustomEvent("api:unauthorized"));
      }
      throw new ApiError(message, resp.status, code, fieldErrors);
    }
    if (init?.raw) return (await resp.blob()) as R;
    if (resp.status === 204) return undefined as R;
    return (await resp.json()) as R;
  }

  private get<R>(path: string, params?: Query) {
    return this.request<R>("GET", path + qs(params));
  }
  private post<R>(path: string, body?: unknown) {
    return this.request<R>("POST", path, body ?? {});
  }
  private put<R>(path: string, body: unknown) {
    return this.request<R>("PUT", path, body);
  }
  private patch<R>(path: string, body: unknown) {
    return this.request<R>("PATCH", path, body);
  }
  private del<R = void>(path: string) {
    return this.request<R>("DELETE", path);
  }
  private upload<R>(path: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return this.request<R>("POST", path, undefined, { form });
  }

  // auth & system
  async getSession() {
    const s = await this.get<T.SessionInfo>("/auth/session");
    this.csrf = s.csrf_token;
    return s;
  }
  async login(email: string, password: string) {
    const s = await this.post<T.SessionInfo>("/auth/login", { email, password });
    this.csrf = s.csrf_token;
    return s;
  }
  async logout() {
    await this.post("/auth/logout");
    this.csrf = undefined;
  }
  getSystemStatus = () => this.get<T.SystemStatus>("/system/status");
  setEmergencyPause = (paused: boolean, reason: string) =>
    this.put<T.SystemStatus["emergency_pause"]>("/system/emergency-pause", { paused, reason });
  getNotifications = () => this.get<T.AppNotification[]>("/notifications");
  markNotificationsRead = (ids: T.ID[]) => this.post<void>("/notifications/read", { ids });

  // overview & workflows
  getOverview = () => this.get<T.Overview>("/overview");
  listWorkflowRuns = (p?: { status?: T.WorkflowStatus | ""; limit?: number }) => this.get<T.WorkflowRun[]>("/workflow-runs", p);
  getWorkflowRun = (id: T.ID) => this.get<T.WorkflowRun>(`/workflow-runs/${id}`);
  pauseWorkflowRun = (id: T.ID) => this.post<T.WorkflowRun>(`/workflow-runs/${id}/pause`);
  resumeWorkflowRun = (id: T.ID) => this.post<T.WorkflowRun>(`/workflow-runs/${id}/resume`);
  cancelWorkflowRun = (id: T.ID) => this.post<T.WorkflowRun>(`/workflow-runs/${id}/cancel`);
  retryWorkflowRun = (id: T.ID) => this.post<T.WorkflowRun>(`/workflow-runs/${id}/retry`);

  // chat
  listChatThreads = () => this.get<T.ChatThread[]>("/chat/threads");
  createChatThread = (title?: string) => this.post<T.ChatThread>("/chat/threads", { title: title ?? null });
  deleteChatThread = (id: T.ID) => this.del(`/chat/threads/${id}`);
  listChatMessages = (threadId: T.ID) => this.get<T.ChatMessage[]>(`/chat/threads/${threadId}/messages`);
  sendChatMessage = (threadId: T.ID, input: T.SendChatMessageInput) =>
    this.post<T.SendChatMessageResult>(`/chat/threads/${threadId}/messages`, input);
  uploadChatAttachment = (file: File) => this.upload<T.Attachment>("/chat/attachments", file);
  getCommandSuggestions = () => this.get<T.CommandSuggestion[]>("/chat/commands");

  // research
  listResearchJobs = () => this.get<T.ResearchJob[]>("/research/jobs");
  createResearchJob = (input: T.ResearchJobInput) => this.post<T.ResearchJob>("/research/jobs", input);
  pauseResearchJob = (id: T.ID) => this.post<T.ResearchJob>(`/research/jobs/${id}/pause`);
  resumeResearchJob = (id: T.ID) => this.post<T.ResearchJob>(`/research/jobs/${id}/resume`);
  cancelResearchJob = (id: T.ID) => this.post<T.ResearchJob>(`/research/jobs/${id}/cancel`);
  listResearchResults = (p: { job_id?: T.ID; unsaved_only?: boolean }) => this.get<T.ResearchResult[]>("/research/results", p);
  saveResearchResults = (ids: T.ID[]) =>
    this.post<{ saved: T.ID[]; skipped: { id: T.ID; reason: string }[] }>("/research/results/save", { result_ids: ids });
  prepareOutreach = (input: { lead_ids: T.ID[]; account_id: T.ID; model: T.ModelPreference }) =>
    this.post<T.WorkflowRun>("/outreach/drafts", input);

  // CRM
  listLeads = (f: T.LeadFilters) => this.get<T.Paginated<T.Lead>>("/leads", f as Query);
  getLead = (id: T.ID) => this.get<T.LeadDetail>(`/leads/${id}`);
  updateLead = (id: T.ID, u: T.LeadUpdate) => this.patch<T.LeadDetail>(`/leads/${id}`, u);
  addLeadNote = (id: T.ID, body: string) => this.post<T.Note>(`/leads/${id}/notes`, { body });
  suppressLead = (id: T.ID, scope: "email" | "domain", detail: string) =>
    this.post<T.LeadDetail>(`/leads/${id}/suppress`, { scope, detail });
  leadsCsvUrl = (f: T.LeadFilters) => `${this.base}/leads/export.csv${qs(f as Query)}`;
  exportLeadsCsv = (f: T.LeadFilters) => this.request<Blob>("GET", `/leads/export.csv${qs(f as Query)}`, undefined, { raw: true });

  // email
  listEmailAccounts = () => this.get<T.EmailAccount[]>("/email-accounts");
  updateEmailAccount = (id: T.ID, u: T.EmailAccountUpdate) => this.patch<T.EmailAccount>(`/email-accounts/${id}`, u);
  startEmailOAuth = (provider: "gmail" | "microsoft", reconnectId?: T.ID) =>
    this.post<{ authorize_url: string }>(`/email-accounts/oauth/${provider}/start`, { reconnect_account_id: reconnectId ?? null });
  addImapSmtpAccount = (input: T.ImapSmtpInput) => this.post<T.EmailAccount>("/email-accounts/imap-smtp", input);
  addAlias = (input: T.AliasInput) => this.post<T.EmailAccount>("/email-accounts/aliases", input);
  disconnectEmailAccount = (id: T.ID) => this.post<T.EmailAccount>(`/email-accounts/${id}/disconnect`);
  testEmailAccount = (id: T.ID) => this.post<{ ok: boolean; message: string }>(`/email-accounts/${id}/test`);
  listConversations = (f: T.InboxFilters) => this.get<T.ConversationSummary[]>("/conversations", f as Query);
  getConversation = (id: T.ID) => this.get<T.ConversationDetail>(`/conversations/${id}`);
  markConversationRead = (id: T.ID) => this.post<void>(`/conversations/${id}/read`);
  suggestReply = (id: T.ID, model: T.ModelPreference) => this.post<T.WorkflowRun>(`/conversations/${id}/suggest-reply`, { model });
  submitReplyForApproval = (id: T.ID, d: T.ReplyDraftInput) => this.post<T.Approval>(`/conversations/${id}/reply-drafts`, d);
  stopSequence = (id: T.ID, reason: string) => this.post<T.ConversationDetail>(`/conversations/${id}/stop-sequence`, { reason });

  // approvals
  listApprovals = (p?: { status?: T.ApprovalStatus | ""; kind?: T.ApprovalKind | "" }) => this.get<T.Approval[]>("/approvals", p);
  getApproval = (id: T.ID) => this.get<T.Approval>(`/approvals/${id}`);
  updateApprovalItem = (aid: T.ID, iid: T.ID, u: { subject?: string; body?: string }) =>
    this.patch<T.Approval>(`/approvals/${aid}/items/${iid}`, u);
  approve = (id: T.ID, input: T.ApproveInput) => this.post<T.Approval>(`/approvals/${id}/approve`, input);
  reject = (id: T.ID, reason: string) => this.post<T.Approval>(`/approvals/${id}/reject`, { reason });

  // tasks & calendar
  listTasks = (p?: { status?: T.TaskStatus | "" }) => this.get<T.Task[]>("/tasks", p);
  createTask = (input: T.TaskInput) => this.post<T.Task>("/tasks", input);
  updateTask = (id: T.ID, input: Partial<T.TaskInput>) => this.patch<T.Task>(`/tasks/${id}`, input);
  completeTask = (id: T.ID) => this.post<T.Task>(`/tasks/${id}/complete`);
  deleteTask = (id: T.ID) => this.del(`/tasks/${id}`);
  listEvents = (r: { start: T.ISODate; end: T.ISODate }) => this.get<T.CalendarEvent[]>("/calendar/events", r);
  createMeeting = (input: T.MeetingInput) => this.post<T.CalendarEvent>("/calendar/events", input);
  updateMeeting = (id: T.ID, input: T.MeetingInput) => this.put<T.CalendarEvent>(`/calendar/events/${id}`, input);
  cancelMeeting = (id: T.ID) => this.post<T.CalendarEvent>(`/calendar/events/${id}/cancel`);

  // blog
  listBlogPosts = () => this.get<T.BlogPost[]>("/blog/posts");
  getBlogPost = (id: T.ID) => this.get<T.BlogPost>(`/blog/posts/${id}`);
  createBlogPost = (input: { topic: string; keywords: string[]; title?: string }) => this.post<T.BlogPost>("/blog/posts", input);
  updateBlogPost = (id: T.ID, u: T.BlogPostUpdate) => this.patch<T.BlogPost>(`/blog/posts/${id}`, u);
  deleteBlogPost = (id: T.ID) => this.del(`/blog/posts/${id}`);
  generateBlogIdeas = (input: { topic: string; keywords: string[]; model: T.ModelPreference }) =>
    this.post<T.WorkflowRun>("/blog/ideas", input);
  getBlogIdeas = (runId: T.ID) => this.get<T.BlogIdea[]>(`/blog/ideas/${runId}`);
  generateBlogPart = (id: T.ID, part: T.BlogGeneratePart, model: T.ModelPreference) =>
    this.post<T.WorkflowRun>(`/blog/posts/${id}/generate`, { part, model });
  uploadBlogDraftToCms = (id: T.ID) => this.post<T.BlogPost>(`/blog/posts/${id}/cms-draft`);
  requestBlogPublish = (id: T.ID, input: { publish_at: T.ISODate | null }) =>
    this.post<T.Approval>(`/blog/posts/${id}/publish-request`, input);

  // knowledge
  getKnowledge = () => this.get<T.KnowledgeOverview>("/knowledge");
  createKnowledgeItem = (input: T.KnowledgeItemInput) => this.post<T.KnowledgeItem>("/knowledge/items", input);
  updateKnowledgeItem = (id: T.ID, input: T.KnowledgeItemInput) => this.put<T.KnowledgeItem>(`/knowledge/items/${id}`, input);
  deleteKnowledgeItem = (id: T.ID) => this.del(`/knowledge/items/${id}`);
  uploadKnowledgeDocument = (file: File) => this.upload<T.KnowledgeDocument>("/knowledge/documents", file);
  setDocumentApproved = (id: T.ID, approved: boolean) => this.patch<T.KnowledgeDocument>(`/knowledge/documents/${id}`, { approved });
  deleteKnowledgeDocument = (id: T.ID) => this.del(`/knowledge/documents/${id}`);
  answerOpenQuestion = (id: T.ID, answer: string) => this.post<void>(`/knowledge/questions/${id}/answer`, { answer });

  // automations
  listAutomations = () => this.get<T.Automation[]>("/automations");
  setAutomationEnabled = (id: T.ID, enabled: boolean) => this.patch<T.Automation>(`/automations/${id}`, { enabled });
  runAutomationNow = (id: T.ID) => this.post<T.WorkflowRun>(`/automations/${id}/run`);

  // usage & costs
  getUsage = () => this.get<T.UsageSummary>("/usage/summary");
  listModelPricing = () => this.get<T.ModelPricing[]>("/models");
  createModelPricing = (input: T.ModelPricingInput) => this.post<T.ModelPricing>("/models", input);
  updateModelPricing = (id: T.ID, input: T.ModelPricingInput) => this.put<T.ModelPricing>(`/models/${id}`, input);
  deleteModelPricing = (id: T.ID) => this.del(`/models/${id}`);
  getUnitPrices = () => this.get<T.UnitPrices>("/usage/unit-prices");
  updateUnitPrices = (input: T.UnitPrices) => this.put<T.UnitPrices>("/usage/unit-prices", input);
  getBudget = () => this.get<T.BudgetSettings>("/usage/budget");
  updateBudget = (input: T.BudgetSettings) => this.put<T.BudgetSettings>("/usage/budget", input);

  // settings
  getProfile = () => this.get<T.OwnerProfile>("/settings/profile");
  updateProfile = (input: T.OwnerProfile) => this.put<T.OwnerProfile>("/settings/profile", input);
  getProviderStatus = () => this.get<T.ProviderConfigStatus[]>("/settings/providers");
  testProvider = (key: T.ProviderKey) => this.post<T.ProviderConfigStatus>(`/settings/providers/${key}/test`);
  getModelRouting = () => this.get<T.ModelRouting>("/settings/model-routing");
  updateModelRouting = (input: T.ModelRouting) => this.put<T.ModelRouting>("/settings/model-routing", input);
  getResearchProvider = () => this.get<T.ResearchProviderStatus>("/settings/research-provider");
  listIntegrations = () => this.get<T.IntegrationStatus[]>("/integrations");
  startCalendarOAuth = () => this.post<{ authorize_url: string }>("/integrations/google_calendar/oauth/start");
  connectWordPress = (input: T.WordPressInput) => this.put<T.IntegrationStatus>("/integrations/wordpress", input);
  disconnectIntegration = (kind: T.IntegrationStatus["kind"]) => this.post<T.IntegrationStatus>(`/integrations/${kind}/disconnect`);
  testIntegration = (kind: T.IntegrationStatus["kind"]) => this.post<{ ok: boolean; message: string }>(`/integrations/${kind}/test`);
  listSuppressions = (q?: string) => this.get<T.Suppression[]>("/suppressions", { q });
  addSuppression = (input: { value: string; reason: T.SuppressionReason; detail: string }) =>
    this.post<T.Suppression>("/suppressions", input);
  removeSuppression = (id: T.ID) => this.del(`/suppressions/${id}`);
  getNotificationSettings = () => this.get<T.NotificationSettings>("/settings/notifications");
  updateNotificationSettings = (input: T.NotificationSettings) => this.put<T.NotificationSettings>("/settings/notifications", input);
  getAutoReply = () => this.get<T.AutoReplySettings>("/settings/auto-reply");
  updateAutoReply = (input: T.AutoReplySettings) => this.put<T.AutoReplySettings>("/settings/auto-reply", input);
}
