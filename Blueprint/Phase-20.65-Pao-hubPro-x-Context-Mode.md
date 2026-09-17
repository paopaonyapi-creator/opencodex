# Phase 20.65 — Pao-hubPro × Context Mode

## Context Window Optimization Runtime, Sandboxed Tool Execution, Persistent Session Intelligence, MCP Context Firewall & Policy-Governed Context Control Plane

> **Document type:** Production-Oriented Implementation Blueprint
> **Phase:** 20.65 (Implementation Blueprint / One-shot Codex Ready)
> **Project:** Pao-hubPro
> **Source of Truth:** `Phase-20.65-Pao-hubPro-x-Context-Mode.md` (prepared 2026-09-16), processed under `PAO-HUBPRO_MASTER_PHASE_REQUEST.md`
> **Primary integration:** `mksglu/context-mode` · **Verified baseline:** `context-mode@1.0.169` · **Runtime prerequisite:** Node.js `>=22.5` or Bun · **License:** Elastic License 2.0 (ELv2)
> **Filename/content consistency:** Filename and header agree on "20.65 × Context Mode"; however, see the **Phase Number Collision** notice below.

---

> ## ⚠ Phase Number Collision (master request §36 — ยังไม่เปลี่ยนเลขเอง)
>
> **หมายเลข 20.65 ถูกใช้โดยเอกสารสองฉบับที่เป็น phase คนละงาน:**
>
> 1. **Phase 20.65 — Pao-hubPro × Litho (deepwiki-rs)** — Autonomous Codebase Documentation Engine (blueprint อยู่ในโฟลเดอร์นี้แล้ว)
> 2. **Phase 20.65 — Pao-hubPro × Context Mode** (เอกสารนี้) — Context Window Optimization Runtime
>
> **การวิเคราะห์ตาม master request §36 (ชื่อ / timestamp / เนื้อหา / dependency / context):**
> - ชื่อ Phase **ต่างกันโดยสิ้นเชิง** — เป็นสอง integration คนละงาน ไม่ใช่ draft เก่า/ใหม่ของงานเดียวกัน
> - เอกสาร Context Mode (2026-09-16) ใหม่กว่า และระบุว่า *"the latest canonical Phase 20.65 per operator instruction and supersedes any older draft that reused the same phase number"* — ข้อความนี้ตีความได้สองทาง: (ก) supersede **Context-Mode draft รุ่นเก่า** ที่เคยใช้เลข 20.65 (สมเหตุสมผล), หรือ (ข) supersede **Litho** (ไม่สมเหตุสมผล เพราะ Litho เป็นงานคนละงาน ไม่ใช่ draft ของ Context Mode)
> - บริบทสนับสนุน Context Mode เป็น phase จริง: blueprint **20.68 (DSPy)** ระบุ "Recommended Next Phase: Pao-hubPro × Context Mode" และหัวข้อ context budget ของ 20.67 (ECC) อ้างถึงงานนี้ด้วย
>
> **Decision (pending user approval):** blueprint นี้**คงเลข 20.65 และชื่อไฟล์เดิม**ตาม master request §39 ทั้งที่มี collision — ทั้งสอง blueprint อยู่ในโฟลเดอร์พร้อมกัน ไม่มีการลบ/ทับกัน
>
> **เสนอทางแก้เพื่อพิจารณา (ต้องได้รับอนุมัติจากผู้ใช้):**
> 1. เปลี่ยนเลข Context Mode เป็น **20.72** (เลขว่างถัดไปหลัง 20.71) — สอดคล้องลำดับ 20.68→…→20.71 และข้อความ "next phase" ใน 20.68, **หรือ**
> 2. คงตาม operator instruction ที่ว่า Context Mode คือ canonical 20.65 และ renumber **Litho** ไปเลขอื่น, **หรือ**
> 3. เพิ่ม `phase-registry.yaml` uniqueness check แล้วให้ผู้ใช้เลือก mapping เอง
>
> **ห้าม silently overwrite หรือ renumber phase ใดโดยไม่มีคำอนุมัติ**

---

> **Primary goal:** Add a policy-governed **Context Control Plane** to Pao-hubPro so large tool outputs, files, logs, browser snapshots, API responses, repository data, and long-running agent state are processed outside the LLM context whenever possible, while preserving recoverable session state, provenance, security, auditability, and operator control.

> **Central rule:**
> **Raw data is not context. Raw data must be classified, filtered, indexed, summarized, queried, or sandbox-processed before it is admitted into an LLM context window unless policy explicitly permits direct delivery.**

> **Final design rule:** *Do not spend model context on raw data that a governed local runtime can analyze first. Preserve evidence outside the prompt, admit only relevant context, remember structured state across compaction, and make every context decision policy-governed and auditable.*

```text
CAPTURE RAW → CLASSIFY → SECRET CHECK → POLICY → BUDGET → ROUTE
→ PROCESS / INDEX / SEARCH / ARTIFACT → VALIDATE → ATTACH PROVENANCE
→ ADMIT MINIMAL CONTEXT → RECORD SESSION STATE → SNAPSHOT BEFORE COMPACTION
→ RECOVER ONLY WHAT MATTERS → AUDIT EVERYTHING IMPORTANT
```

---

## 1. Executive Summary

Phase 20.65 introduces a new **Context Control Plane** between Pao-hubPro agents and the tools/data they consume.

Context Mode provides a strong upstream foundation through: MCP-based context optimization; sandboxed/controlled execution tools; persistent SQLite + FTS5 knowledge storage; BM25 retrieval; session event capture; compaction-aware session recovery; hook-based routing and enforcement; context-saving statistics and diagnostics; local-first storage and execution; permission-rule propagation into context execution.

Pao-hubPro must **not** merely install Context Mode and expose it directly — Phase 20.65 wraps it in Pao-hubPro governance:

```text
Agent / User
    → Pao-hubPro Agent Gateway
    → Context Control Plane
    +--> Identity / Session Scope   +--> Context Classifier
    +--> Context Budget Engine      +--> Policy Engine
    +--> MCP Context Firewall       +--> Secret / PII Guard
    +--> Provenance + Hashing       +--> Approval Gate
    → Context Route Decision
    +--> DIRECT       small + safe + relevant
    +--> EXTRACT      structured query / selected fields
    +--> SUMMARIZE    bounded summarization
    +--> EXECUTE      sandboxed analysis
    +--> INDEX        persistent FTS5 knowledge
    +--> SEARCH       retrieve relevant chunks only
    +--> ARTIFACT     store raw payload outside prompt
    +--> BLOCK        unsafe / forbidden / secret-bearing
    → Context Mode Adapter
    +--> ctx_execute · ctx_execute_file · ctx_batch_execute · ctx_index
    +--> ctx_search · ctx_fetch_and_index · ctx_stats · ctx_doctor
    +--> ctx_upgrade · ctx_purge · ctx_insight (optional / policy controlled)
    → MCP / Files / Browser / Shell / Git / APIs / Repositories / Logs
```

A successful Phase 20.65 means Pao-hubPro can receive a potentially huge tool result, preserve the raw source outside the prompt, classify it, enforce policy and budget, process it using a safe route, inject only minimal relevant context into the model, and later reconstruct the agent's working state after compaction or restart without depending on the full prior transcript.

---

## 2. Problem Statement

Pao-hubPro increasingly connects agents to high-volume capabilities: MCP servers; Git repositories; code search; browser automation; public APIs; local files; logs; build output; test output; ComfyUI/AI generation systems; GPU workflows; multi-agent workers; persistent memory; external documentation; operational dashboards.

Without a dedicated context layer, every new capability creates the same failure mode:

```text
More tools → more raw output → larger prompts → faster context exhaustion
→ more compaction → more forgotten state → repeated reads/searches
→ more cost + latency → weaker reasoning continuity
```

Phase 20.65 changes this to:

```text
More tools → Context Firewall → classify → process outside LLM
→ retain provenance → retrieve only relevant context
→ preserve session state separately → smaller / cleaner prompt
```

The architectural target is **context efficiency without sacrificing evidence, recoverability, or safety.**

---

## 3. Goals (G1–G12)

- **G1 — Context Control Plane:** one central decision layer for whether data is admitted to model context.
- **G2 — Context Budget Engine:** track/enforce byte/token/result limits by agent; session; tool; MCP server; tenant/workspace; task; risk class.
- **G3 — MCP Context Firewall:** prevent uncontrolled tool results from flowing directly into agent prompts.
- **G4 — Sandboxed/controlled external analysis:** inspect large data outside the prompt; return only bounded outputs.
- **G5 — Persistent searchable knowledge:** index approved long-lived data; retrieve only relevant chunks.
- **G6 — Persistent session intelligence:** preserve tasks, decisions, touched files, errors, fixes, git state, blockers, unresolved work independently of conversation compaction.
- **G7 — Compaction recovery:** restore minimal working context after compaction or session resume.
- **G8 — Security-governed context:** block secrets, sensitive paths, dangerous commands, unsafe network targets, disallowed data classes.
- **G9 — Provenance:** every injected context chunk traceable to source, decision, hash, route, timestamp.
- **G10 — Observability:** raw bytes processed; bytes sent to LLM; savings; route distribution; compaction events; recovery quality; denials; failures.
- **G11 — Agent-agnostic integration:** Codex is a primary target, but core context decisions remain portable to other agents.
- **G12 — Graceful degradation:** if hooks or Context Mode are unavailable, fail safely and visibly.

---

## 4. Non-Goals

Phase 20.65 is NOT:

- a replacement for canonical project memory; for Pao-hubPro RBAC/ABAC; for MCP authorization;
- a generic unrestricted code-execution service; a shell proxy; a secret-storage system;
- an excuse to send every document to an LLM summarizer; an automatic approval system for unknown tools; an unlimited web fetcher;
- a multi-tenant hosted reimplementation of Context Mode;
- a guarantee that every agent runtime supports identical hooks; that context compression preserves all semantics;
- a replacement for source-control history; for artifact storage;
- a reason to discard raw evidence — **raw evidence should usually be retained outside the prompt where policy allows, not destroyed.**

---

## 5. Why This Phase Exists

See Section 2. Strategic position — **horizontal infrastructure phase** integrating with, not duplicating, adjacent systems:

| Phase | Relationship |
|---|---|
| 20.53 Persistent context/memory | Persistent Memory = what should survive as durable knowledge; Context Control = what should enter **this model call now** — 20.65 owns runtime context admission and session continuity, not universal long-term memory authority. |
| 20.57 Skill registry | Skill descriptions/instructions may be indexed, but enabled skills remain governed by the skill registry + policy. |
| 20.59 Credential lifecycle | Secrets never become context-mode index content unless an explicit secure design permits; prefer references/handles. |
| 20.61 Worker runtime | Large context-processing tasks run as durable workers when they exceed interactive budgets. |
| 20.62 Code intelligence | Repository graph/code intelligence supplies compact structured answers instead of repeatedly injecting large source trees. |
| 20.63 External API Gateway | API responses pass through the Context Firewall; large responses extracted/indexed/analyzed outside the prompt. |
| 20.64 Visual Compute | GPU job logs, shader diagnostics, artifacts, benchmark outputs are context-budgeted; images/artifacts remain artifacts — prompts carry only needed metadata/observations. |

### Ownership boundaries

**Pao-hubPro core owns:** identity; authentication; RBAC/ABAC; policy authority; approval authority; canonical session/task identity; audit log; data classification; secret handling; egress policy; budget policy; feature flags; dashboard; deployment authority; artifact retention; **final context-admission decision**.

**Context Control Plane owns:** context classification; budgets; route decisions; raw-result references; context envelopes; prompt admission controls; Context Mode adapter; index/search orchestration; session-event projection; compaction snapshots; session recovery; context metrics; context policy enforcement; context-specific approvals.

**Context Mode upstream owns:** its MCP server/tool implementation; hook adapters; local SQLite/FTS5 mechanics; upstream CLI/diagnostics; its release/version lifecycle. **Never treat upstream implementation details as Pao-hubPro's canonical domain model.**

---

## 6. Relationship to Pao-hubPro

### Layer mapping (Pao-hubPro core layers)

| Layer | Role in this phase |
|---|---|
| 03 Intent & Context Layer | **Primary owner** — context admission decisions. |
| 05 MCP Gateway | MCP Context Firewall integration. |
| 06 Capability Registry | Index source registry; classification taxonomy. |
| 07 Policy Engine | Context policy + route policy. |
| 08 Approval Engine | High-risk context actions (execute/fetch/purge). |
| 09–11 Execution Runtimes | Sandboxed ctx_execute; worker jobs. |
| 12 State / Session Layer | Session events + snapshots (structured). |
| 13 Memory / Knowledge Layer | FTS5 index + retrieval (adapter-backed). |
| 14 Secrets & Credential Layer | Secret/PII Guard; references not values. |
| 15 Event / Queue Layer | Context jobs + audit events. |
| 16 Observability Layer | Savings ratio + 20 metrics. |
| 17 Audit Layer | 20 audit event types. |
| 19 Web Dashboard | Context area (6 views). |
| 20 External Provider Layer | context-mode upstream (ELv2, pinned). |

---

## 7. Upstream / External Project

### Upstream baseline (verified at drafting — re-verify before implementation/upgrade)

- Repository: https://github.com/mksglu/context-mode — MCP server/plugin for reducing raw tool output entering agent context, with persistent session continuity and hook-based routing across multiple coding-agent environments.
- Package: `context-mode@1.0.169` · license **Elastic-2.0** · runtime Node.js ≥ 22.5 or Bun.
- Key upstream files to re-check: `README.md · package.json · LICENSE · .codex-plugin/plugin.json · .codex-plugin/hooks.json · configs/codex/ · docs/adapters/`. Upstream changes rapidly — re-check tool schemas, hook semantics, version, license, install instructions before every compatibility release.

### Tool surface (feature-detect at runtime — do not hard-code future shapes)

```text
Sandbox/context-processing: ctx_execute · ctx_execute_file · ctx_batch_execute
                            ctx_index · ctx_search · ctx_fetch_and_index
Meta/operations:            ctx_stats · ctx_doctor · ctx_upgrade · ctx_purge · ctx_insight
```

### Version strategy

Production uses a **tested pinned version**, not floating `latest`:

```yaml
contextMode:
  integration: enabled
  productionVersion: "1.0.169"
  updateChannel: pinned
  autoUpgrade: false
  allowPrerelease: false
```

Upgrade flow: `observe upstream release → source/license diff → tool-schema diff → hook compatibility test → session recovery test → sandbox policy test → security regression → context benchmark → staging rollout → manual production promotion`.

**Runtime compatibility — record at startup:** Node/Bun version; context-mode package version; MCP tool list; hook support detected for active agent runtime; FTS5 availability; database health; permission config availability; adapter mode; feature flags. **Do not fail the entire Pao-hubPro platform merely because Context Mode is unavailable — enter a degraded but explicit mode.**

### ⚠ License Boundary — Mandatory (ELv2)

Context Mode is licensed under **Elastic License 2.0**, not MIT — Phase 20.65 MUST preserve this boundary.

**Allowed posture:** Pao-hubPro integrates a local/operator-managed Context Mode dependency; consumes its MCP/tool capabilities; adds Pao governance around it; retains upstream notices.

**Do not design Pao-hubPro to:** remove upstream license notices; disguise Context Mode as Pao-owned upstream software; expose a substantial set of Context Mode functionality to third parties as a hosted/managed service in violation of ELv2; bypass licensing mechanisms; silently redistribute modified copies without required notices.

```ts
interface ThirdPartyRuntimePolicy {
  component: "context-mode";
  license: "Elastic-2.0";
  deploymentClass: "local-operator" | "internal-self-hosted";
  hostedThirdPartyExposureAllowed: false;
  noticesRequired: true;
}
```

**Before any commercial multi-tenant deployment, re-review the upstream license and deployment architecture.**

---

## 8. Current-State Assumptions

- **[Needs Verification] Repository discovery first:** inspect package manager, monorepo layout, backend/frontend frameworks, DB+ORM, migrations, auth/RBAC/ABAC, current MCP gateway, agent runtime adapters, Codex integration, existing hooks, worker/queue, artifact storage, audit, policy/approval engine, secret handling, outbound HTTP/SSRF controls, config validation, logging, metrics, test frameworks, current memory/context modules, repository intelligence, API gateway modules, coding conventions — create an internal implementation map before editing; reuse sound abstractions.
- **[Assumption] Upstream version:** verify currently installed/available version at implementation; if newer upstream exists, do not silently upgrade the baseline — record the observed version and decide whether to keep 1.0.169 or upgrade only after compatibility review.
- **[Assumption] Hook availability:** Codex hook capabilities may differ by build — feature-detect, never assume PreToolUse can always rewrite tool input or inject arbitrary context.
- **[Assumption] FTS5:** SQLite FTS5 availability checked at startup; absence ⇒ index/search disabled explicitly (never fake persistence).

---

## 9. Target Architecture

```text
+--------------------------------------------------------------------------------+
|                                Pao-hubPro UI                                    |
| Context | Sessions | Index | Policies | Savings | Recoveries | Denials | Health |
+---------------------------------------+----------------------------------------+
                                        ▼
+--------------------------------------------------------------------------------+
|                           Context Control Plane                                |
| Identity/Scope · Classifier · Budget Engine · Policy · Approval · Provenance   |
| Secret Guard · Risk Engine · MCP Firewall · Router · Recovery · Audit          |
+-------------------------+----------------------+-------------------------------+
                          ▼                      ▼
                +------------------+   +-------------------------+
                | Context Router   |   | Session Intelligence    |
                +------------------+   +-------------------------+
                  direct/extract/summarize    events · snapshots
                  /execute/index/search/block search · recovery
                          ▼
                +-------------------------+
                | Context Mode Adapter    |
                | version/schema guarded  |
                +-------------------------+
        ┌──────────────┬────────────────┬──────────────┐
        ▼              ▼                ▼              ▼
   ctx_execute    ctx_index       ctx_search      meta tools
        ▼
  MCP / File / Git / Shell / Web / API
```

---

## 10. Architecture Diagram

```mermaid
flowchart TB
    subgraph CCP[Context Control Plane]
        GW[Agent Gateway]
        CLS[Context Classifier<br/>20 classes]
        BUD[Context Budget Engine<br/>byte/token/result limits]
        POL[Policy Engine]
        SEC[Secret / PII Guard]
        PROV[Provenance + Hashing]
        APPR[Approval Gate]
        ROUTE[Context Router<br/>8 routes]
        FIRE[<b>MCP Context Firewall</b>]
    end

    subgraph SI[Session Intelligence]
        EVT[(Session Events<br/>33 types)]
        SNAP[Pre-Compaction Snapshot]
        REC[Session Recovery]
    end

    AD[Context Mode Adapter<br/>version/schema guarded] --> CM[context-mode@1.0.169<br/>SQLite + FTS5]
    CM --> IDX[(FTS5 Index)]
    CM --> EXEC[Sandboxed Execution]

    AG[Agent] -->|tool result| FIRE
    FIRE --> CLS --> SEC --> POL --> BUD --> ROUTE
    ROUTE -->|direct| AG
    ROUTE -->|extract/summarize/execute/index/search| AD
    ROUTE -->|artifact| ART[(Artifact Store)]
    ROUTE -->|block| DEN[Denial + Reason]
    EVT --> SNAP --> REC --> AG
    PROV --> AUD[(Audit)]
    POL --> AUD
    OUT[Egress Policy] -.->|ctx_fetch_and_index| AD
```

