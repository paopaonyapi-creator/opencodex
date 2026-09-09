# Pao-hubPro Visual Knowledge & Media Memory Guide

This guide describes how to use the **Media Memory** subsystem in Pao-hubPro for indexing, semantic search, and RAG retrieval.

## CLI Usage

Run commands with `bun run scripts/pao-memory.ts`:

```bash
# 1. View storage statistics
bun run scripts/pao-memory.ts stats

# 2. Semantic Search
bun run scripts/pao-memory.ts search "high energy vertical hook tech" --min-score 0.2

# 3. Find Similar Assets
bun run scripts/pao-memory.ts similar mitem_vjob_12345 --limit 5

# 4. Generate RAG Context for LLM
bun run scripts/pao-memory.ts rag "autonomous AI stock videos" --limit 3
```

## REST API Endpoints

All endpoints require the admin token when called externally:

- `GET /api/agent-os/media-memory/stats`
- `POST /api/agent-os/media-memory/search`
  ```json
  {
    "query": "cinematic landscape sunset",
    "mediaType": "video",
    "minScore": 0.2,
    "limit": 10
  }
  ```
- `POST /api/agent-os/media-memory/rag`
  ```json
  {
    "query": "fast-paced TikTok hook inspiration",
    "maxItems": 3
  }
  ```

## WebMCP Tools

Agents can call:
- `media_memory_search`
- `media_memory_rag_context`
- `media_memory_index_video`
- `media_memory_find_similar`
