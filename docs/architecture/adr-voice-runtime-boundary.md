# ADR: Voice Runtime Service Boundary (Pao-hubPro × VoiceStudio)

- **Status:** Accepted (Phase 20.32, 2026-09-13)
- **Context:** VoiceStudio (`debpalash/VoiceStudio`, pinned v0.5.2) provides local
  TTS/STT/voice-cloning. Its application code is licensed **AGPL-3.0**; third-party
  model weights and tokenizers carry their own independent licenses.

## Decision

Pao-hubPro integrates VoiceStudio as a **separately deployed external process** and
communicates only through documented interfaces:

1. the OpenAI-compatible audio API (`POST /v1/audio/speech`,
   `POST /v1/audio/transcriptions`),
2. the documented MCP tool surface (`/mcp`, file output mode mandatory), and
3. a confined shared workspace directory (path-containment enforced on the
   Pao-hubPro side).

Pao-hubPro does **not** vendor, import, or link VoiceStudio source by default. The
integration is isolated in `src/agent-os/speech/` behind the `SpeechProvider`
contract, so alternative runtimes (other TTS/STT engines, whisper servers, remote GPU
hosts) can be routed in without touching production code.

## Rationale

- **AGPL boundary.** Treating VoiceStudio as an unmodified separate service over
  public interfaces keeps the aggregation at arm's length, consistent with the
  upstream license; embedding or shipping modified VoiceStudio code inside Pao-hubPro
  would create obligations this repository does not accept. This ADR is technical
  governance, not legal advice.
- **Independent licensing of models.** The application license says nothing about the
  models. `model_licenses` therefore records engine/weights/tokenizer licenses
  separately, and the guard is fail-closed: `unknown`/`review_required`/non-commercial
  block production use. "Open source" is never treated as "commercial safe".
- **Operational isolation.** GPU runtimes crash, reload, and upgrade on their own
  cadence; a pinned external service (compose image `:0.5.2`, upgrade only through the
  compatibility workflow) protects the proxy runtime from that churn.

## Consequences

- VoiceStudio availability is a deployment prerequisite for speech features; the
  dashboard reports `unavailable`/`misconfigured`/`version_mismatch` health states and
  core proxy functionality never depends on it.
- Any future change to vendor or fork upstream code requires a new ADR and a review of
  the license implications (commercial licensing for proprietary embedding exists
  upstream if it is ever needed).
