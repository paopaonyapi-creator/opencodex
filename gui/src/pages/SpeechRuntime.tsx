// Phase 20.32 — Pao-hubPro × VoiceStudio Local AI Speech Runtime
// Glassmorphic Control Dashboard (orchestration-focused; doc §28, §29).
// This is NOT the VoiceStudio UI — only Pao-hubPro's registry, policy and job controls.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface SpeechRuntimeProps {
  apiBase?: string;
}

interface HealthData {
  state: string;
  provider: string;
  versionDetected: string | null;
  versionPin: string;
  versionVerified: boolean;
  baseUrlOrigin: string;
  remoteMode: boolean;
  reasons: string[];
  queueDepth: number;
  flags: Record<string, boolean>;
}

interface VoiceRow {
  id: string;
  name: string;
  language: string | null;
  provider: string;
  origin: string;
  status: string;
  commercialUseStatus: string;
  consentStatus: string;
  licenseStatus: string;
  impersonatesPublicFigure: boolean;
  stockApprovedAt: string | null;
}

interface JobRow {
  id: string;
  projectId: string;
  type: string;
  status: string;
  progress: number;
  attempt: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputArtifactId: string | null;
  createdAt: string;
}

interface LicenseRow {
  id: string;
  provider: string;
  engine: string;
  modelId: string;
  status: string;
  commercialUse: boolean;
  stockUse: boolean;
  verifiedBy: string | null;
}

interface ConsentRow {
  id: string;
  voiceId: string | null;
  subjectAlias: string;
  consentBasis: string;
  voiceCloneAllowed: boolean;
  commercialUseAllowed: boolean;
  stockUseAllowed: boolean;
  revokedAt: string | null;
}

interface PolicyStatus {
  found: boolean;
  consent: string;
  license: string;
  commercial: string;
  stock: string;
  runtime: string;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "var(--ok, #35c07d)",
  completed: "var(--ok, #35c07d)",
  approved: "var(--ok, #35c07d)",
  active: "var(--ok, #35c07d)",
  allow: "var(--ok, #35c07d)",
  verified: "var(--ok, #35c07d)",
  degraded: "#e2b93b",
  version_mismatch: "#e2b93b",
  pending_review: "#e2b93b",
  review_required: "#e2b93b",
  unreviewed: "#e2b93b",
  warn: "#e2b93b",
  queued: "#7aa2f7",
  running: "#7aa2f7",
  preflight: "#7aa2f7",
  postprocessing: "#7aa2f7",
  policy_check: "#7aa2f7",
  unavailable: "#e06c75",
  blocked: "#e06c75",
  failed: "#e06c75",
  revoked: "#e06c75",
  misconfigured: "#e06c75",
  policy_blocked: "#e06c75",
  unknown: "#8a93a6",
};

function chip(value: string | null | undefined): string {
  const key = value ?? "unknown";
  return STATUS_COLORS[key] || "#8a93a6";
}

