# Phase 21.03 — Pao-hubPro × CC Switch

## Universal AI Provider Control Plane, Cross-CLI Configuration Registry, Local Model Routing Gateway, Automatic Provider Failover, Unified MCP & Skills Synchronization, Prompt & Session Federation, Usage/Cost Observatory, Secure Credential Brokerage & Policy-Governed AI Runtime Switching

**Project:** Pao-hubPro  
**Phase:** 21.03  
**Status:** PROPOSED / IMPLEMENTATION-READY  
**Previous canonical phase:** Phase 21.02 — Pao-hubPro × HyperFrames  
**Reference project:** `farion1231/cc-switch`  
**Reference snapshot verified:** 2026-09-21  
**Integration strategy:** Architectural reference + selective compatible reuse; do not replace existing Pao-hubPro routing, policy, approval, MCP, skills, or agent-governance layers.

---

# 1. Executive Summary

Phase 21.03 introduces a unified AI runtime control plane for Pao-hubPro inspired by the strongest operational concepts in CC Switch: shared provider configuration, local routing, provider hot switching, automatic failover, MCP/skills/prompt synchronization, usage/cost accounting, session discovery, configuration backup, and cross-tool management.

The objective is not to turn Pao-hubPro into a thin clone of CC Switch. The objective is to absorb the control-plane pattern and integrate it with Pao-hubPro's existing architecture: OmniRoute/9Router-style provider routing, MCPProxy, SkillsGate, Reviewer Council, local-first execution, human approval gates, agent fleet infrastructure, and audit/policy enforcement.

After this phase, Pao-hubPro should become the single operational surface from which the user can safely control:

- Codex
- Claude Code / Claude Desktop where applicable
- Gemini CLI
- Grok-compatible coding/runtime endpoints
- OpenCode
- OpenClaw
- Hermes Agent
- MiniMax Code
- OpenAI-compatible local models
- OpenRouter-compatible endpoints
- Custom OpenAI/Anthropic/Gemini-compatible gateways
- MCP servers
- Agent skills
- Prompt profiles
- Runtime sessions
- Provider health
- API usage and cost
- Secrets and OAuth/API credentials
- Policy and approval state

The system must preserve local-first behavior, secure secret handling, deterministic configuration projection, explicit human approval for risky actions, and full auditability.

---

# 2. Why This Phase Exists

AI development tools increasingly duplicate the same configuration across separate files and runtimes:

```text
Codex      -> provider/model/auth/config
Claude     -> provider/model/auth/MCP/prompt
Gemini     -> provider/model/auth/MCP/prompt
OpenCode   -> provider/model/auth/MCP
Hermes     -> provider/model/tools/skills
OpenClaw   -> provider/model/agent workspace
MiniMax    -> provider/model/auth
```

Without a central control plane, the user must repeatedly maintain:

- API keys
- base URLs
- model identifiers
- retry policies
- fallback providers
- MCP definitions
- skills
- system prompts
- workspace prompts
- cost limits
- usage histories
- CLI-specific configuration formats

This creates configuration drift, duplicated credentials, inconsistent policies, hard-to-debug failures, and unnecessary manual work.

Phase 21.03 converts these scattered files into projected runtime artifacts generated from a central registry.

---

# 3. Reference Capabilities Taken From CC Switch

The reference repository demonstrates several useful patterns that should be adapted into Pao-hubPro:

1. Universal/shared provider definitions.
2. One-click provider switching.
3. Local API proxy/routing layer.
4. Per-application proxy takeover.
5. Hot provider switching without restarting routed tools.
6. Automatic provider failover.
7. Circuit breaker behavior.
8. Provider health monitoring.
9. Cross-provider request format conversion.
10. MCP registry and cross-app synchronization.
11. Prompt synchronization across app-specific prompt files.
12. Skills installation and multi-app synchronization.
13. Usage, request, token, and cost tracking.
14. Session discovery and restore workflows.
15. Configuration backup and restoration.
16. Atomic configuration writes.
17. Import flows for providers, MCP servers, prompts, and skills.

Pao-hubPro must implement these concepts under its own policy, security, audit, registry, and routing architecture.

---

# 4. Phase Goals

## G1 — Single Source of Truth for AI Providers

Create a central provider registry representing provider metadata independent of individual CLI config formats.

A provider record should support:

- provider ID
- display name
- provider family
- API protocol
- API base URL
- authentication strategy
- credential reference
- supported models
- capabilities
- context window metadata
- image/audio/video/tool support metadata where relevant
- rate-limit metadata
- pricing metadata
- reliability state
- routing weight
- fallback priority
- policy tags
- environment restrictions
- health-check profile

---

## G2 — Cross-CLI Configuration Projection

Generate tool-specific live configuration from the registry.

Target adapters should initially include:

```text
Codex Adapter
Claude Adapter
Gemini Adapter
OpenCode Adapter
OpenClaw Adapter
Hermes Adapter
MiniMax Adapter
Generic OpenAI-Compatible Adapter
```

Adapters must never directly own source-of-truth provider data.

They only translate registry state into runtime-specific files/env/config.

---

## G3 — Local Model Routing Gateway

Create a local gateway between clients and upstream AI providers.

Default topology:

```text
AI CLI / Agent
     |
     v
Pao Local AI Gateway
     |
     +--> Policy Engine
     +--> Secret Broker
     +--> Provider Router
     +--> Format Adapter
     +--> Retry / Failover
     +--> Usage Meter
     +--> Audit Logger
     |
     v
Selected Provider
```

Default network binding MUST be loopback-only.

```text
127.0.0.1
```

External/LAN exposure must require explicit configuration, authentication, TLS, allowlisting, and approval.

