// Phase 20.35 — Unified AI Runtime Control Plane dashboard: Router Playground
// (§48), provider health + circuit states (§47), context firewall inspector
// (§50), workspace grants, usage and audit.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface UnifiedRuntimeProps {
  apiBase?: string;
}

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  isLocal: boolean;
  capabilities: Record<string, unknown>;
  routing: { modes: Record<string, number> };
  health: { state: string; latencyMs: number; circuitState: string; checkedAt: string | null; message: string | null };
}

interface PreviewReason {
  providerId: string;
  score: number;
  included: boolean;
  reasons: string[];
}

interface PreviewData {
  mode: string;
  requirements: string[];
  selected: string | null;
  fallbacks: string[];
  candidates: PreviewReason[];
  excluded: PreviewReason[];
  policyDecisions: string[];
  executionClass: string;
  contextPreview: { dropped: Array<{ key: string; sensitivity: string; reason: string }>; redactions: number } | null;
}

interface UsageRow {
  providerId: string;
  requests: number;
  failures: number;
  avgMs: number;
  costUsd: number;
}

const STATE_COLORS: Record<string, string> = {
  healthy: "#35c07d", completed: "#35c07d", CLOSED: "#35c07d",
  degraded: "#e2b93b", HALF_OPEN: "#e2b93b", cooldown: "#e2b93b",
  offline: "#e06c75", OPEN: "#e06c75", auth_error: "#e06c75", rate_limited: "#e06c75", disabled: "#e06c75",
};

function color(value: string | null | undefined): string {
  return STATE_COLORS[value ?? ""] || "#8a93a6";
}

