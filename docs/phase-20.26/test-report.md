# Phase 20.26 — Test Report

Suite: `tests/douyin-intelligence.test.ts` — **32 tests, 32 pass, 0 fail**
(110 expect() calls), deterministic, no network, no upstream binary required.

| Area (spec §92-§100) | Tests | Result |
|---|---|---|
| URL classification (video/note/gallery/user/collection/mix/music/live/short link) | 3 | pass |
| SSRF (private/loopback/metadata/file scheme, fail-closed) + redirect-hop family validation | 2 | pass |
| Canonical normalization (media, creator `sec_uid`, comments) | 3 | pass |
| Upstream drift → `DOUYIN_UPSTREAM_CHANGED` (missing aweme id / title / secUid) | 2 | pass |
| Prompt injection stored as content only | 1 | pass |
| Dedup on provider + provider_item_id | 1 | pass |
| Idempotency reserve/lookup + duplicate download rejection | 2 | pass |
| Bounded limits (`0/negative/over-ceiling` → `DOUYIN_LIMIT_EXCEEDED`) | 1 | pass |
| Secret redaction (object tree + embedded strings) | 2 | pass |
| **Adobe Stock rights boundary** (guard + registry enforcement + trend-signal path) | 4 | pass |
| Service flows: inspect, search snapshots (immutable), hot board (append-only + delta), creator sync (incremental), comment dedupe, health dimensions | 6 | pass |
| Graceful degradation (no upstream: health reason, typed router failure, non-douyin unaffected, typed search error) | 4 | pass |
| Phase 20.25 registry integration (9 capabilities, risk mapping, searchability) | 2 | pass |

Regression: Phase 20.24 suites and Phase 20.25 suite re-run green (see
validation commands). Full-repo `test:changed` remains out of scope for this
branch (pre-existing unrelated in-flight work pushes the selected suite past
its 900s cap); every import-connected suite touched by Phase 20.26 passes.

## Optional / not covered (honest)

- Live upstream invocation (needs pinned checkout + network): covered by
  fixture contract tests only; runtime smoke tests are the first production
  follow-up.
- `--serve` REST sidecar mode: documented, not implemented (flag-gated
  production path).
- Browser fallback, authenticated sessions, live recording: flag-gated OFF
  per spec §79; security tests for those paths land with their implementation.
