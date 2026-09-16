// Phase 20.37 — Orchestration dashboard (spec §25): overview, agents, hooks,
// runs, approval queue, audit. Compact glassmorphic single-page tabs.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface AgenticOsProps {
  apiBase?: string;
}

interface AgentRow {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  runtime: { preferred: string };
  riskCeiling: number;
  skills: string[];
}

interface RunRow {
  id: string;
  workflowSlug: string;
  status: string;
  riskLevel: number;
  inputSummary: string;
  outputSummary: string | null;
  concernSummary: string | null;
  createdAt: string;
}

interface ApprovalRow {
  id: string;
  runId: string;
  status: string;
  riskLevel: number;
  title: string;
  reason: string;
  actionSummary: string;
}

interface HookRow {
  id: string;
  event: string;
  priority: number;
  action: string;
  mode: string;
  message: string;
}

const STATE_COLORS: Record<string, string> = {
  DONE: "#35c07d", healthy: "#35c07d", pass: "#35c07d", approved: "#35c07d",
  RUNNING: "#7aa2f7", QUEUED: "#7aa2f7", PLANNED: "#7aa2f7", ROUTING: "#7aa2f7",
  VERIFYING: "#7aa2f7", REVIEWING: "#7aa2f7", RECEIVED: "#7aa2f7",
  WAITING_APPROVAL: "#e2b93b", warn: "#e2b93b", degraded: "#e2b93b", DONE_WITH_CONCERNS: "#e2b93b",
  BLOCKED: "#e06c75", FAILED: "#e06c75", CANCELLED: "#8a93a6", rejected: "#e06c75", fail: "#e06c75",
};

function color(value: string | null | undefined): string {
  return STATE_COLORS[value ?? ""] || "#8a93a6";
}

type TabKey = "overview" | "agents" | "hooks" | "runs" | "approvals" | "audit";

