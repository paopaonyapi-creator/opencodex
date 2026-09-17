# Phase 20.65 — Pao-hubPro × Litho (deepwiki-rs)

## Autonomous Codebase Documentation Engine, C4 Architecture Intelligence, Multi-Agent Repository Research, External Knowledge Fusion & Policy-Governed Engineering Knowledge Runtime

> **Document type:** Production-Oriented Implementation Blueprint
> **Phase:** 20.65
> **Project:** Pao-hubPro
> **Source of Truth:** `Phase-20.65-Pao-hubPro-x-Litho-deepwiki-rs.md` (baseline reviewed: Litho v1.5.0, 2026), processed under `PAO-HUBPRO_MASTER_PHASE_REQUEST.md`
> **Primary upstream:** `sopaco/deepwiki-rs` (Litho) — https://github.com/sopaco/deepwiki-rs
> **Filename/content consistency:** Filename and document header agree on Phase 20.65; no collision detected.

> **Primary role in Pao-hubPro:** Repository → verified engineering knowledge → reusable human/agent context
> **Design rule:** Integrate Litho behind a stable Pao-hubPro adapter and policy boundary. Do not tightly couple core orchestration to Litho internals.

---

## 1. Executive Summary

Phase 20.65 adds an **Autonomous Engineering Knowledge Runtime** to Pao-hubPro by integrating **Litho (deepwiki-rs)** as a codebase documentation and architectural reasoning engine.

The goal is not merely to generate README files. The goal is to let Pao-hubPro continuously transform source repositories, architecture notes, Phase documents, SQL schemas, API specifications, ADRs, deployment documents, and selected external knowledge into a governed, queryable, versioned knowledge layer consumable by Codex, ChatGPT, Claude or other remote models, local AI / Ollama, Pao-hubPro agents, MCP clients, and human developers through the dashboard.

Litho becomes a **specialized analysis worker**, while Pao-hubPro remains the system of record and control plane for: repository registration; job orchestration; access policy; provider routing; secret protection; external-document trust; approvals; artifact versioning; observability; context retrieval; and agent-facing MCP tools.

This phase complements rather than replaces **Phase 20.62 Graft**: Graft is best used for structural code graph, dependency and blast-radius intelligence; Litho is used for C4 architecture explanation, codebase research, documentation synthesis, workflow and boundary analysis, and AI-ready contextual material.

```text
Git / Local Repository / Uploaded Project
                  │
                  ▼
        Pao-hubPro Repository Registry
                  │
                  ▼
       Policy + Trust + Secret Guard
                  │
          ┌───────┴────────┐
          ▼                ▼
        Graft            Litho
   Code/Dependency     Architecture/
       Graph          Documentation AI
          │                │
          └───────┬────────┘
                  ▼
        Knowledge Compiler Layer
                  │
      ┌───────────┼────────────┐
      ▼           ▼            ▼
 Human Docs   Agent Context   Graph Context
      │           │            │
      └───────────┼────────────┘
                  ▼
         Versioned Knowledge Store
                  │
       ┌──────────┼───────────┐
       ▼          ▼           ▼
      MCP       REST API   Dashboard
       │
       ▼
Codex / ChatGPT / Claude / Local AI / Future Agents
```

**Central architectural principle:** *Source code is truth. Generated knowledge is a versioned interpretation of that truth. Policy controls who may generate, read, refresh, and export that interpretation.*

```text
Git/source repository
        >
verified static facts
        >
graph-derived relationships
        >
generated natural-language explanation
```

When sources conflict, agents must be shown the conflict rather than having generated documentation silently override source reality.

---

## 2. Problem Statement

Pao-hubPro has grown into a multi-system agent platform with many phases, adapters, tools, runtimes and policy surfaces. As the repository grows, repeatedly sending raw source files to an LLM becomes increasingly inefficient and unreliable. Without a dedicated repository intelligence layer, agents face five recurring problems:

1. **Context fragmentation** — architecture knowledge is distributed across code, Phase `.md` files, SQL, config and old decisions.
2. **Token waste** — agents repeatedly re-read the same repository content.
3. **Architecture drift** — documentation falls behind implementation.
4. **Unsafe assumptions** — an agent may modify code without understanding module boundaries or downstream effects.
5. **Cross-agent inconsistency** — different models receive different repository slices and form conflicting mental models.

Phase 20.65 addresses those problems by creating a canonical, versioned engineering context plane.

### Expected result after this phase

Pao-hubPro no longer treats a repository as merely a directory of files; each repository becomes a governed knowledge domain:

```text
Repository
   ├── Source Truth
   ├── Dependency Graph
   ├── C4 Architecture
   ├── Workflows
   ├── Boundaries
   ├── Database Model
   ├── External Decisions / Phase Docs
   ├── Versioned Knowledge
   └── Agent Context Packs
```

The practical agent workflow becomes:

```text
Codex receives task → Ask Pao-hubPro Knowledge Gateway
→ Get fresh bounded repository context
   (architecture from Litho, dependency/impact from Graft, phase/ADR knowledge, source provenance)
→ Reason about the change
→ Use normal approval/policy workflow before mutation
```

No manual copying of generated wiki text into an agent prompt should be required.

---

## 3. Goals

### Primary goals

Build a production-ready repository knowledge subsystem that can:

1. Register repositories and knowledge sources.
2. Analyze repositories through Litho without exposing unrestricted host access.
3. Import selected external knowledge.
4. Generate C4-style architectural documentation.
5. Generate database/schema documentation when relevant.
6. Persist every knowledge build as an immutable version.
7. Detect stale knowledge relative to repository state.
8. Expose verified context to agents through MCP and internal APIs.
9. Enforce policy before source code or documentation is sent to external LLM providers.
10. Integrate Graft structural intelligence without hard dependency.
11. Support local-only operation with Ollama where required.
12. Provide human approval for sensitive repositories or external-provider analysis.
13. Track provenance from generated knowledge back to source snapshot, configuration and model/provider.
14. Prevent generated documentation from silently becoming an authority for executable actions.

### Secondary goals

- Reduce repeated token consumption; accelerate Codex onboarding into a repository.
- Improve code-review context; improve architectural change reviews.
- Create reusable context packs; prepare for cross-agent shared repository memory.
- Enable continuous documentation workflows; enable change-aware knowledge refresh.

---

## 4. Non-Goals

Phase 20.65 MUST NOT:

- replace Git as source of truth, or replace the actual source repository with generated documentation;
- allow Litho to mutate application source code;
- automatically approve code changes or automatically deploy code;
- automatically send private repositories to third-party LLMs without policy approval;
- duplicate Graft's code-graph implementation;
- build a full vector database platform from scratch if the existing Pao-hubPro storage layer can serve retrieval;
- create a hard dependency on a single LLM provider;
- trust generated diagrams as ground truth without verification metadata;
- allow imported external documents to inject executable instructions into agent tool calls.

---

## 5. Why This Phase Exists

See Sections 1–2. The strategic fit: Pao-hubPro accumulates Phase documents, ADRs, schemas and deployment notes alongside code. Litho turns that heterogeneous corpus plus the repository itself into normalized, versioned, retrievable knowledge — with Pao-hubPro governing every generation and retrieval decision.

### Relationship to existing Pao-hubPro phases

**Phase 20.62 — Graft:**

| Graft responsibility | Litho responsibility |
|---|---|
| repository structure intelligence | architectural explanation |
| dependency relationships | repository research |
| cross-module links | C4 documentation |
| blast-radius analysis | workflow analysis |
| graph-level code navigation | boundary documentation; module narratives; database overview; AI-ready human-readable context |

Combined:

```text
Graft answers:  "What is connected to what?"
Litho answers:  "What does the system mean and how is it organized?"
Pao-hubPro:     "Who may access it, when, through which model, under which policy?"
```

**Phase 20.53 — OpenViking / Persistent Context:** Phase 20.65 SHOULD publish verified repository knowledge into the broader persistent context layer through a stable export contract rather than direct storage coupling. Recommended context classes: `repo.system_context`, `repo.architecture`, `repo.module`, `repo.workflow`, `repo.boundary`, `repo.database`, `repo.adr`, `repo.release_context`.

**Phase 20.63 — Public APIs:** External API documentation discovered or registered by the API capability layer MAY be attached to Litho jobs as category `api`, but only after trust and scope validation.

**Phase 20.64 — vGPU:** Not required for Litho operation. Future local inference or visualization workers MAY use the visual/GPU runtime, but Phase 20.65 must remain CPU-compatible and provider-agnostic.

---

## 6. Relationship to Pao-hubPro

### Layer mapping (Pao-hubPro core layers)

| Layer | Role in this phase |
|---|---|
| 02 AI / Agent Layer | Knowledge consumers (Codex, ChatGPT, Claude, local models). |
| 05 MCP Gateway | Hosts `knowledge.*` tools. |
| 06 Capability Registry | Knowledge-source registry (categories, trust levels). |
| 07 Policy Engine | Pre-execution policy (visibility, provider class, secrets, cost). |
| 08 Approval Engine | Human approval gates (Section 21). |
| 09–11 Execution Runtimes | Litho runner (local binary or sandbox container). |
| 12 State / Session Layer | Builds, versions, artifacts persistence. |
| 13 Memory / Knowledge Layer | **Primary owner** — Versioned Knowledge Store. |
| 14 Secrets & Credential Layer | Provider credentials via env/secret store; secret preflight scan. |
| 15 Event / Queue Layer | Knowledge build job queue. |
| 16 Observability Layer | Metrics, structured logs, tracing spans. |
| 17 Audit Layer | `knowledge_audit_events`. |
| 19 Web Dashboard | "Knowledge" navigation area. |
| 20 External Provider Layer | LLM providers (cloud/local); Litho upstream engine. |

### Ownership boundaries

**Pao-hubPro owns:** repository registry, snapshot management, job orchestration, policy/approval, provider routing, secret protection, artifact versioning, retrieval surfaces, audit, dashboard.

