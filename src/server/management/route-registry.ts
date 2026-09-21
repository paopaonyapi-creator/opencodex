/**
 * Declared inventory of every reachable management route.
 *
 * DECLARED, not harvested. A grep cannot see this surface: 18 routes are registered
 * through a regex, an `endsWith`, a `pathname.slice`, a prefix decode, a path constant, or a
 * negated `pathname !== "…"` guard, and two of those are live routes whose only textual
 * trace is the negated form. For `GET /api/storage` an equality scan finds solely the dead
 * shadowed copy in `logs-usage-routes.ts` and never the live one.
 *
 * This module is pure DATA and must stay that way. It is imported by
 * `src/server/management-api.ts`, which `tests/core-lab-boundary.test.ts` protects: a user
 * with one provider and no Lab must execute no Lab code. Route paths are strings, so
 * declaring `/api/lab/status` here creates no module edge. Never import a handler, and
 * never import anything from `src/lab/`. The `module` field names the owning file as text
 * for exactly this reason.
 *
 * Reconciliation lives in `tests/management-route-registry.test.ts`, which resolves
 * `(method, path)` pairs from source and fails loudly on a route whose method it cannot
 * determine. Adding a route without declaring it here fails that test.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/**
 * Why a route has no CLI verb. Every value is a claim about the route that a reviewer
 * can check, not a way to quiet the parity test.
 */
export type ExemptionReason =
  /** Requires a dashboard browser session. Includes the user-consent star boundary. */
  | "session-only"
  /** Deliberately returns 405; there is nothing to drive. */
  | "disabled"
  /** Gated on a process-scoped capability principal, not an operator action. */
  | "capability-principal"
  /** A test seam, not an operator capability. */
  | "test-seam"
  /** The CLI reaches the same data through a local transport instead of HTTP. */
  | "local-transport"
  /** Unreachable in the live dispatch order; delete rather than expose. */
  | "dead"
  /**
   * A verb is owed but belongs to a later work-phase. BOUNDED: requires `owner` and
   * `ownerDoc`, and the parity test asserts that tracked doc exists and names the route.
   * The doc is deliberately a repository file rather than the goalplan, which is
   * gitignored -- a test reading machine-local state passes here and finds nothing in CI.
   */
  | "deferred-verb";

export interface RouteExemption {
  readonly reason: ExemptionReason;
  /** Free text; required, because an exemption nobody justified is how a gate erodes. */
  readonly why: string;
  /** Work-phase that owes the verb. Required for `deferred-verb`. */
  readonly owner?: string;
  /** Tracked doc naming the route. Required for `deferred-verb`. */
  readonly ownerDoc?: string;
}

/** How a route is registered, for routes an equality scan cannot see. */
export type NonLiteralMechanism =
  | "negated-guard"
  | "path-constant"
  | "prefix-decode"
  | "slice"
  | "ends-with"
  | "regex";

export interface ManagementRoute {
  readonly method: HttpMethod;
  readonly path: string;
  /** Owning source file, repo-relative without the `src/` prefix or `.ts` suffix. */
  readonly module: string;
  readonly mutates: boolean;
  /** Set when the route is not recoverable from an equality scan of its own file. */
  readonly mechanism?: NonLiteralMechanism;
  readonly exempt?: RouteExemption;
}

/**
 * Shared deferral for the Phase 20.20 social routes: the engine, MCP tools, and REST
 * surface shipped first; CLI verbs belong to the dashboard/CLI follow-up. The owner
 * doc names every deferred route.
 */
const SOCIAL_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.20 ships the engine, MCP tools, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.20 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase-20.20-Pao-hubPro-Social-Intelligence-Engine.md",
} as const;

/**
 * Shared deferral for the Phase 20.20 ECC Agent Harness routes: the harness adapter,
 * safe tools, and REST surface shipped first; CLI verbs belong to the dashboard/CLI follow-up.
 */
const ECC_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.20 ships the ECC harness engine, safe tools, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.20 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.20%20-%20Pao-hubPro%20x%20ECC%20Agent%20Harness%20OS.md",
} as const;

/**
 * Shared deferral for the Phase 20.57 SkillsGate routes: the store, scanner,
 * policy engine, and REST surface shipped first; CLI verbs belong to the
 * follow-up recorded in the owner doc.
 */
const SKILL_GATE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.57 ships the Skill Gate store, scanner, policy, and REST surface first; CLI verbs belong to the follow-up recorded in the owner doc.",
  owner: "Phase 20.57 CLI follow-up",
  ownerDoc: "PHASE_20_57_RECON.md",
} as const;

/**
 * Shared deferral for the Phase 20.21 Codex Native Runtime routes: the native runtime
 * adapter, policy engine, approval broker, and REST surface shipped first; CLI verbs
 * belong to the dashboard/CLI follow-up recorded in the owner doc.
 */
const CODEX_RUNTIME_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.21 ships the native runtime adapter, policy engine, approval broker, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.21 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.21_Pao-hubPro_OpenAI_Codex_Native_Runtime_Integration.md",
} as const;

/**
 * Shared deferral for the Phase 20.22 LangChain Agent Orchestration routes: the
 * orchestration runtime, tool policy, approval bridge, MCP catalog, and REST surface
 * shipped first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.
 */
const ORCHESTRATION_RUNTIME_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.22 ships the LangChain agent orchestration runtime, tool policy, approval bridge, MCP catalog, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.22 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.22.md",
} as const;

/**
 * Shared deferral for the Phase 20.23 Unified Notification Gateway routes: the
 * gateway engine, Discord reliability adapter, priority queue, and REST surface
 * shipped first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.
 */
const NOTIFICATION_GATEWAY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.23 ships the Unified Notification Gateway, Discord webhook reliability adapter, priority queue, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.23 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.23.md",
} as const;

/**
 * Shared deferral for the Phase 20.24 OmniGet Media Acquisition routes: the
 * acquisition engine, queue, processors, MCP tools, and REST surface shipped first;
 * CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.
 */
const MEDIA_ACQUISITION_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.24 ships the OmniGet Local Media Acquisition & MCP Engine, queue, processor, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.24 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.24%20%E2%80%94%20Pao-hubPro%20%C3%97%20OmniGet%20Local%20Media%20Acquisition%20%26%20MCP%20Engine.md",
} as const;

/**
 * Shared deferral for the Phase 20.25 Universal Registry routes: the registry
 * engine, ingestion, search/ranking, planner, permission engine, step executor,
 * and REST surface shipped first; CLI verbs belong to the dashboard/CLI
 * follow-up recorded in the owner doc.
 */
const UNIVERSAL_REGISTRY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.25 ships the Universal Agent Capability Registry, planner, permission engine, step executor, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.25 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.25%20%E2%80%94%20Pao-hubPro%20%C3%97%20Agentic%20AI%20Universal%20Registry%20%26%20Toolchain.md",
} as const;

/**
 * Shared deferral for the Phase 20.26 Douyin Media Intelligence routes: the
 * provider adapter, URL classifier, upstream CLI client, intelligence store,
 * MCP tools, and REST surface shipped first; CLI verbs belong to the
 * dashboard/CLI follow-up recorded in the owner doc.
 */
const DOUYIN_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.26 ships the Douyin provider adapter, intelligence layer, MCP tools, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.26 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.26%20%E2%80%94%20Pao-hubPro%20%C3%97%20Douyin%20Media%20Intelligence%20%26%20Downloader%20Engine.md",
} as const;

/**
 * Shared deferral for the Phase 20.27 Agent Cockpit & Production Readiness
 * Control Plane routes: the cockpit layer (agents, sessions, access modes,
 * approvals, gate, evidence, providers, releases) shipped first; CLI verbs
 * belong to the dashboard/CLI follow-up recorded in the owner doc.
 */
const COCKPIT_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.27 ships the Agent Cockpit, access-mode policy, readiness gate, evidence ledger, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.27 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.27%20%E2%80%94%20Pao-hubPro%20%C3%97%20VibeRaven%20Agent%20Cockpit%20%26%20Production%20Readiness%20Control%20Plane.md",
} as const;

/**
 * Shared deferral for the Phase 20.28 Governance Gateway routes: the gateway
 * pipeline, grants, deny-first policy, approvals, audit chain, kill switch,
 * and REST surface shipped first; CLI verbs belong to the follow-up recorded
 * in the owner doc.
 */
const GOVERNANCE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.28 ships the Governance Gateway pipeline, grants, deny-first policy, approvals, hash-chained audit, and REST surface first; CLI verbs belong to the follow-up recorded in the owner doc.",
  owner: "Phase 20.28 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.28%20%E2%80%94%20Pao-hubPro%20%C3%97%20OpenBot%20Governed%20Agent%20Computer%20%26%20Safe%20Execution%20Fabric.md",
} as const;

/**
 * Shared deferral for the Phase 20.29 Workflow Registry & Safe Automation
 * Engine routes: parser, compiler, registry, runtime, scheduler, import
 * security, and REST surface shipped first; CLI verbs belong to the follow-up
 * recorded in the owner doc.
 */
const AUTOMATION_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.29 ships the WORKFLOW.md parser, compiler, registry, governed runtime, scheduler, import security, and REST surface first; CLI verbs belong to the follow-up recorded in the owner doc.",
  owner: "Phase 20.29 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.29%20%E2%80%94%20Pao-hubPro%20%C3%97%20ClawFlows%20Workflow%20Registry%20%26%20Safe%20Automation%20Engine.md",
} as const;

/**
 * Shared deferral for the Phase 20.30 Universal AI Gateway control-plane
 * routes: alias/policy/budget layer over the EXISTING opencodex proxy router
 * (no second gateway — execution stays in src/router.ts). CLI verbs belong to
 * the follow-up recorded in the owner doc.
 */
const AI_GATEWAY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.30 ships the alias/policy/budget control plane and route preview over the existing proxy router first; CLI verbs belong to the follow-up recorded in the owner doc.",
  owner: "Phase 20.30 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase%2020.30%20%E2%80%94%20Pao-hubPro%20%C3%97%20Free%20Claude%20Code%20Universal%20AI%20Coding%20Gateway%20%26%20Multi-Provider%20Router.md",
} as const;

/**
 * Shared deferral for the Phase 20.32 VoiceStudio speech runtime routes: the
 * provider adapter, governance registries, job pipeline, provenance manifests,
 * and REST surface shipped first; CLI verbs belong to the follow-up recorded
 * in the owner doc.
 */
