# Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory

> **Project:** Pao-hubPro  
> **Phase:** 20.14  
> **Codename:** Visual Knowledge & Media Memory  
> **Status:** Implementation Complete  
> **Primary Goal:** Multimodal Vector Embeddings, Searchable Media Memory Index, and Agentic Retrieval over Video & Image Intelligence  
> **Language:** Thai-first, English-compatible  

---

## 1. Executive Summary

Phase 20.14 introduces **Pao-hubPro Visual Knowledge & Media Memory**, completing Section 104 of the Video Intelligence roadmap:

```text
Video Intelligence (Phase 20.13)
        ↓
Image Intelligence (Phase 16/19/20.6)
        ↓
Transcript & Pacing Analysis
        ↓
Multimodal Dense Embeddings (MediaEmbeddingEngine)
        ↓
Searchable Media Memory Index (MediaMemoryIndex / SQLite)
        ↓
Agent Retrieval & RAG Synthesis (MediaMemoryRetriever)
```

This subsystem enables autonomous agents (YouTube God OS scriptwriters, Adobe Stock Campaign Planners, and Reviewer Council) to search, retrieve, and cross-reference video clips, hero keyframes, editorial pacing rhythms, and spoken dialogue using natural language semantic queries.

---

## 2. Core Architecture

### 1. Unified Multimodal Schema (`MediaMemoryItem`)
Unifies video and image assets into a single searchable record:
- **Identifier & Media Type**: `id`, `mediaType: "video" | "image"`.
- **Content Metadata**: `title`, `summary`, `tags`, `concepts`, `entities`.
- **Technical Specifications**: `width`, `height`, `durationSec`, `fps`, `orientation`, `aspectRatio`, `codec`.
- **Temporal & Narrative Metrics**: `pacing` (cuts/min, rhythm profile), `hook` (opening style, hook score).
- **Speech Transcript**: `transcriptText`, timestamped `transcriptSegments`.
- **Visual Keyframes**: `heroFrames` with timestamps, aesthetic scores, and focal descriptions.

### 2. Provider-Neutral Dense Vector Engine (`MediaEmbeddingEngine`)
- **Offline First**: Deterministic 64-dimensional subword hash projection with term-frequency weighting and Euclidean L2 normalization.
- **Strict Privacy Guarantee**: `MEDIA_MEMORY_LOCAL_ONLY=1` makes zero external HTTP calls.
- **Multimodal Fusion**: Blends concept textual vectors (60%), visual geometry/cut dynamics (25%), and speech transcripts (15%).
- **Cosine Similarity**: Fast dot-product evaluation on normalized unit vectors.

### 3. Local-First SQLite Persistence (`MediaMemoryDbStore`)
- Stores records in `data/media/media-memory.sqlite3`.
- `media_memory_items`: Core item metadata, JSON serialized concepts, tags, and technical specs.
- `media_memory_vectors`: High-dimensional dense vectors indexed by `item_id` and `vector_type`.

### 4. Agent Retrieval & RAG Context Pack (`MediaMemoryRetriever`)
- **Semantic Search**: Natural language query matching against multimodal vectors with threshold and tag filtering.
- **Nearest Neighbors (`findSimilar`)**: Discovery of aesthetically or rhythmically similar media assets.
- **RAG Context Generator (`buildRagContext`)**: Synthesizes compact, structured Markdown prompt contexts for LLM agents.

---

## 3. WebMCP Tool Reference

Exposed under the `media_memory_*` namespace:

| Tool Name | Description |
| :--- | :--- |
| `media_memory_index_video` | Index a Phase 20.13 `VideoAnalysisReport` into media memory |
| `media_memory_index_item` | Index an arbitrary video or image asset with concepts and metadata |
| `media_memory_search` | Semantic natural language search with threshold scoring and filters |
| `media_memory_find_similar` | Find nearest neighbor media items by reference ID |
| `media_memory_get` | Retrieve full item and all associated vector embeddings |
| `media_memory_delete` | Remove an item and its vectors from media memory |
| `media_memory_stats` | Inspect index size, item count, and vector distribution |
| `media_memory_rag_context` | Generate compact RAG prompt context pack in Markdown |

---

## 4. REST Management API

Mounted under `/api/agent-os/media-memory/*` and `/api/media-memory/*`:

- `GET /stats`: Return storage and vector metrics.
- `POST /items`: Ingest and index new media item.
- `GET /items`: List indexed media items.
- `GET /items/:id`: Retrieve single media item.
- `DELETE /items/:id`: Delete media item.
- `POST /search`: Execute semantic vector search.
- `POST /similar/:id`: Find similar items.
- `POST /rag`: Generate RAG prompt context pack.

---

## 5. Security & Invariants

1. **No `shell=True`**: All CLI and subprocess execution strictly uses safe argv arrays.
2. **Offline Mode**: Operates fully offline without cloud API keys.
3. **Core-Lab Boundary**: Preserved through lazy dynamic route imports in `src/server/management/agent-os-routes.ts`.
