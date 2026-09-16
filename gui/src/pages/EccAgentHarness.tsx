// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/ecc-agent-harness.css";

interface EccStatusData {
  installed: boolean;
  available: boolean;
  mode: string;
  version?: string;
  plugin: {
    supported: boolean;
    marketplaceRegistered: boolean;
    pluginInstalled: boolean;
    pluginEnabled: boolean;
    version?: string;
  };
  duplicateInstallDetected: boolean;
  skillsIndexed: number;
  agentsIndexed: number;
  warnings: string[];
  lastCheckedAt: string;
}

interface SkillItem {
  id: string;
  name: string;
  source: string;
  version?: string;
  description: string;
  tags: string[];
  risk: string;
  requiredTools: string[];
  supportedHarnesses: string[];
  enabled: boolean;
  trusted: boolean;
  loadMode: string;
}

interface AgentItem {
  id: string;
  role: string;
  name: string;
  source: string;
  description: string;
  readOnly: boolean;
  allowedRiskClasses: string[];
  allowedTools: string[];
  requiredSkills: string[];
  isSecurityCritical?: boolean;
}

interface RunItem {
  id: string;
  taskId: string;
  harness: string;
  goal: string;
  status: string;
  agentRole: string;
  createdAt: string;
}

interface MemoryItem {
  id: string;
  type: string;
  summary: string;
  confidence: number;
  createdAt: string;
}

interface InstinctItem {
  id: string;
  trigger: string;
  pattern: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  promotable: boolean;
  promotedToSkill?: boolean;
}

interface AgentShieldData {
  installed: boolean;
  version?: string;
  guidance?: string;
}

