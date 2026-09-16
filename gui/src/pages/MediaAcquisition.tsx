// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Glassmorphic Control Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/media-acquisition.css";

interface MediaAcquisitionProps {
  apiBase?: string;
}

interface InspectData {
  title: string;
  provider: string;
  sourcePlatform: string;
  mediaType: string;
  durationSec?: number;
  formats?: Array<{ formatId: string; ext: string; resolution?: string }>;
  subtitles?: Array<{ language: string; ext: string }>;
}

interface MediaJobItem {
  id: string;
  provider: string;
  sourceUrl: string;
  status: string;
  preset: string;
  progressPercent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  outputArtifactId?: string;
  retryCount: number;
  usageClass: string;
  createdAt: string;
}

interface MediaArtifactItem {
  artifactId: string;
  jobId: string;
  type: string;
  sourcePlatform: string;
  title: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  usageClass: string;
  exportToStock: boolean;
  createdAt: string;
}

interface ProviderInfo {
  status: string;
  version?: string;
  latencyMs?: number;
  capabilities?: {
    supportsSubtitles?: boolean;
    supportsAudioExtraction?: boolean;
  };
}

interface MetricsSnapshot {
  jobsTotal: number;
  jobsRunning: number;
  jobsCompleted: number;
  jobsFailed: number;
  downloadBytesTotal: number;
  retryCount: number;
}

