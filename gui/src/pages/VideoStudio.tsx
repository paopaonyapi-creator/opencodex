// Phase 20.92 — AI Script-to-Video Studio dashboard page (GOLD upgraded).
// Renders LIVE data from /api/agent-os/video-studio/* — no placeholder or demo
// data. Projects / AUTO BUILD / pipeline / scene inspector / providers / batch /
// ops views. Fallback visuals are always labelled (never shown as AI-generated).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  aspectRatio: string;
  quality: string;
  createdAt: string;
}

interface SceneRow {
  id: string;
  narrationText: string;
  intent: string;
  durationMs: number;
  status: string;
  disabled: boolean;
  locks: Record<string, boolean>;
  visualPlan: { strategy: string; resolvedAssetIds: string[]; explanation: string; generationClass?: string; generationVersion?: number };
  motionPlan: { templateId: string };
  captions: { mode: string };
}

interface ProjectDetail {
  project: ProjectRow;
  scenes: SceneRow[];
  timeline: { durationMs: number; timelineHash: string } | null;
  qa: { passed: boolean; checks: Array<{ category: string; name: string; passed: boolean; detail: string }> } | null;
  renderPath: string | null;
  costUsd: number;
  approvals: Array<{ kind: string; status: string }>;
}

interface ProviderRow {
  capability: string;
  provider: string;
  model: string;
  availability: string;
  credentialStatus: string;
  generationClass: string;
  notes?: string;
}

interface JobStatus {
  status: string;
  currentStep: string | null;
  steps: Array<{ step: string; status: string }>;
  pauseReason: string | null;
}

interface OpsSummary {
  jobs: Array<{ id: string; projectId: string; kind: string; status: string; currentStep: string | null }>;
  providerExecutions: Array<{ provider: string; operation: string; status: string; count: number; avgDurationMs: number; retries: number }>;
  recentFailures: Array<{ provider: string; operation: string; errorCode: string | null; createdAt: string }>;
}