---

## 11. Core Components

| # | Component | Purpose |
|---|---|---|
| 1 | Context Classifier | 20 classes from tool identity/MIME/trust/size/schema/path/entropy/injection heuristics/relevance. |
| 2 | Context Budget Engine | Per-agent/session/tool/server/tenant/task/risk limits (bytes, tokens, items, execution time, prompt share). |
| 3 | **MCP Context Firewall** | Raw result captured outside prompt → classify → secret scan → budget → policy → route → bounded result. |
| 4 | Route Decision Engine | 8 deterministic, auditable routes with reason codes. |
| 5 | Context Mode Adapter | Replaceable `ContextProcessingRuntime` (9 methods); feature-detected tools. |
| 6 | Sandboxed Execution Boundary | Actor/language/command policy; fs/network scope; resource budgets; bounded stdout. |
| 7 | Secret/PII Guard | Detection + redaction before DIRECT/INDEX/SEARCH/storage. |
| 8 | Persistent Index (FTS5) | Approved sources with Pao metadata sidecar; scoped retrieval. |
| 9 | Session Intelligence | 33 structured event types; pre-compaction snapshots; recovery. |
| 10 | Provenance Chain | Source → rawHash → transform → route → outputHash → policyDecision. |
| 11 | Policy/Risk/Approval | Versioned policies; 4 risk classes; scoped approvals. |
| 12 | Workers + Backpressure | 9 job types; 8 states; concurrency limits. |
| 13 | API + MCP + Dashboard | 16 routes; 7 safe MCP tools; 6 views. |

---

## 12. Component Responsibilities

### 12.1 Context data model (internal contracts — independent of upstream shapes)

```ts
export type ContextRoute =
  | "direct" | "extract" | "summarize" | "execute"
  | "index" | "search" | "artifact" | "block";

export interface ContextSourceRef {
  sourceType: "mcp" | "file" | "shell" | "git" | "browser" | "api"
            | "database" | "agent" | "artifact";
  sourceId: string;
  toolName?: string;
  uri?: string;
  pathRef?: string;
  contentHash?: string;
}

export interface ContextEnvelope {
  id: string;
  sessionId: string;
  taskId?: string;
  source: ContextSourceRef;
  classification: ContextClassification;
  rawBytes: number;
  estimatedTokens?: number;
  risk: ContextRisk;
  route: ContextRoute;
  budgetDecisionId: string;
  policyDecisionId: string;
  artifactRef?: string;
  createdAt: string;
}
```

**No downstream layer should require knowledge of Context Mode-specific JSON to make policy decisions.**

### 12.2 Context classification (20 classes)

```text
small_structured · large_structured · source_code · repository_tree
logs · build_output · test_output · documentation · web_page
browser_snapshot · api_response · database_result · binary_metadata
image_metadata · session_event · operator_decision · secret_candidate
pii_candidate · untrusted_instructions · unknown
```

Classification uses: tool identity; MIME/content type; source trust; size; schema; path; entropy/secret detectors; instruction-injection heuristics; task relevance. **Unknown content should not automatically receive the permissive route.**

### 12.3 Context Budget Engine

Budget is not only token count — track: raw bytes; estimated tokens; number of items; max item size; transform output bytes; execution time; index size; search result count; context share of current model window.

**Recommended initial policy (Pao-hubPro starting limits — tune with benchmarks; NOT upstream Context Mode guarantees):**

```yaml
contextBudget:
  direct:    {maxBytes: 8192, maxEstimatedTokens: 2200}
  extract:   {maxRawBytes: 1048576, maxOutputBytes: 16384}
  summarize: {maxRawBytes: 524288, maxOutputBytes: 12288}
  execute:   {maxInputBytes: 67108864, maxStdoutBytes: 32768, timeoutMs: 30000}
  index:     {maxSingleSourceBytes: 67108864, maxSearchResults: 12, maxSearchOutputBytes: 24576}
  session:   {targetPromptSharePercent: 35, warningPromptSharePercent: 55, hardPromptSharePercent: 70}
```

Budgets must be configurable and scoped. **All hard limits server-side, not overrideable by an ordinary agent.**

### 12.4 Route Decision Engine

```text
IF secret_candidate                          -> BLOCK / REDACT
ELSE IF raw <= direct budget AND trusted AND relevant -> DIRECT
ELSE IF structured data AND task asks for specific fields -> EXTRACT
ELSE IF source is long-lived documentation   -> INDEX + SEARCH
ELSE IF source is logs/build/test output     -> EXECUTE analysis + bounded stdout
ELSE IF source is large repository content   -> code intelligence / INDEX / SEARCH
ELSE IF source must remain as evidence but is not prompt-worthy -> ARTIFACT
ELSE                                         -> SUMMARIZE or BLOCK depending on risk
```

**Route decisions are auditable objects, not hidden heuristics** (reason codes returned).

### 12.5 MCP Context Firewall (the most important Pao-hubPro addition)

**Required flow:**

```text
Agent requests MCP tool → MCP authorization → tool execution
→ raw result captured outside prompt → Context Firewall
→ classify → secret scan → budget → context policy → route
→ transform/retrieve → validate → bounded context result → Agent
```

**Never allow:** `MCP server → 2 MB JSON → LLM prompt directly`.

**Required protections (11):** per-server result limits; per-tool result limits; response MIME/schema validation; secret scan; binary detection; prompt-injection tagging; provenance; truncation markers; artifact fallback; safe extraction; operator-visible denial reasons.

### 12.6 Context Mode adapter

```ts
export interface ContextProcessingRuntime {
  health(): Promise<ContextRuntimeHealth>;
  execute(req: ContextExecuteRequest): Promise<ContextExecuteResult>;
  executeFile(req: ContextFileRequest): Promise<ContextExecuteResult>;
  batch(req: ContextBatchRequest): Promise<ContextBatchResult>;
  index(req: ContextIndexRequest): Promise<ContextIndexResult>;
  search(req: ContextSearchRequest): Promise<ContextSearchResult>;
  fetchAndIndex(req: ContextFetchRequest): Promise<ContextIndexResult>;
  stats(): Promise<ContextRuntimeStats>;
  purge(req: ContextPurgeRequest): Promise<ContextPurgeResult>;
}
```

Implement `ContextModeRuntimeAdapter` (feature-detect tools). Risky meta operations (`ctx_upgrade`, `ctx_purge`, external `ctx_insight`) **must not be automatically exposed to ordinary agents**. Do not let upstream tool naming leak across unrelated business layers. Health diagnostics: executable availability; version; Node/Bun prerequisite; MCP connectivity; tool discovery; FTS5/database health when observable; hook capability detection.

### 12.7 Sandboxed/controlled execution + host hardening

**Execution pipeline:** request → actor policy → language policy → command/script validation → input artifact bind → filesystem scope → network scope → resource budget → execute through Context Mode → bounded stdout → output validation → audit.

**Allowed workloads:** parse JSON; filter CSV-like text; search logs; count/group records; extract matching lines; safe static analysis; transform tool response to compact schema; compute hashes/statistics; inspect non-secret project data.

**Disallow by default:** privilege escalation; unbounded process spawning; arbitrary outbound credentialed calls; writing outside workspace/temp; reading secret files; raw device access; package-manager install from agent-provided arbitrary sources; persistence mechanisms; daemon creation; destructive filesystem commands.

**Host sandbox hardening** — treat Context Mode execution as **controlled subprocess execution**, not a substitute for a hardened OS/container boundary. Higher-risk environments wrap workers in: container/namespace isolation + read-only base filesystem + writable temp workspace + no privileged mode + dropped capabilities + CPU/memory/process quotas + execution timeout + egress allowlist + mounted project subpaths only. Isolation profiles: `PROFILE_SAFE_READ · PROFILE_CODE_ANALYSIS · PROFILE_NETWORK_READONLY · PROFILE_BUILD · PROFILE_ADMIN_APPROVED` — **no ordinary agent receives an unrestricted profile.** Do not concatenate agent/user input into shell commands — argument arrays or direct tool APIs.

### 12.8 Filesystem + network boundaries

**Filesystem:** all file operations normalize/resolve paths before access; reject `..` traversal outside allowed root; reject arbitrary absolute paths unless policy grants; resolve symlinks before final policy decision where practical; per-session/project workspace roots; **secret paths deny-by-default**; output files to controlled temp/artifact locations; raw host home access not implied. Sensitive examples: `.env`, `.env.*`, `**/credentials*`, `**/secrets*`, `~/.ssh/**`, `~/.aws/**`, `~/.config/**/tokens*`, private keys, browser profile stores. **Use secret references, not values.**

**Network/fetch:** `ctx_fetch_and_index` must pass through Pao-hubPro outbound policy when used by managed agents — `URL parse → scheme allowlist → DNS/IP resolution → private/link-local/metadata checks → redirect policy → host allow/deny policy → request timeout → size limit → MIME validation → content classification → index`. **Do not make Context Mode a bypass around the API/egress gateway (20.63).**

### 12.9 Secret/sensitive-data guard

