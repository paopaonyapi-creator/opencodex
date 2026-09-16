// Phase 20.60 — Social Publishing control plane (OpenPost integration).

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props { apiBase?: string; }

interface Publication {
  id: string;
  sourceType: string;
  masterTitle: string | null;
  masterCaption: string | null;
  status: string;
  scheduledAt: string | null;
  updatedAt: string;
}
interface Rendition {
  id: string;
  platform: string;
  format: string;
  caption: string | null;
  validationStatus: string;
  approvalStatus: string;
  deliveryStatus: string;
  contentHash: string;
}
interface Account {
  id: string;
  platform: string;
  username: string | null;
  readinessState: string;
  enabled: boolean;
  lastSyncAt: string | null;
}
interface Job {
  id: string;
  publicationId: string;
  jobType: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}
interface Instance {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  version: string | null;
  lastHealthAt: string | null;
}

const READY_OK = new Set(["ready"]);
const READY_BAD = new Set(["requires_reauth", "requires_scope", "requires_review", "disabled", "unsupported_format"]);

function pill(state: string, okSet: Set<string>, badSet: Set<string>): string {
  if (okSet.has(state)) return "ur-pill ok";
  if (badSet.has(state)) return "ur-pill bad";
  return "ur-pill warn";
}

const DELIVERY_OK = new Set(["published", "scheduled"]);
const DELIVERY_BAD = new Set(["failed_final", "cancelled", "reconciliation_required"]);

