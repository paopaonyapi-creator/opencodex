// Phase 20.56 — Micro-App Capability Lab.

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }
interface CapRow { key: string; name: string; status: string; namespace: string; }
interface RecipeRow { id: string; name: string; riskLevel: string; recommendation: string; filePath: string; }

export default function CapabilityLabPage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [caps, setCaps] = useState<CapRow[]>([]);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"recipes" | "registry" | "runs">("registry");

  const load = useCallback(async () => {
    try {
      const [h, c, r] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/capability-lab/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/capability-lab/capabilities`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/capability-lab/recipes`).then((x) => x.json()),
      ]);
      setHealth(h);
      setCaps(c.capabilities ?? []);
      setRecipes(r.recipes ?? []);
    } catch {
      setMessage("Capability Lab API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 8000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  const seed = async () => {
    await fetch(`${apiBase}/api/agent-os/capability-lab/seed`, { method: "POST" });
    setMessage("Seed corpus imported (analysis only; imported Python is not executed on the host).");
    await load();
  };

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.56</p>
        <h1>Capability Lab</h1>
        <p>Import Python micro-apps, analyze without executing, promote trusted wrappers through policy.</p>
        {health ? <p className="ur-meta">{String(health.recipes)} recipes · {String(health.capabilities)} capabilities</p> : null}
        {message ? <p className="ur-banner">{message}</p> : null}
        <button className="ur-btn" onClick={() => void seed()}>Import seed corpus</button>
      </header>
      <div className="ur-tabs">
        {(["registry", "recipes", "runs"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>
      {tab === "registry" ? (
        <table className="ur-table">
          <thead><tr><th>Key</th><th>Namespace</th><th>Status</th></tr></thead>
          <tbody>
            {caps.map((c) => (
              <tr key={c.key}><td>{c.key}<div className="ur-meta">{c.name}</div></td><td>{c.namespace}</td><td><span className={c.status === "PUBLISHED" ? "ur-pill ok" : c.status === "QUARANTINED" ? "ur-pill bad" : "ur-pill warn"}>{c.status}</span></td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "recipes" ? (
        <table className="ur-table">
          <thead><tr><th>Recipe</th><th>Risk</th><th>Recommendation</th></tr></thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id}><td>{r.name}<div className="ur-meta">{r.filePath}</div></td><td>{r.riskLevel}</td><td>{r.recommendation}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "runs" ? <p className="ur-meta">Runs appear after invoke via API or CLI. Imported Python stays host-denied.</p> : null}
    </div>
  );
}