Before DIRECT, INDEX, SEARCH result injection, or persistent session storage: run secret detection; apply redaction policy; classify sensitive content; block known credential formats; remove auth headers/cookies; avoid storing raw environment dumps; preserve a non-secret reference when useful.

```json
{"decision": "redact", "matched": ["api_key", "cookie"],
 "storedRaw": false, "replacement": "[REDACTED_SECRET]"}
```

**Secret detection failures must be observable and testable.** Reuse the existing credential broker/secret detector if present; never create a second plaintext credential store.

### 12.10 FTS5 index + retrieval policy

**Indexable source classes:** docs; runbooks; build_logs; non-secret command output; API documentation; repository notes; session snapshots; research notes; tool result summaries. Every indexed item carries Pao metadata (workspace_id; project_id; session_id; task_id; source_type; source_uri/path_ref; content_hash; classification; trust_level; created_at; expires_at; retention_class) — if upstream storage cannot represent all metadata, maintain a **Pao sidecar registry keyed by content hash/index label**.

**Retrieval flow:** query intent → scope → policy → ctx_search → rank → deduplicate → provenance attach → secret scan → token/byte cap → inject top relevant chunks. **Never return the full index because a search query is broad.**

```ts
interface RetrievedContextChunk {
  id: string;
  score?: number;
  sourceRef: ContextSourceRef;
  excerpt: string;
  contentHash?: string;
  trust: "trusted" | "observed" | "untrusted";
}
```

### 12.11 Session intelligence + pre-compaction snapshot + recovery

**Session events (33 types):** `session.started; user.intent; user.decision; user.correction; plan.created/updated; task.created/started/completed/blocked; file.read/created/modified/deleted; git.status/commit/branch_changed; tool.called/failed; error.detected/fixed; constraint.added; assumption.added; approval.requested/granted/denied; artifact.created; context.indexed; context.route_decided; compaction.prepared; session.recovered/stopped` — compact and structured; **store artifact/index references, not huge payloads**.

```ts
export interface SessionEvent {
  id: string; sessionId: string; taskId?: string; sequence: number;
  type: string;
  actorType: "user" | "agent" | "system" | "tool";
  actorId?: string;
  payload: Record<string, unknown>;
  sourceRef?: ContextSourceRef;
  contentHash?: string;
  importance: "low" | "normal" | "high" | "critical";
  createdAt: string;
}
```

**Pre-compaction snapshot (`SessionRecoverySnapshot`):** sessionId; taskId; userGoal; activePlan[]; completedSteps[]; pendingSteps[]; decisions[]; constraints[]; filesTouched[{pathRef, action}]; activeErrors[]; resolvedErrors[]; gitState?; relevantArtifacts[]; relevantContextLabels[]; lastUserCorrection?; createdAt. **Snapshot generation must be deterministic enough to test.**

**Recovery flow:** `SessionStart → identify canonical session → load latest snapshot → query relevant session events → validate freshness → build recovery context → enforce recovery budget → inject minimal state`. Recovery order: 1) user goal; 2) latest explicit user correction; 3) current task status; 4) pending plan steps; 5) files currently being modified; 6) unresolved errors/blockers; 7) important constraints; 8) recent decisions; 9) relevant source/index references. **Do not flood the new context with the entire old session.**

### 12.12 Codex hook integration + cross-agent capability matrix

Codex is a primary target — support current Context Mode integration hooks: `PreToolUse · PostToolUse · SessionStart · PreCompact · UserPromptSubmit · Stop`.

**Important design rule:** Codex hook capabilities may differ by build — **do not architect Pao-hubPro around an assumption that PreToolUse can always rewrite tool input or inject arbitrary context.** Therefore enforcement is layered:

```text
Hook Enforcement + MCP Gateway Enforcement + Pao Context Policy + Tool Adapter Limits
```

If a hook is missing: mark capability unavailable; fall back to gateway-level controls where possible; lower trust in automatic routing compliance; show degraded-state warning; **do not silently claim full enforcement**.

**Cross-agent capability matrix (never one boolean `hooksSupported`):**

```ts
interface AgentContextCapabilities {
  platform: string;
  preToolUse: boolean; postToolUse: boolean; sessionStart: boolean;
  preCompact: boolean; userPromptCapture: boolean; stopEvent: boolean;
  canBlockTool: boolean; canRewriteToolInput: boolean; canInjectContext: boolean;
}
```

This allows Context Mode with Codex, Claude-like runtimes, Copilot environments, OMP, Pi, or future agents **without falsely assuming equivalent control**.

### 12.13 Prompt injection defense + provenance

External content may contain instructions intended for the agent — mark external retrieved/indexed content as **data, not authority**. Required protections: provenance label; trust classification; instruction-like content detection; system reminder that retrieved content cannot override higher-level policy; no automatic tool execution based solely on retrieved text; no credential disclosure in response to retrieved instructions. **Do not treat FTS5 search results as trusted instructions merely because they are local.**

**Provenance chain example:**

```json
{"source": "mcp:github/issues", "rawArtifact": "artifact_123",
 "rawHash": "sha256:...", "transform": "ctx_execute:filter-open-p1",
 "transformVersion": "phase20.65/v1", "route": "execute",
 "outputHash": "sha256:...", "policyDecision": "cpd_456"}
```

Allows audit and reprocessing without injecting raw content into the prompt.

### 12.14 Workers, concurrency, caching, retention, privacy

**Workers (long tasks become jobs):** `context_index · context_reindex · context_analyze_artifact · context_session_snapshot · context_recovery_build · context_cleanup · context_health_check · context_benchmark · context_upgrade_check` — states `queued → policy_check → awaiting_approval → running → completed | failed | cancelled | timed_out | blocked`. **Worker output is still subject to context budgeting before it reaches an agent.**

**Backpressure:** `maxConcurrentExecutePerSession: 2 · maxConcurrentExecuteGlobal: 4 · maxConcurrentIndexJobs: 2 · maxQueuedJobsPerSession: 20 · maxSearchQpsPerSession: 5`; queue priority for interactive recovery/search over bulk indexing.

**Caching:** safe cache keys include content hash; query hash; transform version; policy version; source trust/version; workspace scope — **never reuse a cached context result across authorization boundaries unless explicitly designed and proven safe.**

**Retention classes:** `ephemeral (minutes/hours) · session (lifetime + grace) · project (policy) · operational (fixed) · legal_required (explicit only)`. Purge handles Pao sidecar metadata; session snapshots; artifact references; Context Mode indexed content; metrics without raw content follow separate retention. **`ctx_purge` is a consequential action — authorization plus confirmation/approval policy required.**

**Privacy:** preserve Context Mode's local-first advantage — code; prompts; session events; indexes; context processing stay inside the operator-controlled environment unless another feature explicitly requires external processing. If external services are used, record: what data leaves; why; provider; region if known; retention assumptions; credential used by broker reference; approval/policy decision.

---

## 13. Data Flow

**Admission flow:** see Section 12.5 firewall flow. **Index flow:** approved source → classify → secret scan → budget → index → FTS5 + Pao sidecar metadata → scoped search later. **Recovery flow:** Section 12.11. **Worker flow:** job queued → policy → approval (if needed) → execute → bounded output → context budget → agent.

---

## 14. Control Flow

Decisions: routes `direct/extract/summarize/execute/index/search/artifact/block` with reason codes; **fail closed** for secret candidates and unknown-risk content (never permissive by default).

### Risk classification (source LOW/MEDIUM/HIGH/CRITICAL → R0–R4 mapping)

| Source class | R-level | Examples | Default |
|---|---|---|---|
| **LOW** | R0/R1 | stats; search approved docs; read-only extraction from non-secret artifact; context diagnostics | auto-allow |
| **MEDIUM** | R2 | sandbox analysis of workspace files; indexing project documentation; bounded network fetch from allowlisted docs | policy allow, audited |
| **HIGH** | R3 | executing generated scripts; indexing unknown external content; broad repository processing; network-enabled execution; accessing sensitive internal documents | approval required |
| **CRITICAL / BLOCKED BY DEFAULT** | beyond R4 | credential files; private keys; unrestricted shell; host-root access; privileged execution; arbitrary third-party hosted exposure of Context Mode functionality | **BLOCK** |

### Policy model

```yaml
contextPolicy:
  defaults:
    rawResultToPrompt: deny
    preserveArtifact: true
    requireProvenance: true
    secretIndexing: deny
  routes:
    small_structured: {allow: [direct, extract]}
    logs:             {allow: [execute, index, search, artifact]}
    documentation:    {allow: [index, search, summarize]}
    browser_snapshot: {allow: [extract, execute, artifact]}
    source_code:      {allow: [direct, execute, index, search]}
    secret_candidate: {allow: [block]}
  execution:
    networkDefault: deny
    workspaceWriteDefault: deny
    maxExecutionMs: 30000
    maxStdoutBytes: 32768
```

Policies versioned and auditable.

---

## 15. Agent / Worker Model

**Terminology (strictly separated):**

| Term | Definition |
|---|---|
| Agent | Consumer of bounded context (Codex primary; agent-agnostic by design). |
| Worker | Durable job executor (index/snapshot/cleanup — Section 12.14). |
| Job | Long-running context task with 8-state lifecycle. |
| Session | Conversation scope with structured event log + snapshots. |
| Envelope | The canonical admission record (source/classification/risk/route/decisions). |
| Route | One of 8 admission decisions. |
| Artifact | Raw payload stored outside the prompt, referenced by hash. |
| Chunk | Retrieved indexed fragment with provenance + trust label. |

---

## 16. Session / State Model

