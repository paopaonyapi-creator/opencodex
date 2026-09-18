// Phase 20.91b — Engineering Skill Runtime dashboard page.
// Renders LIVE data from /api/agent-os/engineering-skills/* — no placeholder
// or demo data. Packs / Routing Inspector / Workflows views (Phase 20.91b blueprint §31).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface Health {
  ok: boolean;
  phase: string;
  counts: { packs: number; activePacks: number; skills: number; workflows: number; openWorkflows: number };
  invariantCheck: string;
}

interface PackRow {
  id: string;
  name: string;
  sourceType: string;
  version: string | null;
  resolvedCommit: string;
  license: string | null;
  trustStatus: string;
  lifecycleStatus: string;
  enabled: boolean;
}

interface SkillRow {
  id: string;
  slug: string;
  packId: string;
  name: string;
  lifecycleStages: string[];
  riskLevel: string;
  enabled: boolean;
}

interface WorkflowRow {
  id: string;
  title: string;
  status: string;
  risk: string;
  route: { intent: string; selected: string[] };
  stopReason: string | null;
  startedAt: string;
}

interface RouteExplanation {
  intent: string;
  risk: { risk: string; matchedRules: string[]; gate: string };
  explanation: {
    selected: Array<{ slug: string; reason: string; stage: string }>;
    rejected: Array<{ slug: string; reason: string }>;
    stagesCovered: string[];
  };
}

