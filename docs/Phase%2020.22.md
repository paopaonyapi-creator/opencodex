# Phase 20.22 — Pao-hubPro × LangChain Agent Orchestration & MCP Runtime Layer

> **Project:** Pao-hubPro  
> **Phase:** 20.22  
> **Status:** Implementation Specification  
> **Date:** 2026-09-12  
> **Primary repository:** https://github.com/langchain-ai/langchain  
> **Related runtime:** LangGraph  
> **Primary integration surface:** LangChain Agents + MCP  
> **Primary goal:** Add a pluggable LangChain/LangGraph agent orchestration layer to Pao-hubPro so models, MCP tools, Codex, browser automation, local tools, Reviewer Council, and production workflows can be coordinated through one stateful agent runtime without bypassing Pao-hubPro security, permissions, approvals, audit, or provider abstraction.

---

# 0. Executive Decision

Integrate LangChain into Pao-hubPro as an **Agent Orchestration Layer**.

Do **not** make Pao-hubPro equal to LangChain.

Correct architecture:

```text
User / Web Dashboard / API / Automation
                  |
                  v
        Pao-hubPro Control Plane
                  |
      +-----------+-----------+
      |                       |
      v                       v
Security / Policy       Job / Session Layer
      |                       |
      +-----------+-----------+
                  |
                  v
       Agent Runtime Interface
                  |
       +----------+----------+
       |                     |
       v                     v
 LangChain Runtime      Native Runtime
       |                     |
       v                     v
    LangGraph            Existing Flow
       |
       v
  Tool Broker / MCP Gateway
       |
  +----+---------+---------+---------+---------+
  |              |         |         |         |
  v              v         v         v         v
Codex MCP    Browser MCP  Files MCP  ComfyUI  Runpod
  |              |         |         |         |
  +--------------+---------+---------+---------+
                         |
                         v
                 Existing Pao Services
```

LangChain must never become the security boundary.

The security boundary remains:

```text
Pao-hubPro
  -> authentication
  -> authorization
  -> tool policy
  -> path boundary
  -> command allow/deny rules
  -> approval
  -> timeout
  -> secrets
  -> audit
  -> quotas
  -> cost controls
```

LangChain decides **what should happen next**.

Pao-hubPro decides **whether it is allowed to happen**.

---

# 1. Why This Phase Exists

Pao-hubPro is evolving from a collection of integrations into an agent control plane.

Existing and planned capabilities include:

```text
OpenAI Codex
MCP
Browser automation
Local file operations
Local command execution
GitHub
ComfyUI
Runpod
Adobe Stock workflows
Social intelligence
Reviewer Council
Notifications
Model routing
Web Dashboard
Automation
```

Without an orchestration layer, each subsystem tends to implement its own:

```text
agent loop
tool selection
model selection
retry
state
context
approval
structured output
multi-agent handoff
checkpoint
resume
error handling
```

That produces duplicated logic and inconsistent behavior.

Phase 20.22 establishes a common orchestration runtime.

---

# 2. Strategic Role of LangChain

Use LangChain for:

```text
agent construction
model abstraction
tool calling
middleware
structured output
tool selection
fallback
context management
human-in-the-loop integration
multi-agent composition
```

Use LangGraph for:

```text
state
graph execution
durability
checkpointing
resume
branching
subgraphs
long-running workflows
interrupts
```

Use MCP for:

```text
tool interoperability
server discovery
tool schemas
remote/local tool transport
resource access
prompt/resource integration when appropriate
```

Keep Pao-hubPro responsible for:

```text
identity
authorization
policy
secrets
audit
execution boundaries
cost policy
provider policy
workspace isolation
user approval
production job lifecycle
```

---

# 3. Phase Relationship

Phase 20.22 must integrate with the existing Pao-hubPro phases.

Especially preserve the role of the Codex runtime introduced before this phase.

The intended relationship is:

```text
Pao-hubPro
   |
   +-- Native Codex Runtime
   |
   +-- LangChain Agent Runtime
          |
          +-- may invoke Codex through a controlled adapter/tool
          +-- may delegate coding work
          +-- may request review
          +-- may wait for approval
          +-- may resume workflow
```

LangChain does **not** replace Codex.

Codex remains the specialist coding/execution runtime.

LangChain becomes the higher-level orchestration option.

---

# 4. Non-Goals

Phase 20.22 must NOT:

```text
rewrite the whole repository
replace working MCP servers
replace Codex
replace existing authentication
replace the audit system
replace the notification gateway
expose raw shell access to agents
expose unrestricted filesystem access
move secrets into prompts
force all workflows to use LangChain
hard-code one LLM provider
hard-code one MCP transport
break existing API contracts
perform destructive database migrations
delete old runtime paths
```

---

# 5. Compatibility Rule

LangChain evolves quickly.

Therefore:

```text
DO NOT scatter LangChain imports across the whole application.
```

Create a dedicated compatibility boundary:

```text
pao_hub/
  orchestration/
    langchain_runtime/
```

All LangChain-specific code must live behind Pao-hubPro-owned interfaces.

Recommended rule:

```text
Core domain code
        |
        v
Pao AgentRuntime interface
        |
        v
LangChain adapter
        |
        v
LangChain / LangGraph APIs
```

If LangChain changes API later, only the adapter should require major changes.

---

# 6. Dependency Policy

Codex must inspect the repository first and preserve the current package manager.

Preferred dependency behavior:

```text
if uv is already used:
    use uv
elif poetry is already used:
    use poetry
elif pip-tools is already used:
    preserve pip-tools
else:
    preserve the repository's existing dependency workflow
```

Prefer stable compatible releases.

Primary packages:

```text
langchain
langgraph
```

For first-party MCP support, prefer the current supported LangChain MCP integration.

Current reference direction:

```text
langchain.mcp
```

Possible installation form when supported by the selected stable release:

```text
langchain[mcp]
```

