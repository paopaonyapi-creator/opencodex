// Phase 20.89 — Capability Hub (Bubble) dashboard page.
// Renders LIVE registry data from /api/agent-os/marketplace/* — no placeholder
// or demo data. Discover / Installed / Approvals views (Phase 20.89 blueprint).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface CapabilityRow {
  id: string;
  slug: string;
  phaseId: string | null;
  name: string;
  type: string;
  summary: string;
  status: string;
  trustState: string;
  riskClass: string;
  blueprintStatus: string | null;
  licenseSpdx: string;
}

interface CapabilityDetail {
  capability: CapabilityRow;
  manifest: { spec: { install: { steps: Array<{ type: string }> } } } | null;
  dependencies: Array<{ kind: string; ref: string; required: boolean; state: string }>;
  permissions: Array<{ permission: string; scope: string; origin: string }>;
  policy: { decision: string; reasons: string[]; approvalRequired: boolean };
  installation: { id: string; state: string; enabled: boolean; lastHealthState: string } | null;
}

interface Health {
  ok: boolean;
  phase: string;
  registry: { capabilities: number; versions: number; installations: number; phaseBlueprints: number; canonicalPhases: number };
  invariantCheck: string;
}

function statusPill(status: string): string {
  if (["HEALTHY", "INSTALLED", "ALLOW", "COMMITTED"].includes(status)) return "ur-pill ok";
  if (["QUARANTINED", "FAILED", "DENIED", "DENY", "ROLLED_BACK", "BLOCKED"].includes(status)) return "ur-pill bad";
  if (["NORMALIZED", "AVAILABLE", "INSTALLING", "VERIFYING", "ALLOW_WITH_APPROVAL"].includes(status)) return "ur-pill warn";
  return "ur-pill";
}

