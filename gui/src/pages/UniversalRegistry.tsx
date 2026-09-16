// Phase 20.25 — Pao-hubPro × Agentic AI Universal Registry & Toolchain
// Glassmorphic Control Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface UniversalRegistryProps {
  apiBase?: string;
}

interface ToolItem {
  id: string;
  name: string;
  provider: string;
  type: string;
  description: string;
  status: string;
  capabilities: string[];
  authStatus: string;
  risk: { level: number; permissionClass: string; requiresApproval: boolean };
  cost: { model: string };
  health: string;
  executable: boolean;
  source: { kind: string; repository?: string };
  metrics: { runs: number; successes: number; failures: number; avgLatencyMs: number };
}

interface RankedResult {
  tool: ToolItem;
  score: number;
  match: number;
  reasons: string[];
}

interface PlanStepView {
  id: string;
  capability: string;
  title: string;
  selectedToolId?: string;
  selectedToolName?: string;
  fallbackToolIds: string[];
  riskLevel: number;
  approvalRequired: boolean;
}

interface RunView {
  id: string;
  goal: string;
  profile: string;
  mode: string;
  status: string;
  riskLevel: number;
  approvalRequired: boolean;
  estimatedCost: string;
  createdAt: string;
  plan: { steps: PlanStepView[]; notes: string[] };
}

interface ApprovalView {
  id: string;
  toolName?: string;
  toolId: string;
  action: string;
  riskLevel: number;
  reason: string;
  preview: string;
  scope: string;
  status: string;
  requestedAt: string;
}

interface StatsView {
  toolsTotal: number;
  toolsExecutable: number;
  toolsMetadataOnly: number;
  byType: Record<string, number>;
  byHealth: Record<string, number>;
  runs: Record<string, number>;
  pendingApprovals: number;
}

const HEALTH_CLASS: Record<string, string> = {
  healthy: "ur-pill ok",
  degraded: "ur-pill warn",
  offline: "ur-pill bad",
  disabled: "ur-pill muted",
  unknown: "ur-pill muted",
};

