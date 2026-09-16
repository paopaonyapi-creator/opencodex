# Phase 20.21 — Pao-hubPro × OpenAI Codex Native Runtime Integration

> **สถานะ:** Ready for implementation  
> **โปรเจกต์:** Pao-hubPro  
> **Phase:** 20.21  
> **เป้าหมายหลัก:** เปลี่ยน Pao-hubPro ให้ใช้ OpenAI Codex เป็น native coding-agent runtime โดยให้ Pao-hubPro ทำหน้าที่เป็น Control Plane / Orchestrator แทนการสร้าง agent runtime ซ้ำเอง  
> **Primary target:** Windows PC + Linux VPS  
> **แนวทาง:** Stable-first, local-first, secure-by-default, version-aware, feature-flagged experimental capabilities  
> **Reference repository:** https://github.com/openai/codex

---

## 0. Executive Summary

Phase 20.21 จะยกระดับ Pao-hubPro จากระบบที่ “เรียก Codex เป็นเครื่องมือภายนอก” ไปเป็นระบบที่ “ควบคุม Codex Runtime โดยตรง” ผ่านชั้น integration ที่เป็นทางการและตรวจสอบเวอร์ชันได้

สถาปัตยกรรมเป้าหมาย:

```text
ChatGPT / Pao-hubPro Web Dashboard
                │
                ▼
        Pao Control Plane
                │
     ┌──────────┼───────────┐
     │          │           │
     ▼          ▼           ▼
Codex SDK   App Server   MCP Bridge
     │          │           │
     └──────────┼───────────┘
                ▼
          Codex Runtime
                │
     ┌──────────┼────────────┐
     │          │            │
     ▼          ▼            ▼
  Sandbox   Exec Server    Tools
     │          │            │
     └──────────┼────────────┘
                ▼
      Local PC / VPS / Repos
```

หลักสำคัญของ Phase นี้คือ:

1. **ไม่ fork Codex core เป็นค่าเริ่มต้น**
2. **ใช้ official runtime surfaces ก่อน**
3. **แยก Pao-hubPro ออกจาก Codex implementation details ด้วย adapter**
4. **สร้าง policy / approval layer ของ Pao-hubPro ครอบอีกชั้น**
5. **ทุก experimental capability ต้องอยู่หลัง feature flag**
6. **ห้ามใช้ full-access / bypass sandbox เป็น default**
7. **รองรับ session, streaming, approval, audit และ recovery ตั้งแต่แรก**
8. **ถ้า Codex API เปลี่ยน ต้องตรวจจับได้และ downgrade/fallback ได้**

---

# 1. Why This Phase Exists

ก่อน Phase 20.21 Pao-hubPro มีแนวคิดและองค์ประกอบหลายส่วนที่ทับซ้อนกับ Codex runtime เช่น:

- agent execution
- session/thread management
- safe command execution
- filesystem tools
- approval gate
- MCP tools
- remote execution
- coding workflow
- reviewer agents
- dashboard streaming
- process control

การสร้างทั้งหมดเองจะเพิ่ม:

- maintenance cost
- security surface
- compatibility burden
- process orchestration complexity
- duplicated agent logic
- breakage เมื่อ Codex เปลี่ยน protocol

ดังนั้น Phase นี้กำหนดให้:

```text
Pao-hubPro = Control Plane
Codex      = Coding Agent Runtime
```

แทน:

```text
Pao-hubPro = Control Plane + Custom Codex-like Runtime
```

---

# 2. Current Codex Capabilities Relevant to Pao-hubPro

ณ เวลาจัดทำ Phase นี้ Codex repository มี surface สำคัญที่นำมาใช้ได้ดังนี้

## 2.1 Codex CLI

Codex CLI เป็น coding agent ที่รัน locally และเป็น baseline fallback ที่ต้องเก็บไว้เสมอ

ใช้กรณี:

- diagnostics
- recovery
- smoke tests
- fallback เมื่อ SDK/App Server ใช้งานไม่ได้
- manual admin operations

Pao-hubPro ต้องไม่ parse human-readable terminal output เป็น primary protocol

---

## 2.2 Codex Python SDK

Python SDK เหมาะกับ:

- programmatic thread creation
- turn execution
- streaming
- resume
- sync / async workflows
- multiple active turns
- agent orchestration

**Primary use in Pao-hubPro:**

```text
services/codex_gateway
        │
        ▼
openai_codex SDK
        │
        ▼
Codex Runtime
```

ให้ใช้ SDK เป็น integration route หลักสำหรับ orchestration ถ้าเวอร์ชันที่ติดตั้งรองรับ feature ที่ต้องการครบ

---

## 2.3 Codex App Server

`codex app-server` เป็น machine-readable interface สำหรับสร้าง rich UI/client

Protocol:

- bidirectional JSON-RPC
- stdio เป็น stable/default transport
- Unix socket supported
- WebSocket transport ให้ถือว่า experimental จนกว่าจะตรวจสอบเวอร์ชัน runtime แล้ว

Core primitives:

```text
Thread
  └─ Turn
      └─ Items / Events
```

App Server รองรับการ generate schema:

```bash
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR
```

และสามารถ generate experimental schema แยกได้:

```bash
codex app-server generate-ts --out DIR --experimental
codex app-server generate-json-schema --out DIR --experimental
```

### Pao-hubPro requirement

ต้อง generate schema จาก Codex version ที่ติดตั้งจริง และเก็บไว้ใน:

```text
generated/codex/<version>/
```

ห้าม hard-code protocol จากความจำหรือจาก version เก่า

---

## 2.4 Codex Exec Server

`codex exec-server` ให้ process/filesystem execution ผ่าน machine-readable protocol

เหมาะกับ:

- remote execution worker
- controlled subprocesses
- filesystem operations
- PTY/process lifecycle
- remote environment integration

Phase นี้ **ยังไม่ให้ exec-server มีอำนาจโดยตรงจาก Web UI**

ต้องผ่าน:

```text
Web UI
  ↓
Pao API
  ↓
Policy Engine
  ↓
Approval Broker
  ↓
Exec Adapter
  ↓
Codex Exec Server
```

---

## 2.5 App Server Daemon / Remote Control

Codex มี app-server daemon สำหรับ lifecycle/remote control

ปัจจุบันรองรับ:

- Linux
- macOS
- Windows

แต่ daemon ยังถูกระบุว่า **experimental**

ดังนั้น:

```text
PAO_CODEX_DAEMON_ENABLED=false
```

ต้องเป็นค่าเริ่มต้น

เปิดได้เมื่อ:

- runtime compatibility check ผ่าน
- user เปิด feature เอง
- health check ผ่าน
- recovery path พร้อม

