# PHASE_30_36_RECON.md — Repository Reconnaissance (Stage 0)

> Required by Phase 30.36 §41 before implementation. Summarizes the discovered
> architecture and the exact integration plan for the Pao Business Builder.

## 1. Discovered stack

| Aspect | Finding |
| --- | --- |
| Language / runtime | Bun-native TypeScript, strict mode, ES modules, no compile step |
| Package manager | Bun (`bun install`, `bun test`, `bun run *` scripts) |
| Module layout | `src/agent-os/<domain>/` per phase domain; management routes in `src/server/management/` with full-literal guards + `route-registry.ts` declarations; GUI in `gui/` (React + Vite, hash routing, i18n ×10) |
| Database | Single shared SQLite (`openAgentOsDb`), additive `CREATE TABLE IF NOT EXISTS` migrations gated by `AGENT_OS_SCHEMA_VERSION` (currently 35) |
| Migration convention | No ORM — static single-line SQL with bound parameters, check-then-insert (no upserts), row mappers in store files |
| API conventions | `jsonResponse` + typed error bodies, ids in JSON body, chain dispatch in `agent-os-routes.ts`, `deferred-verb` exemptions pointing at owner docs |
| MCP conventions | `WebMcpToolDefinition` registries per domain (`riskTier` R0–R4, `readOnly`, `execute`), e.g. video/mcp-tools.ts, leads/mcp-tools.ts, unified-runtime/mcp-tools.ts |
| UI | Glassmorphic pages under `gui/src/pages/` with `ur-*` classes, `app-routing.ts` Page union + VALID_PAGES, nav keys ×10 locales, `.oxlintrc.json` page ignore list |
| Auth / RBAC | Management API behind admin token + dashboard session; human-actor invariant pattern (`/^(operator|dashboard|user|human|owner)/i`) for governance mutations |
| Audit | Per-domain audit tables + shared `recordAgentEvent` trail (`agent_events`) |
| Jobs | Synchronous job records with statuses (leads, speech); no external queue dependency |
| AI providers | The proxy itself (`/v1/*`) + Phase 20.30 alias/policy layer + Phase 20.35 unified runtime control plane |
| Existing business-adjacent modules | Lead Intelligence (20.34), Universal Capability Registry (20.25), lead/social/SEO data modules, video/stock pipelines, `projects/`-style generation precedents (Phase 20.33 `projects/generated/<slug>` pack layout) |

## 2. Existing concepts to REUSE (no duplication)

1. **Capability inventory** — Phase 30.36 §11 requires a capability registry that
   reflects reality. The Business Builder derives it from live module state:
   feature flags (leads/speech/douyin), the unified-runtime provider registry,
   cockpit agent detection, and the MCP tool registries. No hardcoded fit scores.
2. **Weighted scoring with confidence + evidence** — same shape as the lead
   scoring engine (versioned profiles, evidence arrays, deterministic).
3. **Compliance gate** — GREEN/YELLOW/RED/UNKNOWN rule evaluation in the same
   fail-closed style as the speech/stock gates; RED blocks MVP compilation.
4. **Source adapter + provenance** — the Phase 20.24 artifact-provenance pattern:
   repo URL / path / commit / imported_at / content_hash / license (LICENSE_UNKNOWN
   when undetected), dry-run + incremental imports, duplicate detection by slug +
   content hash, manual-edit protection.
5. **Audit** — `recordAgentEvent` (`business.*` kinds) + a domain audit table.
6. **MVP/Codex pack output** — pack layout per spec §34 under a configurable
   output directory (default under the OpenCodex config dir; overridable for tests).

## 3. Security posture carried over

Imported repository content is **untrusted data**: the parser whitelists keys,
strips HTML/script/control characters, never parses shell/code execution fields,
and no code path passes imported text to any process runner. Prompt-injection
defense is structural: the compiler reads only normalized fields from the
registry, never raw Markdown, and tests inject hostile content to prove it stays
inert. External fetches go through the Phase 20.24 SSRF policy; repo cloning is
flag-gated and reads a locally prepared directory by default.

## 4. Integration plan (mapping spec stages → this repo)

| Spec stage | Implementation |
| --- | --- |
| Stage 1 domain models | `src/agent-os/business-builder/types.ts` |
| Stage 2 database | `AGENT_OS_SCHEMA_VERSION` 35 → 36, ten additive `biz_*` tables |
| Stage 3 source adapter | `sources.ts` (markdown parser, sanitizer, license detection, content hash, dry-run/incremental/duplicate handling) |
| Stage 4 registry | `store.ts` + `service.ts` CRUD/versioning |
| Stage 5 capability registry + Pao Fit | `capabilities.ts` (derived inventory) + `policy.ts` fit scorer |
| Stage 6 scoring | `policy.ts` weighted engine (weights configurable, evidence-based confidence) |
| Stage 7 compliance gate | `policy.ts` dimension rules; compile blocked on RED/UNREVIEWED |
| Stage 8 cost/dependency | `policy.ts` cost estimator over declared API dependencies |
| Stage 9 MVP compiler | `compiler.ts` deterministic reduction pipeline (§14 anti-SaaS rules) |
| Stage 10 Codex pack | `compiler.ts` artifact writer (spec §34/§35 file set) |
| Stage 11 experiments | `service.ts` metric updates + decision engine (KEEP/ITERATE/PIVOT/KILL with evidence) |
| Stage 12 MCP | `mcp-tools.ts` (`business.*` namespace, 15 tools) |
| Stage 13 UI | `gui/src/pages/BusinessBuilder.tsx` (tabs: Opportunities / Import / Compare / Experiments / Capabilities / Compliance) |
| Stage 14 tests | `tests/business-builder.test.ts` |

Routes follow the repo convention: `/api/agent-os/business/*` (spec §25 route
style adapted per the spec's own instruction to match existing patterns).