---

## G4 — Automatic Provider Failover

Provide high-availability routing for long-running agent tasks.

Example:

```text
Primary
OpenAI / Model A
    |
    X failure
    v
Fallback 1
OpenRouter / Model A-compatible
    |
    X unavailable
    v
Fallback 2
Local Model
```

Failover must understand whether a request is safe to replay.

Do not automatically replay unsafe side-effecting tool execution.

---

## G5 — Unified MCP Synchronization

Make MCP definitions centrally managed.

One MCP server should be definable once and projected into compatible clients.

Example:

```text
MCP Registry
  |
  +--> Codex
  +--> Claude
  +--> Gemini
  +--> OpenCode
  +--> Hermes
  +--> OpenClaw
```

Each target must be controlled independently.

---

## G6 — Unified Skills Synchronization

Provide a shared Skills Registry.

Skill lifecycle:

```text
Discover
  -> Import
  -> Scan
  -> Normalize
  -> Review
  -> Approve
  -> Install Disabled
  -> Enable Per Target
  -> Version Track
  -> Update
  -> Rollback
```

Supported sources may include:

- local directory
- ZIP archive
- Git repository
- approved internal registry

No remote skill should receive automatic execution permission immediately after import.

---

## G7 — Prompt Federation

Create a prompt registry that can project common and runtime-specific instructions.

Prompt precedence:

```text
Global
  < Workspace
  < Project
  < Agent
  < Task
  < Runtime Override
```

Potential projections:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
SOUL.md
SYSTEM.md
Runtime-specific configuration
```

The compiler must detect conflicts and produce a preview before destructive overwrite.

---

## G8 — Session Federation

Create a normalized session index across supported AI runtimes.

A session record should capture:

- source runtime
- project
- workspace
- agent
- provider
- model
- start time
- last activity
- status
- transcript locator
- related files
- tools used
- approvals
- token usage
- estimated cost
- parent task
- related run ID

This does not require copying every full transcript into one database. The registry may store pointers plus searchable metadata.

---

## G9 — Usage & Cost Observatory

Create a local observability plane for:

- requests
- input tokens
- output tokens
- cached tokens if available
- estimated spend
- provider spend
- model spend
- task spend
- project spend
- latency
- error rates
- retry counts
- failover counts
- health status

Cost data must include pricing snapshot timestamps because model pricing changes.

---

## G10 — Secure Credential Brokerage

Remove plaintext credential duplication across runtime configuration wherever technically possible.

Secrets should be referenced through opaque IDs:

```text
credential://openai/main
credential://anthropic/work
credential://openrouter/primary
```

Recommended Windows implementation:

```text
Windows Credential Manager
or
DPAPI-backed encrypted vault
```

SQLite may store secret metadata, but raw long-lived secrets should not be stored as ordinary plaintext database fields.

---

## G11 — Policy-Governed Runtime Switching

Provider switching is a policy decision, not only a UI action.

Rules may consider:

- task sensitivity
- provider trust class
- cost budget
- model capability
- latency
- provider health
- data residency restrictions
- network availability
- project policy
- human approval requirements

Example:

```yaml
policy: production-code-review
allowed_providers:
  - openai
  - anthropic
forbid:
  - unknown-relays
max_request_cost_usd: 2.00
require_approval_for:
  - external_provider_with_private_source
```

---

# 5. Non-Goals

This phase MUST NOT:

1. Replace all existing Pao-hubPro routers with one monolithic router.
2. Store plaintext credentials in ordinary project files.
3. Auto-enable imported MCP servers or skills without policy evaluation.
4. Automatically expose the local proxy to the LAN.
5. blindly overwrite user-modified CLI configuration.
6. replay unsafe side-effecting requests automatically after uncertain failure.
7. make provider selection opaque or untraceable.
8. merge all transcripts into a single unbounded database blob.
9. require cloud connectivity for normal local control-plane operation.
10. create a hard dependency on CC Switch itself.

---

# 6. Core Architecture

```text
+-------------------------------------------------------------------+
|                        Pao-hubPro UI                               |
| Provider | Routes | MCP | Skills | Prompts | Sessions | Cost      |
+-------------------------------+-----------------------------------+
                                |
                                v
+-------------------------------------------------------------------+
|                  AI Runtime Control Plane                          |
|                                                                   |
| Provider Registry     Runtime Registry      Policy Engine          |
| MCP Registry          Skills Registry       Approval Engine        |
| Prompt Registry       Session Index         Audit Engine           |
+-------------------------------+-----------------------------------+
                                |
                +---------------+---------------+
                |                               |
                v                               v
+-------------------------------+    +-------------------------------+
| Config Projection Engine      |    | Local AI Gateway              |
| - Codex Adapter               |    | - Router                      |
| - Claude Adapter              |    | - Failover                    |
| - Gemini Adapter              |    | - Circuit Breaker             |
| - OpenCode Adapter            |    | - Protocol Adapter            |
| - Hermes Adapter              |    | - Metering                    |
| - OpenClaw Adapter            |    | - Health                      |
+-------------------------------+    +-------------------------------+
                |                               |
                v                               v
