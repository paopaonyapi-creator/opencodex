import { useState, useEffect } from "react";
import "../styles/operations-console.css";

interface FleetNode {
  id: string;
  name: string;
  nodeType: "local_desktop" | "remote_worker" | "cloud_vm" | "mobile_gateway";
  status: "online" | "degraded" | "offline" | "draining";
  capabilities: string[];
  endpointUrl?: string;
  activeJobs: number;
  maxConcurrency: number;
  lastHeartbeat: number;
  latencyMs: number;
  cpuLoadPercent: number;
  memoryUsageMb: number;
}

interface FleetJob {
  id: string;
  taskType: string;
  priority: "P0" | "P1" | "P2" | "P3";
  payload: Record<string, unknown>;
  requiredCapabilities: string[];
  assignedNodeId?: string;
  status: "queued" | "dispatched" | "running" | "completed" | "failed" | "migrating";
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  checkpointData?: Record<string, unknown>;
  error?: string;
}

interface SloMetrics {
  availabilityPercent: number;
  targetAvailabilityPercent: number;
  errorBudgetMinutesRemaining: number;
  totalErrorBudgetMinutes: number;
  p95LatencyMs: number;
  burnRate: number;
  backpressureActive: boolean;
  evaluatedAt: string;
}

interface FailoverEvent {
  id: string;
  failedNodeId: string;
  targetNodeId: string;
  migratedJobIds: string[];
  reason: string;
  timestamp: number;
  recoveredSuccessfully: boolean;
}

