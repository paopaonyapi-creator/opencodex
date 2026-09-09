# Phase 20.13 Completion Report: Pao-hubPro Video Intelligence × Claude Watch

## 1. Executive Summary
Phase 20.13 introduces the **Provider-Neutral, Local-First Video Intelligence Layer** for Pao-hubPro, purpose-built for YouTube God OS operators, Adobe Stock commercial review, and autonomous agent video comprehension:
1. **Technical Media Probing (`MediaProbe`)**: Extracts video resolution, geometry/orientation (16:9 landscape vs 9:16 portrait), frame rate, duration, and codecs with local `ffprobe` fallback.
2. **Keyframe & Scene Detection (`FrameExtractor`)**: Scene change thresholding, uniform time-bucket sampling fallback, and hero frame aesthetic scoring.
3. **0–10s "Hook Microscope" (`HookAnalyzer`)**: Micro-timeline analysis of the critical first 10 seconds, detecting opening visual impact, first scene cut timing, first spoken word onset, and kinetic/narrative/ambient hook classifications.
4. **Multi-Tier Audio Transcription (`TranscriptEngine`)**: Tier 1 embedded captions, Tier 2 local `faster-whisper`, and Tier 3 cloud fallback with strict `VIDEO_INTELLIGENCE_LOCAL_ONLY` privacy protection.
5. **Editorial Pacing & Rhythm (`PacingAnalyzer`)**: Cuts-per-minute (CPM), mean & median shot lengths, opening cut rate, and rhythm profiles (`HIGH-ENERGY`, `MODERATE`, `CONTEMPLATIVE`, `STATIC`).
6. **Adobe Stock Automated QC Engine (`StockQcEngine`)**: Commercial asset evaluation against Adobe Stock submission standards (minimum 720p/1080p, 4–60s duration, standard aspect ratios, watermark/trademark detection, verdicts `PASS` / `REVIEW` / `FAIL`).
7. **Comprehensive Markdown & JSON Reporting (`ReportBuilder`, `VideoJobManager`)**: Automated synthesis of human-readable markdown summaries and structured machine JSON payloads.
8. **REST Management API & Web GUI Studio**: `/api/agent-os/video-intelligence/*` endpoints and cyber-cinema `#video-intelligence` GUI control panel.

---

## 2. Key Deliverables & Architecture

### Core Domain Subsystem (`src/agent-os/video-intelligence/`)
- `cache.ts`: `VideoAnalysisCache` — deterministic SHA-256 media cache layer with mtime/size invalidation.
- `types.ts`: Domain models (`VideoJobIntent`, `VideoJobStatus`, `VideoMetadata`, `SceneCut`, `HeroFrame`, `HookAnalysis`, `VideoTranscript`, `PacingMetrics`, `StockQcResult`, `VideoAnalysisReport`, `VideoJob`, `RegenerationFeedback`, `ProvenanceRecord`).
- `security.ts`: `VideoSecurityValidator` — SSRF protection against private/loopback IP addressing, command injection prevention, path traversal defense, and safe `yt-dlp` argument generation with argument boundaries (`--`).
- `media-probe.ts`: `MediaProbe` — probes media metadata, codecs, bitrate, dimensions, and calculates aspect ratios with offline simulation fallback.
- `frame-extractor.ts`: `FrameExtractor` — scene change detection, fallback uniform sampling, and hero frame selection based on brightness/contrast scoring.
- `hook-analyzer.ts`: `HookAnalyzer` — 0–10 second retention analysis, opening style classification, and visual hook scoring.
- `transcript-engine.ts`: `TranscriptEngine` — 3-tier cascade respecting `localOnly` mode and masking private transcript text.
- `pacing-analyzer.ts`: `PacingAnalyzer` — cuts-per-minute, mean shot lengths, pace classification.
- `stock-qc.ts`: `StockQcEngine` — technical resolution, clip length, non-standard aspect ratios, and commercial brand risk detection.
- `report-builder.ts`: `ReportBuilder` — markdown generation with technical specification tables, timeline breakdown, AI Video Factory feedback, provenance block, and actionable suggestions.
- `job-manager.ts`: `VideoJobManager` — state machine lifecycle (`queued` -> `probing` -> `extracting_frames` -> `transcribing` -> `analyzing` -> `reviewing` -> `reporting` -> `completed`), auto-intent inference, factory feedback generation, deterministic cache integration, cancellation, and filtering.
- `council-adapter.ts`: `VideoReviewerCouncil` — multi-agent consensus review (`local`, `openai`, `claude`) for deep, stock QC, and high-risk evaluation.
- `knowledge-adapter.ts`: `KnowledgeAdapter` — structured knowledge ingestion (`type: video_analysis`), concept & entity extraction.
- `db-store.ts`: `VideoDbStore` — persistent SQLite ledger storage (`video_intelligence_jobs`, `video_intelligence_findings`).
- `mcp-tools.ts`: `VIDEO_INTELLIGENCE_MCP_TOOLS` — 11 WebMCP tools (`video_analyze`, `video_inspect`, `video_transcribe`, `video_extract_frames`, `video_analyze_hook`, `video_analyze_pacing`, `video_stock_qc`, `video_debug_screen`, `video_get_report`, `video_list_jobs`, `video_cancel_job`).
- `index.ts`: Public API and singletons (`getVideoJobManager()`, `resetVideoJobManager()`, `VideoAnalysisCache`, and WebMCP tool exports).

