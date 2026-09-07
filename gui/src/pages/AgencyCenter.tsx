// Phase 20.8 — Pao-hubPro Agency Center Dashboard
// Visual control plane for specialist search, dynamic team builder, run orchestration, and audit.

import { useEffect, useState } from "react";
import { IconSearch, IconBot, IconRefresh, IconCheck, IconX, IconAlert } from "../icons";

interface AgencyStatus {
  totalAgents: number;
  enabledAgents: number;
  blockedAgents: number;
  divisionsCount: number;
  lastSyncAt: string | null;
  offlineReady: boolean;
}

interface AgentItem {
  slug: string;
  name: string;
  description: string;
  division: string;
  capabilities: string[];
  keywords: string[];
  enabled: boolean;
  score?: number;
  reasons?: string[];
  color?: string;
  emoji?: string;
  body?: string;
}

interface TeamPreset {
  id: string;
  name: string;
  description: string;
  lead: { preferred?: string[] };
  builders: { preferred?: string[] };
  reviewers: { preferred?: string[] };
  validators: { preferred?: string[] };
  maxAgents: number;
  defaultMode: string;
}

interface RunRecord {
  id: string;
  mission: string;
  riskLevel: string;
  executionMode: string;
  status: string;
  councilDecision: string | null;
  realityGatePassed: boolean | null;
  securityGatePassed: boolean | null;
  approvalStatus: string;
  evidenceCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export default function AgencyCenter() {
  const [activeTab, setActiveTab] = useState<"overview" | "specialists" | "teams" | "runs">("overview");

  // State
  const [status, setStatus] = useState<AgencyStatus | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [presets, setPresets] = useState<TeamPreset[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [inspectAgent, setInspectAgent] = useState<AgentItem | null>(null);
  const [missionInput, setMissionInput] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [submittingRun, setSubmittingRun] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch("/api/agency/status");
      if (res.ok) {
        const data = await res.json();
        setStatus({
          totalAgents: data.stats?.totalAgents ?? 0,
          enabledAgents: data.stats?.enabledAgents ?? 0,
          blockedAgents: data.stats?.blockedAgents ?? 0,
          divisionsCount: data.stats?.divisionsCount ?? 0,
          lastSyncAt: data.stats?.lastSyncAt ?? null,
          offlineReady: data.offlineReady ?? true,
        });
      }
    } catch {
      // Best-effort
    }
  }