const SPEECH_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.32 ships the speech provider adapter, voice/consent/license registries, job pipeline, provenance manifests, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.32 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.32_Pao-hubPro_VoiceStudio_Speech_Runtime_Voice_Cloning_Dubbing_MCP_Audio_Engine.md",
} as const;

/**
 * Shared deferral for the Phase 20.33 Open WebUI AI workspace routes: the
 * pao.* MCP gateway, governed tool catalog, aggregate health, and Open WebUI
 * integration shipped first; CLI verbs belong to the follow-up recorded in
 * the owner doc.
 */
const AI_WORKSPACE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.33 ships the Open WebUI integration package, the pao.* policy-aware MCP gateway over the Phase 20.28 governed dispatch, aggregate health, and the dashboard control center first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.33 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.33_Pao-hubPro_Open_WebUI_Unified_AI_Workspace_MCP_Control_Plane_Multi_Model_Agent_Runtime.md",
} as const;

/**
 * Shared deferral for the Phase 20.34 Lead Intelligence routes: the provider
 * adapters, cost-aware routing, budget engine, normalization/dedupe/scoring
 * pipeline, suppression/compliance layer, and REST surface shipped first; CLI
 * verbs belong to the follow-up recorded in the owner doc.
 */
const LEAD_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.34 ships the multi-provider lead adapters, cost-aware routing, budget gate, normalization/dedupe/scoring, suppression compliance, WebMCP tools, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.34 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.34_Pao-hubPro_Lead_Gen_API_Stack_Lead_Intelligence_Control_Plane.md",
} as const;

/**
 * Shared deferral for the Phase 20.35 unified runtime routes: the capability/
 * mode router, route preview, circuit breakers, context/secret firewalls,
 * workspace permissions, attachment engine, and REST surface shipped first;
 * CLI verbs belong to the follow-up recorded in the owner doc.
 */
const UNIFIED_RUNTIME_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.35 ships the unified runtime control plane (capability-aware mode router, route preview, circuit breakers, context/secret firewalls, workspace permissions, attachment engine, WebMCP tools) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.35 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.35_Pao-hubPro_Transgentic_Inspired_Unified_AI_Runtime_Control_Plane.md",
} as const;

/**
 * Shared deferral for the Phase 30.36 Business Builder routes: the playbook
 * source adapter, opportunity registry, scoring/Pao-Fit engines, compliance
 * gate, cost estimator, MVP compiler, Codex pack generator, revenue
 * experiments, and REST surface shipped first; CLI verbs belong to the
 * follow-up recorded in the owner doc.
 */
const BUSINESS_BUILDER_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 30.36 ships the playbook source adapter, opportunity registry, scoring/Pao-Fit engines, compliance gate, cost/dependency analyzer, MVP compiler, Codex pack generator, revenue experiments, WebMCP tools, and REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 30.36 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_30.36_Pao-hubPro_Software_Income_Playbooks_Business_Builder.md",
} as const;

/**
 * Shared deferral for the Phase 20.37 Agentic OS routes: agent/skill
 * registries, deterministic router, run state machine, hook engine, guarded
 * tool calls, approval gate, worktree isolation, memory store, and REST
 * surface shipped first; CLI verbs belong to the follow-up recorded in the
 * owner doc.
 */
const AGENTIC_OS_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.37 ships the Agentic Development OS control plane (agent/skill registries, deterministic router, run state machine, hook engine, guarded tool calls, approval gate, worktree isolation, memory store, redacted audit, doctor, WebMCP tools, REST surface) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.37 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.37_Pao-hubPro_OrchestKit_Inspired_Agentic_Development_OS.md",
} as const;

/**
 * Shared deferral for the Phase 20.38 Dependency Vault routes: CAS storage,
 * integrity verification, archive safety, policy engine, lockfile
 * normalization, acquisition pipeline, profiles, bundles, SBOM, quarantine,
 * and REST surface shipped first; CLI verbs belong to the follow-up recorded
 * in the owner doc.
 */
const DEP_VAULT_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.38 ships the Dependency Vault (content-addressable SHA-512 store, integrity/archive verification, registry allowlist policy, lockfile graph normalization, profiles, .offpack bundles, SBOM, quarantine, GC, WebMCP tools, REST surface) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.38 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.38_Pao-hubPro_OFFPack_Dependency_Vault.md",
} as const;

const CODING_WORKSPACE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.39 ships the Unified AI Coding Workspace (provider adapter registry, unified session control plane, normalized SSE event stream, @context + /command registries, execution policy + risk engine, approval gateway, one-writer workspace lock, safe CLI bridge, usage telemetry, runs/artifacts, audit, WebMCP tools, REST surface) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.39 dashboard/CLI follow-up",
  ownerDoc: "docs/Phase_20.39_Pao-hubPro_Unified_AI_Coding_Workspace.md",
} as const;

const OBSERVABILITY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.40 ships the read-only Agent Observability Control Plane (JSONL liveness adapters, stat-revision scanner cache, evidence normalizer, five independent state planes, process evidence, integrity verification, alerts, fleet/timeline/inspector REST+SSE, 14 read-only WebMCP tools) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.40 dashboard/CLI follow-up",
  ownerDoc: "docs/observability/upstream-reference.md",
} as const;

const MEMORY_PLANE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.41 ships the Trustworthy MCP Memory Plane (authority tiers, immutable revisions, deterministic chunking, local embedding provider, keyword/semantic/hybrid recall with RRF and honest degradation, evidence-backed observations, supersession snapshots, query-hash traces, preview-confirm mutations with signed receipts, scoped OAuth 2.1 with PKCE S256 + DCR + refresh rotation, WebMCP tools, REST surface, dashboard) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.41 dashboard/CLI follow-up",
  ownerDoc: "docs/memory-plane/README.md",
} as const;

const PLUR_MEMORY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.43 ships the PLUR Shared Agent Memory Runtime control plane (engine-neutral interface + PLUR CLI adapter with capability detection, local fallback engine, deterministic scope resolver with project isolation, policy engine, defense-in-depth secret guard, learn/recall/inject with token-budget receipts, feedback, forget/rescope with approvals, episodes/timeline, conflicts, candidates, fail-closed sync preview/execute, reconciliation, memory doctor, Codex/Hermes adapter diagnostics, 12 governed WebMCP tools, REST surface, dashboard) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.43 dashboard/CLI follow-up",
  ownerDoc: "docs/memory/architecture.md",
} as const;

const BOT_WORKSPACE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.42 ships the Named AI Teammate Workspace (agent/team registries, direct/group conversations with mentions and drafts, ordered/parallel group-round orchestration with consent, stop/retry/partial preservation, fingerprint-bound single-use approvals, routines with idempotent runs and concurrency policy, execution event store with reconnect, provider/runtime binding registries, Codex App Server adapter over the Phase 20.21 runtime, safe export, crash reconciliation, WebMCP tools, REST surface, dashboard) first; CLI verbs belong to the dashboard/CLI follow-up recorded in the owner doc.",
  owner: "Phase 20.42 dashboard/CLI follow-up",
  ownerDoc: "docs/bot-workspace/README.md",
} as const;

const MODEL_GATEWAY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.85 ships the OmniRoute unified model gateway, capability registry, cumulative retry budget, circuit monitor, and local-only enforcement first; CLI verbs belong to the dashboard/CLI follow-up.",
  owner: "Phase 20.85 Model Gateway",
  ownerDoc: "docs/Phase 20.85 — Pao-hubPro × OmniRoute.md",
} as const;

const SENSORIMOTOR_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.82 ships the sensorimotor runtime (sessions, perception, transactional actions with checkpoint/rollback, health) and its REST surface first; CLI verbs belong to the dashboard/CLI follow-up recorded in the phase doc.",
  owner: "Phase 20.82 CortexKit AFT",
  ownerDoc: "Blueprint/Phase 20.82 — Pao-hubPro × CortexKit AFT — Agent-Native IDE & Sensorimotor Runtime.md",
} as const;

const MARKETPLACE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.89 ships the Capability Hub registry, manifest pipeline, phase importer, transactional installer and REST surface first; CLI verbs and the full enable/disable lifecycle belong to the runtime-adapter wave (P3) recorded in the phase doc.",
  owner: "Phase 20.89 Capability Hub",
  ownerDoc: "Blueprint/Phase_20.89_Pao-hubPro_x_Bubble.md",
} as const;

const ENGINEERING_SKILLS_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.91b ships the Engineering Skill Runtime registry, router, workflow state machine, evidence gates, reviewer council and REST surface first; CLI verbs and eval-runner UX belong to the adapter/eval wave recorded in the phase doc.",
  owner: "Phase 20.91b Engineering Skill Runtime",
  ownerDoc: "Blueprint/Phase_20.91_Pao-hubPro_x_Addy_Osmani_Agent_Skills.md",
} as const;

const VIDEO_STUDIO_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.92 ships the semantic director layer (segmentation, scene planning, asset ladder, motion templates, deterministic timeline, ffmpeg preview render, QA, auto-build step machine) and REST/MCP surface first; batch CSV intake, Adobe Stock mode and multi-machine workers belong to the post-MVP wave recorded in the phase doc.",
  owner: "Phase 20.92 Video Studio",
  ownerDoc: "docs/PHASE_20.92_VIDEO_STUDIO.md",
} as const;

const WORKFLOW_STUDIO_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.93 ships the visual orchestration core (node registry, typed ports, compiler with policy/budget analysis, durable run engine, approval gates, REST surface) first; canvas drag-and-drop editor, cron/webhook triggers, subflows and plugin SDK belong to Milestones E-H recorded in the phase doc.",
  owner: "Phase 20.93 Workflow Studio",
  ownerDoc: "docs/PHASE_20.93_WORKFLOW_STUDIO.md",
} as const;

const ENZO_WORKSPACE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.94 ships the composition plane (intent compiler, Forge-style two-pass factory, SkillsGate composer, OmniRoute marketplace, credential leases, budget research, sandbox coding, lesson distillation, REST/MCP) first; live OmniRoute completions, encrypted KEK vault when CREDENTIAL_RUNTIME is off, and drag-and-drop canvas remain documented follow-ups.",
  owner: "Phase 20.94 ENZO Workspace",
  ownerDoc: "docs/PHASE_20.94_ENZO_WORKSPACE.md",
} as const;

