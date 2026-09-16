// Phase 20.33 — Pao-hubPro × Open WebUI Unified AI Workspace: Control Center.
// Orchestration-focused cards over the existing surfaces; Open WebUI itself is
// linked out (never iframed — doc §40) and its data stays in its own store.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface AiWorkspaceProps {
  apiBase?: string;
}

interface StatusData {
  governance: { mode: string; policyCount: number };
  workspaceRoots: string[];
  tools: { governed: number; surface: number };
}

interface ToolEntry {
  name: string;
  group: string;
  description: string;
  executor: string;
  risk: string;
  availableVia?: string;
  executable: boolean;
}

interface HealthData {
  overall: string;
  components: {
    governance?: { state?: string; mode?: string };
    orchestration?: Record<string, unknown>;
    llmRouter?: { state?: string; note?: string };
    openWebui?: { version?: string; versionPinned?: boolean; reachable?: boolean | null; launchUrl?: string | null; problems?: string[] };
    optional?: Record<string, string>;
  };
}

interface AliasRow {
  alias: string;
  strategy?: string;
  targetCount?: number;
  enabled?: boolean;
}

interface ApprovalRow {
  id: string;
  status: string;
  risk: string;
  summary: string;
  requestedByAgentId: string;
  createdAt: string;
  expiresAt?: string;
}

const RISK_COLORS: Record<string, string> = {
  read: "#35c07d",
  "write-low": "#e2b93b",
  "write-high": "#e06c75",
  execute: "#e06c75",
  network: "#e2b93b",
  deploy: "#e06c75",
  delete: "#e06c75",
  credential: "#e06c75",
};

function riskColor(risk: string): string {
  return RISK_COLORS[risk] || "#8a93a6";
}

