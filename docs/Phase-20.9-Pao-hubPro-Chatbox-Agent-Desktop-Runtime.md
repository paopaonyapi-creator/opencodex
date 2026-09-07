# Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime

> **Codex One-Shot Implementation Specification**
>
> เป้าหมาย: ยกระดับ Pao-hubPro จาก MCP/AI Hub ให้เป็น **Desktop Agent Operating Layer** ที่รองรับ Multi-Model, MCP, Skills, Safe Local Sandbox, Workspace Policy, Tool Approval และ AI Reviewer Council โดยศึกษาแนวคิดเชิงสถาปัตยกรรมจาก Chatbox แต่ **ห้ามคัดลอก source code ของ Chatbox** หรือโค้ด GPLv3 เข้ามาในโปรเจกต์

---

## 0. คำสั่งหลักสำหรับ Codex

คุณคือ Principal Software Architect + Senior Full-Stack Engineer + AI Agent Infrastructure Engineer

ให้พัฒนา **Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime** ใน repository Pao-hubPro ปัจจุบันแบบ production-ready

### กฎสำคัญ

1. ตรวจ repository ปัจจุบันทั้งหมดก่อนแก้ไข
2. รักษาความสามารถจาก Phase ก่อนหน้า
3. ห้าม rewrite ระบบเดิมโดยไม่จำเป็น
4. ใช้ architecture แบบ modular และ extensible
5. ห้าม copy source code จาก `chatboxai/chatbox`
6. ใช้ Chatbox เป็น architectural reference เท่านั้น
7. ห้ามเพิ่ม dependency ที่ไม่จำเป็น
8. secrets ต้องไม่ถูก commit
9. destructive action ต้องมี approval
10. ทุก tool execution ต้องมี audit trail
11. ทุก external input ถือเป็น untrusted
12. เพิ่ม automated tests สำหรับ critical security path
13. หลัง implementation ต้อง lint + typecheck + test + build
14. ถ้าพบ architecture เดิมที่ชื่อหรือโครงสร้างต่างจากเอกสารนี้ ให้ adapt เข้ากับของเดิม ไม่สร้างระบบซ้ำซ้อน

---

# 1. Mission

สร้าง runtime กลาง:

```text
User
  ↓
Pao Desktop / Web UI
  ↓
Agent Runtime
  ↓
Orchestrator
  ├── Provider Registry
  ├── Skill Registry
  ├── MCP Registry
  ├── Built-in Tools
  ├── Knowledge/RAG
  └── Reviewer Council
          ↓
      Policy Engine
          ↓
     Approval Gateway
          ↓
      Execution Layer
      ├── Safe Sandbox
      ├── Local MCP
      ├── Remote MCP
      ├── ComfyUI
      ├── RunPod
      └── Other approved services
          ↓
       Audit Log
```

Pao-hubPro ต้องเป็นคนควบคุมว่า AI:

- เห็น tool อะไร
- เรียก tool ไหนได้
- argument แบบใดผ่านได้
- action ไหนต้องถามผู้ใช้
- action ไหนห้ามทำ
- process ใดเปิดได้
- path ใดอ่าน/เขียนได้
- environment variable ใดเปิดเผยได้

---

# 2. Agent Modes

เพิ่ม Agent Mode อย่างน้อย 4 ระดับ

```ts
type AgentMode =
  | 'off'
  | 'ask'
  | 'safe_auto'
  | 'full_auto'
```

## OFF

- ไม่มี autonomous tool execution
- AI ใช้ตอบ/วิเคราะห์อย่างเดียว

## ASK

- tool ที่มี side effect ต้องขอ approval
- read-only tool อาจอนุญาตตาม policy

## SAFE AUTO

อนุญาตอัตโนมัติเฉพาะ:

- read workspace
- search
- inspect
- lint
- typecheck
- test ที่อยู่ใน allowlist
- safe metadata operations

แต่ห้าม:

- delete
- overwrite sensitive files
- install arbitrary packages
- git push
- force push
- production deployment
- shell command นอก allowlist
- secret access

## FULL AUTO

ไม่ใช่ unrestricted mode

ต้องยังผ่าน:

```text
Policy Engine
→ Risk Classifier
→ Allowlist
→ Sandbox
→ Audit
```

critical action ยังต้อง approval เสมอ

---

# 3. Provider Registry

สร้าง abstraction กลางสำหรับ AI providers

```text
ProviderRegistry
├── OpenAIProvider
├── AnthropicProvider
├── GeminiProvider
├── OpenRouterProvider
├── OllamaProvider
├── LMStudioProvider
└── OpenAICompatibleProvider
```

interface ตัวอย่าง:

```ts
interface AIProvider {
  id: string
  name: string

  listModels(): Promise<ModelInfo[]>

  generate(request: GenerateRequest): Promise<GenerateResponse>

  stream(
    request: GenerateRequest
  ): AsyncIterable<StreamEvent>

  supportsTools(): boolean
  supportsVision(): boolean
  supportsStructuredOutput(): boolean
}
```

ห้ามกระจาย:

```ts
if (provider === ...)
```

ไปทั่ว codebase

ใช้ registry/factory/adapter ที่จุดเดียว

---

# 4. Model Capability Registry

แต่ละ model ต้องประกาศ capability เช่น:

```ts
interface ModelCapabilities {
  tools: boolean
  vision: boolean
  reasoning: boolean
  structuredOutput: boolean
  streaming: boolean
  maxContext?: number
}
```

Agent Runtime ต้องเลือก feature ตาม capability จริง

ห้าม assume ว่าทุก model รองรับ tool calling

---

# 5. Tool Registry

สร้าง unified Tool Registry

```text
ToolRegistry
├── BuiltInToolProvider
├── MCPToolProvider
├── SkillToolProvider
├── SandboxToolProvider
└── IntegrationToolProvider
```

Tool descriptor:

```ts
interface ToolDescriptor {
  id: string
  namespace: string
  name: string
  description: string
  inputSchema: unknown
  risk: ToolRisk
  source: ToolSource
  requiresApproval: boolean
}
```

ชื่อ tool ต้อง namespace ป้องกัน collision เช่น:

```text
builtin__read_file
builtin__search_workspace

mcp__comfyui__generate_image
mcp__runpod__start_pod
mcp__browser__navigate

skill__adobe_stock__validate_asset
```

---

# 6. Risk Classification

กำหนด:

```ts
type ToolRisk =
  | 'read_only'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
```

ตัวอย่าง:

### read_only

- read file
- list directory
- search
- git status

### low

- create temporary artifact
- run lint
- run unit test

### medium

- edit source file
- create normal project file
- package install จาก approved manifest

### high

- delete file
- external API write
- deploy
- git push
- modify system configuration

### critical

- force push
- destructive database operation
- credential manipulation
- arbitrary elevated shell
- disk/system destructive command

critical ห้าม auto-approve

---

# 7. MCP Runtime

รองรับ:

```text
MCP
├── stdio
└── remote
    ├── Streamable HTTP
    └── SSE compatibility
```

สร้าง:

```text
MCPManager
MCPServerRegistry
MCPConnectionManager
MCPToolAdapter
MCPHealthMonitor
```

server config ตัวอย่าง:

```yaml
servers:
  comfyui:
    transport: stdio
    command: node
    args:
      - ./servers/comfyui/index.js

  remote-service:
    transport: http
    url: https://example.com/mcp
```

---

# 8. MCP Security Gateway

**ห้าม spawn MCP stdio server จาก config โดยไม่ validate**

สร้าง:

```text
MCP Config
   ↓
Schema Validation
   ↓
Server Trust Check
   ↓
Command Allowlist
   ↓
Argument Validation
   ↓
Environment Filter
   ↓
Working Directory Restriction
   ↓
Spawn
```