const ACQUISITION_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.95 ships the Content Acquisition Gateway (plan/policy/jobs/artifacts/session refs, MCP-first OmniGet adapter, CLI fallback, mock worker) first; live OmniGet MCP/CLI execution remains discovery-based and is not a hardcoded tool count.",
  owner: "Phase 20.95 Content Acquisition Gateway",
  ownerDoc: "docs/PHASE_20.95_ACQUISITION.md",
} as const;

const MCP_FABRIC_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.96 ships the AnythingMCP capability control plane (connector intake, canonical tools, privacy gateway, approvals, versioning/drift, KG/skill candidates) first; live AnythingMCP HTTP execute remains discovery-based and is not assumed from unreleased upstream roadmap features.",
  owner: "Phase 20.96 MCP Fabric",
  ownerDoc: "docs/PHASE_20.96_MCP_FABRIC.md",
} as const;

const OPENHERMIT_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.98 ships the OpenHermit durable multi-agent fleet runtime, state plane, sandbox fabric, SkillsGate/MCP governance sync, approval-gated deep research, and REST surface first; CLI fleet verbs belong to follow-up tooling.",
  owner: "Phase 20.98 OpenHermit Fleet Runtime",
  ownerDoc: "docs/Phase_20.98_Pao-hubPro_x_OpenHermit.md",
} as const;

const WHIP_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.99 ships the Mobile Agent Operations Plane, SSH/Tailscale host fabric, unified fleet, transcript projections, remote terminal/workspace, offline queue, QR pairing, and approval control plane first; native mobile application distribution belongs to downstream app packaging.",
  owner: "Phase 20.99 Whip Mobile Operations Plane",
  ownerDoc: "docs/Phase_20.99_Pao-hubPro_x_Whip.md",
} as const;

const ZCODE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.100 ships the ZCode Agent-Native Workspace Runtime, provider leases, 10-stage permission bridge, workflow event journal, deterministic replay, and Reviewer Council gates first; dedicated desktop UI bindings belong to downstream app packaging.",
  owner: "Phase 20.100 ZCode Runtime",
  ownerDoc: "docs/Phase_20.100_Pao-hubPro_x_ZCode.md",
} as const;

const BROWSER_CONTROL_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 20.101 ships the Universal AI Browser Control Plane, Local Chrome and Oya adapters, browser router, encrypted persona vault, record-to-playbook replay, drift repair, and human takeover first; rich visual console belongs to downstream dashboard integration.",
  owner: "Phase 20.101 Universal Browser Control Plane",
  ownerDoc: "docs/Phase_20.101_Pao-hubPro_x_Oya_Browser.md",
} as const;

const UNIFIED_CONTROL_PLANE_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 21.00 ships the Unified Agent Operations Control Plane (federated agent/host registries, durable jobs, central MCP/skill governance, approval fabric, and audit stream) first; custom CLI verbs belong to downstream console integration.",
  owner: "Phase 21.00 Unified Control Plane",
  ownerDoc: "docs/Phase_21.00_Pao-hubPro_Unified_Agent_Operations_Control_Plane.md",
} as const;

const PARLEY_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 21.01 ships the Multi-Agent Work Room (explicit addressing, runtime identity badges, Run Inspector, 4-level tool policy, handoff timeline, and transcript exports) first; dedicated CLI workroom commands belong to follow-up tooling.",
  owner: "Phase 21.01 Parley Multi-Agent Work Room",
  ownerDoc: "docs/Phase_21.01_Pao-hubPro_Parley_Multi-Agent_Work_Room.md",
} as const;

const MISSION_CONTROL_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 21.02 ships the Multi-Agent Mission Control operational console (fleet overview, run timeline, approval inbox, queues/DLQ, incident management, and emergency stop) first; dedicated CLI operations commands belong to follow-up tooling.",
  owner: "Phase 21.02 Multi-Agent Mission Control",
  ownerDoc: "docs/Phase_21.02_Pao-hubPro_Multi-Agent_Mission_Control.md",
} as const;

const NAVOP_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase Navop & 21.03 ship the Host-Authoritative Operations Runtime & CC-Switch Provider Control Plane (resources, capabilities, session brokering, approvals, execution routing, and audit) first; thin CLI tool integrations belong to follow-up tooling.",
  owner: "Phase Navop Host Runtime",
  ownerDoc: "docs/PHASE_LATEST_PAO_HUBPRO_NAVOP_ARCHITECTURE.md",
} as const;

const H3_EXTENDER_VERB_DEFERRAL = {
  reason: "deferred-verb",
  why: "Phase 21.02 ships the MiniMax H3 Extender Video Execution Plane (projects, scene clips, attempts, generation hashes, validation, and MCP tools) first; advanced video timeline GUI and stock submission packaging belong to follow-up video releases.",
  owner: "Phase 21.02 MiniMax H3 Extender",
  ownerDoc: "docs/PHASE_21.02_PAO_HUBPRO_MINIMAX_H3_EXTENDER.md",
} as const;

