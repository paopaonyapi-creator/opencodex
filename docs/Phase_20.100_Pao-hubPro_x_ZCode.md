# Pao-hubPro × ZCode — Unified Agent-Native Coding Workspace Runtime, Desktop-Web-TUI Execution Fabric, Multi-Provider Agent Harness, MCP & Skills Federation, Permission-Brokered Tool Execution, Durable Subagent & Dynamic Workflow Orchestration, Browser Automation, Remote Host Attachment & Policy-Governed Coding Operations Plane

> **Status:** Proposed / Build-Ready Architecture Specification  
> **Project:** Pao-hubPro  
> **Integration Target:** ZCode (`zai-org/ZCode`, compatible with fork `jaturapornchai/ZCode`)  
> **Integration Strategy:** Adapter-first, policy-governed, upstream-friendly  
> **License Note:** ZCode upstream is distributed under Apache License 2.0. Preserve required notices and third-party attribution when redistributing derived components.

---

## 1. Executive Summary

This phase integrates ZCode into Pao-hubPro as a **unified agent-native coding workspace runtime** rather than replacing the Pao-hubPro control plane.

ZCode contributes a mature workspace/runtime foundation covering Desktop, Web, terminal/TUI, Agent CLI/runtime, MCP, Skills, subagents, dynamic workflows, permission brokering, browser automation, remote host/session semantics, provider abstractions, and persistent execution concepts.

Pao-hubPro remains the higher-level authority for:

- provider routing and provider policy;
- credentials and secret brokerage;
- MCP governance;
- Skills governance;
- tool execution policy;
- human approval gates;
- Reviewer Council decisions;
- audit/event history;
- budget/cost policy;
- remote execution trust;
- browser routing;
- sandbox boundaries;
- cross-runtime orchestration.

The target architecture therefore becomes:

```text
Pao-hubPro Control Plane
        │
        ├── Provider Router
        ├── Policy Engine
        ├── Credential Broker
        ├── MCP Registry
        ├── Skills Registry
        ├── Approval Broker
        ├── Workflow Orchestrator
        ├── Reviewer Council
        ├── Browser Router
        ├── Remote Host Manager
        └── Audit / Cost / Observability
                │
                ▼
        ZCode Runtime Adapter
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
   Desktop     Web       TUI/CLI
      │         │         │
      └─────────┴─────────┘
                │
        ZCode Agent Runtime
                │
       ┌────────┼─────────┐
       ▼        ▼         ▼
    MCP      Skills    Subagents
       │        │         │
       └────────┼─────────┘
                ▼
        Tools / Browser / Git
```

---

## 2. Primary Goal

Create a Pao-hubPro integration layer that can use ZCode as an execution/runtime substrate while preventing ZCode from becoming an uncontrolled source of truth for identity, credentials, provider choice, permissions, or destructive execution.

### Core goal statement

> **Use ZCode as a powerful, reusable Agent Workspace Runtime while keeping Pao-hubPro as the authoritative policy, routing, credentials, governance, observability, and durable orchestration plane.**

---

## 3. Design Principles

### 3.1 Adapter-first

Do not deeply fork ZCode core unless there is no stable extension point.

Prefer:

```text
Pao-hubPro
  └── integrations/zcode/*
```

over:

```text
patched-zcode-core-everywhere/*
```

This reduces upgrade friction and preserves the ability to consume upstream improvements.

### 3.2 Pao-hubPro owns policy

ZCode runtime modes, tool metadata, local rules, or UI state must never bypass Pao-hubPro policy for sensitive actions.

### 3.3 Default deny for privileged operations

When policy information is incomplete, stale, conflicting, or unavailable:

```text
DENY > ASK > ALLOW
```

### 3.4 Identity is not path

Remote and local runtime identity must distinguish:

```text
workspaceIdentity
workspacePath
runtimeId
hostId
sessionId
remoteSessionId
```

Never treat a filesystem path alone as a globally unique security identity.

### 3.5 Durable orchestration

Important workflows must be reconstructable after restart from an event journal.

### 3.6 Human-in-the-loop for high impact changes

High-risk operations require explicit approval unless a narrowly scoped policy already authorizes them.

### 3.7 Provider portability

ZCode must be able to run behind Pao-hubPro provider routing without coupling the full system to one model vendor.

---

## 4. ZCode Capabilities Adopted by This Phase

The integration should expose the following ZCode concepts through a Pao-hubPro adapter boundary.

### Workspace surfaces

- Desktop workspace;
- Web workspace;
- terminal/TUI;
- CLI/runtime execution.

### Agent runtime

- sessions;
- tools;
- model calls;
- runtime state;
- background work;
- subagents;
- workflow execution.

### MCP

- stdio MCP;
- HTTP/SSE-compatible MCP;
- workspace/user/common style scopes;
- OAuth-capable MCP configuration;
- timeout and isolation metadata;
- discovery/status/tool inventory.

### Skills

- project-level skills;
- user-level skills;
- system/admin concepts;
- plugin skills;
- bundled skills;
- remote skills;
- Skill diagnostics and validation.