+-------------------------------+    +-------------------------------+
| Runtime Config Files          |    | Upstream Providers            |
+-------------------------------+    +-------------------------------+
```

---

# 7. New Services

## 7.1 `provider-registry-service`

Responsibilities:

- create/update/delete provider definitions
- manage provider aliases
- associate credentials
- model catalogs
- capability metadata
- pricing snapshots
- provider trust classes
- endpoint validation

---

## 7.2 `runtime-adapter-service`

Responsibilities:

- discover installed AI runtimes
- identify config paths
- parse current runtime configs
- create normalized diffs
- project central state into runtime-specific format
- backup before changes
- atomic write
- restore rollback

---

## 7.3 `ai-gateway-service`

Responsibilities:

- local proxy endpoint
- request normalization
- routing
- auth injection
- provider protocol translation
- model remapping
- retries
- failover
- usage metering
- response normalization

---

## 7.4 `provider-health-service`

Responsibilities:

- active health probes
- passive error monitoring
- latency EWMA
- failure windows
- circuit breaker state
- recovery probes
- provider degradation events

---

## 7.5 `mcp-sync-service`

Responsibilities:

- canonical MCP definitions
- app-specific projection
- import from supported clients
- configuration diff
- schema validation
- policy tagging
- install/enable/disable state

---

## 7.6 `skills-sync-service`

Responsibilities:

- skill metadata
- content hashing
- source tracking
- symlink/copy deployment strategies
- compatibility tracking
- policy scan
- version pinning
- rollback

---

## 7.7 `prompt-federation-service`

Responsibilities:

- prompt profiles
- inheritance
- merge/compile
- conflict detection
- preview
- runtime projection
- version history

---

## 7.8 `session-federation-service`

Responsibilities:

- source discovery
- metadata extraction
- indexing
- search
- restore/open integration
- linkage to project/task/run IDs

---

## 7.9 `usage-observatory-service`

Responsibilities:

- request metrics
- token metrics
- pricing snapshots
- cost estimation
- budget policies
- per-project allocation
- usage exports

---

## 7.10 `credential-broker-service`

Responsibilities:

- credential creation
- secure secret storage
- secret retrieval on behalf of authorized runtimes
- rotation metadata
- scope policy
- redaction
- audit

---

# 8. Provider Registry Data Model

Suggested tables:

```sql
CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_family TEXT NOT NULL,
    protocol TEXT NOT NULL,
    base_url TEXT,
    trust_class TEXT NOT NULL DEFAULT 'unclassified',
    enabled INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE provider_credentials (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    secret_ref TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    label TEXT,
    scope_json TEXT,
    expires_at TEXT,
    last_rotated_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(provider_id) REFERENCES ai_providers(id)
);

CREATE TABLE provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL,
    display_name TEXT,
    capability_json TEXT,
    context_window INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(provider_id) REFERENCES ai_providers(id)
);

CREATE TABLE model_pricing_snapshots (
    id TEXT PRIMARY KEY,
    provider_model_id TEXT NOT NULL,
    input_per_million REAL,
    output_per_million REAL,
    cached_input_per_million REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    effective_at TEXT NOT NULL,
    source TEXT,
    FOREIGN KEY(provider_model_id) REFERENCES provider_models(id)
);
```

---

# 9. Runtime Registry Data Model

```sql
CREATE TABLE ai_runtimes (
    id TEXT PRIMARY KEY,
    runtime_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    executable_path TEXT,
    config_path TEXT,
    detected_version TEXT,
    adapter_version TEXT,
    status TEXT NOT NULL,
    last_seen_at TEXT,
    metadata_json TEXT
);

CREATE TABLE runtime_provider_bindings (
    id TEXT PRIMARY KEY,
    runtime_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_model_id TEXT,
    routing_mode TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    policy_id TEXT,
    FOREIGN KEY(runtime_id) REFERENCES ai_runtimes(id),
    FOREIGN KEY(provider_id) REFERENCES ai_providers(id)
);
```

---

# 10. MCP Registry Data Model

```sql
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL,
    command TEXT,
    args_json TEXT,
    url TEXT,
    env_template_json TEXT,
    source TEXT,
    content_hash TEXT,
    risk_level TEXT NOT NULL DEFAULT 'unknown',
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE mcp_runtime_bindings (
    id TEXT PRIMARY KEY,
    mcp_server_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    approval_state TEXT NOT NULL DEFAULT 'pending',
    projection_mode TEXT NOT NULL DEFAULT 'managed',
    FOREIGN KEY(mcp_server_id) REFERENCES mcp_servers(id),
    FOREIGN KEY(runtime_id) REFERENCES ai_runtimes(id)
);
```

---

# 11. Skills Registry Data Model

```sql
CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_uri TEXT,
    version TEXT,
    content_hash TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    approval_state TEXT NOT NULL,
    installed_path TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE skill_runtime_bindings (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    deployment_mode TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(skill_id) REFERENCES skills(id),
    FOREIGN KEY(runtime_id) REFERENCES ai_runtimes(id)
);
```

---

# 12. Prompt Federation Data Model

```sql
CREATE TABLE prompt_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE prompt_projections (
    id TEXT PRIMARY KEY,
    prompt_profile_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    target_path TEXT,
    last_projected_hash TEXT,
    last_projected_at TEXT,
    FOREIGN KEY(prompt_profile_id) REFERENCES prompt_profiles(id),
    FOREIGN KEY(runtime_id) REFERENCES ai_runtimes(id)
);
```

---

# 13. Session Federation Data Model

```sql
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    source_runtime_id TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    project_id TEXT,
    workspace_id TEXT,
    task_id TEXT,
    agent_id TEXT,
    provider_id TEXT,
    model_id TEXT,
    transcript_locator TEXT,
    started_at TEXT,
    last_activity_at TEXT,
    status TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost REAL,
    metadata_json TEXT,
    UNIQUE(source_runtime_id, source_session_id)
);
```

---

# 14. Routing Model

Routing must be explicit and inspectable.

## Routing modes

```text
direct       -> runtime talks directly to configured upstream
gateway      -> runtime uses Pao Local AI Gateway
policy       -> policy engine selects provider/model
auto-failover-> primary provider plus ordered fallbacks
local-only   -> prohibit external upstreams
offline      -> only locally available models
```

---

# 15. Provider Selection Pipeline

```text
1. Request arrives
2. Identify runtime / project / task / agent
3. Resolve applicable policy
4. Determine candidate providers
5. Remove disallowed providers
6. Remove open-circuit providers
7. Validate capability requirements
8. Validate budget constraints
9. Score remaining candidates
10. Select provider/model
11. Obtain credential through broker
12. Adapt request format
13. Dispatch
14. Meter usage
15. Record result
16. Trigger failover if eligible
17. Write audit event
```

---

# 16. Routing Score

Initial weighted routing can use:

```text
score =
  availability_weight * health_score
