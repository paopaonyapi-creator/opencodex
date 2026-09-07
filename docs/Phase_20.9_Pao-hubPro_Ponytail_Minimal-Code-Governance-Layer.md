# Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer

> **Project:** Pao-hubPro  
> **Phase:** 20.9  
> **Primary Goal:** Add a minimal-code governance layer in front of coding agents so Pao-hubPro prefers reuse, native capabilities, existing dependencies, and minimal diffs before creating new abstractions.  
> **Integration Target:** Codex-first, MCP-compatible, Hermes-compatible, Reviewer Council aware  
> **Upstream Reference:** https://github.com/DietrichGebert/ponytail  
> **Status:** Implementation Specification / One-shot Codex Task

---

## 0. Executive Summary

Phase 20.9 adds **Ponytail-style minimal-code governance** to Pao-hubPro.

The purpose is **not** to force short code for its own sake. The purpose is to make coding agents stop before they over-build.

Every non-trivial coding task should follow this ladder:

1. Does the requested thing need to exist?
2. Does equivalent functionality already exist in this codebase?
3. Can the standard library solve it?
4. Can the native platform solve it?
5. Can an already-installed dependency solve it?
6. Can it be implemented with a very small local change?
7. Only then create the minimum new implementation required.

This phase must preserve:

- security boundaries,
- authentication and authorization,
- input validation,
- data-loss protection,
- accessibility,
- backup behavior,
- audit logging,
- rollback capability,
- tests and verification,
- explicit user requirements.

**Minimal does not mean careless.**

The new architecture should place Ponytail governance **before implementation**, while the existing AI Reviewer Council remains **after implementation**.

```text
User / ChatGPT
      |
      v
Pao-hubPro Task Router
      |
      v
Ponytail Governance Gate
      |
      +--> Need it?
      +--> Reuse existing?
      +--> Stdlib?
      +--> Native platform?
      +--> Existing dependency?
      +--> Small local patch?
      |
      v
Coding Agent / Codex
      |
      v
Minimal Diff Verification
      |
      v
Tests / Lint / Typecheck / Build
      |
      v
AI Reviewer Council
      |
      +--> correctness
      +--> security
      +--> maintainability
      +--> regression risk
      |
      v
Approve / Reject / Revise
```

---

# 1. Why This Phase Exists

Pao-hubPro is becoming a large agentic workspace containing multiple phases, integrations, agents, automation components, local tools, AI generation systems, and reviewer workflows.

As the codebase grows, coding agents are increasingly likely to:

- create duplicate helpers,
- introduce a new library for something already available,
- create unnecessary wrappers,
- create unnecessary services,
- create new state management when existing state already works,
- duplicate existing APIs,
- add unnecessary configuration layers,
- create abstractions before there is a real second use case,
- create "future-proof" architecture that has no current requirement,
- touch too many files for a small task,
- replace working code instead of adapting it,
- add hidden maintenance burden.

Phase 20.9 introduces a governance layer whose first question is:

> **What is the smallest correct change that satisfies the actual requirement?**

---

# 2. Verified Upstream Ponytail Capabilities

The implementation may integrate upstream Ponytail directly when useful, but Pao-hubPro must also maintain its own project-specific policy layer.

Current upstream capabilities that this phase may use include:

## 2.1 Codex plugin

