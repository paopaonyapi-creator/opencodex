# Phase 20.12 — Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

> **Project:** Pao-hubPro  
> **Phase:** 20.12  
> **Status:** Design + Implementation Blueprint  
> **Date:** 2026-09-09  
> **Primary Goal:** เพิ่ม Android/Mobile execution subsystem ให้ Pao-hubPro ผ่าน Google ARTEMIS โดยคง Pao-hubPro เป็นศูนย์กลางด้าน orchestration, permissions, safety, audit และ reviewer verification  
> **Upstream:** https://github.com/google/artemis

---

## 0. Executive Summary

Phase 20.12 จะเพิ่มความสามารถให้ Pao-hubPro จากเดิมที่เน้น AI ↔ PC / Browser / VPS ให้ขยายไปสู่:

```text
AI / Codex
   ↓
Pao-hubPro
   ↓
MCP Router / Policy Gateway
   ├── Local PC Tools
   ├── Browser Tools
   ├── VPS Tools
   └── Mobile Gateway
          ↓
       ARTEMIS
          ↓
      ADB / Android
          ↓
   Phone / Emulator
```

ARTEMIS จะถูกใช้เป็น **Mobile Execution Engine** ไม่ใช่ Core Orchestrator ของ Pao-hubPro

Pao-hubPro จะรับผิดชอบ:

- Device Registry
- Authentication / Authorization
- Permission Policy
- Risk Classification
- Approval Gate
- Task Routing
- Task History
- Audit Log
- Reviewer Council Verification
- Dashboard Integration
- Secrets Isolation
- Safe Remote Access

ARTEMIS จะรับผิดชอบ:

- Mobile task execution
- Screen observation
- Accessibility / UI hierarchy
- OCR / visual grounding
- Tap / swipe / input
- ADB diagnostics ตาม profile ที่อนุญาต
- Trace / screenshots / replay
- Flash / Pro execution
- Multi-device targeting

---

# 1. Why This Phase

Pao-hubPro ต้องการเป็น Agent-Native Workspace ที่ AI สามารถทำงานข้ามหลาย execution surface ได้

ก่อน Phase 20.12:

```text
Pao-hubPro
├── Coding
├── Local File
├── Local Command
├── Browser
├── VPS
├── Web App
└── AI Generation / Adobe Stock
```

หลัง Phase 20.12:

```text
Pao-hubPro
├── Coding
├── Local File
├── Local Command
├── Browser
├── VPS
├── Web App
├── AI Generation / Adobe Stock
└── Mobile / Android
    ├── Physical Device
    ├── Emulator
    ├── Screenshot
    ├── UI Hierarchy
    ├── OCR
    ├── Automated Interaction
    ├── Log / Diagnostics
    ├── Trace
    └── Replay
```

ผลลัพธ์คือ Codex/Agent สามารถ:

1. แก้โค้ด
2. build APK
3. ติดตั้ง APK
4. เปิดแอป
5. ทดสอบ flow จริง
6. ตรวจ popup / crash
7. เก็บ screenshot
8. อ่าน trace
9. ส่งผลกลับ Reviewer Council
10. แก้ bug รอบถัดไป

ได้ใน workflow เดียว

---

# 2. Verified ARTEMIS Baseline

ข้อมูล baseline ที่ Phase นี้อิงจาก upstream `google/artemis` ณ วันที่ 2026-09-09

## 2.1 Native MCP Server

ARTEMIS มี MCP server และมี mobile tools หลัก:

```text
mobile_run_task
mobile_manage_task
mobile_get_device_state
mobile_inspect_trace
```

แนวทางเชื่อม Pao-hubPro:

```text
Pao-hubPro MCP Router
        ↓
Artemis Adapter
        ↓
ARTEMIS MCP Server
        ↓
Android Device
```

---

## 2.2 Codex Integration

ARTEMIS รองรับการสร้าง config สำหรับ Codex และสามารถติดตั้ง MCP/rules ให้ AI IDE หลายตัว

ตัวอย่าง upstream:

```toml
[mcp_servers.artemis]
command = "/path/to/artemis/.venv/bin/python"
args = ["-m", "mcp_server"]
cwd = "/path/to/artemis"

[mcp_servers.artemis.env]
PYTHONUNBUFFERED = "1"
PYTHONPATH = "/path/to/artemis"
```

Phase 20.12 จะไม่ให้ Codex bypass Pao-hubPro policy layer ในโหมด production

Production path ที่ต้องการคือ:

```text
Codex
  ↓
Pao-hubPro
  ↓
Permission + Safety Gate
  ↓
Artemis Adapter
  ↓
ARTEMIS
```

Direct Codex → ARTEMIS ใช้ได้เฉพาะ development/debug profile

---

## 2.3 Flash / Pro Profiles

### Flash

เหมาะกับ:

- เปิดแอป
- กดเมนู
- ตรวจ text
- swipe
- simple deterministic flow
- smoke test
- quick UI validation

ข้อดี:

- เร็ว
- token-efficient
- เหมาะกับ repeatable tasks

ข้อจำกัดสำคัญ:

- ไม่มี task plan แบบ Pro
- ไม่มี checkpoint verification แบบ Pro
- ไม่มี pre-execution safety net แบบ Pro
- ไม่มี ADB shell แบบ Pro

### Pro

เหมาะกับ:

- workflow ยาว
- debugging
- verification checkpoints
- recovery
- diagnostics
- ADB diagnostics
- final report
- complex UI

Pao-hubPro policy:

```text
Low-risk task        → Flash preferred
Medium-risk task     → Flash or Pro
High-risk task       → Pro + Approval + Strict Verification
Forbidden task       → Reject
```

---

## 2.4 Web Visual Console

ARTEMIS มี Web Visual Test Console:

```bash
uv run artemis ui
```

ใช้สำหรับ:

- live screen
- natural language dispatch
- task queue
- task history
- execution replay
- telemetry

ใน Phase 20.12 รุ่นแรก:

> **Reuse ARTEMIS UI ก่อน**

จากนั้น Pao-hubPro Dashboard ค่อยดึงเฉพาะข้อมูลสำคัญเข้าหน้ากลาง

---

## 2.5 Device Targeting

ARTEMIS รองรับ `device_serial`

ตัวอย่าง:

```text
emulator-5554
R58M...
```

ดังนั้น Phase นี้จะสร้าง Device Registry ด้าน Pao-hubPro เพื่อไม่ให้ agent ต้องจัดการ raw serial เองตลอดเวลา

ตัวอย่าง logical alias:

```text
android-test-01
android-test-02
pao-dev-phone
emulator-pixel-01
```

---

# 3. Core Architecture

```text
┌────────────────────────────────────────────────────────────┐
│                        User / Pao                          │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                      Pao-hubPro UI                         │
│ Dashboard / Task Console / Device Panel / Audit           │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                    Agent Orchestrator                      │
│ Codex / ChatGPT / Local AI / Reviewer Council             │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                    MCP / Tool Router                       │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐     ┌───────────────────────────┐
│ Local / Browser / VPS    │     │     Mobile Gateway        │
│ Execution Tools          │     │                           │
└──────────────────────────┘     └────────────┬──────────────┘
                                             │
                                             ▼
                                ┌─────────────────────────────┐
                                │ Risk Classifier             │
                                │ Policy Engine               │
                                │ Permission Gate             │
                                │ Approval Gate               │
                                └────────────┬────────────────┘
                                             │
                                             ▼
                                ┌─────────────────────────────┐
                                │ Artemis Adapter             │
                                │ MCP Client / API Client     │
                                └────────────┬────────────────┘
                                             │
                                             ▼
                                ┌─────────────────────────────┐
                                │ Google ARTEMIS              │
                                │ Flash / Pro                 │
                                │ Trace / Replay              │
                                └────────────┬────────────────┘
                                             │
                                             ▼
                                ┌─────────────────────────────┐
                                │ ADB / Android               │
                                └───────┬─────────────┬───────┘
                                        │             │
                                        ▼             ▼
                                     Phone         Emulator
```

---

# 4. Architecture Rule — Do Not Fork Core ARTEMIS

## Required Decision

**ห้าม copy ARTEMIS source code เข้า Pao-hubPro core โดยตรง**

ใช้ dependency boundary:

```text
Pao-hubPro
└── integrations
    └── artemis
        ├── adapter
        ├── client
        ├── policy
        ├── schemas
        └── tests
```

ARTEMIS อยู่แยก:

```text
/opt/pao-hubpro/integrations/artemis-upstream
```

หรือ development:

```text
~/pao-hubpro-runtime/artemis
```

ข้อดี:

- update upstream ง่าย
- rollback ง่าย
- ลด merge conflict
- ลด vendor lock
- เปลี่ยน ARTEMIS เป็น mobile engine ตัวอื่นในอนาคตได้
- Pao-hubPro policy ไม่ผูกกับ implementation ภายใน ARTEMIS

---

# 5. Phase Scope

## IN SCOPE

- Artemis Adapter
- MCP/API integration
- Device Registry
- Device aliases
- Health checks
- Task dispatch
- Task status
- Cancel task
- Instruction injection
- Device state capture
- Screenshot retrieval
- UI hierarchy retrieval
- Trace inspection
- Flash / Pro routing
- Safety policy
- Approval gate
- Audit log
- Reviewer verification
- Dashboard device panel
- Basic multi-device support
- Development emulator workflow
- Physical test-device workflow

## OUT OF SCOPE

Phase 20.12 จะยังไม่ทำ:

- iOS automation
- bypass Android security
- rooted-device exploitation
- banking automation
- crypto wallet transaction automation
- OTP interception
- CAPTCHA bypass
- hidden credential extraction
- arbitrary unrestricted ADB shell exposed to AI
- public Internet exposure of raw ARTEMIS service
- production device farm autoscaling
- automated App Store / Play Store publishing
- unattended financial purchase flows

---

# 6. Milestones

---

## 20.12.1 — Artemis Upstream Adapter

### Goal

สร้าง abstraction layer ระหว่าง Pao-hubPro กับ ARTEMIS

### Proposed Interface

```python
class MobileAutomationProvider:
    async def health(self): ...
    async def list_devices(self): ...
    async def run_task(self, request): ...
    async def get_task(self, task_id): ...
    async def stop_task(self, task_id): ...
    async def inject_instruction(self, task_id, instruction): ...
    async def get_device_state(self, device_id, mode): ...
    async def inspect_trace(self, trace_id): ...
```

Implementation:

```text
MobileAutomationProvider
        ↓
ArtemisProvider
```

อนาคตอาจเพิ่ม:

```text
AppiumProvider
MaestroProvider
AndroidWorldProvider
```

โดยไม่เปลี่ยน API ด้านบน

### Acceptance

- Adapter start ได้
- health check ผ่าน
- ส่ง task ไป ARTEMIS ได้
- อ่าน status ได้
- stop task ได้
- screenshot/device state ได้
- inspect trace ได้

---

## 20.12.2 — Android MCP Gateway

### Goal

ไม่เปิด ARTEMIS tools ตรงให้ทุก agent

สร้าง Pao-hubPro mobile tools:

```text
mobile.device.list
mobile.device.inspect
mobile.task.run
mobile.task.status
mobile.task.stop
mobile.task.inject
mobile.task.trace
mobile.task.screenshot
```

หรือ MCP naming:

```text
pao_mobile_list_devices
pao_mobile_get_device
pao_mobile_run_task
pao_mobile_manage_task
pao_mobile_get_device_state
pao_mobile_inspect_trace
```

ทุก call ต้องผ่าน:

```text
Schema Validation
      ↓
Auth
      ↓
Permission
      ↓
Risk Classifier
      ↓
Policy
      ↓
Approval (if required)
      ↓
Execute
      ↓
Audit
```

### Acceptance

- ไม่มี route ที่ bypass policy
- input validated
- user/session captured
- device captured
- task id captured
- risk class captured
- trace id captured

---

## 20.12.3 — Device Registry

### Goal

จัดการ Android devices ด้วย logical identity

### Device Model

```json
{
  "id": "dev_01",
  "alias": "android-test-01",
  "provider": "artemis",
  "serial": "emulator-5554",
  "type": "emulator",
  "status": "ready",
  "trust_level": "test",
  "allow_agent": true,
  "allow_shell": false,
  "labels": ["android", "test", "pixel"],
  "last_seen_at": "..."
}
```

### Device Types

```text
emulator
physical_test
physical_personal
physical_restricted
```

### Trust Levels

```text
test
trusted
restricted
blocked
```

### Rule

`physical_personal` ต้อง default เป็น:

```text
allow_agent = false
allow_shell = false
requires_approval = true
```

### Acceptance

- register device
- alias device
- disable device
- block device
- heartbeat
- last seen
- serial masked ใน UI สำหรับ user ที่ไม่จำเป็นต้องเห็น

---

## 20.12.4 — Codex Integration

### Development Mode

Codex สามารถเชื่อม ARTEMIS โดยตรงเพื่อ debug integration ได้

### Production Mode

ต้องเป็น:

```text
Codex
 ↓
Pao-hubPro MCP
 ↓
Mobile Gateway
 ↓
ARTEMIS
```

### Codex Rules

เพิ่ม rules:

```text
1. Never guess mobile UI state.
2. Observe before acting.
3. Prefer semantic/resource/text locators.
4. Use coordinates only as fallback.
5. Use Flash for simple low-risk flow.
6. Use Pro for complex verification/debug.
7. Never interact with financial apps.
8. Never handle OTP/2FA secrets.
9. Never execute destructive ADB commands without explicit policy approval.
10. Always return trace/screenshot evidence for test completion.
```

### Acceptance

Codex ทำ flow ตัวอย่างได้:

```text
Build APK
→ Install
→ Launch
→ Navigate
→ Validate UI
→ Screenshot
→ Trace
→ Report
```

---

## 20.12.5 — Safety Permission Gate

### Risk Levels

#### R0 — Observe Only

Examples:

- screenshot
- hierarchy
- app visible-state inspection
- device status

Policy:

```text
AUTO ALLOW
```

#### R1 — Low Risk Interaction

Examples:

- tap
- swipe
- scroll
- open test app
- navigate settings read-only

Policy:

```text
AUTO ALLOW
on test devices
```

#### R2 — Medium Risk

Examples:

- input non-secret text
- install development APK
- clear test app state
- start diagnostics
- app relaunch

Policy:

```text
ALLOW on trusted test devices
AUDIT required
```

#### R3 — High Risk

Examples:

- permission changes
- uninstall app
- shell diagnostics with side effects
- system setting changes
- persistent configuration changes

Policy:

```text
EXPLICIT APPROVAL
PRO PROFILE
STRICT VERIFICATION
```

#### R4 — Forbidden

Examples:

- banking transactions
- crypto wallet transfers
- OTP extraction/interception
- password harvesting
- security bypass
- stealth surveillance
- destructive wipe
- unauthorized privilege escalation
- disabling device security
- bypass screen lock
- arbitrary secret extraction

Policy:

```text
DENY
```

---

# 7. Safe Task Lifecycle

```text
NEW
 ↓
VALIDATING
 ↓
CLASSIFYING_RISK
 ↓
WAITING_APPROVAL ──→ REJECTED
 ↓
QUEUED
 ↓
RUNNING
 ↓
VERIFYING
 ↓
COMPLETED
```

Error paths:

```text
FAILED
CANCELLED
TIMED_OUT
BLOCKED_BY_POLICY
DEVICE_OFFLINE
PROVIDER_ERROR
```

Every transition must be recorded

---

# 8. Task Request Schema

```json
{
  "task_id": "mtask_xxx",
  "goal": "Open the test app and verify login screen",
  "device_id": "dev_01",
  "profile": "auto",
  "verification_level": "final",
  "timeout_sec": 300,
  "evidence": {
    "screenshot": true,
    "trace": true,
    "hierarchy": false
  },
  "requested_by": {
    "type": "agent",
    "id": "codex"
  }
}
```

### Profile Values

```text
auto
flash
pro
```

### Verification

```text
off
final
checkpoints
strict
```

### Pao-hubPro Auto Routing

```text
R0 → Flash
R1 → Flash
R2 → Flash or Pro
R3 → Pro + strict
R4 → Deny
```

---

# 9. Device State Contract

```json
{
  "device_id": "dev_01",
  "provider": "artemis",
  "provider_device_serial": "emulator-5554",
  "online": true,
  "screen": {
    "width": 1080,
    "height": 2400,
    "orientation": "portrait"
  },
  "foreground_app": "com.example.app",
  "screenshot_artifact_id": "artifact_xxx",
  "hierarchy_artifact_id": "artifact_yyy",
  "captured_at": "..."
}
```

---

# 10. Trace Contract

Pao-hubPro ต้องไม่เก็บ trace เป็น text ก้อนเดียว

แยก:

```text
trace
├── metadata
├── task
├── steps
├── screenshots
├── actions
├── checker_results
├── errors
└── final_report
```

ตัวอย่าง step:

```json
{
  "step": 7,
  "action_type": "tap",
  "target": {
    "strategy": "text",
    "value": "Login"
  },
  "result": "success",
  "screenshot_before": "artifact_a",
  "screenshot_after": "artifact_b",
  "timestamp": "..."
}
```

---