export function UniversalRegistry({ apiBase = "" }: UniversalRegistryProps) {
  const [activeTab, setActiveTab] = useState<"registry" | "planner" | "runs" | "approvals" | "health">("registry");

  const [tools, setTools] = useState<ToolItem[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RankedResult[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [goal, setGoal] = useState("");
  const [profile, setProfile] = useState("balanced");
  const [planning, setPlanning] = useState(false);
  const [plannedRun, setPlannedRun] = useState<RunView | null>(null);
  const [running, setRunning] = useState(false);

  const [runs, setRuns] = useState<RunView[]>([]);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [stats, setStats] = useState<StatsView | null>(null);

  const flash = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [toolsRes, runsRes, approvalsRes, statusRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/registry/tools`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/registry/runs`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/registry/approvals`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/registry/stats`).then((r) => r.json()),
      ]);
      if (toolsRes?.tools) setTools(toolsRes.tools);
      if (runsRes?.runs) setRuns(runsRes.runs);
      if (approvalsRes?.approvals) setApprovals(approvalsRes.approvals);
      if (statusRes?.stats) setStats(statusRes.stats);
    } catch {
      // offline or preview mode
    }
  }, [apiBase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    const interval = setInterval(() => void loadData(), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/registry/sync`, { method: "POST" });
      const data = await res.json();
      if (data?.sync) flash(`Synced ${data.sync.ingested} tools`);
      void loadData();
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const res = await fetch(`${apiBase}/api/agent-os/registry/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery.trim(), limit: 15 }),
    });
    const data = await res.json();
    setSearchResults(data?.results ?? []);
  };

  const handleToggle = async (tool: ToolItem) => {
    await fetch(`${apiBase}/api/agent-os/registry/tools/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: tool.id, enabled: tool.status === "disabled" }),
    });
    void loadData();
  };

  const handlePlan = async (dryRun: boolean) => {
    if (!goal.trim()) return;
    setPlanning(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/registry/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), profile, dryRun }),
      });
      const data = await res.json();
      if (data?.run) {
        setPlannedRun(data.run);
        flash(dryRun ? "Dry run plan created" : "Plan created — ready to execute");
      } else {
        flash(data?.error?.message || "Planning failed");
      }
      void loadData();
    } finally {
      setPlanning(false);
    }
  };

  const handleExecute = async () => {
    if (!plannedRun) return;
    setRunning(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/registry/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: plannedRun.id }),
      });
      const data = await res.json();
      if (data?.run) {
        setPlannedRun(data.run);
        if (data.run.status === "waiting_approval") flash("Waiting for human approval");
        else if (data.run.status === "completed") flash("Run completed");
        else flash(`Run status: ${data.run.status}`);
      }
      void loadData();
    } finally {
      setRunning(false);
    }
  };

  const handleApproval = async (id: string, decision: "approved" | "rejected") => {
    await fetch(`${apiBase}/api/agent-os/registry/approvals/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    void loadData();
  };

  const visibleTools = typeFilter
    ? tools.filter((t) => t.type === typeFilter)
    : tools;
  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <div className="ur-wrap">
      <header className="ur-header">
        <div>
          <h1>Universal Registry</h1>
          <p className="ur-sub">Agentic AI capability registry · search · toolchain planner · approvals · audit</p>
        </div>
        <div className="ur-header-actions">
          {message && <span className="ur-toast">{message}</span>}
          <button className="ur-btn primary" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Sources"}
          </button>
        </div>
      </header>

      <nav className="ur-tabs">
        {(["registry", "planner", "runs", "approvals", "health"] as const).map((tab) => (
          <button
            key={tab}
            className={`ur-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "approvals" && pending.length > 0 ? `Approvals (${pending.length})` : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === "registry" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <input
              className="ur-input grow"
              placeholder="What do you want to do? (e.g. scrape tiktok trends)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            />
            <button className="ur-btn" onClick={() => void handleSearch()}>Search</button>
            <select className="ur-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {Object.keys(stats?.byType ?? {}).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {(searchResults ?? visibleTools.map((tool) => ({ tool, match: 1, reasons: [] as string[], score: 1 }))).map((entry) => (
            <article key={entry.tool.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{entry.tool.name}</strong>
                <span className={HEALTH_CLASS[entry.tool.health] ?? "ur-pill muted"}>{entry.tool.health}</span>
                <span className="ur-pill muted">risk {entry.tool.risk.level}</span>
                {entry.tool.risk.requiresApproval && <span className="ur-pill warn">approval</span>}
                {entry.match < 1 && <span className="ur-pill ok">match {Math.round(entry.match * 100)}%</span>}
              </div>
              <p className="ur-desc">{entry.tool.description || "—"}</p>
              <div className="ur-meta">
                <span>{entry.tool.provider}</span>
                <span>· {entry.tool.type}</span>
                <span>· auth {entry.tool.authStatus}</span>
                <span>· cost {entry.tool.cost.model}</span>
                <span>· runs {entry.tool.metrics.runs}</span>
              </div>
              <div className="ur-tags">
                {entry.tool.capabilities.slice(0, 6).map((cap) => <span key={cap} className="ur-tag">{cap}</span>)}
              </div>
              {entry.reasons.length > 0 && (
                <p className="ur-reasons">Why: {entry.reasons.join("; ")}</p>
              )}
              <div className="ur-card-actions">
                <button className="ur-btn small" onClick={() => void handleToggle(entry.tool)}>
                  {entry.tool.status === "disabled" ? "Enable" : "Disable"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {activeTab === "planner" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <input
              className="ur-input grow"
              placeholder="Goal: e.g. find adobe stock trends and produce a video"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <select className="ur-input" value={profile} onChange={(e) => setProfile(e.target.value)}>
              {["balanced", "cheap", "quality", "local_first", "privacy_first", "adobe_stock_production"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button className="ur-btn" onClick={() => void handlePlan(true)} disabled={planning}>Dry Run</button>
            <button className="ur-btn primary" onClick={() => void handlePlan(false)} disabled={planning}>Plan</button>
          </div>

          {plannedRun && (
            <article className="ur-card">
              <div className="ur-card-head">
                <strong>Plan {plannedRun.id}</strong>
                <span className="ur-pill muted">{plannedRun.mode}</span>
                <span className="ur-pill muted">{plannedRun.status}</span>
                <span className={`ur-pill ${plannedRun.riskLevel >= 3 ? "bad" : plannedRun.riskLevel >= 1 ? "warn" : "ok"}`}>
                  risk {plannedRun.riskLevel}
                </span>
                <span className="ur-pill muted">cost {plannedRun.estimatedCost}</span>
              </div>
              <ol className="ur-steps">
                {plannedRun.plan.steps.map((step) => (
                  <li key={step.id}>
                    <span className="ur-cap">{step.capability}</span>
                    {" → "}
                    <span>{step.selectedToolName ?? "no tool registered"}</span>
                    {step.approvalRequired && <span className="ur-pill warn">approval required</span>}
                    {step.fallbackToolIds.length > 0 && (
                      <span className="ur-fallback"> fallbacks: {step.fallbackToolIds.length}</span>
                    )}
                  </li>
                ))}
              </ol>
              {plannedRun.plan.notes.length > 0 && (
                <p className="ur-reasons">Notes: {plannedRun.plan.notes.join("; ")}</p>
              )}
              <div className="ur-card-actions">
                <button className="ur-btn primary" onClick={handleExecute} disabled={running || plannedRun.mode === "dry_run"}>
                  {running ? "Executing…" : "Execute Plan"}
                </button>
              </div>
            </article>
          )}
        </section>
      )}

      {activeTab === "runs" && (
        <section className="ur-section">
          {runs.length === 0 && <p className="ur-empty">No runs yet — create a plan first.</p>}
          {runs.map((run) => (
            <article key={run.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{run.goal}</strong>
                <span className={`ur-pill ${run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "muted"}`}>{run.status}</span>
                <span className="ur-pill muted">{run.mode}</span>
                <span className="ur-pill muted">{run.profile}</span>
              </div>
              <p className="ur-meta">{run.id} · {new Date(run.createdAt).toLocaleString()} · {run.plan.steps.length} steps</p>
            </article>
          ))}
        </section>
      )}

      {activeTab === "approvals" && (
        <section className="ur-section">
          <p className="ur-note">High-risk actions (risk ≥ 3) always require a human decision. There is no "approve forever".</p>
          {approvals.length === 0 && <p className="ur-empty">No approvals requested.</p>}
          {approvals.map((approval) => (
            <article key={approval.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{approval.toolName ?? approval.toolId}</strong>
                <span className={`ur-pill ${approval.riskLevel >= 4 ? "bad" : "warn"}`}>risk {approval.riskLevel}</span>
                <span className={`ur-pill ${approval.status === "pending" ? "warn" : approval.status === "approved" ? "ok" : "bad"}`}>{approval.status}</span>
                <span className="ur-pill muted">{approval.scope}</span>
              </div>
              <p className="ur-desc">{approval.action} — {approval.reason}</p>
              {approval.preview && <pre className="ur-preview">{approval.preview}</pre>}
              {approval.status === "pending" && (
                <div className="ur-card-actions">
                  <button className="ur-btn primary" onClick={() => void handleApproval(approval.id, "approved")}>Approve Once</button>
                  <button className="ur-btn" onClick={() => void handleApproval(approval.id, "rejected")}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {activeTab === "health" && stats && (
        <section className="ur-section">
          <div className="ur-stat-grid">
            <div className="ur-stat"><strong>{stats.toolsTotal}</strong><span>total tools</span></div>
            <div className="ur-stat"><strong>{stats.toolsExecutable}</strong><span>executable</span></div>
            <div className="ur-stat"><strong>{stats.toolsMetadataOnly}</strong><span>metadata only</span></div>
            {Object.entries(stats.byHealth).map(([k, v]) => (
              <div key={k} className="ur-stat"><strong>{v}</strong><span>{k}</span></div>
            ))}
          </div>
          <div className="ur-stat-grid">
            {Object.entries(stats.byType).map(([k, v]) => (
              <div key={k} className="ur-stat"><strong>{v}</strong><span>{k}</span></div>
            ))}
          </div>
          <div className="ur-stat-grid">
            {Object.entries(stats.runs).map(([k, v]) => (
              <div key={k} className="ur-stat"><strong>{v}</strong><span>runs {k}</span></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
