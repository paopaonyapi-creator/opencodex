// Phase 20.63 — External APIs dashboard page (registry overview + review queue).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

interface Provider {
  id: string;
  displayName: string;
  sourceCategory: string | null;
  authType: string;
  health: string;
  trustScore: number | null;
  riskScore: number | null;
  lifecycle: string;
  sourcePresence: string;
}
interface AuditEntry {
  id: string;
  action: string;
  decision: string;
  actorId: string;
  createdAt: string;
}

const LIFE_OK = new Set(["approved", "active"]);
const LIFE_BAD = new Set(["revoked", "rejected", "invalid"]);
const HEALTH_OK = new Set(["healthy"]);

function pill(state: string, ok: Set<string>, bad: Set<string>): string {
  if (ok.has(state)) return "ur-pill ok";
  if (bad.has(state)) return "ur-pill bad";
  return "ur-pill warn";
}

export default function ExternalApisPage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "providers" | "review">("overview");

  const load = useCallback(async () => {
    try {
      const [h, p, a] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/external-apis/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/external-apis/providers`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/external-apis/audit`).then((x) => x.json()),
      ]);
      setHealth(h);
      setProviders(p.providers ?? []);
      setAudit(a.entries ?? []);
    } catch {
      setMessage("External APIs API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 15000);
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

  const reviewQueue = providers.filter((p) => ["review_required", "degraded", "suspended"].includes(p.lifecycle) || p.sourcePresence === "removed");

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.63</p>
        <h1>External APIs</h1>
        <p>Governed capability registry: discovery is not trust, generated is not enabled.</p>
        {health ? (
          <p className="ur-meta">
            {String(health.providers)} providers · {String(health.approved)} approved · {String(health.degraded)} degraded ·{" "}
            {String(health.revoked)} revoked · {String(health.enabledTools)}/{String(health.tools)} tools enabled
          </p>
        ) : null}
        {message ? <p className="ur-banner">{message}</p> : null}
        <button className="ur-btn" onClick={() => void act("/api/agent-os/external-apis/sync", { actorId: "operator" }, "Source synchronized.")}>Sync Public APIs</button>
      </header>
      <div className="ur-tabs">
        {(["overview", "providers", "review"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <table className="ur-table">
          <thead><tr><th>Audit event</th><th>Decision</th><th>Actor</th><th>When</th></tr></thead>
          <tbody>
            {audit.slice(0, 40).map((e) => (
              <tr key={e.id}>
                <td>{e.action}</td>
                <td className="ur-meta">{e.decision}</td>
                <td className="ur-meta">{e.actorId}</td>
                <td className="ur-meta">{e.createdAt}</td>
              </tr>
            ))}
            {audit.length === 0 ? <tr><td colSpan={4} className="ur-meta">No audit events yet. Sync the source to discover providers.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "providers" ? (
        <table className="ur-table">
          <thead><tr><th>Provider</th><th>Category</th><th>Auth</th><th>Health</th><th>Trust / Risk</th><th>Lifecycle</th><th>Actions</th></tr></thead>
          <tbody>
            {providers.slice(0, 200).map((p) => (
              <tr key={p.id}>
                <td>{p.displayName}<div className="ur-meta">{p.id}</div></td>
                <td className="ur-meta">{p.sourceCategory ?? "—"}</td>
                <td>{p.authType}</td>
                <td><span className={pill(p.health, HEALTH_OK, new Set(["unreachable", "suspended"]))}>{p.health}</span></td>
                <td>{p.trustScore ?? "—"} / {p.riskScore ?? "—"}</td>
                <td><span className={pill(p.lifecycle, LIFE_OK, LIFE_BAD)}>{p.lifecycle}</span></td>
                <td>
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/external-apis/providers/${p.id}/approve`, { actorId: "operator" }, "Approved.")}>Approve</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/external-apis/providers/${p.id}/suspend`, { actorId: "operator" }, "Suspended.")}>Suspend</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/external-apis/providers/${p.id}/revoke`, { actorId: "operator" }, "Revoked — tools disabled, calls denied.")}>Revoke</button>
                </td>
              </tr>
            ))}
            {providers.length === 0 ? <tr><td colSpan={7} className="ur-meta">Sync the Public APIs source to populate the registry.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "review" ? (
        <table className="ur-table">
          <thead><tr><th>Provider</th><th>Lifecycle</th><th>Source presence</th><th>Actions</th></tr></thead>
          <tbody>
            {reviewQueue.map((p) => (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td><span className={pill(p.lifecycle, LIFE_OK, LIFE_BAD)}>{p.lifecycle}</span></td>
                <td className="ur-meta">{p.sourcePresence}</td>
                <td>
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/external-apis/providers/${p.id}/approve`, { actorId: "operator" }, "Approved.")}>Approve</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/external-apis/providers/${p.id}/revoke`, { actorId: "operator" }, "Revoked.")}>Revoke</button>
                </td>
              </tr>
            ))}
            {reviewQueue.length === 0 ? <tr><td colSpan={4} className="ur-meta">Review queue is empty.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
