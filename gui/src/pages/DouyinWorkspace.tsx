// Phase 20.26 — Pao-hubPro × Douyin Media Intelligence & Downloader Engine
// Glassmorphic Control Dashboard

import { useState, useEffect, useCallback } from "react";
import "../styles/universal-registry.css";

interface DouyinWorkspaceProps {
  apiBase?: string;
}

interface HealthData {
  provider: { enabled: boolean; upstreamAvailable: boolean; reason?: string };
  search: boolean;
  hotBoard: boolean;
  comments: boolean;
  transcription: boolean;
  browserFallback: boolean;
  authSession: boolean;
  live: boolean;
  publicOnly: boolean;
  circuit: string;
}

interface MediaItem {
  id: string;
  providerItemId: string;
  type: string;
  canonicalUrl: string;
  creatorName?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  tags: string[];
  statistics: Record<string, number>;
  rights: { ownership: string; researchOnly: boolean; commercialReuseAllowed: boolean };
}

interface HotEntry {
  rank: number;
  keyword: string;
  score?: number;
}

interface CreatorItem {
  id: string;
  providerCreatorId: string;
  displayName: string;
  canonicalUrl: string;
  lastSyncedAt?: string;
}

function pillClass(value: boolean, okWhen = true): string {
  const ok = value === okWhen;
  return `ur-pill ${ok ? "ok" : "muted"}`;
}

