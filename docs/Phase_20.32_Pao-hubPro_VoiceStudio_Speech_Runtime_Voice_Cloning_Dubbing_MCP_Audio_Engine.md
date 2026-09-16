# Phase 20.32 — Pao-hubPro × VoiceStudio Local AI Speech Runtime, Voice Cloning, Dubbing & MCP Audio Production Engine

> **Status:** Implemented (net-new delta over the existing production stack)
> **Upstream:** `debpalash/VoiceStudio` pinned to **v0.5.2** (AGPL-3.0, external service)
> **Depends on:** Phase 20.7 video factory, Phase 20.24 media acquisition (process runner, artifact conventions), Phase 20.16/20.27 control-plane governance patterns
> **Validated:** 2026-09-13

---

## 0. What this phase is

VoiceStudio is integrated as a **separate speech-production runtime behind Pao-hubPro**:
local TTS, STT, voice cloning, voice profiles, subtitles/transcripts, and job-based
audio production, with a fail-closed commercial-license guard, a mandatory voice-consent
registry, and an Adobe Stock Safe Mode profile for speech.

VoiceStudio stays an **external service** (doc §1.1): this repository vendors no upstream
code, never imports VoiceStudio Python modules, and only talks to the pinned runtime over
the OpenAI-compatible audio API, the documented MCP tool surface, and the confined shared
workspace. The full boundary rationale lives in
[`docs/architecture/adr-voice-runtime-boundary.md`](./architecture/adr-voice-runtime-boundary.md).

## 1. Duplication audit (spec non-duplication rules)

| Spec area | Existing module reused | Verdict |
| --- | --- | --- |
| Job queue, statuses, retry rules | New `speech_jobs` table, but state-machine + transient-only retry rules modeled on `src/agent-os/video/queue/video-job-queue.ts` and douyin queue | net-new, aligned |
| Process isolation for ffmpeg/ffprobe | `src/agent-os/media-acquisition/process-runner.ts` (`runProcessSafely`, allowlist) | **reused, not duplicated** |
| Artifact + provenance conventions | Phase 20.24 `artifact-registry.ts` shape (sha256, raw vs final, manifest) — speech keeps its own `speech_artifacts` table because the media registry is per-process in-memory | conventions reused, storage net-new |
| STT whisper CLI path | `media-acquisition/transcription-provider.ts` (Phase 20.24) and `video-intelligence/transcript-engine.ts` (Phase 20.13) remain the whisper/native tiers; VoiceStudio STT is a distinct provider tier behind the new `SpeechProvider` contract | **not duplicated** |
| Adobe Stock policy layer | Phase 20.7 `video/policy/adobe-stock-policy.ts` unchanged; speech adds its own fail-closed gates in `speech/policy.ts` and composes with the video-side export gate at packaging time | composed, not merged |
| Human-only governance | Phase 20.27 cockpit `HUMAN_ACTOR_PATTERN` invariant replicated for voice/consent/license decisions | pattern reused |
| Event trail | `src/agent-os/events.ts` `recordAgentEvent` for `speech.artifact.ready` | **reused** |
| MPT integration | MPT voice stays upstream-delegated (`voice_name`/`enable_voice` in `mpt-types.ts`); narration artifacts are handed to the video factory by path/contract (doc §20) — no changes to the MPT adapter | contract only |

## 2. Net-new modules

```
src/agent-os/speech/
├── types.ts          SpeechProvider contract, entities, consent bases (doc §4, §8, §9)
├── errors.ts         SPEECH_* / VOICE_* / MODEL_* taxonomy + message sanitization (§33, §26)
├── flags.ts          feature flags; clone + dubbing default OFF, stock-safe default ON (§32)
├── workspace.ts      confined workspace: resolved-prefix containment, symlink-escape
│                     rejection, per-project layout (§7)
├── http-client.ts    OpenAI-compatible TTS/STT calls, health probe with version-pin
│                     evaluation (pin 0.5.2, unknown → warn_and_disable), loopback/TLS
│                     rules, redacted URLs (§5, §23, §27, §42)
├── redact.ts         single credential-header helper (§26)
├── mcp.ts            documented-tools-only MCP client (list_voices, clone_voice, …),
│                     defensive SSE/JSON parsing (§6)
├── mcp-config.ts     MCP file-mode is mandatory; blob modes refused (§6.2)
├── provider.ts       VoiceStudioProvider + deterministic MockSpeechProvider (CI-safe WAV) (§31)
├── policy.ts         fail-closed license guard, clone consent gate, speech stock-export
│                     gate, human-actor invariant (§9, §10, §11)
├── manifest.ts       provenance manifests + credential-shaped-field refusal (§12)
├── store.ts          static-SQL store over the v33 tables
└── service.ts        job pipeline (preflight → runtime → postprocess → policy_check),
                      transient-only retries, human-only governance, audit (§13–§18, §36)
```

