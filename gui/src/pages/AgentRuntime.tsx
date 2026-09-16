// Phase 20.61 — Agent Runtime control plane (amux integration).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

interface Task {
  id: string;
  title: string;
  role: string;
  status: string;
  priority: number;
  attempt: number;
  maxAttempts: number;
  claimOwner: string | null;
  branch: string | null;
  worktreePath: string | null;
  scheduledAt?: string | null;
}
interface Worker {
  id: string;
  name: string;
  provider: string;
  roles: string[];
  capabilities: string[];
  maxConcurrency: number;
  status: string;
  runtimeWorkerId: string | null;
}
interface Approval {
  id: string;
  taskId: string;
  action: string;
  riskLevel: string;
  status: string;
  requestedAt: string;
  payloadHash: string;
}
interface Session {
  id: string;
  task_id: string;
  runtime_session_id: string;
  status: string;
  attempt: number;
}

const TASK_OK = new Set(["verified", "approved", "closed"]);
const TASK_BAD = new Set(["failed", "rejected", "cancelled"]);

function pill(status: string, ok: Set<string>, bad: Set<string>): string {
  if (ok.has(status)) return "ur-pill ok";
  if (bad.has(status)) return "ur-pill bad";
  return "ur-pill warn";
}

export default function AgentRuntimePage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [runtime, setRuntime] = useState<Record<string, unknown> | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "workers" | "tasks" | "approvals">("overview");

  const load = useCallback(async () => {
    try {
      const [h, r, w, t, a, s] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/agent-runtime/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-runtime/runtime/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-runtime/workers`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-runtime/tasks`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-runtime/approvals?status=pending`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/agent-runtime/sessions`).then((x) => x.json()),
      ]);
      setHealth(h);
      setRuntime(r.runtime ?? null);
      setWorkers(w.workers ?? []);
      setTasks(t.tasks ?? []);
      setApprovals(a.approvals ?? []);
      setSessions(s.sessions ?? []);
    } catch {
      setMessage("Agent Runtime API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 10000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  const act = async (path: string, body?: unknown, ok?: string) => {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? "{}" : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setMessage(res.ok ? ok ?? "Done." : json.error?.message ?? `Request failed (${res.status}).`);
    } catch {
      setMessage("Request failed.");
    }
    await load();
  };

  const decide = async (approval: Approval, action: "approve" | "reject") => {
    const approverId = window.prompt("Approver id", "operator");
    if (approverId === null) return;
    await act(`/api/agent-os/agent-runtime/approvals/${approval.id}/${action}`, { approverId }, "Decision recorded.");
  };

  const runtimePill = runtime ? String(runtime.compatible) === "true" ? "ur-pill ok" : "ur-pill bad" : "ur-pill warn";

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.61</p>
        <h1>Agent Runtime</h1>
        <p>amux-backed worker orchestration: atomic claims, isolated worktrees, evidence, payload-bound approvals.</p>
        {health ? (
          <p className="ur-meta">
            {String(health.tasks)} tasks · {String(health.running)} running · {String(health.blocked)} blocked ·{" "}
            {String(health.failed)} failed · {String(health.awaitingApproval)} awaiting approval
          </p>
        ) : null}
        {runtime ? (
          <p className="ur-meta">
            runtime: <span className={runtimePill}>{String(runtime.healthy) === "true" ? "healthy" : "unavailable"}</span>{" "}
            commit {String(runtime.commit ?? "—").slice(0, 7)} ·{" "}
            {String(runtime.compatible) === "true" ? "compatible" : "DRIFT — dispatch fails closed"}
          </p>
        ) : null}
        {message ? <p className="ur-banner">{message}</p> : null}
      </header>
      <div className="ur-tabs">
        {(["overview", "workers", "tasks", "approvals"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <table className="ur-table">
          <thead><tr><th>Session</th><th>Task</th><th>Runtime lane</th><th>Attempt</th><th>Status</th></tr></thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={String(s.id ?? i)}>
                <td className="ur-meta">{String(s.id ?? "")}</td>
                <td className="ur-meta">{String(s.task_id ?? "")}</td>
                <td>{String(s.runtime_session_id ?? "")}</td>
                <td>{String(s.attempt ?? "")}</td>
                <td><span className={pill(String(s.status ?? ""), new Set(["running"]), new Set(["stopped", "dead"]))}>{String(s.status ?? "")}</span></td>
              </tr>
            ))}
            {sessions.length === 0 ? <tr><td colSpan={5} className="ur-meta">No sessions yet. Enable dispatch and run a task.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "workers" ? (
        <table className="ur-table">
          <thead><tr><th>Worker</th><th>Provider</th><th>Roles</th><th>Capabilities</th><th>Concurrency</th><th>Status</th></tr></thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id}>
                <td>{w.name}<div className="ur-meta">{w.id}</div></td>
                <td>{w.provider}</td>
                <td className="ur-meta">{w.roles.join(", ")}</td>
                <td className="ur-meta">{w.capabilities.join(", ")}</td>
                <td>{w.maxConcurrency}</td>
                <td><span className={pill(w.status, new Set(["online"]), new Set(["offline"]))}>{w.status}</span></td>
              </tr>
            ))}
            {workers.length === 0 ? <tr><td colSpan={6} className="ur-meta">Register workers via POST /api/agent-os/agent-runtime/workers.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "tasks" ? (
        <table className="ur-table">
          <thead><tr><th>Task</th><th>Role</th><th>Status</th><th>Attempt</th><th>Branch</th><th>Actions</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}<div className="ur-meta">{t.id}{t.worktreePath ? " · isolated worktree" : ""}</div></td>
                <td>{t.role}</td>
                <td><span className={pill(t.status, TASK_OK, TASK_BAD)}>{t.status}</span></td>
                <td>{t.attempt}/{t.maxAttempts}</td>
                <td className="ur-meta">{t.branch ?? "—"}</td>
                <td>
                  {t.status === "draft" ? <button className="ur-btn small" onClick={() => void act(`/api/agent-os/agent-runtime/tasks/${t.id}/queue`, {}, "Queued.")}>Queue</button> : null}
                  {t.status === "draft" || t.status === "failed" || t.status === "rejected" ? <button className="ur-btn small" onClick={() => void act(`/api/agent-os/agent-runtime/tasks/${t.id}/dispatch`, {}, "Dispatched (atomic claim).")}>Dispatch</button> : null}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/agent-runtime/tasks/${t.id}/cancel`, { actorId: "operator" }, "Cancelled.")}>Cancel</button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 ? <tr><td colSpan={6} className="ur-meta">Create tasks via POST /api/agent-os/agent-runtime/tasks.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "approvals" ? (
        <table className="ur-table">
          <thead><tr><th>Action</th><th>Task</th><th>Risk</th><th>Requested</th><th>Payload hash</th><th>Decision</th></tr></thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <td>{a.action}</td>
                <td className="ur-meta">{a.taskId}</td>
                <td><span className={a.riskLevel === "critical" ? "ur-pill bad" : "ur-pill warn"}>{a.riskLevel}</span></td>
                <td className="ur-meta">{a.requestedAt}</td>
                <td className="ur-meta">{a.payloadHash.slice(0, 16)}…</td>
                <td>
                  <button className="ur-btn small" onClick={() => void decide(a, "approve")}>Approve</button>{" "}
                  <button className="ur-btn small" onClick={() => void decide(a, "reject")}>Reject</button>
                </td>
              </tr>
            ))}
            {approvals.length === 0 ? <tr><td colSpan={6} className="ur-meta">Approval queue is empty.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
