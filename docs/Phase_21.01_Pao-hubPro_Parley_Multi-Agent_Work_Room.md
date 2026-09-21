# Phase 20.99 — Pao-hubPro × Parley — Multi-Agent Work Room, Runtime Identity, Run Inspector, Provider/Model Metadata, Permission-Aware Execution & Policy-Governed Collaborative Agent Console

**Status:** Design / Implementation Ready  
**Project:** Pao-hubPro  
**Phase:** 20.99  
**Primary inspiration:** Parley-style multi-agent work room  
**Target runtime:** Windows-first, local-first, provider-agnostic  
**Priority:** High  
**Execution principle:** Human-controlled, observable, resumable, auditable

> **Canonical numbering note:** หาก Phase Registry ของ Pao-hubPro มี `20.99` ใช้งานอยู่แล้ว ให้ระบบตรวจชนหมายเลขก่อน merge และเลื่อนไปหมายเลขถัดไปโดยอัตโนมัติ โดยห้าม overwrite Phase เดิม

---

## 1. Phase Goal

สร้าง **Multi-Agent Work Room** สำหรับ Pao-hubPro ที่ให้ผู้ใช้สามารถคุย สั่งงาน และให้ Agent หลายตัวทำงานร่วมกันใน workspace เดียวได้ เช่น:

- Codex
- Claude
- OpenAI / ChatGPT
- Grok
- OpenCode
- Local AI
- Provider ผ่าน OpenRouter / OmniRoute / custom endpoint
- Agent จาก MCP / A2A / external runtime

โดยระบบต้องไม่พึ่งคำตอบของ Agent ว่า “ตัวเองใช้โมเดลอะไร” แต่ให้ **Pao-hubPro Runtime เป็นแหล่งความจริง (source of truth)** สำหรับ:

- Provider
- Model ID
- Endpoint / profile
- Agent identity
- Workspace
- Permission
- Tool access
- Session
- Cost
- Token usage
- Duration
- Trigger
- Approval state
- Files changed
- Commands executed
- Error / retry
- Handoff chain

เป้าหมายคือทำให้ทุก Run **ตรวจสอบย้อนหลังได้**, **ควบคุมสิทธิ์ได้**, **เห็น Agent จริงที่ทำงาน**, และ **ทำงานร่วมกันหลาย Agent ได้อย่างปลอดภัย**

---

# 2. Problem Statement

ในระบบ Agent ปัจจุบัน ผู้ใช้อาจถาม Agent ว่า:

> “ใช้ model ไหนอยู่ครับ”

Agent สามารถตอบได้เพียงข้อมูลที่มีอยู่ใน context ของตัวเอง และอาจไม่เห็น:

- Exact model ID
- Runtime profile
- API endpoint
- Routing rule
- Fallback model
- Provider account
- Token budget
- Sandbox permission
- Workspace write scope

ดังนั้นคำตอบจาก Agent ไม่ควรถูกใช้เป็น authoritative runtime metadata

### Phase 20.99 แก้ปัญหานี้ด้วย

```text
User
  ↓
Pao-hubPro Work Room
  ↓
Agent Router
  ↓
Runtime Metadata Injector
  ↓
Provider Adapter
  ↓
Model / Agent
  ↓
Tool Runtime / Workspace
  ↓
Run Ledger + Inspector + Audit Log
```

---

# 3. Core Principles

## 3.1 Runtime Is the Source of Truth

ข้อมูลต่อไปนี้ต้องมาจาก Pao-hubPro Runtime ไม่ใช่ให้ LLM เดาเอง:

```text
provider
model
endpoint_profile
agent_id
workspace
permissions
tool_policy
routing_rule
token_usage
cost
duration
run_status
approval_status
```

---

## 3.2 Work Room Is a Coordination Surface

Work Room ไม่ใช่แค่ Chat UI แต่เป็น:

- Conversation surface
- Agent routing surface
- Shared workspace
- Approval surface
- Run timeline
- File/command activity stream
- Human takeover point
- Multi-agent collaboration room