- **Session events:** 33 structured types, sequenced, importance-labeled (Section 12.11) — durable independent of model transcript.
- **Snapshots:** deterministic `SessionRecoverySnapshot` built before compaction (`compaction.prepared` event); freshness validated at recovery.
- **Job lifecycle:** `queued → policy_check → awaiting_approval → running → completed | failed | cancelled | timed_out | blocked`.
- **Cache identity:** content hash + query hash + transform version + policy version + source trust/version + workspace scope; never reused across authorization boundaries.
- **Recovery correction precedence:** a newer user correction overrides an older snapshot (threat 13 — test-proven).

---

## 17. MCP Integration

- **MCP Context Firewall** (Section 12.5) wraps MCP tool results — the firewall is the Pao addition; upstream tools execute behind it.
- **Safe Pao MCP tools (7):** `pao_context_stats · pao_context_search · pao_context_index · pao_context_analyze_artifact · pao_context_session_state · pao_context_explain_route · pao_context_health` — not unrestricted upstream pass-through.
- Potentially risky tools such as generic execute either remain internal, are constrained to predefined analyzers, or require explicit policy/approval. `ctx_upgrade`/`ctx_purge`/external Insight never auto-exposed to ordinary agents.
- API surface (16 internal routes incl. `/api/context/health|stats|sessions|classify|route|index|search|execute|approvals|purge|policies|audit`) — **do not expose raw arbitrary execution endpoints publicly.**

---

## 18. Capability Registry

- **Classification taxonomy** (20 classes) with detection inputs.
- **Index source registry** — approved source classes with Pao metadata + sidecar registry keyed by content hash.
- **Agent context capability matrix** (Section 12.12) — per-platform hook capabilities.
- **Sandbox profiles** (5) — no ordinary agent receives unrestricted.
- **License registry** — `context_license_registry` entity recording ELv2 posture (Section 7).

---

## 19. Policy Model

See Section 14 (policy YAML + risk mapping). Rules precedence: Pao policy > route defaults > upstream permission-rule propagation. **Raw result to prompt = deny by default**; provenance required; secret indexing denied; policies versioned/audited; unknown content never permissive.

---

## 20. Security Model

### Threat model (20 threats to test explicitly)

```text
1. tool returns multi-megabyte prompt-flood payload
2. malicious MCP server returns secret-looking or instruction-bearing data
3. path traversal through execute-file
4. symlink escape
5. shell command injection
6. network SSRF through fetch
7. metadata-service access
8. reading .env or SSH keys
9. indexing credentials accidentally
10. prompt injection from indexed web content
11. cross-session index leakage
12. cross-workspace retrieval leakage
13. stale session snapshot overriding newer user decision
14. replay of an old approval
15. excessive worker spawning
16. stdout/stderr context flooding
17. denial bypass by direct upstream MCP access
18. context artifact reference guessing
19. purge without authorization
20. incompatible upstream upgrade changing hook/tool behavior
```

Each maps to controls in Sections 12.5–12.14 + security tests (Section 36).

---

## 21. Approval Model

### R0–R4 / risk class summary

See Section 14. HIGH-class actions (generated-script execution, unknown external indexing, network-enabled execution, sensitive internal documents) require explicit approval.

### Approval mechanics

Approval request shows: actor; session/task; source; requested route; raw size; risk class; filesystem scope; network scope; retention effect; index persistence; reason. **Approval must be scoped, time-bounded where appropriate, and auditable**; approval replay denied (threat 14); `context.approval.requested/granted/denied` audit events.

---

## 22. Failure Handling

### Degraded modes (4 cases — explicit, never silent)

| Case | Behavior |
|---|---|
| **Context Mode process unavailable** | mark health degraded; disable execute/index/search routes that require it; keep Context Firewall active if the Pao layer can still enforce it; bounded direct/extract fallback only when safe; **never silently dump raw oversized output into prompt** |
| **FTS5 unavailable** | disable index/search; retain raw artifacts per policy; surface diagnosis; **do not fake successful persistence** |
| **Hook missing** | continue gateway enforcement; warn that session/routing coverage may be partial; routing instructions only as lower-assurance fallback |
| **Snapshot recovery fails** | load canonical task state from Pao-hubPro; retrieve latest structured events; report **partial recovery**; never invent missing state |

Other failures: oversized outputs → denial with reason; execution timeout → bounded kill; upstream version mismatch → `context.runtime.version_mismatch` + hold.

---

## 23. Recovery Model

- **Session recovery:** snapshot + structured events rebuild minimal working state in the 9-step priority order (Section 12.11); recovery budget enforced; partial recovery reported honestly.
- **Index recovery:** content-hash keyed; corrupted/stale entries rebuilt; sidecar metadata preserved.
- **Cache recovery:** safe cache keys prevent cross-boundary reuse.
- **Rollback:** disable execution while retaining firewall; rollback version per pinned policy; `AUDIO_LAB`-style modularity — Pao-hubPro runs without Context Mode in explicit degraded mode.
- **Purge recovery:** purge is authorized + audited; retention classes govern what is removable.

---

## 24. Observability

### Metrics (20)

```text
context_raw_bytes_total · context_prompt_bytes_total
context_estimated_tokens_saved_total · context_savings_ratio
context_route_total{route} · context_denials_total{reason}
context_secret_redactions_total · context_index_bytes_total
context_search_total · context_search_result_bytes_total
context_execute_total{status} · context_execute_duration_ms
context_execute_timeouts_total · context_compactions_total
context_recoveries_total · context_recovery_failures_total
context_snapshot_age_seconds · context_hook_events_total{type}
context_runtime_health
```

**Top-level KPI:** `Context Savings Ratio = 1 − (prompt admitted bytes / raw processed bytes)` — **do not optimize this metric at the expense of answer correctness.**

---

## 25. Audit

Mandatory audit events (20):

```text
context.runtime.started · context.runtime.version_mismatch
context.route.decided · context.route.blocked · context.secret.redacted
context.execute.requested / completed / failed
context.index.created / updated / purged · context.search.executed
context.snapshot.created · context.recovery.completed / partial
context.approval.requested / granted / denied
context.policy.changed · context.license.reviewed
```

**Audit events should not leak the secret/raw content they are auditing.** Route decisions are auditable objects with reason codes; every denial operator-visible.

---

## 26. Data Model

Use existing DB/ORM conventions — minimum logical entities:

```text
context_runtime_instances · context_policies · context_policy_decisions
context_envelopes · context_artifact_refs · context_routes
context_index_sources · context_search_events · context_execution_events
context_session_events · context_session_snapshots · context_recovery_events
context_approvals · context_denials · context_metrics_rollups
context_license_registry
```

`context_routes` fields: `id · session_id · task_id · source_type · source_id · raw_bytes · estimated_tokens · classification · risk · route · reason · policy_decision_id · artifact_ref · output_bytes · created_at` + indexes for session/time/source/route/risk. **Avoid duplicating canonical task/session tables — reference them.**

---

## 27. API / Event Contracts

### 27.1 Internal API (16 routes)

```text
GET  /api/context/health        GET  /api/context/stats
GET  /api/context/sessions      GET  /api/context/sessions/:id
GET  /api/context/sessions/:id/snapshot
POST /api/context/classify      POST /api/context/route
POST /api/context/index         POST /api/context/search
POST /api/context/execute
POST /api/context/approvals/:id/approve   POST /api/context/approvals/:id/deny
POST /api/context/purge
GET  /api/context/policies      GET  /api/context/audit
```

### 27.2 Common envelope

```json
{
  "request_id": "req_...",
  "session_id": "sess_...",
  "actor_id": "agt_... | usr_...",
  "operation": "context.route",
  "input": {"source_type": "mcp", "raw_bytes": 2097152},
  "status": "ALLOWED | DENIED | REQUIRE_APPROVAL | ROUTED | BLOCKED | FAILED",
  "result": {"route": "execute", "reason": "large_log_output", "output_bytes": 8192},
  "error": {"code": "SECRET_CANDIDATE_BLOCKED", "message": "redacted user-facing message"},
  "created_at": "2026-09-17T00:00:00Z"
}
```

Events: Section 25 catalog.

---

## 28. Configuration

```yaml
contextControl:
  enabled: true
  runtime: context-mode
  contextMode:
    executable: context-mode
    expectedVersion: "1.0.169"
    requireExactVersion: false
  firewall:   {enabled: true, rawToPromptDefault: deny}
  session:    {enabled: true, snapshots: true, recovery: true}
  indexing:   {enabled: true, retentionDays: 30}
  execution:  {enabled: true, network: deny, workspaceWrite: deny, maxMs: 30000, maxStdoutBytes: 32768}
  externalInsight: {enabled: false}
```

(Example only; adapt to existing config system.)

---

## 29. Feature Flags

| Flag | Safe default | Gates |
|---|---|---|
| `CONTEXT_CONTROL_ENABLED` | on | Control plane |
| `CONTEXT_MODE_ENABLED` / `CONTEXT_MODE_MCP_ENABLED` | per config | Upstream adapter/MCP |
| `CONTEXT_MODE_HOOKS_ENABLED` | feature-detected | Hook enforcement |
| `CONTEXT_MODE_INDEX_ENABLED` | on (approved sources) | Index/search |
| `CONTEXT_MODE_EXECUTE_ENABLED` | on (sandboxed) | Execution routes |
| `CONTEXT_MODE_FETCH_ENABLED` | restricted | ctx_fetch_and_index (egress policy) |
| `CONTEXT_SESSION_INTELLIGENCE_ENABLED` / `CONTEXT_PRECOMPACT_ENABLED` / `CONTEXT_RECOVERY_ENABLED` | on | Session intelligence |
| `CONTEXT_FIREWALL_ENABLED` | **on** | Firewall |
| `CONTEXT_SECRET_GUARD_ENABLED` | **on** | Secret guard |
| `CONTEXT_APPROVALS_ENABLED` | **on** | Approvals |
| `CONTEXT_DASHBOARD_ENABLED` | on | UI |
| `CONTEXT_INSIGHT_EXTERNAL_ENABLED` | **off** unless explicitly approved | External Insight |