+ capability_weight   * capability_match
+ cost_weight         * cost_score
+ latency_weight      * latency_score
+ preference_weight   * user_preference
+ policy_weight       * policy_preference
```

Weights must be configurable per policy.

Do not allow a low-cost provider to override a hard security restriction.

---

# 17. Circuit Breaker State Machine

```text
CLOSED
  |
  | failure threshold exceeded
  v
OPEN
  |
  | cool-down elapsed
  v
HALF_OPEN
  |          |
 success     failure
  |          |
  v          v
CLOSED      OPEN
```

Suggested configurable fields:

```yaml
failure_threshold: 3
failure_window_seconds: 60
open_duration_seconds: 30
half_open_probe_count: 1
```

Classify errors before counting them.

Possible categories:

- authentication
- quota
- rate limit
- timeout
- upstream 5xx
- malformed request
- policy rejection
- model unavailable
- network unreachable

Policy errors and malformed local requests should not necessarily degrade provider health.

---

# 18. Failover Safety Rules

Automatic failover is allowed for stateless model inference requests where replay is safe.

Additional guardrails are required when requests may trigger tools.

Classify a run as:

```text
READ_ONLY
IDEMPOTENT_WRITE
NON_IDEMPOTENT_WRITE
UNKNOWN
```

Rules:

```text
READ_ONLY             -> automatic replay allowed
IDEMPOTENT_WRITE      -> replay only with stable idempotency key
NON_IDEMPOTENT_WRITE  -> require explicit recovery logic or approval
UNKNOWN               -> no blind automatic replay
```

---

# 19. Configuration Projection Workflow

Every managed configuration update must follow:

```text
Read current file
   -> Parse
   -> Normalize
   -> Detect unmanaged edits
   -> Build desired state
   -> Compute diff
   -> Validate
   -> Backup
   -> Atomic write temp file
   -> fsync / verify where available
   -> Rename into place
   -> Re-read
   -> Verify hash/schema
   -> Record projection
```

Never overwrite an externally changed managed file without detecting drift.

---

# 20. Config Drift Handling

Drift states:

```text
IN_SYNC
EXTERNAL_CHANGE
CONFLICT
MISSING
INVALID
UNMANAGED
```

Conflict UI should provide:

```text
Current local
Desired Pao-hubPro
Diff
Import local changes
Overwrite with managed state
Keep unmanaged
```

Destructive overwrite requires confirmation when meaningful user changes would be lost.

---

# 21. MCP Import Security Pipeline

```text
Source
  -> Parse MCP definition
  -> Schema validate
  -> Detect executable command
  -> Detect environment/secrets
  -> Detect network destinations
  -> Compute risk
  -> Permission preview
  -> Reviewer Council if policy requires
  -> Human approval
  -> Store Disabled
  -> Explicit enable per runtime
```

Potential high-risk indicators:

- arbitrary shell command
- PowerShell execution
- executable download
- broad filesystem access
- credential directory access
- browser profile access
- network listener
- remote code retrieval
- package install hooks

---

# 22. Skills Import Security Pipeline

```text
Acquire
  -> Hash
  -> Extract isolated
  -> Inspect manifests/instructions/scripts
  -> Static scan
  -> Enumerate commands and file access
  -> Enumerate network requirements
  -> Assign risk class
  -> Reviewer Council
  -> Human approval
  -> Install disabled
```

Skill updates must be treated as new code and re-reviewed when content hash changes.

---

# 23. Credential Architecture

```text
                  +-------------------+
                  | Provider Registry |
                  +---------+---------+
                            |
                            | secret_ref only
                            v
                  +-------------------+
                  | Credential Broker |
                  +---------+---------+
                            |
             +--------------+---------------+
             |                              |
             v                              v
+-------------------------+      +-------------------------+
| Windows Credential     |      | DPAPI Vault             |
| Manager / OS secret API|      | Encrypted local secrets |
+-------------------------+      +-------------------------+
```

Database stores metadata such as:

- secret reference
- provider association
- auth type
- scopes
- expiry
- last rotation
- status

The API must never return raw secrets to ordinary UI queries.

---

# 24. Secret Redaction

Sensitive fields must be redacted from:

- logs
- crash reports
- audit payloads
- UI screenshots where possible
- exported diagnostics
- support bundles
- telemetry

Patterns include:

```text
Authorization headers
API keys
Bearer tokens
OAuth refresh tokens
session cookies
provider secrets
MCP environment secrets
```

---

# 25. Policy Model

Suggested policy object:

```yaml
id: private-source-default
scope:
  project: '*'

data_classification: private
allowed_providers:
  - openai-approved
  - anthropic-approved
  - local
blocked_provider_tags:
  - unknown-relay
  - untrusted
max_cost_per_request_usd: 1.50
max_cost_per_task_usd: 10.00
require_approval:
  - provider_change_to_untrusted
  - mcp_enable_high_risk
  - skill_enable_high_risk
  - lan_proxy_enable
