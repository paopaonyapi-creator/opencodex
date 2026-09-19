# Phase 20.94 — Pao-hubPro × ENZO
## Unified Self-Hosted AI Workspace, BYOK Model Marketplace, Self-Drafting Agent Factory, Automatic Skill Composition, Adaptive Agent Memory, Budget-Governed Deep Research, Live Coding Workspace & Policy-Governed Personal AI Operating Plane

> **Project:** Pao-hubPro  
> **Phase:** 20.94  
> **Status:** Architecture + implementation specification  
> **Primary inspiration:** ENZO (`theguysudo/ENZO`)  
> **Integration strategy:** Adopt patterns and UX concepts; do **not** make ENZO a hard runtime dependency.  
> **Target:** Turn the existing Pao-hubPro capability stack into one coherent, self-hosted AI operating workspace that can discover models, compose agents and skills, research, code, execute tools, remember outcomes, and enforce policy from a single control plane.

---

## 0. Executive Summary

Phase 20.94 converts Pao-hubPro from a collection of powerful subsystems into a unified **Personal AI Operating Plane**.

The key idea borrowed from ENZO is not "another chat UI". The valuable pattern is a workspace where model access, agent creation, skills, research, coding, memory, credentials, execution state, and observability are visible through one product surface.

Pao-hubPro already owns stronger specialist components in many of these areas. Therefore this phase must **compose** existing phases rather than replace them.

### Core composition

```text
User / Operator
      |
      v
+----------------------------------------------------------+
|                 PAO-HUBPRO AI WORKSPACE                  |
| Chat | Models | Agents | Skills | Research | Code | Ops |
+--------------------------+-------------------------------+
                           |
                           v
                  Intent / Task Compiler
                           |
            +--------------+--------------+
            |                             |
            v                             v
      Agent Blueprint                Task Profile
      (Forge-based)             risk/cost/latency/context
            |                             |
            +--------------+--------------+
                           v
                  Skill Composition Engine
                           |
                           v
                  Policy / Approval Gate
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
         OmniRoute      MCPProxy      BrowserSkill
         Models         Tools         Browser Runtime
             |             |             |
             +------+------+-------------+
                    |
                    v
              Execution Runtime
        Codex / AFT / Herdr / Apra Fleet
                    |
                    v
            Artifacts + Observations
                    |
                    v
      OpenViking / Context / Memory Layer
                    |
                    v
          Lesson Distillation / Replay
```

### Phase 20.94 must deliver

1. Unified AI workspace shell.
2. BYOK-aware model marketplace backed by OmniRoute.
3. Self-drafting agent factory backed by Forge.
4. Automatic skill composition backed by SkillsGate + Skill Registry.
5. Adaptive memory and lesson distillation backed by existing memory phases.
6. Budget-governed deep research runtime.
7. Live coding workspace backed by Codex + AFT + review/fix gates.
8. Credential brokerage without exposing long-lived secrets to agents.
9. A single policy, approval, audit, and replay plane.
10. Observable end-to-end task runs with cost, model, tool, memory, and artifact provenance.

---

# 1. Source Baseline: What We Are Taking From ENZO

At the time this phase was drafted, the ENZO repository advertises the following product patterns:

- Unified catalog of 300+ models across 9 providers.
- 74 bundled injectable skills.
- Two-pass self-drafting agent builder.
- Agent learning / neural layer that periodically distills activity into agent memory.
- Deep research loop with hard budgets.
- Coding mode that creates, boots, previews, and diagnoses generated projects.
- Browser-side encrypted provider-key vault with optional passphrase mode.
- Docker-first self-hosting.
- CI security checks, unit/security tests, black-box pentesting, dependency audits, and keyless boot verification.

Reference repository:

- https://github.com/theguysudo/ENZO
- https://github.com/theguysudo/ENZO/blob/main/docs/SECURITY.md

### Architectural interpretation for Pao-hubPro

We adopt the following ENZO concepts:

```text
ENZO concept                     -> Pao-hubPro implementation
-----------------------------------------------------------------------
Unified workspace                -> Pao Workspace Shell
Model catalog                    -> OmniRoute Model Marketplace
Self-drafting agent              -> Forge Agent Factory
Injectable skills                -> Skill Registry + SkillsGate Composer
Agent neural memory              -> Memory Distiller + OpenViking/Context
Research loop                    -> Budget-Governed Research Runtime
Coding preview                   -> Codex/AFT Live Workspace
BYOK vault                       -> Scoped Credential Broker
Security gates                   -> Unified Policy + Audit + Approval Plane
Docker self-hosting              -> paohub up / compose profile
```

### Explicit non-goal

**Do not vendor ENZO as the central Pao-hubPro runtime.**

This phase treats ENZO as a reference architecture and UX inspiration. Existing Pao-hubPro systems remain canonical where they overlap.

---

# 2. Why This Phase Exists

Pao-hubPro has accumulated high-value capabilities across many phases:

- provider routing;
- MCP federation;
- browser execution;
- coding agents;
- code review;
- skill registries;
- prompt compilation;
- persistent memory;
- multi-agent orchestration;
- runtime recovery;
- policy gates;
- artifact transfer;
- capability marketplaces.

The risk is fragmentation.

Without a unifying workspace, the operator still has to know:

- which agent to start;
- which provider to choose;
- which model has the right capability;
- which skills to attach;
- which MCP server to call;
- how much budget is safe;
- which memory source matters;
- whether the run is allowed;
- how to inspect failures;
- where artifacts are stored;
- which phase owns a feature.

Phase 20.94 removes this operational burden.

The user gives **intent**. Pao-hubPro compiles the correct execution plan.

---

# 3. Product Vision

## 3.1 One workspace, one mental model

