# Phase 20.74 — Pao-hubPro × MCPProxy

## Federated MCP Tool Gateway, Context-Efficient Dynamic Tool Discovery, Intent-Aware Execution, Security Quarantine, Audit & Policy-Governed MCP Control Plane

> **Document type:** Production-Oriented Implementation Blueprint
> **Phase:** 20.74 (Proposed / Implementation-Ready)
> **Project:** Pao-hubPro
> **Source of Truth:** `Phase 20.74 — Pao-hubPro × MCPProxy.md` (reference snapshot 2026-09-16), processed under `PAO-HUBPRO_MASTER_PHASE_REQUEST.md`
> **Primary upstream:** `smart-mcp-proxy/mcpproxy-go` — **verified release at snapshot:** `v0.66.1` (2026-09-13) · **License:** MIT
> **Strategic role:** MCP Tool Gateway + Enforcement Plane **beneath** the Pao-hubPro Policy / Orchestration Plane
> **Filename/content consistency:** Filename and document header agree on Phase 20.74; no collision (sequential after Herdr 20.73).

> **Core operating principle:**
> **DISCOVER → DESCRIBE → AUTHORIZE → PREFLIGHT → EXECUTE → AUDIT**
> — แทน `Load every tool schema → let the model choose → execute directly`

> **Architectural caveat:** Pao-hubPro **must not treat MCPProxy as the only trust boundary** — upstream roadmap ยังมีงาน security hardening (agent-token scope enforcement, MCP protocol revision migration) จึงใช้ layered controls: `Pao Policy Engine + Human Approval Gate + MCPProxy enforcement + Upstream tool isolation + OS/container permissions` — **No single component is trusted to protect the entire system by itself.**

---

## 1. Executive Summary

Phase 20.74 introduces **MCPProxy** as the federated MCP gateway for Pao-hubPro. The goal is **not** to replace Pao-hubPro with MCPProxy — it is to put MCPProxy in the correct architectural position: a dedicated tool-access gateway between AI agents and the growing fleet of MCP servers, local tools, remote services, automation runtimes, coding agents, browser agents, infrastructure tools, media-production tools, and external APIs.

```text
ChatGPT / Codex / Claude / Local AI / Specialized Agents
                         ▼
              Pao-hubPro Agent Plane
      planning / orchestration / agent identity
                         ▼
              Pao Policy Control Plane
   authorization / risk policy / approval / budgets
                         ▼
             Phase 20.74 MCP Gateway (MCPProxy)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  Local MCP Servers  Remote MCP       Service MCP
  Files / Shell      GitHub / SaaS    ComfyUI / n8n
  Coding / Browser   Cloud APIs        Runpod / etc.
```

**Phase mission:** > Provide one governed tool-access plane through which agents can discover, inspect, authorize, preflight, invoke, and audit capabilities without loading the full global tool surface into every model context. The system must remain usable if MCPProxy is later replaced, upgraded, or supplemented — **Pao-hubPro owns the abstractions; MCPProxy is an implementation adapter.**

---

## 2. Problem Statement

Pao-hubPro กำลังเชื่อม capability providers จำนวนมาก: local filesystem tools; safe command execution; coding tools; Git/GitHub; browser automation; desktop automation; remote servers; ComfyUI; Runpod; media-generation pipelines; Adobe Stock workflows; n8n; API gateways; credential gateways; observability tools; documentation/repository intelligence; multi-agent coordination; local AI models; cloud AI providers; future Skills/MCP adapters

As the number of MCP servers grows, **four problems become critical:**

1. **Tool-schema explosion** — ถ้าทุก agent ได้ทุก tool schema context ถูกใช้ก่อนทำงานจริง:

```text
GitHub MCP 80 · Google services 70 · Browser 40 · Local workspace 35
ComfyUI 60 · Runpod 20 · Automation/n8n 50 · Repository 40
Stock pipeline 30 · Security 35 · Other MCP servers 200+  =  660+ tools
```

   MCPProxy แก้ด้วย dynamic discovery: search ก่อน แล้วค่อยได้ full definitions เมื่อจำเป็น

2. **Direct agent-to-tool trust is unsafe** — LLM ไม่ควรเป็น sole security decision maker (misunderstand instruction, influenced by untrusted content, wrong tool, misclassify destructive op) ⇒ ต้องมี enforcement layer **external to the model**

3. **MCP server trust changes over time** — tool description/schema เปลี่ยนระหว่างเวอร์ชันได้; previously safe server เพิ่ม/แก้ tool ได้ ⇒ quarantine + approval เป็น standard onboarding workflow

4. **Multi-agent systems need centralized auditability** — เมื่อ Codex/Claude/ChatGPT/local models/automation workers/background jobs ทำงานผ่าน tools ต้องตอบได้: Which agent executed? Which server/tool? What risk class? Was approval required? Who approved? What workflow caused it? What happened before/after? Was a secret involved? Was the tool definition changed since approval?

---

## 3. Goals

1. Provider-neutral **CapabilityGateway** interface + MCPProxy adapter behind it
2. **Canonical capability identity** (`pao://<domain>/<provider>/<capability>`) independent of upstream naming
3. **Context-efficient dynamic tool discovery** — search → filter → describe selected only (ไม่โหลด schema catalog ทั้งหมด)
4. **Risk taxonomy** 7 คลาส (READ/WRITE/EXECUTE/DESTRUCTIVE/EXTERNAL/SECRET/ADMIN) พร้อม Pao policy overrides
5. **Intent-aware execution** — envelope ทุก call ผูก agent/workflow/risk/approval/digest
6. **Security quarantine** — new servers default QUARANTINED; schema-change → trust invalidated
7. **Security scanner abstraction** — normalized findings; PASS/WARN/FAIL/UNKNOWN
8. **Secrets/OAuth** — references not values; Secret Broker; OAuth state surfaced
9. **Required-tools preflight** — scheduled/long jobs verify capabilities before LLM-heavy execution
10. **Pao-level audit** per governed call (domain context MCPProxy ไม่รู้) + correlation IDs
11. **Agent capability profiles** — visibility-aware discovery; 6 profiles
12. Dashboard **MCP Control Plane** + metrics + alerts + config hot-reload lifecycle with rollback

---

## 4. Non-Goals

This phase does **not**:

- replace the Pao-hubPro agent orchestrator; replace the Pao Policy Engine
- give autonomous agents unrestricted shell access
- automatically approve newly discovered MCP servers; automatically trust changed tool schemas
- place secrets directly in source-controlled configuration
- expose MCPProxy management APIs to the public Internet by default
- make destructive operations autonomous by default
- remove existing sandboxing or approval controls
- fork MCPProxy unless a concrete upstream limitation requires it
- tightly couple Pao-hubPro domain logic to MCPProxy-specific APIs

---

## 5. Why This Phase Exists — Upstream Capability Snapshot

### Upstream primitives (verified at snapshot v0.66.1 — re-check current stable before implementation)

Single core binary; embedded Web UI; Windows/macOS/Linux; federation of multiple upstream MCP servers; transports `stdio/http/sse/streamable-http` + auto-detection; local process launching; **dynamic tool discovery via `retrieve_tools`**; **BM25-based tool retrieval**; **on-demand full definition via `describe_tool`**; **read/write/destructive call variants**; explicit execution intent; quarantine and approval controls; hash-based tool-change detection; security-scanner integration; sensitive-data controls; OAuth support; keyring/secret integrations; activity/audit logs; **required-tool preflight checks**; config hot reload; optional TLS; agent-token features.

**Sources:** repository https://github.com/smart-mcp-proxy/mcpproxy-go · README · docs/configuration.md · ROADMAP.md · CHANGELOG.md · releases/latest — ณ design snapshot 2026-09-16 stable ล่าสุดที่ review คือ `v0.66.1` (2026-09-13) — **always re-check current stable version and documentation before implementation.**

### Phase relationship

```text
Phase 20.73 (Herdr) — controls WHO runs and WHERE (Agent Runtime)
Phase 20.74 (MCPProxy) — controls WHAT those agents may do (Tool Runtime)
→ Future phases: cross-machine capability federation; policy-aware autonomous
  workflows; zero-trust agent/tool identities; capability learning/routing
```

---

## 6. Relationship to Pao-hubPro

### Layer mapping (Pao-hubPro core layers)

