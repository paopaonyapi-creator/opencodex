// Phase 20.9 — Pao-hubPro × Chatbox Agent Control Center
// State-of-the-Art Desktop Agent Operating Layer Dashboard
// Premium UI: Glassmorphism, Micro-animations, Terminal Mission Input

import { Fragment, useEffect, useState } from "react";
import {
  IconTerminal,
  IconServer,
  IconBoxes,
  IconLock,
  IconRefresh,
  IconPlay,
  IconCheck,
  IconX,
  IconPlus,
  IconTrash,
} from "../icons";
import "../styles/agent-control-center.css";

interface RuntimeStatus {
  activeMode: "off" | "ask" | "safe_auto" | "full_auto";
  counts: {
    providers: number;
    tools: number;
    mcpServers: number;
    skills: number;
    pendingApprovals: number;
    recentRuns: number;
  };
}

interface AgentRun {
  id: string;
  mission: string;
  agentMode: string;
  providerId?: string;
  modelId?: string;
  status: string;
  activeTools: string[];
  activeSkills: string[];
  currentTask?: string;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
}

interface ApprovalCard {
  id: string;
  runId: string;
  tool: string;
  server?: string;
  risk: "read_only" | "low" | "medium" | "high" | "critical";
  arguments: Record<string, unknown>;
  affectedFiles?: string[];
  command?: string;
  reason?: string;
  estimatedSideEffects?: string[];
  requestedAt: string;
}

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  trustLevel?: "trusted" | "untrusted";
  healthStatus?: string;
  enabled?: boolean;
}

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    tools: boolean;
    vision: boolean;
    reasoning: boolean;
    structuredOutput: boolean;
    streaming: boolean;
    maxContext?: number;
  };
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  version: string;
  sourcePath: string;
  enabled: boolean;
  validationStatus: "valid" | "invalid" | "untrusted";
}

