// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/codex-native-runtime.css";

interface RuntimeStatus {
  enabled: boolean;
  health: {
    status: "healthy" | "degraded" | "unhealthy";
    codex: { installed: boolean; version: string | null };
    sdk: { available: boolean };
    appServer: { available: boolean; initialized: boolean };
    daemon: { enabled: boolean; status: string };
    mcp: { healthy: boolean; toolCount: number };
    timestamp: string;
  };
  capabilities: {
    codexInstalled: boolean;
    codexVersion: string | null;
    pythonSdkAvailable: boolean;
    appServerAvailable: boolean;
    execServerAvailable: boolean;
    daemonAvailable: boolean;
    remoteControlAvailable: boolean;
    mcpAvailable: boolean;
    experimentalApiEnabled: boolean;
    platform: string;
  };
  activeSessions: number;
  activeTurns: number;
  pendingApprovals: number;
  policyProfile: "SAFE" | "NORMAL" | "AUTOMATION" | "FULL_ACCESS";
  runtimeMode: string;
  localNodeId: string;
}

interface SessionItem {
  id: string;
  threadId: string | null;
  workspaceRoot: string;
  nodeId: string;
  runtimeMode: string;
  status: string;
  policyProfile: string;
  title: string | null;
  activeTurnId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalItem {
  id: string;
  sessionId: string;
  turnId: string | null;
  nodeId: string;
  toolName: string;
  command?: string;
  path?: string;
  networkIntent?: string;
  riskLevel: "low" | "medium" | "high";
  status: string;
  requestedAt: string;
  expiresAt: string;
}

interface ToolItem {
  id: string;
  serverName: string;
  toolName: string;
  description: string;
  risk: "low" | "medium" | "high";
  approvalBehavior: "auto" | "ask" | "deny";
  source: string;
  health: string;
  updatedAt: string;
}

interface AuditItem {
  id: string;
  timestamp: string;
  actor: string;
  sessionId?: string | null;
  turnId?: string | null;
  action: string;
  risk: string;
  result: string;
  metadata: Record<string, unknown>;
}

export function CodexNativeRuntime() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "sessions" | "live" | "approvals" | "policies" | "tools" | "audit"
  >("overview");

  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  // New Session State
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPolicy, setNewPolicy] = useState<"SAFE" | "NORMAL" | "AUTOMATION">("NORMAL");

  // Live Turn State
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [turnPrompt, setTurnPrompt] = useState("");
  const [turnExecuting, setTurnExecuting] = useState(false);
  const [turnProgressText, setTurnProgressText] = useState("");
  const [turnProgressPercent, setTurnProgressPercent] = useState(0);
  const [turnLogs, setTurnLogs] = useState<string[]>([]);

  // Full Access Unlock Modal
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(15);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch {
      // offline / mock status
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/approvals");
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/tools");
      if (res.ok) {
        const data = await res.json();
        setTools(data.tools || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/audit");
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchStatus(),
      fetchSessions(),
      fetchApprovals(),
      fetchTools(),
      fetchAuditLogs(),
    ]);
  }, [fetchStatus, fetchSessions, fetchApprovals, fetchTools, fetchAuditLogs]);

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

  const handleCreateSession = async () => {
    if (!newWorkspace) return;
    try {
      const res = await fetch("/api/agent-os/codex-runtime/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceRoot: newWorkspace,
          title: newTitle || undefined,
          policyProfile: newPolicy,
        }),
      });
      if (res.ok) {
        setShowNewSessionModal(false);
        setNewWorkspace("");
        setNewTitle("");
        await fetchSessions();
      }
    } catch {
      // ignore
    }
  };

  const handleExecuteTurn = async () => {
    if (!selectedSessionId || !turnPrompt || turnExecuting) return;
    setTurnExecuting(true);
    setTurnProgressPercent(15);
    setTurnProgressText("Initiating turn with Codex runtime...");
    setTurnLogs((prev) => [...prev, `[USER] ${turnPrompt}`]);

    try {
      const res = await fetch("/api/agent-os/codex-runtime/turns/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          prompt: turnPrompt,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setTurnProgressPercent(100);
        setTurnProgressText("Turn completed successfully");
        setTurnLogs((prev) => [
          ...prev,
          `[CODEX] ${data.turn?.resultSummary || "Completed task instructions."}`,
        ]);
        setTurnPrompt("");
        await fetchSessions();
      } else {
        const err = await res.json();
        setTurnProgressText(`Turn failed: ${err.error?.message || "Unknown error"}`);
        setTurnLogs((prev) => [...prev, `[ERROR] ${err.error?.message || "Failed"}`]);
      }
    } catch (err: unknown) {
      setTurnProgressText("Turn request network error");
      setTurnLogs((prev) => [
        ...prev,
        `[NETWORK ERROR] ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setTurnExecuting(false);
    }
  };

  const handleResolveApproval = async (approvalId: string, decision: "allow" | "deny") => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          decision,
          operator: "dashboard_operator",
        }),
      });
      if (res.ok) {
        await fetchApprovals();
        await fetchAuditLogs();
      }
    } catch {
      // ignore
    }
  };

  const handleUnlockFullAccess = async () => {
    if (!operatorName) return;
    try {
      const res = await fetch("/api/agent-os/codex-runtime/policies/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator: operatorName,
          ttlSeconds: ttlMinutes * 60,
        }),
      });
      if (res.ok) {
        setShowUnlockModal(false);
        setOperatorName("");
        await fetchStatus();
      }
    } catch {
      // ignore
    }
  };

  const handleSyncSchema = async () => {
    try {
      const res = await fetch("/api/agent-os/codex-runtime/schema/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimental: false }),
      });
      if (res.ok) {
        alert("Schema sync completed successfully!");
      }
    } catch {
      alert("Failed to sync schemas.");
    }
  };

  return (
    <div className="codex-runtime-container">
      {/* Header */}
      <div className="codex-runtime-header">
        <div>
          <h1>Pao-hubPro × OpenAI Codex Native Runtime</h1>
          <p style={{ color: "#94a3b8", margin: "0.25rem 0 0 0", fontSize: "0.9rem" }}>
            Enterprise control plane orchestrating official machine-readable Codex runtime
          </p>
        </div>
        <div className="header-badges">
          {status && (
            <>
              <span className={`badge badge-${status.health.status}`}>
                {status.health.status}
              </span>
              <span className="badge badge-mode">
                Mode: {status.runtimeMode}
              </span>
              <span className="badge badge-platform">
                {status.capabilities.platform}
              </span>
              {status.policyProfile === "FULL_ACCESS" && (
                <span className="badge badge-full-access">
                  ⚠️ FULL ACCESS ACTIVE
                </span>
              )}
            </>
          )}
          <button className="btn-secondary" onClick={() => void refreshAll()}>
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="codex-runtime-tabs">
        <button
          className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          Sessions ({sessions.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "live" ? "active" : ""}`}
          onClick={() => setActiveTab("live")}
        >
          Live Turn
        </button>
        <button
          className={`tab-btn ${activeTab === "approvals" ? "active" : ""}`}
          onClick={() => setActiveTab("approvals")}
        >
          Approval Center
          {approvals.filter((a) => a.status === "pending").length > 0 && (
            <span className="tab-badge">
              {approvals.filter((a) => a.status === "pending").length}
            </span>
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === "policies" ? "active" : ""}`}
          onClick={() => setActiveTab("policies")}
        >
          Policies
        </button>
        <button
          className={`tab-btn ${activeTab === "tools" ? "active" : ""}`}
          onClick={() => setActiveTab("tools")}
        >
          Tool & MCP Inventory ({tools.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          Audit Log ({auditLogs.length})
        </button>
      </div>

      {/* Content Area */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>
          Loading Codex runtime state...
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && status && (
            <div>
              <div className="overview-grid">
                <div className="stat-card">
                  <div className="stat-label">Codex Installation</div>
                  <div className="stat-value">
                    {status.capabilities.codexVersion || "Not Detected"}
                  </div>
                  <div className="stat-sub">
                    Binary: {status.capabilities.codexInstalled ? "Ready" : "Missing"}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Active Sessions</div>
                  <div className="stat-value">{status.activeSessions}</div>
                  <div className="stat-sub">{sessions.length} total sessions tracked</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Pending Approvals</div>
                  <div className="stat-value" style={{ color: status.pendingApprovals > 0 ? "#f87171" : "#4ade80" }}>
                    {status.pendingApprovals}
                  </div>
                  <div className="stat-sub">Bounded timeout safety active</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Current Policy Profile</div>
                  <div className="stat-value">{status.policyProfile}</div>
                  <div className="stat-sub">Default: NORMAL (workspace-write)</div>
                </div>
              </div>

              {/* Subsystems */}
              <div className="table-container" style={{ padding: "1.25rem" }}>
                <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Runtime Subsystems & Capabilities</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                  <div>
                    <strong>App Server (stdio JSON-RPC):</strong>{" "}
                    <span style={{ color: status.capabilities.appServerAvailable ? "#4ade80" : "#f87171" }}>
                      {status.capabilities.appServerAvailable ? "Available" : "Unavailable"}
                    </span>
                  </div>
                  <div>
                    <strong>Exec Server:</strong>{" "}
                    <span style={{ color: status.capabilities.execServerAvailable ? "#4ade80" : "#f87171" }}>
                      {status.capabilities.execServerAvailable ? "Available" : "Unavailable"}
                    </span>
                  </div>
                  <div>
                    <strong>Python SDK:</strong>{" "}
                    <span style={{ color: status.capabilities.pythonSdkAvailable ? "#4ade80" : "#94a3b8" }}>
                      {status.capabilities.pythonSdkAvailable ? "Installed" : "Not Installed"}
                    </span>
                  </div>
                  <div>
                    <strong>App Server Daemon:</strong>{" "}
                    <span style={{ color: status.capabilities.daemonAvailable ? "#93c5fd" : "#94a3b8" }}>
                      {status.capabilities.daemonAvailable ? "Supported (Experimental)" : "Unsupported"}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
                  <button className="btn-primary" onClick={() => void handleSyncSchema()}>
                    Synchronize Schemas (generate-ts)
                  </button>
                  <button className="btn-secondary" onClick={() => setActiveTab("sessions")}>
                    Manage Sessions
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SESSIONS */}
          {activeTab === "sessions" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                <h3 style={{ margin: 0 }}>Registered Sessions</h3>
                <button className="btn-primary" onClick={() => setShowNewSessionModal(true)}>
                  + New Session
                </button>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Policy</th>
                      <th>Workspace</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                          No sessions created yet. Click "+ New Session" to start.
                        </td>
                      </tr>
                    ) : (
                      sessions.map((s) => (
                        <tr key={s.id}>
                          <td><code>{s.id}</code></td>
                          <td><strong>{s.title || "Untitled"}</strong></td>
                          <td>
                            <span className={`badge ${s.status === "running" ? "badge-healthy" : "badge-mode"}`}>
                              {s.status}
                            </span>
                          </td>
                          <td>{s.policyProfile}</td>
                          <td><code>{s.workspaceRoot}</code></td>
                          <td>{new Date(s.createdAt).toLocaleTimeString()}</td>
                          <td>
                            <button
                              className="btn-secondary"
                              style={{ marginRight: "0.4rem" }}
                              onClick={() => {
                                setSelectedSessionId(s.id);
                                setActiveTab("live");
                              }}
                            >
                              Run Turn
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: LIVE TURN */}
          {activeTab === "live" && (
            <div>
              <div className="turn-live-view">
                <h3 style={{ margin: "0 0 1rem 0" }}>Live Turn Execution Console</h3>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                  <select
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    style={{
                      background: "rgba(30, 41, 59, 0.8)",
                      color: "#fff",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      borderRadius: "6px",
                      padding: "0.5rem",
                    }}
                  >
                    <option value="">Select Session...</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title || s.id} ({s.status})
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    placeholder="Enter coding task prompt..."
                    value={turnPrompt}
                    onChange={(e) => setTurnPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleExecuteTurn()}
                    style={{
                      flex: 1,
                      background: "rgba(30, 41, 59, 0.8)",
                      color: "#fff",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      borderRadius: "6px",
                      padding: "0.5rem 1rem",
                    }}
                  />

                  <button
                    className="btn-primary"
                    disabled={turnExecuting || !selectedSessionId || !turnPrompt}
                    onClick={() => void handleExecuteTurn()}
                  >
                    {turnExecuting ? "Executing..." : "Start Turn"}
                  </button>
                </div>

                {turnExecuting && (
                  <div>
                    <div className="turn-progress-bar">
                      <div className="turn-progress-fill" style={{ width: `${turnProgressPercent}%` }} />
                    </div>
                    <div style={{ color: "#93c5fd", fontSize: "0.85rem" }}>{turnProgressText}</div>
                  </div>
                )}

                <div
                  style={{
                    marginTop: "1rem",
                    background: "rgba(0, 0, 0, 0.4)",
                    padding: "1rem",
                    borderRadius: "8px",
                    minHeight: "180px",
                    maxHeight: "350px",
                    overflowY: "auto",
                  }}
                >
                  {turnLogs.length === 0 ? (
                    <span style={{ color: "#64748b" }}>Execution event stream will appear here...</span>
                  ) : (
                    turnLogs.map((log, idx) => (
                      <div key={idx} style={{ marginBottom: "0.4rem", whiteSpace: "pre-wrap" }}>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: APPROVALS */}
          {activeTab === "approvals" && (
            <div>
              <h3 style={{ margin: "0 0 1rem 0" }}>Approval Center (Security Gatekeeper)</h3>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Tool</th>
                      <th>Command / Target</th>
                      <th>Risk</th>
                      <th>Status</th>
                      <th>Requested At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                          No approval requests pending. Safe autonomous operations in progress.
                        </td>
                      </tr>
                    ) : (
                      approvals.map((a) => (
                        <tr key={a.id}>
                          <td><code>{a.id}</code></td>
                          <td><strong>{a.toolName}</strong></td>
                          <td><code>{a.command || a.path || a.networkIntent || "N/A"}</code></td>
                          <td>
                            <span className={`badge ${a.riskLevel === "high" ? "badge-unhealthy" : "badge-degraded"}`}>
                              {a.riskLevel}
                            </span>
                          </td>
                          <td>{a.status}</td>
                          <td>{new Date(a.requestedAt).toLocaleTimeString()}</td>
                          <td>
                            {a.status === "pending" && (
                              <div style={{ display: "flex", gap: "0.4rem" }}>
                                <button
                                  className="btn-primary"
                                  onClick={() => void handleResolveApproval(a.id, "allow")}
                                >
                                  Approve
                                </button>
                                <button
                                  className="btn-danger"
                                  onClick={() => void handleResolveApproval(a.id, "deny")}
                                >
                                  Deny
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
            </div>
          )}

          {/* TAB 5: POLICIES */}
          {activeTab === "policies" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                <h3 style={{ margin: 0 }}>Sandbox & Policy Profiles</h3>
                {status?.policyProfile !== "FULL_ACCESS" && (
                  <button className="btn-danger" onClick={() => setShowUnlockModal(true)}>
                    ⚠️ Unlock FULL ACCESS (Temporary)
                  </button>
                )}
              </div>

              <div className="overview-grid">
                <div className="stat-card" style={{ borderLeft: "4px solid #4ade80" }}>
                  <div className="stat-label">SAFE (Read-Only)</div>
                  <div className="stat-sub">
                    Write: Denied<br />
                    Network: Restricted<br />
                    Destructive tools: Blocked<br />
                    Approvals: Always required for state changes
                  </div>
                </div>

                <div className="stat-card" style={{ borderLeft: "4px solid #3b82f6" }}>
                  <div className="stat-label">NORMAL (Default)</div>
                  <div className="stat-sub">
                    Write: Workspace Root Only<br />
                    Network: Restricted<br />
                    Destructive tools: Approval Required<br />
                    Containment: Traversal & symlink defense active
                  </div>
                </div>

                <div className="stat-card" style={{ borderLeft: "4px solid #a855f7" }}>
                  <div className="stat-label">AUTOMATION</div>
                  <div className="stat-sub">
                    Write: Workspace Root Only<br />
                    Network: Allowlist Only (github, npm, pypi)<br />
                    Known-safe tools: Policy-driven<br />
                    Destructive tools: Approval Required
                  </div>
                </div>

                <div className="stat-card" style={{ borderLeft: "4px solid #ef4444" }}>
                  <div className="stat-label">FULL ACCESS (Emergency)</div>
                  <div className="stat-sub">
                    Write: Unrestricted<br />
                    Network: Enabled<br />
                    TTL Countdown: Enforced<br />
                    Audit: High-severity event logged
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: TOOLS & MCP */}
          {activeTab === "tools" && (
            <div>
              <h3 style={{ margin: "0 0 1rem 0" }}>Tool & MCP Inventory</h3>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Server / Source</th>
                      <th>Description</th>
                      <th>Risk</th>
                      <th>Approval Mode</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((t) => (
                      <tr key={t.id}>
                        <td><strong>{t.toolName}</strong></td>
                        <td><code>{t.serverName} ({t.source})</code></td>
                        <td>{t.description}</td>
                        <td>
                          <span className={`badge ${t.risk === "high" ? "badge-unhealthy" : t.risk === "medium" ? "badge-degraded" : "badge-healthy"}`}>
                            {t.risk}
                          </span>
                        </td>
                        <td>{t.approvalBehavior}</td>
                        <td>
                          <span className="badge badge-healthy">{t.health}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: AUDIT LOG */}
          {activeTab === "audit" && (
            <div>
              <h3 style={{ margin: "0 0 1rem 0" }}>Immutable Audit Trail (Secret Redacted)</h3>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Risk</th>
                      <th>Result</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                        <td><code>{log.actor}</code></td>
                        <td><strong>{log.action}</strong></td>
                        <td>
                          <span className={`badge ${log.risk === "high" ? "badge-unhealthy" : "badge-mode"}`}>
                            {log.risk}
                          </span>
                        </td>
                        <td>{log.result}</td>
                        <td><code>{JSON.stringify(log.metadata)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* New Session Modal */}
      {showNewSessionModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Start New Codex Session</h3>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem" }}>
                Workspace Root Directory:
              </label>
              <input
                type="text"
                placeholder="C:\path\to\workspace or /path/to/repo"
                value={newWorkspace}
                onChange={(e) => setNewWorkspace(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                }}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem" }}>
                Session Title (Optional):
              </label>
              <input
                type="text"
                placeholder="My Feature Branch"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                }}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem" }}>
                Policy Profile:
              </label>
              <select
                value={newPolicy}
                onChange={(e) => setNewPolicy(e.target.value as "SAFE" | "NORMAL" | "AUTOMATION")}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                }}
              >
                <option value="NORMAL">NORMAL (Workspace Write Only)</option>
                <option value="SAFE">SAFE (Read Only)</option>
                <option value="AUTOMATION">AUTOMATION (Allowlist Network)</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="btn-secondary" onClick={() => setShowNewSessionModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void handleCreateSession()}>
                Create Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Full Access Modal */}
      {showUnlockModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ border: "2px solid #ef4444" }}>
            <h3 style={{ color: "#ef4444" }}>⚠️ Unlock FULL ACCESS Privileges</h3>
            <p style={{ fontSize: "0.85rem", color: "#fca5a5" }}>
              FULL ACCESS disables workspace containment and network restrictions. It will
              automatically revert after the TTL countdown and generate high-severity audit logs.
            </p>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem" }}>
                Operator Name (Required for Audit):
              </label>
              <input
                type="text"
                placeholder="Your Name / ID"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                }}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem" }}>
                TTL Expiration (Minutes):
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="btn-secondary" onClick={() => setShowUnlockModal(false)}>
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={!operatorName}
                onClick={() => void handleUnlockFullAccess()}
              >
                Confirm & Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