export function MediaAcquisition({ apiBase = "" }: MediaAcquisitionProps) {
  const [activeTab, setActiveTab] = useState<"acquire" | "queue" | "library" | "transcripts" | "providers" | "settings">("acquire");
  const [inputUrl, setInputUrl] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<"best" | "video" | "audio" | "reference" | "transcript">("best");
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectData | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<MediaJobItem[]>([]);
  const [artifacts, setArtifacts] = useState<MediaArtifactItem[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [resJobs, resArts, resHealth, resMetrics] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/media/jobs`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/media/artifacts`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/media/health`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/media/metrics`).then((r) => r.json()),
      ]);
      if (resJobs?.jobs) setJobs(resJobs.jobs);
      if (resArts?.artifacts) setArtifacts(resArts.artifacts);
      if (resHealth?.health) setProviders(resHealth.health);
      if (resMetrics?.metrics) setMetrics(resMetrics.metrics);
    } catch {
      // offline or preview mode
    }
  }, [apiBase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    const interval = setInterval(() => {
      void loadData();
    }, 4000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadData]);

  const handleInspect = async () => {
    if (!inputUrl.trim()) return;
    setInspecting(true);
    setInspectError(null);
    setInspectResult(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInspectError(data.error?.message || "Inspection failed.");
      } else {
        setInspectResult(data.result);
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setInspecting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!inputUrl.trim()) return;
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: inputUrl.trim(),
          preset: selectedPreset,
          usageClass: selectedPreset === "reference" ? "research_reference" : "internal_training",
        }),
      });
      if (res.ok) {
        setMessage("Job queued successfully!");
        setInputUrl("");
        setInspectResult(null);
        void loadData();
        setTimeout(() => setMessage(null), 3000);
      } else {
        const data = await res.json();
        setInspectError(data.error?.message || "Failed to enqueue job.");
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelJob = async (id: string) => {
    await fetch(`${apiBase}/api/agent-os/media/jobs/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void loadData();
  };

  const handleRetryJob = async (id: string) => {
    await fetch(`${apiBase}/api/agent-os/media/jobs/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void loadData();
  };

  return (
    <div className="media-page">
      <div className="media-header">
        <div className="media-title-group">
          <h1>Media Acquisition & Processing</h1>
          <p className="media-subtitle">
            Local-First OmniGet Engine • Process Isolation • Adobe Stock Research Boundary
          </p>
        </div>
        <div className="media-tab-bar">
          <button
            className={`media-tab-btn ${activeTab === "acquire" ? "active" : ""}`}
            onClick={() => setActiveTab("acquire")}
          >
            Acquire
          </button>
          <button
            className={`media-tab-btn ${activeTab === "queue" ? "active" : ""}`}
            onClick={() => setActiveTab("queue")}
          >
            Queue {jobs.length > 0 && <span className="media-badge">{jobs.length}</span>}
          </button>
          <button
            className={`media-tab-btn ${activeTab === "library" ? "active" : ""}`}
            onClick={() => { setActiveTab("library"); void loadData(); }}
          >
            Library {artifacts.length > 0 && <span className="media-badge">{artifacts.length}</span>}
          </button>
          <button
            className={`media-tab-btn ${activeTab === "providers" ? "active" : ""}`}
            onClick={() => { setActiveTab("providers"); void loadData(); }}
          >
            Providers
          </button>
          <button
            className={`media-tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </div>
      </div>

      {message && (
        <div style={{ padding: "0.75rem 1rem", background: "rgba(34,197,94,0.2)", border: "1px solid #22c55e", borderRadius: "0.5rem", color: "#86efac" }}>
          {message}
        </div>
      )}

      {/* 1. ACQUIRE TAB */}
      {activeTab === "acquire" && (
        <div className="media-glass-card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: "1rem" }}>Acquire Media from URL</h2>
          <div className="media-input-group">
            <input
              type="text"
              className="media-url-input"
              placeholder="Paste media URL (YouTube, Vimeo, X, TikTok, or direct web media)..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
            <button
              className="media-secondary-btn"
              onClick={handleInspect}
              disabled={inspecting || !inputUrl.trim()}
            >
              {inspecting ? "Inspecting..." : "Inspect URL"}
            </button>
            <button
              className="media-action-btn"
              onClick={handleEnqueue}
              disabled={!inputUrl.trim()}
            >
              Add to Queue
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
            <span className="media-label">Download Preset:</span>
            {(["best", "video", "audio", "reference", "transcript"] as const).map((p) => (
              <button
                key={p}
                className={`media-secondary-btn ${selectedPreset === p ? "active" : ""}`}
                style={selectedPreset === p ? { borderColor: "#38bdf8", color: "#38bdf8" } : {}}
                onClick={() => setSelectedPreset(p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          {inspectError && (
            <div style={{ padding: "0.75rem", background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: "0.5rem", color: "#fca5a5" }}>
              {inspectError}
            </div>
          )}

          {inspectResult && (
            <div className="media-inspect-result">
              <h3 style={{ margin: "0 0 0.5rem 0", color: "#38bdf8" }}>{inspectResult.title}</h3>
              <div className="media-inspect-grid">
                <div className="media-inspect-item">
                  <span className="media-label">Platform</span>
                  <span className="media-val">{inspectResult.sourcePlatform.toUpperCase()}</span>
                </div>
                <div className="media-inspect-item">
                  <span className="media-label">Media Type</span>
                  <span className="media-val">{inspectResult.mediaType}</span>
                </div>
                <div className="media-inspect-item">
                  <span className="media-label">Provider</span>
                  <span className="media-val">{inspectResult.provider}</span>
                </div>
                <div className="media-inspect-item">
                  <span className="media-label">Duration</span>
                  <span className="media-val">{inspectResult.durationSec ? `${Math.round(inspectResult.durationSec)}s` : "N/A"}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. QUEUE TAB */}
      {activeTab === "queue" && (
        <div className="media-glass-card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: "1rem" }}>Live Acquisition Queue</h2>
          {jobs.length === 0 ? (
            <p style={{ color: "#64748b" }}>No active or past jobs in queue.</p>
          ) : (
            <table className="media-table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Preset</th>
                  <th>Usage Class</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td><code>{job.id}</code></td>
                    <td style={{ maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job.sourceUrl}
                    </td>
                    <td>
                      <span className={`media-status-pill status-${job.status}`}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ width: "150px" }}>
                      <span>{Math.round(job.progressPercent)}%</span>
                      <div className="media-progress-track">
                        <div className="media-progress-bar" style={{ width: `${job.progressPercent}%` }} />
                      </div>
                    </td>
                    <td>{job.preset}</td>
                    <td>
                      <span className="media-tag-research">{job.usageClass}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        {job.status === "running" && (
                          <button className="media-secondary-btn" onClick={() => handleCancelJob(job.id)}>
                            Cancel
                          </button>
                        )}
                        {job.status === "failed" && (
                          <button className="media-secondary-btn" onClick={() => handleRetryJob(job.id)}>
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 3. LIBRARY TAB */}
      {activeTab === "library" && (
        <div className="media-glass-card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: "1rem" }}>Media Artifacts Registry</h2>
          {artifacts.length === 0 ? (
            <p style={{ color: "#64748b" }}>No media artifacts acquired yet.</p>
          ) : (
            <table className="media-table">
              <thead>
                <tr>
                  <th>Artifact ID</th>
                  <th>Title / File</th>
                  <th>Platform</th>
                  <th>SHA-256</th>
                  <th>Size</th>
                  <th>Adobe Stock Policy</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((art) => (
                  <tr key={art.artifactId}>
                    <td><code>{art.artifactId}</code></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{art.title}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{art.filename}</div>
                    </td>
                    <td>{art.sourcePlatform.toUpperCase()}</td>
                    <td>
                      <code style={{ fontSize: "0.75rem" }}>{art.sha256.slice(0, 12)}...</code>
                    </td>
                    <td>{art.sizeBytes ? `${(art.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : "N/A"}</td>
                    <td>
                      {art.exportToStock ? (
                        <span className="media-badge">Exportable</span>
                      ) : (
                        <span className="media-tag-stock-no">Reference Only (No Stock)</span>
                      )}
                    </td>
                    <td>{new Date(art.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 4. PROVIDERS TAB */}
      {activeTab === "providers" && (
        <div className="media-glass-card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: "1rem" }}>Acquisition Providers Health</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
            {Object.entries(providers).map(([name, info]) => (
              <div key={name} style={{ background: "rgba(15, 23, 42, 0.6)", padding: "1.25rem", borderRadius: "0.75rem", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: 0, textTransform: "uppercase" }}>{name}</h3>
                  <span className={`media-status-pill status-${info.status === "healthy" ? "completed" : "failed"}`}>
                    {info.status}
                  </span>
                </div>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <div>Version: <span style={{ color: "#e2e8f0" }}>{info.version || "N/A"}</span></div>
                  <div>Latency: <span style={{ color: "#e2e8f0" }}>{info.latencyMs ? `${info.latencyMs}ms` : "N/A"}</span></div>
                  <div>Subtitles: <span style={{ color: "#e2e8f0" }}>{info.capabilities?.supportsSubtitles ? "Yes" : "No"}</span></div>
                  <div>Audio Extract: <span style={{ color: "#e2e8f0" }}>{info.capabilities?.supportsAudioExtraction ? "Yes" : "No"}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. SETTINGS TAB */}
      {activeTab === "settings" && (
        <div className="media-glass-card">
          <h2 style={{ fontSize: "1.1rem", marginTop: 0, marginBottom: "1rem" }}>Media Acquisition Engine Settings</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: "600px" }}>
            {metrics && (
              <div style={{ background: "rgba(15, 23, 42, 0.6)", padding: "1rem", borderRadius: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ fontWeight: 600, color: "#38bdf8", marginBottom: "0.5rem" }}>Telemetry Snapshot</div>
                <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                  Total Jobs: {metrics.jobsTotal} | Running: {metrics.jobsRunning} | Completed: {metrics.jobsCompleted} | Retries: {metrics.retryCount}
                </div>
              </div>
            )}
            <div>
              <label className="media-label">Storage Root</label>
              <input type="text" className="media-url-input" readOnly value="./runtime/media" style={{ opacity: 0.8 }} />
            </div>
            <div>
              <label className="media-label">Max Global Concurrent Jobs</label>
              <input type="number" className="media-url-input" readOnly value={3} style={{ opacity: 0.8 }} />
            </div>
            <div>
              <label className="media-label">Authenticated Session Acquisition</label>
              <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: "0.25rem 0 0 0" }}>
                Disabled by default for security. Cookie ingestion and session tokens must be enabled via permission tier approval.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MediaAcquisition;