---

## 3.3 Every Action Must Be Attributable

ทุก action ต้องตอบได้ว่า:

```text
ใครทำ
ทำเมื่อไร
ใช้ model ไหน
ผ่าน provider ไหน
ได้รับคำสั่งจากใคร
ใช้ tool อะไร
แก้ไฟล์ไหน
รัน command อะไร
ได้รับ approval หรือไม่
ผลลัพธ์คืออะไร
```

---

# 4. Main User Experience

## 4.1 Work Room

ตัวอย่าง:

```text
┌──────────────────────────────────────────────────────────┐
│ Pao-hubPro / Work Room: Ninja-Shippuden-TH              │
├──────────────────────────────────────────────────────────┤
│ Agents                                                   │
│ ● Claude   ● Codex   ○ Grok   ○ Local AI                │
│                                                          │
│ Mode: WORK                                               │
│ Workspace: C:\Users\PC\Desktop\Ninja-Shippuden-TH       │
│ Policy: workspace-write                                  │
├──────────────────────────────────────────────────────────┤
│ User @codex                                              │
│ ตรวจสอบ project นี้และแก้ build error                   │
│                                                          │
│ Codex                                                    │
│ ✓ inspected package.json                                 │
│ ✓ changed src/...                                        │
│ ✓ ran npm test                                           │
│                                                          │
│ [Run Inspector] [Files Changed] [Commands] [Approve]     │
├──────────────────────────────────────────────────────────┤
│ @claude  @codex  @both  Auto                             │
│ Message the room...                                      │
└──────────────────────────────────────────────────────────┘
```

---

# 5. Agent Addressing

รองรับ explicit addressing:

```text
@codex
@claude
@grok
@local
@both
@reviewers
@all
```

และ logical group:

```text
@builders
@reviewers
@researchers
@fast
@cheap
@private
```

---

# 6. Agent Runtime Identity

Agent ทุกตัวต้องมี canonical identity

```yaml
agent:
  id: codex-primary
  display_name: Codex
  role: builder
  provider: openai
  adapter: openai-codex
  runtime_profile: codex-workspace
  workspace_scope: current_room
  trust_level: managed
```

---

## 6.1 Runtime Identity Badge

บน UI:

```text
Codex
OpenAI • <actual-model-id>
workspace-write
15.6s • 403 tokens
```

ห้ามใช้ชื่อ model ที่ LLM พิมพ์ตอบเองเป็น metadata

---

# 7. Run Inspector

ทุก execution ต้องมี Run Inspector

## 7.1 Overview

```text
RUN INSPECTOR

Run ID       run_01K...
Agent        Codex
Provider     OpenAI
Model        <actual runtime model>
Profile      codex-workspace
Mode         WORK

Workspace
C:\Users\PC\Desktop\Ninja-Shippuden-TH

Started      20:53:10
Finished     20:53:26
Duration     15.6s

Input Tokens    ...
Output Tokens   ...
Cached Tokens   ...
Estimated Cost  ...
```

---

## 7.2 Permissions

```text
Permissions

✓ Read workspace
✓ Write workspace
✓ Run safe commands
✓ Read git diff

? Network access        approval required
? Install package       approval required

✗ Write outside workspace
✗ Access secrets directly
✗ Destructive system command
```

---

## 7.3 Routing

```text
User
  ↓
Room Router
  ↓
Policy Engine
  ↓
Codex
  ↓
Tool Runtime
  ↓
Workspace
```

กรณี fallback:

```text
Codex primary
  ↓ timeout
OpenCode fallback
  ↓
Local model fallback
```

ต้องบันทึกทุก hop

---

# 8. Provider/Model Metadata

สร้าง immutable snapshot ตอน dispatch

```json
{
  "provider": "openai",
  "model": "<actual-model-id>",
  "endpoint_profile": "codex-default",
  "adapter_version": "x.y.z",
  "temperature": null,
  "reasoning_effort": null,
  "max_output_tokens": null,
  "request_id": "...",
  "routing_rule_id": "route_build_001"
}
```

