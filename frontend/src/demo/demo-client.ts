/**
 * DEMO MODE ONLY. An in-browser simulation of the backend used when no backend is reachable.
 * - Everything is stored in localStorage on this device.
 * - Nothing is ever sent, invited or published. "Approved" outgoing actions become status "simulated".
 * - Simulated AI workflows progress on a timer and produce canned, clearly fictional results.
 */
import { startOfDay, startOfMonth } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { ApiError, type ApiClient } from "@/lib/api/client";
import type * as T from "@/lib/api/types";
import { DEMO_VERSION, iso, seedDemoState, type DemoRunState, type DemoState } from "./demo-data";

const KEY = "aiva-demo-state";
const H = 3_600_000;
const wait = (ms = 180 + Math.random() * 220) => new Promise((r) => setTimeout(r, ms));
const clone = <X,>(x: X): X => structuredClone(x);
const nowIso = () => new Date().toISOString();

const WORKFLOW_LABEL: Record<T.WorkflowType, string> = {
  buyer_research: "Buyer research",
  outreach_drafts: "Outreach drafts",
  reply_summary: "Reply summary",
  reply_analysis: "Reply analysis",
  follow_up: "Follow-ups",
  blog_ideas: "Blog ideas",
  blog_generate: "Blog writing",
  task_create: "Task creation",
  daily_summary: "Daily summary",
  general_research: "General research",
};

const COMMANDS: T.CommandSuggestion[] = [
  { id: "research", label: "Find buyers", example: "Research garment importers in Germany.", description: "Starts a buyer research job. Only publicly listed emails are kept, with source links.", workflow_type: "buyer_research" },
  { id: "replies", label: "Summarize replies", example: "Summarize replies from all email accounts.", description: "Summarises conversations that need your attention across connected inboxes.", workflow_type: "reply_summary" },
  { id: "outreach", label: "Draft outreach", example: "Draft outreach for new leads with verified emails.", description: "Prepares first emails for your approval. Nothing is sent without approval.", workflow_type: "outreach_drafts" },
  { id: "blog", label: "Write a blog", example: "Prepare a blog about sustainable manufacturing.", description: "Creates a blog draft with ideas and an outline in Blog Studio.", workflow_type: "blog_ideas" },
  { id: "task", label: "Add a task", example: "Remind me tomorrow to call Nordwind about the quotation.", description: "Creates a task with a reminder in Asia/Dhaka time.", workflow_type: "task_create" },
];

const COUNTRIES = ["Germany", "Netherlands", "France", "Spain", "Italy", "Poland", "Sweden", "Denmark", "Norway", "Belgium", "United Kingdom", "Austria", "Switzerland", "Portugal", "Czech Republic", "Finland", "Ireland", "United States", "Canada", "Japan", "Australia"];

const RESULT_POOL: Omit<T.ResearchResult, "id" | "job_id" | "found_at" | "duplicate_of_lead_id" | "saved_lead_id">[] = [
  { company: "Alster Fashion Supply GmbH", website: "https://www.alster-fashion.example", country: "Germany", email: "einkauf@alster-fashion.example", email_status: "verified_on_source", email_evidence: "… Einkauf: einkauf@alster-fashion.example …", relevance: "Hamburg importer of private-label T-shirts and sweatshirts for regional retail chains.", sources: [{ url: "https://www.alster-fashion.example/impressum", title: "Impressum", verified: true }], missing_info: ["Named contact person"] },
  { company: "Amstel Apparel Trading B.V.", website: "https://www.amstel-apparel.example", country: "Netherlands", email: "purchasing@amstel-apparel.example", email_status: "verified_on_source", email_evidence: "… Purchasing department: purchasing@amstel-apparel.example …", relevance: "Amsterdam wholesaler supplying knit basics to webshops; sources from South Asia.", sources: [{ url: "https://www.amstel-apparel.example/contact", title: "Contact", verified: true }], missing_info: ["Named contact person"] },
  { company: "Bodensee Textil KG", website: "https://www.bodensee-textil.example", country: "Germany", email: null, email_status: "not_found", email_evidence: null, relevance: "Konstanz distributor of promotional textiles; only a web form is published.", sources: [{ url: "https://www.bodensee-textil.example", title: "Home", verified: true }], missing_info: ["Public business email (only a contact form)"] },
  { company: "Lyonnaise Textile Import", website: "https://www.lyonnaise-textile.example", country: "France", email: "achats@lyonnaise-textile.example", email_status: "verified_on_source", email_evidence: "… Service achats : achats@lyonnaise-textile.example …", relevance: "Lyon importer of cotton basics for corporate clients.", sources: [{ url: "https://www.lyonnaise-textile.example/contact", title: "Contact", verified: true }], missing_info: [] },
  { company: "Malmö Basics AB", website: "https://www.malmobasics.example", country: "Sweden", email: "info@malmobasics.example", email_status: "unverified", email_evidence: null, relevance: "Swedish online basics brand; address suggested but not found on any fetched page.", sources: [{ url: "https://www.malmobasics.example/om-oss", title: "Om oss", verified: true }], missing_info: ["Email not confirmed on a public page — do not use until verified"] },
  { company: "Flanders Workwear NV", website: "https://www.flanders-workwear.example", country: "Belgium", email: "aankoop@flanders-workwear.example", email_status: "verified_on_source", email_evidence: "… Aankoop: aankoop@flanders-workwear.example …", relevance: "Ghent workwear distributor with polos and sweatshirts in its catalogue.", sources: [{ url: "https://www.flanders-workwear.example/contact", title: "Contact", verified: true }], missing_info: ["Named contact person"] },
];

function tzDayStart(tz: string, at = Date.now()) { return startOfDay(new TZDate(at, tz)).getTime(); }
function tzMonthStart(tz: string, at = Date.now()) { return startOfMonth(new TZDate(at, tz)).getTime(); }

export class DemoApiClient implements ApiClient {
  readonly mode = "demo" as const;
  private s: DemoState;

  constructor() {
    this.s = this.load();
  }