ตรวจ:

- executable
- args
- cwd
- env
- server identity
- transport
- URL
- TLS
- timeout

block patterns ที่เสี่ยง เช่น:

```text
rm -rf
del /s
format
mkfs
shutdown
reboot
git push --force
powershell -EncodedCommand
curl ... | bash
wget ... | sh
```

อย่าพึ่ง regex อย่างเดียว ให้ใช้ structured command validation เมื่อทำได้

---

# 9. Safe Local Sandbox

สร้าง abstraction:

```ts
interface Sandbox {
  createSession(options: SandboxOptions): Promise<SandboxSession>
  exec(sessionId: string, request: ExecRequest): Promise<ExecResult>
  readFile(sessionId: string, path: string): Promise<string>
  writeFile(sessionId: string, path: string, content: string): Promise<void>
  destroySession(sessionId: string): Promise<void>
}
```

Sandbox policy:

- workspace-root isolation
- path canonicalization
- symlink escape protection
- timeout
- max output
- max process count
- environment filtering
- command allowlist
- resource limits เท่าที่ platform รองรับ
- session cleanup

AI ไม่ควรเห็น low-level sandbox API ทั้งหมด

เปิด abstraction เช่น:

```text
read_file
write_project_file
run_test
run_lint
execute_approved_task
```

---

# 10. Path Security

ก่อน read/write:

```text
input path
→ normalize
→ resolve
→ realpath/canonical path
→ workspace boundary check
→ symlink check
→ policy check
```

ป้องกัน:

```text
../../../
absolute path escape
symlink escape
UNC escape
drive traversal
```

เพิ่ม test สำหรับ path traversal โดยเฉพาะ

---

# 11. Environment & Secret Protection

สร้าง Secret Redaction Layer

ห้าม expose ค่าเช่น:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GITHUB_TOKEN
AWS_SECRET_ACCESS_KEY
DATABASE_URL
PRIVATE_KEY
```

Agent อาจรู้ว่า secret **มีอยู่** แต่ไม่ควรเห็น raw value หากไม่จำเป็น

audit log ต้อง redact secret ด้วย

---

# 12. Approval Gateway

สร้าง Human-in-the-Loop approval

flow:

```text
Tool Call
   ↓
Risk Evaluation
   ↓
Policy
   ↓
Need Approval?
   ├── No → Execute
   └── Yes
         ↓
     Approval UI
         ↓
    approve / reject
```

Approval card แสดง:

- Agent
- Model
- Tool
- Server
- Risk
- Arguments
- Files affected
- Command
- Working directory
- Reason
- Estimated side effects

buttons:

```text
Approve Once
Approve for Session
Reject
```

`Approve Always` ไม่ควรมีสำหรับ high/critical tools

---

# 13. Policy Engine

สร้าง policy engine แยกจาก UI

ไฟล์:

```text
.pao/
├── policies.yaml
├── tools.yaml
├── permissions.yaml
└── providers.yaml
```

ตัวอย่าง:

```yaml
agent:
  default_mode: ask

filesystem:
  allowed_roots:
    - .
  deny:
    - .env
    - secrets/
    - ~/.ssh/

git:
  allow_status: true
  allow_diff: true
  allow_commit: ask
  allow_push: ask
  allow_force_push: false

shell:
  default: deny
  allow:
    - npm test
    - npm run lint
    - npm run typecheck