The operator should think in terms of:

```text
ASK -> PLAN -> EXECUTE -> VERIFY -> LEARN
```

not:

```text
pick model -> pick MCP -> pick skill -> start agent -> find logs -> retry -> save memory
```

## 3.2 Core UI surfaces

The Phase 20.94 workspace should expose seven primary surfaces:

| Surface | Purpose |
|---|---|
| **Terminal / Chat** | Primary natural-language interaction and run stream |
| **Models** | Capability-aware model marketplace and provider health |
| **Agents** | Build, version, inspect, run, and retire agent blueprints |
| **Skills** | Discover, trust-score, install, compose, and inspect skills |
| **Research** | Evidence-backed research runs with hard budgets |
| **Code** | Repository-aware coding workspace, preview, test, review, fix |
| **Operations** | Runs, approvals, cost, failures, audit, replay, secrets, health |

Optional secondary surfaces:

- Memory
- Browser Sessions
- MCP Connections
- Artifacts
- Automations
- Provider Vault
- Policy Console

---

# 4. High-Level Architecture

```text
+======================================================================+
|                        PAO-HUBPRO WORKSPACE                            |
|                                                                      |
|  Chat   Models   Agents   Skills   Research   Code   Operations      |
+==============================+=======================================+
                               |
                               v
+----------------------------------------------------------------------+
|                    INTENT & TASK COMPILATION LAYER                    |
|  - intent classifier                                                   |
|  - task complexity                                                     |
|  - capability requirements                                             |
|  - context requirements                                                |
|  - risk classification                                                 |
|  - cost/latency target                                                 |
+-------------------------------+--------------------------------------+
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
+-----------------------------+       +-------------------------------+
| FORGE AGENT FACTORY         |       | SKILL COMPOSITION ENGINE      |
| - 2-pass drafting           |       | - semantic skill match        |
| - persona / objective       |       | - dependency resolution       |
| - constraints               |       | - trust / policy filtering    |
| - completion criteria       |       | - context-budget packing      |
+--------------+--------------+       +---------------+---------------+
               |                                      |
               +-------------------+------------------+
                                   v
+----------------------------------------------------------------------+
|                   POLICY + APPROVAL CONTROL PLANE                    |
| risk | scopes | secrets | filesystem | browser | network | spend     |
+--------------------------+-------------------------------------------+
                           |
       +-------------------+-------------------+-------------------+
       |                   |                   |                   |
       v                   v                   v                   v
+-------------+     +-------------+     +-------------+     +-------------+
| OmniRoute   |     | MCPProxy    |     | BrowserSkill|     | File/Host   |
| model plane |     | tool plane  |     | web plane   |     | local plane |
+------+------+     +------+------+     +------+------+     +------+------+
       |                   |                   |                   |
       +-------------------+-------------------+-------------------+
                           |
                           v
+----------------------------------------------------------------------+
|                     EXECUTION / AGENT RUNTIME                         |
| Codex | AFT | Herdr | Apra Fleet | Clodex | task DAG | recovery      |
+--------------------------+-------------------------------------------+
                           |
                           v
+----------------------------------------------------------------------+
|                 VERIFICATION + QUALITY GATES                          |
| tests | OpenCodeReview | Bug Hunter | artifact checks | policy checks |
+--------------------------+-------------------------------------------+
                           |
                           v
+----------------------------------------------------------------------+
|                     MEMORY + LEARNING PLANE                           |
| OpenViking | Context Mode | session summaries | lesson distillation   |
+--------------------------+-------------------------------------------+
                           |
                           v
+----------------------------------------------------------------------+
|                     AUDIT / REPLAY / OBSERVABILITY                    |
| events | traces | cost | approvals | model provenance | artifacts     |
+----------------------------------------------------------------------+
```

---

# 5. Design Principles

## P1 — Compose, do not duplicate

If a previous phase already owns a capability, Phase 20.94 must call it through a stable interface rather than create a competing subsystem.

## P2 — Intent first

The operator describes the outcome. The system determines model, agent, skills, tools, memory, and execution posture.

## P3 — Human approval at irreversible boundaries

Human approval is required for high-impact actions such as:

- sending messages;
- publishing content;
- deleting or overwriting important files;
- destructive shell commands;
- account permission changes;
- financial actions;
- external production deployment;
- secret rotation;
- high-cost run escalation.

## P4 — Secrets are leased, not handed out

Agents receive capability-scoped credential access, never unrestricted vault dumps.

## P5 — Every run is replayable

A task run must preserve enough metadata to answer:

- what was requested;
- what plan was generated;
- which model ran each step;
- which skills were injected;
- which tools were called;
- what memory was loaded;
- what approvals were given;
- what files changed;
- what tests ran;
- what the run cost;
- why the final result was accepted.

## P6 — Learning must be controlled

Memory is not automatically trusted merely because an agent wrote it. Learned facts and procedures require provenance and confidence.

## P7 — Budget is a first-class policy object

Every research/coding/agent run can have ceilings for:

- time;
- tokens;
- provider spend;
- number of tool calls;
- number of search queries;
- number of browser actions;
- number of spawned agents;
- filesystem writes;
- retry count.

---

# 6. Module 20.94-A — Unified AI Workspace Shell

## Objective

Create one front-end workspace that consumes Pao-hubPro capabilities through stable backend APIs.

## Required routes

```text
/
/chat
/models
/agents
/skills
/research
/code
/operations
/memory
/artifacts
/settings/providers
/settings/policies
```

## Global command palette

Suggested shortcut:

```text
Ctrl/Cmd + K
```

Commands:

```text
New task
New research run
New coding run
Create agent
Search skills
Open model marketplace
Open active browser session
Open approval queue
Open last failed run
Open cost dashboard
```

