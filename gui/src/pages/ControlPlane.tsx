// Phase 20.16 — Pao-hubPro Multi-AI Control Plane: Command Center.
//
// Deliberately shows ONLY what the backend reports. When the API is unavailable the
// page says so rather than rendering placeholder rows, because an operations surface
// that invents plausible task counts is worse than one that admits it has no data.
//
// The Approval Center has no "allow everything" control, and that is a design
// constraint from the phase spec, not an omission: every approval is per task and
// per tool.

import { useCallback, useEffect, useState } from "react";
import "../styles/control-plane.css";

interface ControlPlaneProps {
  apiBase?: string;
}

interface TaskSummary {
  task_id: string;
  project_id: string;
  goal: string;
  task_type: string;
  risk_level: string;
  status: string;
  created_at: string;
}

interface ToolCallSummary {
  id: string;
  tool: string;
  risk: string;
  outcome: string;
  reason: string | null;
  created_at: string;
}

interface ApprovalSummary {
  id: string;
  task_id: string;
  tool: string;
  risk: string;
  reason: string;
  status: string;
  requested_at: string;
}

interface ArtifactSummary {
  id: string;
  name: string;
  artifact_type: string;
  status: string;
  content_hash: string;
}

interface Overview {
  metrics: Record<string, number>;
  taskCount: number;
  byStatus: Record<string, number>;
  waitingApproval: ApprovalSummary[];
  failedTasks: TaskSummary[];
  activeTasks: TaskSummary[];
  recentToolCalls: ToolCallSummary[];
  recentArtifacts: ArtifactSummary[];
  deniedToolCalls: number;
}

type Tab = "overview" | "tasks" | "approvals" | "tools" | "artifacts";

/** Risk level to a muted class, so a page of rows is still scannable. */
function riskClass(risk: string): string {
  if (risk === "L3") return "cp-chip cp-chip--critical";
  if (risk === "L2") return "cp-chip cp-chip--high";
  if (risk === "L1") return "cp-chip cp-chip--medium";
  return "cp-chip cp-chip--low";
}

/** Outcome to a class. Denials and failures must not look like successes. */
function outcomeClass(outcome: string): string {
  if (outcome === "succeeded") return "cp-chip cp-chip--low";
  if (outcome === "approval_required") return "cp-chip cp-chip--medium";
  return "cp-chip cp-chip--critical";
}