| Layer | Role in this phase |
|---|---|
| 05 MCP Gateway | **Primary owner** — federated gateway + enforcement plane |
| 06 Capability Registry | Canonical capability IDs + aliases + schema hashes |
| 07 Policy Engine | Risk classification + overrides + visibility filter |
| 08 Approval Engine | DESTRUCTIVE/EXTERNAL/ADMIN gates |
| 14 Secrets & Credential Layer | Secret Broker; OAuth state; references not values |
| 15 Event / Queue Layer | Audit events; correlation propagation |
| 16 Observability Layer | ~24 metrics; alerts |
| 17 Audit Layer | Governed-call events with domain context |
| 19 Web Dashboard | MCP Control Plane (8 pages) |

### Integration with existing phases

- **Phase 20.73 (Herdr):** complementary — 20.73 runtime (WHO/WHERE/recover/coordinate) + 20.74 tool control (WHAT visible/executable/approval/audited): `Persistent Agent Identity → Capability Profile → Tool Discovery → Policy Gate → MCPProxy → Tool`
- **Context Mode (20.65 collision-pending):** complementary — Context Mode ลด conversation/tool-output pressure; 20.74 ลด up-front tool-schema pressure. Combined: `User goal → Task decomposition → Capability search (short) → Policy filter → Describe candidates only → Execute → Summarize/compress tool result → Return useful context`
- **Credential Gateway (20.72):** Credential Gateway owns provider identity/rotation policy/secret metadata; MCPProxy consumes execution-time credential references/OAuth state; **Agent gets capability access, not secret material**
- **Context Intelligence:** retrieval telemetry (query; returned candidates; selected candidate; selection rank; execution success; workflow type) improves aliases/descriptions/canonical mappings/ranking/budget decisions — **do not automatically train privileged behavior from raw sensitive logs**
- **Reviewer Council:** high-risk policy/tool changes → scanner results + schema diff → Council (ChatGPT/local AI/second model) → structured advisory report → human decision — **advisory only; must NOT auto-approve high-risk capabilities without policy authorization**

### Ownership boundaries

**Pao-hubPro owns:** CapabilityGateway interface; canonical capability model; policy/approval/credential/audit authority; visibility filtering; budget authority. **MCPProxy owns:** federation mechanics; BM25 retrieval; call variants; quarantine primitives; its config lifecycle. **Upstream MCP servers own:** their tools (untrusted boundary — T0 until qualified).

---

## 7. Upstream / External Project

### Upstream risk assessment

- **License:** MIT — suitable for integration with attribution
- **Maintenance:** fast-moving (v0.66.x line; roadmap includes security hardening + protocol migration) — **pin version in production; compatibility record per release**
- **API stability:** adapter boundary absorbs upstream churn (Pao owns the interface)
- **Dependency risk:** medium — single binary, local deployment; gateway down ⇒ fail closed (Section 22)
- **Security surface:** management APIs; upstream servers untrusted; agent tokens still hardening upstream — layered controls mandatory (header caveat)
- **Upgrade strategy:** 9-step lifecycle (Section 33); compatibility record `mcpproxy: {validated_version: 0.66.1, validated_at: 2026-09-16, protocol_notes: "verify before deployment", test_suite_commit: "..."}` — **update to actual latest tested version during implementation**

### Upstream watch items (10)

agent-token scope hardening; MCP protocol revision upgrades; tool-discovery behavior; direct/deferred schema modes; quarantine semantics; activity/audit behavior; OAuth behavior; scanner integration; config hot reload; breaking changes in API/CLI. **Any upstream security claim must be verified against the version Pao-hubPro actually deploys.**

---

## 8. Current-State Assumptions

- **[Needs Verification] Inspect first:** complete repository structure; current frontend/backend/database/config/auth/audit/agent/policy/workflow/tool abstractions; **all current MCP/tool execution code paths**; env/config conventions; tests/CI commands; **current upstream MCPProxy README/config docs/security docs/changelog/latest stable release before implementing any API/CLI-specific behavior**; record the MCPProxy version actually validated; reuse existing architecture where sensible — do not create duplicate systems
- **[Assumption] Deployment mode:** Mode A (local developer, 127.0.0.1) for initial implementation; Mode B (Pao host, private loopback) as production baseline (Section 23)
- **[Assumption] Approval infrastructure:** reuse existing Pao approval engine if present; otherwise minimal durable approval requests
- **[Assumption] Config hot reload:** use only where verified supported by the deployed MCPProxy version

---

## 9. Target Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                       Pao-hubPro                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Agent / Orchestration Plane                             │  │
│  │ ChatGPT · Codex · Claude · Local AI · Herdr · Workers   │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│                              ▼                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Pao Capability Broker                                   │  │
│  │ capability search · canonical tool IDs                  │  │
│  │ provider abstraction · context budget                   │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│                              ▼                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Pao Policy / Approval Plane                             │  │
│  │ identity/RBAC/ABAC · risk classifier                    │  │
│  │ READ/WRITE/EXECUTE/DESTRUCTIVE/EXTERNAL                 │  │
│  │ approval gates · secret policy · budgets/rate limits    │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│                              ▼                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ MCP Gateway Adapter (MCPProxy)                          │  │
│  │ retrieve_tools · describe_tool · call_tool_read         │  │
│  │ call_tool_write · call_tool_destructive · quarantine    │  │
│  │ sensitive-data checks · activity log · preflight        │  │
│  └──────┬────────────────────┬─────────────────────┬───────┘  │
└─────────┼────────────────────┼─────────────────────┼──────────┘
          ▼                    ▼                     ▼
   Local MCP Servers       Remote MCP            Service MCP
   filesystem/shell-safe   GitHub/SaaS/APIs      ComfyUI/Runpod
   coding/browser          OAuth services        n8n/pipelines
```

---

## 10. Architecture Diagram

```mermaid
flowchart TB
    subgraph PP[Pao Control Plane]
        AG[Agent Plane<br/>Codex/Claude/Local/Herdr/Workers]
        CB[Capability Broker<br/>search · canonical IDs · budget]
        POL[Pao Policy / Approval Plane<br/>risk classifier · visibility · gates]
        AUD[(Pao Audit<br/>domain context)]
        SB[Secret Broker]
        CRED[Credential Gateway<br/>20.72]
    end

    subgraph GW[Gateway Adapter Layer]
        CGI[CapabilityGateway interface<br/>Pao-owned contract]
        AD[MCPProxyGatewayAdapter]
    end

    MP[MCPProxy v0.66.1 pinned<br/>federation · BM25 discovery · quarantine]
    RT[retrieve_tools] --> DT[describe_tool]
    DT --> CT[call_tool_read / write / destructive]
    PF[Required-tools preflight]
    SCAN[ScannerProvider<br/>Semgrep/Trivy/custom]

    AG --> CB --> POL
    POL --> CGI --> AD --> MP
    MP --> RT & DT & CT & PF
    MP --> QUA[Quarantine + schema hashes] --> SCAN --> REVIEW[Human review]
    CB <--> CM[Context Mode 20.65<br/>complementary]
    SB -.->|secret refs at execution boundary| AD
    CRED -.->|OAuth state / rotation policy| AD
    POL --> AUD
    AD --> AUD
```

---

## 11. Core Components

| # | Component | Purpose |
|---|---|---|
| 1 | `CapabilityGateway` interface | Pao-owned provider-neutral contract (search/describe/preflight/execute/audit) |
| 2 | `MCPProxyGatewayAdapter` | The only surface touching MCPProxy APIs; error normalization |
| 3 | Canonical Capability Registry | `pao://` IDs; alias mapping; schema hashes; versioned |
| 4 | Dynamic Discovery | retrieve_tools (BM25) → visibility filter → describe selected only |
| 5 | Risk Classifier | 7 classes + Pao overrides over upstream annotations |
| 6 | Intent-Aware Execution | Governed envelope; 17-step deterministic evaluation |
| 7 | Quarantine Workflow | Onboarding + schema-change flows; trust states (10) |
| 8 | ScannerProvider | Normalized findings; PASS/WARN/FAIL/UNKNOWN |
| 9 | Preflight Service | Workflow capability manifests; READY/TRANSIENT/BLOCKED/UNKNOWN_TOOL |
| 10 | Secret Broker + OAuth state | References not values; connection states surfaced |
| 11 | Approval Gate | APPROVE ONCE / FOR WORKFLOW / DENY / DENY+BLOCK TOOL / EDIT SCOPE |
| 12 | Audit + Correlation | Domain-context events; RAW/REDACTED/MODEL-SAFE/USER-SAFE |
| 13 | Dashboard MCP Control Plane | 8 pages |

