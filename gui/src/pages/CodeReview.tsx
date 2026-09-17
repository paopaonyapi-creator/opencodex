// Phase 20.81 — Code Review Dashboard Page (sessions, findings, gate decisions).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface ReviewSession {
  sessionId: string;
  repositoryPath: string;
  mode: string;
  fromRef: string | null;
  toRef: string | null;
  commitSha: string | null;
  diffHash: string;
  status: string;
  gate: string | null;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  protectedPathChanged: boolean;
  revision: number;
  delegatedFindings: number;
  createdAt: string;
}

interface ReviewFinding {
  findingId: string;
  location: { path: string; startLine: number; endLine: number };
  category: string;
  subcategory?: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  title: string;
  description: string;
  evidence: string;
  status: string;
  source: string;
}

interface StatusData {
  ok: boolean;
  engine: string;
  sessions: number;
  completed: number;
  failed: number;
  gateBreakdown: Record<string, number>;
}

function gateClass(gate: string | null): string {
  if (gate === "PASS") return "ur-pill ok";
  if (gate === "WARN" || gate === "HUMAN_APPROVAL") return "ur-pill warn";
  if (gate === "BLOCK" || gate === "REQUIRE_FIX") return "ur-pill bad";
  return "ur-pill";
}

function severityClass(severity: string): string {
  if (severity === "CRITICAL" || severity === "HIGH") return "ur-pill bad";
  if (severity === "MEDIUM") return "ur-pill warn";
  return "ur-pill ok";
}

export default function CodeReviewPage({ apiBase = "" }: Props) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ReviewSession | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [statusRes, sessionsRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/code-review`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/code-review/sessions?limit=50`).then((r) => r.json()),
      ]);
      setStatus(statusRes);
      setSessions(sessionsRes.sessions ?? []);
    } catch {
      setMessage("Code Review API is unavailable");
    }
  }, [apiBase]);

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/code-review/sessions/${id}`).then((r) => r.json());
      if (res.ok) {
        setSelectedSession(res.session);
        setFindings(res.findings ?? []);
      }
    } catch {
      setMessage("Failed to load session details");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h2>Deterministic AI Code Review</h2>
          <p className="ur-sub">
            Phase 20.81 — Line-anchored inspection, multi-agent review units &amp; policy-governed merge gates.
          </p>
        </div>
        <button type="button" className="ur-btn" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {message && <div className="ur-banner warn">{message}</div>}

      <div className="ur-stats-row">
        <div className="ur-stat">
          <span className="ur-stat-label">Engine</span>
          <span className="ur-stat-val">{status?.engine ?? "loading..."}</span>
        </div>
        <div className="ur-stat">
          <span className="ur-stat-label">Total Sessions</span>
          <span className="ur-stat-val">{status?.sessions ?? 0}</span>
        </div>
        <div className="ur-stat">
          <span className="ur-stat-label">Completed</span>
          <span className="ur-stat-val ok">{status?.completed ?? 0}</span>
        </div>
        <div className="ur-stat">
          <span className="ur-stat-label">Pass</span>
          <span className="ur-stat-val ok">{status?.gateBreakdown?.PASS ?? 0}</span>
        </div>
        <div className="ur-stat">
          <span className="ur-stat-label">Blocked / Fix Required</span>
          <span className="ur-stat-val bad">
            {(status?.gateBreakdown?.BLOCK ?? 0) + (status?.gateBreakdown?.REQUIRE_FIX ?? 0)}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedSession ? "1fr 1fr" : "1fr", gap: "1.5rem" }}>
        <section className="ur-card">
          <h3>Recorded Review Sessions</h3>
          {sessions.length === 0 ? (
            <p className="ur-empty">No review sessions recorded yet. Run `ocx review` to start one.</p>
          ) : (
            <table className="ur-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Mode</th>
                  <th>Rev</th>
                  <th>Gate</th>
                  <th>Protected</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td><code>{s.sessionId}</code></td>
                    <td>{s.mode}</td>
                    <td>r{s.revision}</td>
                    <td><span className={gateClass(s.gate)}>{s.gate ?? "FAIL"}</span></td>
                    <td>{s.protectedPathChanged ? "YES" : "no"}</td>
                    <td>
                      <button
                        type="button"
                        className="ur-btn small"
                        onClick={() => void loadSession(s.sessionId)}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {selectedSession && (
          <section className="ur-card">
            <h3>Findings for {selectedSession.sessionId}</h3>
            <p className="ur-sub">
              Gate: <span className={gateClass(selectedSession.gate)}>{selectedSession.gate}</span> |
              Revision: r{selectedSession.revision} |
              Critical: {selectedSession.criticalCount} | High: {selectedSession.highCount} | Medium: {selectedSession.mediumCount}
            </p>
            {findings.length === 0 ? (
              <p className="ur-empty">No defect findings recorded for this session. Clean bill of health.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
                {findings.map((f) => (
                  <div
                    key={f.findingId}
                    style={{
                      border: "1px solid var(--border-color, #333)",
                      borderRadius: "6px",
                      padding: "0.75rem",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{f.title}</strong>
                      <span className={severityClass(f.severity)}>{f.severity}</span>
                    </div>
                    <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: "0.25rem" }}>
                      <code>{f.location.path}:{f.location.startLine}</code> | Category: {f.category} | Source: {f.source}
                    </div>
                    <p style={{ margin: "0.5rem 0", fontSize: "0.9rem" }}>{f.description}</p>
                    {f.evidence && (
                      <pre style={{ fontSize: "0.8rem", padding: "0.4rem", background: "rgba(0,0,0,0.3)", borderRadius: "4px", overflowX: "auto" }}>
                        {f.evidence}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