Do not force an alpha/beta/pre-release merely to obtain one API.

If the repository's selected stable LangChain release does not expose the required first-party MCP API:

```text
use a compatibility adapter
or
use the officially supported MCP adapter package
```

but hide that choice behind:

```text
PaoMCPToolProvider
```

No business logic may depend on the temporary compatibility implementation.

---

# 7. Target Directory Structure

Adapt to the existing repository rather than blindly creating duplicates.

Desired logical structure:

```text
pao_hub/
├── orchestration/
│   ├── __init__.py
│   ├── runtime.py
│   ├── contracts.py
│   ├── schemas.py
│   ├── registry.py
│   │
│   ├── langchain_runtime/
│   │   ├── __init__.py
│   │   ├── runtime.py
│   │   ├── agent_factory.py
│   │   ├── model_router.py
│   │   ├── mcp_provider.py
│   │   ├── tool_adapter.py
│   │   ├── middleware.py
│   │   ├── structured_output.py
│   │   ├── checkpoint.py
│   │   ├── reviewer_council.py
│   │   ├── errors.py
│   │   └── telemetry.py
│   │
│   └── native_runtime/
│       └── existing adapters
│
├── policy/
│   ├── tool_policy.py
│   ├── approval.py
│   └── risk.py
│
├── mcp/
│   ├── registry.py
│   ├── gateway.py
│   └── clients/
│
└── api/
    └── agent_routes.py

tests/
├── orchestration/
│   ├── test_runtime_contract.py
│   ├── test_agent_factory.py
│   ├── test_model_router.py
│   ├── test_mcp_provider.py
│   ├── test_tool_policy.py
│   ├── test_human_approval.py
│   ├── test_checkpoint_resume.py
│   ├── test_structured_output.py
│   └── test_reviewer_council.py
```

If equivalent modules already exist:

```text
extend them
do not duplicate them
```

---

# 8. Core Runtime Contract

Create a Pao-owned runtime abstraction.

Conceptual interface:

```python
class AgentRuntime:
    async def run(self, request): ...
    async def stream(self, request): ...
    async def resume(self, run_id, input): ...
    async def cancel(self, run_id): ...
    async def get_state(self, run_id): ...
```

Pao-hubPro must be able to choose runtime:

```text
native
langchain
codex
future runtime
```

without changing API consumers.

Example configuration:

```yaml
orchestration:
  default_runtime: langchain
  fallback_runtime: native
```

Do not make configuration names exact if the repository already has an established config system.

---

# 9. Agent Request Schema

Define a normalized request independent from LangChain message classes.

Example conceptual schema:

```text
AgentRunRequest
  id
  workspace_id
  user_id
  session_id
  task
  messages
  preferred_model
  allowed_tools
  denied_tools
  max_model_calls
  max_tool_calls
  max_cost
  timeout_seconds
  require_approval
  metadata
```

Convert to LangChain types only inside the adapter.

This prevents:

```text
LangChain-specific types
```

from leaking through Pao-hubPro API boundaries.

---

# 10. Agent Result Schema

Return a normalized Pao result.

Example:

```text
AgentRunResult
  run_id
  status
  answer
  structured_output
  model_usage
  tool_calls
  approvals
  errors
  checkpoint_id
  started_at
  completed_at
```

Possible statuses:

```text
queued
running
waiting_approval
waiting_input
completed
failed
cancelled
timed_out
```

---

# 11. LangChain Agent Factory

Use the modern LangChain agent API where compatible.

Primary construction direction:

```python
from langchain.agents import create_agent
```

Do not create agents ad hoc throughout business code.

Create:

```text
PaoAgentFactory
```

Responsibilities:

```text
select model
resolve model policy
load allowed tools
attach middleware
attach structured output
configure state
configure checkpointing
attach run metadata
build agent
```

Conceptual flow:

```text
Request
  |
  v
PaoAgentFactory
  |
  +-- Model Router
  +-- Tool Resolver
  +-- Policy Middleware
  +-- Limits
  +-- Approval
  +-- Context Policy
  +-- Checkpoint
  |
  v
Compiled Agent
```

---

# 12. Model Router

Create one provider-neutral model routing layer.

It must support the existing and future Pao provider stack.

Conceptual providers:

```text
OpenAI
Grok
DeepSeek
Anthropic
Local / Ollama
Other OpenAI-compatible endpoints
```

Routing inputs may include:

```text
task class
coding
research
vision
cheap
local
privacy-sensitive
latency-sensitive
high-reasoning
provider availability
budget
```

Example:

```text
task=coding
  -> preferred Codex/OpenAI path

task=research
  -> research-capable provider

task=cheap_batch
  -> low-cost provider

task=private_local
  -> local model
```

Do not encode provider names into business workflows.

Business code should request capabilities.

---

# 13. Model Fallback

Use LangChain fallback middleware or a Pao-owned wrapper where appropriate.

Required behavior:

```text
primary model error
   |
   v
classify failure
   |
   +-- auth/config error -> fail fast
   +-- policy error      -> fail fast
   +-- transient error   -> fallback/retry
   +-- rate limit        -> controlled retry/fallback
```

Do not:

```text
retry invalid API keys
retry policy failures forever
fallback to a provider forbidden by workspace policy
```

Audit every fallback.

---

# 14. Model Call Limits

Every production agent must have explicit limits.

At minimum:

```text
per-run model call limit
per-thread/session model call limit where useful
execution timeout
token/cost budget where available
```

Use LangChain call-limit middleware when compatible, but enforce critical limits again at the Pao control-plane level.

Reason:

```text
middleware limit = orchestration safety
Pao limit       = platform safety
```

---

# 15. Tool Call Limits

Agents must not be allowed to loop tools indefinitely.

Configure:

```text
max tool calls
max repeated same-tool calls
max consecutive failures
max tool runtime
```

Detect loops such as:

```text
read file
read same file
read same file
read same file
...
```