**Phase 20.65 owns:** the Engineering Knowledge Runtime — `KnowledgeEngineAdapter` abstraction, Litho adapter, knowledge compiler/normalizer, versioned store layout, freshness/quality services, context pack compiler, MCP/REST knowledge surfaces.

**Upstream `sopaco/deepwiki-rs` owns:** the analysis engine, its config format, its research agents, its output shapes.

---

## 7. Upstream / External Project

### Upstream capability baseline (at phase-design time; re-verify against the repo at implementation)

The integration MUST treat Litho as an upstream engine with a compatibility adapter. At the time of this phase design, relevant Litho capabilities include:

- Rust-based codebase analysis engine; automatic architecture documentation generation; C4-style documentation.
- Multi-language source analysis; research/analysis + documentation composition pipeline.
- External knowledge through `local_docs`; categorized external documentation.
- Semantic / paragraph / fixed-size chunking; selective routing of document categories to relevant agents.
- Database documentation generation; SQL project analysis.
- OpenAI-compatible provider endpoints; Ollama/local-model support; efficient/powerful model roles; provider/model fallover.
- Caching; improved lenient structured-output deserialization and recovery.
- Generated documentation suitable for both human teams and AI agents.

**Pao-hubPro MUST NOT assume every upstream feature is stable forever. All Litho-specific behavior MUST remain behind `LithoAdapter` and capability detection.**

### Separation of concerns

| Part | Owner | Notes |
|---|---|---|
| A. Upstream project | `sopaco/deepwiki-rs` | Rust engine + CLI + config contract. Do not fork or modify. |
| B. Pao-hubPro adapter | `LithoAdapter` + sub-components (Section 12.3) | Binary resolution, version/capability detection, config compilation, sandboxed execution, log parsing, output normalization, error classification. |
| C. Pao-hubPro policy wrapper | Policy engine integration, secret preflight, provider boundary, approval gates, audit | All governance lives here. |
| D. Pao-hubPro extensions | Registry, snapshot manager, quality/freshness services, context packs, Graft fusion, dashboard, CLI | Built in this phase. |

### Upstream risk assessment

- **License / maintenance status:** [Needs Verification] — record license and release health at implementation time in the compatibility record.
- **API stability:** treat the CLI/config contract as the only stable surface; pin tested versions; detect capability differences at runtime.
- **Dependency risk:** medium — an external binary/container is required for analysis; the system must degrade gracefully when Litho is absent (`knowledge engine unavailable`), never crashing Pao-hubPro core.
- **Security surface:** repository content leaves the host when external LLM providers are used — governed by policy + secret preflight (Sections 20, 28 of source; Section 20 here).
- **Upgrade strategy:** version detection + capability detection per job; config generated per detected version.
- **Vendor lock-in:** none — `KnowledgeEngineAdapter` is replaceable (future Terrain/static-analyzer adapters).
- **Fallback:** Litho-less operation (registry, sources, retrieval of previously published versions, stale marking all still work); Graft-optional fusion.

### References

- Litho / deepwiki-rs: https://github.com/sopaco/deepwiki-rs
- Litho releases: https://github.com/sopaco/deepwiki-rs/releases
- Upstream example configuration: https://github.com/sopaco/deepwiki-rs/blob/main/litho-example.toml
- Upstream architecture reference: https://github.com/sopaco/deepwiki-rs/blob/main/.ai-context/references/ARCHITECTURE.md

---

## 8. Current-State Assumptions

- **[Needs Verification] Repository stack:** inspect architecture, package manager, languages, database, migration system, auth/RBAC, MCP implementation, provider abstractions, policy system, job queue, logging, telemetry, UI conventions and testing conventions before coding. Do not assume TypeScript, a specific DB, Docker, or a particular framework if the repository uses something else.
- **[Assumption] Sandbox/container runtime:** if the project already has a sandbox/container abstraction, reuse it; otherwise implement the local binary mode with the path/env guard from Section 20 and leave container mode as the recommended deployment path where infrastructure supports it.
- **[Assumption] Search/index infrastructure:** knowledge search uses existing search/index infrastructure when available; otherwise a bounded section/keyword index over normalized artifacts is in scope (not a from-scratch vector DB platform).
- **[Assumption] Provider configuration:** LLM provider profiles reuse existing Pao-hubPro provider config; do not create a parallel provider store.
- **[Assumption] Graft availability:** Phase 20.62 may or may not be present; all Graft integration is optional with graceful degradation.

**Reuse existing infrastructure. Do not create duplicate auth, policy, provider, queue, database, audit, config or UI systems when equivalents already exist.**

---

## 9. Target Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       Pao-hubPro UI                         │
│ Repositories │ Knowledge │ C4 │ Jobs │ Policies │ Context   │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              Engineering Knowledge Control Plane            │
│ Repository Registry · Knowledge Source Registry             │
│ Knowledge Job Orchestrator · Policy/Approval Engine         │
│ Snapshot Manager · Artifact/Version Manager                 │
│ Provider Router · Provenance/Audit                          │
└───────────────┬───────────────────────────────┬───────────────┘
                ▼                               ▼
┌──────────────────────────┐      ┌─────────────────────────────┐
│      Litho Adapter       │      │        Graft Adapter        │
│ binary/container runner  │      │ dependency/code graph       │
│ config compiler          │      │ symbol relationships        │
│ output normalizer        │      │ blast radius                │
│ capability detector      │      │ graph export                │
└──────────────┬───────────┘      └─────────────┬───────────────┘
               └───────────────┬────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 Knowledge Compiler Layer                    │
│ Source Map │ C4 Docs │ Module Docs │ Workflows │ DB Docs    │
│ Boundaries │ ADR Links │ Graph Links │ Provenance │ Quality │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  Versioned Knowledge Store                  │
│ manifests │ markdown │ mermaid │ indexes │ context packs    │
└─────────────┬──────────────────────┬─────────────────────────┘
              ▼                      ▼
      ┌───────────────┐      ┌─────────────────┐
      │ MCP Knowledge │      │ REST / Internal │
      │    Gateway    │      │       API       │
      └───────┬───────┘      └─────────────────┘
              ▼
  Codex / ChatGPT / Claude / Local AI / Other Agents
```

---

## 10. Architecture Diagram

```mermaid
flowchart TB
    subgraph CP[Engineering Knowledge Control Plane]
        REG[(Repository Registry)]
        SRC[(Knowledge Source Registry)]
        ORCH[Job Orchestrator]
        POL[Policy / Approval Engine]
        SNAP[Snapshot Manager]
        PROV[Provenance / Audit]
        PR[Provider Router]
    end

    subgraph ENG[Engine Adapters]
        LA[LithoAdapter<br/>binary · config · runner · normalizer]
        GA[Graft Adapter<br/>optional]
    end

    subgraph KC[Knowledge Compiler Layer]
        SM[Source Map]
        C4[C4 Docs]
        MOD[Module Docs]
        WF[Workflows]
        DB[DB Docs]
        BND[Boundaries]
        Q[Quality Service]
    end

    subgraph VS[(Versioned Knowledge Store)]
        MAN[manifest / provenance / quality]
        ART[human/ agent/ diagrams/ graph/ indexes/]
        RAW[litho/raw-output]
    end

    REPO[Git / Local / Workspace Repo] --> REG
    DOCS[Approved External Docs<br/>phase/architecture/adr/api/db] --> SRC
    REG --> SNAP --> LA
    SRC --> LA
    LA --> KC
    GA -.-> KC
    KC --> Q
    Q --> VS
    ORCH --> POL
    POL --> ORCH
    ORCH --> SNAP
    ORCH --> PR
    PR --> LLM[Cloud LLM / Ollama<br/>policy-boundary aware]
    PR --> LA
    LA --> PROV
    VS --> MCPG[MCP Knowledge Gateway]
    VS --> REST[REST API]
    MCPG --> AG[Codex / ChatGPT / Claude / Local AI]
    REST --> DASH[Dashboard — Knowledge]