function statusPill(status: string): string {
  if (["ACTIVE", "DONE", "READY_TO_SHIP", "SHIP", "OBSERVE"].includes(status)) return "ur-pill ok";
  if (["QUARANTINED", "FAILED_VERIFICATION", "FAILED_REVIEW", "ROLLED_BACK", "CANCELLED", "BLOCKED"].includes(status)) return "ur-pill bad";
  if (["CANDIDATE", "VERIFY", "REVIEW", "NEEDS_HUMAN", "ROLLBACK_REQUIRED"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function EngineeringSkills({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [routeResult, setRouteResult] = useState<RouteExplanation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const [healthRes, packRes, skillRes, wfRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/engineering-skills/health`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/api/agent-os/engineering-skills/packs`).then((r) => (r.ok ? r.json() : { packs: [] })),
        fetch(`${apiBase}/api/agent-os/engineering-skills/skills`).then((r) => (r.ok ? r.json() : { skills: [] })),
        fetch(`${apiBase}/api/agent-os/engineering-skills/workflows`).then((r) => (r.ok ? r.json() : { workflows: [] })),
      ]);
      setHealth(healthRes);
      setPacks(packRes.packs ?? []);
      setSkills(skillRes.skills ?? []);
      setWorkflows(wfRes.workflows ?? []);
    } catch {
      setMessage("Engineering Skill Runtime API is unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const packAction = async (pack: PackRow, action: "validate" | "promote" | "rollback" | "enable" | "disable") => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/engineering-skills/packs/${encodeURIComponent(pack.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator", reason: "dashboard action" }),
      });
      const body = (await res.json()) as { ok?: boolean; pack?: PackRow; issues?: string[]; error?: { message: string } };
      await load();
      if (body.ok) {
        setMessage(`Pack '${pack.name}' ${action}: ${body.pack?.lifecycleStatus ?? "ok"}${body.issues?.length ? ` — ${body.issues.join("; ")}` : ""}`);
      } else {
        setMessage(`Pack ${action} failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch {
      setMessage(`Pack ${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  const explainRoute = async () => {
    if (!taskInput.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/engineering-skills/routes/explain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: taskInput }),
      });
      const body = (await res.json()) as RouteExplanation & { ok?: boolean };
      if (body.ok) {
        setRouteResult(body);
      } else {
        setMessage("Routing failed");
      }
    } catch {
      setMessage("Routing failed");
    } finally {
      setBusy(false);
    }
  };

  const startWorkflow = async () => {
    if (!taskInput.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/engineering-skills/workflows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: taskInput, actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; workflow?: WorkflowRow; error?: { message: string } };
      if (body.ok && body.workflow) {
        await load();
        setMessage(`Workflow ${body.workflow.id} started (${body.workflow.status}, risk ${body.workflow.risk})`);
      } else {
        setMessage(`Start failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch {
      setMessage("Start failed");
    } finally {
      setBusy(false);
    }
  };

  const workflowAction = async (id: string, action: "advance" | "cancel") => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/engineering-skills/workflows/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator", reason: "dashboard action" }),
      });
      const body = (await res.json()) as { ok?: boolean; transitioned?: boolean; workflow?: WorkflowRow; reason?: string; missingGate?: { label: string } | null; error?: { message: string } };
      await load();
      if (body.ok) {
        setMessage(
          action === "advance"
            ? body.transitioned
              ? `Advanced → ${body.workflow?.status}`
              : `Gate: ${body.reason ?? "transition refused"}`
            : `Cancelled ${id}`,
        );
      } else {
        setMessage(`Action failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch {
      setMessage("Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="universal-registry">
      <div className="ur-header">
        <h1>Engineering Skill Runtime</h1>
        <p className="ur-subtitle">
          Lifecycle-aware skill routing with evidence-gated workflows — Phase 20.91b (Addy Osmani Agent Skills).
          {health ? ` ${health.counts.activePacks}/${health.counts.packs} packs active, ${health.counts.skills} skills, ${health.counts.openWorkflows} open workflows.` : ""}
        </p>
        <div className="ur-actions">
          <input
            className="ur-search"
            type="search"
            placeholder="Describe a task to route or run (e.g. 'fix the API auth bug')…"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
          />
          <button className="ur-btn" onClick={() => void explainRoute()} disabled={busy || !taskInput.trim()}>Explain Route</button>
          <button className="ur-btn" onClick={() => void startWorkflow()} disabled={busy || !taskInput.trim()}>Start Workflow</button>
        </div>
        {message && <p className="ur-message">{message}</p>}
      </div>

      {routeResult && (
        <div className="ur-section">
          <h2>Routing Inspector</h2>
          <p>
            Intent <strong>{routeResult.intent}</strong> · Risk <strong>{routeResult.risk.risk}</strong> ({routeResult.risk.gate}) · Stages: {routeResult.explanation.stagesCovered.join(" → ") || "—"}
          </p>
          <div className="ur-grid">
            <div>
              <h3>Selected ({routeResult.explanation.selected.length})</h3>
              {routeResult.explanation.selected.map((s) => (
                <div key={s.slug} className="ur-card">
                  <strong>{s.slug}</strong> <span className="ur-pill">{s.stage}</span>
                  <p>{s.reason}</p>
                </div>
              ))}
            </div>
            <div>
              <h3>Rejected ({routeResult.explanation.rejected.length})</h3>
              {routeResult.explanation.rejected.slice(0, 12).map((s) => (
                <div key={s.slug} className="ur-card">
                  <strong>{s.slug}</strong>
                  <p>{s.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="ur-section">
        <h2>Workflow Runs</h2>
        <div className="ur-table-wrap">
          <table className="ur-table">
            <thead>
              <tr><th>Run</th><th>Status</th><th>Risk</th><th>Route</th><th>Started</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {workflows.slice(0, 20).map((w) => (
                <tr key={w.id}>
                  <td title={w.stopReason ?? w.id}>{w.title}</td>
                  <td><span className={statusPill(w.status)}>{w.status}</span></td>
                  <td>{w.risk}</td>
                  <td>{w.route?.selected?.join(", ") || w.route?.intent}</td>
                  <td>{new Date(w.startedAt).toLocaleTimeString()}</td>
                  <td>
                    <button className="ur-btn" onClick={() => void workflowAction(w.id, "advance")} disabled={busy}>Advance</button>
                    <button className="ur-btn" onClick={() => void workflowAction(w.id, "cancel")} disabled={busy}>Cancel</button>
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr><td colSpan={6}>No workflow runs yet — describe a task above and press Start Workflow.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ur-section">
        <h2>Skill Packs</h2>
        <div className="ur-table-wrap">
          <table className="ur-table">
            <thead>
              <tr><th>Pack</th><th>Version</th><th>Commit</th><th>Trust</th><th>Lifecycle</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id}>
                  <td>{p.name} <span className="ur-pill">{p.sourceType}</span></td>
                  <td>{p.version}</td>
                  <td title={p.resolvedCommit}>{p.resolvedCommit.slice(0, 12)}</td>
                  <td>{p.license ?? "—"} · {p.trustStatus}</td>
                  <td><span className={statusPill(p.lifecycleStatus)}>{p.lifecycleStatus}</span></td>
                  <td>
                    <button className="ur-btn" onClick={() => void packAction(p, "validate")} disabled={busy}>Validate</button>
                    <button className="ur-btn" onClick={() => void packAction(p, "promote")} disabled={busy || p.lifecycleStatus !== "CANDIDATE"}>Promote</button>
                    <button className="ur-btn" onClick={() => void packAction(p, "rollback")} disabled={busy}>Rollback</button>
                    <button className="ur-btn" onClick={() => void packAction(p, p.enabled ? "disable" : "enable")} disabled={busy}>{p.enabled ? "Disable" : "Enable"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ur-section">
        <h2>Skill Catalog ({skills.length})</h2>
        <div className="ur-grid">
          {skills.map((s) => (
            <div key={s.id} className="ur-card">
              <strong>{s.slug}</strong> <span className={statusPill(s.riskLevel === "critical" || s.riskLevel === "high" ? "warn" : "ok")}>{s.riskLevel}</span>
              {!s.enabled && <span className="ur-pill bad">disabled</span>}
              <p>{s.lifecycleStages.join(" · ")}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
