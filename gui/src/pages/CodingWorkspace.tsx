// Phase 20.39 — Unified AI Coding Workspace cockpit (spec §28): workspace
// sidebar, session list, conversation with SSE streaming, tool/approval
// cards, inspector (tools / approvals / usage / audit), composer with @
// context and / command hints. Provider-neutral — no provider logic here.

import { useState, useEffect, useCallback, useRef } from "react";
import "../styles/universal-registry.css";

interface CodingWorkspaceProps {
  apiBase?: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  rootPath: string;
  trustLevel: string;
  gitBranch: string | null;
}

interface SessionRow {
  id: string;
  workspaceId: string;
  providerId: string;
  nativeSessionId: string | null;
  title: string;
  status: string;
  mode: string;
  writerState: string;
}

interface ProviderRow {
  id: string;
  displayName: string;
  capabilities: Record<string, boolean>;
  instances: Array<{ status: string; version: string | null }>;
}

interface EventRow {
  id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown> & { type: string };
  timestamp: string;
  sessionId?: string;
}

interface ToolRow {
  id: string;
  toolName: string;
  actionType: string;
  status: string;
  riskScore: number | null;
  exitCode: number | null;
  outputSummary: string | null;
  startedAt: string;
}

interface ApprovalRow {
  id: string;
  summary: string;
  actionType: string;
  riskScore: number;
  status: string;
  sessionId: string;
}

interface UsageRow {
  id: string;
  sessionId: string;
  providerId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  source: string;
}

interface AuditRow {
  id: string;
  eventType: string;
  severity: string;
  summary: string;
  createdAt: string;
}

type InspectorTab = "tools" | "approvals" | "usage" | "audit";

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "#7aa2f7", IDLE: "#35c07d", WAITING_APPROVAL: "#e2b93b", STARTING: "#7aa2f7",
  FAILED: "#e06c75", DISCONNECTED: "#e06c75", STALE: "#e2b93b", COMPLETED: "#35c07d",
  PAUSED: "#e2b93b", DISCOVERED: "#8a93a6",
};

async function api<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "request failed");
  return body.data as T;
}

