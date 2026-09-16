# Phase 20.26 — README

Douyin Media Intelligence & Downloader Engine: Douyin integrated as a
**provider** beneath the Phase 20.24 Media Acquisition Core, governed by the
Phase 20.25 Universal Registry — public-only by default, research-only
rights, bounded operations, secrets protected.

## Quick start

1. **Provider only (no upstream):** works out of the box with typed
   degradation — health reports exactly what is missing.
2. **Enable acquisition:** pin a douyin-downloader checkout (MIT) and set:

```bash
export DOUYIN_DOWNLOADER_HOME=/path/to/douyin-downloader   # must contain run.py
export DOUYIN_PYTHON=python                                # optional override
```

3. Open the dashboard → **Douyin Intelligence**: inspect a public URL, queue a
   research download, run bounded searches, capture hot-board snapshots.

## Modes

- `DOUYIN_PUBLIC_ONLY=true` (default): no logged-in data, no favorites, no
  session actions.
- Authenticated features (`FEATURE_DOUYIN_AUTH_SESSION`, browser fallback,
  live) are OFF until their own tests land.

## Rights

Every Douyin artifact is `research_only=true, ownership=unknown,
commercial_reuse_allowed=false` and is hard-blocked from Adobe Stock export;
only original concepts derived from analysis may enter the stock pipeline.

## Docs

- `upstream-audit.md` — verified upstream facts, license, pinning requirement
- `provider-contract.md` — boundary, operations, risk map, error taxonomy
- `security.md` — network policy, secrets, prompt injection, stock boundary
- `migration-notes.md` — reuse map, schema v32, compatibility
- `test-report.md` — 32/32 green + honest coverage gaps
- `benchmark.md` — baseline methodology (fill after first live run)
- Main doc: `docs/Phase%2020.26%20—%20Pao-hubPro%20×%20Douyin%20Media%20Intelligence%20&%20Downloader%20Engine.md`
