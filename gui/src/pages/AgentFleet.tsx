// Phase 20.40 — Agent Fleet dashboard (spec §26, §40): fleet table with
// precise status wording, summary cards, live timeline (pause/follow/
// filters), session inspector with evidence/confidence, and a lightweight
// parent/child tree. Read-only UI — no control actions exist by design.

import { useState, useEffect, useCallback, useRef } from "react";
import "../styles/universal-registry.css";

interface AgentFleetProps {
  apiBase?: string;
}

interface FleetSession {
  id: string;
  sourceSessionId: string | null;
  runtime: string;
  sourceType: string;
  projectName: string | null;
  tier: string;
  alias: string | null;
  activityState: string;
  processState: string;
  executionState: string;
  healthState: string;
  integrityState: string;
  confidence: number;
  confidenceFactors: Array<{ rule: string; weight: number }>;
  lastRecordedEventAt: string | null;
  lastFileModifiedAt: string | null;
  explicitEndedAt: string | null;
  observedAt: string;
  latestEventType: string | null;
  latestToolName: string | null;
  processIds: number[];
  errors: Array<{ code: string; message: string }>;
  evidence: Array<{ type: string; source: string; value: unknown }>;
}

interface FleetSnapshotData {
  observedAt: string;
  scan: { durationMs: number; adapterErrors: number; cacheHits: number; cacheMisses: number; sourcesSeen: number; sourcesChanged: number };
  summary: { sessions: number; active: number; recent: number; idle: number; stale: number; stalled: number; failed: number; adapterErrors: number; unknown: number };
  sessions: FleetSession[];
}

interface FleetEvent {
  id: string;
  sessionId: string;
  runtime: string;
  kind: string;
  role: string;
  recordedAt: string | null;
  toolName: string | null;
  summary: string | null;
  contentPreview: string | null;
  malformed: boolean;
}

interface AlertRow {
  id: string;
  severity: string;
  title: string;
  firstSeenAt: string;
  resolvedAt: string | null;
}

type ViewKey = "fleet" | "timeline" | "inspector" | "alerts";

const ACTIVITY_COLORS: Record<string, string> = {
  active: "#35c07d", recent: "#7aa2f7", idle: "#e2b93b", stale: "#8a93a6", unknown: "#8a93a6",
};
const HEALTH_COLORS: Record<string, string> = {
  healthy: "#35c07d", degraded: "#e2b93b", stalled: "#e2b93b", error: "#e06c75", unknown: "#8a93a6",
};

async function api<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "request failed");
  return body.data as T;
}

function preciseLabel(state: string): string {
  switch (state) {
    case "active": return "Event observed < 2m ago";
    case "recent": return "Recent event activity";
    case "idle": return "Idle (no event < 2h)";
    case "stale": return "Stale activity";
    case "not_observed": return "Process not observed";
    case "running": return "Process evidence: running";
    case "tool_running": return "Tool activity observed";
    case "waiting_user": return "Waiting for user";
    case "completed": return "Explicitly completed";
    case "failed": return "Explicit failure observed";
    case "stalled": return "Stalled (running, no progress)";
    default: return "Unknown";
  }
}