> ห้าม log secret เช่น API key แบบ plaintext

---

# 9. Runtime Metadata Injection

ก่อน request ไป Agent ให้ runtime สร้าง non-authoritative readable metadata สำหรับ Agent:

```text
Runtime context:
- Agent: Codex
- Provider: OpenAI
- Workspace: Ninja-Shippuden-TH
- Permission profile: workspace-write
- Network: approval-required
- Destructive actions: blocked
```

Exact endpoint secret หรือ credential ห้าม inject ลง prompt

---

# 10. Permission Profiles

## 10.1 read-only

```text
read files        ✓
write files       ✗
commands          ✗
network           ✗
secrets           ✗
```

## 10.2 workspace-write

```text
read files        ✓
write workspace   ✓
safe commands     ✓
network           gated
system changes    gated
outside workspace ✗
```

## 10.3 reviewer

```text
read files        ✓
read diff         ✓
write source      ✗
write review      ✓
commands          test-only
```

## 10.4 admin-approved

ใช้เฉพาะ action ที่ผู้ใช้ approve แบบ explicit และมี expiry

---

# 11. Tool Execution Policy

แยก command เป็น 4 ระดับ

## Level 0 — Safe

ตัวอย่าง:

```text
pwd
ls
git status
git diff
npm test
pytest
```

รันได้ตาม policy

---

## Level 1 — Workspace Mutation

ตัวอย่าง:

```text
edit file
create file
format code
npm run build
```

อนุญาตเมื่อ profile เป็น workspace-write

---

## Level 2 — External / Network

ตัวอย่าง:

```text
npm install
pip install
curl
download
git push
API mutation
```

ต้องผ่าน policy engine และอาจต้อง Human Approval

---

## Level 3 — Dangerous

ตัวอย่าง:

```text
delete outside workspace
disk format
registry destructive edit
credential export
system shutdown
privilege escalation
```

default = BLOCK

---

# 12. Human Approval Gate

UI:

```text
Approval required

Agent: Codex
Action: npm install sharp
Reason: package installation modifies dependencies

[Approve once]
[Approve for this run]
[Deny]
```

ต้องบันทึก:

```text
approval_id
run_id
user_id
action_hash
decision
scope
created_at
expires_at
```

---

# 13. Shared Workspace Model

Room หนึ่งห้องผูกได้กับ workspace

```text
Room
 ├── Conversation
 ├── Agents
 ├── Workspace
 ├── Runs
 ├── Files
 ├── Commands
 ├── Approvals
 └── Transcript
```

Workspace สามารถเป็น:

- Local directory
- Git repository
- Mounted remote folder
- SSH workspace
- Container workspace
- Remote machine workspace

---

# 14. File Activity Timeline

ตัวอย่าง:

```text
20:53:11 Codex read package.json
20:53:13 Codex read src/app.ts
20:53:17 Codex modified src/app.ts
20:53:19 Codex created tests/app.test.ts
20:53:21 Codex ran npm test
20:53:25 Tests passed
```

กดรายการเพื่อดู diff ได้

---

# 15. Command Timeline

```text
Command #12

Agent: Codex
cwd: C:\...\Ninja-Shippuden-TH

> npm test

Exit code: 0
Duration: 4.8s

stdout:
...
```

รองรับ:

- stdout
- stderr
- exit code
- cwd
- env allowlist
- timeout
- killed state

---

# 16. Multi-Agent Collaboration

## 16.1 Sequential

```text
Claude
  ↓ plan
Codex
  ↓ implement
Claude
  ↓ review
Codex
  ↓ fix
```

---

## 16.2 Parallel

```text
             ┌─ Claude review
User → Router├─ Codex implementation
             └─ Local AI static check
```

แล้ว merge ผ่าน Reviewer Council

---

## 16.3 Debate / Review Loop

