# Phase 21 — NotebookLM Knowledge Provider Adapter

## 1. Optional Architecture Boundary
NotebookLM is an **optional external knowledge provider** behind the unified `KnowledgeProvider` interface.

## 2. Operating Rules
1. **Disabled by Default**: Active only when `PAO_NOTEBOOKLM_ENABLED=true` is set.
2. **Circuit Breaker**: Trips after 3 consecutive errors; automatically re-arms after 60 seconds.
3. **Timeout Ceiling**: Strict 5000ms timeout per query.
4. **Graceful Fallback**: External network failure or invalid credentials never crashes local search.
5. **Secret Isolation**: API keys and session credentials are read exclusively from environment variables and never logged or serialized into evidence bundles.