```bash
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

After installation:

1. start `codex`,
2. open `/hooks`,
3. review the lifecycle hooks,
4. trust them only after review,
5. start a new Codex thread.

Node.js must be available on PATH for the lifecycle hooks.

## 2.2 Codex fallback via AGENTS.md

Codex can consume `AGENTS.md` instructions.

This is important because Pao-hubPro must not depend exclusively on plugin state.

The implementation therefore needs a project-owned governance file that remains understandable even if the Ponytail plugin is unavailable.

## 2.3 Hermes support

Upstream installation:

```bash
hermes plugins install DietrichGebert/ponytail --enable
```

Restart Hermes after installation.

## 2.4 Supported modes

Ponytail supports:

```text
lite
full
ultra
off
```

The upstream default is `full`.

Default mode may be configured using:

```text
PONYTAIL_DEFAULT_MODE
```

or the Ponytail user configuration file.

## 2.5 Subagent scoping

Ponytail can scope instruction injection by subagent type using:

```text
PONYTAIL_SUBAGENT_MATCHER
```

The value is a regular expression matched against reported subagent `agent_type`.

Pao-hubPro must use this concept carefully because not every agent should receive "minimize implementation" instructions.

## 2.6 Commands / skills

Relevant upstream operations include:

```text
/ponytail
/ponytail-review
/ponytail-audit
/ponytail-debt
/ponytail-gain
/ponytail-help
```

In Codex skill-capable contexts, corresponding skills can be invoked with `@`, for example:

```text
@ponytail-review
```

## 2.7 MCP server

Upstream provides `ponytail-mcp`.

It exposes:

```text
Prompt: ponytail
Tool:   ponytail_instructions
```

Supported prompt/tool modes:

```text
lite
full
ultra
```

The tool is read-only.

Typical upstream run flow:

```bash
cd ponytail-mcp
npm install
node index.js
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "ponytail": {
      "command": "node",
      "args": ["ponytail-mcp/index.js"]
    }
  }
}
```

### Important limitation

Do **not** treat the MCP integration as a universal always-on instruction injector.

The upstream MCP server is useful for:

- MCP hosts with prompt-menu injection,
- hosts that fetch context using tools,
- explicit governance calls.

For Codex/Pao-hubPro always-on behavior, prefer:

1. project governance rules / `AGENTS.md`,
2. native Ponytail plugin when available,
3. Pao-hubPro task-router governance,
4. MCP as an additional compatible interface.

---

# 3. Phase 20.9 Design Principles

The implementation MUST follow these principles.

## Pao Rule 1 — Requirement Supremacy

Minimal code must never override explicit requirements.

If a requirement genuinely needs a larger implementation, implement it.

Do not delete a required feature just because a smaller diff looks better.

---

## Pao Rule 2 — Safety Is Non-Negotiable

Never reduce or remove safeguards merely to reduce lines of code.

Protected areas include:

- auth,
- authorization,
- secrets,
- validation,
- sanitization,
- filesystem boundaries,
- shell execution boundaries,
- backup/restore,
- data integrity,
- destructive operations,
- database migrations,
- concurrency controls,
- rate limiting where required,
- audit trails,
- error handling that prevents data loss,
- accessibility requirements.

---

## Pao Rule 3 — Reuse Before Creation

Before adding a new module, service, class, hook, helper, schema, adapter, route, store, queue, utility, dependency, or config mechanism:

1. search the repository,
2. identify existing related code,
3. inspect the actual execution path,
4. reuse or extend existing code when reasonable.

Do not create parallel implementations without documented justification.

---

## Pao Rule 4 — No Dependency for Cosmetic LOC Reduction

Do not add a dependency merely because it makes the local code shorter.

A new dependency must provide meaningful value in at least one area:

- correctness,
- interoperability,
- security,
- maintainability,
- performance,
- substantial complexity reduction,
- required protocol support.

---

## Pao Rule 5 — Verify Every Non-Trivial Change

Every non-trivial change must have an executable verification path.

Use whichever already exists in the repository:

```text
unit tests
integration tests
typecheck
lint
build
smoke tests
CLI checks
API health checks
```

Do not invent a brand-new test stack if the repository already has one.

---

## Pao Rule 6 — High-Risk Simplification Requires Review

The following areas may not be simplified without Reviewer Council approval:

```text
auth
permissions
backup
restore
audit log
secrets
remote execution
MCP write tools
filesystem write tools
shell execution
production database code
payment/billing if added later
migration logic
```

---

## Pao Rule 7 — Ponytail Proposes; Reviewer Council Authorizes Risk

Ponytail governance may recommend removal or simplification.

It may **not** be the final authority for risky deletion.

```text
Ponytail Governance = pre-build minimality gate
Reviewer Council     = post-build correctness/risk gate
```

---

## Pao Rule 8 — Prefer Minimal Diff Over Rewrite

For bug fixes and incremental features:

```text
patch > refactor > rewrite
```

unless repository evidence proves the rewrite is safer or significantly simpler.

---

## Pao Rule 9 — Preserve Public Contracts

Do not silently change:

- API request/response shapes,
- MCP tool schemas,
- CLI flags,
- environment variable names,
- config file formats,
- database schemas,
- persistent storage formats,
- public exports,
- webhook contracts,
- existing automation interfaces.

If a contract must change, make it explicit and provide migration compatibility where reasonable.

---

## Pao Rule 10 — Observable Governance

The governance layer must be visible and inspectable.

For meaningful tasks, the system should be able to report:

```text
selected mode
selected rung
files inspected
existing implementation reused
new dependency added? yes/no
files changed
lines added/removed
verification commands
review outcome
```

Do not expose private chain-of-thought.

Provide short structured decision summaries only.

---

# 4. Mode Strategy

Pao-hubPro must support these governance modes:

| Mode | Purpose | Recommended Use |
|---|---|---|
| `off` | Disable Ponytail minimality rules | debugging governance itself |
| `lite` | gentle anti-overengineering | prototypes, spikes |
| `full` | default production mode | features, bugs, integrations |
| `ultra` | aggressive simplification analysis | refactors, debt removal, audits |

## 4.1 Pao default

```text
full
```

## 4.2 Recommended routing

```text
Prototype / disposable spike       -> lite
Normal feature                     -> full
Bug fix                            -> full
MCP tool addition                  -> full
Automation workflow                -> full
Security-sensitive change          -> full + mandatory Reviewer Council
Large refactor                     -> ultra + mandatory tests
Repository-wide debt audit         -> ultra
Research-only agent                -> off
Read-only web/search agent         -> off
Reviewer agent                     -> off
Security reviewer                  -> off
```

---

# 5. Subagent Policy

Do not inject minimal-code instructions into every agent blindly.

Recommended conceptual routing:

```text
research_agent            -> off
web_search_agent          -> off
code_explorer             -> lite or off
planner_agent             -> lite
coding_agent              -> full
bugfix_agent              -> full
refactor_agent             -> ultra
migration_agent            -> full
security_reviewer          -> off
architecture_reviewer      -> off
reviewer_council_member    -> off
final_integrator           -> full
```

If upstream subagent matching is used, configure only agents that should receive Ponytail behavior.

Example concept:

```bash
export PONYTAIL_SUBAGENT_MATCHER='coding|bugfix|refactor|general'
```

Do not hardcode this exact regex unless it matches actual Pao-hubPro agent types.

Codex must inspect existing agent names first.

---

# 6. Target Architecture

Implement the following logical components.

```text
Pao-hubPro
|
+-- Governance
|   |
|   +-- PonytailPolicy
|   +-- ModeRouter
|   +-- TaskClassifier
|   +-- ReuseScanner
|   +-- DependencyGuard
|   +-- DiffGuard
|   +-- RiskClassifier
|   +-- GovernanceReporter
|   +-- DebtLedger
|
+-- Agent Router
|   |
|   +-- Research Agents
|   +-- Coding Agents
|   +-- Refactor Agents
|   +-- Reviewer Agents
|
+-- MCP Layer
|   |
|   +-- Existing Pao MCP tools
|   +-- Optional Ponytail MCP adapter
|
+-- Verification Layer
|   |
|   +-- Tests
|   +-- Lint
|   +-- Typecheck
|   +-- Build
|
+-- Reviewer Council
    |
    +-- Correctness Review
    +-- Security Review
    +-- Maintainability Review
    +-- Regression Review
