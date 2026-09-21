# Phase 21.02 — Pao-hubPro × Multi-Agent Mission Control

## 0. Phase Identity

**Phase:** 21.02  
**Project:** Pao-hubPro  
**Codename:** Multi-Agent Mission Control  
**Status:** PROPOSED / READY FOR IMPLEMENTATION  
**Depends on:** Phase 20.98, 20.99, 21.00, 21.01  
**Primary Goal:** สร้างศูนย์ควบคุมกลางสำหรับดูสถานะ สั่งงาน อนุมัติ หยุด/พัก/รันต่อ ตรวจสอบต้นทุน และติดตามเหตุการณ์ของ Agent ทั้งระบบจากหน้าจอเดียว

---

# 1. Executive Summary

Phase 21.02 ยกระดับ Pao-hubPro จากระบบที่มี Agent Runtime และ Multi-Agent Work Room ให้กลายเป็น **Operational Control Plane** ที่ผู้ใช้สามารถมองเห็นและควบคุม Agent Fleet ทั้งหมดได้แบบเรียลไทม์

แนวคิดหลัก:

- Phase 20.98 = Durable Agent Fleet Runtime
- Phase 20.99 = Mobile / Remote Agent Operations
- Phase 21.00 = Agent Runtime / Control Foundation
- Phase 21.01 = Parley Multi-Agent Work Room
- **Phase 21.02 = Mission Control สำหรับควบคุมทั้งหมดจากจุดเดียว**

Mission Control ต้องไม่เป็นเพียง Dashboard แสดงข้อมูล แต่ต้องเป็น **ระบบควบคุมงานจริง** ที่รองรับ:

- Agent lifecycle
- Job / Task / Run supervision
- Queue management
- Human approval
- Provider routing visibility
- Cost / token telemetry
- Failure recovery
- Pause / Resume / Cancel / Retry
- Audit trail
- Incident handling
- Cross-agent coordination
- Real-time events
- Security / policy enforcement

---

# 2. Core Objectives

## 2.1 Single Operational Surface

ผู้ใช้ต้องสามารถเปิดหน้าเดียวแล้วตอบคำถามเหล่านี้ได้ทันที:

- ตอนนี้ Agent ตัวไหนกำลังทำอะไร?
- งานใดกำลังรอ?
- งานใดล้มเหลว?
- งานใดกำลังรอ Approval?
- Agent ตัวไหนใช้ Provider / Model อะไร?
- Cost / Token ใช้ไปเท่าไร?
- Queue ไหนติด?
- Workflow ไหนช้า?
- มี Agent ตัวไหน Offline?
- มีงานใด Retry ซ้ำผิดปกติ?
- มีเหตุการณ์ Policy Block หรือไม่?

---

## 2.2 Human-in-the-Loop Control

Mission Control ต้องให้ Human เป็นผู้มีอำนาจสูงสุดเหนือ Agent

รองรับ:

- Approve
- Reject
- Pause
- Resume
- Cancel
- Retry
- Reassign
- Escalate
- Takeover
- Kill Run
- Lock Agent
- Quarantine Agent

ทุกคำสั่งต้อง:

1. ตรวจสิทธิ์
2. ตรวจ Policy
3. บันทึก Audit Log
4. ส่ง Event
5. อัปเดตสถานะ
6. สามารถย้อนตรวจสอบได้

---

# 3. Architecture

```text
                    ┌──────────────────────────┐
                    │     Pao-hubPro UI        │
                    │  Multi-Agent Mission     │
                    │        Control           │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   Mission Control API    │
                    └────────────┬─────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
┌─────────▼────────┐   ┌─────────▼────────┐   ┌─────────▼────────┐
│ Agent Registry   │   │ Run Controller   │   │ Approval Engine  │
└─────────┬────────┘   └─────────┬────────┘   └─────────┬────────┘
          │                      │                      │
          └──────────────┬───────┴──────────────┬───────┘
                         │                      │
                ┌────────▼────────┐    ┌────────▼────────┐
                │ Event Bus       │    │ Policy Engine   │
                └────────┬────────┘    └────────┬────────┘
                         │                      │
        ┌────────────────┼──────────────────────┼───────────────┐
        │                │                      │               │
┌───────▼───────┐ ┌──────▼───────┐ ┌───────────▼──────┐ ┌──────▼───────┐
│ OpenHermit    │ │ Parley Room  │ │ Remote Ops / SSH │ │ Provider Hub │
│ Agent Fleet   │ │ Phase 21.01  │ │ Phase 20.99      │ │ Routing      │
└───────────────┘ └──────────────┘ └──────────────────┘ └──────────────┘
```