```

---

# 26. Approval Events

Approval may be required for:

- enabling a high-risk MCP server
- enabling a high-risk skill
- importing credential-bearing configs
- switching private code to an unapproved external provider
- enabling LAN gateway exposure
- changing secret scope
- disabling audit logging
- exceeding task cost budget
- replaying uncertain side-effecting requests

---

# 27. Audit Events

Audit event types should include:

```text
PROVIDER_CREATED
PROVIDER_UPDATED
PROVIDER_SWITCHED
ROUTE_SELECTED
FAILOVER_TRIGGERED
CIRCUIT_OPENED
CIRCUIT_RECOVERED
CREDENTIAL_CREATED
CREDENTIAL_ROTATED
RUNTIME_DISCOVERED
CONFIG_PROJECTED
CONFIG_DRIFT_DETECTED
MCP_IMPORTED
MCP_ENABLED
MCP_DISABLED
SKILL_IMPORTED
SKILL_ENABLED
SKILL_UPDATED
PROMPT_PROJECTED
SESSION_INDEXED
POLICY_DENIED
APPROVAL_REQUESTED
APPROVAL_GRANTED
APPROVAL_DENIED
BUDGET_WARNING
BUDGET_BLOCK
```

Each record should include:

- timestamp
- actor
- machine
- runtime
- project
- task
- correlation ID
- action
- target
- policy result
- approval linkage
- redacted metadata

---

# 28. Usage & Cost Model

Request usage schema:

```sql
CREATE TABLE ai_usage_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    project_id TEXT,
    task_id TEXT,
    agent_id TEXT,
    runtime_id TEXT,
    provider_id TEXT,
    model_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_input_tokens INTEGER,
    estimated_cost REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    latency_ms INTEGER,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    failover_from_provider_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

---

# 29. Budget Guardrails

Budget levels:

```text
GLOBAL
PROJECT
TASK
AGENT
PROVIDER
MODEL
DAY
WEEK
MONTH
```

Actions:

```text
observe only
warn
prefer cheaper provider
require approval
hard block
```

Budget routing must remain subordinate to security policy.

---

# 30. Dashboard

Main dashboard cards:

```text
Active Runtime
Current Provider
Current Model
Gateway Status
Provider Health
Today's Spend
This Week
This Month
Failovers Today
Open Approvals
Config Drift
MCP Enabled
Skills Enabled
```

---

# 31. Provider Screen

Provider UI should expose:

```text
Provider
Status
Health
Endpoint
Protocol
Models
Credential
Trust Class
Cost
Latency
Fallback Position
Allowed Projects
Last Request
Last Error
```

Actions:

```text
Test Connection
Set Active
Add to Fallback
Disable
Edit
Duplicate
Rotate Credential
View Usage
View Audit
```

---

# 32. Routing Screen

Visual route editor:

```text
Codex
  -> Policy: Coding Default
  -> OpenAI Primary
  -> OpenRouter Backup
  -> Local Backup
```

Show real-time states:

```text
HEALTHY
DEGRADED
OPEN CIRCUIT
RATE LIMITED
AUTH ERROR
DISABLED
```

---

# 33. MCP Screen

Columns:

```text
Name
Transport
Risk
Source
Codex
Claude
Gemini
OpenCode
Hermes
OpenClaw
Approval
Version
Health
```

The user must be able to toggle target bindings independently.

---

# 34. Skills Screen

Columns:

```text
Skill
Version
Source
Hash
Risk
Approval
Installed Targets
Update Available
Last Review
```

Actions:

```text
Inspect
Review Diff
Enable
Disable
Pin Version
Rollback
Remove
```

---

# 35. Prompt Screen

Features:

- Markdown editor
- inheritance graph
- target runtime preview
- compiled output preview
- conflict markers
- version history
- restore
- diff
- project scoping

---

# 36. Sessions Screen

Filters:

```text
Runtime
Project
Agent
Provider
Model
Date
Status
Cost
```

Session detail:

```text
Transcript link
Files touched
Tools used
MCP calls
Approvals
Provider switches
Failovers
Token usage
Cost
Audit timeline
```

---

# 37. Proposed Local API

```text
GET    /api/providers
POST   /api/providers
GET    /api/providers/:id
PATCH  /api/providers/:id
DELETE /api/providers/:id

POST   /api/providers/:id/test
POST   /api/providers/:id/activate

GET    /api/routes
POST   /api/routes
PATCH  /api/routes/:id

GET    /api/runtimes
POST   /api/runtimes/discover
POST   /api/runtimes/:id/project-config
GET    /api/runtimes/:id/drift

GET    /api/mcp
POST   /api/mcp/import
PATCH  /api/mcp/:id
POST   /api/mcp/:id/enable
POST   /api/mcp/:id/disable

GET    /api/skills
POST   /api/skills/import
POST   /api/skills/:id/review
POST   /api/skills/:id/enable
POST   /api/skills/:id/rollback

GET    /api/prompts
POST   /api/prompts
POST   /api/prompts/compile
POST   /api/prompts/project

GET    /api/sessions
GET    /api/sessions/:id

GET    /api/usage
GET    /api/cost
GET    /api/health/providers
GET    /api/audit
GET    /api/approvals
```

---

# 38. Proposed CLI

