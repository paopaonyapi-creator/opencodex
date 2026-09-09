// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory Studio

import { useState, useEffect } from "react";
import "../styles/media-memory.css";

interface MediaMemoryProps {
  apiBase?: string;
}

interface MemoryStats {
  totalItems: number;
  totalVectors: number;
  videoCount: number;
  imageCount: number;
  vectorDimensions: number;
  indexSizeBytes: number;
}

interface MemoryResultItem {
  id: string;
  title: string;
  similarityScore: number;
  mediaType: "video" | "image";
  summary: string;
  concepts?: string[];
  tags?: string[];
  specs?: {
    width: number;
    height: number;
    durationSec?: number;
    orientation?: string;
  };
  pacing?: {
    rhythmProfile?: string;
    cutsPerMinute?: number;
  };
  hook?: {
    openingType?: string;
    visualHookScore?: number;
  };
  highlights?: string[];
}

export default function MediaMemory({ apiBase = "" }: MediaMemoryProps) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<"all" | "video" | "image">("all");
  const [minScore, setMinScore] = useState(0.15);
  const [results, setResults] = useState<MemoryResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ragModalContent, setRagModalContent] = useState<string | null>(null);

  const executeSearch = async (searchQuery: string = query) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media-memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery || "general visual media",
          mediaType: mediaType === "all" ? undefined : mediaType,
          minScore,
          limit: 12,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      } else {
        fallbackSearch(searchQuery);
      }
    } catch {
      fallbackSearch(searchQuery);
    } finally {
      setLoading(false);
    }
  };

  const fallbackSearch = (_searchQuery: string) => {
    setResults([
      {
        id: "mitem_vjob_sample1",
        title: "Cyberpunk Cityscape Motion Hook",
        similarityScore: 0.94,
        mediaType: "video",
        summary: "Fast-paced vertical reel showing futuristic neon city with high dynamic cuts.",
        concepts: ["cyberpunk", "neon", "hook:kinetic", "high-energy"],
        specs: { width: 1080, height: 1920, durationSec: 15.0, orientation: "portrait" },
        pacing: { rhythmProfile: "HIGH-ENERGY", cutsPerMinute: 24 },
        hook: { openingType: "Kinetic Visual Hook", visualHookScore: 92 },
      },
      {
        id: "mitem_vjob_sample2",
        title: "AI Studio Drone Horizon",
        similarityScore: 0.81,
        mediaType: "video",
        summary: "Commercial landscape 4K footage over coastal cliffs suitable for Adobe Stock.",
        concepts: ["nature", "aerial", "qc:pass", "balanced"],
        specs: { width: 3840, height: 2160, durationSec: 28.5, orientation: "landscape" },
        pacing: { rhythmProfile: "BALANCED", cutsPerMinute: 8 },
        hook: { openingType: "Ambient Hook", visualHookScore: 78 },
      },
    ]);
  };

  const generateRagContext = async (targetQuery: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media-memory/rag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: targetQuery, maxItems: 3 }),
      });
      if (res.ok) {
        const data = await res.json();
        setRagModalContent(data.pack.contextMarkdown);
      } else {
        setRagModalContent(`## Media Memory RAG Context for "${targetQuery}"\n\n- Simulated contextual payload retrieved from offline index.`);
      }
    } catch {
      setRagModalContent(`## Media Memory RAG Context for "${targetQuery}"\n\n- Simulated contextual payload retrieved from offline index.`);
    }
  };

  const findSimilar = async (itemId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/agent-os/media-memory/similar/${itemId}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    fetch(`${apiBase}/api/agent-os/media-memory/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stats) setStats(d.stats);
      })
      .catch(() => {});

    fetch(`${apiBase}/api/agent-os/media-memory/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "video hook", minScore: 0.15, limit: 12 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.results) setResults(d.results);
      })
      .catch(() => {});
  }, [apiBase]);

  return (
    <div className="media-memory-container">
      {/* Header */}
      <div className="media-memory-header">
        <div>
          <h1>Visual Knowledge & Media Memory</h1>
          <p>Autonomous Multimodal Index, Semantic Retrieval & Agentic RAG Context Engine</p>
        </div>
        <button className="btn-primary" style={{ padding: "0.6rem 1.2rem" }} onClick={() => generateRagContext(query || "creative ideas")}>
          Synthesize RAG Pack
        </button>
      </div>

      {/* KPI Stats */}
      <div className="media-memory-stats-grid">
        <div className="memory-stat-card">
          <span className="stat-title">Total Media Items</span>
          <span className="stat-value">{stats?.totalItems ?? 0}</span>
        </div>
        <div className="memory-stat-card">
          <span className="stat-title">Video Assets</span>
          <span className="stat-value" style={{ color: "#38bdf8" }}>{stats?.videoCount ?? 0}</span>
        </div>
        <div className="memory-stat-card">
          <span className="stat-title">Image Assets</span>
          <span className="stat-value" style={{ color: "#a78bfa" }}>{stats?.imageCount ?? 0}</span>
        </div>
        <div className="memory-stat-card">
          <span className="stat-title">Dense Vectors</span>
          <span className="stat-value" style={{ color: "#4ade80" }}>{stats?.totalVectors ?? 0}</span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="media-memory-search-panel">
        <div className="search-input-row">
          <input
            type="text"
            placeholder="Search by visual concept, dialogue, hook style, or rhythm (e.g., 'high energy vertical reel', 'nature aerial 4k')..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && executeSearch()}
          />
          <button className="btn-primary" onClick={() => executeSearch()} disabled={loading}>
            {loading ? "Searching..." : "Search Memory"}
          </button>
        </div>

        <div className="search-filters-row">
          <div className="filter-group">
            <span style={{ fontSize: "0.85rem", color: "#8b949e" }}>Media Type:</span>
            <button className={`filter-btn ${mediaType === "all" ? "active" : ""}`} onClick={() => setMediaType("all")}>
              All
            </button>
            <button className={`filter-btn ${mediaType === "video" ? "active" : ""}`} onClick={() => setMediaType("video")}>
              Video
            </button>
            <button className={`filter-btn ${mediaType === "image" ? "active" : ""}`} onClick={() => setMediaType("image")}>
              Image
            </button>
          </div>

          <div className="filter-group">
            <span style={{ fontSize: "0.85rem", color: "#8b949e" }}>
              Min Similarity: {Math.round(minScore * 100)}%
            </span>
            <input
              type="range"
              min="0.05"
              max="0.8"
              step="0.05"
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value))}
              style={{ width: "120px" }}
            />
          </div>
        </div>
      </div>

      {/* Search Results Grid */}
      <div className="media-memory-results-grid">
        {results.map((item) => (
          <div key={item.id} className="media-card">
            <div className="card-header">
              <h3 className="card-title" title={item.title}>
                {item.title}
              </h3>
              <span className="score-badge">{Math.round(item.similarityScore * 100)}% MATCH</span>
            </div>

            <div className="card-body">
              <p style={{ margin: 0, lineHeight: 1.4 }}>{item.summary}</p>

              {item.specs && (
                <div style={{ fontSize: "0.8rem", color: "#c9d1d9" }}>
                  <span>{item.specs.width}x{item.specs.height}</span>
                  {item.specs.orientation && <span> &bull; {item.specs.orientation}</span>}
                  {item.specs.durationSec && <span> &bull; {item.specs.durationSec.toFixed(1)}s</span>}
                </div>
              )}

              {item.hook && (
                <div style={{ fontSize: "0.8rem", color: "#fbbf24" }}>
                  Hook: {item.hook.openingType || "Dynamic"} ({item.hook.visualHookScore || 0}/100)
                </div>
              )}

              {item.concepts && item.concepts.length > 0 && (
                <div className="concepts-list">
                  {item.concepts.slice(0, 4).map((c, i) => (
                    <span key={i} className="concept-tag">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="card-footer">
              <button
                className="filter-btn"
                style={{ fontSize: "0.75rem" }}
                onClick={() => findSimilar(item.id)}
              >
                Find Similar
              </button>
              <button
                className="filter-btn"
                style={{ fontSize: "0.75rem", borderColor: "#a78bfa", color: "#a78bfa" }}
                onClick={() => generateRagContext(item.title)}
              >
                RAG Context
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* RAG Preview Modal */}
      {ragModalContent && (
        <div className="rag-modal-overlay" onClick={() => setRagModalContent(null)}>
          <div className="rag-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="rag-modal-header">
              <h3 style={{ margin: 0, color: "#a78bfa" }}>Agent RAG Context Pack</h3>
              <button
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1.2rem" }}
                onClick={() => setRagModalContent(null)}
              >
                &times;
              </button>
            </div>
            <pre className="rag-modal-content">{ragModalContent}</pre>
            <div style={{ padding: "0.75rem 1.5rem", borderTop: "1px solid #30363d", display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(ragModalContent);
                  alert("Copied RAG context to clipboard!");
                }}
              >
                Copy Context
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
