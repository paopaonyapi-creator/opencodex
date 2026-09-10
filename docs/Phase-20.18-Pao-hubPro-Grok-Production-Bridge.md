# Phase 20.18 — Pao-hubPro × Grok Projects / Imagine Production Bridge

Status: Bridge, provider adapter, extension, and mock-verified integration complete.
Not exercised against a live Grok account.

## Numbering

The planning document proposed 20.17, but that number is the Adaptive LLM Gateway
built in the previous turn, and 20.15 is the Domain Control Plane before it. This work
is **20.18**. This is the fourth renumber in the series; the drafts and the committed
repository numbers have drifted apart.

## Stack

The document proposes pnpm / Turborepo / Next.js / Fastify / Drizzle / Vitest / Pino.
This repository is Bun-native TypeScript with React + Vite, SQLite, and Bun's own test
runner. The document's own first instruction is to preserve the existing architecture
and package manager, so everything here is built on the existing stack:

| Proposed | Used instead |
| --- | --- |
| Fastify bridge | `Bun.serve` (`src/server/bridge-server.ts`) |
| Drizzle + its own DB | additive tables on the existing Agent OS SQLite handle |
| Vitest | `bun test` |
| Pino | the repository's existing audit table |
| Zod | plain runtime validation, matching neighbouring subsystems |

Zod is a dependency (4.5.4) and could have been used. It was not, because every other
phase subsystem in this repository validates by hand and introducing a second
convention for one subsystem costs more than it saves.

## Architecture

```text
Pao-hubPro dashboard / CLI
        |
        v
  GenerationProvider  (src/agent-os/browser-provider/grok-provider.ts)
        |
        v
  Local bridge  (127.0.0.1:43117, src/server/bridge-server.ts)
        |  HTTP + WebSocket-equivalent heartbeats
        v
  Chrome MV3 extension  (apps/chrome-grok-bridge/)
        |
        v
  Grok Projects / Imagine
```

**Pao-hubPro core never sees the Grok DOM.** Everything browser-specific stops at the
provider adapter. A UI change is a selector profile edit, not a code change.

## The safety properties, and why each exists

### A human gate blocks rather than fails

A CAPTCHA, an expired session, or a rate limit moves the job to `blocked`. It does NOT
become `failed`, because `failed` is retryable by the queue — and a queue that retries a
CAPTCHA is attempting a bypass, while one that retries a login wall spins forever.

Verified live: a `GROK_SESSION_REQUIRED` report moved a running job to `blocked` with
the error code preserved.

### A restart never resubmits uncertain work

In-flight jobs move to `needs_review` on restart, never to `failed`. The system
genuinely does not know whether a generation completed, and the document is explicit
that it must not resubmit in that state. `needs_review` cannot be entered by a happy
path and cannot silently become `completed` — a human resolves it.

### Selectors never rest on one signal

Each element has weighted candidates across role, aria, text, and CSS. The strongest
resolving signal wins and its confidence is REPORTED, so a fallback to CSS shows as
stale rather than as healthy. This is what lets diagnostics say "the page changed"
instead of "everything is fine".

### Prompts are verified by read-back

The prompt is typed, then read back from the page and compared. A truncation, a
substitution, or an empty field fails with `GROK_PROMPT_VERIFY_FAILED` and the job does
not submit. Unverified submission would generate something the operator did not ask for
while reporting success.

### The extension cannot reach what it should not

- No `<all_urls>`; host access is limited to Grok domains and loopback.
- Four permissions: `storage`, `tabs`, `downloads`, `scripting`.
- No cookie, session, or credential is read, stored, or transmitted. The bridge has no
  route that could accept one.
- No code path clears a CAPTCHA, logs in, or evades a rate limit.

### The bridge is local-only and authenticated

- Bound to `127.0.0.1`, with the host not configurable.
- Origin checked on every route: an extension origin from an allowlist, or loopback.
  A web origin is refused even on loopback, because a page can reach localhost and
  without this check any website could drive the bridge through a visitor's browser.