export function AgenticOs({ apiBase = "" }: AgenticOsProps) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [audit, setAudit] = useState<Array<{ ts: string; event_type: string; severity: string; summary: string; actor_ref: string }>>([]);
  const [doctor, setDoctor] = useState<{ status: string; checks: Array<{ id: string; status: string; message: string }> } | null>(null);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [a, r, ap, h, au, d] = await Promise.all([
        api("/api/agent-os/orch/agents"),
        api("/api/agent-os/orch/runs"),
        api("/api/agent-os/orch/approvals?status=pending"),
        api("/api/agent-os/orch/hooks"),
        api("/api/agent-os/orch/audit"),
        api("/api/agent-os/orch/health"),
      ]);
      setAgents(((a.data as { agents?: AgentRow[] })?.agents) ?? []);
      setRuns(((r.data as { runs?: RunRow[] })?.runs) ?? []);
      setApprovals(((ap.data as { approvals?: ApprovalRow[] })?.approvals) ?? []);
      setHooks(((h.data as { policies?: HookRow[] })?.policies) ?? []);
      setAudit(((au.data as { events?: typeof audit })?.events) ?? []);
      setDoctor((d.data as typeof doctor) ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const startRun = useCallback(async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      await api("/api/agent-os/orch/runs", { method: "POST", body: JSON.stringify({ goal, source: "dashboard", requestedBy: "dashboard" }) });
      setGoal("");
      await refresh();
      setTab("runs");
    } finally {
      setBusy(false);
    }
  }, [api, goal, refresh]);

  const resolveApproval = useCallback(async (approvalId: string, decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await api("/api/agent-os/orch/approvals/resolve", { method: "POST", body: JSON.stringify({ approvalId, decision, actor: "dashboard" }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const toggleAgent = useCallback(async (agentSlug: string, enabled: boolean) => {
    await api("/api/agent-os/orch/agents/enable", { method: "POST", body: JSON.stringify({ agentSlug, enabled, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "agents", label: `Agents (${agents.length})` },
    { key: "hooks", label: `Hooks (${hooks.length})` },
    { key: "runs", label: `Runs (${runs.length})` },
    { key: "approvals", label: `Approvals (${approvals.length})` },
    { key: "audit", label: "Audit" },
  ];

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Orchestration</h1>
          <p className="ur-subtitle">Agentic Development OS: governed agents, skills, hooks, runs, approvals and audit</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
        </div>
      </header>

      {error && <div className="ur-banner ur-banner-error">Dashboard error: {error}</div>}

      <div className="ur-chip-row">
        {tabs.map((entry) => (
          <button key={entry.key} className="ur-chip" style={{ borderColor: tab === entry.key ? "#7aa2f7" : "rgba(255,255,255,0.2)" }} onClick={() => setTab(entry.key)}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <section className="ur-grid ur-grid-4">
            <div className="ur-card">
              <div className="ur-card-label">Doctor</div>
              <div className="ur-card-value" style={{ color: color(doctor?.status) }}>{doctor?.status ?? "…"}</div>
              <div className="ur-card-meta">{doctor?.checks.filter((check) => check.status === "pass").length ?? 0} checks passing</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Active Runs</div>
              <div className="ur-card-value">{runs.filter((run) => !["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "FAILED", "CANCELLED"].includes(run.status)).length}</div>
              <div className="ur-card-meta">{runs.length} total</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Pending Approvals</div>
              <div className="ur-card-value" style={{ color: approvals.length > 0 ? "#e2b93b" : "#35c07d" }}>{approvals.length}</div>
              <div className="ur-card-meta">human resolution required</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Agents / Hooks</div>
              <div className="ur-card-value">{agents.filter((agent) => agent.enabled).length}/{agents.length}</div>
              <div className="ur-card-meta">{hooks.length} hook policies enforced</div>
            </div>
          </section>
          {doctor && doctor.checks.some((check) => check.status !== "pass") && (
            <section className="ur-banner ur-banner-warn">
              {doctor.checks.filter((check) => check.status !== "pass").map((check, index) => (<div key={index}>· {check.id}: {check.message}</div>))}
            </section>
          )}
          <section className="ur-panel">
            <h2 className="ur-panel-title">New Run (intake)</h2>
            <label className="ur-field">
              <span>Goal</span>
              <input className="ur-input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="explore the repository architecture" />
            </label>
            <div className="ur-actions">
              <button className="ur-btn ur-btn-primary" onClick={() => { void startRun(); }} disabled={busy || !goal.trim()}>Start run</button>
            </div>
          </section>
        </>
      )}

      {tab === "agents" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Agent Registry</h2>
          <table className="ur-table">
            <thead><tr><th>Agent</th><th>Runtime</th><th>Risk ceiling</th><th>Skills</th><th>Enabled</th><th></th></tr></thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.slug}>
                  <td>{agent.name}<div className="ur-meta">{agent.slug} · {agent.description.slice(0, 60)}…</div></td>
                  <td>{agent.runtime.preferred}</td>
                  <td>{agent.riskCeiling}</td>
                  <td className="ur-meta">{agent.skills.join(", ")}</td>
                  <td style={{ color: agent.enabled ? "#35c07d" : "#e06c75" }}>{agent.enabled ? "enabled" : "disabled"}</td>
                  <td>
                    <button className="ur-btn ur-btn-sm" onClick={() => { void toggleAgent(agent.slug, !agent.enabled); }} disabled={busy}>
                      {agent.enabled ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "hooks" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Hook Policies (priority-ordered)</h2>
          <table className="ur-table">
            <thead><tr><th>Policy</th><th>Event</th><th>Priority</th><th>Action</th><th>Mode</th><th>Message</th></tr></thead>
            <tbody>
              {hooks.map((hook) => (
                <tr key={hook.id}>
                  <td className="ur-meta">{hook.id}</td>
                  <td>{hook.event}</td>
                  <td>{hook.priority}</td>
                  <td style={{ color: hook.action === "deny" ? "#e06c75" : hook.action === "require_approval" ? "#e2b93b" : "#35c07d" }}>{hook.action}</td>
                  <td>{hook.mode}</td>
                  <td className="ur-meta">{hook.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "runs" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Runs</h2>
          <table className="ur-table">
            <thead><tr><th>Run</th><th>Goal</th><th>Status</th><th>Risk</th><th>Result / Concerns</th><th>Created</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="ur-meta">{run.id}</td>
                  <td>{run.inputSummary.slice(0, 80)}</td>
                  <td style={{ color: color(run.status) }}>{run.status}</td>
                  <td>{run.riskLevel}</td>
                  <td className="ur-meta">{run.outputSummary ?? "—"}{run.concernSummary ? <div style={{ color: "#e2b93b" }}>{run.concernSummary}</div> : null}</td>
                  <td className="ur-meta">{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {runs.length === 0 && (<tr><td colSpan={6} className="ur-empty">No runs yet — start one from Overview.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "approvals" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Approval Queue</h2>
          {approvals.map((approval) => (
            <div key={approval.id} className="ur-banner" style={{ borderColor: "#e2b93b" }}>
              <strong>{approval.title}</strong>
              <div className="ur-meta">run {approval.runId} · risk {approval.riskLevel} · {approval.reason}</div>
              <div className="ur-meta">action: {approval.actionSummary}</div>
              <div className="ur-actions">
                <button className="ur-btn ur-btn-sm" onClick={() => { void resolveApproval(approval.id, "approved"); }} disabled={busy}>Approve</button>
                <button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void resolveApproval(approval.id, "rejected"); }} disabled={busy}>Reject</button>
              </div>
            </div>
          ))}
          {approvals.length === 0 && (<div className="ur-empty">No pending approvals.</div>)}
        </section>
      )}

      {tab === "audit" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Audit Trail (redacted)</h2>
          <table className="ur-table">
            <thead><tr><th>Time</th><th>Event</th><th>Severity</th><th>Actor</th><th>Summary</th></tr></thead>
            <tbody>
              {audit.slice(0, 20).map((entry, index) => (
                <tr key={index}>
                  <td className="ur-meta">{new Date(entry.ts).toLocaleString()}</td>
                  <td>{entry.event_type}</td>
                  <td style={{ color: entry.severity === "error" ? "#e06c75" : entry.severity === "warning" ? "#e2b93b" : "#8a93a6" }}>{entry.severity}</td>
                  <td className="ur-meta">{entry.actor_ref}</td>
                  <td className="ur-meta">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