```

---

# 14. AGENTS.md Workspace Instructions

รองรับ `AGENTS.md`

ค้นจาก workspace hierarchy และ resolve scope อย่าง deterministic

ตัวอย่าง:

```text
repo/
├── AGENTS.md
├── frontend/
│   ├── AGENTS.md
│   └── src/
└── backend/
```

เมื่อทำงานใน:

```text
frontend/src/
```

ต้องรวม instruction ที่เกี่ยวข้องตาม hierarchy โดย scope ที่ใกล้กว่า override กฎที่ override ได้

แต่:

**AGENTS.md ห้าม override security policy**

ลำดับ priority:

```text
Hard Security Policy
>
User Approval
>
Workspace Policy
>
Scoped AGENTS.md
>
Root AGENTS.md
>
Skill Instructions
>
Model Suggestion
```

---

# 15. Skills Runtime

สร้าง Skills Registry

```text
skills/
├── adobe-stock/
│   └── SKILL.md
├── comfyui/
│   └── SKILL.md
├── runpod/
│   └── SKILL.md
└── video-factory/
    └── SKILL.md
```

แต่ตอนเริ่ม conversation ห้าม inject SKILL.md ทั้งหมด

ใช้ progressive disclosure:

### Stage 1

ส่งแค่:

```json
{
  "name": "Adobe Stock",
  "description": "Production and validation workflow for Adobe Stock assets"
}
```

### Stage 2

เมื่อ Agent เลือก skill:

```text
load_skill("adobe-stock")
```

จึงโหลดรายละเอียด

เพิ่ม:

```text
SkillRegistry
SkillLoader
SkillValidator
SkillContextBuilder
```

---

# 16. Skill Security

Skill ถือเป็น untrusted instruction

Skill ห้าม:

- override hard policy
- อ่าน secret เอง
- bypass approval
- เปลี่ยน sandbox root
- เพิ่ม arbitrary executable
- auto-install unknown MCP server

ต้อง validate metadata ก่อน register

---

# 17. AI Reviewer Council Integration

ต่อ Phase Reviewer Council เดิมเข้ากับ runtime ใหม่

```text
Primary Agent
      ↓
Proposed Action
      ↓
Reviewer Council
├── OpenAI Reviewer
├── Claude Reviewer
├── Local Reviewer
└── Optional Additional Reviewer
      ↓
Review Aggregator
      ↓
Risk + Consensus
      ↓
Policy Engine
      ↓
Execution
```

Reviewer output schema:

```ts
interface ReviewResult {
  reviewer: string
  approve: boolean
  confidence: number
  risk: ToolRisk
  concerns: string[]
  recommendations: string[]
}
```

Aggregator:

```ts
interface CouncilDecision {
  decision: 'approve' | 'reject' | 'human_review'
  confidence: number
  risk: ToolRisk
  reasons: string[]
}
```

---

# 18. Reviewer Council Trigger

อย่า review ทุก action เพราะช้าและแพง

trigger เมื่อ:

- high risk
- critical
- large code modification
- deployment
- dependency/security change
- database migration
- architecture change
- user เปิด strict review mode

read-only operation ไม่จำเป็นต้อง council

---

# 19. Knowledge / RAG Layer

สร้าง interface เพื่อรองรับ knowledge source ในอนาคต

```ts
interface KnowledgeProvider {
  search(query: string, options?: SearchOptions): Promise<KnowledgeResult[]>
}
```

sources อาจเป็น:

```text
Workspace
Docs
Markdown
Project Notes
Adobe Stock Knowledge
Pao-hubPro Specs
```

อย่าผูก Agent Runtime กับ vector DB vendor ตัวเดียว

---

# 20. Context Builder

สร้าง central ContextBuilder

รับ:

```text
System Rules
Workspace Policy
AGENTS.md
Relevant Skills
Knowledge Results
Tool Metadata
Conversation
Task State
```

และสร้าง model request

ต้องมี token-budget management

อย่า inject:

- tool definitions ที่ไม่เกี่ยวข้อง
- skill bodies ทั้งหมด
- knowledge ทั้ง database
- audit history ทั้งหมด

---

# 21. Tool Selection

เพิ่ม tool filtering ก่อนส่ง model

```text
All Tools
   ↓
Agent Mode
   ↓
Provider Capability
   ↓
Workspace Policy
   ↓
Task Relevance
   ↓
Risk Rules
   ↓