- Token compared in constant time.
- An empty extension allowlist permits nothing. Failing closed is the point.
- Six-digit pairing code, single use, two-minute expiry.

Verified live over HTTP: requests with no origin, a web origin, a wrong extension id,
and a wrong token were each refused; a request with a valid origin and token succeeded.

### Downloads cannot escape and cannot lie

- Every path component is sanitized AND the final path is asserted against the root.
  The two protections are independent on purpose: a sanitizer bug should not be able
  to write outside the downloads root.
- Files are written to `.part` and renamed on success, so an interrupted write is
  never presented as a complete download.
- Every artifact gets a SHA-256 and a provenance manifest.

## Files

```text
src/agent-os/browser-provider/
  types.ts             job states, error codes, provider interface, capabilities
  selectors.ts         weighted selector engine + the Grok profile
  page-detector.ts     six-signal page identification
  store.ts             persistence + restart reconciliation
  grok-provider.ts     THE ADAPTER
  download-manager.ts  path safety, integrity, provenance
  bridge.ts            auth, origin checks, pairing, service
src/server/bridge-server.ts   the HTTP surface
src/server/bridge-config.ts   configuration and token derivation
apps/chrome-grok-bridge/      the extension (9 scripts, 3 pages, manifest)
tests/fixtures/grok/pages.ts  9 mock page states
```

## Validation

```bash
bun test tests/grok-bridge.test.ts tests/grok-bridge-integration.test.ts \
         tests/grok-bridge-mock-pages.test.ts
  -> 68 pass, 0 fail, 182 assertions
bun run typecheck   -> clean
```

### Live bridge verification

A real bridge process on port 43119, exercised over HTTP:

```text
GET  /health                     -> ok=true
POST /v1/jobs (no origin)         -> 401 refused
POST /v1/jobs (web origin)        -> 401 refused
POST /v1/jobs (wrong extension id)-> 401 refused
POST /v1/jobs (wrong token)       -> 401 refused
POST /v1/jobs (valid)             -> accepted, JOB-F1641877
POST heartbeat (rate-limit page)  -> pageType=rate-limited, confidence 0.9
GET  /v1/jobs/next                -> the job, state=waiting_browser
POST report session-required      -> state=blocked, code preserved
GET  /v1/audit                    -> user_action_required recorded
GET  /v1/diagnostics              -> no token in payload
```

### A defect found by testing my own code

`recordHeartbeat` stamped the session with the wall clock while `health()` compared
against an injected clock. A long-stale provider therefore reported as connected,
because the age computed negative. This is the same defect class as the Domain Control
Plane's approval expiry in the previous turn — two clocks deciding one time-sensitive
verdict. Fixed by stamping from the same clock that compares.

## Not done

- **No live Grok account was exercised.** Everything is verified against mock page
  states and a real bridge process. Whether the real DOM offers a role or aria signal
  for the prompt input is the first thing to check with the extension loaded.
- **No unified generation form or provider card in the dashboard.** The document's
  §20–21 UI is not built. The bridge and provider are complete and callable; only the
  dashboard surface is missing.
- **Reviewer Council and Adobe Stock hooks are not wired.** The provider exposes
  `GenerationResultRecord` and the download manager writes provenance, which is what
  those integrations need, but neither is connected to the existing Phase 19/21
  pipeline.
- **Batch CSV mode is not built.**
- **Video is capability-detected but unverified.** The extension reports `unknown` for
  video until a page is inspected. It is not assumed available.
- **Screenshot-on-error is an option flag without an implementation.** The setting is
  stored and surfaced; the capture is not wired.

## Next step

Load the extension against a real Grok account and run diagnostics. That answers the
one question mocks cannot: whether the selector profile matches the current DOM, and at
what confidence. Everything downstream depends on that answer.