```text
Builder
 ↓
Reviewer A
 ↓
Reviewer B
 ↓
Final synthesis
 ↓
Human approval
```

ต้องมี max-turn limit เพื่อป้องกัน agent loop

---

# 17. Automatic Turns

รองรับ:

```text
Automatic turns: OFF
Automatic turns: 2
Automatic turns: 4
Automatic turns: Custom
```

Policy:

```yaml
auto_turns:
  max_turns: 4
  max_cost_usd: 1.00
  max_duration_seconds: 900
  require_progress: true
  stop_on_repeated_error: true
```

---

# 18. Handoff

Agent สามารถ handoff ได้

ตัวอย่าง:

```text
Codex:
implementation complete
handoff → Claude reviewer
```

Handoff payload:

```json
{
  "from_agent": "codex-primary",
  "to_agent": "claude-reviewer",
  "reason": "implementation complete; request review",
  "run_id": "...",
  "artifacts": ["git_diff", "test_results"],
  "context_ref": "ctx_..."
}
```

---

# 19. Transcript

ทุก Room มี downloadable transcript

รูปแบบ:

- Markdown
- JSON
- JSONL

ตัวอย่าง Markdown:

```text
[20:53:00] USER → @codex
แก้ build error

[20:53:03] CODEX
กำลังตรวจสอบ...

[20:53:08] TOOL
read package.json

[20:53:12] TOOL
npm test

[20:53:20] CODEX
แก้ไขเรียบร้อย...
```

---

# 20. Durable Run State

Run ต้อง resume ได้หลัง:

- Browser refresh
- App restart
- Provider timeout
- Agent crash
- Network disconnect
- Machine reconnect

State:

```text
queued
routing
running
awaiting_approval
paused
retrying
completed
failed
cancelled
```

---

# 21. Database Schema

## rooms

```sql
id
name
mode
workspace_id
created_at
updated_at
```

## room_agents

```sql
id
room_id
agent_id
enabled
role
priority
created_at
```

## agents

```sql
id
display_name
provider_id
adapter_id
runtime_profile_id
role
status
created_at
updated_at
```

## providers

```sql
id
name
type
base_url_ref
credential_ref
status
created_at
```

## model_profiles

```sql
id
provider_id
model_id
display_name
capabilities_json
pricing_json
limits_json
created_at
updated_at
```

## runs

```sql
id
room_id
agent_id
parent_run_id
trigger_type
status
started_at
finished_at
duration_ms
input_tokens
output_tokens
cached_tokens
estimated_cost
runtime_snapshot_json
```

## run_events

```sql
id
run_id
sequence
event_type
payload_json
created_at
```

## tool_calls

```sql
id
run_id
tool_name
action
input_redacted_json
output_ref
status
started_at
finished_at
```

## file_events

```sql
id
run_id
path
operation
before_hash
after_hash
diff_ref
created_at
```

## command_events

```sql
id
run_id
command_redacted
cwd
exit_code
stdout_ref
stderr_ref
duration_ms
created_at
```

## approvals

```sql
id
run_id
action_hash
scope
decision
requested_at
decided_at
expires_at
```

## handoffs

```sql
id
from_run_id
to_agent_id
reason
context_ref
created_at
```

---

# 22. Event Model

ใช้ append-only event log

ตัวอย่าง:

```json
{
  "event_id": "evt_...",
  "room_id": "room_...",
  "run_id": "run_...",
  "type": "command.completed",
  "actor": {
    "type": "agent",
    "id": "codex-primary"
  },
  "timestamp": "...",
  "payload": {
    "exit_code": 0,
    "duration_ms": 4800
  }
}
```

Event types:

```text
room.created
message.created
run.queued
run.started
run.completed
run.failed

agent.handoff

tool.requested
tool.completed
tool.failed

file.read
file.created
file.modified
file.deleted

command.started
command.completed
command.failed

approval.requested
approval.approved
approval.denied

provider.fallback
policy.blocked
```

---

# 23. API Surface

## Rooms