export function SpeechRuntime({ apiBase = "" }: SpeechRuntimeProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [voices, setVoices] = useState<VoiceRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Generate Speech form (doc §28.1)
  const [projectId, setProjectId] = useState("stock-demo");
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState("en");
  const [stockSafe, setStockSafe] = useState(true);
  const [policyStatus, setPolicyStatus] = useState<PolicyStatus | null>(null);
  const [lastJob, setLastJob] = useState<JobRow | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}/api/agent-os/speech${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [h, v, j, l, c] = await Promise.all([
        api("/health"),
        api("/voices"),
        api("/jobs"),
        api("/licenses"),
        api("/consents"),
      ]);
      setHealth((h.data as HealthData) ?? null);
      setVoices(((v.data as { voices?: VoiceRow[] })?.voices) ?? []);
      setJobs(((j.data as { jobs?: JobRow[] })?.jobs) ?? []);
      setLicenses(((l.data as { licenses?: LicenseRow[] })?.licenses) ?? []);
      setConsents(((c.data as { consents?: ConsentRow[] })?.consents) ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const checkPolicy = useCallback(async () => {
    if (!voiceId) return;
    const res = await api("/voices/policy-status", { method: "POST", body: JSON.stringify({ voiceId }) });
    setPolicyStatus((res.data as PolicyStatus) ?? null);
  }, [api, voiceId]);

  const generate = useCallback(async () => {
    if (!voiceId || !script.trim()) return;
    setBusy(true);
    try {
      const res = await api("/synthesize", {
        method: "POST",
        body: JSON.stringify({ projectId, text: script, voiceId, language, stockSafe, requestedBy: "dashboard" }),
      });
      setLastJob((res.data as { job?: JobRow })?.job ?? null);
      await refresh();
      await checkPolicy();
    } finally {
      setBusy(false);
    }
  }, [api, projectId, script, voiceId, language, stockSafe, refresh, checkPolicy]);

  const syncVoices = useCallback(async () => {
    setBusy(true);
    try {
      await api("/voices/sync", { method: "POST", body: JSON.stringify({ requestedBy: "dashboard" }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const approveStock = useCallback(async (id: string) => {
    await api("/voices/approve-stock", { method: "POST", body: JSON.stringify({ voiceId: id, actor: "dashboard", reason: "operator approved via dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const blockVoice = useCallback(async (id: string) => {
    await api("/voices/block", { method: "POST", body: JSON.stringify({ voiceId: id, actor: "dashboard", reason: "operator blocked via dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const reviewLicense = useCallback(async (id: string, status: string, commercialUse: boolean, stockUse: boolean) => {
    await api("/licenses/review", { method: "POST", body: JSON.stringify({ licenseId: id, status, commercialUse, stockUse, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const cancelJob = useCallback(async (id: string) => {
    await api("/jobs/cancel", { method: "POST", body: JSON.stringify({ jobId: id, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Speech Studio</h1>
          <p className="ur-subtitle">VoiceStudio runtime orchestration, voice governance and speech jobs</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
          <button className="ur-btn" onClick={() => { void syncVoices(); }} disabled={busy}>Sync provider voices</button>
        </div>
      </header>

      {error && <div className="ur-banner ur-banner-error">Dashboard error: {error}</div>}

      <section className="ur-grid ur-grid-4">
        <div className="ur-card">
          <div className="ur-card-label">Runtime</div>
          <div className="ur-card-value" style={{ color: chip(health?.state) }}>{health?.state ?? "…"}</div>
          <div className="ur-card-meta">{health?.provider ?? "—"} @ {health?.baseUrlOrigin ?? "—"}</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">Version</div>
          <div className="ur-card-value" style={{ color: health?.versionVerified ? "var(--ok, #35c07d)" : "#e2b93b" }}>
            {health?.versionDetected ?? "undetected"}
          </div>
          <div className="ur-card-meta">pin {health?.versionPin ?? "—"}{health?.remoteMode ? " · remote" : " · local"}</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">Queue</div>
          <div className="ur-card-value">{health?.queueDepth ?? 0}</div>
          <div className="ur-card-meta">active speech jobs</div>
        </div>
        <div className="ur-card">
          <div className="ur-card-label">Stock Safe Mode</div>
          <div className="ur-card-value" style={{ color: health?.flags?.ADOBE_STOCK_SAFE_MODE === false ? "#e2b93b" : "var(--ok, #35c07d)" }}>
            {health?.flags?.ADOBE_STOCK_SAFE_MODE === false ? "off" : "on"}
          </div>
          <div className="ur-card-meta">unknown licenses fail closed</div>
        </div>
      </section>

      {health && health.reasons.length > 0 && (
        <section className="ur-banner ur-banner-warn">
          {health.reasons.map((reason, index) => (<div key={index}>· {reason}</div>))}
        </section>
      )}

      <section className="ur-panel">
        <h2 className="ur-panel-title">Generate Speech</h2>
        <div className="ur-form-grid">
          <label className="ur-field">
            <span>Project</span>
            <input className="ur-input" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          </label>
          <label className="ur-field">
            <span>Language</span>
            <input className="ur-input" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </label>
          <label className="ur-field">
            <span>Voice</span>
            <select className="ur-input" value={voiceId} onChange={(e) => { setVoiceId(e.target.value); setPolicyStatus(null); }}>
              <option value="">— select a voice —</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name} · {voice.status}</option>
              ))}
            </select>
          </label>
          <label className="ur-field ur-field-check">
            <span>Adobe Stock Safe Mode</span>
            <input type="checkbox" checked={stockSafe} onChange={(e) => setStockSafe(e.target.checked)} />
          </label>
        </div>
        <label className="ur-field">
          <span>Script</span>
          <textarea className="ur-input ur-textarea" rows={4} value={script} onChange={(e) => setScript(e.target.value)} />
        </label>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void checkPolicy(); }} disabled={!voiceId || busy}>Check policy</button>
          <button className="ur-btn ur-btn-primary" onClick={() => { void generate(); }} disabled={!voiceId || !script.trim() || busy}>

            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
        {policyStatus && (
          <div className="ur-chip-row">
            <span className="ur-chip" style={{ borderColor: chip(policyStatus.consent) }}>Consent: {policyStatus.consent}</span>
            <span className="ur-chip" style={{ borderColor: chip(policyStatus.license) }}>License: {policyStatus.license}</span>
            <span className="ur-chip" style={{ borderColor: chip(policyStatus.commercial) }}>Commercial: {policyStatus.commercial}</span>
            <span className="ur-chip" style={{ borderColor: chip(policyStatus.stock) }}>Stock: {policyStatus.stock}</span>
            <span className="ur-chip" style={{ borderColor: chip(policyStatus.runtime) }}>Runtime: {policyStatus.runtime}</span>
          </div>
        )}
        {lastJob && (
          <div className="ur-banner" style={{ borderColor: chip(lastJob.status) }}>
            Job {lastJob.id} · {lastJob.status}
            {lastJob.errorCode ? ` · ${lastJob.errorCode}: ${lastJob.errorMessage}` : ""}
            {lastJob.outputArtifactId ? ` · artifact ${lastJob.outputArtifactId}` : ""}
          </div>
        )}
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Voice Registry</h2>
        <table className="ur-table">
          <thead>
            <tr>
              <th>Voice</th><th>Lang</th><th>Origin</th><th>Status</th><th>Consent</th><th>Commercial</th><th>Stock</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {voices.map((voice) => (
              <tr key={voice.id}>
                <td>{voice.name}<div className="ur-meta">{voice.id}</div></td>
                <td>{voice.language ?? "—"}</td>
                <td>{voice.origin}</td>
                <td style={{ color: chip(voice.status) }}>{voice.status}</td>
                <td style={{ color: chip(voice.consentStatus) }}>{voice.consentStatus}</td>
                <td style={{ color: chip(voice.commercialUseStatus) }}>{voice.commercialUseStatus}</td>
                <td style={{ color: chip(voice.stockApprovedAt ? "approved" : "unknown") }}>{voice.stockApprovedAt ? "approved" : "—"}</td>
                <td className="ur-actions-cell">
                  <button className="ur-btn ur-btn-sm" onClick={() => { void approveStock(voice.id); }} disabled={voice.consentStatus !== "verified"}>Approve stock</button>
                  <button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void blockVoice(voice.id); }} disabled={voice.status === "blocked"}>Block</button>
                </td>
              </tr>
            ))}
            {voices.length === 0 && (<tr><td colSpan={8} className="ur-empty">No voices yet — sync the provider registry.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Speech Jobs</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Job</th><th>Project</th><th>Type</th><th>Status</th><th>Attempt</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td className="ur-meta">{job.id}</td>
                <td>{job.projectId}</td>
                <td>{job.type}</td>
                <td style={{ color: chip(job.status) }}>
                  {job.status}{job.errorCode ? ` · ${job.errorCode}` : ""}
                  {job.errorMessage ? <div className="ur-meta">{job.errorMessage}</div> : null}
                </td>
                <td>{job.attempt}/{job.maxAttempts}</td>
                <td className="ur-meta">{new Date(job.createdAt).toLocaleString()}</td>
                <td>
                  {job.status === "queued" && (
                    <button className="ur-btn ur-btn-sm" onClick={() => { void cancelJob(job.id); }}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (<tr><td colSpan={7} className="ur-empty">No speech jobs yet.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Model Licenses (fail closed)</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Model</th><th>Status</th><th>Commercial</th><th>Stock</th><th>Verified by</th><th>Review</th></tr>
          </thead>
          <tbody>
            {licenses.map((license) => (
              <tr key={license.id}>
                <td>{license.provider}/{license.engine}/{license.modelId}</td>
                <td style={{ color: chip(license.status) }}>{license.status}</td>
                <td style={{ color: license.commercialUse ? "var(--ok, #35c07d)" : "#8a93a6" }}>{license.commercialUse ? "yes" : "no"}</td>
                <td style={{ color: license.stockUse ? "var(--ok, #35c07d)" : "#8a93a6" }}>{license.stockUse ? "yes" : "no"}</td>
                <td className="ur-meta">{license.verifiedBy ?? "—"}</td>
                <td className="ur-actions-cell">
                  <button className="ur-btn ur-btn-sm" onClick={() => { void reviewLicense(license.id, "approved", true, true); }}>Approve</button>
                  <button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void reviewLicense(license.id, "blocked", false, false); }}>Block</button>
                </td>
              </tr>
            ))}
            {licenses.length === 0 && (<tr><td colSpan={6} className="ur-empty">No license records — production speech stays blocked until a human registers and approves them.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Voice Consents</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Subject</th><th>Basis</th><th>Voice</th><th>Clone</th><th>Commercial</th><th>Stock</th><th>State</th></tr>
          </thead>
          <tbody>
            {consents.map((consent) => (
              <tr key={consent.id}>
                <td>{consent.subjectAlias}</td>
                <td className="ur-meta">{consent.consentBasis}</td>
                <td className="ur-meta">{consent.voiceId ?? "—"}</td>
                <td>{consent.voiceCloneAllowed ? "yes" : "no"}</td>
                <td>{consent.commercialUseAllowed ? "yes" : "no"}</td>
                <td>{consent.stockUseAllowed ? "yes" : "no"}</td>
                <td style={{ color: chip(consent.revokedAt ? "revoked" : "verified") }}>{consent.revokedAt ? "revoked" : "active"}</td>
              </tr>
            ))}
            {consents.length === 0 && (<tr><td colSpan={7} className="ur-empty">No consents registered — cloning is blocked until a human registers consent.</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
