import { useCallback, useEffect, useState } from "react";
import "../styles/social-intelligence.css";

/**
 * Phase 20.20 — Social Intelligence dashboard (spec section 26).
 *
 * Five sections: Overview, Tool Registry, Research Builder, Run History, Budget & Policy.
 *
 * Evidence honesty rules this page enforces:
 * - Every value comes from the live API. There is no demo/mock fallback data; a fetch
 *   failure renders an error state, not invented numbers.
 * - Unknown metrics render "Unknown", never a fake zero (spec 26.1).
 * - Spend columns keep Estimated and Actual separate; the provider often reports no
 *   actual cost, and that state stays visible.
 */

type Tab = "overview" | "tools" | "research" | "runs" | "policy";

interface SocialStatus {
  status: string;
  enabled: boolean;
  mockMode: boolean;
  providers: number;
  tools: { total: number; enabled: number; healthy: number; degraded: number; unproven: number };
  runsToday: number;
  successRateToday: number | null;
  usage: {
    daily: { estimatedUsd: number; actualUsd: number | null; runs: number };
    monthly: { estimatedUsd: number; actualUsd: number | null; runs: number };
    budgets: {
      dailyBudgetUsd: number;
      monthlyBudgetUsd: number;
      dailyRemainingUsd: number;
      monthlyRemainingUsd: number;
    };
  };
  policy: {
    defaultMaxJobUsd: number;
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    requireApprovalOverUsd: number;
    allowUnestimatedPaidRun: boolean;
    allowPaidAutoRun: boolean;
    maxProviderAttempts: number;
    maxItemsHardLimit: number;
  };
  recentJobs: Array<{ id: string; state: string; platform: string; query: string | null; createdAt: string }>;
}

interface SocialTool {
  id: string;
  providerId: string;
  name: string;
  title: string | null;
  description?: string | null;
  platform: string;
  capabilities: string[];
  enabled: boolean;
  pricingState: "free" | "paid" | "unknown";
  estimatedUnitCost: number | null;
  currency: string | null;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  lastSuccessAt: string | null;
  updatedAt: string;
}

interface RoutePreview {
  selectedToolId: string | null;
  selectedToolName: string | null;
  estimatedCostUsd: number | null;
  requiresApproval: boolean;
  budgetState: string | null;
  candidates: Array<{ toolId: string; score: number; reasons: string[]; risks: string[]; estimatedCostUsd: number | null }>;
  blockedReason: string | null;
}

