// Phase 20.43 — Shared Agent Memory dashboard (spec §19, §31): Overview,
// Engrams, Candidates, Timeline, Conflicts, Adapters, Policies, Sync,
// Receipts, Health. Exact security terms; render-time redaction; no vague
// "AI brain" labels.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface MemoryProps {
  apiBase?: string;
}

interface StatusView {
  enabled: boolean;
  engine: string;
  plurAvailable: boolean;
  plurDetail: string;
  engramsActive: number;
  engramsCandidate: number;
  episodes: number;
  receipts: number;
  conflictsOpen: number;
  approvalsPending: number;
  secretBlocked: number;
  syncEnabled: boolean;
  adapters: Array<{ adapterKey: string; displayName: string; enabled: boolean; status: string; capabilities: string[] }>;
}

interface EngramView {
  id: string;
  title: string;
  memoryType: string;
  scope: string;
  state: string;
  sensitivity: string;
  recallCount: number;
  updatedAt: string;
  secretScanStatus: string;
}

interface TimelineView {
  id: string;
  summary: string;
  eventType: string;
  severity: string;
  agentId: string | null;
  happenedAt: string;
}

interface ReceiptView {
  id: string;
  injectedCount: number;
  usedTokens: number;
  budgetTokens: number;
  latencyMs: number;
  createdAt: string;
}

interface DoctorView {
  overall: string;
  checks: Array<{ name: string; severity: string; detail: string }>;
}

type ViewKey = "overview" | "engrams" | "candidates" | "timeline" | "conflicts" | "adapters" | "policies" | "sync" | "receipts" | "health";

const STATE_COLORS: Record<string, string> = {
  active: "#35c07d", candidate: "#e2b93b", retired: "#8a93a6", blocked: "#e06c75", conflicted: "#e06c75",
};

async function api<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "request failed");
  return body.data as T;
}

