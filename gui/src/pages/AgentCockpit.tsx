// Phase 20.27 — Pao-hubPro × VibeRaven Agent Cockpit & Production Readiness
// Glassmorphic Control Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface CockpitProps {
  apiBase?: string;
}

interface Overview {
  git: { available: boolean; branch?: string; headSha?: string; dirty?: boolean; reason?: string };
  readiness: { verdict: string; profile: string; blockers: number } | null;
  openBlockers: number;
  pendingApprovals: number;
  agents: Array<{ id: string; type: string; status: string; accessMode: string }>;
  providers: Array<{ id: string; status: string }>;
  lastKnownGood?: { sha: string; state: string; markedBy: string } | null;
  viberaven: { enabled: boolean; available: boolean; reason?: string };
}

interface AgentRow {
  id: string;
  type: string;
  displayName: string;
  status: string;
  accessMode: string;
  version?: string;
  reason?: string;
  capabilities: Record<string, boolean>;
}

interface ApprovalRow {
  id: string;
  action: string;
  risk: string;
  reason: string;
  preview: string;
  scope: string;
  status: string;
  requestedBy: string;
  expiresAt?: string;
}

interface GateFindingRow {
  id: string;
  ruleId: string;
  severity: string;
  title: string;
  evidence: Array<{ type: string; summary: string }>;
  suggestedActions: string[];
}

interface GateRow {
  id: string;
  profile: string;
  verdict: string;
  exitCode: number;
  findings: GateFindingRow[];
}

const VERDICT_CLASS: Record<string, string> = {
  clear: "ur-pill ok",
  warning: "ur-pill warn",
  blocked: "ur-pill bad",
  unknown: "ur-pill muted",
};

const RISK_CLASS: Record<string, string> = {
  R0: "ur-pill muted", R1: "ur-pill muted", R2: "ur-pill warn",
  R3: "ur-pill warn", R4: "ur-pill bad", R5: "ur-pill bad",
};

