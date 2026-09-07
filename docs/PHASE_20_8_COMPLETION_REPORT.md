# Phase 20.8 Completion Report: Pao-hubPro × Agency Agents Dynamic Specialist Router & AI Team Orchestrator

## 1. Executive Summary

Phase 20.8 establishes a production-grade **Agency Intelligence Layer** in Pao-hubPro that dynamically indexes, searches, ranks, and lazy-loads specialist agent personas (from 147 local agency skills in `.gemini/config/skills/agency-*` and upstream references), composes multi-disciplinary teams tailored to user missions, decomposes work into dependency-ordered DAGs, delegates subtasks under strict security boundaries, aggregates evidence, and subjects outputs to Pao-hubPro's Reviewer Council, Reality Checker, Security Gate, and Human Approval before permitting execution via Codex, Hermes, or MCP.

### Core Ownership Invariant
> **Invariant:** Pao-hubPro retains 100% ownership of orchestration, policy, permissions, execution, audit, approval, model routing, and review gates. Agency Agents serves strictly as a specialist catalog and persona source. An untrusted prompt from an external specialist markdown can never elevate permissions, bypass workspace sandboxes, execute unsanctioned shell commands, or disable reality verification.

---

## 2. Architecture & Subsystems

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PAO-HUBPRO ORCHESTRATION                               │
│                                                                                        │
│  User / WebMCP / REST API                                                              │
│        │                                                                               │
│        ▼                                                                               │
│  AgencyOrchestrator ──► DynamicTeamBuilder ──► AgentSearchEngine (BM25 + Taxonomy)     │
│        │                                                │                              │
│        │                                                ▼                              │
│        │                                    LazyAgentLoader (LRU Cache)                │
│        │                                                │                              │
│        ▼                                                ▼                              │
│  TaskDecomposer ────► Delegation ───────────► Untrusted Prompt Firewall                │
│  (Sequenced DAG)      (Mode A / Mode B)        (Hierarchical Boundary)                 │
│        │                                                │                              │
│        ▼                                                ▼                              │
│  Specialist Execution ──────────────────────► AgentResult + EvidenceItems              │
│        │                                                                               │
│        ▼                                                                               │
│  Reviewer Council ──► Reality Gate ──► Security Gate ──► Human Approval (if critical) │
│        │                                                                               │
│        ▼                                                                               │
│  Execution via Codex / Hermes / WebMCP Tools ──► COMPLETED (Schema v14 SQLite)         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Subsystems Delivered

1. **Database Schema v14 (`src/agent-os/db.ts`):**
   - Version incremented to `AGENT_OS_SCHEMA_VERSION = 14`.
   - 9 relational tables with cascading foreign keys:
     - `agency_sources`: Registered catalog sources (bundled, cached, git, custom).
     - `agency_agents`: Specialist catalog metadata with capability and keyword indexes.
     - `agency_agent_versions`: Immutable version snapshots with SHA-256 integrity hashes.
     - `agency_team_presets`: Curated multi-agent team templates.
     - `agency_runs`: Orchestrated mission runs and state machine transitions.
     - `agency_subtasks`: Sequenced task DAG with retry tracking and assignment.
     - `agency_agent_results`: Findings, recommendations, diffs, and confidence metrics.
     - `agency_reviews`: Reviewer council, reality gate, and security evaluations.
     - `agency_evidence`: Ground-truth artifacts, test outputs, and verification statuses.

2. **Untrusted Prompt Firewall & Parser (`src/agent-os/agency/parser/`, `security/`):**
   - Frontmatter parser handles single or duplicate YAML blocks, lists, and custom fields.
   - 512KB size limit guard on agent markdown files.
   - Dual SHA-256 integrity hashing (`metadataHash` and `bodyHash`).
   - Prompt Injection Scanner detects clean, warning, and blocked injection patterns.
   - Bounded Instruction Packaging establishes unambiguous hierarchical authority:
     `System Policy > Pao Policy > Project Policy > Team Policy > Specialist Instruction > User Task`.

3. **Registry, Sourcing & Lazy Loader (`src/agent-os/agency/registry/`, `providers/`, `loader/`):**
   - `BundledAgencyProvider`: Scans 147 local agency skills across `.gemini/config/skills/agency-*`.
   - `CachedSnapshotProvider`: Maintains offline immutable cache under `.pao/cache/agency-agents/manifest.json`.
   - `AgentRegistry`: Fast SQLite query interface with dynamic division counters and performance telemetry.
   - `LazyAgentLoader`: Zero startup prompt preload. Employs a 16-entry LRU cache, on-demand loading, and synthetic fallback specialist resilience.

4. **Search Engine & Explainable Routing (`src/agent-os/agency/search/`):**
   - Capability Taxonomy with synonym expansion (e.g. `"auth"` ↔ `"identity-access"` ↔ `"rbac"`).
   - Multi-factor Explainable Routing Formula:
     $$\text{Score} = (0.35 \times \text{IntentMatch}) + (0.25 \times \text{CapabilityOverlap}) + (0.15 \times \text{KeywordScore}) + (0.15 \times \text{DivisionFit}) + (0.10 \times \text{Performance})$$
   - Lexical Search Engine with BM25-style ranking and division diversity enforcement.

5. **Dynamic Team Builder & Presets (`src/agent-os/agency/teams/`):**
   - 5 Standard Presets: `pao-dev`, `pao-mcp`, `pao-stock-research`, `pao-stock-production`, `pao-security`.
   - Automatic risk tiering (`low`, `medium`, `high`, `critical`).
   - Mandatory reviewers (Code Reviewer for code, Security Engineer for high/critical risks).
   - Mandatory validators (Reality Checker for evidence verification).

