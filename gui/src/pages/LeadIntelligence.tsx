// Phase 20.34 — Pao-hubPro × Lead Gen API Stack: Lead Intelligence Control
// Plane dashboard. Tabs: Search · Leads · Providers · Pipelines · Costs ·
// Suppression · Audit (spec §32). Cost preview shows before Run (§32.1).

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface LeadIntelligenceProps {
  apiBase?: string;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  strategy: string;
  estimatedCost: number;
  actualCost: number;
  currency: string;
  errorCode: string | null;
  errorMessage: string | null;
  result: { discovered?: number; merged?: number; leadIds?: string[] } | null;
  createdAt: string;
}

interface LeadRow {
  id: string;
  kind: string;
  status: string;
  confidence: number;
  company: { canonicalName: string; domain?: string; region?: string; industry?: string } | null;
  person: { fullName: string; jobTitle?: string } | null;
  score: { total: number; grade: string } | null;
}

interface ProviderRow {
  id: string;
  name: string;
  adapter: string;
  enabled: boolean;
  capabilities: string[];
  pricingModel: string;
  estimatedCostPer1000: number;
  health: { status?: string; message?: string } | null;
}

interface PipelineRow {
  id: string;
  name: string;
  enabled: boolean;
}

interface RunRow {
  id: string;
  pipelineId: string;
  status: string;
  actualCost: number;
  errorCode: string | null;
  createdAt: string;
}

interface SuppressionRow {
  id: string;
  matchType: string;
  matchValue: string;
  reason: string;
  createdAt: string;
}

interface EstimateData {
  estimatedCost: number;
  currency: string;
  providers: Array<{ providerId: string; score: number; estimate: { estimatedCost: number } }>;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#35c07d", healthy: "#35c07d", verified: "#35c07d", qualified: "#35c07d", active: "#35c07d",
  queued: "#7aa2f7", running: "#7aa2f7", normalized: "#7aa2f7", enriched: "#7aa2f7",
  waiting_approval: "#e2b93b", degraded: "#e2b93b", unknown: "#8a93a6", raw: "#8a93a6",
  blocked: "#e06c75", failed: "#e06c75", suppressed: "#e06c75", disabled: "#e06c75", down: "#e06c75",
};

function chipColor(value: string | null | undefined): string {
  return STATUS_COLORS[value ?? "unknown"] || "#8a93a6";
}

type TabKey = "search" | "leads" | "providers" | "pipelines" | "costs" | "suppression" | "audit";