### Permission flow

- allow;
- deny;
- ask;
- risk-level metadata;
- side-effect scope;
- session-scoped grants;
- persistent rule suggestions.

### Browser automation

- browser backend discovery;
- DOM snapshot → locator → action model;
- Playwright/CDP-oriented browser control;
- visual evidence through screenshots when required;
- Web UI black-box validation.

### Remote execution semantics

- host attachment;
- renderer/mobile consumers sharing an existing runtime;
- remote workspace identity;
- connection/session routing.

### Workflow durability concepts

- subagent registry;
- runtime task registry;
- workflow event journal;
- replay/reconstruction;
- progress projection.

---

## 5. Explicit Non-Goals

This phase must **not**:

1. Replace Pao-hubPro provider routing with ZCode provider selection.
2. Store long-lived secrets directly in ordinary ZCode project files.
3. Treat workspace isolation as an OS sandbox.
4. Assume all ZCode tool calls are safe because they pass through a runtime permission prompt.
5. Allow a runtime mode equivalent to unrestricted execution to override Pao-hubPro policy.
6. Replace Pao-hubPro browser routing with one ZCode browser backend.
7. Depend on ZCode Computer Use as the system-level desktop automation implementation.
8. Expose local runtime ports directly to the public Internet.
9. Merge upstream ZCode source into Pao-hubPro without license/notice preservation.
10. Make Pao-hubPro lifecycle depend on one ZCode version or one ZCode process.

---

## 6. Proposed Repository Layout

```text
pao-hubpro/
├── apps/
│   ├── dashboard/
│   ├── desktop/
│   └── remote-console/
│
├── packages/
│   ├── core/
│   ├── policy/
│   ├── credentials/
│   ├── providers/
│   ├── mcp-registry/
│   ├── skills-registry/
│   ├── approvals/
│   ├── workflows/
│   ├── reviewer-council/
│   ├── audit/
│   ├── observability/
│   ├── browser-router/
│   ├── remote-host/
│   │
│   └── integrations/
│       └── zcode/
│           ├── runtime-adapter/
│           ├── provider-bridge/
│           ├── mcp-bridge/
│           ├── skills-bridge/
│           ├── permission-bridge/
│           ├── workflow-bridge/
│           ├── browser-bridge/
│           ├── remote-host-bridge/
│           ├── telemetry-adapter/
│           ├── config-translator/
│           └── compatibility/
│
└── docs/
    └── phases/
```

---

## 7. Integration Boundary

Create a strict interface between Pao-hubPro and ZCode.

### 7.1 Runtime adapter contract

```ts
export interface ZCodeRuntimeAdapter {
  startRuntime(input: StartRuntimeInput): Promise<RuntimeHandle>;
  stopRuntime(runtimeId: string): Promise<void>;

  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  cancelSession(sessionId: string): Promise<void>;

  executeTurn(input: ExecuteTurnInput): Promise<TurnResult>;

  listTools(sessionId: string): Promise<ToolDescriptor[]>;
  listMcpServers(sessionId: string): Promise<McpServerStatus[]>;
  listSkills(sessionId: string): Promise<SkillDescriptor[]>;
  listSubagents(sessionId: string): Promise<SubagentDescriptor[]>;

  getWorkflowState(workflowRunId: string): Promise<WorkflowProjection>;
  getRuntimeHealth(runtimeId: string): Promise<RuntimeHealth>;
}
```

### 7.2 No direct privilege escalation

The adapter must not expose raw unrestricted process execution to callers outside the Pao-hubPro policy layer.

---

## 8. Provider Control Plane

ZCode should consume a provider selection already resolved by Pao-hubPro.

### Target flow

```text
User Task
   │
   ▼
Pao Provider Router
   │
   ├── capability match
   ├── context-window requirement
   ├── model availability
   ├── cost budget
   ├── latency policy
   ├── provider health
   └── fallback chain
   │
   ▼
Resolved Provider Lease
   │
   ▼
ZCode Provider Bridge
   │
   ▼
ZCode Agent Runtime
```

### Provider lease object

```ts
interface ProviderLease {
  leaseId: string;
  providerId: string;
  modelId: string;
  endpointRef: string;
  credentialRef: string;
  expiresAt?: string;
  maxTokens?: number;
  maxCostUsd?: number;
  allowedCapabilities: string[];
  fallbackChain?: string[];
}
```

### Integration targets

The bridge should be compatible with Pao-hubPro provider modules such as:

- OpenAI / Codex;
- Claude-compatible providers;
- Z.ai;
- Grok-compatible endpoints;
- local OpenAI-compatible servers;
- 9Router;
- OmniRoute;
- CC Switch-style config registry;
- future provider pools.

---

## 9. Provider Failover

Failover must be owned by Pao-hubPro.

```text
Primary Provider
       │
       ├── timeout
       ├── rate limit
       ├── capacity unavailable
       ├── auth expired
       └── budget exceeded
              │
              ▼
      Pao Failover Policy
              │
        ┌─────┴─────┐
        ▼           ▼
     retry       fallback
                    │
                    ▼
             secondary model
```

