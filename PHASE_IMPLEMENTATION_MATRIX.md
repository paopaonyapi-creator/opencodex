# PHASE IMPLEMENTATION MATRIX

> GOLD mode artifact (GOLD §37). Created 2026-09-17 by the GOLD productionization run.
> **Source of truth rule:** status reflects the **current working tree** (branch `paohupbypaoza`), not documentation claims. The working tree carries ~3,412 uncommitted file changes (~509k insertions) implementing phases 20.20→20.63 on top of HEAD `77fa6416f` (Phase 20.19).
>
> Status vocabulary: `NOT_STARTED` · `PARTIAL` · `IMPLEMENTED` · `VERIFIED` · `SUPERSEDED` · `BLOCKED`.
> - `IMPLEMENTED` = real code + wired config present in the working tree and an implementation report claims its focused tests passed.
> - `VERIFIED` = re-verified in this GOLD run (tests executed here, output inspected). Reserved — nothing is auto-promoted to VERIFIED.
> - Verification column values: `report-claimed` (report only) / `this-run` (re-run here).

## 0. Roadmap series (Phases 00–16, original roadmap)

| Phase | Purpose | Dependencies | Current State | Implemented Components | Missing Components | Superseded By | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| 00 | Repository audit baseline | — | done historically | `.tmp/paohubpro-docs/Pao-hubPro_Phases_0-16/` | — | — | report-claimed | SUPERSEDED |
| 01 | OpenHarness | 00 | **not implemented** | — | harness runtime | — | status doc admits | NOT_STARTED |
| 02 | Agent Registry | 00 | implemented | `src/agent-os/registry.ts` | — | — | report-claimed | IMPLEMENTED |
| 03 | Pao Commander | 02 | unmapped | — | — | — | status doc | NOT_STARTED |
| 04 | Task Queue | 02 | implemented | `src/agent-os/tasks.ts` | — | — | report-claimed | IMPLEMENTED |
| 05 | Policy | 02 | implemented | `src/agent-os/policy.ts` | — | — | report-claimed | IMPLEMENTED |
| 06 | Model Router (roadmap) | — | unmapped | — | — | 20.13(b)/20.17 ai-gateway lineage | status doc | SUPERSEDED |
| 07 | Memory OS | 02 | implemented | `src/agent-os/memory.ts` | — | — | report-claimed | IMPLEMENTED |
| 08 | Skill Store | 07 | implemented | `src/agent-os/skills.ts` | — | — | report-claimed | IMPLEMENTED |
| 09 | Workflow | 08 | implemented | `src/agent-os/workflow.ts` | — | — | report-claimed | IMPLEMENTED |
| 10 | Teams | 09 | implemented | `src/agent-os/teams.ts` | — | — | report-claimed | IMPLEMENTED |
| 11 | Observability | 10 | implemented | `src/agent-os/observability.ts` | — | — | report-claimed | IMPLEMENTED |
| 12 | Remote Nodes | 11 | track-only | `src/agent-os/remote.ts` | live node federation | — | report-claimed | PARTIAL |
| 13 | Self-Improvement | 12 | unmapped | — | — | — | status doc | NOT_STARTED |
| 14 | Marketplace | 13 | unmapped | — | — | 20.57 SkillsGate direction | status doc | NOT_STARTED |
| 15 | Agent OS V1 stable / WebMCP | 02–11 | implemented (WebMCP slice) | `gui/src/webmcp/` (9 P0 tools) | — | — | report-claimed | IMPLEMENTED |
| 15/16 dual | AI Media Factory × Huobao | — | implemented | `docs/PHASE_16_COMPLETION_REPORT.md`, 64/64 tests | — | 20.6/20.7 generation stack | report-claimed | IMPLEMENTED (number reused) |
| 18 | SEO Agent OS | 02–11 | **partial (slice 1)** | `src/agent-os/seo/{types,errors}.ts` | remaining agents (contract-ready only) | 18.1 | report admits PARTIAL | PARTIAL |
| 18.1 | GEO Intelligence | 18 | implemented (slices 1–5) | `src/agent-os/seo/geo/` | — | — | report-claimed | IMPLEMENTED |
| 19 | AI Generation Studio × ComfyUI | — | imported as pinned base | `src/agent-os/generation/` | — | 20.x reuse | git evidence | IMPLEMENTED (number reused by 20.x series) |