Safe defaults: firewall on; audit on; secret guard on; auto-upgrade off; external Insight off; public arbitrary execute off; public purge off; network execution off by default.

---

## 30. Repository / Module Structure

Adapt to actual repo structure — do not force this layout if another modular convention exists:

```text
src/context/
  domain/{types, classification, policy, budgets, provenance, recovery}.ts
  application/{ContextGateway, ContextRouter, ContextBudgetService,
               SessionIntelligenceService, ContextApprovalService}.ts
  infrastructure/
    context-mode/{ContextModeAdapter, schema, health}.ts
    persistence/   workers/   metrics/
  security/{secretGuard, pathGuard, egressGuard, executionProfiles}.ts
  api/   mcp/   ui/
```

---

## 31. Dashboard Integration

Add a **Context** area — 6 views:

- **Overview:** current runtime health; installed version; hook support matrix; raw bytes processed; prompt bytes admitted; estimated tokens saved; savings ratio; current sessions; recent denials.
- **Sessions:** active goal; task status; last snapshot; compaction count; recovery events; files touched; unresolved blockers.
- **Routes:** direct; extract; summarize; execute; index; search; artifact; block.
- **Index:** labels/sources; size; retention; trust; last updated; purge action (authorized).
- **Policy:** effective policy; exceptions; approvals; denials; risky execution profiles.
- **Diagnostics:** `ctx_doctor` adapter result; database/FTS health; hook registration; runtime versions; degraded mode.

---

## 32. Dependencies

### Required

- **Pao-hubPro control plane:** identity/auth, policy engine, approval engine, audit, config/flags, persistence, secret handling, egress policy, artifact storage, metrics.
- **context-mode@1.0.169 (pinned, ELv2)** + Node ≥22.5/Bun — for the adapter path; absence ⇒ explicit degraded mode, never platform failure.

### Recommended

- **Phase 20.63 API/egress gateway** — ctx_fetch_and_index must pass through it (no bypass).
- **Phase 20.59 credential broker/secret detector** — reuse; never a second plaintext store.
- **Phase 20.61 worker runtime** — durable jobs for bulk operations.
- **Phase 20.62 code intelligence** — compact repository answers instead of raw trees.
- **Phase 20.67 ECC context budget** — complementary budget layers.
- **Phase 20.64 visual compute** — budgeted GPU logs/artifacts.

### Optional

- Container/namespace isolation infrastructure for higher-risk execution profiles (Phase 20.66 HybridClaw patterns).
- External Insight (flag-gated, off by default).

**Do not assume other phases are implemented.** Standalone path: Context Control Plane + firewall + budget + classification work at the Pao layer even with hooks missing or Context Mode absent (degraded mode); index/search require FTS5; session intelligence persists via Pao's own DB.

---

## 33. Compatibility

- **ELv2 license boundary** — recorded in `context_license_registry`; notices preserved; hosted third-party exposure disabled unless separately reviewed (Section 7)
- **Upstream drift:** tool schemas, hook semantics, version, license re-checked before every compatibility release; feature detection over assumptions
- **Agent parity:** cross-agent capability matrix; degraded-state reporting when hooks missing; architecture never depends solely on PreToolUse rewrite
- **Backward compatibility:** `ContextGateway.processToolResult(...)` introduced incrementally per tool family (Section 38); compatibility adapters until old direct paths removed; Pao-hubPro runs with subsystem off
- **Semantic honesty:** context compression does not guarantee semantics preserved — raw evidence retained outside the prompt where policy allows

---

## 34. Migration

**Do not rewrite Pao-hubPro agent execution all at once.** Introduce `ContextGateway.processToolResult(...)` then migrate tool families incrementally:

```text
1. MCP external tools        2. shell/build/test output
3. browser output            4. API gateway responses
5. file/repository analysis  6. worker results     7. cross-agent messages
```

Maintain compatibility adapters until old direct paths are removed. Rollout stages (Section 38) gate enforcement; shadow mode compares route decisions with current behavior before blocking (except secrets).

---

## 35. Rollback

```text
1. CONTEXT_MODE_ENABLED=false → adapter off; firewall stays if Pao layer can enforce
2. Execution routes disabled while retaining firewall/budget enforcement
3. Index/search disabled explicitly if FTS5 unavailable; artifact refs preserved
4. Version rollback per pinned policy; upgrade checklist reversed
5. Registry/snapshot/audit data preserved; purge only via authorized flow
6. Never leave oversized raw results flowing to prompts during rollback
```

---

## 36. Testing Strategy

### 36.1 Unit tests (10)

Classifier; token/byte budget; route decision; redaction; path normalization; URL/egress checks; recovery snapshot builder; provenance chain; risk classification; config validation.

### 36.2 Adapter contract tests (9)

Tool discovery; execute; file execute; batch execute; index; search; health; stats; purge authorization boundary.

### 36.3 Integration tests (6)

MCP result → firewall → execute → compact result; docs → index → search → prompt; long session → PreCompact → SessionStart recovery; user correction survives compaction; active file list survives compaction; error/fix state survives compaction.

### 36.4 Security tests (10)

Command injection; path traversal; secret file denial; SSRF; redirect to private network; oversized outputs; untrusted instruction content; cross-session leakage; unauthorized purge; execution timeout.

### 36.5 Performance tests + benchmark targets

Measure: raw bytes processed; prompt bytes admitted; latency overhead; index throughput; search latency; snapshot build latency; recovery latency; CPU/RAM overhead.

**Benchmark targets for representative large-output tasks (Pao-hubPro benchmarks — do not hard-code upstream marketing claims):**

```text
>= 80% prompt-byte reduction on large logs/browser/API payloads
<= 2 s p95 local search for normal project index sizes
<= 5 s p95 recovery snapshot assembly under normal workload
0 secret values intentionally admitted from protected fixtures
0 direct oversized MCP payloads bypassing the firewall in covered paths
100% route decisions auditable
```

Track upstream's reported high savings as inspiration, **not as a guaranteed production SLA.**

### 36.6 Demonstration scenarios (6 — must ship)

- **Demo A — Large GitHub/API result:** raw JSON issue set → firewall → execute/extract → return only open high-priority items → savings stats.
- **Demo B — Browser snapshot:** large snapshot → artifact → extract relevant text/controls → bounded context.
- **Demo C — Build log:** large log → execute analyzer → errors + surrounding evidence only.
- **Demo D — Documentation index:** docs → index → search by task question → top relevant chunks only.
- **Demo E — Session compaction:** multi-step coding task → edits + decisions + errors → snapshot before compaction → recover → continue from correct pending step.
- **Demo F — Secret protection:** `.env` fixture → deny/read block → no index → no prompt injection → audit event.

---

## 37. Acceptance Criteria

**Integration:** adapter version/schema guarded; runtime health + version visible; Node/Bun prerequisite validated; production never auto-upgrades blindly.
**Context Firewall:** raw MCP results pass through firewall on covered paths; oversized raw output cannot silently enter prompts; route decisions auditable; artifact fallback exists.
**Budget:** direct byte/token limits; execute stdout limits; search output limits; session prompt-share thresholds.
**Sandbox/execution:** dangerous commands denied; secret paths denied; path traversal tests pass; timeouts enforced; output limits enforced; network deny-by-default unless policy grants.
**Index/retrieval:** approved documents indexable; searches scoped; results carry provenance; **secrets do not enter ordinary index storage**; purge authorized + auditable.
**Session intelligence:** user decisions captured; corrections captured; task state captured; file modifications captured; errors/fixes captured; pre-compaction snapshot exists where supported; recovery continues from correct state.
**Codex:** MCP integration works; hook capabilities feature-detected; missing hook features produce degraded-state reporting; **architecture does not depend solely on PreToolUse input rewrite**.
**Security:** SSRF tests pass; secret fixture tests pass; cross-session leakage tests pass; cross-workspace leakage tests pass; prompt-injection content labeled untrusted.
**Observability:** savings ratio; route metrics; denial metrics; execution metrics; compaction/recovery metrics; dashboard displays health + degraded state.
**License:** ELv2 recorded; upstream notices preserved; hosted third-party exposure disabled unless separately reviewed.
**Build quality:** typecheck; unit; integration; security; build; documentation/runbook — all pass.

---

## 38. Implementation Roadmap

| Stage | Content |
|---|---|
| 0 — Observe only | install adapter; health/stats only; no routing changes |
| 1 — Firewall shadow mode | compute route decisions; compare with current behavior; do not block yet **except secrets** |
| 2 — Large-result routing | enforce on logs/API/browser results; artifact + execute/extract |
| 3 — Persistent index | approved docs + non-secret knowledge; search retrieval |
| 4 — Session intelligence | event capture; snapshots; recovery |
| 5 — Hook enforcement | Codex + supported runtimes; verify actual hook capability matrix |
| 6 — Full production policy | approvals; dashboard; alerting; benchmark gate |

**Operator runbook procedures (13):** install/upgrade Context Mode; verify Node/Bun prerequisite; run diagnostics; confirm MCP registration; confirm hook registration; inspect FTS5/index health; investigate low savings; investigate wrong recovery; purge an index safely; rotate/remove corrupted context storage; disable execution while retaining firewall; rollback version; **review ELv2 deployment boundary**.