---

## 12. Component Responsibilities

### 12.1 Gateway-neutral interface (Pao owns the contract)

```ts
interface CapabilityGateway {
  searchTools(query: ToolSearchQuery): Promise<ToolSearchResult[]>;
  describeTools(ids: string[]): Promise<ToolDescriptor[]>;
  preflight(ids: string[], context: ExecutionContext): Promise<PreflightResult>;
  execute(request: GovernedToolCall): Promise<GovernedToolResult>;
  getAuditTrail(filter: AuditFilter): Promise<AuditEvent[]>;
}
```

Implement `MCPProxyGatewayAdapter`. **Do not scatter direct MCPProxy REST/CLI calls through the application:**

```text
Correct:   Agent → CapabilityBroker → PolicyEngine → CapabilityGateway → MCPProxyGatewayAdapter
Incorrect: Agent code → curl MCPProxy directly; Dashboard → different direct API;
           Scheduler → direct CLI; Worker → custom MCP connection
```

The correct architecture ensures future gateway replacement is possible without redesigning the entire system.

### 12.2 Canonical capability identity

```text
pao://<domain>/<provider>/<capability>
```

Examples: `pao://code/github/create_issue · pao://workspace/files/read_file · pao://workspace/files/write_file · pao://automation/n8n/run_workflow · pao://media/comfyui/queue_prompt · pao://infra/runpod/start_pod`

Mapping:

```yaml
canonical_id: pao://code/github/create_issue
provider: mcpproxy
server: github
tool: create_issue
upstream_id: github:create_issue
risk_class: WRITE
```

Benefits: stable policies even if upstream names change; simpler audit trails; vendor-neutral agent prompts; easier migration; centralized aliasing; safer deprecation handling.

### 12.3 Risk taxonomy (7 classes — richer than upstream variants)

| Class | Examples | Default |
|---|---|---|
| **READ** | read repo metadata; inspect file; list directory; read logs; query status | AUTO_ALLOWED when scoped correctly |
| **WRITE** | create file; edit code; create issue; update metadata | ALLOW only inside approved workspace/scope |
| **EXECUTE** | run build; invoke controlled command; execute workflow; start rendering job | POLICY CHECK + sandbox/allowlist |
| **DESTRUCTIVE** | delete; overwrite irreversibly; terminate production workload; remove cloud resource; force push | **HUMAN APPROVAL REQUIRED** |
| **EXTERNAL** | send email; publish social content; upload production asset; create public issue; third-party API with side effects | USER-SCOPE / POLICY-SCOPE APPROVAL |
| **SECRET** | access credential material; request OAuth token; rotate key; read protected config | **NEVER expose raw secret to model if avoidable** |
| **ADMIN** | modify gateway config; approve quarantined server; alter security policy; add privileged agent token | **HUMAN / ADMIN ONLY** |

**Mapping to MCPProxy invocation:**

| Pao class | MCPProxy path | Default approval |
|---|---|---|
| READ | `call_tool_read` | automatic if in scope |
| WRITE | `call_tool_write` | policy dependent |
| EXECUTE | write or destructive based on effect | restricted |
| DESTRUCTIVE | `call_tool_destructive` | human approval |
| EXTERNAL | effect-dependent | explicit policy |
| SECRET | specialized broker | never direct where avoidable |
| ADMIN | management plane only | human/admin |

**Do not assume upstream annotations are perfect — Pao must be able to override/tighten classifications:**

```yaml
policy_override:
  upstream_tool: github:delete_repository
  pao_risk: DESTRUCTIVE
  approval: ALWAYS
```

### 12.4 Tool discovery (10-step default interaction)

Agents should not assume a tool name:

```text
1. Ask Capability Broker for a capability
2. Broker queries MCPProxy retrieve_tools
3. Rank candidate tools
4. Apply visibility policy
5. Return minimal descriptors
6. Agent selects candidate
7. Fetch full schema with describe_tool
8. Policy evaluation
9. Preflight if required
10. Execute
```

Conceptual request `{"query": "create github issue", "limit": 5}` — **Do not place all schemas in model context; only selected definitions are expanded.**

### 12.5 Intent-aware execution

Every tool call carries a Pao execution envelope:

```json
{
  "request_id": "req_01J...", "workflow_id": "wf_01J...",
  "agent_id": "codex-worker-03",
  "canonical_tool_id": "pao://code/github/create_issue",
  "operation_type": "WRITE",
  "reason": "Create issue requested by the user",
  "target_scope": "repo:owner/project",
  "approval_id": null, "context_hash": "sha256:...",
  "arguments": {"title": "Bug report"}
}
```

**Before execution (9):** validate agent identity → session/workflow → capability visibility → classify risk → target scope → approval requirement → secret policy → budget/rate limits → MCPProxy call variant.

**Policy evaluation order (17 steps, deterministic — fail closed if any required component unavailable):**

```text
1. Authenticate agent          10. Validate secret rules
2. Resolve workflow            11. Validate cost/rate budget
3. Resolve canonical capability 12. Determine approval requirement
4. Verify capability visible   13. Run preflight if required
5. Load current tool descriptor 14. Execute via correct MCPProxy intent path
6. Verify descriptor hash/trust 15. Record audit
7. Classify operation          16. Redact response
8. Apply Pao policy override   17. Return to agent
9. Validate resource/target scope
```

### 12.6 Security quarantine workflow

All newly registered MCP servers default to **`QUARANTINED`** unless a trusted administrative bootstrap explicitly says otherwise.

**Onboarding flow (10):** register candidate MCP → start isolated/restricted → enumerate tools → capture schema hashes → run available security scanners → evaluate tool descriptions → evaluate commands/URLs/env dependencies → generate risk report → **human review** → approve server/selected tools → publish capabilities to agents

**Schema-change flow (7):** previously approved tool → description/schema changes → hash mismatch → **remove from trusted executable surface** → quarantine/pending review → diff old/new schema → re-run review → re-approve. Dashboard shows the diff.

**Schema drift detection:** store `server_id, tool_id, schema_hash, description_hash, approved_hash, first_seen, last_seen, approval_state`; `current_hash != approved_hash` ⇒ **TRUST INVALIDATED until reviewed**; dashboard semantic diff: added parameters; removed parameters; new required fields; description change; annotation change; risk classification change.

**Scanner integration:** `ScannerProvider` abstraction — MCPProxy native scanner · Semgrep · Trivy · Snyk (optional) · future internal · custom policy scanner. Normalized finding:

```json
{"scanner": "semgrep", "severity": "high", "category": "command-injection",
 "artifact": "server-package", "location": "...", "evidence": "...",
 "policy_effect": "BLOCK"}
```

**Scanner results must never automatically turn a blocked item into trusted:** `PASS → eligible for approval · WARN → manual review · FAIL → blocked · UNKNOWN → manual review`

### 12.7 Secrets + OAuth

**Secrets:** referenced, not copied into prompts/logs. Forbidden: `{"Authorization": "Bearer plaintext-token-here"}`. Preferred: `secret://github/pao-hubpro/token` or upstream-supported keyring reference. **Secret Broker responsibilities (7):** resolve secret only at execution boundary; redact logs; prevent model-visible echo; attach least-privilege credential; rotate independently from agent configuration; optionally issue short-lived credentials; deny cross-workspace secret access. **The model should usually know `credential_available = true` — not `credential_value = ...`**

**OAuth (remote MCP servers):** `User/Admin → Pao Credential UI → OAuth authorization → MCPProxy OAuth handling → secure token storage → agent gets capability, not token`. Surfaced states: `CONNECTED · EXPIRED · REAUTH_REQUIRED · SCOPE_CHANGED · ERROR`. **Preflight must detect expired/invalid authentication before an expensive agent workflow starts.**

### 12.8 Required-tools preflight (highest-value autonomous-workflow feature)

Before starting a long job, determine whether all required capabilities are operational. Example (Adobe Stock pipeline): required `files:read, image-review:inspect, metadata:generate, export:write, uploader:submit`.

```text
READY    → start job
TRANSIENT → retry later / retry bounded times
BLOCKED  → require approval / auth / operator
UNKNOWN TOOL → fail configuration immediately
```

**Pao integration:** `preflightWorkflow(workflowManifest)`:

```yaml
workflow: adobe-stock-export
required_capabilities:
  - pao://workspace/files/read_file
  - pao://stock/reviewer/review_asset
  - pao://stock/export/write_package
optional_capabilities:
  - pao://media/upscale/enhance
```