or:

```text
browser search
browser search
browser search
...
```

Terminate or request intervention when loop thresholds are reached.

---

# 16. MCP as the Primary Tool Boundary

Prefer MCP for reusable external capabilities.

Desired topology:

```text
LangChain Agent
      |
      v
Pao MCP Tool Provider
      |
      v
Pao MCP Gateway / Registry
      |
      +-- Codex
      +-- Browser
      +-- Files
      +-- GitHub
      +-- ComfyUI
      +-- Runpod
      +-- Stock Production
      +-- Notification
      +-- Local Services
```

LangChain may understand MCP tool schemas.

But it must receive only tools already filtered by Pao policy.

Wrong:

```text
MCP server exposes 100 tools
      |
      v
Agent receives all 100
      |
      v
Agent decides security
```

Correct:

```text
MCP server exposes 100 tools
      |
      v
Pao Policy filters
      |
      v
18 tools allowed for this run
      |
      v
Tool selector reduces to relevant tools
      |
      v
Agent
```

---

# 17. MCP Compatibility Adapter

Create:

```text
PaoMCPToolProvider
```

Responsibilities:

```text
connect
discover
normalize
filter
convert
cache tool metadata
refresh safely
disconnect
report health
```

Do not let individual agents create unmanaged MCP connections.

Connection lifecycle belongs to the integration layer.

Support multiple configured MCP servers.

Conceptual config:

```yaml
mcp:
  servers:
    codex:
      enabled: true
    browser:
      enabled: true
    files:
      enabled: true
    comfyui:
      enabled: true
```

Preserve existing Pao-hubPro MCP configuration if already present.

---

# 18. MCP Metadata Preservation

When converting MCP tools into LangChain tools, preserve useful metadata.

Examples:

```text
server identity
tool name
tool description
annotations
risk class
read/write nature
approval requirement
Pao policy tags
```

Pao metadata may extend MCP metadata.

Example:

```json
{
  "pao": {
    "risk": "high",
    "approval": "required",
    "workspace_scope": true
  }
}
```

Do not expose internal secrets in model-visible metadata.

---

# 19. Tool Policy Middleware

All tool calls must pass through:

```text
Tool Request
   |
   v
Normalize
   |
   v
Policy Evaluation
   |
   +-- DENY
   |
   +-- APPROVAL_REQUIRED
   |
   +-- ALLOW
```

Policy inputs:

```text
user
workspace
agent
tool
arguments
resource
path
command
network target
risk
run policy
```

The tool policy layer must be owned by Pao-hubPro.

LangChain `wrap_tool_call` or equivalent hooks may call the Pao policy engine.

But policy rules must not live only in LangChain middleware.

---

# 20. Safe Filesystem Policy

Never expose an unrestricted filesystem tool to production agents.

Requirements:

```text
workspace root boundary
canonical path resolution
reject path traversal
reject symlink escape where applicable
read/write distinction
file-size limit
extension rules if configured
audit writes
approval for destructive operations
```

Examples to reject:

```text
../../etc/passwd
workspace/../../secret
unexpected absolute paths
```

If existing Pao-hubPro safe file tools already implement these protections:

```text
reuse them through MCP
do not replace them with generic LangChain filesystem tools
```

---

# 21. Safe Command Policy

Do not expose generic persistent shell middleware directly to production users.

Shell capability must go through the existing controlled command layer.

Required controls:

```text
working directory boundary
command classification
deny dangerous commands
timeout
output limit
environment sanitization
secret filtering
network policy
approval for high-risk commands
audit
```

LangChain may request:

```text
run tests
```

but Pao-hubPro decides the actual safe execution path.

---

# 22. Middleware Pipeline

Recommended logical order:

```text
Request Context
      |
      v
Authentication Context
      |
      v
Run Budget
      |
      v
Model Router
      |
      v
Context Management
      |
      v
Tool Selection
      |
      v
Model
      |
      v
Tool Policy
      |
      +-- approval if needed
      |
      v
Tool Execution
      |
      v
Tool Result Sanitization
      |
      v
Audit / Telemetry
```

Potential LangChain middleware to evaluate:

```text
ModelCallLimitMiddleware
ToolCallLimitMiddleware
ModelFallbackMiddleware
LLMToolSelectorMiddleware
ToolRetryMiddleware
ContextEditingMiddleware
SummarizationMiddleware
HumanInTheLoopMiddleware
```

Use only where they improve the current architecture.

Do not install middleware merely because it exists.

---

# 23. Tool Selector

Pao-hubPro may eventually expose hundreds of tools.

Sending every schema to every model call is wasteful and can reduce tool-selection quality.

Use a two-stage strategy:

```text
Policy Filter
      |
      v
Allowed Tool Set
      |
      v
Semantic / LLM Tool Selector
      |
      v
Small Relevant Tool Set
      |
      v
Main Agent Model
```

The tool selector may optimize relevance.

It must never override permissions.

---

# 24. Human-in-the-Loop

High-risk actions must be interruptible.

Examples:

```text
delete file
overwrite important file
push to Git
merge PR
deploy production
stop server
destroy cloud instance
spend above configured threshold
publish content
submit Adobe Stock assets
send external messages
```

Workflow:

```text
Agent requests action
      |
      v
Risk classifier
      |
      +-- low -> continue
      |
      +-- high
             |
             v
        create approval
             |
             v
       pause checkpoint
             |
             v
     user approves/rejects
             |
             v
           resume
```

Do not emulate approval by asking the model to "be careful."

Approval must be represented in runtime state.

---

# 25. Structured Output

Use structured output for machine-consumed decisions.

Examples:

```text
planner decisions
tool routing
risk assessment
review result
stock QC
deployment decision
task decomposition
final job status
```

Example schema:

```python
class AgentDecision(BaseModel):
    action: str
    reason: str
    risk: str
    tools: list[str]
    requires_approval: bool
```

