# Pao-hubPro × Oya Browser — Universal AI Browser Control Plane, Multi-Provider Browser Routing, Persistent Persona & Session Vault, Record-to-Playbook Deterministic Replay, Browser Fleet Orchestration, Secure Human Takeover, Agent-Driven Workflow Repair, MCP/CDP Automation Gateway, Credential-Brokered Authentication & Policy-Governed Browser Operations

> Status: Proposed / Build-ready specification  
> Product: Pao-hubPro  
> Integration target: Oya Browser-compatible provider layer + Pao-hubPro native browser runtime  
> Date: 2026-09-22 (Asia/Bangkok)  
> Scope: Internal browser automation infrastructure, agent browser execution, reusable deterministic workflows, governance, auditability, and provider portability

---

## 1. Executive Summary

This phase turns Pao-hubPro into a **universal browser control plane for AI agents**.

The system must not bind Pao-hubPro to a single browser vendor, a single automation framework, or a single AI provider. Instead, Pao-hubPro will expose one policy-governed browser capability layer that can route browser tasks to:

- Local Chrome / Chromium
- Pao-hubPro native browser workers
- Oya Browser
- Browserbase
- Steel
- Browser Use
- Any future CDP-compatible browser backend

The phase introduces five core capabilities:

1. **Universal Browser Routing** — choose the correct browser backend according to policy, cost, latency, capability, region, trust level, session requirements, and provider health.
2. **Persistent Persona & Session Vault** — keep browser identity, cookies, localStorage, session metadata, preferred locale, viewport, timezone, profile constraints, and authentication context reusable across jobs without exposing raw secrets to agents.
3. **Record-to-Playbook Deterministic Replay** — allow an agent-assisted run to be converted into a deterministic workflow that can replay without an LLM when the website has not changed.
4. **Secure Human Takeover & Repair** — pause browser autonomy for CAPTCHA, MFA, passkeys, high-risk actions, login recovery, payment confirmation, destructive actions, or other policy-sensitive steps.
5. **Governed Browser Operations** — every browser action flows through policy checks, credential brokerage, approval gates, evidence capture, audit logging, budget controls, and revocation mechanisms.

The intended result is a reusable browser execution fabric that becomes the default browser substrate for Codex, ChatGPT, Claude, local agents, workflows, and Pao-hubPro automation.

---

## 2. Strategic Position in Pao-hubPro

Pao-hubPro already contains or plans multiple systems for:

- model/provider routing,
- multi-agent orchestration,
- MCP tool execution,
- safe local command execution,
- reviewer/approval workflows,
- reusable skills,
- durable task execution,
- remote operations,
- Adobe Stock automation,
- browser extensions and browser-native control.

This phase fills the missing layer between **agent reasoning** and **reliable browser execution**.

### Before

```text
Agent
  ↓
Playwright / Browser tool / Browser vendor
  ↓
Website
```

The problems are:

- vendor lock-in,
- inconsistent session models,
- duplicated login logic,
- unstable scripted authentication,
- no shared browser persona model,
- no centralized approval policy,
- no deterministic workflow replay,
- weak cross-provider observability,
- browser credentials exposed too close to the agent,
- browser failures handled differently by every integration.

### After

```text
ChatGPT / Codex / Claude / Local Agent / Workflow Engine
                         │
                         ▼
                Pao-hubPro MCP Gateway
                         │
                         ▼
             Browser Capability Control Plane
                         │
      ┌──────────────────┼──────────────────┐
      ▼                  ▼                  ▼
 Routing & Policy   Persona / Session   Playbook Engine
      │                  │                  │
      └──────────────────┼──────────────────┘
                         ▼
                 Browser Fleet Manager
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   Local Browser      Oya Adapter   Other Providers
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                       Web
```

---

## 3. Design Principles

### 3.1 Provider-neutral core

Pao-hubPro owns the contract. Providers are adapters.

No internal application should call Oya, Browserbase, Steel, Browser Use, Playwright, or Chrome-specific APIs directly unless it is inside an adapter.

### 3.2 Local-first

Use the user's own browser or local governed browser worker whenever it is appropriate and permitted.

Cloud browser backends are optional capacity, isolation, geo, failover, or workload-specific targets.

### 3.3 Deterministic when possible

LLM reasoning should be used for discovery and repair, not repeatedly for every stable workflow execution.

### 3.4 Human authority over sensitive actions

Agent autonomy stops at configured approval boundaries.

### 3.5 Secret isolation

Agents receive **capability handles**, not raw credentials.

### 3.6 Auditability

Every browser job must be reconstructable from:

- task identity,
- agent identity,
- browser worker,
- provider,
- persona,
- policy decisions,
- executed actions,
- approvals,
- evidence,
- result,
- failure reason.

