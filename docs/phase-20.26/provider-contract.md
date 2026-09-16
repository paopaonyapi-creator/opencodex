# Phase 20.26 — Provider Contract

Boundary: **Douyin is a provider; Pao-hubPro remains the control plane.**

## Module layout (repo convention)

```text
src/agent-os/douyin/
  types.ts       canonical schemas + upstream client contract
  errors.ts      DOUYIN_* error taxonomy (retryable set)
  flags.ts       FEATURE_DOUYIN_* + DOUYIN_PUBLIC_ONLY
  url-policy.ts  domain-family allowlist + classification + redirect-hop validation
  redact.ts      cookie/session/CSRF redaction for every surface
  rights.ts      research-only defaults + Adobe Stock hard boundary
  normalize.ts   raw upstream -> canonical (fail-closed drift detection)
  upstream.ts    CLI client (fixed arg arrays, generated config, allowlisted python)
  store.ts       db v32 intelligence tables + limits + idempotency
  adapter.ts     MediaProvider implementation for the Phase 20.24 router
  service.ts     control-plane facade (rate, breaker, audit, queue reuse)
  mcp-tools.ts   typed WebMCP tool suite

src/server/management/douyin-routes.ts   REST surface
tests/douyin-intelligence.test.ts        32 tests
```

## MediaProvider contract (Phase 20.24)

`DouyinProvider` (name `douyin`) implements `inspect / download / cancel /
getStatus / healthCheck`. It is registered in `MediaProviderRouter` and is
selected **only** for Douyin-family URLs (platform routing in `router.inspect`
and explicit `provider: "douyin"` on queue jobs). Health degrades to
`available: false` with a reason when `FEATURE_DOUYIN_PROVIDER` is off or
`DOUYIN_DOWNLOADER_HOME` is not a pinned checkout — generic providers keep
working and Douyin URLs fail typed (`MEDIA_PROVIDER_OFFLINE`) instead of
receiving fabricated metadata.

## Operations

| Operation | Route/MCP | Risk | Notes |
|---|---|---|---|
| inspect | `POST /inspect`, `douyin_inspect` | R0 | public metadata, normalized + stored |
| download | `POST /download`, `douyin_download` | R2 | existing Phase 20.24 queue; idempotency key; research-only rights |
| search | `POST /search`, `douyin_search` | R1 | bounded, immutable snapshot |
| hot_board | `POST /hot-board`, `douyin_hot_board` | R0 | append-only snapshots + rank deltas |
| creator sync | `POST /creators/sync`, `douyin_sync_creator` | R3 | incremental; registry marks approval-required |
| comments | `POST /comments/fetch`, `douyin_get_comments` | R1 | untrusted data; dedupe; bounded |
| transcribe | `POST /transcribe`, `douyin_transcribe` | R1 | requires artifact; degrades clearly |
| live record | (flag off) | R3 | not implemented behind the flag |
| connect account | (flag off) | R4 | session rows hold vault refs only |

## Capability discovery & graceful degradation (doc §84-§85)

`GET /health` reports separate dimensions (provider/upstream, search,
hot board, comments, transcription, browser fallback, auth session, live,
public-only, circuit state). Missing dependencies disable individual
capabilities instead of crashing the provider.

## Error taxonomy (doc §59)

`DOUYIN_INVALID_URL, DOUYIN_UNSUPPORTED_URL, DOUYIN_NOT_FOUND,
DOUYIN_UNAVAILABLE, DOUYIN_AUTH_REQUIRED, DOUYIN_SESSION_EXPIRED,
DOUYIN_RATE_LIMITED, DOUYIN_BROWSER_REQUIRED, DOUYIN_HUMAN_ACTION_REQUIRED,
DOUYIN_DOWNLOAD_FAILED, DOUYIN_STORAGE_FULL, DOUYIN_CANCELLED,
DOUYIN_UPSTREAM_CHANGED, DOUYIN_PROVIDER_UNHEALTHY, DOUYIN_LIMIT_EXCEEDED,
DOUYIN_DISABLED, DOUYIN_RIGHTS_BLOCKED`. Retryable: UNAVAILABLE,
RATE_LIMITED, PROVIDER_UNHEALTHY. Auth/policy/invalid-input failures are
never retried blindly.