---

## 2.6 MCP

MCP ใช้เชื่อม Codex กับ external tools/services

ใน Pao-hubPro จะใช้สำหรับ:

- Browser tools
- ComfyUI
- Adobe Stock workflow
- VPS utilities
- local services
- future plugins/connectors

แต่ approval ของ MCP ต้องถูกควบคุมอย่างระมัดระวัง เพราะ headless workflows อาจติดค้างหากไม่มี approval surface

---

# 3. Architecture Decision

## ADR-20.21-001 — Codex as Runtime, Pao-hubPro as Control Plane

**Decision:** Adopt

```text
┌────────────────────────────────────────────┐
│              Pao-hubPro UI                 │
│ Dashboard / Mobile / ChatGPT-facing APIs  │
└────────────────────┬───────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│            Pao Control Plane               │
│ Auth / Sessions / Policies / Audit / Jobs │
└──────┬──────────────┬──────────────┬───────┘
       │              │              │
       ▼              ▼              ▼
 Codex SDK      App Server       MCP Layer
 Adapter         Adapter          Adapter
       │              │              │
       └──────────────┼──────────────┘
                      ▼
              Codex Runtime
                      │
             Sandbox / Approvals
                      │
                 Exec Layer
                      │
             PC / VPS / Repos
```

### Rules

- Pao-hubPro owns product behavior
- Codex owns coding-agent runtime behavior
- Pao-hubPro must be able to survive Codex upgrade
- Runtime adapters must be replaceable
- Experimental features must never leak into core domain interfaces

---

# 4. Goals

Phase 20.21 ต้องทำให้สำเร็จอย่างน้อย:

- [ ] ตรวจพบ Codex installation และ version
- [ ] ตรวจสอบ runtime capability
- [ ] สร้าง Codex Gateway
- [ ] รองรับ Python SDK adapter
- [ ] รองรับ App Server adapter
- [ ] normalize events เป็น Pao event model
- [ ] start / resume / cancel Codex sessions
- [ ] stream status และ output ไป Web Dashboard
- [ ] รองรับ approval requests
- [ ] รองรับ sandbox policy profiles
- [ ] เพิ่ม MCP inventory
- [ ] เพิ่ม runtime health page
- [ ] เพิ่ม audit log
- [ ] รองรับ Windows PC
- [ ] รองรับ Linux VPS
- [ ] รองรับ graceful fallback
- [ ] รองรับ version mismatch
- [ ] มี integration tests
- [ ] มี security tests
- [ ] มี smoke test แบบ one-command

---

# 5. Non-Goals

Phase นี้ **ยังไม่ทำ**:

- fork และแก้ Codex core โดยตรง
- replace Codex authentication
- เปิด full disk access เป็น default
- เปิด unrestricted network เป็น default
- expose shell ตรงจาก browser
- auto-approve destructive tools ทุกชนิด
- ทำ remote fleet จำนวนมากแบบ production
- ทำ Adobe Stock end-to-end ใหม่ทั้งหมด
- ทำ ComfyUI orchestration ใหม่ทั้งหมด
- ทำ browser automation engine ใหม่ทั้งหมด

สิ่งเหล่านี้จะต่อยอดบน runtime integration หลัง Phase 20.21 เสถียรแล้ว

---

# 6. Repository Strategy

Codex ต้องเริ่มด้วยการตรวจ repository Pao-hubPro ปัจจุบันก่อน

**ห้ามสร้าง structure ใหม่ทับของเดิมทันที**

ให้ทำ:

1. inspect current project structure
2. identify frontend/backend/runtime boundaries
3. identify language/framework
4. identify current MCP implementation
5. identify auth
6. identify database
7. identify audit/logging
8. identify existing agent orchestration
9. identify current local execution layer
10. map existing components → target architecture

จากนั้น reuse ของเดิมก่อนสร้างของใหม่

---

# 7. Target Modules

ชื่อจริงปรับตาม repository เดิมได้ แต่ logical modules ต้องมีครบ

```text
pao-hubpro/
├─ apps/
│  └─ web/
│
├─ services/
│  ├─ control_plane/
│  ├─ codex_gateway/
│  ├─ policy_engine/
│  ├─ approval_broker/
│  ├─ audit_service/
│  └─ node_manager/
│
├─ packages/
│  ├─ codex_protocol/
│  ├─ runtime_types/
│  ├─ event_types/
│  └─ shared/
│
├─ generated/
│  └─ codex/
│     └─ <version>/
│
├─ config/
│  ├─ policies/
│  └─ runtime/
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ security/
│  └─ smoke/
│
├─ scripts/
│  ├─ codex-detect.*
│  ├─ codex-schema-sync.*
│  ├─ codex-health.*
│  └─ phase-20.21-smoke.*
│
└─ docs/
   ├─ architecture/
   └─ runbooks/
```

ถ้า repository เป็น monolith ให้รักษาโครงสร้างเดิม แต่ต้องคง separation of concerns เทียบเท่า

---

# 8. Runtime Adapter Interface

สร้าง abstraction กลาง:

```text
CodexRuntimeAdapter
```

ขั้นต่ำต้องมี capability:

```text
detect()
health()
capabilities()
start_thread()
resume_thread()
start_turn()
stream_turn()
cancel_turn()
get_thread()
list_threads()
request_approval()
shutdown()
```

และ metadata:

```text
runtime_name
runtime_version
protocol_version
transport
experimental_features
platform
auth_state
```

---

# 9. Runtime Selection Strategy

ให้สร้าง Runtime Router:

```text
                Request
                   │
                   ▼
            Runtime Router
           /       |        \
          /        |         \
         ▼         ▼          ▼
 Python SDK   App Server    CLI Fallback
```

ลำดับแนะนำ:

### Mode A — SDK

ใช้เมื่อ:

- Python SDK installed
- capability required รองรับ
- health check ผ่าน

### Mode B — App Server

ใช้เมื่อ:

- ต้องการ richer protocol/events
- ต้องการ schema-generated client
- approval/UI integration ต้องการ JSON-RPC surface

### Mode C — CLI fallback

ใช้เฉพาะ:

- diagnostics
- emergency compatibility
- smoke test
- user-triggered fallback

ห้ามใช้ screen scraping / fragile text parsing เป็น core

---

# 10. Capability Detection

ก่อนทุก startup ให้สร้าง capability report:

```json
{
  "codexInstalled": true,
  "codexVersion": "detected-at-runtime",
  "pythonSdkAvailable": true,
  "appServerAvailable": true,
  "execServerAvailable": true,
  "daemonAvailable": true,
  "remoteControlAvailable": true,
  "mcpAvailable": true,
  "experimentalApiEnabled": false,
  "platform": "windows|linux|macos"
}
```

