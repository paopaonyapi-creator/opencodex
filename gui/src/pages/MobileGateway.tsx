// Phase 20.12: Pao-hubPro × Google ARTEMIS Mobile Agent Gateway — Dashboard UI
// Stage E of the architecture spec: Devices, Tasks, Trace, Approvals.

import React, { useState, useEffect, useCallback } from "react";
import "../styles/mobile-gateway.css";

interface MobileGatewayProps {
  apiBase: string;
}

type GatewayHealth = {
  ok: boolean;
  enabled: boolean;
  provider: string;
  devicesCount: number;
  readyDevicesCount: number;
  defaults?: {
    profile?: string;
    verification?: string;
    allowPhysical?: boolean;
  };
};

type DeviceType = "emulator" | "physical_test" | "physical_personal" | "cloud_device";

interface MobileDevice {
  id: string;
  alias: string;
  type: DeviceType;
  status: string;
  allowAgent?: boolean;
  allowShell?: boolean;
  requiresApproval?: boolean;
  osVersion?: string;
  screenHeight?: number;
  screenWidth?: number;
  maskedSerial?: string;
  lastHeartbeatMs?: number | null;
}

interface MobileTask {
  id: string;
  goal: string;
  status: string;
  riskLevel?: string;
  profile?: string;
  deviceId?: string;
  createdAt?: string;
  completedAt?: string | null;
  requestedByType?: string;
  requestedById?: string;
  approvedBy?: string | null;
}

interface TaskEvent {
  id: number;
  taskId: string;
  eventType: string;
  message?: string;
  tsMs?: number;
}

