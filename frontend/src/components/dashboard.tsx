"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Archive, Bot, BriefcaseBusiness, CalendarDays, CheckCircle2, CircleDollarSign,
  Database, Globe2, Inbox, LayoutDashboard, ListChecks, LoaderCircle, LogOut, Mail, Menu, Moon, Newspaper,
  Plus, Search, Send, Settings, Sparkles, Sun, Users, X, Zap,
} from "lucide-react";
import { errorMessage } from "@/lib/api/client";
import { useApi, useApiContext } from "@/lib/api/provider";
import type { ModelPricingInput, WorkflowRun, WorkflowStatus, WorkflowType } from "@/lib/api/types";

type PageKey =
  | "overview" | "assistant" | "research" | "leads" | "inbox" | "approvals"
  | "tasks" | "blog" | "knowledge" | "automations" | "usage" | "settings";
type Icon = typeof Activity;

const nav: { key: PageKey; label: string; icon: Icon }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "assistant", label: "AI Assistant", icon: Sparkles },
  { key: "research", label: "Buyer Research", icon: Globe2 },
  { key: "leads", label: "Leads / CRM", icon: Users },
  { key: "inbox", label: "Email Inbox", icon: Inbox },
  { key: "approvals", label: "Approvals", icon: ListChecks },
  { key: "tasks", label: "Tasks & Calendar", icon: CalendarDays },
  { key: "blog", label: "Blog Studio", icon: Newspaper },
  { key: "knowledge", label: "Business Knowledge", icon: Database },
  { key: "automations", label: "Automations", icon: Zap },
  { key: "usage", label: "Usage & Costs", icon: CircleDollarSign },
  { key: "settings", label: "Settings", icon: Settings },
];

const ACTIVE: WorkflowStatus[] = ["queued", "running", "paused", "waiting_approval"];

function inferWorkflow(text: string): WorkflowType {
  const t = text.toLowerCase();
  if (/\bbuyers?|importer|wholesaler|companies\b/.test(t)) return "buyer_research";
  if (/\boutreach|cold email\b/.test(t)) return "outreach_drafts";
  if (/\breply|inbox|inbound\b/.test(t)) return "reply_summary";
  if (/\bfollow[- ]?up\b/.test(t)) return "follow_up";
  if (/\bblog|article|seo\b/.test(t)) return "blog_ideas";
  if (/\btask|reminder|calendar\b/.test(t)) return "task_create";
  if (/\bdaily summary\b/.test(t)) return "daily_summary";
  return "general_research";
}