## Workspace session header

Every active run should show:

```text
Run ID
Mode
Agent
Model / provider
Skills
Policy profile
Budget consumed
Current stage
Approval state
Artifacts
```

## UX requirement

The UI should expose automation power without forcing the operator to understand internal phase numbers.

Phase numbers are visible in diagnostics/developer mode only.

---

# 7. Module 20.94-B — BYOK Model Marketplace

## Ownership

Canonical routing backend: **OmniRoute**.

Phase 20.94 owns presentation, discovery, policy integration, and run-time selection UX.

## Model record

```ts
interface ModelRecord {
  id: string;
  provider: string;
  displayName: string;
  modalities: Array<'text' | 'vision' | 'audio' | 'image' | 'video'>;
  capabilities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  latencyClass?: 'ultra-low' | 'low' | 'normal' | 'slow';
  costClass?: 'free' | 'low' | 'medium' | 'high';
  privacyClass?: 'local' | 'direct-provider' | 'gateway';
  health: 'healthy' | 'degraded' | 'offline' | 'unknown';
  healthCheckedAt?: string;
  trustScore?: number;
  benchmarkRefs?: string[];
  tags: string[];
}
```

## Selection logic

```text
Task requirements
      |
      v
Capability filter
      |
      v
Policy filter
      |
      v
Availability / health filter
      |
      v
Context-window validation
      |
      v
Cost + latency objective
      |
      v
Candidate set
      |
      v
OmniRoute selection / race / fallback
```

## Mandatory behavior

- Never route to an unhealthy model if a healthy compatible model exists.
- Record the **actual** model/provider used, not merely the requested alias.
- Support fallback chains.
- Support local-only policies.
- Support max-cost policies.
- Support provider allow/deny lists.
- Surface rate-limit/degradation state.

## Example route policy

```yaml
profile: balanced-coding
requirements:
  modalities: [text]
  tools: true
  structured_output: true
preferences:
  reasoning: high
  latency: normal
constraints:
  max_cost_usd: 0.75
  deny_providers: []
  local_only: false
fallback:
  max_attempts: 3
```

---

# 8. Module 20.94-C — Scoped Credential Broker

## Goal

Give Pao-hubPro the BYOK convenience of ENZO without exposing long-lived master credentials to arbitrary agents or generated code.

## Threat model

Protect against:

- prompt injection requesting secrets;
- generated code reading environment variables;
- browser page exfiltration;
- MCP server overreach;
- agent logs capturing keys;
- malicious skill definitions;
- accidental secret persistence in artifacts;
- plugin/extension compromise where feasible.

## Credential flow

```text
Vault
  |
  v
Credential Broker
  |
  +--> policy check
  |
  +--> task/run binding
  |
  +--> scope binding
  |
  +--> TTL
  |
  +--> usage limits
  |
  v
Ephemeral Credential Lease
  |
  v
Provider / MCP / Connector call
```

## Lease schema

```ts
interface CredentialLease {
  leaseId: string;
  secretRef: string;
  runId: string;
  principal: string;
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  maxUses?: number;
  provider?: string;
  resourceAllowlist?: string[];
}
```

## Rules

1. Never expose all stored provider keys to an agent.
2. Do not place long-lived secrets in generated project environments.
3. Redact secrets from logs and traces.
4. Generated code receives an explicit environment allowlist.
5. Browser and code sandboxes must not share secret-bearing origins/state.
6. Secret reads/writes must be audited.
7. Credential leases expire automatically.

---

# 9. Module 20.94-D — Self-Drafting Agent Factory

## Ownership

Canonical prompt/agent compiler: **Forge**.

## Input

Natural-language task such as:

```text
Create an agent that researches Adobe Stock opportunities,
checks commercial usefulness and policy risks,
produces 20 concepts, then prepares prompts and metadata.
```

## Two-pass drafting model

### Pass 1 — Domain analysis

Derive:

- domain;
- required expertise;
- hidden/tacit knowledge;
- task stages;
- failure modes;
- edge cases;
- verification strategy;
- expected artifacts;
- required tools;
- required memories;
- permissions;
- budget profile.

### Pass 2 — Operating blueprint

Compile a structured Agent Blueprint.

```yaml
id: adobe-stock-research-agent
name: Adobe Stock Research Agent
version: 1
objective: >
  Find commercially useful Adobe Stock opportunities and convert
  evidence into production-ready concept packages.

instructions:
  - Research evidence before committing to a niche.
  - Separate observed evidence from inference.
  - Reject concepts with unclear commercial use.
  - Run policy checks before final output.

inputs:
  - market_scope
  - asset_type
  - target_count

required_capabilities:
  - web_research
  - image_reasoning
  - metadata_generation

skill_intents:
  - stock-research
  - adobe-stock-policy
  - prompt-engineering
  - metadata
  - commercial-review

memory:
  namespaces:
    - adobe-stock/portfolio
    - adobe-stock/rejections
    - adobe-stock/accepted-patterns

budgets:
  max_cost_usd: 2.00
  max_queries: 25
  max_tool_calls: 80
  max_runtime_minutes: 30

approval:
  publish: required
  filesystem_write: scoped

completion:
  require:
    - evidence_summary
    - concept_list
    - risk_check
    - prompts
    - metadata
```

## Blueprint provenance

Store:

```text
blueprint version
compiler version
model actually used
skills used during drafting
source prompt
creation timestamp
manual edits
review status
```

## Versioning

Agent blueprints are immutable once executed.

Edits create a new version.

---

# 10. Module 20.94-E — Automatic Skill Composition Engine

## Goal

Automatically select the minimum useful skill set for the task.

## Inputs