interface AuditItem {
  id: string;
  timestamp: string;
  eventType: string;
  tool?: string;
  risk?: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface GovernanceStatus {
  success?: boolean;
  config: {
    enabled: boolean;
    defaultMode: string;
    strictness: string;
    maxDiffFilesForSmallFix: number;
    requireCouncilForHighRisk: boolean;
  };
  ladder?: string[];
}

interface DebtItem {
  id: string;
  date: string;
  area: string;
  shortcut: string;
  reason: string;
  risk: string;
  triggerToRevisit: string;
  owner: string;
  status: "open" | "resolved" | "wontfix";
}

const TRANSPORT_OPTIONS = ["stdio", "http", "sse"] as const;
const TRUST_OPTIONS = ["untrusted", "trusted"] as const;
const GIT_PUSH_OPTIONS = ["ask", "always", "deny"] as const;
const FORCE_PUSH_OPTIONS = ["false", "true"] as const;

const MODE_CONFIG = [
  { id: "off" as const, title: "OFF", desc: "Chat-only. All tool execution disabled.", icon: "🔴" },
  { id: "ask" as const, title: "ASK (Supervised)", desc: "Every tool requires explicit human confirmation.", icon: "🟡" },
  { id: "safe_auto" as const, title: "SAFE AUTO", desc: "Read-only & low-risk auto-execute. High/critical asks approval.", icon: "🟢" },
  { id: "full_auto" as const, title: "FULL AUTO", desc: "Autonomous execution. Critical always asks approval.", icon: "🟣" },
] as const;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function AgentControlCenter({ apiBase = "" }: { apiBase?: string }) {
  const [activeTab, setActiveTab] = useState<"control" | "mcp" | "providers" | "skills" | "security">("control");

  // State
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalCard[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditItem[]>([]);
  const [govStatus, setGovStatus] = useState<GovernanceStatus | null>(null);
  const [debts, setDebts] = useState<DebtItem[]>([]);

  // Mission Launcher
  const [missionInput, setMissionInput] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [launching, setLaunching] = useState(false);

  // New MCP Server Form
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpTransport, setNewMcpTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpTrust, setNewMcpTrust] = useState<"trusted" | "untrusted">("untrusted");

  // Policy Settings
  const [allowedRoots, setAllowedRoots] = useState("");
  const [allowPush, setAllowPush] = useState("ask");
  const [allowForcePush, setAllowForcePush] = useState(false);

  // Expandable runs
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const [statusRes, runsRes, approvalsRes, auditRes, mcpRes, provRes, skillsRes, polRes, govRes, debtRes] = await Promise.all([
          fetch(`${apiBase}/api/desktop-agent/status`),
          fetch(`${apiBase}/api/desktop-agent/runs?limit=15`),
          fetch(`${apiBase}/api/desktop-agent/approvals`),
          fetch(`${apiBase}/api/desktop-agent/audit?limit=25`),
          fetch(`${apiBase}/api/desktop-agent/mcp/servers`),
          fetch(`${apiBase}/api/desktop-agent/providers`),
          fetch(`${apiBase}/api/desktop-agent/skills`),
          fetch(`${apiBase}/api/desktop-agent/policies`),
          fetch(`${apiBase}/api/desktop-agent/governance/status`).catch(() => null),
          fetch(`${apiBase}/api/desktop-agent/governance/debt`).catch(() => null),
        ]);

        if (!active) return;

        if (statusRes.ok) setStatus(await statusRes.json());
        if (runsRes.ok) {
          const d = await runsRes.json();
          setRuns(d.runs || []);
        }
        if (approvalsRes.ok) {
          const d = await approvalsRes.json();
          setApprovals(d.approvals || []);
        }
        if (auditRes.ok) {
          const d = await auditRes.json();
          setAuditEvents(d.events || []);
        }
        if (mcpRes.ok) {
          const d = await mcpRes.json();
          setMcpServers(d.servers || []);
        }
        if (provRes.ok) {
          const d = await provRes.json();
          setModels(d.models || []);
        }
        if (skillsRes.ok) {
          const d = await skillsRes.json();
          setSkills(d.skills || []);
        }
        if (polRes.ok) {
          const d = await polRes.json();
          if (d.policy) {
            setAllowedRoots(d.policy.allowedRoots?.join("\n") || "");
            setAllowPush(d.policy.gitPolicy?.allowPush || "ask");
            setAllowForcePush(Boolean(d.policy.gitPolicy?.allowForcePush));
          }
        }
        if (govRes && govRes.ok) {
          const d = await govRes.json();
          setGovStatus(d);
        }
        if (debtRes && debtRes.ok) {
          const d = await debtRes.json();
          setDebts(d.debts || []);
        }
      } catch {
        // ignore
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [apiBase, refreshKey]);

