# Open WebUI License & Branding Notes (Phase 20.33)

> Technical governance note, not legal advice. Verify the upstream license text
> for the exact pinned release before any commercial deployment decision.

## What this integration does

Phase 20.33 runs **unmodified upstream Open WebUI** (pinned `v0.11.3`) as a
separately deployed container and integrates it through supported interfaces
only (OpenAI-compatible API, MCP connector, reverse proxy). Pao-hubPro vendors
no Open WebUI source code.

## Branding guard (doc §4.3)

- Upstream Open WebUI branding inside the upstream application is **left
  untouched** — no logo swaps, no white-label patches, no CSS overrides that
  remove upstream attribution.
- Pao-hubPro branding lives only in Pao-owned components: the Pao dashboard,
  the AI Workspace control center, Pao services, and documentation.
- There is no automatic rebranding tooling in this repository, and none may be
  added without a separate licensing review.

## Why the boundary is structured this way

Open WebUI's license (upstream, with branding/attribution provisions that have
changed across releases — historically BSD-2-Derived with branding conditions,
more recently with additional terms) attaches to the **upstream application**.
Keeping Pao-hubPro as a separate service that talks to Open WebUI over public
interfaces preserves the clean aggregation posture the same way the VoiceStudio
AGPL boundary does (see `docs/architecture/adr-voice-runtime-boundary.md`):
integration over documented interfaces, no vendored source, no derivative
redistribution of the upstream UI.

## If white-labeling is ever required

Treat it as a separate legal/licensing work item (doc §4.3): review the license
of the exact target release, obtain any required permission or a commercial
arrangement, and only then consider a branding change — recorded in a new ADR.
This repository ships none of that.

## References

- Upstream: `https://github.com/open-webui/open-webui` (license file + release
  notes for the pinned tag)
- Pinned baseline: `integrations/open-webui/VERSION` (`0.11.3`)