```text
pao providers list
pao providers add
pao providers test <id>
pao providers activate <id> --runtime codex

pao route list
pao route inspect <runtime>
pao route failover <runtime>

pao runtime discover
pao runtime diff codex
pao runtime sync codex

pao mcp list
pao mcp import <source>
pao mcp enable <id> --runtime codex

pao skill list
pao skill import <source>
pao skill inspect <id>
pao skill enable <id> --runtime codex

pao prompt compile --project <id>
pao prompt diff --runtime claude

pao sessions list
pao usage today
pao cost month

pao gateway status
pao gateway start
pao gateway stop
pao gateway health
```

---

# 39. Gateway Endpoints

OpenAI-compatible local entrypoint example:

```text
http://127.0.0.1:<port>/v1
```

Optional protocol-specific endpoints:

```text
/v1/chat/completions
/v1/responses
/v1/models
/anthropic/v1/messages
/gemini/*
```

Actual endpoint support must be introduced only when protocol translation is verified by tests.

---

# 40. Runtime Adapter Contract

Each adapter implements:

```ts
interface RuntimeAdapter {
  detect(): Promise<RuntimeDetection>;
  readConfig(): Promise<NormalizedRuntimeConfig>;
  diff(desired: DesiredRuntimeConfig): Promise<ConfigDiff>;
  validate(desired: DesiredRuntimeConfig): Promise<ValidationResult>;
  backup(): Promise<BackupResult>;
  project(desired: DesiredRuntimeConfig): Promise<ProjectionResult>;
  verify(): Promise<VerificationResult>;
  restore(backupId: string): Promise<RestoreResult>;
}
```

Adapters must be testable without touching real user configs by using fixtures and temporary directories.

---

# 41. Provider Adapter Contract

```ts
interface ProviderAdapter {
  normalizeRequest(input: CanonicalRequest): Promise<ProviderRequest>;
  execute(request: ProviderRequest, credential: SecretHandle): Promise<ProviderResponse>;
  normalizeResponse(response: ProviderResponse): Promise<CanonicalResponse>;
  classifyError(error: unknown): ProviderErrorClass;
  checkHealth(): Promise<ProviderHealthResult>;
}
```

---

# 42. Canonical Request Envelope

```json
{
  "request_id": "...",
  "runtime_id": "codex-local",
  "project_id": "pao-hubpro",
  "task_id": "...",
  "agent_id": "...",
  "requested_capabilities": ["text", "tools"],
  "model_alias": "coding-default",
  "messages": [],
  "tools": [],
  "policy_context": {},
  "budget_context": {},
  "metadata": {}
}
```

Avoid forcing every provider-specific feature into this envelope. Provider extensions can exist under a namespaced extension field.

---

# 43. Events

Internal event bus topics:

```text
provider.health.changed
provider.circuit.opened
provider.circuit.closed
routing.selection.completed
routing.failover.triggered
runtime.config.drifted
runtime.config.projected
mcp.imported
mcp.binding.changed
skill.imported
skill.binding.changed
prompt.projected
session.indexed
usage.recorded
budget.threshold.reached
approval.requested
approval.resolved
```

---

# 44. Integration With Existing Pao-hubPro Layers

## OmniRoute / 9Router-style systems

Use them as routing/data-plane implementations where useful.

Phase 21.03 becomes the central registry, policy, projection, and operator-facing control plane.

## MCPProxy

Reuse as an MCP routing/security boundary where compatible.

Do not duplicate MCP transport logic unless required.

## SkillsGate

SkillsGate becomes the security/approval gate behind the new unified Skills Registry.

## Reviewer Council

Use Reviewer Council for:

- high-risk skill review
- high-risk MCP import
- suspicious provider configuration
- policy-sensitive routing changes
- dangerous runtime config projection

Reviewer Council should advise/approve according to policy; it must not silently bypass human gates.

## Agent runtime / fleet layers

Attach provider/model/routing metadata to every agent run.

---

# 45. Security Threat Model

Threats include:

1. API key theft.
2. malicious MCP server definitions.
3. malicious skill updates.
4. config injection.
5. deep-link import attacks.
6. local proxy exposure to LAN.
7. unauthorized provider switching.
8. secret leakage through logs.
9. prompt injection causing policy bypass.
10. session transcript disclosure.
11. DNS/base-URL redirection to attacker infrastructure.
12. arbitrary executable paths in imported configs.
13. symlink attacks during skill deployment.
14. config race conditions.
15. failover replay causing duplicate side effects.

---

# 46. Security Requirements

Mandatory:

```text
[ ] Loopback-only gateway by default
[ ] Secrets outside normal plaintext DB fields
[ ] Secret redaction
[ ] Atomic config writes
[ ] Backups before projection
[ ] Drift detection
[ ] Import disabled by default
[ ] Risk analysis for MCP/skills
[ ] Human approval for high-risk enablement
[ ] Audit trail for provider switches
[ ] No blind replay of unsafe tool runs
[ ] Config path validation
[ ] Canonical-path checks
[ ] Symlink traversal protection
[ ] Per-project policy enforcement
[ ] Cost/budget enforcement
[ ] Provider endpoint validation
```

---

# 47. LAN / Remote Gateway Policy

Default:

```text
listen = 127.0.0.1
remote_access = false
```

To enable LAN/remote access require:

```text
explicit enablement
+ authenticated clients
+ TLS
+ IP/network allowlist
+ rate limit
+ audit
+ approval
```

The UI must display a clear security warning whenever the gateway listens on a non-loopback interface.

---

# 48. Backup Strategy

Before any managed config projection:

```text
runtime
config path
original hash
backup timestamp
adapter version
projection ID
```

Backups must be restorable independently per runtime.

Retention policy should be configurable.

---

# 49. Migration Strategy

Migration is gradual.

## Stage A — Discovery only

Detect installed runtimes and parse configuration.

Do not modify anything.

