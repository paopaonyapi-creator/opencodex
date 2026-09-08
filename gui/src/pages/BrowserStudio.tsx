// Phase 20.11-20.14: Pao-hubPro Browser Studio UI Dashboard
//
// Glassmorphism God Mode control plane for live browser tabs, human approval gates,
// multi-agent web operations, QA audit evidence, and distributed remote worker fleet.

import React, { useState, useEffect, useCallback } from "react";
import "../styles/browser-studio.css";

interface BrowserStudioProps {
  apiBase: string;
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
  status: string;
}

interface SnapshotElement {
  ref?: string;
  role?: string;
  name?: string;
  text?: string;
  selector?: string;
}

interface ApprovalItem {
  id: string;
  agent?: string;
  actionTool?: string;
  website?: string;
  reason?: string;
  affectedData?: Record<string, unknown>;
  status?: string;
}

interface MissionItem {
  id: string;
  name: string;
  status: string;
  currentStepIndex?: number;
  assignedAgents?: string[];
  goal?: string;
  contextData?: Record<string, unknown>;
}

interface FleetMetrics {
  totalWorkers: number;
  onlineWorkers: number;
  busyWorkers: number;
  offlineWorkers: number;
  activeJobs: number;
  regions: Record<string, number>;
}

interface RemoteWorkerNode {
  id: string;
  name: string;
  endpointUrl: string;
  status: string;
  geoRegion: string;
  maxConcurrentJobs: number;
  activeJobs: number;
}

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
  version?: string;
}