A model switch should append an event to the audit journal.

---

## 10. MCP Federation

ZCode's MCP capabilities should become a runtime consumer of the Pao-hubPro MCP Registry.

### Canonical registry

```text
Pao MCP Registry
├── server identity
├── source
├── transport
├── scopes
├── health
├── trust status
├── credential reference
├── tool inventory
├── required approvals
├── isolation policy
├── protocol compatibility
└── audit history
```

### Desired scopes

```text
system
organization
user
workspace
session
```

These can be mapped to ZCode concepts where possible.

### MCP resolution flow

```text
ZCode session requests MCP set
        │
        ▼
Pao MCP Resolver
        │
        ├── merge scopes
        ├── apply deny rules
        ├── check trust
        ├── resolve credentials
        ├── validate transport
        └── assign isolation
        │
        ▼
Ephemeral ZCode MCP Configuration
```

### Important security rule

Never persist plaintext production credentials inside generated MCP config when a runtime token or short-lived credential can be injected instead.

---

## 11. MCP Trust Levels

```text
TRUSTED_BUILTIN
TRUSTED_ADMIN
TRUSTED_USER
WORKSPACE_APPROVED
UNTRUSTED
BLOCKED
```

Suggested behavior:

| Trust level | Auto-connect | Tool use | Credential access |
|---|---:|---:|---:|
| TRUSTED_BUILTIN | yes | policy controlled | brokered |
| TRUSTED_ADMIN | yes | policy controlled | brokered |
| TRUSTED_USER | optional | policy controlled | brokered |
| WORKSPACE_APPROVED | after approval | ask by default | scoped only |
| UNTRUSTED | no | deny/ask | none |
| BLOCKED | no | deny | none |

---

## 12. Skills Federation

Pao-hubPro should become the canonical catalog for cross-runtime Skills.

### Canonical Skill object

```ts
interface PaoSkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;

  source:
    | "pao"
    | "zcode"
    | "codex"
    | "chatgpt"
    | "plugin"
    | "workspace"
    | "remote";

  scope: "system" | "user" | "workspace" | "session";

  entrypoint: string;
  checksum: string;

  safeToAutoLoad: boolean;
  allowImplicitInvocation: boolean;

  requiredTools?: string[];
  requiredMcpServers?: string[];
  requiredCapabilities?: string[];

  trustLevel: string;
  enabled: boolean;
}
```

### Skill pipeline

```text
Skill discovered
      │
      ▼
Schema validation
      │
      ▼
Path containment check
      │
      ▼
Trust classification
      │
      ▼
Dependency analysis
      │
      ▼
SkillsGate
      │
      ├── approve
      ├── quarantine
      └── reject
      │
      ▼
Runtime-specific projection
```

---

## 13. Skills Compatibility Layer

Create translators:

```text
Pao Skill → ZCode SKILL.md
Pao Skill → Codex Skill
ZCode Skill → Pao Skill Manifest
Workspace Skill → Quarantined Pao Skill
```

Do not blindly copy untrusted skill support files across machines.

---

## 14. Permission Broker

Pao-hubPro must sit above runtime-specific permission decisions.

### Pao permission decision

```ts
interface PermissionDecision {
  decision: "allow" | "deny" | "ask";
  riskLevel: "low" | "medium" | "high" | "critical";
  sideEffectScope?: string;
  reason: string;
  ruleId?: string;
  expiresAt?: string;
}
```

### Side-effect scopes

```text
read.files
write.files
delete.files
shell.local
shell.remote
git.read
git.write
git.push
network.read
network.write
browser.read
browser.write
credentials.read
mcp.invoke
email.send
cloud.deploy
database.read
database.write
process.kill
system.settings
```

---

## 15. Permission Evaluation Order

```text
1. hard deny policy
2. security boundary validation
3. credential scope validation
4. workspace trust
5. tool trust
6. risk classification
7. session rule
8. project/user rule
9. runtime rule
10. human approval if required
```

The runtime cannot override steps 1–6.

---

## 16. Human Approval UI

Each approval should show enough information to make an informed decision.

### Required display fields

- agent;
- provider/model;
- tool;
- target host;
- workspace;
- exact operation;
- side-effect category;
- risk level;
- credential scope;
- preview/diff where available;
- estimated cost where meaningful;
- whether the grant is once/session/persistent.

### Allowed responses

```text
Allow once
Allow for session
Allow matching rule
Deny
Deny + feedback
Edit input and allow
```

Persistent allow must not be offered for tools whose semantic payload changes unpredictably unless the policy engine can normalize a safe rule.

---

## 17. Runtime Modes

Do not expose raw runtime unrestricted modes directly.

Define Pao-hubPro modes:

### SAFE

- read-only by default;
- no shell writes;
- no Git writes;
- no network side effects;
- no credential-bearing external actions.

### BUILD

- project file writes allowed;
- local builds/tests allowed;
- destructive operations gated;
- external actions gated.

### REVIEW

