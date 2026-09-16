// Phase 20.41 — Memory Plane dashboard (spec §27): Overview, Explorer,
// Recall Lab (score provenance + degradation), Mutation Safety
// (preview→confirm with receipts + stale handling), OAuth Clients.

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface MemoryPlaneProps {
  apiBase?: string;
}

interface MemoryRecordView {
  id: string;
  title: string;
  content: string;
  kind: string;
  authority: string;
  currentRevision: number;
  currentHash: string;
  indexingState: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface StatsView {
  memoriesTotal: number;
  byAuthority: Record<string, number>;
  workspaces: number;
  projects: number;
  indexed: number;
  pendingIndex: number;
  degradedIndex: number;
  chunks: number;
  embeddings: number;
  observations: number;
  traces: number;
  previewsOpen: number;
  provider: { state: string; provider: string; model: string; dimensions: number; detail: string };
}

interface RecallResultView {
  memoryId: string;
  revision: number;
  sourceHash: string;
  title: string;
  content?: string;
  kind: string;
  authority: string;
  tags: string[];
  rank: number;
  scores: { keyword?: number; semantic?: number; fused?: number };
  rankProvenance: { keywordRank?: number; semanticRank?: number; fusedRank?: number };
}

interface RecallResponseView {
  requestedMode: string;
  effectiveMode: string;
  degraded: boolean;
  degradeReason?: string;
  traceId?: string;
  results: RecallResultView[];
}

interface MutationPreviewView {
  previewId: string;
  targetId: string;
  expectedRevision: number | null;
  expectedSourceHash: string | null;
  impact: Record<string, unknown>;
  confirmationReceipt: string;
  expiresAt: string;
}

interface OAuthClientView {
  id: string;
  clientName: string;
  scope: string;
  status: string;
  tokenEndpointAuth?: string;
  createdAt: string;
}

async function api<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? "request failed");
  return body.data as T;
}

type ViewKey = "overview" | "explorer" | "recall" | "mutations" | "oauth";

const AUTHORITY_COLORS: Record<string, string> = {
  authoritative: "#35c07d", derived: "#7aa2f7", observed: "#e2b93b", ephemeral: "#8a93a6",
};
const INDEX_COLORS: Record<string, string> = {
  ready: "#35c07d", pending: "#e2b93b", degraded: "#e06c75",
};