```

The exact paths and file names must follow the existing repository conventions.

**Do not create a new architecture tree if equivalent directories already exist.**

---

# 7. Required Governance Decision Ladder

Before code generation or modification, a coding agent must produce a compact internal governance decision object.

Example schema:

```json
{
  "mode": "full",
  "task_type": "feature",
  "risk": "medium",
  "selected_rung": "reuse-existing",
  "existing_candidates": [
    "src/example/existing-module.ts"
  ],
  "new_dependency_required": false,
  "expected_change_scope": {
    "files": 2,
    "kind": "incremental"
  },
  "requires_reviewer_council": false
}
```

The system may log this object, but should avoid logging secrets or sensitive prompt content.

## Decision order

```text
RUNG 1 — Skip / YAGNI
RUNG 2 — Reuse existing code
RUNG 3 — Standard library
RUNG 4 — Native platform feature
RUNG 5 — Existing installed dependency
RUNG 6 — Small local implementation
RUNG 7 — Minimum new subsystem
```

A later rung should only be selected after earlier applicable options are rejected with a short reason.

---

# 8. Task Classification

Implement a simple task classifier using existing project primitives.

Do not add a model call if deterministic logic already has enough information.

Suggested categories:

```text
research
planning
bugfix
feature
refactor
migration
security
infrastructure
mcp-tool
agent-definition
documentation
test-only
```

Suggested risk levels:

```text
low
medium
high
critical
```

High/critical should include changes touching areas such as:

- authentication,
- authorization,
- database migrations,
- destructive file operations,
- remote shell execution,
- secrets,
- production deployment,
- backup/restore,
- MCP write tools,
- external network credentials.

---

# 9. Repository Reuse Scanner

Before creating new code, inspect the repository for existing equivalents.

Minimum search targets:

```text
module names
function names
route names
MCP tool names
config keys
environment variables
schemas
service classes
adapters
queue implementations
logging utilities
HTTP clients
retry logic
filesystem helpers
auth helpers
validation utilities
```

Use tools that already exist in the development environment, for example:

```text
rg
git grep
project language indexer
Codex repository search
```

Do not add a dedicated search dependency unless clearly necessary.

---

# 10. Dependency Guard

Before introducing any package, generate a dependency decision record.

Example:

```json
{
  "package": "example-package",
  "reason": "required protocol implementation",
  "stdlib_available": false,
  "native_available": false,
  "existing_dependency_available": false,
  "security_review_needed": true
}
```

Reject dependency additions whose only justification is:

```text
"less code"
"cleaner syntax"
"popular library"
"might need later"
```

unless there is an additional concrete technical benefit.

---

# 11. Diff Guard

After implementation, calculate change scope using Git when available.

Collect:

```text
files changed
insertions
deletions
new files
deleted files
new dependencies
public contract changes
migration files
```

Suggested commands:

```bash
git status --short
git diff --stat
git diff --numstat
git diff --check
```

Do not reject a change solely because it is large.

Instead flag unusually large scope relative to the task.

Example conditions:

```text
small bugfix touching > 8 files       -> warn
simple UI tweak adding dependency     -> warn
new helper duplicating existing util  -> reject or revise
public API change without migration   -> reject
security guard removed                -> reject
```

Thresholds should be configurable, not magic constants scattered through the code.

---

# 12. Reviewer Council Integration

Phase 20.9 must integrate with the existing/planned Pao-hubPro Reviewer Council instead of replacing it.

## Mandatory review triggers

Trigger Reviewer Council when any of the following is true:

```text
risk >= high
public API changed
MCP write tool changed
shell execution changed
filesystem mutation changed
auth changed
permission logic changed
backup/restore changed
database migration added
security validation removed
large refactor
ultra mode changed production code
```

## Reviewer roles

Use existing council implementation if present.

Conceptual roles:

```text
Reviewer A — correctness
Reviewer B — security
Reviewer C — maintainability / architecture
Reviewer D — regression / compatibility
```

The governance layer should provide reviewers with:

```text
task requirement
governance decision summary
git diff
test results
known risks
new dependencies
contract changes
```

Reviewers should **not** automatically inherit Ponytail simplification rules.

Reviewers need independent judgment.

---

# 13. Ponytail Review / Audit Integration

Provide Pao-hubPro wrappers or documentation for these workflows.

## 13.1 Current diff review

Purpose:

- identify overengineering in the current diff,
- detect unnecessary files,
- detect wrappers that can be removed,
- detect native/stdlib replacements,
- detect unused abstraction.

Codex-native upstream skill example:

```text
@ponytail-review
```

## 13.2 Repository audit

Use for periodic technical-debt reviews.

```text
@ponytail-audit
```

## 13.3 Debt ledger

Track intentional shortcuts or deferred cleanup.

```text
@ponytail-debt
```

Pao-hubPro should have a project-owned debt file if one does not already exist.

Preferred location should follow current documentation conventions, for example:

```text
docs/governance/technical-debt.md
```

Do not create this file if an equivalent debt tracker already exists.

---

# 14. MCP Integration Requirements

If Pao-hubPro already has an MCP server or MCP registry, integrate Ponytail without creating a duplicate MCP runtime.

Preferred approaches in order:

```text
1. register upstream ponytail-mcp as an external/read-only MCP server
2. create a thin Pao adapter that calls the upstream server
3. vendor a minimal compatible instruction provider only if operationally necessary
```

Do not fork the entire upstream project unless there is a concrete requirement.

## MCP security requirements

The Ponytail MCP interface is instruction-only/read-only.

Pao-hubPro must preserve this property unless explicitly designed otherwise.

Do not add:

```text
shell execution
filesystem writes
network mutation
credential access
repository mutation
```

to the Ponytail MCP adapter.

---

# 15. Codex Integration Requirements

Codex is the primary implementation target.

Support the following layers.

## Layer A — Pao project governance

Create or extend the project's agent instruction file.

If `AGENTS.md` already exists:

- merge carefully,
- preserve existing project rules,
- do not overwrite it wholesale.

Add a concise section named similar to:

```text
Pao-hubPro Minimal-Code Governance
```

This section should include the Pao rules and decision ladder.

## Layer B — Optional Ponytail plugin

Document installation, but do not make application startup fail when the plugin is missing.

```bash
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