export function AiWorkspace({ apiBase = "" }: AiWorkspaceProps) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`);
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [s, h, t, a, appr] = await Promise.all([
        api("/api/agent-os/ai-workspace/status"),
        api("/api/agent-os/ai-workspace/health"),
        api("/api/agent-os/ai-workspace/tools"),
        api("/api/agent-os/ai-gateway/aliases"),
        api("/api/agent-os/governance/approvals"),
      ]);
      setStatus((s.data as StatusData) ?? null);
      setHealth((h.data as HealthData) ?? null);
      setTools(((t.data as { tools?: ToolEntry[] })?.tools) ?? []);
      const aliasData = a.data as { aliases?: AliasRow[] } | undefined;
      setAliases(Array.isArray(aliasData?.aliases) ? aliasData!.aliases! : []);
      const approvalData = appr as { approvals?: ApprovalRow[] } | { data?: { approvals?: ApprovalRow[] } };
      const approvalList = Array.isArray(approvalData)
        ? (approvalData as unknown as ApprovalRow[])
        : ((approvalData as { approvals?: ApprovalRow[] })?.approvals
          ?? ((approvalData as { data?: { approvals?: ApprovalRow[] } })?.data?.approvals ?? []));
      setApprovals(approvalList.filter((entry) => entry.status === "pending"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const resolveApproval = useCallback(async (id: string, decision: "approved" | "denied") => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/governance/approvals/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: id, decision, actor: "dashboard", reason: "resolved from AI workspace control center" }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [apiBase, refresh]);

  const openWebui = health?.components?.openWebui;
  const launchUrl = openWebui?.launchUrl;

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">AI Workspace</h1>
          <p className="ur-subtitle">Open WebUI control plane · pao.* MCP gateway · governed tools</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
          {launchUrl && (
            <a className="ur-btn ur-btn-primary" href={launchUrl} target="_blank" rel="noreferrer">Open Open WebUI</a>
          )}
        </div>
      </header>

      {error && <div className="ur-banner ur-banner-error">Dashboard error: {error}</div>}

      <section className="ur-grid ur-grid-4">
        <div className="ur-card">
          <div className="ur-card-label">Open WebUI</div>
          <div className="ur-card-value" style={{ color: openWebui?.reachable === false ? "#e06c75" : openWebui?.reachable === true ? "#35c07d" : "#e2b93b" }}>
            {openWebui?.reachable === true ? "reachable" : openWebui?.reachable === false ? "unreachable" : "not configured"}
          </div>
          <div className="ur-card-meta">{openWebui?.version ?? "—"}{openWebui?.versionPinned === false ? " · UNPINNED" : " · pinned"}</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">MCP Gateway</div>
          <div className="ur-card-value">{status?.tools?.governed ?? 0}<span className="ur-meta"> + {status?.tools?.surface ?? 0} surface</span></div>
          <div className="ur-card-meta">pao.* tools via governed dispatch</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">Governance</div>
          <div className="ur-card-value" style={{ color: status?.governance?.mode === "normal" ? "#35c07d" : "#e2b93b" }}>{status?.governance?.mode ?? "…"}</div>
          <div className="ur-card-meta">{status?.governance?.policyCount ?? 0} active policies</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">Model Aliases</div>
          <div className="ur-card-value">{aliases.length}</div>
          <div className="ur-card-meta">virtual models over the proxy router</div>
        </div>
      </section>

      {openWebui?.problems && openWebui.problems.length > 0 && (
        <section className="ur-banner ur-banner-warn">
          {openWebui.problems.map((problem, index) => (<div key={index}>· {problem}</div>))}
        </section>
      )}

      <section className="ur-panel">
        <h2 className="ur-panel-title">Pending Approvals</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Approval</th><th>Risk</th><th>Summary</th><th>Requested by</th><th>Expires</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {approvals.map((approval) => (
              <tr key={approval.id}>
                <td className="ur-meta">{approval.id}</td>
                <td style={{ color: riskColor(approval.risk) }}>{approval.risk}</td>
                <td>{approval.summary}</td>
                <td className="ur-meta">{approval.requestedByAgentId}</td>
                <td className="ur-meta">{approval.expiresAt ? new Date(approval.expiresAt).toLocaleTimeString() : "—"}</td>
                <td className="ur-actions-cell">
                  <button className="ur-btn ur-btn-sm" onClick={() => { void resolveApproval(approval.id, "approved"); }} disabled={busy}>Allow</button>
                  <button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void resolveApproval(approval.id, "denied"); }} disabled={busy}>Deny</button>
                </td>
              </tr>
            ))}
            {approvals.length === 0 && (<tr><td colSpan={6} className="ur-empty">No pending approvals — governed tool calls are either allowed or waiting on grants.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">pao.* Tool Catalog</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Tool</th><th>Group</th><th>Risk</th><th>Mode</th><th>Description</th></tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name}>
                <td className="ur-meta">{tool.name}</td>
                <td>{tool.group}</td>
                <td style={{ color: riskColor(tool.risk) }}>{tool.risk}</td>
                <td>{tool.executable ? "governed" : <span className="ur-meta" title={tool.availableVia}>surface</span>}</td>
                <td className="ur-meta">{tool.description}</td>
              </tr>
            ))}
            {tools.length === 0 && (<tr><td colSpan={5} className="ur-empty">Catalog unavailable.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Model Aliases (LLM Router)</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Alias</th><th>Strategy</th><th>Targets</th><th>Enabled</th></tr>
          </thead>
          <tbody>
            {aliases.map((alias) => (
              <tr key={alias.alias}>
                <td>{alias.alias}</td>
                <td>{alias.strategy ?? "—"}</td>
                <td>{alias.targetCount ?? "—"}</td>
                <td style={{ color: alias.enabled === false ? "#e06c75" : "#35c07d" }}>{alias.enabled === false ? "off" : "on"}</td>
              </tr>
            ))}
            {aliases.length === 0 && (<tr><td colSpan={4} className="ur-empty">No aliases reported by the AI gateway yet.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">System Health</h2>
        <div className="ur-chip-row">
          {health && health.components && Object.entries(health.components).map(([name, component]) => (
            <span key={name} className="ur-chip" style={{ borderColor: (component as { state?: string }).state === "healthy" ? "#35c07d" : "#e2b93b" }}>
              {name}: {(component as { state?: string }).state ?? "optional"}
            </span>
          ))}
        </div>
        <p className="ur-meta">
          Optional integrations degrade rather than fail the workspace. Open WebUI data stays in its own
          volume and store; Pao-hubPro owns policy, approvals, tools and audit (doc §S).
        </p>
      </section>
    </div>
  );
}