## 1. Phase 20.x series (Pao-hubPro × …)

| Phase | Title | Dependencies | Current State | Implemented Components | Missing Components | Superseded By | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| 20 | Multi-GPU RunPod workload router | 19 | implemented | `workload-analyzer/gpu-catalog/router/cost-guard/meter` + routes, 51/51 tests | — | — | report-claimed | IMPLEMENTED |
| 20.1 | ComfyUI smart queue × cloud burst | 20 | implemented | SQLite backlog, `gen_dispatch_leases` | — | — | report-claimed | IMPLEMENTED |
| 20.2 | Spec-driven SDLC orchestrator | 05,09 | implemented | `src/agent-os/sdlc/` | — | — | report-claimed | IMPLEMENTED |
| 20.3 | Desktop vision control MCP | 20.2 | implemented | `src/agent-os/desktop/` | live-device verification | — | report-claimed | IMPLEMENTED |
| 20.4 | Engineering council × worktrees | 20.2 | implemented | `src/agent-os/council/` | — | — | report-claimed | IMPLEMENTED |
| 20.5 | Living knowledge brain | 07 | implemented | `src/agent-os/knowledge/` | — | 21(a) gateway | report-claimed | IMPLEMENTED |
| 20.6 | MiniMax H3 image studio | 19 | implemented | schema v12, `/api/h3/*`, 32/32 tests | — | — | report-claimed | IMPLEMENTED |
| 20.7 | AI video factory × MoneyPrinterTurbo | 20.6 | implemented | schema v13, `src/agent-os/video/` | — | 20.31 delta | report-claimed | IMPLEMENTED |
| 20.8 | Agency specialist router | 08 | implemented | `src/agent-os/agency/` (147-skill index) | — | — | report-claimed | IMPLEMENTED |
| 20.9a | Chatbox agent desktop runtime | 09 | implemented | schema v15, 26/26 tests | — | — | report-claimed | IMPLEMENTED |
| 20.9b | Ponytail minimal-code governance | 20.9a | implemented | `src/agent-os/governance/` (7-rung ladder) | — | — | report-claimed | IMPLEMENTED |
| 20.10 | Trend intelligence × Apify × Adobe Stock | 20.6 | implemented | schema 18, `src/agent-os/trends/`, 18/18 | — | — | report-claimed | IMPLEMENTED |
| 20.11 | Pao-hubPro Browser runtime | 09 | implemented | schema 20, `src/agent-os/browser/`, 133 tests across 3 suites | — | — | report-claimed | IMPLEMENTED |
| 20.12a | Browser workflow intelligence | 20.11 | implemented | schema 21, `browser_workflows`, 14 MCP tools | — | — | report-claimed | IMPLEMENTED |
| 20.12b | ARTEMIS mobile gateway | 20.11 | implemented | schema 25, `src/agent-os/mobile/` | **typecheck errors in `mobile/mcp-tools.ts`** | 20.55 extends | **this-run typecheck: FAIL** | IMPLEMENTED (defects open) |
| 20.13a | Browser multi-agent web ops | 20.12a | implemented | schema 22, 5 personas, 15 MCP tools | — | — | report-claimed | IMPLEMENTED |
| 20.13b | Experiential AI gateway + council | 20.4 | implemented | `src/ai-gateway/` (13 test files) | — | 20.17/20.51 | report-claimed | IMPLEMENTED |
| 20.13c | Video intelligence × Claude Watch | 20.7 | implemented | `src/agent-os/video-intelligence/` | — | — | report-claimed | IMPLEMENTED |
| 20.14a | Browser remote worker fleet | 20.13a | implemented | schema 23, 10 `browser.remote.*` tools | — | — | report-claimed | IMPLEMENTED |
| 20.14b | Stock autonomous pipeline | 20.10 | implemented (no report) | `src/agent-os/stock-pipeline/` | — | 21(b) campaign | git evidence | IMPLEMENTED |
| 20.14c | Visual knowledge & media memory | 20.13c | implemented | `src/agent-os/media-memory/`, 8 WebMCP tools | — | — | report-claimed | IMPLEMENTED |
| 20.15 | Domain control plane | 09 | implemented, core verified | `src/agent-os/domain-control/` + routes | not exercised against live provider | — | report-claimed | IMPLEMENTED |
| 20.16 | Multi-AI control plane | 20.11–20.15 | implemented | `src/agent-os/control-plane/` (8 files), 11 REST, 39 MCP, 61 pass | media pipeline data-model only | 20.27 cockpit | report-claimed | IMPLEMENTED |
| 20.17 | Adaptive LLM gateway (experiential) | 20.13b | implemented | `src/agent-os/ai-router/`, baseline doc | no live upstream exercised | 20.51 | report-claimed | IMPLEMENTED |
| 20.18 | Grok bridge | 20.17 | implemented | bridge + provider + extension, mock-verified | not exercised against live Grok | — | report-claimed | IMPLEMENTED |
| 20.19 | Universal AI browser provider | 20.11,20.18 | implemented (HEAD) | `src/agent-os/browser-provider/`, extension + side panel | 3 of 4 site adapters declaration-only | — | commits + report | IMPLEMENTED |
| 20.20a | Social intelligence engine | 20.11 | implemented, core | `src/agent-os/social/` | dashboard + operational surfaces deferred | 20.60 | spec-status | PARTIAL |
| 20.20b | ECC Agent Harness OS | 20.4 | implemented | `src/agent-os/ecc/`, 39/39 tests | — | — | report-claimed | IMPLEMENTED |
| 20.21 | Codex native runtime integration | 20.16 | implemented (spec header stale) | `src/agent-os/codex-runtime/` + routes + tests | — | — | artifact evidence | IMPLEMENTED |
| 20.22 | LangChain orchestration + MCP | 20.21 | implemented (no report) | `src/agent-os/orchestration/` + routes + tests | — | 20.37 | artifact evidence | IMPLEMENTED |
| 20.23 | Notification gateway × Discord | 09 | implemented (no report) | `src/agent-os/notifications/` + routes + tests | — | — | artifact evidence | IMPLEMENTED |
| 20.24 | OmniGet media acquisition | 20.13c | implemented | `src/agent-os/media-acquisition/`, GPL boundary via CLI runner | — | — | report-claimed | IMPLEMENTED |
| 20.25 | Universal registry & toolchain | 09,20.9b | implemented (A–E + G) | `src/agent-os/universal-registry/` + docs/phase-20.25/ | — | — | owner-doc | IMPLEMENTED |
| 20.26 | Douyin media intelligence | 20.24 | implemented (MVP) | `src/agent-os/douyin/`, 32/32 | — | — | test-report | IMPLEMENTED |
| 20.27 | VibeRaven cockpit + readiness gate | 20.16 | implemented (A–C + D slice) | `src/agent-os/control-plane/cockpit`, 22/22 | remaining gate milestones | — | test-report | IMPLEMENTED |
| 20.28 | Governed agent computer (fabric) | 20.9b | implemented | `src/agent-os/governance-gateway/` + `gov_*` tables, 15/15 | — | — | root report | IMPLEMENTED |
| 20.29 | ClawFlows workflow registry | 20.28 | **implemented & verified (auto-seeding wired)** | `src/agent-os/workflows/` (compiler, parser, runtime, store, types) + `automation-routes.ts`; auto-seeds all 8 repo `WORKFLOW.md` files on startup/inspection | GUI page deferred | — | **this-run: 16/16 pass incl. 8-workflow seed** | VERIFIED |
| 20.30 | Universal AI coding gateway (FCC) | 20.17 | implemented (control-plane slice) | alias/policy routing over `src/router.ts` | execution reuses proxy (by design) | — | owner-doc | IMPLEMENTED |
| 20.31 | MoneyPrinterTurbo + Adobe Stock automation | 20.7 | implemented (delta) | IP guard + versioned policy over video | — | — | owner-doc | IMPLEMENTED |
| 20.32 | VoiceStudio speech runtime | 20.9a | implemented (delta) | `src/agent-os/speech/`, validated 2026-09-13 | — | — | owner-doc | IMPLEMENTED |
| 20.33 | Open WebUI workspace + MCP | 20.17 | implemented (reuse-first) | `integrations/open-webui/` (compose, verify.py) | — | — | owner-doc | IMPLEMENTED |
| 20.34 | Lead intelligence control plane | 20.2 | implemented (P0) | `src/agent-os/leads/` + tests | — | 20.78 blueprint exists (Downloads) | owner-doc | IMPLEMENTED |
| 20.35 | Transgentic unified runtime | 20.30 | implemented (delta) | `src/agent-os/unified-runtime/` + routes | — | — | owner-doc | IMPLEMENTED |
| 20.36 | *(unused number)* | — | no doc, no module | — | — | — | — | NOT_STARTED |
| 20.37 | OrchestKit agentic dev OS | 20.35 | implemented (delta) | intake/router/hooks/audit + tests | — | — | owner-doc | IMPLEMENTED |
| 20.38 | OFFPack dependency vault | 20.35 | implemented (slice) | `src/agent-os/dep-vault/`, schema v38, SHA-512 verify | — | — | owner-doc | IMPLEMENTED |
| 20.39 | Claude Code session cockpit | 20.21 | implemented (verbs deferred) | `src/agent-os/ai-workspace/` + `coding-cockpit/` + tests | CLI/dashboard verbs intentionally deferred | — | owner-doc | IMPLEMENTED |
| 20.40 | Infrastructure observability (CheckCle) | 20.11 | implemented | `src/agent-os/agent-observability/` + tests | — | — | artifact evidence | IMPLEMENTED |
| 20.41 | Memory plane (OAuth) | 07,20.5 | implemented | `src/agent-os/memory-plane/` + tests | — | 20.43 extends | artifact evidence | IMPLEMENTED |
| 20.42 | Named AI teammate workspace | 20.21 | implemented | `src/agent-os/bot-workspace/` + tests | — | — | artifact evidence | IMPLEMENTED |
| 20.43 | PLUR shared agent memory | 20.41 | implemented | `src/agent-os/plur-memory/` (schema v43, 22 routes), 24/24 | PLUR binary absent → LocalFallbackEngine (exercised) | — | impl report | IMPLEMENTED |
| 20.44 | *(unused number)* | — | no doc, no module | — | — | — | — | NOT_STARTED |
| 20.45 | The Curator | — | named in 20.54 spec only | — | — | — | — | NOT_STARTED |
| 20.46 | *(unused number)* | — | no doc, no module | — | — | — | — | NOT_STARTED |
| 20.47 | Oh My Pi agent terminal | — | named in 20.54 spec only | — | — | — | — | NOT_STARTED |
| 20.48–20.49 | *(unused numbers)* | — | no doc, no module | — | — | — | — | NOT_STARTED |
| 20.50 | Hermes MaxPlus credit | — | named in 20.54 spec only | — | — | 20.51 satisfies reuse rule | — | NOT_STARTED |
| 20.51 | 9Router multi-provider gateway | 20.17 | implemented (core) | ai-router extension + 4 test suites + deploy/9router + runbooks | sidecar disabled by default (`nine-router.yaml enabled:false`) | — | owner-doc | IMPLEMENTED |
| 20.52 | Stock market signal automation | 20.51 | implemented (core) | `src/agent-os/market/`, paper-trading-first, `LIVE_EXECUTION_DISABLED` | live execution compile-time disabled (by design) | — | owner-doc | IMPLEMENTED |
| 20.53 | OpenViking context control plane | 20.5 | implemented (core) | `src/agent-os/context/` + security tests + deploy/openviking | AGPL sidecar optional | — | owner-doc | IMPLEMENTED |
| 20.54 | Agent platform (MS agents-for-beginners) | 20.28 | implemented | `src/agent-os/agent-platform/` (manifests, 10 patterns, R0–R4, secure envelope) | — | — | **this-run: typecheck fixed + 56 focused pass** | IMPLEMENTED |
| 20.55 | ARTEMIS → Pao mobile runtime | 20.12b | implemented | Flash/Pro router, device leases, `pao.mobile.*` | — | — | owner-doc | IMPLEMENTED |
| 20.56 | Micro-app capability lab (qxresearch) | 20.28 | implemented | `src/agent-os/capability-lab/` + tests | follow-ups 20.56.1–.6 not implemented | — | **this-run: typecheck fixed** | IMPLEMENTED |
| 20.57 | SkillsGate skill control plane | 08,20.25 | **implemented & verified (service + MCP + routes wired)** | `src/agent-os/skill-gate/` (12 files: types, store, scanner, policy, snapshot, adapters, git-transport, sources, paths, frontmatter, service, mcp-tools), schema v47 (`sg_*`), management routes `/api/agent-os/skill-gate/*`, 3 MCP tools (`pao.skill.*`) | SSH transport (deferred); marketplace remote (mock/local only) | — | **this-run: 5/5 pass incl. scanner + import + publish + deploy** | VERIFIED |
| 20.58 | Security plane | 20.28 | **implemented & verified (restored from commit 43b955adc)** | `src/security/` (19 files: service, db, gateway, policy, approval, rbac, scope, campaign, findings, evidence, fixtures, leads, memory, token, circuit, importer, hooks, enabled, index), management routes `/api/security/*`, CLI `ocx security` | — | — | **this-run: 43/43 pass across 4 test suites** | VERIFIED |
| 20.59 | Credential runtime | 20.58 | **implemented & verified (restored from commit 43b955adc)** | `src/credentials/` (18 files: service, db, vault, adapters, circuit, policy, rbac, redact, retry, health, lifecycle, events, enabled, constants, types, index), management routes `/api/credentials/*`, CLI `ocx credentials` | — | — | **this-run: 35/35 pass across 4 test suites** | VERIFIED |
| 20.60 | OpenPost social publishing | 20.20a,20.23 | implemented (P0+P1) | `src/agent-os/social-publishing/` (16 files), schema v48, 37 pass, live OpenAPI verified | — | — | root report | IMPLEMENTED |
| 20.61 | amux agent runtime control plane | 20.54 | implemented | `src/agent-os/agent-runtime/` (13 files), schema v49, 27 pass | real command execution deferred behind `PAO_AGENT_RUNTIME_DISPATCH_ENABLED` (Stage B/C) | — | root report (blueprint dated later disputes "production acceptance") | IMPLEMENTED |
| 20.62 | Graft code intelligence | 20.54 | implemented (seams) | `src/agent-os/code-intelligence/` (11 files), schema v50, 34 pass | graft binary not installed — verified via fakes/runner seams | — | root report | IMPLEMENTED |
| 20.63 | Public APIs external registry | 20.63 | implemented (A–B) | `src/agent-os/external-apis/` (8 files), schema v51, 20 pass | discovery crawler + worker scheduling flag-gated (Stage C) | — | root report ("STATUS: READY") | IMPLEMENTED |
| 20.64 | Vercel vgpu Visual Compute | 19, 20 | **implemented & verified (MCP tools + tests wired)** | `src/agent-os/visual-compute/` (mcp-tools, runtimes, wgsl, types), 3 focused pass | WebGPU browser adapter | — | **this-run: 3/3 pass** | VERIFIED |
| 20.81 | OpenCodeReview runtime | 20.80 | **implemented & verified (slices 1–3)** | `src/agent-os/code-review/` (7 files: types, rules, capture, diff-parser, engine, reviewer, service), schema v52→v53 (`cr_sessions`, `cr_findings`, `cr_gate_results`), REST surface `/api/agent-os/code-review/*`, CLI `ocx review` (workspace/preview/commit/range/sessions/session), skills/ocx surface | OCR CLI adapter seam, Reviewer Council bridge full wiring | — | **this-run: 16 pass across 2 test suites incl. E2E-3** | VERIFIED (slices 1–3) |
| 20.82 | CortexKit AFT sensorimotor runtime | 20.80, 20.81 | **production-hardened (transactional loop + provider hardening)** | `src/agent-os/sensorimotor/` (+`workspace-lock.ts`), schema v56 (+`sm_idempotency`, `sm_actions.verified`), REST `/api/agent-os/sensorimotor/*` (+readiness matrix), MCP `pao.aft.*` (+readiness/idempotency), `decision/provider-mode.ts`, hardened `model-gateway/adapters/omniroute.ts`, docs `PHASE_20.82_AFT_SENSORIMOTOR_RUNTIME.md` | LSP-grade symbol resolution (pinned AFT toolchain), PTY streaming, multi-process workspace lock | — | **this-run: 162 pass (13 AFT + 81 hardening + 12 gateway-doctor + 56 GUI/route/parity adjacent)** — per-workspace locking, idempotent replay, stale-session refusal, post-action verification, flag-aware git blocklist + shell side-door closure, OmniRoute health-cache/retry-backoff/correlation-ids/structured failures (offline=degraded), Jev real\|simulated\|disabled with honest unavailability, MCP/REST parity, secret redaction, TODO_PROVIDER_SCHEMA removed | VERIFIED |
| 20.84 | TypeSafe Jev Decision Intelligence | 20.85 | **implemented & verified (engine, calibration, fusion, audit + provider modes + staged readiness report)** | `src/agent-os/decision/` (contracts, calibration, fusion, engine, types, `provider-mode.ts`), schema v54 (`dec_*`), 10-stage policy fusion | TypeSafe live early-access API (real mode reports missing_credential/missing_schema structurally; calibrated simulation is the named dev/test backend) | — | **this-run: 7/7 pass + 11 mode tests in aft-hardening + staged readiness report (validateJevReadiness, `pao.decision.jev-status` MCP)** | VERIFIED |
| 20.85 | OmniRoute Unified AI Gateway | 20.84, 20.72 | **implemented & verified (gateway, budget, routing, circuit, CLI + connection hardening)** | `src/agent-os/model-gateway/` (registry, envelope, budget, circuits, direct/omniroute adapters with health-cache, bounded retry/backoff, correlation headers, structured `OmniRouteFailure`, fast-fail on fresh cached-unreachable, `ocx gateway doctor [--probe]` live validation), schema v54 (`gw_*`), CLI `ocx gateway`, GUI `ModelGateway.tsx` | live remote OmniRoute daemon (Direct fallback active; offline = degraded, never a crash) | — | **this-run: 8/8 pass + 9 degradation tests in aft-hardening** | VERIFIED |
| 20.89 | Bubble / Capability Hub — registry-first capability marketplace | 20.82, 20.85, 20.86, 20.56 | **implemented & verified (registry, manifest pipeline, phase importer, transactional installer, policy engine, health, audit, REST/MCP/GUI)** | `src/agent-os/marketplace/` (types, canonical-phases, manifest, policy, registry, phase-importer, installer, service, mcp-tools), schema v57 (`mk_*` tables — `cap_*` owned by live 20.56), REST `/api/agent-os/marketplace/*`, MCP `marketplace.*`, GUI `Marketplace.tsx`, docs `PHASE_20.89_CAPABILITY_HUB.md` + `docs/reports/PHASE_REGISTRY_RECONCILIATION.md` | curated collections UI (P1), enable/disable lifecycle + source/runtime adapters (P3), OmniRoute/MCP publish wiring (flagged) | — | **this-run: 50 pass (manifest 11 + core 18 + security 12 + api 7 + gui 3 within)** — canonical lock 31/31 phases registered (0 collisions, regression-tested 20.65/20.65.1 + 20.88/20.90), fail-closed manifest validation (QUARANTINE), transactional installer w/ rollback, approval gates, secret redaction, SSRF guard | VERIFIED |