---

# 4. Main Modules

## 4.1 Fleet Overview

แสดง Agent ทั้งหมดในระบบ

ข้อมูลขั้นต่ำ:

- Agent ID
- Agent Name
- Agent Type
- Status
- Current Task
- Current Run
- Current Provider
- Current Model
- Host / Node
- Last Heartbeat
- Queue Depth
- Active Tools
- Session Duration
- Token Usage
- Estimated Cost
- Last Error

### Agent Status

```text
IDLE
QUEUED
STARTING
RUNNING
WAITING_APPROVAL
PAUSED
BLOCKED
RETRYING
COMPLETED
FAILED
CANCELLED
OFFLINE
QUARANTINED
```

---

# 5. Mission Control Dashboard

## 5.1 Top-Level KPI Cards

หน้าแรกควรมี:

- Active Agents
- Active Runs
- Waiting Approval
- Queue Depth
- Failed Runs
- Offline Agents
- Cost Today
- Tokens Today

---

## 5.2 Fleet Grid

Card ของ Agent แต่ละตัว:

```text
Agent: Codex Builder
Status: RUNNING
Task: Implement Phase 21.02 API
Provider: OpenAI
Model: Codex
Host: local-main
Duration: 00:18:42
Tokens: 48,220
Cost: $1.24

[View]
[Pause]
[Takeover]
[Cancel]
```

---

# 6. Run Explorer

ทุก Run ต้องมี Run Detail Page

## Required Fields

```text
run_id
workflow_id
agent_id
parent_run_id
status
priority
started_at
updated_at
completed_at
provider
model
host
input_tokens
output_tokens
estimated_cost
retry_count
approval_state
current_step
error_code
error_message
```

---

# 7. Timeline View

ทุก Run ต้องมี Timeline

ตัวอย่าง:

```text
05:20:01 RUN_CREATED
05:20:03 AGENT_ASSIGNED
05:20:04 MODEL_SELECTED
05:20:05 TOOL_STARTED
05:20:21 TOOL_COMPLETED
05:20:24 HUMAN_APPROVAL_REQUESTED
05:21:03 HUMAN_APPROVED
05:21:05 RUN_RESUMED
05:21:44 RUN_COMPLETED
```

Timeline ต้องค้นหาและ Filter ได้

---

# 8. Approval Inbox

สร้างหน้า:

```text
/mission-control/approvals
```

แสดงรายการ:

- Approval ID
- Agent
- Run
- Requested Action
- Risk Level
- Requested By
- Requested At
- Policy Trigger
- Scope
- Expiration

Actions:

```text
APPROVE
REJECT
APPROVE_ONCE
APPROVE_FOR_SESSION
ESCALATE
```

---

# 9. Risk Levels

```text
LOW
MEDIUM
HIGH
CRITICAL
```

## Example

### LOW
- read file
- search local knowledge
- read logs

### MEDIUM
- modify workspace file
- install package
- execute non-destructive command

### HIGH
- delete file
- modify production config
- external account action
- privileged SSH operation

### CRITICAL
- destructive production action
- credential rotation
- infrastructure deletion
- financial transaction
- mass outbound action

---

# 10. Queue Control

หน้า:

```text
/mission-control/queues
```

รองรับ:

- View Queue
- Priority Change
- Reorder
- Pause Queue
- Resume Queue
- Retry Dead Letter
- Cancel Pending
- Drain Queue

---

# 11. Dead Letter Queue

งานที่ล้มเหลวเกิน Retry Policy ต้องถูกส่งเข้า:

```text
DLQ
```

บันทึก:

- failure reason
- stack/error
- retry count
- last agent
- provider
- model
- input snapshot
- tool context
- policy context