## Stage B — Import

Normalize existing providers/MCP/prompts into Pao-hubPro registries.

## Stage C — Diff-only projection

Generate expected changes without writing.

## Stage D — Managed projection opt-in

User explicitly enables managed config for a runtime.

## Stage E — Gateway routing

Enable local gateway per runtime.

## Stage F — Auto-failover

Enable after gateway health and compatibility tests pass.

---

# 50. Rollback Strategy

Every subsystem requires rollback.

```text
Provider Registry     -> versioned records
Runtime Projection    -> file backup restore
MCP                    -> previous binding/config
Skills                 -> pinned prior version
Prompts                -> version history
Routes                 -> previous policy revision
Gateway                -> disable takeover, restore direct config
```

---

# 51. Test Matrix

## Unit tests

- provider normalization
- config serializers/parsers
- model alias resolution
- routing score
- circuit breaker
- retry classifier
- failover eligibility
- token/cost calculation
- secret redaction
- policy evaluation
- prompt merge precedence
- drift detection

## Integration tests

- Codex config import/projection
- Claude config import/projection
- Gemini config import/projection
- OpenCode config import/projection
- MCP sync
- skill deployment
- local gateway request
- provider failover
- backup/restore
- budget enforcement

## Security tests

- path traversal
- symlink escape
- malicious MCP command
- secret-in-log detection
- unauthorized provider switch
- unapproved high-risk skill enablement
- non-loopback bind without approval
- replay unsafe request

## Chaos tests

- provider timeout
- provider 429
- provider 5xx
- DNS failure
- gateway restart
- partial config write attempt
- database locked
- credential unavailable
- provider recovers from open circuit

---

# 52. Acceptance Checklist

## Provider Control Plane

- [ ] Central provider registry exists.
- [ ] Multiple providers can be added and disabled.
- [ ] Provider endpoint and credential are separate concepts.
- [ ] Model aliases work.
- [ ] Provider health is visible.

## Runtime Registry

- [ ] Installed runtimes can be discovered.
- [ ] Runtime versions/config paths are recorded.
- [ ] Config files can be parsed safely.
- [ ] Drift can be detected.

## Cross-CLI Projection

- [ ] At least Codex adapter works end-to-end.
- [ ] At least one second runtime adapter works end-to-end.
- [ ] Projection is atomic.
- [ ] Backup is created before write.
- [ ] Rollback restores original config.

## Gateway

- [ ] Local gateway binds to loopback by default.
- [ ] Requests can route to a selected provider.
- [ ] Provider credentials are injected by broker.
- [ ] Usage is recorded.
- [ ] Gateway can be cleanly disabled.

## Failover

- [ ] Ordered fallback routes work.
- [ ] Circuit breaker works.
- [ ] Provider recovery works.
- [ ] Unsafe side-effecting requests are not blindly replayed.

## MCP

- [ ] MCP definitions are centrally registered.
- [ ] Runtime-specific bindings work.
- [ ] Import is disabled by default.
- [ ] High-risk MCP enablement requires approval.

## Skills

- [ ] Skills can be imported.
- [ ] Hash/version are tracked.
- [ ] Deployment per runtime works.
- [ ] High-risk enablement requires approval.
- [ ] Rollback works.

## Prompts

- [ ] Prompt hierarchy compiles deterministically.
- [ ] Runtime preview is available.
- [ ] Conflict/drift detection works.
- [ ] Version restore works.

## Sessions

- [ ] Sessions from supported runtimes can be indexed.
- [ ] Search/filter works.
- [ ] Provider/model/cost metadata is attached where available.

## Cost Observatory

- [ ] Request/token metrics are recorded.
- [ ] Pricing is timestamped.
- [ ] Per-provider/model/project/task cost can be queried.
- [ ] Budget warning/block policies work.

## Credential Security

- [ ] Secrets are not stored in normal plaintext DB fields.
- [ ] Logs redact secrets.
- [ ] Secret references are auditable.
- [ ] Rotation metadata is supported.

## Governance

- [ ] All provider switches produce audit events.
- [ ] Policy denials are traceable.
- [ ] Approval linkage is traceable.
- [ ] Imported executable content is never silently enabled.

---

# 53. Definition of Done

Phase 21.03 is complete only when all of the following are true:

1. Pao-hubPro contains a central provider registry.
2. At least two real AI CLI/runtime adapters are implemented and tested.
3. Existing configuration can be imported without destructive modification.
4. Managed configuration projection supports backup, diff, atomic write, verify, and restore.
5. A loopback-only local AI gateway can route real requests.
6. Provider health and automatic failover function under controlled tests.
7. MCP and Skills have central registries with per-runtime bindings.
8. High-risk MCP/skill activation is approval-gated.
9. Prompt federation can compile and project runtime-specific prompt files.
10. Session federation can index at least two session sources.
11. Usage/cost metrics are queryable by provider/model/project/task.
12. Secrets are brokered through a secure OS-backed/encrypted store.
13. Provider switching and failover are governed by policy.
14. Every sensitive state change is auditable.
15. Test suite covers routing, failover, config projection, security, and rollback.
16. Disabling the phase's managed runtime layer restores runtimes to a safe direct configuration.

---

# 54. Recommended Implementation Order

