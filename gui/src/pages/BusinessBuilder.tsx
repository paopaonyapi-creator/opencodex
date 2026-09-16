// Phase 30.36 — Pao Business Builder dashboard: Opportunities, Import,
// Experiments, Capabilities, Audit (spec §20-§23, §36).

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface BusinessBuilderProps {
  apiBase?: string;
}

interface OpportunityRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  status: string;
  market: string;
  opportunityScore: number | null;
  paoFitScore: number | null;
  scoreConfidence: number | null;
  speedToCash: number;
  difficulty: string;
  complianceRisk: number;
  businessModel: string;
  deliveryModel: string;
  suggestedPrice: number | null;
  currency: string;
}

interface CapabilityRow {
  id: string;
  name: string;
  type: string;
  status: string;
  derivedFrom: string;
}

interface ExperimentRow {
  id: string;
  opportunityId: string;
  hypothesis: string;
  status: string;
  decision: string;
  decisionReasons: string[];
  metrics: Record<string, number>;
  conversion: Record<string, number | null>;
}

const STATUS_COLORS: Record<string, string> = {
  validated: "#35c07d", shortlisted: "#35c07d", available: "#35c07d", GREEN: "#35c07d", KEEP: "#35c07d",
  normalized: "#7aa2f7", imported: "#7aa2f7", in_experiment: "#7aa2f7", running: "#7aa2f7",
  YELLOW: "#e2b93b", ITERATE: "#e2b93b", PIVOT: "#e2b93b", PENDING: "#e2b93b", degraded: "#e2b93b",
  RED: "#e06c75", KILL: "#e06c75", archived: "#e06c75", unavailable: "#e06c75", blocked: "#e06c75",
};

function color(value: string | null | undefined): string {
  return STATUS_COLORS[value ?? ""] || "#8a93a6";
}

type TabKey = "opportunities" | "import" | "experiments" | "capabilities" | "audit";