# 11. Reviewer Council Integration

หลัง ARTEMIS task เสร็จ:

```text
ARTEMIS Result
     ↓
Evidence Collector
     ↓
Reviewer Council
     ├── Reviewer A: Goal Completion
     ├── Reviewer B: UI / Evidence
     ├── Reviewer C: Safety / Policy
     └── Optional Local Reviewer
     ↓
Aggregator
     ↓
PASS / FAIL / NEEDS_REVIEW
```

Reviewer Council ห้าม execute mobile actions

Reviewer มีสิทธิ์:

```text
READ TRACE
READ SCREENSHOT
READ REPORT
READ POLICY RESULT
```

แต่ไม่มี:

```text
TAP
SWIPE
SHELL
INSTALL
DELETE
```

### Review Output

```json
{
  "decision": "PASS",
  "confidence": 0.96,
  "goal_complete": true,
  "safety_ok": true,
  "evidence_ok": true,
  "issues": []
}
```

---

# 12. Proposed Pao-hubPro Directory Structure

```text
pao-hubpro/
├── apps/
│   └── dashboard/
│
├── core/
│   ├── orchestrator/
│   ├── policy/
│   ├── audit/
│   └── reviewer/
│
├── integrations/
│   └── artemis/
│       ├── __init__.py
│       ├── client.py
│       ├── provider.py
│       ├── mapper.py
│       ├── schemas.py
│       ├── exceptions.py
│       ├── health.py
│       └── README.md
│
├── mobile/
│   ├── gateway/
│   │   ├── service.py
│   │   ├── router.py
│   │   └── permissions.py
│   │
│   ├── devices/
│   │   ├── registry.py
│   │   ├── models.py
│   │   └── service.py
│   │
│   ├── tasks/
│   │   ├── models.py
│   │   ├── service.py
│   │   ├── lifecycle.py
│   │   └── classifier.py
│   │
│   ├── evidence/
│   │   ├── screenshots.py
│   │   ├── traces.py
│   │   └── artifacts.py
│   │
│   └── policies/
│       ├── mobile_policy.yaml
│       └── forbidden_actions.yaml
│
├── mcp/
│   └── tools/
│       └── mobile_tools.py
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│       └── mobile/
│
└── docs/
    └── phases/
        └── phase-20.12-artemis-mobile-gateway.md
```

ปรับ path ให้เข้ากับ repo จริงก่อน implement

---

# 13. Suggested Database Tables

## mobile_devices

```sql
id
alias
provider
provider_device_id
device_type
trust_level
status
allow_agent
allow_shell
requires_approval
labels_json
last_seen_at
created_at
updated_at
```

## mobile_tasks

```sql
id
device_id
goal
profile
verification_level
risk_level
status
provider_task_id
trace_id
requested_by_type
requested_by_id
approved_by
started_at
finished_at
created_at
updated_at
```

## mobile_task_events

```sql
id
task_id
event_type
payload_json
created_at
```

## mobile_artifacts

```sql
id
task_id
artifact_type
storage_key
sha256
mime_type
size_bytes
created_at
```

## policy_decisions

```sql
id
task_id
risk_level
decision
rule_id
reason
created_at
```

---

# 14. API Proposal

```text
GET    /api/mobile/devices
GET    /api/mobile/devices/:id
POST   /api/mobile/devices/:id/enable
POST   /api/mobile/devices/:id/disable

POST   /api/mobile/tasks
GET    /api/mobile/tasks
GET    /api/mobile/tasks/:id
POST   /api/mobile/tasks/:id/stop
POST   /api/mobile/tasks/:id/inject
GET    /api/mobile/tasks/:id/trace
GET    /api/mobile/tasks/:id/artifacts

POST   /api/mobile/tasks/:id/approve
POST   /api/mobile/tasks/:id/reject

GET    /api/mobile/health
GET    /api/mobile/provider/health
```

---

# 15. Dashboard

เพิ่มเมนู:

```text
Mobile Agents
```

ภายใน:

```text
Overview
Devices
Tasks
Live Task
Traces
Screenshots
Approvals
Policies
Provider Health
```

## Device Card

แสดง:

```text
Alias
Type
Status
Trust Level
Provider
Current Task
Last Seen
Agent Access
```

Actions:

```text
Inspect
Enable
Disable
Open Live Console
Run Test Task
```

## Task Detail

```text
Goal
Device
Profile
Risk
Approval
Status
Timeline
Screenshots
Trace
Reviewer Result
Final Report
```

---

# 16. Security Design

## 16.1 Network

ARTEMIS service:

```text
127.0.0.1
```

หรือ private network เท่านั้น

ห้าม:

```text
0.0.0.0 publicly exposed
```

ถ้าต้อง remote:

```text
Internet
 ↓
VPN / Tailscale / Private Tunnel
 ↓
Pao-hubPro Auth
 ↓
Mobile Gateway
 ↓
ARTEMIS Private Endpoint
```

---

## 16.2 Secrets

ห้ามส่ง:

```text
password
API key
OTP
2FA code
wallet seed
private key
session secret
```

เข้า prompt log โดยตรง

ใช้:

```text
Secret Reference
↓
Secure Resolver
↓
Scoped Injection
```

และต้อง redact ใน audit

---

## 16.3 Device Separation

แนะนำ:

```text
Device A → Daily personal phone
Device B → Pao-hubPro test phone
Emulator → CI / repeatable tests
```

เริ่ม Phase ด้วย:

> Emulator ก่อน

แล้วค่อย physical test device

ไม่เริ่มจากมือถือหลัก

---

# 17. Dynamic-First Locator Policy

Pao-hubPro ต้องบังคับ automation mindset:

```text
1. Resource ID
2. Accessibility / Semantics
3. Visible Text
4. OCR
5. Visual Region
6. Coordinates
```

Coordinates = fallback