ห้าม assume capability จาก version string อย่างเดียว ถ้าทดสอบ runtime ได้

---

# 11. Schema Sync

สร้าง command:

```text
pao codex schema sync
```

หรือ script ที่เหมาะกับ stack เดิม

workflow:

```text
Detect Codex
    ↓
Read Version
    ↓
Generate Stable TS Schema
    ↓
Generate Stable JSON Schema
    ↓
Optional Experimental Schema
    ↓
Save to generated/codex/<version>/
    ↓
Run type validation
```

### Required behavior

- stable schema เป็น default
- experimental schema เก็บแยก
- commit generated stable schema ได้ถ้าเหมาะกับ repo
- CI ต้อง detect schema drift
- ไม่ overwrite version เก่าโดยเงียบ ๆ

---

# 12. Normalized Pao Event Model

App Server / SDK event ต้อง map เป็น Pao-hubPro event กลาง

ตัวอย่าง:

```ts
type PaoRuntimeEvent =
  | RuntimeConnected
  | RuntimeDisconnected
  | ThreadStarted
  | ThreadResumed
  | TurnStarted
  | TurnProgress
  | AgentMessageDelta
  | AgentMessageCompleted
  | ToolStarted
  | ToolCompleted
  | ToolFailed
  | ApprovalRequested
  | ApprovalResolved
  | SandboxViolation
  | RuntimeWarning
  | RuntimeError
  | TurnCompleted
  | TurnCancelled;
```

Web UI ห้าม bind ตรงกับ Codex raw protocol

---

# 13. Session Manager

สร้าง Pao Session ที่ map กับ Codex Thread

```text
Pao Session
   │
   ├─ pao_session_id
   ├─ codex_thread_id
   ├─ workspace_id
   ├─ node_id
   ├─ runtime_mode
   ├─ status
   ├─ created_at
   ├─ updated_at
   └─ policy_profile
```

ต้องรองรับ:

- create
- resume
- reconnect
- cancellation
- stale-session detection
- crash recovery
- runtime restart reconciliation

---

# 14. Approval Broker

นี่คือ security-critical component

```text
Codex Tool Request
       │
       ▼
Approval Broker
       │
 ┌─────┼────────┐
 │     │        │
 ▼     ▼        ▼
ALLOW ASK      DENY
```

Approval Broker ต้องรู้:

- tool
- command
- arguments
- path
- network intent
- workspace
- session
- node
- risk classification

### Approval timeout

ห้ามปล่อย approval request ค้างไม่จำกัด

กำหนด:

```text
pending
  ↓
timeout
  ↓
safe cancel / deny
```

timeout ต้อง configurable และมี audit event

---

# 15. Policy Profiles

สร้าง profile ขั้นต่ำ 4 แบบ

## SAFE

```text
sandbox: read-only
network: restricted
write: denied
destructive tools: denied
approval: required for escalation
```

## NORMAL

```text
sandbox: workspace-write
network: restricted by default
write: workspace only
destructive tools: approval required
```

## AUTOMATION

```text
sandbox: workspace-write
network: allowlist only
known-safe tools: policy-driven
destructive tools: approval required
```

## FULL ACCESS

```text
sandbox: full access
network: enabled
```

**FULL ACCESS ต้อง:**

- disabled by default
- require explicit unlock
- display risk warning
- expire automatically
- create high-severity audit entry

---

# 16. Forbidden Defaults

ห้ามตั้งค่าเหล่านี้เป็น default:

```text
danger-full-access
unrestricted network
destructive auto-approval
arbitrary path writes
shell from browser directly
approval bypass
global secret exposure
```

โดยเฉพาะคำสั่ง/flag แนว:

```text
--dangerously-bypass-approvals-and-sandbox
```

ห้ามถูกเรียกจาก normal runtime flow

อนุญาตเฉพาะ isolated dev/test environment ที่มี external containment และ user สั่งชัดเจนเท่านั้น

---

# 17. Workspace Security

ทุก Codex session ต้องผูกกับ workspace root

ตัวอย่าง:

```text
C:\PaoHub\workspaces\<workspace-id>
```

หรือ Linux:

```text
/opt/pao-hubpro/workspaces/<workspace-id>
```

### Rules

- canonicalize path ก่อน policy check
- ป้องกัน path traversal
- ป้องกัน symlink escape
- normalize Windows drive/path
- deny sensitive directories
- secrets directories ต้อง deny by default
- temp workspace แยกตาม session ถ้าทำได้

---

# 18. Command Policy

สร้าง command classifier

### LOW RISK

```text
git status
git diff
git log
rg
ls
dir
pwd
cat/read-only equivalents
test commands without network
```

### MEDIUM RISK

```text
npm install
pip install
git checkout
git switch
git pull
build scripts
database migrations in dev
```

### HIGH RISK

```text
rm / del
recursive delete
format disk
registry/system edits
service manipulation
firewall changes
credential tooling
git push --force
database destructive migration
production deployment
```

HIGH RISK ต้อง approval เสมอ

---

# 19. Network Policy

default:

```text
network_access = restricted
```

เมื่อ session ต้อง network:

```text
Request
  ↓
Domain/endpoint classification
  ↓
Allowlist policy
  ↓
Approval if needed
  ↓
Temporary scoped grant
```

อย่าเปิด internet unrestricted เพราะ dependency install แค่ครั้งเดียว

---

# 20. Secrets Handling

ห้ามส่ง secrets เข้า:

- prompt
- UI logs
- audit payload แบบ plain text
- thread title
- generated debug dump

สร้าง:

```text
SecretRedactor
```

รองรับอย่างน้อย:

- OPENAI_API_KEY
- CODEX_API_KEY
- GitHub tokens
- SSH keys
- cloud credentials
- database URLs/passwords
- webhook secrets
- MCP secrets

log ต้อง redact ก่อน persist

---

# 21. MCP Integration

สร้าง MCP Inventory page

แสดง:

```text
Server
Status
Transport
Tools
Risk
Approval mode
Last health check
Last error
```

### Tool annotations

ถ้า MCP tool รองรับ annotations ให้ Pao-hubPro ใช้ข้อมูลเช่น:

```text
read-only intent
destructive intent
open-world/network intent
```

เพื่อประกอบ policy

แต่ **ห้ามเชื่อ annotations อย่างเดียว**

Pao policy ต้องเป็น authority สุดท้าย

---

# 22. Headless MCP Approval Safety

ต้องมี regression test สำหรับกรณี:

```text
headless agent
   ↓
MCP tool
   ↓
approval required
   ↓
no UI connected
```

