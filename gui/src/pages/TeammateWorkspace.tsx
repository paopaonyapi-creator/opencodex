// Phase 20.42 — Teammate Workspace dashboard (spec §21-§24): sidebar
// (chats/agents/teams/routines), conversation with streaming timeline and
// approval cards, agent inspector, round confirmation with recipient order,
// Stop/Retry, routine editor + history. Truthful states only.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface WorkspaceProps {
  apiBase?: string;
}

interface AgentView {
  id: string;
  name: string;
  role: string;
  status: string;
  description: string | null;
  defaultModel: string | null;
  validation: { runnable: boolean; issues: Array<{ code: string; severity: string; message: string }> };
}

interface TeamView {
  id: string;
  name: string;
  orchestrationMode: string;
  members: Array<{ agentId: string; position: number }>;
}

interface ConversationView {
  id: string;
  kind: string;
  title: string | null;
  agentId: string | null;
  teamId: string | null;
  lastMessageAt: string | null;
}

interface MessageView {
  id: string;
  senderType: string;
  senderId: string | null;
  role: string;
  blocks: Array<{ type: string; text?: string }>;
  status: string;
  parentExecutionId: string | null;
  createdAt: string;
}

interface RoundView {
  id: string;
  status: string;
  orchestrationMode: string;
  resolvedAgentOrder: string[];
  stopReason: string | null;
}

interface ExecutionView {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  attempt: number;
  errorCode: string | null;
  events: Array<{ sequence: number; eventType: string; payloadJson: string }>;
}

interface ApprovalView {
  id: string;
  actionSummary: string;
  actionType: string;
  riskLevel: string;
  status: string;
  executionId: string | null;
}

interface RoutineView {
  id: string;
  name: string;
  triggerType: string;
  status: string;
  concurrencyPolicy: string;
  instructionTemplate: string;
  ownerAgentId: string | null;
}

type ViewKey = "chats" | "agents" | "teams" | "routines";

const STATUS_COLORS: Record<string, string> = {
  completed: "#35c07d", running: "#7aa2f7", queued: "#8a93a6", failed: "#e06c75",
  cancelled: "#e2b93b", awaiting_consent: "#e2b93b", pending: "#e2b93b", approved: "#35c07d",
  denied: "#e06c75", partial: "#e2b93b", active: "#35c07d", disabled: "#e06c75", paused: "#e2b93b",
};

async function api<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "request failed");
  return body.data as T;
}