---

## 39. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Prompt-flood via tool payload | Context exhaustion, cost | Firewall + budgets + artifact fallback (threat 1) |
| Malicious MCP output (secrets/instructions) | Leakage/injection | Secret scan + injection tagging + untrusted labels (threat 2) |
| Secret indexing (e.g., .env, SSH keys) | Credential exposure | Secret guard deny-by-default; Invariant 3; threat 8/9 |
| Path traversal / symlink escape | Filesystem exposure | Path guard; canonicalization; threat 3/4 |
| Command injection in execute | Host compromise | Argument arrays; command policy; sandbox profiles; threat 5 |
| SSRF via ctx_fetch_and_index | Internal network access | Egress policy chain; metadata blocking; threat 6/7 |
| Cross-session/workspace leakage | Data breach | Scoped retrieval; sidecar metadata; threat 11/12 |
| Stale snapshot overrides newer correction | Wrong recovery | Freshness validation; correction precedence; threat 13 |
| Approval replay | Unauthorized actions | Scoped, time-bounded, single-use approvals; threat 14 |
| Worker spawn storms | Resource exhaustion | Backpressure limits; threat 15 |
| Direct upstream MCP bypass of firewall | Governance hole | Gateway-level enforcement layering; threat 17 |
| Upstream upgrade breaks hooks/tools | Silent behavior change | Pinned version; upgrade flow; contract tests; threat 20 |
| ELv2 violation (hosted exposure) | Legal exposure | License registry; deployment boundary review |
| Over-optimizing savings ratio | Wrong answers | KPI rule: never at expense of correctness |

---

## 40. Security Checklist

- [ ] Invariant 1: raw tool output ≠ prompt context (default hold outside LLM until routed)
- [ ] Invariant 2: policy before context — never inject first and sanitize later
- [ ] Invariant 3: secrets never become searchable context (FTS5 excluded; test-proven)
- [ ] Invariant 4: evidence preserved by reference (source, hash, artifact ref, transform version, timestamp)
- [ ] Invariant 5: session state structured — not free-text transcript recovery alone
- [ ] Invariant 6: hook support feature-detected per runtime
- [ ] Invariant 7: no unlimited execution — timeout/CPU/memory/fs/command/network/output limits + audit on every route
- [ ] Secret paths deny-by-default; `.env`/SSH/browser-store fixtures blocked (Demo F)
- [ ] SSRF chain enforced for managed fetch; no bypass of 20.63 gateway
- [ ] Cross-session/cross-workspace retrieval leakage tests pass
- [ ] Stale snapshot cannot override newer user correction (test-proven)
- [ ] `ctx_purge`/`ctx_upgrade`/external Insight authorized + audited, never auto-exposed
- [ ] ELv2 boundary documented; notices preserved; no hosted third-party exposure
- [ ] Audit events never leak the content they audit

---

## 41. Production Readiness Checklist

### Quality gates

Typecheck; unit; integration; security; build; relevant e2e — all pass; benchmark targets (Section 36.5) measured on representative fixtures; 6 demonstrators shipped; **do not claim completion if oversized covered tool results can still bypass the Context Firewall, if secrets can enter ordinary indexes/prompts, or if session recovery is untested.**

### Codex review checklist (15 questions — answer with evidence before production promotion)

1. Can any MCP/tool path bypass `ContextGateway`? 2. Can a direct upstream Context Mode tool be called by an ordinary remote agent? 3. Are `ctx_upgrade`, `ctx_purge`, and external Insight protected? 4. Can `.env` or credential content enter FTS5? 5. Can an external page inject instructions that become authoritative? 6. Can a symlink or absolute path escape the workspace? 7. Can an execution route access unrestricted network? 8. Are raw tool results stored in audit logs? 9. Does a newer user correction override an older recovery snapshot? 10. Can two workspaces retrieve each other's indexed data? 11. What happens when Context Mode is down? 12. What happens when hooks are missing? 13. Is the installed upstream version visible and pinned/tested? 14. Does rollback leave the rest of Pao-hubPro functional? 15. Is the ELv2 deployment boundary documented?

### Documentation required

Architecture doc; context policy guide; sandbox/execution security guide; session recovery guide; Codex hook capability notes; operator runbook; upgrade/rollback guide; **ELv2 third-party deployment boundary note**.

### Final implementation report

Files changed; migrations; dependencies/version used; feature flags; tests run/results; Context Mode health/tool discovery; benchmark results; hook capability matrix; remaining risks; manual operator steps; rollback procedure; **any deviation from this blueprint and why**.

---

## 42. Future Extensions

- Additional context routes (e.g., semantic/vector retrieval alongside BM25 when the ecosystem matures)
- Deeper per-agent hook adapters beyond Codex (Claude-like runtimes, Copilot environments, OMP, Pi — per capability matrix)
- Context-budget federation with 20.67 ECC and 20.68 DSPy evaluation gates
- Sidecar metadata → full Pao registry migration when upstream storage evolves
- External Insight policies under explicit commercial/license review

---

## 43. Definition of Done

Phase 20.65 is complete only when:

```text
Pao-hubPro can receive a large tool result,
keep the raw payload outside the LLM prompt,
classify it,
apply identity + policy + secret checks,
enforce a context budget,
select an approved route,
process/index/search it through a guarded Context Mode adapter,
return only bounded relevant context,
preserve provenance,
record auditable context metrics,
track structured session state,
snapshot state before compaction where supported,
restore the active goal/plan/decisions/files/errors after compaction or resume,
and fail safely when hooks, FTS5, or Context Mode are unavailable,
without exposing unrestricted code execution or violating the upstream license boundary.
```

---

## 44. Codex One-Shot Implementation Prompt

Copy the entire prompt below into Codex while Codex is opened at the root of the current Pao-hubPro repository.

