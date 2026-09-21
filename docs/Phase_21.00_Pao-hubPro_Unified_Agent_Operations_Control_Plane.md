# Phase 21.00 — Pao-hubPro Unified Agent Operations Control Plane

**Full title:**  
**Phase 21.00 — Pao-hubPro Unified Agent Operations Control Plane — Durable Multi-Agent Fleet Orchestration, Mobile Operations Console, Cross-Host Runtime Federation, Central MCP & Skills Governance, Secure Remote Execution, Human Approval Fabric, Unified Audit & Policy Enforcement, Resumable Workflows & Production-Grade Agent Infrastructure**

**Status:** GOLD / CLOSED (VERIFIED)  
**Phase type:** Integration / Consolidation / Production Hardening  
**Canonical predecessors:** Phase 20.98 + Phase 20.99  
**Target:** Pao-hubPro  
**Date:** 2026-09-20  
**Verification Result:** 107/107 PASS across 7 test suites, 0 FAIL, Typecheck Clean (Exit code 0)

---

## 0. Executive Summary

Phase 21.00 is the transition point from a collection of powerful subsystems into a single, governed Pao-hubPro operations platform.

The phase does **not** rewrite Phase 20.98 or Phase 20.99. Both predecessors are treated as canonical, closed dependencies.

- **Phase 20.98 — OpenHermit** provides the durable multi-agent runtime foundation.
- **Phase 20.99 — Whip** provides the mobile operations, remote-host, pairing, approval, terminal, SFTP, and offline-command foundation.
- **Phase 21.00** introduces the unified control plane that binds these capabilities together under one operational model, one policy model, one audit model, and one state model.

The result must allow Pao-hubPro to supervise agents, hosts, tools, skills, jobs, approvals, sessions, credentials, remote execution, and recovery workflows from a single coherent runtime.

The phase is considered complete only when the implementation is verified against repository reality, acceptance tests pass, canonical management routes are enforced, security boundaries are intact, audit correlation is preserved, and the phase can be declared **GOLD / CLOSED** without requiring undocumented manual steps.

---

# 1. Mission

Build the **Unified Agent Operations Control Plane** for Pao-hubPro.

The platform SHALL provide:

1. Durable multi-agent fleet orchestration.
2. Cross-host runtime federation.
3. Central agent, host, MCP, and skill registries.
4. Mobile and web operations surfaces.
5. Secure remote command execution.
6. Human approval gates for sensitive operations.
7. Credential-reference-only handling.
8. Offline-safe and resumable workflows.
9. Unified policy enforcement.
10. End-to-end audit correlation.
11. Provider-neutral agent supervision.
12. Failure recovery and replay-safe execution.
13. Canonical management routes.
14. Production health and readiness reporting.
15. Verifiable implementation documentation.

---

# 2. Architectural Position

```text
                              ┌──────────────────────────────┐
                              │         Pao-hubPro           │
                              │ Unified Operations Platform  │
                              └──────────────┬───────────────┘
                                             │
                           ┌─────────────────┴─────────────────┐
                           │                                   │
                 ┌─────────▼─────────┐               ┌────────▼────────┐
                 │ Phase 20.98       │               │ Phase 20.99     │
                 │ OpenHermit        │               │ Whip            │
                 │                   │               │                 │
                 │ Durable Agents    │               │ Mobile Console  │
                 │ PostgreSQL State  │               │ SSH / SFTP      │
                 │ Sandbox Fabric    │               │ Offline Queue   │
                 │ Skills / MCP      │               │ Secure Pairing  │
                 │ Multi-Channel     │               │ Human Approval  │
                 └─────────┬─────────┘               └────────┬────────┘
                           │                                   │
                           └─────────────────┬─────────────────┘
                                             │
                              ┌──────────────▼───────────────┐
                              │        Phase 21.00           │
                              │ Unified Agent Operations     │
                              │        Control Plane         │
                              └──────────────┬───────────────┘
                                             │
         ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
         │                   │               │               │                   │
   ┌─────▼─────┐       ┌─────▼─────┐   ┌────▼────┐    ┌────▼────┐       ┌──────▼──────┐
   │ Local PC  │       │    VPS    │   │ Runpod  │    │ Browser │       │ Mobile Node │
   │ Codex     │       │ Services  │   │ ComfyUI │    │ Agents  │       │ Whip Client │
   └───────────┘       └───────────┘   └─────────┘    └─────────┘       └─────────────┘
```

---

# 3. Non-Goals

Phase 21.00 SHALL NOT:

- Rebuild OpenHermit.
- Rebuild Whip.
- Replace stable Phase 20.98/20.99 contracts without a migration requirement.
- Add unrelated UI redesigns.
- Introduce a new provider solely for novelty.
- Store raw secrets in QR payloads, logs, audit rows, agent prompts, or job payloads.
- Permit silent bypass of approval policy.
- Permit unsafe automatic replay of ambiguous commands.
- Merge Lab-only behavior into Core without explicit promotion.
- Introduce broad refactoring unrelated to Phase 21.00.
- Declare GOLD based only on documentation.

---

# 4. Canonical Dependencies

## 4.1 Phase 20.98 — OpenHermit

Phase 21.00 SHALL consume, not replace:

- durable agent state
- PostgreSQL-backed agent lifecycle
- agent sandbox boundaries
- skills/MCP governance primitives
- multi-channel delivery
- resumable agent operations
- deep-research approval gates
- production agent fleet concepts

## 4.2 Phase 20.99 — Whip

Phase 21.00 SHALL consume, not replace:

- mobile agent operations
- SSH host access
- Tailscale-aware connectivity
- remote terminal
- SFTP workspace
- offline-safe command queue
- biometric credential vault integration
- QR pairing
- replay-resistant pairing flow
- human approval controls
- command replay review rules
- canonical management routes
- audit event correlation

## 4.3 Dependency Rule

Phase 20.98 and 20.99 are **canonical closed dependencies**.

Any required modification to those areas MUST be:

1. minimal,
2. justified,
3. regression-tested,
4. documented,
5. reflected in the implementation matrix,
6. compatible with their existing GOLD guarantees.

---

# 5. Core Design Principles

## 5.1 Durable by Default

No operational workflow may depend solely on in-memory state when recovery matters.

Durable state is required for:

- agents
- jobs
- commands
- approvals
- hosts
- sessions
- workflow checkpoints
- retries
- audit events
- policy decisions

## 5.2 Reference Secrets, Never Embed Secrets

All secret-bearing capabilities SHALL use opaque references.

Allowed:

```json
{
  "credential_ref": "cred_01JXYZ..."
}
```

Forbidden:

```json
{
  "api_key": "sk-...",
  "password": "...",
  "private_key": "-----BEGIN..."
}
```

## 5.3 Human Control for High-Risk Actions

High-impact operations MUST support explicit approval before execution.

Examples:

- destructive filesystem actions
- package installation
- service restart
- credential changes
- privileged commands
- deployment
- database mutation
- remote host reconfiguration
- security-sensitive MCP tools

## 5.4 Replay Must Be Context-Aware

Safe replay requires matching:

- host identity
- working directory
- policy version
- command fingerprint
- credential scope
- expected execution context
- target resource identity

Mismatch SHALL transition to:

```text
needs_review
```

not automatic execution.

## 5.5 One Canonical Management Surface

Management APIs/routes SHALL have a canonical registry.

Aliases MAY exist only when explicitly mapped.

Duplicate management semantics are prohibited.

## 5.6 Audit Everything Material

All material operations SHALL carry a `correlation_id`.

The correlation MUST survive:

```text
request
→ policy evaluation
→ approval
→ dispatch
→ agent/host execution
→ result
→ retry/replay
→ final audit record
```

---

# 6. Unified Control Plane Components

## 6.1 Unified Agent Registry

Create a canonical registry representing all operational agents.

Minimum fields:

```text
agent_id
display_name
runtime_type
provider
model
host_id
sandbox_id
status
capabilities
skill_bindings
mcp_bindings
policy_profile_id
credential_scope_id
created_at
updated_at
last_seen_at
metadata
```

Required status values:

```text
registered
starting
ready
busy
paused
degraded
offline
stopping
stopped
failed
quarantined
```

### Requirements

- stable `agent_id`
- provider-neutral representation
- runtime-specific extension metadata
- capability discovery
- health heartbeat
- policy profile attachment
- skill/MCP assignment
- host ownership
- quarantine support
- audit integration

---

## 6.2 Unified Host Registry

Represent execution locations including:

- local PC
- VPS
- Runpod
- remote Linux machines
- browser runtimes
- future worker nodes

Minimum fields:

```text
host_id
display_name
host_type
os_family
architecture
connection_mode
tailscale_identity
ssh_profile_ref
status
trust_level
capabilities
labels
last_seen_at
created_at
updated_at
```

Host states:

```text
pending
pairing
online
degraded
offline
revoked
quarantined
```

### Required capabilities

- pairing
- revocation
- health
- capability discovery
- trust classification
- command eligibility
- workload placement
- audit history
- last-seen tracking

---

## 6.3 Runtime Federation Layer

