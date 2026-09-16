// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Web GUI Dashboard & Agent Orchestrator Console

import { useState, useEffect, useCallback } from "react";
import "../styles/agent-orchestrator.css";

interface OrchestratorStatus {
  enabled: boolean;
  activeRuntimeType: string;
  registeredRuntimes: string[];
  totalRuns: number;
  activeRuns: number;
  pendingApprovals: number;
  mcpServerCount: number;
  mcpToolCount: number;
  rollbackConfigured: boolean;
}

interface RunItem {
  id: string;
  prompt: string;
  status: string;
  runtimeType: string;
  primaryModel: string;
  modelCallCount: number;
  toolCallCount: number;
  totalCostUsd: number;
  outputText?: string;
  errorText?: string;
  createdAt: string;
}

interface ApprovalItem {
  id: string;
  runId: string;
  toolName: string;
  riskLevel: string;
  actionSummary: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
}

interface McpServerItem {
  id: string;
  serverName: string;
  trustLevel: string;
  status: string;
  toolCount: number;
  endpointOrCommand: string;
}

export function AgentOrchestrator() {
  const [activeTab, setActiveTab] = useState<"overview" | "runs" | "live" | "approvals" | "mcp" | "policies">("overview");
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Live Orchestration Form State
  const [prompt, setPrompt] = useState("");
  const [primaryModel, setPrimaryModel] = useState("claude-3-7-sonnet");
  const [runtimeType, setRuntimeType] = useState<"langchain" | "native">("langchain");
  const [executing, setExecuting] = useState(false);
  const [activeRunResult, setActiveRunResult] = useState<RunItem | null>(null);
  const [runLogs, setRunLogs] = useState<string[]>([]);

  // MCP Add Server State
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerTrust, setNewServerTrust] = useState("approved_third_party");
  const [newServerCmd, setNewServerCmd] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/orchestration/status");
      if (res.ok) {
        const data = (await res.json()) as { status: OrchestratorStatus };
        setStatus(data.status);
      }
    } catch {
      // Ignore network errors in background polling
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/orchestration/runs?limit=25");
      if (res.ok) {
        const data = (await res.json()) as { runs: RunItem[] };
        setRuns(data.runs || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/orchestration/approvals");
      if (res.ok) {
        const data = (await res.json()) as { approvals: ApprovalItem[] };
        setApprovals(data.approvals || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/orchestration/mcp/servers");
      if (res.ok) {
        const data = (await res.json()) as { servers: McpServerItem[] };
        setMcpServers(data.servers || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchStatus(),
      fetchRuns(),
      fetchApprovals(),
      fetchMcpServers(),
    ]);
  }, [fetchStatus, fetchRuns, fetchApprovals, fetchMcpServers]);

  useEffect(() => {
    let active = true;

    const loadAll = () => {
      if (!active) return;
      void refreshAll().finally(() => {
        if (active) setLoading(false);
      });
    };

    const timer = setTimeout(loadAll, 0);
    const interval = setInterval(() => {
      if (!active) return;
      void fetchStatus();
      void fetchApprovals();
    }, 5000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [refreshAll, fetchStatus, fetchApprovals]);

  const handleStartRun = async () => {
    if (!prompt.trim() || executing) return;
    setExecuting(true);
    setRunLogs([`[System] Initializing run on ${runtimeType} runtime with ${primaryModel}...`]);
    try {
      const res = await fetch("/api/agent-os/orchestration/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          primaryModel,
          runtimeType,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { run: RunItem };
        setActiveRunResult(data.run);
        setRunLogs((prev) => [
          ...prev,
          `[Run] ID: ${data.run.id}`,
          `[Run] Status: ${data.run.status}`,
          data.run.outputText ? `[Output] ${data.run.outputText}` : "",
          data.run.errorText ? `[Error] ${data.run.errorText}` : "",
        ]);
        await fetchRuns();
        await fetchStatus();
      } else {
        const err = (await res.json()) as { error?: { message?: string } };
        setRunLogs((prev) => [...prev, `[Error] ${err?.error?.message || "Execution failed"}`]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunLogs((prev) => [...prev, `[Error] ${msg}`]);
    } finally {
      setExecuting(false);
    }
  };

  const handleResolveApproval = async (id: string, approved: boolean) => {
    try {
      const res = await fetch("/api/agent-os/orchestration/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approved, decidedBy: "operator" }),
      });
      if (res.ok) {
        await fetchApprovals();
        await fetchRuns();
        await fetchStatus();
      }
    } catch {
      // Ignore
    }
  };

  const handleAddMcpServer = async () => {
    if (!newServerName.trim()) return;
    try {
      const res = await fetch("/api/agent-os/orchestration/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverName: newServerName.trim(),
          trustLevel: newServerTrust,
          endpointOrCommand: newServerCmd.trim() || "builtin",
        }),
      });
      if (res.ok) {
        setShowMcpModal(false);
        setNewServerName("");
        setNewServerCmd("");
        await fetchMcpServers();
        await fetchStatus();
      }
    } catch {
      // Ignore
    }
  };

  return (
    <div className="agent-orchestrator-container">
      {/* Header */}
      <div className="agent-orchestrator-header">
        <div>
          <h1>Pao-hubPro × LangChain Agent Orchestrator</h1>
          <p>Pluggable Multi-Agent Orchestration, MCP Tools & Policy Governance Layer</p>
        </div>
        <div className="header-status-badge">
          <span className="badge-dot" />
          <span>{status?.activeRuntimeType?.toUpperCase() || "LANGCHAIN"} ACTIVE</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="orchestrator-stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Runs</span>
          <span className="stat-value">{status?.totalRuns ?? (loading ? "..." : 0)}</span>
          <span className="stat-subtext">Lifetime orchestration runs</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active / Paused</span>
          <span className="stat-value">{status?.activeRuns ?? 0}</span>
          <span className="stat-subtext">Currently executing or paused</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pending Approvals</span>
          <span className="stat-value" style={{ color: (status?.pendingApprovals ?? 0) > 0 ? "var(--orch-warning)" : "inherit" }}>
            {status?.pendingApprovals ?? 0}
          </span>
          <span className="stat-subtext">Human-in-the-loop gates</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">MCP Servers</span>
          <span className="stat-value">{status?.mcpServerCount ?? 0}</span>
          <span className="stat-subtext">{status?.mcpToolCount ?? 0} tools cataloged</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="orchestrator-tabs">
        <button
          className={`orchestrator-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`orchestrator-tab ${activeTab === "live" ? "active" : ""}`}
          onClick={() => setActiveTab("live")}
        >
          Live Orchestration
        </button>
        <button
          className={`orchestrator-tab ${activeTab === "runs" ? "active" : ""}`}
          onClick={() => setActiveTab("runs")}
        >
          Runs ({runs.length})
        </button>
        <button
          className={`orchestrator-tab ${activeTab === "approvals" ? "active" : ""}`}
          onClick={() => setActiveTab("approvals")}
        >
          Approvals ({approvals.filter((a) => a.status === "pending").length})
        </button>
        <button
          className={`orchestrator-tab ${activeTab === "mcp" ? "active" : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          MCP Servers ({mcpServers.length})
        </button>
        <button
          className={`orchestrator-tab ${activeTab === "policies" ? "active" : ""}`}
          onClick={() => setActiveTab("policies")}
        >
          Tool Policies
        </button>
      </div>

      {/* Main Content Panels */}
      <div className="orchestrator-content">
        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">System Architecture & Invariants</span>
            </div>
            <div className="orch-timeline">
              <div className="timeline-step">
                <span className="timeline-dot" />
                <span className="timeline-title">LangChain Planning & Coordination</span>
                <span className="timeline-desc">LangChain decides what should happen next; Pao-hubPro decides whether it is allowed to happen.</span>
              </div>
              <div className="timeline-step">
                <span className="timeline-dot" />
                <span className="timeline-title">Pao-hubPro Policy & Permission Middleware</span>
                <span className="timeline-desc">All tool calls pass through risk rating (R0–R4), filesystem containment, and command sanitization.</span>
              </div>
              <div className="timeline-step">
                <span className="timeline-dot" />
                <span className="timeline-title">Multi-Server MCP Tool Integration</span>
                <span className="timeline-desc">Safe tools cataloged from internal, local, and external servers with pre-model filtering.</span>
              </div>
              <div className="timeline-step">
                <span className="timeline-dot" />
                <span className="timeline-title">Codex & Reviewer Council Bridges</span>
                <span className="timeline-desc">Native Codex coding delegation (Phase 20.21) and Reviewer Council evaluation for high-risk actions.</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE ORCHESTRATION */}
        {activeTab === "live" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">Interactive Agent Execution</span>
            </div>
            <div className="orch-form-group">
              <label className="orch-form-label">Task Prompt</label>
              <textarea
                className="orch-textarea"
                placeholder="Describe the agent mission or question..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
              <div className="orch-form-group" style={{ flex: 1 }}>
                <label className="orch-form-label">Primary Model</label>
                <select
                  className="orch-select"
                  value={primaryModel}
                  onChange={(e) => setPrimaryModel(e.target.value)}
                >
                  <option value="claude-3-7-sonnet">Claude 3.7 Sonnet (Recommended)</option>
                  <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
                  <option value="gpt-4o">OpenAI GPT-4o</option>
                  <option value="gpt-4o-mini">OpenAI GPT-4o-mini</option>
                </select>
              </div>
              <div className="orch-form-group" style={{ flex: 1 }}>
                <label className="orch-form-label">Runtime Engine</label>
                <select
                  className="orch-select"
                  value={runtimeType}
                  onChange={(e) => setRuntimeType(e.target.value as "langchain" | "native")}
                >
                  <option value="langchain">LangChain / LangGraph Engine</option>
                  <option value="native">Pao Native Zero-Dependency Runtime</option>
                </select>
              </div>
            </div>
            <button
              className="orch-btn"
              disabled={executing || !prompt.trim()}
              onClick={handleStartRun}
            >
              {executing ? "Executing Agent Mission..." : "Start Agent Run"}
            </button>

            {activeRunResult && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", background: "rgba(99, 102, 241, 0.1)", borderRadius: "0.5rem", border: "1px solid var(--orch-border-active)" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Active Run: {activeRunResult.id}</span>
                <span className={`status-pill status-${activeRunResult.status}`} style={{ marginLeft: "0.75rem" }}>
                  {activeRunResult.status}
                </span>
                <span style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "var(--orch-text-muted)" }}>
                  Calls: {activeRunResult.modelCallCount}m / {activeRunResult.toolCallCount}t | Cost: ${activeRunResult.totalCostUsd.toFixed(4)}
                </span>
              </div>
            )}

            {runLogs.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <span className="orch-form-label">Execution Console & Output</span>
                <div className="code-output" style={{ marginTop: "0.5rem" }}>
                  {runLogs.filter(Boolean).join("\n")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: RUNS */}
        {activeTab === "runs" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">Orchestration Runs History</span>
            </div>
            <table className="orch-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Prompt</th>
                  <th>Runtime</th>
                  <th>Model</th>
                  <th>Calls</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--orch-text-muted)" }}>
                      No orchestration runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: "var(--orch-font-mono)", fontSize: "0.8rem" }}>{r.id.slice(0, 16)}...</td>
                      <td>{r.prompt.length > 40 ? `${r.prompt.slice(0, 40)}...` : r.prompt}</td>
                      <td>{r.runtimeType}</td>
                      <td>{r.primaryModel}</td>
                      <td>{r.modelCallCount}m / {r.toolCallCount}t</td>
                      <td>${r.totalCostUsd.toFixed(4)}</td>
                      <td>
                        <span className={`status-pill status-${r.status}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: APPROVALS */}
        {activeTab === "approvals" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">Human-in-the-Loop Approvals</span>
            </div>
            <table className="orch-table">
              <thead>
                <tr>
                  <th>Tool Name</th>
                  <th>Risk</th>
                  <th>Action Summary</th>
                  <th>Status</th>
                  <th>Expires At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {approvals.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--orch-text-muted)" }}>
                      No pending approvals in queue.
                    </td>
                  </tr>
                ) : (
                  approvals.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.toolName}</td>
                      <td>
                        <span style={{ color: a.riskLevel === "R4" || a.riskLevel === "R3" ? "var(--orch-danger)" : "var(--orch-warning)", fontWeight: 700 }}>
                          {a.riskLevel}
                        </span>
                      </td>
                      <td>{a.actionSummary}</td>
                      <td>
                        <span className={`status-pill status-${a.status}`}>
                          {a.status}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "var(--orch-text-muted)" }}>{new Date(a.expiresAt).toLocaleTimeString()}</td>
                      <td>
                        {a.status === "pending" && (
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              className="orch-btn"
                              style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                              onClick={() => handleResolveApproval(a.id, true)}
                            >
                              Approve
                            </button>
                            <button
                              className="orch-btn orch-btn-danger"
                              style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                              onClick={() => handleResolveApproval(a.id, false)}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 5: MCP SERVERS */}
        {activeTab === "mcp" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">Model Context Protocol (MCP) Multi-Server Catalog</span>
              <button className="orch-btn" onClick={() => setShowMcpModal(true)}>
                + Register Server
              </button>
            </div>
            <table className="orch-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Trust Level</th>
                  <th>Endpoint / Command</th>
                  <th>Tools</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {mcpServers.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.serverName}</td>
                    <td>
                      <span style={{ color: s.trustLevel.includes("trusted") ? "var(--orch-success)" : "var(--orch-accent)" }}>
                        {s.trustLevel}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--orch-font-mono)", fontSize: "0.8rem" }}>{s.endpointOrCommand}</td>
                    <td>{s.toolCount}</td>
                    <td>
                      <span className="status-pill status-completed">{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {showMcpModal && (
              <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(10, 15, 26, 0.8)", borderRadius: "0.5rem", border: "1px solid var(--orch-border)" }}>
                <span className="orch-form-label" style={{ marginBottom: "0.5rem", display: "block" }}>Register New MCP Server</span>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                  <input
                    className="orch-input"
                    placeholder="Server Name (e.g. apify_mcp)"
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <select
                    className="orch-select"
                    value={newServerTrust}
                    onChange={(e) => setNewServerTrust(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="trusted_internal">trusted_internal</option>
                    <option value="trusted_local">trusted_local</option>
                    <option value="approved_third_party">approved_third_party</option>
                    <option value="untrusted_external">untrusted_external</option>
                  </select>
                </div>
                <input
                  className="orch-input"
                  placeholder="Command or Endpoint (e.g. npx -y @modelcontextprotocol/server)"
                  value={newServerCmd}
                  onChange={(e) => setNewServerCmd(e.target.value)}
                  style={{ width: "100%", marginBottom: "1rem" }}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="orch-btn" onClick={handleAddMcpServer}>
                    Save Server
                  </button>
                  <button className="orch-btn orch-btn-secondary" onClick={() => setShowMcpModal(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: TOOL POLICIES */}
        {activeTab === "policies" && (
          <div className="orch-panel">
            <div className="orch-panel-header">
              <span className="orch-panel-title">Tool Risk Governance Matrix</span>
            </div>
            <table className="orch-table">
              <thead>
                <tr>
                  <th>Risk Tier</th>
                  <th>Category</th>
                  <th>Default Gate</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700, color: "var(--orch-success)" }}>R0</td>
                  <td>Harmless Read</td>
                  <td>ALLOW</td>
                  <td>Read file, list dir, get system status, view documentation.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: "var(--orch-accent)" }}>R1</td>
                  <td>State Query</td>
                  <td>ALLOW</td>
                  <td>Web search, database query, lightweight HTTP requests.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: "var(--orch-warning)" }}>R2</td>
                  <td>State Mutation</td>
                  <td>ALLOW (Workspace) / APPROVAL</td>
                  <td>Write or edit file, save dataset, update schema inside designated workspace.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: "var(--orch-danger)" }}>R3</td>
                  <td>Execution / Destructive</td>
                  <td>APPROVAL_REQUIRED</td>
                  <td>Terminal commands, npm/bun test, code execution, git checkout/commit.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: "#e11d48" }}>R4</td>
                  <td>Privileged / Infrastructure</td>
                  <td>COUNCIL_APPROVAL_REQUIRED</td>
                  <td>Kill process, sudo, cloud VM destruction, credential modification.</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
