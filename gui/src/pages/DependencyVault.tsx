// Phase 20.38 — Dependency Vault dashboard (spec §22): overview stats,
// packages/artifacts with trust states, profiles, quarantine, audit.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface DepVaultProps {
  apiBase?: string;
}

interface StatusData {
  packages: number;
  artifacts: number;
  verified: number;
  quarantined: number;
  blocked: number;
  cacheBytes: number;
  bundles: number;
}

interface PackageRow {
  id: string;
  name: string;
  version: string;
  registry: string;
  packageKey: string;
}

interface ArtifactRow {
  id: string;
  packageKey: string;
  trustState: string;
  integrity: string | null;
  sha512Hex: string | null;
  sizeBytes: number;
  quarantineReason: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  packageManager: string;
  packages: Array<{ name: string; version: string }>;
  capabilities: string[];
}

const TRUST_COLORS: Record<string, string> = {
  VERIFIED: "#35c07d", QUARANTINED: "#e2b93b", BLOCKED: "#e06c75",
  DISCOVERED: "#8a93a6", DOWNLOADING: "#7aa2f7", DOWNLOADED: "#7aa2f7", VERIFYING: "#7aa2f7",
  DELETED: "#8a93a6",
};

function trustColor(value: string): string {
  return TRUST_COLORS[value] || "#8a93a6";
}

type TabKey = "overview" | "packages" | "profiles" | "quarantine" | "audit";