### 3.7 Graceful degradation

If advanced features are unavailable, basic browser control should still function.

### 3.8 No anti-abuse bypass guarantees

Stealth/fingerprint controls are infrastructure capabilities, not a promise of undetectable automation. Pao-hubPro must enforce site rules, internal policy, rate limits, account safety, and legal constraints.

---

## 4. Scope

### In scope

- Browser provider registry
- Provider capability discovery
- Browser task routing
- Health-aware failover
- Cost-aware routing
- Browser fleet leasing
- Browser persona lifecycle
- Cookie/localStorage/session persistence
- Credential broker integration
- MCP browser tool surface
- CDP gateway abstraction
- Playwright/Puppeteer compatibility
- Deterministic playbook generation
- Playbook variable binding
- Replay execution
- Replay drift detection
- Agent-assisted workflow repair
- Human takeover
- Approval gates
- Screenshot/evidence capture
- Audit log
- Policy engine
- Browser quotas and budgets
- Local and cloud execution
- Provider adapter SDK

### Out of scope for first implementation

- Building a new Chromium fork from scratch
- CAPTCHA bypass as a mandatory capability
- Automatic financial transactions without approval
- Covert identity spoofing intended to evade enforcement
- Unlimited autonomous account creation
- Unsafe credential extraction
- Reverse engineering of restricted authentication mechanisms

---

## 5. Reference Inspiration: Oya Browser

Oya Browser is used as a **reference implementation and optional provider**, not as the definition of Pao-hubPro architecture.

Verified architectural ideas worth adopting:

- one browser control plane over multiple backends,
- Oya Browser / third-party provider routing,
- browser personas,
- session persistence,
- direct browser/control socket patterns,
- MCP, REST, SDK and CDP surfaces,
- Playwright/Puppeteer interoperability,
- reusable recorded playbooks,
- human takeover,
- browser fleet management,
- audit/evidence orientation.

### License boundary

Important:

- Oya SDK and CLI are described by the project as MIT-licensed.
- Major server/browser/control-plane portions are under a Sustainable Use License.

Pao-hubPro must therefore:

1. keep its own independent architecture and implementation,
2. use public interfaces/adapters where appropriate,
3. avoid copying restricted implementation code into a commercial Pao-hubPro core,
4. track third-party licenses per adapter,
5. clearly separate third-party code from Pao-hubPro-native code.

This specification is an architectural integration plan, not a code-copying plan.

---

# 6. System Architecture

## 6.1 High-level topology

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                               AI CLIENTS                                    │
│ ChatGPT │ Codex │ Claude │ Local AI │ Workflow Engine │ Pao-hubPro Apps    │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PAO-HUBPRO CAPABILITY GATEWAY                           │
│ MCP │ REST │ Internal RPC │ Skill Registry │ Auth │ Tenant Context          │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BROWSER CONTROL PLANE                                   │
│                                                                             │
│ Router │ Policy Engine │ Fleet Manager │ Persona Vault │ Session Manager    │
│ Playbook Engine │ Human Takeover │ Repair Engine │ Evidence │ Audit         │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                   ┌────────────┼────────────┐
                   │            │            │
                   ▼            ▼            ▼
              Local Adapter   Oya Adapter   Provider Adapters
                   │            │            │
                   ▼            ▼            ▼
             Chrome/Edge      Oya           Browserbase
             Chromium         Cloud         Steel
             Pao Worker       Desktop       Browser Use
                                             Future CDP
```

---

## 6.2 Core services

### Browser Gateway

Single entry point for agents and internal apps.

Responsibilities:

- validate caller identity,
- map MCP/REST request to browser capability request,
- attach policy context,
- enforce budgets,
- return normalized browser results.

### Browser Router

Chooses the browser execution backend.

Routing inputs:

- required capabilities,
- persona affinity,
- geographic requirement,
- session continuity,
- data sensitivity,
- provider trust level,
- provider health,
- browser version,
- cost ceiling,
- maximum startup latency,
- browser UI requirement,
- human takeover requirement,
- local-only restrictions.

### Browser Fleet Manager

Manages browser workers as leaseable resources.

States:

```text
OFFLINE
STARTING
READY
LEASED
BUSY
PAUSED_FOR_HUMAN
DRAINING
UNHEALTHY
TERMINATED
```

### Persona Vault

Stores reusable browser identity and session state.

### Credential Broker

Resolves authentication material only when a policy-approved browser action requires it.

### Playbook Engine

Converts successful dynamic browser runs into deterministic workflows.

### Replay Engine

Executes deterministic playbooks without LLM reasoning when possible.

### Repair Engine

Diagnoses drift and proposes a new playbook version.

### Human Takeover Service

Transfers control to a trusted human without destroying job/session context.

### Approval Service

Evaluates whether an action can proceed automatically or requires confirmation.

### Evidence Store

Stores screenshots, action proofs, state snapshots, and replay diagnostics.

### Audit Ledger

Tracks all state transitions and privileged actions.

---

# 7. Browser Provider Abstraction

Every provider must implement the same logical interface.

```ts
interface BrowserProvider {
  id: string;
  capabilities(): Promise<BrowserCapabilities>;
  health(): Promise<ProviderHealth>;
  start(req: BrowserStartRequest): Promise<BrowserLease>;
  connect(leaseId: string): Promise<BrowserConnection>;
  stop(leaseId: string): Promise<void>;
  snapshot?(leaseId: string): Promise<SessionSnapshot>;
  restore?(snapshotId: string): Promise<BrowserLease>;
}
```

## Required provider metadata

```yaml
provider_id: local-chrome
kind: local
trust_level: high
supports:
  cdp: true
  live_view: true
  headful: true
  headless: true
  persona: true
  session_restore: true
  human_takeover: true
  proxy: optional
