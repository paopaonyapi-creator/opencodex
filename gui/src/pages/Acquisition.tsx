// Phase 20.95 — Content Acquisition Gateway dashboard.
// Live data from /api/agent-os/acquisition/* — mock fallback is labeled, never presented as live OmniGet.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/shared";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

type Surface = "request" | "jobs" | "approval" | "artifacts" | "sessions" | "health";

interface JobRow {
  id: string;
  state: string;
  intent: string;
  sourceHost: string | null;
  adapter: string | null;
  policyDecision: string | null;
  createdAt: string;
}

interface AdapterHealth {
  id: string;
  status: string;
  detail?: string;
  capabilityCount?: number;
}

function pill(status: string): string {
  if (["COMPLETED", "healthy", "allow"].includes(status)) return "ur-pill ok";
  if (["FAILED", "BLOCKED", "CANCELLED", "offline", "deny"].includes(status)) return "ur-pill bad";
  if (["WAITING_APPROVAL", "QUEUED", "ACQUIRING", "unconfigured"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function Acquisition({ apiBase = "" }: Props) {
  const t = useT();
  const [surface, setSurface] = useState<Surface>("request");
  const [source, setSource] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [prompt, setPrompt] = useState(t("acq.defaultPrompt"));
  const [ingestKnowledge, setIngestKnowledge] = useState(true);
  const [preserveOriginal, setPreserveOriginal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [health, setHealth] = useState<{ ok?: boolean; phase?: string; adapters?: AdapterHealth[] } | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [inspection, setInspection] = useState<{ job?: JobRow; artifacts?: Array<Record<string, unknown>>; events?: Array<Record<string, unknown>> } | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, j, s] = await Promise.all([
        fetch(apiBase + "/api/agent-os/acquisition/health").then((res) => res.json()),
        fetch(apiBase + "/api/agent-os/acquisition/jobs").then((res) => (res.ok ? res.json() : { jobs: [] })),
        fetch(apiBase + "/api/agent-os/acquisition/sessions").then((res) => (res.ok ? res.json() : { sessions: [] })),
      ]);
      setHealth(h);
      setJobs(j.jobs ?? []);
      setSessions(s.sessions ?? []);
      setLoadState(h?.ok === false || h?.error ? "error" : "ready");
    } catch (err) {
      setLoadState("error");
      setMessage(err instanceof Error ? err.message : t("acq.loadFailed"));
    }
  }, [apiBase, t]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);

  async function previewPlan() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(apiBase + "/api/agent-os/acquisition/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, prompt, ingestKnowledge, preserveOriginal }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(body?.error?.message ?? t("acq.submitFailed"));
      else setPlan(body.plan ?? body);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("acq.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(apiBase + "/api/agent-os/acquisition/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, prompt, ingestKnowledge, preserveOriginal, transcribe: true, summarize: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body?.error?.message ?? t("acq.submitFailed"));
      } else {
        setInspection(body);
        setPlan(body.plan ?? null);
        setMessage(String(body.job?.state ?? ""));
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("acq.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, verb: string) {
    setBusy(true);
    try {
      const res = await fetch(apiBase + "/api/agent-os/acquisition/jobs/" + encodeURIComponent(id) + "/" + verb, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) setMessage(body?.error?.message ?? verb);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function inspect(id: string) {
    const res = await fetch(apiBase + "/api/agent-os/acquisition/jobs/" + encodeURIComponent(id));
    const body = await res.json();
    if (res.ok) setInspection(body);
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(apiBase + "/api/agent-os/acquisition/session-refs/" + encodeURIComponent(id) + "/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const tabs: Surface[] = ["request", "jobs", "approval", "artifacts", "sessions", "health"];
  const tabKey = {
    request: "acq.tab.request",
    jobs: "acq.tab.jobs",
    approval: "acq.tab.approval",
    artifacts: "acq.tab.artifacts",
    sessions: "acq.tab.sessions",
    health: "acq.tab.health",
  } as const;
  const waiting = jobs.filter((j) => j.state === "WAITING_APPROVAL");
  const artifacts = inspection?.artifacts ?? [];
  const mockOnly = (health?.adapters ?? []).every((a) => a.id === "mock" || a.status !== "healthy");

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">{t("acq.kicker")}</p>
        <h1>{t("acq.title")}</h1>
        <p>{t("acq.subtitle")}</p>
        {health && <p><span className={pill(health.ok ? "COMPLETED" : "FAILED")}>{health.ok ? t("acq.ready") : t("acq.error")}</span> {health.phase}</p>}
        {mockOnly && loadState === "ready" && <p className="ur-pill warn">{t("acq.mockNote")}</p>}
        {loadState === "loading" && <p>{t("acq.loading")}</p>}
        {loadState === "error" && <p className="ur-pill bad">{message ?? t("acq.unavailable")}</p>}
      </header>

      <div className="ur-tabs">
        {tabs.map((s) => (
          <button key={s} className={"ur-btn" + (surface === s ? " active" : "")} onClick={() => setSurface(s)}>{t(tabKey[s])}</button>
        ))}
      </div>

      {message && <p>{message}</p>}

      {surface === "request" && (
        <section className="ur-section">
          <h2>{t("acq.newRequest")}</h2>
          <label>{t("acq.source")}</label>
          <input value={source} onChange={(e) => setSource(e.target.value)} style={{ width: "100%" }} />
          <label>{t("acq.prompt")}</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={{ width: "100%" }} />
          <p>
            <label><input type="checkbox" checked={ingestKnowledge} onChange={(e) => setIngestKnowledge(e.target.checked)} /> {t("acq.knowledge")}</label>
            {" "}
            <label><input type="checkbox" checked={preserveOriginal} onChange={(e) => setPreserveOriginal(e.target.checked)} /> {t("acq.preserveOriginal")}</label>
          </p>
          <p>
            <button className="ur-btn" disabled={busy || !source.trim()} onClick={() => void previewPlan()}>{t("acq.planPreview")}</button>
            {" "}
            <button className="ur-btn" disabled={busy || !source.trim()} onClick={() => void submit()}>{busy ? t("acq.planning") : t("acq.submit")}</button>
          </p>
          {plan && (
            <div className="ur-card">
              <p>{t("acq.planPreview")}: {String(plan.selectedAdapter)} / {String(plan.authClass)} / {String(plan.riskClass)}</p>
              <p>{t("acq.commercialUnknown")}</p>
              <p>{t("acq.untrusted")}</p>
            </div>
          )}
          {inspection?.job && <p><span className={pill(inspection.job.state)}>{inspection.job.state}</span> {inspection.job.id}</p>}
        </section>
      )}

      {surface === "jobs" && (
        <section className="ur-section">
          <h2>{t("acq.jobs")}</h2>
          {jobs.length === 0 && <p>{t("acq.noJobs")}</p>}
          {jobs.map((job) => (
            <div className="ur-card" key={job.id}>
              <p><span className={pill(job.state)}>{job.state}</span> {job.sourceHost} · {job.intent} · {job.adapter}</p>
              <p>
                <button className="ur-btn" onClick={() => void inspect(job.id)}>{t("acq.artifacts")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "pause")}>{t("acq.pause")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "resume")}>{t("acq.resume")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "cancel")}>{t("acq.cancel")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "retry")}>{t("acq.retry")}</button>
              </p>
            </div>
          ))}
        </section>
      )}

      {surface === "approval" && (
        <section className="ur-section">
          <h2>{t("acq.waitingApproval")}</h2>
          {waiting.length === 0 && <p>{t("acq.noJobs")}</p>}
          {waiting.map((job) => (
            <div className="ur-card" key={job.id}>
              <p><span className={pill(job.state)}>{job.state}</span> {job.sourceHost}</p>
              <p>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "approve")}>{t("acq.approve")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act(job.id, "deny")}>{t("acq.deny")}</button>
              </p>
            </div>
          ))}
        </section>
      )}

      {surface === "artifacts" && (
        <section className="ur-section">
          <h2>{t("acq.artifacts")}</h2>
          {artifacts.length === 0 && <p>{t("acq.noJobs")}</p>}
          {artifacts.map((art) => (
            <div className="ur-card" key={String(art.id)}>
              <p>{String(art.relativePath)} · {String(art.sha256)} · {String(art.commercialRights)}</p>
            </div>
          ))}
        </section>
      )}

      {surface === "sessions" && (
        <section className="ur-section">
          <h2>{t("acq.sessions")}</h2>
          {sessions.length === 0 && <p>{t("acq.noSessions")}</p>}
          {sessions.map((sess) => (
            <div className="ur-card" key={String(sess.id)}>
              <p>{String(sess.id)} · {String(sess.provider)} · {String(sess.secretRef)}</p>
              <button className="ur-btn" disabled={busy || Boolean(sess.revokedAt)} onClick={() => void revoke(String(sess.id))}>{t("acq.revoke")}</button>
            </div>
          ))}
        </section>
      )}

      {surface === "health" && (
        <section className="ur-section">
          <h2>{t("acq.adapterHealth")}</h2>
          {(health?.adapters ?? []).map((a) => (
            <div className="ur-card" key={a.id}>
              <p><span className={pill(a.status)}>{a.status}</span> {a.id} {a.detail}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