export function DependencyVault({ apiBase = "" }: DepVaultProps) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [status, setStatus] = useState<StatusData | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prewarmProfile, setPrewarmProfile] = useState("base-web");
  const [prewarmResult, setPrewarmResult] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    return (await res.json()) as Record<string, unknown>;
  }, [apiBase]);

  const refresh = useCallback(async () => {
    try {
      const [s, p, pf, a] = await Promise.all([
        api("/api/agent-os/dep-vault/status"),
        api("/api/agent-os/dep-vault/packages"),
        api("/api/agent-os/dep-vault/profiles"),
        api("/api/agent-os/dep-vault/audit"),
      ]);
      setStatus((s.data as StatusData) ?? null);
      setPackages(((p.data as { packages?: PackageRow[] })?.packages) ?? []);
      setArtifacts(((p.data as { artifacts?: ArtifactRow[] })?.artifacts) ?? []);
      setProfiles(((pf.data as { profiles?: ProfileRow[] })?.profiles) ?? []);
      setAudit(((a.data as { events?: typeof audit })?.events) ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const prewarm = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api("/api/agent-os/dep-vault/profiles/prewarm", {
        method: "POST",
        body: JSON.stringify({ profileId: prewarmProfile, mode: "OFFLINE_PREFERRED", actor: "dashboard" }),
      });
      const data = res.data as { ok?: boolean; succeeded?: string[]; failed?: Array<{ package: string; message: string }> };
      setPrewarmResult(`ok=${data?.ok} succeeded=${data?.succeeded?.length ?? 0} failed=${data?.failed?.length ?? 0}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, prewarmProfile, refresh]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "packages", label: `Packages (${packages.length})` },
    { key: "profiles", label: `Profiles (${profiles.length})` },
    { key: "quarantine", label: `Quarantine (${status?.quarantined ?? 0})` },
    { key: "audit", label: "Audit" },
  ];

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Dependency Vault</h1>
          <p className="ur-subtitle">Offline-first package supply chain: SHA-512 verified artifacts, policy gates, air-gap bundles</p>
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

      {tab === "overview" && (
        <>
          <section className="ur-grid ur-grid-4">
            <div className="ur-card">
              <div className="ur-card-label">Packages</div>
              <div className="ur-card-value">{status?.packages ?? 0}</div>
              <div className="ur-card-meta">{status?.artifacts ?? 0} artifacts</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Verified</div>
              <div className="ur-card-value" style={{ color: "#35c07d" }}>{status?.verified ?? 0}</div>
              <div className="ur-card-meta">installable artifacts</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Quarantined</div>
              <div className="ur-card-value" style={{ color: (status?.quarantined ?? 0) > 0 ? "#e2b93b" : "#35c07d" }}>{status?.quarantined ?? 0}</div>
              <div className="ur-card-meta">manual review required</div>
            </div>
            <div className="ur-card">
              <div className="ur-card-label">Cache Size</div>
              <div className="ur-card-value">{Math.round((status?.cacheBytes ?? 0) / 1024)} KB</div>
              <div className="ur-card-meta">{status?.bundles ?? 0} bundles exported</div>
            </div>
          </section>
          <section className="ur-panel">
            <h2 className="ur-panel-title">Prewarm Profile</h2>
            <div className="ur-form-grid">
              <label className="ur-field">
                <span>Profile</span>
                <select className="ur-input" value={prewarmProfile} onChange={(e) => setPrewarmProfile(e.target.value)}>
                  {profiles.map((profile) => (<option key={profile.id} value={profile.id}>{profile.name}</option>))}
                </select>
              </label>
            </div>
            <div className="ur-actions">
              <button className="ur-btn ur-btn-primary" onClick={() => { void prewarm(); }} disabled={busy}>Prewarm (offline-preferred)</button>
            </div>
            {prewarmResult && <div className="ur-banner">Prewarm: {prewarmResult}</div>}
          </section>
        </>
      )}

      {tab === "packages" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Cached Artifacts</h2>
          <table className="ur-table">
            <thead><tr><th>Package</th><th>Trust</th><th>Integrity</th><th>Size</th><th>Reason</th></tr></thead>
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td className="ur-meta">{artifact.packageKey}</td>
                  <td style={{ color: trustColor(artifact.trustState) }}>{artifact.trustState}</td>
                  <td className="ur-meta">{artifact.integrity ?? "—"}</td>
                  <td>{Math.round(artifact.sizeBytes / 1024)} KB</td>
                  <td className="ur-meta">{artifact.quarantineReason ?? "—"}</td>
                </tr>
              ))}
              {artifacts.length === 0 && (<tr><td colSpan={5} className="ur-empty">Vault is empty — run ensure or prewarm.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "profiles" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Dependency Profiles</h2>
          <table className="ur-table">
            <thead><tr><th>Profile</th><th>Manager</th><th>Packages</th><th>Capabilities</th></tr></thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>{profile.name}<div className="ur-meta">{profile.id}</div></td>
                  <td>{profile.packageManager}</td>
                  <td className="ur-meta">{profile.packages.map((pkg) => pkg.name).join(", ")}</td>
                  <td className="ur-meta">{profile.capabilities.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "quarantine" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Quarantine (manual review — no auto trust promotion)</h2>
          <table className="ur-table">
            <thead><tr><th>Package</th><th>Reason</th></tr></thead>
            <tbody>
              {artifacts.filter((artifact) => artifact.trustState === "QUARANTINED").map((artifact) => (
                <tr key={artifact.id}>
                  <td className="ur-meta">{artifact.packageKey}</td>
                  <td className="ur-meta">{artifact.quarantineReason}</td>
                </tr>
              ))}
              {(status?.quarantined ?? 0) === 0 && (<tr><td colSpan={2} className="ur-empty">No quarantined artifacts.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      {tab === "audit" && (
        <section className="ur-panel">
          <h2 className="ur-panel-title">Audit Events</h2>
          <table className="ur-table">
            <thead><tr><th>Event</th><th>Package</th><th>Metadata</th></tr></thead>
            <tbody>
              {audit.slice(0, 20).map((entry, index) => (
                <tr key={index}>
                  <td>{String(entry.event_type)}</td>
                  <td className="ur-meta">{String(entry.package_key ?? "—")}</td>
                  <td className="ur-meta">{String(entry.metadata ?? "{}").slice(0, 120)}</td>
                </tr>
              ))}
              {audit.length === 0 && (<tr><td colSpan={3} className="ur-empty">No audit events yet.</td></tr>)}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