cost:
  startup: 0
  minute: 0
policy:
  regulated_data: allowed
  credential_injection: allowed
  residential_proxy: denied
```

---

# 8. Multi-Provider Browser Routing

## 8.1 Routing pipeline

```text
Browser Task
    │
    ▼
Requirement Extraction
    │
    ▼
Policy Pre-Filter
    │
    ▼
Capability Filter
    │
    ▼
Persona Affinity
    │
    ▼
Provider Health
    │
    ▼
Cost / Latency Score
    │
    ▼
Preferred Route
    │
    ├── success → lease browser
    │
    └── failure → failover route
```

## 8.2 Example routing policy

```yaml
routes:
  - name: authenticated-local-first
    when:
      authenticated_session: true
      sensitivity: [high, regulated]
    prefer:
      - local-chrome
      - pao-governed-worker
    deny:
      - residential-proxy

  - name: general-web-research
    when:
      workload: research
      sensitivity: low
    prefer:
      - pao-governed-worker
      - oya
      - browserbase
      - steel

  - name: durable-persona
    when:
      requires_persistent_persona: true
    require_capabilities:
      - session_restore
      - persistent_storage
```

## 8.3 Failover policy

Failover is allowed only if:

- requested capabilities remain available,
- data classification permits the target provider,
- persona/session can be transferred safely,
- cost remains under budget,
- the task has not crossed a non-idempotent boundary.

Never automatically replay an irreversible action on a different provider.

---

# 9. Persistent Persona & Session Vault

## 9.1 Persona model

```yaml
persona:
  id: persona_adobe_stock_main
  name: Adobe Stock Main
  owner: pao
  mode: persistent
  browser_preferences:
    locale: th-TH
    timezone: Asia/Bangkok
    viewport: 1440x900
    platform_policy: stable
  auth:
    credential_refs:
      - cred_adobe_main
  storage:
    cookies: encrypted
    local_storage: encrypted
    indexed_db: optional
  proxy:
    mode: direct
  policy:
    human_required_for:
      - payout_change
      - password_change
      - account_recovery
```

## 9.2 Persona contents

A persona may contain:

- browser profile identity,
- cookie jar,
- localStorage,
- sessionStorage migration metadata,
- optional browser storage snapshot,
- preferred browser family,
- locale,
- timezone,
- viewport,
- platform constraints,
- proxy preference,
- account affinity,
- provider affinity,
- trusted hosts,
- blocked hosts,
- approval policy,
- credential references.

## 9.3 Security rules

- Persona state encrypted at rest.
- Persona access requires capability authorization.
- Agents cannot enumerate secret values.
- Credential refs are opaque IDs.
- Session export is denied by default.
- Cross-persona cookie merge is prohibited.
- Persona use is logged.
- Persona deletion destroys stored session material.

---

# 10. Credential-Brokered Authentication

Agents must not receive raw passwords, TOTP secrets, API keys, recovery codes, or browser vault decryption keys.

## Flow

```text
Agent requests "login to service"
          │
          ▼
Browser Control Plane
          │
          ▼
Credential Broker
          │
          ├─ verifies host
          ├─ verifies persona
          ├─ verifies policy
          ├─ verifies action context
          └─ returns restricted credential capability
          │
          ▼
Browser worker performs injection
```

The broker should support:

- username/password fields,
- API token form fills,
- TOTP generation,
- OAuth handoff,
- human-assisted passkey flow,
- approval-required secrets.

Credential material must not appear in:

- agent prompt logs,
- generic audit logs,
- screenshots,
- tool output,
- playbook source.

---

# 11. Record-to-Playbook Deterministic Replay

## 11.1 Concept

A successful dynamic run can be converted into a reusable playbook.

```text
Natural-language task
      │
      ▼