## Layer C — Pao task-router enforcement

Pao-hubPro's own task router should still classify coding tasks and attach governance metadata.

The plugin is an enhancement, not the only enforcement mechanism.

---

# 16. Hermes Integration

If Hermes integration already exists in the repository, add documentation/configuration support.

Upstream install:

```bash
hermes plugins install DietrichGebert/ponytail --enable
```

Do not create a Hermes integration subsystem if Pao-hubPro currently has no Hermes runtime path.

In that case, document it as an optional adapter.

---

# 17. Configuration

Use existing configuration mechanisms wherever possible.

Suggested settings:

```text
PAO_GOVERNANCE_ENABLED=true
PAO_GOVERNANCE_MODE=full
PAO_GOVERNANCE_DIFF_GUARD=true
PAO_GOVERNANCE_DEPENDENCY_GUARD=true
PAO_GOVERNANCE_REUSE_SCAN=true
PAO_GOVERNANCE_REVIEWER_COUNCIL=true
PAO_GOVERNANCE_LOG_DECISIONS=true
```

Optional upstream settings:

```text
PONYTAIL_DEFAULT_MODE=full
PONYTAIL_SUBAGENT_MATCHER=<actual project regex>
```

## Configuration precedence

Prefer:

```text
CLI/task override
    > project config
    > environment variable
    > default
```