expected:

```text
approval broker catches request
   ↓
bounded timeout
   ↓
deny/cancel safely
   ↓
turn receives structured failure
```

ห้าม:

```text
hang forever
```

ถ้า Codex runtime version มี bug/behavior ไม่แน่นอน ให้ Pao-hubPro:

- detect pending approval
- surface state
- set timeout
- provide cancellation
- record audit
- document runtime-specific workaround

---

# 23. App Server Client

เมื่อใช้ App Server ต้อง:

1. spawn/connect safely
2. send `initialize`
3. confirm initialization
4. record runtime metadata
5. subscribe/consume events
6. handle bounded queues/backpressure
7. retry overload errors with exponential backoff + jitter
8. reconnect safely
9. reconcile thread state after reconnect
10. shutdown gracefully

### Transport policy

Priority:

```text
stdio
  ↓
Unix socket when appropriate
  ↓
WebSocket only behind experimental flag
```

---

# 24. Experimental API Policy

สร้าง flag:

```env
PAO_CODEX_EXPERIMENTAL_API=false
```

เมื่อ false:

- generate stable schema only
- do not request experimental API
- daemon remote feature off unless independently supported and approved
- hide experimental UI

เมื่อ true:

- log Codex version
- log feature set
- show EXPERIMENTAL badge
- run compatibility smoke test
- allow targeted experimental capability only

ห้ามใช้ single switch แล้วเปิดทุก experimental featureอัตโนมัติ

ควรมี per-feature flags เช่น:

```env
PAO_CODEX_EXPERIMENTAL_API=false
PAO_CODEX_WS_TRANSPORT=false
PAO_CODEX_DAEMON_ENABLED=false
PAO_CODEX_REMOTE_CONTROL=false
```

---

# 25. Daemon Integration

เพิ่ม optional Daemon Manager

functions:

```text
status
start
stop
restart
version
enable_remote_control
disable_remote_control
```

### Windows requirement

ต้อง test บน Windows จริง โดยเฉพาะ:

- detached process behavior
- CODEX_HOME path length
- socket/path constraints
- non-elevated terminal behavior
- restart after crash

### Rule

ถ้า daemon failed:

```text
fallback → embedded/local app-server
```

โดยไม่ทำให้ Pao-hubPro ทั้งระบบล่ม

---

# 26. Remote Node Model

เตรียม data model โดยไม่เปิด production fleet เต็มรูปแบบ

```text
Node
├─ id
├─ name
├─ platform
├─ hostname
├─ codex_version
├─ runtime_mode
├─ connection_state
├─ last_seen
├─ capability_report
├─ policy_profile
└─ enabled
```

ตัวอย่าง:

```text
Pao-PC
Windows
Online

Pao-VPS-01
Linux
Online
```

---

# 27. Dashboard — Runtime Overview

เพิ่มหน้า:

```text
/runtime
```

แสดง:

- Codex detected
- Codex version
- SDK version
- runtime mode
- App Server status
- daemon status
- exec-server status
- MCP count
- active threads
- active turns
- pending approvals
- current policy
- platform
- last health check

---

# 28. Dashboard — Sessions

หน้า:

```text
/sessions
```

แต่ละ session แสดง:

```text
Status
Workspace
Thread ID
Node
Model
Runtime adapter
Sandbox
Policy
Started
Last activity
```

actions:

```text
Open
Resume
Cancel
Archive
View logs
```

---

# 29. Dashboard — Live Turn View

หน้า session detail ต้องมี:

```text
User Prompt
Agent Progress
Tool Calls
Commands
File Changes
Approvals
Warnings
Final Result
```

stream แบบ realtime เท่าที่ stack ปัจจุบันรองรับ

ใช้:

- SSE
- WebSocket
- existing realtime layer

อย่างใดอย่างหนึ่งตาม architecture เดิมของ Pao-hubPro

ห้ามผูก frontend ตรงกับ Codex raw socket

---

# 30. Dashboard — Approval Center

หน้า:

```text
/approvals
```

แสดง:

```text
Request
Risk
Tool
Command
Path
Network
Session
Node
Requested at
Expires at
```

actions:

```text
Approve once
Approve scoped
Deny
Cancel turn
```

### ห้ามมี

```text
Approve everything forever
```

เป็นปุ่มเด่น/default

---

# 31. Dashboard — Policy Center

หน้า:

```text
/policies
```

แสดง profile:

```text
SAFE
NORMAL
AUTOMATION
FULL ACCESS
```

และ config:

```text
write scope
network
tool rules
command rules
path rules
approval rules
TTL
```

---

# 32. Dashboard — MCP / Tool Inventory

หน้า:

```text
/tools
```

จัดกลุ่ม:

```text
Codex Built-ins
MCP Servers
Pao Tools
Remote Node Tools
Plugins
```

แต่ละ tool:

```text
enabled
risk
approval behavior
source
health
```

---

# 33. Audit Log

ทุก action สำคัญต้องบันทึก:

```text
runtime.start
runtime.stop
runtime.upgrade_detected
thread.start
thread.resume
turn.start
turn.cancel
tool.call
tool.result
approval.request
approval.allow
approval.deny
policy.change
sandbox.escalation
network.grant
full_access.unlock
remote_control.enable
remote_control.disable
```

Audit entry:

```json
{
  "id": "...",
  "timestamp": "...",
  "actor": "...",
  "sessionId": "...",
  "nodeId": "...",
  "action": "...",
  "risk": "...",
  "result": "...",
  "metadata": {}
}
```

ต้อง redact secrets

---

# 34. Health Checks

สร้าง:

```text
GET /api/runtime/codex/health
```

logical response:

```json
{
  "status": "healthy",
  "codex": {
    "installed": true,
    "version": "runtime-detected"
  },
  "sdk": {
    "available": true
  },
  "appServer": {
    "available": true,
    "initialized": true
  },
  "daemon": {
    "enabled": false,
    "status": "disabled"
  },
  "mcp": {
    "healthy": true
  }
}
```

HTTP path ปรับตาม backend conventions เดิมได้

---

# 35. Observability

ขั้นต่ำ:

- structured logs
- request correlation ID
- Pao session ID
- Codex thread ID
- turn ID
- tool ID/name
- node ID
- runtime adapter
- duration
- status
- error category

metrics:

```text
active_sessions
active_turns
turn_duration
turn_failures
approval_pending
approval_timeout
tool_failures
runtime_reconnects
app_server_overload
schema_mismatch
```

---

# 36. Error Taxonomy

normalize error เป็น:

```text
RUNTIME_NOT_FOUND
RUNTIME_VERSION_UNSUPPORTED
AUTH_REQUIRED
APP_SERVER_INIT_FAILED
PROTOCOL_MISMATCH
RUNTIME_OVERLOADED
THREAD_NOT_FOUND
TURN_FAILED
TURN_CANCELLED
APPROVAL_TIMEOUT
APPROVAL_DENIED
SANDBOX_DENIED
PATH_DENIED
NETWORK_DENIED
TOOL_FAILED
MCP_UNAVAILABLE
REMOTE_NODE_OFFLINE
INTERNAL_ERROR
```

UI ต้องไม่แสดง raw stack trace ให้ user ปกติ

---

# 37. Version Management

สร้าง version policy:

```text
detected
supported
tested
experimental
blocked
```

startup flow:

```text
Detect Version
     ↓
Known/Tested?
 ┌───┴────┐
Yes      No
 │        │
 ▼        ▼
Run      Compatibility Test
          │
      ┌───┴─────┐
     Pass      Fail
      │          │
      ▼          ▼
 Warn+Run    Fallback/Block
```

ห้าม auto-upgrade Codex แล้ว assume ว่าระบบใช้ได้ทันทีใน production mode

---

# 38. Compatibility Manifest

เพิ่มไฟล์:

```text
config/codex-compatibility.json
```

ตัวอย่าง:

```json
{
  "minimumVersion": null,
  "testedVersions": [],
  "blockedVersions": [],
  "features": {
    "pythonSdk": true,
    "appServer": true,
    "execServer": true,
    "daemon": "experimental",
    "websocketTransport": "experimental"
  }
}
```

Codex implementation ให้เติม version จริงหลัง detect/test

---

# 39. Authentication

Phase นี้ต้อง reuse Codex-supported auth mechanism

ห้าม:

- copy token ลง database แบบ plain text
- scrape auth files ไปแสดง UI
- invent custom token exchange ถ้าไม่จำเป็น

Dashboard แสดงเพียง:

```text
Authenticated
Auth mode
Plan/provider when available
Last checked
```

อย่า expose credentials

---

# 40. Multi-Agent Foundation

เตรียม interface:

```text
AgentRun
├─ role
├─ thread
├─ turn
├─ policy
├─ workspace
└─ result
```

เพื่อรองรับ Reviewer Council ภายหลัง

ตัวอย่าง:

```text
Primary Builder
Security Reviewer
Test Reviewer
Architecture Reviewer
```

Phase นี้ให้ทำ infrastructure เท่านั้น ไม่จำเป็นต้องสร้าง council ใหญ่ใหม่ถ้าของเดิมมีอยู่แล้ว

---

# 41. Reviewer Council Integration

ถ้า Pao-hubPro มี Reviewer Council อยู่แล้ว:

ให้ migrate execution backend:

```text
Old Reviewer Executor
        ↓
Codex Runtime Adapter
```

ห้าม rewrite business logic ถ้าไม่จำเป็น

Reviewer แต่ละ role ต้องสามารถมี:

- isolated thread
- own prompt/instructions
- restricted tools
- own policy
- timeout
- cancellation

---

# 42. Queue / Concurrency

ต้องรองรับ multiple active turns เท่าที่ runtime surface รองรับ

แต่กำหนด concurrency limit ของ Pao เอง:

```env
PAO_CODEX_MAX_CONCURRENT_TURNS=3
```

ค่า default ปรับตามเครื่องได้

ต้องมี:

- queue
- running
- cancelled
- failed
- completed

และ backpressure

---

# 43. Job Model

สร้าง unified job:

```text
Job
├─ id
├─ type
├─ session_id
├─ node_id
├─ state
├─ priority
├─ created_at
├─ started_at
├─ finished_at
└─ error
```

states:

```text
queued
starting
running
waiting_approval
completed
failed
cancelled
```

---

# 44. Crash Recovery

ทดสอบ:

```text
Pao backend restart
Codex app-server restart
PC reboot
VPS reboot
network drop
browser refresh
```

หลัง restart ต้อง:

- mark stale jobs
- reconnect where supported
- reconcile thread status
- avoid duplicate destructive work
- show recovery state clearly

---

# 45. Idempotency

critical mutation request ต้องมี idempotency key หรือ equivalent

โดยเฉพาะ:

- create remote job
- approval action
- cancel
- deployment trigger
- write operation wrapper

ป้องกัน double click / reconnect แล้วสั่งซ้ำ

---

# 46. Database Changes

อย่าเปลี่ยน database engine ถ้า project มีของเดิมอยู่แล้ว

เพิ่ม entities ตาม framework เดิม:

```text
runtime_nodes
runtime_sessions
runtime_jobs
runtime_events
runtime_approvals
runtime_audit_logs
runtime_capabilities
```

ถ้าไม่มี DB migration system ให้เพิ่ม migration mechanism ที่เหมาะกับ stack

---

# 47. API Surface

ตัวอย่าง logical endpoints:

```text
GET  /api/runtime/codex
GET  /api/runtime/codex/health
POST /api/runtime/codex/schema/sync

GET  /api/runtime/nodes
GET  /api/runtime/sessions
POST /api/runtime/sessions
GET  /api/runtime/sessions/:id
POST /api/runtime/sessions/:id/resume

POST /api/runtime/sessions/:id/turns
POST /api/runtime/turns/:id/cancel

GET  /api/runtime/approvals
POST /api/runtime/approvals/:id/approve
POST /api/runtime/approvals/:id/deny

GET  /api/runtime/tools
GET  /api/runtime/audit
```

ใช้ conventions ของ backend เดิมเป็นหลัก

---

# 48. Security Boundaries

```text
Internet
   │
   ▼
Web UI
   │
   ▼
Authenticated API
   │
   ▼
Authorization
   │
   ▼
Policy Engine
   │
   ▼
Approval Broker
   │
   ▼
Codex Adapter
   │
   ▼
Sandbox
   │
   ▼
Workspace / Tool
```

ห้าม bypass ชั้นใดชั้นหนึ่งเพื่อความสะดวก

---

# 49. Windows Support Checklist

- [ ] Codex detect works
- [ ] path canonicalization
- [ ] PowerShell-safe spawning
- [ ] quoting rules
- [ ] long path behavior
- [ ] CODEX_HOME handling
- [ ] process cancellation
- [ ] detached daemon behavior
- [ ] restart behavior
- [ ] workspace sandbox behavior
- [ ] symlink/junction escape tests
- [ ] antivirus/permission errors handled
- [ ] non-admin operation supported where possible

---

# 50. Linux VPS Support Checklist

