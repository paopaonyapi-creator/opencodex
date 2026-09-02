# Phase 18 Checklist

Slice 1 status (verified this commit):

- [x] Existing architecture inspected (Agent OS db, provider registry, policy, gateway, reviews, routes, GUI)
- [x] SEO provider contract implemented (src/agent-os/seo/types.ts)
- [x] MCP connection implemented (OpenSeoMcpClient, JSON-RPC)
- [x] Capability discovery implemented (tools/list -> normalized capabilities)
- [x] Provider health implemented (healthy/degraded/offline/misconfigured/unauthorized)
- [x] Security warning implemented (public no-auth = CRITICAL, loopback = WARNING)
- [x] SEO Project Context implemented (seo_projects table + CRUD API)
- [x] Policy system implemented (safe defaults, deny-by-default writes)
- [x] Orchestrator implemented (capability-gated analysis lane + runs)
- [x] Keyword Agent implemented (quick-win recommendations)
- [x] Competitor Agent implemented (overlap recommendations)
- [x] MockSeoProvider works end-to-end (provenance=mock everywhere)
- [x] Recommendation inbox implemented (approve/dismiss lifecycle)
- [x] Dashboard page implemented (#seo, all locales translated)
- [x] Tests pass (17 Phase 18 tests; 52 Agent OS tests total)
- [x] Typecheck passes; GUI build passes
- [x] Documentation created
- [x] No secrets committed

Deferred to later slices (capability-gated, contract ready):

- [ ] Keyword Cluster / SERP / Content Gap / Content Planner agents
- [ ] Technical SEO agent (crawler/Lighthouse integration)
- [ ] Backlink/GSC/Local/AI-visibility agents beyond overview lane
- [ ] Reviewer Council auto-invocation on approved fix plans
- [ ] Auto-fix planner (git branch + minimal patch + gates)
- [ ] Baseline reports & scheduled runs
- [ ] SEO project setup wizard
