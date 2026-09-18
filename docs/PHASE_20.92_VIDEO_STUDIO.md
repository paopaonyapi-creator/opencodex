# Phase 20.92 — AI Script-to-Video Studio

**Status:** IMPLEMENTED (MVP vertical slice — script → scenes → assets → voice → timeline → 720p MP4 → QA → approval)
**Blueprint:** `Pao-hubPro Blueprints/2026-09-19/Phase%2020.92%20-%20Pao-hubPro%20AI%20Script-to-Video%20Studio.md` (44 sections; BrowserSkill renumber proposal cascaded to 20.94)
**Scope:** semantic director layer on top of the Phase 20.7 video factory — one canonical project model, deterministic timeline, policy-governed rendering.

## Architecture law

1. **One canonical model:** UI, agents, the timeline engine and the renderer all read/write the VideoProject/Scene/Timeline shapes in `src/agent-os/video-studio/types.ts` (Zod-validated at every boundary). Provider adapters never invent their own project schema.
2. **AI plans, deterministic code executes:** LLMs (or rule engines) may classify intent and plan emphasis; the Timeline Engine computes startMs/durationMs/frames and the renderer converts frames to pixels — never the model.
3. **No generation during render:** the renderer receives finished timeline + resolved asset URIs; calling any AI provider from the render path is forbidden (source §25).
4. **Human override wins:** scene locks (script/asset/layout/motion/timing/voice) are enforced at write time — regeneration refuses locked fields with `LOCKED_FIELD`.

## Reused subsystems (no duplicates)

| Need | Reused from |
| --- | --- |
| Production jobs/QC/export/providers | `src/agent-os/video/` (Phase 20.7 video factory, `video_production_*` tables) |
| TTS narration | `src/agent-os/speech/` providers (`MockSpeechProvider` offline adapter; VoiceStudio when configured) |
| Media probing | ffmpeg/ffprobe on PATH (8.1.1 verified) |
| Schema validation | `zod` (already a repo dependency) |
| Routes/MCP/GUI conventions | route-registry + gateway registration patterns (20.89/20.91b) |

## Module map (`src/agent-os/video-studio/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Canonical model + Zod schemas: 16 scene intents, 20 visual strategies, 8 track types, locks, budget, QA report, `parseOrThrow` (raw model JSON is never trusted) |
| `segmentation.ts` | Semantic script segmentation — discourse markers + entity churn + density budgeting (punctuation alone never splits); Thai character-based pacing; `hashScript` = invalidation identity |
| `planner.ts` | Scene planner: intent classification → visual strategy → layout → asset requirements → caption mode → duration formula (speech + read + entrance + transition) |
| `motion.ts` | Motion primitive registry (16) + 11 motion templates with metadata + intent-aware selector + repetition warnings |
| `assets.ts` | Asset registry (content-addressable checksums), 9-factor visual matcher, **resolution ladder** (project → brand → shared → cache → stock* → AI image* → text-card), ffmpeg text-card synthesizer, prompt compiler |
| `voice.ts` | TTS + word alignment (language-aware estimation, marked `alignmentMethod: "estimated"` — no real forced-alignment provider is wired) + caption engine (6 modes, Thai-compatible wrapping, overflow detection) |
| `timeline.ts` | Deterministic timeline builder — tracks/clips with frame math; `timelineHash` = same input → same timeline |
| `qa.ts` | Six QA categories (script/asset/layout/timeline/audio/render) as static, deterministic checks |
| `renderer.ts` | ffmpeg deterministic renderer (scene cards + narration audio + caption burn-in), render profiles (PREVIEW_720P / YOUTUBE_1080P / SHORTS_1080X1920), ffprobe-based render QA evidence. `RenderConfig.engine: "remotion"` is the adapter seam for the Phase 20.88a renderer |
| `service.ts` | Facade + **auto-build step machine**: SEGMENT → PLAN → RESOLVE_ASSETS → VOICE → TIMELINE → QA → PREVIEW_RENDER → APPROVAL_GATE; every step idempotent (`projectId:step:inputHash`), resumable (DONE steps skipped), budget-gated (PAUSE → approval), audited |

## Database (schema v59, `vs_*` prefix — additive)

`vs_projects, vs_project_versions, vs_scenes, vs_assets, vs_asset_usage, vs_jobs, vs_job_steps, vs_brand_kits, vs_approvals, vs_provenance, vs_cost_events, vs_audit_events` — the `video_production_*` (20.7), `esk_*` (20.91b) and `mk_*` (20.89) namespaces are untouched.

## Surfaces