ห้าม generate test script แบบ hard-code coordinate เป็นค่าเริ่มต้นถ้ามี dynamic locator ใช้ได้

---

# 18. Observability

Metrics:

```text
mobile_tasks_total
mobile_tasks_success_total
mobile_tasks_failed_total
mobile_tasks_blocked_total
mobile_task_duration_seconds
mobile_device_online
mobile_provider_health
mobile_approval_wait_seconds
mobile_trace_artifacts_total
```

Logs:

```text
request_id
task_id
device_id
agent_id
risk_level
policy_decision
provider_task_id
trace_id
status
duration
```

ห้าม log secrets

---

# 19. Health Checks

## Provider

```text
ARTEMIS process alive
MCP/API reachable
version available
```

## Android

```text
ADB reachable
device authorized
device online
screen state available
```

## Pao-hubPro

```text
registry OK
database OK
artifact storage OK
policy engine OK
reviewer service OK
```

---

# 20. Failure Handling

### Device Offline

```text
task → DEVICE_OFFLINE
```

ไม่ retry แบบไม่จำกัด

### ARTEMIS Unavailable

```text
provider → unhealthy
new tasks → reject/queue based on policy
```

### Task Timeout

```text
request stop
wait grace period
mark TIMED_OUT
save available trace
```

### Policy Violation

```text
stop before execution
BLOCKED_BY_POLICY
audit reason
```

### Approval Expired

```text
EXPIRED
```

ห้าม auto-approve

---

# 21. Development Setup Target

Environment assumptions:

```text
Python >= 3.12
uv
ADB
scrcpy
FFmpeg
Android emulator or USB debugging device
```

Suggested upstream location:

```text
~/pao-hubpro-runtime/artemis
```

Clone:

```bash
git clone https://github.com/google/artemis.git ~/pao-hubpro-runtime/artemis
cd ~/pao-hubpro-runtime/artemis
```

ใช้ upstream setup script/CLI ตาม OS

จากนั้น verify:

```bash
adb devices -l
uv run artemis status
```

ทดลอง UI:

```bash
uv run artemis ui
```

ทดลอง MCP config generation:

```bash
uv run artemis mcp --generate-config codex
```

> หมายเหตุ: คำสั่ง upstream อาจเปลี่ยนในอนาคต ให้ Codex อ่าน README ปัจจุบันก่อนติดตั้งจริงเสมอ

---

# 22. Implementation Strategy

## Stage A — Emulator First

```text
ARTEMIS
 ↓
Android Emulator
 ↓
System Settings test
```

เป้าหมาย:

- connectivity
- screenshot
- simple tap
- trace

## Stage B — Pao-hubPro Adapter

```text
Pao-hubPro
 ↓
Artemis Provider
 ↓
Emulator
```

## Stage C — Policy

เพิ่ม:

```text
Risk classifier
Permission
Approval
Audit
```

## Stage D — Reviewer

เพิ่ม:

```text
Trace
Screenshot
Reviewer Council
```

## Stage E — Dashboard

เพิ่ม:

```text
Devices
Tasks
Trace
Approvals
```

## Stage F — Physical Test Device

หลัง emulator tests ผ่านเท่านั้น

---

# 23. Test Plan

## Unit Tests

- risk classifier
- policy matching
- task state machine
- device registry
- provider mappings
- schema validation
- secret redaction

## Integration Tests

- provider health
- mock ARTEMIS MCP
- run task
- status
- stop
- screenshot
- trace
- device state

## E2E Tests

### E2E-01

```text
Open Android Settings
→ Find Battery
→ Verify page loaded
→ Capture screenshot
```

Expected:

```text
PASS
trace exists
screenshot exists
```

### E2E-02

```text
Open test app
→ Navigate to Login
→ Verify fields
→ No credentials entered
```

### E2E-03

Send forbidden request:

```text
Open banking app and transfer money
```

Expected:

```text
BLOCKED_BY_POLICY
ARTEMIS not called
```

### E2E-04

R3 task:

```text
Change persistent device setting
```

Expected:

```text
WAITING_APPROVAL
```

### E2E-05

Provider offline

Expected:

```text
PROVIDER_ERROR
no uncontrolled retry loop
```

---

# 24. Acceptance Criteria

Phase 20.12 ถือว่า **DONE** เมื่อครบทุกข้อ:

## Integration

- [ ] ARTEMIS ติดตั้งแยกจาก Pao-hubPro core
- [ ] Artemis Adapter ทำงาน
- [ ] provider health check ได้
- [ ] Pao-hubPro เรียก mobile task ได้
- [ ] task status ได้
- [ ] stop task ได้
- [ ] device state ได้
- [ ] screenshot ได้
- [ ] trace inspection ได้

## Device

- [ ] Device Registry
- [ ] logical alias
- [ ] emulator supported
- [ ] physical test device supported
- [ ] blocked/restricted state

## Safety

- [ ] risk classifier
- [ ] R0–R4
- [ ] forbidden list
- [ ] R3 approval
- [ ] R4 reject before provider call
- [ ] secret redaction
- [ ] raw ARTEMIS not exposed publicly

## Audit

- [ ] task lifecycle stored
- [ ] policy decision stored
- [ ] provider task id stored
- [ ] trace id stored
- [ ] artifacts stored
- [ ] failures stored

## Reviewer

- [ ] completed task can enter Reviewer Council
- [ ] reviewer has read-only evidence
- [ ] reviewer output stored
- [ ] PASS / FAIL / NEEDS_REVIEW supported

## UI

- [ ] Mobile Agents menu
- [ ] device list
- [ ] task list
- [ ] task detail
- [ ] screenshot view
- [ ] trace link
- [ ] approval queue

## QA

- [ ] unit tests pass
- [ ] integration tests pass
- [ ] E2E-01 pass
- [ ] forbidden E2E test pass
- [ ] no secret in logs
- [ ] README updated

---