Agent performs browser actions
      │
      ▼
Recorder captures normalized actions
      │
      ▼
Variable/secret extraction
      │
      ▼
Playbook draft
      │
      ▼
Validation replay
      │
      ▼
Approved playbook
```

## 11.2 Playbook structure

```yaml
playbook:
  id: adobe_stock_upload_v1
  version: 1
  description: Upload an approved Adobe Stock asset draft
  persona: persona_adobe_stock_main
  allowed_hosts:
    - contributor.stock.adobe.com
  inputs:
    - asset_path
    - title
    - keywords
  secrets: []
  steps:
    - goto: https://contributor.stock.adobe.com/
    - assert:
        condition: authenticated
    - click:
        target: upload_button
    - upload:
        target: file_input
        value: "{{asset_path}}"
    - fill:
        target: title_input
        value: "{{title}}"
    - fill:
        target: keywords_input
        value: "{{keywords}}"
    - approval:
        policy: before_submission
    - click:
        target: submit_button
```

## 11.3 Action normalization

Recorded actions should be transformed from fragile coordinates/selectors into semantic target descriptions.

Target priority:

1. stable element ID / automation ID,
2. accessible role + name,
3. stable form label,
4. deterministic selector,
5. text anchor,
6. vision fallback,
7. coordinates only as last resort.

## 11.4 Replay modes

- `strict` — fail immediately on drift.
- `safe-repair` — allow non-sensitive agent repair.
- `human-repair` — pause and request human assistance.
- `dry-run` — execute assertions without irreversible actions.

---

# 12. Drift Detection & Agent-Driven Workflow Repair

A playbook must detect site drift rather than blindly continue.

## Drift signals

- target missing,
- target moved to incompatible context,
- unexpected navigation,
- authentication state changed,
- challenge page detected,
- form schema changed,
- destructive action text changed,
- new approval prompt,
- unexpected domain redirect.

## Repair flow

```text
Replay failure
    │
    ▼
Capture evidence
    │
    ▼
Classify failure
    │
    ├─ transient → retry within policy
    │
    ├─ auth → session recovery
    │
    ├─ challenge → human takeover
    │
    └─ DOM/workflow drift → agent repair
                         │
                         ▼
                    Repair Draft
                         │
                         ▼
                 Reviewer / Human Gate
                         │
                         ▼
                    Playbook vNext
```

Repairs must create a new version, never silently mutate the approved playbook.

---

# 13. Secure Human Takeover

## 13.1 Trigger conditions

Human takeover may be required for:

- CAPTCHA,
- MFA,
- passkey,
- security question,
- account recovery,
- payment confirmation,
- payout destination changes,
- password changes,
- account deletion,
- final publication/submission,
- suspicious unexpected UI,
- policy ambiguity.

## 13.2 Takeover lifecycle

```text
RUNNING
  ↓
PAUSE_REQUESTED
  ↓
PAUSED_FOR_HUMAN
  ↓
HUMAN_CONNECTED
  ↓
HUMAN_CONTROL
  ↓
HAND_BACK
  ↓
AGENT_RESUME
```

## 13.3 Requirements

- preserve browser session,
- preserve tab state,
- preserve task context,
- show why takeover was requested,
- show pending high-risk action,
- allow immediate stop,
- log handoff boundaries,
- prevent simultaneous human/agent input unless explicitly enabled.

---

# 14. Approval Policy Engine

## Risk classes

### R0 — read-only

Examples:

- navigate,
- extract text,
- summarize,
- screenshot.

Default: automatic.

### R1 — reversible low risk

Examples:

- fill non-sensitive forms,
- change filters,
- create draft.

Default: automatic or sampled review.

### R2 — external side effect

Examples:

- send message,
- upload asset,
- post content,
- submit application.

Default: configurable approval.

### R3 — sensitive account action

Examples:

- change password,
- connect billing,
- change payout,
- grant OAuth scope,
- delete account.

Default: mandatory human approval.

### R4 — irreversible/high-risk

Default: explicit human approval immediately before execution.

---

# 15. MCP Browser Gateway

Pao-hubPro should expose normalized browser tools.

## Minimal tool set

```text
browser.start
browser.stop
browser.status
browser.goto
browser.observe
browser.click
browser.type
browser.select
browser.upload
browser.download
browser.screenshot
browser.ask
browser.extract
browser.execute_playbook
browser.record_playbook
browser.pause
browser.resume
browser.takeover_request
browser.takeover_release
browser.session_snapshot
browser.session_restore
browser.persona_list
browser.persona_use
browser.evidence_get
```

## Example MCP semantics

### `browser.start`

Input:

```json
{
  "persona_id": "persona_adobe_stock_main",
  "provider_policy": "local-first",
  "headful": true,
  "human_takeover": true
}
```

Output:

```json
{
  "browser_id": "br_01J...",
  "lease_id": "lease_01J...",
  "provider": "local-chrome",
  "status": "ready"
}
```

### `browser.execute_playbook`

```json
{
  "playbook_id": "adobe_stock_upload_v1",
  "inputs": {
    "asset_path": "artifact://asset/123",
    "title": "...",
    "keywords": "..."
  },
  "mode": "safe-repair"
}
```

---

# 16. CDP Automation Gateway

Pao-hubPro should provide a controlled CDP relay for trusted clients.

Goals:

- Playwright compatibility,
- Puppeteer compatibility,
- provider-neutral CDP endpoint,
- authorization per browser lease,
- session expiry,
- host policy enforcement,
- observability.

The external client should not need to know whether the browser runs locally, in Oya, or on another provider.

---

# 17. Browser Fleet Orchestration

## Browser worker model

```yaml
worker:
  id: worker_local_01
  provider: local
  runtime: windows
  browsers:
    - chrome
    - edge
  capacity: 3
  trust_zone: local-private
  labels:
    gpu: false
    human_takeover: true
    persistent_storage: true