- user intent;
- agent blueprint;
- task graph;
- current repository/workspace;
- model context budget;
- policy profile;
- installed skill registry;
- trust score;
- historical success data.

## Resolution pipeline

```text
Intent
  |
  v
Candidate retrieval
  |
  v
Semantic relevance
  |
  v
Capability dependency expansion
  |
  v
Policy / trust filter
  |
  v
Conflict detection
  |
  v
Context-budget optimizer
  |
  v
Composition plan
```

## Skill manifest

```yaml
id: mcp-developer
version: 3.2.0
name: MCP Developer
summary: Build and review MCP servers and clients.
intents:
  - build-mcp
  - debug-mcp
  - review-mcp
capabilities:
  - code
  - protocol-design
  - testing
requires:
  - typescript-pro
optional:
  - security-reviewer
allowed_tools:
  - filesystem.read
  - filesystem.write.scoped
  - shell.scoped
risk:
  level: medium
trust:
  provenance: curated
  score: 0.96
context:
  estimated_tokens: 6200
```

## Conflict handling

Examples:

```text
Skill A says use npm
Skill B says use pnpm
```

The composer must not silently inject contradictory operating rules.

Resolution order:

1. workspace policy;
2. project-local rules;
3. agent blueprint;
4. higher-trust skill;
5. explicit operator override.

## SkillsGate integration

Every composed skill set must pass:

- source trust;
- manifest validation;
- forbidden instruction patterns;
- tool scope validation;
- executable-content policy;
- dependency integrity;
- license metadata check;
- version pinning.

---

# 11. Module 20.94-F — Adaptive Agent Memory

## Objective

Allow agents to improve from actual work without turning previous mistakes into permanent truth.

## Memory layers

```text
L0 Working Context
   current run only

L1 Session Memory
   task summaries, temporary observations

L2 Project Memory
   repository conventions, decisions, architecture

L3 Agent Memory
   domain-specific lessons and heuristics

L4 User/Workspace Memory
   stable preferences and approved operating rules

L5 Evidence Store
   source-backed facts and artifacts
```

## Lesson distillation

After a run:

```text
Run events
   |
   +--> successes
   +--> failures
   +--> retries
   +--> human corrections
   +--> test results
   +--> review findings
   +--> final artifacts
          |
          v
   Lesson Distiller
          |
          v
 Candidate lessons
          |
          v
 Confidence / provenance scoring
          |
     +----+----+
     |         |
   accept    quarantine
     |
     v
 Memory store
```

## Lesson schema

```ts
interface AgentLesson {
  id: string;
  agentId: string;
  domain: string;
  statement: string;
  evidenceRefs: string[];
  runRefs: string[];
  confidence: number;
  status: 'candidate' | 'accepted' | 'quarantined' | 'retired';
  createdAt: string;
  lastValidatedAt?: string;
  expiresAt?: string;
}
```

## Rules

- Human correction outranks self-generated inference.
- Failed runs may produce lessons, but only with explicit failure provenance.
- Model-generated guesses must not become durable facts automatically.
- Time-sensitive facts receive expiration/revalidation metadata.
- Sensitive memories inherit access control from their source.

---

# 12. Module 20.94-G — Budget-Governed Deep Research

## Goal

Build an iterative research agent that can decide what to search next while remaining bounded by hard budgets.

## Research state machine

```text
DEFINE QUESTION
      |
      v
CREATE RESEARCH PLAN
      |
      v
GENERATE QUERIES
      |
      v
SEARCH / FETCH
      |
      v
EXTRACT EVIDENCE
      |
      v
ASSESS COVERAGE
  +---+---+
  |       |
ENOUGH?  GAP?
  |       |
 yes     no
  |       |
  v       +--> next query cycle
SYNTHESIZE
  |
  v
VERIFY CLAIMS
  |
  v
FINAL + SOURCE MAP
```

## Research budget object

```yaml
max_queries: 30
max_sources: 60
max_fetches: 50
max_tool_calls: 120
max_tokens: 250000
max_cost_usd: 4.00
max_runtime_minutes: 45
max_parallel_workers: 5
max_retry_per_source: 1
```

## Stop conditions

Stop when any of the following is true:

- coverage threshold achieved;
- confidence threshold achieved;
- no material unresolved gaps;
- budget exhausted;
- policy blocks further retrieval;
- operator cancels run.

## Output requirements

Every research run should preserve:

```text
research question
query history
sources considered
sources rejected + reason
evidence fragments
claim -> source mapping
uncertainties
conflicts between sources
budget usage
model provenance
```

## Escalation strategy

```text
cheap model -> query generation
fast model  -> source triage
strong model -> synthesis / conflict resolution
review model -> final claim verification
```

OmniRoute should own the actual provider selection.

---

# 13. Module 20.94-H — Live Coding Workspace

## Ownership

Use existing Pao-hubPro coding stack:

- Codex Native Runtime;
- CortexKit AFT;
- Claude Code best-practice phase;
- OpenCodeReview;
- Agentic Bug Hunter;
- Clodex where applicable;
- Herdr / Apra Fleet for multi-agent or remote execution.

## User experience

```text
Request
  |
  v
Repository scan
  |
  v
Plan
  |
  v
Edit transaction
  |
  v
Build / typecheck
  |
  v
Run
  |
  v
Preview
  |
  v
Tests
  |
  v
Review
  |
  +--> fail -> repair loop
  |
  v
Human diff approval where required
  |
  v
Commit / artifact
```

## Required panes

```text
Task
Plan
Repository tree
Diff
Terminal
Tests
Preview
Review findings
Artifacts
Run trace
```

## Sandbox rules

Generated or repository code must run in a constrained environment.

Default denied:

- unrestricted host filesystem;
- host secret environment;
- arbitrary LAN access;
- privileged containers;
- Docker socket;
- SSH agent socket;
- cloud credentials.

