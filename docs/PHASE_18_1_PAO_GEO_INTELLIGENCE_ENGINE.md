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

## Additional slices implemented

- Slice 2: passage-level citability and dashboard GEO score/crawler evidence.
- Slice 3: brand/entity consistency, E-E-A-T, and per-platform readiness.
- Slice 4: direct sitemap/canonical/freshness checks and safe llms.txt proposal
  generation. Proposals include only validated same-domain HTTPS URLs, exclude
  sensitive/admin paths, are preview/copy-only, and have no deploy endpoint.

## Reviewer Council & fix planner (slice 5)

Every audit can be reviewed by a deterministic 3-reviewer council — evidence
integrity, risk, and epistemic honesty — recorded into the existing reviews
ledger and aggregated with the same summarizeCouncil() contract as every other
Agent OS subject. The fix planner turns verified findings into an ordered,
approval-bound plan (executionPath: "none"): it proposes, it never executes.
Agents read audit/council results through two WebMCP tools (get_seo_geo_audit,
get_seo_geo_council, both R0 read-only with the shared audit trail); a council
never grants a pass when the audit verified nothing.

The same surface is available without a browser through `ocx seo`:

```text
ocx seo health --json
ocx seo projects
ocx seo analyze <projectId>
ocx seo geo-audit <projectId>
ocx seo council <projectId>
ocx seo report <projectId>
```

Every audit stores a bounded normalized snapshot in `seo_runs.result_json`.
Council reviews that exact snapshot without re-fetching the website. Repeated
audits upsert open recommendations by project/area/title, and repeated council
calls reuse the same three reviews; old user-owned duplicates are never
silently deleted.

## Deferred (contract-ready)

Nothing inside the Phase 18.1 scope. Website changes remain a human approval
+ manual/CI workflow by design; there is no write or deployment path in this
engine.