Avoid parsing free-form natural language with regex when a schema can be used.

All structured responses must be validated.

Invalid output should follow a bounded repair/retry path.

---

# 26. State Model

Create explicit run state.

Suggested logical fields:

```text
run_id
session_id
workspace_id
user_id
status
task
messages
plan
current_step
selected_model
allowed_tools
tool_history
approval_state
budget
cost
errors
artifacts
structured_result
checkpoint_version
```

Do not put secrets in persistent graph state.

Use secret references where necessary.

---

# 27. Checkpoint and Resume

Long-running Pao workflows must survive interruption.

Examples:

```text
coding task
large research job
100-image batch
video generation
Runpod job
browser automation
Reviewer Council
multi-step publishing
```

Required behavior:

```text
run
 -> checkpoint
 -> process restart
 -> reload state
 -> continue
```

Where a tool call is not idempotent, store enough execution metadata to avoid accidental duplicate effects.

---

# 28. Idempotency

Before retrying or resuming side-effecting operations, identify:

```text
operation id
tool call id
external job id
commit SHA
upload id
submission id
deployment id
notification event id
```

Do not repeat an external side effect simply because the graph resumed.

Examples:

```text
do not upload same stock asset twice
do not deploy twice
do not send same notification repeatedly
do not start duplicate Runpod jobs
```

---

# 29. Reviewer Council Integration

Implement Reviewer Council as a reusable orchestration component.

Conceptual graph:

```text
                Planner / Supervisor
                        |
          +-------------+-------------+
          |             |             |
          v             v             v
       Coder         Reviewer      Researcher
          |             |             |
          v             v             v
       Codex          Model B       Model C
          |             |             |
          +-------------+-------------+
                        |
                        v
                    Judge
                        |
                        v
                Structured Decision
```

Possible review dimensions:

```text
correctness
security
maintainability
policy
cost
regression risk
test quality
```

The Judge must receive normalized outputs.

Do not let one reviewer silently overwrite another.

---

# 30. Codex Integration

Codex remains the preferred specialist for repository coding work when configured.

Possible orchestration:

```text
User task
   |
   v
LangChain Supervisor
   |
   +-- inspect project
   +-- determine coding required
   |
   v
Codex Tool / Runtime Adapter
   |
   v
Codex performs coding task
   |
   v
Tests / Diff / Result
   |
   v
Reviewer Council
   |
   v
Supervisor
```

Never let the agent send arbitrary unrestricted shell commands to simulate Codex if a safe Codex runtime already exists.

---

# 31. Browser Integration

Browser automation remains behind a controlled tool/MCP boundary.

The agent may request actions such as:

```text
navigate
search
extract
click
type
download
```

but browser permissions and domain policy remain Pao-owned.

Add:

```text
domain allow/deny policy
download handling
credential boundary
session isolation
timeout
audit
```

Never inject browser cookies or secrets directly into prompts.

---

# 32. ComfyUI / AI Generation Integration

LangChain may orchestrate generation jobs.

Example:

```text
Stock Planner
   |
   v
Prompt Builder
   |
   v
ComfyUI MCP
   |
   v
Generation Job
   |
   v
QC
   |
   v
Reviewer Council
   |
   v
Metadata
   |
   v
Export
```

Agent orchestration should manage state and decisions.

ComfyUI remains responsible for generation execution.

---

# 33. Runpod Integration

Treat Runpod jobs as external stateful jobs.

Store:

```text
provider job id
pod id
status
GPU class
start time
stop time
cost metadata if available
```

Approval may be required for expensive operations.

Do not allow the LLM to create unlimited GPU jobs.

Enforce Pao-side budget and concurrency limits.

---

# 34. Notification Gateway Integration

Use the existing unified notification infrastructure.

Agent runtimes emit events such as:

```text
agent.run.started
agent.run.waiting_approval
agent.run.resumed
agent.run.completed
agent.run.failed
agent.budget.warning
agent.tool.denied
agent.model.fallback
```

Do not let LangChain agents call Discord/Telegram directly.

Correct:

```text
Agent Runtime
  -> Pao Event
  -> Notification Gateway
  -> provider adapter
```

---

# 35. Event Model

Define normalized orchestration events.

Examples:

```text
agent.run.created
agent.run.started
agent.model.called
agent.model.fallback
agent.tool.selected
agent.tool.requested
agent.tool.allowed
agent.tool.denied
agent.tool.started
agent.tool.completed
agent.tool.failed
agent.approval.requested
agent.approval.approved
agent.approval.rejected
agent.checkpoint.saved
agent.run.resumed
agent.run.completed
agent.run.failed
agent.run.cancelled
```

Events must carry IDs, not secrets.

---

# 36. Audit Trail

Every production run should be reconstructable.

Audit fields should include where applicable:

```text
run_id
session_id
workspace_id
actor
runtime
agent
model
provider
tool
MCP server
policy decision
approval
duration
result status
token usage
estimated cost
error category
timestamp
```

Sensitive tool arguments may need redaction.

Never log:

```text
API keys
authorization headers
MCP secrets
cookies
raw passwords
webhook tokens
```

---

# 37. Observability

Add metrics around:

```text
run count
success rate
failure rate
model latency
tool latency
model fallback count
tool denial count
approval count
checkpoint count
resume count
tokens
cost
timeout count
loop prevention count
```

If the project already has observability infrastructure:

```text
integrate with it
do not create a second isolated telemetry stack
```

---

# 38. Error Taxonomy

Normalize errors.

Suggested categories:

```text
MODEL_AUTH
MODEL_RATE_LIMIT
MODEL_TIMEOUT
MODEL_PROVIDER
TOOL_DENIED
TOOL_VALIDATION
TOOL_TIMEOUT
TOOL_EXECUTION
MCP_CONNECTION
MCP_PROTOCOL
MCP_TOOL_NOT_FOUND
APPROVAL_REJECTED
BUDGET_EXCEEDED
RUN_TIMEOUT
CHECKPOINT
CANCELLED
INTERNAL
```