Do not introduce another configuration library merely for these settings.

---

# 18. Governance Report

For each meaningful coding task, generate a concise report.

Example:

```text
Governance mode: full
Task: bugfix
Risk: medium
Selected rung: reuse-existing
Reuse: src/lib/retry.ts
New dependencies: none
Files changed: 2
Diff: +18 / -7
Verification: unit tests + typecheck
Reviewer Council: not required
Status: PASS
```

Do not output hidden chain-of-thought.

Only output decisions, evidence, and results.

---

# 19. Metrics

Add lightweight metrics using an existing logging/telemetry system if present.

Suggested metrics:

```text
governance_tasks_total
reuse_selected_total
stdlib_selected_total
native_selected_total
existing_dependency_selected_total
new_implementation_selected_total
new_dependencies_total
overengineering_warnings_total
reviewer_council_trigger_total
governance_rejections_total
avg_files_changed
avg_insertions
avg_deletions
```

Metrics must not contain:

- prompts containing secrets,
- API keys,
- file contents,
- private user data.

If no telemetry framework exists, use structured logs instead of adding a new metrics stack.

---

# 20. Technical Debt Ledger

If no existing equivalent exists, create a simple Markdown ledger.

Suggested record:

```markdown
## DEBT-YYYYMMDD-001

- Date:
- Area:
- Shortcut:
- Reason:
- Risk:
- Trigger to revisit:
- Related files:
- Owner:
- Status: open
```

Do not turn this into a database-backed system in Phase 20.9.

Markdown is enough unless the repository already has a structured issue system.

---

# 21. UI / Dashboard

A full UI is **not required** for this phase.

If Pao-hubPro already has an admin/developer dashboard, add only a small governance status surface.

Optional fields:

```text
Governance: ON
Mode: FULL
Last decision: reuse-existing
Reviewer Council: PASS
New dependency: no
```

Do not build a new dashboard framework solely for Ponytail.

---

# 22. Logging

Use structured logs.

Example:

```json
{
  "event": "governance.decision",
  "mode": "full",
  "task_type": "bugfix",
  "risk": "medium",
  "rung": "reuse-existing",
  "files_changed": 2,
  "new_dependency": false,
  "review_required": false
}
```

Never log:

```text
API keys
auth tokens
passwords
private keys
secret env values
full confidential prompts
```

---

# 23. Failure Behavior

Governance must fail safely.

## Plugin unavailable

```text
Ponytail plugin unavailable
-> continue using Pao project governance rules
-> report degraded integration
-> do not block normal development
```

## MCP unavailable

```text
Ponytail MCP unavailable
-> continue using local governance policy
-> do not disable coding automatically
```

## Reuse scanner fails

```text
reuse scan fails
-> warn
-> continue cautiously
-> do not claim "no existing implementation"
```

## Reviewer Council unavailable on high-risk task

Preferred behavior:

```text
high-risk task
+ council required
+ council unavailable
=> DO NOT auto-approve production-impacting change
```

Allow explicit developer override with a clearly recorded reason if the existing Pao-hubPro governance model supports overrides.

---

# 24. Rollback

The implementation must be removable.

## Pao governance

Support:

```text
PAO_GOVERNANCE_ENABLED=false
```

## Ponytail Codex plugin

Upstream removal:

```bash
codex plugin remove ponytail
```

Do not remove unrelated user settings.

## Code rollback

Keep Phase 20.9 changes logically isolated enough to revert via Git without reverting unrelated phases.

---

# 25. Testing Requirements

Use the repository's existing testing stack.

Add tests for the governance logic itself.

Minimum cases:

## 25.1 Mode router

```text
default -> full
explicit lite -> lite
explicit ultra -> ultra
explicit off -> off
invalid mode -> safe fallback + warning
```

## 25.2 Task classifier

Test representative:

```text
bugfix
feature
refactor
security
research
```

## 25.3 Reuse-first behavior

Given an existing utility:

```text
request equivalent helper
-> scanner finds existing utility
-> selected rung = reuse-existing
```

## 25.4 Dependency guard

```text
new package with cosmetic justification -> reject/warn
new package required for protocol -> allow for review
```

## 25.5 Risk escalation

```text
auth change -> reviewer required
backup change -> reviewer required
MCP write change -> reviewer required
simple docs change -> reviewer not required
```

## 25.6 Diff guard

```text
small fix + giant unrelated diff -> warn/fail policy
small local diff -> pass
```

## 25.7 Governance disabled

```text
PAO_GOVERNANCE_ENABLED=false
-> existing behavior preserved
```

---

# 26. Verification Commands

Codex must first discover existing project scripts.