function statusPill(status: string): string {
  if (["DONE", "QA_PASSED", "RENDERED", "EXPORTED", "ASSETS_READY", "TIMELINE_READY", "COMPLETED", "available"].includes(status)) return "ur-pill ok";
  if (["FAILED_RETRYABLE", "FAILED_BLOCKED", "CANCELLED", "DRAFT", "offline"].includes(status)) return "ur-pill bad";
  if (["WAITING_APPROVAL", "RUNNING", "PLANNED", "SCRIPTED", "RENDERING", "unconfigured"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

const PIPELINE_STEPS = ["SEGMENT", "PLAN", "RESOLVE_ASSETS", "VOICE", "TIMELINE", "QA", "PREVIEW_RENDER", "APPROVAL_GATE"];

interface TemplateRow {
  id: string;
  supportsIntents: string[];
  motion: { entrance: string; emphasis: string; exit: string };
  version: string;
}

export function VideoStudio({ apiBase = "" }: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [targetDurationSec, setTargetDurationSec] = useState("");
  const [templateId, setTemplateId] = useState("auto");
  const [visualProvider, setVisualProvider] = useState("auto");
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [batchCsv, setBatchCsv] = useState("Topic,Script\n");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projRes, provRes, tmplRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/video-studio/projects`).then((r) => (r.ok ? r.json() : { projects: [] })),
        fetch(`${apiBase}/api/agent-os/video-studio/providers`).then((r) => (r.ok ? r.json() : { providers: [] })),
        fetch(`${apiBase}/api/agent-os/video-studio/templates`).then((r) => (r.ok ? r.json() : { templates: [] })),
      ]);
      setProjects((projRes as { projects: ProjectRow[] }).projects ?? []);
      setProviders((provRes as { providers: ProviderRow[] }).providers ?? []);
      setTemplates((tmplRes as { templates: TemplateRow[] }).templates ?? []);
    } catch {
      setMessage("Video Studio API is unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(id)}`);
      if (res.ok) setDetail((await res.json()) as ProjectDetail);
    } catch {
      setMessage("Failed to load project detail");
    }
  }, [apiBase]);

  const loadOps = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/ops`);
      if (res.ok) setOps((await res.json()) as OpsSummary);
    } catch { /* ops view is best-effort */ }
  }, [apiBase]);

  const createProject = async () => {
    if (!title.trim() || !script.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title, script, aspectRatio, actor: "dashboard_operator",
          targetDurationSec: targetDurationSec ? Number(targetDurationSec) : undefined,
          templateId: templateId === "auto" ? undefined : templateId,
          visualProvider, voiceProvider,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; project?: ProjectRow; error?: { message: string } };
      if (body.ok && body.project) {
        await load();
        setMessage(`Project '${body.project.title}' created — press AUTO BUILD to run the pipeline`);
      } else {
        setMessage(`Create failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch { setMessage("Create failed"); } finally { setBusy(false); }
  };

  const runAutoBuild = async (projectId: string, target: "preview" | "final") => {
    setBusy(true);
    setMessage(null);
    try {
      const start = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/auto-build`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const startBody = (await start.json()) as { ok?: boolean; jobId?: string };
      if (!startBody.ok || !startBody.jobId) { setMessage("Auto build failed to start"); return; }
      let last = { job: { status: "QUEUED", currentStep: null as string | null }, step: null as string | null, done: false, paused: false, detail: undefined as string | undefined };
      const cap = target === "final" ? 7 : 12; // final stops after PREVIEW_RENDER (approval gate next)
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${apiBase}/api/agent-os/video-studio/auto-build/${encodeURIComponent(startBody.jobId)}/step`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
        });
        last = (await res.json()) as never;
        if (last.done || last.job.status.startsWith("FAILED") || (target === "final" && last.step === "PREVIEW_RENDER" && last.job.status === "RUNNING")) break;
      }
      const status = await fetch(`${apiBase}/api/agent-os/video-studio/auto-build/${encodeURIComponent(startBody.jobId)}`);
      setJob((await status.json()) as JobStatus);
      await load();
      await loadDetail(projectId);
      void cap;
      setMessage(
        last.job.status === "WAITING_APPROVAL"
          ? `AUTO BUILD stopped at the human-review boundary (${last.job.currentStep ?? "APPROVAL_GATE"}) — no auto-publish`
          : `Auto build ended: ${last.job.status}${last.detail ? ` — ${last.detail}` : ""}`,
      );
    } catch { setMessage("Auto build failed"); } finally { setBusy(false); }
  };

  const approve = async (projectId: string) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "DRAFT_VIDEO_APPROVAL", decide: true, approve: true, approver: "dashboard_operator" }),
      });
      await loadDetail(projectId);
      setMessage("DRAFT_VIDEO_APPROVAL granted — FINAL RENDER unlocked");
    } catch { setMessage("Approval failed"); } finally { setBusy(false); }
  };

  const renderFinal = async (projectId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/render-final`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; path?: string; error?: { message: string } };
      await loadDetail(projectId);
      setMessage(body.ok ? `FINAL 1080p render: ${body.path}` : `Final render refused: ${body.error?.message ?? "unknown"}`);
    } catch { setMessage("Final render failed"); } finally { setBusy(false); }
  };

  const sceneAction = async (projectId: string, sceneId: string, action: "regenerate" | "voice" | "disable" | "enable") => {
    setBusy(true);
    try {
      const body = action === "regenerate" ? JSON.stringify({ what: "visual", actor: "dashboard_operator" }) : "{}";
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      });
      const body2 = (await res.json()) as { ok?: boolean; error?: { message: string } };
      await loadDetail(projectId);
      if (!body2.ok) setMessage(`Scene ${action} refused: ${body2.error?.message ?? "unknown"}`);
    } catch { setMessage("Scene action failed"); } finally { setBusy(false); }
  };

  const runBatch = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const lines = batchCsv.trim().split("\n").slice(1).filter(Boolean);
      const items = lines.map((line) => {
        const [topic, ...rest] = line.split(",");
        return { title: topic?.trim() ?? "Batch item", script: rest.join(",").trim() };
      }).filter((i) => i.script.length > 0);
      if (items.length === 0) { setMessage("Batch CSV needs title,script rows"); return; }
      const create = await fetch(`${apiBase}/api/agent-os/video-studio/batch`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, actor: "dashboard_operator" }),
      });
      const created = (await create.json()) as { ok?: boolean; batchId?: string };
      if (!created.ok || !created.batchId) { setMessage("Batch create failed"); return; }
      const run = await fetch(`${apiBase}/api/agent-os/video-studio/batch/${encodeURIComponent(created.batchId)}/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ concurrency: 2, actor: "dashboard_operator" }),
      });
      const ran = (await run.json()) as { ok?: boolean; total?: number; done?: number; failed?: number; waiting?: number };
      await load(); await loadOps();
      setMessage(`Batch ${created.batchId}: ${ran.total ?? 0} jobs — done ${ran.done ?? 0}, waiting approval ${ran.waiting ?? 0}, failed ${ran.failed ?? 0}`);
    } catch { setMessage("Batch failed"); } finally { setBusy(false); }
  };

  const buildManifest = async (projectId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/manifest`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = (await res.json()) as { ok?: boolean; filename?: string; manifest?: { sha256: string; policy_status?: { human_approval?: string } }; error?: { message: string } };
      if (body.ok) setMessage(`Stock manifest ${body.filename} — sha256 ${body.manifest?.sha256?.slice(0, 16)}… · approval: ${body.manifest?.policy_status?.human_approval ?? "pending"}`);
      else setMessage(`Manifest refused: ${body.error?.message ?? "unknown"}`);
    } catch { setMessage("Manifest failed"); } finally { setBusy(false); }
  };

  const generationPill = (gc?: string) => {
    if (gc === "ai-generated") return <span className="ur-pill ok">AI</span>;
    if (gc === "library") return <span className="ur-pill">library</span>;
    return <span className="ur-pill warn">fallback</span>;
  };

  return (
    <div className="universal-registry">
      <div className="ur-header">
        <h1>Video Studio</h1>
        <p className="ur-subtitle">
          AI Script-to-Video — semantic segmentation, scene planning, asset ladder, deterministic timeline, ffmpeg render — Phase 20.92 GOLD.
        </p>
      </div>

      <div className="ur-section">
        <h2>Provider Capability Matrix</h2>
        <div className="ur-grid">
          {providers.map((p) => (
            <div key={`${p.capability}:${p.provider}`} className="ur-card">
              <strong>{p.capability}</strong> {p.provider} <span className={statusPill(p.availability)}>{p.availability}</span>
              <p>{p.model} · {p.generationClass} · {p.notes ?? ""}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="ur-section">
        <h2>New Project</h2>
        <div className="ur-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input className="ur-search" type="text" placeholder="Project name…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="ur-search" rows={4} placeholder="Paste a script… (English or Thai)" value={script} onChange={(e) => setScript(e.target.value)} />
          <div className="ur-actions">
            <select className="ur-search" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} style={{ maxWidth: 140 }}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
            </select>
            <input
              className="ur-search" type="number" min={10} max={600} style={{ maxWidth: 170 }}
              placeholder="Target seconds" value={targetDurationSec}
              onChange={(e) => setTargetDurationSec(e.target.value)}
            />
            <select className="ur-search" value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ maxWidth: 210 }} title="Preferred motion template (honoured when it supports the scene intent)">
              <option value="auto">Template: auto (intent-aware)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>Template: {t.id}</option>
              ))}
            </select>
            <select className="ur-search" value={visualProvider} onChange={(e) => setVisualProvider(e.target.value)} style={{ maxWidth: 210 }} title="Visual provider — AI requires a configured ComfyUI endpoint">
              <option value="auto">Visual: auto</option>
              <option value="comfyui">Visual: ComfyUI (AI)</option>
              <option value="deterministic-card">Visual: brand card (no AI)</option>
            </select>
            <select className="ur-search" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value)} style={{ maxWidth: 210 }} title="Voice provider — VoiceStudio requires its endpoint configuration">
              <option value="auto">Voice: auto</option>
              <option value="voicestudio">Voice: VoiceStudio (AI)</option>
              <option value="mock-speech">Voice: offline tone (no AI)</option>
            </select>
            <button className="ur-btn" onClick={() => void createProject()} disabled={busy || !title.trim() || !script.trim()}>Create</button>
          </div>
        </div>
        {message && <p className="ur-message">{message}</p>}
      </div>

      <div className="ur-section">
        <h2>Projects</h2>
        <div className="ur-table-wrap">
          <table className="ur-table">
            <thead>
              <tr><th>Title</th><th>Status</th><th>Format</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td><span className={statusPill(p.status)}>{p.status}</span></td>
                  <td>{p.aspectRatio} · {p.quality}</td>
                  <td>
                    <button className="ur-btn" onClick={() => void loadDetail(p.id)}>Inspect</button>
                    <button className="ur-btn" onClick={() => void runAutoBuild(p.id, "preview")} disabled={busy}>AUTO BUILD</button>
                    <button className="ur-btn" onClick={() => void approve(p.id)} disabled={busy}>Approve</button>
                    <button className="ur-btn" onClick={() => void renderFinal(p.id)} disabled={busy}>Final 1080p</button>
                    <button className="ur-btn" onClick={() => void buildManifest(p.id)} disabled={busy}>Stock manifest</button>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={4}>No projects yet — create one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {job && (
        <div className="ur-section">
          <h2>Pipeline — {job.status}{job.currentStep ? ` (${job.currentStep})` : ""}</h2>
          <div className="ur-grid">
            {PIPELINE_STEPS.map((step) => {
              const match = job.steps.find((s) => s.step === step);
              return (
                <div key={step} className="ur-card">
                  <strong>{step}</strong> <span className={statusPill(match?.status ?? "PENDING")}>{match?.status ?? "PENDING"}</span>
                </div>
              );
            })}
          </div>
          {job.pauseReason && <p className="ur-message">{job.pauseReason}</p>}
        </div>
      )}

      {detail && (
        <div className="ur-section">
          <h2>Storyboard — {detail.project.title}</h2>
          <p>
            {detail.scenes.length} scenes · timeline {detail.timeline ? `${(detail.timeline.durationMs / 1000).toFixed(1)}s (${detail.timeline.timelineHash.slice(0, 10)})` : "not built"} · cost ${detail.costUsd.toFixed(2)}
            {detail.qa ? ` · QA ${detail.qa.passed ? "PASS" : "FAIL"}` : ""}
          </p>
          {detail.renderPath && <p>Preview render: <code>{detail.renderPath}</code></p>}
          <div className="ur-table-wrap">
            <table className="ur-table">
              <thead>
                <tr><th>#</th><th>Intent</th><th>Template</th><th>Visual</th><th>Secs</th><th>Locks</th><th>Inspector</th></tr>
              </thead>
              <tbody>
                {detail.scenes.map((s, i) => (
                  <tr key={s.id} style={s.disabled ? { opacity: 0.45 } : undefined}>
                    <td>{i + 1}</td>
                    <td>{s.intent}</td>
                    <td>{s.motionPlan.templateId || "—"}</td>
                    <td>{s.visualPlan.strategy} {generationPill(s.visualPlan.generationClass)}{s.visualPlan.resolvedAssetIds.length > 0 ? " ✓" : ""} v{s.visualPlan.generationVersion ?? 0}</td>
                    <td>{(s.durationMs / 1000).toFixed(1)}</td>
                    <td>{Object.entries(s.locks).filter(([, v]) => v).map(([k]) => `🔒${k}`).join(" ") || "—"}</td>
                    <td>
                      <button className="ur-btn" onClick={() => void sceneAction(detail.project.id, s.id, "regenerate")} disabled={busy || s.disabled}>Regen visual</button>
                      <button className="ur-btn" onClick={() => void sceneAction(detail.project.id, s.id, "voice")} disabled={busy || s.disabled}>Regen voice</button>
                      <button className="ur-btn" onClick={() => void sceneAction(detail.project.id, s.id, s.disabled ? "enable" : "disable")} disabled={busy}>{s.disabled ? "Enable" : "Disable"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.qa && !detail.qa.passed && (
            <div>
              <h3>QA failures</h3>
              {detail.qa.checks.filter((c) => !c.passed).map((c) => (
                <p key={`${c.category}/${c.name}`}>{c.category}/{c.name}: {c.detail}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ur-section">
        <h2>Batch Production (bounded concurrency 2)</h2>
        <textarea className="ur-search" rows={3} placeholder={"Topic,Script\nBitcoin basics,Bitcoin allows…\nSolar panels,Solar panels convert…"} value={batchCsv} onChange={(e) => setBatchCsv(e.target.value)} />
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => void runBatch()} disabled={busy}>Create + Run batch</button>
          <button className="ur-btn" onClick={() => void loadOps()} disabled={busy}>Refresh ops</button>
        </div>
      </div>

      {ops && (
        <div className="ur-section">
          <h2>Operations</h2>
          <div className="ur-table-wrap">
            <table className="ur-table">
              <thead><tr><th>Job</th><th>Kind</th><th>Status</th><th>Step</th></tr></thead>
              <tbody>
                {ops.jobs.map((j) => (
                  <tr key={j.id}><td>{j.id}</td><td>{j.kind}</td><td><span className={statusPill(j.status)}>{j.status}</span></td><td>{j.currentStep ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {ops.providerExecutions.length > 0 && (
            <div className="ur-grid">
              {ops.providerExecutions.map((e) => (
                <div key={`${e.provider}:${e.operation}:${e.status}`} className="ur-card">
                  <strong>{e.provider}/{e.operation}</strong> <span className={statusPill(e.status === "ok" ? "DONE" : "FAILED_RETRYABLE")}>{e.status}</span>
                  <p>{e.count} calls · avg {e.avgDurationMs}ms · retries {e.retries}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