Do not expose raw internal stack traces to normal users.

Preserve detailed errors in secure diagnostic logs.

---

# 39. Retry Policy

Retry only retryable failures.

Examples:

```text
temporary provider timeout -> retry
temporary MCP disconnect   -> retry
rate limit                 -> bounded backoff
invalid credentials        -> no blind retry
tool denied                -> no retry
approval rejected          -> no retry
invalid destructive path   -> no retry
```

Use:

```text
bounded attempts
exponential backoff
jitter
overall deadline
```

---

# 40. Context Management

Long-running agents require bounded context.

Possible strategy:

```text
recent conversation
+
persistent task state
+
selected important artifacts
+
summary of old history
```

Do not continually append unlimited tool output.

Large tool outputs should be:

```text
stored as artifacts
summarized
referenced by ID/path
```

not copied into every model request.

---

# 41. Prompt Boundary

Keep prompts versioned.

Recommended:

```text
prompts/
  supervisor/
  planner/
  reviewer/
  judge/
```

Each prompt should have:

```text
name
version
role
expected tools
expected output schema
```

Do not hide critical security rules only in prompts.

Security must be executable policy.

---

# 42. Feature Flags

Introduce Phase 20.22 safely.

Recommended feature flags:

```text
LANGCHAIN_RUNTIME_ENABLED
LANGCHAIN_RUNTIME_DEFAULT
LANGCHAIN_MCP_ENABLED
LANGCHAIN_REVIEWER_COUNCIL_ENABLED
```

Names may follow existing project conventions.

Initial rollout:

```text
off by default
 -> local development
 -> integration tests
 -> opt-in workflow
 -> selected production workflow
 -> wider default
```

Do not perform a flag-day migration.

---

# 43. API Surface

If Pao-hubPro already has agent/job APIs, extend them.

Otherwise provide normalized endpoints conceptually similar to:

```text
POST /api/agents/runs
GET  /api/agents/runs/{run_id}
POST /api/agents/runs/{run_id}/resume
POST /api/agents/runs/{run_id}/cancel
GET  /api/agents/runs/{run_id}/events
```

Approval endpoints may be separate.

Do not expose LangChain internal graph objects over API.

---

# 44. Streaming

Support streaming when useful.

Possible stream events:

```text
run_started
model_delta
tool_requested
tool_started
tool_completed
approval_required
status_changed
final
error
```

Filter internal chain-of-thought or hidden reasoning.

Never expose private model reasoning.

Expose only safe user-facing progress and structured execution events.

---

# 45. Web Dashboard

Add or extend the Pao-hubPro dashboard.

Recommended run view:

```text
Run ID
Task
Status
Runtime
Model
Provider
Current step
Tools used
Approvals
Duration
Token usage
Estimated cost
Errors
Artifacts
Timeline
```

Add runtime selector only if it is useful to the user.

Default users should not need to understand LangChain internals.

---

# 46. Agent Timeline UI

Recommended timeline:

```text
00:00 Run started
00:01 Planner selected model
00:02 Tools filtered 31 -> 8
00:03 Codex requested
00:03 Approval not required
00:04 Codex started
00:21 Codex completed
00:22 Tests completed
00:23 Reviewer started
00:31 Review passed
00:32 Run completed
```

This should be based on Pao events.

Do not reconstruct history only from logs.

---

# 47. Security Requirements

Mandatory:

```text
no raw unrestricted shell
no unrestricted filesystem
no secrets in prompts
no secrets in graph checkpoints
no authorization delegated to model
no approval delegated to model
no provider fallback across forbidden boundaries
no invisible destructive actions
no unlimited loops
no unlimited cost
no cross-workspace state leak
no raw stack traces in user UI
```

---

# 48. Threat Scenarios

Test at least:

```text
prompt injection asks for forbidden tool
tool output contains malicious instructions
MCP server advertises dangerous new tool
model repeatedly requests denied tool
path traversal
symlink escape
shell injection
secret exfiltration attempt
cross-workspace resource access
provider fallback violates privacy rule
resume repeats destructive side effect
agent loop causes cost spike
MCP server disconnects mid-run
approval state is forged
```

---

# 49. MCP Trust Levels

Classify MCP servers.

Example:

```text
trusted_internal
trusted_local
approved_third_party
untrusted_external
```

Trust level may influence:

```text
allowed tools
approval requirements
network access
result sanitization
logging
timeout
```

Do not automatically trust a tool just because it comes from MCP.

MCP is a protocol, not a trust guarantee.

---

# 50. Tool Risk Classification

Suggested risk classes:

```text
R0 = read-only harmless
R1 = low-impact write
R2 = meaningful side effect
R3 = destructive / external publish / money / production
R4 = highly privileged
```

Examples:

```text
read project file       -> R0
write generated draft   -> R1
commit code             -> R2
deploy production       -> R3
delete infrastructure   -> R4
```

Approval policy should be configurable.

---

# 51. Reviewer Council Policy

Not every run needs multiple reviewers.

Use Reviewer Council when:

```text
security-sensitive change
large refactor
production deployment
high-value generation batch
important publishing action
ambiguous implementation decision
```

Skip or reduce reviewers for trivial low-risk tasks.

This controls latency and cost.

---

# 52. Cost Controls

At minimum track:

```text
model calls
tokens where available
provider
runtime duration
external job cost when available
```

Support configurable limits:

```text
per run
per workspace
per day
per provider
```

When budget threshold is reached:

```text
warn
degrade model
pause for approval
or terminate
```

depending on policy.

Never silently exceed configured hard limits.

---

# 53. Configuration

All configuration must be environment/config driven.

Do not hard-code:

```text
provider API keys
model names
MCP URLs
tokens
workspace paths
approval thresholds
budgets
```