```

## Scheduler considerations

- persona affinity,
- storage locality,
- provider availability,
- account concurrency limits,
- site rate limits,
- memory/CPU constraints,
- geographic restrictions,
- browser version,
- human proximity.

## Lease model

A browser must be leased to one active execution context unless explicitly configured for cooperative operation.

```text
available → leased → active → paused → active → released
```

Expired leases must be reclaimed safely.

---

# 18. Observability

Metrics:

- browser starts,
- startup latency,
- task success rate,
- replay success rate,
- repair rate,
- human takeover count,
- provider failover count,
- average task cost,
- browser-minutes by provider,
- persona restore success,
- authentication failure count,
- provider health,
- policy denials,
- approvals,
- abnormal termination count.

Example:

```text
pao_browser_task_total
pao_browser_task_success_total
pao_browser_provider_failover_total
pao_browser_playbook_replay_success_total
pao_browser_human_takeover_total
pao_browser_provider_cost_total
pao_browser_active_leases
```

---

# 19. Evidence & Audit Model

Every privileged browser job receives a correlation ID.

```text
job_id
  ├── agent request
  ├── selected policy
  ├── routing decision
  ├── provider lease
  ├── persona use
  ├── browser actions
  ├── approvals
  ├── screenshots
  ├── repair proposals
  ├── result
  └── teardown
```

Audit events should be append-only.

Recommended event fields:

```yaml
event_id:
job_id:
timestamp:
actor_type: agent|human|system
actor_id:
action:
resource:
provider:
persona_id:
policy_decision:
risk_class:
approval_id:
evidence_refs: []
result:
error_code:
prev_hash:
event_hash:
```

Sensitive values must be redacted before persistence.

---

# 20. Suggested Database Schema

## `browser_providers`

```sql
id
name
adapter_type
status
priority
trust_level
capabilities_json
cost_model_json
config_ref
created_at
updated_at
```

## `browser_workers`

```sql
id
provider_id
name
runtime
state
capacity
labels_json
last_heartbeat_at
created_at
updated_at
```

## `browser_leases`

```sql
id
worker_id
browser_id
job_id
persona_id
state
started_at
expires_at
released_at
```

## `browser_personas`

```sql
id
owner_id
name
mode
policy_id
profile_json_encrypted
created_at
updated_at
last_used_at
```

## `browser_sessions`

```sql
id
persona_id
provider_id
snapshot_ref
state
created_at
expires_at
```

## `browser_playbooks`

```sql
id
name
description
active_version
risk_class
policy_id
created_by
created_at
updated_at
```

## `browser_playbook_versions`

```sql
id
playbook_id
version
source_json
checksum
status
created_by
created_at
approved_by
approved_at
```

## `browser_jobs`

```sql
id
requester_type
requester_id
persona_id
provider_id
worker_id
playbook_id
state
risk_class
cost_estimate
cost_actual
started_at
completed_at
error_code
```

## `browser_approvals`

```sql
id
job_id
action_type
risk_class
status
requested_at
resolved_at
resolved_by
reason
```

## `browser_audit_events`

```sql
id
job_id
seq
event_type
actor_type
actor_id
payload_redacted_json
prev_hash
event_hash
created_at
```

---

# 21. Provider Registry

Provider adapters should be discovered through the Pao-hubPro capability registry.

Example:

```yaml
browserProviders:
  localChrome:
    adapter: '@pao/browser-local'
    enabled: true
    priority: 100

  oya:
    adapter: '@pao/browser-oya'
    enabled: true
    priority: 80

  browserbase:
    adapter: '@pao/browser-browserbase'
    enabled: false
    priority: 70