```

---

## 11. Core Components

| # | Component | Purpose |
|---|---|---|
| 1 | Repository Registry | Normalized record of repositories approved for analysis. |
| 2 | Snapshot Manager | Immutable per-build source snapshot + deterministic fingerprint. |
| 3 | `KnowledgeEngineAdapter` | Stable engine boundary (detect/validate/build/cancel/health). |
| 4 | `LithoAdapter` | Litho-specific implementation (resolver → error classifier). |
| 5 | Execution isolation | Local binary mode or container/sandbox mode with resource limits. |
| 6 | Knowledge Source Registry | Explicitly approved external docs with categories + trust levels. |
| 7 | Provider Router | Pao-hubPro-owned model role mapping + privacy-boundary fallover. |
| 8 | Job Orchestrator | Build lifecycle: policy → snapshot → research → compose → verify → publish. |
| 9 | Knowledge Compiler / Normalizer | Raw Litho output → normalized Pao-hubPro artifacts. |
| 10 | Freshness Service | Deterministic staleness states. |
| 11 | `KnowledgeQualityService` | 11-check quality gate before publish. |
| 12 | Context Pack Compiler | Task-specific, budgeted, provenance-rich agent context. |
| 13 | MCP Knowledge Gateway | 10 scoped `knowledge.*` tools. |
| 14 | REST / Internal API | Repository/build/version/artifact/search/context-pack surfaces. |
| 15 | Dashboard (Knowledge) | Overview, repositories, builds, C4/module/database viewers, sources, policies. |
| 16 | CLI | `knowledge doctor / repo / build / status / versions / context`. |

---

## 12. Component Responsibilities

### 12.1 Repository Registry

Normalized registry for repositories analyzed by Pao-hubPro. Record fields: `id, name, slug, source_type, source_uri, local_path, remote_url, default_branch, visibility, trust_level, owner_scope, analysis_policy_id, created_at, updated_at, last_snapshot_sha, last_knowledge_version_id`.

Supported `source_type` values for Phase 20.65: `local`, `git`, `workspace`. Future: `github_connector`, `archive`, `remote_workspace`.

**Repository registration MUST NOT automatically begin external-LLM analysis unless policy permits it.**

### 12.2 Repository Snapshot Manager

Every knowledge build MUST bind to an immutable source snapshot. For Git repositories, record at minimum: branch, commit SHA, dirty working-tree flag, submodule state if applicable, repository fingerprint, inclusion/exclusion rules.

Recommended fingerprint:

```text
SHA256(
  repo_id
  + commit_sha
  + include_globs
  + exclude_globs
  + relevant_config_hash
  + external_knowledge_manifest_hash
)
```

Dirty working tree default:

```text
interactive/manual job     -> allow with explicit "dirty" provenance
scheduled/CI job           -> deny unless policy explicitly allows dirty snapshots
```

### 12.3 Litho Adapter (stable boundary)

```ts
interface KnowledgeEngineAdapter {
  detectCapabilities(): Promise<KnowledgeEngineCapabilities>;
  validateConfig(input: KnowledgeBuildSpec): Promise<ValidationResult>;
  build(input: KnowledgeBuildSpec): Promise<KnowledgeBuildResult>;
  cancel(jobId: string): Promise<void>;
  health(): Promise<AdapterHealth>;
}
```

Litho-specific composition:

```text
LithoAdapter
├── LithoBinaryResolver
├── LithoVersionDetector
├── LithoCapabilityDetector
├── LithoConfigCompiler
├── LithoSandboxRunner
├── LithoLogParser
├── LithoArtifactCollector
├── LithoOutputNormalizer
└── LithoErrorClassifier
```

Rules: do not import Litho internals deeply into Pao-hubPro core; prefer the CLI/config contract first; pin tested versions; detect capability differences at runtime; persist raw Litho logs separately from normalized knowledge artifacts; never expose raw provider API keys to dashboard responses.

### 12.4 Execution strategy

Two modes:

**Local binary mode** — spawn controlled Litho binary with read-only repository mount, generated `litho.toml`, isolated output directory, restricted environment. Use for trusted local development machines / Codex environments / lightweight installs.

**Container/sandbox mode (recommended for server deployment):**

```text
Pao-hubPro Worker → Ephemeral Litho Sandbox
├── /workspace/repo       read-only
├── /workspace/knowledge  read-only selected docs
├── /workspace/output     writable
├── minimal env
├── controlled network
└── resource limits
```

Recommended controls: CPU limit; RAM limit; wall-clock timeout; output-size limit; process count limit; no Docker socket; no host root mount; no SSH keys; explicit network policy.

### 12.5 External knowledge fusion

Build a Pao-hubPro-managed knowledge-source registry instead of pointing Litho blindly at arbitrary host directories.

Standard categories: `architecture, adr, database, api, deployment, workflow, phase, security, operations, requirements, general`. Pao-hubPro phase documents use category `phase`; selected important architecture Phase files MAY additionally map to `architecture` / `adr`.

Supported source types (minimum): `.md, .txt, .sql, .yaml, .yml, .json`, and `.pdf` when supported by the configured Litho pipeline.

Knowledge source record: `id, repo_id, name, category, source_type, path_or_uri, trust_level, enabled, content_hash, last_indexed_at, allowed_agents, max_bytes, created_at, updated_at`.

Trust levels: `trusted_internal, trusted_vendor, untrusted_external, user_supplied`. `untrusted_external` and `user_supplied` content MUST be wrapped as **reference data**, not executable agent instructions.

### 12.6 Generated knowledge artifact model

Each build produces a `KnowledgeVersion`:

```text
.pao-hub/knowledge/<repo-id>/<version-id>/
├── manifest.json
├── provenance.json
├── quality.json
├── source-map.json
├── human/
│   ├── README.md · system-context.md · architecture.md
│   ├── workflows.md · boundaries.md · database.md · modules/
├── agent/
│   ├── context.md · architecture-context.md
│   ├── module-index.json · workflows.json · boundaries.json · database-context.md
├── diagrams/
│   ├── context.mmd · containers.mmd · components/ · database.mmd
├── graph/
│   ├── graft-manifest.json · crosslinks.json
├── litho/
│   ├── raw-output/ · execution.log · generated-config.toml
└── indexes/
    ├── sections.json · retrieval.json
```

Raw Litho output SHOULD be preserved to aid debugging, but agents SHOULD normally consume normalized Pao-hubPro artifacts.

### 12.7 Knowledge manifest

```json
{
  "schema_version": "1.0",
  "repo_id": "repo_pao_hubpro",
  "knowledge_version": "kv_01...",
  "engine": {"name": "litho", "version": "1.5.0"},
  "source": {"commit_sha": "abc123", "dirty": false, "snapshot_fingerprint": "sha256:..."},
  "provider": {
    "class": "openai_compatible",
    "model_roles": {"efficient": "...", "powerful": "..."}
  },
  "external_knowledge": [
    {"id": "ks_phase_docs", "category": "phase", "content_hash": "sha256:..."}
  ],
  "artifacts": [],
  "quality": {"status": "verified", "warnings": []},
  "created_at": "..."
}
```

**Do not persist secret values in the manifest.**

### 12.8 C4 architecture intelligence

Normalize Litho's architecture output into four logical layers whenever available: `Level 1 System Context · Level 2 Containers · Level 3 Components · Level 4 Code/Module Detail`.

Every generated C4 artifact carries: knowledge version; source snapshot; generator; model/provider class; generation timestamp; confidence/verification status; source links where available.

**A diagram MUST NOT be marked `verified` only because Mermaid syntax parses.** Separate statuses: `generated, syntax_valid, source_crosschecked, verified, warning, failed`.

### 12.9 Database documentation runtime

Enable database analysis when signals exist: `.sql` files; migration folders; schema files; ORM migrations; explicit user setting.

Generated database knowledge includes where detectable: tables, columns, primary keys, foreign keys, constraints, views, procedures/functions, entity relationships, high-level data-flow explanation. **Do not present inferred database relationships as guaranteed facts** — mark provenance: `declared, inferred, external_doc, unknown`.

### 12.10 Generated Litho configuration

Compile a **job-scoped** `litho.toml` rather than editing a global configuration. Conceptual template:

```toml
project_name = "{{PROJECT_NAME}}"
project_path = "/workspace/repo"
output_path = "/workspace/output"
target_language = "en"

# Provider values are injected from the approved provider profile.
# Never write long-lived plaintext credentials into version control.

[knowledge.local_docs]
enabled = true
cache_dir = "/workspace/cache/knowledge/local_docs"
watch_for_changes = false

[knowledge.local_docs.default_chunking]
enabled = true
max_chunk_size = 8000
chunk_overlap = 200
strategy = "semantic"
min_size_for_chunking = 10000

[[knowledge.local_docs.categories]]
name = "architecture"
description = "Approved architecture documentation"
paths = ["/workspace/knowledge/architecture/**/*.md"]

[[knowledge.local_docs.categories]]
name = "phase"
description = "Pao-hubPro implementation phase specifications"
paths = ["/workspace/knowledge/phase/**/*.md"]

[[knowledge.local_docs.categories]]
name = "database"
description = "Database schemas and technical database notes"
paths = ["/workspace/knowledge/database/**/*"]

[[knowledge.local_docs.categories]]
name = "api"
description = "Approved API references"
paths = ["/workspace/knowledge/api/**/*"]
```

The exact keys MUST be generated according to the detected Litho version and validated before execution.

### 12.11 Caching and incremental rebuilds

Higher-level build cache key includes: repository snapshot fingerprint; Litho version; normalized Litho config hash; external knowledge hashes; provider/model role identifiers; prompt/template version; Pao-hubPro normalizer version.

Rebuild modes: `full, changed_sources, external_knowledge_only, verify_only, normalize_only, force`.

If upstream Litho cannot guarantee safe fine-grained incremental regeneration for a particular version, `changed_sources` MAY internally perform a full Litho run while still preserving the Pao-hubPro API contract.

### 12.12 Graft + Litho fusion

A fusion stage runs after both adapters finish:

```text
Litho output (module narratives, workflows, boundaries)
+ Graft graph (symbol nodes, imports, dependencies, impact edges)
  ↓ Knowledge Crosslinker
module A → explanation · source files · dependency node ids · downstream modules · blast-radius link
```

Crosslinks are **additive**: if Graft is unavailable, Litho-only builds must still succeed.

### 12.13 Multi-agent research normalization

Expose Litho's research pipeline as a logical job graph rather than relying on opaque execution state. Normalized research tasks:

```text
System Context Research · Architecture Research · Domain Module Detection
Workflow Research · Boundary Analysis · Key Module Insight
Database Overview Analysis · Documentation Composition
Diagram Validation · Integrity Verification
```

The dashboard MAY display these as stages even if the exact upstream agent naming changes.

### 12.14 Context Pack Compiler

One of the most important deliverables:

```text
Task
  ↓
Context Pack Planner
  ├── system context · relevant modules · relevant workflow
  ├── dependency/blast-radius links · applicable ADRs · selected source pointers
  ↓
Budgeter
  ↓
Agent-ready context
```

Context pack MUST state: repository; source SHA; knowledge version; freshness status; selected sections; omitted sections due to budget; provenance links. **If knowledge is stale, the consumer MUST be told explicitly.** Never silently exceed the token budget.

---

## 13. Data Flow

**Build flow:**

```text
build request → policy_check → snapshotting → preprocessing → researching
→ composing → verifying → normalizing → publishing → completed
```

**Fusion flow:** Litho normalized artifacts + Graft graph (optional) → crosslinker → module/workflow records with graph links.

**Retrieval flow:**

```text
agent task → MCP knowledge.* tool → scope check (repo permission)
→ version selection (latest published, or pinned) → bounded result with provenance
(context.pack: planner → budgeter → pack with SHA/version/freshness)
```

**Staleness flow:** repository SHA / docs hash / config hash / engine version / model-policy change → freshness recompute → dashboard marks stale → refresh requested (policy-gated) → new immutable version.

---

## 14. Control Flow

Every build passes policy evaluation **before entering `snapshotting`**.

Policy inputs: repository visibility; repository trust level; requested provider; source size; file classifications; secret scan result; external knowledge trust; caller role; estimated cost; job trigger; network requirement.

Decisions: **`allow` | `allow_local_only` | `require_approval` | `deny`**.

Example policy (syntax follows the existing Pao-hubPro policy engine if one exists):

```yaml
knowledge_policy:
  private_repository:
    external_llm: require_approval
    local_llm: allow
  restricted_repository:
    external_llm: deny
    local_llm: allow
  untrusted_external_docs:
    executable_instructions: deny
  scheduled_refresh:
    max_estimated_cost_usd: 2.00