export function EccAgentHarness({ apiBase }: { apiBase: string }) {
  const [activeTab, setActiveTab] = useState<"overview" | "skills" | "agents" | "timeline" | "learning" | "agentshield">("overview");
  const [status, setStatus] = useState<EccStatusData | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [instincts, setInstincts] = useState<InstinctItem[]>([]);
  const [agentshield, setAgentShield] = useState<AgentShieldData | null>(null);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("all");

  // Task execution modal
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskGoal, setTaskGoal] = useState("");
  const [isWriteTask, setIsWriteTask] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [lastExecutionResult, setLastExecutionResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [stRes, skRes, agRes, tmRes, memRes, inRes, shRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/ecc/status`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/skills`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/agents`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/timeline`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/memory`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/instincts`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/agent-os/ecc/agentshield`).then(r => r.ok ? r.json() : null),
      ]);

      if (stRes?.status) setStatus(stRes.status);
      if (skRes?.skills) setSkills(skRes.skills);
      if (agRes?.agents) setAgents(agRes.agents);
      if (tmRes?.runs) setRuns(tmRes.runs);
      if (memRes?.memories) setMemories(memRes.memories);
      if (inRes?.instincts) setInstincts(inRes.instincts);
      if (shRes?.agentshield) setAgentShield(shRes.agentshield);
    } catch {
      // Best effort load
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`${apiBase}/api/agent-os/ecc/status`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/skills`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/agents`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/timeline`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/memory`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/instincts`).then(r => r.ok ? r.json() : null),
      fetch(`${apiBase}/api/agent-os/ecc/agentshield`).then(r => r.ok ? r.json() : null),
    ]).then(([stRes, skRes, agRes, tmRes, memRes, inRes, shRes]) => {
      if (!active) return;
      if (stRes?.status) setStatus(stRes.status);
      if (skRes?.skills) setSkills(skRes.skills);
      if (agRes?.agents) setAgents(agRes.agents);
      if (tmRes?.runs) setRuns(tmRes.runs);
      if (memRes?.memories) setMemories(memRes.memories);
      if (inRes?.instincts) setInstincts(inRes.instincts);
      if (shRes?.agentshield) setAgentShield(shRes.agentshield);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [apiBase]);

  const handleExecuteTask = async () => {
    if (!taskGoal.trim()) return;
    setExecuting(true);
    setLastExecutionResult(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/ecc/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: taskGoal, isWriteTask }),
      });
      const data = await res.json();
      if (data?.result) {
        setLastExecutionResult(`Task completed with status: ${data.result.status}. Reviewer Council Decision: ${data.result.councilResult?.decision ?? "N/A"}`);
        void fetchData();
      }
    } catch (e: unknown) {
      setLastExecutionResult(`Execution failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExecuting(false);
    }
  };

  const handlePromoteInstinct = async (instinctId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/ecc/instincts/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instinctId, approvedByOperator: true }),
      });
      if (res.ok) {
        void fetchData();
      }
    } catch {
      // Handled
    }
  };

  const filteredSkills = skills.filter(s => {
    if (selectedSource !== "all" && s.source !== selectedSource) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div className="ecc-container">
      {/* Header */}
      <header className="ecc-header">
        <div className="ecc-title-area">
          <h1>
            ECC Agent Harness OS
            <span className={`ecc-badge ${status?.available ? "ecc-badge-success" : "ecc-badge-warning"}`}>
              {status?.mode ?? "INITIALIZING"}
            </span>
            {status?.version && <span className="ecc-badge ecc-badge-primary">v{status.version}</span>}
          </h1>
          <p className="ecc-subtitle">
            Governed agent execution layer combining affaan-m/ECC skills & roles with Pao-hubPro Safe Tool Gateway policies.
          </p>
        </div>
        <div className="ecc-header-actions">
          <button type="button" className="ecc-btn ecc-btn-primary" onClick={() => setShowTaskModal(true)}>
            + Run Governed Task
          </button>
          <button type="button" className="ecc-btn ecc-btn-secondary" onClick={() => void fetchData()}>
            Refresh
          </button>
        </div>
      </header>

      {/* Duplicate Install / Conflict Alert Banner */}
      {status?.duplicateInstallDetected && (
        <div className="ecc-alert-banner">
          <div className="ecc-alert-icon">⚠️</div>
          <div>
            <strong>Conflicting ECC Installation Detected:</strong> Native Codex plugin and legacy sync are both active.
            Automated mutations are blocked until the duplicate installation is cleaned up per AGENTS.md guidelines.
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="ecc-tabs">
        <button type="button" className={`ecc-tab-btn ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview & Health
        </button>
        <button type="button" className={`ecc-tab-btn ${activeTab === "skills" ? "active" : ""}`} onClick={() => setActiveTab("skills")}>
          Skills Registry ({skills.length})
        </button>
        <button type="button" className={`ecc-tab-btn ${activeTab === "agents" ? "active" : ""}`} onClick={() => setActiveTab("agents")}>
          Agent Roles ({agents.length})
        </button>
        <button type="button" className={`ecc-tab-btn ${activeTab === "timeline" ? "active" : ""}`} onClick={() => setActiveTab("timeline")}>
          Execution Pipeline
        </button>
        <button type="button" className={`ecc-tab-btn ${activeTab === "learning" ? "active" : ""}`} onClick={() => setActiveTab("learning")}>
          Memory & Instincts
        </button>
        <button type="button" className={`ecc-tab-btn ${activeTab === "agentshield" ? "active" : ""}`} onClick={() => setActiveTab("agentshield")}>
          AgentShield Security
        </button>
      </nav>

      {/* Tab Content */}
      {loading && <p style={{ color: "#94a3b8" }}>Loading harness state...</p>}

      {!loading && activeTab === "overview" && (
        <div className="ecc-grid-2">
          <div className="ecc-card">
            <div className="ecc-card-header">
              <h3 className="ecc-card-title">Harness Runtime Health</h3>
              <span className={`ecc-badge ${status?.available ? "ecc-badge-success" : "ecc-badge-warning"}`}>
                {status?.available ? "READY" : "DEGRADED"}
              </span>
            </div>
            <p className="ecc-card-desc">Current operating mode and platform capability detection.</p>
            <div className="ecc-meta-list">
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Integration Mode:</span>
                <span className="ecc-meta-val">{status?.mode ?? "native-only"}</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Codex Plugin Supported:</span>
                <span className="ecc-meta-val">{status?.plugin.supported ? "Yes (CLI 0.147+)" : "No"}</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Native Plugin Installed:</span>
                <span className="ecc-meta-val">{status?.plugin.pluginInstalled ? "Installed (ecc@ecc)" : "Not installed"}</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Duplicate Install Guard:</span>
                <span className="ecc-meta-val">{status?.duplicateInstallDetected ? "Triggered (Unsafe)" : "Clear (Safe)"}</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Total Indexed Skills:</span>
                <span className="ecc-meta-val">{status?.skillsIndexed ?? 0}</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Active Agent Roles:</span>
                <span className="ecc-meta-val">{status?.agentsIndexed ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="ecc-card">
            <div className="ecc-card-header">
              <h3 className="ecc-card-title">Safe Tool Gateway</h3>
              <span className="ecc-badge ecc-badge-primary">Zero-Trust</span>
            </div>
            <p className="ecc-card-desc">Enforced tool classification and workspace containment.</p>
            <div className="ecc-meta-list">
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Class A (Read-only):</span>
                <span className="ecc-meta-val" style={{ color: "#34d399" }}>Allowed (In-Workspace)</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Class B (Workspace write):</span>
                <span className="ecc-meta-val" style={{ color: "#60a5fa" }}>Allowed (With Audit)</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Class C (Execution):</span>
                <span className="ecc-meta-val" style={{ color: "#fbbf24" }}>Policy-Checked</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Class D (Network/External):</span>
                <span className="ecc-meta-val">Domain Filtered</span>
              </div>
              <div className="ecc-meta-row">
                <span className="ecc-meta-label">Class E (High-Impact / Sudo):</span>
                <span className="ecc-meta-val" style={{ color: "#f87171" }}>DENIED / Human Approval</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "skills" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="ecc-filter-bar">
            <div className="ecc-filter-group">
              <label htmlFor="ecc-src-filter" style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Source:</label>
              <select
                id="ecc-src-filter"
                value={selectedSource}
                onChange={e => setSelectedSource(e.target.value)}
                style={{ background: "#1e293b", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", padding: "0.35rem 0.6rem", borderRadius: "0.4rem" }}
              >
                <option value="all">All Sources</option>
                <option value="pao">Pao Native</option>
                <option value="ecc">ECC Upstream</option>
                <option value="project">Project Local</option>
                <option value="user">User (~/.codex)</option>
              </select>
            </div>
            <input
              type="text"
              className="ecc-search-input"
              placeholder="Search skills by name, tag, or tool..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="ecc-grid-3">
            {filteredSkills.map(skill => (
              <div key={skill.id} className="ecc-card">
                <div className="ecc-card-header">
                  <h4 className="ecc-card-title">{skill.name}</h4>
                  <span className={`ecc-badge ${skill.risk === "high" ? "ecc-badge-danger" : skill.risk === "medium" ? "ecc-badge-warning" : "ecc-badge-success"}`}>
                    {skill.risk}
                  </span>
                </div>
                <p className="ecc-card-desc">{skill.description}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  <span className="ecc-tag-pill">{skill.source}</span>
                  {skill.tags.map(t => <span key={t} className="ecc-tag-pill">#{t}</span>)}
                </div>
                <div className="ecc-meta-row" style={{ marginTop: "auto", paddingTop: "0.5rem" }}>
                  <span className="ecc-meta-label">Load Mode:</span>
                  <span className="ecc-meta-val">{skill.loadMode}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && activeTab === "agents" && (
        <div className="ecc-grid-3">
          {agents.map(agent => (
            <div key={agent.id} className="ecc-card">
              <div className="ecc-card-header">
                <h4 className="ecc-card-title">{agent.name}</h4>
                <span className={`ecc-badge ${agent.readOnly ? "ecc-badge-success" : "ecc-badge-warning"}`}>
                  {agent.readOnly ? "READ-ONLY" : "WRITE-CAPABLE"}
                </span>
              </div>
              <p className="ecc-card-desc">{agent.description}</p>
              <div className="ecc-meta-list">
                <div className="ecc-meta-row">
                  <span className="ecc-meta-label">Role:</span>
                  <span className="ecc-meta-val">pao.{agent.role}</span>
                </div>
                <div className="ecc-meta-row">
                  <span className="ecc-meta-label">Allowed Classes:</span>
                  <span className="ecc-meta-val">{agent.allowedRiskClasses.join(", ")}</span>
                </div>
                <div className="ecc-meta-row">
                  <span className="ecc-meta-label">Security Critical:</span>
                  <span className="ecc-meta-val">{agent.isSecurityCritical ? "Yes (Mandatory)" : "No"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === "timeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="ecc-card">
            <h3 className="ecc-card-title">Governed Execution State Machine</h3>
            <p className="ecc-card-desc">Deterministic progression through security gates and Reviewer Council.</p>
            <div className="ecc-stepper">
              <div className="ecc-step done">
                <div className="ecc-step-circle">1</div>
                <span>Intake</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step done">
                <div className="ecc-step-circle">2</div>
                <span>Plan</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step done">
                <div className="ecc-step-circle">3</div>
                <span>Policy</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step active">
                <div className="ecc-step-circle">4</div>
                <span>Execute</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step">
                <div className="ecc-step-circle">5</div>
                <span>Verify</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step">
                <div className="ecc-step-circle">6</div>
                <span>Council</span>
              </div>
              <div className="ecc-step-line" />
              <div className="ecc-step">
                <div className="ecc-step-circle">7</div>
                <span>Audit</span>
              </div>
            </div>
          </div>

          <div className="ecc-card">
            <h3 className="ecc-card-title">Recent Governed Runs</h3>
            <div className="ecc-log-list">
              {runs.length === 0 && <p className="ecc-card-desc">No governed tasks recorded yet.</p>}
              {runs.map(r => (
                <div key={r.id} className="ecc-log-item">
                  <div className="ecc-log-left">
                    <span className={`ecc-badge ${r.status === "PASS" ? "ecc-badge-success" : r.status === "BLOCKED" ? "ecc-badge-danger" : "ecc-badge-warning"}`}>
                      {r.status}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, color: "#f8fafc" }}>{r.goal}</div>
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                        Role: {r.agentRole} • Harness: {r.harness} • ID: {r.id}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{new Date(r.createdAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "learning" && (
        <div className="ecc-grid-2">
          <div className="ecc-card">
            <h3 className="ecc-card-title">Memory Vault</h3>
            <p className="ecc-card-desc">Secret-filtered operational facts, ADRs, and repository conventions.</p>
            <div className="ecc-log-list">
              {memories.map(m => (
                <div key={m.id} className="ecc-log-item" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <span className="ecc-tag-pill">{m.type}</span>
                    <span style={{ fontSize: "0.75rem", color: "#38bdf8" }}>Confidence: {Math.round(m.confidence * 100)}%</span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#f1f5f9", marginTop: "0.35rem" }}>{m.summary}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ecc-card">
            <h3 className="ecc-card-title">Continuous Learning & Instincts</h3>
            <p className="ecc-card-desc">Observed patterns require operator approval to promote to skills.</p>
            <div className="ecc-log-list">
              {instincts.map(i => (
                <div key={i.id} className="ecc-log-item" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <span style={{ fontWeight: 600, color: "#38bdf8" }}>{i.trigger}</span>
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                      Success: {i.successCount} • Fail: {i.failureCount}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#cbd5e1", margin: "0.35rem 0" }}>{i.pattern}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <span className={`ecc-badge ${i.promotable ? "ecc-badge-success" : "ecc-badge-warning"}`}>
                      {i.promotedToSkill ? "PROMOTED" : i.promotable ? "PROMOTABLE" : "LEARNING"}
                    </span>
                    {i.promotable && !i.promotedToSkill && (
                      <button type="button" className="ecc-btn ecc-btn-primary" onClick={() => void handlePromoteInstinct(i.id)}>
                        Approve & Promote to Skill
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "agentshield" && (
        <div className="ecc-card">
          <div className="ecc-card-header">
            <h3 className="ecc-card-title">AgentShield Security Gate</h3>
            <span className={`ecc-badge ${agentshield?.installed ? "ecc-badge-success" : "ecc-badge-warning"}`}>
              {agentshield?.installed ? `v${agentshield.version}` : "OPTIONAL / NOT INSTALLED"}
            </span>
          </div>
          <p className="ecc-card-desc">
            Independent security auditing tool. Per Pao-hubPro security policy, AgentShield is never silently downloaded in production.
          </p>
          {agentshield?.guidance && (
            <div style={{ background: "rgba(255,255,255,0.04)", padding: "0.75rem 1rem", borderRadius: "0.5rem", fontSize: "0.85rem", color: "#94a3b8" }}>
              {agentshield.guidance}
            </div>
          )}
        </div>
      )}

      {/* Task Execution Modal */}
      {showTaskModal && (
        <div className="ecc-modal-overlay">
          <div className="ecc-modal">
            <h3 className="ecc-modal-title">Run Governed Agent Task</h3>
            <p className="ecc-card-desc">
              Executes through the full multi-agent harness: Planner → Explorer → Safe Tool Gateway → Verification → Reviewer Council.
            </p>
            <textarea
              className="ecc-textarea"
              placeholder="Describe the coding or inspection task (e.g. Inspect architecture boundaries and verify safe tool policies)..."
              value={taskGoal}
              onChange={e => setTaskGoal(e.target.value)}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "#e2e8f0" }}>
              <input type="checkbox" checked={isWriteTask} onChange={e => setIsWriteTask(e.target.checked)} />
              Task requires workspace file writes (Assigns Builder + Test Engineer)
            </label>

            {lastExecutionResult && (
              <div style={{ padding: "0.75rem", background: "rgba(56, 189, 248, 0.1)", borderRadius: "0.5rem", fontSize: "0.85rem", color: "#38bdf8" }}>
                {lastExecutionResult}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
              <button type="button" className="ecc-btn ecc-btn-secondary" onClick={() => setShowTaskModal(false)}>
                Close
              </button>
              <button type="button" className="ecc-btn ecc-btn-primary" disabled={executing || !taskGoal.trim()} onClick={() => void handleExecuteTask()}>
                {executing ? "Running..." : "Execute"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
