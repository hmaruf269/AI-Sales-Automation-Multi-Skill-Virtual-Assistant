import type * as T from "./types";

/**
 * The single seam between the UI and data. `HttpApiClient` talks to the FastAPI backend;
 * `DemoApiClient` (src/demo) is an in-browser simulation. Swap implementations without touching pages.
 */
export interface ApiClient {
  readonly mode: T.DataMode;

  // auth & system
  getSession(): Promise<T.SessionInfo>;
  login(email: string, password: string): Promise<T.SessionInfo>;
  logout(): Promise<void>;
  getSystemStatus(): Promise<T.SystemStatus>;
  setEmergencyPause(paused: boolean, reason: string): Promise<T.SystemStatus["emergency_pause"]>;
  getNotifications(): Promise<T.AppNotification[]>;
  markNotificationsRead(ids: T.ID[]): Promise<void>;

  // overview & workflows
  getOverview(): Promise<T.Overview>;
  listWorkflowRuns(params?: { status?: T.WorkflowStatus | ""; limit?: number }): Promise<T.WorkflowRun[]>;
  startWorkflowRun(input: {
    type: T.WorkflowType;
    title?: string;
    input: string;
    model_config_id?: T.ID | null;
    params?: Record<string, unknown>;
  }): Promise<T.WorkflowRun>;
  getWorkflowRun(id: T.ID): Promise<T.WorkflowRun>;
  pauseWorkflowRun(id: T.ID): Promise<T.WorkflowRun>;
  resumeWorkflowRun(id: T.ID): Promise<T.WorkflowRun>;
  cancelWorkflowRun(id: T.ID): Promise<T.WorkflowRun>;
  retryWorkflowRun(id: T.ID): Promise<T.WorkflowRun>;

  // chat
  listChatThreads(): Promise<T.ChatThread[]>;
  createChatThread(title?: string): Promise<T.ChatThread>;
  deleteChatThread(id: T.ID): Promise<void>;
  listChatMessages(threadId: T.ID): Promise<T.ChatMessage[]>;
  sendChatMessage(threadId: T.ID, input: T.SendChatMessageInput): Promise<T.SendChatMessageResult>;
  uploadChatAttachment(file: File): Promise<T.Attachment>;
  getCommandSuggestions(): Promise<T.CommandSuggestion[]>;

  // research
  listResearchJobs(): Promise<T.ResearchJob[]>;
  createResearchJob(input: T.ResearchJobInput): Promise<T.ResearchJob>;
  pauseResearchJob(id: T.ID): Promise<T.ResearchJob>;
  resumeResearchJob(id: T.ID): Promise<T.ResearchJob>;
  cancelResearchJob(id: T.ID): Promise<T.ResearchJob>;
  listResearchResults(params: { job_id?: T.ID; unsaved_only?: boolean }): Promise<T.ResearchResult[]>;
  saveResearchResults(resultIds: T.ID[]): Promise<{ saved: T.ID[]; skipped: { id: T.ID; reason: string }[] }>;
  prepareOutreach(input: { lead_ids: T.ID[]; account_id: T.ID; model: T.ModelPreference }): Promise<T.WorkflowRun>;

  // CRM
  listLeads(filters: T.LeadFilters): Promise<T.Paginated<T.Lead>>;
  getLead(id: T.ID): Promise<T.LeadDetail>;
  updateLead(id: T.ID, update: T.LeadUpdate): Promise<T.LeadDetail>;
  addLeadNote(id: T.ID, body: string): Promise<T.Note>;
  suppressLead(id: T.ID, scope: "email" | "domain", detail: string): Promise<T.LeadDetail>;
  /** Returns a URL the browser can download directly (same-origin, cookie-authenticated). */
  leadsCsvUrl(filters: T.LeadFilters): string;
  exportLeadsCsv(filters: T.LeadFilters): Promise<Blob>;

  // email
  listEmailAccounts(): Promise<T.EmailAccount[]>;
  updateEmailAccount(id: T.ID, update: T.EmailAccountUpdate): Promise<T.EmailAccount>;
  /** Returns the provider consent URL. The OAuth exchange happens server-side. */
  startEmailOAuth(provider: "gmail" | "microsoft", reconnectId?: T.ID): Promise<{ authorize_url: string }>;
  addImapSmtpAccount(input: T.ImapSmtpInput): Promise<T.EmailAccount>;
  addAlias(input: T.AliasInput): Promise<T.EmailAccount>;
  disconnectEmailAccount(id: T.ID): Promise<T.EmailAccount>;
  testEmailAccount(id: T.ID): Promise<{ ok: boolean; message: string }>;
  listConversations(filters: T.InboxFilters): Promise<T.ConversationSummary[]>;
  getConversation(id: T.ID): Promise<T.ConversationDetail>;
  markConversationRead(id: T.ID): Promise<void>;
  suggestReply(id: T.ID, model: T.ModelPreference): Promise<T.WorkflowRun>;
  submitReplyForApproval(id: T.ID, draft: T.ReplyDraftInput): Promise<T.Approval>;
  stopSequence(conversationId: T.ID, reason: string): Promise<T.ConversationDetail>;

  // approvals
  listApprovals(params?: { status?: T.ApprovalStatus | "" ; kind?: T.ApprovalKind | "" }): Promise<T.Approval[]>;
  getApproval(id: T.ID): Promise<T.Approval>;
  updateApprovalItem(approvalId: T.ID, itemId: T.ID, update: { subject?: string; body?: string }): Promise<T.Approval>;
  approve(approvalId: T.ID, input: T.ApproveInput): Promise<T.Approval>;
  reject(approvalId: T.ID, reason: string): Promise<T.Approval>;