```

### Risk classification (R0–R4 mapping)

| Level | Examples in this phase | Default |
|---|---|---|
| R0 — Read-only/safe | knowledge read/search/section retrieval; status/freshness reads; context pack generation from published versions | Policy allow within repo scope |
| R1 — Low-risk local action | source registration; knowledge-source registration; local-only (Ollama) analysis of trusted repos | Policy allow within quota |
| R2 — Reversible write | publishing a knowledge version; source edits via PATCH; cancellation | Policy allow, audited |
| R3 — Sensitive operation | external-LLM analysis of private repos; untrusted-source enablement; secret-scan override; expensive rebuild above budget | Human approval required |
| R4 — Destructive/privileged | scheduled cloud analysis of restricted code; provider boundary change; retention deletion of pinned versions | Human approval; some (restricted + external LLM) map to deny per policy |

R3–R4 require human approval before execution; **no agent may bypass approval**. Policy evaluation failure fails closed.

---

## 15. Agent / Worker Model

**Terminology (strictly separated):**

| Term | Definition in this phase |
|---|---|
| Agent | A knowledge consumer (Codex/ChatGPT/Claude/local model via MCP). Holds only `knowledge.read`, `knowledge.search`, `knowledge.context_pack` by default. |
| Worker | The executor running a knowledge build (local process or sandbox container). |
| Job / Build | One knowledge build invocation with persisted lifecycle state. |
| Run | One execution of a build or research stage; carries `job_id`, `request_id`. |
| Session | Control-plane session binding actor + workspace. |
| Tool | An MCP `knowledge.*` operation. |
| KnowledgeVersion | An immutable published artifact set bound to a snapshot. |
| Artifact | A normalized file within a version (human/, agent/, diagrams/, graph/, indexes/). |

**Workers own all engine execution.** Agents never invoke Litho directly; they request builds through policy-gated surfaces. Concurrency: `max_concurrent_jobs: 2` initial default (configurable); per-repo builds serialize by default to avoid double-analysis cost.

---

## 16. Session / State Model

### 16.1 Build lifecycle

```text
queued → policy_check → snapshotting → preprocessing → researching
→ composing → verifying → normalizing → publishing → completed
```

Failure states: `blocked_policy, failed_snapshot, failed_engine, failed_provider, failed_verification, cancelled, timed_out`.

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> policy_check
    policy_check --> blocked_policy
    policy_check --> awaiting_approval
    awaiting_approval --> snapshotting
    awaiting_approval --> cancelled
    policy_check --> snapshotting
    snapshotting --> failed_snapshot
    snapshotting --> preprocessing
    preprocessing --> researching
    researching --> composing
    researching --> failed_provider
    researching --> failed_engine
    composing --> verifying
    verifying --> failed_verification
    verifying --> normalizing
    normalizing --> publishing
    publishing --> completed
    publishing --> failed_publish
    queued --> cancelled
    researching --> timed_out
```

A failed or cancelled build **must never replace the latest published knowledge version**; partial generated docs MUST NOT be published as latest verified knowledge.

### 16.2 Approval request lifecycle

```text
OPEN → DECIDED(APPROVED | DENIED) | EXPIRED | CANCELLED
```

Approval record: who, what, repo, provider class, reason, expiry, scope, created_at. **Prefer scoped, expiring approvals rather than global permanent bypasses.**

### 16.3 Idempotency

Build submission keyed by `repo_id + snapshot_fingerprint + config_hash + trigger`; a duplicate request while an identical build is queued/running returns the existing build instead of double-spending provider cost.

### 16.4 Retention

```text
published knowledge versions     keep last 10 per repo
failed raw job outputs           7 days
execution logs                   30 days
context packs                    configurable / short lived
provider cost metrics            long-lived aggregate
```

Do not delete a knowledge version referenced by a pinned audit/review workflow.

---

## 17. MCP Integration

Expose repository intelligence to agents through a constrained MCP interface (adapt names to existing MCP conventions):

| Tool | Purpose / obligation |
|---|---|
| `knowledge.repositories.list` | List repositories **visible to the caller** — never reveal out-of-scope repos. |
| `knowledge.repo.status` | Latest knowledge version, freshness, source SHA, build quality, last build status. |
| `knowledge.search` | Bounded snippets with provenance. Input: `{repo_id, query, artifact_types?, max_results?}`. |
| `knowledge.section.get` | Retrieve a specific known section/artifact. |
| `knowledge.architecture.get` | Retrieve a selected C4 level. |
| `knowledge.module.get` | Normalized module knowledge + graph crosslinks if available. |
| `knowledge.workflow.get` | Workflow description and related modules. |
| `knowledge.database.get` | Database overview under repository permissions. |
| `knowledge.context.pack` | Create a bounded context pack: `{repo_id, task, token_budget, include_graph}`. |
| `knowledge.refresh.request` | Request a refresh job — **MUST be policy-gated** (triggers LLM spend + repository processing). |

Read tools require repository read permission; refresh requires build permission plus policy/cost check.

**Response safety rules:** enforce repository scope; limit payload size; include source/version metadata; expose freshness state; avoid returning hidden secrets found during analysis; avoid leaking raw local filesystem paths when unnecessary; prefer repository-relative paths.

---

## 18. Capability & Knowledge Registry

- **Knowledge Source Registry** (Section 12.5): categories, trust levels, per-source `allowed_agents` and `max_bytes`; content hashes drive `stale_docs`.
- **C4 verification registry** (Section 12.8): per-diagram status from `generated` up to `verified` with explicit evidence.
- **Freshness registry** (deterministic states): `fresh, stale_code, stale_docs, stale_config, stale_engine, stale_model_policy, unknown` — e.g. current repo SHA ≠ knowledge manifest SHA ⇒ `stale_code`; external docs hash changed ⇒ `stale_docs`. **The dashboard MUST show staleness prominently.**
- **Quality registry:** `KnowledgeQualityService` runs 11 checks: expected artifact presence; empty-document detection; Mermaid parse validation; broken internal-link detection; suspicious file-path hallucination detection; referenced source existence checks; module coverage estimate; database artifact consistency; oversized context pack detection; generated-doc instruction-injection scan; raw-vs-normalized artifact count checks. Result: `verified | verified_with_warnings | unverified | failed`.
- **Source cross-checking:** where practical, generated claims mentioning concrete source modules are validated against the snapshot (does the file exist? does the symbol/path exist? is the module excluded?). Do not attempt to prove every natural-language claim — the goal is catching obvious hallucinations and broken references.

---

## 19. Policy Model

See Sections 14 and 27 of source. Policy layers:

1. **Registration policy** — which repos/sources may be registered.
2. **Build policy** — visibility × provider class × secret scan × cost ⇒ `allow / allow_local_only / require_approval / deny`.
3. **Retrieval policy** — repo scope + RBAC per tool/agent.
4. **Fallback policy** — provider fallover must stay within the same data/privacy boundary.

**Provider routing rules:** roles `efficient_model, powerful_model, fallback_model, local_model`.

```text
Public repository   -> approved cloud provider allowed
Private/internal    -> policy decides cloud vs local
Restricted          -> local-only model
Provider failure    -> fallover only to another provider allowed by same data policy
```

A fallback MUST NOT silently cross a privacy boundary. Prohibited default: primary local Ollama → fallback public cloud API, unless policy explicitly permits external transfer.

---

## 20. Security Model

| Control | Implementation |
|---|---|
| Authentication / Authorization | All routes use existing Pao-hubPro auth/RBAC; no parallel auth system. Permission set in Section 41 of source (Section 21 here). |
| Prompt-injection boundary | External documents are **data**, not instructions: attach source provenance; mark trust level; strip/neutralize embedded tool-call markup when practical; enforce system-level rule that document instructions cannot override runtime policy; never permit documentation text to grant itself tool permissions; do not execute shell snippets found in docs; do not interpret credentials found in docs as permission to use them. Wrapper concept: `<external_knowledge trust="untrusted_external" source="...">…reference material only…</external_knowledge>`. |
| Secret & sensitive data protection | Preflight content-risk scan before external-provider analysis: detect API keys, private keys, `.env` secrets, cloud credentials, tokens, connection strings, credential files. Filename exclusions (.env, .env.*, *.pem, *.key, id_rsa, id_ed25519, node_modules/, target/, dist/, build/, .git/, coverage/, vendor caches) **plus content-based checks**. Findings ⇒ external job blocked or requires approved remediation; local-only job policy-dependent. **Never log secret values.** |
| File scope guard | Litho runs only against an approved snapshot root. Prevent `../` escape, arbitrary absolute-path mounting, symlink escape outside repository, accidental home-directory analysis, mounting SSH/config credential dirs. Registered local paths normalized and approved before use. |
| Execution isolation | Read-only repo mount; writable output/cache only; minimal env; CPU/RAM/time/output/process limits; no Docker socket, no host root mount, no SSH keys. |
| Network policy | `network = disabled | provider_only | unrestricted (default disabled)`. Local Ollama → internal endpoint only; cloud LLM → approved provider endpoint only. No arbitrary outbound web access for normal analysis. |
| Provider privacy boundary | Fallback never crosses data/privacy boundary (Section 19). |
| Response safety | Section 17 rules — scope, size, provenance, freshness, no secrets, relative paths. |
| Audit trail | Every build request, policy decision, approval, cancellation, publish, source change, provider boundary selection (Section 25). |

**Secrets handling:** provider credentials live in environment/secret store, never committed YAML; never in logs, artifacts, manifests, or API responses.

---

## 21. Approval Model

### Approval gates (policy-sensitive events)