- intended for Reviewer Council;
- read/diff/test focused;
- write disabled except explicitly approved remediation branches.

### ADMIN

- elevated operations possible;
- explicit high-risk approvals remain available;
- full audit required.

---

## 18. Subagent Orchestration

ZCode subagents should register into the Pao-hubPro Agent Registry.

### Agent record

```ts
interface AgentInstance {
  agentId: string;
  parentAgentId?: string;
  sessionId: string;
  workflowRunId?: string;
  role: string;
  providerLeaseId: string;
  state:
    | "starting"
    | "running"
    | "waiting"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: string;
  updatedAt: string;
}
```

### Example coding fleet

```text
Lead Agent
 ├── Planner
 ├── Repository Analyst
 ├── Coder A
 ├── Coder B
 ├── Test Agent
 ├── Security Reviewer
 └── Final Reviewer
```

---

## 19. Reviewer Council Integration

Pao-hubPro Reviewer Council should be able to review ZCode-generated changes before sensitive merge/deploy actions.

```text
ZCode Coding Agent
        │
        ▼
Patch / Diff / Test Results
        │
        ▼
Reviewer Council
  ├── ChatGPT reviewer
  ├── Local reviewer
  ├── Claude reviewer
  └── optional specialist
        │
        ▼
Council Aggregator
        │
   ┌────┼─────┐
   ▼    ▼     ▼
approve revise block
```

The Council verdict itself does not bypass the Permission Broker.

---

## 20. Dynamic Workflow Orchestration

Define a common workflow DSL that can project into ZCode dynamic workflows.

### Example

```yaml
workflow:
  id: feature-build
  version: 1

actors:
  planner:
    role: planner
  coder:
    role: coder
  tester:
    role: tester
  reviewer:
    role: reviewer

steps:
  - id: plan
    actor: planner
    output: implementation_plan

  - id: implement
    actor: coder
    requires: [plan]
    output: patch

  - id: test
    actor: tester
    requires: [implement]
    output: test_report

  - id: review
    actor: reviewer
    requires: [test]
    gate: reviewer_council
```

---

## 21. Durable Workflow Journal

All workflow state transitions should be append-only events.

### Event examples

```text
workflow.created
workflow.started
workflow.paused
workflow.resumed
workflow.completed
workflow.failed

agent.spawned
agent.started
agent.waiting
agent.completed
agent.failed
agent.cancelled

tool.requested
tool.approval_required
tool.approved
tool.denied
tool.completed
tool.failed

provider.lease_created
provider.failover

mcp.connected
mcp.failed

review.requested
review.completed
```

### Journal record

```ts
interface WorkflowEvent {
  eventId: string;
  workflowRunId: string;
  sequence: number;
  eventType: string;
  actorType: string;
  actorId?: string;
  payload: unknown;
  traceId: string;
  createdAt: string;
}
```

---

## 22. Replay Model

Runtime restart must support:

```text
Journal
  │
  ▼
Reducer
  │
  ▼
Workflow Projection
  │
  ├── current step
  ├── active agents
  ├── pending approvals
  ├── failed operations
  ├── completed artifacts
  └── health status
```

Never rely exclusively on an in-memory runtime registry for durable progress.

---

## 23. Browser Automation Bridge

ZCode Browser Use should become one backend inside Pao-hubPro Browser Router.

### Backends

```text
Pao Browser Router
├── ZCode Browser Use
├── Oya Browser
├── Chrome Extension Bridge
├── CDP Direct
├── Playwright Worker
└── future browser providers
```

### Routing examples

| Task | Preferred backend |
|---|---|
| deterministic web form | ZCode Browser Use / Playwright |
| existing signed-in user browser | Oya / Extension Bridge |
| isolated scraping | headless CDP |
| GUI visual validation | ZCode web-gui-tester |
| human takeover | persistent browser session |

---

## 24. Browser Security

Browser operations are side-effectful.

Require additional checks for:

- form submission;
- purchase/payment;
- account deletion;
- posting public content;
- sending messages;
- uploading files;
- downloading unknown executables;
- OAuth consent;
- credential entry;
- administrative settings.

### Human takeover

```text
Agent controls browser
        │
        ▼
Sensitive boundary detected
        │
        ▼
Secure Human Takeover
        │
        ▼
User completes sensitive step
        │
        ▼
Agent resumes with sanitized state
```

---

## 25. Computer Use Boundary

Do not design this phase around ZCode's repository placeholder Computer Use implementation.

Pao-hubPro should preserve a dedicated system-level automation boundary through its own Computer/Remote Desktop components.

```text
Browser task      → Browser Router
Desktop GUI task  → Pao Computer Control
Remote host task  → Remote Desktop Commander
Terminal task     → Policy-gated Shell
```

---

## 26. Remote Host Attachment

Use a host-attachment architecture instead of spawning unrelated agent copies for each UI.

```text
Desktop Host
    │
    ├── Desktop Renderer
    ├── Web Client
    └── Mobile Console
           │
           ▼
      same authoritative
      agent/session runtime
```