**The scheduler should not waste LLM tokens planning a workflow that cannot execute.**

### 12.9 Audit + correlation IDs

Every governed call produces a **Pao audit event** even if MCPProxy logs it — because Pao needs domain context MCPProxy cannot know: business workflow; user request; agent identity; approval identity; risk decision; policy version; task objective; budget; parent/child agent relationships.

```json
{
  "event_id": "evt_01J...", "timestamp": "2026-09-16T...Z",
  "request_id": "req_...", "workflow_id": "wf_...", "session_id": "sess_...",
  "agent_id": "codex-worker-03", "parent_agent_id": "orchestrator-01",
  "user_id": "local-owner",
  "canonical_tool_id": "pao://code/github/create_issue",
  "upstream_server": "github", "upstream_tool": "create_issue",
  "risk_class": "WRITE", "policy_decision": "ALLOW",
  "policy_version": "2026-09-16.1", "approval_id": null,
  "argument_digest": "sha256:...", "result_digest": "sha256:...",
  "mcpproxy_request_id": "...", "duration_ms": 412, "status": "SUCCESS"
}
```

**Redaction levels:** `RAW (restricted) · REDACTED · MODEL-SAFE · USER-SAFE` — **never store plaintext secrets in normal audit rows.** **Correlation IDs** standardized (`trace_id, workflow_id, request_id, agent_id, session_id, approval_id`) propagated through `Pao-hubPro → MCP Gateway Adapter → MCPProxy → upstream server where supported`; dashboard drill-down: open workflow → agent steps → tool calls → policy decisions → approval events → errors.

### 12.10 Agent capability profiles + visibility

**Do not connect all agents using one unrestricted identity.** Profiles:

| Profile | Capabilities |
|---|---|
| **Planner** | READ metadata; SEARCH tools; DESCRIBE tools; **NO direct destructive execution** |
| **Coding Agent** | repo read; workspace read/write; build/test execute; restricted git write; no infrastructure admin |
| **Stock Production Agent** | asset read/write; ComfyUI queue; metadata generation; export; no shell outside workspace |
| **Infrastructure Agent** | status read; logs read; approved operational execute; high-risk actions require human approval |
| **Reviewer Agent** | mostly READ; may produce review artifacts; no direct production mutation |
| **Admin Agent / Human Console** | server registration; quarantine approval; policy administration; credential administration |

**Capability visibility:** tool discovery itself is permission-aware — `SEARCH RESULTS = global tool index ∩ agent visibility scope ∩ workflow scope`; the policy layer filters **both** discovery metadata and execution rights; **do not rely solely on execution-time denial.**

**Multi-agent coordination rules:** different agents must not share unrestricted tool state merely because they share a workflow — use `agent identity + workflow scope + capability profile`. A planner can discover a destructive tool without being able to execute it only if policy explicitly allows that visibility; **a reviewer should not inherit a coder's write permission; a child agent should not automatically inherit all parent privileges — privilege inheritance must be explicit and bounded.**

### 12.11 MCP server registry + hot reload

Registry fields: `id, name, provider, transport, endpoint_ref, enabled, trust_state, owner, risk_tier, network_zone, credential_profile, allowed_agents, allowed_workflows, quarantine_policy, last_schema_scan`. **States (10):** `DISCOVERED · REGISTERED · QUARANTINED · SCANNING · REVIEW_REQUIRED · APPROVED · DEGRADED · AUTH_REQUIRED · DISABLED · REVOKED`

**Hot reload lifecycle (9 — use carefully):** dashboard edit → validate draft → write staging config → policy lint → **backup active config** → atomic replace → MCPProxy hot reload → health check → commit revision; health check fails ⇒ **rollback previous config**; maintain versioned config snapshots.

**Deployment modes:** A — Local developer (127.0.0.1, single machine; recommended initial) · B — Pao host (backend ↔ private loopback ↔ MCPProxy ↔ servers; recommended production baseline) · C — Per-machine gateway (central control plane + per-machine proxies) · D — Federated gateways (future: dev/production/GPU-media/remote-worker gateways — **policies must prevent accidental cross-zone calls**)

### 12.12 Network policy + sandboxing + failure model

**Network:** default `MCPProxy listen = loopback/private only; public Internet = denied`; remote access requires VPN/private overlay/reverse proxy + TLS + authentication + source restrictions + rate limiting + audit — **never expose the management surface directly to the Internet only because it is convenient.**

**Sandboxing:** a gateway controls access but **does not replace OS isolation** — for untrusted/high-risk local MCP servers: `MCPProxy quarantine + container/process sandbox + filesystem restrictions + network restrictions + resource limits`. Suggested zones: `Zone 0 trusted core · Zone 1 trusted local tools · Zone 2 isolated third-party MCP · Zone 3 network-only remote MCP · Zone 4 high-risk experimental`

**Failure model (6 — never silently bypass):**

| Failure | Code | Response |
|---|---|---|
| Gateway unavailable | `GATEWAY_DOWN` | do not bypass gateway; fail safely; show operator status |
| Tool unavailable | `TOOL_UNAVAILABLE` | search equivalent approved tool; **never silently switch to a more privileged tool** |
| Quarantined | `TOOL_QUARANTINED` | stop; generate review request |
| Authentication expired | `AUTH_REQUIRED` | request reauthentication; don't repeatedly burn agent tokens retrying |
| Policy denied | `POLICY_DENIED` | concise reason; don't prompt-inject the model into bypassing policy |
| Approval required | `APPROVAL_REQUIRED` | create approval request; preserve pending action envelope; do not execute until approved |

**Retry policy:** retry only when classified transient — `network timeout/server starting → bounded retry; rate limit → backoff; OAuth required → no automatic retry loop; quarantine → no retry; policy denied → no retry; approval required → wait for approval state; unknown tool → configuration failure`. All retries use the same workflow/trace identifiers. **Budget governance:** `max tool calls/workflow · max destructive calls/workflow · max remote API spend · max GPU job duration · max agent retries` — exhaustion ⇒ `BUDGET_EXCEEDED`, not uncontrolled retry loops.

**Caching rules:** safe — tool search result metadata; immutable descriptors keyed by schema hash; server health (short TTL). Do not blindly cache — authorization decisions across policy revisions; secret-bearing responses; destructive operation results; mutable tool definitions without schema hash. Cache key includes relevant scope where permission affects visibility.

**Config example (Pao-owned):**

```yaml
mcp_gateway:
  provider: mcpproxy
  endpoint: http://127.0.0.1:8080
  tls: false
  fail_closed: true
  discovery: {default_limit: 5, max_limit: 10, describe_batch_limit: 5}
  security: {quarantine_required: true, block_unknown_servers: true,
             block_unclassified_tools: true, sensitive_data_redaction: true}
  approvals: {destructive: always, admin: always, external: policy, write: policy}
  audit: {enabled: true, redact_secrets: true, retain_days: 90}
  preflight: {required_for_scheduled_jobs: true, required_for_long_running_jobs: true}
```

MCPProxy-specific configuration lives in the adapter/infra layer, **not** the domain model. MCPProxy upstream config example (illustrative; generate from verified current docs): `{"listen": "127.0.0.1:8080", "quarantine_enabled": true, "instructions": "Use retrieve_tools to discover tools before assuming a capability is unavailable.", "mcpServers": [...]}` — rules: no committed secrets; loopback default; quarantine enabled; least privilege; config backup; validate before reload.

---

## 13. Data Flow

**Discovery flow:** user goal → task decomposition → capability search (short results) → policy filter → describe only candidates → execute → summarize/compress tool result → return only useful context. **Execution flow:** 17-step policy order (Section 12.5) → MCPProxy variant → audit → redacted response. **Quarantine flow:** onboarding/schema-change flows (Section 12.6) → scanner → human review → publish.

---

## 14. Control Flow

**Decisions:** `SUCCESS · DENIED · APPROVAL_REQUIRED · QUARANTINED · AUTH_REQUIRED · UNAVAILABLE · INVALID_ARGUMENTS · POLICY_ERROR · UPSTREAM_ERROR` — fail closed if any required policy component unavailable.

### Risk classification (R0–R4 mapping from the 7-class taxonomy)

