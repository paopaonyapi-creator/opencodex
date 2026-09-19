// Phase 20.96 — AnythingMCP capability control plane.
// Live data from /api/agent-os/mcp-fabric/* — mock fallback is labeled.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/shared";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }
type Surface = "catalog" | "inspector" | "privacy" | "approvals" | "knowledge" | "skills" | "health";

function pill(status: string): string {
  if (["PUBLISHED", "MONITORED", "APPROVED", "healthy", "success"].includes(status)) return "ur-pill ok";
  if (["DISABLED", "FROZEN", "BLOCK", "offline", "failed"].includes(status)) return "ur-pill bad";
  if (["POLICY_REVIEW", "TESTED", "PENDING", "unconfigured"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function McpFabric({ apiBase = "" }: Props) {
  const t = useT();
  const [surface, setSurface] = useState<Surface>("catalog");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [connectors, setConnectors] = useState<Array<Record<string, unknown>>>([]);
  const [tools, setTools] = useState<Array<Record<string, unknown>>>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [knowledge, setKnowledge] = useState<Array<Record<string, unknown>>>([]);
  const [skills, setSkills] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, c, tl, a, k, s] = await Promise.all([
        fetch(apiBase + "/api/agent-os/mcp-fabric/health").then((res) => res.json()),
        fetch(apiBase + "/api/agent-os/mcp-fabric/connectors").then((res) => (res.ok ? res.json() : { connectors: [] })),
        fetch(apiBase + "/api/agent-os/mcp-fabric/tools").then((res) => (res.ok ? res.json() : { tools: [] })),
        fetch(apiBase + "/api/agent-os/mcp-fabric/approvals").then((res) => (res.ok ? res.json() : { approvals: [] })),
        fetch(apiBase + "/api/agent-os/mcp-fabric/knowledge").then((res) => (res.ok ? res.json() : { candidates: [] })),
        fetch(apiBase + "/api/agent-os/mcp-fabric/skills").then((res) => (res.ok ? res.json() : { candidates: [] })),
      ]);
      setHealth(h);
      setConnectors(c.connectors ?? []);
      setTools(tl.tools ?? []);
      setApprovals(a.approvals ?? []);
      setKnowledge(k.candidates ?? []);
      setSkills(s.candidates ?? []);
      setLoadState(h?.ok === false || h?.error ? "error" : "ready");
    } catch (err) {
      setLoadState("error");
      setMessage(err instanceof Error ? err.message : t("amf.loadFailed"));
    }
  }, [apiBase, t]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) void load(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);

  async function act(path: string) {
    setBusy(true);
    try {
      const res = await fetch(apiBase + path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) setMessage(body?.error?.message ?? path);
      await load();
    } finally { setBusy(false); }
  }

  const tabs: Surface[] = ["catalog", "inspector", "privacy", "approvals", "knowledge", "skills", "health"];
  const tabKey = {
    catalog: "amf.tab.catalog",
    inspector: "amf.tab.inspector",
    privacy: "amf.tab.privacy",
    approvals: "amf.tab.approvals",
    knowledge: "amf.tab.knowledge",
    skills: "amf.tab.skills",
    health: "amf.tab.health",
  } as const;
  const adapters = Array.isArray(health?.adapters) ? health!.adapters as Array<{ id: string; status: string; detail?: string }> : [];
  const mockOnly = adapters.every((a) => a.id === "mock" || a.status !== "healthy");

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">{t("amf.kicker")}</p>
        <h1>{t("amf.title")}</h1>
        <p>{t("amf.subtitle")}</p>
        {health && <p><span className={pill(health.ok ? "PUBLISHED" : "DISABLED")}>{health.ok ? t("amf.ready") : t("amf.error")}</span></p>}
        {mockOnly && loadState === "ready" && <p className="ur-pill warn">{t("amf.mockNote")}</p>}
        {loadState === "loading" && <p>{t("amf.loading")}</p>}
        {loadState === "error" && <p className="ur-pill bad">{message ?? t("amf.unavailable")}</p>}
      </header>
      <div className="ur-tabs">
        {tabs.map((s) => (
          <button key={s} className={"ur-btn" + (surface === s ? " active" : "")} onClick={() => setSurface(s)}>{t(tabKey[s])}</button>
        ))}
      </div>
      {message && <p>{message}</p>}
      {surface === "catalog" && (
        <section className="ur-section">
          <h2>{t("amf.catalog")}</h2>
          {connectors.length === 0 && <p>{t("amf.noConnectors")}</p>}
          {connectors.map((c) => (
            <div className="ur-card" key={String(c.id)}>
              <p><span className={pill(String(c.lifecycle))}>{String(c.lifecycle)}</span> {String(c.name)} · {String(c.kind)} · {String(c.riskMax)}</p>
              <p>
                <button className="ur-btn" disabled={busy} onClick={() => void act("/api/agent-os/mcp-fabric/connectors/" + encodeURIComponent(String(c.id)) + "/approve")}>{t("amf.approve")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act("/api/agent-os/mcp-fabric/connectors/" + encodeURIComponent(String(c.id)) + "/publish")}>{t("amf.publish")}</button>
                <button className="ur-btn" disabled={busy} onClick={() => void act("/api/agent-os/mcp-fabric/connectors/" + encodeURIComponent(String(c.id)) + "/disable")}>{t("amf.disable")}</button>
              </p>
            </div>
          ))}
        </section>
      )}
      {surface === "inspector" && (
        <section className="ur-section">
          <h2>{t("amf.inspector")}</h2>
          {tools.length === 0 && <p>{t("amf.noTools")}</p>}
          {tools.map((tool) => (
            <div className="ur-card" key={String(tool.id)}>
              <p><span className={pill(String(tool.risk))}>{String(tool.risk)}</span> {String(tool.canonicalName)} v{String(tool.version)}</p>
              <p>{String(tool.description)}</p>
            </div>
          ))}
        </section>
      )}
      {surface === "privacy" && (
        <section className="ur-section">
          <h2>{t("amf.privacy")}</h2>
          <p>{t("amf.privacyHelp")}</p>
        </section>
      )}
      {surface === "approvals" && (
        <section className="ur-section">
          <h2>{t("amf.approvals")}</h2>
          {approvals.length === 0 && <p>{t("amf.noApprovals")}</p>}
          {approvals.map((a) => (
            <div className="ur-card" key={String(a.id)}>
              <p><span className={pill(String(a.status))}>{String(a.status)}</span> {String(a.risk)} {String(a.id)}</p>
              {String(a.status) === "PENDING" && (
                <p>
                  <button className="ur-btn" disabled={busy} onClick={() => void act("/api/agent-os/mcp-fabric/approvals/" + encodeURIComponent(String(a.id)) + "/approve")}>{t("amf.approve")}</button>
                  <button className="ur-btn" disabled={busy} onClick={() => void act("/api/agent-os/mcp-fabric/approvals/" + encodeURIComponent(String(a.id)) + "/deny")}>{t("amf.deny")}</button>
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      {surface === "knowledge" && (
        <section className="ur-section">
          <h2>{t("amf.knowledge")}</h2>
          {knowledge.length === 0 && <p>{t("amf.noKnowledge")}</p>}
          {knowledge.map((k) => <div className="ur-card" key={String(k.id)}><p>{String(k.status)} · {String(k.relation)}</p></div>)}
        </section>
      )}
      {surface === "skills" && (
        <section className="ur-section">
          <h2>{t("amf.skills")}</h2>
          {skills.length === 0 && <p>{t("amf.noSkills")}</p>}
          {skills.map((s) => <div className="ur-card" key={String(s.id)}><p>{String(s.status)} · {String(s.title)}</p></div>)}
        </section>
      )}
      {surface === "health" && (
        <section className="ur-section">
          <h2>{t("amf.health")}</h2>
          {adapters.map((a) => <div className="ur-card" key={a.id}><p><span className={pill(a.status)}>{a.status}</span> {a.id} {a.detail}</p></div>)}
        </section>
      )}
    </div>
  );
}