export function MemoryPlane({ apiBase = "" }: MemoryPlaneProps) {
  const [view, setView] = useState<ViewKey>("overview");
  const [stats, setStats] = useState<StatsView | null>(null);
  const [memories, setMemories] = useState<MemoryRecordView[]>([]);
  const [detail, setDetail] = useState<{ memory: MemoryRecordView; revisions: Array<{ revision: number; contentHash: string; createdAt: string }>; tags: string[]; supersession: Array<{ supersedesMemoryId: string; supersededRevision: number }>; chunks: number } | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [recallResult, setRecallResult] = useState<RecallResponseView | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState("decision");
  const [newAuthority, setNewAuthority] = useState("observed");
  const [preview, setPreview] = useState<MutationPreviewView | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [clients, setClients] = useState<OAuthClientView[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api<StatsView>(apiBase, "/api/memory/stats"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  const loadMemories = useCallback(async () => {
    try {
      const data = await api<{ memories: MemoryRecordView[] }>(apiBase, "/api/memory/memories");
      setMemories(data.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase]);

  const loadClients = useCallback(async () => {
    try {
      const data = await api<{ clients: OAuthClientView[] }>(apiBase, "/api/memory/oauth/clients");
      setClients(data.clients);
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
    const initial = setTimeout(() => {
      void loadMemories();
      if (view === "oauth") void loadClients();
    }, 0);
    return () => clearTimeout(initial);
  }, [loadMemories, loadClients, view]);

  const openDetail = async (memoryId: string) => {
    setSelectedMemory(memoryId);
    try {
      setDetail(await api(apiBase, "/api/memory/memories/detail?id=" + encodeURIComponent(memoryId)));
      setView("explorer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remember = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      const result = await api<{ memoryId: string; indexing: { status: string } }>(apiBase, "/api/memory/memories", {
        method: "POST",
        body: JSON.stringify({ title: newTitle, content: newContent, kind: newKind, authority: newAuthority, agentKey: "dashboard", tags: ["dashboard"] }),
      });
      setNewTitle("");
      setNewContent("");
      await loadMemories();
      await refreshStats();
      setSelectedMemory(result.memoryId);
      void openDetail(result.memoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runRecall = async () => {
    if (!query.trim()) return;
    try {
      setRecallResult(await api<RecallResponseView>(apiBase, "/api/memory/recall", {
        method: "POST",
        body: JSON.stringify({ query, mode, limit: 8 }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const forgetPreview = async (memoryId: string) => {
    try {
      setConfirmStatus(null);
      setPreview(await api<MutationPreviewView>(apiBase, "/api/memory/memories/forget/preview", {
        method: "POST",
        body: JSON.stringify({ memoryId }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const forgetConfirm = async () => {
    if (!preview) return;
    try {
      const result = await api<{ status: string; detail: string }>(apiBase, "/api/memory/memories/forget/confirm", {
        method: "POST",
        body: JSON.stringify({ memoryId: preview.targetId, confirmationReceipt: preview.confirmationReceipt }),
      });
      setConfirmStatus(result.status + ": " + result.detail);
      if (result.status === "completed") {
        setPreview(null);
        await loadMemories();
        await refreshStats();
      }
    } catch (err) {
      setConfirmStatus("failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="ur-page">
      <header className="ur-header">
        <div>
          <h1 className="ur-title">Memory Plane</h1>
          <p className="ur-subtitle">Trustworthy shared memory: authority tiers, immutable revisions, honest recall, preview-confirm mutations</p>
        </div>
        <div className="ur-actions">
          {(["overview", "explorer", "recall", "mutations", "oauth"] as ViewKey[]).map((key) => (
            <button key={key} className="ur-button" style={{ opacity: view === key ? 1 : 0.6 }} onClick={() => setView(key)}>{key}</button>
          ))}
        </div>
      </header>

      {error && <div className="ur-error" role="alert">{error}</div>}

      {view === "overview" && stats && (
        <section className="ur-card">
          <h2 className="ur-section-title">Overview</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              ["Memories", stats.memoriesTotal, "#7aa2f7"],
              ["Authoritative", stats.byAuthority.authoritative ?? 0, "#35c07d"],
              ["Observed", stats.byAuthority.observed ?? 0, "#e2b93b"],
              ["Derived", stats.byAuthority.derived ?? 0, "#7aa2f7"],
              ["Workspaces", stats.workspaces, "#8a93a6"],
              ["Projects", stats.projects, "#8a93a6"],
              ["Indexed", stats.indexed, "#35c07d"],
              ["Pending index", stats.pendingIndex, "#e2b93b"],
              ["Degraded index", stats.degradedIndex, "#e06c75"],
              ["Chunks", stats.chunks, "#8a93a6"],
              ["Embeddings", stats.embeddings, "#8a93a6"],
              ["Observations", stats.observations, "#8a93a6"],
              ["Traces", stats.traces, "#8a93a6"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="ur-card" style={{ padding: "8px 14px", minWidth: 96 }}>
                <div style={{ fontSize: 20, color: String(color) }}>{String(value)}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{String(label)}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, marginTop: 10 }}>
            Embedding provider: <strong>{stats.provider.provider}</strong> / {stats.provider.model} ({stats.provider.dimensions} dims) — health {stats.provider.state}
            <div style={{ opacity: 0.7 }}>{stats.provider.detail}</div>
          </p>
        </section>
      )}

      {view === "explorer" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Create memory</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} style={{ maxWidth: 300 }} />
            <select className="ur-input" value={newKind} onChange={(event) => setNewKind(event.target.value)} style={{ maxWidth: 140 }}>
              {["decision", "preference", "constraint", "fact", "runbook", "retrospective", "cheatsheet", "note", "incident", "other"].map((kind) => <option key={kind}>{kind}</option>)}
            </select>
            <select className="ur-input" value={newAuthority} onChange={(event) => setNewAuthority(event.target.value)} style={{ maxWidth: 140 }}>
              {["observed", "authoritative", "derived", "ephemeral"].map((authority) => <option key={authority}>{authority}</option>)}
            </select>
            <button className="ur-button" onClick={() => void remember()}>Remember</button>
          </div>
          <textarea className="ur-input" placeholder="content" value={newContent} onChange={(event) => setNewContent(event.target.value)} rows={3} style={{ width: "100%", marginBottom: 12 }} />
          <h2 className="ur-section-title">Memories ({memories.length})</h2>
          <ul className="ur-list">
            {memories.map((memory) => (
              <li key={memory.id} className="ur-list-item" style={{ cursor: "pointer", borderColor: selectedMemory === memory.id ? "#7aa2f7" : undefined }} onClick={() => void openDetail(memory.id)}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 12 }}>{memory.title}</strong>
                  <span>
                    <span style={{ color: AUTHORITY_COLORS[memory.authority], fontSize: 11 }}>{memory.authority}</span>
                    {" "}
                    <span style={{ color: INDEX_COLORS[memory.indexingState], fontSize: 11 }}>{memory.indexingState}</span>
                  </span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {memory.kind} · rev {memory.currentRevision} · {memory.currentHash.slice(0, 16)}…
                </div>
              </li>
            ))}
            {memories.length === 0 && <li className="ur-list-item">No memories yet.</li>}
          </ul>
          {detail && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <h3 className="ur-section-title">Detail — {detail.memory.title}</h3>
              <div style={{ opacity: 0.85, whiteSpace: "pre-wrap", marginBottom: 8 }}>{detail.memory.content}</div>
              <div style={{ opacity: 0.75 }}>
                rev {detail.memory.currentRevision} · hash {detail.memory.currentHash.slice(0, 24)}… · {detail.chunks} chunk(s) · tags: {detail.tags.join(", ") || "none"}
              </div>
              <div style={{ opacity: 0.75 }}>Revisions: {detail.revisions.map((revision) => "r" + revision.revision + "@" + revision.contentHash.slice(7, 15)).join(" → ")}</div>
              {detail.supersession.length > 0 && <div style={{ opacity: 0.75 }}>Supersedes: {detail.supersession.map((link) => link.supersedesMemoryId.slice(0, 12) + "@r" + link.supersededRevision).join(", ")}</div>}
              <button className="ur-button" style={{ marginTop: 8, borderColor: "#e06c75" }} onClick={() => { setView("mutations"); void forgetPreview(detail.memory.id); }}>Forget (preview)…</button>
            </div>
          )}
        </section>
      )}

      {view === "recall" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Recall Lab</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input className="ur-input" placeholder="query" value={query} onChange={(event) => setQuery(event.target.value)} style={{ maxWidth: 320 }} onKeyDown={(event) => { if (event.key === "Enter") void runRecall(); }} />
            <select className="ur-input" value={mode} onChange={(event) => setMode(event.target.value)} style={{ maxWidth: 120 }}>
              {["hybrid", "keyword", "semantic"].map((option) => <option key={option}>{option}</option>)}
            </select>
            <button className="ur-button" onClick={() => void runRecall()}>Recall</button>
          </div>
          {recallResult && (
            <div>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                requested <strong>{recallResult.requestedMode}</strong> → effective <strong>{recallResult.effectiveMode}</strong>
                {recallResult.degraded && <span style={{ color: "#e2b93b" }}> · DEGRADED: {recallResult.degradeReason}</span>}
                {recallResult.traceId && <span style={{ opacity: 0.6 }}> · trace {recallResult.traceId}</span>}
              </div>
              <ul className="ur-list">
                {recallResult.results.map((result) => (
                  <li key={result.memoryId} className="ur-list-item" style={{ fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>#{result.rank} {result.title}</strong>
                      <span style={{ opacity: 0.7 }}>
                        keyword {result.scores.keyword?.toFixed(3) ?? "—"} · semantic {result.scores.semantic?.toFixed(3) ?? "—"} · fused {result.scores.fused?.toFixed(4) ?? "—"}
                      </span>
                    </div>
                    <div style={{ opacity: 0.75 }}>
                      kw#{result.rankProvenance.keywordRank ?? "—"} sem#{result.rankProvenance.semanticRank ?? "—"} fused#{result.rankProvenance.fusedRank ?? "—"} · rev {result.revision} · {result.sourceHash.slice(0, 16)}… · {result.kind}/{result.authority}
                    </div>
                    {result.content && <div style={{ opacity: 0.85, marginTop: 4 }}>{result.content.slice(0, 240)}{result.content.length > 240 ? "…" : ""}</div>}
                  </li>
                ))}
                {recallResult.results.length === 0 && <li className="ur-list-item">No results.</li>}
              </ul>
            </div>
          )}
        </section>
      )}

      {view === "mutations" && (
        <section className="ur-card">
          <h2 className="ur-section-title">Mutation Safety</h2>
          <p style={{ fontSize: 12, opacity: 0.8 }}>
            Destructive operations are preview-first: an impact snapshot is taken and a server-signed receipt is issued. Confirming a stale or expired preview returns a conflict and mutates nothing.
          </p>
          {!preview && <p style={{ opacity: 0.6 }}>Pick a memory in the Explorer and choose “Forget (preview)…”.</p>}
          {preview && (
            <div style={{ fontSize: 12 }}>
              <div>preview <strong>{preview.previewId}</strong> · target {preview.targetId}</div>
              <div>expected revision {preview.expectedRevision} · hash {preview.expectedSourceHash?.slice(0, 24)}…</div>
              <div>impact: {JSON.stringify(preview.impact)}</div>
              <div style={{ opacity: 0.6, marginTop: 4 }}>expires {preview.expiresAt}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="ur-button" style={{ borderColor: "#e06c75" }} onClick={() => void forgetConfirm()}>Confirm forget</button>
                <button className="ur-button" onClick={() => setPreview(null)}>Cancel</button>
              </div>
              {confirmStatus && <p style={{ marginTop: 8, color: confirmStatus.startsWith("completed") ? "#35c07d" : "#e2b93b" }}>{confirmStatus}</p>}
            </div>
          )}
        </section>
      )}

      {view === "oauth" && (
        <section className="ur-card">
          <h2 className="ur-section-title">OAuth Clients</h2>
          <p style={{ fontSize: 12, opacity: 0.8 }}>
            Remote MCP clients register via DCR and authenticate with PKCE S256. Consent per scope is operator-approved. Raw tokens are never displayed or stored.
          </p>
          <ul className="ur-list">
            {clients.map((client) => (
              <li key={client.id} className="ur-list-item" style={{ fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{client.clientName}</strong>
                  <span style={{ color: client.status === "active" ? "#35c07d" : "#e06c75" }}>{client.status}</span>
                </div>
                <div style={{ opacity: 0.75 }}>{client.id} · scopes: {client.scope} · auth: {client.tokenEndpointAuth}</div>
              </li>
            ))}
            {clients.length === 0 && <li className="ur-list-item">No clients registered yet.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