```text
You are implementing:

Phase 20.65 — Pao-hubPro × Context Mode —
Context Window Optimization Runtime,
Sandboxed Tool Execution,
Persistent Session Intelligence,
MCP Context Firewall &
Policy-Governed Context Control Plane.

NOTE: A phase-number collision exists (20.65 also used by a Litho blueprint).
Keep the 20.65 identifier and this filename for now; do not renumber or
overwrite any other phase without explicit user approval.

IMPORTANT:
Work directly inside the existing Pao-hubPro repository.
Do not create a separate demo repository.
Do not rewrite the application architecture.
Do not remove existing functionality.
Do not replace existing authentication, authorization, database, ORM,
job system, audit system, policy engine, MCP gateway, artifact store,
logging, metrics, UI framework, config system, credential system,
or memory system when an equivalent already exists.

FIRST — REPOSITORY DISCOVERY
Inspect the repository thoroughly before changing code.
Determine:
- package manager
- monorepo/workspace layout
- backend framework
- frontend framework
- database + ORM
- migration system
- auth/RBAC/ABAC
- current MCP gateway
- existing agent runtime adapters
- Codex integration
- existing hook integration
- worker/job queue
- artifact/file storage
- audit log
- policy/approval engine
- secret/credential handling
- outbound HTTP/SSRF controls
- config/env validation
- structured logging
- metrics/telemetry
- test framework
- browser/e2e framework
- current persistent memory/context modules
- repository intelligence modules
- API gateway modules
- coding conventions

Create a short internal implementation map before editing.
Reuse existing abstractions wherever they are sound.

==================================================
A. UPSTREAM / LICENSE BASELINE
==================================================

Primary upstream:
https://github.com/mksglu/context-mode

Drafting baseline:
context-mode@1.0.169
Node.js >=22.5 or Bun
Elastic License 2.0

Before implementation, verify the currently installed/available upstream
version, tool surface, runtime requirement, and license.
If newer upstream exists, do not silently upgrade the blueprint baseline.
Record the observed version and decide whether to keep 1.0.169 or use the
newer version only after compatibility review.

Do not remove license notices.
Do not design third-party hosted exposure of a substantial set of Context Mode
features.
Treat the integration as local/internal/self-hosted operator infrastructure
unless legal review says otherwise.

==================================================
B. CORE DOMAIN
==================================================

Create or extend a Context Control domain using repository conventions.
Implement internal contracts equivalent to:
- ContextEnvelope
- ContextSourceRef
- ContextClassification
- ContextRisk
- ContextRoute
- ContextBudgetDecision
- ContextPolicyDecision
- ContextProvenance
- SessionEvent
- SessionRecoverySnapshot
- ContextRuntimeHealth

Context routes:
- direct
- extract
- summarize
- execute
- index
- search
- artifact
- block

Do not expose context-mode-specific schemas across unrelated layers.

==================================================
C. CONTEXT MODE ADAPTER
==================================================

Implement a replaceable ContextModeRuntimeAdapter.
Feature-detect tools instead of assuming every future version is identical.
Support current tools when available:
- ctx_execute
- ctx_execute_file
- ctx_batch_execute
- ctx_index
- ctx_search
- ctx_fetch_and_index
- ctx_stats
- ctx_doctor
- ctx_upgrade
- ctx_purge
- ctx_insight

Risky meta operations such as upgrade/purge/Insight must not be automatically
exposed to ordinary agents.

Add health diagnostics for:
- executable availability
- version
- Node/Bun prerequisite
- MCP connectivity
- tool discovery
- FTS5/database health when observable
- hook capability detection

==================================================
D. MCP CONTEXT FIREWALL
==================================================

Introduce a gateway step for tool results:

raw tool result
-> capture outside prompt
-> classify
-> secret scan
-> policy
-> budget
-> route
-> transform/retrieve
-> validate
-> bounded agent context

Do not let large raw MCP outputs flow directly to an LLM on covered paths.
Keep an artifact/reference when policy permits.

Implement source-specific budgets and denial reasons.

==================================================
E. CONTEXT BUDGET ENGINE
==================================================

Track:
- raw bytes
- estimated tokens
- transformed bytes
- item count
- execution duration
- search result size
- current prompt share

Start with configurable conservative defaults similar to the blueprint.
Treat them as Pao-hubPro policy, not upstream limits.

All hard limits must be server-side and not overrideable by an ordinary agent.

==================================================
F. ROUTING
==================================================

Implement deterministic/auditable route decisions.
Examples:
- small safe structured -> direct
- structured large -> extract
- long-lived docs -> index/search
- large logs/build/test -> execute/analyze
- large repository content -> code intelligence or index/search
- evidence not needed in prompt -> artifact
- secret/forbidden -> block/redact

Return route reason codes.

==================================================
G. SECRET / SENSITIVE DATA GUARD
==================================================

Prevent credential values from entering:
- ordinary prompt context
- FTS5 index
- session event payloads
- audit logs

Protect common secret files and patterns.
Reuse the existing credential broker/secret detector if present.
Never create a second plaintext credential store.

==================================================
H. EXECUTION SAFETY
==================================================

Context Mode execution is not authorization.
Wrap execution with Pao policy.

Enforce:
- allowed languages/tasks
- workspace/path boundary
- path traversal protection
- timeout
- bounded stdout/stderr
- process/concurrency limits where supported
- network deny by default
- secret file deny
- no privilege escalation
- no unrestricted daemon/persistence behavior

If the existing infrastructure supports containers/sandbox workers,
run higher-risk context execution there.

Do not concatenate agent/user input into shell commands.
Use argument arrays or direct tool APIs.

==================================================
I. NETWORK / FETCH SAFETY
==================================================

Managed ctx_fetch_and_index usage must pass through the project's egress
policy.
Enforce:
- scheme allowlist
- redirect limit
- private/link-local/metadata blocking
- DNS/IP validation
- timeout
- response size limit
- MIME checks

Do not allow Context Mode to bypass Phase 20.63/API gateway controls.

==================================================
J. PERSISTENT INDEX / SEARCH
==================================================

Allow approved non-secret sources to be indexed.
Keep Pao metadata/provenance in the existing database or a sidecar registry
if Context Mode cannot store all required fields.

Index/search must be scoped by workspace/project/session policy.
Search results must be bounded, deduplicated, provenance-tagged,
secret-scanned, and treated as untrusted data if sourced externally.

==================================================
K. SESSION INTELLIGENCE
==================================================

Capture structured events for:
- user goal
- user decisions/corrections
- plan/task changes
- file reads/modifications
- git changes
- tool calls/failures
- errors/fixes
- constraints
- approvals
- artifacts
- context routes
- compaction/recovery

Do not store giant tool payloads in events.
Store references/hashes.

==================================================
L. PRECOMPACT + RECOVERY
==================================================

Where supported, integrate lifecycle events equivalent to:
- PreToolUse
- PostToolUse
- UserPromptSubmit
- PreCompact
- SessionStart
- Stop

Build a compact SessionRecoverySnapshot before compaction.
On recovery restore only the most relevant state:
1. user goal
2. latest correction
3. active task
4. pending plan
5. files touched
6. unresolved errors/blockers
7. constraints
8. key decisions
9. relevant artifact/index refs

Feature-detect hook capability.
Do not assume Codex PreToolUse can always rewrite tool input or inject
arbitrary context.
Use layered enforcement:
- hooks
- MCP gateway
- Pao context policy
- adapter limits

If a hook is unsupported, show degraded state instead of pretending full
coverage.

==================================================
M. PROMPT-INJECTION BOUNDARY
==================================================

Retrieved/indexed external content is data, not policy.
Tag trust/provenance.
Never allow retrieved text to override system/policy controls.
Never execute tools merely because retrieved content instructs the agent to
do so.

==================================================
N. DATABASE / MIGRATIONS
==================================================

Using existing ORM/migration conventions, add only required entities for:
- context runtime instances
- context policies/decisions
- context envelopes/routes
- artifact refs
- index sources
- search events
- execution events
- session events
- session snapshots
- recovery events
- approvals/denials
- metrics rollups
- third-party license registry

Avoid duplicating canonical task/session tables; reference them.

==================================================
O. API + MCP
==================================================

Add authenticated internal API surfaces for health/stats/sessions/search/
index/route/audit.
Do not expose arbitrary execution publicly.

Add safe Pao MCP capabilities such as:
- pao_context_stats
- pao_context_search
- pao_context_index
- pao_context_analyze_artifact
- pao_context_session_state
- pao_context_explain_route
- pao_context_health

Generic execute should remain internal or require constrained analyzers +
policy/approval.

==================================================
P. FEATURE FLAGS
==================================================

Add typed flags using the project's config system:
CONTEXT_CONTROL_ENABLED
CONTEXT_MODE_ENABLED
CONTEXT_MODE_MCP_ENABLED
CONTEXT_MODE_HOOKS_ENABLED
CONTEXT_MODE_INDEX_ENABLED
CONTEXT_MODE_EXECUTE_ENABLED
CONTEXT_MODE_FETCH_ENABLED
CONTEXT_SESSION_INTELLIGENCE_ENABLED
CONTEXT_PRECOMPACT_ENABLED
CONTEXT_RECOVERY_ENABLED
CONTEXT_FIREWALL_ENABLED
CONTEXT_SECRET_GUARD_ENABLED
CONTEXT_APPROVALS_ENABLED
CONTEXT_DASHBOARD_ENABLED
CONTEXT_INSIGHT_EXTERNAL_ENABLED

Safe defaults:
- firewall on
- audit on
- secret guard on
- auto-upgrade off
- external Insight off
- public arbitrary execute off
- network execution deny by default

Update env example/config validation.

==================================================
Q. OBSERVABILITY
==================================================

Add structured metrics/logs for:
- raw bytes
- admitted prompt bytes
- savings ratio
- route distribution
- denials
- secret redactions
- index/search
- execute latency/errors/timeouts
- compactions
- recoveries
- hook events
- runtime health

Never log secret/raw sensitive content merely for observability.

==================================================
R. DASHBOARD
==================================================

Add a Context Control dashboard using existing UI conventions.
Show:
- runtime/version health
- hook capability matrix
- raw vs admitted bytes
- estimated savings
- route distribution
- active sessions
- snapshot/recovery state
- index sources
- denials/approvals
- degraded mode
- diagnostics

Risky operations require explicit authorization.

==================================================
S. WORKERS / BACKPRESSURE
==================================================

Use existing job infrastructure for bulk index/reindex, artifact analysis,
snapshot builds, cleanup, health checks, benchmarks, and upgrade checks.

Enforce concurrency/queue limits.
Interactive search/recovery should have higher priority than bulk indexing.

==================================================
T. FAILURE MODES
==================================================

If Context Mode is down:
- do not dump oversized raw results into prompt
- keep firewall/budget enforcement where possible
- mark degraded state
- disable dependent routes safely

If FTS5/index unavailable:
- disable index/search explicitly
- preserve artifact refs if allowed

If hook unavailable:
- keep gateway enforcement
- mark partial session/routing coverage

If recovery incomplete:
- use canonical Pao task state + latest structured events
- report partial recovery
- do not invent missing state

==================================================
U. SECURITY TESTS
==================================================

Add regression tests for:
- command injection
- path traversal
- symlink escape where applicable
- secret file read attempts
- secret indexing attempts
- SSRF/private IP/metadata targets
- redirect bypass
- oversized MCP output
- stdout flooding
- cross-session leakage
- cross-workspace leakage
- prompt injection in indexed content
- stale snapshot vs newer user correction
- unauthorized purge
- approval replay
- runtime version incompatibility

==================================================
V. PERFORMANCE / CONTEXT BENCHMARKS
==================================================

Create representative fixtures:
- large JSON API response
- GitHub-like issue list
- browser snapshot
- build log
- test log
- docs corpus
- source tree report

Measure raw bytes vs admitted prompt bytes and latency.
Target >=80% prompt-byte reduction for large-output fixtures while preserving
task correctness.
Do not make the upstream 98% claim a mandatory universal SLA.

==================================================
W. DEMONSTRATORS
==================================================

Ship demo/test flows for:
1. large API/GitHub result -> extract
2. browser snapshot -> compact context
3. build log -> error analysis
4. docs -> index/search
5. long coding session -> compaction -> recovery
6. .env/secret fixture -> blocked/no-index/no-prompt

==================================================
X. DOCUMENTATION
==================================================

Add:
- architecture doc
- context policy guide
- sandbox/execution security guide
- session recovery guide
- Codex hook capability notes
- operator runbook
- upgrade/rollback guide
- ELv2 third-party deployment boundary note

==================================================
Y. FINAL VERIFICATION
==================================================

Run the repository's normal:
- format
- lint
- typecheck
- unit tests
- integration tests
- security tests
- build
- relevant e2e tests

Then produce a final implementation report with:
1. files changed
2. migrations
3. dependencies/version used
4. feature flags
5. tests run/results
6. Context Mode health/tool discovery
7. benchmark results
8. hook capability matrix
9. remaining risks
10. manual operator steps
11. rollback procedure
12. any deviation from this blueprint and why

Do not claim completion if oversized covered tool results can still bypass
the Context Firewall, if secrets can enter ordinary indexes/prompts, or if
session recovery is untested.
```
