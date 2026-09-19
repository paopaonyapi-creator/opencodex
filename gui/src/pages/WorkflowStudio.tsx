// Phase 20.93 — Visual Agentic Workflow Studio page.
// Renders LIVE data from /api/agent-os/workflow-studio/* — no placeholder or
// demo data. Workflows / node palette / graph authoring / runs / approvals.

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface NodeDefRow {
  type: string;
  title: string;
  category: string;
  description: string;
  riskLevel: string;
  sideEffect: string;
  requiredCapabilities: string[];
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  active_version: number;
  updated_at: string;
}

interface WorkflowDetail {
  workflow: { id: string; name: string; description: string; activeVersion: number };
  versions: Array<{ id: string; version: number; status: string; planHash: string | null; createdAt: string }>;
  graph: { schemaVersion: string; name: string; description: string; nodes: Array<{ id: string; type: string; position: { x: number; y: number }; config: Record<string, unknown> }>; edges: Array<{ id: string; source: string; sourcePort: string; target: string; targetPort: string }> } | null;
}

interface RunInspection {
  run: { id: string; status: string; planHash: string; trigger: string; error: string | null; costTotal: number; inputTokens: number; outputTokens: number };
  nodes: Array<{ nodeId: string; nodeType: string; effectiveNodeType: string | null; status: string; attempt: number; maxAttempts: number; durationMs: number | null; outputJson: string | null; errorJson: string | null; costUsd: number | null; inputTokens: number | null; outputTokens: number | null }>;
  events: Array<{ type: string; nodeId: string | null; createdAt: string }>;
  artifacts: Array<{ id: string; nodeId: string; name: string; mimeType: string; sha256: string; sizeBytes: number }>;
  approvals: Array<{ id: string; nodeId: string; proposedAction: string; riskLevel: string; status: string }>;
}

interface ApprovalRow {
  id: string;
  runId: string;
  nodeId: string;
  proposedAction: string;
  payloadJson: string;
  riskLevel: string;
  createdAt: string;
}