| Source class | R-level | Default |
|---|---|---|
| READ | R0 | auto-allow when scoped |
| WRITE | R1/R2 | allow inside approved workspace/scope (policy-dependent) |
| EXECUTE | R2/R3 | policy check + sandbox/allowlist |
| DESTRUCTIVE | R3 | **human approval required** |
| EXTERNAL | R3 | user-scope/policy-scope approval |
| SECRET | R3/R4 | specialized broker; never direct where avoidable |
| ADMIN | R4 | **human/admin only** |

### Security invariants 1–10 (must be enforced by tests)

```text
INVARIANT 1  No agent can execute a capability that is not visible/allowed by its policy.
INVARIANT 2  A READ path cannot be used to bypass a DESTRUCTIVE classification.
INVARIANT 3  A quarantined tool cannot execute through the normal governed path.
INVARIANT 4  A changed schema invalidates approval when policy requires re-review.
INVARIANT 5  A destructive tool cannot execute without the required approval.
INVARIANT 6  Secrets do not appear in normal logs/audit/model-safe responses.
INVARIANT 7  Gateway failure does not fall back to uncontrolled direct execution.
INVARIANT 8  An agent cannot gain another agent's capability profile merely by
             changing request fields.
INVARIANT 9  A workflow cannot expand target scope beyond policy without new
             authorization.
INVARIANT 10 Management/admin APIs are not part of the standard agent execution
             surface.
```

### Threat model (7 threats)

| Threat | Controls |
|---|---|
| Prompt injection selects dangerous tool | capability visibility; risk classification; intent validation; approval; sandbox |
| Tool poisoning | quarantine; schema hashing; scanner review; manual approval |
| Secret exfiltration | secret broker; argument/response scanning; redaction; least privilege |
| Compromised child agent | agent-specific profile; workflow scope; no implicit privilege inheritance |
| Gateway management takeover | local/private management surface; admin identity; separate management permissions; TLS/private network where remote |
| Policy bypass via direct upstream | network policy; remove direct credentials; route via gateway; monitor forbidden egress |
| Approved tool changes behavior | schema/description hash; re-quarantine on change; version pin where possible; behavioral tests |

---

## 15. Agent / Worker Model

**Terminology (strictly separated):**

| Term | Definition |
|---|---|
| Agent | Governed caller with a capability profile (6 profiles, Section 12.10) |
| Workflow | Business context binding agent + capability requirements + budget |
| Capability | Canonical `pao://` tool (versioned descriptor + schema hash) |
| Gateway | MCPProxy instance behind the Pao adapter (deployment mode A–D) |
| Quarantine | Trust state preventing execution until review |
| Approval | Human decision bound to exact action; APPROVE ONCE / FOR WORKFLOW / DENY / DENY+BLOCK TOOL / EDIT SCOPE |

**Approval card:** `Agent: codex-worker-03 · Action: delete file · Target: /workspace/build/old-output.zip · Risk: DESTRUCTIVE · Reason: Cleanup before fresh build · Tool: filesystem:delete_file · Workflow: release-build · Arguments changed since planning: No` — **no generic "Approve everything" button for high-risk classes.**

---

## 16. Session / State Model

- **Server trust states:** 10 (Section 12.11); schema change ⇒ `TRUST INVALIDATED` until reviewed
- **Approval lifecycle:** pending → approved-once / approved-for-workflow / denied / expired; bound to exact action + arguments (changed since planning flagged)
- **OAuth connection states:** `CONNECTED/EXPIRED/REAUTH_REQUIRED/SCOPE_CHANGED/ERROR`
- **Workflow states:** preflight `READY/TRANSIENT/BLOCKED/AUTH_REQUIRED/UNKNOWN_TOOL`
- **Config revisions:** versioned snapshots; hot-reload health-check failure ⇒ rollback previous config

---

## 17. MCP Integration

This phase **is** the MCP integration layer — MCPProxy federates upstream MCP servers behind the Pao `CapabilityGateway`. All agent MCP access routes through: `Agent → CapabilityBroker → PolicyEngine → CapabilityGateway → MCPProxyGatewayAdapter → MCPProxy → upstream MCP servers`. No direct upstream bypass; no raw management surface to agents (Invariant 10).

---

## 18. Capability Registry

- **Canonical registry:** `pao://` IDs + upstream mapping + aliases + schema/description hashes + approval state
- **Server registry:** 10 trust states + ownership + risk tier + network zone + credential profile + allowed agents/workflows + quarantine policy
- **Tool version registry:** descriptor/version references (**do not duplicate giant tool schemas in every execution row**)
- **Visibility rules:** `SEARCH RESULTS = global index ∩ agent visibility scope ∩ workflow scope`

---

## 19. Policy Model

See Sections 12.3 (taxonomy + overrides), 12.5 (17-step order), 12.10 (visibility). Deterministic; fail closed; upstream annotations advisory — Pao overrides authoritative; policy versions recorded in every audit event (`policy_version: 2026-09-16.1`).

---

## 20. Security Model

See Sections 12.6–12.7 (quarantine/scanners/secrets/OAuth), 12.12 (network/sandbox/zones), 14 (invariants 1–10 + threat model 7). **Layered controls:** no single component protects the whole system; gateway ≠ OS isolation; scanner results never auto-trust; management plane = human/admin only; loopback/private default binding.

**Operational checklist (3 phases):**

- **Before registering an MCP server (7):** source identified; license reviewed; transport known; credentials scoped; network destination known; sandbox requirement decided; trust tier assigned
- **Before approval (7):** tool list reviewed; schema hashes captured; scanner results reviewed; dangerous tools classified; secret behavior reviewed; agent visibility configured; workflow visibility configured
- **Before production enablement (6):** preflight passes; audit works; redaction works; failure path tested; rollback tested; **destructive action test blocked without approval**

---

## 21. Approval Model

### R0–R4 summary

See Section 14. DESTRUCTIVE/ADMIN = always human; EXTERNAL = policy-scope; no blanket approvals.

### Approval UX

Card (Section 15) + 5 actions; approval bound to exact action + arguments; expiration; pending envelope preserved until decided. Integration with Reviewer Council for high-risk policy/tool changes: scanner results + schema diff → multi-model advisory → human decision (**advisory only**).

---

## 22. Failure Handling

See Section 12.12 failure model (6 codes + responses) + retry policy (8 rows) + budget governance (`BUDGET_EXCEEDED`). **Fail closed if capability gateway or policy engine unavailable; never silently fall back to uncontrolled direct execution (Invariant 7).**

---

## 23. Recovery Model

- **Gateway recovery:** health checks; config rollback (Section 12.11); deployment-mode restart procedures
- **Quarantine recovery:** review flow re-approves; schema diff reviewed; re-published capabilities
- **OAuth recovery:** reauth flow; SCOPE_CHANGED ⇒ re-review; preflight catches before expensive workflows
- **Rollback plan:** before production enablement — backup MCPProxy config; backup Pao policy config; version-pinned installation option; preserve prior gateway adapter version; retain DB migration rollback where safe. If new gateway release causes regression: `stop admission of new workflows → allow in-flight safe calls to drain → rollback gateway version/config → health test → resume`. **Never solve a gateway outage by enabling uncontrolled direct destructive access.**
- **Upgrade:** `pin version in production → track stable releases → review changelog → run compatibility tests → run security invariant suite → stage upgrade → promote only after pass` — avoid automatic production upgrades without qualification

---

## 24. Observability

### Metrics (5 groups, ~24)

```text
Gateway:   mcp_gateway_up · mcp_connected_servers · mcp_quarantined_servers
           mcp_available_tools · mcp_tool_schema_changes_total
Discovery: tool_search_total · tool_search_latency_ms · tool_search_no_result_total
           tool_describe_total · selected_tool_rank
Execution: tool_calls_total · tool_call_latency_ms · tool_call_success_total
           tool_call_error_total
Policy:    policy_allow_total · policy_deny_total · approval_required_total
           quarantine_block_total · scope_block_total
Auth:      auth_required_total · oauth_expired_total · credential_error_total
```

**Never use high-cardinality secret values as metric labels.**

### Alerts (8)

```text
gateway down · large sudden tool-surface change · approved tool changed schema
unexpected destructive-call spike · repeated policy bypass attempts
OAuth failures on critical workflows · quarantine disabled unexpectedly
config rollback triggered
```

---

## 25. Audit

See Section 12.9 — Pao-level audit event per governed call with domain context; redaction levels; correlation IDs; argument/result digests (not raw payloads); `mcpproxy_request_id` correlation where available.

---

## 26. Data Model

Conceptual tables (adapt to existing DB technology):

