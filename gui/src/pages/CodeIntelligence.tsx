// Phase 20.62 — Code Intelligence control plane (Graft integration).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

interface Repository {
  id: string;
  name: string;
  graphState: string;
  providerKey: string;
  deepEnrichmentEnabled: boolean;
  lastBuildAt: string | null;
  lastFingerprint: string | null;
}
interface ImpactReport {
  id: string;
  targetRef: string;
  riskLevel: string;
  riskScore: number;
  policyDecision: string;
  freshnessState: string;
  createdAt: string;
}

const STATE_OK = new Set(["ready"]);
const STATE_BAD = new Set(["failed", "disabled"]);

function pill(state: string, ok: Set<string>, bad: Set<string>): string {
  if (ok.has(state)) return "ur-pill ok";
  if (bad.has(state)) return "ur-pill bad";
  return "ur-pill warn";
}

export default function CodeIntelligencePage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [provider, setProvider] = useState<Record<string, unknown> | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [reports, setReports] = useState<ImpactReport[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "repositories" | "impact">("overview");

  const load = useCallback(async () => {
    try {
      const [h, p, r, i] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/code-intelligence/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/code-intelligence/provider/status`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/code-intelligence/repositories`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/code-intelligence/impact-reports-all`).then((x) => x.json()).catch(() => ({ reports: [] })),
      ]);
      setHealth(h);
      setProvider(p.status ?? null);
      setRepos(r.repositories ?? []);
      setReports((i.reports ?? []) as ImpactReport[]);
    } catch {
      setMessage("Code Intelligence API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 12000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  const act = async (path: string, body?: unknown, ok?: string) => {
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? "{}" : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setMessage(res.ok ? ok ?? "Done." : json.error?.message ?? `Request failed (${res.status}).`);
    } catch {
      setMessage("Request failed.");
    }
    await load();
  };

  const registerRepo = async () => {
    const name = window.prompt("Repository name", "my-repo");
    if (name === null) return;
    const path = window.prompt("Absolute repository path (operator only)");
    if (path === null) return;
    await act("/api/agent-os/code-intelligence/repositories", { name, path, actorId: "operator" }, "Repository registered.");
  };

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.62</p>
        <h1>Code Intelligence</h1>
        <p>Graft-backed repository graphs: freshness, blast radius, and policy-governed impact gates.</p>
        {health ? (
          <p className="ur-meta">
            {String(health.repositories)} repositories · {String(health.ready)} ready · {String(health.stale)} stale ·{" "}
            {String(health.failed)} failed
          </p>
        ) : null}
        {provider ? (
          <p className="ur-meta">
            provider {String(provider.provider ?? "—")} {String(provider.version ?? "")} ·{" "}
            <span className={String(provider.available) === "true" ? "ur-pill ok" : "ur-pill bad"}>
              {String(provider.status ?? "unavailable")}
            </span>{" "}
            · telemetry {String(provider.telemetryDisabled) === "true" ? "off" : "ON"}
          </p>
        ) : null}
        {message ? <p className="ur-banner">{message}</p> : null}
        <button className="ur-btn" onClick={() => void registerRepo()}>Register repository</button>
      </header>
      <div className="ur-tabs">
        {(["overview", "repositories", "impact"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <table className="ur-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Provider</td><td>{provider ? `${String(provider.provider)} ${String(provider.version ?? "")}` : "—"}</td></tr>
            <tr><td>Compatibility</td><td><span className={provider && String(provider.compatible) === "true" ? "ur-pill ok" : "ur-pill warn"}>{provider ? String(provider.status) : "unknown"}</span></td></tr>
            <tr><td>Node runtime</td><td className="ur-meta">{provider ? String(provider.runtimeVersion ?? "—") : "—"}</td></tr>
            <tr><td>Telemetry</td><td>{provider && String(provider.telemetryDisabled) === "true" ? "disabled (DO_NOT_TRACK=1)" : "enabled"}</td></tr>
            <tr><td>Machine-wide config writes</td><td>{provider && String(provider.machineWideConfigWrites) === "true" ? "allowed" : "denied by default"}</td></tr>
            <tr><td>Deep enrichment</td><td>{repos.some((r) => r.deepEnrichmentEnabled) ? "enabled per repository" : "disabled"}</td></tr>
          </tbody>
        </table>
      ) : null}

      {tab === "repositories" ? (
        <table className="ur-table">
          <thead><tr><th>Repository</th><th>Graph state</th><th>Provider</th><th>Last build</th><th>Fingerprint</th><th>Actions</th></tr></thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r.id}>
                <td>{r.name}<div className="ur-meta">{r.id}</div></td>
                <td><span className={pill(r.graphState, STATE_OK, STATE_BAD)}>{r.graphState}</span></td>
                <td>{r.providerKey}</td>
                <td className="ur-meta">{r.lastBuildAt ?? "—"}</td>
                <td className="ur-meta">{r.lastFingerprint ? r.lastFingerprint.slice(0, 14) + "…" : "—"}</td>
                <td>
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/code-intelligence/repositories/${r.id}/build`, { actorId: "operator" }, "Graph built.")}>Build</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/code-intelligence/repositories/${r.id}/check`, {}, "Freshness checked.")}>Check</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/code-intelligence/repositories/${r.id}/map`, { actorId: "operator" }, "Map generated.")}>Map</button>
                </td>
              </tr>
            ))}
            {repos.length === 0 ? <tr><td colSpan={6} className="ur-meta">No repositories registered yet.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "impact" ? (
        <table className="ur-table">
          <thead><tr><th>Target</th><th>Risk</th><th>Score</th><th>Policy</th><th>Freshness</th><th>Created</th></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="ur-meta">{r.targetRef}</td>
                <td><span className={pill(r.riskLevel, new Set(["low"]), new Set(["critical"]))}>{r.riskLevel}</span></td>
                <td>{r.riskScore}</td>
                <td>{r.policyDecision}</td>
                <td><span className={pill(r.freshnessState, new Set(["fresh"]), new Set(["missing"]))}>{r.freshnessState}</span></td>
                <td className="ur-meta">{r.createdAt}</td>
              </tr>
            ))}
            {reports.length === 0 ? <tr><td colSpan={6} className="ur-meta">No impact reports yet. Run the Pre-Edit Impact Gate via API or MCP.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