export function BusinessBuilder({ apiBase = "" }: BusinessBuilderProps) {
  const [tab, setTab] = useState<TabKey>("opportunities");
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [audit, setAudit] = useState<Array<{ ts: string; actor: string; event: string; entity: string; entityId: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceDir, setSourceDir] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [o, c, e, a] = await Promise.all([
        api("/api/agent-os/business/opportunities"),
        api("/api/agent-os/business/capabilities"),
        api("/api/agent-os/business/experiments"),
        api("/api/agent-os/business/audit"),
      ]);
      setOpportunities(((o.data as { opportunities?: OpportunityRow[] })?.opportunities) ?? []);
      setCapabilities(((c.data as { capabilities?: CapabilityRow[] })?.capabilities) ?? []);
      setExperiments(((e.data as { experiments?: ExperimentRow[] })?.experiments) ?? []);
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

  const runImport = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/business/import/playbooks", {
        method: "POST",
        body: JSON.stringify({ dryRun, sourceDir: sourceDir || undefined, actor: "dashboard" }),
      });
      setImportResult((res.data as Record<string, unknown>) ?? null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, dryRun, sourceDir, refresh]);

  const opportunityAction = useCallback(async (opportunityId: string, action: "score" | "compile" | "codex-pack") => {
    setBusy(true);
    try {
      const res = await api(`/api/agent-os/business/opportunities/${action}`, {
        method: "POST",
        body: JSON.stringify({ opportunityId, actor: "dashboard" }),
      });
      const data = res.data as Record<string, unknown>;
      if (action === "score") setDetail({ kind: "score", ...data });
      else setDetail({ kind: action, blocked: (data.spec as { blocked?: boolean })?.blocked ?? false, outputDir: (data.spec as { outputDir?: string })?.outputDir ?? (data as { outputDir?: string }).outputDir, reasons: (data.spec as { blockReasons?: string[] })?.blockReasons ?? [] });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const evaluateExperiment = useCallback(async (experimentId: string) => {
    await api("/api/agent-os/business/experiments/evaluate", { method: "POST", body: JSON.stringify({ experimentId, actor: "dashboard" }) });
    await refresh();
  }, [api, refresh]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "opportunities", label: `Opportunities (${opportunities.length})` },
    { key: "import", label: "Import" },
    { key: "experiments", label: `Experiments (${experiments.length})` },
    { key: "capabilities", label: `Capabilities (${capabilities.length})` },
    { key: "audit", label: "Audit" },
  ];

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Business Builder</h1>
          <p className="ur-subtitle">Monetization intelligence: import playbooks, score opportunities, compile MVPs, validate revenue</p>
        </div>
        <div className="ur-actions">
          <button className="ur-btn" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
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

      {tab === "opportunities" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Opportunity Registry</h2>
          <table className="ur-table">
            <thead>
              <tr><th>Opportunity</th><th>Score</th><th>Pao Fit</th><th>Speed</th><th>Difficulty</th><th>Status</th><th>Price</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {opportunities.map((opportunity) => (
                <tr key={opportunity.id}>
                  <td>{opportunity.name}<div className="ur-meta">{opportunity.market || opportunity.slug}</div></td>
                  <td>{opportunity.opportunityScore !== null ? `${opportunity.opportunityScore}/100` : "—"}{opportunity.scoreConfidence !== null ? <div className="ur-meta">conf {opportunity.scoreConfidence}</div> : null}</td>
                  <td>{opportunity.paoFitScore !== null ? `${opportunity.paoFitScore}/100` : "—"}</td>
                  <td>{opportunity.speedToCash}</td>
                  <td>{opportunity.difficulty}</td>
                  <td style={{ color: color(opportunity.status) }}>{opportunity.status}</td>
                  <td>{opportunity.suggestedPrice !== null ? `${opportunity.suggestedPrice} ${opportunity.currency}` : "—"}</td>
                  <td className="ur-actions-cell">
                    <button className="ur-btn ur-btn-sm" onClick={() => { void opportunityAction(opportunity.id, "score"); }} disabled={busy}>Score</button>
                    <button className="ur-btn ur-btn-sm" onClick={() => { void opportunityAction(opportunity.id, "compile"); }} disabled={busy}>Compile MVP</button>
                    <button className="ur-btn ur-btn-sm ur-btn-primary" onClick={() => { void opportunityAction(opportunity.id, "codex-pack"); }} disabled={busy}>Codex Pack</button>
                  </td>
                </tr>
              ))}
              {opportunities.length === 0 && (<tr><td colSpan={8} className="ur-empty">No opportunities yet — import playbooks or create one manually.</td></tr>)}
            </tbody>
          </table>
          {detail && (
            <div className="ur-banner" style={{ borderColor: detail.kind === "score" ? "#7aa2f7" : (detail.blocked ? "#e06c75" : "#35c07d") }}>
              {detail.kind === "score"
                ? `Score ${(detail.score as { score?: number })?.score ?? "—"}/100 · Pao Fit ${detail.paoFit ?? "—"} · confidence ${(detail.score as { confidence?: number })?.confidence ?? "—"}`
                : `${detail.kind} ${detail.blocked ? "BLOCKED" : "OK"}${detail.outputDir ? ` → ${detail.outputDir}` : ""}${(detail.reasons as string[])?.length ? ` · ${(detail.reasons as string[]).join("; ")}` : ""}`}
            </div>
          )}
        </section>
      )}

      {tab === "import" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Import Playbooks (read-only external source)</h2>
          <p className="ur-meta">
            Point at a locally prepared clone directory. Imported content is treated as untrusted
            reference data: it is sanitized, structure-extracted, hash-stamped and provenance-tracked — never executed.
          </p>
          <label className="ur-field">
            <span>Source directory</span>
            <input className="ur-input" value={sourceDir} onChange={(e) => setSourceDir(e.target.value)} placeholder="(default configured BUSINESS_PLAYBOOKS_DIR)" />
          </label>
          <label className="ur-field ur-field-check">
            <span>Dry run</span>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          </label>
          <div className="ur-actions">
            <button className="ur-btn ur-btn-primary" onClick={() => { void runImport(); }} disabled={busy}>{dryRun ? "Dry run" : "Import"}</button>
          </div>
          {importResult && (
            <div className="ur-banner">
              files {String(importResult.filesSeen)} · created {String(importResult.created)} · updated {String(importResult.updated)} ·
              duplicates {String(importResult.skippedDuplicates)} · conflicts {String((importResult.conflicts as unknown[])?.length ?? 0)} · license {String(importResult.license)}
            </div>
          )}
        </section>
      )}

      {tab === "experiments" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Revenue Experiments</h2>
          <table className="ur-table">
            <thead>
              <tr><th>Experiment</th><th>Hypothesis</th><th>Status</th><th>Decision</th><th>Metrics</th><th></th></tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <tr key={experiment.id}>
                  <td className="ur-meta">{experiment.id}<div className="ur-meta">{experiment.opportunityId}</div></td>
                  <td>{experiment.hypothesis}</td>
                  <td style={{ color: color(experiment.status) }}>{experiment.status}</td>
                  <td style={{ color: color(experiment.decision) }}>{experiment.decision}</td>
                  <td className="ur-meta">
                    leads {experiment.metrics.leadsContacted ?? 0} · replies {experiment.metrics.replies ?? 0} · paid {experiment.metrics.paidCustomers ?? 0} · revenue {experiment.metrics.revenue ?? 0}
                  </td>
                  <td><button className="ur-btn ur-btn-sm" onClick={() => { void evaluateExperiment(experiment.id); }} disabled={busy}>Evaluate</button></td>
                </tr>
              ))}
              {experiments.length === 0 && (<tr><td colSpan={6} className="ur-empty">No experiments yet — create one from an opportunity (MCP: business_create_experiment).</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "capabilities" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Pao-hubPro Capability Registry (derived from live modules)</h2>
          <table className="ur-table">
            <thead><tr><th>Capability</th><th>Type</th><th>Status</th><th>Derived from</th></tr></thead>
            <tbody>
              {capabilities.map((capability) => (
                <tr key={capability.id}>
                  <td>{capability.name}<div className="ur-meta">{capability.id}</div></td>
                  <td>{capability.type}</td>
                  <td style={{ color: color(capability.status) }}>{capability.status}</td>
                  <td className="ur-meta">{capability.derivedFrom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "audit" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Business Audit Trail</h2>
          <table className="ur-table">
            <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Entity</th></tr></thead>
            <tbody>
              {audit.slice(0, 15).map((entry, index) => (
                <tr key={index}>
                  <td className="ur-meta">{new Date(entry.ts).toLocaleString()}</td>
                  <td className="ur-meta">{entry.actor}</td>
                  <td>{entry.event}</td>
                  <td className="ur-meta">{entry.entity}:{entry.entityId}</td>
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