Visible Tool Set
```

เป้าหมาย:

- ลด token
- ลด hallucinated tool call
- ลด attack surface

---

# 22. Agent Run State Machine

สร้าง explicit state machine เช่น:

```text
IDLE
 ↓
PLANNING
 ↓
WAITING_MODEL
 ↓
TOOL_PROPOSED
 ↓
POLICY_CHECK
 ↓
WAITING_APPROVAL
 ↓
EXECUTING
 ↓
OBSERVING
 ↓
REVIEWING
 ↓
COMPLETED
```

พร้อม:

```text
FAILED
CANCELLED
TIMEOUT
```

ห้ามพึ่ง boolean จำนวนมากจน state ขัดกัน

---

# 23. Cancellation

ผู้ใช้ต้องสามารถ:

```text
Stop Agent
```

แล้วระบบ:

1. abort model stream
2. cancel pending HTTP
3. terminate sandbox process ที่อนุญาต
4. mark pending tool call cancelled
5. cleanup resources
6. persist final audit state

---

# 24. Audit Log

ทุก run เก็บ:

```ts
interface AuditEvent {
  id: string
  timestamp: string
  runId: string
  actor: string
  eventType: string
  tool?: string
  risk?: ToolRisk
  status: string
  metadata?: Record<string, unknown>
}
```

events:

```text
RUN_STARTED
MODEL_REQUEST
MODEL_RESPONSE
TOOL_PROPOSED
POLICY_ALLOWED
POLICY_DENIED
APPROVAL_REQUESTED
APPROVAL_GRANTED
APPROVAL_REJECTED
TOOL_STARTED
TOOL_COMPLETED
TOOL_FAILED
COUNCIL_REVIEW
RUN_COMPLETED
RUN_CANCELLED
```

redact secrets ก่อน persist

---

# 25. UI — Agent Control Center

เพิ่มหน้า:

```text
Agent Control Center
```

sections:

```text
Agent Status
Current Model
Agent Mode
Active Skill
Connected MCP Servers
Available Tools
Pending Approval
Current Task
Execution Timeline
Reviewer Council
Audit Log
```

---

# 26. UI Style

ใช้ style เดิมของ Pao-hubPro เป็นหลัก

หากไม่มี design system ชัดเจน:

- clean
- minimal
- desktop-first
- responsive
- readable
- dark/light compatible
- ไม่ใส่ animation ที่ไม่จำเป็น

Agent status ต้องเห็นชัด:

```text
Idle
Thinking
Waiting Approval
Running Tool
Reviewing
Completed
Failed
```

---

# 27. MCP Manager UI

สร้าง:

```text
Settings
→ MCP Servers
```

แสดง:

- Name
- Transport
- Command/URL
- Status
- Trust
- Tools count
- Last connected
- Health
- Enable/Disable

actions:

```text
Add
Edit
Test Connection
Enable
Disable
Remove
View Tools
```

config ที่จะ spawn local process ต้องมี warning + validation

---

# 28. Provider Settings

หน้า:

```text
Settings
→ AI Providers
```

รองรับ:

- provider
- API endpoint
- model
- secret reference
- test connection
- capabilities

API key input ต้อง:

- masked
- ไม่ log
- ไม่ส่ง frontend telemetry
- เก็บผ่าน secure mechanism ที่ architecture ปัจจุบันรองรับ

---

# 29. Skills Manager

หน้า:

```text
Settings
→ Skills
```

แสดง:

- Name
- Description
- Version
- Source
- Enabled
- Validation status

actions:

```text
Enable
Disable
Inspect
Reload
```

---

# 30. Security Center

เพิ่ม:

```text
Settings
→ Security
```

แสดง:

```text
Agent Default Mode
Allowed Workspace Roots
Denied Paths
Shell Policy
MCP Trust Policy
Approval Policy
Secret Protection
Reviewer Council Threshold
Audit Retention
```

---

# 31. Recommended Project Structure

ปรับตาม repo จริงก่อน

ตัวอย่าง:

```text
src/
├── agent/
│   ├── runtime/
│   ├── state/
│   ├── context/
│   └── orchestrator/
│
├── providers/
│   ├── registry/
│   ├── openai/
│   ├── anthropic/
│   ├── gemini/
│   ├── ollama/
│   └── compatible/
│
├── tools/
│   ├── registry/
│   ├── builtin/
│   ├── adapters/
│   └── risk/
│
├── mcp/
│   ├── registry/
│   ├── transports/
│   ├── security/
│   └── health/
│
├── sandbox/
│
├── skills/
│
├── policy/
│
├── approval/
│
├── reviewer-council/
│
├── knowledge/
│
├── audit/
│
└── security/
```

อย่าสร้าง directory ซ้ำหาก repo มี equivalent อยู่แล้ว

---

# 32. Persistence

persist อย่างน้อย:

```text
Provider configuration
MCP configuration
Agent preferences
Workspace policy references
Skill enable state
Audit events
Approval history
```

ห้าม persist raw secrets ลง plaintext DB/config

---

# 33. Database Migration

ถ้าระบบมี database อยู่แล้ว ให้เพิ่ม migration

ตัวอย่าง entities:

```text
agent_runs
agent_events
tool_calls
tool_approvals
mcp_servers
skills
provider_configs
review_results
```

migration ต้อง:

- reversible เมื่อเหมาะสม
- ไม่ทำลายข้อมูลเดิม
- มี index ที่จำเป็น

---

# 34. Error Model

สร้าง typed errors:

```text
PolicyDeniedError
ApprovalRejectedError
ToolExecutionError
MCPConnectionError
SandboxViolationError
ProviderError
SkillValidationError
CouncilRejectedError
```

UI ต้องแสดงข้อความที่เข้าใจได้ แต่ไม่ leak secrets/internal stack

---

# 35. Observability

เพิ่ม structured logs

fields:

```text
runId
toolCallId
providerId
modelId
mcpServerId
risk
duration
status
```

ห้าม log:

```text
API key
Authorization header
cookie
private key
raw secret
```

---

# 36. Timeouts & Retries

กำหนด timeout แยก:

```text
Model request
MCP connection
MCP tool
Sandbox process
Reviewer
Knowledge search
```

retry เฉพาะ idempotent operation

ห้าม auto retry destructive action โดยไม่ประเมินผลจาก attempt แรก

---

# 37. Concurrency

ป้องกัน:

- tool call เดียว execute ซ้ำ
- approval double-submit
- agent run race
- simultaneous conflicting file writes

ใช้:

```text
toolCallId
idempotency key
run lock
execution status
```

ตามความเหมาะสม

---

# 38. Security Tests — Required

ต้องมี automated tests อย่างน้อยสำหรับ:

### Path

```text
../ escape
absolute escape
symlink escape
```

### Shell

```text
blocked executable
blocked args
command injection
```

### Secrets

```text
audit redaction
model-context redaction
error redaction
```

### Approval

```text
high risk waits for approval
rejected action never executes
critical cannot session-auto-approve
```

### MCP

```text
invalid config rejected
untrusted stdio blocked
environment filtered
```

### Skills

```text
skill cannot override hard policy
invalid metadata rejected
```

---

# 39. Functional Tests

ทดสอบ:

```text
Provider registration
Model capability resolution
Tool registration
Tool collision handling
Agent mode filtering
Policy evaluation
Approval lifecycle
MCP connect/disconnect
Skill load/unload
Reviewer aggregation
Cancellation
Audit persistence
```

---

# 40. End-to-End Scenarios

สร้าง test/fixture หรือ documented verification สำหรับ:

## Scenario A

```text
User:
"อ่าน package.json แล้วบอก scripts"
```

Expected:

```text
read-only
→ no unnecessary approval
→ audit
```

## Scenario B

```text
User:
"แก้ไฟล์แล้วรัน test"
```

Expected:

```text
plan
→ policy
→ write permission
→ edit
→ approved test command
→ result
→ audit
```

## Scenario C

```text
User:
"git push --force"
```

Expected:

```text
critical
→ policy deny หรือ mandatory human approval ตาม hard policy
→ never silent auto execute
```

## Scenario D

MCP config พยายาม:

```text
powershell -EncodedCommand ...
```

Expected:

```text
blocked before spawn
```

---

# 41. Backward Compatibility

ก่อน implement:

1. inspect existing Pao-hubPro APIs
2. inspect MCP implementation
3. inspect Reviewer Council
4. inspect settings
5. inspect auth
6. inspect database
7. inspect frontend routing
8. inspect existing tests

สร้าง adapter แทนการ duplicate

Phase 20.9 ต้องไม่ทำ Phase เดิมพัง

---

# 42. Migration Strategy

ทำเป็นลำดับ:

```text
Step 1 — Audit existing architecture
Step 2 — Introduce interfaces
Step 3 — Wrap existing providers/tools
Step 4 — Add policy layer
Step 5 — Add approval gateway
Step 6 — Add MCP security
Step 7 — Add skills runtime
Step 8 — Integrate Reviewer Council
Step 9 — Add Agent state machine
Step 10 — Add UI
Step 11 — Tests
Step 12 — Documentation
```

หลีกเลี่ยง big-bang rewrite

---

# 43. Documentation

สร้าง/อัปเดต:

```text
docs/
├── agent-runtime.md
├── provider-registry.md
├── tool-registry.md
├── mcp-runtime.md
├── mcp-security.md
├── sandbox.md
├── policy-engine.md
├── skills-runtime.md
├── reviewer-council.md
├── security-model.md
└── phase-20.9.md
```

ปรับชื่อ/path ตาม convention ของ repo

---

# 44. Security Model Document

ต้องอธิบาย trust boundaries:

```text
Trusted Core
├── Hard Policy
├── Approval Gateway
└── Secret Store