Grant capabilities explicitly through policy.

## Environment allowlist

Use allowlists, not blocklists.

Example:

```yaml
env_allowlist:
  - PATH
  - HOME
  - TMPDIR
  - LANG
  - TZ
  - NODE_ENV
  - PAOHUB_RUN_ID
  - PAOHUB_PROJECT_ID
```

Secrets should be injected through scoped connector calls or short-lived leases rather than inherited process environments whenever possible.

---

# 14. Module 20.94-I — Policy-Governed Execution Plane

## Risk classes

```text
R0 Read-only reasoning
R1 Read-only external retrieval
R2 Scoped local writes
R3 External side effects
R4 Destructive / credential / deployment actions
```

## Default approval matrix

| Action | Risk | Default |
|---|---:|---|
| Read repository | R0 | Auto |
| Query model | R0 | Auto within budget |
| Web research | R1 | Auto within policy |
| Read MCP resource | R1 | Auto if connector trusted |
| Write generated artifact to workspace | R2 | Auto in scoped directory |
| Edit source files | R2 | Auto or review depending profile |
| Run tests | R2 | Auto |
| Browser form fill | R3 | Preview/approval by policy |
| Send email/message | R3 | Human approval |
| Publish content | R3 | Human approval |
| Production deploy | R4 | Human approval |
| Delete persistent data | R4 | Human approval |
| Rotate/reveal secrets | R4 | Human approval |

## Policy decision object

```ts
interface PolicyDecision {
  decisionId: string;
  runId: string;
  action: string;
  risk: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  decision: 'allow' | 'deny' | 'require_approval';
  rulesMatched: string[];
  reason: string;
  expiresAt?: string;
}
```

---

# 15. Module 20.94-J — Observability, Cost, Audit & Replay

## Every run emits events

```text
run.created
run.planned
model.candidate_selected
model.request.started
model.request.completed
model.fallback
skill.resolved
skill.injected
policy.checked
approval.requested
approval.resolved
tool.called
tool.completed
browser.action
filesystem.read
filesystem.write
artifact.created
memory.read
memory.candidate_created
memory.accepted
test.started
test.completed
review.finding
run.failed
run.completed
```

## Run trace

Each event should include:

```ts
interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  type: string;
  actor: string;
  timestamp: string;
  parentEventId?: string;
  payload: Record<string, unknown>;
  redactions?: string[];
}
```

## Cost accounting

Track at minimum:

```text
input tokens
output tokens
cached tokens where known
provider cost
search/tool cost
image/video generation cost
GPU runtime cost
estimated local compute
```

## Replay modes

```text
inspect-only
re-run-same-plan
re-run-latest-models
re-run-from-stage
fork-run
```

Replays must not silently repeat irreversible side effects.

---

# 16. Integration Map With Existing Pao-hubPro Phases

Phase 20.94 is a composition layer.

| Existing capability | Role in 20.94 |
|---|---|
| **OmniRoute** | Canonical model/provider routing plane |
| **Forge** | Agent/prompt blueprint compiler |
| **Bubble** | Capability discovery / marketplace UX patterns |
| **SkillsGate** | Skill trust, validation, installation gates |
| **Prompt Master** | Prompt assets, templates, versioning |
| **MCPProxy** | Federated MCP discovery and execution gateway |
| **CortexKit AFT** | Repository perception + coding operations |
| **Codex Native Runtime** | Primary coding execution runtime |
| **OpenCodeReview** | Deterministic review gate |
| **Agentic Bug Hunter** | Failure discovery / repair support |
| **OpenViking** | Knowledge/memory source |
| **Context Mode** | Context selection/compaction plane |
| **Herdr** | Persistent multi-agent terminal/session runtime |
| **Apra Fleet** | Distributed agent fleet/control plane |
| **Tencent BrowserSkill** | Browser agent execution plane |
| **FileSync** | Cross-device artifact movement |
| **Agentic Signal** | Signals / event-based intelligence input |
| **Clodex** | Cross-agent coding integration where applicable |

## Rule

No new subsystem may duplicate one of the above without an explicit deprecation plan.

---

# 17. Canonical End-to-End Flow

Example request:

```text
Analyze this new GitHub repository, decide whether it is useful for
Pao-hubPro, and if useful prepare a new phase spec with architecture,
schema, checklist and implementation plan.
```

Flow:

```text
1. Workspace receives request
2. Intent compiler classifies:
   - research
   - repository analysis
   - architecture design
   - document generation

3. Task profile produced:
   risk = R1/R2
   expected artifacts = markdown
   research budget = medium

4. Skill Composer selects:
   - repository-analysis
   - architecture-designer
   - security-reviewer
   - technical-writer

5. Context layer retrieves:
   - latest Pao-hubPro phase registry
   - architecture conventions
   - previous integration patterns

6. OmniRoute chooses models by stage

7. MCP/GitHub/web tools gather evidence

8. Research runtime validates gaps

9. Forge creates integration blueprint

10. Policy gate approves local artifact write

11. Document artifact generated

12. Review model checks:
    - duplication
    - architecture conflict
    - security
    - unsupported claims

13. Final artifact stored

14. Lessons distilled:
    - reusable integration insight
    - repository fit
    - architecture decision

15. Run trace available in Operations
```

---

# 18. Data Model

Recommended canonical database: PostgreSQL for server state, with object/artifact storage separated where useful.

SQLite may remain valid for single-node development, but interfaces should not assume SQLite semantics.

## Core tables

### `models`