## 2. Phase 21–25 series (autonomous operations)

| Phase | Title | Dependencies | Current State | Implemented Components | Missing Components | Verification | Status |
|---|---|---|---|---|---|---|---|
| 21a | Knowledge layer + grounded gateway | 20.5 | implemented | knowledge gateway, 23/23 + 67/67 | — | report-claimed | IMPLEMENTED |
| 21b | Stock autonomous campaign planner | 20.14b | implemented (no report) | `src/agent-os/campaign/` | — | git evidence | IMPLEMENTED |
| 22 | Autonomous change control (ACC) | 20.4,20.9b | implemented | `src/agent-os/change-control/` + routes | — | report-claimed | IMPLEMENTED |
| 23 | Self-healing fleet (AOF) | 22 | implemented | `src/agent-os/operations/` | — | report-claimed | IMPLEMENTED |
| 24 | Cost & token economy governor | 23 | implemented | `src/agent-os/economy/` | — | report-claimed | IMPLEMENTED |
| 25 | Zero-trust security shield (ASTIS) | 22–24 | implemented | `src/agent-os/security/` (threat-detector, quarantine-guard, security-vault) | distinct from absent 20.58 `src/security/` | report-claimed | IMPLEMENTED |
| 30.36 | Software income playbooks | 20.2 | implemented (P0) | `src/agent-os/business-builder/`, schema v36, 20 routes, 14 MCP tools, 14 pass | deterministic scoring only; manual clone; no fuzzy dedupe; 30.37 recommended (no trace) | root report | IMPLEMENTED |