- **REST** `/api/agent-os/video-studio/*` — 20 routes declared in `route-registry.ts` (literal + slice) with `VIDEO_STUDIO_VERB_DEFERRAL`: health, projects CRUD, script, plan, resolve-assets, voice, timeline, qa, render, approve, auto-build + step machine, scene lock/regenerate/narration/reorder.
- **MCP** `video.*` tools (15) registered under the `video_studio` server with R0–R4 risk tiers: project create/get, script.segment, scene.plan/update/lock, asset.search/resolve, motion.plan, timeline.build, voice.generate, qa.run, render.preview, render.final (R3, budget-gated), project.approve (R3), project.export (R3, requires DRAFT_VIDEO_APPROVAL).
- **GUI** `video-studio` page: New Project (**target duration, preferred motion template, visual provider, voice provider** selectors wired into `VideoProjectInput.prefs` — template honoured when it supports the scene intent; provider prefs can pin the deterministic card / offline voice with honest labelling), Routing/Storyboard inspector (intent/template/visual generation-class/seconds/locks), scene inspector actions (regenerate visual, regenerate voice, disable/enable), Workflow Runs (status pills, advance/cancel), **AUTO BUILD** driving the step machine to the human-review boundary, Batch CSV panel (bounded concurrency), ops view (provider executions + failures), Skill Packs/audit views. Nav key `nav.videoStudio` localized in all 10 locales.
- **i18n** `nav.videoStudio` in all 10 locales.

## Acceptance test (GOLD §56)

`tests/video-studio.test.ts` — 21 tests: segmentation (EN/TH, punctuation rule), intent classification, duration formula, template selection, repetition warnings, matcher explainability, prompt compiler, Thai caption wrapping, timeline determinism, **critical tests A–H** (locked-script immutability, resume without regeneration, motion-only change keeps voice, idempotency key dedupe, schema rejection, budget PAUSE, missing-asset render gate) and the **real acceptance render**: "How AI Agent Routing Works" → 3–5 scenes → assets → narration → timeline → playable 720p MP4 (ffprobe-verified) → QA PASS → WAITING_APPROVAL. Run: `bun test tests/video-studio.test.ts`.

## Real vs configuration-dependent

- **Real now:** deterministic segmentation/planning/matching, text-card synthesis (ffmpeg), mock-provider narration (real WAV bytes), timeline engine, ffmpeg preview render, QA, approvals, cost/provenance/audit, auto-build step machine.
- **Configuration-dependent (honest gaps):** VoiceStudio TTS (set speech provider config), AI image/video generation (no provider configured — ladder degrades to the owned text-card rung with a recorded reason), Remotion engine (not installed; ffmpeg is the deterministic engine — `engine: "remotion"` seam ready), Adobe Stock mode + batch ≥ 50 + multi-machine workers (post-MVP wave, flagged in route deferral).

## Security

- No secrets in project JSON; provider credentials resolve through the existing credential/policy layer.
- Asset paths resolve through the registry only; text-card synthesis guards paths via `ToolExecutionSandbox.assertSafeWorkspacePath`.
- External publish is not implemented as an auto action — FINAL_EXPORT_APPROVAL is the human boundary; AUTO BUILD always stops at `WAITING_APPROVAL`.
- Every mutating step writes audit events (`vs_audit_events`) and provenance (`vs_provenance`).

---

## 19. GOLD IMPLEMENTATION STATUS

Phase 20.92 was upgraded from the accepted MVP to a production-ready pipeline (GOLD continuation, 2026-09-19). Labeled status per major feature:

| Feature | Status |
| --- | --- |
| Semantic segmentation (EN/TH) + scene planning + intents | ✅ VERIFIED |
| Deterministic timeline engine (frame math, same-input-same-hash) | ✅ VERIFIED |
| ffmpeg render engine (720p preview + 1080p final + 9:16 + 1:1, H.264+AAC) | ✅ VERIFIED |
| Narration-authoritative audio/scene synchronization | ✅ VERIFIED |
| Visual fallback chain with explicit generation classes | ✅ VERIFIED |
| Provider capability matrix + honest availability reporting | ✅ VERIFIED |
| Resumable step machine + cancel/retry + scene-level regeneration | ✅ VERIFIED |
| Batch engine (bounded concurrency, failure isolation, disk guard) | ✅ VERIFIED (local deterministic path) |
| Adobe Stock sidecar manifest (SHA-256, provenance, approval state) | ✅ VERIFIED |
| Observability (`vs_provider_executions`, ops view) | ✅ VERIFIED |
| VoiceStudio TTS client (timeout/retry/backoff/structured errors) | 🟡 IMPLEMENTED — RUNTIME CREDENTIAL/EXTERNAL SERVICE REQUIRED |
| ComfyUI image generation client (real /prompt /history /view) | 🟡 IMPLEMENTED — RUNTIME CREDENTIAL/EXTERNAL SERVICE REQUIRED (full HTTP lifecycle verified against a local test server) |
| Remotion render engine | 🟡 IMPLEMENTED — adapter seam + clean `RENDER_ENGINE_UNAVAILABLE`; install remotion to enable |
| Music generation | ⚪ DEFERRED (no provider; timeline renders narration-only) |
| Multi-machine federation | ⚪ DEFERRED (serializable execution-unit contract only; single-machine fully functional) |
| Automated external publishing | ⚪ DEFERRED BY POLICY (human approval boundary is permanent) |