```sql
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]',
  modalities JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  health_status TEXT NOT NULL DEFAULT 'unknown',
  health_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `agents`

```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  blueprint JSONB NOT NULL,
  status TEXT NOT NULL,
  drafted_by_model TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slug, version)
);
```

### `skills`

```sql
CREATE TABLE skills (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  source_uri TEXT,
  trust_score NUMERIC,
  status TEXT NOT NULL,
  installed_at TIMESTAMPTZ,
  PRIMARY KEY(id, version)
);
```

### `runs`

```sql
CREATE TABLE runs (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  request_text TEXT NOT NULL,
  agent_id UUID,
  policy_profile TEXT,
  budget JSONB NOT NULL DEFAULT '{}',
  usage JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `run_events`

```sql
CREATE TABLE run_events (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id),
  seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, seq)
);
```

### `approvals`

```sql
CREATE TABLE approvals (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id),
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  status TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `agent_lessons`

```sql
CREATE TABLE agent_lessons (
  id UUID PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  statement TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]',
  run_refs JSONB NOT NULL DEFAULT '[]',
  confidence NUMERIC NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ
);
```

### `artifacts`

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES runs(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT NOT NULL,
  sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 19. API Surface

## Workspace

```text
POST   /api/v1/runs
GET    /api/v1/runs/:id
POST   /api/v1/runs/:id/cancel
POST   /api/v1/runs/:id/replay
GET    /api/v1/runs/:id/events
```

## Models

```text
GET    /api/v1/models
GET    /api/v1/models/:id
POST   /api/v1/models/route
POST   /api/v1/models/:id/health-check
```

## Agents

```text
GET    /api/v1/agents
POST   /api/v1/agents/draft
POST   /api/v1/agents
GET    /api/v1/agents/:slug/:version
POST   /api/v1/agents/:slug/:version/run
POST   /api/v1/agents/:slug/:version/fork
```

## Skills

```text
GET    /api/v1/skills
POST   /api/v1/skills/resolve
POST   /api/v1/skills/install
POST   /api/v1/skills/:id/review
```

## Research

```text
POST   /api/v1/research
GET    /api/v1/research/:runId
POST   /api/v1/research/:runId/extend-budget
```

## Coding

```text
POST   /api/v1/code/sessions
GET    /api/v1/code/sessions/:id
POST   /api/v1/code/sessions/:id/apply
POST   /api/v1/code/sessions/:id/test
POST   /api/v1/code/sessions/:id/review
POST   /api/v1/code/sessions/:id/approve
```

## Approvals

```text
GET    /api/v1/approvals
POST   /api/v1/approvals/:id/approve
POST   /api/v1/approvals/:id/deny
```

## Memory

```text
GET    /api/v1/memory/search
POST   /api/v1/memory/lessons/:id/accept
POST   /api/v1/memory/lessons/:id/quarantine
POST   /api/v1/memory/lessons/:id/retire
```

---

# 20. Recommended Repository Structure

```text
apps/
  workspace-web/
  gateway-api/

packages/
  workspace-shell/
  task-compiler/
  agent-factory/
  skill-composer/
  policy-engine/
  credential-broker/
  research-runtime/
  coding-workspace/
  memory-distiller/
  run-events/
  observability/
  artifact-registry/
  provider-contracts/
  tool-contracts/

integrations/
  omniroute/
  forge/
  skillsgate/
  mcpproxy/
  aft/
  codex/
  openviking/
  context-mode/
  herdr/
  apra-fleet/
  browser-skill/

config/
  policies/
  budgets/
  routing/
  agents/
  skills/

infra/
  compose/
  migrations/
  monitoring/

scripts/
  bootstrap/
  smoke/
  migration/
```

---

# 21. Configuration Model

Example `paohub.workspace.yaml`:

```yaml
workspace:
  name: Pao-hubPro
  default_mode: auto

routing:
  provider: omniroute
  profile: balanced

agents:
  compiler: forge
  auto_draft: true
  immutable_versions: true

skills:
  resolver: skill-composer
  gate: skillsgate
  auto_compose: true
  max_injected_tokens: 18000
  minimum_trust_score: 0.75

research:
  defaults:
    max_queries: 20
    max_sources: 40
    max_cost_usd: 2.0
    max_runtime_minutes: 30

coding:
  runtime: codex
  perception: aft
  review: opencodereview
  bug_hunter: true
  sandbox: required

memory:
  provider: openviking
  context_provider: context-mode
  lessons:
    auto_accept_min_confidence: 0.95
    require_human_for_sensitive: true

policy:
  profile: personal-safe
  approval_required_for:
    - external_message_send
    - publish
    - production_deploy
    - destructive_delete
    - secret_rotation

observability:
  record_model_provenance: true
  record_tool_calls: true
  record_costs: true
  redact_secrets: true
```

---

# 22. Security Requirements

Phase 20.94 must treat ENZO's security documentation as useful reference material, but implement Pao-hubPro's own threat model.

## Required controls

### 22.1 Secret handling

- encrypted persistent secret storage;
- scoped access;
- short-lived leases;
- secret redaction;
- explicit credential audit trail;
- no secrets in generated artifacts by default.

### 22.2 Generated code isolation

- sandbox process/container;
- environment allowlist;
- filesystem scope;
- network policy;
- no host Docker socket;
- no inherited cloud credentials;
- preview origin isolation.

### 22.3 Skill supply chain

- never execute arbitrary code merely to "learn" a skill repository;
- parse declared skill content through controlled readers;
- signature/hash support;
- version pinning;
- trust score;
- quarantine suspicious skills.

### 22.4 MCP controls

- dynamic tool discovery must not imply dynamic authorization;
- every tool has risk metadata;
- tool arguments validated before dispatch;
- connector permissions scoped by run;
- dangerous methods require approval.

### 22.5 Browser controls

- explicit tab ownership;
- origin awareness;
- credential/autofill awareness;
- human takeover;
- screenshot/DOM provenance;
- approval before irreversible web actions where required.

### 22.6 Audit

The audit log itself must be append-oriented and protected against ordinary agent mutation.

---

# 23. Failure Handling

## Provider failure

```text
model failure
 -> classify reason
 -> rate limit? wait/fallback
 -> auth? stop + credential event
 -> unsupported feature? reroute
 -> provider outage? fallback
 -> malformed output? repair / retry policy