## 3. Known conflicts & discrepancies (GOLD §1 recording duty)

1. **Number reuse (historical):** 20.9, 20.12, 20.13 (×3), 20.14 (×3), 20.20, 21, 15/16 dual-use. Recorded; no renumbering performed (backward compatibility).
2. **Stale status lines:** 20.21 spec says "Ready for implementation" while module+routes+tests exist; 20.19 doc says extension "not built" while HEAD commits built it. Docs stale, code newer.
3. **20.57 SkillsGate:** recon planned a report never written; implementation commit lives only on `backup/admiring-noyce-main-based`; the working tree holds a divergent rewrite missing planned files; 20.60 report confirms pre-existing typecheck errors. Treat as BLOCKED/in-flight until repaired.
4. **20.58/20.59:** exist only as commit `e2f5e62af` on the backup branch — **absent from the current working tree**. Decision recorded: treat as NOT_STARTED for the current checkout; recovery from the backup branch is the candidate fix path (needs security review first per AGENTS.md — those are auth/credential subsystems).
5. **Blueprint-vs-report tension (20.61/20.62):** later-dated blueprints assert "production acceptance NOT asserted" while earlier reports claim green gates. Resolution: reports describe test-pass status of the control-plane slice; blueprints describe full production acceptance. Both recorded; nothing auto-promoted to VERIFIED.
6. **Uncommitted tree:** the entire 20.20→20.63 implementation exists only as ~3,412 uncommitted changes. GOLD must establish a clean commit baseline before further mutation.
7. **Two workflow engines:** browser workflow intelligence (20.12a: `src/agent-os/browser/workflow/`) vs automation engine (20.29: `src/agent-os/workflows/`). Distinct registries; consolidation candidate (recorded, not merged during GOLD without a dedicated decision).
8. **Repo `workflows/` dir not auto-loaded** by the 20.29 engine; `workflows/research/` is empty.

## 4. Verification ledger for this GOLD run

- Typecheck (`bun run typecheck`): **FAIL — pre-existing**. Errors in `agent-platform/service.ts` (2), `capability-lab/service.ts` (5), `mobile/mcp-tools.ts` (2), `skill-gate/store.ts` (1), `visual-compute/runtimes.ts` (1). Recorded as baseline; repair is GOLD work item #1.
- Full test suite (`bun run test`): logged to `.tmp/gold-baseline-test.log` (running at matrix creation; result recorded in GOLD_IMPLEMENTATION_STATUS.md).
- Known environment-only failures (AGENTS.md): 5 documented container-only failures; not regressions.