## 20. REAL PROVIDER INTEGRATIONS

`src/agent-os/video-studio/providers.ts` — capability matrix (IMAGE/VIDEO/TTS/MUSIC/LLM/RENDER) with availability (`available`/`unconfigured`/`offline`), credential status, local/remote, concurrency, and `generationClass` (`ai-generated` vs `deterministic`). Routing selects by capability; config comes from approved env only. `POST /providers/verify` runs live health probes (VoiceStudio healthCheck, ComfyUI `/system_stats`).

## 21. COMFYUI PIPELINE

`src/agent-os/video-studio/comfyui.ts` — pure network client over ComfyUI's native API: `POST /prompt` (bounded backoff retry), `GET /history/{id}` (poll), `GET /view` (artifact download, returns BYTES). Workflow graphs are registry-controlled: built-in text2img graph with labeled injection points (positive/negative prompt, seed, WxH); an approved workflow may be selected BY ID from the studio `workflows/` directory (`PAO_COMFYUI_WORKFLOW`). Persistence happens only in the AssetRegistry (`persistComfyuiArtifact`): id-shape guard → sandbox path guard → SHA-256 of bytes → registration. Config: `PAO_COMFYUI_URL`, `PAO_COMFYUI_CHECKPOINT`, `PAO_COMFYUI_WORKFLOW`, `PAO_COMFYUI_WORKFLOW_MODEL`. Policy gate: `PAO_VIDEO_STUDIO_AI_IMAGE=false` disables external generation entirely. Full HTTP lifecycle verified against a local test server (submit→poll→discover→SHA-256).

## 22. VOICESTUDIO / TTS PIPELINE

`voice.ts` reuses the Phase 20.57 VoiceStudio provider when `VOICESTUDIO_BASE_URL` is configured: 12s timeout per attempt, 2 retries with exponential backoff, structured error codes (`MISSING_CREDENTIAL` / `PROVIDER_UNAVAILABLE` / `VOICE_UNAVAILABLE`), then a clearly-labelled deterministic fallback (`generationClass: "deterministic-fallback"`). Every scene emits an audio manifest: asset id, URI, checksum, duration, provider, model, alignment method. Real TTS durations drive scene adaptation automatically (no configuration needed to switch).

## 23. REMOTION RENDER PIPELINE

`renderer.ts` exposes `assertRenderEngine("remotion")` — a clean adapter seam that fails with `RENDER_ENGINE_UNAVAILABLE` until `remotion`/`@remotion/renderer` are installed. The ffmpeg engine is the verified deterministic production path: scene cards scaled/padded per profile, narration placed via `adelay`+`amix`, caption burn-in on the bottom safe area, `libx264` + `aac` output, profiles PREVIEW_720P / YOUTUBE_1080P / SHORTS_1080X1920 / SQUARE_1080 (+4K/Stock reserved).

## 24. BATCH PRODUCTION

`service.createBatch` → N independent projects + child jobs (`parent_id`); `service.runBatch(batchId, concurrency)` drives them with bounded concurrency (default 2, max 8), **provider rate-limit-aware spacing** (external providers — comfyui/voicestudio — are spaced by `PAO_VIDEO_STUDIO_PROVIDER_SPACING_MS` or a per-call `providerSpacingMs`; the deterministic gate helper `providerRateLimitDelayMs` is unit-tested), failure isolation (a failing child never stops others), disk-space guard (500 MB minimum on the studio root), resumability (DONE steps skipped), and aggregate status (`batchStatus`). 50+ jobs are representable; children only advance one step per pass so external providers are never flooded.

## 25. ADOBE STOCK MODE

