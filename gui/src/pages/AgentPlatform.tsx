// Phase 20.54 — Agent Platform registry, approvals, receipts.

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface AgentPlatformProps {
  apiBase?: string;
}

interface AgentRow {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  patterns: string[];
  capabilities: string[];
}

interface ApprovalRow {
  id: string;
  taskId: string;
  agentId: string;
  capabilityId: string;
  riskLevel: string;
  status: string;
}

export default function AgentPlatformPage({ apiBase = "" }: AgentPlatformProps) {
  const [tab, setTab] = useState<"agents" | "approvals" | "receipts" | "audit">("agents");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [receipts, setReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, a, p, r, u] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/agent-platform/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-platform/agents`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-platform/approvals`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-platform/receipts`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-platform/audit`).then((x) => x.json()),
      ]);
      setHealth(h);
      setAgents(a.agents ?? []);
      setApprovals(p.approvals ?? []);
      setReceipts(r.receipts ?? []);
      setAudit(u.events ?? []);
    } catch {
      setMessage("Agent platform API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 8000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);

  const resolve = async (id: string, decision: "approved" | "rejected") => {
    await fetch(`${apiBase}/api/agent-os/agent-platform/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actorId: "admin", decision }),
    });
    setMessage(`${decision} ${id}`);
    await load();
  };

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.54</p>
        <h1>Agent Platform</h1>
        <p>Registry, policy, approvals, receipts, and audit for governed agents.</p>
        {health ? <p className="ur-meta">{String(health.agents)} agents · {String(health.pendingApprovals)} pending approvals</p> : null}
        {message ? <p className="ur-banner">{message}</p> : null}
      </header>
      <div className="ur-tabs">
        {(["agents", "approvals", "receipts", "audit"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>
      {tab === "agents" ? (
        <table className="ur-table">
          <thead><tr><th>Agent</th><th>Version</th><th>Patterns</th><th>Status</th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>{a.name}<div className="ur-meta">{a.id}</div></td>
                <td>{a.version}</td>
                <td>{a.patterns.join(", ")}</td>
                <td><span className={a.enabled ? "ur-pill ok" : "ur-pill muted"}>{a.enabled ? "enabled" : "disabled"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "approvals" ? (
        <table className="ur-table">
          <thead><tr><th>Approval</th><th>Capability</th><th>Risk</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <td>{a.id}<div className="ur-meta">{a.agentId} / {a.taskId}</div></td>
                <td>{a.capabilityId}</td>
                <td><span className={a.riskLevel === "R4" ? "ur-pill bad" : "ur-pill warn"}>{a.riskLevel}</span></td>
                <td>{a.status}</td>
                <td>
                  {a.status === "pending" ? (
                    <>
                      <button className="ur-btn" onClick={() => void resolve(a.id, "approved")}>Approve</button>
                      <button className="ur-btn" onClick={() => void resolve(a.id, "rejected")}>Reject</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "receipts" ? (
        <pre className="ur-pre">{JSON.stringify(receipts, null, 2)}</pre>
      ) : null}
      {tab === "audit" ? (
        <pre className="ur-pre">{JSON.stringify(audit.slice(-40), null, 2)}</pre>
      ) : null}
    </div>
  );
}