```

## Tool failure

```text
tool call fails
 -> classify retryability
 -> inspect side-effect status
 -> do not blindly retry non-idempotent actions
 -> fallback tool only when semantics match
```

## Agent failure

```text
agent stuck
 -> checkpoint
 -> summarize state
 -> spawn reviewer/recovery agent
 -> resume from safe checkpoint
```

## Coding failure

```text
build fails
 -> capture logs
 -> classify
 -> repair attempt
 -> test
 -> review
 -> budget check
 -> escalate to operator if unresolved
```

---

# 24. Testing Strategy

## Unit tests

Required coverage areas:

```text
routing policies
skill resolution
blueprint compiler
budget counters
credential lease expiry
policy decisions
memory lesson scoring
run-event ordering
artifact hashing
secret redaction
```

## Integration tests

```text
workspace -> task compiler -> OmniRoute
workspace -> Forge -> agent blueprint
agent -> skill composer -> SkillsGate
run -> MCPProxy -> safe tool
research -> search -> evidence -> synthesis
coding -> edit -> build -> test -> review
run -> memory -> lesson candidate
approval -> action execution
```

## Security tests

```text
secret extraction attempt
prompt injection requesting vault dump
skill with hostile instructions
skill with executable payload
path traversal
command injection
browser cross-origin attempt
preview -> parent secret access attempt
MCP method overreach
approval bypass
IDOR on runs/artifacts
replay repeating destructive action
log secret leakage
```

## Chaos tests

```text
provider outage
model returns invalid JSON
MCP timeout
browser disconnect
agent worker death
DB restart
network split
partial artifact upload
run recovery after process restart
```

---

# 25. Acceptance Checklist

## Workspace

- [ ] One UI exposes Chat, Models, Agents, Skills, Research, Code, Operations.
- [ ] Every run has a stable Run ID.
- [ ] Run state survives page refresh.
- [ ] Active stage and budget are visible.

## Models

- [ ] Model marketplace consumes OmniRoute catalog.
- [ ] Health state is visible.
- [ ] Actual model/provider provenance is recorded.
- [ ] Fallback chains are supported.
- [ ] Provider allow/deny policy works.

## Agents

- [ ] Natural language can produce a draft blueprint.
- [ ] Drafting uses two explicit conceptual passes.
- [ ] Blueprint versions are immutable after execution.
- [ ] Agent provenance is stored.

## Skills

- [ ] Skills resolve automatically from intent.
- [ ] SkillsGate reviews untrusted skills.
- [ ] Dependency resolution works.
- [ ] Conflicting instructions are detected.
- [ ] Context-budget limit is enforced.

## Memory

- [ ] Run outcomes can generate candidate lessons.
- [ ] Lessons include provenance.
- [ ] Failed runs do not silently become trusted knowledge.
- [ ] Time-sensitive lessons can expire.
- [ ] Human corrections have priority.

## Research

- [ ] Research loop can generate follow-up queries.
- [ ] Hard budget stops are enforced.
- [ ] Claim-to-source mapping is preserved.
- [ ] Uncertainty/conflicting evidence is represented.

## Coding

- [ ] Repository can be inspected through AFT/context layer.
- [ ] Edits are transactional or reversible.
- [ ] Build/test output is visible.
- [ ] Live preview is isolated.
- [ ] Review/fix loop is integrated.

## Policy

- [ ] Actions receive a risk class.
- [ ] R3/R4 actions can require approval.
- [ ] Approval decisions are auditable.
- [ ] Replay cannot silently repeat irreversible actions.

## Credentials

- [ ] Long-lived secrets are not exposed to arbitrary agents.
- [ ] Credential leases have TTL/scope.
- [ ] Logs redact secrets.
- [ ] Generated code receives an environment allowlist.

## Operations

- [ ] Run event stream is queryable.
- [ ] Cost and token usage are recorded where providers expose them.
- [ ] Failed runs are inspectable.
- [ ] Re-run/fork/replay workflow exists.

---

# 26. Definition of Done

Phase 20.94 is complete only when an operator can open **one Pao-hubPro workspace** and perform all of the following without manually wiring subsystems:

1. Describe a task in natural language.
2. Let the system choose or draft an agent.
3. Automatically compose relevant trusted skills.
4. Resolve an appropriate model/provider through OmniRoute.
5. Attach only the required tools and credentials.
6. Execute the task under a visible budget.
7. Request approval for risky actions.
8. Produce artifacts.
9. Verify outputs with tests/review where applicable.
10. Save evidence-backed lessons.
11. Inspect the entire run trace.
12. Replay or fork the run safely.

The success criterion is not "the UI exists".

The success criterion is:

> **Pao-hubPro behaves like one coherent AI operating system rather than a collection of disconnected phases.**

---

# 27. Implementation Sequence

## Stage 1 — Contracts first

Build stable interfaces for:

```text
model router
agent compiler
skill resolver
policy engine
credential broker
run events
artifact registry
memory provider
```

Do not start by building a large UI.

## Stage 2 — Run Orchestrator

Create the canonical run state machine:

```text
CREATED
  -> PLANNING
  -> WAITING_FOR_APPROVAL (optional)
  -> RUNNING
  -> VERIFYING
  -> COMPLETED
  -> FAILED
  -> CANCELLED