Semi-Trusted
├── Workspace Config
└── Local Integrations

Untrusted
├── Model Output
├── MCP Server
├── Skill
├── Retrieved Documents
├── Web Content
└── User-supplied Config
```

หลัก:

> Model output is a proposal, not authority.

---

# 45. Definition of Done

Phase 20.9 ถือว่าเสร็จเมื่อ:

- [ ] Agent Runtime ทำงาน
- [ ] Agent Mode 4 ระดับทำงาน
- [ ] Provider Registry ทำงาน
- [ ] Tool Registry ทำงาน
- [ ] MCP stdio ทำงานผ่าน security gateway
- [ ] Remote MCP architecture พร้อมใช้งาน
- [ ] Tool risk classification ทำงาน
- [ ] Approval Gateway ทำงาน
- [ ] Safe Sandbox boundary ทำงาน
- [ ] Workspace path protection ผ่าน test
- [ ] Secret redaction ผ่าน test
- [ ] AGENTS.md hierarchy ทำงาน
- [ ] Skills progressive loading ทำงาน
- [ ] Reviewer Council เชื่อมกับ high-risk flow
- [ ] Agent state machine ทำงาน
- [ ] Cancel Agent ทำงาน
- [ ] Audit Log ทำงาน
- [ ] Agent Control Center ใช้งานได้
- [ ] MCP Manager ใช้งานได้
- [ ] Provider Settings ใช้งานได้
- [ ] Skills Manager ใช้งานได้
- [ ] Security Center ใช้งานได้
- [ ] backward compatibility ผ่าน
- [ ] lint ผ่าน
- [ ] typecheck ผ่าน
- [ ] tests ผ่าน
- [ ] production build ผ่าน
- [ ] ไม่มี secret ใน git diff
- [ ] documentation ครบ

---

# 46. Final Verification Commands

Codex ต้องตรวจ package manager/build system จริงก่อนเลือกคำสั่ง

ตัวอย่างเท่านั้น:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

ห้าม assume ว่า npm คือ package manager หาก repo ใช้ pnpm/yarn/bun

---

# 47. Final Security Review

ก่อนจบ Phase ให้ตรวจ:

```text
[ ] AI bypass policy ไม่ได้
[ ] Skill bypass policy ไม่ได้
[ ] MCP bypass policy ไม่ได้
[ ] AGENTS.md bypass hard policy ไม่ได้
[ ] path traversal ถูก block
[ ] symlink escape ถูก block
[ ] raw secrets ไม่เข้า log
[ ] critical actions ไม่ auto approve
[ ] cancellation cleanup process
[ ] MCP child process cleanup
[ ] duplicate tool execution ถูกป้องกัน
```

---

# 48. Final Report Required From Codex

หลังทำงานเสร็จ ให้ Codex สรุป:

```markdown
# Phase 20.9 Implementation Report