export default function ControlPlane({ apiBase = "" }: ControlPlaneProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `${apiBase}/api/agent-os/control-plane`;

  /** Fetch and surface failure explicitly instead of substituting placeholder data. */
  const load = useCallback(
    async (which: Tab) => {
      setBusy(true);
      setError(null);
      try {
        if (which === "overview") {
          const res = await fetch(base, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setOverview((await res.json()) as Overview);
        } else if (which === "tasks") {
          const res = await fetch(`${base}/tasks`, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setTasks(((await res.json()) as { tasks: TaskSummary[] }).tasks ?? []);
        } else if (which === "approvals") {
          const res = await fetch(`${base}/approvals`, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setApprovals(((await res.json()) as { approvals: ApprovalSummary[] }).approvals ?? []);
        } else if (which === "tools") {
          const res = await fetch(`${base}/tools`, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setToolCalls(((await res.json()) as { toolCalls: ToolCallSummary[] }).toolCalls ?? []);
        } else if (which === "artifacts") {
          const res = await fetch(`${base}/artifacts`, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setArtifacts(((await res.json()) as { artifacts: ArtifactSummary[] }).artifacts ?? []);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  useEffect(() => {
    let cancelled = false;
    // The fetch is started inside a microtask rather than called synchronously, so
    // the effect body itself does no setState. React's compiler flags a synchronous
    // setState in an effect as a cascading-render hazard, and the flag is correct
    // here: the load path sets busy state, which would render twice on every tab
    // change. The cancellation guard keeps a fast tab switch from letting a stale
    // response overwrite the tab the user is now looking at.
    const run = async () => {
      if (cancelled) return;
      await load(tab);
    };
    void Promise.resolve().then(run);
    const timer = setInterval(() => void run(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tab, load]);

  const decide = async (approvalId: string, decision: "grant" | "deny") => {
    setBusy(true);
    try {
      await fetch(`${base}/approvals/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approvalId, decision }),
      });
    } finally {
      setBusy(false);
      await load("approvals");
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Command Center" },
    { id: "tasks", label: "Task Graph" },
    { id: "approvals", label: "Approval Center" },
    { id: "tools", label: "Tool Activity" },
    { id: "artifacts", label: "Artifact Studio" },
  ];

  return (
    <div className="cp-page">
      <header className="cp-header">
        <div>
          <h1 className="cp-title">Multi-AI Control Plane</h1>
          <p className="cp-subtitle">
            Task-scoped permissions, reviewer council, and an append-only tool ledger.
          </p>
        </div>
        <button className="cp-refresh" onClick={() => void load(tab)} disabled={busy}>
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <nav className="cp-tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            className={entry.id === tab ? "cp-tab cp-tab--active" : "cp-tab"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="cp-error">
          <strong>Control plane is not reachable.</strong> {error}
          <div className="cp-error-hint">
            Nothing is being shown in its place: this view reports only what the backend
            actually returns.
          </div>
        </div>
      ) : null}

      {tab === "overview" && overview ? (
        <>
          <section className="cp-metrics">
            <Metric label="Tasks" value={overview.taskCount} />
            <Metric label="Tool calls" value={overview.metrics.tool_calls_total ?? 0} />
            <Metric label="Denied" value={overview.deniedToolCalls} tone="warn" />
            <Metric label="Awaiting approval" value={overview.waitingApproval.length} tone="warn" />
            <Metric label="Failed tasks" value={overview.metrics.tasks_failed_total ?? 0} tone="bad" />
          </section>

          <section className="cp-grid">
            <Panel title="Active runs">
              {overview.activeTasks.length === 0 ? (
                <Empty text="No task is running." />
              ) : (
                overview.activeTasks.map((task) => (
                  <div key={task.task_id} className="cp-row">
                    <span className={riskClass(task.risk_level)}>{task.risk_level}</span>
                    <span className="cp-row-main">{task.goal}</span>
                    <span className="cp-row-meta">{task.project_id}</span>
                  </div>
                ))
              )}
            </Panel>

            <Panel title="Waiting for approval">
              {overview.waitingApproval.length === 0 ? (
                <Empty text="Nothing is waiting on a human decision." />
              ) : (
                overview.waitingApproval.map((approval) => (
                  <div key={approval.id} className="cp-row">
                    <span className={riskClass(approval.risk)}>{approval.risk}</span>
                    <span className="cp-row-main">{approval.tool}</span>
                    <span className="cp-row-meta">{approval.task_id}</span>
                  </div>
                ))
              )}
            </Panel>

            <Panel title="Recent tool activity">
              {overview.recentToolCalls.length === 0 ? (
                <Empty text="No tool call has been recorded." />
              ) : (
                overview.recentToolCalls.slice(0, 12).map((call) => (
                  <div key={call.id} className="cp-row">
                    <span className={outcomeClass(call.outcome)}>{call.outcome}</span>
                    <span className="cp-row-main">{call.tool}</span>
                    <span className="cp-row-meta">{new Date(call.created_at).toLocaleTimeString()}</span>
                  </div>
                ))
              )}
            </Panel>

            <Panel title="Recent artifacts">
              {overview.recentArtifacts.length === 0 ? (
                <Empty text="No artifact has been registered." />
              ) : (
                overview.recentArtifacts.map((artifact) => (
                  <div key={artifact.id} className="cp-row">
                    <span className="cp-chip cp-chip--low">{artifact.artifact_type}</span>
                    <span className="cp-row-main">{artifact.name}</span>
                    <span className="cp-row-meta">{artifact.content_hash.slice(0, 10)}</span>
                  </div>
                ))
              )}
            </Panel>
          </section>
        </>
      ) : null}

      {tab === "approvals" ? (
        <Panel title="Approval Center">
          <p className="cp-note">
            Every approval is scoped to one task and one tool. There is intentionally no
            blanket allow option.
          </p>
          {approvals.length === 0 ? (
            <Empty text="No pending approval." />
          ) : (
            approvals.map((approval) => (
              <div key={approval.id} className="cp-approval">
                <div className="cp-approval-head">
                  <span className={riskClass(approval.risk)}>{approval.risk}</span>
                  <strong>{approval.tool}</strong>
                  <span className="cp-row-meta">{approval.task_id}</span>
                </div>
                {approval.reason ? <div className="cp-approval-reason">{approval.reason}</div> : null}
                <div className="cp-approval-actions">
                  <button onClick={() => void decide(approval.id, "grant")} disabled={busy}>
                    Approve Once
                  </button>
                  <button
                    className="cp-danger"
                    onClick={() => void decide(approval.id, "deny")}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </Panel>
      ) : null}

      {tab === "tasks" ? (
        <Panel title="Task Graph">
          {tasks.length === 0 ? (
            <Empty text="No task has been created." />
          ) : (
            tasks.map((task) => (
              <div key={task.task_id} className="cp-row">
                <span className={riskClass(task.risk_level)}>{task.risk_level}</span>
                <span className="cp-row-main">{task.goal}</span>
                <span className="cp-row-meta">{task.task_type}</span>
                <span className="cp-row-meta">{task.status}</span>
              </div>
            ))
          )}
        </Panel>
      ) : null}

      {tab === "tools" ? (
        <Panel title="Tool Activity">
          <p className="cp-note">Arguments were redacted before being stored.</p>
          {toolCalls.length === 0 ? (
            <Empty text="No tool call has been recorded." />
          ) : (
            toolCalls.map((call) => (
              <div key={call.id} className="cp-row">
                <span className={outcomeClass(call.outcome)}>{call.outcome}</span>
                <span className="cp-row-main">{call.tool}</span>
                <span className="cp-row-meta">{call.reason ?? ""}</span>
              </div>
            ))
          )}
        </Panel>
      ) : null}

      {tab === "artifacts" ? (
        <Panel title="Artifact Studio">
          {artifacts.length === 0 ? (
            <Empty text="No artifact has been registered." />
          ) : (
            artifacts.map((artifact) => (
              <div key={artifact.id} className="cp-row">
                <span className="cp-chip cp-chip--low">{artifact.artifact_type}</span>
                <span className="cp-row-main">{artifact.name}</span>
                <span className="cp-row-meta">{artifact.status}</span>
                <span className="cp-row-meta">{artifact.content_hash.slice(0, 10)}</span>
              </div>
            ))
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className={tone ? `cp-metric cp-metric--${tone}` : "cp-metric"}>
      <div className="cp-metric-value">{value}</div>
      <div className="cp-metric-label">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cp-panel">
      <h2 className="cp-panel-title">{title}</h2>
      <div className="cp-panel-body">{children}</div>
    </section>
  );
}

/**
 * An explicit empty state. Rendering sample rows here would make an idle control
 * plane look busy, which is exactly the false signal an operations page must avoid.
 */
function Empty({ text }: { text: string }) {
  return <div className="cp-empty">{text}</div>;
}