interface SwarmMessage {
  id: string;
  topic: string;
  senderAgentId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

const INITIAL_NODES: FleetNode[] = [
  {
    id: "node-local-primary",
    name: "Local Desktop Host",
    nodeType: "local_desktop",
    status: "online",
    capabilities: ["desktop_vision", "code_edit", "shell_exec", "browser_control"],
    activeJobs: 1,
    maxConcurrency: 8,
    lastHeartbeat: Date.now() - 2000,
    latencyMs: 12,
    cpuLoadPercent: 24,
    memoryUsageMb: 512,
  },
  {
    id: "node-cloud-gpu-01",
    name: "RunPod Cloud GPU H100",
    nodeType: "cloud_vm",
    status: "online",
    capabilities: ["sd_xl_render", "video_generation", "bulk_compute"],
    activeJobs: 3,
    maxConcurrency: 10,
    lastHeartbeat: Date.now() - 5000,
    latencyMs: 48,
    cpuLoadPercent: 62,
    memoryUsageMb: 4096,
  },
  {
    id: "node-mobile-artemis",
    name: "Google ARTEMIS Android Worker",
    nodeType: "mobile_gateway",
    status: "online",
    capabilities: ["mobile_touch", "app_install", "sms_verification"],
    activeJobs: 0,
    maxConcurrency: 2,
    lastHeartbeat: Date.now() - 8000,
    latencyMs: 85,
    cpuLoadPercent: 18,
    memoryUsageMb: 320,
  },
];

const INITIAL_JOBS: FleetJob[] = [
  {
    id: "job-sdlc-worktree-01",
    taskType: "sdlc_worktree_execution",
    priority: "P0",
    payload: { branch: "dev", testSuite: "all" },
    requiredCapabilities: ["code_edit", "shell_exec"],
    assignedNodeId: "node-local-primary",
    status: "running",
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now() - 30000,
    updatedAt: Date.now() - 5000,
    checkpointData: { step: "typecheck", completedFiles: 42 },
  },
  {
    id: "job-stock-video-02",
    taskType: "stock_video_synthesis",
    priority: "P1",
    payload: { prompt: "Cyberpunk neon city aerial hyperlapse", duration: 5 },
    requiredCapabilities: ["video_generation"],
    assignedNodeId: "node-cloud-gpu-01",
    status: "running",
    retryCount: 0,
    maxRetries: 2,
    createdAt: Date.now() - 45000,
    updatedAt: Date.now() - 8000,
    checkpointData: { framesRendered: 60, totalFrames: 120 },
  },
];

const INITIAL_SLO: SloMetrics = {
  availabilityPercent: 99.94,
  targetAvailabilityPercent: 99.9,
  errorBudgetMinutesRemaining: 39.8,
  totalErrorBudgetMinutes: 43.2,
  p95LatencyMs: 142,
  burnRate: 0.42,
  backpressureActive: false,
  evaluatedAt: new Date().toISOString(),
};

const INITIAL_FAILOVERS: FailoverEvent[] = [
  {
    id: "failover-demo-01",
    failedNodeId: "node-remote-aux-03",
    targetNodeId: "dynamic_reassigned",
    migratedJobIds: ["job-scraping-38a1"],
    reason: "Missed heartbeat > 30s (worker network partition)",
    timestamp: Date.now() - 3600000,
    recoveredSuccessfully: true,
  },
];

export default function OperationsConsole({ apiBase }: { apiBase?: string }) {
  const [nodes, setNodes] = useState<FleetNode[]>(INITIAL_NODES);
  const [jobs, setJobs] = useState<FleetJob[]>(INITIAL_JOBS);
  const [slo, setSlo] = useState<SloMetrics>(INITIAL_SLO);
  const [failovers, setFailovers] = useState<FailoverEvent[]>(INITIAL_FAILOVERS);
  const [messages, setMessages] = useState<SwarmMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"fleet" | "jobs" | "slo" | "failover" | "swarm">("fleet");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const base = apiBase || "";
    const fetchLive = () => {
      Promise.all([
        fetch(`${base}/api/agent-os/operations/fleet`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/operations/jobs`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/operations/slo`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/operations/failovers`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/operations/swarm/messages`).then((r) => (r.ok ? r.json() : null)),
      ])
        .then(([fleetData, jobData, sloData, failoverData, swarmData]) => {
          if (fleetData?.nodes && fleetData.nodes.length > 0) setNodes(fleetData.nodes);
          if (jobData?.jobs) setJobs(jobData.jobs);
          if (sloData?.metrics) setSlo(sloData.metrics);
          if (failoverData?.events) setFailovers(failoverData.events);
          if (swarmData?.messages) setMessages(swarmData.messages);
        })
        .catch(() => {
          // Fallback to local state
        });
    };

    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => clearInterval(interval);
  }, [apiBase, tick]);

  const handleHeartbeat = async (nodeId: string) => {
    setFeedback(`Sending simulated heartbeat to ${nodeId}...`);
    try {
      const res = await fetch(`${apiBase || ""}/api/agent-os/operations/fleet/${encodeURIComponent(nodeId)}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latencyMs: 18 }),
      });
      if (res.ok) {
        setFeedback(`Node ${nodeId} heartbeat accepted.`);
        setTick((t) => t + 1);
      } else {
        // Local update fallback
        setNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, status: "online" } : n))
        );
        setFeedback(`Heartbeat updated locally for ${nodeId}.`);
      }
    } catch {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, status: "online" } : n))
      );
      setFeedback(`Heartbeat updated locally for ${nodeId}.`);
    }
  };

  const handleDrain = async (nodeId: string) => {
    setFeedback(`Draining node ${nodeId}...`);
    try {
      await fetch(`${apiBase || ""}/api/agent-os/operations/fleet/${encodeURIComponent(nodeId)}/drain`, {
        method: "POST",
      });
      setTick((t) => t + 1);
    } catch {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, status: "draining" } : n))
      );
    }
    setFeedback(`Node ${nodeId} is now draining.`);
  };

  const handleTriggerFailover = async (nodeId: string) => {
    setFeedback(`Triggering automated failover for node ${nodeId}...`);
    try {
      const res = await fetch(`${apiBase || ""}/api/agent-os/operations/failover/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, reason: "Operator triggered simulated infrastructure dropout" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFeedback(`Failover event executed successfully: ${data.event?.id}`);
        setTick((t) => t + 1);
        return;
      }
    } catch {
      // Fallback local simulation
    }

    const newEvent: FailoverEvent = {
      id: "failover-sim-recovery",
      failedNodeId: nodeId,
      targetNodeId: "node-cloud-gpu-01",
      migratedJobIds: ["job-sdlc-worktree-01"],
      reason: "Simulated worker partition",
      timestamp: 1726000000000,
      recoveredSuccessfully: true,
    };
    setFailovers((prev) => [newEvent, ...prev]);
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, status: "offline", activeJobs: 0 } : n))
    );
    setJobs((prev) =>
      prev.map((j) =>
        j.assignedNodeId === nodeId ? { ...j, assignedNodeId: "node-cloud-gpu-01", status: "running" } : j
      )
    );
    setFeedback(`Self-healing failover completed for ${nodeId}: migrated jobs to node-cloud-gpu-01.`);
  };

  const onlineCount = nodes.filter((n) => n.status === "online").length;
  const budgetPercent = Number(((slo.errorBudgetMinutesRemaining / slo.totalErrorBudgetMinutes) * 100).toFixed(1));

  return (
    <div className="operations-container" id="operations-console-view">
      {/* Header */}
      <header className="operations-header">
        <div className="operations-title-group">
          <h1>Autonomous Operations & Self-Healing Fleet (AOF)</h1>
          <p className="operations-subtitle">
            Heterogeneous Topologies • Automated Dropout Recovery • Real-time SLO Governor • Swarm Coordination
          </p>
        </div>
        <div className="operations-actions">
          <button
            className="btn-aof btn-aof-secondary"
            id="btn-refresh-operations"
            onClick={() => setTick((t) => t + 1)}
          >
            Refresh Telemetry
          </button>
          <button
            className="btn-aof btn-aof-primary"
            id="btn-dispatch-test-job"
            onClick={async () => {
              setFeedback("Dispatching test swarm job...");
              try {
                await fetch(`${apiBase || ""}/api/agent-os/operations/jobs`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    taskType: "browser_scraping_mission",
                    priority: "P1",
                    payload: { target: "https://trends.google.com" },
                    requiredCapabilities: ["browser_control"],
                  }),
                });
                setTick((t) => t + 1);
              } catch {
                // local fallback
                const newJob: FleetJob = {
                  id: "job-test-dispatched",
                  taskType: "browser_scraping_mission",
                  priority: "P1",
                  payload: { target: "https://trends.google.com" },
                  requiredCapabilities: ["browser_control"],
                  assignedNodeId: "node-local-primary",
                  status: "running",
                  retryCount: 0,
                  maxRetries: 3,
                  createdAt: 1726000000000,
                  updatedAt: 1726000000000,
                };
                setJobs((prev) => [newJob, ...prev]);
              }
              setFeedback("New job dispatched to healthy node.");
            }}
          >
            + Enqueue Fleet Job
          </button>
        </div>
      </header>

      {/* Feedback Alert */}
      {feedback && (
        <div className="feedback-banner" id="operations-feedback-banner">
          <span>{feedback}</span>
          <button
            style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontWeight: "bold" }}
            onClick={() => setFeedback(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Metric Cards Grid */}
      <section className="operations-metrics-grid">
        <div className="aof-metric-card" id="metric-fleet-nodes">
          <div className="aof-metric-header">
            <span>Fleet Nodes</span>
            <span>{onlineCount} / {nodes.length} ONLINE</span>
          </div>
          <div className="aof-metric-val">{nodes.length} Nodes</div>
          <div className="aof-metric-sub">
            {nodes.filter((n) => n.status === "degraded").length} Degraded • {nodes.filter((n) => n.status === "offline").length} Offline
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${(onlineCount / Math.max(1, nodes.length)) * 100}%`,
                background: "linear-gradient(90deg, #22c55e, #10b981)",
              }}
            />
          </div>
        </div>

        <div className="aof-metric-card" id="metric-availability-slo">
          <div className="aof-metric-header">
            <span>Service Availability (SLO)</span>
            <span>Target {slo.targetAvailabilityPercent}%</span>
          </div>
          <div className="aof-metric-val" style={{ color: slo.availabilityPercent >= slo.targetAvailabilityPercent ? "#4ade80" : "#f87171" }}>
            {slo.availabilityPercent}%
          </div>
          <div className="aof-metric-sub">P95 Latency: {slo.p95LatencyMs}ms</div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(100, slo.availabilityPercent)}%`,
                background: slo.availabilityPercent >= slo.targetAvailabilityPercent ? "#22c55e" : "#ef4444",
              }}
            />
          </div>
        </div>

        <div className="aof-metric-card" id="metric-error-budget">
          <div className="aof-metric-header">
            <span>Error Budget</span>
            <span>Burn: {slo.burnRate}x</span>
          </div>
          <div className="aof-metric-val">{slo.errorBudgetMinutesRemaining} min</div>
          <div className="aof-metric-sub">
            {budgetPercent}% budget remaining (Total {slo.totalErrorBudgetMinutes}m)
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${budgetPercent}%`,
                background: slo.burnRate > 2.0 ? "#ef4444" : "linear-gradient(90deg, #38bdf8, #818cf8)",
              }}
            />
          </div>
        </div>

        <div className="aof-metric-card" id="metric-in-flight-jobs">
          <div className="aof-metric-header">
            <span>Active Workloads</span>
            <span>{jobs.filter((j) => j.status === "running").length} Running</span>
          </div>
          <div className="aof-metric-val">{jobs.length} Total Jobs</div>
          <div className="aof-metric-sub">
            {jobs.filter((j) => j.status === "migrating").length} Migrating • {failovers.length} Failovers Healed
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{ width: "100%", background: "linear-gradient(90deg, #c084fc, #e879f9)" }}
            />
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="aof-tabs">
        <button
          className={`aof-tab-btn ${activeTab === "fleet" ? "active" : ""}`}
          onClick={() => setActiveTab("fleet")}
        >
          Fleet Topology ({nodes.length})
        </button>
        <button
          className={`aof-tab-btn ${activeTab === "jobs" ? "active" : ""}`}
          onClick={() => setActiveTab("jobs")}
        >
          Workload Scheduler ({jobs.length})
        </button>
        <button
          className={`aof-tab-btn ${activeTab === "failover" ? "active" : ""}`}
          onClick={() => setActiveTab("failover")}
        >
          Self-Healing Log ({failovers.length})
        </button>
        <button
          className={`aof-tab-btn ${activeTab === "swarm" ? "active" : ""}`}
          onClick={() => setActiveTab("swarm")}
        >
          Swarm Event Bus ({messages.length})
        </button>
      </nav>

      {/* Tab 1: Fleet Grid */}
      {activeTab === "fleet" && (
        <section className="fleet-grid" id="fleet-topology-grid">
          {nodes.map((node) => (
            <div className="fleet-node-card" key={node.id} id={`node-card-${node.id}`}>
              <div className="fleet-node-header">
                <div className="node-title-area">
                  <h3>{node.name}</h3>
                  <div className="node-id">{node.id}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
                  <span className={`badge-status ${node.status}`}>{node.status}</span>
                  <span className="badge-topology">{node.nodeType}</span>
                </div>
              </div>

              <div className="node-stats-grid">
                <div className="node-stat-item">
                  <div className="stat-label">Jobs / Max</div>
                  <div className="stat-val">{node.activeJobs} / {node.maxConcurrency}</div>
                </div>
                <div className="node-stat-item">
                  <div className="stat-label">Latency</div>
                  <div className="stat-val">{node.latencyMs} ms</div>
                </div>
                <div className="node-stat-item">
                  <div className="stat-label">CPU Load</div>
                  <div className="stat-val">{node.cpuLoadPercent}%</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.3rem" }}>Capabilities:</div>
                <div className="caps-chips">
                  {node.capabilities.map((cap) => (
                    <span className="cap-chip" key={cap}>{cap}</span>
                  ))}
                </div>
              </div>

              <div className="node-card-actions">
                <button
                  className="btn-aof btn-aof-secondary"
                  onClick={() => handleHeartbeat(node.id)}
                  title="Ping heartbeat"
                >
                  Heartbeat
                </button>
                <button
                  className="btn-aof btn-aof-secondary"
                  onClick={() => handleDrain(node.id)}
                  title="Gracefully drain jobs"
                >
                  Drain
                </button>
                <button
                  className="btn-aof btn-aof-danger"
                  onClick={() => handleTriggerFailover(node.id)}
                  title="Simulate sudden failure"
                >
                  Failover
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Tab 2: Workloads Table */}
      {activeTab === "jobs" && (
        <section className="aof-panel" id="workloads-panel">
          <h2 style={{ fontSize: "1.2rem", margin: "0 0 1rem 0" }}>Heterogeneous Fleet Jobs</h2>
          <table className="aof-table">
            <thead>
              <tr>
                <th>Job ID / Task</th>
                <th>Priority</th>
                <th>Assigned Node</th>
                <th>Status</th>
                <th>Retries</th>
                <th>Checkpoints</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{job.taskType}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "monospace" }}>{job.id}</div>
                  </td>
                  <td>
                    <span className={`priority-badge priority-${job.priority.toLowerCase()}`}>
                      {job.priority}
                    </span>
                  </td>
                  <td>{job.assignedNodeId || <em style={{ color: "#94a3b8" }}>Unassigned</em>}</td>
                  <td>
                    <span className={`badge-status ${job.status === "running" ? "online" : job.status === "migrating" ? "draining" : "degraded"}`}>
                      {job.status}
                    </span>
                  </td>
                  <td>{job.retryCount} / {job.maxRetries}</td>
                  <td>
                    {job.checkpointData ? (
                      <span style={{ fontSize: "0.75rem", color: "#38bdf8", fontFamily: "monospace" }}>
                        {JSON.stringify(job.checkpointData).slice(0, 32)}...
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    {job.status === "running" && (
                      <button
                        className="btn-aof btn-aof-secondary"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                        onClick={async () => {
                          await fetch(`${apiBase || ""}/api/agent-os/operations/jobs/${encodeURIComponent(job.id)}/complete`, {
                            method: "POST",
                          }).catch(() => {});
                          setTick((t) => t + 1);
                          setFeedback(`Job ${job.id} marked as completed.`);
                        }}
                      >
                        Complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab 3: Failover Events Log */}
      {activeTab === "failover" && (
        <section className="aof-panel" id="failover-log-panel">
          <h2 style={{ fontSize: "1.2rem", margin: "0 0 1rem 0" }}>Self-Healing & Failover Audit History</h2>
          <table className="aof-table">
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Failed Node</th>
                <th>Destination Node</th>
                <th>Migrated Tasks</th>
                <th>Reason</th>
                <th>Recovery</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {failovers.map((event) => (
                <tr key={event.id}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{event.id}</td>
                  <td style={{ color: "#f87171", fontWeight: 600 }}>{event.failedNodeId}</td>
                  <td style={{ color: "#4ade80", fontWeight: 600 }}>{event.targetNodeId}</td>
                  <td>{event.migratedJobIds.join(", ") || "None"}</td>
                  <td style={{ color: "#94a3b8" }}>{event.reason}</td>
                  <td>
                    <span className={`badge-status ${event.recoveredSuccessfully ? "online" : "offline"}`}>
                      {event.recoveredSuccessfully ? "RECOVERED" : "FAILED"}
                    </span>
                  </td>
                  <td style={{ color: "#64748b", fontSize: "0.8rem" }}>
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab 4: Swarm Bus Messages */}
      {activeTab === "swarm" && (
        <section className="aof-panel" id="swarm-messages-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.2rem", margin: 0 }}>Swarm Pub/Sub Event Stream</h2>
            <button
              className="btn-aof btn-aof-secondary"
              onClick={async () => {
                await fetch(`${apiBase || ""}/api/agent-os/operations/swarm/publish`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    topic: "fleet_coordination",
                    senderAgentId: "console-operator",
                    payload: { action: "sync_mesh" },
                  }),
                }).catch(() => {});
                setTick((t) => t + 1);
              }}
            >
              Publish Test Event
            </button>
          </div>
          <table className="aof-table">
            <thead>
              <tr>
                <th>Message ID</th>
                <th>Topic</th>
                <th>Sender Agent</th>
                <th>Payload</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "#64748b" }}>
                    No swarm messages published yet.
                  </td>
                </tr>
              ) : (
                messages.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{m.id}</td>
                    <td>
                      <span className="badge-topology">{m.topic}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{m.senderAgentId}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#38bdf8" }}>
                      {JSON.stringify(m.payload)}
                    </td>
                    <td style={{ color: "#64748b", fontSize: "0.8rem" }}>
                      {new Date(m.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