## Repository Analysis
...

## Architecture Added
...

## Files Created
...

## Files Modified
...

## Database Changes
...

## Security Controls
...

## Tests Added
...

## Verification Results
- lint:
- typecheck:
- tests:
- build:

## Backward Compatibility
...

## Known Limitations
...

## Recommended Phase 21
...
```

ห้ามรายงานว่า test/build ผ่านหากไม่ได้รันจริง

---

# 49. Git Safety

Codex:

- ห้าม force push
- ห้าม delete branch
- ห้าม reset destructive
- ห้ามแก้ unrelated user work
- ห้าม commit secret
- ห้าม push โดยไม่ได้รับคำสั่ง
- ตรวจ `git diff` ก่อน final report

ถ้า repository มี uncommitted user changes ให้ preserve ไว้

---

# 50. Expected Result

เมื่อ Phase 20.9 เสร็จ Pao-hubPro ควรเปลี่ยนจาก:

```text
AI
↓
MCP / Tools
```

เป็น:

```text
                    PAO-HUBPRO
                         │
                  Agent Runtime
                         │
        ┌────────────────┼────────────────┐
        │                │                │
 Provider Registry   Skill Registry   Knowledge
        │                │                │
        └────────────────┼────────────────┘
                         │
                    Orchestrator
                         │
                 Reviewer Council
                         │
                    Policy Engine
                         │
                 Approval Gateway
                         │
                    Tool Registry
            ┌────────────┼────────────┐
            │            │            │
          MCP         Built-in      Skills
            │
     MCP Security Gateway
            │
        Safe Sandbox
            │
      Approved Execution
            │
         Audit Log