# 25. Non-Negotiable Rules

Codex ต้องทำตาม:

1. ห้าม rewrite Pao-hubPro architecture โดยไม่จำเป็น
2. ห้าม fork ARTEMIS code เข้า core
3. ห้าม expose raw ADB เป็น unrestricted public tool
4. ห้ามให้ mobile tool bypass policy layer
5. ห้าม execute R3 โดยไม่มี approval
6. ห้าม execute R4
7. ห้ามใช้ personal phone เป็น default target
8. ห้ามเก็บ secrets ใน logs
9. ห้าม hard-code provider-specific objects ทั่วทั้ง codebase
10. ต้องมี provider abstraction
11. ต้องมี tests
12. ต้องรักษา backward compatibility ของ features เดิม
13. ต้องใช้ feature flag
14. ต้อง rollback ได้
15. ต้องอัปเดต documentation

---

# 26. Feature Flags

```env
PAO_MOBILE_ENABLED=false
PAO_MOBILE_PROVIDER=artemis
PAO_MOBILE_ALLOW_PHYSICAL=false
PAO_MOBILE_ALLOW_SHELL=false
PAO_MOBILE_REQUIRE_REVIEW=true
PAO_MOBILE_DEFAULT_PROFILE=flash
PAO_MOBILE_DEFAULT_VERIFICATION=final
```

Production เริ่มด้วย:

```env
PAO_MOBILE_ENABLED=true
PAO_MOBILE_ALLOW_PHYSICAL=false
PAO_MOBILE_ALLOW_SHELL=false
```

จนกว่า emulator validation จะผ่าน

---

# 27. Environment Proposal

```env
ARTEMIS_HOME=/opt/pao-hubpro/integrations/artemis-upstream
ARTEMIS_TRANSPORT=stdio
ARTEMIS_HOST=127.0.0.1
ARTEMIS_PORT=8000

PAO_MOBILE_ENABLED=true
PAO_MOBILE_PROVIDER=artemis
PAO_MOBILE_DEFAULT_PROFILE=flash
PAO_MOBILE_DEFAULT_VERIFICATION=final

PAO_MOBILE_ALLOW_PHYSICAL=false
PAO_MOBILE_ALLOW_SHELL=false
PAO_MOBILE_REQUIRE_REVIEW=true
```

ห้าม commit secret env

---

# 28. Rollback Plan

ถ้า integration มีปัญหา:

```text
PAO_MOBILE_ENABLED=false
```

Pao-hubPro features อื่นต้องทำงานต่อ

Rollback levels:

### Level 1

disable Mobile Gateway

### Level 2

disable Artemis Provider

### Level 3

remove upstream ARTEMIS runtime

### Level 4

revert Phase 20.12 migration

Database migration ต้อง reversible ถ้า framework รองรับ

---

# 29. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Agent กดผิด UI | High | Pro Safety Net + policy + verification |
| ใช้กับมือถือส่วนตัว | High | device trust + default deny |
| ADB สิทธิ์กว้าง | High | no raw unrestricted shell |
| Upstream เปลี่ยน API | Medium | adapter boundary |
| Device disconnect | Medium | heartbeat + explicit state |
| Screenshot มีข้อมูลส่วนตัว | High | artifact access policy |
| Prompt contains secret | High | secret scanner/redaction |
| Endless task | Medium | timeout + lifecycle control |
| Provider down | Medium | health checks |
| Hard-coded coordinates | Medium | dynamic-first policy |
| Codex bypass gateway | High | production MCP config only points to Pao-hubPro |
| Reviewer modifies device | High | reviewer read-only permissions |

---

# 30. Definition of Done

Phase 20.12 ไม่ถือว่าเสร็จเพียงเพราะ ARTEMIS เปิดได้

ต้องพิสูจน์ workflow นี้:

```text
User
 ↓
Pao-hubPro
 ↓
Codex / Agent
 ↓
Mobile Task Request
 ↓
Risk Classification
 ↓
Policy
 ↓
ARTEMIS
 ↓
Android Emulator
 ↓
Action
 ↓
Screenshot + Trace
 ↓
Reviewer Council
 ↓
Verified Result
 ↓
Dashboard
```

และ forbidden flow:

```text
User / Agent
 ↓
Forbidden Mobile Request
 ↓
Policy R4
 ↓
DENY
 ↓
ARTEMIS NOT CALLED
 ↓
Audit
```

ผ่านทั้งสอง flow จึงถือว่า Phase เสร็จ

---

# 31. Recommended Next Phase

หลัง Phase 20.12:

## Phase 20.13 — Pao-hubPro Mobile QA Factory

แนวทาง:

```text
Code Change
 ↓
Build APK
 ↓
Install Emulator
 ↓
ARTEMIS Smoke Test
 ↓
Regression Flow
 ↓
Screenshot Diff
 ↓
Logcat / Trace
 ↓
Reviewer Council
 ↓
PASS
 ↓
Allow Merge
```

เป้าหมายคือเปลี่ยน Mobile Gateway จาก “AI คุมมือถือได้” ไปเป็น “AI QA pipeline อัตโนมัติ”

---

# 32. One-Shot Codex Implementation Prompt

คัดลอกทั้งหมดด้านล่างไปใช้กับ Codex ได้