export function DouyinWorkspace({ apiBase = "" }: DouyinWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "inspector" | "search" | "trends" | "library">("overview");
  const [health, setHealth] = useState<HealthData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [inspectResult, setInspectResult] = useState<MediaItem | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [searchItems, setSearchItems] = useState<MediaItem[]>([]);
  const [hotEntries, setHotEntries] = useState<HotEntry[]>([]);
  const [previousEntries, setPreviousEntries] = useState<HotEntry[]>([]);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [creators, setCreators] = useState<CreatorItem[]>([]);

  const flash = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [healthRes, itemsRes, creatorsRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/media/douyin/health`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/media/douyin/items?limit=20`).then((r) => r.json()),
        fetch(`${apiBase}/api/agent-os/media/douyin/creators`).then((r) => r.json()),
      ]);
      if (healthRes?.data) setHealth(healthRes.data);
      if (itemsRes?.data?.items) setItems(itemsRes.data.items);
      if (creatorsRes?.data?.creators) setCreators(creatorsRes.data.creators);
    } catch {
      // offline or preview mode
    }
  }, [apiBase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    const interval = setInterval(() => void loadData(), 6000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadData]);

  const handleInspect = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setInspectError(null);
    setInspectResult(null);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/douyin/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data?.ok) {
        setInspectResult(data.data.item);
      } else {
        setInspectError(data?.error?.message || "Inspect failed.");
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/douyin/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), usageClass: "research_reference" }),
      });
      const data = await res.json();
      flash(data?.ok ? "Download queued (research-only rights)." : data?.error?.message || "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/douyin/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), maxItems: 20 }),
      });
      const data = await res.json();
      if (data?.ok) {
        setSearchItems(data.data.items);
        flash(`Snapshot ${data.data.snapshot.id} saved (${data.data.items.length} items).`);
      } else {
        flash(data?.error?.message || "Search failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleHotBoard = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media/douyin/hot-board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data?.ok) {
        setHotEntries(data.data.entries);
        setPreviousEntries(data.data.previous ?? []);
        flash("Hot board snapshot captured.");
      } else {
        flash(data?.error?.message || "Hot board failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const rankDelta = (keyword: string): number | null => {
    if (previousEntries.length === 0) return null;
    const current = hotEntries.find((e) => e.keyword === keyword);
    const previous = previousEntries.find((e) => e.keyword === keyword);
    if (!current || !previous) return null;
    return previous.rank - current.rank;
  };

  return (
    <div className="ur-wrap">
      <header className="ur-header">
        <div>
          <h1>Douyin Intelligence</h1>
          <p className="ur-sub">
            Provider beneath the Media Acquisition Core · public-only research · research-only rights
          </p>
        </div>
        <div className="ur-header-actions">
          {message && <span className="ur-toast">{message}</span>}
        </div>
      </header>

      <nav className="ur-tabs">
        {(["overview", "inspector", "search", "trends", "library"] as const).map((tab) => (
          <button key={tab} className={`ur-tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && health && (
        <section className="ur-section">
          <article className="ur-card">
            <div className="ur-card-head">
              <strong>Provider</strong>
              <span className={health.provider.enabled && health.provider.upstreamAvailable ? "ur-pill ok" : "ur-pill warn"}>
                {health.provider.upstreamAvailable ? "upstream available" : "degraded"}
              </span>
              <span className={pillClass(health.publicOnly)}>public-only {health.publicOnly ? "on" : "off"}</span>
              <span className={`ur-pill ${health.circuit === "closed" ? "ok" : "bad"}`}>circuit {health.circuit}</span>
            </div>
            {health.provider.reason && <p className="ur-desc">{health.provider.reason}</p>}
            <p className="ur-reasons">
              Set DOUYIN_DOWNLOADER_HOME to a pinned douyin-downloader checkout (MIT) to enable acquisition; search,
              hot board, and comments share the same upstream availability.
            </p>
          </article>
          <div className="ur-stat-grid">
            <div className="ur-stat"><strong>{health.search ? "on" : "off"}</strong><span>search</span></div>
            <div className="ur-stat"><strong>{health.hotBoard ? "on" : "off"}</strong><span>hot board</span></div>
            <div className="ur-stat"><strong>{health.comments ? "on" : "off"}</strong><span>comments</span></div>
            <div className="ur-stat"><strong>{health.transcription ? "on" : "off"}</strong><span>transcription</span></div>
            <div className="ur-stat"><strong>{health.browserFallback ? "on" : "off"}</strong><span>browser fallback</span></div>
            <div className="ur-stat"><strong>{health.authSession ? "on" : "off"}</strong><span>auth session</span></div>
            <div className="ur-stat"><strong>{health.live ? "on" : "off"}</strong><span>live</span></div>
          </div>
        </section>
      )}

      {activeTab === "inspector" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <input
              className="ur-input grow"
              placeholder="Paste a Douyin URL (video / note / gallery / music / short link)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="ur-btn primary" onClick={() => void handleInspect()} disabled={busy}>
              {busy ? "Working…" : "Inspect"}
            </button>
            <button className="ur-btn" onClick={() => void handleDownload()} disabled={busy}>
              Download Reference
            </button>
          </div>
          {inspectError && <p className="ur-empty">{inspectError}</p>}
          {inspectResult && (
            <article className="ur-card">
              <div className="ur-card-head">
                <strong>{inspectResult.title}</strong>
                <span className="ur-pill muted">{inspectResult.type}</span>
                <span className="ur-pill ok">research-only</span>
                <span className="ur-pill muted">ownership {inspectResult.rights.ownership}</span>
              </div>
              <p className="ur-desc">{inspectResult.description || "—"}</p>
              <div className="ur-meta">
                <span>{inspectResult.creatorName || "unknown creator"}</span>
                <span>· {inspectResult.providerItemId}</span>
                {inspectResult.publishedAt && <span>· {inspectResult.publishedAt}</span>}
              </div>
              <div className="ur-tags">
                {inspectResult.tags.map((tag) => <span key={tag} className="ur-tag">{tag}</span>)}
              </div>
            </article>
          )}
        </section>
      )}

      {activeTab === "search" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <input className="ur-input grow" placeholder="Keyword (bounded snapshot)" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="ur-btn primary" onClick={() => void handleSearch()} disabled={busy}>Search</button>
          </div>
          {searchItems.map((item) => (
            <article key={item.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{item.title}</strong>
                <span className="ur-pill muted">{item.type}</span>
              </div>
              <p className="ur-meta">{item.creatorName || "unknown"} · {item.providerItemId}</p>
            </article>
          ))}
        </section>
      )}

      {activeTab === "trends" && (
        <section className="ur-section">
          <div className="ur-toolbar">
            <button className="ur-btn primary" onClick={() => void handleHotBoard()} disabled={busy}>Capture Snapshot</button>
          </div>
          {hotEntries.length > 0 && (
            <article className="ur-card">
              {hotEntries.map((entry) => {
                const delta = rankDelta(entry.keyword);
                return (
                  <div key={`${entry.rank}-${entry.keyword}`} className="ur-card-head">
                    <strong>#{entry.rank}</strong>
                    <span>{entry.keyword}</span>
                    {entry.score !== undefined && <span className="ur-pill muted">{entry.score}</span>}
                    {delta !== null && <span className={`ur-pill ${delta >= 0 ? "ok" : "warn"}`}>{delta >= 0 ? `+${delta}` : delta}</span>}
                  </div>
                );
              })}
            </article>
          )}
          {hotEntries.length === 0 && <p className="ur-empty">No snapshot yet — hot-board history is append-only for trend comparison.</p>}
        </section>
      )}

      {activeTab === "library" && (
        <section className="ur-section">
          <h3 className="ur-sub">Canonical items</h3>
          {items.map((item) => (
            <article key={item.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{item.title}</strong>
                <span className="ur-pill muted">{item.type}</span>
                <span className="ur-pill ok">research-only</span>
              </div>
              <p className="ur-meta">{item.creatorName || "unknown"} · {item.providerItemId}</p>
            </article>
          ))}
          <h3 className="ur-sub">Creators</h3>
          {creators.map((creator) => (
            <article key={creator.id} className="ur-card">
              <div className="ur-card-head">
                <strong>{creator.displayName}</strong>
                <span className="ur-pill muted">{creator.providerCreatorId}</span>
                {creator.lastSyncedAt && <span className="ur-pill muted">synced {new Date(creator.lastSyncedAt).toLocaleString()}</span>}
              </div>
            </article>
          ))}
          {items.length === 0 && creators.length === 0 && <p className="ur-empty">Library is empty — inspect or search to populate canonical items.</p>}
        </section>
      )}
    </div>
  );
}
