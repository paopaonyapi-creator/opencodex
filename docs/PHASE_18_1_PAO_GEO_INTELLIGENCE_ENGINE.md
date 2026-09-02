# Phase 18.1 — Pao GEO Intelligence Engine × geo-seo-claude

Phase 18.1 extends Phase 18 with a GEO / AI-search readiness layer. It reuses
the Phase 18 project model, recommendation inbox, run ledger, routes, and
dashboard; the upstream geo-seo-claude project is a CONCEPT REFERENCE only —
no upstream code was copied and nothing was installed outside the repository.

## Relationship to Phase 18

- Same `SeoProjectContext` (extended area values, no separate project store).
- Same recommendation inbox; GEO entries are prefixed `[GEO]` and filterable.
- Same `seo_runs` ledger with `kind = geo_audit` and `provider = geo-engine`.
- Same route tree: `/api/agent-os/seo/geo/*` handled inside the SEO routes.

## Implemented (slice 1)

- **GEO types** (`src/agent-os/seo/geo/types.ts`): capabilities, evidence,
  findings with `basis` (observed_web_standard | public_platform_documentation |
  general_retrieval_principle | heuristic | unknown) and explicit
  `verification` state (verified / unverified / conflict /
  suppressed_false_positive / unverifiable).
- **Safe fetch + direct verification** (`geo/geo-fetch.ts`): raw first-party
  responses only (never transformed markdown), https-enforced, 5 MB cap, 15 s
  timeout, and SSRF policy mirroring the provider destination classifier —
  loopback/private/link-local/metadata space refused both as literals AND after
  DNS resolution.
- **AI crawler policy** (`geo/analyzers.ts`): deterministic robots.txt group
  parser (RFC 9309-style longest-match), per-crawler ALLOWED/BLOCKED/PARTIAL/
  UNKNOWN from the RAW file with exact evidence lines (`L12: ...`), registry
  covering GPTBot/ClaudeBot/PerplexityBot/Google-Extended/Applebot-Extended/
  CCBot/Bytespider. A 404 robots.txt is honest ALLOWED; a fetch failure is
  honest UNKNOWN. Blocking is presented as a business choice, not an error.
- **llms.txt**: existence decided ONLY by direct GET (404 → MISSING, fetch
  failure → UNKNOWN, never MISSING without a 404). Link validation flags
  out-of-domain links; state machine present_valid / present_with_issues /
  missing / fetch_failed / unknown.
- **Schema intelligence**: raw-HTML JSON-LD extraction with malformed-block
  tolerance; missing Organization schema is reported only after raw-HTML
  verification (false-positive suppression rule), and the finding is marked
  `verified` with the page hash as evidence.
- **False-positive suppression**: findings contradicted by their own verified
  evidence are dropped and counted as `suppressed` in the run summary.
- **GEO orchestrator** (`geo/geo-orchestrator.ts`): capability-gated audit,
  transparent HEURISTIC score (100 − verified-impact penalties; never claimed
  to predict platform rankings), verification summary, recommendations into
  the Phase 18 inbox with `requiresApproval` for anything that would write to
  the site. Fixture/reserved domains (.test/.invalid/.localhost/example) skip
  the network lane and mark everything unverifiable — nothing is fabricated.
- **Routes** (`src/server/management/geo-routes.ts`): `POST /api/agent-os/seo/
  geo/projects/:id/audit` and `GET /api/agent-os/seo/geo/projects/:id/
  recommendations`, inside the existing auth model.

## Honest-degradation guarantee

The orchestrator never invents findings. For every check it either has
verified raw-response evidence, or it reports `unverifiable` with the reason.
The audit result separates `I verified this` from `I could not check this` —
the answer to "เว็บนี้พร้อมสำหรับ AI Search แค่ไหน" is always grounded in
what was actually observed.

## Testing

`bun test tests/geo-phase18-1.test.ts` — deterministic parser coverage
(wildcard/specific UA/allow-override/empty), JSON-LD extraction incl.
malformed blocks, SSRF refusals (loopback/private/metadata/invalid), the
honest fixture-mode audit, and inbox integration. Phase 18 regression tests
stay green.

## Deferred to slice 2+ (contract-ready)

Citability passage scoring, brand/entity consistency, platform-readiness
scoring, E-E-A-T content analysis, llms.txt proposal generation, fix
planner + Reviewer Council auto-invocation, dashboard GEO tab (audit is
available via API now).