Suggested logical configuration groups:

```text
orchestration
models
mcp
policy
limits
checkpoint
telemetry
reviewer_council
```

---

# 54. Secrets

Secrets remain in the existing secret/config infrastructure.

Agents may receive:

```text
secret reference
capability
credential-bound tool
```

They should not receive raw secrets unless technically unavoidable.

Redact secrets from:

```text
logs
events
checkpoint state
tool errors
dashboard
model messages
```

---

# 55. Database / Persistence

Inspect the current persistence model before modifying anything.

Prefer additive migrations.

Possible tables/entities only if equivalent storage does not already exist:

```text
agent_runs
agent_events
agent_checkpoints
agent_approvals
agent_tool_calls
agent_usage
```

Do not create redundant tables when the existing job/audit/event store can be extended.

No destructive migration.

---

# 56. Backward Compatibility

Existing flows must continue working when Phase 20.22 is disabled.

Required:

```text
feature flag off
    ->
existing runtime works unchanged
```

If LangChain initialization fails:

```text
system startup should degrade gracefully
```

unless LangChain is explicitly configured as mandatory.

---

# 57. Unit Tests

Add tests for:

```text
runtime contract
agent factory
model routing
fallback policy
model limits
tool limits
MCP tool discovery
MCP tool filtering
tool policy
approval
structured output
checkpoint/resume
idempotency
error mapping
event emission
secret redaction
```

Mock external providers.

Unit tests must not require paid model calls.

---

# 58. Integration Tests

Create controlled integration tests.

Minimum scenarios:

```text
simple agent answer
read-only MCP tool
denied MCP tool
approval-required tool
structured output
model fallback
checkpoint/resume
MCP disconnect
tool retry
run timeout
cancel
Reviewer Council mock
Codex adapter mock
```

Real-provider tests must be opt-in.

---

# 59. Test — Simple Agent

Input:

```text
"Summarize this project status."
```

Expected:

```text
agent created
approved model selected
no unnecessary tool calls
normalized final result
audit event produced
```

---

# 60. Test — Tool Policy

Expose mock tools:

```text
read_status
delete_project
```

Policy:

```text
read_status = allow
delete_project = deny
```

Prompt attempts to force deletion.

Expected:

```text
delete_project never executes
policy denial is audited
agent cannot override denial
```

---

# 61. Test — Human Approval

Mock tool:

```text
deploy_production
```

Expected:

```text
tool requested
run becomes waiting_approval
checkpoint saved
no deployment yet
approve
run resumes
tool executes once
run completes
```

Reject path:

```text
reject
 -> tool not executed
 -> run completes safely or terminates according to policy
```

---

# 62. Test — MCP Discovery

Connect to a controlled mock MCP server.

Expected:

```text
server discovered
tools normalized
metadata preserved
Pao policy applied
only approved tools reach agent
```

If server later adds a dangerous tool:

```text
new tool is not automatically granted
```

---

# 63. Test — Model Fallback

Primary model returns transient error.

Expected:

```text
failure classified
allowed fallback selected
audit event emitted
run completes
```

Then configure fallback provider as forbidden.

Expected:

```text
no forbidden fallback
run fails/degrades according to policy
```

---

# 64. Test — Loop Protection

Mock model repeatedly calls same tool.

Expected:

```text
tool call limit reached
loop terminated
clear error/status
cost remains bounded
```

---

# 65. Test — Checkpoint Resume

Flow:

```text
step A
step B
approval interrupt
process restart
resume
step C
```

Expected:

```text
state restored
A and B are not repeated unnecessarily
side effects are not duplicated
C completes
```

---

# 66. Test — Secret Redaction

Inject fake secrets into:

```text
environment
tool credential
provider config
```

Expected absent from:

```text
API response
dashboard events
normal logs
checkpoint
model-visible messages unless explicitly required
```

---

# 67. Test — Codex Delegation

Mock coding task.

Expected:

```text
Supervisor identifies coding need
Codex adapter invoked
Codex result normalized
tests/review path runs
final response includes outcome
```

LangChain must not directly replace the safe Codex runtime with an unrestricted shell.

---

# 68. Test — Reviewer Council

Mock:

```text
Coder -> proposal
Reviewer A -> pass
Reviewer B -> finds security problem
Judge -> reject/change required
```

Expected:

```text
all opinions preserved
Judge produces structured decision
security finding is visible
unsafe change is not auto-promoted
```

---

# 69. Performance Requirements

Avoid unnecessary overhead.

Measure:

```text
agent creation latency
tool discovery latency
model routing overhead
checkpoint latency
event overhead
tool selector overhead
```

Cache safe metadata such as:

```text
MCP tool schemas
provider capability metadata
prompt templates
```

but support refresh/invalidation.

---

# 70. Developer Experience

Provide clear local developer commands using the repository's existing tooling.

Add documentation for:

```text
enable runtime
configure provider
configure MCP server
run demo agent
run tests
inspect run
approve/reject action
disable runtime
```

Do not require manual code edits for normal configuration.

---

# 71. Documentation

Create or update:

```text
docs/architecture/agent-orchestration.md
docs/integrations/langchain.md
docs/security/agent-tool-policy.md
```

or equivalent existing documentation locations.

Document:

```text
why LangChain is an adapter
why Pao owns security
how MCP is filtered
how approvals work
how to add a provider
how to add an MCP server
how to add middleware
how to test
how to disable the runtime
```

---

# 72. AGENTS.md / Codex Guidance

If the repository has `AGENTS.md`, extend it.

Add rules such as:

```text
Do not bypass AgentRuntime interfaces.
Do not call unrestricted shell from LangChain production agents.
Do not expose raw secrets to model context.
Do not skip Pao policy when adapting MCP tools.
Do not perform destructive migrations without explicit instruction.
Add tests for new orchestration behavior.
Preserve feature-flag rollback.
```