### Benefits

- shared conversation state;
- shared tool state;
- fewer duplicated agents;
- lower token/cost duplication;
- consistent approvals;
- easier handoff between desktop and mobile.

---

## 27. Remote Host Trust Model

Each host must have:

```text
hostId
publicKey
hostType
platform
owner
trustLevel
capabilities
lastSeenAt
policyProfileId
```

### Trust levels

```text
LOCAL_TRUSTED
PAIRED_TRUSTED
LIMITED
QUARANTINED
REVOKED
```

High-risk operations on remote hosts should require stronger approval rules than the same operations on a local trusted workstation.

---

## 28. Credential Broker

Secrets must be referenced, not casually copied.

### Credential reference

```ts
interface CredentialRef {
  id: string;
  provider: string;
  scope: string[];
  secretType: "api_key" | "oauth" | "token" | "password" | "certificate";
  expiresAt?: string;
}
```

### Runtime flow

```text
Runtime requests credential capability
        │
        ▼
Credential Broker
        │
        ├── validate caller
        ├── validate tool
        ├── validate workspace
        ├── validate scope
        └── issue short-lived secret/token
        │
        ▼
Ephemeral runtime injection
```

Never log secret values.

---

## 29. Audit Log

Every consequential operation should be traceable.

### Audit categories

```text
auth
provider
agent
workflow
tool
permission
mcp
skill
browser
remote_host
credential
git
deployment
review
system
```

### Audit record

```ts
interface AuditEvent {
  id: string;
  traceId: string;
  sessionId?: string;
  workflowRunId?: string;
  actorId?: string;
  category: string;
  action: string;
  target?: string;
  decision?: string;
  riskLevel?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

---

## 30. Observability

Create a unified observability surface for both Pao-hubPro and ZCode.

### Metrics

- active runtimes;
- active sessions;
- active subagents;
- workflow duration;
- tool latency;
- MCP connection latency;
- provider latency;
- token usage;
- cost;
- retry rate;
- provider failover count;
- approval wait time;
- tool failure rate;
- browser operation failure rate;
- agent completion rate.

### Trace hierarchy

```text
workflow trace
  └── session trace
       └── turn trace
            ├── model span
            ├── tool span
            ├── MCP span
            ├── browser span
            └── approval span
```

---

## 31. Cost Governance

Each workflow can define budgets.

```ts
interface WorkflowBudget {
  maxCostUsd?: number;
  maxTokens?: number;
  maxModelCalls?: number;
  maxSubagents?: number;
  maxRuntimeMinutes?: number;
}
```

### Budget actions

```text
WARN
THROTTLE
DOWNGRADE_MODEL
PAUSE
REQUIRE_APPROVAL
STOP
```

---

## 32. Proposed Database Schema

### runtimes

```text
id
kind
host_id
workspace_identity
workspace_path
version
status
started_at
stopped_at
metadata_json
```

### sessions

```text
id
runtime_id
workspace_identity
provider_lease_id
mode
status
created_at
updated_at
```

### agents

```text
id
session_id
workflow_run_id
parent_agent_id
role
provider_lease_id
status
created_at
updated_at
```

### workflow_runs

```text
id
workflow_id
session_id
status
current_step
created_at
updated_at
completed_at
```

### workflow_events

```text
id
workflow_run_id
sequence
trace_id
event_type
actor_type
actor_id
payload_json
created_at
```

### permission_requests

```text
id
session_id
trace_id
tool_call_id
tool_name
risk_level
side_effect_scope
input_hash
status
requested_at
resolved_at
resolved_by
```

### mcp_servers

```text
id
name
transport
scope
trust_level
credential_ref
enabled
config_json
created_at
updated_at
```

### skills

```text
id
name
version
source
scope
trust_level
checksum
entrypoint
enabled
manifest_json
created_at
updated_at
```

### provider_leases

```text
id
provider_id
model_id
credential_ref
max_cost_usd
expires_at
created_at
```

### audit_events

```text
id
trace_id
session_id
workflow_run_id
actor_id
category
action
target
decision
risk_level
metadata_json
created_at
```

---

## 33. API Surface

Suggested Pao-hubPro endpoints:

```text
POST   /api/zcode/runtimes
GET    /api/zcode/runtimes
GET    /api/zcode/runtimes/:id
DELETE /api/zcode/runtimes/:id

POST   /api/zcode/sessions
GET    /api/zcode/sessions/:id
POST   /api/zcode/sessions/:id/turns
POST   /api/zcode/sessions/:id/cancel

GET    /api/zcode/sessions/:id/tools
GET    /api/zcode/sessions/:id/mcp
GET    /api/zcode/sessions/:id/skills
GET    /api/zcode/sessions/:id/subagents

GET    /api/zcode/workflows/:id
POST   /api/zcode/workflows/:id/pause
POST   /api/zcode/workflows/:id/resume
POST   /api/zcode/workflows/:id/cancel

GET    /api/approvals
POST   /api/approvals/:id/allow
POST   /api/approvals/:id/deny