- [ ] Codex detect works
- [ ] service user
- [ ] CODEX_HOME isolated
- [ ] workspace permissions
- [ ] process lifecycle
- [ ] systemd optional integration
- [ ] no root requirement by default
- [ ] sandbox health
- [ ] remote connection policy
- [ ] firewall-aware diagnostics
- [ ] logs rotate

---

# 51. Test Matrix

## Unit

- adapters
- policy rules
- approval decisions
- path guard
- event normalization
- secret redaction
- version parsing
- capability detection

## Integration

- SDK thread/turn
- App Server initialize
- thread start
- stream
- cancellation
- reconnect
- schema generation
- MCP inventory
- approval flow

## Security

- path traversal
- symlink escape
- command injection
- shell metacharacters
- secret leakage
- unauthorized approval
- full-access expiry
- network denial
- destructive command gate

## Failure

- Codex missing
- outdated/new unknown version
- auth expired
- app-server crash
- runtime overload
- MCP offline
- approval timeout
- node offline
- DB failure
- UI disconnect

---

# 52. Required Smoke Test

สร้าง one-command smoke test:

Windows:

```powershell
.\scripts\phase-20.21-smoke.ps1
```

Linux/macOS:

```bash
./scripts/phase-20.21-smoke.sh
```

หรือ equivalent ตาม stack

smoke test ต้องตรวจ:

1. Codex detected
2. version read
3. capability report
4. schema generation
5. runtime connect
6. test thread
7. test turn
8. event streaming
9. safe tool/read action
10. approval simulation
11. cancellation
12. audit entry
13. clean shutdown

---

# 53. UI UX Requirements

แนวทาง UI:

- clean
- compact
- Apple-like
- dark/light compatible
- status เข้าใจทันที
- danger states ชัด
- approvals อ่านง่าย
- mobile usable

### Status badges

```text
Healthy
Warning
Experimental
Disconnected
Approval Required
Blocked
Full Access
```

FULL ACCESS ต้องเด่นและไม่ควรกลืนกับ state ปกติ

---

# 54. Runtime Settings

เพิ่ม settings เช่น:

```env
PAO_CODEX_RUNTIME_MODE=auto
PAO_CODEX_EXPERIMENTAL_API=false
PAO_CODEX_WS_TRANSPORT=false
PAO_CODEX_DAEMON_ENABLED=false
PAO_CODEX_REMOTE_CONTROL=false
PAO_CODEX_MAX_CONCURRENT_TURNS=3
PAO_CODEX_APPROVAL_TIMEOUT_SECONDS=120
PAO_CODEX_DEFAULT_POLICY=NORMAL
```

ห้าม commit secrets

---

# 55. Feature Flags

สร้าง feature registry:

```text
codex.python_sdk
codex.app_server
codex.exec_server
codex.mcp
codex.daemon
codex.remote_control
codex.experimental_api
codex.websocket_transport
```

แต่ละ feature ต้องมี:

```text
supported
enabled
experimental
reason
```

---

# 56. Migration Strategy

### Step 1

เก็บ existing agent execution ไว้

### Step 2

เพิ่ม `CodexRuntimeAdapter`

### Step 3

เปิดเฉพาะ test workspace

### Step 4

compare old vs new behavior

### Step 5

ย้าย default coding tasks ไป native Codex runtime

### Step 6

เก็บ old executor เป็น temporary fallback

### Step 7

remove old path เฉพาะเมื่อ regression tests ผ่านครบ

---

# 57. Rollback Strategy

ทุก change ต้อง rollback ได้

ขั้นต่ำ:

```text
PAO_CODEX_NATIVE_RUNTIME=false
```

หรือ equivalent feature flag

เมื่อ off:

```text
Pao-hubPro
   ↓
Previous stable execution path
```

ห้าม migration แบบ irreversible โดยไม่มี backup

---

# 58. Documentation Required

สร้าง:

```text
docs/architecture/codex-native-runtime.md
docs/runbooks/codex-install.md
docs/runbooks/codex-auth.md
docs/runbooks/codex-upgrade.md
docs/runbooks/codex-recovery.md
docs/security/codex-runtime-security.md
```

---

# 59. Upgrade Runbook

เมื่อ Codex มี version ใหม่:

```text
Detect Update
    ↓
Do NOT auto-enable in production
    ↓
Generate Schema
    ↓
Run Compatibility Tests
    ↓
Run Security Tests
    ↓
Compare capabilities
    ↓
Review breaking/experimental changes
    ↓
Approve version
```

---

# 60. CI Gate

CI ต้อง fail ถ้า:

- lint fail
- type check fail
- unit fail
- critical integration fail
- secret scan fail
- path guard test fail
- policy test fail
- schema validation fail

experimental runtime tests สามารถแยกเป็น non-blocking ได้ในช่วงแรก แต่ต้องรายงานชัดเจน

---

# 61. Acceptance Criteria

Phase 20.21 ถือว่าเสร็จเมื่อ:

- [ ] Pao-hubPro detect Codex ได้
- [ ] แสดง Codex version ใน Dashboard
- [ ] มี capability report
- [ ] มี runtime adapter abstraction
- [ ] SDK/App Server อย่างน้อยหนึ่ง route ใช้งานจริง end-to-end
- [ ] stable schema sync ทำงาน
- [ ] create thread ได้
- [ ] start turn ได้
- [ ] stream output ได้
- [ ] cancel turn ได้
- [ ] resume/reconcile session ได้ตาม capability
- [ ] approval request แสดงใน UI
- [ ] approval timeout ไม่ทำให้ระบบ hang
- [ ] SAFE/NORMAL policy ทำงาน
- [ ] workspace boundary ถูก enforce
- [ ] secret redaction ทำงาน
- [ ] audit log ทำงาน
- [ ] Windows smoke test ผ่าน
- [ ] Linux VPS smoke test ผ่าน หรือมี documented blocker ที่ชัดเจน
- [ ] experimental daemon ปิดเป็น default
- [ ] full access ปิดเป็น default
- [ ] rollback switch ทำงาน
- [ ] docs ครบ
- [ ] tests ผ่าน

---

# 62. Definition of Done

ผลลัพธ์ที่ต้องเห็นจริง:

```text
เปิด Pao-hubPro Dashboard
        ↓
Runtime = Codex Native
        ↓
เลือก Workspace
        ↓
Start Session
        ↓
พิมพ์ Coding Task
        ↓
Codex Thread/Turn ทำงาน
        ↓
เห็น Progress + Tool Calls แบบสด
        ↓
ถ้าต้อง Escalate → Approval Center
        ↓
Approve/Deny
        ↓
งานจบ
        ↓
เห็น Result + Audit + File Changes
```

โดยไม่ต้อง:

```text
เปิด terminal เอง
copy prompt
parse console output
ให้ full-access ตลอดเวลา
```

---

# 63. Implementation Order

ทำตามลำดับนี้ ห้ามเริ่มจาก UI อย่างเดียว

```text
01 Inspect existing Pao-hubPro
02 Add feature flags
03 Codex detection
04 Capability report
05 Runtime adapter interface
06 Python SDK adapter
07 App Server adapter
08 Schema sync
09 Event normalization
10 Session manager
11 Approval broker
12 Policy engine
13 Audit
14 API
15 Dashboard
16 MCP inventory
17 Daemon optional integration
18 Windows tests
19 Linux VPS tests
20 Security tests
21 Smoke test
22 Docs
23 Final regression
```

---

# 64. Codex One-Shot Implementation Prompt

ให้เปิด Codex ที่ root ของ repository `Pao-hubPro` แล้วใช้ prompt ด้านล่างได้ทันที

```text
You are implementing Phase 20.21 of Pao-hubPro.

PHASE NAME:
Phase 20.21 — Pao-hubPro × OpenAI Codex Native Runtime Integration

PRIMARY GOAL:
Refactor/extend Pao-hubPro so OpenAI Codex becomes the native coding-agent runtime while Pao-hubPro remains the Control Plane / Orchestrator.

SOURCE OF TRUTH:
- Read this Phase 20.21 markdown completely.
- Inspect the existing repository before making architectural decisions.
- Preserve working functionality.
- Reuse existing modules, frameworks, auth, database, API conventions, UI system, logging, tests, and MCP components where practical.
- Do not blindly create a new parallel architecture if equivalent modules already exist.

UPSTREAM REFERENCE:
https://github.com/openai/codex

CRITICAL ARCHITECTURE:
Pao-hubPro UI
  -> Pao Control Plane
  -> Runtime Adapter
  -> OpenAI Codex SDK / App Server
  -> Codex Runtime
  -> Sandbox / Approval / Tools
  -> Local PC / VPS workspace

DO NOT:
- fork or modify OpenAI Codex core unless absolutely necessary
- make danger-full-access the default
- use --dangerously-bypass-approvals-and-sandbox in normal flows
- expose arbitrary shell execution directly to the browser
- expose secrets in logs/API/UI
- bind frontend components directly to raw Codex JSON-RPC schemas
- assume experimental APIs are stable
- remove the previous stable execution path until migration tests pass
- rewrite unrelated working modules

IMPLEMENT IN THIS ORDER:

1. REPOSITORY DISCOVERY
   - inspect project architecture
   - identify backend/frontend/runtime layers
   - identify current agent execution
   - identify MCP implementation
   - identify auth/database/audit/logging
   - identify current OS assumptions
   - write a concise implementation map before changing code

2. FEATURE FLAGS
   Add equivalent configuration for:
   - PAO_CODEX_NATIVE_RUNTIME
   - PAO_CODEX_RUNTIME_MODE=auto
   - PAO_CODEX_EXPERIMENTAL_API=false
   - PAO_CODEX_WS_TRANSPORT=false
   - PAO_CODEX_DAEMON_ENABLED=false
   - PAO_CODEX_REMOTE_CONTROL=false
   - PAO_CODEX_MAX_CONCURRENT_TURNS=3
   - PAO_CODEX_APPROVAL_TIMEOUT_SECONDS=120
   - PAO_CODEX_DEFAULT_POLICY=NORMAL

3. CODEX DETECTION
   Implement Codex installation/version/platform detection.
   Produce a machine-readable capability report.
   Do not assume capabilities solely from version numbers when a runtime probe is possible.

4. RUNTIME ABSTRACTION
   Implement a CodexRuntimeAdapter-equivalent interface supporting:
   - detect
   - health
   - capabilities
   - start_thread
   - resume_thread
   - start_turn
   - stream_turn
   - cancel_turn
   - get_thread
   - list_threads
   - shutdown

5. PYTHON SDK ADAPTER
   If compatible with the existing backend stack, integrate the official openai_codex SDK.
   Support sync/async appropriately.
   Support concurrent active turns through the application queue with an explicit concurrency limit.

6. APP SERVER ADAPTER
   Integrate codex app-server as a machine-readable JSON-RPC runtime surface.
   Use stdio first.
   Initialize correctly before other methods.
   Handle bounded queues/backpressure.
   Treat overload as retryable using exponential backoff with jitter.
   Keep WebSocket transport behind an experimental feature flag.

7. CODEX SCHEMA SYNC
   Implement a command/script that runs:
   codex app-server generate-ts --out <versioned-dir>
   codex app-server generate-json-schema --out <versioned-dir>

   Store version-specific generated artifacts.
   Keep stable schemas separate from optional experimental schemas.
   Detect schema drift.

8. EVENT NORMALIZATION
   Create a Pao-owned runtime event model.
   Map raw Codex events into stable Pao events.
   Frontend must consume Pao events, not raw Codex protocol types.

9. SESSION MANAGER
   Map Pao session IDs to Codex thread IDs.
   Support lifecycle, reconnect, resume, cancellation, stale session handling, and crash reconciliation.

10. POLICY ENGINE
   Implement SAFE, NORMAL, AUTOMATION, and FULL ACCESS profiles.
   SAFE/NORMAL must be the usable defaults.
   FULL ACCESS must require explicit temporary unlock and create a high-severity audit event.

11. APPROVAL BROKER
   All risky operations must pass through a Pao-owned approval layer.
   Approval requests must have a bounded timeout.
   A headless approval must never hang indefinitely.
   On timeout, safely deny/cancel and emit a structured runtime event.

12. WORKSPACE GUARD
   Canonicalize paths.
   Prevent traversal, symlink/junction escape, sensitive directory access, and writes outside approved workspace roots.

13. COMMAND + NETWORK POLICY
   Classify low/medium/high-risk commands.
   Destructive commands always require approval.
   Keep network restricted by default.
   Use scoped/temporary grants instead of global unrestricted network access.

14. SECRET REDACTION
   Prevent API keys, tokens, credentials, DB passwords, SSH keys, webhook secrets, and MCP secrets from entering logs/UI/audit payloads.

15. MCP INVENTORY
   Surface configured MCP servers/tools in a normalized inventory.
   Include health, source, risk classification, and approval behavior.
   Never trust tool annotations as the sole security authority.

16. HEADLESS MCP REGRESSION
   Add a test where an MCP call requires approval but no UI is attached.
   It must timeout safely and become visible as waiting/denied/cancelled, never hang silently forever.

17. OPTIONAL APP-SERVER DAEMON
   Detect and support codex app-server daemon only behind feature flags.
   Remember that this upstream capability is experimental.
   Support Linux/macOS/Windows capability detection.
   If daemon startup/connect fails, fall back safely to local/embedded app-server behavior.

18. REMOTE NODE FOUNDATION
   Add a minimal Node model for Windows PC and Linux VPS:
   id, name, platform, hostname, codexVersion, runtimeMode, state, lastSeen, capabilities, policy.

19. API
   Add/adapt runtime endpoints following existing backend conventions for:
   - runtime health
   - capabilities
   - nodes
   - sessions
   - turns
   - cancellation
   - approvals
   - tools
   - audit

20. DASHBOARD
   Build/adapt UI pages:
   - Runtime Overview
   - Sessions
   - Live Turn
   - Approval Center
   - Policy Center
   - Tool/MCP Inventory
   - Audit Log

   UI should be clean, compact, Apple-like, responsive, and dark/light compatible.
   Risk and experimental states must be visually obvious.

21. AUDIT + OBSERVABILITY
   Add structured logs, correlation IDs, session/thread/turn IDs, tool names, runtime adapter, duration, errors, approval events, policy changes, sandbox escalations, and remote-control changes.
   Redact secrets before persistence.

22. VERSION COMPATIBILITY
   Add a compatibility manifest.
   Unknown Codex versions should trigger compatibility testing/warnings instead of silent trust.
   Keep upgrade/rollback behavior explicit.

23. WINDOWS TESTS
   Test path canonicalization, PowerShell spawning, quoting, CODEX_HOME, cancellation, daemon behavior, workspace security, junction/symlink escapes, and non-admin operation.

24. LINUX VPS TESTS
   Test permissions, service user behavior, CODEX_HOME, process lifecycle, sandbox health, remote connectivity, and non-root operation.

25. TESTS
   Add:
   - unit tests
   - integration tests
   - security tests
   - failure-mode tests
   - smoke tests

26. SMOKE TEST COMMAND
   Provide a one-command Phase 20.21 smoke test for Windows and Linux/macOS.
   It must validate detection, version, capability report, schema sync, runtime connection, thread, turn, streaming, safe tool action, approval, cancel, audit, and shutdown.

27. DOCUMENTATION
   Create/update:
   - architecture document
   - install runbook
   - auth runbook
   - upgrade runbook
   - recovery runbook
   - runtime security document

28. MIGRATION + ROLLBACK
   Keep previous stable execution available behind a feature flag until regression tests pass.
   Provide a simple rollback switch for native Codex runtime.

QUALITY BAR:
- production-oriented
- no placeholder security
- no fake/mock success in production code paths
- typed interfaces where the project supports them
- structured error handling
- no silent failures
- no unbounded approval waits
- no destructive defaults
- preserve existing working behavior
- minimal unnecessary dependencies
- follow the project's existing lint/format/test conventions

BEFORE FINISHING:
- run formatter
- run lint
- run type checks
- run relevant unit/integration/security tests
- run Phase 20.21 smoke test where environment permits
- inspect git diff
- fix regressions
- summarize files changed
- summarize architecture decisions
- summarize tests run and results
- list any environment-dependent tests not run
- list remaining known risks
- do not claim completion for checks that were not actually executed

Implement as much of Phase 20.21 as the repository and environment allow in this single run. Do not stop after only writing a plan.
```