```

---

# 22. Security Architecture

## Trust zones

```text
ZONE A — Pao local machine
ZONE B — Pao controlled VPS / private infrastructure
ZONE C — approved cloud browser provider
ZONE D — public internet
```

Data classification controls which zone can receive a task.

### Mandatory controls

- secrets encrypted at rest,
- secrets never returned to agent,
- browser session tokens redacted,
- provider credentials stored in central secret store,
- per-job capability tokens,
- short-lived browser leases,
- domain allow/deny list,
- outbound request policy,
- download quarantine,
- file upload policy,
- browser action rate limits,
- account lockout protection,
- destructive-action approval,
- session kill switch,
- stop-all browser fleet operation.

---

# 23. Browser-Specific Threat Model

Threats to account for:

- prompt injection from web pages,
- credential phishing pages,
- malicious downloads,
- hidden destructive UI,
- domain spoofing,
- OAuth consent manipulation,
- cross-site navigation,
- unexpected iframe actions,
- cookie/session theft,
- malicious playbook modification,
- replay of irreversible actions,
- agent hallucination around page state,
- provider compromise,
- insecure screenshots/logs.

Mitigations:

- domain-bound credentials,
- trusted-host assertions,
- action risk classification,
- browser isolation,
- content-to-agent trust labeling,
- explicit tool-call confirmation for privileged actions,
- immutable playbook versions,
- final-state assertions,
- audit evidence,
- human approval.

---

# 24. Web Prompt Injection Defense

Browser content is untrusted input.

The browser reader should label extracted web content as:

```text
UNTRUSTED_WEB_CONTENT
```

The agent must not treat page instructions as system or developer instructions.

Example policy:

```yaml
web_content_policy:
  may_inform_task: true
  may_override_system: false
  may_request_secret: false
  may_change_policy: false
  may_approve_action: false
```

---

# 25. Integration with Pao-hubPro Reviewer Council

Repair proposals and high-impact browser automation changes should enter the existing reviewer flow.

```text
Repair Agent
    │
    ▼
Playbook Diff
    │
    ▼
Reviewer Council
 ┌────┼────┐
 ▼    ▼    ▼
AI-1 AI-2 Rules
    │
    ▼
Review Result
    │
    ▼
Human approval when required
    │
    ▼
Publish playbook version
```

---

# 26. Integration with CC Switch / OmniRoute

Browser execution and model routing should remain separate layers.

```text
Task
 ├─ Model Router → choose reasoning model
 └─ Browser Router → choose browser provider
```

This allows scenarios such as:

```text
Codex
  + local Chrome

Claude
  + Oya

Local AI
  + Browserbase
```

without hard coupling.

---

# 27. Integration with Pao-hubPro Skills

Browser automation should be usable as reusable skills.

Example skills:

```text
skills/browser/research-web
skills/browser/download-asset
skills/browser/upload-stock
skills/browser/check-account-status
skills/browser/collect-evidence
skills/browser/create-draft
```

Skills should reference capability names, not provider names.

Correct:

```text
requires: browser.persistent_session
```

Avoid:

```text
requires: oya.browser
```

unless a workflow genuinely requires a provider-specific feature.

---

# 28. Adobe Stock Use Case

This phase becomes especially useful for the Adobe Stock pipeline.

Possible flow:

```text
Approved Stock Asset
       │
       ▼
Metadata Validator
       │
       ▼
Browser Playbook
       │
       ▼
Adobe Persona
       │
       ▼
Upload Draft
       │
       ▼
Fill metadata
       │
       ▼
Screenshot evidence
       │
       ▼
Human review / approval
       │
       ▼
Final submission
```

Final submission should remain approval-gated unless explicitly configured otherwise.

---

# 29. Suggested Repository Layout

```text
apps/
  browser-console/

packages/
  browser-core/
  browser-contracts/
  browser-router/
  browser-policy/
  browser-fleet/
  browser-persona/
  browser-credentials/
  browser-playbooks/
  browser-replay/
  browser-repair/
  browser-evidence/
  browser-audit/
  browser-mcp/
  browser-cdp-gateway/

  provider-local-chrome/
  provider-oya/
  provider-browserbase/
  provider-steel/
  provider-browser-use/

services/
  browser-control-plane/
  browser-worker/

migrations/
  browser/

docs/
  browser-control-plane/
```

---

# 30. API Endpoints

Suggested REST endpoints:

```text
POST   /api/browser/jobs
GET    /api/browser/jobs/:id
POST   /api/browser/jobs/:id/cancel

GET    /api/browser/providers
GET    /api/browser/workers
POST   /api/browser/workers/:id/drain