`service.buildStockManifest(projectId)` produces a deterministic sidecar (`stock_<project>_<revision>.json`): project/job ids, title, description, keywords, aspect/resolution/duration/fps, audio status (provider + alignment method), visual provider classes, voice provider, models, generated assets, render artifact path, real SHA-256 of the artifact, policy status (`human_approval: pending|granted`, `publish_automated: false`), and full provenance. Publishing is NOT automated; the manifest documents the human boundary.

## 26. SECURITY / POLICY VERIFICATION

- No secrets in project JSON, manifests, audit rows or logs (test: env-injected marker never leaks).
- Workflow selection is registry-controlled (ID matched against the registered directory; no env strings flow into path APIs).
- Artifact locations pass the id-shape guard + containment check + `ToolExecutionSandbox.assertSafeWorkspacePath`.
- Policy gate before external generation (`PAO_VIDEO_STUDIO_AI_IMAGE`), budget PAUSE→approval, and the permanent human publish boundary.
- Bounded subprocesses (ffmpeg timeouts), safe cancellation (job refuses further steps), full audit/provenance per mutation and generation.

## 27. TEST MATRIX

`tests/video-studio-production.test.ts` (14 tests) + `tests/video-studio.test.ts` (21 tests): provider matrix honesty; workflow-id traversal rejection; ComfyUI lifecycle against a live HTTP server (submit/poll/discover/SHA-256/provenance); ComfyUI-down fallback labelling; VoiceStudio missing-credential (`MISSING_CREDENTIAL` + fallback class); narration-authoritative sync (no truncation/drift); timeline determinism; segmentation EN/TH; caption Thai wrapping; scene regenerate/disable/reorder with version tracking; cancel/retry; batch bounded concurrency + isolation; audit/provenance; no-secret leakage; Adobe Stock manifest; preview 720p AND final 1080p MP4 acceptance renders (ffprobe-verified).

## 28. HOW TO RUN

```bash
bun run src/cli/index.ts start        # start the proxy; open Dashboard → Video Studio
bun test tests/video-studio.test.ts            # MVP suite (includes 720p acceptance render)
bun test tests/video-studio-production.test.ts # GOLD suite (includes 1080p final render)
```

## 29. REQUIRED ENVIRONMENT VARIABLES

| Variable | Purpose | Default |
| --- | --- | --- |
| `VOICESTUDIO_BASE_URL` | Real TTS endpoint (absent → deterministic fallback + `MISSING_CREDENTIAL`) | unset |
| `VOICESTUDIO_REMOTE_ENABLED` / `VOICESTUDIO_TLS_REQUIRED` | Speech remote policy (Phase 20.57) | false / true |
| `PAO_COMFYUI_URL` | ComfyUI endpoint for AI image generation | unset |
| `PAO_COMFYUI_CHECKPOINT` | Checkpoint name inside the workflow graph | `model.safetensors` |
| `PAO_COMFYUI_WORKFLOW` | Approved workflow ID in `runtime/video-studio/workflows/` | unset (built-in graph) |
| `PAO_COMFYUI_WORKFLOW_MODEL` | Model label for provenance | `sdxl-text2img` |
| `PAO_VIDEO_STUDIO_AI_IMAGE` | Policy gate for external image generation | `true` (provider still required) |
| `PAO_VIDEO_STUDIO_ROOT` | Studio artifact root | `runtime/video-studio` |

## 30. ACCEPTANCE EVIDENCE

- MVP acceptance render: `runtime/video-studio/projects/vsprj_7086cb53-6b4/renders/draft/render_preview_720p_878fdafbf33d.mp4` (ffprobe: 1280x720, 28s).
- GOLD suite renders a fresh 1920x1080 final MP4 per run and verifies it via ffprobe (`hasStream`, duration, resolution) plus manifest SHA-256; QA PASS and `WAITING_APPROVAL` job state are asserted, never assumed.

## 31. REMAINING EXTERNAL BLOCKERS

- VoiceStudio runtime deployment (real TTS) — code path ready; falls back cleanly today.
- ComfyUI instance with a loaded checkpoint (real GPU inference) — HTTP lifecycle verified; inference needs the service.
- Remotion packages (optional render engine) — seam ready; install to enable.
- Music provider — none wired.

## 32. FINAL PRODUCTION READINESS

Single-machine production-ready for deterministic video generation with honest AI degradation: every scene/artifact carries its generation class and provenance, the pipeline cannot silently fake AI output, all paid/external paths are policy-gated with human approval boundaries preserved, and batch execution is bounded and resumable. Rating: PRODUCTION-READY (deterministic path) + PROVIDER-INTEGRATION-READY (AI paths activate on configuration).