export default function BrowserStudio({ apiBase }: BrowserStudioProps) {
  const [activeTab, setActiveTab] = useState<"live" | "approvals" | "missions" | "fleet" | "workflows">("live");
  const [killSwitchActive, setKillSwitchActive] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Live Browser state
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>("https://stock.adobe.com/contributor");
  const [pageReaderText, setPageReaderText] = useState<string>("");
  const [snapshotElements, setSnapshotElements] = useState<SnapshotElement[]>([]);
  const [screenshotB64, setScreenshotB64] = useState<string | null>(null);

  // Approvals state
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);

  // Missions state (Phase 20.13)
  const [missions, setMissions] = useState<MissionItem[]>([]);
  const [selectedMission, setSelectedMission] = useState<MissionItem | null>(null);

  // Remote Fleet state (Phase 20.14)
  const [fleetStatus, setFleetStatus] = useState<FleetMetrics>({
    totalWorkers: 0,
    onlineWorkers: 0,
    busyWorkers: 0,
    offlineWorkers: 0,
    activeJobs: 0,
    regions: {},
  });
  const [workers, setWorkers] = useState<RemoteWorkerNode[]>([]);

  // Workflows state (Phase 20.12)
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

  // Dialogs
  const [showNewWorkerModal, setShowNewWorkerModal] = useState<boolean>(false);
  const [newWorkerForm, setNewWorkerForm] = useState({
    name: "",
    endpointUrl: "",
    geoRegion: "us-east",
    maxConcurrentJobs: 3,
  });

  const [showNewMissionModal, setShowNewMissionModal] = useState<boolean>(false);
  const [newMissionForm, setNewMissionForm] = useState({
    name: "Adobe Stock Spring Campaign",
    goal: "Generate metadata and submit spring assets",
    targetDomain: "stock.adobe.com",
  });

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem("ocx-token") || "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  // 1. Fetch Browser Status & Tabs
  const fetchBrowserData = useCallback(async () => {
    try {
      const statusRes = await fetch(`${apiBase}/api/browser/status`, { headers: getHeaders() });
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as { killSwitchActive?: boolean; activeTabId?: string };
        setKillSwitchActive(!!statusData.killSwitchActive);
        if (statusData.activeTabId) {
          setActiveTabId(statusData.activeTabId);
        }
      }

      const tabsRes = await fetch(`${apiBase}/api/browser/tabs`, { headers: getHeaders() });
      if (tabsRes.ok) {
        const tabsData = await tabsRes.json();
        const tabList = (Array.isArray(tabsData) ? tabsData : (tabsData as { tabs?: BrowserTab[] }).tabs || []) as BrowserTab[];
        setTabs(tabList);
      }
    } catch {
      // Silent poll fail
    }
  }, [apiBase, getHeaders]);

  // 2. Fetch Approvals Queue
  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/browser/approvals`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setApprovals((Array.isArray(data) ? data : (data as { approvals?: ApprovalItem[] }).approvals || []) as ApprovalItem[]);
      }
    } catch {
      // Silent fail
    }
  }, [apiBase, getHeaders]);

  // 3. Fetch Missions
  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/browser/missions`, { headers: getHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { missions?: MissionItem[] };
        const missionList = data.missions || [];
        setMissions(missionList);
      }
    } catch {
      // Silent fail
    }
  }, [apiBase, getHeaders]);

  // 4. Fetch Remote Fleet
  const fetchFleet = useCallback(async () => {
    try {
      const [fleetRes, workersRes] = await Promise.all([
        fetch(`${apiBase}/api/browser/remote/fleet`, { headers: getHeaders() }),
        fetch(`${apiBase}/api/browser/remote/workers`, { headers: getHeaders() }),
      ]);
      if (fleetRes.ok) {
        const fData = (await fleetRes.json()) as { fleet?: FleetMetrics };
        if (fData.fleet) setFleetStatus(fData.fleet);
      }
      if (workersRes.ok) {
        const wData = (await workersRes.json()) as { workers?: RemoteWorkerNode[] };
        setWorkers(wData.workers || []);
      }
    } catch {
      // Silent fail
    }
  }, [apiBase, getHeaders]);

  // 5. Fetch Workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/browser/workflows`, { headers: getHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { workflows?: WorkflowItem[] };
        setWorkflows(data.workflows || []);
      }
    } catch {
      // Silent fail
    }
  }, [apiBase, getHeaders]);

  // Initial load and polling loop
  useEffect(() => {
    let active = true;

    const loadAll = () => {
      if (!active) return;
      void fetchBrowserData();
      void fetchApprovals();
      void fetchMissions();
      void fetchFleet();
      void fetchWorkflows();
    };

    const timer = setTimeout(loadAll, 0);
    const interval = setInterval(loadAll, 6000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchBrowserData, fetchApprovals, fetchMissions, fetchFleet, fetchWorkflows]);

  // Kill switch toggle
  const toggleKillSwitch = async () => {
    setLoading(true);
    try {
      const endpoint = killSwitchActive ? "resume" : "stop";
      const res = await fetch(`${apiBase}/api/browser/${endpoint}`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ reason: "Manual toggle from Browser Studio UI" }),
      });
      if (res.ok) {
        setKillSwitchActive(!killSwitchActive);
      }
    } finally {
      setLoading(false);
    }
  };

  // Read active page
  const readPage = useCallback(async () => {
    try {
      const [readRes, snapRes] = await Promise.all([
        fetch(`${apiBase}/api/browser/read`, { headers: getHeaders() }),
        fetch(`${apiBase}/api/browser/snapshot`, { headers: getHeaders() }),
      ]);
      if (readRes.ok) {
        const rData = (await readRes.json()) as { text?: string; rawText?: string };
        setPageReaderText(rData.text || rData.rawText || "Page content loaded.");
      }
      if (snapRes.ok) {
        const sData = (await snapRes.json()) as { elements?: SnapshotElement[] };
        setSnapshotElements(sData.elements || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageReaderText(`Error reading page: ${msg}`);
    }
  }, [apiBase, getHeaders]);

  // Navigate URL
  const handleNavigate = async () => {
    if (!urlInput) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/browser/navigate`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ url: urlInput, tabId: activeTabId }),
      });
      if (res.ok) {
        await fetchBrowserData();
        await readPage();
      }
    } finally {
      setLoading(false);
    }
  };

  // Capture Screenshot
  const handleScreenshot = async () => {
    try {
      const res = await fetch(`${apiBase}/api/browser/screenshot`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ tabId: activeTabId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { dataBase64?: string };
        if (data.dataBase64) {
          setScreenshotB64(`data:image/png;base64,${data.dataBase64}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Screenshot failed: ${msg}`);
    }
  };

  // Handle Approval Decision
  const handleApprovalDecision = async (id: string, decision: "once" | "session" | "reject") => {
    try {
      let endpoint = `/api/browser/approvals/${id}/approve`;
      const body: Record<string, unknown> = {};
      if (decision === "session") {
        body.forSession = true;
      } else if (decision === "reject") {
        endpoint = `/api/browser/approvals/${id}/reject`;
      }

      await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      await fetchApprovals();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Approval action failed: ${msg}`);
    }
  };

  // Register Remote Worker
  const handleRegisterWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkerForm.name || !newWorkerForm.endpointUrl) return;

    try {
      const res = await fetch(`${apiBase}/api/browser/remote/workers`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(newWorkerForm),
      });
      if (res.ok) {
        setShowNewWorkerModal(false);
        setNewWorkerForm({ name: "", endpointUrl: "", geoRegion: "us-east", maxConcurrentJobs: 3 });
        await fetchFleet();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to register worker: ${msg}`);
    }
  };

  // Drain or Delete Worker
  const handleDrainWorker = async (id: string) => {
    await fetch(`${apiBase}/api/browser/remote/workers/${id}/drain`, {
      method: "POST",
      headers: getHeaders(),
    });
    await fetchFleet();
  };

  const handleDeleteWorker = async (id: string) => {
    if (!confirm("Are you sure you want to unregister this worker node?")) return;
    await fetch(`${apiBase}/api/browser/remote/workers/${id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    await fetchFleet();
  };

  // Create Mission
  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBase}/api/browser/missions`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: newMissionForm.name,
          goal: newMissionForm.goal,
          contextData: { targetDomain: newMissionForm.targetDomain },
        }),
      });
      if (res.ok) {
        setShowNewMissionModal(false);
        await fetchMissions();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to create mission: ${msg}`);
    }
  };

  return (
    <div className="bs-container">
      {/* Header & Kill Switch Bar */}
      <header className="bs-header">
        <div className="bs-header-titles">
          <h1>
            <span style={{ fontSize: "1.4rem" }}>🌐</span> Pao-hubPro Browser Studio
          </h1>
          <p>Autonomous Agent-Native Browser Operations & Remote Fleet Control Plane</p>
        </div>

        <div className="bs-header-actions">
          <button
            className={`bs-kill-switch-btn ${killSwitchActive ? "stopped" : "active"}`}
            onClick={toggleKillSwitch}
            disabled={loading}
            title={killSwitchActive ? "Click to Resume Agent Control" : "Click to Emergency STOP All Agents"}
          >
            <span className={`bs-pulse-dot ${killSwitchActive ? "danger" : "success"}`} />
            {killSwitchActive ? "RESUME AGENTS" : "STOP AGENT"}
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bs-nav-tabs">
        <button
          className={`bs-tab-btn ${activeTab === "live" ? "active" : ""}`}
          onClick={() => setActiveTab("live")}
        >
          🖥️ Live Browser & Tabs
          <span className="bs-tab-badge highlight">{tabs.length}</span>
        </button>

        <button
          className={`bs-tab-btn ${activeTab === "approvals" ? "active" : ""}`}
          onClick={() => setActiveTab("approvals")}
        >
          🛡️ Approval Queue
          {approvals.length > 0 && (
            <span className="bs-tab-badge warning">{approvals.length}</span>
          )}
        </button>

        <button
          className={`bs-tab-btn ${activeTab === "missions" ? "active" : ""}`}
          onClick={() => setActiveTab("missions")}
        >
          🤖 Multi-Agent Squads
          <span className="bs-tab-badge">{missions.length}</span>
        </button>

        <button
          className={`bs-tab-btn ${activeTab === "fleet" ? "active" : ""}`}
          onClick={() => setActiveTab("fleet")}
        >
          ☁️ Remote Fleet
          <span className="bs-tab-badge highlight">{fleetStatus.onlineWorkers || 0} Online</span>
        </button>

        <button
          className={`bs-tab-btn ${activeTab === "workflows" ? "active" : ""}`}
          onClick={() => setActiveTab("workflows")}
        >
          ⚡ Workflows
          <span className="bs-tab-badge">{workflows.length}</span>
        </button>
      </nav>

      {/* Tab 1: Live Browser & Tabs */}
      {activeTab === "live" && (
        <div className="bs-browser-panel">
          {/* Tab Strip */}
          <div className="bs-tabs-strip">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`bs-tab-pill ${tab.id === activeTabId ? "active" : ""}`}
                onClick={() => {
                  setActiveTabId(tab.id);
                  setUrlInput(tab.url);
                }}
              >
                <span>{tab.title || tab.url || "Untitled Tab"}</span>
              </div>
            ))}
          </div>

          {/* Address Bar */}
          <div className="bs-address-bar">
            <input
              type="text"
              className="bs-url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter URL to navigate..."
              onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
            />
            <button className="bs-btn bs-btn-primary" onClick={handleNavigate} disabled={loading}>
              Navigate ➔
            </button>
            <button className="bs-btn bs-btn-secondary" onClick={readPage}>
              📖 Read Page
            </button>
            <button className="bs-btn bs-btn-secondary" onClick={handleScreenshot}>
              📷 Screenshot
            </button>
          </div>

          {/* Reader & Snapshot Grid */}
          <div className="bs-reader-grid">
            <div className="bs-panel-box">
              <h3>
                Page Text Reader
                <button className="bs-btn bs-btn-secondary" style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }} onClick={readPage}>
                  Refresh
                </button>
              </h3>
              <div className="bs-reader-content">
                {pageReaderText || "Click 'Read Page' or navigate to extract visible text and layout."}
              </div>
            </div>

            <div className="bs-panel-box">
              <h3>
                Semantic Snapshot Elements ({snapshotElements.length})
                <span style={{ fontSize: "0.8rem", color: "var(--bs-cyan)" }}>Refs: [e1] - [eN]</span>
              </h3>
              <div style={{ flex: 1, maxHeight: "380px", overflowY: "auto" }}>
                {snapshotElements.length === 0 ? (
                  <div className="bs-empty-state">No semantic snapshot generated yet.</div>
                ) : (
                  <table className="bs-elements-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Role</th>
                        <th>Name / Text</th>
                        <th>Selector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshotElements.slice(0, 30).map((el, i) => (
                        <tr key={i}>
                          <td><span className="bs-ref-chip">{el.ref || `e${i + 1}`}</span></td>
                          <td><span className="bs-role-chip">{el.role || "element"}</span></td>
                          <td style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {el.name || el.text || "-"}
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--bs-text-muted)" }}>
                            {el.selector || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Screenshot Preview */}
          {screenshotB64 && (
            <div className="bs-panel-box">
              <h3>
                Live Screenshot Capture
                <button className="bs-btn bs-btn-secondary" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setScreenshotB64(null)}>
                  Close
                </button>
              </h3>
              <img src={screenshotB64} alt="Browser screenshot" className="bs-screenshot-img" />
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Human Approval Queue */}
      {activeTab === "approvals" && (
        <div>
          {approvals.length === 0 ? (
            <div className="bs-empty-state">
              <h3>🛡️ No Pending Human Approvals</h3>
              <p>All agent actions are within policy limits. Level 3 sensitive actions will appear here for supervisor sign-off.</p>
            </div>
          ) : (
            <div className="bs-approval-grid">
              {approvals.map((req) => (
                <div key={req.id} className="bs-approval-card">
                  <span className="bs-card-badge high">CONFIRM REQUIRED</span>
                  <div className="bs-approval-meta">
                    <span className="bs-approval-site">🌐 {req.website || "Target Site"}</span>
                    <span className="bs-approval-title">{req.actionTool || "Browser Action"}</span>
                    <p className="bs-approval-reason">{req.reason || "Autonomous agent requested high-risk action."}</p>
                  </div>

                  <div className="bs-data-preview">
                    {JSON.stringify(req.affectedData || {}, null, 2)}
                  </div>

                  <div className="bs-approval-actions">
                    <button
                      className="bs-btn bs-btn-success"
                      onClick={() => handleApprovalDecision(req.id, "once")}
                    >
                      ✓ Approve Once
                    </button>
                    <button
                      className="bs-btn bs-btn-primary"
                      onClick={() => handleApprovalDecision(req.id, "session")}
                    >
                      ✓ For Session
                    </button>
                    <button
                      className="bs-btn bs-btn-danger"
                      onClick={() => handleApprovalDecision(req.id, "reject")}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Multi-Agent Squads */}
      {activeTab === "missions" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2>Autonomous Operations Missions</h2>
            <button className="bs-btn bs-btn-primary" onClick={() => setShowNewMissionModal(true)}>
              + New Multi-Agent Mission
            </button>
          </div>

          {/* Stepper Visualization */}
          <div className="bs-mission-stepper">
            {[
              { num: 1, label: "1. Research Agent" },
              { num: 2, label: "2. Metadata Agent" },
              { num: 3, label: "3. Upload Agent" },
              { num: 4, label: "4. QA Audit Agent" },
              { num: 5, label: "5. Reviewer Council" },
            ].map((st, idx) => (
              <div key={st.num} className={`bs-step-node ${idx <= (selectedMission?.currentStepIndex || 0) ? "active" : ""}`}>
                <div className="bs-step-icon">{st.num}</div>
                <div className="bs-step-label">{st.label}</div>
              </div>
            ))}
          </div>

          <div className="bs-reader-grid">
            <div className="bs-panel-box">
              <h3>Active Missions List</h3>
              {missions.length === 0 ? (
                <div className="bs-empty-state">No missions created yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {missions.map((m) => (
                    <div
                      key={m.id}
                      className="bs-approval-card"
                      style={{ padding: "0.75rem", cursor: "pointer" }}
                      onClick={() => setSelectedMission(m)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{m.name}</strong>
                        <span className="bs-region-badge">{m.status}</span>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>{m.goal}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bs-panel-box">
              <h3>QA Audit Evidence</h3>
              {selectedMission ? (
                <div className="bs-qa-evidence-box">
                  <div>
                    <strong>Mission:</strong> {selectedMission.name}
                  </div>
                  <div>
                    <strong>Step:</strong> {selectedMission.currentStepIndex || 0} / 5
                  </div>
                  <div>
                    <strong>Assigned Squad:</strong> {JSON.stringify(selectedMission.assignedAgents || ["research", "metadata", "upload", "qa", "reviewer"])}
                  </div>
                  <div className="bs-data-preview">
                    {JSON.stringify(selectedMission.contextData || {}, null, 2)}
                  </div>
                </div>
              ) : (
                <div className="bs-empty-state">Select a mission to inspect details.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Remote Worker Fleet */}
      {activeTab === "fleet" && (
        <div>
          {/* Summary Stats */}
          <div className="bs-fleet-stats-grid">
            <div className="bs-stat-card">
              <span className="bs-stat-label">Total Fleet Nodes</span>
              <span className="bs-stat-value">{fleetStatus.totalWorkers || 0}</span>
            </div>
            <div className="bs-stat-card">
              <span className="bs-stat-label">Online & Ready</span>
              <span className="bs-stat-value" style={{ color: "var(--bs-emerald)" }}>{fleetStatus.onlineWorkers || 0}</span>
            </div>
            <div className="bs-stat-card">
              <span className="bs-stat-label">Busy Nodes</span>
              <span className="bs-stat-value" style={{ color: "var(--bs-amber)" }}>{fleetStatus.busyWorkers || 0}</span>
            </div>
            <div className="bs-stat-card">
              <span className="bs-stat-label">Active Dispatches</span>
              <span className="bs-stat-value" style={{ color: "var(--bs-cyan)" }}>{fleetStatus.activeJobs || 0}</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2>Distributed Worker Nodes</h2>
            <button className="bs-btn bs-btn-primary" onClick={() => setShowNewWorkerModal(true)}>
              + Register Worker Node
            </button>
          </div>

          {/* Workers Grid */}
          <div className="bs-workers-grid">
            {workers.map((w) => (
              <div key={w.id} className="bs-worker-card">
                <div className="bs-worker-header">
                  <div>
                    <div className="bs-worker-name">{w.name}</div>
                    <div className="bs-worker-url">{w.endpointUrl}</div>
                  </div>
                  <span className="bs-region-badge">{w.geoRegion}</span>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>
                    <span>Capacity Load</span>
                    <span>{w.activeJobs || 0} / {w.maxConcurrentJobs || 3}</span>
                  </div>
                  <div className="bs-load-bar-wrap">
                    <div
                      className="bs-load-bar-fill"
                      style={{ width: `${Math.min(100, ((w.activeJobs || 0) / (w.maxConcurrentJobs || 3)) * 100)}%` }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
                  <span style={{ fontSize: "0.8rem", color: w.status === "online" ? "var(--bs-emerald)" : "var(--bs-amber)" }}>
                    ● {w.status.toUpperCase()}
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="bs-btn bs-btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }} onClick={() => handleDrainWorker(w.id)}>
                      Drain
                    </button>
                    <button className="bs-btn bs-btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }} onClick={() => handleDeleteWorker(w.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Workflows */}
      {activeTab === "workflows" && (
        <div>
          <h2>Recorded Workflows & Automation Templates</h2>
          <div className="bs-workers-grid" style={{ marginTop: "1rem" }}>
            {workflows.length === 0 ? (
              <div className="bs-empty-state" style={{ gridColumn: "1 / -1" }}>
                No workflows recorded yet. Use `browser.workflow.create` or recording routes to build automated templates.
              </div>
            ) : (
              workflows.map((wf) => (
                <div key={wf.id} className="bs-worker-card">
                  <div className="bs-worker-header">
                    <div>
                      <div className="bs-worker-name">{wf.name}</div>
                      <div className="bs-worker-url">v{wf.version || "1.0.0"}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--bs-text-muted)", margin: "0.25rem 0" }}>
                    {wf.description || "No description provided."}
                  </p>
                  <button className="bs-btn bs-btn-primary" style={{ marginTop: "0.5rem" }}>
                    ▶ Run Workflow
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal: Register Remote Worker */}
      {showNewWorkerModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(8px)" }}>
          <div className="bs-panel-box" style={{ width: "440px" }}>
            <h3>Register Remote Browser Node</h3>
            <form onSubmit={handleRegisterWorker} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Worker Name</label>
                <input
                  type="text"
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  placeholder="e.g. RunPod US-East VPS"
                  value={newWorkerForm.name}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Endpoint URL</label>
                <input
                  type="text"
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  placeholder="http://10.0.0.5:18090"
                  value={newWorkerForm.endpointUrl}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, endpointUrl: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Geographic Region</label>
                <select
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  value={newWorkerForm.geoRegion}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, geoRegion: e.target.value })}
                >
                  <option value="us-east">US East (N. Virginia)</option>
                  <option value="us-west">US West (Oregon)</option>
                  <option value="eu-central">Europe (Frankfurt)</option>
                  <option value="asia-southeast">Asia (Singapore)</option>
                  <option value="global">Global Any</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Max Concurrency</label>
                <input
                  type="number"
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  value={newWorkerForm.maxConcurrentJobs}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, maxConcurrentJobs: parseInt(e.target.value, 10) || 3 })}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="bs-btn bs-btn-secondary" onClick={() => setShowNewWorkerModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="bs-btn bs-btn-primary">
                  Register Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Mission */}
      {showNewMissionModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(8px)" }}>
          <div className="bs-panel-box" style={{ width: "440px" }}>
            <h3>Create Multi-Agent Mission</h3>
            <form onSubmit={handleCreateMission} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Mission Name</label>
                <input
                  type="text"
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  value={newMissionForm.name}
                  onChange={(e) => setNewMissionForm({ ...newMissionForm, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Target Domain</label>
                <input
                  type="text"
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem" }}
                  value={newMissionForm.targetDomain}
                  onChange={(e) => setNewMissionForm({ ...newMissionForm, targetDomain: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--bs-text-muted)" }}>Goal / Brief</label>
                <textarea
                  className="bs-url-input"
                  style={{ width: "100%", marginTop: "0.25rem", height: "80px", resize: "none" }}
                  value={newMissionForm.goal}
                  onChange={(e) => setNewMissionForm({ ...newMissionForm, goal: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="bs-btn bs-btn-secondary" onClick={() => setShowNewMissionModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="bs-btn bs-btn-primary">
                  Launch Squad
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
