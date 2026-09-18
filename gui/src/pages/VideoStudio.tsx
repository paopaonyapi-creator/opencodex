// Phase 20.92 — AI Script-to-Video Studio dashboard page.
// Renders LIVE data from /api/agent-os/video-studio/* — no placeholder or demo
// data. Projects / Auto Build / pipeline progress views (Phase 20.92 §45).

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
  locks: Record<string, boolean>;
  visualPlan: { strategy: string; resolvedAssetIds: string[]; explanation: string };
  motionPlan: { templateId: string };
}

interface ProjectDetail {
  project: ProjectRow;
  scenes: SceneRow[];
  timeline: { durationMs: number; timelineHash: string } | null;
  qa: { passed: boolean; checks: Array<{ category: string; name: string; passed: boolean; detail: string }> } | null;
  renderPath: string | null;
  costUsd: number;
}

interface JobStatus {
  status: string;
  currentStep: string | null;
  steps: Array<{ step: string; status: string }>;
  pauseReason: string | null;
}

function statusPill(status: string): string {
  if (["DONE", "QA_PASSED", "RENDERED", "EXPORTED", "ASSETS_READY", "TIMELINE_READY"].includes(status)) return "ur-pill ok";
  if (["FAILED_RETRYABLE", "FAILED_BLOCKED", "CANCELLED", "DRAFT"].includes(status)) return "ur-pill bad";
  if (["WAITING_APPROVAL", "RUNNING", "PLANNED", "SCRIPTED", "RENDERING"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function VideoStudio({ apiBase = "" }: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects`);
      const body = (await res.json()) as { projects?: ProjectRow[] };
      setProjects(body.projects ?? []);
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

  const createProject = async () => {
    if (!title.trim() || !script.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/video-studio/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, script, aspectRatio, actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; project?: ProjectRow; error?: { message: string } };
      if (body.ok && body.project) {
        await load();
        setMessage(`Project '${body.project.title}' created — press AUTO BUILD to run the pipeline`);
      } else {
        setMessage(`Create failed: ${body.error?.message ?? "unknown"}`);
      }
    } catch {
      setMessage("Create failed");
    } finally {
      setBusy(false);
    }
  };

  const autoBuild = async (projectId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const start = await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/auto-build`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const startBody = (await start.json()) as { ok?: boolean; jobId?: string };
      if (!startBody.ok || !startBody.jobId) { setMessage("Auto build failed to start"); return; }
      let last = { job: { status: "QUEUED", currentStep: null as string | null }, done: false, paused: false, detail: undefined as string | undefined };
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${apiBase}/api/agent-os/video-studio/auto-build/${encodeURIComponent(startBody.jobId)}/step`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "dashboard_operator" }),
        });
        last = (await res.json()) as never;
        if (last.done || last.job.status.startsWith("FAILED")) break;
      }
      const status = await fetch(`${apiBase}/api/agent-os/video-studio/auto-build/${encodeURIComponent(startBody.jobId)}`);
      setJob((await status.json()) as JobStatus);
      await load();
      await loadDetail(projectId);
      setMessage(
        last.job.status === "WAITING_APPROVAL"
          ? "AUTO BUILD complete — project is WAITING FOR HUMAN REVIEW before final export (no auto-publish)"
          : `Auto build ended: ${last.job.status}${last.detail ? ` — ${last.detail}` : ""}`,
      );
    } catch {
      setMessage("Auto build failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (projectId: string) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/video-studio/projects/${encodeURIComponent(projectId)}/approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "DRAFT_VIDEO_APPROVAL", decide: true, approve: true, approver: "dashboard_operator" }),
      });
      await loadDetail(projectId);
      setMessage("DRAFT_VIDEO_APPROVAL granted — final render/export unlocked");
    } catch {
      setMessage("Approval failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="universal-registry">
      <div className="ur-header">
        <h1>Video Studio</h1>
        <p className="ur-subtitle">
          AI Script-to-Video — semantic segmentation, scene planning, asset ladder, deterministic timeline, ffmpeg preview — Phase 20.92.
        </p>
      </div>

      <div className="ur-section">
        <h2>New Project</h2>
        <div className="ur-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input className="ur-search" type="text" placeholder="Project title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            className="ur-search" rows={4}
            placeholder="Paste a script… (English or Thai — segmentation handles both)"
            value={script} onChange={(e) => setScript(e.target.value)}
          />
          <div className="ur-actions">
            <select className="ur-search" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} style={{ maxWidth: 140 }}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
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
              <tr><th>Title</th><th>Status</th><th>Format</th><th>Quality</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td><span className={statusPill(p.status)}>{p.status}</span></td>
                  <td>{p.aspectRatio}</td>
                  <td>{p.quality}</td>
                  <td>
                    <button className="ur-btn" onClick={() => void loadDetail(p.id)}>Inspect</button>
                    <button className="ur-btn" onClick={() => void autoBuild(p.id)} disabled={busy}>AUTO BUILD</button>
                    <button className="ur-btn" onClick={() => void approve(p.id)} disabled={busy}>Approve</button>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={5}>No projects yet — create one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {job && (
        <div className="ur-section">
          <h2>Pipeline — {job.status}{job.currentStep ? ` (${job.currentStep})` : ""}</h2>
          <div className="ur-grid">
            {job.steps.map((s) => (
              <div key={s.step} className="ur-card">
                <strong>{s.step}</strong> <span className={statusPill(s.status === "DONE" ? "DONE" : s.status)}>{s.status}</span>
              </div>
            ))}
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
                <tr><th>#</th><th>Intent</th><th>Template</th><th>Visual</th><th>Seconds</th><th>Locks</th></tr>
              </thead>
              <tbody>
                {detail.scenes.map((s, i) => (
                  <tr key={s.id}>
                    <td>{i + 1}</td>
                    <td>{s.intent}</td>
                    <td>{s.motionPlan.templateId || "—"}</td>
                    <td title={s.visualPlan.explanation}>{s.visualPlan.strategy}{s.visualPlan.resolvedAssetIds.length > 0 ? " ✓" : ""}</td>
                    <td>{(s.durationMs / 1000).toFixed(1)}</td>
                    <td>{Object.entries(s.locks).filter(([, v]) => v).map(([k]) => `🔒${k}`).join(" ") || "—"}</td>
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
    </div>
  );
}