```text
POST   /api/rooms
GET    /api/rooms
GET    /api/rooms/:id
PATCH  /api/rooms/:id
DELETE /api/rooms/:id
```

## Messages

```text
POST /api/rooms/:id/messages
GET  /api/rooms/:id/messages
```

## Runs

```text
POST /api/rooms/:id/runs
GET  /api/runs/:id
POST /api/runs/:id/cancel
POST /api/runs/:id/retry
POST /api/runs/:id/resume
```

## Inspector

```text
GET /api/runs/:id/inspector
GET /api/runs/:id/events
GET /api/runs/:id/files
GET /api/runs/:id/commands
```

## Approval

```text
POST /api/approvals/:id/approve
POST /api/approvals/:id/deny
```

---

# 24. Router

Router พิจารณา:

```text
mention
task type
required capability
workspace permission
provider health
cost
latency
context limit
policy
user preference
fallback chain
```

ตัวอย่าง:

```yaml
routes:
  coding:
    primary: codex-primary
    fallback:
      - opencode
      - local-coder

  review:
    primary: claude-reviewer
    fallback:
      - gpt-reviewer
```

---

# 25. Provider Health

แสดงสถานะ:

```text
OpenAI      Healthy   430 ms
Anthropic   Healthy   620 ms
Grok        Degraded  1.9 s
Local AI    Healthy   45 ms
```

Metrics:

- availability
- latency
- rate-limit state
- last error
- fallback count
- rolling cost

---

# 26. Cost Governance

กำหนด budget:

```yaml
budget:
  per_run_usd: 1.00
  per_room_usd: 10.00
  daily_usd: 20.00
```

เมื่อใกล้ limit:

```text
Budget warning
Room usage: 82%
```

เมื่อถึง limit:

```text
Execution paused
Human approval required
```

---

# 27. Context Governance

Agent ไม่ควรได้รับทุกอย่างใน Room โดยอัตโนมัติ

Context Builder เลือก:

- User request
- Relevant conversation
- Workspace summary
- Relevant files
- Previous run output
- Reviewer notes
- Policy constraints

และสร้าง:

```text
Context Manifest
```

เพื่อ trace ว่า Agent เห็นข้อมูลอะไรบ้าง

---

# 28. Secret Management

Secret เก็บผ่าน:

```text
Credential Vault
```

Agent เห็นเพียง:

```text
credential_ref://openai/default
```

ห้ามแสดง:

```text
sk-...
token
password
private key
```

ใน:

- prompt
- transcript
- audit
- stdout
- inspector

ต้องมี redaction layer

---

# 29. Network Policy

Network mode:

```text
off
allowlist
approval
full
```

Default:

```text
approval
```

Domain allowlist ตัวอย่าง:

```text
github.com
api.github.com
registry.npmjs.org
pypi.org
```

---

# 30. Git Integration

ก่อน Agent เขียนไฟล์:

```text
capture git status
```

หลังทำงาน:

```text
capture git diff
```

Inspector แสดง:

```text
Files changed: 4
+120 / -31
Tests: Passed
```

รองรับ optional checkpoint commit

---

# 31. Checkpoint / Rollback

ก่อน risky mutation:

```text
checkpoint
```

รองรับ:

```text
Restore file
Restore run
Rollback workspace checkpoint
```

Phase แรกใช้ Git เป็น rollback backend ได้

---

# 32. Reviewer Council Integration

เชื่อมกับ Reviewer Council ของ Pao-hubPro

ตัวอย่าง:

```text
Codex Builder
   ↓
Claude Reviewer
   ↓
Local AI Reviewer
   ↓
Policy Validator
   ↓
Human
```

ผล review:

```text
PASS
PASS WITH NOTES
CHANGES REQUESTED
BLOCKED
```

Reviewer ห้าม merge เองถ้านโยบายต้อง human approval

---

# 33. Work Room Modes

## TALK

```text
no workspace mutation
```

## WORK

```text
workspace tools enabled per policy
```

## REVIEW