Examples only:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

or:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

or repository-specific equivalents.

**Do not blindly run commands that do not exist.**

Before running verification:

- inspect `package.json`, `pyproject.toml`, `Makefile`, workspace files, or equivalent,
- select existing scripts,
- avoid destructive scripts.

Always run where available:

```bash
git diff --check
```

---

# 27. Suggested File Layout

This is a conceptual example only.

Codex MUST adapt to the existing repository structure.

```text
src/
  governance/
    index.*
    policy.*
    mode-router.*
    task-classifier.*
    reuse-scanner.*
    dependency-guard.*
    diff-guard.*
    risk-classifier.*
    reporter.*

docs/
  governance/
    ponytail.md
    technical-debt.md

tests/
  governance/
    ...
```

If the repository already has:

```text
policy/
guards/
agent/
router/
review/
```

reuse those directories instead.

---

# 28. Do Not Do These Things

Codex must NOT:

1. rewrite Pao-hubPro from scratch,
2. create a second task router if one exists,
3. create a second Reviewer Council,
4. create another MCP runtime if one exists,
5. create a new logging framework,
6. create a new metrics stack without need,
7. create a new config framework,
8. add a database only for governance settings,
9. add Redis only for this phase,
10. add a message queue only for this phase,
11. add a full UI dashboard only for this phase,
12. replace existing safety controls,
13. remove validation to reduce LOC,
14. weaken auth or permissions,
15. add dependencies only to reduce local code,
16. auto-modify global user configuration without explicit need,
17. hardcode machine-specific paths,
18. assume Windows/Linux/macOS without detecting existing project expectations,
19. vendor the entire Ponytail repository without justification,
20. claim that MCP provides universal always-on injection.

---

# 29. Acceptance Criteria

Phase 20.9 is complete only when all applicable items below pass.

## Core

- [ ] Existing Pao-hubPro architecture was inspected before implementation.
- [ ] No duplicate router/reviewer/config/logger subsystem was created.
- [ ] Governance can be enabled/disabled.
- [ ] Default governance mode is `full`.
- [ ] Modes `lite`, `full`, `ultra`, and `off` are supported conceptually or directly.
- [ ] Coding tasks perform reuse-first analysis.
- [ ] New dependency decisions are recorded or guarded.
- [ ] High-risk tasks trigger Reviewer Council policy.
- [ ] Reviewer agents are not forced into minimal-code behavior.
- [ ] Diff scope can be reported.
- [ ] Safety-critical code cannot be removed merely for LOC reduction.

## Codex

- [ ] Existing `AGENTS.md` is preserved and extended, not blindly replaced.
- [ ] Ponytail Codex plugin installation is documented as optional/recommended.
- [ ] Plugin absence does not break Pao-hubPro.
- [ ] Hook trust/review step is documented.

## MCP

- [ ] Ponytail MCP is treated as read-only/instruction-only.
- [ ] MCP is not incorrectly treated as universal always-on injection.
- [ ] Existing MCP infrastructure is reused if present.

## Quality

- [ ] Existing tests pass.
- [ ] New governance tests pass.
- [ ] Lint passes where configured.
- [ ] Typecheck passes where configured.
- [ ] Build passes where configured.
- [ ] `git diff --check` passes.
- [ ] No secret was committed.
- [ ] No unrelated files were modified.

## Documentation

- [ ] Phase 20.9 architecture documented.
- [ ] Enable/disable documented.
- [ ] Mode behavior documented.
- [ ] Reviewer Council integration documented.
- [ ] Rollback documented.

---

# 30. Definition of Done

A developer should be able to give Pao-hubPro a task such as:

```text
Add retry support to the existing API client.
```

and the system should first inspect the repository and potentially determine:

```text
There is already a retry utility used by another API client.
Reuse it.
No new dependency.
No new service.
No new abstraction.
Change two files.
Run existing tests.
```

Instead of creating:

```text
RetryManager
RetryStrategyFactory
RetryPolicyProvider
retry configuration service
new retry npm package
new persistence layer
new dashboard
```

unless the actual requirement genuinely demands them.

---

# 31. One-Shot Codex Implementation Prompt

> Copy the entire block below into Codex from the root of the **Pao-hubPro** repository.

