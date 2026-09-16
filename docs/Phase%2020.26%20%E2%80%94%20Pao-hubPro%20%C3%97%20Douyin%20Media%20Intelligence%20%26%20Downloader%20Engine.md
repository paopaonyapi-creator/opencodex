# Phase 20.26 — Pao-hubPro × Douyin Media Intelligence & Downloader Engine

> **Status:** Implemented (MVP vertical slice + intelligence layer)  
> **Project:** Pao-hubPro  
> **Phase:** 20.26  
> **Codename:** Douyin Media Intelligence & Downloader Engine  
> **Primary Reference:** https://github.com/jiji262/douyin-downloader (MIT)  
> **Depends On:** Phase 20.24 Media Acquisition & MCP Engine, Phase 20.25 Universal Agent Capability Registry  

---

## 1. Executive Decision — honored

Douyin is implemented as a **provider/adapter beneath the existing Media
Acquisition Core**, not a second downloader architecture:

- The `DouyinProvider` implements the Phase 20.24 `MediaProvider` contract and
  is registered into the existing `MediaProviderRouter`.
- Downloads flow through the **existing Phase 20.24 queue** (`provider:
  "douyin"` job envelope) and register artifacts with the **existing
  ArtifactRegistry** (SHA-256, provenance, usage classes).
- Capabilities are registered into the **Phase 20.25 Universal Registry** as
  `social.douyin.*` — no agent hard-codes Douyin routing.
- Douyin-specific intelligence (search snapshots, hot board, comments,
  creators, transcripts) extends the shared Agent OS store (db v32); media
  files stay in the Phase 20.24 storage/artifact layer.

## 2. Upstream Audit Summary (docs/phase-20.26/upstream-audit.md)

Verified against the upstream repository page on 2026-09-13:

- **License:** MIT (notices preserved in the audit doc; no upstream code is
  vendored into this repository).
- **Entrypoint:** `python run.py -c config.yml`; flags `-u`, `--search`,
  `--hot-board`, `--serve` (FastAPI REST), `python -m tools.cookie_fetcher`.
- **Config keys observed:** `path`, `mode` (post/like/mix/music/collect/
  collectmix), `number`, `thread`, `retry_times`, `cookies.{msToken,ttwid,
  odin_tt,passport_csrf_token,sid_guard}`, `browser_fallback.*`,
  `transcript.*`, `comments.*`, `live.*`, `server.*`.
- **Commit SHA:** not captured from the web view — MUST be pinned and recorded
  in `DOUYIN_DOWNLOADER_HOME` before production use (dependency pinning, doc
  §61). No upstream code was executed during this integration.

## 3. Adapter Boundary Decision (doc §8-§9)

**Option C — controlled CLI adapter** for the MVP (`python run.py`, fixed
argument arrays, generated minimal config with the documented `path` key,
never a shell, never arbitrary flags), upgrading to the documented `--serve`
localhost REST sidecar for production. Rationale: smallest safe integration,
binary allowlist via the shared Phase 20.24 safe process runner, clear audit
boundary, and the upstream stays a pinned external dependency (untrusted,
DATA+process boundary only).

## 4. What Shipped

| Area | Delivered |
|---|---|
| Provider | `DouyinProvider` (MediaProvider contract) + platform routing in `MediaProviderRouter` (Douyin URLs never get fabricated metadata from generic providers) |
| URL policy | Classifier for video/note/gallery/user/collection/mix/music/live/short-link; SSRF fail-closed via the shared policy; every redirect hop must stay in the Douyin domain family |
| Canonical schemas | Canonical media item, creator (stable `sec_uid` identity), comment, transcript; raw payloads referenced, never spread |
| Intelligence store | db v32: douyin_creators, douyin_media_items, douyin_search_snapshots, douyin_hot_board_snapshots (append-only), douyin_comments, douyin_transcripts, douyin_sessions (secret REFS only), douyin_idempotency |
| Control plane | Bounded limits (never unlimited), idempotency keys (`douyin:download:<id>:<preset>`, `douyin:sync:<sec_uid>`), global rate policy (interval + concurrency + cooldown), circuit breaker, typed error taxonomy (DOUYIN_*), secret redaction on every payload/error surface |
| Registry (20.25) | 9 `social.douyin.*` capabilities with mapped risk (profile sync + live = approval required; account features = R4 by policy) |
| MCP | `douyin_inspect/download/search/hot_board/get_job/sync_creator/get_comments/transcribe/list_artifacts` (typed schemas, bounded, no secrets; live/connect tools remain flag-gated) |
| REST | 16 routes under `/api/agent-os/media/douyin/*` with the `{ok, data, provider}` envelope and canonical error codes |
| Dashboard | Douyin workspace: overview/health, URL inspector (inspect + download reference), bounded search, hot-trend snapshots with rank deltas, canonical library |
| Rights | research_only=true, ownership=unknown, commercial_reuse=false by default; **Adobe Stock hard boundary enforced in the ArtifactRegistry** (see below) |