If no `AGENTS.md` exists, create one only if consistent with repository conventions.

---

# 73. Implementation Sequence

Codex should implement in this order:

```text
1. Inspect repository
2. Identify existing runtimes, MCP, policy, audit, config, jobs
3. Write architecture note
4. Add dependencies safely
5. Add AgentRuntime contract
6. Add LangChain adapter
7. Add model router adapter
8. Add MCP tool provider
9. Add policy middleware
10. Add limits
11. Add structured output
12. Add checkpoint/resume
13. Add approval bridge
14. Add events/audit
15. Add Reviewer Council adapter
16. Integrate Codex delegation
17. Add API/dashboard integration where existing architecture supports it
18. Add tests
19. Run lint/typecheck/tests
20. Fix regressions
21. Produce implementation report
```

Do not start by rewriting application entrypoints.

---

# 74. Codex One-Shot Execution Prompt

Copy this entire section into Codex if executing manually:

```text
You are implementing Phase 20.22 of Pao-hubPro.

Goal:
Integrate LangChain/LangGraph as a pluggable Agent Orchestration & MCP Runtime Layer while preserving Pao-hubPro as the security, authorization, policy, approval, audit, cost, workspace, and execution boundary.

Primary upstream reference:
https://github.com/langchain-ai/langchain

Important current API direction:
- Prefer the modern LangChain agent API (`langchain.agents.create_agent`) where compatible.
- Prefer the current first-party LangChain MCP integration (`langchain.mcp`) when available in the stable compatible release.
- Do not force a prerelease only to obtain MCP support.
- Hide all LangChain/MCP version differences behind Pao-owned adapters.
- Use LangGraph for state/checkpoint/resume where appropriate.

FIRST: inspect the entire repository before modifying anything.

Identify:
- project language/runtime
- package manager
- application entrypoints
- existing agent/runtime abstraction
- Codex runtime
- MCP server/client/registry
- safe file tools
- safe command tools
- authentication/authorization
- policy/approval system
- audit/event system
- job/session model
- configuration
- database/migrations
- API
- dashboard
- tests
- AGENTS.md or equivalent engineering instructions

Then produce a short internal implementation map before writing code.

DO NOT:
- rewrite working architecture unnecessarily
- replace Codex
- replace working MCP servers
- expose unrestricted shell
- expose unrestricted filesystem
- place secrets in prompts/checkpoints/logs
- let LangChain become the security boundary
- let model output override permissions
- hard-code providers
- hard-code MCP URLs
- perform destructive migrations
- delete the old runtime
- force all workflows to LangChain
- bypass existing audit or notification infrastructure

ARCHITECTURE:

User/API/Dashboard
 -> Pao-hubPro Control Plane
 -> Auth/Policy/Budget/Approval
 -> Pao AgentRuntime interface
 -> LangChain Runtime adapter
 -> LangChain create_agent / LangGraph
 -> Pao MCP Tool Provider
 -> Pao MCP Gateway
 -> approved MCP tools/services

Create or extend a Pao-owned AgentRuntime interface with run/stream/resume/cancel/state capabilities as appropriate to the existing codebase.

Create a LangChain runtime adapter behind that interface.

Create a PaoAgentFactory responsible for:
- model selection
- allowed tool resolution
- middleware
- limits
- structured output
- checkpoint/state
- run metadata

Create/extend a provider-neutral Model Router.
Do not put provider names in business workflows.

Create PaoMCPToolProvider:
- connect through existing MCP infrastructure where possible
- discover tools
- preserve useful metadata
- apply Pao policy BEFORE exposing tools to the agent
- normalize tools into LangChain-compatible tools
- manage connection lifecycle
- support multiple servers
- cache metadata safely
- refresh safely

MCP IS NOT A TRUST BOUNDARY.
Never grant a tool merely because an MCP server advertises it.

Implement a tool policy path:
tool request
 -> normalize
 -> policy
 -> ALLOW / DENY / APPROVAL_REQUIRED
 -> execute only when allowed

Reuse existing safe filesystem and command execution layers.
Do NOT replace them with generic unrestricted LangChain filesystem or shell middleware.

Add bounded:
- model call limit
- tool call limit
- repeated-call/loop protection
- execution timeout
- retry policy
- cost/token budget where available

Evaluate LangChain middleware such as:
- ModelCallLimitMiddleware
- ToolCallLimitMiddleware
- ModelFallbackMiddleware
- LLMToolSelectorMiddleware
- ToolRetryMiddleware
- ContextEditingMiddleware
- SummarizationMiddleware
- HumanInTheLoopMiddleware

Use only what fits the architecture.
Critical controls must also exist at the Pao layer.

Implement human approval for high-risk side effects using real runtime state/checkpoint interrupts, not prompt-only warnings.

Implement structured output for machine-consumed decisions using validated schemas.

Implement normalized state, events, and results that do not expose LangChain internal types to API/domain code.

Implement checkpoint/resume for long-running workflows.
Protect against duplicate side effects using idempotency identifiers.

Integrate Reviewer Council as a reusable orchestration graph/component where the codebase supports it.

Preserve the previous Codex runtime.
LangChain may delegate coding work to Codex through a controlled adapter/tool, then feed normalized results into tests/review.

Integrate with the existing notification/event infrastructure by emitting normalized events such as:
- agent.run.started
- agent.run.waiting_approval
- agent.run.completed
- agent.run.failed
- agent.model.fallback
- agent.tool.denied

Do not call Discord/Telegram directly from the agent runtime.

Add feature flags so the LangChain runtime can be disabled without breaking the existing runtime.

Add/extend API and dashboard only in ways consistent with the existing repository.

Security requirements:
- workspace isolation
- canonical path boundaries
- command policy
- no secret leakage
- approval for destructive/high-impact actions
- no forbidden provider fallback
- no cross-workspace access
- redacted logs
- bounded retries
- bounded cost
- bounded loops

Add tests for:
1. runtime contract
2. simple agent run
3. MCP discovery
4. policy filtering
5. denied tool
6. approval-required tool
7. model fallback
8. model-call limit
9. tool-call limit
10. loop protection
11. structured output
12. checkpoint/resume
13. idempotency
14. secret redaction
15. Codex delegation
16. Reviewer Council
17. MCP disconnect
18. cancellation
19. timeout
20. feature-flag rollback

Tests must use mocks/fakes by default and must not require paid API calls.

Run the repository's existing:
- formatter
- lint
- type checker
- unit tests
- integration tests that are safe/local

Fix all regressions caused by this phase.

At completion, output:
1. architecture discovered
2. files created
3. files modified
4. dependencies changed
5. migrations added
6. feature flags
7. security controls
8. tests added
9. commands/tests executed
10. pass/fail results
11. known limitations
12. exact manual steps still required
13. recommended next phase

Do not claim success for anything not actually implemented or tested.
```