GET    /api/audit
GET    /api/observability/zcode
```

---

## 34. Internal Event Bus

Use durable internal events where practical.

### Topic examples

```text
zcode.runtime.started
zcode.runtime.stopped
zcode.runtime.failed

zcode.session.created
zcode.session.resumed
zcode.session.closed

zcode.agent.spawned
zcode.agent.completed
zcode.agent.failed

zcode.tool.requested
zcode.tool.completed
zcode.tool.failed

zcode.permission.requested
zcode.permission.resolved

zcode.mcp.connected
zcode.mcp.failed

zcode.workflow.started
zcode.workflow.progress
zcode.workflow.completed
zcode.workflow.failed

zcode.browser.action
zcode.browser.takeover_requested

zcode.provider.failover
```

---

## 35. Dashboard UI

Add a dedicated **ZCode Runtime** area to Pao-hubPro Dashboard.

### Page: Runtime Overview

Show:

- runtime health;
- ZCode version;
- host;
- workspace;
- active sessions;
- active agents;
- token usage;
- estimated cost;
- MCP status;
- approval queue;
- browser status.

### Page: Agent Fleet

Show agent cards:

```text
Role
Model
Status
Current task
Duration
Tokens
Cost
Parent
Workflow
```

### Page: Workflow Timeline

Visualize:

```text
Plan → Implement → Test → Review → Approval → Merge
```

with live progress and replay history.

### Page: MCP & Skills

Show:

- source;
- trust;
- scope;
- status;
- dependencies;
- last error;
- enabled/disabled;
- policy warnings.

### Page: Approvals

High-signal cards with diff/preview and risk information.

---

## 36. Security Architecture

```text
Untrusted Input
      │
      ▼
Prompt / Content Boundary
      │
      ▼
Agent Runtime
      │
      ▼
Tool Intent
      │
      ▼
Pao Policy Engine
      │
      ├── identity check
      ├── trust check
      ├── credential scope
      ├── side-effect scope
      ├── risk score
      └── human approval
      │
      ▼
Execution Adapter
      │
      ▼
Sandbox / Host / Browser / MCP
```

---

## 37. Sandbox Strategy

Because runtime/workspace isolation is not equivalent to an OS sandbox, Pao-hubPro should support stronger execution isolation.

### Isolation profiles

```text
DIRECT_TRUSTED
RESTRICTED_PROCESS
CONTAINER
VM
REMOTE_SANDBOX
```

### Tool assignment

Example:

```text
Read files       → direct allowed
Project build    → restricted process
Unknown script   → container
External repo    → disposable sandbox
Untrusted binary → deny / isolated VM
```

---

## 38. Git Safety

Git operations need dedicated policy.

### Reads

Usually lower risk:

```text
git status
git diff
git log
git show
```

### Writes

Policy-controlled:

```text
git add
git commit
git checkout
git reset
git rebase
```

### External side effects

Approval-gated by default:

```text
git push
force push
tag push
release creation
PR merge
```

Reviewer Council should run before merge/deploy policies when configured.

---

## 39. Hook Governance

Hooks can become implicit code execution.

Create a central hook policy for:

```text
SessionStart
UserPromptSubmit
PreToolUse
PermissionRequest
PostToolUse
PostToolUseFailure
Stop
```

### Hook trust

```text
builtin
admin-approved
workspace-approved
untrusted
blocked
```

Hook manifest changes must invalidate previous trust when the signed/hash identity changes.

---

## 40. Compatibility Matrix

Maintain a compatibility file:

```yaml
zcode:
  supported:
    - ">=3.14.0 <4.0.0"

capabilities:
  mcp: true
  skills: true
  subagents: true
  dynamic_workflows: true
  browser_use: true
  remote_host_attachment: true
  computer_use:
    mode: external_pao_runtime