  async function loadAgents() {
    try {
      const res = await fetch("/api/agency/agents?limit=100");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
      }
    } catch {
      // Best-effort
    }
  }

  async function loadPresets() {
    try {
      const res = await fetch("/api/agency/teams/presets");
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets ?? []);
      }
    } catch {
      // Best-effort
    }
  }

  async function loadRuns() {
    try {
      const res = await fetch("/api/agency/runs?limit=15");
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } catch {
      // Best-effort
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/agency/status").then(async (r) => {
      if (!r.ok || !active) return;
      const data = await r.json();
      if (active) {
        setStatus({
          totalAgents: data.stats?.totalAgents ?? 0,
          enabledAgents: data.stats?.enabledAgents ?? 0,
          blockedAgents: data.stats?.blockedAgents ?? 0,
          divisionsCount: data.stats?.divisionsCount ?? 0,
          lastSyncAt: data.stats?.lastSyncAt ?? null,
          offlineReady: data.offlineReady ?? true,
        });
      }
    }).catch(() => {});

    void fetch("/api/agency/agents?limit=100").then(async (r) => {
      if (!r.ok || !active) return;
      const data = await r.json();
      if (active) setAgents(data.agents ?? []);
    }).catch(() => {});

    void fetch("/api/agency/teams/presets").then(async (r) => {
      if (!r.ok || !active) return;
      const data = await r.json();
      if (active) setPresets(data.presets ?? []);
    }).catch(() => {});

    void fetch("/api/agency/runs?limit=15").then(async (r) => {
      if (!r.ok || !active) return;
      const data = await r.json();
      if (active) setRuns(data.runs ?? []);
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/agency/sync", { method: "POST" });
      if (res.ok) {
        await loadStatus();
        await loadAgents();
        await loadPresets();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim() && selectedDivision === "all") {
      loadAgents();
      return;
    }

    try {
      const res = await fetch("/api/agency/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim() || selectedDivision,
          division: selectedDivision !== "all" ? selectedDivision : undefined,
          limit: 30,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAgents(data.results?.map((r: { agent: AgentItem; score?: number; reasons?: string[] }) => ({
          ...r.agent,
          score: r.score,
          reasons: r.reasons,
        })) ?? []);
      }
    } catch {
      // Best-effort
    }
  }

  async function handleInspect(slug: string) {
    try {
      const res = await fetch(`/api/agency/agents/${slug}?includeBody=true`);
      if (res.ok) {
        const data = await res.json();
        setInspectAgent(data.agent);
      }
    } catch {
      // Best-effort
    }
  }

  async function handleLaunchRun() {
    if (!missionInput.trim()) return;
    setSubmittingRun(true);
    try {
      const res = await fetch("/api/agency/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mission: missionInput.trim(),
          presetId: selectedPresetId || undefined,
        }),
      });
      if (res.ok) {
        setMissionInput("");
        await loadRuns();
        setActiveTab("runs");
      }
    } finally {
      setSubmittingRun(false);
    }
  }

  async function handleApprove(runId: string) {
    try {
      const res = await fetch(`/api/agency/runs/${runId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: "dashboard-user" }),
      });
      if (res.ok) {
        await loadRuns();
      }
    } catch {
      // Best-effort
    }
  }

  const divisions = ["all", "engineering", "design", "product", "testing", "security", "specialized", "marketing"];

  return (
    <div className="agency-container">
      {/* Hero Banner */}
      <div className="agency-hero-banner">
        <div className="agency-hero-title">
          <h2>
            <IconBot /> <code>Agency Intelligence Layer</code>
          </h2>
          <p>
            <code>Dynamic specialist router, lazy-loaded personas & AI team orchestrator.</code>
          </p>
        </div>
        <div className="agency-hero-actions">
          <button
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing}
          >
            <IconRefresh /> <code>{syncing ? "Syncing..." : "Sync Catalog"}</code>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="agency-tab-nav">
        <button
          className={`agency-tab-btn ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <code>Overview</code>
        </button>
        <button
          className={`agency-tab-btn ${activeTab === "specialists" ? "active" : ""}`}
          onClick={() => setActiveTab("specialists")}
        >
          <code>Specialists ({agents.length})</code>
        </button>
        <button
          className={`agency-tab-btn ${activeTab === "teams" ? "active" : ""}`}
          onClick={() => setActiveTab("teams")}
        >
          <code>Teams & Presets</code>
        </button>
        <button
          className={`agency-tab-btn ${activeTab === "runs" ? "active" : ""}`}
          onClick={() => setActiveTab("runs")}
        >
          <code>Runs & Audit ({runs.length})</code>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="agency-stats-grid">
            <div className="agency-stat-card">
              <div className="stat-label"><code>Total Specialists</code></div>
              <div className="stat-value">{status?.totalAgents ?? 0}</div>
            </div>
            <div className="agency-stat-card">
              <div className="stat-label"><code>Active & Enabled</code></div>
              <div className="stat-value" style={{ color: "#10b981" }}>
                {status?.enabledAgents ?? 0}
              </div>
            </div>
            <div className="agency-stat-card">
              <div className="stat-label"><code>Divisions</code></div>
              <div className="stat-value">{status?.divisionsCount ?? 0}</div>
            </div>
            <div className="agency-stat-card">
              <div className="stat-label"><code>Offline Resilience</code></div>
              <div className="stat-value" style={{ color: "#6366f1", fontSize: "var(--text-lg)" }}>
                <code>{status?.offlineReady ? "Snapshot Ready" : "Uncached"}</code>
              </div>
            </div>
          </div>

          <div style={{ background: "var(--surface-panel)", padding: "var(--space-4)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
            <h4 style={{ margin: "0 0 var(--space-2)" }}><code>Core Architecture & Policy Invariants</code></h4>
            <ul style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <li><code>Zero Preload: Only lightweight agent metadata is indexed. Full instructions are loaded strictly on-demand.</code></li>
              <li><code>Prompt Firewall: System Policy &gt; Pao Policy &gt; Project Policy &gt; Team Policy &gt; Specialist Instruction.</code></li>
              <li><code>Reviewer Council Gate: 5-agent council evaluates specialist code changes and proposals before execution.</code></li>
              <li><code>Reality Checker: Ground-truth claims and evidence items are verified against actual local files and test outputs.</code></li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 2: SPECIALISTS EXPLORER */}
      {activeTab === "specialists" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="agency-search-bar">
            <input
              type="text"
              className="agency-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <select
              className="agency-division-select"
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
            >
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d.toUpperCase()}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={handleSearch}>
              <IconSearch /> <code>Search</code>
            </button>
          </div>

          <div className="agency-agents-grid">
            {agents.map((agent) => (
              <div key={agent.slug} className="agency-agent-card">
                <div className="agency-agent-head">
                  <div>
                    <h4 className="agency-agent-title">
                      {agent.emoji && `${agent.emoji} `}
                      <code>{agent.name}</code>
                    </h4>
                    <span className="agency-division-tag">
                      <code>{agent.division}</code>
                    </span>
                  </div>
                  {agent.score !== undefined && (
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#6366f1" }}>
                      <code>{Math.round(agent.score * 100)}% Match</code>
                    </span>
                  )}
                </div>

                <p className="agency-agent-desc"><code>{agent.description || "Specialist"}</code></p>

                <div className="agency-caps-cluster">
                  {agent.capabilities.slice(0, 4).map((cap) => (
                    <span key={cap} className="agency-cap-pill">
                      <code>{cap}</code>
                    </span>
                  ))}
                  {agent.capabilities.length > 4 && (
                    <span className="agency-cap-pill">
                      <code>+{agent.capabilities.length - 4}</code>
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleInspect(agent.slug)}
                  >
                    <code>Inspect</code>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: TEAMS & PRESETS */}
      {activeTab === "teams" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Mission Input Form */}
          <div style={{ background: "var(--surface-panel)", padding: "var(--space-4)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <h4 style={{ margin: 0 }}><code>Launch Dynamic Team Run</code></h4>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              <code>Provide a mission. The system will dynamically select specialists, decompose tasks, and execute quality gates.</code>
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <input
                type="text"
                className="agency-search-input"
                value={missionInput}
                onChange={(e) => setMissionInput(e.target.value)}
              />
              <select
                className="agency-division-select"
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
              >
                <option value=""><code>Dynamic Team (Auto-composed)</code></option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                onClick={handleLaunchRun}
                disabled={submittingRun || !missionInput.trim()}
              >
                <code>{submittingRun ? "Starting..." : "Start Run"}</code>
              </button>
            </div>
          </div>

          {/* Presets Grid */}
          <h4 style={{ margin: "var(--space-2) 0 0" }}><code>Configured Team Presets</code></h4>
          <div className="agency-teams-grid">
            {presets.map((preset) => (
              <div key={preset.id} className="agency-team-card">
                <div>
                  <h4 style={{ margin: "0 0 var(--space-1)" }}><code>{preset.name}</code></h4>
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                    <code>{preset.description}</code>
                  </p>
                </div>

                <div className="agency-team-roles">
                  <div className="agency-role-row">
                    <span className="agency-role-label"><code>Lead:</code></span>
                    <span><code>{preset.lead.preferred?.join(", ") || "Auto"}</code></span>
                  </div>
                  <div className="agency-role-row">
                    <span className="agency-role-label"><code>Builders:</code></span>
                    <span><code>{preset.builders.preferred?.join(", ") || "Auto"}</code></span>
                  </div>
                  <div className="agency-role-row">
                    <span className="agency-role-label"><code>Reviewers:</code></span>
                    <span><code>{preset.reviewers.preferred?.join(", ") || "Auto"}</code></span>
                  </div>
                  <div className="agency-role-row">
                    <span className="agency-role-label"><code>Gate:</code></span>
                    <span><code>{preset.validators.preferred?.join(", ") || "Reality Checker"}</code></span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    <code>Max {preset.maxAgents} Agents • {preset.defaultMode}</code>
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setMissionInput(preset.name);
                    }}
                  >
                    <code>Select</code>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: RUNS & AUDIT */}
      {activeTab === "runs" && (
        <div className="agency-run-timeline">
          {runs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--text-secondary)" }}>
              <code>No orchestrated team runs recorded yet.</code>
            </div>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="agency-run-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)" }}>
                  <div>
                    <span className={`agency-state-badge agency-state--${run.status.toLowerCase()}`}>
                      <code>{run.status}</code>
                    </span>
                    <h4 style={{ margin: "var(--space-1) 0" }}><code>{run.mission}</code></h4>
                    <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)" }}>
                      <code>ID: {run.id} • Risk: {run.riskLevel.toUpperCase()} • Mode: {run.executionMode}</code>
                    </p>
                  </div>

                  {run.status === "AWAITING_APPROVAL" && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleApprove(run.id)}
                    >
                      <IconCheck /> <code>Approve Run</code>
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-3)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                  <div><code>Council: {run.councilDecision || "Pending"}</code></div>
                  <div><code>Reality Gate: {run.realityGatePassed === null ? "Pending" : run.realityGatePassed ? "Passed" : "Failed"}</code></div>
                  <div><code>Security Gate: {run.securityGatePassed === null ? "Pending" : run.securityGatePassed ? "Passed" : "Failed"}</code></div>
                  <div><code>Evidence Items: {run.evidenceCount}</code></div>
                </div>

                {run.errorMessage && (
                  <div style={{ marginTop: "var(--space-2)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", fontSize: "var(--text-xs)" }}>
                    <IconAlert /> <code>{run.errorMessage}</code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* INSPECT AGENT MODAL */}
      {inspectAgent && (
        <div className="agency-modal-overlay" onClick={() => setInspectAgent(null)}>
          <div className="agency-modal" onClick={(e) => e.stopPropagation()}>
            <div className="agency-modal-header">
              <div>
                <h3 style={{ margin: 0 }}>
                  {inspectAgent.emoji && `${inspectAgent.emoji} `}
                  <code>{inspectAgent.name}</code>
                </h3>
                <span className="agency-division-tag">
                  <code>{inspectAgent.division}</code>
                </span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setInspectAgent(null)}
              >
                <IconX />
              </button>
            </div>

            <div className="agency-modal-body">
              <p style={{ marginTop: 0 }}><code>{inspectAgent.description}</code></p>

              <h5 style={{ margin: "var(--space-3) 0 var(--space-1)" }}><code>Capabilities</code></h5>
              <div className="agency-caps-cluster">
                {inspectAgent.capabilities.map((c) => (
                  <span key={c} className="agency-cap-pill">
                    <code>{c}</code>
                  </span>
                ))}
              </div>

              {inspectAgent.body && (
                <>
                  <h5 style={{ margin: "var(--space-4) 0 var(--space-1)" }}><code>Sanitized Prompt Instructions (Preview)</code></h5>
                  <div className="agency-prompt-preview">
                    {inspectAgent.body}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