```text
mcp_gateways · mcp_servers · mcp_tools · mcp_tool_versions
capability_aliases · capability_policies · agent_capability_profiles
workflow_capability_requirements · approval_requests · approval_events
tool_execution_events · mcp_config_revisions · credential_bindings
```

**Do not duplicate giant tool schemas in every execution row — store descriptor/version references.**

---

## 27. API / Event Contracts

### 27.1 Pao APIs

**Capability search:**

```http
POST /api/capabilities/search
{"query": "create an issue in github", "workflow_id": "wf_123",
 "agent_id": "codex-01", "limit": 5}
→ {"results": [{"canonical_id": "pao://code/github/create_issue",
   "display_name": "Create GitHub Issue", "risk_class": "WRITE",
   "score": 0.89, "requires_description": true}]}
```

**Governed execution:**

```http
POST /api/capabilities/execute
{"canonical_id": "pao://code/github/create_issue", "workflow_id": "wf_123",
 "agent_id": "codex-01", "intent": {"operation_type": "WRITE",
 "reason": "User requested an issue"}, "arguments": {"title": "Example"}}
→ states: SUCCESS | DENIED | APPROVAL_REQUIRED | QUARANTINED | AUTH_REQUIRED
          | UNAVAILABLE | INVALID_ARGUMENTS | POLICY_ERROR | UPSTREAM_ERROR
```

**Do not leak hidden tool/server metadata to unauthorized agents.**

### 27.2 Common envelope

Standard Pao envelope + audit event schema (Section 12.9) + 9 execution states + 18-char error codes.

---

## 28. Configuration

See Section 12.12 (Pao-owned `mcp_gateway` YAML) + MCPProxy upstream config example (illustrative — generate from verified current docs during implementation; 6 rules: no committed secrets; loopback default; quarantine enabled; least privilege; config backup; validate before reload).

---

## 29. Feature Flags

| Flag | Default | Gates |
|---|---|---|
| `mcp_gateway.enabled` | per config | Gateway subsystem |
| `security.quarantine_required` | `true` | New-server quarantine |
| `security.block_unknown_servers` | `true` | Unregistered server execution |
| `security.block_unclassified_tools` | `true` | Unclassified tool execution |
| `security.sensitive_data_redaction` | `true` | Redaction |
| `approvals.destructive` / `approvals.admin` | `always` | High-risk gates (**never relaxed**) |
| `approvals.write` / `approvals.external` | `policy` | Policy-dependent gating |
| `audit.enabled` / `audit.redact_secrets` | `true` | Audit + redaction |
| `preflight.required_for_scheduled_jobs` / `_long_running_jobs` | `true` | Preflight gates |
| `gateway.fail_closed` | `true` | Outage semantics |

---

## 30. Repository / Module Structure

Recommended additions (adapt paths to the real repository rather than forcing blindly):

```text
apps/web/src/features/{mcp-control-plane, approvals, audit}/
services/api/src/{capability, gateway, policy, approvals, audit, credentials}/
packages/
  capability-core/{canonical-id.ts, types.ts, registry.ts}
  gateway-core/{capability-gateway.ts, errors.ts}
  gateway-mcpproxy/{client.ts, adapter.ts, mapper.ts, health.ts,
                    preflight.ts, audit-correlator.ts}
  policy-engine/{classifier.ts, evaluator.ts, rules.ts}
  audit-core/{event.ts, redaction.ts, storage.ts}
config/mcp/{registry.yaml, policies.yaml, profiles.yaml}
infra/mcpproxy/{README.md, install/, config/, systemd/, docker/}
scripts/mcp/{bootstrap.*, healthcheck.*, backup-config.*, restore-config.*}
```

---

## 31. Dashboard Integration

New top-level area **MCP Control Plane** — 8 pages:

- **Overview:** gateway status; connected servers; approved servers; quarantined servers; tools available; blocked calls; calls today; error rate
- **Servers:** name; transport; health; trust state; authentication; tool count; last change
- **Tools:** canonical ID; upstream ID; risk class; approval requirement; schema hash; visibility
- **Quarantine:** pending servers; changed tools; scanner results; schema diffs; approve/reject
- **Policies:** agent profile; workflow profile; target scope; risk mappings
- **Approvals:** pending; approved; denied; expiration
- **Audit:** timeline; request ID; workflow ID; agent; tool; decision; status
- **Credentials:** **metadata only** — provider; state; last rotation; scope. **Never show raw credentials by default.**

---

## 32. Dependencies

### Required

- **Pao-hubPro existing primitives:** auth/RBAC, policy engine, approval engine, audit store, config/flags, persistence, telemetry, secret management
- **MCPProxy v0.66.1 (pinned; MIT)** — gateway implementation behind the adapter

### Recommended

- **Phase 20.73 Herdr** — persistent agent identity feeding capability profiles; **Phase 20.72 credential gateway** — provider credential policy/metadata; **Context Mode (20.65 pending)** — complementary context optimization; **Reviewer Council** — advisory review of high-risk changes; **ScannerProvider backends** (Semgrep/Trivy)

### Optional

- OAuth providers for remote MCP; canary/online evaluation; federated gateway mode D

**Do not assume other phases are implemented.** Standalone path: first development slice (Section 38) — local test MCP server → MCPProxy → adapter → capability search → policy READ check → read-only execution → Pao audit event — works with zero privileged integrations; WRITE/quarantine/drift/approval/destructive/preflight added in order.

---

## 33. Compatibility

- **Version pinning:** production pins stable MCPProxy release; compatibility record per deployment (`validated_version, validated_at, protocol_notes, test_suite_commit`); avoid automatic production upgrades without qualification
- **Upstream drift:** 10 watch items (Section 7); any upstream security claim verified against the deployed version; adapter boundary absorbs API/CLI churn
- **Migration compatibility:** existing tool paths preserved until each group validated (Section 38) — **but do not preserve an insecure direct path indefinitely**
- **Gateway replaceability:** the architecture continues functioning conceptually if MCPProxy is replaced later (Pao owns the interface)
- **Backward compatibility:** config revisions versioned; hot-reload rollback; DB migration rollback where safe

---

## 34. Migration

**Do not migrate every tool at once.** Order:

```text
1. READ-only tools                5. remote API tools
2. repository metadata tools      6. external-side-effect tools
3. workspace controlled WRITE     7. destructive/admin tools last
4. build/test EXECUTE tools
```

Per group: `shadow observe → route low-risk subset → compare results → enable policy gates → disable old direct path`. M14 milestone: route existing Pao tools through the gateway incrementally; compare behavior; disable direct paths after confidence threshold.

---

## 35. Rollback

Pre-production: backup MCPProxy configuration; backup Pao policy configuration; version-pinned installation option; preserve prior gateway adapter version; retain DB migration rollback where safe. Regression rollback: `stop admission of new workflows → allow in-flight safe calls to drain → rollback gateway version/config → health test → resume` — **never solve a gateway outage by enabling uncontrolled direct destructive access.**

---

## 36. Testing Strategy

### 36.1 Unit tests (7)

Canonical capability mapping; risk mapping; policy evaluation; approval rules; redaction; error mapping; schema hash handling.

### 36.2 Adapter tests (8 — mock MCPProxy)

Retrieve tools; describe tools; read call; write call; destructive call; quarantine errors; auth errors; timeout.

### 36.3 Integration tests (13 — real local test server `Pao API → MCPProxy → test MCP server`)

Search tool; describe tool; read execution; write execution; destructive blocked; destructive approved; new tool quarantined; tool schema changed; OAuth unavailable; gateway restart; config hot reload; preflight ready; preflight blocked.

### 36.4 Security tests (10 — attempt)

Fake agent ID; fake approval ID; **read→destructive mismatch**; direct upstream bypass; prompt-injected intent reason; secret exfiltration in argument; secret exfiltration in response; changed descriptor after approval; hidden tool enumeration; cross-workflow capability reuse.

### 36.5 E2E tests (UI, 9 steps)

Register server → see quarantine → review diff → approve → search capability → execute safe tool → request destructive action → approve → inspect audit trail.

### 36.6 First development slice (do not begin with the dashboard)

```text
Local test MCP server → MCPProxy → MCPProxyGatewayAdapter
→ Capability search → Policy READ check → read-only tool execution → Pao audit event
```

Acceptance: user request → agent searches capability → only relevant tool descriptor loaded → policy allows READ → MCPProxy invokes tool → result returns → audit trace visible. **Then add WRITE, quarantine, schema drift, approval, destructive calls, and preflight — in that order.**

---