## 5. Adobe Stock Hard Boundary (doc §67, §100 — mandatory)

`ArtifactRegistry.registerArtifact` now consults the Phase 20.26 rights
policy: any artifact sourced from the Douyin family is forced
`exportToStock = false` regardless of requested usage class, unless rights
are explicitly verified as user-owned by the rights policy — a state
downloading never creates. Allowed flow remains: Douyin media → analysis →
abstract trend signal → original concept → original generation → Reviewer
Council → Stock QC → export. Covered by an automated test
(`BLOCKED_BY_RIGHTS_POLICY`).

## 6. REST surface

```text
GET  /api/agent-os/media/douyin/health
POST /api/agent-os/media/douyin/inspect
POST /api/agent-os/media/douyin/download
POST /api/agent-os/media/douyin/search
POST /api/agent-os/media/douyin/hot-board
GET  /api/agent-os/media/douyin/hot-board
POST /api/agent-os/media/douyin/creators/sync
GET  /api/agent-os/media/douyin/creators
POST /api/agent-os/media/douyin/comments/fetch
GET  /api/agent-os/media/douyin/comments
POST /api/agent-os/media/douyin/transcribe
GET  /api/agent-os/media/douyin/items
GET  /api/agent-os/media/douyin/search-snapshots
GET  /api/agent-os/media/douyin/sessions
POST /api/agent-os/media/douyin/stock-export/check
GET  /api/agent-os/media/douyin/mcp-tools
```

CLI verbs are deferred to the dashboard/CLI follow-up (route-registry owner:
this document).

## 7. Feature Flags

`FEATURE_DOUYIN_PROVIDER` (on, degrades gracefully), `FEATURE_DOUYIN_SEARCH`
(on), `FEATURE_DOUYIN_HOT_BOARD` (on), `FEATURE_DOUYIN_COMMENTS` (on),
`FEATURE_DOUYIN_TRANSCRIPTION` (on, degrades without artifact/provider),
`FEATURE_DOUYIN_BROWSER_FALLBACK` (off), `FEATURE_DOUYIN_AUTH_SESSION` (off),
`FEATURE_DOUYIN_LIVE` (off), `DOUYIN_PUBLIC_ONLY` (on by default — no
logged-in account data in the research worker).

## 8. Validation

```bash
bun run typecheck
bun test tests/douyin-intelligence.test.ts   # 32 tests
bun test tests/media-acquisition.test.ts     # Phase 20.24 regression
bun run lint:gui
bun run build:gui
bun run privacy:scan
```

## 9. Honest Limitations

1. **Upstream runtime not exercised end-to-end here**: the CLI adapter is
   contract-tested with fixtures; live verification requires a pinned
   douyin-downloader checkout (`DOUYIN_DOWNLOADER_HOME`) and network access.
   Parsing is fail-closed (`DOUYIN_UPSTREAM_CHANGED`) against drift.
2. **Commit SHA not captured** from the web view — pin and record before
   production (doc §61 upgrade flow).
3. **Browser fallback / authenticated sessions / live recording** are
   flag-gated off; session rows store vault references only, and no
   CAPTCHA/anti-bot bypass exists anywhere in the design.
4. **Transcription** reuses the Phase 20.24 local Whisper provider; OpenAI
   transcription is documented but not wired (secret refs would route through
   the existing vault).
5. **Creator sync** is incremental by stored item ids; `since`-cursor support
   follows once upstream field behavior is verified at runtime.

## 10. Recommended Next Steps

1. Pin upstream commit, run the smoke tests in `docs/phase-20.26/benchmark.md`
   methodology, and record results in the audit doc.
2. Wire the notification events (`media.douyin.*`) through the Phase 20.23
   gateway.
3. Add Research Sets (spec §68) on top of the snapshot tables.
