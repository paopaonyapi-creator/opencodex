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
- **GUI** `video-studio` page: New Project (title/script/aspect), project table, **AUTO BUILD** button driving the step machine to the human-review boundary, pipeline progress cards, storyboard inspector (intent/template/visual/seconds/locks), QA failures.
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
