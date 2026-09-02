# Phase 18.1 Checklist — Slice 1

- [x] Phase 18 implementation inspected; no duplicate SEO infrastructure created
- [x] GEO module integrated into Phase 18 architecture (same project/inbox/run ledger)
- [x] GEO orchestrator implemented (capability-gated, honest degradation)
- [x] AI crawler agent implemented (deterministic robots parsing, raw-file evidence lines)
- [x] Deterministic robots verification implemented (groups, longest-match, 404/unknown states)
- [x] llms.txt direct verification implemented (404→MISSING, failure→UNKNOWN)
- [x] Schema verification against raw HTML implemented (JSON-LD, malformed-safe)
- [x] Evidence verification layer implemented (hash, status, final URL, excerpts)
- [x] False-positive suppression implemented (contradicted findings dropped + counted)
- [x] GEO scoring implemented (explicit HEURISTIC score, never platform-ranking claims)
- [x] Recommendations carry evidence + basis + verification state
- [x] Policy integration (requiresApproval on anything write-shaped; no site writes exist)
- [x] SSRF protections implemented and tested (literal + post-DNS, metadata blocked)
- [x] Phase 18 regression tests pass
- [x] Typecheck passes
- [x] Documentation complete
- [x] Upstream treated as concept reference only (no code copied, nothing installed)

Deferred to slice 2+ (contract-ready, not yet implemented):

- [x] Citability agent with passage-level scoring (slice 2, geo/citability.ts)
- [x] Brand authority + entity consistency analyzers (slice 3, geo/entity.ts)
- [x] Platform readiness agent (slice 3, geo/platform.ts, basis=general_retrieval_principle)
- [x] Content / E-E-A-T agent (slice 3, geo/eeat.ts)
- [ ] llms.txt proposal generation
- [ ] GEO technical agent (sitemap/canonical/freshness)
- [ ] Reviewer Council auto-invocation + fix planner
- [x] Dashboard GEO section (slice 2-3: score tiles, crawler list, entity/EEAT tiles, platform readiness)
- [ ] MCP GEO read tools