export function AgentMemory({ apiBase = "" }: MemoryProps) {
  const [view, setView] = useState<ViewKey>("overview");
  const [status, setStatus] = useState<StatusView | null>(null);
  const [engrams, setEngrams] = useState<EngramView[]>([]);
  const [timeline, setTimeline] = useState<TimelineView[]>([]);
  const [receipts, setReceipts] = useState<ReceiptView[]>([]);
  const [doctor, setDoctor] = useState<DoctorView | null>(null);
  const [learnTitle, setLearnTitle] = useState("");
  const [learnContent, setLearnContent] = useState("");
  const [learnScope, setLearnScope] = useState("");
  const [learnType, setLearnType] = useState("project_convention");
  const [learnResult, setLearnResult] = useState<string | null>(null);
  const [recallQuery, setRecallQuery] = useState("");
  const [recallResult, setRecallResult] = useState<string | null>(null);
  const [syncProfile, setSyncProfile] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      setStatus(await api<StatusView>(apiBase, "/api/agent-memory/status"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  const loadView = useCallback(async (key: ViewKey) => {
    try {
      if (key === "engrams" || key === "candidates") {
        const data = await api<{ engrams: EngramView[] }>(apiBase, "/api/agent-memory/engrams" + (key === "candidates" ? "?state=candidate" : ""));
        setEngrams(data.engrams);
      } else if (key === "timeline") {
        const data = await api<{ episodes: TimelineView[] }>(apiBase, "/api/agent-memory/timeline");
        setTimeline(data.episodes);
      } else if (key === "receipts") {
        const data = await api<{ receipts: ReceiptView[] }>(apiBase, "/api/agent-memory/receipts");
        setReceipts(data.receipts);
      } else if (key === "health") {
        setDoctor(await api<DoctorView>(apiBase, "/api/agent-memory/doctor"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  useEffect(() => {
    const initial = setTimeout(() => void refreshStats(), 0);
    const timer = setInterval(() => void refreshStats(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refreshStats]);

  useEffect(() => {
    const initial = setTimeout(() => void loadView(view), 0);
    return () => clearTimeout(initial);
  }, [view, loadView]);

  const learn = async () => {
    if (!learnTitle.trim() || !learnContent.trim()) return;
    try {
      const result = await api<{ ok: boolean; state: string; reason: string }>(apiBase, "/api/agent-memory/learn", {
        method: "POST",
        body: JSON.stringify({ title: learnTitle, content: learnContent, memoryType: learnType, scope: learnScope || undefined, sourceKind: "explicit" }),
      });
      setLearnResult(result.state + ": " + result.reason);
      setLearnTitle("");
      setLearnContent("");
      await refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const recallNow = async () => {
    if (!recallQuery.trim()) return;
    try {
      const result = await api<{ engine: string; results: Array<{ title: string; scope: string; memoryType: string }>; degraded: boolean }>(apiBase, "/api/agent-memory/recall", {
        method: "POST",
        body: JSON.stringify({ query: recallQuery }),
      });
      setRecallResult("engine " + result.engine + (result.degraded ? " (fallback)" : "") + " · " + result.results.length + " result(s): " + result.results.map((row) => row.title).join("; "));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const syncPreview = async () => {
    try {
      const result = await api<{ status: string; blockedCount: number; warnings: string[] }>(apiBase, "/api/agent-memory/sync/preview", {
        method: "POST",
        body: JSON.stringify({ profile: syncProfile }),
      });
      setSyncResult(result.status + " · blocked: " + result.blockedCount + (result.warnings.length > 0 ? " · " + result.warnings.join("; ") : ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const candidateAction = async (engramRegistryId: string, approve: boolean) => {
    try {
      await api(apiBase, "/api/agent-memory/candidates/" + (approve ? "approve" : "reject"), { method: "POST", body: JSON.stringify({ engramRegistryId }) });
      await loadView("candidates");
      await refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Shared Agent Memory</h1>
          <p className="ur-subtitle">PLUR-backed engram store under Pao governance: scope, secret scan, policy, receipts, audit</p>
        </div>
        <div className="ur-actions">
          {(["overview", "engrams", "candidates", "timeline", "conflicts", "adapters", "policies", "sync", "receipts", "health"] as ViewKey[]).map((key) => (
            <button key={key} className="ur-button" style={{ opacity: view === key ? 1 : 0.55 }} onClick={() => setView(key)}>{key}</button>
          ))}
        </div>
      </header>

      {error && <div className="ur-error" role="alert">{error}</div>}

      {view === "overview" && status && (
        <section className="ur-card">
          <h2 className="ur-section-title">Overview</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              ["Active memories", status.engramsActive, "#35c07d"],
              ["Candidates", status.engramsCandidate, "#e2b93b"],
              ["Episodes", status.episodes, "#7aa2f7"],
              ["Receipts", status.receipts, "#8a93a6"],
              ["Open conflicts", status.conflictsOpen, "#e06c75"],
              ["Pending approvals", status.approvalsPending, "#e2b93b"],
              ["Secret-blocked writes", status.secretBlocked, "#e06c75"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="ur-card" style={{ padding: "8px 14px", minWidth: 110 }}>
                <div style={{ fontSize: 20, color: String(color) }}>{String(value)}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{String(label)}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, marginTop: 10 }}>
            Engine: <strong>{status.engine}</strong>{status.plurAvailable ? " (PLUR CLI detected)" : " — PLUR CLI not installed; local fallback active"} · Sync: {status.syncEnabled ? "ENABLED" : "disabled (safe default)"}
            <div style={{ opacity: 0.7 }}>{status.plurDetail}</div>
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="memory title" value={learnTitle} onChange={(event) => setLearnTitle(event.target.value)} style={{ maxWidth: 220 }} />
            <select className="ur-input" value={learnType} onChange={(event) => setLearnType(event.target.value)} style={{ maxWidth: 180 }}>
              {["project_convention", "preference", "constraint", "architecture_decision", "operational_lesson", "debugging_lesson", "security_rule", "workflow", "note"].map((kind) => <option key={kind}>{kind}</option>)}
            </select>
            <input className="ur-input" placeholder="scope (default project)" value={learnScope} onChange={(event) => setLearnScope(event.target.value)} style={{ maxWidth: 200 }} />
            <input className="ur-input" placeholder="content" value={learnContent} onChange={(event) => setLearnContent(event.target.value)} style={{ maxWidth: 320 }} />
            <button className="ur-button" onClick={() => void learn()}>Learn</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="recall query" value={recallQuery} onChange={(event) => setRecallQuery(event.target.value)} style={{ maxWidth: 260 }} />
            <button className="ur-button" onClick={() => void recallNow()}>Recall</button>
          </div>
          {learnResult && <p style={{ fontSize: 12, marginTop: 6 }}>{learnResult}</p>}
          {recallResult && <p style={{ fontSize: 12, marginTop: 6 }}>{recallResult}</p>}
        </section>
      )}

      {(view === "engrams" || view === "candidates") && (
        <section className="ur-card">
          <h2 className="ur-section-title">{view === "candidates" ? "Candidates awaiting approval" : "Engram registry"}</h2>
          <ul className="ur-list">
            {engrams.map((engram) => (
              <li key={engram.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{engram.title}</strong>
                  <span style={{ color: STATE_COLORS[engram.state] }}>{engram.state}</span>
                </div>
                <div style={{ opacity: 0.75 }}>
                  {engram.memoryType} · Scope: {engram.scope} · Sensitivity: {engram.sensitivity} · Secret scan: {engram.secretScanStatus} · recalls {engram.recallCount}
                </div>
                {view === "candidates" && (
                  <div style={{ marginTop: 4 }}>
                    <button className="ur-button" onClick={() => void candidateAction(engram.id, true)}>Approve</button>{" "}
                    <button className="ur-button" onClick={() => void candidateAction(engram.id, false)}>Reject</button>
                  </div>
                )}
              </li>
            ))}
            {engrams.length === 0 && <li className="ur-list-item">Nothing here yet.</li>}
          </ul>
        </section>
      )}

      {view === "timeline" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Episode timeline</h2>
          <ul className="ur-list">
            {timeline.map((entry) => (
              <li key={entry.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <span style={{ color: entry.severity === "critical" || entry.severity === "error" ? "#e06c75" : "#7aa2f7" }}>{entry.eventType}</span> · {entry.summary}
                <div style={{ opacity: 0.7 }}>{entry.happenedAt.replace("T", " ").slice(0, 16)}</div>
              </li>
            ))}
            {timeline.length === 0 && <li className="ur-list-item">No episodes captured.</li>}
          </ul>
        </section>
      )}

      {view === "adapters" && status && (
        <section className="ur-card">
          <h2 className="ur-section-title">Agent adapters</h2>
          <ul className="ur-list">
            {status.adapters.map((adapter) => (
              <li key={adapter.adapterKey} className="ur-list-item" style={{ fontSize: 12 }}>
                <strong>{adapter.displayName}</strong> · {adapter.enabled ? "enabled" : "disabled"}
                <div style={{ opacity: 0.75 }}>capabilities: {adapter.capabilities.join(", ")}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "policies" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Default policy rules</h2>
          <ul className="ur-list">
            {[
              "deny durable learning of raw secret material",
              "deny sync to unknown/public remote (sync disabled by default)",
              "require approval for rescoping private/user memory to shared scope",
              "require approval for bulk forget",
              "allow project-scoped rules from trusted coding agents",
              "deny agents reading unrelated project scope",
              "force local scope for temporary_context",
              "redact sensitive content then require approval",
            ].map((rule) => <li key={rule} className="ur-list-item" style={{ fontSize: 12 }}>{rule}</li>)}
          </ul>
        </section>
      )}

      {view === "sync" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Sync (opt-in, fail-closed)</h2>
          <p style={{ fontSize: 12, opacity: 0.8 }}>
            Sync is disabled by default. Local scope never syncs; private visibility and secret-scan findings are blocked. Personal sync requires a private remote; unknown remotes fail closed.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="ur-input" placeholder="sync profile name" value={syncProfile} onChange={(event) => setSyncProfile(event.target.value)} style={{ maxWidth: 220 }} />
            <button className="ur-button" onClick={() => void syncPreview()}>Dry-run preview</button>
          </div>
          {syncResult && <p style={{ fontSize: 12, marginTop: 8 }}>{syncResult}</p>}
        </section>
      )}

      {view === "receipts" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Injection receipts</h2>
          <ul className="ur-list">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="ur-list-item" style={{ fontSize: 12 }}>
                {receipt.injectedCount} injected · {receipt.usedTokens}/{receipt.budgetTokens} tokens · {receipt.latencyMs}ms
                <div style={{ opacity: 0.7 }}>{receipt.createdAt.replace("T", " ").slice(0, 16)}</div>
              </li>
            ))}
            {receipts.length === 0 && <li className="ur-list-item">No injections recorded.</li>}
          </ul>
        </section>
      )}

      {view === "health" && doctor && (
        <section className="ur-card">
          <h2 className="ur-section-title">Memory doctor — {doctor.overall}</h2>
          <ul className="ur-list">
            {doctor.checks.map((check) => (
              <li key={check.name} className="ur-list-item" style={{ fontSize: 12 }}>
                <strong style={{ color: check.severity === "PASS" ? "#35c07d" : check.severity === "FAIL" ? "#e06c75" : check.severity === "MANUAL" ? "#7aa2f7" : "#e2b93b" }}>{check.severity}</strong> {check.name}
                <div style={{ opacity: 0.75 }}>{check.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
