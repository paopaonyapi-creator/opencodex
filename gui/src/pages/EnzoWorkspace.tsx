// Phase 20.94 — Unified AI Operating Workspace.
// Renders LIVE data from /api/agent-os/enzo-workspace/* — no placeholder demo payloads.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/shared";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

type Surface = "chat" | "models" | "agents" | "skills" | "research" | "code" | "operations";

interface Health {
  ok?: boolean;
  phase?: string;
  enabled?: boolean;
  models?: number;
  runs?: number;
  surfaces?: string[];
  error?: { code?: string; message?: string };
}

interface RunRow {
  id: string;
  mode: string;
  status: string;
  requestText: string;
  createdAt: string;
  error: string | null;
}

interface Inspection {
  run: RunRow & { policyProfile?: string };
  events: Array<{ seq: number; type: string; createdAt: string }>;
  artifacts: Array<{ id: string; name: string; sha256: string; type: string }>;
  approvals: Array<{ id: string; actionType: string; riskLevel: string; status: string }>;
  agent?: { name?: string; slug?: string; version?: number; objective?: string } | null;
  skills?: { selected?: Array<{ id: string; reason: string }>; denied?: Array<{ id: string; reason: string }> } | null;
  lessons?: Array<{ id: string; statement: string; status: string; confidence: number }>;
}