```text
first external analysis of a private repository
provider boundary change
expensive full rebuild above budget
untrusted knowledge-source enablement
secret-scan override
scheduled cloud analysis of restricted code
```

### Mechanics

- Lifecycle: `OPEN → DECIDED(APPROVED | DENIED) | EXPIRED | CANCELLED` (Section 16.2).
- Scoped + expiring; approval covers the specific repo × provider class × action — never a global bypass.
- Audit event recorded on request and decision; R3–R4 mapping in Section 14.
- Agents cannot self-approve; approval state is checked server-side in the orchestrator.

---

## 22. Failure Handling

### Error classification (normalized)

```text
LITHO_NOT_INSTALLED · LITHO_VERSION_UNSUPPORTED · LITHO_CONFIG_INVALID
REPOSITORY_NOT_FOUND · REPOSITORY_SCOPE_DENIED · SNAPSHOT_FAILED
SECRET_SCAN_BLOCKED · POLICY_DENIED · APPROVAL_REQUIRED
PROVIDER_AUTH_FAILED · PROVIDER_RATE_LIMITED · PROVIDER_UNAVAILABLE
MODEL_OUTPUT_INVALID · LITHO_PROCESS_FAILED · LITHO_TIMEOUT
OUTPUT_MISSING · OUTPUT_INVALID · MERMAID_INVALID
QUALITY_GATE_FAILED · PUBLISH_FAILED · CANCELLED
```

UI presents human-readable recovery guidance per class.

### Failure handling table

| Failure | Detection | Containment | Retry | Audit |
|---|---|---|---|---|
| Litho missing / unsupported version | Version detection | Build fails `LITHO_NOT_INSTALLED`/`LITHO_VERSION_UNSUPPORTED`; runtime degrades to "engine unavailable" | No auto-retry (deterministic) | build failed event |
| Snapshot failure | Snapshot step error | `failed_snapshot`; no analysis runs | No auto-retry on path errors; transient FS errors bounded | event |
| Secret findings | Preflight scan | External job `SECRET_SCAN_BLOCKED`; local job policy-dependent | No auto-retry; remediation flow | scan result event (no values) |
| Policy denial | Policy engine | `blocked_policy` | No retry | policy denial event |
| Provider auth/rate-limit/unavailable | Provider API | `failed_provider`; stage-aware | **Safe to retry:** transient timeout, rate limit with bounded backoff, temporary network errors | provider events |
| Invalid model structured output | Deserialization | `MODEL_OUTPUT_INVALID`; Litho lenient recovery attempted; else fail stage | Bounded, stage-aware | event |
| Litho process failure / timeout | Process exit / deadline | `LITHO_PROCESS_FAILED`/`LITHO_TIMEOUT`; child process terminated; workspace cleaned | No infinite retry | event |
| Output missing/invalid / Mermaid invalid | Collector + validator | `failed_verification` via quality gate | No auto-retry | quality event |
| Quality gate failure | `KnowledgeQualityService` | Version not published; previous latest preserved | Fix inputs, rebuild | quality event |
| Publish failure | Store write | `PUBLISH_FAILED`; partial artifacts cleaned per retention | Bounded | event |
| Budget exceeded | Cost tracker | warn / require_approval / stop per config | After approval or window reset | cost event |

**Do not blindly retry:** policy denial, invalid repository path, unsupported Litho version, secret-scan block, deterministic config error, budget exceeded. All automatic retries use exponential backoff with a max attempt limit — no unlimited retry.

---

## 23. Recovery Model

- **Crash recovery:** build state persisted per stage; a dead worker's build is re-adopted or failed cleanly; no ambiguous "running forever" states (wall-clock timeouts enforce this).
- **Cancellation flow:** user/API cancel → job `cancelling` → terminate Litho child process/sandbox → collect partial logs → cleanup temporary workspace → job `cancelled`. Partial docs never published.
- **Version rollback:** published versions are immutable; consumers read any retained version; latest pointer only moves on a successful publish.
- **Degraded operation:** if Litho is unavailable, the subsystem degrades to "knowledge engine unavailable" — registry, sources, retrieval of existing versions, staleness marking, dashboard all continue; Pao-hubPro core MCP hub operation is unaffected.
- **Config recovery:** invalid configuration fails fast with clear errors; no silent security fallback.
- **Retention recovery:** pinned/audit-referenced versions exempt from retention deletion.

---

## 24. Observability

### Metrics

```text
knowledge_build_total
knowledge_build_duration_seconds
knowledge_build_failure_total
knowledge_build_queue_depth
knowledge_artifact_total
knowledge_artifact_bytes
knowledge_quality_warning_total
knowledge_stale_repo_total
knowledge_provider_request_total
knowledge_provider_retry_total
knowledge_cache_hit_total
knowledge_context_pack_total
knowledge_context_pack_tokens
knowledge_policy_denial_total
```

### Structured logs

Every log line includes when applicable: `request_id, job_id, repo_id, knowledge_version, engine, engine_version, stage, provider_class`. **Never include API keys or source file contents by default.**

### Tracing spans

```text
knowledge.build · knowledge.policy_check · knowledge.snapshot · knowledge.secret_scan
litho.execute · litho.research · litho.compose
knowledge.verify · knowledge.normalize · knowledge.publish · knowledge.context_pack
```

### Cost observability

Per build track (when provider data available): input tokens; output tokens; provider requests; retry count; model roles used; estimated cost; cache hits; cache misses. Budgets: `per_job, per_repo_daily, per_repo_monthly, workspace_daily`. Limit responses: `warn, require_approval, stop`.

---

## 25. Audit

Every significant activity records WHO / WHAT / WHEN / WHERE / WHY / RESULT.

`knowledge_audit_events` fields: `id, actor_type, actor_id, action, repo_id, build_id, provider_class, policy_decision, metadata_json, created_at`.

Audited actions: build request; policy decision; approval (request + decision); cancellation; publish; source registration/change; provider boundary selection; secret-scan outcome (no values).

**Never place raw provider credentials or discovered secret values in audit metadata.** Audit log separated from application debug logs.

---

## 26. Data Model

Use the project's existing database technology and migration conventions.

Logical tables/entities:

```text
knowledge_repositories
knowledge_sources
knowledge_builds
knowledge_versions
knowledge_artifacts
knowledge_quality_results
knowledge_policies
knowledge_provider_profiles
knowledge_audit_events
knowledge_context_packs
knowledge_graph_links
```

### `knowledge_builds`

```text
id · repo_id · requested_by · trigger_type · status
snapshot_sha · snapshot_fingerprint · engine_name · engine_version
provider_profile_id · config_hash · started_at · completed_at
error_code · error_summary · created_at
```

### `knowledge_versions`

```text
id · repo_id · build_id · version_number · manifest_path · source_sha
freshness · quality_status · published_at · created_at
```

### `knowledge_artifacts`

```text
id · knowledge_version_id · artifact_type · title · relative_path
content_hash · mime_type · source_map_path · size_bytes · created_at
```

### `knowledge_audit_events`

```text
id · actor_type · actor_id · action · repo_id · build_id
provider_class · policy_decision · metadata_json · created_at
```

`knowledge_policies` and `knowledge_provider_profiles` are optional if Pao-hubPro already has equivalent global models — **do not duplicate global provider/policy tables.**

---

## 27. API / Event Contracts

### 27.1 REST / internal API

```text
GET    /api/knowledge/repositories
POST   /api/knowledge/repositories
GET    /api/knowledge/repositories/:repoId
GET    /api/knowledge/repositories/:repoId/status

POST   /api/knowledge/repositories/:repoId/builds
GET    /api/knowledge/builds/:buildId
POST   /api/knowledge/builds/:buildId/cancel
GET    /api/knowledge/builds/:buildId/logs

GET    /api/knowledge/repositories/:repoId/versions
GET    /api/knowledge/versions/:versionId
GET    /api/knowledge/versions/:versionId/artifacts

POST   /api/knowledge/search
POST   /api/knowledge/context-pack

GET    /api/knowledge/repositories/:repoId/sources
POST   /api/knowledge/repositories/:repoId/sources
PATCH  /api/knowledge/sources/:sourceId
DELETE /api/knowledge/sources/:sourceId

GET    /api/knowledge/policies
POST   /api/knowledge/policies/validate
```

All routes use the existing Pao-hubPro auth/RBAC mechanism. Do not create a parallel server or auth system.

### 27.2 Common envelope

```json
{
  "request_id": "req_...",
  "session_id": "sess_...",
  "actor_id": "agt_... | usr_...",
  "operation": "knowledge.context.pack",
  "input": {},
  "status": "ALLOWED | DENIED | REQUIRE_APPROVAL | COMPLETED | FAILED",
  "result": {},
  "error": {"code": "SECRET_SCAN_BLOCKED", "message": "redacted user-facing message"},
  "created_at": "2026-09-17T00:00:00Z"
}
```

Knowledge results additionally carry: `repo_id`, `knowledge_version`, `source_sha`, `freshness`, `quality_status`, `provenance` links.

### 27.3 Event contract

Audit events follow `knowledge_audit_events` schema (Section 25) appended to the existing audit/event store; job-stage transitions are persisted on `knowledge_builds` and emit trace spans (Section 24).

---

## 28. Configuration

```yaml
knowledge:
  enabled: true

  engine:
    default: litho
    litho:
      executable: deepwiki-rs
      min_version: "1.5.0"
      execution_mode: sandbox
      timeout_seconds: 3600

  storage:
    root: .pao-hub/knowledge

  build:
    max_concurrent_jobs: 2
    max_repo_bytes: 1073741824
    default_language: en

  policy:
    require_approval_private_cloud: true
    block_external_on_secret_findings: true

  quality:
    require_mermaid_valid: true
    require_source_crosscheck: true

  context_pack:
    default_token_budget: 12000
    max_token_budget: 50000
```

**Environment variables carry secrets, not committed YAML.** Validate configuration at startup; fail fast on invalid values; security-relevant settings (provider boundary, secret blocking) never silently fall back.

---

## 29. Feature Flags

Minimum flag set (adapt names to project conventions):