```text
You are implementing Phase 20.9 of Pao-hubPro:
"Pao-hubPro × Ponytail Minimal-Code Governance Layer".

OBJECTIVE
Add a production-safe minimal-code governance layer that makes coding agents prefer:
1) skip unnecessary work,
2) reuse existing Pao-hubPro code,
3) standard library,
4) native platform capabilities,
5) already-installed dependencies,
6) small local patches,
7) only then the minimum new subsystem required.

This is NOT code golf.
Never reduce security, validation, auth, authorization, accessibility, data-loss handling, backups, audit logs, tests, or explicit requirements merely to reduce LOC.

CRITICAL FIRST STEP — INSPECT BEFORE EDITING
Do not write code immediately.
First inspect this repository and identify:
- existing AGENTS.md or agent instruction files,
- task router / orchestrator,
- agent registry,
- MCP server/registry,
- Reviewer Council or review pipeline,
- config system,
- logging system,
- test framework,
- package manager,
- existing dependency policy,
- existing risk/security policy,
- existing technical-debt documentation,
- existing metrics/telemetry.

Use existing components.
Do NOT create duplicate infrastructure.

UPSTREAM REFERENCE
Ponytail repository:
https://github.com/DietrichGebert/ponytail

Codex plugin install documentation:
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail

The plugin is optional/recommended integration.
Pao-hubPro MUST still have project-owned governance rules and must not fail if the plugin is unavailable.

UPSTREAM MCP
Ponytail has a read-only instruction MCP server under ponytail-mcp.
It exposes a prompt named `ponytail` and a tool named `ponytail_instructions`.
Treat this integration as read-only/instruction-only.
Do not add shell/filesystem mutation capabilities to it.
Do not assume MCP can universally inject instructions every turn across all hosts.

PAO GOVERNANCE RULES
1. Explicit requirements beat minimality.
2. Never remove safety controls for LOC reduction.
3. Search/reuse existing Pao-hubPro modules before creating new ones.
4. Do not add a dependency just because syntax is shorter.
5. Every non-trivial change needs executable verification.
6. Security/auth/backup/audit/remote-exec simplification requires Reviewer Council approval.
7. Ponytail governance proposes simplification; Reviewer Council authorizes risky changes.
8. Prefer minimal diff over rewrite for incremental work.
9. Preserve public contracts unless the change is explicit and migration-safe.
10. Produce observable decision summaries, never private chain-of-thought.

MODES
Support the project concept of:
- off
- lite
- full
- ultra

Default: full.

Recommended routing:
- research/search agents: off
- planner: lite
- normal coding: full
- bugfix: full
- MCP coding: full
- refactor: ultra
- reviewer agents: off
- security reviewer: off

If actual agent names differ, map to the real repository names.
Do not hardcode example names that do not exist.

REQUIRED COMPONENTS
Implement by extending existing architecture where possible:
- governance policy
- mode routing
- task classification
- repository reuse scan
- dependency guard
- diff guard
- risk classification
- governance report
- Reviewer Council trigger integration
- optional Ponytail MCP registration/adapter documentation
- optional Codex plugin documentation

DECISION LADDER
Every coding task should be evaluated in this order:
RUNG 1: Does this need to exist? If not, skip.
RUNG 2: Does equivalent code already exist? Reuse it.
RUNG 3: Can stdlib solve it?
RUNG 4: Can native platform functionality solve it?
RUNG 5: Can an installed dependency solve it?
RUNG 6: Can a small local implementation solve it?
RUNG 7: Only then create the minimum new subsystem.

Record a compact decision summary similar to:
{
  mode,
  task_type,
  risk,
  selected_rung,
  existing_candidates,
  new_dependency_required,
  expected_change_scope,
  requires_reviewer_council
}

Do not log secrets or full confidential prompts.

DEPENDENCY GUARD
Before adding a package, determine:
- why it is needed,
- whether stdlib can do it,
- whether native platform can do it,
- whether an installed dependency can do it,
- whether the package adds security/maintenance risk.

Reject or warn on dependencies whose only rationale is "less code" or "might need later".

DIFF GUARD
Use Git when available to summarize:
- changed files,
- insertions,
- deletions,
- new/deleted files,
- dependency changes,
- public contract changes,
- migration changes.

Use commands such as:
git status --short
git diff --stat
git diff --numstat
git diff --check

Do not reject a legitimate large change merely for size; instead compare scope to requirement and flag likely overbuild.

REVIEWER COUNCIL
Do not replace the existing Reviewer Council.
Integrate with it.

Mandatory review triggers include:
- high/critical risk,
- auth/permission changes,
- database migrations,
- backup/restore,
- shell/remote execution,
- MCP write tools,
- filesystem mutation,
- public API/schema changes,
- security validation removal,
- large production refactor,
- ultra-mode production changes.

Reviewer agents should NOT inherit minimal-code instructions automatically.
They need independent judgment.

AGENTS.MD
If AGENTS.md exists, merge a concise Pao-hubPro Minimal-Code Governance section into it.
Preserve all existing instructions.
Do not replace AGENTS.md wholesale.
If equivalent instructions already exist, consolidate rather than duplicate.

CONFIGURATION
Reuse the existing config system.
Suggested concepts, adapted to project conventions:
PAO_GOVERNANCE_ENABLED=true
PAO_GOVERNANCE_MODE=full
PAO_GOVERNANCE_DIFF_GUARD=true
PAO_GOVERNANCE_DEPENDENCY_GUARD=true
PAO_GOVERNANCE_REUSE_SCAN=true
PAO_GOVERNANCE_REVIEWER_COUNCIL=true
PAO_GOVERNANCE_LOG_DECISIONS=true

Optional upstream envs:
PONYTAIL_DEFAULT_MODE=full
PONYTAIL_SUBAGENT_MATCHER=<regex matching real coding agent types>

Do not add a new config library if the project already has one.

TECHNICAL DEBT
If an equivalent debt tracker does not exist, create a lightweight Markdown ledger.
Do not create a database-backed debt system for this phase.

FAILURE BEHAVIOR
- Ponytail plugin missing -> Pao governance still works.
- Ponytail MCP unavailable -> local governance still works.
- reuse scan fails -> warn; do not claim no existing implementation exists.
- Reviewer Council required but unavailable on a high-risk production change -> do not auto-approve.

TESTING
Use the repository's existing test framework.
Add focused tests for:
- mode routing,
- task classification,
- reuse selection,
- dependency guard,
- high-risk escalation,
- diff guard,
- governance disabled fallback.

Do not introduce a new test framework.

VERIFICATION
Discover the real project scripts before running anything.
Run all relevant existing checks such as:
- tests,
- lint,
- typecheck,
- build,
- git diff --check.

Do not run destructive scripts.

DO NOT
- rewrite the project,
- create a second router,
- create a second Reviewer Council,
- create another MCP runtime if one exists,
- add Redis/DB/queue/dashboard just for governance,
- remove safety controls,
- weaken auth,
- add cosmetic dependencies,
- hardcode machine paths,
- vendor the entire Ponytail repo without justification,
- modify unrelated files.

DELIVERABLES
At completion provide:
1. repository architecture findings,
2. files created/modified,
3. governance architecture implemented,
4. mode behavior,
5. Reviewer Council integration,
6. MCP/Codex integration status,
7. dependencies added (prefer none; justify any),
8. exact verification commands run,
9. test/build/lint/typecheck results,
10. git diff summary,
11. remaining risks/TODOs,
12. rollback instructions.

FINAL ACCEPTANCE CHECK
Before declaring success, verify:
- no duplicate subsystem was created,
- no unnecessary dependency was added,
- explicit requirements are preserved,
- high-risk changes cannot bypass review,
- plugin/MCP absence degrades safely,
- tests pass,
- build passes where applicable,
- git diff --check passes,
- no secrets are exposed,
- only Phase 20.9-related files changed.

Implement this phase now from the current repository state. Make the smallest correct production-ready change set that satisfies all requirements above.
```