export function CodingWorkspace({ apiBase = "" }: CodingWorkspaceProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [composer, setComposer] = useState("");
  const [contextHint, setContextHint] = useState<"none" | "at" | "slash">("none");
  const [newRoot, setNewRoot] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("tools");
  const [toolRows, setToolRows] = useState<ToolRow[]>([]);
  const [approvalRows, setApprovalRows] = useState<ApprovalRow[]>([]);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "connected" | "reconnecting">("idle");
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const ws = await api<{ workspaces: WorkspaceRow[] }>(apiBase, "/api/agent-os/coding-workspace/workspaces");
      setWorkspaces(ws.workspaces);
      const pv = await api<{ providers: ProviderRow[] }>(apiBase, "/api/agent-os/coding-workspace/providers");
      setProviders(pv.providers);
      const ss = await api<{ sessions: SessionRow[] }>(apiBase, "/api/agent-os/coding-workspace/sessions");
      setSessions(ss.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  // SSE: reconnect with Last-Event-ID semantics (spec §35). Stream state is
  // updated only from EventSource callbacks; visible rows are derived by
  // matching the stream's session so switching sessions needs no sync reset.
  useEffect(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (!selectedSession) return;
    const source = new EventSource(apiBase + "/api/agent-os/coding-workspace/sessions/stream?id=" + encodeURIComponent(selectedSession));
    eventSourceRef.current = source;
    source.addEventListener("agent", (event) => {
      const envelope = JSON.parse((event as MessageEvent).data) as EventRow;
      const stamped: EventRow = {
        ...envelope,
        id: envelope.id ?? "sse_" + envelope.sequence,
        sessionId: selectedSession,
        timestamp: envelope.timestamp ?? new Date().toISOString(),
      };
      setStreamState("connected");
      setEvents((prev) => {
        if (prev.some((candidate) => candidate.sessionId === stamped.sessionId && candidate.sequence === stamped.sequence)) return prev;
        return [...prev, stamped];
      });
      if (stamped.sequence > lastSequenceRef.current) lastSequenceRef.current = stamped.sequence;
    });
    source.onerror = () => setStreamState("reconnecting");
    source.onopen = () => setStreamState("connected");
    return () => source.close();
  }, [apiBase, selectedSession]);

  const loadInspector = useCallback(async (tab: InspectorTab, sessionId: string | null) => {
    try {
      if (tab === "tools") {
        const data = await api<{ toolExecutions: ToolRow[] }>(apiBase, "/api/agent-os/coding-workspace/tools" + (sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : ""));
        setToolRows(data.toolExecutions);
      } else if (tab === "approvals") {
        const data = await api<{ approvals: ApprovalRow[] }>(apiBase, "/api/agent-os/coding-workspace/approvals");
        setApprovalRows(data.approvals);
      } else if (tab === "usage") {
        const sessionIdParam = sessionId ? "?id=" + encodeURIComponent(sessionId) : "";
        const data = await api<{ usage: UsageRow[] }>(apiBase, "/api/agent-os/coding-workspace/sessions/usage" + sessionIdParam);
        setUsageRows(data.usage);
      } else if (tab === "audit") {
        const data = await api<{ events: AuditRow[] }>(apiBase, "/api/agent-os/coding-workspace/audit");
        setAuditRows(data.events);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  // Inspector rows refresh on the same cadence as the session list; tab and
  // session changes trigger an immediate load from the interaction handlers.
  const inspectorRef = useRef<{ tab: InspectorTab; session: string | null }>({ tab: "tools", session: null });
  useEffect(() => {
    const timer = setInterval(() => {
      void loadInspector(inspectorRef.current.tab, inspectorRef.current.session);
    }, 10_000);
    return () => clearInterval(timer);
  }, [loadInspector]);

  const registerWorkspace = async () => {
    if (!newRoot.trim()) return;
    try {
      await api(apiBase, "/api/agent-os/coding-workspace/workspaces", { method: "POST", body: JSON.stringify({ rootPath: newRoot.trim(), actor: "operator" }) });
      setNewRoot("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startSession = async (providerId: string) => {
    if (!selectedWorkspace) return;
    try {
      const data = await api<{ session: SessionRow }>(apiBase, "/api/agent-os/coding-workspace/sessions/start", {
        method: "POST",
        body: JSON.stringify({ workspaceId: selectedWorkspace, providerId, actor: "operator", mode: "CHAT" }),
      });
      await refresh();
      setSelectedSession(data.session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async () => {
    if (!selectedSession || !composer.trim()) return;
    const text = composer;
    setComposer("");
    setContextHint("none");
    try {
      await api(apiBase, "/api/agent-os/coding-workspace/sessions/messages", {
        method: "POST",
        body: JSON.stringify({ sessionId: selectedSession, text, actor: "operator" }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const resume = async (sessionId: string) => {
    try {
      await api(apiBase, "/api/agent-os/coding-workspace/sessions/resume", { method: "POST", body: JSON.stringify({ sessionId, actor: "operator" }) });
      await refresh();
      setSelectedSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const decideApproval = async (approvalId: string, approve: boolean) => {
    try {
      await api(apiBase, "/api/agent-os/coding-workspace/approvals/decide", {
        method: "POST",
        body: JSON.stringify({ approvalId, approve, actor: "operator" }),
      });
      await loadInspector("approvals", selectedSession);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const selected = sessions.find((session) => session.id === selectedSession) ?? null;
  const pendingApprovals = approvalRows.filter((row) => row.status === "PENDING");
  useEffect(() => {
    inspectorRef.current = { tab: inspectorTab, session: selectedSession };
  }, [inspectorTab, selectedSession]);
  const visibleEvents = events.filter((event) =>
    event.sessionId === selectedSession && (event.payload.type !== "MessageDelta" || events.length < 400));

  const changeInspectorTab = (tab: InspectorTab) => {
    setInspectorTab(tab);
    void loadInspector(tab, selectedSession);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const onComposerChange = (value: string) => {
    setComposer(value);
    if (value.startsWith("@")) setContextHint("at");
    else if (value.startsWith("/")) setContextHint("slash");
    else setContextHint("none");
  };

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Unified AI Coding Workspace</h1>
          <p className="ur-subtitle">
            Local-first cockpit for native Codex / Claude Code sessions — provider-neutral, policy-gated, one writer per workspace
          </p>
        </div>
        <div className="ur-actions">
          <span className="ur-badge" style={{ borderColor: streamState === "connected" ? "#35c07d" : "#e2b93b" }}>
            {streamState === "connected" ? "stream connected" : streamState === "reconnecting" ? "reconnecting…" : "idle"}
          </span>
        </div>
      </header>

      {error && <div className="ur-error" role="alert">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 320px", gap: 16, alignItems: "start" }}>
        {/* Left: workspaces + sessions */}
        <section className="ur-card">
          <h2 className="ur-section-title">Workspaces</h2>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input className="ur-input" placeholder="/absolute/path/to/project" value={newRoot} onChange={(event) => setNewRoot(event.target.value)} />
            <button className="ur-button" onClick={() => void registerWorkspace()}>Add</button>
          </div>
          <ul className="ur-list">
            {workspaces.map((workspace) => (
              <li
                key={workspace.id}
                className="ur-list-item"
                style={{ cursor: "pointer", borderColor: selectedWorkspace === workspace.id ? "#7aa2f7" : undefined }}
                onClick={() => setSelectedWorkspace(workspace.id)}
              >
                <strong>{workspace.name}</strong>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {workspace.trustLevel} {workspace.gitBranch ? "· " + workspace.gitBranch : "· no git"}
                </div>
              </li>
            ))}
          </ul>
          <h2 className="ur-section-title" style={{ marginTop: 14 }}>Providers</h2>
          <ul className="ur-list">
            {providers.map((provider) => (
              <li key={provider.id} className="ur-list-item">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{provider.displayName}</span>
                  <button className="ur-button" disabled={!selectedWorkspace} onClick={() => void startSession(provider.id)}>Start</button>
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {provider.instances[0]?.status ?? "unprobed"} {provider.instances[0]?.version ? "· " + provider.instances[0].version : ""}
                </div>
              </li>
            ))}
          </ul>
          <h2 className="ur-section-title" style={{ marginTop: 14 }}>Sessions</h2>
          <ul className="ur-list">
            {sessions.map((session) => (
              <li key={session.id} className="ur-list-item" style={{ cursor: "pointer", borderColor: selectedSession === session.id ? "#7aa2f7" : undefined }} onClick={() => setSelectedSession(session.id)}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 12 }}>{session.title}</strong>
                  <span style={{ color: STATUS_COLORS[session.status] ?? "#8a93a6", fontSize: 11 }}>{session.status}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {session.providerId} · {session.mode} {session.nativeSessionId ? "· native ✓" : ""}
                  {session.status === "DISCOVERED" || session.status === "STALE" ? (
                    <button className="ur-button" onClick={(event) => { event.stopPropagation(); void resume(session.id); }}>Resume</button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Center: conversation + composer */}
        <section className="ur-card" style={{ minHeight: 520, display: "flex", flexDirection: "column" }}>
          <h2 className="ur-section-title">
            Conversation {selected ? "— " + selected.title : ""}
          </h2>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 420, display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleEvents.length === 0 && <p style={{ opacity: 0.6 }}>Select or start a session. Messages stream as normalized provider events.</p>}
            {visibleEvents.map((event) => (
              <EventCard key={event.id + ":" + event.sequence} event={event} />
            ))}
          </div>
          {contextHint !== "none" && (
            <div style={{ fontSize: 12, opacity: 0.8, margin: "6px 0" }}>
              {contextHint === "at"
                ? "@ refs resolve server-side: @file, @folder, @session, @agent, @skill, @mcp, @run — type a label after @"
                : "/ commands: /status /sessions /usage /cancel /checkpoint /rollback"}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              className="ur-input"
              placeholder={selected ? "Message… (@ for context, / for commands)" : "Select a session first"}
              value={composer}
              disabled={!selected}
              onChange={(event) => onComposerChange(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="ur-button" disabled={!selected || !composer.trim()} onClick={() => void send()}>Send</button>
          </div>
        </section>

        {/* Right: inspector */}
        <section className="ur-card">
          <h2 className="ur-section-title">Inspector</h2>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["tools", "approvals", "usage", "audit"] as InspectorTab[]).map((tab) => (
              <button
                key={tab}
                className="ur-button"
                style={{ opacity: inspectorTab === tab ? 1 : 0.6 }}
                onClick={() => changeInspectorTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {inspectorTab === "tools" && (
            <ul className="ur-list">
              {toolRows.map((tool) => (
                <li key={tool.id} className="ur-list-item" style={{ cursor: "pointer" }} onClick={() => setExpandedTools((prev) => {
                  const next = new Set(prev);
                  if (next.has(tool.id)) next.delete(tool.id);
                  else next.add(tool.id);
                  return next;
                })}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{tool.status === "COMPLETED" ? "✓" : tool.status === "FAILED" ? "✗" : "…"} {tool.toolName}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{tool.actionType}{tool.exitCode !== null ? " · exit " + tool.exitCode : ""}</span>
                  </div>
                  {expandedTools.has(tool.id) && (
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {tool.outputSummary ?? "(no output)"}{tool.riskScore !== null ? "\nrisk: " + tool.riskScore : ""}
                    </div>
                  )}
                </li>
              ))}
              {toolRows.length === 0 && <li className="ur-list-item">No tool activity yet.</li>}
            </ul>
          )}

          {inspectorTab === "approvals" && (
            <ul className="ur-list">
              {approvalRows.map((approval) => (
                <li key={approval.id} className="ur-list-item">
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong style={{ fontSize: 12 }}>{approval.summary}</strong>
                    <span style={{ color: approval.riskScore >= 50 ? "#e06c75" : "#e2b93b", fontSize: 11 }}>risk {approval.riskScore}</span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{approval.actionType} · {approval.status}</div>
                  {approval.status === "PENDING" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button className="ur-button" onClick={() => void decideApproval(approval.id, true)}>Approve</button>
                      <button className="ur-button" onClick={() => void decideApproval(approval.id, false)}>Deny</button>
                    </div>
                  )}
                </li>
              ))}
              {approvalRows.length === 0 && <li className="ur-list-item">No approval requests.</li>}
            </ul>
          )}

          {inspectorTab === "usage" && (
            <ul className="ur-list">
              {usageRows.map((usage) => (
                <li key={usage.id} className="ur-list-item" style={{ fontSize: 12 }}>
                  {usage.providerId}: in {usage.inputTokens ?? "Unavailable"} / out {usage.outputTokens ?? "Unavailable"}
                  <div style={{ fontSize: 11, opacity: 0.75 }}>
                    cost: {usage.reportedCostUsd !== null ? "$" + usage.reportedCostUsd + " (reported)" : "Unavailable (estimated: " + (usage.estimatedCostUsd ?? "n/a") + ")"}
                  </div>
                </li>
              ))}
              {usageRows.length === 0 && <li className="ur-list-item">No usage recorded. Unknown values stay unknown — nothing is invented.</li>}
            </ul>
          )}

          {inspectorTab === "audit" && (
            <ul className="ur-list">
              {auditRows.map((row) => (
                <li key={row.id} className="ur-list-item" style={{ fontSize: 12 }}>
                  <span style={{ color: row.severity === "critical" ? "#e06c75" : row.severity === "warning" ? "#e2b93b" : "#35c07d" }}>{row.eventType}</span>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{row.summary}</div>
                </li>
              ))}
              {auditRows.length === 0 && <li className="ur-list-item">Audit trail is empty.</li>}
            </ul>
          )}

          {pendingApprovals.length > 0 && (
            <p style={{ fontSize: 11, marginTop: 8, color: "#e2b93b" }}>{pendingApprovals.length} pending approval(s) require a human decision.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: EventRow }) {
  const payload = event.payload;
  switch (payload.type) {
    case "MessageCompleted":
      return (
        <div className="ur-list-item" style={{ borderColor: "#7aa2f7" }}>
          <strong style={{ fontSize: 12 }}>Agent</strong>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{String(payload.text ?? "")}</div>
        </div>
      );
    case "ToolStarted":
    case "ToolCompleted":
      return (
        <div className="ur-list-item" style={{ fontSize: 12, opacity: 0.9 }}>
          {payload.type === "ToolCompleted" ? "✓" : "…"} tool · {String(payload.toolName ?? payload.toolExecutionId ?? "")}
          {payload.type === "ToolCompleted" ? " — " + String(payload.status ?? "") : ""}
        </div>
      );
    case "ApprovalRequired":
      return (
        <div className="ur-list-item" style={{ borderColor: "#e2b93b", fontSize: 12 }}>
          ⚠ approval required: {String(payload.summary ?? "")} (risk {String(payload.riskScore ?? "?")})
        </div>
      );
    case "UsageUpdated":
      return (
        <div className="ur-list-item" style={{ fontSize: 11, opacity: 0.75 }}>
          usage: in {String((payload.usage as { inputTokens?: number } | undefined)?.inputTokens ?? "?")} / out {String((payload.usage as { outputTokens?: number } | undefined)?.outputTokens ?? "?")}
        </div>
      );
    case "RuntimeError":
      return (
        <div className="ur-list-item" style={{ borderColor: "#e06c75", fontSize: 12 }}>
          ✗ error: {String(payload.message ?? "")}
        </div>
      );
    case "SessionCompleted":
      return (
        <div className="ur-list-item" style={{ fontSize: 12, opacity: 0.85 }}>
          session {String(payload.status ?? "completed")}
        </div>
      );
    default:
      return (
        <div className="ur-list-item" style={{ fontSize: 11, opacity: 0.6 }}>
          {payload.type}
        </div>
      );
  }
}