## 37. Acceptance Criteria

**Gateway:** MCPProxy bootstrap through documented Pao tooling; Pao connects via gateway adapter (not scattered direct calls); default listen local/private.
**Discovery:** agent searches capabilities without receiving the entire tool-schema catalog; full descriptor loaded only for selected tools; **hidden tools do not appear for unauthorized agent profiles**.
**Policy:** READ/WRITE/EXECUTE/DESTRUCTIVE/EXTERNAL/SECRET/ADMIN classifications exist; upstream annotation is not the sole policy source; destructive operation can require human approval.
**Quarantine:** newly registered untrusted server quarantined; schema/tool change invalidates approval; operator reviews + approves/rejects changes.
**Preflight:** scheduled/long jobs verify required capabilities before LLM-heavy execution; blocked/auth-required/unknown-tool states distinguishable.
**Secrets:** no plaintext production secrets committed; sensitive values redacted from normal audit/model-safe logs.
**Audit:** every governed tool execution receives a Pao audit event; correlates to MCPProxy request/activity record where available; workflow/agent/request IDs searchable.
**Resilience:** gateway failure fail-closed; config changes validated + rollback-capable; retry behavior distinguishes transient from policy/auth/quarantine failures.
**Testing:** unit suite passes; integration suite passes; security invariant tests pass (Invariants 1–10); E2E approval path passes.

---

## 38. Implementation Roadmap

**Implementation milestones M1–M14:**

| M | Content | Deliverable |
|---|---|---|
| M1 Upstream reconnaissance | verify latest stable; read docs/config/security notes; exact API/CLI paths; compatibility matrix — **do not code against assumptions if upstream changed** | `docs/mcp/mcpproxy-compatibility.md` |
| M2 Gateway bootstrap | install local MCPProxy; loopback binding; health check; dev config; basic test MCP server | working gateway |
| M3 Capability Gateway abstraction | provider-neutral interface; MCPProxy adapter; error normalization; health state | — |
| M4 Discovery + canonical registry | tool retrieval; description fetch; canonical IDs; aliases; visibility filter | — |
| M5 Policy engine integration | risk taxonomy; evaluator; agent/workflow profiles; scope enforcement | — |
| M6 Intent-aware calls | read/write/destructive paths; reason/intent envelope | — |
| M7 Quarantine + schema drift | trust state; schema hashes; change detection; review workflow | — |
| M8 Human approval | approval API + UI; one-time/workflow-bound; expiration | — |
| M9 Secrets + auth | credential references; OAuth state mapping; redaction | — |
| M10 Preflight | workflow manifest; scheduler integration; error routing | — |
| M11 Audit + observability | correlation IDs; audit DB; activity correlation; metrics | — |
| M12 Dashboard | overview; servers; tools; quarantine; policies; approvals; audit | — |
| M13 Security tests | invariant suite; scope attacks; bypass attempts; schema drift; secret leakage | — |
| M14 Migration | incremental routing; no big-bang; behavior comparison; disable direct paths after confidence | — |

**Quality gates before finishing (11):** formatter; linter; typecheck; unit tests; integration tests; build; security tests; git diff review; confirm no secrets; confirm destructive operations cannot bypass approval; confirm gateway outage fails closed.

---

## 39. Risks

| Risk | Mitigation |
|---|---|
| Prompt injection selects dangerous tool | capability visibility; risk classification; intent validation; approval; sandbox |
| Tool poisoning | quarantine; schema hashing; scanner review; manual approval |
| Secret exfiltration | secret broker; argument/response scanning; redaction; least privilege |
| Compromised child agent | agent-specific profile; workflow scope; no implicit privilege inheritance |
| Gateway management takeover | local/private management surface; admin identity; separate permissions; TLS/private network |
| Policy bypass via direct upstream | network policy; remove direct credentials; route via gateway; monitor forbidden egress |
| Approved tool changes behavior | schema/description hash; re-quarantine on change; version pin; behavioral tests |
| Schema explosion returns | dynamic discovery; describe-on-demand; visibility filter |
| Upstream hardening lag | layered controls; invariants tested; watch items tracked |
| Big-bang migration regression | per-group shadow → compare → enable → disable old path |

---

## 40. Security Checklist

- [ ] Invariants 1–10 (Section 14) test-encoded and passing
- [ ] CapabilityGateway is the only MCPProxy surface; no scattered direct calls; no agent bypass
- [ ] `pao://` canonical IDs stable across upstream changes; alias/version/schema-hash registry
- [ ] Risk taxonomy 7 classes with Pao overrides; upstream annotations never sole source
- [ ] 17-step policy evaluation deterministic; fail closed on unavailable components
- [ ] New servers default QUARANTINED; schema change ⇒ trust invalidated + diff + re-review
- [ ] Scanner results: PASS→eligible, WARN→manual, FAIL→blocked, UNKNOWN→manual (never auto-trust)
- [ ] Secrets via `secret://` references; broker resolves at execution boundary; `credential_available` not `credential_value`
- [ ] OAuth states surfaced; preflight detects expired auth before expensive workflows
- [ ] Approval cards complete; APPROVE ONCE/FOR WORKFLOW/DENY/DENY+BLOCK/EDIT SCOPE; no blanket high-risk approval
- [ ] Visibility filter on discovery AND execution; hidden tools invisible to unauthorized profiles
- [ ] No implicit child privilege inheritance; planner/reviewer/coder profiles separated
- [ ] Audit events with domain context; 4 redaction levels; correlation IDs propagated
- [ ] Loopback/private default; management surface not public; zones 0–4 sandboxing
- [ ] Config: validated → staged → backed up → atomic → hot reload (verified) → health → commit/rollback

---

## 41. Production Readiness Checklist

### Operational checklist (3 phases — Section 20)

Before registering (7) · before approval (7) · before production enablement (6) — all checked with evidence.

### Quality gates (11)

Formatter; linter; typecheck; unit tests; integration tests; build; security tests; git diff review; confirm no secrets present; confirm destructive operations cannot bypass approval; confirm gateway outage fails closed. **Do not claim completion if tests fail; do not hide failures; do not disable security checks just to make tests pass.**

### Documentation required

Architecture; installation/bootstrap; gateway configuration; capability registry; policy model; quarantine/review flow; approvals; secrets/OAuth; preflight; audit; troubleshooting; upgrade/rollback procedure; MCPProxy validated version.

### Final report (10)

Concise architecture summary; files added/changed; database migrations; config/env additions; tests added and results; commands to run locally; security assumptions; known upstream/version limitations; remaining TODOs; rollback instructions.

---

## 42. Future Extensions

- Federated gateway mode D (cross-zone policy enforcement; dev/production/GPU-media/remote-worker gateways)
- Cross-machine capability federation; zero-trust agent/tool identities; capability learning and routing optimization (per 20.73/20.74 transition)
- Policy-aware autonomous workflows with preflight-driven scheduling
- Additional scanner providers; behavioral tool testing; semantic-diff review automation
- Context Intelligence integration maturation (retrieval telemetry → ranking/alias learning)

---

## 43. Definition of Done

Phase 20.74 is DONE when Pao-hubPro has:

- a unified, vendor-neutral capability gateway abstraction backed by MCPProxy;
- dynamic tool discovery working (schemas loaded only when required);
- Pao policies authoritative (upstream annotations advisory);
- quarantine and tool-change review integrated;
- high-risk execution approval-governed;
- scheduled workflows supporting capability preflight;
- secrets out of normal model/audit surfaces;
- **every governed call traceable from user/workflow/agent through policy decision to MCPProxy/upstream execution.**

The architecture must continue functioning conceptually if MCPProxy is replaced later.

**Final architecture position:** Pao-hubPro remains the brain; the Policy Plane remains the authority; MCPProxy becomes the governed tool gateway; agents receive the minimum capability surface necessary; high-risk actions remain approval-controlled; **every action becomes traceable.**

---

## 44. Codex One-Shot Implementation Prompt

Copy the block below into Codex at the root of the Pao-hubPro repository — Codex must inspect the real repository first and adapt paths/frameworks/database/runtime rather than blindly creating a parallel architecture.