function Badge({ children, tone = "" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}><span className="dot" />{children}</span>;
}
function Button({
  children, onClick, kind = "", className = "", type = "button", disabled = false, style,
}: {
  children: React.ReactNode; onClick?: () => void; kind?: string; className?: string; type?: "button" | "submit"; disabled?: boolean; style?: CSSProperties;
}) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn ${kind} ${className}`} style={style}>{children}</button>;
}
function Header({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}
function Status({ value }: { value: string }) {
  const v = value.toLowerCase();
  const tone = /interested|connected|completed|published|active|approved/.test(v) ? "good"
    : /failed|error|lost|disconnected/.test(v) ? "danger"
    : /pending|queued|running|paused|information/.test(v) ? "warn" : "brand";
  return <Badge tone={tone}>{value.replaceAll("_", " ")}</Badge>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><Archive size={28} /><strong style={{ display: "block", color: "var(--text)", marginBottom: 5 }}>{title}</strong><span>{detail}</span></div>;
}
function Unavailable({ name }: { name: string }) {
  return <Empty title={`${name} is empty`} detail="This module has no live records yet. Hermes workflows (Assistant, Research, Usage, Settings) are connected to the backend." />;
}

function useRuns() {
  const api = useApi();
  return useQuery({
    queryKey: ["workflow-runs"],
    queryFn: () => api.listWorkflowRuns({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.includes(r.status)) ? 2500 : 12_000),
  });
}

export function Dashboard() {
  const api = useApi();
  const { session, logout } = useApiContext();
  const [page, setPage] = useState<PageKey>("overview");
  const [dark, setDark] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [toast, setToast] = useState("");
  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2800); };
  const go = (p: PageKey) => { setPage(p); setMobile(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const Active = nav.find((n) => n.key === page)!;
  const owner = session?.owner;
  const initials = (owner?.name || "O").split(" ").map((p) => p[0]).join("").slice(0, 3).toUpperCase();

  const statusQ = useQuery({ queryKey: ["system-status"], queryFn: () => api.getSystemStatus(), refetchInterval: 15_000 });
  const hermes = statusQ.data?.hermes;
  const liveOk = hermes?.research === "connected" && hermes?.writer === "connected";

  return (
    <div data-theme={dark ? "dark" : "light"}>
      <div className="shell">
        <aside className={`sidebar ${mobile ? "open" : ""}`}>
          <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>Nexa Sales AI</strong><small>Live workspace</small></div></div>
          <nav className="nav" aria-label="Main navigation">{nav.map((n) => <button key={n.key} className={page === n.key ? "active" : ""} onClick={() => go(n.key)}><n.icon size={18} />{n.label}</button>)}</nav>
          <div className="sidebar-foot">
            <div className="owner"><div className="avatar">{initials}</div><div><strong style={{ fontSize: 13 }}>{owner?.name || "Owner"}</strong><small>{owner?.email}</small></div></div>
            <Button className="sm" style={{ marginTop: 12, width: "100%" }} onClick={() => void logout()}><LogOut size={14} />Sign out</Button>
          </div>
        </aside>
        <main className="main">
          <div className={`live-bar ${liveOk ? "" : "warn"}`}>
            <span>
              <strong>Live</strong>
              {hermes ? ` · Hermes research ${hermes.research} · writer ${hermes.writer}` : " · checking Hermes…"}
              {statusQ.data?.mode === "demo" ? " · backend is labelled demo" : ""}
            </span>
            <span>{statusQ.data?.providers.gemini.configured ? "Gemini free tier ready" : "Gemini key missing"} · {statusQ.data?.providers.openai.configured ? "OpenAI configured" : "OpenAI off"} · {statusQ.data?.providers.kimi.configured ? "Kimi configured" : "Kimi off"}</span>
          </div>
          <header className="topbar">
            <div className="row">
              <button className="btn icon-btn mobile-toggle" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation"><Menu size={18} /></button>
              <h1>{Active.label}</h1>
            </div>
            <div className="top-actions">
              <button className="btn icon-btn" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            </div>
          </header>
          <div className="content">
            {page === "overview" && <Overview go={go} />}
            {page === "assistant" && <Assistant notify={notify} />}
            {page === "research" && <Research notify={notify} />}
            {page === "leads" && <Unavailable name="Leads / CRM" />}
            {page === "inbox" && <Unavailable name="Inbox" />}
            {page === "approvals" && <Unavailable name="Approvals" />}
            {page === "tasks" && <Unavailable name="Tasks" />}
            {page === "blog" && <Unavailable name="Blog Studio" />}
            {page === "knowledge" && <Unavailable name="Business Knowledge" />}
            {page === "automations" && <Unavailable name="Automations" />}
            {page === "usage" && <Usage />}
            {page === "settings" && <SettingsPage notify={notify} />}
          </div>
        </main>
      </div>
      {mobile && <button onClick={() => setMobile(false)} aria-label="Close navigation" style={{ position: "fixed", inset: 0, border: 0, background: "rgba(0,0,0,.3)", zIndex: 25 }} />}
      {toast && <div className="toast"><CheckCircle2 size={15} style={{ display: "inline", marginRight: 8 }} />{toast}</div>}
    </div>
  );
}

function Overview({ go }: { go: (p: PageKey) => void }) {
  const { session } = useApiContext();
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const running = runs.filter((r) => ACTIVE.includes(r.status)).length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const first = session?.owner?.name?.split(" ")[0] || "there";
  return (
    <>
      <Header title={`Hello, ${first}`} description="Live workspace connected to Hermes. External send/publish still requires a dedicated approval API." action={<Button kind="primary" onClick={() => go("assistant")}><Sparkles size={15} />Ask Nexa</Button>} />
      <div className="quick-actions">
        <Button onClick={() => go("research")}><Globe2 size={15} />Find Buyers</Button>
        <Button onClick={() => go("assistant")}><Mail size={15} />Draft Outreach</Button>
        <Button onClick={() => go("settings")}><Settings size={15} />Models</Button>
      </div>
      <div className="grid grid-5">
        {([[String(runs.length), "Workflow runs", Activity], [String(running), "In progress", BriefcaseBusiness], [String(failed), "Failed", AlertTriangle, failed ? "warn" : ""], [String(runs.filter((r) => r.status === "completed").length), "Completed", CheckCircle2], [String(runs.filter((r) => r.type === "buyer_research").length), "Buyer research", Globe2]] as [string, string, Icon, string?][]).map(([n, l, I, t]) => (
          <div className="card metric" key={l}><div className="metric-icon"><I size={17} /></div><strong>{n}</strong><span>{l}</span>{t && <div style={{ marginTop: 8 }}><Badge tone={t}>Attention</Badge></div>}</div>
        ))}
      </div>
      <section className="card pad" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Recent workflows</h3><Button kind="ghost" className="sm" onClick={() => go("assistant")}>Open assistant</Button></div>
        {!runs.length && <Empty title="No workflows yet" detail="Start research or ask the assistant. Results are stored as suggestions until you approve an external action." />}
        <div className="list">{runs.slice(0, 8).map((r) => <RunRow key={r.id} run={r} />)}</div>
      </section>
    </>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  return (
    <div className="list-item">
      <div className="metric-icon" style={{ margin: 0, width: 31, height: 31 }}><Activity size={14} /></div>
      <div className="list-main">
        <strong>{run.title}</strong>
        <p>{run.progress_message || run.result_summary || run.error?.message || run.type.replaceAll("_", " ")}</p>
      </div>
      <Status value={run.status} />
    </div>
  );
}

function Assistant({ notify }: { notify: (s: string) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const runsQ = useRuns();
  const runs = runsQ.data ?? [];
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const current = runs.find((r) => r.id === selected) ?? runs[0];
  const start = useMutation({
    mutationFn: (input: string) => {
      const type = inferWorkflow(input);
      return api.startWorkflowRun({ type, title: input.slice(0, 80), input });
    },
    onSuccess: (run) => {
      setSelected(run.id);
      setText("");
      void qc.invalidateQueries({ queryKey: ["workflow-runs"] });
      notify("Workflow queued on Hermes");
    },
    onError: (err) => notify(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelWorkflowRun(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["workflow-runs"] }); notify("Cancel requested"); },
    onError: (err) => notify(errorMessage(err)),
  });
  const retry = useMutation({
    mutationFn: (id: number) => api.retryWorkflowRun(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["workflow-runs"] }); notify("Retry queued"); },
    onError: (err) => notify(errorMessage(err)),
  });

  return (
    <>
      <Header title="AI Assistant" description="Requests run on Hermes. Output is a suggestion — nothing is emailed or published from here." />
      <div className="card split">
        <aside className="split-aside">
          <p className="secondary" style={{ margin: "0 0 10px" }}>{runs.length} runs</p>
          {runs.map((r) => (
            <div key={r.id} className={`conversation ${current?.id === r.id ? "active" : ""}`} onClick={() => setSelected(r.id)}>
              <strong>{r.title}</strong>
              <p className="secondary">{r.type.replaceAll("_", " ")} · {r.status}</p>
            </div>
          ))}
          {!runs.length && <p className="muted">No runs yet.</p>}
        </aside>
        <div className="split-main">
          <div className="notice">Hermes executes the workflow. Review the result before any external action.</div>
          {current ? (
            <div className="card pad workflow" style={{ marginTop: 16 }}>
              <div className="card-head"><strong>{current.title}</strong><Status value={current.status} /></div>
              {current.progress != null && <div className="progress"><span style={{ width: `${current.progress}%` }} /></div>}
              <p className="muted" style={{ fontSize: 13 }}>{current.progress_message}</p>
              {current.steps.map((s, i) => <div className="step" key={i}>{s.label} · {s.status}</div>)}
              {current.result_summary && <div className="message">{current.result_summary}</div>}
              {current.error && <div className="notice danger">{current.error.message}{current.error.recovery ? ` ${current.error.recovery}` : ""}</div>}
              <div className="row">
                {current.can_cancel && <Button className="sm" onClick={() => cancel.mutate(current.id)}><X size={13} />Cancel</Button>}
                {current.can_retry && <Button className="sm" onClick={() => retry.mutate(current.id)}>Retry</Button>}
              </div>
            </div>
          ) : <Empty title="Ask Hermes" detail="Describe a research, draft, or summary task." />}
          <div className="composer">
            <div className="row" style={{ alignItems: "stretch" }}>
              <textarea className="textarea" style={{ minHeight: 66 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Research garment importers in Germany…" />
              <Button kind="primary" disabled={start.isPending || !text.trim()} onClick={() => start.mutate(text.trim())}>{start.isPending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Research({ notify }: { notify: (s: string) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const runsQ = useRuns();
  const jobs = (runsQ.data ?? []).filter((r) => r.type === "buyer_research" || r.type === "general_research");
  const [product, setProduct] = useState("");
  const [industry, setIndustry] = useState("");
  const [countries, setCountries] = useState("");
  const start = useMutation({
    mutationFn: () => {
      const input = `Product: ${product}\nIndustry: ${industry}\nTarget countries: ${countries}\nFind relevant business buyers from public sources. Do not invent email addresses.`;
      return api.startWorkflowRun({ type: "buyer_research", title: `${product} · ${countries}`, input });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["workflow-runs"] }); notify("Buyer research queued on Hermes"); },
    onError: (err) => notify(errorMessage(err)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); start.mutate(); };

  return (
    <>
      <Header title="Buyer Research" description="Hermes searches public sources. Emails appear only if they are found on a cited page." />
      <div className="grid grid-2">
        <form className="card pad" onSubmit={submit}>
          <div className="card-head"><h3>Research setup</h3><Badge tone="brand">Live Hermes</Badge></div>
          <div className="form-row">
            <div className="field"><label>Product</label><input required className="input" value={product} onChange={(e) => setProduct(e.target.value)} /></div>
            <div className="field"><label>Industry</label><input required className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} /></div>
            <div className="field"><label>Target countries</label><input required className="input" value={countries} onChange={(e) => setCountries(e.target.value)} /></div>
          </div>
          <div className="form-actions"><Button type="submit" kind="primary" disabled={start.isPending}><Search size={15} />Start research</Button></div>
        </form>
        <section className="card pad">
          <div className="card-head"><h3>Jobs</h3></div>
          {!jobs.length && <Empty title="No research jobs" detail="Submit the form to queue a Hermes run." />}
          <div className="list">{jobs.map((r) => <RunRow key={r.id} run={r} />)}</div>
        </section>
      </div>
      {jobs[0]?.result_summary && (
        <section className="card pad" style={{ marginTop: 16 }}>
          <div className="card-head"><h3>Latest result</h3><Status value={jobs[0].status} /></div>
          <div className="message" style={{ maxWidth: "100%" }}>{jobs[0].result_summary}</div>
        </section>
      )}
    </>
  );
}

function Usage() {
  const api = useApi();
  const budgetQ = useQuery({ queryKey: ["budget-status"], queryFn: () => api.getBudgetStatus() });
  const modelsQ = useQuery({ queryKey: ["models"], queryFn: () => api.listModelPricing() });
  const b = budgetQ.data;
  const dailyPct = b?.daily.limit ? Math.min(100, (b.daily.spent / b.daily.limit) * 100) : 0;
  return (
    <>
      <Header title="Usage & Costs" description="Application estimates from Hermes usage records. Not a provider invoice." />
      <div className="grid grid-3">
        <div className="card metric"><div className="metric-icon"><Bot size={17} /></div><strong>{b ? `${b.currency} ${b.daily.spent.toFixed(2)}` : "—"}</strong><span>Today (estimate)</span></div>
        <div className="card metric"><div className="metric-icon"><CircleDollarSign size={17} /></div><strong>{b ? `${b.currency} ${b.monthly.spent.toFixed(2)}` : "—"}</strong><span>This month (estimate)</span></div>
        <div className="card metric"><div className="metric-icon"><AlertTriangle size={17} /></div><strong>{b?.unpriced_records_this_month ?? 0}</strong><span>Unpriced records</span></div>
      </div>
      <section className="card pad" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Daily budget</h3><strong>{b?.daily.limit == null ? "No daily cap" : `${b.daily.spent.toFixed(2)} / ${b.daily.limit}`}</strong></div>
        <div className="progress"><span style={{ width: `${dailyPct}%` }} /></div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head pad" style={{ margin: 0 }}><h3>Configured models</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Provider</th><th>Model</th><th>Enabled</th><th>Input / 1M</th><th>Output / 1M</th></tr></thead>
            <tbody>
              {(modelsQ.data ?? []).map((m) => (
                <tr key={m.id}><td>{m.provider}</td><td className="primary-cell">{m.label || m.model_id}</td><td>{m.enabled ? "Yes" : "No"}</td><td>{m.input_price_per_mtok ?? "—"}</td><td>{m.output_price_per_mtok ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
          {!modelsQ.data?.length && <Empty title="No models" detail="Add a model in Settings before running Hermes workflows." />}
        </div>
      </section>
    </>
  );
}

function SettingsPage({ notify }: { notify: (s: string) => void }) {
  const api = useApi();
  const { session } = useApiContext();
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ["system-status"], queryFn: () => api.getSystemStatus() });
  const modelsQ = useQuery({ queryKey: ["models"], queryFn: () => api.listModelPricing() });
  const [provider, setProvider] = useState<"openai" | "kimi" | "gemini">("gemini");
  const [modelId, setModelId] = useState("gemini-3.5-flash-lite");
  const [label, setLabel] = useState("");
  const add = useMutation({
    mutationFn: () => api.createModelPricing({
      provider, model_id: modelId.trim(), label: label.trim() || modelId.trim(), enabled: true,
      input_price_per_mtok: null, output_price_per_mtok: null, cached_input_price_per_mtok: null,
      currency: "USD", pricing_updated_at: null, pricing_source: "",
    } satisfies ModelPricingInput),
    onSuccess: () => {
      setModelId(""); setLabel("");
      void qc.invalidateQueries({ queryKey: ["models"] });
      notify("Model saved");
    },
    onError: (err) => notify(errorMessage(err)),
  });

  const st = statusQ.data;
  return (
    <>
      <Header title="Settings" description="Owner session, Hermes health, and models used for live runs." />
      <section className="card pad">
        <div className="card-head"><h3>Owner</h3><Badge tone="good">Signed in</Badge></div>
        <p>{session?.owner?.name}</p>
        <p className="muted">{session?.owner?.email}</p>
      </section>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card pad">
          <div className="card-head"><h3>Hermes</h3><Status value={st?.hermes.research ?? "unknown"} /></div>
          <p className="muted" style={{ fontSize: 13 }}>Pin {st?.hermes.version_pin} · research {st?.hermes.research} · writer {st?.hermes.writer}</p>
        </section>
        <section className="card pad">
          <div className="card-head"><h3>Providers</h3></div>
          <p>Gemini: {st?.providers.gemini.configured ? "free-tier key present" : "add GEMINI_API_KEY from Google AI Studio"}</p>
          <p>OpenAI: {st?.providers.openai.configured ? "server key present" : "not configured"}</p>
          <p>Kimi: {st?.providers.kimi.configured ? "server key present" : "not configured"}</p>
        </section>
      </div>
      <section className="card pad" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Add model</h3></div>
        <div className="form-row">
          <div className="field"><label>Provider</label><select className="select" value={provider} onChange={(e) => { const next = e.target.value as "openai" | "kimi" | "gemini"; setProvider(next); if (next === "gemini" && !modelId.trim()) setModelId("gemini-3.5-flash-lite"); }}><option value="gemini">Gemini (free tier)</option><option value="openai">OpenAI</option><option value="kimi">Kimi</option></select></div>
          <div className="field"><label>Model ID</label><input className="input" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gemini-3.5-flash-lite" required /></div>
          <div className="field"><label>Label</label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GPT fast" /></div>
        </div>
        <Button kind="primary" className="" disabled={add.isPending || !modelId.trim()} onClick={() => add.mutate()} style={{ marginTop: 14 }}><Plus size={14} />Save model</Button>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Label</th><th>Provider</th><th>Model ID</th></tr></thead>
            <tbody>{(modelsQ.data ?? []).map((m) => <tr key={m.id}><td>{m.label}</td><td>{m.provider}</td><td>{m.model_id}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