export function TeammateWorkspace({ apiBase = "" }: WorkspaceProps) {
  const [view, setView] = useState<ViewKey>("chats");
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [executions, setExecutions] = useState<ExecutionView[]>([]);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [routines, setRoutines] = useState<RoutineView[]>([]);
  const [composer, setComposer] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [consentRound, setConsentRound] = useState<{ round: RoundView; text: string; agentIdsInOrder: string[]; mode: string } | null>(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("researcher");
  const [newAgentInstructions, setNewAgentInstructions] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoutineName, setNewRoutineName] = useState("");
  const [newRoutineOwner, setNewRoutineOwner] = useState<string>("");
  const [routineRuns, setRoutineRuns] = useState<Array<{ id: string; status: string; triggerSource: string; startedAt: string | null }>>([]);
  const [selectedRoutine, setSelectedRoutine] = useState<string | null>(null);
  const [lastRoundId, setLastRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [agentData, teamData, convData, approvalData, routineData] = await Promise.all([
        api<{ agents: AgentView[] }>(apiBase, "/api/agent-workspace/agents"),
        api<{ teams: TeamView[] }>(apiBase, "/api/agent-workspace/teams"),
        api<{ conversations: ConversationView[] }>(apiBase, "/api/agent-workspace/conversations"),
        api<{ approvals: ApprovalView[] }>(apiBase, "/api/agent-workspace/approvals?status=pending"),
        api<{ routines: RoutineView[] }>(apiBase, "/api/agent-workspace/routines"),
      ]);
      setAgents(agentData.agents);
      setTeams(teamData.teams);
      setConversations(convData.conversations);
      setApprovals(approvalData.approvals);
      setRoutines(routineData.routines);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedConversation) return;
    const load = async () => {
      try {
        const data = await api<{ messages: MessageView[] }>(apiBase, "/api/agent-workspace/conversations/messages?id=" + encodeURIComponent(selectedConversation));
        setMessages(data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [apiBase, selectedConversation]);

  const loadRoundTimeline = useCallback(async (roundId: string) => {
    try {
      const data = await api<{ round: RoundView; executions: ExecutionView[] }>(apiBase, "/api/agent-workspace/rounds/detail?id=" + encodeURIComponent(roundId));
      setExecutions(data.executions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  useEffect(() => {
    if (!lastRoundId) return;
    const initial = setTimeout(() => void loadRoundTimeline(lastRoundId), 0);
    const timer = setInterval(() => void loadRoundTimeline(lastRoundId), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [lastRoundId, loadRoundTimeline]);

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const createAgent = async () => {
    if (!newAgentName.trim()) return;
    try {
      await api(apiBase, "/api/agent-workspace/agents", { method: "POST", body: JSON.stringify({ name: newAgentName, role: newAgentRole, systemInstructions: newAgentInstructions }) });
      setNewAgentName("");
      setNewAgentInstructions("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createTeam = async () => {
    if (!newTeamName.trim() || selectedRecipients.length === 0) return;
    try {
      const team = await api<TeamView>(apiBase, "/api/agent-workspace/teams", { method: "POST", body: JSON.stringify({ name: newTeamName, memberAgentIds: selectedRecipients, orchestrationMode: "ordered" }) });
      setNewTeamName("");
      const conversation = await api<ConversationView>(apiBase, "/api/agent-workspace/conversations", { method: "POST", body: JSON.stringify({ kind: "group", teamId: team.id, title: team.name }) });
      setSelectedRecipients([]);
      await refresh();
      setSelectedConversation(conversation.id);
      setView("chats");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async () => {
    if (!selectedConversation || !composer.trim()) return;
    const isGroup = conversations.find((conversation) => conversation.id === selectedConversation)?.kind === "group";
    const text = composer;
    setComposer("");
    try {
      if (isGroup && selectedRecipients.length > 0) {
        const result = await api<{ round: RoundView; consentRequired: boolean }>(apiBase, "/api/agent-workspace/rounds", {
          method: "POST",
          body: JSON.stringify({ conversationId: selectedConversation, text, agentIdsInOrder: selectedRecipients, mode: "ordered" }),
        });
        setConsentRound({ round: result.round, text, agentIdsInOrder: selectedRecipients, mode: "ordered" });
        setLastRoundId(result.round.id);
        await refresh();
      } else {
        await api(apiBase, "/api/agent-workspace/conversations/messages", { method: "POST", body: JSON.stringify({ conversationId: selectedConversation, text }) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runRound = async () => {
    if (!consentRound) return;
    try {
      await api(apiBase, "/api/agent-workspace/rounds/run", { method: "POST", body: JSON.stringify({ roundId: consentRound.round.id, conversationId: selectedConversation, text: consentRound.text, agentIdsInOrder: consentRound.agentIdsInOrder, mode: consentRound.mode, requireConsent: false }) });
      setConsentRound(null);
      setLastRoundId(consentRound.round.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopRound = async (roundId: string) => {
    try {
      await api(apiBase, "/api/agent-workspace/rounds/cancel", { method: "POST", body: JSON.stringify({ roundId }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const decideApproval = async (approvalId: string, approve: boolean) => {
    try {
      await api(apiBase, "/api/agent-workspace/approvals/decide", { method: "POST", body: JSON.stringify({ approvalId, approve, actor: "operator" }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createRoutine = async () => {
    if (!newRoutineName.trim() || !newRoutineOwner) return;
    try {
      await api(apiBase, "/api/agent-workspace/routines", { method: "POST", body: JSON.stringify({ name: newRoutineName, ownerAgentId: newRoutineOwner, triggerType: "manual", instructionTemplate: "Run the routine for " + newRoutineName }) });
      setNewRoutineName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runRoutine = async (routineId: string) => {
    try {
      await api(apiBase, "/api/agent-workspace/routines/run", { method: "POST", body: JSON.stringify({ id: routineId }) });
      const runs = await api<{ runs: typeof routineRuns }>(apiBase, "/api/agent-workspace/routines/runs?id=" + encodeURIComponent(routineId));
      setRoutineRuns(runs.runs);
      setSelectedRoutine(routineId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Teammate Workspace</h1>
          <p className="ur-subtitle">Named AI teammates, ordered group rounds, approval gates, routines — truthful states only</p>
        </div>
        <div className="ur-actions">
          {(["chats", "agents", "teams", "routines"] as ViewKey[]).map((key) => (
            <button key={key} className="ur-button" style={{ opacity: view === key ? 1 : 0.6 }} onClick={() => setView(key)}>{key}</button>
          ))}
        </div>
      </header>

      {error && <div className="ur-error" role="alert">{error}</div>}

      {approvals.length > 0 && (
        <section className="ur-card" style={{ borderColor: "#e2b93b", marginBottom: 12 }}>
          <h2 className="ur-section-title">Approvals awaiting human decision</h2>
          {approvals.map((approval) => (
            <div key={approval.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
              <span><strong style={{ color: approval.riskLevel === "critical" || approval.riskLevel === "high" ? "#e06c75" : "#e2b93b" }}>{approval.riskLevel}</strong> · {approval.actionSummary}</span>
              <span>
                <button className="ur-button" onClick={() => void decideApproval(approval.id, true)}>Approve</button>{" "}
                <button className="ur-button" onClick={() => void decideApproval(approval.id, false)}>Deny</button>
              </span>
            </div>
          ))}
        </section>
      )}

      {view === "chats" && (
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 300px", gap: 14, alignItems: "start" }}>
          <section className="ur-card">
            <h2 className="ur-section-title">Chats</h2>
            <ul className="ur-list">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="ur-list-item" style={{ cursor: "pointer", borderColor: selectedConversation === conversation.id ? "#7aa2f7" : undefined }} onClick={() => setSelectedConversation(conversation.id)}>
                  <strong style={{ fontSize: 12 }}>{conversation.title ?? conversation.kind}</strong>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{conversation.kind}</div>
                </li>
              ))}
              {conversations.length === 0 && <li className="ur-list-item">No conversations yet — create an agent, then a direct chat appears when you message it.</li>}
            </ul>
          </section>

          <section className="ur-card" style={{ minHeight: 460, display: "flex", flexDirection: "column" }}>
            <h2 className="ur-section-title">Conversation</h2>
            <div style={{ flex: 1, overflowY: "auto", maxHeight: 380, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map((message) => (
                <div key={message.id} className="ur-list-item" style={{ borderColor: message.senderType === "user" ? "#7aa2f7" : undefined }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    {message.senderType === "agent" ? agentById.get(message.senderId ?? "")?.name ?? "agent" : message.senderType} · {message.status}
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{message.blocks.map((block) => block.text ?? "").join("")}</div>
                </div>
              ))}
              {messages.length === 0 && <p style={{ opacity: 0.6 }}>Select a chat or create agents/teams first.</p>}
            </div>
            {consentRound && (
              <div className="ur-list-item" style={{ borderColor: "#e2b93b", margin: "8px 0" }}>
                <div style={{ fontSize: 12 }}><strong>Round confirmation</strong> — resolved order:</div>
                <ol style={{ fontSize: 12, margin: "4px 0 0 18px" }}>
                  {consentRound.agentIdsInOrder.map((agentId) => (
                    <li key={agentId}>{agentById.get(agentId)?.name ?? agentId} — {agentById.get(agentId)?.defaultModel ?? "mock runtime"}</li>
                  ))}
                </ol>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="ur-button" onClick={() => void runRound()}>Run round</button>
                  <button className="ur-button" onClick={() => setConsentRound(null)}>Cancel</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input className="ur-input" placeholder={selectedConversation ? "Message… (use @Name to mention)" : "Select a chat first"} value={composer} disabled={!selectedConversation} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} />
              <button className="ur-button" disabled={!selectedConversation || !composer.trim()} onClick={() => void send()}>Send</button>
            </div>
            {selectedConversation && conversations.find((conversation) => conversation.id === selectedConversation)?.kind === "group" && (
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                Recipients (ordered): {selectedRecipients.map((agentId) => agentById.get(agentId)?.name ?? agentId).join(" → ") || "none selected"}
              </div>
            )}
          </section>

          <section className="ur-card">
            <h2 className="ur-section-title">Run timeline</h2>
            {executions.length === 0 && <p style={{ fontSize: 11, opacity: 0.6 }}>Rounds appear here with per-agent state.</p>}
            {executions.map((execution) => (
              <div key={execution.id} style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: STATUS_COLORS[execution.status] ?? "#8a93a6" }}>{execution.status === "completed" ? "✓" : execution.status === "failed" || execution.status === "cancelled" ? "✗" : "●"}</span>{" "}
                {execution.agentName} <span style={{ opacity: 0.7 }}>({execution.status}, attempt {execution.attempt})</span>
              </div>
            ))}
            {lastRoundId && executions.some((execution) => execution.status === "running" || execution.status === "queued" || execution.status === "starting") && (
              <button className="ur-button" style={{ borderColor: "#e06c75", marginTop: 8 }} onClick={() => void stopRound(lastRoundId)}>Stop round</button>
            )}
            <h2 className="ur-section-title" style={{ marginTop: 10 }}>Recent rounds</h2>
            {selectedConversation && executions.length === 0 && <p style={{ fontSize: 11, opacity: 0.6 }}>Start a group round.</p>}
          </section>
        </div>
      )}

      {view === "agents" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Create agent</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="name" value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} style={{ maxWidth: 200 }} />
            <select className="ur-input" value={newAgentRole} onChange={(event) => setNewAgentRole(event.target.value)} style={{ maxWidth: 180 }}>
              {["chief_of_staff", "researcher", "planner", "coder", "reviewer", "browser_operator", "system_admin", "custom"].map((role) => <option key={role}>{role}</option>)}
            </select>
            <button className="ur-button" onClick={() => void createAgent()}>Create</button>
          </div>
          <textarea className="ur-input" placeholder="system instructions" value={newAgentInstructions} onChange={(event) => setNewAgentInstructions(event.target.value)} rows={2} style={{ width: "100%", marginBottom: 12 }} />
          <h2 className="ur-section-title">Agents ({agents.length})</h2>
          <ul className="ur-list">
            {agents.map((agent) => (
              <li key={agent.id} className="ur-list-item">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 12 }}>{agent.name}</strong>
                  <span style={{ color: STATUS_COLORS[agent.status], fontSize: 11 }}>{agent.status}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{agent.role} · {agent.validation.runnable ? "runnable" : "blocked: " + agent.validation.issues.map((issue) => issue.code).join(", ")}</div>
                <div style={{ marginTop: 4 }}>
                  <button className="ur-button" onClick={() => { setSelectedRecipients((previous) => previous.includes(agent.id) ? previous.filter((id) => id !== agent.id) : [...previous, agent.id]); }}>
                    {selectedRecipients.includes(agent.id) ? "Deselect" : "Select"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "teams" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Create team (selected agents become ordered members)</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input className="ur-input" placeholder="team name" value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} style={{ maxWidth: 220 }} />
            <button className="ur-button" disabled={selectedRecipients.length === 0} onClick={() => void createTeam()}>Create team + chat</button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>Order: {selectedRecipients.map((agentId, index) => (index + 1) + ". " + (agentById.get(agentId)?.name ?? agentId)).join("  →  ")}</div>
          <ul className="ur-list">
            {teams.map((team) => (
              <li key={team.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <strong>{team.name}</strong> · {team.orchestrationMode}
                <div style={{ opacity: 0.7 }}>{team.members.map((member) => member.position + ". " + (agentById.get(member.agentId)?.name ?? member.agentId)).join(" → ")}</div>
              </li>
            ))}
            {teams.length === 0 && <li className="ur-list-item">No teams yet.</li>}
          </ul>
        </section>
      )}

      {view === "routines" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Create routine (manual trigger)</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="routine name" value={newRoutineName} onChange={(event) => setNewRoutineName(event.target.value)} style={{ maxWidth: 200 }} />
            <select className="ur-input" value={newRoutineOwner} onChange={(event) => setNewRoutineOwner(event.target.value)} style={{ maxWidth: 200 }}>
              <option value="">owner agent…</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button className="ur-button" onClick={() => void createRoutine()}>Create</button>
          </div>
          <ul className="ur-list">
            {routines.map((routine) => (
              <li key={routine.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{routine.name}</strong>
                  <span style={{ color: STATUS_COLORS[routine.status] }}>{routine.status}</span>
                </div>
                <div style={{ opacity: 0.75 }}>{routine.triggerType} · {routine.concurrencyPolicy}</div>
                <button className="ur-button" style={{ marginTop: 4 }} onClick={() => void runRoutine(routine.id)}>Run now</button>
              </li>
            ))}
            {routines.length === 0 && <li className="ur-list-item">No routines yet.</li>}
          </ul>
          {selectedRoutine && (
            <div style={{ fontSize: 12, marginTop: 8 }}>
              <h3 className="ur-section-title">Run history</h3>
              {routineRuns.map((run) => (
                <div key={run.id}>{run.status} · {run.triggerSource} · {run.startedAt ?? "—"}</div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