```text
You are implementing Phase 20.12 of Pao-hubPro:

"Phase 20.12 — Pao-hubPro × Google ARTEMIS Mobile Agent Gateway"

MISSION
Add a safe Android/mobile automation subsystem to Pao-hubPro using Google ARTEMIS:
https://github.com/google/artemis

Pao-hubPro MUST remain the top-level orchestrator, policy authority, audit authority, and reviewer authority.
ARTEMIS is an external mobile execution provider only.

DO NOT blindly implement from assumptions.
First inspect the existing Pao-hubPro repository and current architecture.
Then inspect the current upstream ARTEMIS README, mcp_server README, configuration, and exposed MCP/API interfaces.
Adapt the plan below to the real repository structure while preserving existing conventions.

==================================================
NON-NEGOTIABLE ARCHITECTURE
==================================================

Required production path:

Codex / Agent
  -> Pao-hubPro Tool/MCP Router
  -> Mobile Gateway
  -> Auth / Permission
  -> Risk Classifier
  -> Policy Engine
  -> Approval Gate when required
  -> Artemis Adapter
  -> ARTEMIS
  -> Android Device / Emulator

Do NOT make production Codex call ARTEMIS directly.

Do NOT vendor or fork ARTEMIS source into the Pao-hubPro core.

Create a provider abstraction so ARTEMIS can later be replaced by another implementation.

==================================================
PHASE OBJECTIVES
==================================================

Implement:

1. Artemis upstream adapter
2. Mobile provider abstraction
3. Mobile MCP/tool gateway
4. Android device registry
5. logical device aliases
6. device health / heartbeat
7. mobile task lifecycle
8. run/status/stop/inject task operations
9. screenshot/device-state retrieval
10. trace inspection
11. Flash/Pro routing
12. risk classification R0-R4
13. approval gate
14. forbidden-action policy
15. audit trail
16. evidence/artifact storage
17. Reviewer Council read-only verification hook
18. dashboard pages/components
19. feature flags
20. unit/integration/E2E tests
21. documentation
22. rollback controls

==================================================
ARTEMIS BASELINE
==================================================

Current ARTEMIS exposes native MCP support with tools conceptually including:

- mobile_run_task
- mobile_manage_task
- mobile_get_device_state
- mobile_inspect_trace

Do not trust this list blindly if upstream changed.
Inspect current upstream first.

ARTEMIS supports Flash and Pro execution profiles.

Use ARTEMIS behind an adapter.
Map provider-specific responses into Pao-hubPro-owned schemas.

==================================================
PROVIDER ABSTRACTION
==================================================

Create or adapt an interface equivalent to:

class MobileAutomationProvider:
    async def health(...)
    async def list_devices(...)
    async def run_task(...)
    async def get_task(...)
    async def stop_task(...)
    async def inject_instruction(...)
    async def get_device_state(...)
    async def inspect_trace(...)

Implement:

ArtemisProvider(MobileAutomationProvider)

Keep ARTEMIS-specific types inside integrations/artemis or the repository's equivalent integration boundary.

==================================================
DEVICE REGISTRY
==================================================

Required logical device fields:

- id
- alias
- provider
- provider_device_id / serial
- device_type
- trust_level
- status
- allow_agent
- allow_shell
- requires_approval
- labels
- last_seen_at
- created_at
- updated_at

device_type values:

- emulator
- physical_test
- physical_personal
- physical_restricted

trust_level values:

- test
- trusted
- restricted
- blocked

Defaults for physical_personal:

allow_agent = false
allow_shell = false
requires_approval = true

Never default an agent to a personal device.

==================================================
MOBILE TASK STATE MACHINE
==================================================

Support at least:

NEW
VALIDATING
CLASSIFYING_RISK
WAITING_APPROVAL
QUEUED
RUNNING
VERIFYING
COMPLETED
FAILED
CANCELLED
TIMED_OUT
REJECTED
BLOCKED_BY_POLICY
DEVICE_OFFLINE
PROVIDER_ERROR

Persist state transitions.

==================================================
RISK POLICY
==================================================

R0 OBSERVE ONLY
Examples:
- screenshot
- hierarchy
- read-only device/app state

Default:
AUTO ALLOW

R1 LOW RISK
Examples:
- tap
- swipe
- scroll
- open a test app
- read-only navigation

Default:
AUTO ALLOW ON TEST DEVICES

R2 MEDIUM
Examples:
- enter non-secret test text
- install development APK
- clear test-app state
- controlled diagnostics

Default:
ALLOW ON TRUSTED TEST DEVICES
AUDIT REQUIRED

R3 HIGH
Examples:
- persistent system setting changes
- uninstall
- shell actions with side effects
- permission changes

Default:
EXPLICIT APPROVAL
PRO PROFILE
STRICT VERIFICATION

R4 FORBIDDEN
Examples:
- banking transaction
- crypto wallet transfer
- OTP extraction/interception
- credential harvesting
- security bypass
- lock-screen bypass
- arbitrary secret extraction
- destructive wipe
- unauthorized privilege escalation
- stealth surveillance

Default:
DENY BEFORE CALLING ARTEMIS

Implement policy in a maintainable rule representation, not scattered if-statements.

==================================================
FLASH / PRO ROUTING
==================================================

Support requested profile:

auto
flash
pro

Suggested auto route:

R0 -> Flash
R1 -> Flash
R2 -> Flash or Pro based on task complexity
R3 -> Pro + strict verification
R4 -> Deny

Do not assume Flash has the same safety/verification properties as Pro.
Consult upstream docs before implementation.

==================================================
DYNAMIC-FIRST LOCATOR MINDSET
==================================================

Document and enforce for generated automation/test guidance:

1. Resource ID
2. Accessibility / Semantics
3. Visible text
4. OCR
5. Visual region
6. Coordinates as fallback

Never make coordinate hard-coding the default when a stable dynamic locator exists.

==================================================
SECURITY
==================================================

Requirements:

- raw ARTEMIS must not be publicly exposed
- prefer loopback/private network
- remote access must pass Pao-hubPro auth
- no unrestricted raw ADB shell tool for agents
- redact secrets in logs
- do not persist OTP/password/API key/private key/wallet seed
- screenshots/traces are protected artifacts
- reviewer agents receive read-only evidence access only
- production Codex tool configuration must target Pao-hubPro, not ARTEMIS directly

Add safe feature flags.

Suggested flags:

PAO_MOBILE_ENABLED
PAO_MOBILE_PROVIDER
PAO_MOBILE_ALLOW_PHYSICAL
PAO_MOBILE_ALLOW_SHELL
PAO_MOBILE_REQUIRE_REVIEW
PAO_MOBILE_DEFAULT_PROFILE
PAO_MOBILE_DEFAULT_VERIFICATION

Use existing config conventions if the repository has them.

==================================================
MCP / TOOL SURFACE
==================================================

Expose Pao-hubPro-owned tools equivalent to:

pao_mobile_list_devices
pao_mobile_get_device
pao_mobile_run_task
pao_mobile_manage_task
pao_mobile_get_device_state
pao_mobile_inspect_trace

Every execution tool call must pass:

schema validation
-> authentication
-> authorization
-> risk classification
-> policy evaluation
-> approval if required
-> provider execution
-> audit

No bypass route.

==================================================
REVIEWER COUNCIL
==================================================

After eligible task completion:

ARTEMIS Result
-> Evidence Collector
-> Reviewer Council
-> Aggregated Decision

Reviewer inputs:

- task goal
- final result
- screenshots
- trace
- policy decision
- checker/final report when available

Reviewer permissions are read-only.

Output:

PASS
FAIL
NEEDS_REVIEW

Persist reviewer result.

==================================================
DASHBOARD
==================================================

Add/adapt a "Mobile Agents" area.

Provide:

- Overview
- Devices
- Tasks
- Task Detail
- Screenshots / Artifacts
- Trace
- Approvals
- Policies
- Provider Health

Respect existing Pao-hubPro UI design system.
Do not replace the current UI framework.

==================================================
OBSERVABILITY
==================================================

Capture:

request_id
task_id
device_id
agent_id
risk_level
policy_decision
provider_task_id
trace_id
status
duration

Never log secrets.

Add health checks for:

- provider
- ADB/device state
- registry/storage/database
- policy engine

==================================================
FAILURE HANDLING
==================================================

Device offline:
-> DEVICE_OFFLINE

Provider offline:
-> PROVIDER_ERROR or controlled queue behavior

Timeout:
-> request stop
-> grace period
-> TIMED_OUT
-> save partial trace if available

Policy violation:
-> BLOCKED_BY_POLICY
-> do not call provider

Approval expiry:
-> expire/reject
-> never auto-approve

Avoid infinite retries.

==================================================
TESTS
==================================================

Unit:
- risk classifier
- policy
- state machine
- device registry
- schema mapping
- redaction

Integration:
- mock Artemis provider/MCP
- health
- run
- status
- stop
- screenshot
- state
- trace

E2E using emulator first:

E2E-01:
Open Android Settings
-> navigate to Battery
-> verify page
-> screenshot
-> trace
Expected PASS

E2E-02:
Open a test app
-> navigate to Login
-> verify fields
-> do not use real credentials

E2E-03:
Forbidden request such as banking/crypto transfer
Expected:
BLOCKED_BY_POLICY
ARTEMIS MUST NOT BE CALLED

E2E-04:
R3 persistent setting change
Expected:
WAITING_APPROVAL

E2E-05:
Provider unavailable
Expected:
controlled PROVIDER_ERROR
no infinite retry

==================================================
ROLLBACK
==================================================

Mobile subsystem must be removable/disableable without breaking existing Pao-hubPro features.

PAO_MOBILE_ENABLED=false

must cleanly disable the feature.

Do not make existing core modules depend unconditionally on ARTEMIS.

==================================================
IMPLEMENTATION WORKFLOW
==================================================

Perform the work in this order:

1. inspect repository
2. inspect current upstream ARTEMIS
3. produce concise implementation map
4. create/update provider abstraction
5. implement Artemis adapter
6. implement registry
7. implement task lifecycle
8. implement policy/risk system
9. expose safe tools/API
10. implement audit/evidence
11. add reviewer hook
12. add dashboard
13. add feature flags
14. add tests
15. run tests/lint/typecheck/build
16. fix failures
17. update documentation
18. produce final implementation report

Do not stop after scaffolding.
Implement working code appropriate to the existing repository.

==================================================
FINAL REPORT
==================================================

At completion report:

1. files added
2. files modified
3. architecture implemented
4. ARTEMIS integration method
5. exposed Pao-hubPro mobile tools
6. risk/policy behavior
7. device registry behavior
8. reviewer integration
9. dashboard additions
10. tests executed
11. test results
12. known limitations
13. exact commands to run
14. rollback steps
15. remaining items before enabling physical devices

If any requested component cannot be safely completed because the existing repository lacks required infrastructure, implement the safest compatible subset and clearly document the gap instead of inventing architecture.
```

---

# 33. Source References

Official upstream used for this Phase:

- Google ARTEMIS repository  
  https://github.com/google/artemis

- ARTEMIS MCP Server README  
  https://github.com/google/artemis/blob/main/mcp_server/README.md

- ARTEMIS pyproject.toml  
  https://github.com/google/artemis/blob/main/pyproject.toml

- ARTEMIS README  
  https://github.com/google/artemis/blob/main/README.md

---

# 34. Final Recommendation

**Implement Phase 20.12.**

แต่ให้เริ่มจาก:

```text
Emulator
→ ARTEMIS
→ Artemis Adapter
→ Pao-hubPro Policy Gateway
→ Trace
→ Reviewer Council
```

ก่อนเปิด physical-device automation

เป้าหมายของ Phase นี้ไม่ใช่เพียง:

> “Codex กดมือถือได้”

แต่คือ:

> **“Pao-hubPro สามารถให้ AI ใช้ Android เป็น execution surface ได้อย่างควบคุมได้ ตรวจสอบย้อนหลังได้ ปิดได้ และมีหลักฐานยืนยันผล”**

นี่คือฐานที่เหมาะสมสำหรับ Phase 20.13 Mobile QA Factory ต่อไป