export function AgentFleet({ apiBase = "" }: AgentFleetProps) {
  const [view, setView] = useState<ViewKey>("fleet");
  const [snapshot, setSnapshot] = useState<FleetSnapshotData | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspector, setInspector] = useState<{ session: FleetSession; events: FleetEvent[]; integrity: { digest: string | null; status: string; checkedAt: string } | null } | null>(null);
  const [paused, setPaused] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadInspectorRef = useRef<(sessionId: string) => Promise<void>>(async () => {});

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await api<FleetSnapshotData>(apiBase, "/api/agent-os/observability/snapshot");
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  const loadTimeline = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (kindFilter) params.set("kinds", kindFilter);
      if (search) params.set("q", search);
      const data = await api<{ events: FleetEvent[] }>(apiBase, "/api/agent-os/observability/timeline?" + params.toString());
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase, kindFilter, search]);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await api<{ alerts: AlertRow[] }>(apiBase, "/api/agent-os/observability/alerts?unresolved=true");
      setAlerts(data.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  const loadInspector = useCallback(async (sessionId: string) => {
    try {
      const data = await api<{ session: FleetSession; events: FleetEvent[]; integrity: { digest: string | null; status: string; checkedAt: string } | null }>(apiBase, "/api/agent-os/observability/sessions/detail?id=" + encodeURIComponent(sessionId));
      setInspector(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  useEffect(() => {
    loadInspectorRef.current = loadInspector;
  }, [loadInspector]);

  useEffect(() => {
    const initial = setTimeout(() => void loadSnapshot(), 0);
    const timer = setInterval(() => {
      if (!paused) void loadSnapshot();
    }, 4000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadSnapshot, paused]);

  useEffect(() => {
    const initial = setTimeout(() => void loadTimeline(), 0);
    const timer = setInterval(() => {
      if (!paused && followLatest) void loadTimeline();
    }, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadTimeline, paused, followLatest]);

  useEffect(() => {
    const initial = setTimeout(() => void loadAlerts(), 0);
    const timer = setInterval(() => void loadAlerts(), 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadAlerts]);

  useEffect(() => {
    if (!selected) return;
    void loadInspectorRef.current(selected);
  }, [selected]);

  const runIntegrity = async (sessionId: string) => {
    try {
      await api(apiBase, "/api/agent-os/observability/integrity-check", { method: "POST", body: JSON.stringify({ sessionId, force: true }) });
      await loadInspectorRef.current(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const summary = snapshot?.summary;
  const childByParent = new Map<string, FleetSession[]>();
  for (const session of snapshot?.sessions ?? []) {
    if (!session.tier || session.tier === "session") continue;
    // Tree display groups by runtime/project when no explicit parent exists.
    const key = session.sourceSessionId ?? session.runtime;
    const siblings = childByParent.get(key) ?? [];
    siblings.push(session);
    childByParent.set(key, siblings);
  }
  const roots = (snapshot?.sessions ?? []).filter((session) => session.tier === "session");

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Agent Fleet</h1>
          <p className="ur-subtitle">Read-only observability: evidence-backed activity, process, execution, health and integrity states</p>
        </div>
        <div className="ur-actions">
          {(["fleet", "timeline", "inspector", "alerts"] as ViewKey[]).map((key) => (
            <button key={key} className="ur-button" style={{ opacity: view === key ? 1 : 0.6 }} onClick={() => setView(key)}>{key}</button>
          ))}
        </div>
      </header>

      {error && <div className="ur-error" role="alert">{error}</div>}

      <section style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {summary && (
          [
            ["Observed", summary.sessions, "#7aa2f7"],
            ["Active", summary.active, "#35c07d"],
            ["Recent", summary.recent, "#7aa2f7"],
            ["Idle", summary.idle, "#e2b93b"],
            ["Stale", summary.stale, "#8a93a6"],
            ["Stalled", summary.stalled, "#e2b93b"],
            ["Failed", summary.failed, "#e06c75"],
            ["Adapter errors", summary.adapterErrors, "#e06c75"],
            ["Unknown", summary.unknown, "#8a93a6"],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="ur-card" style={{ padding: "8px 14px", minWidth: 96 }}>
              <div style={{ fontSize: 20, color: String(color) }}>{String(value)}</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>{String(label)}</div>
            </div>
          ))
        )}
      </section>

      {view === "fleet" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Fleet ({roots.length} sessions, {snapshot?.scan.sourcesSeen ?? 0} sources seen, scan {snapshot?.scan.durationMs ?? 0}ms)</h2>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7 }}>
                <th>Agent</th><th>Runtime</th><th>Project</th><th>Activity</th><th>Process</th><th>Execution</th><th>Health</th><th>Latest</th><th>Last event</th><th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.sessions ?? []).map((session) => (
                <tr key={session.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }} onClick={() => { setSelected(session.id); setView("inspector"); }}>
                  <td>{session.alias ?? session.sourceSessionId?.slice(0, 12) ?? session.id.slice(0, 12)}{session.tier !== "session" ? " · " + session.tier : ""}</td>
                  <td>{session.runtime}</td>
                  <td>{session.projectName ?? "—"}</td>
                  <td style={{ color: ACTIVITY_COLORS[session.activityState] }} title={preciseLabel(session.activityState) + " · evidence: " + JSON.stringify(session.evidence.map((item) => item.type))}>{session.activityState}</td>
                  <td title={preciseLabel(session.processState)}>{session.processState}{session.processIds.length > 0 ? " (" + session.processIds.join(",") + ")" : ""}</td>
                  <td title={preciseLabel(session.executionState)}>{session.executionState}</td>
                  <td style={{ color: HEALTH_COLORS[session.healthState] }} title={preciseLabel(session.healthState)}>{session.healthState}</td>
                  <td>{session.latestToolName ? session.latestToolName : session.latestEventType ?? "—"}</td>
                  <td title={"Recorded: " + (session.lastRecordedEventAt ?? "—") + "\nFile updated: " + (session.lastFileModifiedAt ?? "—") + "\nObserved: " + session.observedAt}>
                    {session.lastRecordedEventAt ? session.lastRecordedEventAt.replace("T", " ").slice(5, 16) : "—"}
                  </td>
                  <td>{Math.round(session.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(snapshot?.sessions.length ?? 0) === 0 && (
            <p style={{ opacity: 0.6 }}>
              No sessions observed yet. Adapters scan Claude JSONL roots, the 20.21 Codex runtime tables, the 20.39 cockpit bus, and any configured generic JSONL sources. Insufficient evidence is shown as Unknown — never guessed.
            </p>
          )}
        </section>
      )}

      {view === "timeline" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Fleet timeline</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="ur-button" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button>
            <button className="ur-button" style={{ opacity: followLatest ? 1 : 0.6 }} onClick={() => setFollowLatest(!followLatest)}>{followLatest ? "Following latest" : "Paused feed"}</button>
            <input className="ur-input" placeholder="filter kinds (comma separated)" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} style={{ maxWidth: 220 }} />
            <input className="ur-input" placeholder="search" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 180 }} />
            <button className="ur-button" onClick={() => void loadTimeline()}>Apply</button>
          </div>
          <ul className="ur-list">
            {events.map((event) => (
              <li key={event.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <span style={{ color: event.kind === "error" || event.malformed ? "#e06c75" : event.kind === "tool_call" ? "#e2b93b" : "#7aa2f7" }}>{event.kind}</span>
                {" · "}{event.runtime}{" · "}{(event.recordedAt ?? "").replace("T", " ").slice(5, 16)}
                {event.toolName ? " · " + event.toolName : ""}
                <div style={{ opacity: 0.75 }}>{event.summary ?? event.contentPreview ?? ""}</div>
              </li>
            ))}
            {events.length === 0 && <li className="ur-list-item">No events match the filters.</li>}
          </ul>
        </section>
      )}

      {view === "inspector" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Session inspector</h2>
          {!selected && <p style={{ opacity: 0.6 }}>Pick a session from the fleet table.</p>}
          {inspector && (
            <div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="ur-badge">alias: {inspector.session.alias ?? "—"}</span>
                <span className="ur-badge">runtime: {inspector.session.runtime}</span>
                <span className="ur-badge" style={{ borderColor: ACTIVITY_COLORS[inspector.session.activityState] }}>activity: {inspector.session.activityState}</span>
                <span className="ur-badge">process: {inspector.session.processState}</span>
                <span className="ur-badge">execution: {inspector.session.executionState}</span>
                <span className="ur-badge" style={{ borderColor: HEALTH_COLORS[inspector.session.healthState] }}>health: {inspector.session.healthState}</span>
                <span className="ur-badge">integrity: {inspector.session.integrityState}</span>
                <span className="ur-badge">confidence: {Math.round(inspector.session.confidence * 100)}%</span>
                <button className="ur-button" onClick={() => void runIntegrity(inspector.session.id)}>Verify integrity (SHA-256)</button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
                Confidence factors: {inspector.session.confidenceFactors.length > 0
                  ? inspector.session.confidenceFactors.map((factor) => factor.rule + " (" + (factor.weight >= 0 ? "+" : "") + factor.weight + ")").join(", ")
                  : "none"}
                <div>Recorded event: {inspector.session.lastRecordedEventAt ?? "—"} · File updated: {inspector.session.lastFileModifiedAt ?? "—"} · Observed: {inspector.session.observedAt} · Explicit end: {inspector.session.explicitEndedAt ?? "none"}</div>
                <div>Integrity: {inspector.integrity ? inspector.integrity.status + " @ " + inspector.integrity.checkedAt + " · " + (inspector.integrity.digest ?? "no digest") : "unchecked"}</div>
                {inspector.session.errors.length > 0 && <div style={{ color: "#e06c75" }}>Errors: {inspector.session.errors.map((item) => item.code).join(", ")}</div>}
              </div>
              <h3 className="ur-section-title">Recent events</h3>
              <ul className="ur-list">
                {inspector.events.map((event) => (
                  <li key={event.id} className="ur-list-item" style={{ fontSize: 12 }}>
                    <span style={{ color: event.kind === "error" ? "#e06c75" : "#7aa2f7" }}>{event.kind}</span>
                    {" · "}{(event.recordedAt ?? "").replace("T", " ").slice(5, 16)}{event.toolName ? " · " + event.toolName : ""}
                    <div style={{ opacity: 0.75 }}>{event.summary ?? event.contentPreview ?? ""}</div>
                  </li>
                ))}
                {inspector.events.length === 0 && <li className="ur-list-item">No persisted events for this session.</li>}
              </ul>
            </div>
          )}
        </section>
      )}

      {view === "alerts" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Open alerts</h2>
          <ul className="ur-list">
            {alerts.map((alert) => (
              <li key={alert.id} className="ur-list-item" style={{ fontSize: 12, borderColor: alert.severity === "error" || alert.severity === "critical" ? "#e06c75" : "#e2b93b" }}>
                <strong>{alert.severity}</strong> · {alert.title}
                <div style={{ opacity: 0.7 }}>first seen {alert.firstSeenAt.replace("T", " ").slice(5, 16)}</div>
              </li>
            ))}
            {alerts.length === 0 && <li className="ur-list-item">No unresolved alerts.</li>}
          </ul>
        </section>
      )}

      {view === "fleet" && childByParent.size > 0 && (
        <section className="ur-card" style={{ marginTop: 14 }}>
          <h2 className="ur-section-title">Relationships (subagents / workers)</h2>
          {[...childByParent.entries()].map(([key, children]) => (
            <div key={key} style={{ fontSize: 12, marginBottom: 6 }}>
              <strong>{key.slice(0, 16)}</strong>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {children.map((child) => (
                  <li key={child.id}>{child.tier} · {child.runtime} · {child.activityState} · {child.executionState}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