interface TaskArtifact {
  id: number;
  taskId: string;
  kind: string;
  mimeType?: string;
  dataBase64?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

interface TaskTrace {
  taskId: string;
  steps?: Array<{
    index?: number;
    action?: string;
    description?: string;
    status?: string;
    durationMs?: number;
  }>;
  reviewerVerdict?: {
    verdict?: string;
    confidence?: number;
    summary?: string;
  };
  events?: TaskEvent[];
  artifacts?: TaskArtifact[];
}

function fmtTime(value?: string | number | null): string {
  if (value === null || value === undefined) return "—";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (["READY", "COMPLETED", "PASS", "APPROVED", "ONLINE"].includes(s)) return "success";
  if (["WAITING_APPROVAL", "RUNNING", "VALIDATING", "CLASSIFYING_RISK", "VERIFYING", "NEW"].includes(s)) return "info";
  if (["DRAINING", "OFFLINE", "BUSY", "NEEDS_REVIEW"].includes(s)) return "warn";
  if (["BLOCKED_BY_POLICY", "CANCELLED", "REJECTED", "FAILED", "ERROR"].includes(s)) return "danger";
  return "neutral";
}

function riskBadgeClass(level?: string): string {
  switch (level) {
    case "R4": return "danger";
    case "R3": return "warn";
    case "R2": return "info";
    case "R1": return "success";
    case "R0": return "neutral";
    default: return "neutral";
  }
}

export default function MobileGateway({ apiBase }: MobileGatewayProps) {
  const [activeTab, setActiveTab] = useState<"devices" | "tasks" | "trace" | "approvals">("devices");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [tasks, setTasks] = useState<MobileTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TaskTrace | null>(null);
  const [traceArtifacts, setTraceArtifacts] = useState<TaskArtifact[]>([]);
  const [traceEvents, setTraceEvents] = useState<TaskEvent[]>([]);

  const [goalInput, setGoalInput] = useState("");
  const [profileSelect, setProfileSelect] = useState("flash");
  const [deviceSelect, setDeviceSelect] = useState("");
  const [verificationSelect, setVerificationSelect] = useState("standard");

  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [newDeviceForm, setNewDeviceForm] = useState({
    alias: "",
    providerDeviceId: "",
    type: "emulator" as DeviceType,
  });

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem("ocx-token") || "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/mobile/health`, { headers: getHeaders() });
      if (res.ok) {
        setHealth((await res.json()) as GatewayHealth);
      }
    } catch {
      // Silent poll fail
    }
  }, [apiBase, getHeaders]);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/mobile/devices`, { headers: getHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { devices?: MobileDevice[] };
        setDevices(data.devices || []);
      }
    } catch {
      // Silent poll fail
    }
  }, [apiBase, getHeaders]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/mobile/tasks`, { headers: getHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { tasks?: MobileTask[] };
        setTasks(data.tasks || []);
      }
    } catch {
      // Silent poll fail
    }
  }, [apiBase, getHeaders]);

  const fetchTrace = useCallback(async (taskId: string) => {
    try {
      const [traceRes, artifactsRes, eventsRes] = await Promise.all([
        fetch(`${apiBase}/api/mobile/tasks/${taskId}/trace`, { headers: getHeaders() }),
        fetch(`${apiBase}/api/mobile/tasks/${taskId}/artifacts`, { headers: getHeaders() }),
        fetch(`${apiBase}/api/mobile/tasks/${taskId}/events`, { headers: getHeaders() }),
      ]);

      if (traceRes.ok) {
        const data = (await traceRes.json()) as { trace?: TaskTrace };
        setTrace(data.trace || null);
      }
      if (artifactsRes.ok) {
        const data = (await artifactsRes.json()) as { artifacts?: TaskArtifact[] };
        setTraceArtifacts(data.artifacts || []);
      }
      if (eventsRes.ok) {
        const data = (await eventsRes.json()) as { events?: TaskEvent[] };
        setTraceEvents(data.events || []);
      }
    } catch {
      // Silent poll fail
    }
  }, [apiBase, getHeaders]);

  // Poll loop (async poll body keeps every setState behind an await, matching
  // the AgentControlCenter pattern the react-compiler rule accepts).
  useEffect(() => {
    let active = true;

    const poll = async () => {
      await Promise.all([fetchHealth(), fetchDevices(), fetchTasks()]);
      if (!active || !selectedTaskId) return;
      await fetchTrace(selectedTaskId);
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 6000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchHealth, fetchDevices, fetchTasks, fetchTrace, selectedTaskId]);

  const pendingApprovals = tasks.filter((t) => t.status === "WAITING_APPROVAL");

  const runTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/mobile/tasks`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          goal: goalInput.trim(),
          profile: profileSelect,
          verificationLevel: verificationSelect,
          deviceId: deviceSelect || undefined,
        }),
      });
      const data = (await res.json()) as { task?: MobileTask; error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message || `HTTP ${res.status}`);
      } else if (data.task) {
        setGoalInput("");
        await fetchTasks();
        if (data.task.status !== "BLOCKED_BY_POLICY") {
          setSelectedTaskId(data.task.id);
          setActiveTab("trace");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const approveTask = async (taskId: string) => {
    await fetch(`${apiBase}/api/mobile/tasks/${taskId}/approve`, {
      method: "POST",
      headers: getHeaders(),
    });
    await fetchTasks();
  };

  const rejectTask = async (taskId: string) => {
    await fetch(`${apiBase}/api/mobile/tasks/${taskId}/reject`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ reason: "Rejected from Mobile Gateway dashboard" }),
    });
    await fetchTasks();
  };

  const stopTask = async (taskId: string) => {
    await fetch(`${apiBase}/api/mobile/tasks/${taskId}/stop`, {
      method: "POST",
      headers: getHeaders(),
    });
    await fetchTasks();
  };

  const toggleDeviceAgentAccess = async (deviceId: string, enable: boolean) => {
    await fetch(`${apiBase}/api/mobile/devices/${deviceId}/${enable ? "enable" : "disable"}`, {
      method: "POST",
      headers: getHeaders(),
    });
    await fetchDevices();
  };

  const registerDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/mobile/devices`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(newDeviceForm),
      });
      const data = (await res.json()) as { device?: MobileDevice; error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message || `HTTP ${res.status}`);
      } else if (data.device) {
        setShowAddDeviceModal(false);
        setNewDeviceForm({ alias: "", providerDeviceId: "", type: "emulator" });
        await fetchDevices();
        await fetchHealth();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const screenshotArtifact = traceArtifacts.find(
    (a) => a.kind.toLowerCase().includes("screenshot") && a.dataBase64,
  );

  const tabs: Array<{ id: typeof activeTab; label: string; count?: number }> = [
    { id: "devices", label: "Devices" },
    { id: "tasks", label: "Tasks", count: tasks.length },
    { id: "trace", label: "Trace" },
    { id: "approvals", label: "Approvals", count: pendingApprovals.length },
  ];

  return (
    <div className="mg-container">
      <header className="mg-header">
        <div className="mg-header-titles">
          <h1><span style={{ fontSize: "1.4rem" }}>📱</span> Pao-hubPro Mobile Agent Gateway</h1>
          <p>ARTEMIS-powered Android automation · Risk-gated · Human-supervised</p>
        </div>
        <div className="mg-header-stats">
          <span className="mg-stat-pill">
            <span className="dot" style={{ background: health?.enabled ? "var(--mg-emerald)" : "var(--mg-crimson)" }} />
            {health?.enabled ? "Gateway Enabled" : "Gateway Disabled"}
          </span>
          <span className="mg-stat-pill">Provider: {health?.provider ?? "—"}</span>
          <span className="mg-stat-pill">Devices: {health?.devicesCount ?? 0} ({health?.readyDevicesCount ?? 0} ready)</span>
        </div>
      </header>

      {error && (
        <div className="mg-panel" style={{ borderColor: "var(--mg-crimson-glow)" }}>
          <p style={{ margin: 0, color: "var(--mg-crimson)" }}>{error}</p>
        </div>
      )}

      <nav className="mg-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`mg-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}{typeof tab.count === "number" ? ` (${tab.count})` : ""}
          </button>
        ))}
      </nav>

      {/* Devices tab */}
      {activeTab === "devices" && (
        <>
          <section className="mg-panel">
            <div className="mg-panel-title">
              <span>Registered Devices</span>
              <button className="mg-btn primary" onClick={() => setShowAddDeviceModal(true)}>
                + Add Device
              </button>
            </div>
            {devices.length === 0 ? (
              <div className="mg-empty">No devices registered yet.</div>
            ) : (
              <div className="mg-grid-2">
                {devices.map((d) => (
                  <div key={d.id} className="mg-device-card">
                    <div className="mg-device-head">
                      <div>
                        <div className="mg-device-name">{d.alias}</div>
                        <div className="mg-device-serial">{d.maskedSerial || "—"}</div>
                      </div>
                      <span className={`mg-badge ${statusBadgeClass(d.status)}`}>{d.status}</span>
                    </div>
                    <div className="mg-meta-row">
                      <span className="mg-badge purple">{d.type}</span>
                      {d.osVersion && <span className="mg-badge neutral">{d.osVersion}</span>}
                      {d.requiresApproval && <span className="mg-badge warn">Approval Required</span>}
                    </div>
                    <div className="mg-meta-row">
                      <span className={`mg-badge ${d.allowAgent ? "success" : "neutral"}`}>
                        Agent {d.allowAgent ? "Allowed" : "Blocked"}
                      </span>
                      {d.allowShell !== undefined && (
                        <span className={`mg-badge ${d.allowShell ? "success" : "neutral"}`}>
                          Shell {d.allowShell ? "Allowed" : "Blocked"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="mg-btn"
                        onClick={() => toggleDeviceAgentAccess(d.id, !d.allowAgent)}
                        disabled={d.type === "physical_personal"}
                        title={d.type === "physical_personal" ? "Personal devices cannot enable agent access" : undefined}
                      >
                        {d.allowAgent ? "Disable Agent" : "Enable Agent"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Tasks tab */}
      {activeTab === "tasks" && (
        <>
          <section className="mg-panel">
            <div className="mg-panel-title">
              <span>Run New Task</span>
            </div>
            <form className="mg-form" onSubmit={runTask}>
              <label>
                Goal
                <input
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder="Open Settings and find Battery"
                  required
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
                <label>
                  Device
                  <select value={deviceSelect} onChange={(e) => setDeviceSelect(e.target.value)}>
                    <option value="">Auto-select</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>{d.alias}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Profile
                  <select value={profileSelect} onChange={(e) => setProfileSelect(e.target.value)}>
                    <option value="flash">Flash</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
                <label>
                  Verification
                  <select value={verificationSelect} onChange={(e) => setVerificationSelect(e.target.value)}>
                    <option value="standard">Standard</option>
                    <option value="strict">Strict</option>
                  </select>
                </label>
              </div>
              <button type="submit" className="mg-btn primary" disabled={loading}>
                {loading ? "Running…" : "Run Task"}
              </button>
            </form>
          </section>

          <section className="mg-panel">
            <div className="mg-panel-title">
              <span>Recent Tasks</span>
            </div>
            {tasks.length === 0 ? (
              <div className="mg-empty">No tasks yet.</div>
            ) : (
              <div className="mg-table-wrap">
                <table className="mg-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Goal</th>
                      <th>Status</th>
                      <th>Risk</th>
                      <th>Profile</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id}>
                        <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{t.id.slice(0, 12)}</td>
                        <td>{t.goal}</td>
                        <td><span className={`mg-badge ${statusBadgeClass(t.status)}`}>{t.status}</span></td>
                        <td><span className={`mg-badge ${riskBadgeClass(t.riskLevel)}`}>{t.riskLevel || "—"}</span></td>
                        <td>{t.profile || "—"}</td>
                        <td>{fmtTime(t.createdAt)}</td>
                        <td>
                          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            <button
                              className="mg-btn"
                              onClick={() => {
                                setSelectedTaskId(t.id);
                                setActiveTab("trace");
                              }}
                            >
                              Trace
                            </button>
                            {t.status === "WAITING_APPROVAL" && (
                              <button className="mg-btn approve" onClick={() => approveTask(t.id)}>Approve</button>
                            )}
                            {t.status === "WAITING_APPROVAL" && (
                              <button className="mg-btn danger" onClick={() => rejectTask(t.id)}>Reject</button>
                            )}
                            {(t.status === "RUNNING" || t.status === "WAITING_APPROVAL") && (
                              <button className="mg-btn danger" onClick={() => stopTask(t.id)}>Stop</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Trace tab */}
      {activeTab === "trace" && (
        <section className="mg-panel">
          <div className="mg-panel-title">
            <span>Task Trace</span>
            {selectedTaskId && (
              <button className="mg-btn" onClick={() => void fetchTrace(selectedTaskId)}>Refresh</button>
            )}
          </div>
          {!selectedTaskId ? (
            <div className="mg-empty">Select a task from the Tasks tab to inspect its trace.</div>
          ) : (
            <>
              <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <span className="mg-badge info" style={{ fontFamily: "monospace" }}>{selectedTaskId.slice(0, 16)}</span>
                {trace?.reviewerVerdict?.verdict && (
                  <span className={`mg-badge ${statusBadgeClass(trace.reviewerVerdict.verdict)}`}>
                    Reviewer: {trace.reviewerVerdict.verdict}
                  </span>
                )}
                {trace?.reviewerVerdict?.confidence !== undefined && trace?.reviewerVerdict?.confidence !== null && (
                  <span className="mg-badge neutral">Confidence: {trace.reviewerVerdict.confidence}</span>
                )}
              </div>

              <h4 style={{ margin: "0.75rem 0 0.5rem" }}>Steps</h4>
              {(!trace?.steps || trace.steps.length === 0) ? (
                <div className="mg-empty">No steps recorded.</div>
              ) : (
                <ul className="mg-trace-list">
                  {trace.steps.map((s, i) => (
                    <li key={s.index ?? i} className="mg-trace-item">
                      <div className="mg-trace-head">
                        <span>{s.index ?? i + 1}. {s.action || "step"}</span>
                        <span className={`mg-badge ${statusBadgeClass(s.status || "")}`}>{s.status || "—"}</span>
                      </div>
                      {s.description && <p className="mg-trace-detail">{s.description}</p>}
                      {s.durationMs !== undefined && (
                        <p className="mg-trace-detail">{s.durationMs}ms</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <h4 style={{ margin: "1.25rem 0 0.5rem" }}>Events</h4>
              {traceEvents.length === 0 ? (
                <div className="mg-empty">No events recorded.</div>
              ) : (
                <ul className="mg-trace-list">
                  {traceEvents.map((ev) => (
                    <li key={ev.id} className="mg-trace-item">
                      <div className="mg-trace-head">
                        <span>{ev.eventType}</span>
                        <span className="mg-badge neutral">{fmtTime(ev.tsMs)}</span>
                      </div>
                      {ev.message && <p className="mg-trace-detail">{ev.message}</p>}
                    </li>
                  ))}
                </ul>
              )}

              <h4 style={{ margin: "1.25rem 0 0.5rem" }}>Evidence</h4>
              {screenshotArtifact ? (
                <img
                  className="mg-screenshot"
                  src={`data:${screenshotArtifact.mimeType || "image/png"};base64,${screenshotArtifact.dataBase64}`}
                  alt="Task screenshot evidence"
                />
              ) : (
                <div className="mg-empty">No screenshot evidence captured for this task.</div>
              )}
            </>
          )}
        </section>
      )}

      {/* Approvals tab */}
      {activeTab === "approvals" && (
        <section className="mg-panel">
          <div className="mg-panel-title">
            <span>Pending Approvals (R3 High-Risk Tasks)</span>
          </div>
          {pendingApprovals.length === 0 ? (
            <div className="mg-empty">No tasks awaiting approval.</div>
          ) : (
            <div className="mg-grid-2">
              {pendingApprovals.map((t) => (
                <div key={t.id} className="mg-device-card">
                  <div className="mg-device-head">
                    <div>
                      <div className="mg-device-name">{t.goal}</div>
                      <div className="mg-device-serial" style={{ fontFamily: "monospace" }}>{t.id}</div>
                    </div>
                    <span className="mg-badge warn">{t.riskLevel || "R3"}</span>
                  </div>
                  <p className="mg-trace-detail">
                    This task was classified as high-risk and requires human supervisor approval before execution.
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="mg-btn approve" onClick={() => approveTask(t.id)}>Approve</button>
                    <button className="mg-btn danger" onClick={() => rejectTask(t.id)}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Add Device modal */}
      {showAddDeviceModal && (
        <div className="mg-modal-overlay" role="dialog" aria-modal="true">
          <div className="mg-modal">
            <h3>Register Device</h3>
            <form className="mg-form" onSubmit={registerDevice}>
              <label>
                Alias
                <input
                  value={newDeviceForm.alias}
                  onChange={(e) => setNewDeviceForm((f) => ({ ...f, alias: e.target.value }))}
                  placeholder="Pixel 8 Emulator"
                  required
                />
              </label>
              <label>
                Provider Device ID (Serial / ADB)
                <input
                  value={newDeviceForm.providerDeviceId}
                  onChange={(e) => setNewDeviceForm((f) => ({ ...f, providerDeviceId: e.target.value }))}
                  placeholder="emulator-5554"
                  required
                />
              </label>
              <label>
                Type
                <select
                  value={newDeviceForm.type}
                  onChange={(e) => setNewDeviceForm((f) => ({ ...f, type: e.target.value as DeviceType }))}
                >
                  <option value="emulator">Emulator</option>
                  <option value="physical_test">Physical Test Device</option>
                  <option value="physical_personal">Physical Personal Device</option>
                  <option value="cloud_device">Cloud Device</option>
                </select>
              </label>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="mg-btn" onClick={() => setShowAddDeviceModal(false)}>Cancel</button>
                <button type="submit" className="mg-btn primary">Register</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