6. **Decomposer, Reviewer Council, Reality & Security Gates (`src/agent-os/agency/orchestration/`, `review/`):**
   - `TaskDecomposer`: Transforms high-level goals into dependency-ordered subtask DAGs.
   - `ReviewerCouncilAdapter`: Aggregates findings, detects conflicts, and issues consensus decisions.
   - `RealityGate`: Validates physical existence of artifacts on filesystem and prevents hallucinations.
   - `SecurityGate`: Blocks destructive command patterns (`rm -rf /`, formatting) and diff secret leaks; halts for human operator approval on critical operations.

7. **Adapters & WebMCP Tools (`src/agent-os/agency/execution/`, `mcp/`):**
   - `CodexAgencyAdapter`: Mode A (Bounded prompt injection-free instruction) and Mode B (export to `.pao/generated/codex-agents/*.toml`).
   - `HermesAgencyAdapter`: Lazy routing and inspection adapter.
   - 7 WebMCP Tools registered in `src/agent-os/agency/mcp/agency-tools.ts`:
     `pao_agency_search`, `pao_agency_inspect`, `pao_agency_build_team`, `pao_agency_delegate`, `pao_agency_run_team`, `pao_agency_get_run`, `pao_agency_sync`.

8. **Management REST API & GUI Dashboard (`src/server/management/`, `gui/src/pages/`):**
   - Mounted routes under `/api/agency/*`: `/status`, `/agents`, `/agents/:slug`, `/search`, `/teams/presets`, `/teams/build`, `/runs`, `/runs/:id`, `/runs/:id/approve`, `/runs/:id/cancel`, `/sync`.
   - `AgencyCenter.tsx` + `agency-center.css`: Modern God-mode dashboard with division pills, search, team composition builder, run lifecycle tracker, and multi-language support (10 locales).

---

## 3. Verification & Quality Gates

All automated verification gates and tests passed with zero regressions:

| Gate / Suite | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Agency Test Suite** | `bun test tests/agency-agents-orchestrator.test.ts` | **23 passed / 0 failed** | 130 expect assertions passed |
| **Strict Typecheck** | `bun run typecheck` | **Passed (0 errors)** | Strict TypeScript clean |
| **GUI Linter** | `bun run lint:gui` | **Passed (0 warnings, 0 errors)** | 236 files inspected |
| **GUI Production Build** | `bun run build:gui` | **Passed (Code 0)** | Vite client build clean |
| **CI Privacy Scan** | `bun run privacy:scan` | **Passed** | Zero leaked credentials or secrets |
| **Core / Lab Boundary** | `bun test tests/core-lab-boundary.test.ts` | **17 passed / 0 failed** | Zero direct/transitive Lab imports |
| **Skill Surface Map** | `bun run skill:surface:check` | **Passed** | Operating reference current |

---

## 4. Deliverables & File Manifest

### Backend Runtime (`src/agent-os/agency/`)
- `types.ts`: Domain models, enums, request/response contracts.
- `parser/agent-markdown-parser.ts`: Markdown parser with 512KB limit, SHA-256 hashing.
- `parser/frontmatter.ts`: Frontmatter extractor with multi-line list support.
- `parser/sections.ts`: Structured section extractor.
- `security/prompt-injection-scanner.ts`: Security scanner (`clean`, `warning`, `blocked`).
- `security/prompt-sanitizer.ts`: Bounded instruction builder and hierarchical authority enforce.
- `registry/agent-registry.ts`: Relational catalog with usage telemetry.
- `loader/lazy-agent-loader.ts`: LRU memory cache with synthetic fallback agent creation.
- `providers/agency-catalog-provider.ts`: Provider contract.
- `providers/bundled-agency-provider.ts`: Local filesystem scanner (.gemini skills).
- `providers/cached-snapshot-provider.ts`: Offline cache reader/writer.
- `search/capability-taxonomy.ts`: Semantic synonym expansion.
- `search/routing-score.ts`: 5-factor explainable scoring engine.
- `search/lexical-search.ts`: BM25-style search and diversity reranking.
- `teams/preset-loader.ts`: Standard team preset repository.
- `teams/dynamic-team-builder.ts`: Risk-aware team composition engine.
- `orchestration/task-decomposer.ts`: Subtask DAG sequencer.
- `orchestration/agency-orchestrator.ts`: 11-step state machine orchestrator.
- `orchestration/sync-service.ts`: Catalog synchronization coordinator.
- `review/reviewer-council-adapter.ts`: Pao-hubPro review adapter.
- `review/reality-gate.ts`: Ground-truth verification gate.
- `review/security-gate.ts`: Command denylist and approval gate.
- `execution/codex-agency-adapter.ts`: Mode A bounded instruction & Mode B TOML export.
- `execution/hermes-agency-adapter.ts`: Hermes router and tool handler.
- `mcp/agency-tools.ts`: 7 WebMCP tools.
- `index.ts`: Unified barrel exports.

### API & GUI
- `src/server/management/agency-routes.ts`: REST API routes.
- `src/server/management-api.ts`: API router registration.
- `gui/src/pages/AgencyCenter.tsx`: React dashboard.
- `gui/src/styles/agency-center.css`: Responsive glassmorphism styling.
- `gui/src/App.tsx`, `app-routing.ts`, `icons.tsx`: GUI navigation integration.
- `gui/src/i18n/*.ts`: 10 language translations updated.

### Database & Tests
- `src/agent-os/db.ts`: Schema v14 with 9 relational tables and indexes.
- `tests/agency-agents-orchestrator.test.ts`: Comprehensive 23-test validation suite.

---

## 5. Conclusion

Phase 20.8 is fully operational, thoroughly tested, and verified against all architectural and security constraints. Pao-hubPro now possesses an autonomous specialist routing and dynamic team orchestration capability with robust verification gates.