```text
read/diff/test only
```

## RESEARCH

```text
network + citations + artifact capture
```

## AUTOPILOT

```text
bounded autonomous turns
budget limit
approval gates
```

---

# 34. Room Header

แสดงข้อมูลสำคัญตลอดเวลา:

```text
WORK
Workspace: Ninja-Shippuden-TH
Policy: workspace-write
Agents: Claude + Codex
Budget: $0.27 / $3.00
```

เพื่อป้องกันผู้ใช้สับสนว่า Agent กำลังทำงานที่ไหน

---

# 35. Agent Presence

สถานะ:

```text
Idle
Thinking
Running tool
Waiting approval
Reviewing
Paused
Offline
Error
```

ห้ามแสดง “กำลังทำงาน” หาก backend ไม่มี active run จริง

---

# 36. Streaming

แยก stream:

```text
assistant tokens
reasoning-safe progress events
tool calls
file changes
commands
approval requests
```

ไม่จำเป็นต้อง expose private chain-of-thought

ใช้ activity message แบบ:

```text
Inspecting package.json
Running tests
Reviewing diff
Waiting for approval
```

---

# 37. Error Handling

## Provider Error

```text
Provider unavailable
Retry 1/2
```

ถ้ายังล้ม:

```text
Fallback → OpenCode
```

---

## Tool Error

แสดง:

```text
command
exit code
stderr summary
retry decision
```

---

## Policy Block

```text
Blocked by policy:
write outside workspace
```

Agent ต้องไม่ bypass policy ด้วย command รูปแบบอื่น

---

# 38. UI Components

สร้าง components:

```text
RoomSidebar
RoomHeader
AgentPresenceBar
MessageTimeline
AgentMessage
ToolActivityCard
FileDiffCard
CommandCard
ApprovalCard
RunInspectorDrawer
ProviderBadge
ModelBadge
PermissionBadge
CostBadge
WorkspaceBadge
RoutingTrace
TranscriptExport
```

---

# 39. Run Inspector Tabs

```text
Overview
Timeline
Routing
Context
Tools
Commands
Files
Permissions
Cost
Errors
Raw Events
```

---

# 40. Search & Filtering

ค้นหา:

```text
run id
agent
provider
model
file
command
error
date
room
```

Filters:

```text
Completed
Failed
Blocked
Approval
Fallback
Cost > threshold
```

---

# 41. Observability

Metrics:

```text
runs_total
runs_success
runs_failed
average_duration
tool_calls_total
approval_rate
fallback_rate
tokens_total
cost_total
provider_latency
policy_block_count
```

---

# 42. Security Requirements

ต้องมี:

- path normalization
- workspace boundary enforcement
- command allow/deny policy
- secret redaction
- immutable runtime snapshot
- signed approval action hash
- audit log
- event ordering
- timeout
- max output size
- process kill
- symlink escape protection
- environment variable allowlist

---

# 43. Windows-Specific Safety

ตรวจ:

```text
PowerShell
cmd.exe
WSL
junction
symlink
UNC path
drive letter
registry command
scheduled task
service control
```

ห้าม Agent ใช้ path trick เพื่อ escape workspace

---

# 44. Remote Runtime Compatibility

เตรียมรองรับ:

```text
Local Windows
WSL
Docker
SSH
Tailscale host
Remote VPS
Remote desktop host
```

ผ่าน abstraction:

```text
ExecutionHostAdapter
```

---

# 45. MCP Integration

Tool จาก MCP ต้องลงทะเบียน:

```yaml
tool:
  id: filesystem.read
  server: local-filesystem
  risk: low
  permissions:
    - workspace.read
```

Inspector ต้อง trace ได้ว่า:

```text
Agent → MCP server → Tool → Result
```

---

# 46. Skill Registry Integration

Agent สามารถโหลด Skill ตามงาน

```text
coding-review
repo-analysis
browser-research
adobe-stock
deployment
```

Run ต้องบันทึก:

```text
skill_id
skill_version
loaded_at
```