export function LeadIntelligence({ apiBase = "" }: LeadIntelligenceProps) {
  const [tab, setTab] = useState<TabKey>("search");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search form (§32.1)
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("Maha Sarakham");
  const [industry, setIndustry] = useState("solar installer");
  const [leadKind, setLeadKind] = useState("local_business");
  const [limit, setLimit] = useState(10);
  const [maxJobCost, setMaxJobCost] = useState(2);
  const [strategy, setStrategy] = useState("BALANCED");
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [lastJob, setLastJob] = useState<JobRow | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [costs, setCosts] = useState<Array<{ providerId: string; estimated: number; actual: number; currency: string; calls: number }>>([]);
  const [suppression, setSuppression] = useState<SuppressionRow[]>([]);
  const [audit, setAudit] = useState<Array<{ ts: string; actorId: string; action: string; resourceType: string; resourceId: string }>>([]);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [j, l, p, pl, c, s, a] = await Promise.all([
        api("/api/agent-os/leads/jobs"),
        api("/api/agent-os/leads"),
        api("/api/agent-os/leads/providers"),
        api("/api/agent-os/leads/pipelines"),
        api("/api/agent-os/leads/costs"),
        api("/api/agent-os/leads/suppression"),
        api("/api/agent-os/leads/audit"),
      ]);
      setJobs(((j.data as { jobs?: JobRow[] })?.jobs) ?? []);
      setLeads(((l.data as { leads?: LeadRow[] })?.leads) ?? []);
      setProviders(((p.data as { providers?: ProviderRow[] })?.providers) ?? []);
      setPipelines(((pl.data as { pipelines?: PipelineRow[] })?.pipelines) ?? []);
      setRuns(((pl.data as { runs?: RunRow[] })?.runs) ?? []);
      setCosts(((c.data as { summary?: typeof costs })?.summary) ?? []);
      setSuppression(((s.data as { entries?: SuppressionRow[] })?.entries) ?? []);
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

  const previewCost = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/leads/cost-estimate", {
        method: "POST",
        body: JSON.stringify({ query: { query, region, industryKeywords: [industry], leadKind, limit }, strategy }),
      });
      setEstimate((res.data as EstimateData) ?? null);
    } finally {
      setBusy(false);
    }
  }, [api, query, region, industry, leadKind, limit, strategy]);

  const runSearch = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/leads/search", {
        method: "POST",
        body: JSON.stringify({
          query: { query, region, industryKeywords: [industry], leadKind, limit },
          strategy,
          budget: { maxJobCost },
          actor: "dashboard",
        }),
      });
      setLastJob(((res.data as { job?: JobRow })?.job) ?? null);
      await refresh();
      setTab("leads");
    } finally {
      setBusy(false);
    }
  }, [api, query, region, industry, leadKind, limit, strategy, maxJobCost, refresh]);

  const leadAction = useCallback(async (leadId: string, action: "enrich" | "verify") => {
    setBusy(true);
    try {
      await api(`/api/agent-os/leads/${action}`, { method: "POST", body: JSON.stringify({ leadId, actor: "dashboard" }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const runPipeline = useCallback(async (pipelineId: string) => {
    setBusy(true);
    try {
      await api("/api/agent-os/leads/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipelineId, request: { query, region, industryKeywords: [industry], limit }, actor: "dashboard" }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, query, region, industry, limit, refresh]);

  const exportLeads = useCallback(async (format: "csv" | "json") => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/leads/exports", { method: "POST", body: JSON.stringify({ format, actor: "dashboard" }) });
      const data = res.data as { content?: string };
      if (data?.content) window.prompt(`Export (${format}) — select all and copy:`, data.content);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const addSuppression = useCallback(async (matchValue: string) => {
    if (!matchValue.trim()) return;
    await api("/api/agent-os/leads/suppression", {
      method: "POST",
      body: JSON.stringify({ matchType: "domain", matchValue, reason: "manual_block", actor: "dashboard" }),
    });
    await refresh();
  }, [api, refresh]);

  const removeSuppression = useCallback(async (entryId: string) => {
    await api("/api/agent-os/leads/suppression/remove", { method: "POST", body: JSON.stringify({ entryId, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "search", label: "Search" },
    { key: "leads", label: `Leads (${leads.length})` },
    { key: "providers", label: "Providers" },
    { key: "pipelines", label: "Pipelines" },
    { key: "costs", label: "Costs" },
    { key: "suppression", label: `Suppression (${suppression.length})` },
    { key: "audit", label: "Audit" },
  ];

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Lead Intelligence</h1>
          <p className="ur-subtitle">Multi-provider B2B discovery, enrichment, verification and scoring — governed, budgeted, audited</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
          <button className="ur-btn" onClick={() => { void exportLeads("csv"); }} disabled={busy}>Export CSV</button>
          <button className="ur-btn" onClick={() => { void exportLeads("json"); }} disabled={busy}>Export JSON</button>
        </div>
      </header>

      {error && <div className="ur-banner ur-banner-error">Dashboard error: {error}</div>}

      <div className="ur-chip-row">
        {tabs.map((entry) => (
          <button key={entry.key} className="ur-chip" style={{ borderColor: tab === entry.key ? "#7aa2f7" : "rgba(255,255,255,0.2)" }} onClick={() => setTab(entry.key)}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Search</h2>
          <div className="ur-form-grid">
            <label className="ur-field"><span>Query</span>
              <input className="ur-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="solar installer" />
            </label>
            <label className="ur-field"><span>Region</span>
              <input className="ur-input" value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
            <label className="ur-field"><span>Industry keyword</span>
              <input className="ur-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </label>
            <label className="ur-field"><span>Lead type</span>
              <select className="ur-input" value={leadKind} onChange={(e) => setLeadKind(e.target.value)}>
                <option value="local_business">local_business</option>
                <option value="company">company</option>
                <option value="person">person</option>
              </select>
            </label>
            <label className="ur-field"><span>Limit</span>
              <input className="ur-input" type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 10)} />
            </label>
            <label className="ur-field"><span>Strategy</span>
              <select className="ur-input" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                <option>BALANCED</option><option>CHEAPEST</option><option>BEST_QUALITY</option><option>FASTEST</option><option>MANUAL</option>
              </select>
            </label>
            <label className="ur-field"><span>Max job cost (USD)</span>
              <input className="ur-input" type="number" min={0.1} step={0.5} value={maxJobCost} onChange={(e) => setMaxJobCost(Number(e.target.value) || 2)} />
            </label>
          </div>
          <div className="ur-actions">
            <button className="ur-btn" onClick={() => { void previewCost(); }} disabled={busy}>Estimate cost</button>
            <button className="ur-btn ur-btn-primary" onClick={() => { void runSearch(); }} disabled={busy || !query.trim()}>Run search</button>
          </div>
          {estimate && (
            <div className="ur-banner">
              Estimated {estimate.estimatedCost.toFixed(4)} {estimate.currency} across {estimate.providers.length} provider(s):
              {estimate.providers.map((entry) => ` ${entry.providerId} (${entry.estimate.estimatedCost.toFixed(4)})`).join(",")}
            </div>
          )}
          {lastJob && (
            <div className="ur-banner" style={{ borderColor: chipColor(lastJob.status) }}>
              Job {lastJob.id} · {lastJob.status}{lastJob.errorCode ? ` · ${lastJob.errorCode}: ${lastJob.errorMessage}` : ""}
              {lastJob.result ? ` · discovered ${lastJob.result.discovered ?? 0}, merged ${lastJob.result.merged ?? 0}` : ""}
            </div>
          )}
          <h2 className="ur-panel-title">Recent Jobs</h2>
          <table className="ur-table">
            <thead>
              <tr><th>Job</th><th>Type</th><th>Status</th><th>Est / Actual</th><th>Created</th></tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map((job) => (
                <tr key={job.id}>
                  <td className="ur-meta">{job.id}</td>
                  <td>{job.type}</td>
                  <td style={{ color: chipColor(job.status) }}>{job.status}{job.errorCode ? ` · ${job.errorCode}` : ""}</td>
                  <td>{job.estimatedCost.toFixed(4)} / {job.actualCost.toFixed(4)} {job.currency}</td>
                  <td className="ur-meta">{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {jobs.length === 0 && (<tr><td colSpan={5} className="ur-empty">No jobs yet.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "leads" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Leads</h2>
          <table className="ur-table">
            <thead>
              <tr><th>Score</th><th>Company / Person</th><th>Title</th><th>Region</th><th>Status</th><th>Confidence</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ color: lead.score?.grade === "A" ? "#35c07d" : "#8a93a6" }}>{lead.score ? `${lead.score.total} (${lead.score.grade})` : "—"}</td>
                  <td>{lead.company?.canonicalName ?? lead.person?.fullName}<div className="ur-meta">{lead.company?.domain ?? lead.id}</div></td>
                  <td>{lead.person?.jobTitle ?? "—"}</td>
                  <td>{lead.company?.region ?? "—"}</td>
                  <td style={{ color: chipColor(lead.status) }}>{lead.status}</td>
                  <td>{lead.confidence.toFixed(2)}</td>
                  <td className="ur-actions-cell">
                    <button className="ur-btn ur-btn-sm" onClick={() => { void leadAction(lead.id, "enrich"); }} disabled={busy}>Enrich</button>
                    <button className="ur-btn ur-btn-sm" onClick={() => { void leadAction(lead.id, "verify"); }} disabled={busy}>Verify</button>
                    <button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void addSuppression(lead.company?.domain ?? lead.id); }} disabled={busy || !lead.company?.domain}>Suppress</button>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (<tr><td colSpan={7} className="ur-empty">No leads yet — run a search.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "providers" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Providers</h2>
          <table className="ur-table">
            <thead>
              <tr><th>Provider</th><th>Adapter</th><th>Capabilities</th><th>Pricing</th><th>Health</th></tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}<div className="ur-meta">{provider.id}{provider.enabled ? "" : " · disabled"}</div></td>
                  <td>{provider.adapter}</td>
                  <td className="ur-meta">{provider.capabilities.join(", ")}</td>
                  <td>{provider.pricingModel} · {provider.estimatedCostPer1000}/1k</td>
                  <td style={{ color: chipColor(provider.health?.status) }}>{provider.health?.status ?? "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "pipelines" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Pipelines</h2>
          <table className="ur-table">
            <thead><tr><th>Pipeline</th><th>Actions</th></tr></thead>
            <tbody>
              {pipelines.map((pipeline) => (
                <tr key={pipeline.id}>
                  <td>{pipeline.name}<div className="ur-meta">{pipeline.id}</div></td>
                  <td><button className="ur-btn ur-btn-sm" onClick={() => { void runPipeline(pipeline.id); }} disabled={busy}>Run</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="ur-panel-title">Recent Runs</h2>
          <table className="ur-table">
            <thead><tr><th>Run</th><th>Pipeline</th><th>Status</th><th>Cost</th><th>Created</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="ur-meta">{run.id}</td>
                  <td>{run.pipelineId}</td>
                  <td style={{ color: chipColor(run.status) }}>{run.status}{run.errorCode ? ` · ${run.errorCode}` : ""}</td>
                  <td>{run.actualCost.toFixed(4)}</td>
                  <td className="ur-meta">{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {runs.length === 0 && (<tr><td colSpan={5} className="ur-empty">No pipeline runs yet.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "costs" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Provider Spend (estimated vs actual)</h2>
          <table className="ur-table">
            <thead><tr><th>Provider</th><th>Calls</th><th>Estimated</th><th>Actual</th><th>Currency</th></tr></thead>
            <tbody>
              {costs.map((entry) => (
                <tr key={entry.providerId}>
                  <td>{entry.providerId}</td>
                  <td>{entry.calls}</td>
                  <td>{entry.estimated.toFixed(4)}</td>
                  <td>{entry.actual.toFixed(4)}</td>
                  <td>{entry.currency}</td>
                </tr>
              ))}
              {costs.length === 0 && (<tr><td colSpan={5} className="ur-empty">No provider spend recorded yet.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "suppression" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Suppression List</h2>
          <table className="ur-table">
            <thead><tr><th>Type</th><th>Value</th><th>Reason</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {suppression.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.matchType}</td>
                  <td className="ur-meta">{entry.matchValue}</td>
                  <td>{entry.reason}</td>
                  <td className="ur-meta">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td><button className="ur-btn ur-btn-sm ur-btn-danger" onClick={() => { void removeSuppression(entry.id); }} disabled={busy}>Remove</button></td>
                </tr>
              ))}
              {suppression.length === 0 && (<tr><td colSpan={5} className="ur-empty">No suppression entries — exports and outreach gate on this list.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "audit" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Audit Trail</h2>
          <table className="ur-table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead>
            <tbody>
              {audit.map((entry, index) => (
                <tr key={index}>
                  <td className="ur-meta">{new Date(entry.ts).toLocaleString()}</td>
                  <td className="ur-meta">{entry.actorId}</td>
                  <td>{entry.action}</td>
                  <td className="ur-meta">{entry.resourceType}:{entry.resourceId}</td>
                </tr>
              ))}
              {audit.length === 0 && (<tr><td colSpan={4} className="ur-empty">No audit entries yet.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