```

### Startup validation

On runtime boot:

1. detect ZCode version;
2. load compatibility profile;
3. verify required APIs/protocol features;
4. disable unsupported optional features;
5. fail closed for missing security-critical capabilities.

---

## 41. Upstream Sync Strategy

Use an integration branch or pinned upstream reference.

Recommended:

```text
upstream/zcode
pao/zcode-adapter
```

Avoid long-lived invasive patches.

Track:

- protocol changes;
- provider config changes;
- MCP schema changes;
- Skills schema changes;
- permission contract changes;
- browser APIs;
- workflow event semantics;
- session identity changes.

---

## 42. Build Sequence

### Milestone A — Runtime Adapter

Build:

- version detection;
- process lifecycle;
- health endpoint;
- session create/resume;
- turn execution;
- structured event projection.

### Milestone B — Provider Bridge

Build:

- provider lease mapping;
- model routing;
- credentials injection;
- failover events;
- cost telemetry.

### Milestone C — MCP & Skills Federation

Build:

- registry mapping;
- trust mapping;
- config projection;
- diagnostics;
- SkillsGate integration.

### Milestone D — Permission Bridge

Build:

- tool classification;
- side-effect classification;
- risk scoring;
- approval queue;
- session grants;
- audit log.

### Milestone E — Subagent / Workflow Bridge

Build:

- agent registry;
- workflow event ingestion;
- projection;
- journal;
- replay;
- Reviewer Council gate.

### Milestone F — Browser Bridge

Build:

- backend registration;
- browser capability discovery;
- browser action telemetry;
- sensitive-action gates;
- human takeover.

### Milestone G — Remote Host Integration

Build:

- host identities;
- pairing;
- mobile attachment;
- remote policy;
- remote session recovery.

### Milestone H — Dashboard & Production Hardening

Build:

- runtime overview;
- agent fleet;
- workflow timeline;
- approvals;
- MCP/Skills health;
- cost dashboards;
- recovery tests;
- chaos/failure tests.

---

## 43. Suggested Module Interfaces

### Policy bridge

```ts
export interface ZCodePolicyBridge {
  evaluateTool(input: ToolPolicyInput): Promise<ToolPolicyResult>;
  evaluateMcp(input: McpPolicyInput): Promise<McpPolicyResult>;
  evaluateSkill(input: SkillPolicyInput): Promise<SkillPolicyResult>;
  evaluateBrowserAction(input: BrowserPolicyInput): Promise<BrowserPolicyResult>;
}
```

### Workflow bridge

```ts
export interface ZCodeWorkflowBridge {
  ingestEvent(event: unknown): Promise<void>;
  projectRun(runId: string): Promise<WorkflowProjection>;
  replay(runId: string): Promise<WorkflowProjection>;
}
```

### Browser bridge

```ts
export interface ZCodeBrowserBridge {
  listBrowsers(): Promise<BrowserBackend[]>;
  acquireSession(input: BrowserSessionRequest): Promise<BrowserSession>;
  releaseSession(sessionId: string): Promise<void>;
}
```

---

## 44. Failure Handling

### Provider failure

- retry only if idempotent/safe;
- trigger fallback according to lease policy;
- record provider failover event.

### MCP failure

- classify startup vs invocation failure;
- do not silently switch to an unrelated tool;
- surface degraded state.

### Runtime crash

- preserve journal;
- mark runtime failed;
- recreate runtime;
- replay projection;
- resume only resumable work.

### Approval service unavailable

- high-risk operations fail closed;
- low-risk read-only operations may continue if policy explicitly permits.

### Remote host disconnect

- mark operations suspended;
- do not duplicate side-effectful commands during reconnect;
- use command/run idempotency keys.

---

## 45. Idempotency

Every side-effectful operation should carry an idempotency key.

```text
workflowRunId
stepId
toolCallId
attempt
```

Example:

```text
wf_123:deploy:tool_456:1
```

This is especially important for:

- remote execution;
- deploy;
- browser submissions;
- Git operations;
- external API writes;
- reconnect/resume flows.

---

## 46. Testing Strategy

### Unit tests

- provider mapping;
- policy decisions;
- scope resolution;
- skill parsing;
- event reducers;
- compatibility checks.

### Integration tests

- ZCode runtime boot;
- Web/TUI/CLI parity;
- MCP connect/disconnect;
- Skill load;
- subagent spawn;
- workflow replay;
- browser control;
- remote attachment.

### Security tests

- prompt injection through repository files;
- malicious Skill;
- malicious MCP server;
- command injection;
- path traversal;
- symlink escape;
- credential leak attempts;
- approval bypass;
- stale session replay;
- duplicate side effects.

### Recovery tests

Kill runtime during:

- model call;
- tool invocation;
- approval wait;
- subagent execution;
- browser action;
- workflow transition.

Verify deterministic recovery behavior.

---

## 47. Acceptance Checklist

### Runtime

- [ ] Pao-hubPro can start/stop a compatible ZCode runtime.
- [ ] Runtime version compatibility is checked before session creation.
- [ ] Health state is visible in Dashboard.
- [ ] Runtime crash does not corrupt the Pao workflow journal.

### Providers

- [ ] Pao-hubPro controls provider/model selection.
- [ ] Secrets are passed through Credential Broker references.
- [ ] Provider failover is audited.
- [ ] Cost/token telemetry is collected.

### MCP

- [ ] Pao MCP Registry projects valid config into ZCode.
- [ ] Workspace MCP can require explicit trust.
- [ ] MCP credentials are scoped and brokered.
- [ ] MCP failure is visible without silently bypassing policy.

### Skills

- [ ] Skills from ZCode can be discovered by Pao Skills Registry.
- [ ] Pao Skills can be projected into ZCode-compatible form.
- [ ] Untrusted workspace Skills are quarantined or approval-gated.
- [ ] Skill path/symlink containment is validated.

### Permission

- [ ] Every sensitive tool request passes Pao Policy Engine.
- [ ] Risk level and side-effect scope are recorded.
- [ ] Session-only grants are supported.
- [ ] High-risk operations fail closed when approval UI is unavailable.

### Agents & Workflows

- [ ] ZCode subagents appear in Pao Agent Registry.
- [ ] Dynamic workflow progress is projected into Dashboard.
- [ ] Workflow state can be reconstructed from journal events.
- [ ] Reviewer Council can gate merge/deploy workflow steps.

### Browser

- [ ] ZCode Browser Use appears as one backend in Browser Router.
- [ ] Browser write actions are classified separately from reads.
- [ ] Human takeover can be requested at sensitive steps.
- [ ] Browser sessions are auditable.

### Remote

- [ ] Desktop/Web/Mobile can attach to an authoritative host/session model.
- [ ] Remote host trust level affects permission policy.
- [ ] Reconnect does not duplicate high-impact side effects.

### Security

- [ ] No OS-sandbox assumption is made from workspace isolation.
- [ ] Plaintext production credentials are not stored in project config.
- [ ] Runtime unrestricted modes cannot bypass Pao policy.
- [ ] Audit records contain no secret values.

### Upstream

- [ ] Apache-2.0 licensing requirements are preserved.
- [ ] Required third-party notices are retained for redistributed components.
- [ ] Compatibility range is documented.
- [ ] Upstream patch surface remains minimal.

---

## 48. Definition of Done

This phase is complete when Pao-hubPro can treat ZCode as a managed runtime backend with:

1. controlled provider selection;
2. controlled MCP and Skills projection;
3. Pao-owned permission enforcement;
4. human approval for high-risk tools;
5. subagent visibility;
6. durable workflow journal and replay;
7. Reviewer Council workflow gates;
8. browser backend integration;
9. remote host/session attachment support;
10. unified audit, metrics, and cost telemetry;
11. restart-safe recovery;
12. no dependency on ZCode as the root authority for secrets, policy, or privilege.

---

## 49. Recommended Final Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Pao-hubPro                              │
│                                                                 │
│  Provider Router   Policy Engine   Credential Broker            │
│  MCP Registry      SkillsGate      Approval Broker              │
│  Browser Router    Reviewer Council Workflow Orchestrator       │
│  Remote Hosts      Audit Log       Cost / Observability         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ZCode Integration Layer
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
 Provider Bridge          Permission Bridge      MCP/Skills Bridge
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                         ZCode Runtime
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
   Desktop/Web/TUI          Subagents               Browser Use
       │                       │                        │
       └─────────────── Dynamic Workflow ──────────────┘
                               │
                        Tools / Git / Shell
                               │
                         Execution Hosts
```

