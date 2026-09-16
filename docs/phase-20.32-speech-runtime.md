# Speech Runtime (Phase 20.32) — Setup, Endpoints, Error Codes

Operational reference for the VoiceStudio speech runtime integrated in
Pao-hubPro. Design rationale and duplication audit:
[`Phase_20.32` owner doc](./Phase_20.32_Pao-hubPro_VoiceStudio_Speech_Runtime_Voice_Cloning_Dubbing_MCP_Audio_Engine.md).

## Quick start (local VoiceStudio)

1. Deploy VoiceStudio **v0.5.2** (pinned) bound to loopback:

   ```
   http://127.0.0.1:3900        # OpenAI-compatible API
   http://127.0.0.1:3900/mcp    # MCP (file output mode mandatory)
   ```

2. Configure (see `.env.example`; never commit the API key):

   ```
   SPEECH_PROVIDER=voicestudio
   VOICESTUDIO_BASE_URL=http://127.0.0.1:3900
   VOICESTUDIO_VERSION_PIN=0.5.2
   PAO_SPEECH_WORKSPACE=./workspace/pao-speech
   ADOBE_STOCK_SAFE_MODE=true
   ```

   `SPEECH_PROVIDER=mock` selects the deterministic mock provider (CI / offline).

3. Dashboard → **Speech Studio**. Run **Sync provider voices** (new entries are
   `unreviewed`), register + review a **model license** (fail-closed until a human
   approves), register **consent** for cloned/reference voices, then approve a voice
   for stock if applicable.

## Governance chain

```
Generate speech
  → voice resolved in Pao-hubPro Voice Registry (never raw provider ids)
  → license guard      (unknown/blocked ⇒ MODEL_LICENSE_UNVERIFIED / *_BLOCKED)
  → stock-safe gates   (voice active + consent verified + manifest + no public-figure impersonation)
  → runtime synthesis  (transient errors retried only)
  → raw + final artifacts, provenance manifest (sha256 chain, no secrets)
  → speech.artifact.ready event (consumed by the video pipeline)
```

Cloning additionally requires: `FEATURE_SPEECH_CLONE=true`, a reference file inside
`PAO_SPEECH_WORKSPACE`, and a registered consent row with an acceptable basis
(`self_voice`, `written_permission`, `licensed_voice_dataset`,
`synthetic_non_person_impersonation`). Cloned voices always start `pending_review`.

## Endpoints (management API, `/api/agent-os/speech/*`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | state, version pin check, queue depth, flags |
| GET | `/capabilities` | flag-gated TTS/STT/clone/dubbing/MCP |
| GET | `/diagnostics` | redacted preflight bundle (never the API key) |
| GET | `/mcp-config` | file-mode config view; blob modes refused |
| GET | `/voices` · POST `/voices/sync` | sync never auto-approves |
| POST | `/voices/approve-stock` · `/voices/block` | **human only** |
| POST | `/voices/policy-status` | Generate-form chips |
| POST | `/synthesize` · `/transcribe` · `/clone` · `/dub` | runs a job inline, returns terminal state |
| GET | `/jobs` · POST `/jobs/detail` · `/jobs/cancel` | |
| POST | `/artifacts/detail` | artifact + provenance manifest |
| GET | `/licenses` · POST `/licenses` · `/licenses/review` | review is **human only** |
| GET | `/consents` · POST `/consents` · `/consents/revoke` | **human only** |
| GET | `/audit` | governance trail |

## Error codes

`SPEECH_RUNTIME_UNAVAILABLE` (retryable) · `SPEECH_GENERATION_TIMEOUT` (retryable) ·
`SPEECH_RUNTIME_VERSION_MISMATCH` · `SPEECH_OUTPUT_INVALID` ·
`SPEECH_PATH_OUTSIDE_WORKSPACE` · `SPEECH_DISABLED_BY_FLAG` ·
`SPEECH_VOICE_NOT_FOUND` · `VOICE_CONSENT_REQUIRED` · `VOICE_CONSENT_REVOKED` ·
`VOICE_CLONE_NOT_ALLOWED` · `MODEL_LICENSE_UNVERIFIED` ·
`MODEL_COMMERCIAL_USE_BLOCKED` · `MODEL_STOCK_USE_BLOCKED` · `REMOTE_AUTH_FAILED` ·
`REMOTE_TLS_REQUIRED`. Messages are sanitized (no bearer tokens, no key query params).

## Troubleshooting

- **`misconfigured` health** — remote base URL without `VOICESTUDIO_REMOTE_ENABLED=true`,
  or plain-HTTP remote with `VOICESTUDIO_TLS_REQUIRED` on.
- **`version_mismatch`** — detected runtime exceeds the maximum tested version;
  clone/dubbing stay disabled until the pin is re-approved.
- **`MODEL_LICENSE_UNVERIFIED` on every stock job** — register the engine/model in
  Licenses and have a human approve it (commercial + stock).
- **Jobs fail `SPEECH_PATH_OUTSIDE_WORKSPACE`** — all file inputs must live inside
  `PAO_SPEECH_WORKSPACE`; symlink escapes are rejected.
