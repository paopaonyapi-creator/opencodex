// Phase 20.82 — Sensorimotor Runtime Dashboard Page
// (CortexKit AFT: sessions, perception, transactional actions, health).
//
// Every panel renders live runtime state from
// /api/agent-os/sensorimotor/* — no placeholder or demo data.

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface SensorimotorHealth {
  ok: boolean;
  policyVersion: string;
  activeSessions: number;
  recentActions24h: number;
  recentFailures24h: number;
}

interface SensorimotorSession {
  id: string;
  workspaceRoot: string;
  actorId: string;
  status: "active" | "closed" | "aborted";
  goal: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SensorimotorAction {
  actionId: string;
  kind: string;
  target: string;
  status: string;
  attempt: number;
}

type ActionKind = "fs.write" | "fs.delete" | "fs.move";

function statusPill(status: string): string {
  if (status === "succeeded" || status === "active") return "ur-pill ok";
  if (status === "failed" || status === "rolled_back" || status === "timed_out" || status === "aborted") return "ur-pill bad";
  if (status === "pending" || status === "planning" || status === "checkpointed" || status === "running" || status === "retryable") return "ur-pill warn";
  return "ur-pill";
}

export function Sensorimotor({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<SensorimotorHealth | null>(null);
  const [sessions, setSessions] = useState<SensorimotorSession[]>([]);
  const [actions, setActions] = useState<SensorimotorAction[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // execute-action form state
  const [kind, setKind] = useState<ActionKind>("fs.write");
  const [target, setTarget] = useState("");
  const [content, setContent] = useState("");
  const [destination, setDestination] = useState("");

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const [healthRes, sessionsRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/sensorimotor/health`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/api/agent-os/sensorimotor/sessions`).then((r) => (r.ok ? r.json() : { sessions: [] })),
      ]);
      setHealth(healthRes);
      setSessions(sessionsRes.sessions ?? []);
    } catch {
      setMessage("Sensorimotor API is unavailable");
    }
  }, [apiBase]);

  const loadActions = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setActions([]);
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/agent-os/sensorimotor/actions?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const body = (await res.json()) as { actions?: SensorimotorAction[] };
        setActions(body.actions ?? []);
      }
    } catch {
      setMessage("Failed to load session actions");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!selectedSession) return;
    const t = setTimeout(() => void loadActions(selectedSession), 0);
    return () => clearTimeout(t);
  }, [selectedSession, loadActions]);

  const createSession = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/sensorimotor/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceRoot: window.prompt("Workspace root directory:", "") ?? "",
          actorId: "dashboard_operator",
          goal: "dashboard session",
        }),
      });
      const body = (await res.json()) as { ok?: boolean; session?: SensorimotorSession; error?: { message?: string } };
      if (body.ok && body.session) {
        await load();
        setSelectedSession(body.session.id);
        setMessage(`Session ${body.session.id} created`);
      } else {
        setMessage(body.error?.message ?? "Failed to create session");
      }
    } catch {
      setMessage("Failed to create session");
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (sessionId: string, status: "closed" | "aborted") => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/sensorimotor/sessions/${encodeURIComponent(sessionId)}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
      if (selectedSession === sessionId) setSelectedSession("");
      setMessage(`Session ${sessionId} ${status}`);
    } catch {
      setMessage("Failed to close session");
    } finally {
      setBusy(false);
    }
  };

  const executeAction = async () => {
    if (!selectedSession || !target.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/sensorimotor/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSession,
          kind,
          target: target.trim(),
          ...(kind === "fs.write" ? { content } : {}),
          ...(kind === "fs.move" && destination.trim() ? { destination: destination.trim() } : {}),
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        outcome?: { status: string; error?: { code: string; message: string } | null; observation?: { healthDelta?: { filesChanged: number; rolledBackFlag?: boolean } } | null };
        error?: { message?: string };
      };
      if (body.outcome) {
        const o = body.outcome;
        setMessage(
          o.status === "succeeded"
            ? `Action succeeded (${o.observation?.healthDelta?.filesChanged ?? 0} file change(s))`
            : `Action ${o.status}${o.error ? `: ${o.error.code} — ${o.error.message}` : ""}`,
        );
        await loadActions(selectedSession);
      } else {
        setMessage(body.error?.message ?? "Action dispatch failed");
      }
    } catch {
      setMessage("Action dispatch failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h2>Sensorimotor Runtime</h2>
          <p className="ur-sub">
            Phase 20.82 — CortexKit AFT: perception → plan → act → observe with checkpoint &amp; rollback.
          </p>
        </div>
        <button type="button" className="ur-btn" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {message && <div className="ur-banner warn">{message}</div>}

      <div className="ur-stats-row">
        <div className="ur-stat">
          <span className={`ur-pill ${health?.ok ? "ok" : "bad"}`}>{health?.ok ? "HEALTHY" : "OFFLINE"}</span>
          <span>Runtime</span>
        </div>
        <div className="ur-stat">
          <span className="ur-pill">{health?.policyVersion ?? "—"}</span>
          <span>Policy Version</span>
        </div>
        <div className="ur-stat">
          <strong>{health?.activeSessions ?? 0}</strong>
          <span>Active Sessions</span>
        </div>
        <div className="ur-stat">
          <strong>{health?.recentActions24h ?? 0}</strong>
          <span>Actions (24h)</span>
        </div>
        <div className="ur-stat">
          <strong>{health?.recentFailures24h ?? 0}</strong>
          <span>Failures (24h)</span>
        </div>
      </div>

      <section className="ur-section">
        <div className="ur-section-head">
          <h3>Sessions</h3>
          <button type="button" className="ur-btn" onClick={() => void createSession()} disabled={busy}>
            New Session
          </button>
        </div>
        {sessions.length === 0 ? (
          <div className="ur-empty">No sensorimotor sessions recorded yet.</div>
        ) : (
          <table className="ur-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Workspace</th>
                <th>Actor</th>
                <th>Status</th>
                <th>Goal</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={selectedSession === s.id ? "ur-row-active" : undefined}>
                  <td className="mono">{s.id}</td>
                  <td className="mono" title={s.workspaceRoot}>{s.workspaceRoot.length > 40 ? "…" + s.workspaceRoot.slice(-39) : s.workspaceRoot}</td>
                  <td>{s.actorId}</td>
                  <td><span className={statusPill(s.status)}>{s.status}</span></td>
                  <td>{s.goal ?? "—"}</td>
                  <td>
                    <button type="button" className="ur-btn" onClick={() => setSelectedSession(s.id)}>
                      Inspect
                    </button>{" "}
                    {s.status === "active" && (
                      <>
                        <button type="button" className="ur-btn" onClick={() => void closeSession(s.id, "closed")} disabled={busy}>
                          Close
                        </button>{" "}
                        <button type="button" className="ur-btn" onClick={() => void closeSession(s.id, "aborted")} disabled={busy}>
                          Abort
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedSession && (
        <>
          <section className="ur-section">
            <div className="ur-section-head">
              <h3>Execute Transactional Action</h3>
              <span className="mono ur-sub">session {selectedSession}</span>
            </div>
            <div className="ur-form-row">
              <label>
                Kind{" "}
                <select value={kind} onChange={(e) => setKind(e.target.value as ActionKind)}>
                  <option value="fs.write">fs.write</option>
                  <option value="fs.delete">fs.delete</option>
                  <option value="fs.move">fs.move</option>
                </select>
              </label>
              <label>
                Target (relative path){" "}
                <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="src/example.ts" />
              </label>
              {kind === "fs.write" && (
                <label>
                  Content{" "}
                  <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="file content" />
                </label>
              )}
              {kind === "fs.move" && (
                <label>
                  Destination{" "}
                  <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="new/path.ts" />
                </label>
              )}
              <button type="button" className="ur-btn" onClick={() => void executeAction()} disabled={busy || !target.trim()}>
                Execute
              </button>
            </div>
            <p className="ur-sub">
              Every action is checkpointed before execution; failures roll back automatically. Paths are sandbox-checked against the session workspace.
            </p>
          </section>

          <section className="ur-section">
            <div className="ur-section-head">
              <h3>Session Actions</h3>
              <button type="button" className="ur-btn" onClick={() => void loadActions(selectedSession)}>
                Refresh
              </button>
            </div>
            {actions.length === 0 ? (
              <div className="ur-empty">No actions recorded for this session.</div>
            ) : (
              <table className="ur-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Kind</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.actionId}>
                      <td className="mono">{a.actionId}</td>
                      <td><code>{a.kind}</code></td>
                      <td className="mono">{a.target}</td>
                      <td><span className={statusPill(a.status)}>{a.status}</span></td>
                      <td>{a.attempt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