```text
You are implementing Phase 20.74 of Pao-hubPro.

PHASE NAME
Phase 20.74 — Pao-hubPro × MCPProxy — Federated MCP Tool Gateway,
Context-Efficient Dynamic Tool Discovery, Intent-Aware Execution,
Security Quarantine, Audit & Policy-Governed MCP Control Plane

PRIMARY OBJECTIVE
Integrate smart-mcp-proxy/mcpproxy-go into Pao-hubPro as a governed MCP Tool
Gateway / Enforcement Plane without replacing Pao-hubPro's own orchestration,
policy, approval, credential, audit, or domain abstractions.

IMPORTANT ARCHITECTURE RULE
Pao-hubPro owns the CapabilityGateway interface and canonical capability model.
MCPProxy is an adapter implementation behind that interface.
Do not spread direct MCPProxy-specific calls across unrelated application
modules.
Do not allow agents to bypass Pao policy by talking directly to upstream MCP
servers.

BEFORE CODING
1. Inspect the complete repository structure.
2. Identify the current frontend, backend, database, config, auth, audit,
   agent, policy, workflow, and tool abstractions.
3. Find all current MCP/tool execution code paths.
4. Find current environment/config conventions.
5. Read existing tests and CI commands.
6. Read the current upstream MCPProxy README, configuration docs, security
   docs, changelog, and latest stable release before implementing any
   API/CLI-specific behavior.
7. Record the MCPProxy version actually validated.
8. Reuse existing Pao-hubPro architecture where sensible. Do not create
   duplicate systems.

SAFETY REQUIREMENTS
- Fail closed if the capability gateway or policy engine is unavailable.
- No plaintext secrets in source control.
- No raw secret in normal logs, audit output, UI, or model-facing responses.
- Destructive/admin operations require explicit policy authorization and
  human approval by default.
- Newly registered/untrusted MCP servers must be quarantined by default.
- Changed tool schemas/descriptions must be able to invalidate trust and
  require review.
- Do not treat MCPProxy as the only security boundary.
- Preserve OS/container/network sandboxing.
- Do not expose MCPProxy management interfaces publicly by default.
- Default MCPProxy binding should be loopback/private.
- Never silently fall back to uncontrolled direct tool execution.

IMPLEMENTATION GOALS

A. CAPABILITY GATEWAY ABSTRACTION
Create/reuse a provider-neutral interface similar to:
- searchTools
- describeTools
- preflight
- execute
- getAuditTrail / correlation support
Create an MCPProxy adapter behind the interface.
Normalize upstream errors into Pao domain errors.

B. CANONICAL CAPABILITY REGISTRY
Create stable Pao capability IDs independent of upstream names.
Recommended logical format: pao://<domain>/<provider>/<capability>
Store mapping to MCPProxy server/tool IDs.
Support aliases and version/schema hashes.

C. DYNAMIC TOOL DISCOVERY
Use MCPProxy dynamic tool discovery where supported.
Do not place the complete global tool schema surface in every agent context.
Flow: search/retrieve -> policy visibility filter -> describe selected
tool(s) -> authorize -> execute.

D. RISK MODEL
Preserve or implement these internal risk classes:
READ, WRITE, EXECUTE, DESTRUCTIVE, EXTERNAL, SECRET, ADMIN.
Do not blindly trust upstream annotations.
Allow Pao policy overrides.
Map to MCPProxy read/write/destructive invocation semantics where
appropriate.

E. EXECUTION ENVELOPE
Every execution must carry/correlate: trace_id; workflow_id; request_id;
agent_id; session_id where available; canonical capability ID;
operation/risk class; human-readable reason; target scope; approval ID if
required; policy version.

F. POLICY ORDER
Implement deterministic enforcement approximately:
1 authenticate agent
2 resolve workflow
3 resolve capability
4 check visibility
5 obtain current descriptor
6 verify trust/schema state
7 classify risk
8 apply Pao policy
9 validate target scope
10 validate secret policy
11 validate cost/rate budget if such system exists
12 require approval where needed
13 preflight where needed
14 execute through MCPProxy
15 audit
16 redact
17 return

G. QUARANTINE
Integrate MCPProxy quarantine/tool-change capabilities where supported.
Store Pao trust state independently.
Support states such as: DISCOVERED, REGISTERED, QUARANTINED, SCANNING,
REVIEW_REQUIRED, APPROVED, DEGRADED, AUTH_REQUIRED, DISABLED, REVOKED.

H. TOOL SCHEMA DRIFT
Persist descriptor/schema hashes.
If the currently observed approved tool changes, invalidate approval
according to policy.
Provide old/new diff data for UI/review.

I. HUMAN APPROVAL
Reuse existing approval infrastructure if present.
Otherwise implement minimal durable approval requests.
At minimum support: APPROVE ONCE; APPROVE FOR WORKFLOW where safe; DENY.
Never implement global one-click blanket approval for destructive/admin
capabilities.

J. PREFLIGHT
Add a workflow preflight layer for scheduled, autonomous, or long-running
jobs. A workflow may declare required and optional capabilities.
Return distinct states for: READY; TRANSIENT; BLOCKED; AUTH_REQUIRED;
UNKNOWN_TOOL / MISCONFIGURED.
Do not start an expensive agent workflow if mandatory capabilities are known
to be unavailable.

K. SECRETS / OAUTH
Reuse the current credential architecture.
Integrate with MCPProxy OAuth/keyring/credential mechanisms only through a
controlled adapter.
Prefer secret references over values.
Redact values from logs and model-facing errors.
Expose connection state, not token value.

L. AUDIT
Create a Pao-level audit event for every governed tool call.
Correlate to MCPProxy request/activity ID when available.
Audit record should include: workflow; agent; capability; upstream
server/tool; risk; policy decision; policy version; approval; status;
latency; argument/result digest or safely redacted summary.

M. DASHBOARD
Integrate into the existing Pao-hubPro UI style.
Add an MCP Control Plane area with, where architecture permits:
- Overview
- Servers
- Tools
- Quarantine
- Policies
- Approvals
- Audit
- Credential connection status
Do not expose plaintext credentials.

N. OBSERVABILITY
Add structured logs and metrics using existing telemetry conventions.
Include gateway health, server/tool counts, discovery latency, execution
success/error, policy deny, quarantine blocks, approval requirements, and
auth failures.
Avoid secret/high-cardinality labels.

O. CONFIG MANAGEMENT
Use repository conventions.
Keep Pao-owned config separate from MCPProxy implementation config.
Validate before applying.
Back up active config before changes.
Use atomic writes when writing MCPProxy config.
Support rollback.
Use hot reload only where verified supported by the deployed MCPProxy
version.

P. DEPLOYMENT
Provide development bootstrap for MCPProxy.
Prefer version-pinned stable release for production.
Default to loopback/private network.
Document Linux/Windows/macOS considerations only where relevant to the
current repo/deployment.

Q. TESTS
Add tests for at least:
- capability mapping
- visibility policy
- READ success
- WRITE policy
- DESTRUCTIVE denied without approval
- DESTRUCTIVE allowed with valid approval
- quarantined tool blocked
- changed schema invalidates trust
- fake agent identity denied
- fake/expired approval denied
- secret redaction
- gateway unavailable fail-closed
- auth-required no retry loop
- preflight ready
- preflight blocked
- direct bypass prevention where testable
Add adapter integration tests against a test MCP server/MCPProxy instance
if feasible in CI.

R. MIGRATION
Do not big-bang migrate every existing tool.
Create a safe migration path:
READ -> controlled WRITE -> EXECUTE -> EXTERNAL -> DESTRUCTIVE/ADMIN.
Preserve backwards compatibility until each route is validated, but do not
preserve an insecure direct path indefinitely.

S. DOCUMENTATION
Create/update documentation covering:
- architecture
- installation/bootstrap
- gateway configuration
- capability registry
- policy model
- quarantine/review flow
- approvals
- secrets/OAuth
- preflight
- audit
- troubleshooting
- upgrade/rollback procedure
- MCPProxy validated version

T. QUALITY GATES
Before finishing:
1 run formatter
2 run linter
3 run typecheck
4 run unit tests
5 run integration tests available
6 run build
7 run security-related tests
8 review git diff
9 confirm no secrets are present
10 confirm destructive operations cannot bypass approval
11 confirm gateway outage fails closed

DELIVERABLE FORMAT
At completion provide:
1. concise architecture summary
2. files added/changed
3. database migrations
4. config/env additions
5. tests added and results
6. commands to run locally
7. security assumptions
8. known upstream/version limitations
9. remaining TODOs
10. rollback instructions

DO NOT CLAIM COMPLETION IF TESTS FAIL.
DO NOT HIDE FAILURES.
DO NOT DISABLE SECURITY CHECKS JUST TO MAKE TESTS PASS.
```