---

# 32. Recommended First Production Settings

After implementation, start conservatively:

```text
PAO_GOVERNANCE_ENABLED=true
PAO_GOVERNANCE_MODE=full
PAO_GOVERNANCE_DIFF_GUARD=true
PAO_GOVERNANCE_DEPENDENCY_GUARD=true
PAO_GOVERNANCE_REUSE_SCAN=true
PAO_GOVERNANCE_REVIEWER_COUNCIL=true
PAO_GOVERNANCE_LOG_DECISIONS=true
```

Do not enable `ultra` globally.

Use `ultra` explicitly for refactoring/audit tasks.

---

# 33. Recommended Operational Workflow

```text
1. User submits coding task
2. Pao-hubPro classifies task + risk
3. Governance gate scans existing code
4. Governance selects minimum valid rung
5. Codex implements minimal patch
6. Run project verification
7. Run diff guard
8. If applicable run @ponytail-review
9. Trigger Reviewer Council when required
10. Revise if rejected
11. Produce governance + verification summary
12. Commit only after checks pass
```

---

# 34. Expected Phase 20.9 Outcome

After this phase, Pao-hubPro should increasingly behave like this:

```text
"Before I add anything, I will inspect what we already have."
```

instead of:

```text
"I can solve this by creating another subsystem."
```

The system should become:

- smaller,
- easier to maintain,
- cheaper to review,
- harder to accidentally duplicate,
- safer to extend,
- more predictable for Codex,
- better prepared for future autonomous agent phases.

---

# 35. Upstream References

- Ponytail repository: https://github.com/DietrichGebert/ponytail
- Ponytail MCP directory: https://github.com/DietrichGebert/ponytail/tree/main/ponytail-mcp
- License: MIT (upstream Ponytail)

When implementing against upstream Ponytail, verify the current README and current release before depending on version-specific behavior.

---

## END — Phase 20.9

**Next logical direction after Phase 20.9:** connect governance evidence to Pao-hubPro's AI Reviewer Council so review decisions can compare the requested requirement, selected minimality rung, actual diff, test evidence, and risk classification before allowing high-risk code changes.