  // tasks & calendar
  listTasks(params?: { status?: T.TaskStatus | "" }): Promise<T.Task[]>;
  createTask(input: T.TaskInput): Promise<T.Task>;
  updateTask(id: T.ID, input: Partial<T.TaskInput>): Promise<T.Task>;
  completeTask(id: T.ID): Promise<T.Task>;
  deleteTask(id: T.ID): Promise<void>;
  listEvents(range: { start: T.ISODate; end: T.ISODate }): Promise<T.CalendarEvent[]>;
  createMeeting(input: T.MeetingInput): Promise<T.CalendarEvent>;
  updateMeeting(id: T.ID, input: T.MeetingInput): Promise<T.CalendarEvent>;
  cancelMeeting(id: T.ID): Promise<T.CalendarEvent>;

  // blog
  listBlogPosts(): Promise<T.BlogPost[]>;
  getBlogPost(id: T.ID): Promise<T.BlogPost>;
  createBlogPost(input: { topic: string; keywords: string[]; title?: string }): Promise<T.BlogPost>;
  updateBlogPost(id: T.ID, update: T.BlogPostUpdate): Promise<T.BlogPost>;
  deleteBlogPost(id: T.ID): Promise<void>;
  generateBlogIdeas(input: { topic: string; keywords: string[]; model: T.ModelPreference }): Promise<T.WorkflowRun>;
  getBlogIdeas(runId: T.ID): Promise<T.BlogIdea[]>;
  generateBlogPart(id: T.ID, part: T.BlogGeneratePart, model: T.ModelPreference): Promise<T.WorkflowRun>;
  uploadBlogDraftToCms(id: T.ID): Promise<T.BlogPost>;
  requestBlogPublish(id: T.ID, input: { publish_at: T.ISODate | null }): Promise<T.Approval>;

  // knowledge
  getKnowledge(): Promise<T.KnowledgeOverview>;
  createKnowledgeItem(input: T.KnowledgeItemInput): Promise<T.KnowledgeItem>;
  updateKnowledgeItem(id: T.ID, input: T.KnowledgeItemInput): Promise<T.KnowledgeItem>;
  deleteKnowledgeItem(id: T.ID): Promise<void>;
  uploadKnowledgeDocument(file: File): Promise<T.KnowledgeDocument>;
  setDocumentApproved(id: T.ID, approved: boolean): Promise<T.KnowledgeDocument>;
  deleteKnowledgeDocument(id: T.ID): Promise<void>;
  answerOpenQuestion(id: T.ID, answer: string): Promise<void>;

  // automations
  listAutomations(): Promise<T.Automation[]>;
  setAutomationEnabled(id: T.ID, enabled: boolean): Promise<T.Automation>;
  runAutomationNow(id: T.ID): Promise<T.WorkflowRun>;

  // usage & costs
  getUsage(): Promise<T.UsageSummary>;
  listModelPricing(): Promise<T.ModelPricing[]>;
  createModelPricing(input: T.ModelPricingInput): Promise<T.ModelPricing>;
  updateModelPricing(id: T.ID, input: T.ModelPricingInput): Promise<T.ModelPricing>;
  deleteModelPricing(id: T.ID): Promise<void>;
  getUnitPrices(): Promise<T.UnitPrices>;
  updateUnitPrices(input: T.UnitPrices): Promise<T.UnitPrices>;
  getBudget(): Promise<T.BudgetSettings>;
  getBudgetStatus(): Promise<{
    currency: string;
    inflight_allowance_pct: number;
    daily: { limit: number | null; spent: number };
    monthly: { limit: number | null; spent: number };
    unpriced_records_this_month: number;
  }>;
  updateBudget(input: T.BudgetSettings): Promise<T.BudgetSettings>;

  // settings
  getProfile(): Promise<T.OwnerProfile>;
  updateProfile(input: T.OwnerProfile): Promise<T.OwnerProfile>;
  getProviderStatus(): Promise<T.ProviderConfigStatus[]>;
  testProvider(key: T.ProviderKey): Promise<T.ProviderConfigStatus>;
  getModelRouting(): Promise<T.ModelRouting>;
  updateModelRouting(input: T.ModelRouting): Promise<T.ModelRouting>;
  getResearchProvider(): Promise<T.ResearchProviderStatus>;
  listIntegrations(): Promise<T.IntegrationStatus[]>;
  startCalendarOAuth(): Promise<{ authorize_url: string }>;
  connectWordPress(input: T.WordPressInput): Promise<T.IntegrationStatus>;
  disconnectIntegration(kind: T.IntegrationStatus["kind"]): Promise<T.IntegrationStatus>;
  testIntegration(kind: T.IntegrationStatus["kind"]): Promise<{ ok: boolean; message: string }>;
  listSuppressions(q?: string): Promise<T.Suppression[]>;
  addSuppression(input: { value: string; reason: T.SuppressionReason; detail: string }): Promise<T.Suppression>;
  removeSuppression(id: T.ID): Promise<void>;
  getNotificationSettings(): Promise<T.NotificationSettings>;
  updateNotificationSettings(input: T.NotificationSettings): Promise<T.NotificationSettings>;
  getAutoReply(): Promise<T.AutoReplySettings>;
  updateAutoReply(input: T.AutoReplySettings): Promise<T.AutoReplySettings>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = "",
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