function statusPill(status: string): string {
  if (["SUCCEEDED", "APPROVED", "published"].includes(status)) return "ur-pill ok";
  if (["FAILED", "CANCELLED", "REJECTED"].includes(status)) return "ur-pill bad";
  if (["RUNNING", "WAITING_FOR_APPROVAL", "PENDING", "draft", "RETRYING", "PAUSED"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

const TEMPLATE_GRAPH = {
  schemaVersion: "1.0",
  name: "new-workflow",
  description: "",
  nodes: [
    { id: "trigger_1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "input_1", type: "input.json", position: { x: 160, y: 0 }, config: { data: { topic: "hello" } } },
    { id: "notify_1", type: "output.notify", position: { x: 320, y: 0 }, config: { message: "done" } },
  ],
  edges: [
    { id: "e1", source: "trigger_1", sourcePort: "output", target: "input_1", targetPort: "input" },
    { id: "e2", source: "input_1", sourcePort: "output", target: "notify_1", targetPort: "input" },
  ],
};

export function WorkflowStudio({ apiBase = "" }: Props) {
  const [nodes, setNodes] = useState<NodeDefRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [run, setRun] = useState<RunInspection | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [name, setName] = useState("");
  const [graphText, setGraphText] = useState(JSON.stringify(TEMPLATE_GRAPH, null, 2));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [healthRes, wfRes, apprRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/workflow-studio/health`).then((r) => (r.ok ? r.json() : { nodes: [] })),
        fetch(`${apiBase}/api/agent-os/workflow-studio/workflows`).then((r) => (r.ok ? r.json() : { workflows: [] })),
        fetch(`${apiBase}/api/agent-os/workflow-studio/approvals`).then((r) => (r.ok ? r.json() : { approvals: [] })),
      ]);
      setNodes((healthRes as { nodes: NodeDefRow[] }).nodes ?? []);
      setWorkflows((wfRes as { workflows: WorkflowRow[] }).workflows ?? []);
      setApprovals((apprRes as { approvals: ApprovalRow[] }).approvals ?? []);
    } catch {
      setMessage("Workflow Studio API is unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/workflows/${encodeURIComponent(id)}`);
      if (res.ok) {
        const body = (await res.json()) as WorkflowDetail;
        setDetail(body);
        if (body.graph) setGraphText(JSON.stringify(body.graph, null, 2));
      }
    } catch {
      setMessage("Failed to load workflow");
    }
  }, [apiBase]);

  const parseGraph = (): unknown | null => {
    try {
      return JSON.parse(graphText);
    } catch {
      setMessage("Graph JSON is not valid JSON");
      return null;
    }
  };

  const createWorkflow = async () => {
    const graph = parseGraph();
    if (!graph) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/workflows`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "new-workflow", graph, actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; id?: string; error?: { message: string } };
      if (body.ok && body.id) {
        await load();
        await loadDetail(body.id);
        setMessage(`Workflow created — publish it to freeze an immutable version`);
      } else {
        setMessage(`Create failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch { setMessage("Create failed"); } finally { setBusy(false); }
  };

  const validate = async () => {
    const graph = parseGraph();
    if (!graph || !detail) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/workflows/${encodeURIComponent(detail.workflow.id)}/validate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph }),
      });
      const body = (await res.json()) as { ok?: boolean; diagnostics?: Array<{ severity: string; message: string; nodeId: string | null }> };
      const errors = (body.diagnostics ?? []).filter((d) => d.severity === "error");
      setMessage(body.ok ? "Validation passed — graph is executable" : `Validation failed: ${errors.map((e) => e.message).join("; ")}`);
    } catch { setMessage("Validation failed"); } finally { setBusy(false); }
  };

  const publish = async () => {
    const graph = parseGraph();
    if (!graph || !detail) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/workflows/${encodeURIComponent(detail.workflow.id)}/publish`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph, actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; version?: number; planHash?: string; error?: { message: string } };
      await loadDetail(detail.workflow.id);
      setMessage(body.ok ? `Published v${body.version} (plan ${body.planHash?.slice(0, 12)}…)` : `Publish failed: ${body.error?.message ?? "unknown"}`);
    } catch { setMessage("Publish failed"); } finally { setBusy(false); }
  };

  const startRun = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/workflows/${encodeURIComponent(detail.workflow.id)}/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trigger: "manual", actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; runId?: string; error?: { message: string } };
      if (!body.ok || !body.runId) { setMessage(`Run failed: ${body.error?.message ?? "unknown"}`); return; }
      await advance(body.runId);
    } catch { setMessage("Run failed"); } finally { setBusy(false); }
  };

  const advance = async (runId: string) => {
    let last = { status: "RUNNING", executed: [] as string[], paused: false };
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/runs/${encodeURIComponent(runId)}/advance`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      last = (await res.json()) as typeof last;
      if (["SUCCEEDED", "FAILED"].includes(last.status) || last.paused) break;
    }
    await loadRun(runId);
    await load();
    setMessage(`Run ${runId.slice(0, 14)}… → ${last.status}${last.paused ? " (paused for approval)" : ""}`);
  };

  const loadRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/workflow-studio/runs/${encodeURIComponent(runId)}`);
      if (res.ok) setRun((await res.json()) as RunInspection);
    } catch { setMessage("Failed to load run"); }
  }, [apiBase]);

  const decide = async (approvalId: string, approve: boolean) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/workflow-studio/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve, actor: "dashboard_operator", note: approve ? "approved via studio" : "rejected via studio" }),
      });
      await load();
      if (run) await advance(run.run.id);
      setMessage(approve ? "Approval granted — run resumed" : "Approval rejected");
    } catch { setMessage("Approval decision failed"); } finally { setBusy(false); }
  };

  return (
    <div className="universal-registry">
      <div className="ur-header">
        <h1>Workflow Studio</h1>
        <p className="ur-subtitle">
          Visual agentic workflow orchestration — typed node graphs, compiled plans, durable runs, human approval gates. Phase 20.93.
          {nodes.length > 0 ? ` ${nodes.length} node types registered.` : ""}
        </p>
      </div>

      <div className="ur-section">
        <h2>Node Palette</h2>
        <div className="ur-grid">
          {nodes.map((n) => (
            <div key={n.type} className="ur-card">
              <strong>{n.title}</strong> <span className="ur-pill">{n.category}</span>
              <span className={statusPill(n.riskLevel === "low" ? "SUCCEEDED" : "RUNNING")}>{n.riskLevel}</span>
              <p>{n.type}</p>
              <p>{n.description}</p>
              {n.requiredCapabilities.length > 0 && <p>requires: {n.requiredCapabilities.join(", ")}</p>}
              {n.sideEffect !== "none" && <p>side effect: {n.sideEffect}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="ur-section">
        <h2>Author a Workflow</h2>
        <div className="ur-actions">
          <input className="ur-search" type="text" placeholder="Workflow name…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="ur-btn" onClick={() => setGraphText(JSON.stringify(TEMPLATE_GRAPH, null, 2))} disabled={busy}>Load template</button>
          <button className="ur-btn" onClick={() => void createWorkflow()} disabled={busy || !name.trim()}>Create</button>
        </div>
        <textarea className="ur-search" rows={12} value={graphText} onChange={(e) => setGraphText(e.target.value)} spellCheck={false} />
        {detail && (
          <div className="ur-actions">
            <button className="ur-btn" onClick={() => void validate()} disabled={busy}>Validate</button>
            <button className="ur-btn" onClick={() => void publish()} disabled={busy}>Publish version</button>
            <button className="ur-btn" onClick={() => void startRun()} disabled={busy || detail.workflow.activeVersion === 0}>Run</button>
          </div>
        )}
        {message && <p className="ur-message">{message}</p>}
      </div>

      <div className="ur-section">
        <h2>Workflows</h2>
        <div className="ur-table-wrap">
          <table className="ur-table">
            <thead><tr><th>Name</th><th>Active version</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.active_version > 0 ? `v${w.active_version}` : <span className="ur-pill warn">no published version</span>}</td>
                  <td>{new Date(w.updated_at).toLocaleString()}</td>
                  <td><button className="ur-btn" onClick={() => void loadDetail(w.id)}>Open</button></td>
                </tr>
              ))}
              {workflows.length === 0 && <tr><td colSpan={4}>No workflows yet — author one above.</td></tr>}
            </tbody>
          </table>
        </div>
        {detail && (
          <div>
            <h3>{detail.workflow.name} — versions</h3>
            {detail.versions.map((v) => (
              <div key={v.id} className="ur-card">
                v{v.version} <span className={statusPill(v.status)}>{v.status}</span>
                <p>plan {v.planHash ? `${v.planHash.slice(0, 16)}…` : "not compiled"}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ur-section">
        <h2>Pending Approvals</h2>
        {approvals.length === 0 && <p>No approvals waiting.</p>}
        {approvals.map((a) => (
          <div key={a.id} className="ur-card">
            <strong>{a.proposedAction}</strong> <span className={statusPill(a.riskLevel === "low" ? "SUCCEEDED" : "RUNNING")}>{a.riskLevel}</span>
            <p>run {a.runId} · node {a.nodeId}</p>
            <p><code>{a.payloadJson.slice(0, 200)}</code></p>
            <button className="ur-btn" onClick={() => void decide(a.id, true)} disabled={busy}>Approve</button>
            <button className="ur-btn" onClick={() => void decide(a.id, false)} disabled={busy}>Reject</button>
          </div>
        ))}
      </div>

      {run && (
        <div className="ur-section">
          <h2>Run {run.run.id} — {run.run.status}</h2>
          <p>
            plan {run.run.planHash.slice(0, 16)}… · trigger {run.run.trigger}
            {` · cost $${(run.run.costTotal ?? 0).toFixed(4)} · tokens ${run.run.inputTokens ?? 0}/${run.run.outputTokens ?? 0}`}
            {run.run.error ? ` · error: ${run.run.error}` : ""}
          </p>
          <div className="ur-table-wrap">
            <table className="ur-table">
              <thead><tr><th>Node</th><th>Type</th><th>Status</th><th>Attempt</th><th>ms</th><th>Cost</th><th>Detail</th></tr></thead>
              <tbody>
                {run.nodes.map((n) => (
                  <tr key={n.nodeId}>
                    <td>{n.nodeId}</td>
                    <td title={n.effectiveNodeType && n.effectiveNodeType !== n.nodeType ? `failover: ${n.nodeType} → ${n.effectiveNodeType}` : n.nodeType}>
                      {n.nodeType}
                      {n.effectiveNodeType && n.effectiveNodeType !== n.nodeType && <span className="ur-pill warn">→ {n.effectiveNodeType}</span>}
                    </td>
                    <td><span className={statusPill(n.status)}>{n.status}</span></td>
                    <td>{n.attempt}/{n.maxAttempts}</td>
                    <td>{n.durationMs ?? "—"}</td>
                    <td>{n.costUsd ? `$${n.costUsd.toFixed(4)}` : "—"}</td>
                    <td title={n.errorJson ?? n.outputJson ?? ""}>{(n.errorJson ?? n.outputJson ?? "").slice(0, 90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.artifacts.length > 0 && (
            <div>
              <h3>Artifacts</h3>
              {run.artifacts.map((a) => (
                <div key={a.id} className="ur-card">
                  <strong>{a.name}</strong> <span className="ur-pill">{a.mimeType}</span>
                  <p>{a.sizeBytes} bytes · sha256 {a.sha256.slice(0, 16)}…</p>
                </div>
              ))}
            </div>
          )}
          <details>
            <summary>Execution events ({run.events.length})</summary>
            <ul>
              {run.events.map((e, i) => (
                <li key={`${e.type}-${i}`}>{e.createdAt} · {e.type}{e.nodeId ? ` · ${e.nodeId}` : ""}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