| Flag | Default | Gates |
|---|---|---|
| `KNOWLEDGE_RUNTIME_ENABLED` | `false` at first deploy (enable deliberately after doctor passes); `true` per source config intent once verified | Whole subsystem; disabled mode leaves published artifacts readable and core MCP hub unaffected |
| `KNOWLEDGE_EXTERNAL_LLM_ENABLED` | `false` | Any external (cloud) provider use; local Ollama unaffected |
| `KNOWLEDGE_SCHEDULED_TRIGGERS_ENABLED` | `false` | Scheduled/CI/post-merge automatic builds |
| `KNOWLEDGE_GRAF_FUSION_ENABLED` | `true` when Graft detected | Graft crosslinking (optional, degrades cleanly) |
| `KNOWLEDGE_UNTRUSTED_SOURCES_ENABLED` | `false` | Enabling `untrusted_external` / `user_supplied` sources |
| `KNOWLEDGE_CONTEXT_PACKS_ENABLED` | `true` | Context pack compiler |

> **Default-posture note (decision recorded):** the source configuration example sets `enabled: true`; per the master request's conservative-default rule, the *runtime* flag ships `false` and is enabled deliberately after `knowledge doctor` passes, while the genuinely risky paths (external LLM, scheduled automation, untrusted sources) default off regardless. Disabling must never delete knowledge history.

---

## 30. Repository / Module Structure

**Codex MUST adapt to actual Pao-hubPro repository conventions rather than forcing this literally.**

```text
src/
├── knowledge/
│   ├── domain/
│   │   ├── repository.ts
│   │   ├── build.ts
│   │   ├── artifact.ts
│   │   ├── version.ts
│   │   ├── source.ts
│   │   └── policy.ts
│   ├── application/
│   │   ├── knowledge-build.service.ts
│   │   ├── context-pack.service.ts
│   │   ├── quality.service.ts
│   │   ├── freshness.service.ts
│   │   └── knowledge-search.service.ts
│   ├── adapters/
│   │   ├── litho/
│   │   │   ├── litho.adapter.ts
│   │   │   ├── litho.runner.ts
│   │   │   ├── litho.config.ts
│   │   │   ├── litho.capabilities.ts
│   │   │   ├── litho.normalizer.ts
│   │   │   └── litho.errors.ts
│   │   └── graft/
│   │       └── graft-knowledge.adapter.ts
│   ├── infrastructure/
│   │   ├── snapshot/
│   │   ├── storage/
│   │   ├── sandbox/
│   │   ├── secret-scan/
│   │   └── persistence/
│   ├── api/
│   ├── mcp/
│   └── ui/
└── ...existing project structure
```

Keep future engine adapters behind the same abstraction:

```ts
KnowledgeEngineAdapter
├── LithoAdapter
├── TerrainAdapter      // future
├── GraftNarrativeAdapter
├── StaticAnalyzerAdapter
└── FutureAdapter
```

---

## 31. Dashboard Integration

Add top-level **Knowledge** navigation. Pages:

```text
Knowledge Overview · Repositories · Repository Detail · Build History
Knowledge Viewer · C4 Explorer · Module Explorer · Workflow Explorer
Database Explorer · External Knowledge Sources · Policies · Provider Profiles
```

**Repository Detail** example:

```text
Repository: Pao-hubPro
Branch: main
Source SHA: abc123
Knowledge: STALE_CODE
Last build: 18 min ago
Engine: Litho 1.5.0
Quality: Verified with warnings
Provider: Local / Cloud class
```

Actions: Refresh Knowledge · Build Full · Verify Only · Generate Context Pack · View C4 · View Modules · View Build Log.

Sensitive controls hidden/disabled per RBAC; staleness displayed prominently; no secrets rendered.

---

## 32. Dependencies

### Required

- **Pao-hubPro core control plane:** auth/RBAC, policy engine (or seam), audit log, typed config/flags, persistence + migrations, structured logging/telemetry, job queue (or minimal DB-backed queue), artifact/file storage.
- **Litho binary/container** (`deepwiki-rs`, min version compatible with v1.5.0 behavior) for *new* analysis; not required for retrieval of existing versions.

### Recommended

- **Phase 20.62 Graft** — crosslinks/blast-radius fusion (optional adapter; Litho-only builds fully usable without it).
- **Phase 20.53 OpenViking** — publish context classes through a stable export contract.
- **Existing provider config** — LLM provider profiles (cloud + local Ollama).
- **Existing sandbox/container runtime** — preferred for server deployment.
- **Existing search/index infrastructure** — for knowledge search.

### Optional

- **Phase 20.63 Public APIs** — attach trusted `api` docs to jobs.
- **Phase 20.64 vGPU** — not required; future visualization only.

**Do not assume other phases are implemented.** Standalone path: with only local mode + Ollama (or no provider at all for verify/normalize-only operations), the subsystem registers repos, runs builds, publishes versions, serves retrieval, and marks staleness — cloud providers are a policy-gated enhancement, not a requirement.

---

## 33. Compatibility

- **Git remains source of truth.** Generated knowledge is a versioned interpretation; conflicts are surfaced, never silently resolved by docs.
- **Upstream compatibility record** (persist per release): verified Litho version(s); capability differences from v1.5.0 baseline; config keys generated; license evidence.
- **Version detection:** adapter validates Litho version/capabilities per job; unsupported versions fail with `LITHO_VERSION_UNSUPPORTED`, never misbehave silently.
- **Backward compatibility:** existing Pao-hubPro operations unaffected when `KNOWLEDGE_RUNTIME_ENABLED=false`; Graft operates independently of knowledge-runtime flags.
- **Provider-agnostic:** no hard dependency on a single LLM provider; local-only operation supported.

---

## 34. Migration

- Codex MUST create migrations using the existing migration framework.
- Minimum entities: `knowledge_repositories, knowledge_sources, knowledge_builds, knowledge_versions, knowledge_artifacts, knowledge_quality_results, knowledge_audit_events`.
- Optional (if not already represented globally): `knowledge_policies, knowledge_provider_profiles`.
- Additive only; no destructive changes to unrelated tables; down/rollback guidance when supported.
- Migrations may land with the runtime flag off; storage root (`.pao-hub/knowledge`) created lazily on first build.

---

## 35. Rollback

Feature flag: `KNOWLEDGE_RUNTIME_ENABLED=false`.

Rollback MUST: stop new jobs; cancel active jobs if necessary; leave existing published artifacts readable; not delete knowledge history; not break Graft independently; not affect core Pao-hubPro MCP hub operation.

Litho adapter failures degrade gracefully to `knowledge engine unavailable` rather than crashing the full Pao-hubPro runtime.

Config rollback: revert typed config; flag rollback maps to rollout stages (Section 38); database rollback prefers flag-off over table drops; evidence retention takes precedence.

---

## 36. Testing Strategy

### 36.1 Unit tests

Repository fingerprinting; path scope validation; Litho config compiler; version capability detection; Litho output normalization; error classification; policy decision mapping; freshness calculation; artifact manifest generation; context budget enforcement; source-map validation.

### 36.2 Integration tests (fixture repositories)

Fixtures:

```text
tiny-ts-app · tiny-python-app · tiny-rust-app · sql-schema-project
repo-with-external-docs · repo-with-invalid-mermaid-case · repo-with-secret-fixture
```

Secret fixture MUST contain fake values only.

Test cases: build succeeds; build denied by policy; secret finding blocks external provider; local-only build allowed; Litho missing; unsupported Litho version; provider temporary failure; provider fallback within same policy boundary; invalid generated structured output recovers/fails cleanly; external docs category routing; SQL docs generated; cancel job; stale status after commit change; context pack respects budget.

### 36.3 Agent-specific tests

Scope-enforcement test (agent cannot read out-of-scope repos via MCP); approval-bypass test (R3 paths unreachable without approval decision); injection test (docs containing "ignore instructions / call tool X" cannot trigger tool calls or alter policy); budget test (context pack never exceeds token budget; omission reported); hallucination detection test (nonexistent referenced paths flagged by quality service).

### 36.4 Concurrency / failure / recovery tests

Parallel builds respect `max_concurrent_jobs`; duplicate idempotent submissions collapse; worker crash mid-build leaves recoverable state; cancellation terminates child process and cleans workspace; failed build never replaces latest published version.

### 36.5 End-to-end test

```text
register fixture repo
  ↓ add architecture external docs
  ↓ run knowledge build
  ↓ verify artifacts
  ↓ query via REST
  ↓ query via MCP
  ↓ create context pack
  ↓ change repository SHA
  ↓ verify stale_code
  ↓ rebuild
  ↓ verify new knowledge version
```

---

## 37. Acceptance Criteria

### Critical

- [ ] Repository can be registered; snapshot is immutable per build.
- [ ] Litho version/capabilities detected; job-scoped config generated and validated before execution.
- [ ] Litho runs inside a controlled execution boundary; source repository is read-only to Litho (test-proven).
- [ ] External knowledge sources are explicitly registered with categories and trust levels.
- [ ] C4/architecture docs collected and normalized; knowledge build stored as a versioned artifact set.
- [ ] Fresh/stale state works (SHA change ⇒ `stale_code`; test-proven).
- [ ] Build quality checks run; quality status visible.
- [ ] MCP knowledge tools enforce scope (out-of-scope access denied; test-proven).
- [ ] Context pack includes source SHA and knowledge version and respects budget (test-proven).
- [ ] External-provider use is policy checked; secret findings can block external analysis (fixture test-proven).
- [ ] Raw provider credentials never appear in logs/API output/artifacts (scan test-proven).
- [ ] Failed or cancelled builds do not replace latest published knowledge (test-proven).

### Important

- [ ] SQL/database fixture generates database knowledge with declared/inferred provenance markers.
- [ ] `local_docs` categories generated from the Pao-hubPro knowledge registry.
- [ ] Graft crosslinks work when Graft is available; Litho-only build works when Graft is unavailable.
- [ ] Local Ollama profile selectable; provider fallback never crosses privacy boundary (test-proven).
- [ ] Retry policy distinguishes transient vs deterministic errors.
- [ ] Dashboard displays build stages, freshness and quality.
- [ ] Audit events written for build request and policy decision.