export function UnifiedRuntime({ apiBase = "" }: UnifiedRuntimeProps) {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [audit, setAudit] = useState<Array<{ ts: string; actor: string; event: string; risk: string; decision: string }>>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Router playground inputs (§48)
  const [prompt, setPrompt] = useState("Fix the failing tests in this repository");
  const [mode, setMode] = useState("");
  const [executionClass, setExecutionClass] = useState("provider_mode");
  const [workspaceId, setWorkspaceId] = useState("default");
  const [preferLocal, setPreferLocal] = useState(false);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [p, u, a] = await Promise.all([
        api("/api/agent-os/unified/providers"),
        api("/api/agent-os/unified/usage"),
        api("/api/agent-os/unified/audit"),
      ]);
      setProviders(((p.data as { providers?: ProviderRow[] })?.providers) ?? []);
      setUsage(((u.data as { summary?: UsageRow[] })?.summary) ?? []);
      setAudit(((a.data as { entries?: typeof audit })?.entries) ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const runPreview = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/unified/router/preview", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          ...(mode ? { mode } : {}),
          executionClass,
          workspaceId,
          preferLocal,
        }),
      });
      setPreview((res.data as PreviewData) ?? null);
    } finally {
      setBusy(false);
    }
  }, [api, prompt, mode, executionClass, workspaceId, preferLocal]);

  const runExecute = useCallback(async () => {
    setBusy(true);
    try {
      await api("/api/agent-os/unified/router/execute", {
        method: "POST",
        body: JSON.stringify({ prompt, ...(mode ? { mode } : {}), executionClass, workspaceId, preferLocal }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, prompt, mode, executionClass, workspaceId, preferLocal, refresh]);

  const testProvider = useCallback(async (providerId: string) => {
    await api("/api/agent-os/unified/providers/test", { method: "POST", body: JSON.stringify({ providerId, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Unified Runtime</h1>
          <p className="ur-subtitle">Local-first control plane: capability-aware routing, circuit breakers, context/secret firewalls</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
        </div>
      </header>

      {error && <div className="ur-banner ur-banner-error">Dashboard error: {error}</div>}

      <section className="ur-panel">
        <h2 className="ur-panel-title">Router Playground</h2>
        <label className="ur-field">
          <span>Prompt</span>
          <textarea className="ur-input ur-textarea" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <div className="ur-form-grid">
          <label className="ur-field">
            <span>Mode (blank = auto-detect)</span>
            <select className="ur-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">auto</option>
              <option value="general">general</option>
              <option value="coding">coding</option>
              <option value="research">research</option>
              <option value="review">review</option>
              <option value="image">image</option>
              <option value="automation">automation</option>
              <option value="private_local">private_local</option>
            </select>
          </label>
          <label className="ur-field">
            <span>Execution class</span>
            <select className="ur-input" value={executionClass} onChange={(e) => setExecutionClass(e.target.value)}>
              <option value="provider_mode">provider_mode</option>
              <option value="agent_mode">agent_mode</option>
            </select>
          </label>
          <label className="ur-field">
            <span>Workspace</span>
            <input className="ur-input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          </label>
          <label className="ur-field ur-field-check">
            <span>Prefer local</span>
            <input type="checkbox" checked={preferLocal} onChange={(e) => setPreferLocal(e.target.checked)} />
          </label>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void runPreview(); }} disabled={busy}>Preview route</button>
          <button className="ur-btn ur-btn-primary" onClick={() => { void runExecute(); }} disabled={busy}>Execute</button>
        </div>
        {preview && (
          <div className="ur-banner">
            Mode <strong>{preview.mode}</strong> · class {preview.executionClass} · selected{" "}
            <strong style={{ color: preview.selected ? "#35c07d" : "#e06c75" }}>{preview.selected ?? "none (blocked)"}</strong>
            {preview.fallbacks.length > 0 ? ` · fallbacks: ${preview.fallbacks.join(", ")}` : ""}
            {preview.contextPreview && preview.contextPreview.redactions > 0 ? ` · ${preview.contextPreview.redactions} context redaction(s)` : ""}
            <div className="ur-meta">requirements: {preview.requirements.join(", ")}</div>
            {preview.policyDecisions.map((decision, index) => (<div key={index} className="ur-meta">policy: {decision}</div>))}
          </div>
        )}
        {preview && (
          <table className="ur-table">
            <thead><tr><th>Provider</th><th>Included</th><th>Score</th><th>Reasons</th></tr></thead>
            <tbody>
              {[...preview.candidates, ...preview.excluded].map((entry) => (
                <tr key={entry.providerId}>
                  <td>{entry.providerId}</td>
                  <td style={{ color: entry.included ? "#35c07d" : "#e06c75" }}>{entry.included ? "yes" : "excluded"}</td>
                  <td>{entry.included ? entry.score.toFixed(1) : "—"}</td>
                  <td className="ur-meta">{entry.reasons.join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Providers</h2>
        <table className="ur-table">
          <thead>
            <tr><th>Provider</th><th>Type</th><th>Local</th><th>Health</th><th>Circuit</th><th>Latency</th><th>Modes</th><th></th></tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.name}<div className="ur-meta">{provider.id}{provider.enabled ? "" : " · disabled"}</div></td>
                <td>{provider.type}</td>
                <td>{provider.isLocal ? "local" : "cloud"}</td>
                <td style={{ color: color(provider.health.state) }}>{provider.health.state}{provider.health.message ? <div className="ur-meta">{provider.health.message}</div> : null}</td>
                <td style={{ color: color(provider.health.circuitState) }}>{provider.health.circuitState}</td>
                <td>{provider.health.latencyMs} ms</td>
                <td className="ur-meta">{Object.entries(provider.routing.modes).map(([key, value]) => `${key}:${value}`).join(", ") || "—"}</td>
                <td><button className="ur-btn ur-btn-sm" onClick={() => { void testProvider(provider.id); }} disabled={busy}>Test</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Usage</h2>
        <table className="ur-table">
          <thead><tr><th>Provider</th><th>Requests</th><th>Failures</th><th>Avg ms</th><th>Est. cost</th></tr></thead>
          <tbody>
            {usage.map((row) => (
              <tr key={row.providerId}>
                <td>{row.providerId}</td>
                <td>{row.requests}</td>
                <td>{row.failures}</td>
                <td>{Math.round(row.avgMs)}</td>
                <td>${row.costUsd.toFixed(4)}</td>
              </tr>
            ))}
            {usage.length === 0 && (<tr><td colSpan={5} className="ur-empty">No route executions yet — try the playground.</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="ur-panel">
        <h2 className="ur-panel-title">Audit</h2>
        <table className="ur-table">
          <thead><tr><th>Time</th><th>Event</th><th>Risk</th><th>Decision</th><th>Actor</th></tr></thead>
          <tbody>
            {audit.slice(0, 15).map((entry, index) => (
              <tr key={index}>
                <td className="ur-meta">{new Date(entry.ts).toLocaleString()}</td>
                <td>{entry.event}</td>
                <td>{entry.risk}</td>
                <td style={{ color: entry.decision === "allowed" ? "#35c07d" : "#e2b93b" }}>{entry.decision}</td>
                <td className="ur-meta">{entry.actor}</td>
              </tr>
            ))}
            {audit.length === 0 && (<tr><td colSpan={5} className="ur-empty">No audit entries yet.</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