  // ------------------------------------------------------------------ persistence
  private load(): DemoState {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as DemoState;
          if (parsed.version === DEMO_VERSION) return parsed;
        }
      } catch { /* corrupted demo state — reseed */ }
    }
    return seedDemoState();
  }
  private save() {
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* quota — ignore in demo */ }
    }
  }
  /** Restores the original sample data. */
  reset() {
    this.s = seedDemoState();
    this.save();
  }
  private id() { return ++this.s.seq; }
  private notFound(what: string): never { throw new ApiError(`${what} not found.`, 404, "not_found"); }

  // ------------------------------------------------------------------ simulated workflows
  private startRun(type: T.WorkflowType, title: string, plan: DemoRunState["plan"], effect: string | null, args: Record<string, unknown>, model: T.ModelPreference = "auto"): T.WorkflowRun {
    const provider = this.pickProvider(type, model);
    const run: T.WorkflowRun = {
      id: this.id(), type, title, status: "queued", progress: 0,
      steps: plan.map((p) => ({ label: p.label, status: "pending" as const })),
      result_summary: null, result_links: [], sources: [], error: null,
      served_by: { provider, model: provider === "kimi" ? "demo-kimi-general" : "demo-gpt-general", via_fallback: false },
      approval_ids: [], can_pause: true, can_resume: false, can_cancel: true, can_retry: false,
      estimated_cost: null, created_at: nowIso(), updated_at: nowIso(),
    };
    this.s.runs.unshift({ run, plan, startedMs: Date.now(), pausedAtMs: null, effect, args, applied: false });
    this.s.runs = this.s.runs.slice(0, 60);
    this.save();
    return clone(run);
  }

  private pickProvider(type: T.WorkflowType, model: T.ModelPreference): T.ProviderKey {
    if (model !== "auto") return model;
    const route = this.s.routing.workflows.find((w) => w.workflow_type === type) ?? this.s.routing.workflows[0];
    return this.s.pricing.find((p) => p.id === route?.model_id)?.provider ?? "openai";
  }

  private tick() {
    let changed = false;
    for (const rs of this.s.runs) {
      const r = rs.run;
      if (r.status !== "queued" && r.status !== "running") continue;
      const elapsed = Date.now() - rs.startedMs;
      const total = rs.plan.reduce((a, p) => a + p.ms, 0);
      let acc = 0;
      r.steps = rs.plan.map((p) => {
        const start = acc;
        acc += p.ms;
        const status = elapsed >= acc ? "done" : elapsed >= start ? "running" : "pending";
        return { label: p.label, status, detail: status === "done" ? p.detail : undefined } as T.WorkflowStep;
      });
      r.progress = Math.min(100, Math.round((elapsed / total) * 100));
      r.status = elapsed < 600 ? "queued" : "running";
      if (elapsed >= total) {
        r.status = "completed";
        r.progress = 100;
        r.can_pause = r.can_cancel = r.can_resume = false;
        if (!rs.applied) {
          rs.applied = true;
          this.applyEffect(rs);
          this.recordUsage(r);
        }
      }
      r.updated_at = nowIso();
      changed = true;
    }
    if (changed) this.save();
  }

  private recordUsage(r: T.WorkflowRun) {
    const provider = r.served_by?.provider ?? "openai";
    const model_id = r.served_by?.model ?? "demo-gpt-general";
    const input = 6_000 + Math.round(Math.random() * 9_000);
    const output = 700 + Math.round(Math.random() * 1_600);
    this.s.usage.push({ at: Date.now(), provider, model_id, input, output, cached: 0, workflow: r.type });
    const p = this.s.pricing.find((x) => x.model_id === model_id);
    r.estimated_cost = p?.input_price_per_mtok != null && p.output_price_per_mtok != null
      ? (input * p.input_price_per_mtok + output * p.output_price_per_mtok) / 1_000_000 : null;
    if (r.type === "buyer_research") {
      this.s.serviceUsage.push({ at: Date.now(), key: "search", units: 6, workflow: r.type });
      this.s.serviceUsage.push({ at: Date.now(), key: "extraction", units: 9, workflow: r.type });
    }
  }

  private chatReply(threadId: unknown, content: string, extra: Partial<T.ChatMessage> = {}) {
    if (typeof threadId !== "number") return;
    this.s.messages.push({ id: this.id(), thread_id: threadId, role: "assistant", content, attachments: [], workflow_run_id: null, approval_ids: [], unsupported: false, created_at: nowIso(), ...extra });
    const t = this.s.threads.find((x) => x.id === threadId);
    if (t) { t.last_preview = content.slice(0, 90); t.updated_at = nowIso(); }
  }

  private applyEffect(rs: DemoRunState) {
    const r = rs.run;
    const a = rs.args;
    switch (rs.effect) {
      case "research": {
        const job = this.s.researchJobs.find((j) => j.id === a.job_id);
        if (!job) break;
        const pool = RESULT_POOL.filter((p) => !this.s.researchResults.some((x) => x.company === p.company));
        const picked = (pool.length ? pool : RESULT_POOL).slice(0, 4);
        for (const p of picked) {
          const dup = this.s.leads.find((l) => new URL(l.website).hostname === new URL(p.website).hostname);
          this.s.researchResults.unshift({ ...clone(p), id: this.id(), job_id: job.id, found_at: nowIso(), duplicate_of_lead_id: dup?.id ?? null, saved_lead_id: null });
        }
        const verified = picked.filter((p) => p.email_status === "verified_on_source").length;
        job.progress.searches += 12; job.progress.pages_checked += 37; job.progress.candidates += picked.length + 3;
        job.progress.new_leads += picked.length; job.progress.duplicates_skipped += 2; job.progress.emails_verified += verified;
        job.spent_today += 0.18; job.spent_total += 0.18; job.last_run_at = nowIso(); job.current_run_id = null;
        if (job.mode === "one_time") { job.status = "completed"; job.next_run_at = null; }
        else { job.status = "running"; job.next_run_at = iso(Date.now() + (job.limits.interval_hours ?? 24) * H); }
        r.result_summary = `Found ${picked.length} candidate companies (${verified} with a public email confirmed on the source page). 2 companies already in your CRM were skipped. Review and save them in Buyer Research.`;
        r.result_links = [{ label: "Review results", href: `/research?job=${job.id}` }];
        r.sources = picked.flatMap((p) => p.sources);
        this.chatReply(a.thread_id, r.result_summary, { workflow_run_id: r.id });
        break;
      }
      case "outreach": {
        const ids = (a.lead_ids as number[]) ?? [];
        const account = this.s.accounts.find((x) => x.id === a.account_id) ?? this.s.accounts[0];
        const leads = this.s.leads.filter((l) => ids.includes(l.id));
        const usable = leads.filter((l) => l.contact_email && !l.suppression.suppressed && l.email_status !== "not_found");
        const skipped = leads.length - usable.length;
        if (!usable.length) {
          r.result_summary = "No drafts were prepared: none of the selected leads has a usable, non-suppressed email address.";
          this.chatReply(a.thread_id, r.result_summary, { workflow_run_id: r.id });
          break;
        }
        const appr: T.Approval = {
          id: this.id(), kind: "outreach", status: "pending", title: `First outreach to ${usable.length} lead${usable.length > 1 ? "s" : ""}`,
          action: `Send ${usable.length} first email${usable.length > 1 ? "s" : ""} from ${account.address} and start the 'Standard EU outreach' sequence.`,
          sender: { account_id: account.id, address: account.address, sender_name: account.sender_name, kind: account.kind },
          recipients: usable.map((l) => l.contact_email!),
          items: usable.map((l) => ({
            id: this.id(), label: "First email", recipient: l.contact_email, recipient_name: l.contacts[0]?.name || null, company: l.company,
            subject: `${l.products.split(",")[0]} from Bangladesh — Meghna Knit`,
            body: `Dear ${l.contacts[0]?.name || "Purchasing Team"},\n\nI noticed that ${l.company} works with ${l.products.toLowerCase()}. We are a vertically integrated knit composite in Gazipur, Bangladesh, certified to GOTS and OEKO-TEX Standard 100.\n\nWould it help if I sent our product sheet?\n\n${account.signature}`,
            schedule: `After approval, within ${account.window_start}–${account.window_end} ${account.timezone}`, scheduled_at: null, editable: true,
            warnings: l.email_status === "unverified" ? ["Recipient email is UNVERIFIED — not found on a public page."] : [],
          })),
          schedule_summary: "First emails in the next sending window; follow-ups after 4 and 11 days only if there is no reply, bounce or unsubscribe.",
          is_batch: usable.length > 1, content_hash: `demo-${Date.now()}`, related: [{ label: "Leads", href: "/leads" }], invalid_reason: null, created_at: nowIso(), decided_at: null,
        };
        this.s.approvals.unshift(appr);
        r.approval_ids = [appr.id];
        r.result_summary = `Prepared ${usable.length} draft${usable.length > 1 ? "s" : ""} for your approval${skipped ? `; ${skipped} lead(s) skipped (no usable email or suppressed)` : ""}. Nothing has been sent.`;
        r.result_links = [{ label: "Review in Approvals", href: `/approvals?id=${appr.id}` }];
        this.chatReply(a.thread_id, r.result_summary, { workflow_run_id: r.id, approval_ids: [appr.id] });
        break;
      }
      case "reply_summary": {
        const att = this.s.conversations.filter((c) => c.needs_attention);
        const lines = att.map((c) => `• ${c.company} (${c.account_address}) — ${c.classification?.replace(/_/g, " ") ?? "unclassified"}: ${c.ai_summary ?? c.snippet}`);
        r.result_summary = att.length ? `${att.length} conversation(s) need your attention:\n${lines.join("\n")}` : "No replies need your attention right now.";
        r.result_links = [{ label: "Open inbox", href: "/inbox?filter=attention" }];
        this.chatReply(a.thread_id, r.result_summary, { workflow_run_id: r.id });
        break;
      }
      case "suggest_reply": {
        const c = this.s.conversations.find((x) => x.id === a.conversation_id);
        if (!c) break;
        const acc = this.s.accounts.find((x) => x.id === c.account_id);
        c.suggested_reply = c.suggested_reply ?? {
          subject: `Re: ${c.subject.replace(/^Re:\s*/i, "")}`,
          body: `Dear ${c.contact_name || "Sir or Madam"},\n\nThank you for your message. Our standard MOQ is 1,000 pcs per colour per style, and our lead time is 60–75 days after pre-production sample approval.\n\n${acc?.signature ?? ""}`,
          based_on_facts: ["MOQ: 1,000 pcs per colour per style", "Delivery: 60–75 days after PP sample approval"],
          missing_facts: [],
        };
        r.result_summary = "Suggested reply prepared from approved business facts. Review it in the inbox; it is only sent after approval.";
        r.result_links = [{ label: "Open conversation", href: `/inbox?c=${c.id}` }];
        break;
      }
      case "blog_ideas": {
        const topic = String(a.topic ?? "");
        const ideas: T.BlogIdea[] = [
          { title: `${topic}: what buyers should know`, angle: "Practical explainer for sourcing managers", keywords: [topic.toLowerCase(), "garment sourcing"] },
          { title: `5 questions to ask a factory about ${topic.toLowerCase()}`, angle: "Checklist format", keywords: [topic.toLowerCase(), "supplier checklist"] },
          { title: `How we approach ${topic.toLowerCase()} at our knit composite`, angle: "Behind the scenes, factual and verifiable", keywords: [topic.toLowerCase(), "Bangladesh knitwear"] },
        ];
        this.s.blogIdeas[String(r.id)] = ideas;
        r.result_summary = `Generated ${ideas.length} ideas for “${topic}”.`;
        if (typeof a.post_id === "number") {
          const p = this.s.posts.find((x) => x.id === a.post_id);
          if (p && !p.outline) {
            p.title = p.title || ideas[0].title;
            p.outline = "1. Why it matters to buyers\n2. What we do today (only approved facts)\n3. What to ask any supplier\n4. Next steps";
            p.updated_at = nowIso();
          }
          r.result_links = [{ label: "Open draft in Blog Studio", href: `/blog?id=${a.post_id}` }];
        }
        this.chatReply(a.thread_id, `${r.result_summary} I created a draft with an outline in Blog Studio. Nothing is published without your approval.`, { workflow_run_id: r.id });
        break;
      }
      case "blog_part": {
        const p = this.s.posts.find((x) => x.id === a.post_id);
        if (!p) break;
        const part = a.part as T.BlogGeneratePart;
        const title = p.title || p.topic;
        if (part === "outline") p.outline = `1. Introduction to ${p.topic}\n2. Key considerations for buyers\n3. How we work (approved facts only)\n4. Checklist\n5. Conclusion`;
        if (part === "article") p.body = `## Introduction\n\n${title} is a frequent question from European buyers. This article explains the essentials in plain language.\n\n## Key considerations\n\n- Documentation buyers can verify\n- Timelines and responsibilities\n- What to ask any supplier\n\n## How we work\n\nWe are a vertically integrated knit composite in Gazipur, Bangladesh, certified to GOTS and OEKO-TEX Standard 100.\n\n## Conclusion\n\n[Add your own closing and call to action.]\n`;
        if (part === "seo") { p.seo_title = title.slice(0, 60); p.meta_description = `A practical guide to ${p.topic.toLowerCase()} for apparel buyers sourcing knitwear from Bangladesh.`.slice(0, 158); }
        if (part === "captions") p.social_captions = [{ platform: "LinkedIn", text: `New on our blog: ${title}. A practical read for apparel buyers.` }, { platform: "Facebook", text: `${title} — read the full article on our blog.` }];
        p.updated_at = nowIso();
        r.result_summary = `Generated ${part} for “${title}”. Review and edit before requesting publication.`;
        r.result_links = [{ label: "Open in Blog Studio", href: `/blog?id=${p.id}` }];
        break;
      }
      case "automation": {
        const au = this.s.automations.find((x) => x.id === a.automation_id);
        if (!au) break;
        const run: T.AutomationRun = { id: r.id, started_at: r.created_at, finished_at: nowIso(), status: "completed", summary: au.outgoing ? "Run completed (demo — no external actions performed)" : "Run completed (demo)", error: null };
        au.last_run = run;
        au.history.unshift(run);
        r.result_summary = run.summary;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ auth & system
  async getSession(): Promise<T.SessionInfo> { await wait(60); return { authenticated: true, owner: { name: this.s.profile.name, email: this.s.profile.email } }; }
  async login(): Promise<T.SessionInfo> { return this.getSession(); }
  async logout() { await wait(60); }
  async getSystemStatus(): Promise<T.SystemStatus> {
    await wait(80);
    return {
      mode: "demo", app_version: "demo", timezone: this.s.profile.timezone, emergency_pause: clone(this.s.emergency),
      hermes: { version_pin: "v0.23.2", research: "disconnected", writer: "disconnected" },
      providers: {
        openai: { configured: false, enabled_models: this.s.pricing.filter((p) => p.provider === "openai" && p.enabled).length },
        kimi: { configured: false, enabled_models: this.s.pricing.filter((p) => p.provider === "kimi" && p.enabled).length },
      },
    };
  }
  async setEmergencyPause(paused: boolean, reason: string) {
    await wait();
    this.s.emergency = { paused, reason: paused ? reason : "", since: paused ? nowIso() : null };
    this.save();
    return clone(this.s.emergency);
  }
  async getNotifications() { await wait(80); return clone(this.s.notifications); }
  async markNotificationsRead(ids: T.ID[]) { await wait(60); this.s.notifications.forEach((n) => { if (ids.includes(n.id)) n.read = true; }); this.save(); }

  // ------------------------------------------------------------------ overview & workflows
  async getOverview(): Promise<T.Overview> {
    await wait();
    this.tick();
    const u = this.computeUsage();
    const pendingApprovals = this.s.approvals.filter((a) => a.status === "pending");
    const activity: T.ActivityItem[] = [
      ...this.s.conversations.flatMap((c) => c.messages.map((m) => ({
        id: `m${m.id}`, kind: (m.direction === "in" ? "reply" : "email_sent") as T.ActivityItem["kind"],
        title: m.direction === "in" ? `Reply from ${c.company}` : `${m.status === "simulated" ? "Simulated email (demo)" : m.status === "sent" ? "Email sent" : `Email ${m.status}`} to ${c.company}`,
        detail: m.direction === "in" ? (m.classification ? m.classification.replace(/_/g, " ") : undefined) : `from ${m.from}`,
        href: `/inbox?c=${c.id}`, at: m.sent_at ?? m.created_at,
      }))),
      ...this.s.leads.filter((l) => Date.now() - Date.parse(l.created_at) < 48 * H).map((l) => ({ id: `l${l.id}`, kind: "lead" as const, title: `New lead: ${l.company}`, detail: l.country, href: `/leads?id=${l.id}`, at: l.created_at })),
      ...pendingApprovals.map((a) => ({ id: `a${a.id}`, kind: "approval" as const, title: `Approval requested: ${a.title}`, href: `/approvals?id=${a.id}`, at: a.created_at })),
      ...this.s.runs.map((r) => r.run).filter((r) => r.status === "completed" || r.status === "failed").map((r) => ({ id: `w${r.id}`, kind: (r.status === "failed" ? "error" : "workflow") as T.ActivityItem["kind"], title: `${r.title} ${r.status}`, detail: r.result_summary ?? undefined, at: r.updated_at })),
      ...this.s.posts.filter((p) => p.status === "failed").map((p) => ({ id: `b${p.id}`, kind: "error" as const, title: `Blog publishing failed: ${p.title}`, detail: p.error ?? undefined, href: `/blog?id=${p.id}`, at: p.updated_at })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    const horizon = Date.now() + 7 * 24 * H;
    const upcoming: T.UpcomingItem[] = [
      ...this.s.leads.filter((l) => l.next_follow_up_at && Date.parse(l.next_follow_up_at) < horizon && !l.suppressed).map((l) => ({ id: `f${l.id}`, kind: "follow_up" as const, title: `Follow-up: ${l.company}`, detail: l.sender_address ?? undefined, href: `/leads?id=${l.id}`, due_at: l.next_follow_up_at! })),
      ...this.s.tasks.filter((t) => t.status !== "done" && t.due_at && Date.parse(t.due_at) < horizon).map((t) => ({ id: `t${t.id}`, kind: "task" as const, title: t.title, href: `/tasks?id=${t.id}`, due_at: t.due_at!, priority: t.priority })),
      ...this.s.events.filter((e) => e.status !== "cancelled" && Date.parse(e.start_at) > Date.now() && Date.parse(e.start_at) < horizon).map((e) => ({ id: `e${e.id}`, kind: "meeting" as const, title: e.title, detail: e.status === "pending_approval" ? "Invitation awaiting approval" : undefined, href: `/tasks?view=calendar`, due_at: e.start_at })),
    ].sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 10);
    return {
      counts: {
        total_leads: this.s.leads.length,
        interested_buyers: this.s.leads.filter((l) => l.status === "interested").length,
        replies_needing_attention: this.s.conversations.filter((c) => c.needs_attention).length,
        pending_approvals: pendingApprovals.length,
        running_workflows: this.s.runs.filter((r) => r.run.status === "running" || r.run.status === "queued").length + this.s.researchJobs.filter((j) => j.status === "running" && j.mode === "ongoing").length,
      },
      spend_today: { estimated: u.budget.daily_spent, currency: u.currency, daily_budget: u.budget.daily_limit, unpriced_records: u.unpriced_records },
      recent_activity: activity, upcoming,
    };
  }
  async listWorkflowRuns(params?: { status?: T.WorkflowStatus | ""; limit?: number }) {
    await wait(100); this.tick();
    return clone(this.s.runs.map((r) => r.run).filter((r) => !params?.status || r.status === params.status).slice(0, params?.limit ?? 50));
  }
  async startWorkflowRun(input: {
    type: T.WorkflowType;
    title?: string;
    input: string;
    model_config_id?: T.ID | null;
    params?: Record<string, unknown>;
  }) {
    await wait();
    const run: T.WorkflowRun = {
      id: Date.now(),
      type: input.type,
      title: input.title || input.type,
      status: "queued",
      progress: 0,
      steps: [],
      result_summary: null,
      result_links: [],
      sources: [],
      error: null,
      served_by: null,
      approval_ids: [],
      can_pause: false,
      can_resume: false,
      can_cancel: true,
      can_retry: false,
      estimated_cost: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.s.runs.unshift({ run, plan: [], startedMs: Date.now(), pausedAtMs: null, effect: null, args: {}, applied: false });
    this.save();
    return clone(run);
  }
  private rs(id: T.ID) { return this.s.runs.find((r) => r.run.id === id) ?? this.notFound("Workflow run"); }
  async getWorkflowRun(id: T.ID) { await wait(80); this.tick(); return clone(this.rs(id).run); }
  async pauseWorkflowRun(id: T.ID) {
    await wait(); this.tick(); const rs = this.rs(id);
    if (rs.run.status !== "running" && rs.run.status !== "queued") throw new ApiError("This run can no longer be paused.", 409);
    rs.pausedAtMs = Date.now(); rs.run.status = "paused"; rs.run.can_pause = false; rs.run.can_resume = true; this.save(); return clone(rs.run);
  }
  async resumeWorkflowRun(id: T.ID) {
    await wait(); const rs = this.rs(id);
    if (rs.run.status !== "paused") throw new ApiError("This run is not paused.", 409);
    rs.startedMs += Date.now() - (rs.pausedAtMs ?? Date.now()); rs.pausedAtMs = null; rs.run.status = "running"; rs.run.can_pause = true; rs.run.can_resume = false; this.save(); this.tick(); return clone(rs.run);
  }
  async cancelWorkflowRun(id: T.ID) {
    await wait(); this.tick(); const rs = this.rs(id);
    if (T_TERMINAL.includes(rs.run.status)) throw new ApiError("This run has already finished.", 409);
    rs.run.status = "cancelled"; rs.run.can_pause = rs.run.can_resume = rs.run.can_cancel = false; rs.run.can_retry = true;
    rs.run.steps = rs.run.steps.map((s) => (s.status === "done" ? s : { ...s, status: "skipped" }));
    const job = this.s.researchJobs.find((j) => j.current_run_id === id);
    if (job) { job.current_run_id = null; job.status = "paused"; job.pause_reason = "Run cancelled by owner"; }
    this.save(); return clone(rs.run);
  }
  async retryWorkflowRun(id: T.ID) {
    await wait(); const rs = this.rs(id);
    return this.startRun(rs.run.type, rs.run.title, rs.plan, rs.effect, rs.args);
  }

  // ------------------------------------------------------------------ chat
  async listChatThreads() { await wait(80); return clone([...this.s.threads].sort((a, b) => b.updated_at.localeCompare(a.updated_at))); }
  async createChatThread(title?: string) {
    await wait(80);
    const t: T.ChatThread = { id: this.id(), title: title || "New conversation", last_preview: "", updated_at: nowIso() };
    this.s.threads.unshift(t); this.save(); return clone(t);
  }
  async deleteChatThread(id: T.ID) { await wait(80); this.s.threads = this.s.threads.filter((t) => t.id !== id); this.s.messages = this.s.messages.filter((m) => m.thread_id !== id); this.save(); }
  async listChatMessages(threadId: T.ID) { await wait(80); this.tick(); return clone(this.s.messages.filter((m) => m.thread_id === threadId)); }
  async uploadChatAttachment(file: File): Promise<T.Attachment> {
    await wait(300);
    if (file.size > 10 * 1024 * 1024) throw new ApiError("Attachments are limited to 10 MB.", 413);
    return { id: this.id(), filename: file.name, size: file.size, content_type: file.type || "application/octet-stream" };
  }
  async getCommandSuggestions() { await wait(40); return clone(COMMANDS); }

  async sendChatMessage(threadId: T.ID, input: T.SendChatMessageInput): Promise<T.SendChatMessageResult> {
    await wait(350);
    const thread = this.s.threads.find((t) => t.id === threadId) ?? this.notFound("Conversation");
    const text = input.content.trim();
    if (!text) throw new ApiError("Message is empty.", 422);
    const owner: T.ChatMessage = { id: this.id(), thread_id: threadId, role: "owner", content: text, attachments: [], workflow_run_id: null, approval_ids: [], unsupported: false, created_at: nowIso() };
    this.s.messages.push(owner);
    if (thread.title === "New conversation") thread.title = text.slice(0, 48);
    thread.last_preview = text.slice(0, 90); thread.updated_at = nowIso();
    const lower = text.toLowerCase();
    let run: T.WorkflowRun | null = null;
    let reply = "";
    let unsupported = false;

    if (/(research|find|look for|search).*(buyer|importer|wholesaler|brand|distributor|compan|retailer)/.test(lower)) {
      const countries = COUNTRIES.filter((c) => lower.includes(c.toLowerCase()));
      const product = /garment|apparel|cloth/.test(lower) ? "Garments" : /t-?shirt/.test(lower) ? "T-shirts" : /polo/.test(lower) ? "Polo shirts" : "Knit garments";
      const job = this.createJobInternal({
        name: `${product} buyers — ${countries.join(", ") || "Europe"}`, mode: /ongoing|continu|every|weekly|daily/.test(lower) ? "ongoing" : "one_time",
        criteria: { product, industry: "Apparel", countries: countries.length ? countries : ["Germany"], buyer_type: "Importers, wholesalers, brands" },
        result_target: null, limits: { max_runtime_minutes: 20, spend_limit: 2, interval_hours: 24, concurrency: 1 }, model: input.model,
      }, threadId);
      run = this.rs(job.current_run_id!).run;
      reply = `Started buyer research: “${job.name}” (${job.mode === "ongoing" ? "ongoing, every 24 h" : "one-time"}, max 20 min, 2.00 USD estimated spend limit). I only keep publicly listed business emails and link the source page for each.${countries.length ? "" : " I didn't recognise a country, so I used Germany — change it in Buyer Research if needed."}`;
    } else if (/summar/.test(lower) && /(repl|inbox|email|mail)/.test(lower)) {
      run = this.startRun("reply_summary", "Summarize replies across inboxes", [
        { label: "Load recent conversations", ms: 1500, detail: `${this.s.accounts.filter((a) => a.kind === "mailbox" && a.status === "connected").length} connected inboxes` },
        { label: "Summarize replies needing attention", ms: 3000 },
      ], "reply_summary", { thread_id: threadId }, input.model);
      reply = "Summarizing replies from all connected inboxes. Note: eu-sales@meghnaknit.example needs reconnection, so its newest mail is not included.";
    } else if (/(draft|prepare|write).*(outreach|first email|cold email)|outreach/.test(lower)) {
      const leads = this.s.leads.filter((l) => l.status === "new" && l.email_status === "verified_on_source" && !l.suppressed);
      if (!leads.length) {
        reply = "There are no new leads with a verified public email to draft outreach for. Run buyer research or verify an email first.";
      } else {
        run = this.startRun("outreach_drafts", `Draft outreach for ${leads.length} new lead(s)`, [
          { label: "Check suppression list and duplicates", ms: 1200, detail: "No conflicts" },
          { label: "Load approved business facts", ms: 1200 },
          { label: "Write personalised first emails", ms: 4000 },
          { label: "Create approval request", ms: 800 },
        ], "outreach", { thread_id: threadId, lead_ids: leads.map((l) => l.id), account_id: 1 }, input.model);
        reply = `Drafting first emails for ${leads.length} new lead(s) with verified emails, from sales@meghnaknit.example. They will appear in Approvals — nothing is sent until you approve.`;
      }
    } else if (/blog|article|post about/.test(lower)) {
      const topic = (text.match(/(?:about|on)\s+(.+?)[.?!]*$/i)?.[1] ?? "Sustainable manufacturing").replace(/^(a|an|the)\s+/i, "");
      const post = this.newPost(topic.charAt(0).toUpperCase() + topic.slice(1), []);
      run = this.startRun("blog_ideas", `Blog ideas: ${post.topic}`, [
        { label: "Research angles", ms: 2000 }, { label: "Generate ideas and outline", ms: 3000 },
      ], "blog_ideas", { thread_id: threadId, topic: post.topic, post_id: post.id }, input.model);
      reply = `Preparing ideas and an outline for a blog about “${post.topic}”. I'll only use facts from Business Knowledge; anything I can't confirm will be marked for you to fill in.`;
    } else if (/remind|task|to-?do/.test(lower)) {
      const tomorrow = /tomorrow/.test(lower);
      const due = new TZDate(Date.now() + (tomorrow ? 24 * H : 2 * H), this.s.profile.timezone);
      if (tomorrow) due.setHours(10, 0, 0, 0);
      const title = text.replace(/^(please\s+)?(remind me( to)?|add (a )?task( to)?|create (a )?task( to)?)\s*/i, "").replace(/\btomorrow\b/i, "").trim() || text;
      const task = this.createTaskInternal({ title: title.charAt(0).toUpperCase() + title.slice(1), description: "Created from AI Assistant", priority: "normal", due_at: new Date(due.getTime()).toISOString(), recurrence: "none", recurrence_interval: 1, remind_at: new Date(due.getTime() - 30 * 60_000).toISOString(), reminder_channel: "dashboard" });
      reply = `Added task “${task.title}”, due ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: this.s.profile.timezone }).format(due)} (${this.s.profile.timezone}), with a dashboard reminder 30 minutes before.`;
    } else {
      unsupported = true;
      reply = "I can't run that as an automated workflow yet. Supported requests are: buyer research, summarizing email replies, drafting outreach for approval, preparing blog drafts, and creating tasks or reminders. Try one of the suggested commands below.";
    }
    const assistant: T.ChatMessage = { id: this.id(), thread_id: threadId, role: "assistant", content: reply, attachments: [], workflow_run_id: run?.id ?? null, approval_ids: [], unsupported, created_at: nowIso() };
    this.s.messages.push(assistant);
    owner.attachments = input.attachment_ids.map((id) => ({ id, filename: `attachment-${id}`, size: 0, content_type: "" }));
    this.save();
    return { messages: clone([owner, assistant]), workflow_run: run ? clone(run) : null };
  }

  // ------------------------------------------------------------------ research
  async listResearchJobs() { await wait(); this.tick(); return clone(this.s.researchJobs); }
  private createJobInternal(input: T.ResearchJobInput, threadId?: T.ID): T.ResearchJob {
    const job: T.ResearchJob = {
      ...clone(input), id: this.id(), status: "running", pause_reason: "",
      progress: { searches: 0, pages_checked: 0, candidates: 0, new_leads: 0, duplicates_skipped: 0, emails_verified: 0 },
      spent_today: 0, spent_total: 0, last_run_at: null, next_run_at: null, current_run_id: null, error: null, created_at: nowIso(),
    };
    this.s.researchJobs.unshift(job);
    const run = this.startRun("buyer_research", `Buyer research: ${job.name}`, [
      { label: "Plan search queries", ms: 1500, detail: `${job.criteria.countries.join(", ")} · ${job.criteria.buyer_type}` },
      { label: "Search the web", ms: 3500, detail: "12 searches" },
      { label: "Visit company pages", ms: 4000, detail: "37 pages checked" },
      { label: "Verify public emails on source pages", ms: 2500 },
      { label: "Remove duplicates against CRM", ms: 1000, detail: "2 already in CRM" },
    ], "research", { job_id: job.id, thread_id: threadId ?? null }, input.model);
    job.current_run_id = run.id;
    job.last_run_at = nowIso();
    return job;
  }
  async createResearchJob(input: T.ResearchJobInput) {
    await wait();
    if (!input.criteria.product.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { "criteria.product": "Product is required." });
    const job = this.createJobInternal(input);
    this.save(); return clone(job);
  }
  private job(id: T.ID) { return this.s.researchJobs.find((j) => j.id === id) ?? this.notFound("Research job"); }
  async pauseResearchJob(id: T.ID) {
    await wait(); const j = this.job(id);
    if (j.current_run_id) { const rs = this.s.runs.find((r) => r.run.id === j.current_run_id); if (rs && !T_TERMINAL.includes(rs.run.status)) { rs.pausedAtMs = Date.now(); rs.run.status = "paused"; rs.run.can_resume = true; rs.run.can_pause = false; } }
    j.status = "paused"; j.pause_reason = "Paused by owner"; j.next_run_at = null; this.save(); return clone(j);
  }
  async resumeResearchJob(id: T.ID) {
    await wait(); const j = this.job(id);
    const rs = j.current_run_id ? this.s.runs.find((r) => r.run.id === j.current_run_id) : undefined;
    if (rs && rs.run.status === "paused") { rs.startedMs += Date.now() - (rs.pausedAtMs ?? Date.now()); rs.pausedAtMs = null; rs.run.status = "running"; rs.run.can_pause = true; rs.run.can_resume = false; }
    j.status = "running"; j.pause_reason = ""; if (j.mode === "ongoing" && !rs) j.next_run_at = iso(Date.now() + 5 * 60_000);
    this.save(); return clone(j);
  }
  async cancelResearchJob(id: T.ID) {
    await wait(); const j = this.job(id);
    const rs = j.current_run_id ? this.s.runs.find((r) => r.run.id === j.current_run_id) : undefined;
    if (rs && !T_TERMINAL.includes(rs.run.status)) { rs.run.status = "cancelled"; rs.run.can_cancel = rs.run.can_pause = rs.run.can_resume = false; }
    j.status = "completed"; j.pause_reason = "Stopped by owner"; j.next_run_at = null; j.current_run_id = null; this.save(); return clone(j);
  }
  async listResearchResults(params: { job_id?: T.ID; unsaved_only?: boolean }) {
    await wait(); this.tick();
    return clone(this.s.researchResults.filter((r) => (!params.job_id || r.job_id === params.job_id) && (!params.unsaved_only || !r.saved_lead_id)));
  }
  async saveResearchResults(resultIds: T.ID[]) {
    await wait(400);
    const saved: T.ID[] = []; const skipped: { id: T.ID; reason: string }[] = [];
    for (const rid of resultIds) {
      const r = this.s.researchResults.find((x) => x.id === rid);
      if (!r) { skipped.push({ id: rid, reason: "Result not found" }); continue; }
      if (r.saved_lead_id) { skipped.push({ id: rid, reason: "Already saved" }); continue; }
      if (r.duplicate_of_lead_id) { skipped.push({ id: rid, reason: "Company already in CRM" }); continue; }
      const job = this.s.researchJobs.find((j) => j.id === r.job_id);
      const leadId = this.id();
      this.s.leads.unshift({
        id: leadId, company: r.company, website: r.website, country: r.country, industry: job?.criteria.industry ?? "", buyer_type: job?.criteria.buyer_type ?? "",
        products: job?.criteria.product ?? "", status: "new", contact_email: r.email, email_status: r.email_status, sender_account_id: null, sender_address: null,
        last_contact_at: null, next_follow_up_at: null, suppressed: false, created_at: nowIso(), relevance: r.relevance, missing_info: r.missing_info, sources: r.sources,
        contacts: [{ id: this.id(), name: "", role: "", email: r.email, email_status: r.email_status, email_source_url: r.sources[0]?.url ?? null, email_evidence: r.email_evidence }],
        timeline: [{ id: `r${leadId}`, kind: "research", title: "Saved from buyer research", detail: r.relevance, at: nowIso() }],
        notes: [], conversation_id: null, sequence: null,
        research_history: job ? [{ job_id: job.id, job_name: job.name, found_at: r.found_at, relevance: r.relevance }] : [],
        suppression: { suppressed: false, reason: null, since: null, scope: null },
      });
      r.saved_lead_id = leadId; saved.push(rid);
    }
    this.save(); return { saved, skipped };
  }
  async prepareOutreach(input: { lead_ids: T.ID[]; account_id: T.ID; model: T.ModelPreference }) {
    await wait();
    if (!input.lead_ids.length) throw new ApiError("Select at least one lead.", 422);
    return this.startRun("outreach_drafts", `Draft outreach for ${input.lead_ids.length} lead(s)`, [
      { label: "Check suppression list and duplicates", ms: 1200 }, { label: "Load approved business facts", ms: 1200 },
      { label: "Write personalised first emails", ms: 4000 }, { label: "Create approval request", ms: 800 },
    ], "outreach", { lead_ids: input.lead_ids, account_id: input.account_id }, input.model);
  }

  // ------------------------------------------------------------------ CRM
  private lead(id: T.ID) { return this.s.leads.find((l) => l.id === id) ?? this.notFound("Lead"); }
  private toLead(l: T.LeadDetail): T.Lead {
    const { id, company, website, country, industry, buyer_type, products, status, contact_email, email_status, sender_account_id, sender_address, last_contact_at, next_follow_up_at, suppressed, created_at } = l;
    return { id, company, website, country, industry, buyer_type, products, status, contact_email, email_status, sender_account_id, sender_address, last_contact_at, next_follow_up_at, suppressed, created_at };
  }
  private filterLeads(f: T.LeadFilters) {
    const q = f.q?.trim().toLowerCase();
    let items = this.s.leads.filter((l) =>
      (!q || [l.company, l.contact_email ?? "", l.country, l.products, l.website].some((v) => v.toLowerCase().includes(q))) &&
      (!f.status || l.status === f.status) && (!f.country || l.country === f.country) &&
      (!f.sender_account_id || l.sender_account_id === f.sender_account_id));
    const sort = f.sort ?? "created_at";
    items = [...items].sort((a, b) => sort === "company" ? a.company.localeCompare(b.company) : sort === "next_follow_up_at" ? (a.next_follow_up_at ?? "9").localeCompare(b.next_follow_up_at ?? "9") : (b[sort] ?? "").localeCompare(a[sort] ?? ""));
    return items;
  }
  async listLeads(filters: T.LeadFilters) { await wait(); const items = this.filterLeads(filters); return { items: items.map((l) => this.toLead(l)), total: items.length }; }
  async getLead(id: T.ID) { await wait(120); return clone(this.lead(id)); }
  async updateLead(id: T.ID, update: T.LeadUpdate) {
    await wait(); const l = this.lead(id);
    if (update.status && update.status !== l.status) { l.timeline.unshift({ id: `s${this.id()}`, kind: "status", title: `Status changed from ${l.status} to ${update.status}`, at: nowIso() }); l.status = update.status; }
    if (update.next_follow_up_at !== undefined) l.next_follow_up_at = update.next_follow_up_at;
    if (update.outreach_paused && l.sequence) { l.sequence.status = "stopped"; l.sequence.stop_reason = "Paused by owner"; }
    this.save(); return clone(l);
  }
  async addLeadNote(id: T.ID, body: string) {
    await wait(); const l = this.lead(id);
    if (!body.trim()) throw new ApiError("Note is empty.", 422);
    const n: T.Note = { id: this.id(), body: body.trim(), created_at: nowIso() };
    l.notes.unshift(n); l.timeline.unshift({ id: `n${n.id}`, kind: "note", title: "Note added", detail: n.body, at: n.created_at });
    this.save(); return clone(n);
  }
  async suppressLead(id: T.ID, scope: "email" | "domain", detail: string) {
    await wait(); const l = this.lead(id);
    const domain = new URL(l.website).hostname.replace(/^www\./, "");
    if (scope === "email" && !l.contact_email) throw new ApiError("This lead has no email address to suppress. Suppress the domain instead.", 422);
    this.s.suppressions.unshift({ id: this.id(), email: scope === "email" ? l.contact_email : null, domain: scope === "domain" ? domain : null, reason: "manual", detail: detail || "Suppressed from CRM", created_at: nowIso() });
    l.suppressed = true; l.suppression = { suppressed: true, reason: "manual", since: nowIso(), scope };
    if (l.sequence && l.sequence.status === "active") { l.sequence.status = "stopped"; l.sequence.stop_reason = "Suppressed by owner"; }
    l.next_follow_up_at = null;
    l.timeline.unshift({ id: `x${this.id()}`, kind: "suppression", title: `Added to global suppression list (${scope})`, detail, at: nowIso() });
    this.save(); return clone(l);
  }
  leadsCsvUrl() { return "#demo-csv"; }
  async exportLeadsCsv(filters: T.LeadFilters) {
    await wait();
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = this.filterLeads(filters).map((l) => [l.company, l.website, l.country, l.contact_email, l.email_status, l.products, l.status, l.sender_address, l.last_contact_at, l.next_follow_up_at, l.suppressed ? "yes" : "no"].map(esc).join(","));
    const header = ["company", "website", "country", "contact_email", "email_status", "products", "status", "sender_account", "last_contact_at", "next_follow_up_at", "suppressed"].join(",");
    return new Blob([`# DEMO DATA — fictional companies\n${header}\n${rows.join("\n")}\n`], { type: "text/csv" });
  }

  // ------------------------------------------------------------------ email
  async listEmailAccounts() { await wait(); return clone(this.s.accounts); }
  private account(id: T.ID) { return this.s.accounts.find((a) => a.id === id) ?? this.notFound("Email account"); }
  async updateEmailAccount(id: T.ID, update: T.EmailAccountUpdate) {
    await wait(); const a = this.account(id);
    if (update.daily_limit != null && update.hourly_limit != null && update.hourly_limit > update.daily_limit) throw new ApiError("Please check the highlighted fields.", 422, "validation", { hourly_limit: "Hourly limit cannot exceed the daily limit." });
    Object.assign(a, update); this.save(); return clone(a);
  }
  async startEmailOAuth(): Promise<{ authorize_url: string }> {
    await wait();
    throw new ApiError("Demo Mode cannot connect real mailboxes. Connect a backend with Google or Microsoft OAuth configured to add accounts.", 400, "demo_unsupported");
  }
  async addImapSmtpAccount(): Promise<T.EmailAccount> {
    await wait();
    throw new ApiError("Demo Mode cannot connect real mailboxes. IMAP/SMTP credentials are only accepted by the backend.", 400, "demo_unsupported");
  }
  async addAlias(input: T.AliasInput) {
    await wait(); const parent = this.account(input.parent_id);
    if (parent.kind !== "mailbox") throw new ApiError("An alias must belong to a mailbox.", 422);
    if (this.s.accounts.some((a) => a.address.toLowerCase() === input.address.toLowerCase())) throw new ApiError("Please check the highlighted fields.", 422, "validation", { address: "This address already exists." });
    const a: T.EmailAccount = { ...clone(parent), id: this.id(), address: input.address.toLowerCase(), sender_name: input.sender_name, kind: "alias", parent_id: parent.id, parent_address: parent.address, sent_today: 0, last_sync_at: null, last_error: null };
    this.s.accounts.push(a); this.save(); return clone(a);
  }
  async disconnectEmailAccount(id: T.ID) {
    await wait(); const a = this.account(id); a.status = "disconnected"; a.last_error = null;
    this.s.accounts.filter((x) => x.parent_id === id).forEach((x) => (x.status = "disconnected"));
    this.save(); return clone(a);
  }
  async testEmailAccount(id: T.ID) {
    await wait(700); const a = this.account(id);
    return a.status === "connected" ? { ok: true, message: "Demo check only — no real connection was made." } : { ok: false, message: a.last_error ?? "Account is not connected." };
  }
  private conv(id: T.ID) { return this.s.conversations.find((c) => c.id === id) ?? this.notFound("Conversation"); }
  async listConversations(f: T.InboxFilters) {
    await wait(); this.tick();
    const q = f.q?.trim().toLowerCase();
    return clone(this.s.conversations
      .filter((c) => (!f.account_id || c.account_id === f.account_id || this.s.accounts.find((a) => a.id === f.account_id)?.parent_id === c.account_id) &&
        (f.filter !== "attention" || c.needs_attention) && (f.filter !== "unread" || c.unread) &&
        (!q || [c.company, c.subject, c.contact_email, c.snippet].some((v) => v.toLowerCase().includes(q))))
      .map(({ messages: _m, ai_summary: _a, escalation_reason: _e, suggested_reply: _s, pending_reply_approval_id: _p, sequence: _q, ...rest }) => rest)
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)));
  }
  async getConversation(id: T.ID) { await wait(120); this.tick(); return clone(this.conv(id)); }
  async markConversationRead(id: T.ID) { await wait(40); this.conv(id).unread = false; this.save(); }
  async suggestReply(id: T.ID, model: T.ModelPreference) {
    await wait(); const c = this.conv(id);
    if (c.classification === "unsubscribe") throw new ApiError("This contact asked not to be contacted. Replies are blocked.", 409);
    c.suggested_reply = null; this.save();
    return this.startRun("reply_analysis", `Suggest reply: ${c.company}`, [
      { label: "Read conversation (as untrusted text)", ms: 1200 }, { label: "Match approved business facts", ms: 1500 }, { label: "Draft reply", ms: 2500 },
    ], "suggest_reply", { conversation_id: id }, model);
  }
  async submitReplyForApproval(id: T.ID, draft: T.ReplyDraftInput) {
    await wait(); const c = this.conv(id);
    if (!draft.body.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { body: "The reply is empty." });
    const l = this.lead(c.lead_id);
    if (l.suppression.suppressed) throw new ApiError("This contact is on the suppression list. Replies are blocked.", 409);
    const acc = this.account(c.account_id);
    if (c.pending_reply_approval_id) {
      const old = this.s.approvals.find((a) => a.id === c.pending_reply_approval_id);
      if (old && old.status === "pending") { old.status = "invalidated"; old.invalid_reason = "Replaced by a newer draft."; }
    }
    const appr: T.Approval = {
      id: this.id(), kind: "sales_reply", status: "pending", title: `Reply to ${c.company}`,
      action: `Send this reply in the existing conversation from ${acc.address}.`,
      sender: { account_id: acc.id, address: acc.address, sender_name: acc.sender_name, kind: acc.kind }, recipients: [c.contact_email],
      items: [{ id: this.id(), label: "Reply", recipient: c.contact_email, recipient_name: c.contact_name || null, company: c.company, subject: draft.subject, body: draft.body, schedule: "Immediately after approval", scheduled_at: null, editable: true, warnings: c.escalation_reason ? [c.escalation_reason] : [] }],
      schedule_summary: "Sent immediately after approval.", is_batch: false, content_hash: `demo-${Date.now()}`,
      related: [{ label: "Conversation", href: `/inbox?c=${c.id}` }], invalid_reason: null, created_at: nowIso(), decided_at: null,
    };
    this.s.approvals.unshift(appr); c.pending_reply_approval_id = appr.id; this.save(); return clone(appr);
  }
  async stopSequence(conversationId: T.ID, reason: string) {
    await wait(); const c = this.conv(conversationId);
    if (c.sequence) { c.sequence.status = "stopped"; c.sequence.stop_reason = reason || "Stopped by owner"; c.sequence.steps.forEach((s) => { if (["queued", "approved", "pending_approval", "draft"].includes(s.status)) s.status = "cancelled"; }); }
    const l = this.lead(c.lead_id); l.sequence = clone(c.sequence); l.next_follow_up_at = null;
    this.save(); return clone(c);
  }

  // ------------------------------------------------------------------ approvals
  private approval(id: T.ID) { return this.s.approvals.find((a) => a.id === id) ?? this.notFound("Approval"); }
  async listApprovals(params?: { status?: T.ApprovalStatus | ""; kind?: T.ApprovalKind | "" }) {
    await wait(); this.tick();
    return clone(this.s.approvals.filter((a) => (!params?.status || a.status === params.status) && (!params?.kind || a.kind === params.kind)));
  }
  async getApproval(id: T.ID) { await wait(100); return clone(this.approval(id)); }
  async updateApprovalItem(approvalId: T.ID, itemId: T.ID, update: { subject?: string; body?: string }) {
    await wait(); const a = this.approval(approvalId);
    if (a.status !== "pending") throw new ApiError("Only pending approvals can be edited.", 409);
    const it = a.items.find((i) => i.id === itemId) ?? this.notFound("Approval item");
    if (!it.editable) throw new ApiError("This item cannot be edited here.", 409);
    if (update.subject !== undefined) it.subject = update.subject;
    if (update.body !== undefined) it.body = update.body;
    a.content_hash = `demo-${approvalId}-${Date.now()}`;
    this.save(); return clone(a);
  }
  async approve(approvalId: T.ID, input: T.ApproveInput) {
    await wait(500); const a = this.approval(approvalId);
    if (a.status !== "pending") throw new ApiError(`This approval is already ${a.status}.`, 409);
    if (input.content_hash !== a.content_hash) throw new ApiError("The content changed since you reviewed it. Review the latest version and approve again.", 409, "approval_stale");
    const items = a.items.filter((i) => input.item_ids.includes(i.id));
    if (a.items.length && !items.length) throw new ApiError("Select at least one item to approve.", 422);
    const paused = this.s.emergency.paused;
    const outStatus: T.OutboundStatus = paused ? "queued" : "simulated";
    for (const it of items) {
      const lead = this.s.leads.find((l) => l.contact_email && l.contact_email === it.recipient);
      if (lead?.suppression.suppressed && a.kind !== "blog_publish") { it.warnings.push("Skipped at send time: recipient is suppressed."); continue; }
      if (a.kind === "outreach" && lead && a.sender) {
        const m: T.EmailMessage = { id: this.id(), direction: "out", kind: "initial", from: a.sender.address, to: it.recipient!, subject: it.subject, body: it.body, status: outStatus, error: null, sent_at: null, created_at: nowIso(), classification: null, classification_reason: null };
        const seq = { name: "Standard EU outreach (3 steps)", status: "active" as const, stop_reason: null, steps: [
          { step: 0, label: "First email", delay_days: 0, status: outStatus, scheduled_at: null, sent_at: null },
          { step: 1, label: "Follow-up 1", delay_days: 4, status: "approved" as const, scheduled_at: iso(Date.now() + 96 * H), sent_at: null },
          { step: 2, label: "Follow-up 2", delay_days: 7, status: "approved" as const, scheduled_at: iso(Date.now() + 264 * H), sent_at: null },
        ] };
        let c = this.s.conversations.find((x) => x.lead_id === lead.id);
        if (!c) {
          const acc = this.account(a.sender.account_id);
          c = { id: this.id(), lead_id: lead.id, company: lead.company, contact_name: lead.contacts[0]?.name ?? "", contact_email: it.recipient!, account_id: acc.parent_id ?? acc.id, account_address: a.sender.address, subject: it.subject, snippet: it.body.slice(0, 100), status: "active", classification: null, needs_attention: false, unread: false, last_message_at: nowIso(), messages: [], ai_summary: null, escalation_reason: null, suggested_reply: null, pending_reply_approval_id: null, sequence: null };
          this.s.conversations.unshift(c);
        }
        c.messages.push(m); c.sequence = seq; c.last_message_at = nowIso();
        lead.conversation_id = c.id; lead.sequence = clone(seq); lead.status = lead.status === "new" ? "contacted" : lead.status;
        lead.sender_account_id = a.sender.account_id; lead.sender_address = a.sender.address; lead.last_contact_at = nowIso(); lead.next_follow_up_at = iso(Date.now() + 96 * H);
        lead.timeline.unshift({ id: `m${m.id}`, kind: "email_out", title: paused ? "Email queued — outgoing actions are paused" : "Email SIMULATED (demo — not sent)", detail: it.subject, status: m.status, at: nowIso() });
      }
      if (a.kind === "sales_reply") {
        const c = this.s.conversations.find((x) => x.pending_reply_approval_id === a.id);
        if (c && a.sender) {
          c.messages.push({ id: this.id(), direction: "out", kind: "reply", from: a.sender.address, to: it.recipient!, subject: it.subject, body: it.body, status: outStatus, error: null, sent_at: null, created_at: nowIso(), classification: null, classification_reason: null });
          c.pending_reply_approval_id = null; c.needs_attention = false; c.suggested_reply = null; c.last_message_at = nowIso();
        }
      }
      if (a.kind === "follow_up_sequence" && lead) {
        lead.sequence = { name: "Custom follow-ups", status: "active", stop_reason: null, steps: a.items.map((x, i) => ({ step: i + 1, label: x.label, delay_days: i === 0 ? 4 : 7, status: input.item_ids.includes(x.id) ? "approved" : "cancelled", scheduled_at: null, sent_at: null })) };
      }
    }
    if (a.kind === "blog_publish") {
      const p = this.s.posts.find((x) => x.approval_id === a.id);
      if (p) { p.status = "scheduled"; p.error = null; p.updated_at = nowIso(); }
    }
    if (a.kind === "meeting_invite") {
      const e = this.s.events.find((x) => x.approval_id === a.id);
      if (e) { e.status = "confirmed"; e.invites_sent = false; e.error = "Demo Mode: invitations were not delivered."; }
    }
    a.status = "approved"; a.decided_at = nowIso();
    this.save(); return clone(a);
  }
  async reject(approvalId: T.ID, reason: string) {
    await wait(); const a = this.approval(approvalId);
    if (a.status !== "pending") throw new ApiError(`This approval is already ${a.status}.`, 409);
    a.status = "rejected"; a.decided_at = nowIso(); a.invalid_reason = reason || null;
    const c = this.s.conversations.find((x) => x.pending_reply_approval_id === a.id); if (c) c.pending_reply_approval_id = null;
    const p = this.s.posts.find((x) => x.approval_id === a.id); if (p) { p.status = "draft"; p.approval_id = null; }
    const e = this.s.events.find((x) => x.approval_id === a.id); if (e) { e.status = "draft"; e.approval_id = null; }
    this.save(); return clone(a);
  }

  // ------------------------------------------------------------------ tasks & calendar
  async listTasks(params?: { status?: T.TaskStatus | "" }) { await wait(); return clone(this.s.tasks.filter((t) => !params?.status || t.status === params.status)); }
  private createTaskInternal(input: T.TaskInput): T.Task {
    const t: T.Task = { ...clone(input), id: this.id(), status: input.status ?? "open", history: [{ at: nowIso(), action: "Created" }], completed_at: null, created_at: nowIso() };
    this.s.tasks.unshift(t); return t;
  }
  async createTask(input: T.TaskInput) {
    await wait();
    if (!input.title.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { title: "Title is required." });
    const t = this.createTaskInternal(input); this.save(); return clone(t);
  }
  private task(id: T.ID) { return this.s.tasks.find((t) => t.id === id) ?? this.notFound("Task"); }
  async updateTask(id: T.ID, input: Partial<T.TaskInput>) {
    await wait(); const t = this.task(id); Object.assign(t, input); t.history.unshift({ at: nowIso(), action: "Edited" }); this.save(); return clone(t);
  }
  async completeTask(id: T.ID) {
    await wait(); const t = this.task(id);
    t.status = "done"; t.completed_at = nowIso(); t.history.unshift({ at: nowIso(), action: "Completed" });
    if (t.recurrence !== "none" && t.due_at) {
      const d = new TZDate(t.due_at, this.s.profile.timezone);
      if (t.recurrence === "daily") d.setDate(d.getDate() + t.recurrence_interval);
      if (t.recurrence === "weekly") d.setDate(d.getDate() + 7 * t.recurrence_interval);
      if (t.recurrence === "monthly") d.setMonth(d.getMonth() + t.recurrence_interval);
      const shift = d.getTime() - Date.parse(t.due_at);
      const next = this.createTaskInternal({ title: t.title, description: t.description, priority: t.priority, due_at: new Date(d.getTime()).toISOString(), recurrence: t.recurrence, recurrence_interval: t.recurrence_interval, remind_at: t.remind_at ? iso(Date.parse(t.remind_at) + shift) : null, reminder_channel: t.reminder_channel });
      next.history = [{ at: nowIso(), action: "Next occurrence created" }];
    }
    this.save(); return clone(t);
  }
  async deleteTask(id: T.ID) { await wait(); this.s.tasks = this.s.tasks.filter((t) => t.id !== id); this.save(); }
  async listEvents(range: { start: T.ISODate; end: T.ISODate }) {
    await wait();
    return clone(this.s.events.filter((e) => e.end_at >= range.start && e.start_at <= range.end));
  }
  private validateMeeting(input: T.MeetingInput) {
    const errs: Record<string, string> = {};
    if (!input.title.trim()) errs.title = "Title is required.";
    if (Date.parse(input.end_at) <= Date.parse(input.start_at)) errs.end_at = "End must be after start.";
    if (Object.keys(errs).length) throw new ApiError("Please check the highlighted fields.", 422, "validation", errs);
  }
  private meetingApproval(e: T.CalendarEvent): T.Approval {
    return {
      id: this.id(), kind: "meeting_invite", status: "pending", title: e.title,
      action: `Create the event on Google Calendar and send invitations to ${e.attendees.length} attendee(s).`,
      sender: null, recipients: e.attendees.map((x) => x.email),
      items: [{ id: this.id(), label: "Meeting", recipient: e.attendees.map((x) => x.email).join(", "), recipient_name: null, company: null, subject: e.title, body: `${e.description}\nLocation: ${e.location || "—"}`, schedule: `${e.start_at} → ${e.end_at} (${e.timezone})`, scheduled_at: e.start_at, editable: false, warnings: [] }],
      schedule_summary: `Invitations are only sent after approval. Times shown in ${e.timezone}.`, is_batch: false, content_hash: `demo-${Date.now()}`,
      related: [{ label: "Calendar", href: "/tasks?view=calendar" }], invalid_reason: null, created_at: nowIso(), decided_at: null,
    };
  }
  async createMeeting(input: T.MeetingInput) {
    await wait(); this.validateMeeting(input);
    const e: T.CalendarEvent = { id: this.id(), title: input.title, description: input.description, location: input.location, start_at: input.start_at, end_at: input.end_at, timezone: input.timezone, attendees: input.attendees.map((a) => ({ ...a, response: "needs_action" })), status: "draft", provider: "local", invites_sent: false, approval_id: null, error: null };
    if (input.send_invites && input.attendees.length) { const ap = this.meetingApproval(e); this.s.approvals.unshift(ap); e.approval_id = ap.id; e.status = "pending_approval"; e.provider = "google"; }
    else e.status = "confirmed";
    this.s.events.push(e); this.save(); return clone(e);
  }
  async updateMeeting(id: T.ID, input: T.MeetingInput) {
    await wait(); this.validateMeeting(input);
    const e = this.s.events.find((x) => x.id === id) ?? this.notFound("Event");
    if (e.approval_id) { const old = this.s.approvals.find((a) => a.id === e.approval_id); if (old?.status === "pending") { old.status = "invalidated"; old.invalid_reason = "Meeting details changed — renewed approval required."; } }
    Object.assign(e, { title: input.title, description: input.description, location: input.location, start_at: input.start_at, end_at: input.end_at, timezone: input.timezone, attendees: input.attendees.map((a) => ({ ...a, response: "needs_action" as const })), approval_id: null, error: null });
    if (input.send_invites && input.attendees.length) { const ap = this.meetingApproval(e); this.s.approvals.unshift(ap); e.approval_id = ap.id; e.status = "pending_approval"; e.provider = "google"; }
    else e.status = "confirmed";
    this.save(); return clone(e);
  }
  async cancelMeeting(id: T.ID) {
    await wait(); const e = this.s.events.find((x) => x.id === id) ?? this.notFound("Event");
    e.status = "cancelled";
    if (e.approval_id) { const a = this.s.approvals.find((x) => x.id === e.approval_id); if (a?.status === "pending") { a.status = "invalidated"; a.invalid_reason = "Meeting cancelled."; } }
    this.save(); return clone(e);
  }

  // ------------------------------------------------------------------ blog
  private post(id: T.ID) { return this.s.posts.find((p) => p.id === id) ?? this.notFound("Blog post"); }
  private newPost(topic: string, keywords: string[], title = ""): T.BlogPost {
    const p: T.BlogPost = { id: this.id(), topic, keywords, title, outline: "", body: "", seo_title: "", meta_description: "", social_captions: [], status: "draft", cms: "wordpress", cms_draft: { uploaded: false, cms_post_id: null, uploaded_at: null, edit_url: null }, scheduled_at: null, published_url: null, published_at: null, approval_id: null, error: null, updated_at: nowIso() };
    this.s.posts.unshift(p); return p;
  }
  async listBlogPosts() { await wait(); this.tick(); return clone(this.s.posts); }
  async getBlogPost(id: T.ID) { await wait(100); this.tick(); return clone(this.post(id)); }
  async createBlogPost(input: { topic: string; keywords: string[]; title?: string }) {
    await wait();
    if (!input.topic.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { topic: "Topic is required." });
    const p = this.newPost(input.topic.trim(), input.keywords, input.title); this.save(); return clone(p);
  }
  async updateBlogPost(id: T.ID, update: T.BlogPostUpdate) {
    await wait(); const p = this.post(id);
    if (p.status === "published") throw new ApiError("Published posts cannot be edited here. Edit them in your CMS.", 409);
    Object.assign(p, update); p.updated_at = nowIso();
    if (p.status === "pending_approval" || p.status === "scheduled") {
      const a = this.s.approvals.find((x) => x.id === p.approval_id);
      if (a && a.status === "pending") { a.status = "invalidated"; a.invalid_reason = "The post was edited after the approval request — request publishing again."; }
      p.status = "draft"; p.approval_id = null; p.scheduled_at = null;
    }
    this.save(); return clone(p);
  }
  async deleteBlogPost(id: T.ID) { await wait(); this.s.posts = this.s.posts.filter((p) => p.id !== id); this.save(); }
  async generateBlogIdeas(input: { topic: string; keywords: string[]; model: T.ModelPreference }) {
    await wait();
    if (!input.topic.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { topic: "Topic is required." });
    return this.startRun("blog_ideas", `Blog ideas: ${input.topic}`, [{ label: "Research angles", ms: 1800 }, { label: "Generate ideas", ms: 2500 }], "blog_ideas", { topic: input.topic }, input.model);
  }
  async getBlogIdeas(runId: T.ID) { await wait(80); this.tick(); return clone(this.s.blogIdeas[String(runId)] ?? []); }
  async generateBlogPart(id: T.ID, part: T.BlogGeneratePart, model: T.ModelPreference) {
    await wait(); const p = this.post(id);
    if (p.status === "published") throw new ApiError("Published posts cannot be regenerated.", 409);
    const label = { outline: "outline", article: "article", seo: "SEO title & meta description", captions: "social captions" }[part];
    return this.startRun("blog_generate", `Write ${label}: ${p.title || p.topic}`, [{ label: "Load approved business facts", ms: 1200 }, { label: `Write ${label}`, ms: part === "article" ? 5000 : 2500 }], "blog_part", { post_id: id, part }, model);
  }
  async uploadBlogDraftToCms(id: T.ID): Promise<T.BlogPost> {
    await wait(600);
    void this.post(id);
    throw new ApiError("Demo Mode cannot upload to a real CMS. Connect WordPress through a backend to upload drafts.", 400, "demo_unsupported");
  }
  async requestBlogPublish(id: T.ID, input: { publish_at: T.ISODate | null }) {
    await wait(); const p = this.post(id);
    const errs: Record<string, string> = {};
    if (!p.title.trim()) errs.title = "Add a title.";
    if (!p.body.trim()) errs.body = "The article is empty.";
    if (input.publish_at && Date.parse(input.publish_at) < Date.now()) errs.publish_at = "Choose a future time.";
    if (Object.keys(errs).length) throw new ApiError("The post isn't ready to publish yet.", 422, "validation", errs);
    const a: T.Approval = {
      id: this.id(), kind: "blog_publish", status: "pending", title: `Publish “${p.title}”`,
      action: `Publish to WordPress (${this.s.integrations.find((i) => i.kind === "wordpress")?.details.site_url ?? "not connected"}) ${input.publish_at ? "at the scheduled time" : "immediately after approval"}.`,
      sender: null, recipients: [],
      items: [{ id: this.id(), label: "Blog post", recipient: null, recipient_name: null, company: null, subject: p.title, body: `SEO title: ${p.seo_title || "—"}\nMeta description: ${p.meta_description || "—"}\n\n${p.body.slice(0, 1200)}${p.body.length > 1200 ? "\n…" : ""}`, schedule: input.publish_at ? "Scheduled" : "Immediately after approval", scheduled_at: input.publish_at, editable: false, warnings: p.cms_draft.uploaded ? [] : ["The draft has not been uploaded to the CMS yet."] }],
      schedule_summary: input.publish_at ? "Published at the scheduled time after approval." : "Published immediately after approval.",
      is_batch: false, content_hash: `demo-${Date.now()}`, related: [{ label: "Open in Blog Studio", href: `/blog?id=${p.id}` }], invalid_reason: null, created_at: nowIso(), decided_at: null,
    };
    this.s.approvals.unshift(a);
    p.status = "pending_approval"; p.approval_id = a.id; p.scheduled_at = input.publish_at; p.error = null; p.updated_at = nowIso();
    this.save(); return clone(a);
  }

  // ------------------------------------------------------------------ knowledge
  async getKnowledge() {
    await wait();
    const cats: [T.KnowledgeCategory, string][] = [
      ["factory_profile", "Factory profile is missing."], ["product", "No products are listed."], ["pricing", "No approved prices — the assistant will not quote prices."],
      ["moq", "MOQ is missing."], ["production_capacity", "Production capacity is missing."], ["delivery_time", "Delivery times are missing."],
      ["payment_terms", "Payment terms are missing."], ["certification", "No certifications listed — the assistant will not claim any."], ["sales_statement", "No approved sales statements."],
    ];
    const k = clone(this.s.knowledge);
    k.missing = cats.filter(([c]) => !k.items.some((i) => i.category === c && i.approved)).map(([category, message]) => ({ category, message }));
    for (const i of k.items) {
      const empty = Object.entries(i.fields).filter(([, v]) => !v.trim()).map(([f]) => f);
      if (empty.length) k.missing.push({ category: i.category, message: `“${i.title}”: ${empty.join(", ").replace(/_/g, " ")} not filled in.` });
      if (!i.approved) k.missing.push({ category: i.category, message: `“${i.title}” is not approved yet, so it is not used.` });
    }
    if (!k.items.some((i) => i.category === "pricing" && /hoodie|sweatshirt/i.test(i.title))) k.missing.push({ category: "pricing", message: "No approved price for sweatshirts / hoodies." });
    return k;
  }
  async createKnowledgeItem(input: T.KnowledgeItemInput) {
    await wait();
    if (!input.title.trim()) throw new ApiError("Please check the highlighted fields.", 422, "validation", { title: "Title is required." });
    const i: T.KnowledgeItem = { ...clone(input), id: this.id(), updated_at: nowIso() };
    this.s.knowledge.items.push(i); this.save(); return clone(i);
  }
  async updateKnowledgeItem(id: T.ID, input: T.KnowledgeItemInput) {
    await wait(); const i = this.s.knowledge.items.find((x) => x.id === id) ?? this.notFound("Knowledge item");
    Object.assign(i, clone(input), { updated_at: nowIso() }); this.save(); return clone(i);
  }
  async deleteKnowledgeItem(id: T.ID) { await wait(); this.s.knowledge.items = this.s.knowledge.items.filter((i) => i.id !== id); this.save(); }
  async uploadKnowledgeDocument(file: File) {
    await wait(700);
    const ok = /\.(pdf|txt|md)$/i.test(file.name);
    if (file.size > 20 * 1024 * 1024) throw new ApiError("Documents are limited to 20 MB.", 413);
    const d: T.KnowledgeDocument = { id: this.id(), filename: file.name, size: file.size, status: ok ? "ready" : "failed", extracted_chars: ok ? Math.min(file.size, 40_000) : 0, approved: false, error: ok ? null : "Unsupported file type. Upload a PDF, TXT or Markdown file.", uploaded_at: nowIso() };
    this.s.knowledge.documents.unshift(d); this.save(); return clone(d);
  }
  async setDocumentApproved(id: T.ID, approved: boolean) {
    await wait(); const d = this.s.knowledge.documents.find((x) => x.id === id) ?? this.notFound("Document");
    if (approved && d.status !== "ready") throw new ApiError("Only processed documents can be approved.", 409);
    d.approved = approved; this.save(); return clone(d);
  }
  async deleteKnowledgeDocument(id: T.ID) { await wait(); this.s.knowledge.documents = this.s.knowledge.documents.filter((d) => d.id !== id); this.save(); }
  async answerOpenQuestion(id: T.ID, answer: string) {
    await wait(); const q = this.s.knowledge.open_questions.find((x) => x.id === id) ?? this.notFound("Question");
    if (!answer.trim()) throw new ApiError("Answer is empty.", 422);
    this.s.knowledge.items.push({ id: this.id(), category: "sales_statement", title: q.question, fields: { statement: answer.trim() }, approved: true, auto_reply_allowed: false, updated_at: nowIso() });
    this.s.knowledge.open_questions = this.s.knowledge.open_questions.filter((x) => x.id !== id); this.save();
  }

  // ------------------------------------------------------------------ automations
  async listAutomations() { await wait(); this.tick(); return clone(this.s.automations); }
  async setAutomationEnabled(id: T.ID, enabled: boolean) {
    await wait(); const a = this.s.automations.find((x) => x.id === id) ?? this.notFound("Automation");
    a.enabled = enabled; a.status = enabled ? "active" : "paused"; a.pause_reason = enabled ? "" : "Paused by owner";
    a.next_run_at = enabled ? iso(Date.now() + 10 * 60_000) : null; this.save(); return clone(a);
  }
  async runAutomationNow(id: T.ID) {
    await wait(); const a = this.s.automations.find((x) => x.id === id) ?? this.notFound("Automation");
    if (!a.enabled) throw new ApiError("Enable the automation before running it.", 409);
    if (a.outgoing && this.s.emergency.paused) throw new ApiError("Outgoing actions are paused. Resume them before running this automation.", 409, "emergency_pause");
    return this.startRun(a.type === "buyer_research" ? "buyer_research" : a.type === "reply_analysis" ? "reply_analysis" : a.type === "daily_summary" ? "daily_summary" : "follow_up", `Run now: ${a.name}`, [{ label: "Check conditions", ms: 1200 }, { label: "Process", ms: 2500 }], "automation", { automation_id: a.id });
  }

  // ------------------------------------------------------------------ usage & costs
  private computeUsage(): T.UsageSummary {
    const tz = this.s.profile.timezone;
    const day = tzDayStart(tz), month = tzMonthStart(tz);
    const price = (model_id: string) => this.s.pricing.find((p) => p.model_id === model_id);
    let unpriced = 0;
    const costOf = (u: DemoState["usage"][number]) => {
      const p = price(u.model_id);
      if (p?.input_price_per_mtok == null || p.output_price_per_mtok == null) { return null; }
      const cachedPrice = p.cached_input_price_per_mtok ?? p.input_price_per_mtok;
      return ((u.input - u.cached) * p.input_price_per_mtok + u.cached * cachedPrice + u.output * p.output_price_per_mtok) / 1_000_000;
    };
    const agg = (rows: DemoState["usage"]): T.TokenUsage => {
      let cost: number | null = 0; let anyPriced = false;
      for (const r of rows) { const c = costOf(r); if (c == null) continue; anyPriced = true; cost = (cost ?? 0) + c; }
      return { input_tokens: rows.reduce((a, r) => a + r.input, 0), output_tokens: rows.reduce((a, r) => a + r.output, 0), cached_tokens: rows.reduce((a, r) => a + r.cached, 0), estimated_cost: rows.length && !anyPriced ? null : cost, runs: rows.length };
    };
    const monthRows = this.s.usage.filter((u) => u.at >= month);
    unpriced += monthRows.filter((u) => costOf(u) == null).length;
    const providers = (["openai", "kimi"] as T.ProviderKey[]).map((key) => ({
      key, label: key === "openai" ? "OpenAI (GPT)" : "Kimi (Moonshot AI)", configured: this.s.providers.find((p) => p.key === key)?.configured ?? false,
      today: agg(monthRows.filter((u) => u.provider === key && u.at >= day)), month: agg(monthRows.filter((u) => u.provider === key)),
    }));
    const svcLabels = { search: ["Web search", "searches"], extraction: ["Page extraction", "pages"], verification: ["Email verification", "checks"], browser: ["Browser automation", "sessions"] } as const;
    const services = (Object.keys(svcLabels) as (keyof typeof svcLabels)[]).map((key) => {
      const rows = this.s.serviceUsage.filter((s) => s.key === key && s.at >= month);
      const unit = this.s.unitPrices[key];
      const today_units = rows.filter((r) => r.at >= day).reduce((a, r) => a + r.units, 0);
      const month_units = rows.reduce((a, r) => a + r.units, 0);
      if (unit == null) unpriced += rows.length;
      return { key, label: svcLabels[key][0], configured: key === "search" || key === "extraction", unit_label: svcLabels[key][1], unit_price: unit, today_units, month_units, today_cost: unit == null ? null : today_units * unit, month_cost: unit == null ? null : month_units * unit };
    });
    const daily_spent = providers.reduce((a, p) => a + (p.today.estimated_cost ?? 0), 0) + services.reduce((a, s) => a + (s.today_cost ?? 0), 0);
    const monthly_spent = providers.reduce((a, p) => a + (p.month.estimated_cost ?? 0), 0) + services.reduce((a, s) => a + (s.month_cost ?? 0), 0);
    const b = this.s.budget;
    const alerts: T.UsageSummary["alerts"] = [];
    if (b.daily != null && daily_spent >= b.daily) alerts.push({ level: "critical", message: "Daily budget reached. New AI workflows are blocked until tomorrow (Asia/Dhaka) or until you raise the budget." });
    else if (b.daily != null && daily_spent >= (b.daily * b.alert_at_pct) / 100) alerts.push({ level: "warning", message: `Estimated spending today has passed ${b.alert_at_pct}% of the daily budget.` });
    if (b.monthly != null && monthly_spent >= (b.monthly * b.alert_at_pct) / 100) alerts.push({ level: monthly_spent >= b.monthly ? "critical" : "warning", message: `Estimated spending this month is at ${Math.round((monthly_spent / b.monthly) * 100)}% of the monthly budget.` });
    if (unpriced) alerts.push({ level: "info", message: `${unpriced} usage record(s) this month have no configured price and are not included in the estimates.` });
    const wfTypes = Array.from(new Set(monthRows.map((u) => u.workflow)));
    const by_workflow = wfTypes.map((w) => { const rows = monthRows.filter((u) => u.workflow === w); const a = agg(rows); const svc = services.length ? this.s.serviceUsage.filter((s) => s.workflow === w && s.at >= month).reduce((acc, s) => acc + (this.s.unitPrices[s.key] ?? 0) * s.units, 0) : 0; return { workflow_type: w, label: WORKFLOW_LABEL[w], runs: rows.length, tokens: a.input_tokens + a.output_tokens, estimated_cost: a.estimated_cost == null ? null : a.estimated_cost + svc }; }).sort((x, y) => (y.estimated_cost ?? 0) - (x.estimated_cost ?? 0));
    return { currency: b.currency, timezone: tz, providers, services, budget: { daily_limit: b.daily, monthly_limit: b.monthly, daily_spent, monthly_spent, inflight_allowance_pct: b.inflight_allowance_pct }, alerts, by_workflow, unpriced_records: unpriced };
  }
  async getUsage() { await wait(); this.tick(); return this.computeUsage(); }
  async listModelPricing() { await wait(); return clone(this.s.pricing); }
  private validatePricing(input: T.ModelPricingInput, exceptId?: T.ID) {
    const errs: Record<string, string> = {};
    if (!input.model_id.trim()) errs.model_id = "Model ID is required.";
    if (this.s.pricing.some((p) => p.id !== exceptId && p.provider === input.provider && p.model_id === input.model_id.trim())) errs.model_id = "This model is already configured.";
    for (const k of ["input_price_per_mtok", "output_price_per_mtok", "cached_input_price_per_mtok"] as const) if (input[k] != null && input[k]! < 0) errs[k] = "Must be zero or more.";
    if (Object.keys(errs).length) throw new ApiError("Please check the highlighted fields.", 422, "validation", errs);
  }
  async createModelPricing(input: T.ModelPricingInput) {
    await wait(); this.validatePricing(input);
    const p: T.ModelPricing = { ...clone(input), model_id: input.model_id.trim(), id: this.id(), pricing_updated_at: input.input_price_per_mtok != null ? nowIso() : null };
    this.s.pricing.push(p); this.save(); return clone(p);
  }
  async updateModelPricing(id: T.ID, input: T.ModelPricingInput) {
    await wait(); this.validatePricing(input, id);
    const p = this.s.pricing.find((x) => x.id === id) ?? this.notFound("Model");
    const priceChanged = p.input_price_per_mtok !== input.input_price_per_mtok || p.output_price_per_mtok !== input.output_price_per_mtok || p.cached_input_price_per_mtok !== input.cached_input_price_per_mtok;
    Object.assign(p, clone(input)); if (priceChanged) p.pricing_updated_at = nowIso();
    this.save(); return clone(p);
  }
  async deleteModelPricing(id: T.ID) {
    await wait();
    if (this.s.routing.workflows.some((w) => w.model_id === id || w.fallback_model_id === id)) throw new ApiError("This model is used in model routing. Change the routing first.", 409);
    this.s.pricing = this.s.pricing.filter((p) => p.id !== id); this.save();
  }
  async getUnitPrices() { await wait(); return clone(this.s.unitPrices); }
  async updateUnitPrices(input: T.UnitPrices) { await wait(); this.s.unitPrices = { ...clone(input), updated_at: nowIso() }; this.save(); return clone(this.s.unitPrices); }
  async getBudget() { await wait(); return clone(this.s.budget); }
  async getBudgetStatus() {
    await wait();
    return {
      currency: this.s.budget.currency,
      inflight_allowance_pct: this.s.budget.inflight_allowance_pct,
      daily: { limit: this.s.budget.daily, spent: 0 },
      monthly: { limit: this.s.budget.monthly, spent: 0 },
      unpriced_records_this_month: 0,
    };
  }
  async updateBudget(input: T.BudgetSettings) {
    await wait();
    if (input.daily != null && input.monthly != null && input.daily > input.monthly) throw new ApiError("Please check the highlighted fields.", 422, "validation", { daily: "Daily budget cannot exceed the monthly budget." });
    this.s.budget = clone(input); this.save(); return clone(this.s.budget);
  }

  // ------------------------------------------------------------------ settings
  async getProfile() { await wait(); return clone(this.s.profile); }
  async updateProfile(input: T.OwnerProfile) {
    await wait();
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { throw new ApiError("Please check the highlighted fields.", 422, "validation", { timezone: "Unknown timezone." }); }
    this.s.profile = clone(input); this.save(); return clone(this.s.profile);
  }
  async getProviderStatus() { await wait(); return clone(this.s.providers).map((p) => ({ ...p, configured: false, last_check_ok: null, last_check_message: "Demo Mode — no provider keys are used in the browser." })); }
  async testProvider(key: T.ProviderKey) {
    await wait(600);
    const p = this.s.providers.find((x) => x.key === key) ?? this.notFound("Provider");
    return { ...clone(p), configured: false, last_checked_at: nowIso(), last_check_ok: false, last_check_message: "Demo Mode: no backend, so the provider could not be tested." };
  }
  async getModelRouting() { await wait(); return clone(this.s.routing); }
  async updateModelRouting(input: T.ModelRouting) {
    await wait();
    if (input.max_retries < 0 || input.max_retries > 5) throw new ApiError("Please check the highlighted fields.", 422, "validation", { max_retries: "Use 0–5 retries." });
    this.s.routing = clone(input); this.save(); return clone(this.s.routing);
  }
  async getResearchProvider(): Promise<T.ResearchProviderStatus> { await wait(); return { search_backend: "firecrawl", extract_backend: "firecrawl", configured: false, paid: true, note: "Demo Mode — the research provider is configured on the server (Hermes web backends)." }; }
  async listIntegrations() { await wait(); return clone(this.s.integrations); }
  async startCalendarOAuth(): Promise<{ authorize_url: string }> { await wait(); throw new ApiError("Demo Mode cannot connect Google Calendar. Use a backend with Google OAuth configured.", 400, "demo_unsupported"); }
  async connectWordPress(): Promise<T.IntegrationStatus> { await wait(); throw new ApiError("Demo Mode cannot store CMS credentials. WordPress application passwords are only accepted by the backend.", 400, "demo_unsupported"); }
  async disconnectIntegration(kind: T.IntegrationStatus["kind"]) {
    await wait(); const i = this.s.integrations.find((x) => x.kind === kind) ?? this.notFound("Integration");
    i.status = "disconnected"; i.credential_set = false; i.account = null; i.last_error = null; this.save(); return clone(i);
  }
  async testIntegration(kind: T.IntegrationStatus["kind"]) {
    await wait(600); const i = this.s.integrations.find((x) => x.kind === kind) ?? this.notFound("Integration");
    return i.status === "connected" ? { ok: true, message: "Demo check only — no real connection was made." } : { ok: false, message: i.last_error ?? "Not connected." };
  }
  async listSuppressions(q?: string) {
    await wait(); const s = q?.trim().toLowerCase();
    return clone(this.s.suppressions.filter((x) => !s || (x.email ?? x.domain ?? "").includes(s) || x.detail.toLowerCase().includes(s)));
  }
  async addSuppression(input: { value: string; reason: T.SuppressionReason; detail: string }) {
    await wait(); const v = input.value.trim().toLowerCase();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); const isDomain = /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v);
    if (!isEmail && !isDomain) throw new ApiError("Please check the highlighted fields.", 422, "validation", { value: "Enter an email address or a domain like example.com." });
    if (this.s.suppressions.some((x) => x.email === v || x.domain === v)) throw new ApiError("Please check the highlighted fields.", 422, "validation", { value: "Already suppressed." });
    const s: T.Suppression = { id: this.id(), email: isEmail ? v : null, domain: isEmail ? null : v, reason: input.reason, detail: input.detail, created_at: nowIso() };
    this.s.suppressions.unshift(s);
    for (const l of this.s.leads) {
      const host = new URL(l.website).hostname.replace(/^www\./, "");
      if ((isEmail && l.contact_email === v) || (!isEmail && (host === v || l.contact_email?.endsWith(`@${v}`)))) {
        l.suppressed = true; l.suppression = { suppressed: true, reason: input.reason, since: nowIso(), scope: isEmail ? "email" : "domain" };
        if (l.sequence?.status === "active") { l.sequence.status = "stopped"; l.sequence.stop_reason = "Suppressed"; }
        l.next_follow_up_at = null;
      }
    }
    this.save(); return clone(s);
  }
  async removeSuppression(id: T.ID) {
    await wait(); const s = this.s.suppressions.find((x) => x.id === id) ?? this.notFound("Suppression");
    this.s.suppressions = this.s.suppressions.filter((x) => x.id !== id);
    for (const l of this.s.leads) if (l.suppressed && (l.contact_email === s.email || (s.domain && new URL(l.website).hostname.endsWith(s.domain)))) { l.suppressed = false; l.suppression = { suppressed: false, reason: null, since: null, scope: null }; }
    this.save();
  }
  async getNotificationSettings() { await wait(); return clone(this.s.notificationSettings); }
  async updateNotificationSettings(input: T.NotificationSettings) { await wait(); this.s.notificationSettings = clone(input); this.save(); return clone(input); }
  async getAutoReply() { await wait(); return clone(this.s.autoReply); }
  async updateAutoReply(input: T.AutoReplySettings) { await wait(); this.s.autoReply = clone(input); this.save(); return clone(input); }
}

const T_TERMINAL: T.WorkflowStatus[] = ["completed", "failed", "cancelled"];