---

## 50. Recommended Implementation Decision

**Adopt ZCode as a managed agent workspace/runtime subsystem.**

Do not make it the Pao-hubPro root control plane.

The most valuable concepts to reuse are:

- multi-surface runtime;
- agent runtime/CLI;
- MCP plumbing;
- Skills infrastructure;
- subagents;
- dynamic workflows;
- workflow replay concepts;
- permission broker concepts;
- browser-use runtime;
- remote host/session semantics;
- provider abstraction.

Pao-hubPro should add stronger cross-runtime governance, credentials, auditability, sandboxing, multi-provider routing, Reviewer Council, browser routing, and durable policy enforcement on top.

---

## 51. `/goal` — One-Shot Codex Build Command

```text
/goal Build the Pao-hubPro × ZCode integration as an adapter-first, upstream-friendly Agent-Native Coding Workspace Runtime subsystem. Keep Pao-hubPro as the authoritative control plane for provider routing, credentials, MCP/Skills governance, tool permissions, human approvals, Reviewer Council, workflow durability, browser routing, remote-host trust, audit, cost and observability. Implement packages/integrations/zcode with runtime-adapter, provider-bridge, mcp-bridge, skills-bridge, permission-bridge, workflow-bridge, browser-bridge, remote-host-bridge, telemetry-adapter, config-translator and compatibility modules. Add strict runtime-version capability detection; Pao-managed provider leases and failover; brokered ephemeral credentials; canonical MCP and Skills registries with trust/scope projection; side-effect-aware permission evaluation; approval UI contracts; SAFE/BUILD/REVIEW/ADMIN policy modes; ZCode subagent projection into Pao Agent Registry; append-only workflow event journal plus deterministic replay; Reviewer Council workflow gates; Browser Router integration with ZCode Browser Use as one backend; human takeover for sensitive browser actions; remote host identities and shared authoritative session attachment; idempotency keys for side-effectful operations; unified tracing, audit, token/cost telemetry and health metrics; restart-safe recovery; compatibility tests; security tests for malicious skills/MCP, prompt injection, path traversal, symlink escape, credential exfiltration and approval bypass. Do not treat workspace isolation as an OS sandbox, do not rely on ZCode Computer Use as the system-level automation layer, do not store production secrets in project config, and do not allow unrestricted runtime modes to bypass Pao policy. Preserve Apache-2.0 and third-party notices. Deliver implementation, migrations, tests, docs, sample configs and a final acceptance report proving every checklist item in this phase.
```

---

## 52. Source References

- ZCode upstream: <https://github.com/zai-org/ZCode>
- User-provided fork: <https://github.com/jaturapornchai/ZCode>
- ZCode project homepage: <https://zcode.z.ai/>

---

**End of Phase Specification**