```

## Stage 3 — Workspace shell

Build UI against the canonical contracts.

## Stage 4 — Model marketplace

Connect OmniRoute and provider health.

## Stage 5 — Agent + skill composition

Connect Forge + SkillsGate.

## Stage 6 — Research runtime

Add bounded iterative research.

## Stage 7 — Coding workspace

Integrate Codex/AFT/test/review/preview.

## Stage 8 — Memory distillation

Add candidate lesson pipeline.

## Stage 9 — Operations + replay

Complete auditing, cost, failures, replay, artifact provenance.

## Stage 10 — Security hardening

Run threat-model review, penetration tests, chaos tests, and approval-bypass tests before declaring Phase 20.94 production-ready.

---

# 28. Migration Strategy

Phase 20.94 must be additive first.

## Phase A — Adapter mode

Existing systems continue running unchanged.

The workspace calls them through adapters.

## Phase B — Canonical contracts

Replace direct cross-phase imports with stable service contracts.

## Phase C — Unified run IDs

All subsystems report into the same run/event plane.

## Phase D — Policy unification

Move scattered approval/risk logic into the policy control plane.

## Phase E — UX consolidation

Old dashboards remain available as deep diagnostic pages, while normal use flows through the unified workspace.

---

# 29. Anti-Patterns to Reject

Do **not**:

- create another independent model router;
- create another independent memory database without adapters;
- let each agent read all secrets;
- automatically install arbitrary GitHub skills and execute their scripts;
- allow generated code to inherit server secrets;
- duplicate MCP discovery outside MCPProxy;
- treat model names as permanent identities;
- store only final answers without run provenance;
- let memory accept unsourced claims automatically;
- retry non-idempotent side effects blindly;
- make approval state client-only;
- couple the UI directly to provider SDKs;
- make ENZO a mandatory dependency.

---

# 30. Operational Profiles

## `safe-personal`

```yaml
research: auto
read_tools: auto
file_write: scoped
browser_navigation: auto
browser_submit: approval
messages_send: approval
production_deploy: approval
destructive: approval
max_run_cost_usd: 3.00
```

## `developer-local`

```yaml
research: auto
repo_read: auto
repo_write: auto
shell_scoped: auto
network: restricted
commit: approval
push: approval
production_deploy: approval
max_run_cost_usd: 5.00
```

## `automation-strict`

```yaml
research: auto
external_side_effects: deny
filesystem_write: workspace_only
network: allowlist
secrets: leased_only
max_run_cost_usd: 1.00
```

---

# 31. Suggested Dashboard Metrics

```text
Runs today
Success rate
Median time-to-success
Cost per successful run
Model fallback rate
Provider error rate
Tool failure rate
Approval rate
Human correction rate
Lesson acceptance rate
Skill composition success rate
Average context size
Research query count
Code repair loop count
Security-denied actions
```

The most important metric is not raw token usage.

It is:

```text
cost per successful verified outcome
```

---

# 32. Future Extensions Enabled by Phase 20.94

Once the workspace and contracts exist, future phases can add capabilities without fragmenting UX.

Examples:

- voice agent workspace;
- Adobe Stock production studio;
- autonomous scheduled research;
- business lead operations;
- smart-farm operations;
- remote-device control;
- AI media production;
- financial analysis workspace;
- agent marketplace;
- cross-device personal AI workspace;
- mobile companion app;
- self-improvement/evaluation loops.

Each new capability becomes a registered surface/tool/skill/agent instead of another isolated application.

---

# 33. Final Architecture Decision

**Decision:** Use ENZO as a reference architecture and product pattern library, not as the runtime foundation of Pao-hubPro.

### Keep canonical Pao-hubPro ownership

```text
Models      -> OmniRoute
Agents      -> Forge
Skills      -> SkillsGate + Skill Registry
Tools       -> MCPProxy
Coding      -> Codex + AFT
Browser     -> BrowserSkill
Memory      -> OpenViking + Context Mode
Review      -> OpenCodeReview + Bug Hunter
Fleet       -> Apra Fleet / Herdr
Policy      -> Pao-hubPro Policy Control Plane
Workspace   -> Phase 20.94
```

### Strategic result

Before Phase 20.94:

```text
Powerful capabilities
spread across many phases
```

After Phase 20.94:

```text
One Personal AI Operating Plane
with many capabilities behind it
```

---

# 34. Codex Handoff Notes

When implementing this phase, Codex must:

1. Inspect the existing Pao-hubPro repository before creating new packages.
2. Map existing implementations to the ownership table in Section 16.
3. Reuse existing contracts where sound.
4. Introduce adapters before rewrites.
5. Preserve backward compatibility until the unified workspace passes smoke tests.
6. Add migrations instead of deleting existing persistent state.
7. Add tests alongside each contract.
8. Keep secrets out of logs, prompts, generated artifacts, and child-process environments.
9. Implement approval enforcement server-side.
10. Produce an implementation report that lists:
   - created files;
   - modified files;
   - migrations;
   - tests;
   - remaining gaps;
   - risk items;
   - rollback instructions.

---

# 35. Final Acceptance Statement

Phase 20.94 is accepted when this statement is true:

> A user can open Pao-hubPro, describe a goal, and the system can safely determine the required agent, model, skills, memory, tools, browser/code runtime, budget and approval path; execute the work; verify it; create artifacts; learn from the result; and expose a complete auditable trace — all from one self-hosted workspace.

---

## Reference

- ENZO repository: https://github.com/theguysudo/ENZO
- ENZO security model: https://github.com/theguysudo/ENZO/blob/main/docs/SECURITY.md
- ENZO changelog: https://github.com/theguysudo/ENZO/blob/main/docs/CHANGELOG.md