```

เป้าหมายไม่ใช่สร้าง Chatbox clone

เป้าหมายคือสร้าง:

> **Pao-hubPro Agent Operating Layer**

ที่สามารถเป็นแกนกลางสำหรับ:

- Codex automation
- ChatGPT/OpenAI
- Claude
- Local AI
- MCP
- ComfyUI
- RunPod
- Adobe Stock production
- Pao AI Image Factory
- Pao AI Video Factory
- Browser automation
- Reviewer Council
- future agents

โดยมี **security, policy, approval และ audit เป็นแกนกลางตั้งแต่ระดับ architecture**

---

# 51. Start Now

ให้เริ่มดำเนินการทันทีตามลำดับ:

```text
Inspect
→ Map Existing Architecture
→ Design Migration
→ Implement Core Interfaces
→ Integrate Existing Components
→ Add Security Layers
→ Add Agent Runtime
→ Add UI
→ Add Tests
→ Verify
→ Document
→ Final Report
```

อย่าหยุดเพียงสร้าง scaffold หรือ TODO

ให้ implement feature ที่สามารถใช้งานได้จริงตาม architecture ของ repository ปัจจุบัน และหากมีข้อจำกัดจากระบบเดิม ให้เลือก implementation ที่ปลอดภัยที่สุด พร้อมบันทึกข้อจำกัดไว้ใน Final Report
