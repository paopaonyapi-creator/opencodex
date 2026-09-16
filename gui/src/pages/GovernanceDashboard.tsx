// Phase 20.28 — Pao-hubPro Governance Gateway dashboard (glassmorphic)

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface GovernanceDashboardProps {
  apiBase?: string;
}

interface GovernanceStatus {
  mode: string;
  providers: Array<{ id: string; available: boolean }>;
  policies: number;
}

interface GrantRow {
  id: string;
  subjectId: string;
  provider: string;
  capability: string;
  effectCeiling?: string;
  resourcePattern?: string;
  enabled: boolean;
  expiresAt?: string;
}

interface ApprovalRow {
  id: string;
  actionId: string;
  status: string;
  risk: string;
  summary: string;
  requestedByAgentId: string;
  argumentPreview?: unknown;
}

interface AuditRow {
  id: string;
  actionId?: string;
  eventType: string;
  provider?: string;
  tool?: string;
  risk?: string;
  decision?: string;
  resourceSummary?: string;
  timestamp: string;
}

const MODE_CLASS: Record<string, string> = {
  normal: "ur-pill ok",
  read_only: "ur-pill warn",
  paused: "ur-pill bad",
};

const RISK_CLASS: Record<string, string> = {
  low: "ur-pill muted", medium: "ur-pill warn", high: "ur-pill warn", critical: "ur-pill bad",
};