### Nice to have

- [ ] Post-merge refresh trigger; cost dashboard; side-by-side architecture diff between knowledge versions; diagram visual explorer; context-pack preview/token estimator.

---

## 38. Implementation Roadmap

| Stage | Content | Exit condition |
|---|---|---|
| Stage 0 — Discovery | Repository inspection; upstream Litho version/license verification | Inspection summary; integration points mapped |
| Stage 1 — Foundation (Milestone A) | Domain models, migrations, repository registry, snapshot service, storage layout | Registry + snapshot + fingerprint working |
| Stage 2 — Engine (Milestone B) | Litho adapter: binary resolver, version detection, capabilities, config compiler, process runner, cancellation, log capture | Fixture build completes in controlled boundary |
| Stage 3 — Security & Policy (Milestone C) | Path guard, secret scan, provider boundary policy, approval gate integration | Security suite green; fail-closed proven |
| Stage 4 — Artifact Pipeline (Milestone D) | Raw output collection, normalization, manifest, source map, freshness, quality checks | Versioned publish with quality gate |
| Stage 5 — External Knowledge (Milestone E) | Source registry, category mapping, safe staging, generated `local_docs` config | Category routing verified |
| Stage 6 — Retrieval (Milestone F) | Knowledge search, section retrieval, context pack compiler | Bounded, provenance-rich packs |
| Stage 7 — MCP + API (Milestone G) | REST endpoints, MCP tools, RBAC, audit | All 10 MCP tools scoped + audited |
| Stage 8 — Graft Fusion + UI (Milestones H + I) | Optional graph adapter, crosslinks; dashboard pages | Fusion additive; UI complete |
| Stage 9 — Production Hardening (Milestone J) | Integration/e2e tests, timeouts, retries, retention, metrics, docs, doctor/CLI | Acceptance checklist passes |

### Rollout plan

| Rollout stage | Configuration |
|---|---|
| Stage 1 — Local development only | execution: local/sandbox; provider: local Ollama or explicit dev provider; trigger: manual only; repo: Pao-hubPro test fixture |
| Stage 2 — Pao-hubPro repository | manual build; selected Phase docs; Graft optional; full quality checks |
| Stage 3 — Multiple registered repositories | add RBAC, policy profiles, artifact retention, context packs |
| Stage 4 — Controlled automation | post-merge stale marking; scheduled refresh; CI integration |

**Do NOT enable automatic cloud analysis by default.** Recommended initial defaults: `manual = enabled, scheduled = disabled, post-merge = disabled`; enable repository-specific automation after stable operation.

**Refresh strategy:** small commit → mark stale → do not rebuild immediately → batch after merge / explicit refresh. Architecture-affecting merge → queue refresh → policy check → build → quality check → publish new version. Avoid spending tokens on every trivial commit.

**Build triggers:** manual, API, MCP request, post-merge webhook, scheduled, CI.

---

## 39. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Prompt injection via imported docs | Policy/tool manipulation | Trust wrapping, injection scan in quality gate, system-level boundary rules (Section 20) |
| Private source sent to cloud LLM | Data exposure | Policy engine + approval gates + secret preflight; restricted repos local-only |
| Secret leakage via repository content | Credential compromise | Content-based preflight scan; external job blocked on findings; no secret logging |
| Provider fallback crossing privacy boundary | Unapproved data transfer | Fallback constrained to same policy boundary; test-proven |
| Path escape / over-broad mounts | Host exposure | File scope guard; canonicalization; sandbox mount rules |
| Generated docs drift from reality | Wrong agent decisions | Immutable snapshot binding; freshness states; staleness surfaced to consumers |
| Hallucinated architecture claims | Misleading context | Quality service; source cross-checking; verification statuses below `verified` |
| Upstream Litho breaking changes | Build breakage | Version pinning + capability detection + `LITHO_VERSION_UNSUPPORTED` |
| Cost explosion (LLM spend) | Budget damage | Cost tracking, budgets, warn/approve/stop responses, batched refresh |
| Litho absent/unavailable | No new knowledge | Graceful degradation; retrieval of existing versions unaffected |
| Partial build published as verified | False confidence | Publish only after quality gate; failed/cancelled builds never replace latest |

---

## 40. Security Checklist

- [ ] Repository read-only during analysis; output/cache the only writable paths (sandbox rules).
- [ ] Path escape (`..`, absolute mounts, symlink escape, home-dir/SSH-dir mounts) blocked and tested.
- [ ] Secret preflight scan before external transfer; content-based, not filename-only; findings block or require approved remediation.
- [ ] Discovered secret values never logged or audited.
- [ ] Provider credentials only via env/secret store; never in committed YAML, logs, manifests, artifacts, or API responses.
- [ ] External docs wrapped as reference data; injection payloads cannot trigger tools or override policy (tested).
- [ ] Fallback never crosses privacy boundary without explicit policy (tested).
- [ ] Network modes enforced: disabled / provider_only / unrestricted(default-off).
- [ ] MCP responses scope-enforced, size-bounded, provenance-carrying, secret-free, repo-relative paths.
- [ ] Approval scoped + expiring; agents cannot self-approve; R3/R4 paths gated server-side (tested).
- [ ] Audit events recorded for build/policy/approval/publish/source/provider-boundary actions; credential-free.
- [ ] Config fails fast; no silent security fallback.

---

## 41. Production Readiness Checklist

### `knowledge doctor` (Pao-hubPro diagnostic)

```bash
pao-hub knowledge doctor
```

Expected checks:

```text
[OK] database reachable
[OK] knowledge storage writable
[OK] Litho executable found
[OK] Litho version supported
[OK] sandbox available
[OK] provider profile configured
[OK] local model reachable (if configured)
[OK] Mermaid validator available
[OK] Graft adapter optional/not configured
```

Additional CLI commands (naming follows existing Pao-hubPro conventions):

```bash
pao-hub knowledge repo add <path>
pao-hub knowledge repo list
pao-hub knowledge build <repo>
pao-hub knowledge status <repo>
pao-hub knowledge versions <repo>
pao-hub knowledge context <repo> --task "..."
```

### Quality gates before declaring completion

1. formatter; 2. linter; 3. typecheck; 4. unit tests; 5. integration tests; 6. e2e flow; 7. build; 8. migration review; 9. git diff review; 10. secret scan of the change set itself; 11. feature-flag default verification; 12. rollback (flag-off) verification; 13. no unrelated regressions.

**Do not claim a check passed unless it was actually run; report blocked checks with exact reasons. Do not leave critical-path TODO stubs.**

### Documentation deliverables

Developer/operator docs covering: installation; Litho requirements; provider configuration; security boundary; policy; external knowledge; troubleshooting; rollback. Adapt paths to repository conventions.

---

## 42. Future Extensions

Keep stable interfaces for future engines (Section 30 adapter hierarchy). Potential future capabilities — implement only if they naturally fit existing abstractions:

- Terrain living-context sync; architecture drift diffing.
- PR-specific knowledge previews; code-review context generation.
- Documentation confidence scoring.
- Multi-repository architecture maps; organization-level dependency maps.
- Autonomous ADR draft suggestions; release-note context generation; incident-context packs.

---

## 43. Definition of Done

A repository owner can perform the following end-to-end workflow:

```text
1. Register repository
2. Select approved provider profile
3. Attach Phase/architecture/database docs
4. Run policy preflight
5. Approve if required
6. Start Litho analysis
7. Watch job stages
8. Receive normalized C4 + repository docs
9. Pass knowledge quality gate
10. Publish immutable knowledge version
11. Ask Codex/agent for task context through MCP
12. Receive a bounded context pack with provenance
13. Change repository
14. Pao-hubPro marks old knowledge stale
15. Rebuild and publish a new version
```

No manual copying of generated wiki text into an agent prompt should be required.

---

## 44. Codex One-Shot Implementation Prompt

Copy the entire prompt below into Codex from the root of the Pao-hubPro repository.