---

# 75. Acceptance Checklist

Phase 20.22 is complete only if:

```text
[ ] repository inspected before implementation
[ ] working architecture preserved
[ ] AgentRuntime abstraction exists or equivalent is extended
[ ] LangChain runtime is behind adapter boundary
[ ] modern create_agent API used where compatible
[ ] MCP integration hidden behind Pao provider
[ ] tools filtered before model access
[ ] Pao remains security boundary
[ ] unrestricted shell is not exposed
[ ] unrestricted filesystem is not exposed
[ ] model call limit exists
[ ] tool call limit exists
[ ] loop protection exists
[ ] retry policy is bounded
[ ] model fallback respects provider policy
[ ] structured output validated
[ ] approval can pause/resume
[ ] checkpoint/resume tested
[ ] side-effect idempotency considered/tested
[ ] Codex runtime preserved
[ ] Reviewer Council path integrated or adapter prepared
[ ] events/audit emitted
[ ] secrets redacted
[ ] feature flag rollback works
[ ] unit tests pass
[ ] safe integration tests pass
[ ] lint/typecheck pass
[ ] documentation updated
[ ] implementation report produced
```

---

# 76. Definition of Success

Phase 20.22 succeeds when Pao-hubPro can execute a workflow such as:

```text
User:
"Review this project, use Codex to fix the issue, run tests,
have another model review the change, and ask me before deployment."
```

and internally perform:

```text
Request
  |
  v
Pao Auth / Policy
  |
  v
LangChain Supervisor
  |
  v
Tool Policy
  |
  +-- inspect repository
  |
  +-- delegate coding to Codex
  |
  +-- collect result
  |
  +-- run safe tests
  |
  +-- Reviewer Council
  |
  +-- structured decision
  |
  +-- deployment requested
  |
  v
Approval Interrupt
  |
  v
Checkpoint
  |
  v
User Approves
  |
  v
Resume
  |
  v
Controlled Deployment Tool
  |
  v
Audit / Events / Notification
  |
  v
Completed
```

without:

```text
unrestricted shell
permission bypass
secret exposure
duplicate deployment
unbounded model loop
unbounded tool loop
forbidden provider fallback
lost run after restart
hidden high-risk action
LangChain types leaking through all domain layers
hard dependency that prevents runtime rollback
```

---

# 77. Recommended Rollout

Roll out in this order:

```text
Stage 1
Local mock agent
No external side effects

Stage 2
Read-only MCP tools

Stage 3
Codex delegation
Safe repository operations

Stage 4
Reviewer Council

Stage 5
Approval-controlled write tools

Stage 6
Selected production workflow

Stage 7
Broader default runtime
```

Do not begin with production deployment automation.

---

# 78. Future Follow-Ups After Phase 20.22

Potential next phases:

```text
Phase 20.22.1 — LangGraph Durable Workflow Persistence
Phase 20.22.2 — Dynamic MCP Capability Registry
Phase 20.22.3 — Agent Cost & Token Governance
Phase 20.22.4 — Reviewer Council Production Runtime
Phase 20.22.5 — Human Approval Center
Phase 20.22.6 — Agent Observability Dashboard
Phase 20.22.7 — Semantic Tool Router
Phase 20.22.8 — Multi-Agent Supervisor Templates
Phase 20.22.9 — Agent Evaluation & Regression Harness
Phase 20.22.10 — Runtime Benchmark: Native vs LangChain vs Codex
```

Recommended next logical extension:

```text
Phase 20.22.1 — LangGraph Durable Workflow Persistence
```

if persistence/checkpoint infrastructure is still basic after this phase.

If durable persistence already exists, prioritize:

```text
Phase 20.22.9 — Agent Evaluation & Regression Harness
```

to prevent orchestration changes from silently reducing quality.

---

# 79. Final Phase Statement

**Phase 20.22 converts Pao-hubPro from a collection of AI integrations into a pluggable agent orchestration control plane.**

The key architecture is:

```text
Pao-hubPro
   owns
security
policy
approval
audit
budget
workspace
execution boundaries

LangChain / LangGraph
   owns
agent orchestration
stateful decision flow
tool coordination
structured model interaction

MCP
   owns
standardized capability transport

Codex
   owns
specialist coding execution
```

The strategic outcome is:

```text
Pao-hubPro
      becomes
Agent-Native MCP Control Plane
```

without surrendering control of security or infrastructure to the orchestration framework.

---

# 80. Upstream References

```text
LangChain:
https://github.com/langchain-ai/langchain

LangChain Python Reference:
https://reference.langchain.com/python/langchain/

create_agent:
https://reference.langchain.com/python/langchain/agents/factory/create_agent

Middleware:
https://reference.langchain.com/python/langchain/middleware

LangGraph:
https://github.com/langchain-ai/langgraph
```

Before implementation, Codex should verify the exact current stable APIs and dependency compatibility from upstream documentation and the repository lockfile.

---

**END OF PHASE 20.22**