---

# 65. Post-Implementation Verification Prompt

หลัง Codex ทำ implementation รอบแรก ให้ใช้ prompt นี้ตรวจซ้ำ:

```text
Audit the Phase 20.21 implementation as a strict senior platform/security reviewer.

Verify:
1. Pao-hubPro is the control plane and Codex is behind a runtime adapter.
2. The frontend is not coupled directly to raw Codex protocol types.
3. Codex version/capability detection is real.
4. App Server initialization is correct.
5. Stable schema generation is version-aware.
6. Experimental APIs are off by default.
7. daemon/remote control are feature-flagged.
8. danger-full-access is not a default path.
9. --dangerously-bypass-approvals-and-sandbox is not used in normal runtime code.
10. workspace path traversal/symlink/junction attacks are handled.
11. risky commands cannot bypass approval.
12. approval waits are bounded and cancellable.
13. headless MCP approval cannot hang silently.
14. secrets are redacted before logging/persistence.
15. concurrency has explicit limits/backpressure.
16. crash/reconnect paths avoid duplicate destructive actions.
17. audit logs cover security-relevant operations.
18. Windows and Linux behavior are handled explicitly.
19. rollback to the previous execution path is possible.
20. tests actually validate the above rather than only mocking success.

Then:
- run the relevant tests
- inspect git diff
- identify Critical/High/Medium/Low findings
- fix Critical and High findings that can be fixed safely
- rerun tests
- provide final residual risks
```

---

# 66. Recommended Next Architecture After 20.21

เมื่อ Phase นี้ผ่าน acceptance criteria แล้ว โครงสร้างจะพร้อมต่อยอด:

```text
                 Pao-hubPro
                     │
              Codex Control Plane
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
     Pao-PC       Pao-VPS       Future Node
        │            │
        ▼            ▼
   Codex Runtime  Codex Runtime
        │            │
   ┌────┼────┐       │
   ▼    ▼    ▼       ▼
Browser MCP  ComfyUI MCP
Adobe Stock  Automation
Reviewer Council
```

Phase ถัดไปที่เหมาะสมหลัง runtime เสถียรคือการทำ **Remote Agent Fleet + Tool Bridges** โดยใช้ฐาน security/policy/approval ของ Phase 20.21 แทนการเปิด remote shell แบบตรง ๆ

---

# 67. Source References

Official / upstream references used to design this phase:

- OpenAI Codex repository  
  https://github.com/openai/codex

- Codex App Server README  
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

- Codex App Server Daemon README  
  https://github.com/openai/codex/blob/main/codex-rs/app-server-daemon/README.md

- Codex Exec Server README  
  https://github.com/openai/codex/blob/main/codex-rs/exec-server/README.md

- Codex Python SDK API Reference  
  https://github.com/openai/codex/blob/main/sdk/python/docs/api-reference.md

- Codex AGENTS.md  
  https://github.com/openai/codex/blob/main/AGENTS.md

---

# 68. Final Rule

Phase 20.21 ต้องไม่จบที่:

```text
"เชื่อม Codex ได้"
```

แต่ต้องจบที่:

```text
"Pao-hubPro ควบคุม Codex ได้อย่างเป็นระบบ
ปลอดภัย
ตรวจสอบได้
อัปเกรดได้
ย้อนกลับได้
และพร้อมเป็นฐานสำหรับ automation ระยะยาว"
```

**End of Phase 20.21 specification**