export default function SocialPublishingPage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [renditions, setRenditions] = useState<Record<string, Rendition[]>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "accounts" | "publications" | "jobs">("overview");

  const load = useCallback(async () => {
    try {
      const [h, i, a, p, j] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/social-publishing/health`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/social-publishing/instances`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/social-publishing/accounts`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/social-publishing/publications`).then((x) => x.json()),
        fetch(`${apiBase}/api/agent-os/social-publishing/jobs`).then((x) => x.json()),
      ]);
      setHealth(h);
      setInstances(i.instances ?? []);
      setAccounts(a.accounts ?? []);
      setPublications(p.publications ?? []);
      setJobs(j.jobs ?? []);
    } catch {
      setMessage("Social Publishing API unavailable");
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 10000);
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

  const openPublication = async (id: string) => {
    try {
      const detail = (await fetch(`${apiBase}/api/agent-os/social-publishing/publications/${id}`).then((x) => x.json())) as { renditions?: Rendition[] };
      setRenditions((prev) => ({ ...prev, [id]: detail.renditions ?? [] }));
    } catch {
      setMessage("Could not load renditions.");
    }
  };

  const approve = async (id: string, decision: "approved" | "rejected") => {
    const approverId = window.prompt("Approver id", "operator");
    if (approverId === null) return;
    await act(`/api/agent-os/social-publishing/publications/${id}/approve`, { decision, approverId }, decision === "approved" ? "Approval bound to current content hashes." : "Publication rejected.");
  };

  const schedule = async (id: string, scheduledAt: string | null) => {
    const when = scheduledAt ?? new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
    await act(`/api/agent-os/social-publishing/publications/${id}/schedule`, { scheduledAt: when }, "Dispatched to OpenPost (idempotent job).");
  };

  return (
    <div className="ur-page">
      <header className="ur-hero">
        <p className="ur-kicker">Phase 20.60</p>
        <h1>Social Publishing</h1>
        <p>OpenPost-backed publishing control plane: policy, approval, idempotent dispatch, reconciliation.</p>
        {health ? (
          <p className="ur-meta">
            {String(health.instances)} instances · {String(health.readyAccounts)}/{String(health.accounts)} ready ·{" "}
            {String(health.awaitingApproval)} awaiting approval · {String(health.failed)} failed
          </p>
        ) : null}
        {message ? <p className="ur-banner">{message}</p> : null}
        <button className="ur-btn" onClick={() => void act("/api/agent-os/social-publishing/analytics/sync", {}, "Analytics snapshots synced.")}>Sync analytics</button>
      </header>
      <div className="ur-tabs">
        {(["overview", "accounts", "publications", "jobs"] as const).map((id) => (
          <button key={id} className={tab === id ? "ur-tab on" : "ur-tab"} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="ur-section">
          <table className="ur-table">
            <thead><tr><th>Instance</th><th>Base URL</th><th>Status</th><th>Version</th><th>Last health</th><th></th></tr></thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="ur-meta">{i.baseUrl}</td>
                  <td><span className={pill(i.status, new Set(["healthy"]), new Set(["unavailable"]))}>{i.status}</span></td>
                  <td>{i.version ?? "—"}</td>
                  <td className="ur-meta">{i.lastHealthAt ?? "—"}</td>
                  <td>
                    <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/instances/${i.id}/test`, {}, "Health checked.")}>Test</button>{" "}
                    <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/instances/${i.id}/sync`, {}, "Accounts synced.")}>Sync</button>
                  </td>
                </tr>
              ))}
              {instances.length === 0 ? <tr><td colSpan={6} className="ur-meta">No OpenPost instance registered yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "accounts" ? (
        <table className="ur-table">
          <thead><tr><th>Platform</th><th>Account</th><th>Readiness</th><th>Enabled</th><th>Last sync</th><th></th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.platform}</td>
                <td>{a.username ?? "—"}</td>
                <td><span className={pill(a.readinessState, READY_OK, READY_BAD)}>{a.readinessState}</span></td>
                <td>{a.enabled ? "yes" : "no"}</td>
                <td className="ur-meta">{a.lastSyncAt ?? "—"}</td>
                <td>
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/accounts/${a.id}/refresh-capabilities`, {}, "Capabilities refreshed.")}>Refresh</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/accounts/${a.id}/enabled`, { enabled: !a.enabled }, "Account updated.")}>{a.enabled ? "Disable" : "Enable"}</button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 ? <tr><td colSpan={6} className="ur-meta">Sync an instance to discover connected accounts.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "publications" ? (
        <table className="ur-table">
          <thead><tr><th>Publication</th><th>Status</th><th>Schedule</th><th>Actions</th></tr></thead>
          <tbody>
            {publications.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.masterTitle ?? p.id}
                  <div className="ur-meta">{p.masterCaption ?? ""}</div>
                  {(renditions[p.id] ?? []).length > 0 ? (
                    <div className="ur-meta">
                      {(renditions[p.id] ?? []).map((r) => (
                        <div key={r.id}>
                          {r.platform}: {r.validationStatus} / {r.approvalStatus} /{" "}
                          <span className={pill(r.deliveryStatus, DELIVERY_OK, DELIVERY_BAD)}>{r.deliveryStatus}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td><span className={pill(p.status, new Set(["published", "approved", "scheduled"]), new Set(["failed", "rejected"]))}>{p.status}</span></td>
                <td className="ur-meta">{p.scheduledAt ?? "—"}</td>
                <td>
                  <button className="ur-btn small" onClick={() => void openPublication(p.id)}>Renditions</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/publications/${p.id}/request-approval`, {}, "Queued for human approval.")}>Request approval</button>{" "}
                  <button className="ur-btn small" onClick={() => void approve(p.id, "approved")}>Approve</button>{" "}
                  <button className="ur-btn small" onClick={() => void approve(p.id, "rejected")}>Reject</button>{" "}
                  <button className="ur-btn small" onClick={() => void schedule(p.id, p.scheduledAt)}>Schedule</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/publications/${p.id}/publish`, { actorType: "human", actorId: "operator" }, "Publish-now dispatched.")}>Publish</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/publications/${p.id}/cancel`, {}, "Cancel requested.")}>Cancel</button>{" "}
                  <button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/publications/${p.id}/reconcile`, {}, "Reconciled.")}>Reconcile</button>
                </td>
              </tr>
            ))}
            {publications.length === 0 ? <tr><td colSpan={4} className="ur-meta">Create publications via POST /api/agent-os/social-publishing/publications.</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "jobs" ? (
        <table className="ur-table">
          <thead><tr><th>Job</th><th>Publication</th><th>Type</th><th>Status</th><th>Attempts</th><th>Last error</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="ur-meta">{j.id}</td>
                <td className="ur-meta">{j.publicationId}</td>
                <td>{j.jobType}</td>
                <td><span className={pill(j.status, new Set(["completed"]), new Set(["failed_final"]))}>{j.status}</span></td>
                <td>{j.attemptCount}/{j.maxAttempts}</td>
                <td className="ur-meta">{j.lastErrorCode ?? ""} {j.lastErrorMessage ?? ""}</td>
                <td><button className="ur-btn small" onClick={() => void act(`/api/agent-os/social-publishing/jobs/${j.id}/retry`, {}, "Job requeued.")}>Retry</button></td>
              </tr>
            ))}
            {jobs.length === 0 ? <tr><td colSpan={7} className="ur-meta">No delivery jobs.</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