```text
21.03.1  Provider Registry + DB migrations
21.03.2  Runtime Discovery + Adapter contract
21.03.3  Codex Adapter
21.03.4  Second Runtime Adapter
21.03.5  Credential Broker
21.03.6  Config Diff / Backup / Atomic Projection
21.03.7  Local AI Gateway
21.03.8  Routing Policy
21.03.9  Health + Circuit Breaker
21.03.10 Automatic Failover
21.03.11 MCP Registry + Sync
21.03.12 Skills Registry + SkillsGate integration
21.03.13 Prompt Federation
21.03.14 Session Federation
21.03.15 Usage / Cost Observatory
21.03.16 Approval + Reviewer Council hooks
21.03.17 UI control plane
21.03.18 Security hardening
21.03.19 Chaos / rollback tests
21.03.20 Canonical documentation + closeout
```

---

# 55. Suggested Repository Structure

```text
apps/
  desktop/
  web/

packages/
  ai-control-plane/
  provider-registry/
  provider-adapters/
  runtime-registry/
  runtime-adapters/
    codex/
    claude/
    gemini/
    opencode/
    openclaw/
    hermes/
    minimax/
  ai-gateway/
  routing-engine/
  health-engine/
  failover-engine/
  credential-broker/
  mcp-registry/
  skills-registry/
  prompt-federation/
  session-federation/
  usage-observatory/
  policy-engine/
  approval-engine/
  audit-engine/

migrations/
  21.03/

tests/
  fixtures/
  integration/
  security/
  chaos/

docs/
  phases/
    21.03-cc-switch-control-plane.md
```

---

# 56. UI Navigation Proposal

```text
Pao-hubPro
|
+-- Home
+-- Agents
+-- Providers        <- NEW
+-- Routing          <- NEW
+-- Runtimes         <- NEW
+-- MCP
+-- Skills
+-- Prompts          <- EXPANDED
+-- Sessions         <- EXPANDED
+-- Usage & Cost     <- NEW/EXPANDED
+-- Approvals
+-- Audit
+-- Settings
```

---

# 57. Operational UX Principle

The main workflow should require minimal steps.

Example provider switch:

```text
Providers
  -> choose provider
  -> Activate
  -> target runtimes appear
  -> policy check
  -> preview
  -> Apply
```

If the runtime is gateway-managed, switching should be immediate without rewriting its upstream provider every time.

If the runtime is direct-config-managed, projection rules apply.

---

# 58. Recommended Default Modes

```yaml
gateway:
  bind: 127.0.0.1
  remote_access: false
  logging: true
  redact_secrets: true

imports:
  auto_enable_mcp: false
  auto_enable_skills: false

routing:
  auto_failover: false
  require_explicit_enable: true

credentials:
  plaintext_storage: false

config_projection:
  backup_before_write: true
  drift_detection: true
  atomic_write: true
```

Auto-failover should become opt-in per runtime/policy after successful compatibility tests.

---

# 59. Phase Deliverables

Required deliverables:

```text
[ ] database migrations
[ ] provider registry service
[ ] runtime registry service
[ ] runtime adapter SDK
[ ] Codex adapter
[ ] second runtime adapter
[ ] credential broker
[ ] local AI gateway
[ ] routing engine integration
[ ] health engine
[ ] failover engine
[ ] MCP registry integration
[ ] SkillsGate integration
[ ] prompt federation
[ ] session federation
[ ] usage/cost observatory
[ ] approval hooks
[ ] audit events
[ ] desktop/web UI
[ ] unit tests
[ ] integration tests
[ ] security tests
[ ] rollback tests
[ ] operator documentation
[ ] migration guide
```

---

# 60. Final Architecture Target

```text
                       PAO-HUBPRO
                           |
                 +---------+---------+
                 | AI CONTROL PLANE  |
                 +---------+---------+
                           |
      +--------------------+--------------------+
      |                    |                    |
      v                    v                    v
 Provider Registry     Runtime Registry    Policy / Approval
      |                    |                    |
      +----------+---------+---------+----------+
                 |                   |
                 v                   v
       Config Projection       Pao AI Gateway
                 |                   |
      +----------+-------+     +-----+--------------------+
      |          |       |     | Router / Failover        |
      v          v       v     | Health / Circuit Breaker |
    Codex      Claude  Gemini  | Protocol Translation    |
      |          |       |     | Usage / Cost Meter      |
      +----------+-------+     +------------+-------------+
                 |                          |
                 +-------------+------------+
                               |
                               v
                    Secure Credential Broker
                               |
                               v
                 Approved AI Provider Fabric
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
            OpenAI         Anthropic         Google
              |                |                |
              +---------- Other / Local --------+

Supporting planes:

MCP Registry <-> Skills Registry <-> Prompt Federation
      |               |                  |
      +---------------+------------------+
                      |
               Session Federation
                      |
                Usage / Cost / Audit
```

---

# 61. Canonical Phase Statement

**Phase 21.03 transforms Pao-hubPro into a unified AI provider and runtime control plane.**

The phase centralizes provider definitions, safely projects configuration into multiple AI CLIs, introduces a local routing gateway with policy-aware provider selection and automatic failover, federates MCP servers, skills, prompts, and sessions, adds usage/cost observability, brokers credentials through secure local secret storage, and subjects every sensitive runtime switch to Pao-hubPro policy, audit, approval, and rollback controls.

CC Switch is used as an architectural reference for multi-runtime configuration management and local routing behavior, while Pao-hubPro remains the authoritative governance layer and system of record.

---

# 62. Closeout Gate

Do not mark **Phase 21.03 GOLD / CLOSED** until:

```text
[ ] acceptance checklist passes
[ ] automated tests pass
[ ] security tests pass
[ ] failover replay safety verified
[ ] credential leakage tests pass
[ ] config backup/restore verified
[ ] drift handling verified
[ ] at least two runtime adapters verified
[ ] approval gates verified
[ ] audit completeness verified
[ ] rollback drill passes
[ ] canonical phase documentation updated
```

**END — Phase 21.03**