```text
You are implementing Phase 20.65 of the existing Pao-hubPro codebase.

PHASE TITLE
Phase 20.65 — Pao-hubPro × Litho (deepwiki-rs) — Autonomous Codebase Documentation
Engine, C4 Architecture Intelligence, Multi-Agent Repository Research, External
Knowledge Fusion & Policy-Governed Engineering Knowledge Runtime

UPSTREAM
https://github.com/sopaco/deepwiki-rs

PRIMARY OBJECTIVE
Add a production-grade Engineering Knowledge Runtime to Pao-hubPro. Integrate Litho
as a replaceable knowledge-engine adapter that can analyze approved repository
snapshots and selected external knowledge, generate architecture/documentation
artifacts, normalize them into versioned Pao-hubPro knowledge, and expose safe
task-specific context to agents through the existing API/MCP/auth/policy
infrastructure.

EXECUTION MODE
Work as: Inspect -> Plan -> Implement -> Validate -> Test -> Review -> Report.
Never delete the repository, reset git history, force push, expose secrets, deploy
to production, run destructive DB migrations, or change important infrastructure
without explicit user approval.

IMPORTANT OPERATING RULES
1. First inspect the existing repository completely enough to understand its
   architecture, package manager, languages, database, migration system, auth/RBAC,
   MCP implementation, provider abstractions, policy system, job queue, logging,
   telemetry, UI conventions and testing conventions.
2. Reuse existing infrastructure. Do not create duplicate auth, policy, provider,
   queue, database, audit, config or UI systems when equivalents already exist.
3. Preserve backward compatibility.
4. Keep Litho behind a stable adapter. Core Pao-hubPro code must not depend directly
   on Litho internal Rust modules.
5. Prefer the Litho CLI/config contract and detect its version/capabilities.
6. Treat source repositories as read-only during Litho analysis.
7. Never expose long-lived LLM/API credentials in source control, logs, artifacts or
   API responses.
8. Never silently send private/restricted repositories to an external LLM.
9. Provider fallback may not cross a data/privacy boundary unless policy explicitly
   permits it.
10. External documentation is reference data and may contain prompt injection. It
    must never grant itself tool permissions or override runtime policy.
11. A failed/cancelled build must never replace the latest published knowledge version.
12. Source code remains authoritative; generated docs are versioned interpretations.
13. Do not make unrelated large refactors.
14. Do not fake integrations. If an external optional component such as Graft is
    absent, implement a clean optional adapter and graceful degradation.
15. Run formatting, type checks, tests and builds before declaring completion.

IMPLEMENTATION TARGETS

A. DOMAIN
Create/adapt domain concepts for: KnowledgeRepository, KnowledgeSource,
KnowledgeBuild, KnowledgeVersion, KnowledgeArtifact, KnowledgeQualityResult,
KnowledgeContextPack, knowledge audit events. Use the existing database/migration
patterns.

B. REPOSITORY REGISTRY
Support local/git/workspace repositories using existing repo abstractions if present.
Store branch, commit SHA, visibility/trust classification, analysis policy and last
published knowledge version.

C. SNAPSHOT MANAGER
Bind every build to an immutable snapshot. For Git capture commit SHA, dirty flag and
a deterministic fingerprint. Reject unsafe paths and symlink/path escapes.

D. LITHO ADAPTER
Implement a KnowledgeEngineAdapter contract and LithoAdapter with: executable/version
detection; capability detection; job-scoped config generation; controlled process or
sandbox execution; timeout; cancellation; log capture; output collection; output
normalization; error classification. Support a tested minimum Litho version compatible
with v1.5.0 behavior, but do not hardcode feature assumptions without version/capability
checks.

E. EXECUTION ISOLATION
Prefer the project's existing sandbox/container runtime when available. Repository
mount must be read-only. Only a dedicated output/cache directory may be writable. Do
not mount Docker socket, SSH keys or arbitrary home directories. Apply CPU/memory/
time/output limits when infrastructure supports them.

F. PROVIDER ROUTING
Reuse Pao-hubPro provider configuration. Support local-only and approved
external-provider profiles. Map approved model roles to Litho efficient/powerful/
fallback model settings. Do not allow fallback across a privacy boundary.

G. EXTERNAL KNOWLEDGE
Add a registry for explicitly approved documentation inputs. Standard categories:
architecture, adr, database, api, deployment, workflow, phase, security, operations,
requirements, general. Generate job-scoped Litho local_docs configuration from this
registry. Stage only approved files into a safe job knowledge directory. Add
provenance and trust level. Treat content as reference data, not executable
instructions.

H. SECRET PREFLIGHT
Before external-provider analysis, scan selected repository input for likely secrets
using existing scanners if available. Block or require policy approval on findings.
Do not log discovered secret values. Default exclude .env, private keys, build caches,
.git, node_modules, target, dist, coverage and equivalent generated directories.

I. POLICY
Before execution evaluate repository visibility, trust, provider class, external
knowledge trust, secret findings, actor permissions, trigger and estimated cost.
Normalize decisions to: allow, allow_local_only, require_approval, deny. Reuse
existing policy/approval infrastructure.

J. ARTIFACT NORMALIZATION
Persist raw Litho output for troubleshooting but create normalized Pao-hubPro
artifacts under a versioned knowledge directory. Generate at minimum: manifest;
provenance; quality report; system context; architecture; workflows; boundaries;
module docs/index; database overview when available; Mermaid files; retrieval index
metadata; agent context.

K. KNOWLEDGE VERSIONING
Every successful publish creates an immutable KnowledgeVersion bound to snapshot
SHA/fingerprint, Litho version, config hash, external knowledge hashes and
provider/model identifiers without secrets.

L. FRESHNESS
Implement: fresh, stale_code, stale_docs, stale_config, stale_engine,
stale_model_policy, unknown. Changing repository SHA after a build must produce
stale_code.

M. QUALITY GATE
Check: required artifacts; empty output; broken internal links; Mermaid syntax where
validator exists; impossible/nonexistent referenced source paths; module coverage
estimate; output size; injection-like executable instructions in generated/reference
docs. Return: verified, verified_with_warnings, unverified, failed.

N. DATABASE KNOWLEDGE
When SQL/schema/migration signals exist, enable database documentation and normalize
tables, keys, relationships, views/procedures/functions when output is available.
Distinguish declared vs inferred relationships when possible.

O. GRAFT FUSION
If the existing Phase 20.62 Graft integration exists, create optional crosslinks from
Litho modules/workflows to Graft nodes/dependencies/blast-radius information.
Litho-only builds must remain fully usable when Graft is absent.

P. SEARCH AND CONTEXT PACKS
Implement repository knowledge search over normalized artifacts using existing
search/index infrastructure when available. Implement a task-specific ContextPack
compiler accepting: repo_id, task, token_budget, include_graph. Return bounded,
provenance-rich context containing relevant system context, modules, workflows,
ADR/phase material and graph links. Always include source SHA, knowledge version and
freshness. Never silently exceed token budget.

Q. MCP
Add scoped tools, adapting names to existing MCP naming conventions:
knowledge.repositories.list, knowledge.repo.status, knowledge.search,
knowledge.section.get, knowledge.architecture.get, knowledge.module.get,
knowledge.workflow.get, knowledge.database.get, knowledge.context.pack,
knowledge.refresh.request.
Read tools require repository read permission. Refresh requires build permission and
policy/cost check.

R. REST/API
Expose equivalent APIs through the existing API framework for repository status,
builds, versions, artifacts, search, context packs and knowledge sources. Do not
create a parallel server.

S. RBAC
Reuse existing auth/RBAC and add only missing permissions such as: knowledge.read,
knowledge.search, knowledge.context_pack, knowledge.build, knowledge.cancel,
knowledge.sources.manage, knowledge.providers.manage, knowledge.policies.manage,
knowledge.approve, knowledge.admin. Agents normally hold read/search/context_pack
only — not providers/policies/admin.

T. AUDIT
Audit build request, policy decision, approval, cancellation, publish, source changes
and provider boundary selection. Never audit raw credentials or unnecessary source
contents.

U. OBSERVABILITY
Add structured logs and metrics for build count, duration, failures, queue depth,
provider retries, cache hits, stale repos, quality warnings, context packs and policy
denials. Use existing telemetry conventions.

V. UI
Using the current Pao-hubPro design system, add a Knowledge area with: Overview;
Repositories; Repository detail; Build history/status; Knowledge/C4 viewer;
Module/workflow viewer; Database viewer where applicable; External knowledge sources;
policy/provider status. Display source SHA, freshness, latest version, Litho version,
quality and build stages prominently. Do not expose secrets.

W. CLI
If the project has a CLI, add/adapt commands for: knowledge doctor; knowledge repo
add/list; knowledge build; knowledge status; knowledge versions; knowledge context
--task. Follow current command naming conventions.

X. FAILURE HANDLING
Normalize at least these classes: LITHO_NOT_INSTALLED, LITHO_VERSION_UNSUPPORTED,
LITHO_CONFIG_INVALID, REPOSITORY_NOT_FOUND, REPOSITORY_SCOPE_DENIED, SNAPSHOT_FAILED,
SECRET_SCAN_BLOCKED, POLICY_DENIED, APPROVAL_REQUIRED, PROVIDER_AUTH_FAILED,
PROVIDER_RATE_LIMITED, PROVIDER_UNAVAILABLE, MODEL_OUTPUT_INVALID,
LITHO_PROCESS_FAILED, LITHO_TIMEOUT, OUTPUT_MISSING, OUTPUT_INVALID, MERMAID_INVALID,
QUALITY_GATE_FAILED, PUBLISH_FAILED, CANCELLED.
Retry only transient provider failures with bounded exponential backoff. Do not retry
deterministic policy/config/path/secret failures automatically.

Y. TESTS
Add unit, integration and end-to-end coverage. Create small fixture repositories for
representative languages and SQL/external-doc scenarios. Use fake credentials/secrets
only. Test: successful build; policy denial; secret block; local-only run;
unsupported/missing Litho; provider transient failure; policy-safe provider fallback;
invalid model structured output failure/recovery; local_docs category handling;
SQL/database output; cancellation; stale_code after commit change; context token
budget; MCP authorization.

Z. DOCUMENTATION
Add developer/operator docs covering installation, Litho requirements, provider
configuration, security boundary, policy, external knowledge, troubleshooting and
rollback.

EXPECTED STORAGE CONCEPT
Use existing storage abstractions if present. Conceptually a published version should
contain: manifest.json; provenance.json; quality.json; source-map.json; human/*;
agent/*; diagrams/*; graph/*; litho/raw-output/*; indexes/*.

FEATURE FLAG / ROLLBACK
Provide a safe feature flag such as KNOWLEDGE_RUNTIME_ENABLED or adapt to existing
feature-flag conventions. Disabling the runtime must stop new analysis without
deleting existing published knowledge or breaking the MCP hub/Graft.

ACCEPTANCE TEST
Demonstrate this complete flow with a fixture repository:
1. register repo
2. attach approved architecture/phase external docs
3. pass policy preflight
4. create immutable snapshot
5. run Litho
6. collect/normalize artifacts
7. run quality checks
8. publish KnowledgeVersion
9. query via API
10. query via MCP
11. generate bounded context pack
12. change source SHA
13. confirm stale_code
14. rebuild
15. publish next immutable version

DELIVERY REQUIREMENTS
- Provide actual production code, migrations, tests and docs.
- Do not leave critical-path TODO stubs.
- Keep optional integrations clearly optional.
- Keep changes focused on Phase 20.65.
- Run formatter/linter/typecheck/tests/build using the repository's existing commands.
- Fix failures introduced by this phase.
- At completion print: 1. architecture summary; 2. files created/changed; 3. migrations
  created; 4. commands used to verify; 5. test/build results; 6. known limitations;
  7. security decisions; 8. manual setup steps, if truly unavoidable; 9. next
  recommended follow-up.

Before editing, inspect the current Pao-hubPro repo and map this specification to its
real architecture. Do not assume TypeScript, a specific DB, Docker, or a particular
framework if the repository uses something else. Adapt cleanly while preserving all
security and acceptance requirements above.
```
