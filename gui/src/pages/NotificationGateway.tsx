// Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer
// Glassmorphic Control Dashboard

import React, { useState, useEffect, useCallback } from "react";
import "../styles/notification-gateway.css";

interface NotificationStatus {
  enabled: boolean;
  workerEnabled: boolean;
  workerActive: boolean;
  discordEnabled: boolean;
  totalDestinations: number;
  healthyDestinations: number;
  openCircuits: number;
  queuedDeliveries: number;
  rateLimitedDeliveries: number;
  openDeadLetters: number;
  invalidRequests10m: number;
}

interface NotificationMetrics {
  eventsToday: number;
  deliveriesToday: number;
  delivered: number;
  retrying: number;
  rateLimited: number;
  failed: number;
  deadLetter: number;
  successRate: number;
  rateLimitCount10m: number;
  invalidRequests10m: number;
  activeDestinations: number;
  openCircuits: number;
}

interface Destination {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  environment: string;
  channelClass: string;
  health: string;
  invalidReason: string | null;
  rateLimitStateKey: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  id: string;
  eventId: string;
  destinationId: string;
  provider: string;
  status: string;
  priority: string;
  attempt: number;
  maxAttempts: number;
  availableAtMs: number;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

interface DeliveryAttempt {
  id: string;
  deliveryId: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  statusCode: number | null;
  errorCode: string | null;
  retryAfterMs: number | null;
  bucketId: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAfterMs: number | null;
  globalRateLimited: boolean;
  durationMs: number;
}

interface RateLimitState {
  stateKey: string;
  provider: string;
  destinationId: string | null;
  bucketId: string | null;
  scope: string | null;
  limit: number | null;
  remaining: number | null;
  resetAfterMs: number | null;
  blockedUntilMs: number | null;
  observedAt: string | null;
  rateLimitedCount: number;
}

interface ProviderGate {
  provider: string;
  blockedUntilMs: number | null;
  reason: string | null;
  observedAt: string | null;
}

interface DeadLetter {
  id: string;
  deliveryId: string;
  eventId: string;
  destinationId: string;
  reason: string;
  lastErrorCode: string | null;
  attempts: number;
  status: string;
  createdAt: string;
}

interface NotificationEventItem {
  id: string;
  source: string;
  eventType: string;
  title: string;
  message: string | null;
  severity: string;
  priority: string;
  status: string | null;
  occurredAt: string;
  data: Record<string, unknown>;
}

type TabType = "overview" | "destinations" | "deliveries" | "rate-limits" | "dead-letters" | "events";

export function NotificationGateway(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [metrics, setMetrics] = useState<NotificationMetrics | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [rateLimits, setRateLimits] = useState<{ states: RateLimitState[]; gates: ProviderGate[] }>({ states: [], gates: [] });
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [events, setEvents] = useState<NotificationEventItem[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Modals
  const [showAddDestModal, setShowAddDestModal] = useState(false);
  const [showTestSendModal, setShowTestSendModal] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<{ delivery: Delivery; attempts: DeliveryAttempt[]; event: NotificationEventItem | null } | null>(null);

  // Form states
  const [newDestId, setNewDestId] = useState("");
  const [newDestName, setNewDestName] = useState("");
  const [newDestSecretRef, setNewDestSecretRef] = useState("env:DISCORD_WEBHOOK_URL");
  const [newDestClass, setNewDestClass] = useState("general");

  const [testTitle, setTestTitle] = useState("Test Ping from Dashboard");
  const [testMessage, setTestMessage] = useState("Manual verification dispatched via Web UI");
  const [testSeverity, setTestSeverity] = useState("info");
  const [testPriority, setTestPriority] = useState("P2");
  const [testDestination, setTestDestination] = useState("");

  const showNotification = (text: string, type: "success" | "error" = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [resStatus, resMetrics, resDest, resDeliv, resRL, resDL, resEvt] = await Promise.all([
        fetch("/api/agent-os/notifications/status").then((r) => r.json()),
        fetch("/api/agent-os/notifications/metrics").then((r) => r.json()),
        fetch("/api/agent-os/notifications/destinations").then((r) => r.json()),
        fetch("/api/agent-os/notifications/deliveries?limit=50").then((r) => r.json()),
        fetch("/api/agent-os/notifications/rate-limits").then((r) => r.json()),
        fetch("/api/agent-os/notifications/dead-letters").then((r) => r.json()),
        fetch("/api/agent-os/notifications/events?limit=50").then((r) => r.json()),
      ]);

      if (resStatus.status) setStatus(resStatus.status);
      if (resMetrics.metrics) setMetrics(resMetrics.metrics);
      if (resDest.destinations) setDestinations(resDest.destinations);
      if (resDeliv.deliveries) setDeliveries(resDeliv.deliveries);
      if (resRL.states) setRateLimits(resRL);
      if (resDL.deadLetters) setDeadLetters(resDL.deadLetters);
      if (resEvt.events) setEvents(resEvt.events);
      setNowTs(Date.now());
    } catch {
      showNotification("Failed to connect to Notification Gateway API", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  const handleCreateDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDestId.trim() || !newDestName.trim() || !newDestSecretRef.trim()) return;

    try {
      const res = await fetch("/api/agent-os/notifications/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newDestId.trim(),
          name: newDestName.trim(),
          secretRef: newDestSecretRef.trim(),
          channelClass: newDestClass,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create destination");

      showNotification(`Destination '${newDestId}' registered successfully`);
      setShowAddDestModal(false);
      setNewDestId("");
      setNewDestName("");
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleToggleDestination = async (id: string, currentlyEnabled: boolean) => {
    const endpoint = currentlyEnabled
      ? "/api/agent-os/notifications/destinations/disable"
      : "/api/agent-os/notifications/destinations/enable";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Toggle destination failed");
      showNotification(`Destination '${id}' ${currentlyEnabled ? "disabled" : "enabled"}`);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleTestDestination = async (id: string) => {
    try {
      const res = await fetch("/api/agent-os/notifications/destinations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Test dispatch failed");
      showNotification(`Test notification queued for '${id}'`);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleManualSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle.trim()) return;

    try {
      const res = await fetch("/api/agent-os/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: testTitle.trim(),
          message: testMessage.trim() || undefined,
          severity: testSeverity,
          priority: testPriority,
          destination: testDestination || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Send failed");
      showNotification("Notification event admitted into gateway");
      setShowTestSendModal(false);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRetryDelivery = async (id: string) => {
    try {
      const res = await fetch("/api/agent-os/notifications/deliveries/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Retry failed");
      showNotification(`Delivery '${id}' returned to queue`);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRetryDeadLetter = async (id: string) => {
    try {
      const res = await fetch("/api/agent-os/notifications/dead-letters/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Retry failed");
      showNotification(`Dead letter '${id}' retried`);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDismissDeadLetter = async (id: string) => {
    try {
      const res = await fetch("/api/agent-os/notifications/dead-letters/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Dismiss failed");
      showNotification(`Dead letter '${id}' dismissed`);
      void loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleViewDeliveryDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/agent-os/notifications/delivery?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedDelivery(data);
      }
    } catch {
      showNotification("Failed to fetch delivery details", "error");
    }
  };

  return (
    <div className="notification-gateway">
      {/* Header */}
      <div className="notification-gateway-header">
        <div>
          <h1>Unified Notification Gateway</h1>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary, #8b949e)" }}>
            Phase 20.23 • Discord Webhook Reliability Layer • Adaptive Rate Limiter & Priority Queue
          </span>
        </div>
        <div className="notification-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadData()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowTestSendModal(true)}>
            + Emit Event
          </button>
        </div>
      </div>

      {/* Toast Alert */}
      {message && (
        <div style={{
          padding: "12px 16px",
          borderRadius: "8px",
          marginBottom: "16px",
          background: message.type === "error" ? "rgba(237,66,69,0.2)" : "rgba(87,242,135,0.2)",
          border: `1px solid ${message.type === "error" ? "rgba(237,66,69,0.4)" : "rgba(87,242,135,0.4)"}`,
          color: message.type === "error" ? "#ed4245" : "#57f287",
        }}>
          {message.text}
        </div>
      )}

      {/* Tab Bar */}
      <div className="notification-tabs">
        <button type="button" className={`notification-tab-btn ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button type="button" className={`notification-tab-btn ${activeTab === "destinations" ? "active" : ""}`} onClick={() => setActiveTab("destinations")}>
          Destinations ({destinations.length})
        </button>
        <button type="button" className={`notification-tab-btn ${activeTab === "deliveries" ? "active" : ""}`} onClick={() => setActiveTab("deliveries")}>
          Deliveries ({deliveries.length})
        </button>
        <button type="button" className={`notification-tab-btn ${activeTab === "rate-limits" ? "active" : ""}`} onClick={() => setActiveTab("rate-limits")}>
          Rate Limits ({rateLimits.states.length})
        </button>
        <button type="button" className={`notification-tab-btn ${activeTab === "dead-letters" ? "active" : ""}`} onClick={() => setActiveTab("dead-letters")}>
          Dead Letters ({deadLetters.length})
        </button>
        <button type="button" className={`notification-tab-btn ${activeTab === "events" ? "active" : ""}`} onClick={() => setActiveTab("events")}>
          Event Explorer ({events.length})
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <>
          <div className="notification-metric-grid">
            <div className="notification-metric-card">
              <span className="metric-title">Gateway Status</span>
              <span className="metric-value">
                <span className={`badge badge-${status?.enabled ? "healthy" : "disabled"}`}>
                  {status?.enabled ? "ACTIVE" : "DISABLED"}
                </span>
              </span>
              <span className="metric-sub">Worker: {status?.workerEnabled ? "Running" : "Off"}</span>
            </div>
            <div className="notification-metric-card">
              <span className="metric-title">Success Rate</span>
              <span className="metric-value">{metrics?.successRate ?? 100}%</span>
              <span className="metric-sub">{metrics?.delivered ?? 0} delivered</span>
            </div>
            <div className="notification-metric-card">
              <span className="metric-title">Queue Depth</span>
              <span className="metric-value">{status?.queuedDeliveries ?? 0}</span>
              <span className="metric-sub">{status?.rateLimitedDeliveries ?? 0} rate-limited</span>
            </div>
            <div className="notification-metric-card">
              <span className="metric-title">Dead Letters</span>
              <span className="metric-value" style={{ color: (status?.openDeadLetters ?? 0) > 0 ? "#ed4245" : "#57f287" }}>
                {status?.openDeadLetters ?? 0}
              </span>
              <span className="metric-sub">Open circuits: {status?.openCircuits ?? 0}</span>
            </div>
            <div className="notification-metric-card">
              <span className="metric-title">Invalid Req (10m)</span>
              <span className="metric-value">{metrics?.invalidRequests10m ?? 0}</span>
              <span className="metric-sub">429 Count: {metrics?.rateLimitCount10m ?? 0}</span>
            </div>
          </div>

          <div className="notification-panel">
            <h2>Recent Deliveries</h2>
            <div className="notification-table-wrap">
              <table className="notification-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Priority</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th>Attempt</th>
                    <th>HTTP</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.slice(0, 5).map((del) => (
                    <tr key={del.id}>
                      <td>{new Date(del.createdAt).toLocaleTimeString()}</td>
                      <td><span className="badge badge-info">{del.priority}</span></td>
                      <td><code>{del.destinationId}</code></td>
                      <td>
                        <span className={`badge badge-${del.status.toLowerCase()}`}>
                          {del.status}
                        </span>
                      </td>
                      <td>{del.attempt} / {del.maxAttempts}</td>
                      <td>{del.lastStatusCode ?? "—"}</td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleViewDeliveryDetails(del.id)}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {deliveries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="notification-empty-state">No deliveries recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: DESTINATIONS */}
      {activeTab === "destinations" && (
        <div className="notification-panel">
          <h2>
            <span>Registered Destinations</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddDestModal(true)}>
              + Add Destination
            </button>
          </h2>
          <div className="notification-table-wrap">
            <table className="notification-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Environment</th>
                  <th>Health</th>
                  <th>Enabled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((dest) => (
                  <tr key={dest.id}>
                    <td><code>{dest.id}</code></td>
                    <td><strong>{dest.name}</strong></td>
                    <td><span className="badge badge-info">{dest.channelClass}</span></td>
                    <td>{dest.environment}</td>
                    <td>
                      <span className={`badge badge-${dest.health}`}>
                        {dest.health}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${dest.enabled ? "healthy" : "disabled"}`}>
                        {dest.enabled ? "ACTIVE" : "OFF"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleTestDestination(dest.id)}>
                          Test
                        </button>
                        <button
                          type="button"
                          className={`btn ${dest.enabled ? "btn-danger" : "btn-primary"} btn-sm`}
                          onClick={() => void handleToggleDestination(dest.id, dest.enabled)}
                        >
                          {dest.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {destinations.length === 0 && (
                  <tr>
                    <td colSpan={7} className="notification-empty-state">No destinations configured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: DELIVERIES */}
      {activeTab === "deliveries" && (
        <div className="notification-panel">
          <h2>Delivery History Ledger</h2>
          <div className="notification-table-wrap">
            <table className="notification-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Event ID</th>
                  <th>Destination</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>HTTP Code</th>
                  <th>Error Code</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((del) => (
                  <tr key={del.id}>
                    <td><code>{del.id.slice(0, 10)}...</code></td>
                    <td><code>{del.eventId.slice(0, 10)}...</code></td>
                    <td><code>{del.destinationId}</code></td>
                    <td><span className="badge badge-info">{del.priority}</span></td>
                    <td>
                      <span className={`badge badge-${del.status.toLowerCase()}`}>
                        {del.status}
                      </span>
                    </td>
                    <td>{del.attempt} / {del.maxAttempts}</td>
                    <td>{del.lastStatusCode ?? "—"}</td>
                    <td>{del.lastErrorCode ? <code>{del.lastErrorCode}</code> : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleViewDeliveryDetails(del.id)}>
                          Inspect
                        </button>
                        {(del.status === "FAILED" || del.status === "DEAD_LETTER") && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleRetryDelivery(del.id)}>
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={9} className="notification-empty-state">No delivery jobs in history.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: RATE LIMITS */}
      {activeTab === "rate-limits" && (
        <>
          {rateLimits.gates.length > 0 && (
            <div className="notification-panel" style={{ borderColor: "rgba(237,66,69,0.5)" }}>
              <h2 style={{ color: "#ed4245" }}>Global Provider Gates Active</h2>
              <div className="notification-table-wrap">
                <table className="notification-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Reason</th>
                      <th>Blocked Until</th>
                      <th>Observed At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateLimits.gates.map((g) => (
                      <tr key={g.provider}>
                        <td><strong>{g.provider}</strong></td>
                        <td><span className="badge badge-danger">{g.reason}</span></td>
                        <td>{g.blockedUntilMs ? new Date(g.blockedUntilMs).toLocaleTimeString() : "Indefinite"}</td>
                        <td>{g.observedAt ? new Date(g.observedAt).toLocaleTimeString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="notification-panel">
            <h2>Observed Discord Rate-Limit Buckets</h2>
            <div className="notification-table-wrap">
              <table className="notification-table">
                <thead>
                  <tr>
                    <th>Bucket ID</th>
                    <th>Destination</th>
                    <th>Scope</th>
                    <th>Remaining</th>
                    <th>Limit</th>
                    <th>Reset After</th>
                    <th>Blocked Until</th>
                    <th>429 Hits</th>
                    <th>Observed At</th>
                  </tr>
                </thead>
                <tbody>
                  {rateLimits.states.map((rl) => (
                    <tr key={rl.stateKey}>
                      <td><code>{rl.bucketId ?? "default"}</code></td>
                      <td>{rl.destinationId ?? "global"}</td>
                      <td><span className="badge badge-info">{rl.scope ?? "route"}</span></td>
                      <td>
                        <strong style={{ color: (rl.remaining ?? 1) === 0 ? "#ed4245" : "#57f287" }}>
                          {rl.remaining ?? "—"}
                        </strong>
                      </td>
                      <td>{rl.limit ?? "—"}</td>
                      <td>{rl.resetAfterMs ? `${(rl.resetAfterMs / 1000).toFixed(2)}s` : "—"}</td>
                      <td>
                        {rl.blockedUntilMs && rl.blockedUntilMs > nowTs ? (
                          <span className="badge badge-warning">
                            {new Date(rl.blockedUntilMs).toLocaleTimeString()}
                          </span>
                        ) : "Ready"}
                      </td>
                      <td>{rl.rateLimitedCount}</td>
                      <td>{rl.observedAt ? new Date(rl.observedAt).toLocaleTimeString() : "—"}</td>
                    </tr>
                  ))}
                  {rateLimits.states.length === 0 && (
                    <tr>
                      <td colSpan={9} className="notification-empty-state">No dynamic rate-limit headers observed yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* TAB 5: DEAD LETTERS */}
      {activeTab === "dead-letters" && (
        <div className="notification-panel">
          <h2>Dead Letter Queue</h2>
          <div className="notification-table-wrap">
            <table className="notification-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Delivery ID</th>
                  <th>Destination</th>
                  <th>Reason</th>
                  <th>Attempts</th>
                  <th>Created At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((dl) => (
                  <tr key={dl.id}>
                    <td><code>{dl.id.slice(0, 10)}...</code></td>
                    <td><code>{dl.deliveryId.slice(0, 10)}...</code></td>
                    <td><code>{dl.destinationId}</code></td>
                    <td><span className="badge badge-danger">{dl.reason}</span></td>
                    <td>{dl.attempts}</td>
                    <td>{new Date(dl.createdAt).toLocaleString()}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleRetryDeadLetter(dl.id)}>
                          Retry
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleDismissDeadLetter(dl.id)}>
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {deadLetters.length === 0 && (
                  <tr>
                    <td colSpan={7} className="notification-empty-state">Dead letter queue is empty.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: EVENT EXPLORER */}
      {activeTab === "events" && (
        <div className="notification-panel">
          <h2>Admitted Notification Events</h2>
          <div className="notification-table-wrap">
            <table className="notification-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Event Type</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => (
                  <tr key={evt.id}>
                    <td>{new Date(evt.occurredAt).toLocaleTimeString()}</td>
                    <td><code>{evt.source}</code></td>
                    <td><code>{evt.eventType}</code></td>
                    <td><strong>{evt.title}</strong></td>
                    <td><span className={`badge badge-${evt.severity}`}>{evt.severity}</span></td>
                    <td><span className="badge badge-info">{evt.priority}</span></td>
                    <td><span className="badge badge-secondary">{evt.status}</span></td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={7} className="notification-empty-state">No events admitted yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: ADD DESTINATION */}
      {showAddDestModal && (
        <div className="notification-modal-backdrop" onClick={() => setShowAddDestModal(false)}>
          <div className="notification-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Notification Destination</h3>
            <form onSubmit={handleCreateDestination}>
              <div className="form-group">
                <label>Destination ID (e.g. discord-alerts)</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={newDestId}
                  onChange={(e) => setNewDestId(e.target.value)}
                  placeholder="discord-prod-alerts"
                />
              </div>
              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={newDestName}
                  onChange={(e) => setNewDestName(e.target.value)}
                  placeholder="Production Discord Channel"
                />
              </div>
              <div className="form-group">
                <label>Secret Reference (e.g. env:DISCORD_WEBHOOK_URL)</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={newDestSecretRef}
                  onChange={(e) => setNewDestSecretRef(e.target.value)}
                  placeholder="env:DISCORD_WEBHOOK_URL"
                />
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #8b949e)" }}>
                  Must start with <code>env:</code>. Raw webhook secrets are never stored directly in the database.
                </span>
              </div>
              <div className="form-group">
                <label>Channel Class</label>
                <select className="form-select" value={newDestClass} onChange={(e) => setNewDestClass(e.target.value)}>
                  <option value="general">General</option>
                  <option value="critical">Critical</option>
                  <option value="errors">Errors</option>
                  <option value="jobs">Jobs</option>
                  <option value="stock">Stock Pipeline</option>
                  <option value="research">Research</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddDestModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Destination
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TEST / EMIT EVENT */}
      {showTestSendModal && (
        <div className="notification-modal-backdrop" onClick={() => setShowTestSendModal(false)}>
          <div className="notification-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Emit Notification Event</h3>
            <form onSubmit={handleManualSend}>
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label>Severity</label>
                  <select className="form-select" value={testSeverity} onChange={(e) => setTestSeverity(e.target.value)}>
                    <option value="info">Info</option>
                    <option value="success">Success</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                    <option value="critical">Critical</option>
                    <option value="debug">Debug</option>
                  </select>
                </div>
                <div>
                  <label>Priority</label>
                  <select className="form-select" value={testPriority} onChange={(e) => setTestPriority(e.target.value)}>
                    <option value="P0">P0 (Critical)</option>
                    <option value="P1">P1 (High)</option>
                    <option value="P2">P2 (Normal)</option>
                    <option value="P3">P3 (Low)</option>
                    <option value="P4">P4 (Telemetry)</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Target Destination (Optional)</label>
                <select className="form-select" value={testDestination} onChange={(e) => setTestDestination(e.target.value)}>
                  <option value="">All matching subscriptions</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.id})</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowTestSendModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Emit Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELIVERY INSPECTION */}
      {selectedDelivery && (
        <div className="notification-modal-backdrop" onClick={() => setSelectedDelivery(null)}>
          <div className="notification-modal" style={{ maxWidth: "680px" }} onClick={(e) => e.stopPropagation()}>
            <h3>Delivery Details: <code>{selectedDelivery.delivery.id}</code></h3>
            <div style={{ marginBottom: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "0.85rem" }}>
              <div><strong>Status:</strong> <span className={`badge badge-${selectedDelivery.delivery.status.toLowerCase()}`}>{selectedDelivery.delivery.status}</span></div>
              <div><strong>Priority:</strong> {selectedDelivery.delivery.priority}</div>
              <div><strong>Destination:</strong> {selectedDelivery.delivery.destinationId}</div>
              <div><strong>Attempts:</strong> {selectedDelivery.delivery.attempt} / {selectedDelivery.delivery.maxAttempts}</div>
              {selectedDelivery.delivery.lastErrorCode && (
                <div style={{ gridColumn: "span 2" }}>
                  <strong>Last Error:</strong> <code>{selectedDelivery.delivery.lastErrorCode}</code> {selectedDelivery.delivery.lastErrorMessage}
                </div>
              )}
            </div>

            <h4>Attempt History</h4>
            <div className="notification-table-wrap" style={{ maxHeight: "240px", overflowY: "auto" }}>
              <table className="notification-table" style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Bucket</th>
                    <th>Remaining</th>
                    <th>Reset</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDelivery.attempts.map((att) => (
                    <tr key={att.id}>
                      <td>{att.attempt}</td>
                      <td>{new Date(att.startedAt).toLocaleTimeString()}</td>
                      <td>{att.statusCode ?? "ERR"}</td>
                      <td>{att.bucketId ?? "—"}</td>
                      <td>{att.rateLimitRemaining ?? "—"}</td>
                      <td>{att.rateLimitResetAfterMs ? `${(att.rateLimitResetAfterMs / 1000).toFixed(1)}s` : "—"}</td>
                      <td>{att.durationMs}ms</td>
                    </tr>
                  ))}
                  {selectedDelivery.attempts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="notification-empty-state">No recorded attempts.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedDelivery(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationGateway;