/** Every reachable management route. */
export const MANAGEMENT_ROUTES: readonly ManagementRoute[] = [
  // server/management-api
  { method: "POST", path: "/api/stop", module: "server/management-api", mutates: true },
  // codex/auth-api
  { method: "DELETE", path: "/api/codex-auth/accounts", module: "codex/auth-api", mutates: true },
  { method: "GET", path: "/api/codex-auth/accounts", module: "codex/auth-api", mutates: false },
  { method: "GET", path: "/api/codex-auth/active", module: "codex/auth-api", mutates: false },
  { method: "GET", path: "/api/codex-auth/login-status", module: "codex/auth-api", mutates: false },
  { method: "GET", path: "/api/codex-auth/quota", module: "codex/auth-api", mutates: false },
  { method: "GET", path: "/api/codex-auth/reset-credits", module: "codex/auth-api", mutates: false },
  { method: "PATCH", path: "/api/codex-auth/pool-strategy", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/accounts", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/accounts/clear-cooldown", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/login", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/login/cancel", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/login/code", module: "codex/auth-api", mutates: true },
  { method: "POST", path: "/api/codex-auth/reset-credits/consume", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/accounts/alias", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/accounts/pause", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/accounts/pause-exhausted", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/accounts/priority", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/active", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/auto-switch", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/failover", module: "codex/auth-api", mutates: true },
  { method: "PUT", path: "/api/codex-auth/pool-strategy", module: "codex/auth-api", mutates: true },
  // codex/native-profile-api
  { method: "GET", path: "/api/native-main-profiles", module: "codex/native-profile-api", mutates: false },
  { method: "GET", path: "/api/native-main-profiles/doctor", module: "codex/native-profile-api", mutates: false },
  { method: "POST", path: "/api/native-main-profiles/recover", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/register", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/stage", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/stage/cancel", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/stage/finish", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/stage/heartbeat", module: "codex/native-profile-api", mutates: true },
  { method: "POST", path: "/api/native-main-profiles/switch", module: "codex/native-profile-api", mutates: true },
  // server/management/agent-settings-routes
  { method: "GET", path: "/api/claude-code", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/claude-desktop", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/claude-desktop/status", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/codex-auth/features/default-mode-request-user-input", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/effort-caps", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/grok", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/injection-model", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/subagent-model-fallback", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/subagent-models", module: "server/management/agent-settings-routes", mutates: false },
  { method: "GET", path: "/api/v2", module: "server/management/agent-settings-routes", mutates: false },
  { method: "POST", path: "/api/claude-desktop/apply", module: "server/management/agent-settings-routes", mutates: true },
  { method: "POST", path: "/api/grok/apply", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/claude-code", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/claude-desktop", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/codex-auth/features/default-mode-request-user-input", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/effort-caps", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/grok/selection", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/injection-model", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/subagent-model-fallback", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/subagent-models", module: "server/management/agent-settings-routes", mutates: true },
  { method: "PUT", path: "/api/v2", module: "server/management/agent-settings-routes", mutates: true },
  // server/management/codex-prompt-routes
  { method: "GET", path: "/api/codex-prompt", module: "server/management/codex-prompt-routes", mutates: false },
  { method: "GET", path: "/api/codex-prompt/text", module: "server/management/codex-prompt-routes", mutates: false },
  { method: "POST", path: "/api/codex-prompt/adopt", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Prompt adoption requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  { method: "POST", path: "/api/codex-prompt/repair", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Prompt repair requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  { method: "PUT", path: "/api/codex-prompt/base", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Base prompt write requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  { method: "PUT", path: "/api/codex-prompt/base/select", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Base prompt selection requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  { method: "PUT", path: "/api/codex-prompt/custom", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Custom prompt write requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  { method: "PUT", path: "/api/codex-prompt/toggle", module: "server/management/codex-prompt-routes", mutates: true, exempt: { reason: "session-only", why: "Prompt toggle requires the gui-session principal (codex-prompt-routes.ts:298)." } },
  // server/management/combo-routes
  { method: "DELETE", path: "/api/combos", module: "server/management/combo-routes", mutates: true },
  { method: "GET", path: "/api/combos", module: "server/management/combo-routes", mutates: false },
  { method: "PUT", path: "/api/combos", module: "server/management/combo-routes", mutates: true },
  // server/management/config-routes
  { method: "GET", path: "/api/config", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/diagnostics/project-config", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/settings", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/shadow-call-settings", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/sidecar-settings", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/startup-health", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/update/check", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/update/status", module: "server/management/config-routes", mutates: false },
  { method: "GET", path: "/api/windows-tray", module: "server/management/config-routes", mutates: false },
  { method: "POST", path: "/api/startup-action", module: "server/management/config-routes", mutates: true },
  { method: "POST", path: "/api/sync", module: "server/management/config-routes", mutates: true },
  { method: "POST", path: "/api/update/run", module: "server/management/config-routes", mutates: true },
  { method: "POST", path: "/api/windows-tray", module: "server/management/config-routes", mutates: true },
  { method: "PUT", path: "/api/config", module: "server/management/config-routes", mutates: true, exempt: { reason: "disabled", why: "Returns 405 by design; provider changes go through POST /api/providers." } },
  { method: "PUT", path: "/api/settings", module: "server/management/config-routes", mutates: true },
  { method: "PUT", path: "/api/shadow-call-settings", module: "server/management/config-routes", mutates: true },
  { method: "PUT", path: "/api/sidecar-settings", module: "server/management/config-routes", mutates: true },
  // server/management/integration-routes
  { method: "GET", path: "/api/client-integrations", module: "server/management/integration-routes", mutates: false },
  { method: "GET", path: "/api/client-integrations/journal", module: "server/management/integration-routes", mutates: false },
  { method: "POST", path: "/api/client-integrations/restore", module: "server/management/integration-routes", mutates: true },
  // server/management/lab-automation-routes
  { method: "GET", path: "/api/lab/automation", module: "server/management/lab-automation-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/automation/runs", module: "server/management/lab-automation-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "POST", path: "/api/lab/automation/run", module: "server/management/lab-automation-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Lab automation run has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  { method: "PUT", path: "/api/lab/automation", module: "server/management/lab-automation-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Lab automation config update has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  // server/management/lab-routes
  { method: "GET", path: "/api/lab/artifacts", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/catalog", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/events", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/observations", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/production-signals", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/public/community", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/status", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/subjects", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/verdicts", module: "server/management/lab-routes", mutates: false, exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "POST", path: "/api/lab/public/community/import", module: "server/management/lab-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Community evidence import has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  { method: "POST", path: "/api/lab/public/export", module: "server/management/lab-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Public evidence export has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  { method: "POST", path: "/api/lab/public/preview", module: "server/management/lab-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Public evidence preview has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  { method: "POST", path: "/api/lab/public/verify", module: "server/management/lab-routes", mutates: true, exempt: { reason: "deferred-verb", why: "Public evidence verification has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  // server/management/logs-usage-routes
  { method: "GET", path: "/api/claude/inbound-debug", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/debug", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/debug/injection-logs", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/debug/logs", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/debug/usage-logs", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/logs", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/storage/cleanup-policy", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/storage/cleanup-policy/test-stream", module: "server/management/logs-usage-routes", mutates: false, exempt: { reason: "test-seam", why: "Opt-in streaming seam declared at src/storage/policy-job.ts:71." } },
  { method: "GET", path: "/api/storage/trash", module: "server/management/logs-usage-routes", mutates: false },
  { method: "GET", path: "/api/storage/trash/restore/test-stream", module: "server/management/logs-usage-routes", mutates: false, exempt: { reason: "test-seam", why: "Opt-in streaming seam declared at src/storage/restore-job.ts:34." } },
  { method: "GET", path: "/api/usage", module: "server/management/logs-usage-routes", mutates: false },
  { method: "POST", path: "/api/storage/cleanup", module: "server/management/logs-usage-routes", mutates: true },
  { method: "POST", path: "/api/storage/cleanup-policy/run", module: "server/management/logs-usage-routes", mutates: true },
  { method: "POST", path: "/api/storage/cleanup/preview", module: "server/management/logs-usage-routes", mutates: true },
  { method: "POST", path: "/api/storage/trash/restore", module: "server/management/logs-usage-routes", mutates: true },
  { method: "PUT", path: "/api/debug", module: "server/management/logs-usage-routes", mutates: true },
  { method: "PUT", path: "/api/storage/cleanup-policy", module: "server/management/logs-usage-routes", mutates: true },
  // server/management/model-routes
  { method: "GET", path: "/api/aliases", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/catalog", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/client-config", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/custom-models", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/model-discovery", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/model-presets", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/models", module: "server/management/model-routes", mutates: false },
  { method: "GET", path: "/api/selected-models", module: "server/management/model-routes", mutates: false },
  { method: "POST", path: "/api/custom-models", module: "server/management/model-routes", mutates: true },
  { method: "POST", path: "/api/model-discovery/acknowledge", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/default-aliases", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/disabled-models", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/model-discovery", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/model-presets", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/model-visibility", module: "server/management/model-routes", mutates: true },
  { method: "PUT", path: "/api/selected-models", module: "server/management/model-routes", mutates: true },
  // server/management/native-integration-routes
  { method: "GET", path: "/api/native-integrations", module: "server/management/native-integration-routes", mutates: false },
  { method: "PUT", path: "/api/native-integrations/claude", module: "server/management/native-integration-routes", mutates: true },
  { method: "PUT", path: "/api/native-integrations/claude-desktop", module: "server/management/native-integration-routes", mutates: true },
  { method: "PUT", path: "/api/native-integrations/codex", module: "server/management/native-integration-routes", mutates: true },
  { method: "PUT", path: "/api/native-integrations/grok", module: "server/management/native-integration-routes", mutates: true },
  // server/management/oauth-account-routes
  { method: "DELETE", path: "/api/keys", module: "server/management/oauth-account-routes", mutates: true },
  { method: "DELETE", path: "/api/oauth/accounts", module: "server/management/oauth-account-routes", mutates: true },
  { method: "DELETE", path: "/api/providers/keys", module: "server/management/oauth-account-routes", mutates: true },
  { method: "GET", path: "/api/key-providers", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/keys", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/oauth/accounts", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/oauth/accounts/pool", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/oauth/providers", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/oauth/status", module: "server/management/oauth-account-routes", mutates: false },
  { method: "GET", path: "/api/providers/keys", module: "server/management/oauth-account-routes", mutates: false },
  { method: "PATCH", path: "/api/keys", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PATCH", path: "/api/oauth/accounts/pool", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/keys", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/accounts/clear-cooldown", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/accounts/import", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/login", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/login/cancel", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/login/code", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/oauth/logout", module: "server/management/oauth-account-routes", mutates: true },
  { method: "POST", path: "/api/providers/keys", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PUT", path: "/api/oauth/accounts/active", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PUT", path: "/api/oauth/accounts/alias", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PUT", path: "/api/oauth/accounts/pool", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PUT", path: "/api/providers/keys/active", module: "server/management/oauth-account-routes", mutates: true },
  { method: "PUT", path: "/api/providers/keys/alias", module: "server/management/oauth-account-routes", mutates: true },
  // server/management/provider-routes
  { method: "DELETE", path: "/api/providers", module: "server/management/provider-routes", mutates: true },
  { method: "GET", path: "/api/provider-context-caps", module: "server/management/provider-routes", mutates: false },
  { method: "GET", path: "/api/provider-presets", module: "server/management/provider-routes", mutates: false },
  { method: "GET", path: "/api/provider-quotas", module: "server/management/provider-routes", mutates: false },
  { method: "GET", path: "/api/provider-request-pacing", module: "server/management/provider-routes", mutates: false },
  { method: "GET", path: "/api/providers", module: "server/management/provider-routes", mutates: false },
  { method: "PATCH", path: "/api/providers", module: "server/management/provider-routes", mutates: true },
  { method: "POST", path: "/api/providers", module: "server/management/provider-routes", mutates: true },
  { method: "POST", path: "/api/providers/switch-pool", module: "server/management/provider-routes", mutates: true },
  { method: "POST", path: "/api/providers/test", module: "server/management/provider-routes", mutates: true },
  { method: "PUT", path: "/api/provider-context-caps", module: "server/management/provider-routes", mutates: true },
  // server/management/request-history-routes
  { method: "GET", path: "/api/request-history", module: "server/management/request-history-routes", mutates: false },
  // server/management/routing-analytics-routes
  // server/management/routing-profile-routes
  { method: "DELETE", path: "/api/routing-profiles", module: "server/management/routing-profile-routes", mutates: true },
  { method: "GET", path: "/api/routing-profiles", module: "server/management/routing-profile-routes", mutates: false },
  { method: "POST", path: "/api/routing-profiles/dry-run", module: "server/management/routing-profile-routes", mutates: true },
  { method: "PUT", path: "/api/routing-profiles", module: "server/management/routing-profile-routes", mutates: true },
  // server/management/sidebar-routes
  { method: "GET", path: "/api/github/star", module: "server/management/sidebar-routes", mutates: false },
  { method: "GET", path: "/api/update/badge", module: "server/management/sidebar-routes", mutates: false },
  { method: "POST", path: "/api/github/star", module: "server/management/sidebar-routes", mutates: true, exempt: { reason: "session-only", why: "User-consent boundary in AGENTS_INSTALL.md: starring spends the user's identity. Must never gain a CLI verb." } },
  // server/management/storage-log-guard-routes
  { method: "GET", path: "/api/storage/codex-logs", module: "server/management/storage-log-guard-routes", mutates: false },
  { method: "POST", path: "/api/storage/codex-logs/compact", module: "server/management/storage-log-guard-routes", mutates: true },
  { method: "POST", path: "/api/storage/codex-logs/protect", module: "server/management/storage-log-guard-routes", mutates: true },
  { method: "POST", path: "/api/storage/codex-logs/repair", module: "server/management/storage-log-guard-routes", mutates: true },
  { method: "POST", path: "/api/storage/codex-logs/unprotect", module: "server/management/storage-log-guard-routes", mutates: true },
  // server/management/security-control-routes
  { method: "GET", path: "/api/security/overview", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/authorizations", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/authorizations", module: "server/management/security-control-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives authorization creation through local service directly." } },
  { method: "GET", path: "/api/security/scopes", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/scopes", module: "server/management/security-control-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives scope creation through local service directly." } },
  { method: "GET", path: "/api/security/campaigns", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/campaigns", module: "server/management/security-control-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives campaign creation through local service directly." } },
  { method: "GET", path: "/api/security/approvals", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/findings", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/skills", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/skills/import", module: "server/management/security-control-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives package import through local service directly." } },
  { method: "GET", path: "/api/security/tools", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/mcp", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/policies", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/policies/evaluate", module: "server/management/security-control-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives policy evaluation through local service directly." } },
  { method: "GET", path: "/api/security/audit", module: "server/management/security-control-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/authorizations/{id}", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "PATCH", path: "/api/security/authorizations/{id}", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives authorization updates through local service directly." } },
  { method: "POST", path: "/api/security/authorizations/{id}/verify", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives authorization verification through local service directly." } },
  { method: "GET", path: "/api/security/scopes/{id}", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "PATCH", path: "/api/security/scopes/{id}", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives scope updates through local service directly." } },
  { method: "POST", path: "/api/security/scopes/{id}/verify", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives scope verification through local service directly." } },
  { method: "GET", path: "/api/security/campaigns/{id}", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/campaigns/{id}/start", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives campaign start through local service directly." } },
  { method: "POST", path: "/api/security/campaigns/{id}/pause", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives campaign pause through local service directly." } },
  { method: "POST", path: "/api/security/campaigns/{id}/resume", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives campaign resume through local service directly." } },
  { method: "POST", path: "/api/security/campaigns/{id}/cancel", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives campaign cancel through local service directly." } },
  { method: "POST", path: "/api/security/campaigns/{id}/recon", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives fixture recon through local service directly." } },
  { method: "GET", path: "/api/security/campaigns/{id}/leads", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/campaigns/{id}/findings", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/campaigns/{id}/evidence", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "GET", path: "/api/security/campaigns/{id}/audit", module: "server/management/security-control-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches security data through local service/db operations; src/cli/security.ts calls getSecurityControlService() directly." } },
  { method: "POST", path: "/api/security/approvals/{id}/approve", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives approval grants through local service directly." } },
  { method: "POST", path: "/api/security/approvals/{id}/deny", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives approval denials through local service directly." } },
  { method: "POST", path: "/api/security/findings/{id}/validate", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives finding validation through local service directly." } },
  { method: "POST", path: "/api/security/findings/{id}/report", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives report export through local service directly." } },
  { method: "POST", path: "/api/security/skills/{id}/activate", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives package activation through local service directly." } },
  { method: "POST", path: "/api/security/skills/{id}/quarantine", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives package quarantine through local service directly." } },
  { method: "POST", path: "/api/security/mcp/{id}/test", module: "server/management/security-control-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives MCP tests through local service directly." } },
  // server/management/credential-routes
  { method: "GET", path: "/api/credentials/overview", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "POST", path: "/api/credentials", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives credential import through local service directly." } },
  { method: "GET", path: "/api/credentials/providers", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials/pool", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials/health", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "POST", path: "/api/credentials/health/run", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives health passes through local service directly." } },
  { method: "GET", path: "/api/credentials/quota", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials/policies", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "POST", path: "/api/credentials/policies", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives policy writes through local service directly." } },
  { method: "POST", path: "/api/credentials/policies/evaluate", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives policy evaluation through local service directly." } },
  { method: "GET", path: "/api/credentials/approvals", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials/audit", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "GET", path: "/api/credentials/leases", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "POST", path: "/api/credentials/leases", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives lease creation through local service directly." } },
  { method: "GET", path: "/api/credentials/oauth/sessions", module: "server/management/credential-routes", mutates: false, exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "POST", path: "/api/credentials/oauth/start", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives OAuth start through local service directly." } },
  { method: "POST", path: "/api/credentials/oauth/callback", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives OAuth callback through local service directly." } },
  { method: "POST", path: "/api/credentials/expiry/run", module: "server/management/credential-routes", mutates: true, exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives expiry passes through local service directly." } },
  { method: "GET", path: "/api/credentials/{id}", module: "server/management/credential-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "The CLI reaches credential data through local service/db operations; src/cli/credentials.ts calls getCredentialRuntimeService() directly." } },
  { method: "DELETE", path: "/api/credentials/{id}", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives credential deletion through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/validate", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives validation through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/health", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives health checks through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/quarantine", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives quarantine through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/revoke", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives revocation through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/rotate", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives rotation through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/activate", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives activation through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/disable", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives disable through local service directly." } },
  { method: "POST", path: "/api/credentials/{id}/refresh", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives refresh through local service directly." } },
  { method: "POST", path: "/api/credentials/leases/{id}/release", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives lease release through local service directly." } },
  { method: "POST", path: "/api/credentials/approvals/{id}/approve", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives approval grants through local service directly." } },
  { method: "POST", path: "/api/credentials/approvals/{id}/reject", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives approval rejections through local service directly." } },
  { method: "POST", path: "/api/credentials/approvals/{id}/execute", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives approval execution through local service directly." } },
  { method: "POST", path: "/api/credentials/providers/{id}/enable", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives provider enable through local service directly." } },
  { method: "POST", path: "/api/credentials/providers/{id}/disable", module: "server/management/credential-routes", mutates: true, mechanism: "regex", exempt: { reason: "session-only", why: "Interactive dashboard operation; CLI drives provider disable through local service directly." } },
  // server/management/system-routes
  { method: "GET", path: "/api/system/memory", module: "server/management/system-routes", mutates: false },
  { method: "GET", path: "/api/system/windows-replace-retries", module: "server/management/system-routes", mutates: false },
  { method: "POST", path: "/api/system/restart", module: "server/management/system-routes", mutates: true },
  // --- Routes an equality scan of their own file cannot see (18). ---
  // Each carries `mechanism`; the reconciliation test counts these separately.
  { method: "GET", path: "/api/storage", module: "server/management/storage-log-guard-routes", mutates: false, mechanism: "negated-guard" },
  { method: "GET", path: "/api/routing-analytics", module: "server/management/routing-analytics-routes", mutates: false, mechanism: "negated-guard" },
  { method: "GET", path: "/api/system/codex-app-server", module: "server/management/system-routes", mutates: false, mechanism: "path-constant" },
  { method: "POST", path: "/api/system/codex-restart", module: "server/management/system-routes", mutates: true, mechanism: "path-constant" },
  { method: "POST", path: "/api/providers/reload", module: "server/management/provider-routes", mutates: true, mechanism: "path-constant", exempt: { reason: "capability-principal", why: "Gated on the local-provider-reload-capability principal (provider-routes.ts:467), not an operator action." } },
  { method: "GET", path: "/api/client-integrations/{clientId}", module: "server/management/integration-routes", mutates: false, mechanism: "prefix-decode" },
  { method: "PUT", path: "/api/client-integrations/{clientId}", module: "server/management/integration-routes", mutates: true, mechanism: "prefix-decode" },
  { method: "GET", path: "/api/request-history/{id}", module: "server/management/request-history-routes", mutates: false, mechanism: "slice" },
  { method: "GET", path: "/api/request-history/{id}/route-decision", module: "server/management/request-history-routes", mutates: false, mechanism: "ends-with" },
  { method: "PUT", path: "/api/providers/{provider}/alias", module: "server/management/model-routes", mutates: true, mechanism: "regex" },
  { method: "PUT", path: "/api/providers/{provider}/model-aliases", module: "server/management/model-routes", mutates: true, mechanism: "regex" },
  { method: "PUT", path: "/api/custom-models/{id}", module: "server/management/model-routes", mutates: true, mechanism: "regex" },
  { method: "DELETE", path: "/api/custom-models/{id}", module: "server/management/model-routes", mutates: true, mechanism: "regex" },
  { method: "GET", path: "/api/lab/subjects/{id}", module: "server/management/lab-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/events/{id}", module: "server/management/lab-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "GET", path: "/api/lab/artifacts/{digest}", module: "server/management/lab-routes", mutates: false, mechanism: "regex", exempt: { reason: "local-transport", why: "ocx lab reads the same rows from the local SQLite projection; src/cli/lab.ts imports ../lab/query directly and never fetches /api/lab." } },
  { method: "POST", path: "/api/lab/automation/runs/{id}/cancel", module: "server/management/lab-automation-routes", mutates: true, mechanism: "regex", exempt: { reason: "deferred-verb", why: "Lab automation run cancellation has no CLI verb yet. A local SQLite read cannot drive it, so local-transport does not apply.", owner: "wp7", ownerDoc: "devlog/_plan/260828_ocx_agentic_control/060_phase_gui_parity.md" } },
  // Phase 20.20 Social Intelligence Engine. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/social/status", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/providers", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/tools", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "POST", path: "/api/social/registry/refresh", module: "server/management/social-routes", mutates: true, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "POST", path: "/api/social/route/preview", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "POST", path: "/api/social/run", module: "server/management/social-routes", mutates: true, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/runs", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "POST", path: "/api/social/research", module: "server/management/social-routes", mutates: true, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/research", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/usage", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/audit", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "POST", path: "/api/social/tools/toggle", module: "server/management/social-routes", mutates: true, exempt: SOCIAL_VERB_DEFERRAL },
  { method: "GET", path: "/api/social/mcp-tools", module: "server/management/social-routes", mutates: false, exempt: SOCIAL_VERB_DEFERRAL },
  // Phase 20.57 SkillsGate Skill Control Plane.
  { method: "GET", path: "/api/agent-os/skill-gate/health", module: "server/management/skill-gate-routes", mutates: false, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/skill-gate/sources", module: "server/management/skill-gate-routes", mutates: false, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/skill-gate/skills", module: "server/management/skill-gate-routes", mutates: false, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/skill-gate/import", module: "server/management/skill-gate-routes", mutates: true, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/skill-gate/publish", module: "server/management/skill-gate-routes", mutates: true, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/skill-gate/deploy", module: "server/management/skill-gate-routes", mutates: true, exempt: SKILL_GATE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/skill-gate/skills/{id}", module: "server/management/skill-gate-routes", mutates: false, mechanism: "slice", exempt: SKILL_GATE_VERB_DEFERRAL },
  // Phase 20.20 ECC Agent Harness OS. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/ecc/status", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/code-review", module: "server/management/code-review-routes", mutates: false },
  { method: "POST", path: "/api/agent-os/code-review/preview", module: "server/management/code-review-routes", mutates: false },
  { method: "POST", path: "/api/agent-os/code-review/run", module: "server/management/code-review-routes", mutates: true },
  { method: "GET", path: "/api/agent-os/code-review/sessions", module: "server/management/code-review-routes", mutates: false },
  { method: "GET", path: "/api/agent-os/code-review/sessions/{id}", module: "server/management/code-review-routes", mutates: false, mechanism: "slice" },
  // Phase 20.82 CortexKit AFT sensorimotor runtime (sensorimotor-routes)
  { method: "GET", path: "/api/agent-os/sensorimotor/health", module: "server/management/sensorimotor-routes", mutates: false, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/sensorimotor/sessions", module: "server/management/sensorimotor-routes", mutates: false, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/sensorimotor/sessions", module: "server/management/sensorimotor-routes", mutates: true, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/sensorimotor/actions", module: "server/management/sensorimotor-routes", mutates: false, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/sensorimotor/actions", module: "server/management/sensorimotor-routes", mutates: true, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/sensorimotor/actions/{id}", module: "server/management/sensorimotor-routes", mutates: false, mechanism: "slice", exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/sensorimotor/sessions/{id}/close", module: "server/management/sensorimotor-routes", mutates: true, mechanism: "slice", exempt: SENSORIMOTOR_VERB_DEFERRAL },
  // Phase 20.89: Capability Hub (Bubble) — registry-first marketplace.
  { method: "GET", path: "/api/agent-os/marketplace/health", module: "server/management/marketplace-routes", mutates: false, exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/marketplace/capabilities", module: "server/management/marketplace-routes", mutates: false, exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/marketplace/capabilities/{slug}", module: "server/management/marketplace-routes", mutates: false, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/marketplace/reconciliation", module: "server/management/marketplace-routes", mutates: false, exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/marketplace/audit", module: "server/management/marketplace-routes", mutates: false, exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/import-phases", module: "server/management/marketplace-routes", mutates: true, exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/capabilities/{slug}/plan-install", module: "server/management/marketplace-routes", mutates: true, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/capabilities/{slug}/favorite", module: "server/management/marketplace-routes", mutates: true, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/install-plans/{id}/approve", module: "server/management/marketplace-routes", mutates: true, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/install-plans/{id}/execute", module: "server/management/marketplace-routes", mutates: true, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/marketplace/install-plans/{id}", module: "server/management/marketplace-routes", mutates: false, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/marketplace/installations/{id}/rollback", module: "server/management/marketplace-routes", mutates: true, mechanism: "slice", exempt: MARKETPLACE_VERB_DEFERRAL },
  // Phase 20.91b: Engineering Skill Runtime (Addy Osmani Agent Skills; proposed 20.93).
  { method: "GET", path: "/api/agent-os/engineering-skills/health", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/packs", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/packs/{id}", module: "server/management/engineering-skills-routes", mutates: false, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/skills", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/workflows", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/workflows/{id}", module: "server/management/engineering-skills-routes", mutates: false, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/workflows/{id}/evidence", module: "server/management/engineering-skills-routes", mutates: false, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/workflows/{id}/reviews", module: "server/management/engineering-skills-routes", mutates: false, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/policy-decisions", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/engineering-skills/audit", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/import", module: "server/management/engineering-skills-routes", mutates: true, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/{id}/validate", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/{id}/promote", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/{id}/rollback", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/{id}/enable", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/packs/{id}/disable", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/routes/explain", module: "server/management/engineering-skills-routes", mutates: false, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows", module: "server/management/engineering-skills-routes", mutates: true, exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/advance", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/evidence", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/reviews", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/approve", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/cancel", module: "server/management/engineering-skills-routes", mutates: true, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/engineering-skills/workflows/{id}/skip-request", module: "server/management/engineering-skills-routes", mutates: false, mechanism: "slice", exempt: ENGINEERING_SKILLS_VERB_DEFERRAL },
  // Phase 20.92: AI Script-to-Video Studio (semantic director layer).
  { method: "GET", path: "/api/agent-os/video-studio/health", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/projects", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/templates", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/projects/{id}", module: "server/management/video-studio-routes", mutates: false, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/auto-build/{jobId}", module: "server/management/video-studio-routes", mutates: false, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects", module: "server/management/video-studio-routes", mutates: true, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/script", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/plan", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/resolve-assets", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/voice", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/timeline", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/qa", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/render", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/approve", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/auto-build", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/auto-build/{jobId}/step", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/lock", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/regenerate", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/narration", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/reorder", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  // Phase 20.93: Visual Agentic Workflow Studio (orchestration layer).
  { method: "GET", path: "/api/agent-os/workflow-studio/health", module: "server/management/workflow-studio-routes", mutates: false, exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/workflow-studio/workflows", module: "server/management/workflow-studio-routes", mutates: false, exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/workflow-studio/nodes", module: "server/management/workflow-studio-routes", mutates: false, exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/workflow-studio/approvals", module: "server/management/workflow-studio-routes", mutates: false, exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/workflow-studio/workflows/{id}", module: "server/management/workflow-studio-routes", mutates: false, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/workflow-studio/runs/{id}", module: "server/management/workflow-studio-routes", mutates: false, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/workflows", module: "server/management/workflow-studio-routes", mutates: true, exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/workflows/{id}/validate", module: "server/management/workflow-studio-routes", mutates: false, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/workflows/{id}/publish", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/workflows/{id}/run", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/runs/{id}/advance", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/runs/{id}/pause", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/runs/{id}/resume", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/runs/{id}/cancel", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/runs/{id}/retry", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/workflow-studio/approvals/{id}/decision", module: "server/management/workflow-studio-routes", mutates: true, mechanism: "slice", exempt: WORKFLOW_STUDIO_VERB_DEFERRAL },
  // Phase 20.94: ENZO unified workspace.
  { method: "GET", path: "/api/agent-os/enzo-workspace/health", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/models", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/agents", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/skills", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/runs", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/approvals", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/memory/search", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/runs/{id}", module: "server/management/enzo-workspace-routes", mutates: false, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/runs/{id}/events", module: "server/management/enzo-workspace-routes", mutates: false, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/enzo-workspace/agents/{slug}/{version}", module: "server/management/enzo-workspace-routes", mutates: false, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/models/route", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/agents/draft", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/agents", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/skills/resolve", module: "server/management/enzo-workspace-routes", mutates: false, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/runs", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/research", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/credentials", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/credentials/lease", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/tools/invoke", module: "server/management/enzo-workspace-routes", mutates: true, exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/runs/{id}/cancel", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/runs/{id}/replay", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/approvals/{id}/approve", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/approvals/{id}/deny", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/memory/lessons/{id}/accept", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/memory/lessons/{id}/quarantine", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/enzo-workspace/agents/{slug}/{version}/run", module: "server/management/enzo-workspace-routes", mutates: true, mechanism: "slice", exempt: ENZO_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/health", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/adapters/health", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/doctor", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/jobs", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/capabilities", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/sessions", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/jobs/{id}", module: "server/management/acquisition-routes", mutates: false, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/acquisition/jobs/{id}/artifacts", module: "server/management/acquisition-routes", mutates: false, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/plan", module: "server/management/acquisition-routes", mutates: false, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs", module: "server/management/acquisition-routes", mutates: true, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/pause", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/resume", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/cancel", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/retry", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/approve", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/jobs/{id}/deny", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/session-refs", module: "server/management/acquisition-routes", mutates: true, exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/acquisition/session-refs/{id}/revoke", module: "server/management/acquisition-routes", mutates: true, mechanism: "slice", exempt: ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/health", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/doctor", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/connectors", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/tools", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/approvals", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/knowledge", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/skills", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/metrics", module: "server/management/mcp-fabric-routes", mutates: false, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mcp-fabric/connectors/{id}", module: "server/management/mcp-fabric-routes", mutates: false, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/import", module: "server/management/mcp-fabric-routes", mutates: true, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/execute", module: "server/management/mcp-fabric-routes", mutates: true, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/privacy-preview", module: "server/management/mcp-fabric-routes", mutates: true, exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/connectors/{id}/approve", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/connectors/{id}/publish", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/connectors/{id}/disable", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/connectors/{id}/drift", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/approvals/{id}/approve", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/approvals/{id}/deny", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/skills/{id}/promote", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mcp-fabric/tools/{id}/rollback", module: "server/management/mcp-fabric-routes", mutates: true, mechanism: "slice", exempt: MCP_FABRIC_VERB_DEFERRAL },
  // Phase 20.98: OpenHermit Fleet Runtime
  { method: "GET", path: "/api/agent-os/openhermit/health", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/compatibility", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/agents", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/agents", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/agents/{id}", module: "server/management/openhermit-routes", mutates: false, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/agents/{id}/start", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/agents/{id}/stop", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/agents/{id}/restart", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/agents/{id}/reconcile", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/agents/{id}/sessions", module: "server/management/openhermit-routes", mutates: false, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/agents/{id}/skills", module: "server/management/openhermit-routes", mutates: false, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/agents/{id}/mcp", module: "server/management/openhermit-routes", mutates: false, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/sessions", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/sessions/{id}/message", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/sessions/{id}/checkpoint", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/sessions/{id}/resume", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/sessions/{id}/close", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/approvals", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/approvals/{id}/approve", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/approvals/{id}/reject", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/fleet/impact", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/fleet/execute", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/research/create", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/research/{id}/approve", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/research/{id}/execute", module: "server/management/openhermit-routes", mutates: true, mechanism: "slice", exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/skills/assign", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/openhermit/mcp/assign", module: "server/management/openhermit-routes", mutates: true, exempt: OPENHERMIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/openhermit/events", module: "server/management/openhermit-routes", mutates: false, exempt: OPENHERMIT_VERB_DEFERRAL },
  // Phase 20.99: Pao-hubPro × Whip Mobile Agent Operations Plane
  { method: "GET", path: "/api/agent-os/whip/hosts", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/hosts", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/fleet", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/transcripts", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/transcripts/turn", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/terminals", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/terminals", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/pairing/create", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/pairing/complete", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/approvals", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/approvals/{id}/decide", module: "server/management/whip-routes", mutates: true, mechanism: "slice", exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/queue", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/whip/queue", module: "server/management/whip-routes", mutates: true, exempt: WHIP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/whip/audit", module: "server/management/whip-routes", mutates: false, exempt: WHIP_VERB_DEFERRAL },
  // Phase 20.100: Pao-hubPro × ZCode Agent Workspace Runtime
  { method: "GET", path: "/api/agent-os/zcode/health", module: "server/management/zcode-routes", mutates: false, exempt: ZCODE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/zcode/runtimes", module: "server/management/zcode-routes", mutates: true, exempt: ZCODE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/zcode/tools", module: "server/management/zcode-routes", mutates: false, exempt: ZCODE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/zcode/approvals", module: "server/management/zcode-routes", mutates: false, exempt: ZCODE_VERB_DEFERRAL },
  // Phase 20.101: Pao-hubPro Universal AI Browser Control Plane
  { method: "GET", path: "/api/agent-os/browser-control/fleet", module: "server/management/browser-control-routes", mutates: false, exempt: BROWSER_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/browser-control/lease", module: "server/management/browser-control-routes", mutates: true, exempt: BROWSER_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/browser-control/personas", module: "server/management/browser-control-routes", mutates: false, exempt: BROWSER_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/browser-control/personas", module: "server/management/browser-control-routes", mutates: true, exempt: BROWSER_CONTROL_VERB_DEFERRAL },
  // Phase 21.00: Unified Agent Operations Control Plane
  { method: "GET", path: "/api/agent-os/unified/agents", module: "server/management/unified-control-plane-routes", mutates: false, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/agents", module: "server/management/unified-control-plane-routes", mutates: true, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/hosts", module: "server/management/unified-control-plane-routes", mutates: false, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/hosts", module: "server/management/unified-control-plane-routes", mutates: true, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/jobs", module: "server/management/unified-control-plane-routes", mutates: true, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/approvals/{id}/decide", module: "server/management/unified-control-plane-routes", mutates: true, mechanism: "slice", exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/mcp/tools", module: "server/management/unified-control-plane-routes", mutates: false, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/skills", module: "server/management/unified-control-plane-routes", mutates: false, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/audit", module: "server/management/unified-control-plane-routes", mutates: false, exempt: UNIFIED_CONTROL_PLANE_VERB_DEFERRAL },
  // Phase 21.01: Pao-hubPro × Parley Multi-Agent Work Room
  { method: "GET", path: "/api/agent-os/parley/rooms", module: "server/management/parley-routes", mutates: false, exempt: PARLEY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/parley/rooms", module: "server/management/parley-routes", mutates: true, exempt: PARLEY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/parley/rooms/{id}", module: "server/management/parley-routes", mutates: false, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/parley/rooms/{id}/messages", module: "server/management/parley-routes", mutates: false, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/parley/rooms/{id}/messages", module: "server/management/parley-routes", mutates: true, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/parley/rooms/{id}/agents", module: "server/management/parley-routes", mutates: false, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/parley/rooms/{id}/agents", module: "server/management/parley-routes", mutates: true, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/parley/rooms/{id}/export", module: "server/management/parley-routes", mutates: false, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/parley/runs/{id}/inspector", module: "server/management/parley-routes", mutates: false, mechanism: "slice", exempt: PARLEY_VERB_DEFERRAL },
  // Phase 21.02: Multi-Agent Mission Control
  { method: "GET", path: "/api/agent-os/mission-control/overview", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/agents", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/agents/{id}/pause", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/agents/{id}/resume", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/agents/{id}/quarantine", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/agents/{id}/takeover", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/runs", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/runs/{id}/timeline", module: "server/management/mission-control-routes", mutates: false, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/runs/{id}/pause", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/runs/{id}/resume", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/runs/{id}/cancel", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/runs/{id}/retry", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/approvals", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/approvals/{id}/resolve", module: "server/management/mission-control-routes", mutates: true, mechanism: "slice", exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/queues", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/dlq", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/mission-control/emergency-stop", module: "server/management/mission-control-routes", mutates: true, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/mission-control/audit", module: "server/management/mission-control-routes", mutates: false, exempt: MISSION_CONTROL_VERB_DEFERRAL },
  // Phase Navop & 21.03: Host-Authoritative Operations & CC-Switch Runtime
  { method: "GET", path: "/api/agent-os/navop/resources", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/navop/resources", module: "server/management/navop-routes", mutates: true, exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/capabilities", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/navop/sessions", module: "server/management/navop-routes", mutates: true, exempt: NAVOP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/navop/execute", module: "server/management/navop-routes", mutates: true, exempt: NAVOP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/navop/approvals/{id}/resolve", module: "server/management/navop-routes", mutates: true, mechanism: "slice", exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/providers", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/runtimes", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/audit", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/routes", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/navop/routes", module: "server/management/navop-routes", mutates: true, exempt: NAVOP_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/navop/usage", module: "server/management/navop-routes", mutates: false, exempt: NAVOP_VERB_DEFERRAL },
  // Phase 21.02: MiniMax H3 Extender Video Execution Plane
  { method: "GET", path: "/api/video/h3/projects", module: "server/management/h3-extender-routes", mutates: false, exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/video/h3/projects", module: "server/management/h3-extender-routes", mutates: true, exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/video/h3/projects/{id}/clips", module: "server/management/h3-extender-routes", mutates: false, mechanism: "slice", exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/video/h3/projects/{id}/clips", module: "server/management/h3-extender-routes", mutates: true, mechanism: "slice", exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/video/h3/clips/{id}/generate", module: "server/management/h3-extender-routes", mutates: true, mechanism: "slice", exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/video/h3/clips/{id}/validate", module: "server/management/h3-extender-routes", mutates: true, mechanism: "slice", exempt: H3_EXTENDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/providers", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/ops", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/video-studio/batch/{batchId}", module: "server/management/video-studio-routes", mutates: false, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/providers/verify", module: "server/management/video-studio-routes", mutates: false, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/manifest", module: "server/management/video-studio-routes", mutates: false, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/render-final", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/voice", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/disable", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/enable", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/auto-build/{jobId}/cancel", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/auto-build/{jobId}/retry", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/batch", module: "server/management/video-studio-routes", mutates: true, exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/video-studio/batch/{batchId}/run", module: "server/management/video-studio-routes", mutates: true, mechanism: "slice", exempt: VIDEO_STUDIO_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/sensorimotor/perceive", module: "server/management/sensorimotor-routes", mutates: false, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/sensorimotor/perceptions/{id}", module: "server/management/sensorimotor-routes", mutates: false, mechanism: "slice", exempt: SENSORIMOTOR_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/sensorimotor/readiness", module: "server/management/sensorimotor-routes", mutates: false, exempt: SENSORIMOTOR_VERB_DEFERRAL },
  // Phase 20.85 OmniRoute Unified Model Gateway (agent-os-routes)
  { method: "GET", path: "/api/agent-os/model-gateway/health", module: "server/management/agent-os-routes", mutates: false, exempt: MODEL_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/model-gateway/routes", module: "server/management/agent-os-routes", mutates: false, exempt: MODEL_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/model-gateway/providers", module: "server/management/agent-os-routes", mutates: false, exempt: MODEL_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/model-gateway/models", module: "server/management/agent-os-routes", mutates: false, exempt: MODEL_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/model-gateway/circuits", module: "server/management/agent-os-routes", mutates: false, exempt: MODEL_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/skills", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/agents", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/memory", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/instincts", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/timeline", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/doctor", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ecc/agentshield", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ecc/plan", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ecc/execute", module: "server/management/ecc-routes", mutates: true, exempt: ECC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ecc/verify", module: "server/management/ecc-routes", mutates: false, exempt: ECC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ecc/instincts/promote", module: "server/management/ecc-routes", mutates: true, exempt: ECC_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ecc/agentshield/scan", module: "server/management/ecc-routes", mutates: true, exempt: ECC_VERB_DEFERRAL },
  // Phase 20.21 OpenAI Codex Native Runtime Integration. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/codex-runtime/status", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/health", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/capabilities", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/schema/sync", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/nodes", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/nodes", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/sessions", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/session", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/sessions", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/sessions/resume", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/turns/start", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/turns/cancel", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/approvals", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/approvals/resolve", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/policies", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/codex-runtime/policies/unlock", module: "server/management/codex-runtime-routes", mutates: true, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/tools", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/audit", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/codex-runtime/daemon/status", module: "server/management/codex-runtime-routes", mutates: false, exempt: CODEX_RUNTIME_VERB_DEFERRAL },
  // Phase 20.22 Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/orchestration/status", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orchestration/runs", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orchestration/runs", module: "server/management/orchestration-routes", mutates: true, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orchestration/run", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orchestration/runs/resume", module: "server/management/orchestration-routes", mutates: true, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orchestration/runs/cancel", module: "server/management/orchestration-routes", mutates: true, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orchestration/approvals", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orchestration/approvals/resolve", module: "server/management/orchestration-routes", mutates: true, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orchestration/mcp/servers", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orchestration/mcp/servers", module: "server/management/orchestration-routes", mutates: true, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orchestration/policies", module: "server/management/orchestration-routes", mutates: false, exempt: ORCHESTRATION_RUNTIME_VERB_DEFERRAL },
  // Phase 20.23 Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/notifications/status", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/metrics", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/destinations", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/destinations", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/destinations/enable", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/destinations/disable", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/destinations/test", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/events", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/events", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/send", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/deliveries", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/delivery", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/deliveries/retry", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/dead-letters", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/dead-letters/retry", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/notifications/dead-letters/dismiss", module: "server/management/notification-routes", mutates: true, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/notifications/rate-limits", module: "server/management/notification-routes", mutates: false, exempt: NOTIFICATION_GATEWAY_VERB_DEFERRAL },
  // Phase 20.24 Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/media/status", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/health", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/providers", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/inspect", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs/batch", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/jobs", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/job", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs/pause", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs/resume", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs/cancel", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/jobs/retry", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/artifacts", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/metrics", module: "server/management/media-routes", mutates: false, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/bridge/pair", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/bridge/dispatch", module: "server/management/media-routes", mutates: true, exempt: MEDIA_ACQUISITION_VERB_DEFERRAL },
  // Phase 20.25 Pao-hubPro × Agentic AI Universal Registry & Toolchain. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/registry/status", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/tools", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/tool", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/search", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/sync", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/health-check", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/plan", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/runs", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/runs", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/run", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/runs/replay", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/approvals", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/approvals/resolve", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/audit", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/registry/stats", module: "server/management/registry-routes", mutates: false, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/tools/toggle", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/registry/feedback", module: "server/management/registry-routes", mutates: true, exempt: UNIVERSAL_REGISTRY_VERB_DEFERRAL },
  // Phase 20.26 Pao-hubPro × Douyin Media Intelligence & Downloader Engine. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/media/douyin/health", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/inspect", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/download", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/search", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/hot-board", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/hot-board", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/creators/sync", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/creators", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/comments/fetch", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/comments", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/transcribe", module: "server/management/douyin-routes", mutates: true, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/items", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/search-snapshots", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/sessions", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/media/douyin/stock-export/check", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/media/douyin/mcp-tools", module: "server/management/douyin-routes", mutates: false, exempt: DOUYIN_VERB_DEFERRAL },
  // Phase 20.27 Pao-hubPro × VibeRaven Agent Cockpit & Production Readiness Control Plane. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/cockpit/overview", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/agents", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/agents/doctor", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/agents/access-mode", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/sessions", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/sessions", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/session", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/sessions/cancel", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/approvals", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/approvals", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/approvals/resolve", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/gate", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/gate", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/evidence", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/providers", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/providers/verify", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/releases/compare", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/releases/mark", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/context-snapshot", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/context-snapshot", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/reviews", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/reviews", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/cockpit/tasks", module: "server/management/cockpit-routes", mutates: false, exempt: COCKPIT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/cockpit/tasks", module: "server/management/cockpit-routes", mutates: true, exempt: COCKPIT_VERB_DEFERRAL },
  // Phase 20.28 Pao-hubPro × OpenBot-inspired Governance Gateway. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/governance/status", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/governance/policies", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/policies", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/policies/test", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/dispatch", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/governance/grants", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/grants", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "DELETE", path: "/api/agent-os/governance/grants", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/governance/approvals", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/approvals/resolve", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/governance/audit", module: "server/management/governance-routes", mutates: false, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/emergency", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/governance/computers/control", module: "server/management/governance-routes", mutates: true, exempt: GOVERNANCE_VERB_DEFERRAL },
  // Phase 20.29 Pao-hubPro × ClawFlows Workflow Registry & Safe Automation Engine. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/automation", module: "server/management/automation-routes", mutates: false, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/import", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/enable", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/disable", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/dry-run", module: "server/management/automation-routes", mutates: false, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/run", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/automation/runs", module: "server/management/automation-routes", mutates: false, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/automation/runs/detail", module: "server/management/automation-routes", mutates: false, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/runs/cancel", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/approvals/resolve", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/runs/replay", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/seed", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/automation/audit", module: "server/management/automation-routes", mutates: false, exempt: AUTOMATION_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/automation/scheduler/tick", module: "server/management/automation-routes", mutates: true, exempt: AUTOMATION_VERB_DEFERRAL },
  // Phase 20.30 Universal AI Gateway control plane (over the existing proxy router). Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/ai-gateway/status", module: "server/management/ai-gateway-routes", mutates: false, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-gateway/aliases", module: "server/management/ai-gateway-routes", mutates: false, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ai-gateway/aliases", module: "server/management/ai-gateway-routes", mutates: true, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ai-gateway/route-preview", module: "server/management/ai-gateway-routes", mutates: false, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-gateway/budget", module: "server/management/ai-gateway-routes", mutates: false, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ai-gateway/budget", module: "server/management/ai-gateway-routes", mutates: true, exempt: AI_GATEWAY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-gateway/audit", module: "server/management/ai-gateway-routes", mutates: false, exempt: AI_GATEWAY_VERB_DEFERRAL },
  // Phase 20.32 Pao-hubPro × VoiceStudio Local AI Speech Runtime. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/speech/health", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/capabilities", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/diagnostics", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/mcp-config", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/voices", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/voices/sync", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/voices/approve-stock", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/voices/block", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/voices/policy-status", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/synthesize", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/transcribe", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/clone", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/dub", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/jobs", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/jobs/detail", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/jobs/cancel", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/artifacts/detail", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/licenses", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/licenses", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/licenses/review", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/consents", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/consents", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/speech/consents/revoke", module: "server/management/speech-routes", mutates: true, exempt: SPEECH_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/speech/audit", module: "server/management/speech-routes", mutates: false, exempt: SPEECH_VERB_DEFERRAL },
  // Phase 20.33 Pao-hubPro × Open WebUI Unified AI Workspace & MCP Control Plane. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/ai-workspace/status", module: "server/management/ai-workspace-routes", mutates: false, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-workspace/health", module: "server/management/ai-workspace-routes", mutates: false, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-workspace/tools", module: "server/management/ai-workspace-routes", mutates: false, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ai-workspace/mcp", module: "server/management/ai-workspace-routes", mutates: true, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/ai-workspace/tools/call", module: "server/management/ai-workspace-routes", mutates: true, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/ai-workspace/openwebui", module: "server/management/ai-workspace-routes", mutates: false, exempt: AI_WORKSPACE_VERB_DEFERRAL },
  // Phase 20.34 Pao-hubPro × Lead Gen API Stack. Full-literal pathname guards, no mechanism.
  { method: "POST", path: "/api/agent-os/leads/search", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/cost-estimate", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/jobs", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/jobs/detail", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/jobs/approve", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/jobs/cancel", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/detail", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/enrich", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/verify", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/score", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/providers", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/providers/test", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/providers/enable", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/pipelines", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/pipelines/run", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/pipelines/detail", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/exports", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/exports/detail", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/suppression", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/suppression", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/suppression/remove", module: "server/management/lead-routes", mutates: true, exempt: LEAD_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/leads/suppression/check", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/audit", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/leads/costs", module: "server/management/lead-routes", mutates: false, exempt: LEAD_VERB_DEFERRAL },
  // Phase 20.35 Pao-hubPro unified AI runtime control plane. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/unified/health", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/providers", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/providers/test", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/providers/enable", module: "server/management/unified-runtime-routes", mutates: true, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/router/preview", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/router/execute", module: "server/management/unified-runtime-routes", mutates: true, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/context/inspect", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/workspaces/grants", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/workspaces/grants/set", module: "server/management/unified-runtime-routes", mutates: true, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/unified/attachments/validate", module: "server/management/unified-runtime-routes", mutates: true, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/usage", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/unified/audit", module: "server/management/unified-runtime-routes", mutates: false, exempt: UNIFIED_RUNTIME_VERB_DEFERRAL },
  // Phase 30.36 Pao-hubPro Business Builder. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/business/opportunities", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/detail", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/score", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/pao-fit", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/compliance", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/cost", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/compare", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/compile", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/codex-pack", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/opportunities/archive", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/import/playbooks", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/business/import/history", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/business/capabilities", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/capabilities/refresh", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/business/experiments", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/experiments", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/experiments/metrics", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/business/experiments/evaluate", module: "server/management/business-routes", mutates: true, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/business/audit", module: "server/management/business-routes", mutates: false, exempt: BUSINESS_BUILDER_VERB_DEFERRAL },
  // Phase 20.37 Pao-hubPro Agentic Development OS. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/orch/health", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/agents", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/agents/enable", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/skills", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/hooks", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/route", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/runs", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/runs", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/runs/detail", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/runs/cancel", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/approvals", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/approvals/resolve", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/worktrees", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/worktrees/allocate", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/worktrees/release", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/memories", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/orch/memories", module: "server/management/agentic-os-routes", mutates: true, exempt: AGENTIC_OS_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/orch/audit", module: "server/management/agentic-os-routes", mutates: false, exempt: AGENTIC_OS_VERB_DEFERRAL },
  // Phase 20.38 Pao-hubPro Dependency Vault. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/dep-vault/status", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/dep-vault/packages", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/scan", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/ensure", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/install", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/dep-vault/profiles", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/profiles/prewarm", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/bundles/export", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/bundles/import", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/dep-vault/quarantine", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/quarantine/reverify", module: "server/management/dependency-vault-routes", mutates: true, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/dep-vault/sbom", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/dep-vault/audit", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/dep-vault/policy/decisions", module: "server/management/dependency-vault-routes", mutates: false, exempt: DEP_VAULT_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/health", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/workspaces", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/workspaces", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/workspaces/detail", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "PATCH", path: "/api/agent-os/coding-workspace/workspaces/detail", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/workspaces/lock", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/workspaces/lock/takeover", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/providers", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/providers/probe", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/providers/capabilities", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/sessions", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/sessions/start", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/sessions/detail", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "PATCH", path: "/api/agent-os/coding-workspace/sessions/detail", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/sessions/resume", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/sessions/messages", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/sessions/cancel", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/sessions/events", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/sessions/stream", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/sessions/usage", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/session-discovery/scan", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/session-discovery/import", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/approvals", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/approvals/decide", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/usage/summary", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/context/search", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/context/resolve", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/slash-commands", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/slash-commands/execute", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/audit", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/coding-workspace/reconcile", module: "server/management/coding-cockpit-routes", mutates: true, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/runs", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/tools", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/coding-workspace/processes", module: "server/management/coding-cockpit-routes", mutates: false, exempt: CODING_WORKSPACE_VERB_DEFERRAL },
  // Phase 20.40 Pao-hubPro × JSONL Liveness Agent Observability (read-only). Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-os/observability/health", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/snapshot", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/sessions", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/sessions/detail", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/sessions/events", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/timeline", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/adapters", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/alerts", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/events/stream", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "PUT", path: "/api/agent-os/observability/sessions/alias", module: "server/management/observability-routes", mutates: true, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-os/observability/integrity-check", module: "server/management/observability-routes", mutates: true, exempt: OBSERVABILITY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-os/observability/stats", module: "server/management/observability-routes", mutates: false, exempt: OBSERVABILITY_VERB_DEFERRAL },
  // Phase 20.43 Pao x PLUR Shared Agent Memory Runtime. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-memory/status", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/doctor", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/engrams", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/learn", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/recall", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/inject", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/feedback", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/rescope", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/forget", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/timeline", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/episodes", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/receipts", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/conflicts", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/conflicts/resolve", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/candidates", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/candidates/approve", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/candidates/reject", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/policies", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-memory/adapters", module: "server/management/plur-memory-routes", mutates: false, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/sync/preview", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/sync/execute", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-memory/reconcile", module: "server/management/plur-memory-routes", mutates: true, exempt: PLUR_MEMORY_VERB_DEFERRAL },
  // Phase 20.42 Pao-hubPro x BotWorkspace-inspired Named AI Teammate Workspace. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/agent-workspace/health", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/agents", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/agents", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/agents/detail", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "PATCH", path: "/api/agent-workspace/agents/detail", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/agents/status", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/teams", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/teams", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/teams/reorder", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/conversations", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/conversations", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/conversations/messages", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/conversations/messages", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "PUT", path: "/api/agent-workspace/conversations/draft", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/conversations/draft", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/providers", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/providers", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/providers/healthcheck", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/runtimes", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/rounds", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/rounds/run", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/rounds/detail", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/rounds/cancel", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/rounds/retry", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/approvals", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/approvals/decide", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/routines", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/routines", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/routines/status", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/routines/run", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/routines/runs", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/audit", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "GET", path: "/api/agent-workspace/export", module: "server/management/bot-workspace-routes", mutates: false, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  { method: "POST", path: "/api/agent-workspace/reconcile", module: "server/management/bot-workspace-routes", mutates: true, exempt: BOT_WORKSPACE_VERB_DEFERRAL },
  // Phase 20.41 Pao-hubPro × Arra-inspired Trustworthy MCP Memory Plane. Full-literal pathname guards, no mechanism.
  { method: "GET", path: "/api/memory/info", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/health", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/stats", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/preflight", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/verify", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/memories", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/memories", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/memories/detail", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/memories/revisions", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/memories/forget/preview", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/memories/forget/confirm", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/recall", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/observations", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/index/rebuild/preview", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/index/rebuild/confirm", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/traces", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/traces/detail", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/workspaces", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/projects", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/tags", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/export", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/import", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/.well-known/oauth-authorization-server", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/.well-known/oauth-protected-resource", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/oauth/register", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/oauth/token", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/oauth/revoke", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "GET", path: "/api/memory/oauth/clients", module: "server/management/memory-plane-routes", mutates: false, exempt: MEMORY_PLANE_VERB_DEFERRAL },
  { method: "POST", path: "/api/memory/oauth/clients/decide", module: "server/management/memory-plane-routes", mutates: true, exempt: MEMORY_PLANE_VERB_DEFERRAL },
];