interface ResearchJob {
  id: string;
  platform: string;
  query: string | null;
  state: string;
  maxCostUsd: number;
  estimatedCostUsd: number | null;
  fallbackHistory: Array<{ toolId: string; errorCode: string | null; note: string; at: string }>;
  resultSummary: Record<string, unknown>;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

const PLATFORMS = ["tiktok", "instagram", "youtube", "reddit", "x_twitter", "pinterest"] as const;
const CAPABILITIES = [
  "search_videos", "search_posts", "search_hashtags", "get_comments", "get_transcript",
  "get_trending", "get_engagement_metrics", "search_profiles",
] as const;

function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function observedReliability(tool: SocialTool): string {
  const completed = tool.successCount + tool.failureCount + tool.timeoutCount;
  if (completed === 0) return "Unproven";
  const rate = Math.round((tool.successCount / completed) * 100);
  return `${rate}% of ${completed}`;
}

function healthOf(tool: SocialTool): { label: string; className: string } {
  if (!tool.enabled) return { label: "Disabled", className: "health-disabled" };
  const completed = tool.successCount + tool.failureCount + tool.timeoutCount;
  if (completed === 0) return { label: "Unproven", className: "health-unproven" };
  const rate = tool.successCount / completed;
  if (rate >= 0.9) return { label: "Healthy", className: "health-healthy" };
  if (rate >= 0.6) return { label: "Degraded", className: "health-degraded" };
  return { label: "Unhealthy", className: "health-degraded" };
}

function pricingLabel(tool: SocialTool): string {
  if (tool.pricingState === "free") return "Free";
  if (tool.pricingState === "paid" && tool.estimatedUnitCost !== null) {
    return `Paid ${usd(tool.estimatedUnitCost)}/unit`;
  }
  return "Paid (unknown)";
}

export default function SocialIntelligence({ apiBase }: { apiBase: string }) {
  const base = apiBase || "";
  const [tab, setTab] = useState<Tab>("overview");

  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [tools, setTools] = useState<SocialTool[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("any");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);

  const [researchTopic, setResearchTopic] = useState("");
  const [researchPlatform, setResearchPlatform] = useState<string>("tiktok");
  const [researchCapability, setResearchCapability] = useState<string>("search_videos");
  const [maxItems, setMaxItems] = useState("20");
  const [maxCost, setMaxCost] = useState("0.10");
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runResult, setRunResult] = useState<ResearchJob | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);

  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    fetch(`${base}/api/social/status`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SocialStatus) => {
        setStatus(data);
        setStatusError(null);
      })
      .catch(() => setStatusError("Social Intelligence status is unavailable. Is the proxy running?"))
      .finally(() => setStatusLoading(false));
  }, [base]);

  const loadTools = useCallback(() => {
    const params = new URLSearchParams();
    if (platformFilter !== "any") params.set("platform", platformFilter);
    if (capabilityFilter) params.set("capability", capabilityFilter);
    fetch(`${base}/api/social/tools?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { tools: SocialTool[] }) => {
        setTools(data.tools ?? []);
        setToolsError(null);
      })
      .catch(() => setToolsError("Tool registry is unavailable."))
      .finally(() => setToolsLoading(false));
  }, [base, platformFilter, capabilityFilter]);

  const loadJobs = useCallback(() => {
    fetch(`${base}/api/social/research?limit=25`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { jobs: ResearchJob[] }) => {
        setJobs(data.jobs ?? []);
        setJobsError(null);
      })
      .catch(() => setJobsError("Run history is unavailable."))
  }, [base]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadTools(); }, [loadTools]);
  useEffect(() => { loadJobs(); }, [loadJobs]);

  const refreshRegistry = async () => {
    setRefreshing(true);
    setRefreshSummary(null);
    try {
      const res = await fetch(`${base}/api/social/registry/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "apify" }),
      });
      const data = await res.json();
      if (data?.refresh) {
        const r = data.refresh;
        setRefreshSummary(`Discovered ${r.discovered}, inserted ${r.inserted}, updated ${r.updated}, marked stale ${r.markedStale}.`);
        loadTools();
        loadStatus();
      } else {
        setRefreshSummary(data?.error?.message ?? "Refresh failed.");
      }
    } catch {
      setRefreshSummary("Refresh request failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleTool = async (tool: SocialTool) => {
    await fetch(`${base}/api/social/tools/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolId: tool.id, enabled: !tool.enabled }),
    });
    loadTools();
    loadStatus();
  };

  const previewTool = async (tool: SocialTool) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch(`${base}/api/social/route/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: tool.platform,
          capabilities: tool.capabilities.length > 0 ? tool.capabilities.slice(0, 2) : ["search_keyword"],
          maxItems: Number(maxItems) || 20,
          maxCostUsd: Number(maxCost) || 0.1,
        }),
      });
      setPreview(await res.json());
      setTab("research");
    } finally {
      setPreviewLoading(false);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    setRunResult(null);
    setApprovalPending(false);
    try {
      const res = await fetch(`${base}/api/social/route/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: researchPlatform,
          capabilities: [researchCapability],
          query: researchTopic || undefined,
          maxItems: Number(maxItems) || 20,
          maxCostUsd: Number(maxCost) || 0.1,
        }),
      });
      setPreview(await res.json());
    } catch {
      setPreview({ selectedToolId: null, selectedToolName: null, estimatedCostUsd: null, requiresApproval: false, budgetState: null, candidates: [], blockedReason: "Preview request failed." });
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeRun = async (approvalToken?: string) => {
    setRunBusy(true);
    try {
      const res = await fetch(`${base}/api/social/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: researchPlatform,
          capabilities: [researchCapability],
          query: researchTopic || undefined,
          maxItems: Number(maxItems) || 20,
          maxCostUsd: Number(maxCost) || 0.1,
          ...(approvalToken ? { approvalToken } : {}),
        }),
      });
      const data = await res.json();
      setRunResult(data ?? null);
      setApprovalPending(data?.state === "approval_required");
      loadStatus();
      loadJobs();
    } catch {
      setRunResult(null);
    } finally {
      setRunBusy(false);
    }
  };

  const grantApprovalAndRun = async () => {
    if (!runResult?.id) return;
    setRunBusy(true);
    try {
      const res = await fetch(`${base}/api/social/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", jobId: runResult.id, maxUsd: Number(maxCost) || 0.5 }),
      });
      const approval = await res.json();
      if (approval?.approvalToken) {
        await executeRun(approval.approvalToken);
      }
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className="social-container">
      <header className="social-header">
        <div>
          <h1>Social Intelligence</h1>
          <p className="social-subtitle">
            Provider-agnostic social research: registry, routing, budget guard, and evidence-backed
            Adobe Stock opportunity discovery.
          </p>
        </div>
        {status && (
          <div className="social-mode-badges">
            <span className={`badge ${status.enabled ? "badge-ok" : "badge-off"}`}>
              {status.enabled ? "Enabled" : "Disabled"}
            </span>
            <span className={`badge ${status.mockMode ? "badge-warn" : "badge-ok"}`}>
              {status.mockMode ? "Mock mode" : "Live providers"}
            </span>
          </div>
        )}
      </header>

      <nav className="social-tabs" role="tablist">
        {([["overview", "Overview"], ["tools", "Tool Registry"], ["research", "Research Builder"], ["runs", "Run History"], ["policy", "Budget & Policy"]] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`social-tab ${tab === id ? "social-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <section className="social-section" aria-label="Overview">
          {statusLoading && <p className="social-state">Loading status…</p>}
          {statusError && <p className="social-state social-state-error">{statusError} <button className="link-btn" onClick={loadStatus}>Retry</button></p>}
          {status && (
            <>
              <div className="social-metric-grid">
                <MetricCard label="Providers" value={String(status.providers)} sub="registered" />
                <MetricCard label="Registered Tools" value={String(status.tools.total)} sub={`${status.tools.enabled} enabled`} />
                <MetricCard label="Healthy / Degraded" value={`${status.tools.healthy} / ${status.tools.degraded}`} sub={`${status.tools.unproven} unproven (no runs yet)`} />
                <MetricCard label="Runs Today" value={String(status.runsToday)} sub="provider runs started" />
                <MetricCard
                  label="Observed Success Rate"
                  value={status.successRateToday === null ? "Unknown" : `${Math.round(status.successRateToday * 100)}%`}
                  sub={status.successRateToday === null ? "no completed runs today" : "internal observed, today"}
                />
                <MetricCard label="Estimated Spend Today" value={usd(status.usage.daily.estimatedUsd)} sub="ledger estimate" />
                <MetricCard label="Actual Spend Today" value={usd(status.usage.daily.actualUsd)} sub={status.usage.daily.actualUsd === null ? "provider not reporting" : "provider-reported"} />
                <MetricCard label="Daily Budget Remaining" value={usd(status.usage.budgets.dailyRemainingUsd)} sub={`of ${usd(status.usage.budgets.dailyBudgetUsd)}`} />
              </div>

              <div className="social-panel">
                <div className="social-panel-header">
                  <h2>Recent Research Jobs</h2>
                  <button className="btn-secondary" onClick={() => refreshRegistry()} disabled={refreshing}>
                    {refreshing ? "Refreshing registry…" : "Refresh registry"}
                  </button>
                </div>
                {refreshSummary && <p className="social-hint">{refreshSummary}</p>}
                {status.recentJobs.length === 0 ? (
                  <p className="social-state">No research jobs yet. Start one from the Research Builder.</p>
                ) : (
                  <table className="social-table">
                    <thead>
                      <tr><th>Job</th><th>Platform</th><th>Query</th><th>State</th><th>Created</th></tr>
                    </thead>
                    <tbody>
                      {status.recentJobs.map((job) => (
                        <tr key={job.id}>
                          <td className="mono">{job.id.slice(0, 18)}…</td>
                          <td>{job.platform}</td>
                          <td>{job.query ?? "—"}</td>
                          <td><StateBadge state={job.state} /></td>
                          <td>{new Date(job.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {tab === "tools" && (
        <section className="social-section" aria-label="Tool Registry">
          <div className="social-filters">
            <label>
              Platform
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                <option value="any">Any</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              Capability
              <select value={capabilityFilter} onChange={(e) => setCapabilityFilter(e.target.value)}>
                <option value="">Any</option>
                {CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button className="btn-secondary" onClick={() => refreshRegistry()} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh from provider"}
            </button>
          </div>
          {refreshSummary && <p className="social-hint">{refreshSummary}</p>}

          {toolsLoading && <p className="social-state">Loading tools…</p>}
          {toolsError && <p className="social-state social-state-error">{toolsError} <button className="link-btn" onClick={loadTools}>Retry</button></p>}
          {!toolsLoading && !toolsError && tools.length === 0 && (
            <p className="social-state">
              No tools match these filters. Refresh the registry from the provider to populate the catalog.
            </p>
          )}
          {tools.length > 0 && (
            <table className="social-table">
              <thead>
                <tr>
                  <th>Tool</th><th>Provider</th><th>Platform</th><th>Capabilities</th>
                  <th>Health</th><th>Observed Reliability</th><th>Cost</th><th>Last Success</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const health = healthOf(tool);
                  return (
                    <tr key={tool.id} className={tool.enabled ? "" : "row-disabled"}>
                      <td title={tool.description ?? undefined}>{tool.title ?? tool.name}</td>
                      <td>{tool.providerId}</td>
                      <td>{tool.platform}</td>
                      <td className="caps-cell">{tool.capabilities.slice(0, 3).join(", ")}{tool.capabilities.length > 3 ? ` +${tool.capabilities.length - 3}` : ""}</td>
                      <td><span className={`health-pill ${health.className}`}>{health.label}</span></td>
                      <td>{observedReliability(tool)}</td>
                      <td>{pricingLabel(tool)}</td>
                      <td>{tool.lastSuccessAt ? new Date(tool.lastSuccessAt).toLocaleDateString() : "Never"}</td>
                      <td className="actions-cell">
                        <button className="link-btn" onClick={() => void previewTool(tool)} disabled={previewLoading}>
                          Route preview
                        </button>
                        <button className="link-btn" onClick={() => void toggleTool(tool)}>
                          {tool.enabled ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "research" && (
        <section className="social-section" aria-label="Research Builder">
          <div className="social-panel">
            <h2>Define the research</h2>
            <div className="social-form-grid">
              <label>
                Topic / query
                <input
                  type="text"
                  value={researchTopic}
                  onChange={(e) => setResearchTopic(e.target.value)}
                  placeholder="e.g. smart farming"
                />
              </label>
              <label>
                Platform
                <select value={researchPlatform} onChange={(e) => setResearchPlatform(e.target.value)}>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label>
                Capability
                <select value={researchCapability} onChange={(e) => setResearchCapability(e.target.value)}>
                  {CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                Max items
                <input type="number" min={1} max={1000} value={maxItems} onChange={(e) => setMaxItems(e.target.value)} />
              </label>
              <label>
                Max spend (USD)
                <input type="number" min={0} step={0.01} value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
              </label>
            </div>
            <div className="social-form-actions">
              <button className="btn-secondary" onClick={() => void runPreview()} disabled={previewLoading}>
                {previewLoading ? "Previewing…" : "Route preview (free)"}
              </button>
              <button className="btn-primary" onClick={() => void executeRun()} disabled={runBusy || !preview || preview.blockedReason !== null}>
                {runBusy ? "Running…" : "Run research"}
              </button>
            </div>
            <p className="social-hint">
              The route preview is free and never starts a provider job. Run uses the same budget gates.
            </p>
          </div>

          {preview && (
            <div className="social-panel">
              <h2>Route preview</h2>
              {preview.blockedReason ? (
                <p className="social-state social-state-error">Blocked: {preview.blockedReason}</p>
              ) : (
                <>
                  <p>
                    Selected <strong>{preview.selectedToolName ?? preview.selectedToolId}</strong> ·{" "}
                    estimated {usd(preview.estimatedCostUsd)} ·{" "}
                    {preview.requiresApproval ? "requires approval before a paid run" : "no approval needed"} ·{" "}
                    budget state <code>{preview.budgetState ?? "n/a"}</code>
                  </p>
                  {preview.candidates.map((candidate, index) => (
                    <details key={candidate.toolId} className="social-candidate" open={index === 0}>
                      <summary>
                        Score {candidate.score}/100 · {usd(candidate.estimatedCostUsd)}
                      </summary>
                      <ul>
                        {candidate.reasons.map((reason) => <li key={reason} className="reason-item">+ {reason}</li>)}
                        {candidate.risks.map((risk) => <li key={risk} className="risk-item">− {risk}</li>)}
                      </ul>
                    </details>
                  ))}
                </>
              )}
            </div>
          )}

          {runResult && (
            <div className="social-panel">
              <h2>Run result</h2>
              <p>
                Job <span className="mono">{runResult.id}</span> · <StateBadge state={runResult.state} />
                {runResult.errorCode ? ` · ${runResult.errorCode}` : ""}
              </p>
              {approvalPending && (
                <div className="social-approval">
                  <p>
                    This job is parked for approval: the estimate exceeds policy or paid auto-run is disabled.
                    Approving here issues a single-use token bound to this job and the max spend above.
                  </p>
                  <button className="btn-primary" onClick={() => void grantApprovalAndRun()} disabled={runBusy}>
                    Approve up to ${maxCost} and run
                  </button>
                </div>
              )}
              {runResult.fallbackHistory.length > 0 && (
                <details className="social-candidate">
                  <summary>Fallback history ({runResult.fallbackHistory.length} entries)</summary>
                  <ul>
                    {runResult.fallbackHistory.map((entry, i) => (
                      <li key={i}>{new Date(entry.at).toLocaleTimeString()} — {entry.note} {entry.errorCode ? `(${entry.errorCode})` : ""}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "runs" && (
        <section className="social-section" aria-label="Run History">
          {jobsError && <p className="social-state social-state-error">{jobsError} <button className="link-btn" onClick={loadJobs}>Retry</button></p>}
          {!jobsError && jobs.length === 0 && <p className="social-state">No research jobs recorded yet.</p>}
          {jobs.length > 0 && (
            <table className="social-table">
              <thead>
                <tr>
                  <th>Job</th><th>Platform</th><th>Query</th><th>State</th>
                  <th>Estimated</th><th>Items</th><th>Fallbacks</th><th>Error</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const summary = job.resultSummary as { itemCount?: number; uniqueCount?: number };
                  return (
                    <tr key={job.id}>
                      <td className="mono">{job.id.slice(0, 18)}…</td>
                      <td>{job.platform}</td>
                      <td>{job.query ?? "—"}</td>
                      <td><StateBadge state={job.state} /></td>
                      <td>{usd(job.estimatedCostUsd)}</td>
                      <td>{summary.itemCount ?? (job.state === "completed" ? "0" : "—")}</td>
                      <td>{job.fallbackHistory.length}</td>
                      <td>{job.errorCode ?? "—"}</td>
                      <td>{new Date(job.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "policy" && status && (
        <section className="social-section" aria-label="Budget and Policy">
          <div className="social-panel">
            <h2>Budgets (enforced by the central Cost Guard)</h2>
            <table className="social-table">
              <thead><tr><th>Limit</th><th>Value</th><th>Spent (committed)</th><th>Remaining</th></tr></thead>
              <tbody>
                <tr>
                  <td>Per job (default)</td><td>{usd(status.policy.defaultMaxJobUsd)}</td>
                  <td>—</td><td>—</td>
                </tr>
                <tr>
                  <td>Daily</td><td>{usd(status.policy.dailyBudgetUsd)}</td>
                  <td>{usd(status.usage.daily.estimatedUsd)}</td>
                  <td>{usd(status.usage.budgets.dailyRemainingUsd)}</td>
                </tr>
                <tr>
                  <td>Monthly</td><td>{usd(status.policy.monthlyBudgetUsd)}</td>
                  <td>{usd(status.usage.monthly.estimatedUsd)}</td>
                  <td>{usd(status.usage.budgets.monthlyRemainingUsd)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="social-panel">
            <h2>Policy</h2>
            <table className="social-table">
              <thead><tr><th>Setting</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td>Approval required over</td><td>{usd(status.policy.requireApprovalOverUsd)}</td></tr>
                <tr><td>Paid auto-run</td><td>{status.policy.allowPaidAutoRun ? "allowed" : "disabled (default safe)"}</td></tr>
                <tr><td>Unknown-cost paid tools</td><td>{status.policy.allowUnestimatedPaidRun ? "may run" : "blocked (default safe)"}</td></tr>
                <tr><td>Max provider attempts per job</td><td>{status.policy.maxProviderAttempts}</td></tr>
                <tr><td>Max items hard limit</td><td>{status.policy.maxItemsHardLimit}</td></tr>
              </tbody>
            </table>
            <p className="social-hint">
              These values come from SOCIAL_* environment settings on the server and are read-only here.
              Provider tokens are server-side only and never exposed to this page.
            </p>
          </div>
        </section>
      )}

      {tab === "policy" && !status && (
        <section className="social-section">
          {statusLoading ? <p className="social-state">Loading policy…</p> : <p className="social-state social-state-error">{statusError}</p>}
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="social-metric-card">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const cls = state === "completed" || state === "approved" ? "state-ok"
    : state === "failed" ? "state-err"
    : state === "approval_required" ? "state-warn"
    : state === "budget_blocked" || state === "policy_blocked" ? "state-err"
    : "state-info";
  return <span className={`state-pill ${cls}`}>{state}</span>;
}