  async function handleModeChange(newMode: "off" | "ask" | "safe_auto" | "full_auto") {
    try {
      const res = await fetch(`${apiBase}/api/desktop-agent/modes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        triggerRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleLaunchMission() {
    if (!missionInput.trim()) return;
    setLaunching(true);
    try {
      const res = await fetch(`${apiBase}/api/desktop-agent/runs?async=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: missionInput.trim(),
          providerId: selectedProvider,
          modelId: selectedModel,
        }),
      });
      if (res.ok) {
        setMissionInput("");
        triggerRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLaunching(false);
    }
  }

  async function handleApproval(id: string, decision: "approve_once" | "approve_session" | "reject") {
    try {
      const res = await fetch(`${apiBase}/api/desktop-agent/approvals/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        triggerRefresh();
      } else {
        const err = await res.json();
        console.warn(err);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCancelRun(runId: string) {
    try {
      await fetch(`${apiBase}/api/desktop-agent/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Operator cancelled via Control Center" }),
      });
      triggerRefresh();
    } catch {
      // ignore
    }
  }

  async function handleAddMcpServer(e: React.FormEvent) {
    e.preventDefault();
    if (!newMcpName) return;
    try {
      const id = newMcpName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const args = newMcpArgs.split(" ").filter(Boolean);
      const res = await fetch(`${apiBase}/api/desktop-agent/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: newMcpName,
          transport: newMcpTransport,
          command: newMcpCommand || undefined,
          args: args.length > 0 ? args : undefined,
          url: newMcpUrl || undefined,
          trustLevel: newMcpTrust,
        }),
      });
      if (res.ok) {
        setNewMcpName("");
        setNewMcpCommand("");
        setNewMcpArgs("");
        setNewMcpUrl("");
        triggerRefresh();
      } else {
        const err = await res.json();
        console.warn(err);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteMcpServer(id: string) {
    try {
      await fetch(`${apiBase}/api/desktop-agent/mcp/servers/${id}`, { method: "DELETE" });
      triggerRefresh();
    } catch {
      // ignore
    }
  }

  async function handleTestMcpHealth(id: string) {
    try {
      const res = await fetch(`${apiBase}/api/desktop-agent/mcp/servers/${id}/health`, { method: "POST" });
      if (res.ok) {
        triggerRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSavePolicy() {
    try {
      const roots = allowedRoots.split("\n").map((r) => r.trim()).filter(Boolean);
      const res = await fetch(`${apiBase}/api/desktop-agent/policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedRoots: roots,
          gitPolicy: {
            allowPush,
            allowForcePush,
          },
        }),
      });
      if (res.ok) {
        console.info("Security policy updated");
      }
    } catch (err) {
      console.error(err);
    }
  }

  const activeMode = status?.activeMode || "ask";
  const runningCount = runs.filter((r) => r.status === "RUNNING" || r.status === "EXECUTING").length;

  return (
    <div className="agent-control-center">
      {/* ─── Hero Header ─── */}
      <header className="acc-header">
        <div className="acc-title-group">
          <h1>Pao-hubPro Agent Desktop Runtime</h1>
          <p className="acc-subtitle">
            Autonomous Operating Layer • Multi-Model Providers • Pre-spawn MCP Guard • Zero GPL Clean-Room
          </p>
        </div>

        <div className="acc-header-actions">
          <div className="acc-mode-badge">
            <span className={`mode-dot ${activeMode}`} />
            <span>{activeMode.replace("_", " ").toUpperCase()}</span>
          </div>

          <button
            type="button"
            className="acc-btn acc-btn-secondary"
            onClick={() => triggerRefresh()}
          >
            <IconRefresh /> Refresh
          </button>
        </div>
      </header>

      {/* ─── Live System Stats ─── */}
      <div className="acc-live-stats">
        <div className="acc-live-stat">
          <span className="stat-label">Approvals</span>
          <span className={`stat-value ${approvals.length > 0 ? "warning" : "success"}`}>
            {approvals.length}
          </span>
        </div>
        <div className="acc-live-stat">
          <span className="stat-label">Tools</span>
          <span className="stat-value">{status?.counts.tools ?? 0}</span>
        </div>
        <div className="acc-live-stat">
          <span className="stat-label">MCP</span>
          <span className="stat-value">{status?.counts.mcpServers ?? 0}</span>
        </div>
        <div className="acc-live-stat">
          <span className="stat-label">Skills</span>
          <span className="stat-value">{status?.counts.skills ?? 0}</span>
        </div>
        <div className="acc-live-stat">
          <span className="stat-label">Running</span>
          <span className={`stat-value ${runningCount > 0 ? "warning" : ""}`}>
            {runningCount}
          </span>
        </div>
        <div className="acc-live-stat">
          <span className="stat-label">Total Runs</span>
          <span className="stat-value">{status?.counts.recentRuns ?? 0}</span>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <nav className="acc-tabs">
        <button
          type="button"
          className={`acc-tab-btn ${activeTab === "control" ? "active" : ""}`}
          onClick={() => setActiveTab("control")}
        >
          <IconTerminal /> Control Center
        </button>
        <button
          type="button"
          className={`acc-tab-btn ${activeTab === "mcp" ? "active" : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          <IconServer /> MCP Servers ({status?.counts.mcpServers ?? 0})
        </button>
        <button
          type="button"
          className={`acc-tab-btn ${activeTab === "providers" ? "active" : ""}`}
          onClick={() => setActiveTab("providers")}
        >
          <IconBoxes /> Providers & Models
        </button>
        <button
          type="button"
          className={`acc-tab-btn ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          <IconPlay /> Skills ({status?.counts.skills ?? 0})
        </button>
        <button
          type="button"
          className={`acc-tab-btn ${activeTab === "security" ? "active" : ""}`}
          onClick={() => setActiveTab("security")}
        >
          <IconLock /> Security & Policies
        </button>
      </nav>

      {/* ═══ TAB 1: Control Center ═══ */}
      {activeTab === "control" && (
        <>
          {/* Stats */}
          <div className="acc-stats-grid">
            <div className="acc-stat-card">
              <span className="acc-stat-label">Pending Approvals</span>
              <span className="acc-stat-val" style={{ color: approvals.length > 0 ? "#fbbf24" : "#34d399" }}>
                {approvals.length}
              </span>
            </div>
            <div className="acc-stat-card">
              <span className="acc-stat-label">Registered Tools</span>
              <span className="acc-stat-val">{status?.counts.tools ?? 0}</span>
            </div>
            <div className="acc-stat-card">
              <span className="acc-stat-label">Active MCP Servers</span>
              <span className="acc-stat-val">{status?.counts.mcpServers ?? 0}</span>
            </div>
            <div className="acc-stat-card">
              <span className="acc-stat-label">Recorded Runs</span>
              <span className="acc-stat-val">{status?.counts.recentRuns ?? 0}</span>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>Agent Autonomy Mode</h2>
              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                Select how autonomously tool actions execute
              </span>
            </div>

            <div className="acc-mode-selector">
              {MODE_CONFIG.map((mode) => (
                <div
                  key={mode.id}
                  className={`acc-mode-option ${activeMode === mode.id ? "active" : ""}`}
                  onClick={() => void handleModeChange(mode.id)}
                >
                  <div className="acc-mode-option-head">
                    <span className="acc-mode-option-title">{mode.icon} {mode.title}</span>
                    <span className={`mode-dot ${mode.id}`} />
                  </div>
                  <span className="acc-mode-option-desc">{mode.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Approvals */}
          {approvals.length > 0 && (
            <div className="acc-card" style={{ borderColor: "rgba(245, 158, 11, 0.3)" }}>
              <div className="acc-card-head">
                <h2 style={{ color: "#fbbf24" }}>⚠ Pending Human Approvals ({approvals.length})</h2>
                <span style={{ fontSize: "0.8rem", color: "#f59e0b" }}>
                  Human-in-the-Loop authorization required
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {approvals.map((appr) => (
                  <div key={appr.id} className={`acc-approval-card ${appr.risk}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ color: "#e2e8f0" }}>🔧 {appr.tool}</strong>
                      <span className={`acc-badge ${appr.risk}`}>{appr.risk.toUpperCase()}</span>
                    </div>

                    <div className="acc-approval-meta">
                      <span>Run: {appr.runId.slice(0, 12)}…</span>
                      {appr.command && <span>⌘ {appr.command}</span>}
                      {appr.affectedFiles && appr.affectedFiles.length > 0 && (
                        <span>📁 {appr.affectedFiles.join(", ")}</span>
                      )}
                      <span>🕐 {timeAgo(appr.requestedAt)}</span>
                    </div>

                    {appr.reason && (
                      <p style={{ margin: "0.25rem 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                        💬 {appr.reason}
                      </p>
                    )}

                    {appr.estimatedSideEffects && appr.estimatedSideEffects.length > 0 && (
                      <p style={{ margin: "0.25rem 0", fontSize: "0.78rem", color: "#f97316" }}>
                        ⚡ Side Effects: {appr.estimatedSideEffects.join(", ")}
                      </p>
                    )}

                    <div className="acc-approval-actions">
                      <button
                        type="button"
                        className="acc-btn acc-btn-success"
                        onClick={() => void handleApproval(appr.id, "approve_once")}
                      >
                        <IconCheck /> Approve Once
                      </button>

                      {appr.risk !== "critical" && (
                        <button
                          type="button"
                          className="acc-btn acc-btn-secondary"
                          onClick={() => void handleApproval(appr.id, "approve_session")}
                        >
                          Approve Session
                        </button>
                      )}

                      <button
                        type="button"
                        className="acc-btn acc-btn-danger"
                        onClick={() => void handleApproval(appr.id, "reject")}
                      >
                        <IconX /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mission Launcher */}
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🚀 Launch Agent Mission</h2>
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div className="acc-form-group" style={{ flex: 1, minWidth: "300px" }}>
                <label>Mission Objective</label>
                <div className="acc-mission-terminal">
                  <textarea
                    className="acc-textarea"
                    rows={3}
                    value={missionInput}
                    onChange={(e) => setMissionInput(e.target.value)}
                    placeholder="Describe what the agent should accomplish..."
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}><code>Presets:</code></span>
                  <button
                    type="button"
                    className="acc-btn acc-btn-secondary"
                    style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                    onClick={() => setMissionInput("Scan emerging commercial stock niches using builtin__campaign_scan_trends and rank by NVS.")}
                  >
                    <code>📈 Scan Stock Trends</code>
                  </button>
                  <button
                    type="button"
                    className="acc-btn acc-btn-secondary"
                    style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                    onClick={() => setMissionInput("Plan an autonomous 25-asset commercial stock media campaign matrix with diverse lighting and camera angles.")}
                  >
                    <code>📋 Plan Stock Campaign</code>
                  </button>
                  <button
                    type="button"
                    className="acc-btn acc-btn-secondary"
                    style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                    onClick={() => setMissionInput("Dispatch the latest planned stock campaign into the generation queue and sync execution status.")}
                  >
                    <code>⚡ Dispatch & Sync</code>
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: "200px" }}>
                <div className="acc-form-group">
                  <label>Provider</label>
                  <select
                    className="acc-select"
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </div>

                <div className="acc-form-group">
                  <label>Model</label>
                  <input
                    type="text"
                    className="acc-input"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="e.g. gpt-4o"
                  />
                </div>

                <button
                  type="button"
                  className="acc-btn acc-btn-primary"
                  onClick={() => void handleLaunchMission()}
                  disabled={launching || !missionInput.trim()}
                  style={{ justifyContent: "center", padding: "0.7rem 1rem" }}
                >
                  <IconPlay /> {launching ? "Starting…" : "Run Mission"}
                </button>
              </div>
            </div>
          </div>

          {/* Recent Runs */}
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>📋 Recent Agent Runs</h2>
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                Click a row to expand details
              </span>
            </div>

            <table className="acc-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Mission</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Task</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpandedRunId(expandedRunId === r.id ? null : r.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.id.slice(0, 10)}…</td>
                      <td>{r.mission.length > 50 ? `${r.mission.slice(0, 50)}…` : r.mission}</td>
                      <td><span className={`mode-dot ${r.agentMode}`} /> {r.agentMode}</td>
                      <td><span className={`acc-run-status ${r.status}`}>{r.status}</span></td>
                      <td style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{r.currentTask?.slice(0, 35) || "—"}</td>
                      <td style={{ fontSize: "0.78rem" }}>{timeAgo(r.startedAt)}</td>
                      <td>
                        {r.status !== "COMPLETED" && r.status !== "FAILED" && r.status !== "CANCELLED" && (
                          <button
                            type="button"
                            className="acc-btn acc-btn-danger"
                            style={{ padding: "0.2rem 0.5rem", fontSize: "0.72rem" }}
                            onClick={(e) => { e.stopPropagation(); void handleCancelRun(r.id); }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedRunId === r.id && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <div className="acc-run-detail">
                            <div className="acc-run-detail-row">
                              <span className="label">Full ID</span>
                              <span className="value">{r.id}</span>
                            </div>
                            <div className="acc-run-detail-row">
                              <span className="label">Mission</span>
                              <span className="value">{r.mission}</span>
                            </div>
                            {r.providerId && (
                              <div className="acc-run-detail-row">
                                <span className="label">Provider</span>
                                <span className="value">{r.providerId}</span>
                              </div>
                            )}
                            {r.modelId && (
                              <div className="acc-run-detail-row">
                                <span className="label">Model</span>
                                <span className="value">{r.modelId}</span>
                              </div>
                            )}
                            {r.activeTools.length > 0 && (
                              <div className="acc-run-detail-row">
                                <span className="label">Tools</span>
                                <span className="value">{r.activeTools.join(", ")}</span>
                              </div>
                            )}
                            {r.errorMessage && (
                              <div className="acc-run-detail-row">
                                <span className="label" style={{ color: "#f87171" }}>Error</span>
                                <span className="value" style={{ color: "#f87171" }}>{r.errorMessage}</span>
                              </div>
                            )}
                            <div className="acc-run-detail-row">
                              <span className="label">Started</span>
                              <span className="value">{new Date(r.startedAt).toLocaleString()}</span>
                            </div>
                            {r.finishedAt && (
                              <div className="acc-run-detail-row">
                                <span className="label">Finished</span>
                                <span className="value">{new Date(r.finishedAt).toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="acc-empty">
                        <span className="acc-empty-icon">🤖</span>
                        <span>No agent runs recorded yet. Launch a mission above to get started.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Audit Console */}
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🖥 Real-time Audit Stream</h2>
              <span style={{ fontSize: "0.75rem", color: "#475569" }}>
                Secret Redacted • Fail-Closed Enforcement
              </span>
            </div>

            <div className="acc-console">
              {auditEvents.map((evt) => (
                <div key={evt.id} className="acc-console-line">
                  <span className="acc-console-ts">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  <span className={`acc-console-type ${evt.eventType}`}>[{evt.eventType}]</span>
                  <span style={{ color: "#94a3b8" }}>
                    {evt.tool ? `tool=${evt.tool} ` : ""}
                    {evt.status ? `status=${evt.status} ` : ""}
                    {evt.metadata ? JSON.stringify(evt.metadata) : ""}
                  </span>
                </div>
              ))}
              {auditEvents.length === 0 && (
                <div className="acc-empty">
                  <span className="acc-empty-icon">📡</span>
                  <span>Audit stream waiting for events…</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══ TAB 2: MCP Servers ═══ */}
      {activeTab === "mcp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>➕ Register New MCP Server</h2>
              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                Pre-spawn Security Gateway verifies binary allowlist and args
              </span>
            </div>

            <form onSubmit={(e) => void handleAddMcpServer(e)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                <div className="acc-form-group">
                  <label>Server Name</label>
                  <input
                    type="text"
                    className="acc-input"
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    placeholder="e.g. filesystem-mcp"
                    required
                  />
                </div>

                <div className="acc-form-group">
                  <label>Transport</label>
                  <select
                    className="acc-select"
                    value={newMcpTransport}
                    onChange={(e) => setNewMcpTransport(e.target.value as "stdio" | "http" | "sse")}
                  >
                    {TRANSPORT_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div className="acc-form-group">
                  <label>Trust Level</label>
                  <select
                    className="acc-select"
                    value={newMcpTrust}
                    onChange={(e) => setNewMcpTrust(e.target.value as "trusted" | "untrusted")}
                  >
                    {TRUST_OPTIONS.map((tr) => (
                      <option key={tr} value={tr}>{tr}</option>
                    ))}
                  </select>
                </div>
              </div>

              {newMcpTransport === "stdio" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
                  <div className="acc-form-group">
                    <label>Command</label>
                    <input
                      type="text"
                      className="acc-input"
                      value={newMcpCommand}
                      onChange={(e) => setNewMcpCommand(e.target.value)}
                      placeholder="node, bun, python, npx…"
                    />
                  </div>
                  <div className="acc-form-group">
                    <label>Arguments</label>
                    <input
                      type="text"
                      className="acc-input"
                      value={newMcpArgs}
                      onChange={(e) => setNewMcpArgs(e.target.value)}
                      placeholder="Space separated"
                    />
                  </div>
                </div>
              ) : (
                <div className="acc-form-group">
                  <label>Endpoint URL</label>
                  <input
                    type="url"
                    className="acc-input"
                    value={newMcpUrl}
                    onChange={(e) => setNewMcpUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              )}

              <div>
                <button type="submit" className="acc-btn acc-btn-primary">
                  <IconPlus /> Add MCP Server
                </button>
              </div>
            </form>
          </div>

          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🔌 Registered MCP Servers ({mcpServers.length})</h2>
            </div>

            <table className="acc-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Transport</th>
                  <th>Command / URL</th>
                  <th>Trust</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mcpServers.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.transport.toUpperCase()}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                      {s.command ? `${s.command} ${(s.args || []).join(" ")}` : s.url || "—"}
                    </td>
                    <td>
                      <span className={`acc-badge ${s.trustLevel === "trusted" ? "low" : "medium"}`}>
                        {s.trustLevel ?? "untrusted"}
                      </span>
                    </td>
                    <td>
                      <span className={`acc-badge ${s.healthStatus === "healthy" ? "healthy" : "unknown"}`}>
                        {s.healthStatus || "unknown"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          type="button"
                          className="acc-btn acc-btn-secondary"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}
                          onClick={() => void handleTestMcpHealth(s.id)}
                        >
                          Ping
                        </button>
                        <button
                          type="button"
                          className="acc-btn acc-btn-danger"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}
                          onClick={() => void handleDeleteMcpServer(s.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {mcpServers.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="acc-empty">
                        <span className="acc-empty-icon">🔌</span>
                        <span>No MCP servers registered. Add one above.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ TAB 3: Providers & Models ═══ */}
      {activeTab === "providers" && (
        <div className="acc-card">
          <div className="acc-card-head">
            <h2>🧠 Multi-Model AI Providers & Capabilities</h2>
            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
              Dynamic Feature Detection: Tools, Vision, Reasoning, Structured Output
            </span>
          </div>

          <table className="acc-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Tool Calling</th>
                <th>Vision</th>
                <th>Reasoning</th>
                <th>Structured</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td>{m.provider}</td>
                  <td>{m.capabilities.tools ? <span className="acc-badge low">YES</span> : <span className="acc-badge critical">NO</span>}</td>
                  <td>{m.capabilities.vision ? <span className="acc-badge low">YES</span> : <span className="acc-badge read_only">NO</span>}</td>
                  <td>{m.capabilities.reasoning ? <span className="acc-badge low">YES</span> : <span className="acc-badge read_only">NO</span>}</td>
                  <td>{m.capabilities.structuredOutput ? <span className="acc-badge low">YES</span> : <span className="acc-badge read_only">NO</span>}</td>
                  <td style={{ fontFamily: "monospace" }}>{m.capabilities.maxContext ? `${Math.round(m.capabilities.maxContext / 1000)}k` : "128k"}</td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="acc-empty">
                      <span className="acc-empty-icon">🧠</span>
                      <span>No models discovered.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ TAB 4: Progressive Skills ═══ */}
      {activeTab === "skills" && (
        <div className="acc-card">
          <div className="acc-card-head">
            <h2>⚡ Progressive Skills Catalog</h2>
            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
              Stage 1 (Token-Efficient Descriptors) → Stage 2 (On-Demand Instructions)
            </span>
          </div>

          <table className="acc-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Version</th>
                <th>Status</th>
                <th>Description</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((sk) => (
                <tr key={sk.id}>
                  <td><strong>{sk.name}</strong></td>
                  <td style={{ fontFamily: "monospace" }}>{sk.version}</td>
                  <td>
                    <span className={`acc-badge ${sk.validationStatus === "valid" ? "low" : "critical"}`}>
                      {sk.validationStatus}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{sk.description}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#64748b" }}>{sk.sourcePath}</td>
                </tr>
              ))}
              {skills.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="acc-empty">
                      <span className="acc-empty-icon">⚡</span>
                      <span>No skills registered.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ TAB 5: Security & Policies ═══ */}
      {activeTab === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🔒 Workspace Containment & Security</h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="acc-form-group">
                <label>Allowed Root Directories (one per line)</label>
                <textarea
                  className="acc-textarea"
                  rows={3}
                  value={allowedRoots}
                  onChange={(e) => setAllowedRoots(e.target.value)}
                  placeholder="C:\Users\you\projects"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="acc-form-group">
                  <label>Git Remote Push Policy</label>
                  <select
                    className="acc-select"
                    value={allowPush}
                    onChange={(e) => setAllowPush(e.target.value)}
                  >
                    {GIT_PUSH_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="acc-form-group">
                  <label>Git Force Push (--force)</label>
                  <select
                    className="acc-select"
                    value={allowForcePush ? "true" : "false"}
                    onChange={(e) => setAllowForcePush(e.target.value === "true")}
                  >
                    {FORCE_PUSH_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="acc-btn acc-btn-primary"
                  onClick={() => void handleSavePolicy()}
                >
                  Save Workspace Policy
                </button>
              </div>
            </div>
          </div>

          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🛡 Active Security Guards</h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              <div className="acc-guard-card">
                <strong>🚧 Path Traversal Guard</strong>
                <p>
                  Enforces realpath containment, blocks UNC, drive-traversals, and relative escapes.
                </p>
                <span className="acc-badge low">ACTIVE & ENFORCED</span>
              </div>

              <div className="acc-guard-card">
                <strong>🔑 Secret Redactor</strong>
                <p>
                  Masks API keys, bearer tokens, private keys, and DB credentials from prompts & logs.
                </p>
                <span className="acc-badge low">ACTIVE & ENFORCED</span>
              </div>

              <div className="acc-guard-card">
                <strong>🔒 Pre-spawn MCP Guard</strong>
                <p>
                  Validates executable allowlist, blocks arbitrary bash/powershell injections in stdio config.
                </p>
                <span className="acc-badge low">ACTIVE & ENFORCED</span>
              </div>
            </div>
          </div>

          <div className="acc-card">
            <div className="acc-card-head">
              <h2>🎀 Ponytail Minimal-Code Governance Layer</h2>
              <span className={`acc-badge ${govStatus?.config?.enabled ? "low" : "critical"}`}>
                {govStatus?.config?.enabled ? `ACTIVE (${(govStatus?.config?.defaultMode || "full").toUpperCase()})` : "DISABLED"}
              </span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: "0 0 1rem 0" }}>
              Enforces disciplined 7-rung decision ladder before coding agents author new abstractions.
              Reviewer agents are strictly exempt (independent judgment). High-risk operations require Reviewer Council approval.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
              <div className="acc-guard-card">
                <strong>🪜 7-Rung Decision Ladder</strong>
                <p>
                  YAGNI → Reuse → Stdlib → Native → Existing Dep → Small Patch → Minimal New Subsystem.
                </p>
                <span className="acc-badge low">ENFORCING</span>
              </div>

              <div className="acc-guard-card">
                <strong>📦 Dependency Guard</strong>
                <p>
                  Blocks cosmetic & redundant packages when standard library or native platform equivalents exist.
                </p>
                <span className="acc-badge low">ACTIVE</span>
              </div>

              <div className="acc-guard-card">
                <strong>🔍 Diff Guard & Contract Safety</strong>
                <p>
                  Monitors git status; warns if bugfixes exceed {govStatus?.config?.maxDiffFilesForSmallFix ?? 5} files; protects auth & contracts.
                </p>
                <span className="acc-badge low">MONITORING</span>
              </div>

              <div className="acc-guard-card">
                <strong>📋 Technical Debt Ledger</strong>
                <p>
                  Tracks deliberate architectural shortcuts and deferred refactor triggers.
                </p>
                <span className="acc-badge read_only">{debts.length} Tracked Entries</span>
              </div>
            </div>

            {debts.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ fontSize: "0.85rem", color: "#e2e8f0", marginBottom: "0.5rem" }}>Tracked Technical Debts</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {debts.slice(0, 5).map((debt) => (
                    <div
                      key={debt.id}
                      style={{
                        padding: "0.6rem 0.8rem",
                        background: "rgba(15, 23, 42, 0.6)",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <span style={{ fontFamily: "monospace", color: "#38bdf8", marginRight: "0.5rem" }}>{debt.id}</span>
                        <span style={{ color: "#e2e8f0" }}>{debt.shortcut}</span>
                        <span style={{ color: "#64748b", marginLeft: "0.5rem" }}>({debt.area})</span>
                      </div>
                      <span className={`acc-badge ${debt.status === "open" ? "warning" : "low"}`}>{debt.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