export function AgentCockpit({ apiBase = "" }: CockpitProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "agents" | "approvals" | "readiness">("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [gate, setGate] = useState<GateRow | null>(null);
  const [gateProfile, setGateProfile] = useState("pull_request");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, agentsRes, approvalsRes, gateRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/cockpit/overview`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/cockpit/agents`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/cockpit/approvals?status=pending`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/cockpit/gate`).then((r) => r.json()),
      ]);
      if (overviewRes?.overview) setOverview(overviewRes.overview);
      if (agentsRes?.agents) setAgents(agentsRes.agents);
      if (approvalsRes?.approvals) setApprovals(approvalsRes.approvals);
      if (gateRes?.gate) setGate(gateRes.gate);
    } catch {
      // offline or preview mode
    }
  }, [apiBase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    const interval = setInterval(() => void loadData(), 6000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadData]);

  const changeMode = async (agentType: string, mode: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/cockpit/agents/access-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType, mode, actor: "dashboard" }),
      });
      const data = await res.json();
      flash(data?.ok ? `${agentType} → ${mode}` : data?.error?.message || "Mode change refused");
      void loadData();
    } finally {
      setBusy(false);
    }
  };

  const resolveApproval = async (id: string, decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/cockpit/approvals/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, decidedBy: "dashboard" }),
      });
      const data = await res.json();
      flash(data?.approval ? `Approval ${decision}` : data?.error?.message || "Resolve failed");
      void loadData();
    } finally {
      setBusy(false);
    }
  };

  const runGate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/cockpit/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: gateProfile }),
      });
      const data = await res.json();
      if (data?.gate) {
        setGate(data.gate);
        flash(`Gate ${data.gate.verdict} (exit ${data.gate.exitCode})`);
      } else {
        flash(data?.error?.message || "Gate run failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ur-wrap">
      <header className="ur-header">
        <div>
          <h1>Agent Cockpit</h1>
          <p className="ur-sub">Control plane · access modes · approvals · evidence-backed readiness</p>
        </div>
        <div className="ur-header-actions">
          {message && <span className="ur-toast">{message}</span>}
        </div>
      </header>

      <nav className="ur-tabs">
        {(["overview", "agents", "approvals", "readiness"] as const).map((tab) => (
          <button key={tab} className={`ur-tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab === "approvals" && overview && overview.pendingApprovals > 0 ? `Approvals (${overview.pendingApprovals})` : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && overview && (
        <section className="ur-section">
          <article className="ur-card">
            <div className="ur-card-head">
              <strong>{overview.git.available ? `${overview.git.branch} @ ${(overview.git.headSha ?? "").slice(0, 10)}` : "git unavailable"}</strong>
              {overview.git.dirty && <span className="ur-pill warn">uncommitted changes</span>}
              {overview.readiness && (
                <span className={VERDICT_CLASS[overview.readiness.verdict] ?? "ur-pill muted"}>
                  readiness {overview.readiness.verdict} ({overview.readiness.profile})
                </span>
              )}
              {overview.lastKnownGood && (
                <span className="ur-pill ok">known-good {(overview.lastKnownGood.sha || "").slice(0, 8)}</span>
              )}
            </div>
          </article>
          <div className="ur-stat-grid">
            <div className="ur-stat"><strong>{overview.openBlockers}</strong><span>open blockers</span></div>
            <div className="ur-stat"><strong>{overview.pendingApprovals}</strong><span>pending approvals</span></div>
            <div className="ur-stat"><strong>{overview.agents.filter((a) => a.status === "ready").length}</strong><span>agents ready</span></div>
            <div className="ur-stat"><strong>{overview.providers.filter((p) => p.status === "verified").length}</strong><span>providers verified</span></div>
          </div>
          <article className="ur-card">
            <div className="ur-card-head">
              <strong>VibeRaven adapter</strong>
              <span className={overview.viberaven.enabled ? "ur-pill warn" : "ur-pill muted"}>
                {overview.viberaven.enabled ? (overview.viberaven.available ? "available" : "flag on, not configured") : "reference-only (flag off)"}
              </span>
            </div>
            {overview.viberaven.reason && <p className="ur-reasons">{overview.viberaven.reason}</p>}
          </article>
        </section>
      )}

      {activeTab === "agents" && (
        <section className="ur-section">
          {agents.map((agent) => (
            <article key={agent.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{agent.displayName}</strong>
                <span className={agent.status === "ready" ? "ur-pill ok" : "ur-pill muted"}>{agent.status}</span>
                <span className="ur-pill muted">{agent.accessMode}</span>
                {agent.version && <span className="ur-pill muted">{agent.version}</span>}
              </div>
              {agent.reason && <p className="ur-reasons">{agent.reason}</p>}
              <div className="ur-card-actions">
                {(["ask", "approve", "full"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`ur-btn small ${agent.accessMode === mode ? "primary" : ""}`}
                    onClick={() => void changeMode(agent.type, mode)}
                    disabled={busy}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {activeTab === "approvals" && (
        <section className="ur-section">
          {approvals.length === 0 && <p className="ur-empty">No pending approvals.</p>}
          {approvals.map((approval) => (
            <article key={approval.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{approval.action}</strong>
                <span className={RISK_CLASS[approval.risk] ?? "ur-pill muted"}>{approval.risk}</span>
                <span className="ur-pill muted">{approval.scope}</span>
                <span className="ur-pill muted">{approval.requestedBy}</span>
              </div>
              <p className="ur-desc">{approval.reason}</p>
              {approval.preview && <pre className="ur-preview">{approval.preview}</pre>}
              <div className="ur-card-actions">
                <button className="ur-btn primary" onClick={() => void resolveApproval(approval.id, "approved")} disabled={busy}>Approve</button>
                <button className="ur-btn" onClick={() => void resolveApproval(approval.id, "rejected")} disabled={busy}>Reject</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {activeTab === "readiness" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <select className="ur-input" value={gateProfile} onChange={(e) => setGateProfile(e.target.value)}>
              {["dev", "pre_commit", "pull_request", "staging", "production", "strict_production"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button className="ur-btn primary" onClick={() => void runGate()} disabled={busy}>Run Gate</button>
          </div>
          {gate && (
            <article className="ur-card">
              <div className="ur-card-head">
                <strong>Gate {gate.id}</strong>
                <span className={VERDICT_CLASS[gate.verdict] ?? "ur-pill muted"}>{gate.verdict}</span>
                <span className={`ur-pill ${gate.exitCode === 0 ? "ok" : "bad"}`}>exit {gate.exitCode}</span>
                <span className="ur-pill muted">{gate.profile}</span>
              </div>
              {gate.findings.map((finding) => (
                <div key={finding.id} className="ur-card">
                  <div className="ur-card-head">
                    <span className={`ur-pill ${finding.severity === "critical" || finding.severity === "blocker" ? "bad" : finding.severity === "warning" ? "warn" : "muted"}`}>{finding.severity}</span>
                    <span>{finding.title}</span>
                  </div>
                  <p className="ur-reasons">rule {finding.ruleId} · evidence: {finding.evidence.map((e) => e.summary).join("; ") || "verification missing"}</p>
                </div>
              ))}
              {gate.findings.length === 0 && <p className="ur-empty">No findings recorded.</p>}
            </article>
          )}
          {!gate && <p className="ur-empty">No gate run yet.</p>}
        </section>
      )}
    </div>
  );
}
