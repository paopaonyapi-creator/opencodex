# Phase 20.26 — Upstream Audit: douyin-downloader

Source: https://github.com/jiji262/douyin-downloader
Audited: 2026-09-13 via repository page fetch. **No upstream code was
executed, installed, or vendored during this integration.**

## Facts verified

| Item | Value |
|---|---|
| License | MIT — notices preserved here; no code vendored, so no redistribution obligations are triggered. If upstream code is ever vendored, carry `LICENSE` + `README` notices verbatim. |
| Language / runtime | Python 3.8+; macOS / Linux / Windows |
| Entrypoint | `python run.py -c config.yml` |
| CLI flags observed | `-u <url>`, `--search <keyword>`, `--hot-board [N]`, `--serve`, `--serve-port`, `-c <config>`, `-p`, `-t` |
| REST mode | FastAPI + uvicorn via `--serve`: `POST /api/v1/download`, `GET /api/v1/jobs/{job_id}`, `GET /api/v1/jobs`, `GET /api/v1/health` |
| Modes | `post`, `like`, `mix`, `music` (public); `collect`, `collectmix` (logged-in favorites) |
| Content types | single video, image-note (`/note/`, `/gallery/`), collection/mix, music, profile batch, live (experimental, FLV/HLS, partial preserved) |
| Search / hot board | JSONL output files |
| Comments | per-aweme, optional replies, `*_comments.json` |
| Transcription | optional, OpenAI Transcriptions API, videos only |
| Cookies | `cookies.{msToken,ttwid,odin_tt,passport_csrf_token,sid_guard}`; fetch via `python -m tools.cookie_fetcher` (Playwright) |
| Other config | `path`, `mode`, `number`, `thread`, `retry_times`, `proxy`, `database`, `database_path`, `start_time`/`end_time`, `folderstyle`, `increase.*`, `browser_fallback.*`, `transcript.*`, `comments.*`, `live.*`, `notifications.*`, `server.{max_jobs,job_ttl_seconds}`, `progress.quiet_logs` |
| Internal dedup | SQLite history database (implementation detail of the upstream process — never Pao-hubPro's store) |
| Commit SHA | **Not captured** from the repository page. Pin the exact commit/tag into `DOUYIN_DOWNLOADER_HOME` and record it here before production (doc §61). |

## Integration decision

CLI adapter (Option C) for MVP: fixed argument arrays (`run.py -u <validated-url>
-c <generated-config>`), a generated minimal config carrying only the
documented `path` key, binary allowlist (`python`/`python3`/`py` via the
Phase 20.24 safe process runner — `shell: false`), 120s timeout, 16MB buffer
cap. Production upgrade path: the documented `--serve` localhost REST mode
behind feature flags. Never `shell=True`, never arbitrary flags from agents.

## Output schema trust level

JSON/JSONL shapes are handled **fail-closed**: the normalizer requires
`awemeId`, `url`, and `title`; any missing/changed field raises
`DOUYIN_UPSTREAM_CHANGED` instead of creating a corrupted canonical record.
Contract fixtures live in `tests/douyin-intelligence.test.ts` and encode the
shapes documented above; runtime verification against a real checkout is a
required follow-up.

## Known limitations / risks

- Douyin changes behavior frequently; treat every upstream response as
  potentially drifted (the adapter reports `DOUYIN_UPSTREAM_CHANGED`).
- Search/hot-board may require session cookies for some views — public-only
  mode is the default and degrades with `DOUYIN_AUTH_REQUIRED`.
- Live recording is experimental upstream; it is flag-gated OFF in Pao-hubPro.

## Supply-chain notes (doc §62)

External repository = untrusted dependency. Before production: pin commit,
review install scripts and subprocess use, keep the process in a restricted
working directory with only its own output dir writable, inject secrets only
when an authenticated feature is explicitly enabled, and keep the API
localhost-only if the sidecar mode is adopted.