Actions:

```text
RETRY
REASSIGN
EDIT_INPUT
ARCHIVE
CANCEL
```

---

# 12. Agent Takeover

Human Takeover ต้องสามารถ:

1. Pause Agent
2. Freeze tool execution
3. Lock current state
4. เปิด Terminal / Workspace
5. ตรวจ Context
6. แก้ไข
7. Resume Agent

State:

```text
AUTONOMOUS
HUMAN_REVIEW
HUMAN_CONTROL
RETURNING_TO_AGENT
```

---

# 13. Provider & Model Telemetry

Mission Control ต้องแสดง:

- Provider
- Model
- Latency
- Request Count
- Error Rate
- Tokens
- Estimated Cost
- Quota
- Rate Limit
- Health
- Last Failure

---

# 14. Provider Health

Status:

```text
HEALTHY
DEGRADED
RATE_LIMITED
UNAVAILABLE
DISABLED
```

Failover Event ตัวอย่าง:

```text
OpenAI GPT-X
       ↓ rate limited
Claude
       ↓ provider policy
Local AI
```

ทุก Failover ต้อง Audit ได้

---

# 15. Cost Control

## Daily Limits

```text
daily_budget_usd
provider_budget_usd
agent_budget_usd
workflow_budget_usd
```

Actions เมื่อเกิน Budget:

```text
WARN
THROTTLE
REQUIRE_APPROVAL
PAUSE
BLOCK
```

---

# 16. Budget Dashboard

แสดง:

- Cost Today
- Cost This Week
- Cost This Month
- Cost by Agent
- Cost by Provider
- Cost by Model
- Cost by Workflow

---

# 17. Token Telemetry

เก็บ:

```text
input_tokens
output_tokens
cached_tokens
reasoning_tokens
total_tokens
```

รองรับ:

- per run
- per agent
- per provider
- per workflow
- per day

---

# 18. Event Bus

Event Names:

```text
agent.registered
agent.online
agent.offline
agent.paused
agent.resumed

run.created
run.started
run.paused
run.resumed
run.completed
run.failed
run.cancelled

approval.requested
approval.approved
approval.rejected

tool.started
tool.completed
tool.failed
tool.blocked

provider.selected
provider.failed
provider.failover

policy.allowed
policy.blocked

budget.warning
budget.exceeded
```

---

# 19. Realtime Transport

Preferred:

```text
WebSocket
```

Fallback:

```text
Server-Sent Events
```

Mission Control UI ต้อง Update โดยไม่ Reload หน้า

---

# 20. Data Model

## agents