export function GovernanceDashboard({ apiBase = "" }: GovernanceDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "approvals" | "grants" | "audit">("overview");
  const [status, setStatus] = useState<GovernanceStatus | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, grantsRes, approvalsRes, auditRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/governance/status`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/governance/grants`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/governance/approvals`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/governance/audit?limit=50`).then((r) => r.json()),
      ]);
      if (statusRes?.mode) setStatus({ mode: statusRes.mode, providers: statusRes.providers ?? [], policies: statusRes.policies ?? 0 });
      if (grantsRes?.grants) setGrants(grantsRes.grants);
      if (approvalsRes?.approvals) setApprovals(approvalsRes.approvals);
      if (auditRes?.events) setAudit(auditRes.events);
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

  const setMode = async (mode: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/governance/emergency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, actor: "dashboard" }),
      });
      const data = await res.json();
      flash(data?.mode ? `Governance mode: ${data.mode}` : "Mode change failed");
      void loadData();
    } finally {
      setBusy(false);
    }
  };

  const resolveApproval = async (id: string, decision: "approved" | "denied") => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/governance/approvals/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, resolvedBy: "dashboard" }),
      });
      const data = await res.json();
      flash(data?.result ? `Approval ${decision}` : data?.error?.message || "Resolve failed");
      void loadData();
    } finally {
      setBusy(false);
    }
  };

  const revokeGrant = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/governance/grants?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      flash("Grant revoked");
      void loadData();
    } finally {
      setBusy(false);
    }
  };

  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <div className="ur-wrap">
      <header className="ur-header">
        <div>
          <h1>Governance</h1>
          <p className="ur-sub">Gateway mode · grants · approvals · hash-chained audit</p>
        </div>
        <div className="ur-header-actions">
          {message && <span className="ur-toast">{message}</span>}
        </div>
      </header>

      <nav className="ur-tabs">
        {(["overview", "approvals", "grants", "audit"] as const).map((tab) => (
          <button key={tab} className={`ur-tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab === "approvals" && pending.length > 0 ? `Approvals (${pending.length})` : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && status && (
        <section className="ur-section">
          <article className="ur-card">
            <div className="ur-card-head">
              <strong>Kill switch</strong>
              <span className={MODE_CLASS[status.mode] ?? "ur-pill muted"}>{status.mode}</span>
              <span className="ur-pill muted">{status.policies} active policies</span>
            </div>
            <div className="ur-card-actions">
              {(["normal", "read_only", "paused"] as const).map((mode) => (
                <button key={mode} className={`ur-btn small ${status.mode === mode ? "primary" : ""}`} onClick={() => void setMode(mode)} disabled={busy}>
                  {mode}
                </button>
              ))}
            </div>
          </article>
          <div className="ur-stat-grid">
            <div className="ur-stat"><strong>{pending.length}</strong><span>pending approvals</span></div>
            <div className="ur-stat"><strong>{grants.filter((g) => g.enabled).length}</strong><span>active grants</span></div>
            <div className="ur-stat"><strong>{status.providers.filter((p) => p.available).length}</strong><span>providers available</span></div>
            <div className="ur-stat"><strong>{audit.filter((e) => e.eventType.includes("denied")).length}</strong><span>recent denials</span></div>
          </div>
        </section>
      )}

      {activeTab === "approvals" && (
        <section className="ur-section">
          {approvals.length === 0 && <p className="ur-empty">No approvals recorded.</p>}
          {approvals.map((approval) => (
            <article key={approval.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{approval.summary || approval.actionId}</strong>
                <span className={RISK_CLASS[approval.risk] ?? "ur-pill muted"}>{approval.risk}</span>
                <span className={`ur-pill ${approval.status === "pending" ? "warn" : approval.status === "approved" ? "ok" : "bad"}`}>{approval.status}</span>
                <span className="ur-pill muted">{approval.requestedByAgentId}</span>
              </div>
              {approval.argumentPreview !== undefined && (
                <pre className="ur-preview">{JSON.stringify(approval.argumentPreview, null, 1).slice(0, 400)}</pre>
              )}
              {approval.status === "pending" && (
                <div className="ur-card-actions">
                  <button className="ur-btn primary" onClick={() => void resolveApproval(approval.id, "approved")} disabled={busy}>Approve</button>
                  <button className="ur-btn" onClick={() => void resolveApproval(approval.id, "denied")} disabled={busy}>Deny</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {activeTab === "grants" && (
        <section className="ur-section">
          {grants.map((grant) => (
            <article key={grant.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{grant.subjectId}</strong>
                <span className="ur-pill muted">{grant.provider}/{grant.capability}</span>
                {grant.effectCeiling && <span className="ur-pill warn">ceiling {grant.effectCeiling}</span>}
                <span className={`ur-pill ${grant.enabled ? "ok" : "bad"}`}>{grant.enabled ? "enabled" : "disabled"}</span>
                {grant.expiresAt && <span className="ur-pill muted">expires {new Date(grant.expiresAt).toLocaleString()}</span>}
              </div>
              {grant.resourcePattern && <p className="ur-reasons">resource: {grant.resourcePattern}</p>}
              <div className="ur-card-actions">
                <button className="ur-btn small" onClick={() => void revokeGrant(grant.id)} disabled={busy}>Revoke</button>
              </div>
            </article>
          ))}
          {grants.length === 0 && <p className="ur-empty">No grants — every governed action is denied by default.</p>}
        </section>
      )}

      {activeTab === "audit" && (
        <section className="ur-section">
          {audit.map((event) => (
            <article key={event.id} className="ur-card">
              <div className="ur-card-head">
                <span className={`ur-pill ${event.eventType.includes("denied") || event.eventType.includes("failed") ? "bad" : event.eventType.includes("succeeded") || event.eventType.includes("allowed") ? "ok" : "muted"}`}>
                  {event.eventType}
                </span>
                {event.risk && <span className={RISK_CLASS[event.risk] ?? "ur-pill muted"}>{event.risk}</span>}
                {event.provider && <span className="ur-pill muted">{event.provider}{event.tool ? "/" + event.tool : ""}</span>}
              </div>
              <p className="ur-meta">{new Date(event.timestamp).toLocaleString()} · {event.actionId || "—"}</p>
            </article>
          ))}
          {audit.length === 0 && <p className="ur-empty">No audit events yet.</p>}
        </section>
      )}
    </div>
  );
}