Provide a common execution abstraction across heterogeneous runtimes.

Canonical operation shape:

```ts
interface RuntimeExecutionRequest {
  executionId: string;
  correlationId: string;
  agentId?: string;
  hostId: string;
  operationType: string;
  payloadRef?: string;
  workingDirectory?: string;
  credentialRefs?: string[];
  policyContext: PolicyContext;
  approvalRef?: string;
  timeoutMs?: number;
}
```

The federation layer SHALL normalize:

- dispatch
- progress
- completion
- failure
- cancellation
- pause
- resume
- retry
- replay
- timeout

---

# 7. Unified Job Model

Every long-running operation SHALL be represented as a durable job.

Minimum job schema:

```text
job_id
correlation_id
job_type
requested_by
agent_id
host_id
status
priority
payload_ref
policy_snapshot_id
approval_id
attempt
max_attempts
checkpoint_ref
result_ref
error_code
error_message
created_at
started_at
updated_at
finished_at
```

Canonical job states:

```text
queued
awaiting_policy
awaiting_approval
approved
dispatching
running
paused
retry_wait
needs_review
succeeded
failed
cancelled
expired
```

Illegal state transitions MUST be rejected.

---

# 8. Workflow State Machine

Recommended canonical transition model:

```text
queued
  │
  ▼
awaiting_policy
  │
  ├── deny ───────────────► failed
  │
  └── allow
        │
        ▼
awaiting_approval
  │
  ├── not_required ───────► approved
  ├── approved ───────────► approved
  ├── rejected ───────────► cancelled
  └── expired ────────────► expired
        │
        ▼
dispatching
        │
        ▼
running
  │       │       │
  │       │       ├────► paused
  │       │
  │       ├────────────► retry_wait
  │
  ├────────────────────► needs_review
  │
  ├────────────────────► failed
  │
  └────────────────────► succeeded
```

---

# 9. Central MCP Governance

Phase 21.00 SHALL expose one canonical MCP registry.

Minimum MCP server record:

```text
mcp_server_id
name
transport
endpoint_ref
auth_ref
trust_level
environment
status
tool_count
policy_profile_id
source
version
last_verified_at
created_at
updated_at
```

Per-tool record:

```text
tool_id
mcp_server_id
name
description
risk_class
requires_approval
allowed_agent_classes
allowed_host_classes
input_schema_hash
output_schema_hash
enabled
```

Risk classes:

```text
R0_READ_ONLY
R1_LOW_RISK
R2_CONTROLLED_WRITE
R3_SENSITIVE
R4_PRIVILEGED
```

Default:

- R0 → may auto-run if policy allows.
- R1 → may auto-run within scope.
- R2 → contextual policy evaluation.
- R3 → approval required.
- R4 → explicit approval + strict host/credential/context validation.

---

# 10. Central Skill Governance

Skill registry fields:

```text
skill_id
name
version
source
runtime
entrypoint
capability_tags
risk_class
required_tools
required_credentials
allowed_agents
allowed_hosts
policy_profile_id
status
checksum
created_at
updated_at
```

Skill lifecycle:

```text
discovered
pending_review
verified
enabled
disabled
deprecated
quarantined
```

### Mandatory controls

- checksum verification
- source provenance
- explicit version
- capability declaration
- tool dependency declaration
- credential dependency declaration
- policy attachment
- enable/disable switch
- audit trail

---

# 11. Policy Engine

Create a central policy evaluation contract.

Example:

```ts
interface PolicyDecision {
  decision: "allow" | "deny" | "require_approval" | "needs_review";
  policyId: string;
  policyVersion: string;
  reasonCodes: string[];
  constraints?: Record<string, unknown>;
}
```

Policy inputs SHOULD include:

```text
actor
agent
host
tool
skill
operation
risk class
credential scope
working directory
environment
resource
network target
command fingerprint
time
prior approval
replay context
```

---

# 12. Human Approval Fabric

All approvals SHALL be durable records.

Minimum schema:

```text
approval_id
correlation_id
request_type
resource_type
resource_id
risk_class
requested_by
requested_at
expires_at
decision
decided_by
decided_at
decision_reason
policy_snapshot_id
context_hash
```

Approval states:

```text
pending
approved
rejected
expired
revoked
consumed
```

## 12.1 Approval Invariants

An approval MUST NOT be reused when any material field changes:

- command
- target host
- target path
- credential scope
- operation type
- resource identity
- risk class
- context hash

---

# 13. Secure Remote Execution

Supported operation categories:

```text
shell
file_read
file_write
file_upload
file_download
process_control
service_control
deployment
package_operation
container_operation
agent_operation
workflow_operation
```

Each request MUST pass through:

```text
authentication
→ authorization
→ policy
→ approval if required
→ context validation
→ dispatch
→ audit
```

No direct bypass route is permitted.

---

# 14. Offline-Safe Command Queue

The existing Whip offline model SHALL be elevated to the unified job layer.

Offline commands MUST store:

```text
command_id
correlation_id
host_id
command_fingerprint
context_hash
working_directory
credential_scope_ref
policy_snapshot_id
approval_ref
created_at
expires_at
replay_status
```

Replay status:

```text
queued
validated
replaying
completed
failed
expired
needs_review
revoked
```

## 14.1 Replay Safety Rule

Automatic replay SHALL require all replay-critical context to match.

Any mismatch in R3/R4 operations MUST become:

```text
needs_review
```

---

# 15. Credential Brokerage

The control plane SHALL manage credential references, not raw credentials.

Credential metadata:

```text
credential_ref
credential_type
provider
scope
owner
host_constraints
agent_constraints
expires_at
rotation_due_at
status
```

Status:

```text
active
expired
revoked
rotation_required
disabled
```

### Forbidden Storage

Raw secret values SHALL NOT appear in:

- audit logs
- QR payloads
- jobs
- workflow payloads
- agent registry
- host registry
- approval records
- frontend state
- analytics events

---

# 16. Pairing and Device Trust

Pairing SHALL remain:

- short-lived
- replay-resistant
- revocable
- auditable
- credential-reference-only

Recommended pairing TTL:

```text
5 minutes
```

Pairing record:

```text
pairing_id
device_id
challenge_hash
created_at
expires_at
consumed_at
revoked_at
status
```

States:

```text
pending
consumed
expired
revoked
```

A pairing token MUST be one-time-use.

---

# 17. Audit Architecture

Create/extend a unified operations audit stream.

Canonical table:

```text
operation_audit_events
```

Minimum fields:

```text
event_id
correlation_id
causation_id
event_type
actor_type
actor_id
agent_id
host_id
job_id
approval_id
resource_type
resource_id
risk_class
policy_id
policy_version
outcome
metadata
created_at
```

### Audit Requirements

- append-oriented
- correlation-preserving
- secret-safe
- queryable
- timestamped
- policy-aware
- replay-aware

---

# 18. Correlation Rules

Every top-level operation receives exactly one primary:

```text
correlation_id
```

Child operations receive:

```text
causation_id
```

Example:

```text
User request       correlation_id = C1
Policy check       correlation_id = C1
Approval request   correlation_id = C1
Command dispatch   correlation_id = C1
Agent action       correlation_id = C1
Retry              correlation_id = C1
Audit events       correlation_id = C1
```

A missing correlation ID for material operations is a verification failure.

---

# 19. Failure Taxonomy

Canonical error categories:

```text
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
POLICY_DENIED
APPROVAL_REQUIRED
APPROVAL_REJECTED
APPROVAL_EXPIRED
HOST_OFFLINE
HOST_QUARANTINED
AGENT_OFFLINE
AGENT_QUARANTINED
CONTEXT_MISMATCH
CREDENTIAL_UNAVAILABLE
CREDENTIAL_REVOKED
DISPATCH_FAILED
EXECUTION_FAILED
EXECUTION_TIMEOUT
CHECKPOINT_FAILED
REPLAY_BLOCKED
RESOURCE_CONFLICT
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

Errors SHOULD be machine-readable and user-readable.

---

# 20. Recovery Model

The system SHALL recover safely from:

- API restart
- worker restart
- agent crash
- host disconnect
- network outage
- mobile disconnect
- approval timeout
- provider outage
- partial execution
- delayed result delivery

Recovery MUST avoid duplicate destructive execution.

---

# 21. Idempotency

Material mutation requests MUST support idempotency.

Recommended fields:

```text
idempotency_key
operation_fingerprint
first_seen_at
last_seen_at
result_ref
```

Duplicate requests MUST return the existing result when semantics match.

Conflicting requests using the same idempotency key MUST fail safely.

---

# 22. Checkpoints and Resume

Resumable workflows SHALL persist checkpoints.

Checkpoint record:

```text
checkpoint_id
job_id
step_id
state_ref
artifact_refs
created_at
checksum
```

Resume MUST validate:

- workflow version
- step identity
- required artifacts
- host compatibility
- credential availability
- policy compatibility

---

# 23. Cross-Provider Agent Supervision

Phase 21.00 SHALL remain provider-neutral.

Example providers/runtimes may include:

```text
OpenAI / Codex
Claude
Grok
local models
OpenCode
OpenHermit agents
custom MCP agents
future providers
```

The control plane SHALL normalize operational metadata but MUST NOT erase provider-specific capability differences.

---

# 24. Capability-Aware Scheduling

Workload placement SHALL consider:

```text
agent capabilities
host capabilities
GPU availability
runtime type
network access
credential availability
policy constraints
trust level
cost/budget metadata
current load
job priority
```

Scheduler output:

```text
selected_agent_id
selected_host_id
reason_codes
policy_snapshot_id
```

---

# 25. Host Trust Levels

Recommended trust classes:

```text
TRUSTED_LOCAL
TRUSTED_PRIVATE
MANAGED_REMOTE
EPHEMERAL_CLOUD
UNTRUSTED
QUARANTINED
```

High-risk jobs SHALL NOT run on insufficiently trusted hosts.

---

# 26. Core / Lab Boundary

Maintain explicit separation.

```text
/core
/lab
```

Lab functionality MUST NOT become Core implicitly.

Promotion requires:

1. implementation maturity,
2. tests,
3. policy review,
4. security review,
5. documentation,
6. explicit registry change.

Add/maintain:

```text
core-lab-boundary.test.ts
```

---

# 27. Canonical Management Routes

Maintain a route registry.

Recommended API grouping:

```text
/api/v1/agents
/api/v1/hosts
/api/v1/jobs
/api/v1/workflows
/api/v1/approvals
/api/v1/mcp
/api/v1/skills
/api/v1/credentials
/api/v1/policies
/api/v1/audit
/api/v1/health
```

Create/maintain:

```text
management-route-registry.test.ts
```

No hidden duplicate administrative route may bypass the canonical layer.

---

# 28. Suggested API Surface

## Agents

```text
GET    /api/v1/agents
POST   /api/v1/agents
GET    /api/v1/agents/:id
PATCH  /api/v1/agents/:id
POST   /api/v1/agents/:id/pause
POST   /api/v1/agents/:id/resume
POST   /api/v1/agents/:id/quarantine
```

## Hosts

```text
GET    /api/v1/hosts
POST   /api/v1/hosts
GET    /api/v1/hosts/:id
POST   /api/v1/hosts/:id/pair
POST   /api/v1/hosts/:id/revoke
POST   /api/v1/hosts/:id/quarantine
```

## Jobs

```text
GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/cancel
POST   /api/v1/jobs/:id/pause
POST   /api/v1/jobs/:id/resume
POST   /api/v1/jobs/:id/retry
POST   /api/v1/jobs/:id/replay
```

## Approvals

```text
GET    /api/v1/approvals
GET    /api/v1/approvals/:id
POST   /api/v1/approvals/:id/approve
POST   /api/v1/approvals/:id/reject
POST   /api/v1/approvals/:id/revoke
```

## MCP

```text
GET    /api/v1/mcp/servers
POST   /api/v1/mcp/servers
GET    /api/v1/mcp/tools
PATCH  /api/v1/mcp/tools/:id
```

## Skills

```text
GET    /api/v1/skills
POST   /api/v1/skills
GET    /api/v1/skills/:id
POST   /api/v1/skills/:id/verify
POST   /api/v1/skills/:id/enable
POST   /api/v1/skills/:id/disable
```

---

# 29. Suggested Database Schema

Recommended new tables:

```text
control_agents
control_hosts
control_jobs
control_job_attempts
control_workflows
control_workflow_checkpoints
control_approvals
control_policies
control_policy_snapshots
control_mcp_servers
control_mcp_tools
control_skills
control_skill_bindings
control_credential_refs
control_pairings
control_offline_commands
operation_audit_events
control_idempotency_keys
```

Where possible, integrate existing canonical tables rather than duplicate them.

---

# 30. Migration Policy

Migration SHALL:

- preserve existing IDs when possible
- avoid destructive reset
- be forward-safe
- include rollback guidance
- avoid raw secret migration into new tables
- preserve audit correlation
- preserve canonical Phase 20.98/20.99 behavior

Every schema migration MUST have a deterministic migration identifier.

---

# 31. UI — Unified Operations Console

The Phase 21.00 console SHOULD expose:

## Dashboard

- online agents
- busy agents
- offline agents
- online hosts
- degraded hosts
- running jobs
- pending approvals
- failed jobs
- replay review queue
- recent audit events

## Agent Detail

- identity
- provider/runtime
- host
- status
- skills
- MCP bindings
- policy
- current job
- recent audit
- pause/resume/quarantine

## Host Detail

- host identity
- connectivity
- trust level
- current agents
- active jobs
- SSH/SFTP availability
- capabilities
- health
- revoke/quarantine actions

## Job Detail

- state
- timeline
- correlation ID
- policy decision
- approval
- execution target
- retries
- checkpoint
- output/result
- failure diagnostics

## Approval Inbox

- operation
- risk level
- agent
- host
- command/action summary
- credential scope
- policy reason
- expiration
- approve/reject

---

# 32. Mobile Operations

Mobile MUST support operational supervision without weakening controls.

Minimum mobile actions:

- view fleet
- inspect agent
- inspect host
- view job state
- approve/reject
- pause/resume
- safe retry
- review blocked replay
- terminal access through approved route
- SFTP workspace
- revoke paired device

High-risk actions MUST remain approval/policy gated even from trusted mobile devices.

---

# 33. WebSocket / Event Stream

The control plane SHOULD expose a normalized event stream.

Example topics:

```text
agent.status.changed
host.status.changed
job.created
job.status.changed
approval.requested
approval.decided
policy.denied
command.needs_review
audit.event.created
```

Every event SHALL include:

```text
event_id
correlation_id
event_type
timestamp
resource_type
resource_id
```

---

# 34. Observability

Minimum metrics:

```text
agents_total
agents_ready
agents_failed
hosts_online
hosts_offline
jobs_queued
jobs_running
jobs_failed
jobs_succeeded
approvals_pending
approvals_rejected
commands_needs_review
policy_denials
replay_attempts
replay_blocked
execution_latency
job_duration
```

Health endpoints:

```text
/api/v1/health/live
/api/v1/health/ready
/api/v1/health/dependencies
```

---

# 35. Security Requirements

Phase 21.00 SHALL verify:

- no plaintext credential leakage
- no raw secrets in QR codes
- no policy bypass route
- no unaudited R3/R4 execution
- replay context validation
- approval expiration
- device revocation
- host revocation
- agent quarantine
- path validation
- command boundary validation
- MCP tool risk classification
- skill provenance
- audit correlation
- privileged action gating

---

# 36. Path Safety

File-related operations SHALL enforce:

- normalized paths
- configured root boundaries
- traversal prevention
- symlink-aware validation where applicable
- host-specific allowed roots
- operation-specific access policy

Unsafe examples SHALL be rejected.

---

# 37. Command Safety

Command execution MUST classify:

```text
read-only
mutation
destructive
privileged
network-sensitive
credential-sensitive
```

Dangerous command patterns SHALL require stricter policy handling.

The system MUST NOT rely solely on string matching for authorization.

---

# 38. Network Safety

Remote and agent operations SHALL respect:

- host allowlists
- network scope
- private endpoint rules
- provider endpoint policy
- SSRF controls where relevant
- callback validation
- tunnel identity

---

# 39. Testing Strategy

## 39.1 Unit Tests

Cover:

- state transitions
- policy decisions
- approval validation
- replay validation
- credential reference validation
- route registry
- trust level enforcement
- skill/MCP risk rules
- idempotency

## 39.2 Integration Tests

Cover:

- agent → job → host dispatch
- policy → approval → execution
- offline queue → reconnect → replay
- mobile approval → execution
- agent crash → resume
- host disconnect → retry
- credential revocation → blocked job
- MCP tool invocation → audit
- skill execution → audit

## 39.3 Security Tests

Cover:

- QR replay
- expired pairing token
- approval reuse
- changed command after approval
- changed host after approval
- path traversal
- secret leakage
- policy bypass
- unauthorized route
- replay context mismatch
- R4 automatic replay attempt

## 39.4 Regression Tests

Protect Phase 20.98 and 20.99 behavior.

---

# 40. Mandatory Test Files

Create or update equivalent tests for:

```text
management-route-registry.test.ts
core-lab-boundary.test.ts
unified-agent-registry.test.ts
unified-host-registry.test.ts
job-state-machine.test.ts
approval-context-binding.test.ts
offline-replay-safety.test.ts
credential-reference-safety.test.ts
audit-correlation.test.ts
mcp-governance.test.ts
skill-governance.test.ts
policy-enforcement.test.ts
idempotency.test.ts
pairing-replay-resistance.test.ts
host-trust-enforcement.test.ts
workflow-resume.test.ts
```

Names MAY adapt to repository conventions, but coverage MUST exist.

---

# 41. Acceptance Criteria

Phase 21.00 is not complete until ALL applicable criteria pass.

| Requirement | Required |
|---|---|
| Unified agent registry implemented | YES |
| Unified host registry implemented | YES |
| Durable job state implemented | YES |
| Cross-host runtime dispatch works | YES |
| MCP governance centralized | YES |
| Skill governance centralized | YES |
| R3/R4 approval gating enforced | YES |
| Credential references are secret-safe | YES |
| Pairing remains replay-resistant | YES |
| Offline replay is context-safe | YES |
| Context mismatch becomes `needs_review` | YES |
| Canonical management routes enforced | YES |
| Core/Lab boundary remains intact | YES |
| Audit correlation is preserved | YES |
| Idempotency implemented for material mutations | YES |
| Durable checkpoints/resume verified | YES |
| Host/agent quarantine works | YES |
| No undocumented policy bypass route exists | YES |
| Documentation matches repository reality | YES |
| Implementation Matrix says VERIFIED | YES |
| GOLD status says CLOSED | YES |
| No unrelated refactoring introduced | YES |

---

# 42. Definition of Done

Phase 21.00 SHALL be considered DONE only when:

1. requested architecture exists in code,
2. migrations are applied,
3. tests pass,
4. security invariants pass,
5. no high-severity unresolved implementation gap remains,
6. documentation matches actual paths and behavior,
7. implementation matrix is updated,
8. GOLD closure document is updated,
9. previous canonical phases remain stable,
10. repository can proceed to Phase 21.01 without hidden cleanup debt.

---

# 43. Required Documentation Artifacts

Create/update:

```text
PHASE_21.00_UNIFIED_AGENT_OPERATIONS_CONTROL_PLANE.md
PHASE_IMPLEMENTATION_MATRIX.md
GOLD_IMPLEMENTATION_STATUS.md
ARCHITECTURE.md
SECURITY_MODEL.md
POLICY_MODEL.md
AGENT_REGISTRY.md
HOST_REGISTRY.md
MCP_GOVERNANCE.md
SKILL_GOVERNANCE.md
APPROVAL_MODEL.md
OFFLINE_REPLAY_MODEL.md
AUDIT_MODEL.md
OPERATIONS_RUNBOOK.md
```

Adapt filenames if repository has canonical equivalents.

Do not create duplicate documentation when an authoritative file already exists; update the canonical document instead.

---

# 44. Implementation Matrix Template

```md
| Capability | Status | Evidence | Tests | Notes |
|---|---|---|---|---|
| Unified Agent Registry | TODO | | | |
| Unified Host Registry | TODO | | | |
| Durable Jobs | TODO | | | |
| Runtime Federation | TODO | | | |
| MCP Governance | TODO | | | |
| Skills Governance | TODO | | | |
| Human Approval Fabric | TODO | | | |
| Credential Brokerage | TODO | | | |
| Offline Replay Safety | TODO | | | |
| Pairing Security | TODO | | | |
| Policy Enforcement | TODO | | | |
| Audit Correlation | TODO | | | |
| Idempotency | TODO | | | |
| Resume / Checkpoint | TODO | | | |
| Canonical Routes | TODO | | | |
| Core/Lab Boundary | TODO | | | |
| Documentation | TODO | | | |
```

Final state MUST contain no false VERIFIED rows.

---

# 45. GOLD Closure Template

Final GOLD state SHOULD contain:

```text
PHASE: 21.00
STATUS: CLOSED
VERIFICATION: VERIFIED
SECURITY: PASS
REGRESSION: PASS
DOCUMENTATION: SYNCHRONIZED
MIGRATIONS: VERIFIED
CANONICAL ROUTES: VERIFIED
CORE/LAB BOUNDARY: VERIFIED
AUDIT CORRELATION: VERIFIED
OFFLINE REPLAY SAFETY: VERIFIED
CREDENTIAL SAFETY: VERIFIED
APPROVAL FABRIC: VERIFIED
UNRELATED REFACTORING: NONE
```

---

# 46. Implementation Order

Recommended implementation order:

## Stage A — Repository Reality Check

1. inspect current architecture
2. locate Phase 20.98 implementation
3. locate Phase 20.99 implementation
4. map existing schemas
5. map management routes
6. map policy hooks
7. map audit model
8. map credential abstractions
9. identify reusable code
10. create gap matrix

## Stage B — Unified Data Model

1. agent registry
2. host registry
3. jobs
4. approvals
5. policies
6. MCP/skill registry
7. credential refs
8. audit stream
9. idempotency
10. checkpoints

## Stage C — Runtime Federation

1. runtime adapter contract
2. OpenHermit adapter
3. Whip/remote adapter
4. local runtime adapter
5. job dispatcher
6. normalized execution lifecycle

## Stage D — Governance

1. policy evaluation
2. risk classification
3. approval gating
4. credential scope
5. replay validation
6. trust enforcement

## Stage E — Operations Surfaces

1. dashboard APIs
2. event stream
3. web console wiring
4. mobile console wiring
5. approval inbox
6. failure/recovery UX

## Stage F — Hardening

1. unit tests
2. integration tests
3. security tests
4. regression tests
5. migration verification
6. documentation sync

## Stage G — GOLD Closure

1. implementation matrix
2. evidence links
3. verification run
4. unresolved-gap review
5. GOLD status update
6. phase closure

---

# 47. Repository Editing Rules

During implementation:

- inspect before editing
- reuse canonical abstractions
- avoid duplicate subsystems
- keep changes scoped to Phase 21.00
- do not rewrite unrelated modules
- preserve existing public contracts unless migration is documented
- prefer additive migration over destructive migration
- maintain strict typing
- maintain tests with behavior changes
- do not claim implementation without repository evidence

---

# 48. Security Stop Conditions

Implementation MUST stop and mark the item unresolved if any of the following is discovered and cannot be safely resolved within scope:

- raw credential persistence
- approval bypass
- R4 auto-execution without explicit policy
- arbitrary remote execution outside the governed dispatcher
- missing audit trail for privileged actions
- replay of stale approval
- pairing token reuse
- ambiguous destructive replay
- unrestricted path access
- broken Core/Lab boundary
- undocumented management backdoor

Do not hide these issues by marking the phase complete.

---

# 49. Verification Commands

Use repository-native commands discovered from the actual project.

Typical verification categories:

```text
install
lint
typecheck
unit tests
integration tests
security tests
build
migration validation
route registry validation
documentation validation
```

Do not invent a package-manager command without inspecting repository reality.

---

# 50. Final Verification Questions

Before closure, answer all with evidence:

1. Can any R3/R4 operation bypass approval?
2. Can a stale approval execute a changed command?
3. Can an offline queued command replay against a changed context?
4. Can a QR payload expose a reusable secret?
5. Can a revoked host still accept jobs?
6. Can a quarantined agent still receive work?
7. Can an MCP tool execute outside its risk policy?
8. Can a skill silently gain new privileges?
9. Can any management route bypass the canonical registry?
10. Can a Core runtime accidentally import Lab-only behavior?
11. Is `correlation_id` preserved end-to-end?
12. Are mutation requests idempotent where required?
13. Can workflows resume safely after restart?
14. Does documentation match actual repository paths?
15. Are 20.98 and 20.99 regressions covered?
16. Is every VERIFIED claim backed by code or test evidence?
17. Is any unrelated refactoring included?
18. Can Phase 21.00 be closed without manual undocumented intervention?

Any material **NO / UNKNOWN** blocks GOLD closure.

---

# 51. Expected End State

After Phase 21.00:

```text
Pao-hubPro
   │
   ├── Unified Agent Registry
   ├── Unified Host Registry
   ├── Durable Job Runtime
   ├── Workflow Resume / Checkpoints
   ├── Cross-Host Runtime Federation
   ├── Central MCP Registry
   ├── Central Skill Registry
   ├── Policy Engine
   ├── Human Approval Fabric
   ├── Credential Brokerage
   ├── Secure Pairing
   ├── Offline Replay Safety
   ├── Unified Audit Stream
   ├── Mobile Operations
   ├── Web Operations
   ├── Failure Recovery
   └── Production Readiness
```

The operational relationship becomes:

```text
OpenHermit 20.98
       +
Whip 20.99
       +
Pao-hubPro Core
       │
       ▼
Phase 21.00
Unified Agent Operations Control Plane
```

---

# 52. Phase Boundary

**Phase 21.00 owns integration, governance, federation, operational state, and production hardening.**

Future features that materially extend business functionality, new media pipelines, new providers, new external products, or unrelated application domains SHOULD begin in Phase 21.01+ instead of expanding Phase 21.00 indefinitely.

---

# 53. Completion Declaration

The phase MAY be declared complete only when the repository itself demonstrates:

```text
IMPLEMENTATION = COMPLETE
VERIFICATION = PASS
SECURITY = PASS
REGRESSION = PASS
DOCUMENTATION = SYNCHRONIZED
GOLD = CLOSED
```

No status label alone is sufficient.

---

# 54. Final Target

**Phase 21.00 converts Pao-hubPro from a set of integrated agent subsystems into a governed, durable, production-grade Agent Operations Platform capable of controlling agents, hosts, tools, skills, remote execution, approvals, credentials, workflows, recovery, and audit from one unified control plane.**