GET    /api/browser/personas
POST   /api/browser/personas
PATCH  /api/browser/personas/:id
DELETE /api/browser/personas/:id

POST   /api/browser/sessions
POST   /api/browser/sessions/:id/snapshot
POST   /api/browser/sessions/:id/restore

GET    /api/browser/playbooks
POST   /api/browser/playbooks
POST   /api/browser/playbooks/:id/run
POST   /api/browser/playbooks/:id/record
POST   /api/browser/playbooks/:id/approve-version

POST   /api/browser/takeover/:jobId/request
POST   /api/browser/takeover/:jobId/release

GET    /api/browser/jobs/:id/evidence
GET    /api/browser/jobs/:id/audit
```

---

# 31. Error Taxonomy

```text
BROWSER_PROVIDER_UNAVAILABLE
BROWSER_PROVIDER_CAPABILITY_MISSING
BROWSER_START_TIMEOUT
BROWSER_LEASE_EXPIRED
BROWSER_SESSION_RESTORE_FAILED
BROWSER_PERSONA_POLICY_DENIED
BROWSER_CREDENTIAL_DENIED
BROWSER_AUTHENTICATION_FAILED
BROWSER_TARGET_NOT_FOUND
BROWSER_NAVIGATION_UNEXPECTED
BROWSER_PLAYBOOK_DRIFT
BROWSER_PLAYBOOK_REPAIR_REQUIRED
BROWSER_HUMAN_TAKEOVER_REQUIRED
BROWSER_APPROVAL_REQUIRED
BROWSER_DOWNLOAD_BLOCKED
BROWSER_UPLOAD_BLOCKED
BROWSER_DOMAIN_DENIED
BROWSER_COST_LIMIT_EXCEEDED
BROWSER_POLICY_DENIED
```

Errors must be structured and recoverable where possible.

---

# 32. Implementation Stages

## Stage A — Contracts and Local Browser

Deliver:

- browser contracts,
- provider interface,
- local Chrome adapter,
- basic fleet manager,
- browser leases,
- MCP browser tools,
- browser task audit.

## Stage B — Persona & Session Vault

Deliver:

- encrypted personas,
- persistent cookies/storage,
- session restore,
- credential broker,
- persona policy.

## Stage C — Oya Adapter

Deliver:

- Oya SDK/API adapter,
- capability discovery,
- session lifecycle mapping,
- provider health,
- routing compatibility.

## Stage D — Playbooks

Deliver:

- recorder,
- playbook schema,
- replay executor,
- assertions,
- variables,
- secret placeholders,
- versioning.

## Stage E — Repair & Takeover

Deliver:

- drift detection,
- repair drafts,
- approval workflow,
- live human takeover,
- safe resume.

## Stage F — Multi-provider routing

Deliver:

- at least two additional provider adapters or mocked adapters,
- routing policies,
- failover,
- cost telemetry.

## Stage G — Production hardening

Deliver:

- observability,
- quotas,
- budget controls,
- stop-all,
- evidence store,
- integrity-linked audit,
- security review.

---

# 33. Acceptance Checklist

## Architecture

- [ ] Browser core contains no direct hard dependency on Oya.
- [ ] Provider adapters implement one normalized contract.
- [ ] Local browser works without any cloud provider.
- [ ] MCP clients do not need provider-specific knowledge.

## Routing

- [ ] Provider selected using capability + policy.
- [ ] Health-aware failover works.
- [ ] Sensitive jobs cannot fail over into disallowed trust zones.
- [ ] Irreversible actions are never automatically duplicated during failover.

## Persona

- [ ] Cookies/storage encrypted at rest.
- [ ] Agent cannot read raw credential values.
- [ ] Persona can be restored across browser jobs.
- [ ] Persona use is audited.

## Playbooks

- [ ] Successful run can be recorded.
- [ ] Variables are separated from fixed steps.
- [ ] Secrets are represented by opaque references.
- [ ] Replay can execute without an LLM on unchanged pages.
- [ ] Drift generates a structured failure.
- [ ] Repair creates a new version.

## Human takeover

- [ ] Browser can pause without losing state.
- [ ] Human can take control securely.
- [ ] Agent cannot type concurrently during exclusive takeover.
- [ ] Handoff/resume is audited.

## Governance

- [ ] Risk classes enforced.
- [ ] Approval gates are configurable.
- [ ] Destructive actions require explicit approval by default.
- [ ] Domain allow/deny policy supported.
- [ ] Browser kill switch supported.

## Observability

- [ ] Provider metrics visible.
- [ ] Task duration visible.
- [ ] Provider cost visible.
- [ ] Replay success/failure visible.
- [ ] Human takeover counts visible.

## License

- [ ] Third-party licenses recorded.
- [ ] Oya Sustainable Use code is not copied into unrestricted Pao-hubPro core.
- [ ] MIT SDK/CLI usage is tracked separately.
- [ ] Commercial deployment has a license review checklist.

---

# 34. Definition of Done

This phase is complete when an agent can:

1. request a browser capability through Pao-hubPro,
2. receive a browser without knowing the underlying provider,
3. use a persistent persona safely,
4. complete an authenticated browser task,
5. record the successful task as a playbook,
6. replay the playbook without a model call when the page remains compatible,
7. detect workflow drift,
8. create a repair proposal,
9. pause for human intervention when required,
10. resume from the same session,
11. fail over providers only when safe,
12. produce complete audit/evidence for the job.

---

# 35. Recommended First Production Workflow

Use one controlled workflow to validate the architecture before broad rollout.

Recommended:

```text
Authenticated research/download workflow
```

Why:

- requires persona/session persistence,
- exercises download policy,
- exercises browser routing,
- can be deterministic,
- does not require immediate irreversible external actions,
- allows safe testing of human takeover and repair.

After this succeeds, move to:

```text
Adobe Stock upload draft
```

and keep final submission approval-gated.

---

# 36. Recommended Build Order

```text
1. Browser Contracts
2. Local Chrome Adapter
3. MCP Browser Gateway
4. Fleet Lease Manager
5. Persona Vault
6. Credential Broker
7. Oya Provider Adapter
8. Playbook Recorder
9. Deterministic Replay
10. Drift Detection
11. Repair Draft Engine
12. Human Takeover
13. Policy + Approval Engine
14. Evidence/Audit
15. Multi-provider Failover
16. Cost/Usage Observatory
17. Production Security Review
```

This order minimizes provider lock-in and lets Pao-hubPro retain a working local browser path even if every external provider is disabled.

---

# 37. One-Shot Codex Goal

```text
/goal Implement the Pao-hubPro Universal AI Browser Control Plane as a provider-neutral, local-first, policy-governed browser execution subsystem. Create browser contracts and a provider adapter interface; implement a local Chrome/Chromium adapter first and an Oya Browser adapter second; add a Browser Provider Registry, capability discovery, health-aware and cost-aware routing, safe provider failover, browser worker fleet leasing, persistent encrypted Persona & Session Vault, opaque credential brokerage, MCP browser tools, a controlled CDP gateway for Playwright/Puppeteer, Record-to-Playbook capture, deterministic replay without an LLM when possible, drift detection, versioned agent-assisted workflow repair, secure exclusive Human Takeover, configurable risk classes and approval gates, domain/egress policies, evidence capture, append-only integrity-linked audit logs, cost/usage telemetry, quotas, kill switch, and structured error handling. Keep Oya and every cloud browser as replaceable adapters; do not couple Pao-hubPro core code to any provider. Preserve strict third-party license boundaries: treat Oya server/browser/control-plane implementation as source-available under its stated Sustainable Use terms and do not copy restricted implementation code into the commercial Pao-hubPro core; use public interfaces and independently implemented contracts. Build migrations, tests, API/MCP contracts, provider mocks, security checks, documentation, and acceptance tests. Definition of Done: an agent can request an authenticated browser through Pao-hubPro without knowing the provider, reuse a secure persistent persona, execute and record a successful workflow, replay it deterministically, detect page drift, generate a repair draft, pause for a human-sensitive step, resume safely, fail over providers only when policy allows, and produce full auditable evidence for the job.
```

---

# 38. Final Architecture Decision

Pao-hubPro should **not become an Oya-dependent application**.

The correct architecture is:

```text
Pao-hubPro owns:

Browser Contract
Browser Router
Persona Vault
Credential Broker
Fleet Manager
Playbook Engine
Replay Engine
Repair Engine
Human Approval
Audit / Evidence
MCP Gateway
Policy Engine

Providers implement adapters:

Local Chrome
Pao Browser Worker
Oya Browser
Browserbase
Steel
Browser Use
Future Providers
```

This gives Pao-hubPro a durable browser automation substrate that can survive provider changes, pricing changes, outages, architectural changes, and future AI/browser technology shifts.

---

## Source References

- Oya Browser repository: https://github.com/OyadotAI/oya-browser
- Oya Browser architecture: https://github.com/OyadotAI/oya-browser/blob/main/ARCHITECTURE.md
- Oya Browser license: https://github.com/OyadotAI/oya-browser/blob/main/LICENSE.md
- Oya Browser self-hosting documentation: https://github.com/OyadotAI/oya-browser/blob/main/docs/self-hosting.md
- Oya Browser provider-control rationale: https://github.com/OyadotAI/oya-browser/blob/main/docs/why-oya.md