function pill(status: string): string {
  if (["COMPLETED", "APPROVED", "healthy", "accepted"].includes(status)) return "ur-pill ok";
  if (["FAILED", "DENIED", "CANCELLED", "offline"].includes(status)) return "ur-pill bad";
  if (["RUNNING", "WAITING_FOR_APPROVAL", "PLANNING", "CREATED", "candidate"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function EnzoWorkspace({ apiBase = "" }: Props) {
  const t = useT();
  const [surface, setSurface] = useState<Surface>("chat");
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [agents, setAgents] = useState<Array<Record<string, unknown>>>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [request, setRequest] = useState(t("enzo.defaultPrompt"));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const [h, m, a, r, ap] = await Promise.all([
        fetch(apiBase + "/api/agent-os/enzo-workspace/health").then((res) => res.json()),
        fetch(apiBase + "/api/agent-os/enzo-workspace/models").then((res) => (res.ok ? res.json() : { models: [] })),
        fetch(apiBase + "/api/agent-os/enzo-workspace/agents").then((res) => (res.ok ? res.json() : { agents: [] })),
        fetch(apiBase + "/api/agent-os/enzo-workspace/runs").then((res) => (res.ok ? res.json() : { runs: [] })),
        fetch(apiBase + "/api/agent-os/enzo-workspace/approvals").then((res) => (res.ok ? res.json() : { approvals: [] })),
      ]);
      setHealth(h);
      setModels(m.models ?? []);
      setAgents(a.agents ?? []);
      setRuns(r.runs ?? []);
      setApprovals(ap.approvals ?? []);
      setLoadState(h?.ok === false || h?.error ? "error" : "ready");
    } catch (err) {
      setLoadState("error");
      setMessage(err instanceof Error ? err.message : t("enzo.loadFailed"));
    }
  }, [apiBase, t]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);

 async function runTask() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(apiBase + "/api/agent-os/enzo-workspace/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body?.error?.message ?? t("enzo.runFailed"));
      } else {
        setInspection(body);
        setMessage(String(body.run?.status ?? ""));
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("enzo.runFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    try {
      const res = await fetch(apiBase + "/api/agent-os/enzo-workspace/approvals/" + encodeURIComponent(id) + (approve ? "/approve" : "/deny"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (res.ok) setInspection(body);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const surfaces: Surface[] = ["chat", "models", "agents", "skills", "research", "code", "operations"];
  const tabKey = {
    chat: "enzo.tab.chat",
    models: "enzo.tab.models",
    agents: "enzo.tab.agents",
    skills: "enzo.tab.skills",
    research: "enzo.tab.research",
    code: "enzo.tab.code",
    operations: "enzo.tab.operations",
  } as const;
  const unconfigured = health && health.ok && (health.models ?? 0) >= 0;

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">{t("enzo.kicker")}</p>
        <h1>{t("enzo.title")}</h1>
        <p>{t("enzo.subtitle")}</p>
        {health && <p><span className={pill(health.ok ? "COMPLETED" : "FAILED")}>{health.ok ? t("enzo.ready") : health.error?.code ?? t("enzo.error")}</span></p>}
        {loadState === "loading" && <p>{t("enzo.loading")}</p>}
        {loadState === "error" && <p className="ur-pill bad">{message ?? health?.error?.message ?? t("enzo.unavailable")}</p>}
      </header>

      <div className="ur-tabs">
        {surfaces.map((s) => (
          <button key={s} className={"ur-btn" + (surface === s ? " active" : "")} onClick={() => setSurface(s)}>{t(tabKey[s])}</button>
        ))}
      </div>

      {message && <p>{message}</p>}

      {surface === "chat" && (
        <section className="ur-section">
          <h2>{t("enzo.newTask")}</h2>
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={6} style={{ width: "100%" }} />
          <p>
            <button className="ur-btn" disabled={busy || !request.trim()} onClick={() => void runTask()}>{busy ? t("enzo.running") : t("enzo.planExecute")}</button>
          </p>
          {inspection && (
            <div className="ur-card">
              <p><span className={pill(inspection.run.status)}>{inspection.run.status}</span> {inspection.run.id}</p>
              <p>{inspection.run.requestText}</p>
              {inspection.agent && <p>{inspection.agent.name} v{inspection.agent.version}</p>}
              {inspection.skills?.selected && <p>{t("enzo.skillsLabel")}: {inspection.skills.selected.map((s) => s.id).join(", ") || t("enzo.none")}</p>}
            </div>
          )}
          {runs.length === 0 && loadState === "ready" && <p>{t("enzo.noRunsYet")}</p>}
        </section>
      )}

      {surface === "models" && (
        <section className="ur-section">
          <h2>{t("enzo.modelsTitle")}</h2>
          {models.length === 0 && <p>{t("enzo.noModels")}</p>}
          <div className="ur-table-wrap">
            <table className="ur-table">
              <thead><tr><th>{t("enzo.colModel")}</th><th>{t("enzo.colProvider")}</th><th>{t("enzo.colHealth")}</th><th>{t("enzo.colCost")}</th><th>{t("enzo.colConfigured")}</th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={String(m.id)}>
                    <td>{String(m.displayName ?? m.id)}</td>
                    <td>{String(m.provider)}</td>
                    <td><span className={pill(String(m.health))}>{String(m.health)}</span></td>
                    <td>{String(m.costClass)}</td>
                    <td>{m.configured ? t("enzo.yes") : t("enzo.unconfigured")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {surface === "agents" && (
        <section className="ur-section">
          <h2>{t("enzo.agentsTitle")}</h2>
          {agents.length === 0 && <p>{t("enzo.noAgents")}</p>}
          {agents.map((a) => (
            <div key={String(a.id)} className="ur-card">
              <strong>{String(a.name)}</strong> <span className={pill(String(a.status))}>{String(a.status)}</span>
              <p>{String(a.slug)} v{String(a.version)}</p>
            </div>
          ))}
        </section>
      )}

      {surface === "skills" && (
        <section className="ur-section">
          <h2>{t("enzo.skillsTitle")}</h2>
          <p>{t("enzo.skillsHelp")}</p>
          {inspection?.skills ? (
            <div>
              {(inspection.skills.selected ?? []).map((s) => <div key={s.id} className="ur-card"><strong>{s.id}</strong><p>{s.reason}</p></div>)}
              {(inspection.skills.denied ?? []).map((s) => <div key={s.id} className="ur-card"><strong>{s.id}</strong> <span className="ur-pill bad">{t("enzo.denied")}</span><p>{s.reason}</p></div>)}
            </div>
          ) : <p>{t("enzo.skillsEmpty")}</p>}
        </section>
      )}

      {surface === "research" && (
        <section className="ur-section">
          <h2>{t("enzo.researchTitle")}</h2>
          {inspection?.run?.mode === "research" || inspection?.run?.mode === "agent" ? (
            <div className="ur-card">
              <p>{inspection.run.id}</p>
              <p>{inspection.artifacts.filter((a) => a.type === "research").map((a) => a.name).join(", ") || t("enzo.noneYet")}</p>
            </div>
          ) : <p>{t("enzo.researchEmpty")}</p>}
        </section>
      )}

      {surface === "code" && (
        <section className="ur-section">
          <h2>{t("enzo.codeTitle")}</h2>
          <p>{t("enzo.codeHelp")}</p>
          {inspection?.approvals?.length ? <p>{t("enzo.codePending")}</p> : <p>{t("enzo.codeEmpty")}</p>}
        </section>
      )}

      {surface === "operations" && (
        <section className="ur-section">
          <h2>{t("enzo.approvals")}</h2>
          {approvals.length === 0 && <p>{t("enzo.noApprovals")}</p>}
          {approvals.map((a) => (
            <div key={String(a.id)} className="ur-card">
              <strong>{String(a.actionType)}</strong> <span className={pill(String(a.riskLevel))}>{String(a.riskLevel)}</span>
              <p>{String(a.runId)}</p>
              <button className="ur-btn" disabled={busy} onClick={() => void decide(String(a.id), true)}>{t("enzo.approveOnce")}</button>
              <button className="ur-btn" disabled={busy} onClick={() => void decide(String(a.id), false)}>{t("enzo.deny")}</button>
            </div>
          ))}
          <h2>{t("enzo.runs")}</h2>
          {runs.length === 0 && <p>{t("enzo.noRuns")}</p>}
          {runs.map((r) => (
            <div key={r.id} className="ur-card">
              <span className={pill(r.status)}>{r.status}</span> {r.mode} · {r.id}
              <p>{r.requestText.slice(0, 160)}</p>
            </div>
          ))}
          {unconfigured && inspection?.lessons && inspection.lessons.length > 0 && (
            <div>
              <h2>{t("enzo.lessons")}</h2>
              {inspection.lessons.map((l) => (
                <div key={l.id} className="ur-card"><span className={pill(l.status)}>{l.status}</span> {l.statement}</div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