Database: `AGENT_OS_SCHEMA_VERSION` 32 → **33**, additive `CREATE TABLE IF NOT EXISTS`
migration adding `speech_jobs`, `speech_artifacts`, `voice_profiles`, `voice_consents`,
`model_licenses`, `speech_policy_checks`, `speech_runtime_health`, `speech_audit`
(doc §37). No existing table or column is altered.

## 3. REST surface (24 routes, `/api/agent-os/speech/*`)

Health/capabilities/diagnostics (redacted), MCP config view, voice registry
(sync never auto-approves — synced voices land `unreviewed`), human-only
`voices/approve-stock` + `voices/block`, generate-form policy chips, synthesize /
transcribe / clone / dub (dub feature-flagged OFF until upstream ships a stable
programmatic API, §19), jobs list/detail/cancel, artifact detail with manifest,
license register/review, consent register/revoke, audit trail.

All pathname guards are full literals; entity ids travel in the JSON body
(Phase 20.29 automation precedent); every route is declared in
`src/server/management/route-registry.ts` under `SPEECH_VERB_DEFERRAL` (CLI verbs
deferred to a later work phase).

## 4. Governance behavior (the part that matters)

- **License guard (doc §10):** missing record == unknown == **block**; `review_required`
  blocks; `commercial_use=false` / `stock_use=false` block; only human review flips a
  record to `approved`. Licensing is never inferred from "open source".
- **Consent (doc §9):** only `self_voice`, `written_permission`,
  `licensed_voice_dataset`, `synthetic_non_person_impersonation` are acceptable bases;
  `unknown`, `scraped_voice`, `celebrity_voice`, `public_figure_voice`,
  `third_party_without_permission` are refused at registration and at the gate.
- **Cloning (doc §18):** disabled by default (`FEATURE_SPEECH_CLONE=false`); when enabled
  it requires an in-workspace reference file plus a valid consent row, and the resulting
  voice always lands `pending_review` with `commercialUseStatus=unknown`.
- **Stock Safe Mode (doc §11, §46):** unknown anything blocks with a specific reason
  (`MODEL_LICENSE_UNVERIFIED`, `VOICE_NOT_APPROVED_FOR_STOCK`, `VOICE_CONSENT_REQUIRED`,
  `MANIFEST_MISSING`, `PUBLIC_PERSON_IMPERSONATION_BLOCKED`); unsafe jobs are blocked
  before the runtime call and produce an audit row.
- **Human-only:** license review, stock approval, voice blocking, consent lifecycle —
  agents receive an `invariant violation` (403) exactly like the Phase 20.27 cockpit.
- **Non-stock synthesis** with an unverified license proceeds (local testing is not
  bricked) but records a `warn` policy check and can never silently become a stock approval.

## 5. Retry rules (doc §14.1)

Transient (`SPEECH_RUNTIME_UNAVAILABLE`, `SPEECH_GENERATION_TIMEOUT`) → requeued with
`attempt+1` up to `1 + SPEECH_MAX_RETRIES`. Everything else — policy, consent, license,
path, invalid input, cancellation — is terminal and never retried.

## 6. Tests

`tests/speech-runtime.test.ts` (16 tests): flags defaults; workspace containment +
symlink escape (win32 symlink case covered by sibling-path refusal); fail-closed license
matrix; consent gate matrix + rejected-basis registration; stock-safe block paths with
audit; full TTS happy path (raw + final artifacts, manifest sha256, no-secret assertion,
`speech.artifact.ready` event row); human-only invariants; cloned-voice pending review;
clone flag default; transient-vs-terminal retry; transcription artifacts; MCP file-mode
enforcement; credential redaction.

## 7. Honest accounting / follow-ups

- The **dubbing** workflow is intentionally not automated: upstream dubbing lacks a stable
  public programmatic API (doc §19) — the endpoint exists and reports
  `SPEECH_DISABLED_BY_FLAG`.
- Audio postprocessing records raw + final versions and probes metadata via ffprobe when
  available; loudness normalization/trimming is a flagged follow-up (spec §15) rather than
  a fake implementation.
- `SPEECH_JOB_TIMEOUT_SECONDS` bounds runtime calls; long-form chunked narration
  (§16.1) is a documented follow-up — current pipeline handles whole-script synthesis.
- Integration/contract tests against a real VoiceStudio v0.5.2 runtime are
  skip-without-runtime by design; CI runs the deterministic mock only (doc §31).
- Remote GPU mode (doc §23) is supported at the client layer (loopback/TLS checks,
  `VOICESTUDIO_REMOTE_ENABLED` gate); the Compose overlay from doc §24 is an operator
  deployment concern and intentionally not committed blind.
- Phase 20.33 follow-up (doc §48): multimodal timeline orchestration should consume the
  `speech.artifact.ready` event contract as-is.