---

# 47. Capability Registry

Agent profile:

```json
{
  "agent": "codex-primary",
  "capabilities": [
    "coding",
    "shell",
    "file_edit",
    "test",
    "repo_analysis"
  ]
}
```

Router ใช้ capability นี้ในการเลือก Agent

---

# 48. Policy Engine

Policy evaluation input:

```text
user
room
agent
tool
action
workspace
path
network target
cost
risk
approval state
```

Output:

```text
ALLOW
ALLOW_WITH_REDACTION
REQUIRE_APPROVAL
DENY
```

---

# 49. Audit Log

Audit log แยกจาก transcript

Transcript = สิ่งที่ผู้ใช้เห็นในการสนทนา

Audit = เหตุการณ์ระบบ

ตัวอย่าง:

```text
20:53:10 run started
20:53:11 provider=openai
20:53:11 model=<actual-id>
20:53:12 workspace read
20:53:17 file modified
20:53:21 command executed
20:53:26 run completed
```

---

# 50. Data Retention

Config:

```yaml
retention:
  transcripts_days: 90
  run_events_days: 180
  command_output_days: 30
  audit_days: 365
```

สามารถตั้ง local-only ได้

---

# 51. Export

Export:

```text
room.md
room.json
events.jsonl
run-report.md
diff.patch
audit.jsonl
```

---

# 52. Minimum Viable Implementation

## MVP-1

ต้องทำ:

- Work Room
- @agent routing
- Codex + Claude adapters
- Runtime identity
- Exact provider/model metadata capture
- Workspace binding
- Permission profiles
- Run timeline
- File activity
- Command activity
- Approval gate
- Run Inspector
- Transcript export

---

# 53. Phase 2 Enhancements

หลัง MVP:

- Multi-agent automatic turns
- Reviewer Council
- Cost governance
- Routing fallback
- Skill Registry
- MCP tracing
- Remote host execution
- Resumable runs
- Checkpoints
- Context Manifest

---

# 54. Recommended Tech Structure

```text
apps/
  web/
  desktop/

packages/
  agent-runtime/
  room-engine/
  provider-adapters/
  model-registry/
  router/
  policy-engine/
  approval-engine/
  workspace-runtime/
  tool-runtime/
  event-store/
  run-inspector/
  audit/
  secrets/
  shared-types/
```

---

# 55. Suggested Internal Interfaces

```ts
interface AgentAdapter {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
  capabilities(): AgentCapabilities
}

interface ExecutionHost {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  runCommand(command: CommandSpec): Promise<CommandResult>
}

interface PolicyEngine {
  evaluate(input: PolicyInput): Promise<PolicyDecision>
}

interface RunLedger {
  append(event: RunEvent): Promise<void>
  getRun(runId: string): Promise<RunRecord>
}
```

---

# 56. Runtime Snapshot

ทุก Run เก็บ immutable snapshot:

```json
{
  "agent": {},
  "provider": {},
  "model": {},
  "route": {},
  "workspace": {},
  "permission_profile": {},
  "policy_version": "...",
  "skill_versions": [],
  "tool_registry_version": "..."
}
```

เพื่อให้ตอบย้อนหลังได้ว่า Run นั้นใช้ config ไหนจริง

---

# 57. Important Rule — Never Trust Self-Reported Model Identity

ห้ามระบบนำข้อความเช่น:

```text
"I am GPT-5"
"I use Claude X"
"I am Codex"
```

ไปใช้เป็น runtime metadata

Source of truth ต้องมาจาก:

1. Router config
2. Provider adapter
3. API response metadata
4. Runtime snapshot
5. Model registry

เท่านั้น

---

# 58. Acceptance Checklist

## Work Room

- [ ] สร้าง Room ได้
- [ ] ผูก workspace ได้
- [ ] เลือก TALK / WORK / REVIEW ได้
- [ ] เพิ่ม/ลบ Agent จาก Room ได้
- [ ] ใช้ `@codex`, `@claude`, `@both` ได้
- [ ] เห็น Agent presence แบบ real-time

