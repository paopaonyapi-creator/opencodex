/**
 * Pao SEO Agent OS dashboard (Phase 18): provider health, projects, baseline
 * analysis runs, and the recommendation inbox. Read-only plus explicitly
 * user-triggered actions — the panel never mutates a website.
 */
import { useEffect, useState } from "react";
import { useT } from "../i18n/shared";

interface SeoHealth {
  provider: string;
  status: string;
  activeMode: string;
  latencyMs: number | null;
  capabilities: string[];
  security?: { status?: string; publicNoAuthDetected?: boolean; reason?: string };
}

interface SeoProject {
  id: string;
  domain: string;
  displayName?: string;
  policy?: { allowResearch?: boolean };
}

interface SeoRecommendation {
  id: string;
  title: string;
  detail: string;
  impact: string;
  effort: string;
  status: string;
  requiresApproval: boolean;
}

interface GeoAuditResult {
  runId: string;
  heuristicscore: number;
  verificationSummary: { verified: number; unverified: number; conflict: number; suppressed: number };
  findings: Array<{ title: string; verification: string; basis: string; impact: string; detail: string }>;
  crawlerPolicy: Array<{ crawlerId: string; displayName: string; category: string; access: string; evidenceLines: string[] }>;
  llmsTxt: { state: string; url: string; issues: string[] };
  schema: { blocksFound: number; families: string[] };
  citability: { overallScore: number; strongCount: number; weakCount: number; topIssues: string[] } | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

export default function PaoSeo({ apiBase }: { apiBase: string }) {
  const t = useT();
  const [health, setHealth] = useState<SeoHealth | null>(null);
  const [healthState, setHealthState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<SeoProject[]>([]);
  const [projectsState, setProjectsState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<SeoRecommendation[]>([]);
  const [recsState, setRecsState] = useState<LoadState>("idle");
  const [analyzing, setAnalyzing] = useState(false);
  const [geoAudit, setGeoAudit] = useState<GeoAuditResult | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formDomain, setFormDomain] = useState("");
  const [formName, setFormName] = useState("");
  const [formSeeds, setFormSeeds] = useState("");
  const [creating, setCreating] = useState(false);

  const loadHealth = async (signal: AbortSignal) => {
    setHealthState("loading");
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/provider/health`, { signal });
      if (!res.ok) throw new Error(String(res.status));
      setHealth(await res.json());
      setHealthState("ready");
    } catch {
      setHealthState("error");
    }
  };

  const loadProjects = async (signal: AbortSignal) => {
    setProjectsState("loading");
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/projects`, { signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { projects: SeoProject[] };
      setProjects(data.projects ?? []);
      setProjectsState("ready");
    } catch {
      setProjectsState("error");
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadHealth(controller.signal);
    void loadProjects(controller.signal);
    return () => controller.abort();
    // oxlint-disable-next-line react/react-compiler -- mount-only bootstrap
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiBase is stable per mount
  }, [apiBase]);

  const selectProject = async (id: string) => {
    setSelected(id);
    setRecsState("loading");
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/projects/${encodeURIComponent(id)}/recommendations`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { recommendations: SeoRecommendation[] };
      setRecommendations(data.recommendations ?? []);
      setRecsState("ready");
    } catch {
      setRecsState("error");
    }
  };

  const runAnalysis = async () => {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/projects/${encodeURIComponent(selected)}/analyze`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { code?: string } } | null;
        setError(body?.error?.code ?? String(res.status));
        return;
      }
      await selectProject(selected);
    } catch {
      setError("network");
    } finally {
      setAnalyzing(false);
    }
  };

  const runGeoAuditAction = async () => {
    if (!selected || geoBusy) return;
    setGeoBusy(true);
    setGeoError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/geo/projects/${encodeURIComponent(selected)}/audit`, { method: "POST" });
      if (!res.ok) {
        setGeoError(String(res.status));
        return;
      }
      setGeoAudit(await res.json());
    } catch {
      setGeoError("network");
    } finally {
      setGeoBusy(false);
    }
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formDomain.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/seo/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: formDomain.trim(),
          ...(formName.trim() ? { displayName: formName.trim() } : {}),
          ...(formSeeds.trim() ? { seedKeywords: formSeeds.split(",").map(s => s.trim()).filter(Boolean) } : {}),
        }),
      });
      if (!res.ok) {
        setError(String(res.status));
        return;
      }
      setFormDomain("");
      setFormName("");
      setFormSeeds("");
      const controller = new AbortController();
      await loadProjects(controller.signal);
    } finally {
      setCreating(false);
    }
  };

  const setRecStatus = async (id: string, status: "approved" | "dismissed" | "open") => {
    await fetch(`${apiBase}/api/agent-os/seo/recommendations/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (selected) await selectProject(selected);
  };

  const statusTone = (status: string) =>
    status === "healthy" ? "seo-status--ok" : status === "degraded" ? "seo-status--warn" : "seo-status--err";

  return (
    <div className="page-head-wrap">
      <div className="page-head">
        <h2>{t("seo.title")}</h2>
      </div>
      <div className="seo-page">
        <section className="seo-card">
          <h3>{t("seo.providerHealth")}</h3>
          {healthState === "loading" && <p className="muted">{t("common.loading")}</p>}
          {healthState === "error" && <p className="seo-err">{t("seo.loadFailed")}</p>}
          {healthState === "ready" && health && (
            <div className="seo-health-grid">
              <span className={`seo-status ${statusTone(health.status)}`}>{health.status}</span>
              <span className="muted">{t("seo.mode")}: <strong>{health.activeMode}</strong></span>
              <span className="muted">{t("seo.latency")}: {health.latencyMs === null ? "—" : `${health.latencyMs} ms`}</span>
              <span className="muted">{t("seo.security")}: {health.security?.status ?? "safe"}{health.security?.publicNoAuthDetected ? ` · ${health.security.reason ?? ""}` : ""}</span>
              <div className="seo-capabilities">
                {health.capabilities.map(capability => <code key={capability}>{capability}</code>)}
              </div>
            </div>
          )}
        </section>

        <section className="seo-card">
          <h3>{t("seo.projects")}</h3>
          <form className="seo-new-project" onSubmit={createProject}>
            <input className="input" required value={formDomain} onChange={e => setFormDomain(e.target.value)} placeholder={t("seo.domainPlaceholder")} />
            <input className="input" value={formName} onChange={e => setFormName(e.target.value)} placeholder={t("seo.displayNamePlaceholder")} />
            <input className="input" value={formSeeds} onChange={e => setFormSeeds(e.target.value)} placeholder={t("seo.seedPlaceholder")} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>{creating ? t("common.loading") : t("seo.createProject")}</button>
          </form>
          {projectsState === "loading" && <p className="muted">{t("common.loading")}</p>}
          {projectsState === "error" && <p className="seo-err">{t("seo.loadFailed")}</p>}
          {projectsState === "ready" && projects.length === 0 && <p className="muted">{t("seo.noProjects")}</p>}
          {projects.length > 0 && (
            <ul className="seo-project-list">
              {projects.map(project => (
                <li key={project.id} className={selected === project.id ? "seo-project seo-project--active" : "seo-project"}>
                  <button type="button" onClick={() => void selectProject(project.id)}>
                    <strong>{project.displayName || project.domain}</strong>
                    <span className="muted">{project.domain}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="seo-card">
          <h3>{t("seo.recommendations")}</h3>
          {selected === null && <p className="muted">{t("seo.selectProject")}</p>}
          {selected !== null && (
            <>
              <div className="seo-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void runAnalysis()} disabled={analyzing}>
                  {analyzing ? t("seo.analyzing") : t("seo.runAnalysis")}
                </button>
              </div>
              {error && <p className="seo-err">{t("seo.runFailed")} ({error})</p>}
              {recsState === "loading" && <p className="muted">{t("common.loading")}</p>}
              {recsState === "ready" && recommendations.length === 0 && <p className="muted">{t("seo.noRecommendations")}</p>}
              <ul className="seo-rec-list">
                {recommendations.map(rec => (
                  <li key={rec.id} className="seo-rec">
                    <div className="seo-rec-head">
                      <span className={`seo-impact seo-impact--${rec.impact}`}>{rec.impact}</span>
                      <strong>{rec.title}</strong>
                      {rec.status !== "open" && <span className="seo-badge">{rec.status}</span>}
                    </div>
                    <p className="muted">{rec.detail}</p>
                    <div className="seo-rec-actions">
                      {rec.status === "open" && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setRecStatus(rec.id, "approved")}>{t("seo.approve")}</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setRecStatus(rec.id, "dismissed")}>{t("seo.dismiss")}</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="seo-card">
          <h3>{t("seo.geoTitle")}</h3>
          <p className="muted">{t("seo.geoHint")}</p>
          {selected === null && <p className="muted">{t("seo.selectProject")}</p>}
          {selected !== null && (
            <>
              <div className="seo-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void runGeoAuditAction()} disabled={geoBusy}>
                  {geoBusy ? t("seo.analyzing") : t("seo.geoRun")}
                </button>
              </div>
              {geoError && <p className="seo-err">{t("seo.runFailed")} ({geoError})</p>}
              {geoAudit && (
                <div className="seo-geo-grid">
                  <div className="seo-geo-tile">
                    <strong>{t("seo.geoScore")}: {geoAudit.heuristicscore}/100</strong>
                    <span className="muted">{t("seo.geoHeuristic")}</span>
                  </div>
                  <div className="seo-geo-tile">
                    <strong>{t("seo.geoCitability")}: {geoAudit.citability ? `${geoAudit.citability.overallScore}/100` : "—"}</strong>
                    <span className="muted">{geoAudit.citability ? `${geoAudit.citability.strongCount} / ${geoAudit.citability.weakCount}` : "—"}</span>
                  </div>
                  <div className="seo-geo-tile">
                    <strong>{t("seo.geoSchema")}: {geoAudit.schema.blocksFound}</strong>
                    <span className="muted">{geoAudit.schema.families.join(", ") || "—"}</span>
                  </div>
                  <div className="seo-geo-tile">
                    <strong>{t("seo.geoLlms")}: {geoAudit.llmsTxt.state}</strong>
                    <span className="muted">{geoAudit.llmsTxt.issues.join("; ") || "—"}</span>
                  </div>
                </div>
              )}
              {geoAudit && (
                <ul className="seo-rec-list">
                  {geoAudit.crawlerPolicy.map(crawler => (
                    <li key={crawler.crawlerId} className="seo-rec">
                      <div className="seo-rec-head">
                        <span className={`seo-impact seo-impact--${crawler.access === "allowed" ? "low" : crawler.access === "blocked" ? "high" : "medium"}`}>{crawler.access}</span>
                        <strong>{crawler.displayName}</strong>
                        <span className="seo-badge">{crawler.category}</span>
                      </div>
                      {crawler.evidenceLines.length > 0 && <p className="muted">{crawler.evidenceLines.join(" · ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {geoAudit && (
                <div className="seo-geo-verify">
                  <span className="muted">{t("seo.geoVerify")}: {geoAudit.verificationSummary.verified} ✓ · {geoAudit.verificationSummary.unverified} ? · {geoAudit.verificationSummary.conflict} ⚠ · {geoAudit.verificationSummary.suppressed} ⊘</span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