### CLI Command Runner
- `scripts/pao-video.ts`: `pao video analyze <source>` CLI supporting all command flags (`--intent`, `--start`, `--end`, `--sampling`, `--hook`, `--local-only`, `--reviewer-council`, `--json`, `--output`).

### Management REST API
- `src/server/management/video-intelligence-routes.ts`:
  - `GET /api/agent-os/video-intelligence/jobs`: List and filter video analysis jobs.
  - `POST /api/agent-os/video-intelligence/jobs`: Submit a video URL or local file path for asynchronous processing.
  - `GET /api/agent-os/video-intelligence/jobs/:id`: Fetch real-time job status and progress.
  - `POST /api/agent-os/video-intelligence/jobs/:id/cancel`: Cancel an active or queued job.
  - `GET /api/agent-os/video-intelligence/jobs/:id/report`: Retrieve full report artifact (Markdown & JSON).
  - `GET /api/agent-os/video-intelligence/jobs/:id/frames`: Extract detected scene cuts and hero keyframes.
  - `GET /api/agent-os/video-intelligence/jobs/:id/transcript`: Retrieve transcript segments and dialogue timestamps.
  - `GET /api/agent-os/video-intelligence/jobs/:id/events`: Real-time SSE (`text/event-stream`) streaming progress and status events.
  - Route alias `/api/video/*` mapped for convenience.
- Mounted via lazy dynamic import in `src/server/management/agent-os-routes.ts`.

### Web GUI Video Intelligence Studio (`gui/`)
- `gui/src/pages/VideoIntelligence.tsx` & `gui/src/styles/video-intelligence.css`:
  - **Quick Job Ingestion Form**: Support for YouTube Godmode, Adobe Stock QC, Shorts / TikTok Hook, and General Analysis intents.
  - **Status & Progress Tracking**: Real-time progress bar, stage indicator, and job cancellation button.
  - **Metrics Dashboard**: 4 key KPI cards displaying Technical Specs, Pacing / CPM, Hook Score, and Adobe Stock Verdict.
  - **Hook Microscope Visualizer**: Visual breakdown of the 0–10 second timeline, first cut timestamp, and opening speech onset.
  - **Full Markdown Report Inspector**: Formatted preview of the generated technical report.
- Registered `#video-intelligence` in `gui/src/app-routing.ts`, `gui/src/App.tsx`, and all 10 i18n locales (`en`, `th`, `de`, `fr`, `ja`, `ko`, `ru`, `tr`, `zh`, `zh-TW`).

### Documentation Suite
- `docs/video-intelligence.md`: Subsystem architecture, pipeline stages, and security guardrails.
- `docs/video-stock-qc.md`: Commercial Adobe Stock QC guidelines and automated rules.
- `docs/video-local-only.md`: Offline privacy mode and whisper/ffprobe airgap guarantees.
- `docs/video-mcp-tools.md`: WebMCP tool reference and example invocations.

---

## 3. Verification & Quality Gates

| Gate / Test Suite | Result | Details |
| :--- | :--- | :--- |
| `tests/video-intelligence-types.test.ts` | **PASS (1/1)** | Type invariants and default configuration validation verified |
| `tests/video-intelligence-security.test.ts` | **PASS (6/6)** | SSRF, loopback blocking, path traversal, safe argv escaping verified |
| `tests/video-intelligence-media-probe.test.ts` | **PASS (2/2)** | Geometry calculation, resolution, orientation, codec probing verified |
| `tests/video-intelligence-frame-extractor.test.ts` | **PASS (2/2)** | Scene change thresholding, hero frame selection verified |
| `tests/video-intelligence-engines.test.ts` | **PASS (8/8)** | PacingAnalyzer, HookAnalyzer, TranscriptEngine, StockQcEngine verified |
| `tests/video-intelligence-job-manager.test.ts` | **PASS (7/7)** | State machine, report, auto-intent, factory feedback, caching verified |
| `tests/video-intelligence-routes.test.ts` | **PASS (8/8)** | REST endpoints, reports, cancel, alias `/api/video/jobs`, SSE events verified |
| `tests/video-intelligence-mcp-tools.test.ts` | **PASS (21/21)** | All 11 WebMCP tool definitions, argument validation, and executions verified |
| `tests/video-intelligence-council.test.ts` | **PASS (3/3)** | Multi-agent consensus, knowledge extraction, and SQLite persistence verified |
| `tests/video-intelligence-cli.test.ts` | **PASS (5/5)** | CLI command dispatch, option parsing, JSON output, and execution flow verified |
| **Total Phase 20.13 Unit Tests** | **PASS (59/59)** | 0 failures, 237 expect assertions green across 10 test files |
| `tests/core-lab-boundary.test.ts` | **PASS (17/17)** | Zero core-to-lab imports or leakage |
| `tests/repo-hygiene.test.ts` | **PASS (12/12)** | Clean repository state, no untracked local state |
| `bun run typecheck` | **PASS** | 0 TypeScript errors |
| `bun run lint:gui` | **PASS** | 0 warnings, 0 errors across 245 files |
| `bun run build:gui` | **PASS** | Production Vite bundle built cleanly in 1.57s |
| `bun run privacy:scan` | **PASS** | 0 credential or secret leaks |
| `bun run skill:surface:check` | **PASS** | Management surface map current |