```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL,
  host_id UUID,
  provider TEXT,
  model TEXT,
  current_run_id UUID,
  last_heartbeat TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## runs

```sql
CREATE TABLE runs (
  id UUID PRIMARY KEY,
  workflow_id UUID,
  agent_id UUID,
  parent_run_id UUID,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  provider TEXT,
  model TEXT,
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  estimated_cost NUMERIC(12,6) DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  approval_state TEXT,
  current_step TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## run_events

```sql
CREATE TABLE run_events (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  agent_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL
);
```

## approvals

```sql
CREATE TABLE approvals (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  agent_id UUID,
  action TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  policy_rule TEXT,
  status TEXT NOT NULL,
  requested_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,
  resolved_by TEXT
);
```

## cost_usage

```sql
CREATE TABLE cost_usage (
  id UUID PRIMARY KEY,
  run_id UUID,
  agent_id UUID,
  provider TEXT,
  model TEXT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_usd NUMERIC(12,6),
  created_at TIMESTAMP NOT NULL
);
```

---

# 21. API

Base:

```text
/api/mission-control
```

## Agent

```text
GET  /agents
GET  /agents/:id
POST /agents/:id/pause
POST /agents/:id/resume
POST /agents/:id/quarantine
POST /agents/:id/takeover
```

## Runs

```text
GET  /runs
GET  /runs/:id
POST /runs/:id/pause
POST /runs/:id/resume
POST /runs/:id/cancel
POST /runs/:id/retry
POST /runs/:id/reassign
```

## Approvals

```text
GET  /approvals
POST /approvals/:id/approve
POST /approvals/:id/reject
POST /approvals/:id/escalate
```

## Queue

```text
GET  /queues
POST /queues/:id/pause
POST /queues/:id/resume
POST /queues/:id/drain
```

## Telemetry

```text
GET /telemetry/cost
GET /telemetry/tokens
GET /telemetry/providers
GET /telemetry/agents
```

---

# 22. RBAC

Roles:

```text
OWNER
ADMIN
OPERATOR
REVIEWER
VIEWER
AGENT
```

## OWNER

Full access

## ADMIN

Manage agent + policies + approvals

## OPERATOR

Control runs / queues

## REVIEWER

Approve / reject high-risk actions

## VIEWER

Read-only

## AGENT

Machine identity only

---

# 23. Audit Log

ทุก Action ที่เปลี่ยน State ต้องบันทึก:

```text
actor
actor_type
action
resource_type
resource_id
before_state
after_state
reason
ip/session
timestamp
correlation_id
```

Audit Log ต้อง:

- Append-only
- Searchable
- Filterable
- Exportable
- ไม่สามารถลบผ่าน UI ปกติ

---

# 24. Incident Mode

เพิ่ม Global Incident Mode

```text
NORMAL
DEGRADED
LOCKDOWN
```

## LOCKDOWN

เมื่อเปิด:

- block new high-risk jobs
- pause external actions
- require approval for write tools
- disable unsafe providers
- preserve logs
- notify operator

---

# 25. Emergency Stop

ปุ่ม:

```text
EMERGENCY STOP
```

ต้องทำ:

1. Stop accepting new work
2. Pause queues
3. Cancel unsafe active tools
4. Freeze agent execution
5. Preserve state
6. Create incident record
7. Require explicit admin resume

ห้ามทำ Hard Kill แบบไม่เก็บ State เว้นแต่เป็น Critical Security Incident

---

# 26. UI Structure

```text
Mission Control
├── Overview
├── Agents
├── Runs
├── Approvals
├── Queues
├── Providers
├── Costs
├── Events
├── Incidents
├── Audit Logs
└── Settings
```

---

# 27. Apple-Like UI Direction

Style:

- clean
- minimal
- dense but readable
- soft cards
- subtle borders
- clear status indicators
- fast navigation
- command-palette support
- responsive desktop/mobile

ห้ามทำ Dashboard ที่มีข้อมูลล้นหน้าจอ

ใช้ Progressive Disclosure:

```text
Overview
    ↓
Agent
    ↓
Run
    ↓
Step
    ↓
Event
```

---

# 28. Command Palette

Shortcut:

```text
Ctrl/Cmd + K
```

Commands:

```text
Open Agent
Open Run
Pause Run
Resume Run
Retry Run
Open Approvals
Emergency Stop
Search Event
Search Audit
```

---

# 29. Search

Global Search รองรับ:

- agent id
- run id
- task
- workflow
- provider
- model
- error
- event
- approval
- audit actor

---

# 30. Notifications

Channels:

- In-App
- Web Push
- Discord
- Telegram
- Email
- Mobile App

Priority:

```text
INFO
WARNING
HIGH
CRITICAL
```

---

# 31. Integration — Phase 20.98 OpenHermit

Phase 21.02 ต้องดึง:

- agent state
- sandbox state
- task status
- heartbeat
- durable execution status

และส่ง:

- pause
- resume
- cancel
- reassign

---

# 32. Integration — Phase 20.99 Remote Operations

รองรับ:

- remote host status
- SSH node
- Tailscale node
- mobile supervision
- remote terminal launch
- approval from mobile

---

# 33. Integration — Phase 21.00

ใช้ Phase 21.00 เป็น Runtime / Control foundation สำหรับ:

- lifecycle
- dispatch
- execution
- state transition

Mission Control ห้ามสร้าง Runtime ซ้ำ

---

# 34. Integration — Phase 21.01 Parley

จาก Mission Control ต้องเปิด Parley Room ของ Run ได้

```text
Mission Control
      ↓
Run
      ↓
Open Parley Room
```

แสดง:

- participating agents
- discussion
- proposals
- votes / reviews
- decisions
- artifacts

---

# 35. Decision Trace

ทุก Multi-Agent Decision ควรมี:

```text
proposal
proposed_by
reviewers
review_result
decision
decision_reason
approval
execution_result
```

เป้าหมายคือให้ตรวจย้อนกลับได้ว่า:

> "ทำไม Agent ถึงตัดสินใจทำสิ่งนี้"

---

# 36. Policy Integration

ก่อน Control Action ต้องผ่าน:

```text
AUTH
↓
RBAC
↓
POLICY
↓
RISK
↓
APPROVAL
↓
EXECUTION
↓
AUDIT
```

---

# 37. State Machine

```text
QUEUED
  ↓
STARTING
  ↓
RUNNING
  ├── WAITING_APPROVAL
  ├── PAUSED
  ├── RETRYING
  ├── FAILED
  ├── CANCELLED
  └── COMPLETED
```

Invalid transition ต้อง Reject

ตัวอย่าง:

```text
COMPLETED → RUNNING
```

ห้าม

---

# 38. Idempotency

Control API ทุก endpoint ที่กระทบ State ต้องรองรับ:

```text
Idempotency-Key
```

เพื่อป้องกันคำสั่งซ้ำจาก:

- mobile reconnect
- retry
- network timeout
- double click

---

# 39. Correlation IDs

ทุก Workflow ต้องมี:

```text
trace_id
correlation_id
run_id
agent_id
```

เพื่อ trace ข้าม:

```text
UI
→ API
→ Queue
→ Agent
→ Tool
→ Provider
→ Result
```

---

# 40. Observability

รองรับ metrics:

```text
agent_active_total
agent_offline_total
run_active_total
run_failed_total
approval_pending_total
queue_depth
provider_error_rate
provider_latency_ms
token_usage_total
cost_usd_total
```

---

# 41. Logging

Log levels:

```text
DEBUG
INFO
WARN
ERROR
CRITICAL
AUDIT
```

Sensitive fields ต้อง redact:

```text
api_key
token
password
cookie
authorization
secret
private_key
```

---

# 42. Security Requirements

- no plaintext credentials
- signed agent identity
- short-lived session tokens
- policy-gated tools
- encrypted secrets
- RBAC
- audit trail
- CSRF protection
- rate limiting
- replay protection
- idempotency
- input validation
- websocket auth
- provider credential isolation

---

# 43. Multi-Node Awareness

Mission Control ต้องรู้ Host:

```text
local-main
vps-01
runpod-01
remote-pc
mobile
```

Host fields:

```text
host_id
hostname
status
cpu
memory
gpu
disk
network
last_heartbeat
active_agents
active_runs
```

---

# 44. Node Health

Status:

```text
ONLINE
DEGRADED
OFFLINE
MAINTENANCE
```

---

# 45. Agent Capability Registry

Agent Profile:

```text
agent_id
capabilities
skills
tools
mcp_servers
allowed_providers
allowed_hosts
risk_ceiling
```

Mission Control ใช้ข้อมูลนี้เพื่อไม่ Assign งานผิด Agent

---

# 46. Scheduling

รองรับ:

- priority
- capability matching
- provider constraints
- host constraints
- budget constraints
- concurrency limits

---

# 47. Concurrency Controls

ระดับ:

```text
global
host
agent
workflow
provider
tool
```

---

# 48. Rate Limits

กำหนด:

```text
requests_per_minute
runs_per_hour
tool_calls_per_minute
provider_requests_per_minute
```

---

# 49. Retry Policy

Default:

```text
max_retries = 3
backoff = exponential
jitter = enabled
```

ห้าม Auto Retry:

- destructive command
- financial operation
- external irreversible action

จนกว่าจะมี explicit policy

---

# 50. Recovery

เมื่อ Backend Restart:

Mission Control ต้อง reconstruct state จาก:

- database
- durable queue
- agent heartbeat
- active session
- run checkpoint

---

# 51. Offline Agent Handling

ถ้า heartbeat หาย:

```text
ONLINE
↓
SUSPECTED_OFFLINE
↓
OFFLINE
```

ห้าม Reassign ทันทีโดยไม่ตรวจว่า Run เดิมยังมี side effects อยู่หรือไม่

---

# 52. UX: Run Detail

หน้า Run Detail ควรมี Tabs:

```text
Overview
Timeline
Steps
Tools
Messages
Artifacts
Parley
Approvals
Cost
Logs
Audit
```

---

# 53. UX: Agent Detail

Tabs:

```text
Overview
Current Run
History
Skills
Tools
Providers
Host
Cost
Logs
Policy
```

---

# 54. UX: Approval Detail

ต้องแสดง:

```text
Agent wants to:
[Action]

Reason:
[...]

Risk:
HIGH

Affected resources:
[...]

Policy:
[...]

Preview:
[...]

[Reject] [Approve Once] [Approve]
```

---

# 55. UX: Failure Analysis

เมื่อ Run Fail:

แสดง:

```text
Failure Summary
Root Error
Failed Step
Last Successful Step
Provider
Tool
Retry Count
Recommended Recovery
Related Logs
```

Actions:

```text
Retry
Retry From Step
Reassign
Open Logs
Open Parley
Cancel
```

---

# 56. Immutable Execution Snapshot

ก่อน Retry ต้องเก็บ Snapshot:

```text
input
context
provider
model
tool state
policy state
environment
```

เพื่อสามารถเปรียบเทียบ:

```text
Attempt 1
Attempt 2
Attempt 3
```

---

# 57. Artifact Tracking

Run artifacts:

```text
files
patches
reports
images
logs
build outputs
links
```

Metadata:

```text
artifact_id
run_id
agent_id
type
path
hash
size
created_at
```

---

# 58. Integrity

Artifacts สำคัญควรมี:

```text
SHA-256
```

ใช้ตรวจ:

- corruption
- accidental overwrite
- cross-agent transfer

---

# 59. Webhooks

Events ที่ควรส่ง Webhook:

```text
run.failed
run.completed
approval.requested
agent.offline
budget.exceeded
incident.created
```

---

# 60. Feature Flags

ใช้ Feature Flag สำหรับ:

```text
mission_control
emergency_stop
cost_control
provider_failover
human_takeover
remote_terminal
```

---

# 61. Configuration

ตัวอย่าง:

```yaml
mission_control:
  enabled: true

  approvals:
    enabled: true
    timeout_minutes: 30

  costs:
    daily_budget_usd: 20

  retries:
    max_retries: 3

  heartbeat:
    interval_seconds: 15
    offline_after_seconds: 60
```

---

# 62. Implementation Layers

## Layer 1 — Data

- DB tables
- migrations
- repositories

## Layer 2 — Domain

- Agent State Machine
- Run State Machine
- Approval State Machine
- Budget Engine

## Layer 3 — Services

- Agent Service
- Run Service
- Queue Service
- Approval Service
- Cost Service
- Event Service

## Layer 4 — API

- REST
- WebSocket

## Layer 5 — UI

- Dashboard
- Agent
- Run
- Approval
- Queue
- Cost
- Events

## Layer 6 — Integration

- OpenHermit
- Parley
- Remote Ops
- Provider Router

---

# 63. Implementation Order

Recommended order:

```text
1. DB Schema
2. Agent Registry
3. Run State Machine
4. Event Store
5. Mission Control API
6. Realtime Event Stream
7. Overview UI
8. Agent UI
9. Run UI
10. Approval Inbox
11. Queue Control
12. Cost Telemetry
13. Provider Health
14. Audit Log
15. Incident Mode
16. Emergency Stop
17. Mobile Optimization
18. Integration Tests
19. Security Tests
20. Documentation
```

---

# 64. Tests

## Unit

- state transitions
- policy decisions
- cost calculations
- retry rules
- approval state

## Integration

- UI → API
- API → Queue
- Queue → Agent
- Agent → Event
- Approval → Resume
- Failover → Provider

## Failure

- provider timeout
- agent offline
- DB reconnect
- websocket reconnect
- duplicate request
- retry collision
- approval expiration

---

# 65. Security Tests

- privilege escalation
- unauthorized pause
- unauthorized approval
- forged websocket event
- replay attack
- duplicate command
- secret leakage
- path traversal
- command injection

---

# 66. Acceptance Checklist

## Core

- [ ] Mission Control dashboard loads
- [ ] Agent fleet visible
- [ ] Runs visible
- [ ] Agent status updates realtime
- [ ] Run timeline works
- [ ] Pause works
- [ ] Resume works
- [ ] Cancel works
- [ ] Retry works

## Approval

- [ ] Approval Inbox
- [ ] Approve
- [ ] Reject
- [ ] Audit
- [ ] Risk level

## Queue

- [ ] Queue list
- [ ] Pause queue
- [ ] Resume queue
- [ ] DLQ
- [ ] Retry DLQ

## Provider

- [ ] Provider health
- [ ] Provider latency
- [ ] Provider errors
- [ ] Provider failover event

## Cost

- [ ] Token tracking
- [ ] Cost tracking
- [ ] Budget limits
- [ ] Budget alerts

## Security

- [ ] RBAC
- [ ] Policy
- [ ] Audit
- [ ] Secret redaction
- [ ] Emergency Stop

## Integration

- [ ] Phase 20.98
- [ ] Phase 20.99
- [ ] Phase 21.00
- [ ] Phase 21.01

---

# 67. Definition of Done

Phase 21.02 ถือว่าเสร็จเมื่อ:

1. Agent ทั้งระบบมองเห็นจาก Mission Control
2. Run ทั้งระบบ trace ได้
3. Human สามารถ Pause / Resume / Cancel / Retry ได้
4. Approval Inbox ใช้งานจริง
5. Queue และ DLQ ควบคุมได้
6. Provider Health แสดงผลจริง
7. Token / Cost telemetry ใช้งานจริง
8. Audit Log ครบทุก control action
9. Emergency Stop ผ่าน test
10. WebSocket reconnect ผ่าน test
11. RBAC ผ่าน test
12. Integration กับ Phase 20.98–21.01 ผ่าน test
13. Documentation complete
14. Completion Report generated
15. Implementation Matrix updated
16. GOLD status updated

---

# 68. Required Deliverables

```text
docs/
└── Phase_21.02_Pao-hubPro_Multi-Agent_Mission_Control.md

mission-control/
├── api/
├── domain/
├── services/
├── realtime/
├── ui/
├── telemetry/
├── approvals/
├── queues/
├── audit/
└── tests/

PHASE_21.02_COMPLETION_REPORT.md
PHASE_IMPLEMENTATION_MATRIX.md
GOLD_IMPLEMENTATION_STATUS.md
```

---

# 69. Non-Goals

Phase 21.02 ไม่ควร:

- เขียน Agent Runtime ใหม่
- สร้าง Provider Router ใหม่
- แทนที่ OpenHermit
- แทนที่ Parley
- ทำ Remote Desktop ใหม่
- ให้ Agent ข้าม Policy
- ให้ UI เรียก Tool โดยตรง

Mission Control เป็น **Control Plane** ไม่ใช่ execution engine ตัวใหม่

---

# 70. Final Target Architecture

```text
                 Pao-hubPro
                     │
          ┌──────────▼──────────┐
          │ Multi-Agent Mission │
          │      Control        │
          └──────────┬──────────┘
                     │
     ┌───────────────┼─────────────────┐
     │               │                 │
 Agent Fleet      Parley Room      Remote Ops
 Phase 20.98      Phase 21.01      Phase 20.99
     │               │                 │
     └───────────────┼─────────────────┘
                     │
             Runtime Foundation
                 Phase 21.00
                     │
        ┌────────────┼────────────┐
        │            │            │
     Models        Tools        MCP
        │            │            │
        └────────────┼────────────┘
                     │
              Local / VPS / Cloud
```

---

# 71. Final Principle

> **Observe everything. Control safely. Preserve state. Audit every action. Human remains in command.**

Phase 21.02 ต้องทำให้ Pao-hubPro เปลี่ยนจาก "ระบบที่มี Agent หลายตัว" ไปเป็น "ระบบปฏิบัติการ Agent ที่ควบคุมได้จริง"

---

# 72. Recommended Phase Status

```text
Phase 21.02
Pao-hubPro × Multi-Agent Mission Control

STATUS:
READY_FOR_IMPLEMENTATION
```