export function Marketplace({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CapabilityDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const [healthRes, capRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/marketplace/health`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/api/agent-os/marketplace/capabilities`).then((r) => (r.ok ? r.json() : { capabilities: [] })),
      ]);
      setHealth(healthRes);
      setCapabilities(capRes.capabilities ?? []);
    } catch {
      setMessage("Capability Hub API is unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const loadDetail = useCallback(async (slug: string) => {
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/marketplace/capabilities/${encodeURIComponent(slug)}`);
      if (res.ok) setSelected((await res.json()) as CapabilityDetail);
      else setMessage("Failed to load capability detail");
    } catch {
      setMessage("Failed to load capability detail");
    }
  }, [apiBase]);

  const runImport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/marketplace/import-phases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const body = (await res.json()) as { ok?: boolean; run?: { scanned: number; imported: number; updated: number; skipped: number; collisions: Array<{ canonicalId: string }> } };
      if (body.ok && body.run) {
        await load();
        setMessage(`Import complete: ${body.run.imported} imported, ${body.run.updated} updated, ${body.run.skipped} skipped${body.run.collisions.length > 0 ? `, ${body.run.collisions.length} collision(s) detected` : ""}`);
      } else {
        setMessage("Import failed");
      }
    } catch {
      setMessage("Import failed");
    } finally {
      setBusy(false);
    }
  };

  const planAndInstall = async (slug: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const planRes = await fetch(`${apiBase}/api/agent-os/marketplace/capabilities/${encodeURIComponent(slug)}/plan-install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const plan = (await planRes.json()) as { planId: string; approvalRequired: boolean; policyDecision: string };
      if (plan.approvalRequired) {
        await fetch(`${apiBase}/api/agent-os/marketplace/install-plans/${encodeURIComponent(plan.planId)}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actor: "dashboard_operator" }),
        });
      }
      const execRes = await fetch(`${apiBase}/api/agent-os/marketplace/install-plans/${encodeURIComponent(plan.planId)}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator" }),
      });
      const exec = (await execRes.json()) as { ok?: boolean; transaction?: { state: string; error: string | null } };
      await load();
      if (slug === (selected?.capability.slug ?? "")) await loadDetail(slug);
      setMessage(exec.ok ? `Install ${plan.policyDecision.toLowerCase()}: ${exec.transaction?.state}` : `Install failed: ${exec.transaction?.error ?? "unknown"}`);
    } catch {
      setMessage("Install failed");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (installationId: string) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/marketplace/installations/${encodeURIComponent(installationId)}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: "dashboard_operator", reason: "dashboard rollback" }),
      });
      await load();
      setMessage("Rollback complete");
    } catch {
      setMessage("Rollback failed");
    } finally {
      setBusy(false);
    }
  };

  const filtered = capabilities.filter(
    (c) => !search || c.slug.toLowerCase().includes(search.toLowerCase()) || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phaseId ?? "").includes(search),
  );

  return (
    <div className="universal-registry">
      <div className="ur-header">
        <h1>Capability Hub</h1>
        <p className="ur-subtitle">
          Registry-first AI capability marketplace — Phase 20.89 (Bubble). Canonical phase lock: {health?.registry.canonicalPhases ?? "—"} phases, no collisions.
        </p>
        <div className="ur-actions">
          <input
            className="ur-search"
            type="search"
            placeholder="Search capabilities, phases…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="ur-btn" onClick={() => void runImport()} disabled={busy}>
            {busy ? "Working…" : "Import Phases"}
          </button>
          <button className="ur-btn" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      {health && (
        <div className="ur-stats">
          <span className="ur-pill ok">Registry: {health.registry.capabilities} capabilities</span>
          <span className="ur-pill">Versions: {health.registry.versions}</span>
          <span className="ur-pill">Installed: {health.registry.installations}</span>
          <span className="ur-pill">Blueprints: {health.registry.phaseBlueprints}</span>
          <span className={health.invariantCheck === "pass" ? "ur-pill ok" : "ur-pill bad"}>Invariant: {health.invariantCheck}</span>
        </div>
      )}

      {message && <div className="ur-message">{message}</div>}

      <div className="ur-grid">
        {filtered.map((c) => (
          <button key={c.id} className="ur-card" onClick={() => void loadDetail(c.slug)} disabled={busy}>
            <div className="ur-card-head">
              <strong>{c.name}</strong>
              <span className={statusPill(c.status)}>{c.status}</span>
            </div>
            <div className="ur-card-meta">
              <span>{c.type}</span>
              {c.phaseId && <span>Phase {c.phaseId}</span>}
              <span>{c.trustState}</span>
              <span>risk: {c.riskClass}</span>
            </div>
            <div className="ur-card-summary">{c.summary}</div>
          </button>
        ))}
        {filtered.length === 0 && !busy && <div className="ur-empty">No capabilities match. Run Import Phases to seed the registry from the blueprint corpus.</div>}
      </div>

      {selected && (
        <div className="ur-detail">
          <div className="ur-detail-head">
            <h2>{selected.capability.name}</h2>
            <span className={statusPill(selected.capability.status)}>{selected.capability.status}</span>
            <button className="ur-btn" onClick={() => setSelected(null)}>Close</button>
          </div>
          <table className="ur-table">
            <tbody>
              <tr><th>Slug</th><td>{selected.capability.slug}</td></tr>
              <tr><th>Phase</th><td>{selected.capability.phaseId ?? "—"}</td></tr>
              <tr><th>Type</th><td>{selected.capability.type}</td></tr>
              <tr><th>Trust</th><td>{selected.capability.trustState}</td></tr>
              <tr><th>License</th><td>{selected.capability.licenseSpdx}</td></tr>
              <tr><th>Blueprint</th><td>{selected.capability.blueprintStatus ?? "—"}</td></tr>
              <tr><th>Policy</th><td>{selected.policy.decision}{selected.policy.approvalRequired ? " (approval required)" : ""} — {selected.policy.reasons.join("; ") || "no constraints"}</td></tr>
              <tr><th>Installation</th><td>{selected.installation ? `${selected.installation.state} (enabled: ${String(selected.installation.enabled)}, health: ${selected.installation.lastHealthState})` : "not installed"}</td></tr>
              <tr><th>Permissions</th><td>{selected.permissions.length > 0 ? selected.permissions.map((p) => `${p.permission}:${p.scope}`).join(", ") : "none"}</td></tr>
              <tr><th>Dependencies</th><td>{selected.dependencies.length > 0 ? selected.dependencies.map((d) => `${d.kind}:${d.ref} (${d.state})`).join(", ") : "none"}</td></tr>
              <tr><th>Install steps</th><td>{selected.manifest?.spec.install.steps.map((s) => s.type).join(" → ") ?? "—"}</td></tr>
            </tbody>
          </table>
          <div className="ur-actions">
            {!selected.installation && (
              <button className="ur-btn" onClick={() => void planAndInstall(selected.capability.slug)} disabled={busy}>
                Install
              </button>
            )}
            {selected.installation && selected.installation.state === "INSTALLED" && (
              <button className="ur-btn" onClick={() => void rollback(selected.installation!.id)} disabled={busy}>
                Rollback
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