## Runtime Identity

- [ ] Run บันทึก provider จริง
- [ ] Run บันทึก model ID จริง
- [ ] บันทึก adapter/profile
- [ ] ไม่ใช้ self-reported model identity
- [ ] แสดง Runtime Identity Badge

## Inspector

- [ ] เปิด Run Inspector ได้
- [ ] เห็น routing
- [ ] เห็น permission
- [ ] เห็น tool calls
- [ ] เห็น commands
- [ ] เห็น files changed
- [ ] เห็น token/cost
- [ ] เห็น error/fallback

## Safety

- [ ] จำกัด workspace boundary
- [ ] block dangerous command
- [ ] secret redaction
- [ ] approval gate
- [ ] audit log
- [ ] symlink escape test
- [ ] path traversal test

## Reliability

- [ ] run state durable
- [ ] retry provider error
- [ ] cancel run
- [ ] resume run
- [ ] prevent infinite agent loop
- [ ] max turn budget

## Export

- [ ] transcript Markdown
- [ ] transcript JSON
- [ ] event JSONL
- [ ] diff export
- [ ] run report

---

# 59. Definition of Done

Phase 20.99 ถือว่าเสร็จเมื่อผู้ใช้สามารถ:

1. เปิด Pao-hubPro
2. สร้าง Work Room
3. เลือก workspace
4. เปิด Codex และ Claude ใน Room เดียวกัน
5. ส่งงานด้วย `@codex`
6. เห็น runtime identity ของ Codex ที่มาจากระบบจริง
7. เห็นไฟล์และ command ที่ Agent ใช้
8. ให้ Claude review ผลของ Codex
9. กด approve action ที่มีความเสี่ยง
10. เปิด Run Inspector แล้วย้อนดู trace ทั้ง Run ได้
11. export transcript และ audit ได้
12. restart ระบบแล้ว Run/Room ยัง recover ได้

---

# 60. Final Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    Pao-hubPro UI                        │
│                                                         │
│   Rooms • Agents • Work • Review • Run Inspector        │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    Room Engine                          │
│                                                         │
│ Message Router • Auto Turns • Handoff • Context Builder │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                 Policy / Approval Plane                 │
│                                                         │
│ Permission • Risk • Budget • Human Approval             │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                  Agent Runtime Router                   │
│                                                         │
│ Codex • Claude • Grok • OpenCode • Local • Custom       │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
       ┌────────▼────────┐   ┌────────▼────────┐
       │ Provider Layer │   │ Tool / MCP Layer │
       └────────┬────────┘   └────────┬────────┘
                │                     │
                └──────────┬──────────┘
                           │
                  ┌────────▼────────┐
                  │ Workspace Host │
                  │ Local/SSH/WSL  │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │ Run Event Store │
                  │ Audit / Ledger  │
                  └─────────────────┘
```

---

# 61. Expected Outcome

เมื่อ Phase นี้เสร็จ Pao-hubPro จะเปลี่ยนจากระบบที่ “เรียก Agent หลายตัวได้” ไปเป็น **Agent Operations Console** ที่สามารถ:

- ควบคุม Agent หลาย provider ในห้องเดียว
- ระบุ runtime identity จริง
- ตรวจสอบ model/provider ที่ถูกใช้จริง
- ตรวจทุก tool/action ย้อนหลัง
- ทำงานบนไฟล์จริงใน workspace
- ใช้ human approval ในจุดเสี่ยง
- ให้ Agent review กันเอง
- จำกัด budget และ automatic turns
- recover งานที่ค้าง
- export transcript/audit
- รองรับ Local / Remote / MCP / SSH ในอนาคต

Phase 20.99 จึงเป็น **Control Plane สำหรับการทำงานร่วมกันของ Agent** และเป็นฐานสำคัญก่อนขยาย Pao-hubPro ไปสู่ autonomous multi-agent operations แบบเต็มรูปแบบ
