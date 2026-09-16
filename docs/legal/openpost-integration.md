# OpenPost integration licensing boundary

**Status:** engineering constraint record for Phase 20.60. Not legal advice.

OpenPost (https://github.com/getopenpost/openpost) is licensed **AGPL-3.0-only**.
Pao-hubPro integrates with it strictly as a separately deployed external
service, over its HTTP API (and, optionally, its MCP server).

## The boundary

```text
Pao-hubPro core (this repository)
        │
        │  HTTP /api/v1  (+ optional MCP)
        ▼
OpenPost service (AGPL-3.0-only, separately deployed)
        │
        ▼
Social provider APIs (X, Mastodon, TikTok, …)
```

Rules enforced by this phase:

1. **No source copying.** OpenPost source must not be vendored, copied, or
   merged into Pao-hubPro core. `src/agent-os/social-publishing/openpost/`
   contains an original adapter written against OpenPost's *published API
   contract* (docs.openpo.st/openapi.json); it shares no code with upstream.
2. **No derivative distribution.** Deployment assets under
   `integrations/openpost/` are original Pao-hubPro documentation and a compose
   file referencing upstream's published container image. They are not a fork
   and contain no OpenPost source.
3. **Separate deployment.** OpenPost runs as its own container/service
   (see `integrations/openpost/README.md`). Pao-hubPro links to it by URL and
   a secret reference; process, lifecycle, and storage are independent.
4. **Not a modified version.** If OpenPost is ever modified to suit this
   integration, those modifications must live in a separate upstream-licensed
   repository and the AGPL network-use / source-availability obligations must
   be reviewed before any production distribution or hosted offering of the
   combined service.
5. **Notices.** Operators deploying OpenPost preserve upstream's license and
   notices by using the unmodified upstream image, pinned in
   `integrations/openpost/`.

## Why HTTP/MCP integration is the chosen shape

Communicating with an AGPL work over its public API at arm's length — as an
independent process, with independent code — is the classic service-boundary
pattern. The integration code in this repository is original, serves
Pao-hubPro's own orchestration purposes, and does not incorporate or
distribute OpenPost. A material licensing change upstream (license rebrand,
scope change) must be flagged for review before shipping changes that tighten
the coupling.

## Review triggers

Re-review this file before:

- vendoring or forking any OpenPost code,
- shipping Pao-hubPro and OpenPost as a single distributed artifact,
- exposing OpenPost responses (which embed upstream data structures) as part
  of Pao-hubPro's own licensed distributions in a way that goes beyond
  interoperability metadata.
