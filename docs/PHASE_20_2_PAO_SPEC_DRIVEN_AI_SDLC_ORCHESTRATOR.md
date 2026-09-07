# Phase 20.2 — Pao AI Generation Studio × Spec-Driven AI SDLC Orchestrator

> **Project:** Pao-hubPro  
> **Phase:** 20.2  
> **Depends on:**  
> - Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator  
> - Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router  
> - Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler  
>
> **Status:** Implementation Specification / Codex One-Shot Build Prompt  
> **Primary Goal:** เปลี่ยน Pao-hubPro จากระบบที่ “AI ช่วยเขียนโค้ดเป็นครั้ง ๆ” ให้เป็น **Spec-Driven AI Software Engineering Operating Layer** ที่รับ Idea → สร้าง Spec → Clarify → Plan → Tasks → Analyze → Checklist → Implement → Test → Review → Converge → Deploy/Operate ได้เป็นวงจรเดียว พร้อม Quality Gates, Audit Trail, Safe Execution, Reviewer Council, Resume/Recovery และ Human Approval สำหรับจุดเสี่ยง  
> **Important:** Phase นี้ต้อง **ต่อยอด repository Pao-hubPro เดิมเท่านั้น** ห้ามสร้าง repository ใหม่ ห้ามทำลาย Phase 19/20/20.1 และต้อง reuse auth, database, logging, job infrastructure, MCP, dashboard, provider abstractions และ security controls เดิมเมื่อเหมาะสม

---

# 0. Mission สำหรับ Codex

คุณคือ **Principal Software Architect + Senior Staff Engineer + AI Agent Systems Engineer + DevSecOps Engineer + SRE + QA Architect + Product Engineer** ที่กำลังทำงานอยู่ใน repository **Pao-hubPro** ที่มีอยู่แล้ว

ให้ implement:

```text
Phase 20.2
Pao Spec-Driven AI SDLC Orchestrator
×
AI Quality Gate & Reviewer Council
```

ให้ใช้งานจริงแบบ end-to-end ไม่ใช่ demo-only

เป้าหมายคือเปลี่ยน flow จาก:

```text
User idea
  ↓
Prompt Codex
  ↓
AI writes code
  ↓
Manual checking
  ↓
Fix again
```

เป็น:

```text
Idea
  ↓
/specify
  ↓
/clarify
  ↓
/plan
  ↓
/tasks
  ↓
/analyze
  ↓
/checklist
  ↓
/implement
  ↓
Automated Tests
  ↓
Security / Architecture / Regression Review
  ↓
Reviewer Council
  ↓
/converge
  ↓
Staging / Deployment Gate
  ↓
Operate & Improve
  ↓
Feedback → New SDLC Cycle
```

ระบบต้องสามารถตอบคำถามสำคัญได้ตลอดเวลา:

```text
ตอนนี้ Feature อยู่ขั้นตอนไหน?
Requirement ไหนถูก implement แล้ว?
Acceptance Criteria ไหนผ่าน/ไม่ผ่าน?
Task ไหน blocked?
ไฟล์ใดถูกแก้?
Test อะไรผ่าน/ไม่ผ่าน?
มี security risk หรือไม่?
Reviewer คน/agent ไหนให้ PASS/FAIL?
ทำไม Gate นี้ถึงผ่าน?
ถ้าระบบ restart จะ resume จากไหน?
ถ้าต้อง rollback ต้องย้อนอะไร?
```

---

# 1. Non-Negotiable Rules

1. **ห้ามสร้าง repository ใหม่**
2. ต้อง inspect repository ปัจจุบันก่อนแก้ไฟล์
3. ต้องอ่าน architecture, package manager, test runner, lint, type check, DB/migration, auth และ runtime เดิมก่อนเลือก implementation
4. ถ้ามี subsystem เดิมให้ extend แทน duplicate
5. ห้าม assume framework จากเอกสารนี้ถ้า codebase จริงใช้ framework อื่น
6. ต้องรักษา backward compatibility เท่าที่ทำได้
7. ห้ามลบ feature เดิมเพียงเพื่อทำ Phase 20.2 ให้ง่ายขึ้น
8. ห้าม hardcode path ของเครื่องผู้ใช้
9. ห้าม hardcode secret, API key, token, password
10. ห้าม expose dangerous execution endpoint สู่ public โดยไม่มี auth/RBAC
11. ทุก action ที่แก้ไฟล์, run command, commit, deploy, rollback ต้องมี audit log
12. ทุก cycle ต้องมี persistent state
13. ทุก run ต้อง recover/resume หลัง process restart ได้
14. ทุก mutating operation ต้อง idempotent หรือมี idempotency guard
15. ต้องป้องกัน agent/worker ทำ task เดียวซ้ำจาก race condition
16. ต้องมี locking/lease สำหรับ implementation run
17. ต้องมี timeout สำหรับ subprocess/agent run
18. ต้องมี cancellation
19. ต้องมี emergency stop
20. ต้องมี dry-run สำหรับ action เสี่ยง
21. ต้องมี Human Approval Gate สำหรับ action ที่กำหนดเป็น high-risk
22. AI review **ห้ามแทน deterministic checks** เช่น test/lint/typecheck/security scan
23. AI provider ต้องเป็น adapter/configurable
24. ระบบต้องทำงานได้แม้ external AI reviewer บางตัว unavailable
25. Reviewer Council ต้อง degrade gracefully
26. ห้ามให้ reviewer ที่แก้โค้ดเป็น reviewer เพียงคนเดียวของงาน critical
27. ต้องมี minimum independent review policy สำหรับงาน risk สูง
28. ต้องไม่ deploy ถ้า required gate fail
29. ต้องไม่ mark phase complete จากข้อความ AI อย่างเดียว
30. Acceptance Criteria ต้อง map ไป evidence จริง
31. Test result ต้องเก็บ command, exit code, timestamp และ output summary
32. ห้าม fake test pass
33. ถ้ารัน test ไม่ได้ ต้อง mark `NOT_RUN/BLOCKED` ไม่ใช่ PASS
34. ห้าม auto-fix destructive DB migration โดยไม่มี guard
35. Migration ต้องมี rollback/forward recovery strategy ตาม capability ของ stack
36. Git dirty working tree ต้องถูกตรวจสอบก่อนแก้
37. ห้าม overwrite user uncommitted changes
38. ต้องรองรับ Windows เป็นหลัก และ Linux เป็นรอง
39. ห้ามผูกระบบกับ GitHub อย่างเดียว ถ้า local Git ทำงานได้
40. GitHub integration ให้เป็น optional adapter
41. ต้องรองรับ local-only development mode
42. ต้องรองรับ AI-off / deterministic-only review mode
43. ต้องมี mock provider และ fake execution backend สำหรับ tests
44. ต้องมี docs, migration, `.env.example`, tests และ build verification
45. ต้องมี final verification report ก่อนจบ Phase 20.2

---

# 2. Core Concept — Spec Is the Contract

Phase 20.2 ใช้หลัก:

```text
Idea is not code.
Prompt is not specification.
Specification is not implementation.
Implementation is not proof.
Tests + evidence + review = confidence.
```

Canonical chain:

```text
Idea
 ↓
Requirement
 ↓
Acceptance Criteria
 ↓
Architecture Plan
 ↓
Tasks
 ↓
Implementation
 ↓
Verification Evidence
 ↓
Gate Decision
```

ถ้ามีขั้นใดขาด ต้อง detect เป็น gap

ตัวอย่าง:

```text
Requirement:
รองรับ Resume Queue หลัง restart

Acceptance Criteria:
เมื่อ process restart ระหว่างมี pending jobs
ระบบต้อง recover jobs และไม่ submit งานซ้ำ

Task:
Implement persistent queue recovery

Test:
restart_recovery_does_not_duplicate_jobs

Evidence:
PASS + test run id + commit hash
```

---

# 3. Phase 20.2 Responsibility Boundary

## Phase 19

```text
generation jobs
ComfyUI workflows
assets
review for generated media
Adobe Stock QC
metadata
export
```

## Phase 20

```text
GPU provider routing
RunPod lifecycle
capacity
cost guard
provider health
```

## Phase 20.1

```text
smart queue
backlog intelligence
runtime prediction
cloud burst
scale-up/down
queue reconciliation
```

## Phase 20.2

```text
software requirement lifecycle
specification
clarification
planning
task graph
consistency analysis
quality checklist
safe implementation execution
automated verification
software reviewer council
quality gates
human approvals
convergence
SDLC audit trail
cycle resume/recovery
continuous improvement loop
```

Phase 20.2 ต้องไม่ reimplement Generation Queue หรือ RunPod scheduler

---

# 4. Target Architecture

```text
┌───────────────────────────────────────────────────────────────────────┐
│                              Pao-hubPro                               │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ User / Dashboard / MCP / REST                                         │
│                 │                                                     │
│                 ▼                                                     │
│        Pao SDLC Command Gateway                                       │
│                 │                                                     │
│                 ▼                                                     │
│        SDLC Cycle Orchestrator                                        │
│                 │                                                     │
│     ┌───────────┼──────────────────────────────────────────┐          │
│     ▼           ▼          ▼          ▼          ▼          ▼          │
│ Constitution  Specify   Clarify     Plan       Tasks     Analyze       │
│     │                                                        │         │
│     └─────────────────────────┬──────────────────────────────┘         │
│                               ▼                                        │
│                        Checklist Gate                                  │
│                               │                                        │
│                               ▼                                        │
│                    Safe Implementation Runner                          │
│                               │                                        │
│              ┌────────────────┼────────────────┐                       │
│              ▼                ▼                ▼                       │
│          Git Adapter     Command Runner    Agent Adapter                │
│              │                │                │                       │
│              └────────────────┼────────────────┘                       │
│                               ▼                                        │
│                     Deterministic Verification                         │
│                               │                                        │
│     ┌─────────────────────────┼──────────────────────────────┐         │
│     ▼                         ▼                              ▼         │
│   Tests                  Security                      Build/Lint       │
│     │                         │                              │         │
│     └─────────────────────────┼──────────────────────────────┘         │
│                               ▼                                        │
│                    Software Reviewer Council                          │
│                               │                                        │
│                               ▼                                        │
│                       Quality Gate Engine                              │
│                               │                                        │
│                    ┌──────────┴──────────┐                             │
│                    ▼                     ▼                             │
│                  FAIL                  PASS                            │
│                    │                     │                             │
│                    ▼                     ▼                             │
│               Fix / Rework          /converge                         │
│                    │                     │                             │
│                    └──────────────► Staging Gate                       │
│                                          │                             │
│                                          ▼                             │
│                                     Deploy Adapter                     │
│                                          │                             │
│                                          ▼                             │
│                                   Operate / Feedback                   │
│                                          │                             │
│                                          └──────► New Cycle            │
└───────────────────────────────────────────────────────────────────────┘
```

---

# 5. Logical Module Layout

ปรับให้เข้ากับ codebase จริง ห้าม force directory นี้ถ้า architecture เดิมไม่เหมาะ

```text
sdlc/
  domain/
    cycle/
    state/
    requirement/
    acceptance/
    artifact/
    task/
    gate/
    review/
    approval/
    evidence/

  constitution/
  specify/
  clarify/
  plan/
  tasks/
  analyze/
  checklist/
  implement/
  verify/
  review/
  converge/

  orchestrator/
  runner/
  git/
  agents/
  providers/
  policy/
  security/
  telemetry/
  persistence/
  api/
  mcp/
```

ถ้า Pao-hubPro ใช้ feature-based/module-based structure ให้ map modules ตาม style เดิม

---

# 6. SDLC Cycle

สร้าง canonical entity:

```text
SdlcCycle
```

fields ขั้นต่ำ:

```text
id
project_id
feature_key
slug
title
summary
source_idea
status
risk_level
priority
created_by
created_at
updated_at
started_at
completed_at
current_stage
current_gate
branch_name
base_branch
worktree_path
repo_head_at_start
latest_commit_sha
constitution_version
policy_version
metadata
```

ห้ามเก็บ object สำคัญทั้งหมดเป็น JSON blob เดียวถ้า query/report ต้องใช้ relational fields

---

# 7. Cycle State Machine

ใช้ explicit state machine

```text
DRAFT
  ↓
SPECIFYING
  ↓
SPECIFIED
  ↓
CLARIFYING
  ↓
CLARIFIED
  ↓
PLANNING
  ↓
PLANNED
  ↓
TASKING
  ↓
TASKED
  ↓
ANALYZING
  ↓
ANALYZED
  ↓
READY_FOR_IMPLEMENTATION
  ↓
IMPLEMENTING
  ↓
VERIFYING
  ↓
REVIEWING
  ↓
CONVERGING
  ↓
READY_FOR_STAGING
  ↓
STAGING
  ↓
READY_FOR_DEPLOYMENT
  ↓
DEPLOYED
  ↓
OPERATING
  ↓
CLOSED
```

Failure/control states:

```text
BLOCKED
PAUSED
CANCELLED
FAILED
REWORK_REQUIRED
APPROVAL_REQUIRED
ROLLBACK_REQUIRED
ROLLED_BACK
```

Transitions ต้อง validate

ห้าม set status แบบ arbitrary string update จาก frontend

---

# 8. Risk Levels

```text
LOW
MEDIUM
HIGH
CRITICAL
```

ตัวอย่าง:

## LOW

```text
copy text
UI spacing
non-sensitive docs
```

## MEDIUM

```text
new API endpoint
DB query change
new background job
```

## HIGH

```text
auth
permissions
filesystem write
shell execution
payments/cost
deployment
provider credentials
migration
```

## CRITICAL

```text
destructive migration
production deletion
secret rotation
remote command execution exposure
security boundary change
```

Risk level มีผลต่อ:

```text
required tests
review quorum
human approval
allowed auto-actions
rollback requirement
```

---

# 9. SDLC Commands

Phase 20.2 ต้องรองรับ logical commands ต่อไปนี้:

```text
/constitution
/specify
/clarify
/plan
/tasks
/analyze
/checklist
/implement
/test
/review
/converge
/deploy
/operate
/status
/resume
/pause
/abort
/rollback
```

UI/MCP/API สามารถเรียก service เดียวกัน

ห้ามทำ business logic แยก 3 ชุดระหว่าง UI/API/MCP

---

# 10. `/constitution`

Purpose:

```text
กำหนดกฎสูงสุดของ project
```

Constitution ต้อง versioned และ immutable ต่อ cycle หลังเริ่ม implementation ยกเว้น explicit migration/re-approval

ตัวอย่าง baseline:

```md
# Pao-hubPro Constitution

1. Never expose secrets.
2. Never overwrite uncommitted user work.
3. Every production-impacting change requires verification evidence.
4. Every new API validates input and authorization.
5. Every background task must define retry/idempotency behavior.
6. Every migration must define recovery strategy.
7. High-risk operations require approval.
8. Required tests cannot be replaced by AI opinion.
9. Production deployment requires health verification.
10. Failed mandatory gate blocks convergence.
```

เก็บ:

```text
constitution_id
version
content_hash
content
created_at
created_by
active
```

Cycle ต้อง pin `constitution_version`

---

# 11. Constitution Policy Packs

รองรับ policy pack เช่น:

```text
base
security
backend
frontend
database
mcp
ai-agent
generation
adobe-stock
runpod
```

Policy pack ต้อง merge แบบ deterministic

Conflict ต้อง surface ห้าม silently choose

---

# 12. `/specify`

Input:

```text
idea
problem statement
existing context
optional constraints
```

Output ต้องได้ structured specification

อย่างน้อย:

```text
Problem
Goal
Non-Goals
Actors
User Stories
Functional Requirements
Non-Functional Requirements
Constraints
Dependencies
Risks
Acceptance Criteria
Out of Scope
Open Questions
```

---

# 13. Requirement Entity

```text
requirement_id
cycle_id
key
type
priority
title
description
source
status
risk_level
created_at
updated_at
```

Types:

```text
FUNCTIONAL
NON_FUNCTIONAL
SECURITY
PERFORMANCE
RELIABILITY
OPERABILITY
COMPATIBILITY
DATA
UX
```

Requirement key ตัวอย่าง:

```text
FR-001
NFR-001
SEC-001
REL-001
```

---

# 14. Acceptance Criteria Entity

```text
acceptance_id
requirement_id
key
description
verification_type
status
verified_by
verified_at
evidence_id
```

Verification types:

```text
UNIT_TEST
INTEGRATION_TEST
E2E_TEST
SECURITY_CHECK
STATIC_ANALYSIS
MANUAL_REVIEW
OBSERVABILITY_CHECK
MIGRATION_TEST
BUILD_CHECK
```

Acceptance Criteria ต้อง testable

ห้ามยอมรับคำว่า:

```text
works well
fast enough
secure
user-friendly
```

โดยไม่มี observable criterion

---

# 15. Spec Quality Gate

ก่อน SPECIFIED:

```text
[ ] Goal exists
[ ] Non-goals exist
[ ] Scope is bounded
[ ] Functional requirements exist
[ ] Acceptance criteria exist
[ ] Important NFRs considered
[ ] Security impact considered
[ ] Data impact considered
[ ] Dependencies identified
[ ] Open questions classified
```

ถ้าขาด critical item → gate fail

---

# 16. `/clarify`

Purpose:

```text
ค้นหาความกำกวมก่อนออกแบบ
```

Clarification engine ต้องหา:

```text
ambiguous requirement
missing actor
undefined permission
undefined failure behavior
undefined retry
undefined data ownership
undefined performance target
undefined compatibility
undefined deployment effect
conflicting requirements
```

---

# 17. Clarification Severity

```text
INFO
MINOR
MAJOR
BLOCKING
```

BLOCKING example:

```text
Feature requires deleting data
แต่ไม่มี retention/approval rule
```

ห้ามเข้า `/plan` หากมี unresolved BLOCKING clarification

---

# 18. Auto-Resolve vs Ask User

Codex ต้องใช้กฎ:

```text
ถ้าตอบได้จาก codebase → inspect codebase
ถ้าตอบได้จาก constitution → use constitution
ถ้าตอบได้จาก existing project docs → use docs
ถ้าเป็น implementation detail ที่ไม่เปลี่ยน product intent → choose safest compatible option + document assumption
ถ้าเปลี่ยน scope/behavior/security/cost materially → require explicit clarification/approval
```

อย่าถาม user ในสิ่งที่ codebase ตอบได้

แต่ห้ามเดา business intent ที่มีผลสำคัญ

---

# 19. Clarification Record

```text
id
cycle_id
question
reason
severity
source_artifact
status
resolution
resolved_by
resolved_at
assumption
```

Statuses:

```text
OPEN
RESOLVED
ASSUMED
DEFERRED
BLOCKING
```

---

# 20. `/plan`

Plan ต้องแปลง Spec เป็น architecture/implementation strategy

Sections:

```text
Current State
Target State
Architecture
Data Model
API Changes
UI Changes
Background Jobs
Security Model
Failure Handling
Observability
Migration
Testing Strategy
Deployment Strategy
Rollback Strategy
Compatibility
Implementation Sequence
```

---

# 21. Repository Reconnaissance ก่อน Plan

ก่อน generate plan ต้อง inspect อย่างน้อย:

```text
project tree
package manifests
README/docs
AGENTS.md / CLAUDE.md / equivalent
existing architecture
config system
auth/RBAC
database layer
migration mechanism
API routing
background job system
logging
telemetry
tests
CI config
Docker/runtime config
MCP server/tools
existing Phase 19/20/20.1 modules
```

ผล reconnaissance ต้องบันทึกใน artifact

---

# 22. Architecture Decision Records

สำหรับ decision สำคัญ ให้สร้าง ADR logical record:

```text
ADR-001
Title
Context
Decision
Alternatives
Consequences
Risk
Status
```

อย่าสร้าง ADR ทุกเรื่องเล็ก ๆ

ใช้เฉพาะ decision ที่มีผลระยะยาวหรือ cross-module

---

# 23. `/tasks`

แปลง plan เป็น executable task graph

แต่ละ task:

```text
task_id
cycle_id
key
title
description
status
priority
risk_level
depends_on
requirements
acceptance_criteria
expected_files
verification_plan
assigned_agent
lease_owner
lease_expires_at
started_at
completed_at
```

---

# 24. Task States

```text
TODO
READY
IN_PROGRESS
BLOCKED
VERIFYING
REVIEWING
REWORK
DONE
SKIPPED
CANCELLED
```

---

# 25. Task Dependency DAG

Task dependencies ต้องเป็น DAG

ก่อน implementation:

```text
validate no cycle
validate missing dependency
validate orphan critical requirement
validate task ordering
```

ถ้ามี cycle:

```text
TASK-004 → TASK-007 → TASK-004
```

ต้อง fail `/tasks`

---

# 26. Vertical Slice Preference

ถ้าเหมาะสม ให้แบ่ง task เป็น vertical slices ที่ verify ได้

แทน:

```text
ทำ backend ทั้งหมด
ทำ frontend ทั้งหมด
ทำ tests ทีหลัง
```

ให้ prefer:

```text
1. Data model + service + API + test
2. UI integration + test
3. observability + recovery
4. hardening
```

ยกเว้น architecture เดิมบังคับ sequence อื่น

---

# 27. `/analyze`

Purpose:

```text
ตรวจ consistency ระหว่าง Spec → Plan → Tasks → Tests
```

Analyze อย่างน้อย:

```text
Requirement coverage
Acceptance coverage
Task coverage
Dependency consistency
Architecture consistency
Security coverage
Data migration coverage
Error-path coverage
Rollback coverage
Observability coverage
```

---

# 28. Gap Types

```text
REQ_WITHOUT_TASK
TASK_WITHOUT_REQUIREMENT
AC_WITHOUT_VERIFICATION
PLAN_WITHOUT_TASK
SECURITY_UNCOVERED
MIGRATION_UNCOVERED
ROLLBACK_MISSING
OBSERVABILITY_MISSING
CONFLICT
DUPLICATE
OUT_OF_SCOPE
```

---

# 29. Coverage Matrix

ระบบต้องสร้าง matrix:

```text
Requirement → Acceptance → Task → Test/Check → Evidence → Gate
```

ตัวอย่าง:

```text
FR-004
  └─ AC-004-1
      └─ TASK-011
          └─ integration/test_resume.py::test_resume
              └─ EVID-102
                  └─ PASS
```

Dashboard ต้องเปิดดู chain ได้

---

# 30. Analyze Gate

ห้ามเข้า implementation ถ้ามี:

```text
BLOCKING clarification
critical requirement without task
acceptance criterion without verification plan
high-risk change without rollback strategy
security-sensitive feature without security verification
```

---

# 31. `/checklist`

สร้าง checklist จาก:

```text
constitution
risk level
changed modules
plan
requirements
policy packs
```

Checklist ไม่ควรเป็น static list อย่างเดียว

---

# 32. Baseline Pre-Implementation Checklist

```text
[ ] Repository inspected
[ ] Git status checked
[ ] User changes protected
[ ] Spec approved/valid
[ ] Blocking clarifications resolved
[ ] Plan valid
[ ] Task DAG valid
[ ] Requirement coverage complete
[ ] Acceptance verification mapped
[ ] Security impact known
[ ] Migration strategy known
[ ] Rollback strategy known
[ ] Test strategy defined
[ ] Required tools available
```

---

# 33. Dynamic Checklist Examples

ถ้ามี DB migration เพิ่ม:

```text
[ ] migration forward tested
[ ] rollback/recovery documented
[ ] existing rows handled
[ ] nullable/default behavior checked
```

ถ้ามี auth:

```text
[ ] authentication tested
[ ] authorization tested
[ ] privilege escalation tested
[ ] unauthenticated path tested
```

ถ้ามี MCP tool:

```text
[ ] tool schema validated
[ ] destructive hint/policy defined
[ ] auth boundary checked
[ ] timeout defined
[ ] error response structured
```

---

# 34. Quality Gate Engine

สร้าง reusable gate engine

Gate object:

```text
gate_id
cycle_id
gate_type
stage
status
required
risk_level
conditions
result_summary
decided_at
decided_by
evidence_ids
```

Statuses:

```text
PENDING
RUNNING
PASS
FAIL
BLOCKED
WAIVED
```

WAIVED ต้องมี:

```text
reason
approved_by
approval_id
expires_at optional
```

ห้าม waive silently

---

# 35. Mandatory Gates

อย่างน้อย:

```text
SPEC_GATE
CLARIFICATION_GATE
PLAN_GATE
TASK_GATE
ANALYSIS_GATE
PRE_IMPLEMENT_GATE
BUILD_GATE
TEST_GATE
STATIC_ANALYSIS_GATE
SECURITY_GATE
REVIEW_GATE
CONVERGENCE_GATE
STAGING_GATE
DEPLOYMENT_GATE
POST_DEPLOY_HEALTH_GATE
```

เปิด/ปิดตาม project capability ได้ แต่ mandatory gate สำหรับ risk นั้นต้องไม่ถูกข้ามโดย accident

---

# 36. `/implement`

Implementation runner ต้องทำงานตาม task graph ไม่ใช่ prompt เดียวที่ไร้สถานะ

Flow:

```text
Acquire cycle lock
 ↓
Validate pre-implementation gate
 ↓
Select READY task
 ↓
Acquire task lease
 ↓
Prepare Git safety
 ↓
Create execution context
 ↓
Run implementation agent
 ↓
Capture changed files
 ↓
Run task verification
 ↓
Review
 ↓
PASS → task DONE
FAIL → REWORK/BLOCKED
 ↓
Release lease
```

---

# 37. Implementation Context Package

Agent ที่ implement task ต้องได้รับเฉพาะ context ที่จำเป็นแต่เพียงพอ:

```text
constitution excerpt
spec requirements
acceptance criteria
plan section
task definition
relevant code paths
existing conventions
previous task decisions
verification commands
risk policy
```

ห้ามส่ง secret raw value เข้า LLM prompt ถ้าไม่จำเป็น

---

# 38. Safe Git Strategy

ก่อนแก้:

```text
git rev-parse --is-inside-work-tree
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

ถ้ามี uncommitted changes:

```text
DO NOT RESET
DO NOT CLEAN
DO NOT CHECKOUT OVER FILES
```

ให้:

```text
1. detect ownership
2. isolate Phase changes if safe
3. use worktree/branch when appropriate
4. otherwise block and explain
```

---

# 39. Branch Naming

Configurable default:

```text
sdlc/<feature-key>-<slug>
```

ตัวอย่าง:

```text
sdlc/p20-2-spec-driven-orchestrator
```

ห้าม force branch creation ถ้า repo workflow เดิมมี convention ที่ชัดเจน

---

# 40. Worktree Support

ถ้า Git version และ environment รองรับ:

```text
optional isolated worktree per cycle
```

Benefits:

```text
protect current working tree
parallel cycles
clean diff
safe rollback
```

แต่ต้อง config ได้

```env
PAO_SDLC_USE_GIT_WORKTREE=auto
```

values:

```text
auto
always
never
```

---

# 41. Command Runner

Phase 20.2 ต้องมี Safe Command Runner หรือ reuse ของเดิม

Command execution record:

```text
run_id
cycle_id
task_id
command
cwd
sanitized_env
timeout_seconds
started_at
finished_at
exit_code
status
stdout_summary
stderr_summary
artifact_path optional
```

---

# 42. Command Safety

Command policy ต้องรองรับ:

```text
ALLOW
REQUIRE_APPROVAL
DENY
```

ตัวอย่าง DENY/approval-sensitive:

```text
rm -rf /
format disk
destructive DB command
force push protected branch
production delete
secret dump
```

ห้ามใช้ string blacklist อย่างเดียวเป็น security boundary

ให้ใช้:

```text
structured command classification
working-directory boundary
RBAC
approval
sandbox/container when available
```

---

# 43. Working Directory Boundary

Default:

```text
repo root + explicitly allowed temp paths
```

ห้าม agent เขียนไฟล์ทั่วเครื่องโดย default

ถ้าจำเป็นต้องออกนอก repo ต้อง require policy/approval

---

# 44. Execution Timeout

Config examples:

```env
PAO_SDLC_COMMAND_DEFAULT_TIMEOUT_SECONDS=120
PAO_SDLC_TEST_TIMEOUT_SECONDS=900
PAO_SDLC_BUILD_TIMEOUT_SECONDS=1200
PAO_SDLC_AGENT_TIMEOUT_SECONDS=1800
```

ค่าจริง config ได้

---

# 45. Cancellation

Cancel ต้อง:

```text
mark cancellation requested
signal running subprocess safely
wait grace period
force terminate if policy allows
release lease
persist status
record partial changes
require reconciliation before resume
```

---

# 46. Idempotency

ทุก implementation attempt:

```text
execution_attempt_id
idempotency_key
base_commit_sha
input_artifact_hashes
```

ถ้า retry หลัง timeout ต้องตรวจ:

```text
task already changed?
commit already exists?
test already passed?
lease stale?
```

ก่อน run ซ้ำ

---

# 47. Task Lease

เพื่อป้องกันหลาย agent แก้ task เดียวกัน:

```text
lease_owner
lease_token
lease_acquired_at
lease_expires_at
heartbeat_at
```

Expired lease ต้องผ่าน reconciliation ก่อน takeover

---

# 48. Change Manifest

หลัง implementation เก็บ:

```text
files_added
files_modified
files_deleted
migrations_added
config_changed
api_changed
schema_changed
commands_run
commit_sha
```

ใช้ manifest ใน review

---

# 49. Deterministic Verification First

ก่อน AI review ต้อง run deterministic checks ที่ codebase รองรับ

Auto-discover commands จาก:

```text
package.json
pyproject.toml
Makefile
justfile
Cargo.toml
go.mod
CI files
README
existing scripts
```

ห้าม assume `npm test` เสมอ

---

# 50. Build Gate

ตรวจอย่างน้อยตาม stack:

```text
build
compile
type check
syntax check
```

ถ้า project ไม่มี build step ให้ mark `NOT_APPLICABLE`

ไม่ใช่ PASS ปลอม

---

# 51. Test Gate

รองรับ:

```text
unit
integration
E2E
contract
migration
regression
```

TestRun:

```text
id
cycle_id
task_id
suite
tool
command
exit_code
passed_count
failed_count
skipped_count
duration_ms
status
log_ref
commit_sha
```

---

# 52. Test Selection

ระหว่าง task:

```text
run targeted tests first
```

ก่อน converge:

```text
run required broader regression suite
```

ถ้าชุดเต็มใช้เวลามาก ให้ policy กำหนด แต่ห้าม skip โดยไม่บันทึก

---

# 53. Lint / Format

รองรับ existing tooling

```text
ESLint
Biome
Ruff
Black
Prettier
Clippy
gofmt
etc.
```

อย่าติดตั้ง tool ใหม่โดยไม่จำเป็นถ้า project มีของเดิม

---

# 54. Static Analysis

ถ้ามี:

```text
type checker
static analyzer
SAST
dependency scan
```

ให้ integrate เป็น evidence

ถ้าไม่มี ไม่จำเป็นต้องบังคับเพิ่ม package หนัก ๆ โดยไม่มีเหตุผล

---

# 55. Security Gate

Security check ต้อง risk-based

ตรวจอย่างน้อย:

```text
secret exposure
input validation
authentication
authorization
path traversal
command injection
SQL injection
SSRF when relevant
unsafe deserialization
CORS/security headers when relevant
filesystem boundary
MCP tool safety
logging sensitive data
```

---

# 56. Dependency Security

ถ้า package manager รองรับ:

```text
audit vulnerabilities
```

แต่ต้อง distinguish:

```text
pre-existing vulnerability
newly introduced vulnerability
false positive / unreachable
```

Phase ห้าม claim ว่าแก้ vulnerability ทั้ง repo ถ้าไม่ได้แก้จริง

---

# 57. Secret Scan

ก่อน commit/converge ตรวจ diff สำหรับ:

```text
API keys
private keys
tokens
passwords
connection strings
```

ห้าม print secret ใน final report

---

# 58. Software Reviewer Council

สร้าง Software Reviewer Council แยก logical role จาก media Reviewer Council ของ Phase 19

ถ้า Phase 19 มี generic review orchestration ที่ reuse ได้ ให้ reuse engine

ถ้าเป็น media-specific ให้ reuseเฉพาะ infrastructure ที่เหมาะ ไม่ผูก semantics กัน

---

# 59. Reviewer Roles

ขั้นต่ำรองรับ role adapters:

```text
Architecture Reviewer
Security Reviewer
Test/QA Reviewer
Reliability/SRE Reviewer
Requirements Reviewer
Code Quality Reviewer
```

ไม่จำเป็นต้องเรียก AI 6 โมเดลทุก task

Policy เลือก reviewer ตาม risk

---

# 60. Review Profiles

## LOW

```text
Code Quality + deterministic checks
```

## MEDIUM

```text
Code Quality
Requirements
QA
```

## HIGH

```text
Architecture
Security
QA
Reliability
Requirements
```

## CRITICAL

```text
all required roles
+ independent second reviewer
+ human approval
```

---

# 61. AI Provider Adapter

รองรับ provider abstraction:

```text
Codex/OpenAI-compatible
ChatGPT/OpenAI-compatible review adapter
Claude-compatible adapter
Local model adapter
Future provider
```

อย่า hardcode provider name ใน domain model

Domain ใช้:

```text
review_provider_id
reviewer_profile
model_capability
```

---

# 62. Provider Failure

ถ้า reviewer provider offline:

```text
required reviewer unavailable
→ BLOCKED or fallback ตาม policy

optional reviewer unavailable
→ continue + record degraded review
```

ห้าม silently mark PASS

---

# 63. Review Input

Reviewer ต้องได้รับ:

```text
requirements
acceptance criteria
plan
task
change manifest
relevant diff
test evidence
security evidence
known limitations
```

ไม่ควรส่ง repo ทั้งหมดถ้าไม่จำเป็น

---

# 64. Structured Review Output

```text
review_id
role
provider
status
confidence
findings
severity_counts
blocking_findings
recommendations
requirement_coverage
created_at
```

Finding:

```text
finding_id
severity
category
file
line optional
description
rationale
suggested_fix
blocking
```

---

# 65. Review Severities

```text
INFO
LOW
MEDIUM
HIGH
CRITICAL
```

Default gate:

```text
CRITICAL → fail
HIGH → fail unless explicitly approved/waived by policy
MEDIUM → configurable
LOW/INFO → record
```

---

# 66. Reviewer Independence

สำหรับ HIGH/CRITICAL:

```text
implementing agent != sole approving reviewer
```

ถ้า provider เดียวกันแต่คนละ run ให้ mark independence ต่ำกว่า provider/model ต่างกัน

Policy สามารถ require independent provider

---

# 67. Reviewer Consensus

Council result:

```text
PASS
PASS_WITH_NOTES
REWORK_REQUIRED
BLOCKED
```

ห้ามใช้ majority vote อย่างเดียวกับ security critical finding

Critical veto policy:

```text
critical security finding
→ REWORK_REQUIRED
```

แม้ reviewer อื่น PASS

---

# 68. Rework Loop

```text
Review FAIL
 ↓
Create finding-linked rework tasks
 ↓
Implement fix
 ↓
Targeted tests
 ↓
Regression as required
 ↓
Re-review affected roles
```

ห้าม reset history เดิม

เก็บ review version lineage

---

# 69. Evidence Store

Evidence types:

```text
TEST_RESULT
BUILD_RESULT
LINT_RESULT
TYPECHECK_RESULT
SECURITY_SCAN
REVIEW_RESULT
MANUAL_APPROVAL
SCREENSHOT optional
LOG
DEPLOYMENT_RESULT
HEALTH_CHECK
```

Evidence:

```text
id
cycle_id
task_id optional
type
status
source
summary
artifact_ref
commit_sha
created_at
expires_at optional
```

---

# 70. Evidence Freshness

Evidence ต้องผูก commit SHA

ถ้า code เปลี่ยนหลัง test:

```text
old test evidence may become stale
```

Gate engine ต้อง detect

ตัวอย่าง:

```text
Tests passed at commit A
Code now commit B
→ TEST_GATE = STALE/PENDING
```

---

# 71. Human Approval

Approval entity:

```text
approval_id
cycle_id
task_id optional
gate_id
action
risk_level
requested_by
requested_at
status
approved_by
approved_at
reason
context_hash
```

Statuses:

```text
PENDING
APPROVED
REJECTED
EXPIRED
CANCELLED
```

---

# 72. Approval Binding

Approval ต้อง bind กับ exact context hash

ถ้า destructive migration plan เปลี่ยนหลัง approval:

```text
old approval invalid
```

ต้องขอใหม่

---

# 73. Default Human Approval Triggers

อย่างน้อย:

```text
production deployment
destructive migration
production data delete
force push / protected branch override
security boundary change
secret/credential operation
external paid resource creation above threshold
```

ให้ configurable

---

# 74. AI Cost Guard

Phase 20.2 อาจเรียก reviewer หลาย provider

ต้องมี:

```text
per-cycle budget
per-review budget
max reviewer calls
fallback policy
```

Config example:

```env
PAO_SDLC_AI_REVIEW_ENABLED=true
PAO_SDLC_MAX_REVIEW_CALLS_PER_TASK=4
PAO_SDLC_MAX_REVIEW_CALLS_PER_CYCLE=100
PAO_SDLC_REVIEW_BUDGET_USD=10
```

เป็นตัวอย่าง ไม่ hardcode

---

# 75. `/converge`

Convergence คือการพิสูจน์ว่า:

```text
Spec
Plan
Tasks
Implementation
Tests
Reviews
Evidence
```

สอดคล้องกันและไม่มี blocking gap

---

# 76. Convergence Checks

```text
[ ] All required requirements implemented or explicitly deferred
[ ] All required acceptance criteria have fresh evidence
[ ] All required tasks done
[ ] No unresolved blocking clarification
[ ] No blocking review finding
[ ] Mandatory tests pass
[ ] Build passes / N/A valid
[ ] Security gate passes
[ ] Migration verified when applicable
[ ] Rollback/recovery strategy verified when required
[ ] Docs updated
[ ] Env example updated when config changed
[ ] Audit complete
[ ] Working tree expected
[ ] Final diff understood
```

---

# 77. Definition of Done

Cycle `CLOSED` ได้เมื่อ:

```text
convergence gate PASS
+
required deployment/operate gates satisfied for cycle type
```

รองรับ cycle type ที่ไม่ deploy เช่น docs/refactor

อย่าบังคับ production deploy ทุก cycle

---

# 78. Cycle Types

```text
FEATURE
BUGFIX
REFACTOR
SECURITY
INFRASTRUCTURE
MIGRATION
DOCUMENTATION
EXPERIMENT
```

Gate profile แตกต่างได้

---

# 79. Deployment Adapter

Phase 20.2 ไม่ควรสร้าง deployment system ใหม่ถ้า Pao-hubPro มีอยู่แล้ว

ให้สร้าง abstraction:

```text
DeploymentAdapter
```

methods logical:

```text
prepare()
deploy_to_staging()
health_check()
promote()
rollback()
status()
```

ถ้าไม่มี deployment subsystem:

```text
support manual deployment evidence
```

ไม่ต้อง invent production infra

---

# 80. Staging Gate

ถ้ามี staging:

```text
build artifact
apply staging config
run migration in safe environment
smoke test
critical path test
health check
```

ถ้าไม่มี staging:

```text
mark unavailable
require stronger pre-deploy policy for high-risk changes
```

---

# 81. Post-Deploy Health Gate

หลัง deploy:

```text
service health
error rate
critical endpoint
background workers
DB connectivity
queue health
provider health if affected
```

Duration/config ตามระบบเดิม

---

# 82. Rollback

รองรับ:

```text
CODE_ROLLBACK
CONFIG_ROLLBACK
DEPLOYMENT_ROLLBACK
MIGRATION_RECOVERY
FEATURE_FLAG_DISABLE
```

ห้าม claim DB rollback ทำได้เสมอ

บาง migration ต้อง forward-fix

ต้องบันทึก strategy จริง

---

# 83. `/operate`

หลัง deployment ระบบต้องติดตามอย่างน้อย:

```text
health
errors
latency
queue/backlog if relevant
resource use
AI review cost if relevant
user feedback
incidents
```

Phase 20.2 orchestration ใช้ข้อมูลเหล่านี้สร้าง improvement candidate ได้

---

# 84. Feedback → New Cycle

Feedback ห้ามแก้ production ทันทีแบบ invisible

Flow:

```text
Feedback
 ↓
Improvement Candidate
 ↓
New SDLC Cycle
 ↓
/specify
```

สามารถ link parent cycle:

```text
parent_cycle_id
source_feedback_id
```

---

# 85. Artifact System

ทุก stage สร้าง versioned artifact

Types:

```text
CONSTITUTION
SPEC
CLARIFICATION
PLAN
ADR
TASKS
ANALYSIS
CHECKLIST
IMPLEMENTATION_LOG
TEST_REPORT
SECURITY_REPORT
REVIEW_REPORT
CONVERGENCE_REPORT
DEPLOYMENT_REPORT
OPERATIONS_REPORT
FINAL_REPORT
```

---

# 86. Artifact Storage

ให้ใช้ database + file artifact ตาม architecture เดิม

Suggested repo-friendly mirror:

```text
.pao/
  sdlc/
    constitution.md
    cycles/
      <cycle-id>/
        manifest.yaml
        spec.md
        clarifications.md
        plan.md
        tasks.md
        analysis.md
        checklist.md
        implementation-log.md
        verification.md
        review.md
        convergence.md
        final-report.md
```

แต่ต้องไม่ force หาก repo มี docs convention ที่ดีกว่า

---

# 87. Artifact Hashing

Artifact ที่ใช้ gate ต้องมี:

```text
content_hash
version
created_at
source_version
```

ถ้า Spec เปลี่ยนหลัง Plan:

```text
Plan may become stale
Tasks may become stale
```

ต้อง propagate invalidation

---

# 88. Staleness Graph

ตัวอย่าง:

```text
Spec changed
→ Clarification check pending
→ Plan stale
→ Tasks stale
→ Analyze stale
→ Pre-implementation gate fail
```

ห้ามปล่อย implement จาก plan เก่าโดยไม่ตรวจ

---

# 89. Artifact Version Lineage

```text
artifact_id
cycle_id
type
version
parent_version_id
content_hash
created_by
created_at
reason
```

---

# 90. Suggested Database Tables

ใช้ชื่อให้เข้ากับ convention เดิม

```text
sdlc_cycles
sdlc_artifacts
sdlc_requirements
sdlc_acceptance_criteria
sdlc_clarifications
sdlc_adrs
sdlc_tasks
sdlc_task_dependencies
sdlc_runs
sdlc_command_runs
sdlc_test_runs
sdlc_evidence
sdlc_reviews
sdlc_review_findings
sdlc_gates
sdlc_approvals
sdlc_events
sdlc_locks
sdlc_feedback
```

อย่าทำ table ทั้งหมดถ้า existing generic tables reuse ได้อย่างเหมาะสม

---

# 91. Migration Rules

1. additive migration ก่อนถ้าเป็นไปได้
2. migration ต้อง idempotent ตาม framework capability
3. ห้าม drop column/table อัตโนมัติใน Phase 20.2 โดยไม่มีเหตุผล/approval
4. ต้อง test empty DB + existing DB path เท่าที่ test infrastructure รองรับ
5. rollback/forward recovery document

---

# 92. Event Model

Events อย่างน้อย:

```text
sdlc.cycle.created
sdlc.cycle.stage_changed
sdlc.spec.generated
sdlc.clarification.blocked
sdlc.plan.generated
sdlc.tasks.generated
sdlc.analysis.gap_found
sdlc.gate.started
sdlc.gate.passed
sdlc.gate.failed
sdlc.task.started
sdlc.task.completed
sdlc.task.rework_required
sdlc.run.started
sdlc.run.failed
sdlc.test.completed
sdlc.review.completed
sdlc.approval.requested
sdlc.approval.approved
sdlc.approval.rejected
sdlc.converged
sdlc.deployed
sdlc.rollback.requested
sdlc.rollback.completed
sdlc.feedback.created
```

---

# 93. Event Idempotency

Event ต้องมี:

```text
event_id
cycle_id
sequence
idempotency_key
timestamp
```

consumer ต้อง handle duplicate delivery

---

# 94. Realtime UI Updates

Reuse websocket/SSE/event infrastructure เดิมถ้ามี

UI ต้องเห็น:

```text
stage
current task
running command
latest gate
latest review
blockers
progress
```

ห้าม poll ถี่เกินโดยไม่จำเป็น

---

# 95. Dashboard — SDLC Command Center

เพิ่ม page logical:

```text
SDLC Command Center
```

Sections:

```text
Active Cycles
Blocked Cycles
Approval Required
Recent Reviews
Gate Failures
Ready to Converge
Recent Deployments
```

---

# 96. New Cycle UI

Fields:

```text
Title
Idea / Problem
Cycle Type
Priority
Risk hint optional
Target module optional
Constraints optional
Auto-run mode
Reviewer profile
```

Auto-run modes:

```text
MANUAL
GUIDED
AUTO_UNTIL_APPROVAL
FULL_AUTO_SAFE_ONLY
```

---

# 97. Cycle Detail UI

Tabs:

```text
Overview
Spec
Clarify
Plan
Tasks
Coverage
Checklist
Implementation
Tests
Security
Reviews
Gates
Approvals
Artifacts
Audit
```

---

# 98. Stage Timeline

แสดง:

```text
Idea → Specify → Clarify → Plan → Tasks → Analyze → Implement → Verify → Review → Converge
```

แต่ละ node:

```text
status
duration
owner
latest result
blocker count
```

---

# 99. Coverage UI

ต้องดูได้ว่า:

```text
FR-001  100%
FR-002  50%  ← missing test
SEC-001 0%   ← no task
```

click แล้วเห็น trace chain

---

# 100. Gate Matrix UI

ตัวอย่าง:

```text
Spec                 PASS
Clarification        PASS
Plan                 PASS
Task Coverage        PASS
Build                PASS
Unit Test            PASS
Integration          PASS
Security             PASS
Reviewer Council     REWORK
Convergence          BLOCKED
```

---

# 101. Approval UI

แสดงให้ user เห็นชัด:

```text
Action
Reason
Risk
Exact change/context
What happens if approved
Rollback option
```

Buttons:

```text
Approve
Reject
View Diff
```

อย่าใช้ปุ่ม vague ว่า `OK`

---

# 102. Diff Viewer

ถ้า UI stack รองรับ:

```text
changed files
added/deleted lines
migration files
config changes
```

สำหรับ high-risk approval ต้องเปิดดู diff ได้

---

# 103. Audit Log

เก็บ:

```text
who
what
when
cycle
task
input hash
result
ip/session if architecture supports
```

Sensitive fields ต้อง redact

---

# 104. REST API

ปรับ naming ตาม API convention เดิม

Logical endpoints:

```text
POST   /api/sdlc/cycles
GET    /api/sdlc/cycles
GET    /api/sdlc/cycles/:id
POST   /api/sdlc/cycles/:id/specify
POST   /api/sdlc/cycles/:id/clarify
POST   /api/sdlc/cycles/:id/plan
POST   /api/sdlc/cycles/:id/tasks
POST   /api/sdlc/cycles/:id/analyze
POST   /api/sdlc/cycles/:id/checklist
POST   /api/sdlc/cycles/:id/implement
POST   /api/sdlc/cycles/:id/test
POST   /api/sdlc/cycles/:id/review
POST   /api/sdlc/cycles/:id/converge
POST   /api/sdlc/cycles/:id/pause
POST   /api/sdlc/cycles/:id/resume
POST   /api/sdlc/cycles/:id/cancel
POST   /api/sdlc/cycles/:id/rollback
GET    /api/sdlc/cycles/:id/artifacts
GET    /api/sdlc/cycles/:id/gates
GET    /api/sdlc/cycles/:id/evidence
GET    /api/sdlc/cycles/:id/audit
POST   /api/sdlc/approvals/:id/approve
POST   /api/sdlc/approvals/:id/reject
```

ห้าม implement endpoint ที่ไม่เข้ากับ routing style เดิมแบบฝืน ๆ

---

# 105. API Authorization

แยก permissions logical:

```text
sdlc.read
sdlc.create
sdlc.run
sdlc.approve
sdlc.deploy
sdlc.rollback
sdlc.admin
```

Reuse RBAC เดิม

---

# 106. MCP Tools

เพิ่ม tools logical:

```text
sdlc_create_cycle
sdlc_get_cycle
sdlc_get_status
sdlc_specify
sdlc_clarify
sdlc_plan
sdlc_generate_tasks
sdlc_analyze
sdlc_get_checklist
sdlc_implement
sdlc_run_tests
sdlc_review
sdlc_converge
sdlc_pause
sdlc_resume
sdlc_request_approval
sdlc_rollback
sdlc_get_report
```

ใช้ naming/schema ตาม MCP implementation เดิม

---

# 107. MCP Tool Safety Hints

Read-only:

```text
get_cycle
get_status
get_checklist
get_report
```

Mutating:

```text
specify
plan
tasks
implement
resume
```

High-risk:

```text
deploy
rollback
approve destructive action
```

ถ้า MCP framework รองรับ annotations/tool hints ให้กำหนดอย่างถูกต้อง

---

# 108. MCP Input Validation

ทุก tool ต้อง validate:

```text
cycle exists
state transition valid
user permission
required artifact current
no conflicting lock
risk gate
```

---

# 109. CLI / Slash Command Adapter

ถ้า Pao-hubPro มี command palette/chat command:

```text
/sdlc new "Add Auto Upscale for Adobe Stock"
/specify
/clarify
/plan
/tasks
/analyze
/checklist
/implement
/status
/review
/converge
```

ถ้าไม่มี ไม่ต้องสร้าง chat UI ใหม่เพียงเพื่อ slash command

ให้ service/API/MCP เป็น core

---

# 110. Agent Adapter Interface

logical interface:

```text
AgentAdapter.run(
  role,
  instructions,
  context,
  constraints,
  timeout,
  output_schema
)
```

ต้องรองรับ:

```text
structured output
cancellation
timeout
provider errors
usage/cost metadata
```

---

# 111. Agent Roles

```text
Specifier
Clarifier
Planner
Task Decomposer
Consistency Analyst
Implementer
Test Analyst
Security Reviewer
Architecture Reviewer
QA Reviewer
Convergence Analyst
```

Role ไม่เท่ากับ provider

provider เดียวทำหลาย role ได้ตาม policy

---

# 112. Prompt Versioning

System prompt/template ของแต่ละ role ต้อง versioned

เก็บ:

```text
prompt_template_id
version
content_hash
```

Run record ต้องรู้ว่าใช้ prompt version ไหน

---

# 113. Structured Output Validation

AI output ที่เป็น:

```text
spec
plan
tasks
review
```

ต้อง parse ผ่าน schema validation

ถ้า invalid:

```text
repair attempt limited
→ fail explicitly
```

ห้าม parse ด้วย regex เปราะ ๆ ถ้ามี structured JSON/schema support

---

# 114. Hallucination Guard

AI ห้าม claim:

```text
file exists
endpoint exists
test passed
package installed
migration applied
```

โดยไม่มี tool/repo evidence

Implementer ต้อง inspect ก่อนกล่าวอ้าง

---

# 115. Codebase Grounding

Plan/review ต้องอ้างอิง path/symbol จริงเมื่อหาได้

ถ้าหาไม่พบ:

```text
mark unknown
```

ไม่ invent file path

---

# 116. Context Compression

สำหรับ repo ใหญ่:

```text
retrieve only relevant files
summarize stable architecture
cache repository map
invalidate on significant commit
```

ไม่ส่ง entire repository ทุก call

---

# 117. Repository Map

สร้าง cacheable repository map:

```text
modules
entrypoints
API routes
DB models
migration dirs
test dirs
config files
CI files
MCP tools
Phase modules
```

เก็บ commit SHA ที่ map สร้าง

---

# 118. Resume / Recovery

หลัง process restart:

```text
load active cycles
find stale leases
reconcile command runs
reconcile task status
validate git HEAD/worktree
mark uncertain operations
resume safe stages
```

ห้าม auto-resume destructive action ที่สถานะไม่แน่ชัด

---

# 119. Recovery States

Command/run statuses:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
TIMED_OUT
CANCELLED
UNKNOWN_AFTER_RESTART
RECONCILED
```

`UNKNOWN_AFTER_RESTART` ต้องตรวจผลก่อน retry

---

# 120. Reconciliation

ตัวอย่าง:

```text
Task marked RUNNING
process crashed

on restart:
- inspect lease
- inspect process if possible
- inspect git diff/commit
- inspect evidence
- determine completed/failed/unknown
```

ห้าม run task ซ้ำทันที

---

# 121. Locks

Lock types:

```text
CYCLE_LOCK
TASK_LOCK
WORKTREE_LOCK
DEPLOYMENT_LOCK
MIGRATION_LOCK
```

ใช้ DB/advisory lock/existing distributed lock ตาม stack

---

# 122. Concurrency

รองรับหลาย cycle แต่ต้องป้องกัน:

```text
สอง cycle แก้ไฟล์เดียว conflict
สอง migration run พร้อมกัน
สอง deploy พร้อมกัน
```

Phase 20.2 ต้อง detect overlap risk

---

# 123. File Conflict Prediction

ใช้ `expected_files` + actual diff

ถ้า cycles active สองตัวแก้ module เดียวกัน:

```text
warn
serialize
or isolate via worktree
```

อย่า assume merge จะผ่าน

---

# 124. Observability

Metrics logical:

```text
sdlc_cycles_active
sdlc_cycles_blocked
sdlc_stage_duration_seconds
sdlc_task_duration_seconds
sdlc_gate_failures_total
sdlc_rework_total
sdlc_review_findings_total
sdlc_command_failures_total
sdlc_ai_calls_total
sdlc_ai_cost_total
sdlc_resume_total
```

ปรับให้เข้ากับ telemetry stack เดิม

---

# 125. Structured Logging

ทุก log สำคัญมี:

```text
cycle_id
task_id
run_id
gate_id
stage
provider
```

ห้าม log secret

---

# 126. Alerts

ถ้ามี alert infrastructure:

```text
cycle stuck
critical review finding
repeated test failure
stale lease
approval waiting too long
post-deploy health failed
```

ไม่จำเป็นต้องสร้าง notification stack ใหม่ถ้าไม่มี

---

# 127. Settings

เพิ่ม settings ตาม architecture เดิม:

```text
SDLC enabled
Default auto-run mode
Default reviewer profile
Max parallel cycles
Use worktrees
Command timeout
Agent timeout
Required human approvals
AI review enabled
Review budget
Artifact retention
```

---

# 128. Environment Variables

ตัวอย่างชื่อ ปรับตาม naming convention:

```env
PAO_SDLC_ENABLED=true
PAO_SDLC_DEFAULT_MODE=GUIDED
PAO_SDLC_MAX_PARALLEL_CYCLES=2
PAO_SDLC_USE_GIT_WORKTREE=auto
PAO_SDLC_COMMAND_DEFAULT_TIMEOUT_SECONDS=120
PAO_SDLC_TEST_TIMEOUT_SECONDS=900
PAO_SDLC_BUILD_TIMEOUT_SECONDS=1200
PAO_SDLC_AGENT_TIMEOUT_SECONDS=1800
PAO_SDLC_AI_REVIEW_ENABLED=true
PAO_SDLC_MAX_REVIEW_CALLS_PER_TASK=4
PAO_SDLC_MAX_REVIEW_CALLS_PER_CYCLE=100
PAO_SDLC_REVIEW_BUDGET_USD=10
PAO_SDLC_REQUIRE_APPROVAL_FOR_PRODUCTION=true
PAO_SDLC_ARTIFACT_RETENTION_DAYS=90
```

อย่า duplicate config ถ้ามี central settings system

---

# 129. Secrets

Provider credentials ต้องใช้ secret system เดิม

`.env.example` ใส่เฉพาะ placeholder:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

ถ้า provider นั้นถูก enable จริง

อย่าเพิ่ม secret ที่ไม่ใช้

---

# 130. Security Model

Phase 20.2 มี execution capability จึงถือเป็น security-sensitive subsystem

ต้อง threat model:

```text
malicious prompt
prompt injection from repo docs
command injection
path traversal
secret exfiltration
unsafe MCP call
privilege escalation
approval bypass
log injection
artifact tampering
review spoofing
```

---

# 131. Prompt Injection from Repository

ข้อความใน README/comment/source code อาจเป็น untrusted content

Agent ต้องแยก:

```text
system policy
user intent
trusted project policy
repository content
```

Repo content ห้าม override constitution/policy

---

# 132. Artifact Integrity

Gate decision ต้องใช้ artifact hash

ถ้า artifact file ถูกแก้นอกระบบ:

```text
hash mismatch
→ invalidate dependent gate
```

---

# 133. Approval Bypass Protection

Approval-required action ต้อง validate server-side

ห้ามพึ่ง frontend disable button

---

# 134. RBAC Tests

อย่างน้อย:

```text
reader cannot implement
runner cannot approve if policy separates duty
unauthorized user cannot read sensitive execution logs
non-admin cannot change critical policy
```

ปรับตาม role model เดิม

---

# 135. Privacy / Redaction

ก่อนส่ง context ไป external reviewer:

```text
redact secrets
redact tokens
redact private keys
avoid unnecessary user data
```

หาก content sensitive ตาม policy ให้ใช้ local/deterministic mode

---

# 136. Test Strategy — Phase 20.2

ต้องมี tests โดยไม่ต้องเรียก AI/API จริง

ใช้ mocks/fakes

---

# 137. Unit Tests

อย่างน้อย:

```text
state machine transitions
risk classification
gate evaluation
artifact hashing
staleness propagation
requirement coverage
DAG cycle detection
lease expiry
approval context hash
review severity policy
command policy
```

---

# 138. Integration Tests

อย่างน้อย:

```text
create cycle → specify → plan → tasks
blocking clarification stops planning
analysis gap blocks implementation
implementation lock prevents duplicate worker
test failure blocks review/converge
review critical finding creates rework
artifact change invalidates gate
restart recovers active cycle
approval required blocks high-risk action
```

---

# 139. Git Integration Tests

ใช้ temp repo:

```text
clean repo
repo with uncommitted changes
branch creation
worktree optional
changed file manifest
stale base commit
conflicting cycle
```

ห้าม test กับ user repository จริงแบบ destructive

---

# 140. Command Runner Tests

```text
success
non-zero exit
timeout
cancel
large stdout truncation/summarization
working directory violation
disallowed command
approval-required command
```

---

# 141. Reviewer Tests

Mock reviewer:

```text
PASS
HIGH finding
CRITICAL security finding
malformed output
provider timeout
provider unavailable
```

ตรวจ council result ถูกต้อง

---

# 142. Recovery Tests

จำลอง crash:

```text
during task lease
during command run
after code change before status save
after test pass before gate update
during review
```

ต้องไม่ duplicate dangerous action

---

# 143. Migration Tests

```text
fresh DB
upgrade existing DB
required indexes
constraints
rollback/recovery path
```

ตาม test tooling เดิม

---

# 144. API Tests

```text
validation
auth
RBAC
invalid transition
lock conflict
approval
pagination
artifact retrieval
```

---

# 145. MCP Tests

```text
schema
read-only vs mutating behavior
invalid cycle
blocked gate
approval required
error normalization
```

---

# 146. UI Tests

ถ้า frontend test infrastructure มีอยู่:

```text
new cycle
stage timeline
gate matrix
approval flow
blocked status
resume flow
```

ถ้าไม่มี อย่าเพิ่ม heavy framework เพียงเพื่อ Phase นี้โดยไม่มีเหตุผล

---

# 147. Acceptance Scenario A — Simple Feature

ใช้ mock/test fixture:

```text
Idea:
Add a harmless settings field
```

Expected:

```text
create cycle
specify
plan
tasks
analyze
implement in temp fixture repo
run test
review
converge
PASS
```

---

# 148. Acceptance Scenario B — Missing Coverage

Spec:

```text
FR-001
FR-002
```

Tasks cover only FR-001

Expected:

```text
/analyze
→ REQ_WITHOUT_TASK FR-002
→ implementation blocked
```

---

# 149. Acceptance Scenario C — Test Failure

```text
implementation complete
unit test fails
```

Expected:

```text
TEST_GATE FAIL
REVIEW may run diagnostic only
CONVERGENCE blocked
```

ห้าม close cycle

---

# 150. Acceptance Scenario D — Critical Security Finding

Reviewer returns:

```text
CRITICAL command injection
```

Expected:

```text
REVIEW_GATE FAIL
REWORK_REQUIRED
rework task generated
```

majority vote ห้าม override

---

# 151. Acceptance Scenario E — Dirty Working Tree

User มี uncommitted file

Expected:

```text
system detects dirty state
never reset/clean user file
either isolate safely or block
```

---

# 152. Acceptance Scenario F — Restart Recovery

```text
Task RUNNING
process stops unexpectedly
```

restart:

```text
stale lease detected
reconcile Git/evidence
no blind rerun
safe resume
```

---

# 153. Acceptance Scenario G — Artifact Staleness

```text
Spec v1
Plan v1
Tasks v1

then Spec becomes v2
```

Expected:

```text
Plan/Tasks/Analyze dependent state marked stale
implementation cannot continue until reconciled
```

---

# 154. Acceptance Scenario H — High-Risk Approval

```text
plan includes destructive migration
```

Expected:

```text
risk HIGH/CRITICAL
approval requested
context hash bound
implementation/deploy blocked until approval
```

---

# 155. Acceptance Scenario I — AI Reviewer Offline

```text
Security reviewer unavailable
```

ถ้า security reviewer required:

```text
REVIEW_GATE BLOCKED
```

ถ้า optional:

```text
record degraded review
continue according to policy
```

---

# 156. Acceptance Scenario J — Pao-hubPro Feature Example

ใช้เป็น documentation/demo cycle เท่านั้น ไม่บังคับ implement feature นี้:

```text
Idea:
เพิ่ม Auto Upscale สำหรับ Adobe Stock
```

ระบบควรสร้าง chain ตัวอย่าง:

```text
Idea
→ Requirement: upscale presets
→ Acceptance: output dimensions/quality checks
→ Plan: reuse Phase 19 asset pipeline
→ Tasks: service/API/UI/tests
→ Analyze
→ Implement
→ Stock QC regression
→ Review
→ Converge
```

แสดงว่า Phase 20.2 ใช้กับ Phase 19 ได้โดยไม่ duplicate asset pipeline

---

# 157. Integration with Phase 19

Phase 20.2 ต้องสามารถสร้าง SDLC cycle เพื่อพัฒนา Generation Studio

แต่ runtime generation jobs ยังใช้ Phase 19

```text
Software SDLC Orchestrator
!=
Media Generation Job Orchestrator
```

ห้ามใช้ table/state เดียวกันจน semantics ปนกัน

reuse generic infrastructure เท่านั้น

---

# 158. Integration with Phase 20

ถ้า software change เกี่ยวกับ RunPod:

Plan/analyze ต้อง identify:

```text
cost impact
provider lifecycle impact
secret impact
failover impact
```

แต่ GPU routing runtime ยังเป็น Phase 20

---

# 159. Integration with Phase 20.1

ถ้า change เกี่ยว Smart Queue:

Phase 20.2 coverage สามารถ map requirements ไป tests เช่น:

```text
no duplicate dispatch
queue ownership safe
scale-up hysteresis
budget guard
```

แต่ไม่สร้าง scheduler ใหม่

---

# 160. Self-Hosting / Dogfooding

หลัง Phase 20.2 stable ให้ระบบสามารถใช้ SDLC orchestrator เพื่อพัฒนา Phase ถัดไปของตัวเอง

แต่ Phase 20.2 initial bootstrap ต้องไม่พึ่ง subsystem ที่ยังไม่ถูกสร้างจน deadlock

ใช้ bootstrap path:

```text
Codex implements Phase 20.2 normally
→ tests
→ Phase 20.2 enabled
→ future phases use orchestrator
```

---

# 161. Bootstrap Safety

อย่าพยายามให้ Phase 20.2 orchestrate implementation ของ Phase 20.2 แบบ full recursive ในครั้งแรก

ทำหลัง system passes acceptance tests เท่านั้น

---

# 162. Final Report

หลัง Codex implement เสร็จ ต้องสร้าง Final Verification Report ที่มี:

```text
Phase implemented
Architecture summary
Files added
Files modified
DB migrations
API endpoints
MCP tools
UI pages/components
Tests run
Build/lint/typecheck results
Security checks
Known limitations
Backward compatibility notes
Manual steps
Environment variables
Rollback/recovery notes
Final git status
Final commit SHA if committed
```

---

# 163. Final Report Honesty Rules

ห้ามเขียน:

```text
All tests passed
```

ถ้าไม่ได้ run จริง

ต้องแยก:

```text
PASS
FAIL
NOT_RUN
NOT_APPLICABLE
BLOCKED
```

---

# 164. Documentation Deliverables

อัปเดต:

```text
README or module docs
SDLC architecture docs
command reference
MCP tool docs
REST API docs
settings docs
security model
approval model
recovery guide
troubleshooting
```

และ `.env.example`

---

# 165. Troubleshooting Guide ต้องครอบคลุม

```text
cycle stuck
stale lease
invalid state transition
dirty Git tree
worktree error
agent timeout
test timeout
review provider unavailable
artifact hash mismatch
approval expired
recovery after crash
```

---

# 166. Performance Requirements

SDLC orchestrator ไม่ควรทำให้ main dashboard ช้า

Guidelines:

```text
long-running work → background worker
large logs → paginate/stream
large diff → lazy load
artifact content → fetch on demand
```

อย่าเก็บ stdout หลาย MB ใน row เดียวถ้า persistence layer ไม่เหมาะ

---

# 167. Retention

Configurable retention สำหรับ:

```text
command logs
AI prompts/responses
artifacts
review evidence
```

Audit/approval retention อาจต้องยาวกว่า runtime logs

ใช้ policy เดิมถ้ามี

---

# 168. Data Redaction in Logs

Redact patterns:

```text
Authorization headers
API keys
cookies
private keys
database passwords
signed URLs when sensitive
```

---

# 169. Failure Semantics

ทุก service method ต้อง distinguish:

```text
VALIDATION_ERROR
INVALID_STATE
POLICY_BLOCKED
APPROVAL_REQUIRED
LOCK_CONFLICT
PROVIDER_UNAVAILABLE
COMMAND_FAILED
TEST_FAILED
REVIEW_FAILED
TIMEOUT
CANCELLED
INTERNAL_ERROR
```

อย่า return generic 500 ทุกกรณี

---

# 170. Retry Policy

Retry ได้สำหรับ:

```text
transient provider failure
network issue
retryable agent timeout according to policy
```

ห้าม retry blindly:

```text
destructive command
migration
commit/push
production deploy
```

ต้อง reconcile ก่อน

---

# 171. Rate Limiting

Mutating endpoints และ AI-heavy endpoints ควร reuse rate limit infrastructure ถ้ามี

ป้องกัน accidental double click / repeated agent call

---

# 172. UI Double-Submit Guard

ปุ่ม `/implement`, approve, rollback:

```text
disable while request pending
idempotency key
server-side lock
```

---

# 173. Feature Flags

ถ้า feature flag system มีอยู่ ให้เพิ่ม:

```text
sdlc_orchestrator_enabled
sdlc_ai_review_enabled
sdlc_auto_implement_enabled
```

เพื่อ rollout ปลอดภัย

---

# 174. Rollout Plan

แนะนำ:

```text
Stage 1: Local deterministic mode
Stage 2: Guided mode + AI spec/plan
Stage 3: AI reviewers
Stage 4: Auto implementation safe tasks
Stage 5: Staging/deployment integration
```

Codex ไม่จำเป็นต้อง rollout production จริงถ้า repo ไม่มี deployment target

แต่ architecture ต้องรองรับ

---

# 175. Manual Mode

```text
User triggers each stage
```

เหมาะกับ bootstrap/debug

---

# 176. Guided Mode

```text
system proposes next step
user confirms at important boundaries
```

Default ที่แนะนำสำหรับ initial release

---

# 177. Auto Until Approval

```text
specify → clarify → plan → tasks → analyze → checklist → implement → verify → review
```

หยุดเมื่อ:

```text
approval required
blocking clarification
gate fail
```

---

# 178. Full Auto Safe Only

ทำได้เฉพาะ action ที่ policy classify safe

ห้าม full-auto production destructive action

---

# 179. Suggested Initial Default

```text
PAO_SDLC_DEFAULT_MODE=GUIDED
```

AI review เปิดได้ แต่ deterministic gate mandatory

---

# 180. Future Extension Points — DO NOT overbuild now

ออกแบบ interface รองรับอนาคต:

```text
GitHub PR integration
Slack/Telegram approval
multi-repo cycles
remote Codex workers
CI result ingestion
policy-as-code
OpenTelemetry traces
automatic incident-to-cycle
multi-agent debate
benchmark/eval suite
```

แต่ห้าม implementทั้งหมดถ้าไม่จำเป็นใน Phase 20.2

---

# 181. Out of Scope

Phase 20.2 ไม่ต้อง:

```text
สร้าง GitHub clone
สร้าง CI platform ใหม่
สร้าง container orchestrator ใหม่
สร้าง IDE ใหม่
สร้าง full project management app
replace Git
replace Phase 19 Generation Orchestrator
replace Phase 20 GPU Router
replace Phase 20.1 Smart Queue
```

---

# 182. Minimum Viable Production Scope

Phase 20.2 ถือว่าใช้งานได้ขั้นต่ำเมื่อมี:

```text
Persistent cycle
State machine
Spec artifact
Clarification
Plan
Tasks DAG
Analyze coverage
Checklist
Safe implementation runner
Git protection
Deterministic verification
Reviewer abstraction
Quality gates
Approval model
Converge
Recovery
REST/MCP integration where existing architecture supports
Dashboard status
Tests
Docs
```

---

# 183. Required Build Order

Codex ควร implement ตาม dependency โดยประมาณ:

```text
1 Domain model + migration
2 Cycle state machine
3 Artifact/version system
4 Constitution/policy
5 Specify/Clarify/Plan/Tasks
6 Analyze/Coverage
7 Checklist/Gate engine
8 Lock/lease/recovery
9 Safe Git + Command runner
10 Implementation runner
11 Deterministic verification
12 Reviewer abstraction/council
13 Approval
14 Converge
15 API/MCP
16 Dashboard
17 Observability
18 Integration tests
19 Docs
20 Final verification
```

ปรับได้ตาม codebaseจริง

---

# 184. Codex Repository Inspection Checklist

ก่อนเขียนโค้ด:

```text
[ ] print/inspect project tree
[ ] find main app entrypoint
[ ] find backend framework
[ ] find frontend framework
[ ] find DB/ORM
[ ] find migrations
[ ] find auth/RBAC
[ ] find background jobs
[ ] find logging
[ ] find settings/env
[ ] find tests
[ ] find MCP integration
[ ] find Phase 19 modules
[ ] find Phase 20 modules
[ ] find Phase 20.1 modules
[ ] inspect git status
[ ] identify existing patterns to reuse
```

---

# 185. Codex Implementation Behavior

เมื่อพบ ambiguity:

1. inspect codebase
2. inspect project docs
3. reuse existing pattern
4. choose backward-compatible option
5. document assumption
6. ถ้าเป็น product/security/destructive ambiguity ที่สำคัญ ให้ stop เฉพาะจุดนั้นและสร้าง blocker แทนเดา

---

# 186. Do Not Stop for Trivial Questions

Codex ไม่ต้องถาม user ว่า:

```text
อยากตั้งชื่อไฟล์อะไร?
ใช้ helper เดิมได้ไหม?
จะใช้ folder ไหน?
```

ถ้า codebase มี convention ชัดเจน

ให้ตัดสินใจจาก repository

---

# 187. But Do Stop for Material Decisions

เช่น:

```text
จะลบ production data หรือไม่
จะ expose remote shell หรือไม่
จะเปลี่ยน auth model หรือไม่
จะสร้าง paid cloud resource เกิน budget หรือไม่
```

ต้อง approval/clarification

---

# 188. Final Acceptance Checklist — Core

```text
[ ] Existing Pao-hubPro repo used
[ ] No duplicate project created
[ ] Phase 19 intact
[ ] Phase 20 intact
[ ] Phase 20.1 intact
[ ] Persistent SDLC cycles
[ ] Explicit state machine
[ ] Constitution versioning
[ ] Specification artifacts
[ ] Clarification blockers
[ ] Architecture planning
[ ] Task DAG
[ ] Requirement coverage analysis
[ ] Dynamic checklist
[ ] Quality gates
[ ] Safe implementation runner
[ ] Git dirty-tree protection
[ ] Command policy
[ ] Locks/leases
[ ] Resume/recovery
[ ] Deterministic verification
[ ] Software Reviewer Council
[ ] Approval model
[ ] Convergence
```

---

# 189. Final Acceptance Checklist — Engineering

```text
[ ] Migration created
[ ] Unit tests
[ ] Integration tests
[ ] Recovery tests
[ ] Git temp-repo tests
[ ] API tests
[ ] MCP tests if MCP exists
[ ] Frontend tests if infra exists
[ ] Build verified
[ ] Lint verified
[ ] Typecheck verified if applicable
[ ] Security checks performed
[ ] Secrets not committed
[ ] Env example updated
[ ] Docs updated
[ ] Backward compatibility reviewed
```

---

# 190. Final Acceptance Checklist — UX

```text
[ ] Create cycle UI usable
[ ] Stage timeline visible
[ ] Blocker visible
[ ] Task progress visible
[ ] Coverage matrix visible
[ ] Gate matrix visible
[ ] Approval action explicit
[ ] Review findings readable
[ ] Resume/paused state understandable
[ ] Final report accessible
```

---

# 191. Final Acceptance Checklist — Safety

```text
[ ] No silent destructive action
[ ] No silent approval bypass
[ ] No overwrite user uncommitted changes
[ ] No fake PASS
[ ] No blind retry after uncertain crash
[ ] No secret in logs/prompts where avoidable
[ ] No direct public dangerous endpoint
[ ] No arbitrary filesystem access by default
[ ] No unrestricted shell endpoint
[ ] No auto production deploy without policy
```

---

# 192. Definition of Phase 20.2 Success

Phase 20.2 สำเร็จเมื่อ Pao-hubPro สามารถรับ:

```text
"เพิ่ม feature X"
```

แล้วสร้าง lifecycle ที่ตรวจสอบย้อนหลังได้:

```text
Idea
 ↓
Spec
 ↓
Clarify
 ↓
Plan
 ↓
Tasks
 ↓
Analyze
 ↓
Checklist
 ↓
Implement
 ↓
Tests
 ↓
Security
 ↓
Review
 ↓
Converge
```

โดยทุกขั้นมี state, artifact, evidence และ gate

ไม่ใช่แค่การส่ง prompt ต่อกัน

---

# 193. Desired User Experience

เป้าหมาย UX:

```text
เปาเขียน:
"เพิ่มระบบ Auto Upscale สำหรับ Adobe Stock"

Pao-hubPro:
1. สร้าง Cycle
2. สร้าง Spec
3. หา Gap
4. วาง Plan
5. แตก Tasks
6. วิเคราะห์ coverage
7. แสดง checklist
8. Implement แบบปลอดภัย
9. Run tests
10. Review
11. แจ้ง blocker ถ้ามี
12. Converge เมื่อผ่าน
```

เปาไม่ต้องจำทุกขั้นตอนเอง

แต่ยังเห็นและควบคุมทุก Gate สำคัญได้

---

# 194. Quality Philosophy

Phase 20.2 ต้องยึดหลัก:

```text
Fast is useful.
Repeatable is better.
Verified is production-grade.
Auditable is trustworthy.
Recoverable is operationally safe.
```

---

# 195. Codex One-Shot Execute Instruction

**เริ่ม implement Phase 20.2 ใน repository Pao-hubPro ปัจจุบันตอนนี้**

ให้ทำตามลำดับ:

```text
A. Inspect repository
B. Map existing Phase 19/20/20.1 architecture
C. Inspect Git status and protect user changes
D. Design integration using existing conventions
E. Implement persistent domain + migrations
F. Implement SDLC state machine/artifacts
G. Implement /specify /clarify /plan /tasks /analyze /checklist
H. Implement gate engine
I. Implement safe Git/command/locking/recovery
J. Implement /implement runner
K. Implement deterministic verification
L. Implement Software Reviewer Council abstraction
M. Implement approvals
N. Implement /converge
O. Integrate API/MCP/UI using existing architecture
P. Add observability
Q. Add tests/mocks/fakes
R. Run tests/build/lint/typecheck that exist
S. Fix failures caused by Phase 20.2
T. Update docs/.env.example
U. Produce final verification report
```

อย่าหยุดที่การสร้างไฟล์ skeleton

อย่าจบด้วย TODO ที่เป็น core requirement

อย่าลบของเดิมเพื่อให้ test ผ่าน

อย่าแก้ unrelated failures แบบกว้างโดยไม่มีเหตุผล

ถ้าพบ pre-existing failure ให้แยกใน final report

---

# 196. Final Verification Commands

Codex ต้อง discover commands จริงจาก repo แล้วรันตามที่เหมาะสม เช่น:

```text
backend tests
frontend tests
unit tests
integration tests
lint
typecheck
build
migration validation
```

**ห้าม copy command ตัวอย่างโดยไม่ตรวจ package/stack จริง**

---

# 197. Final Verification Report Template

```md
# Phase 20.2 Final Verification Report

## Status
PASS / PARTIAL / BLOCKED / FAIL

## Repository
- Base branch:
- Start commit:
- End commit:
- Working tree:

## Implemented
- ...

## Architecture
- ...

## Database/Migrations
- ...

## API
- ...

## MCP
- ...

## UI
- ...

## Security
- ...

## Tests Executed
| Check | Command | Result |
|---|---|---|
| Unit | ... | PASS/FAIL/NOT_RUN |
| Integration | ... | ... |
| Lint | ... | ... |
| Typecheck | ... | ... |
| Build | ... | ... |

## Known Limitations
- ...

## Pre-existing Issues
- ...

## Manual Configuration
- ...

## Rollback / Recovery
- ...

## Final Acceptance
- [ ] ...
```

---

# 198. Phase 20.3 Preparation — DO NOT IMPLEMENT

หลัง Phase 20.2 เสถียร Phase ถัดไปสามารถเป็น:

```text
Phase 20.3 — Pao Autonomous Engineering Council
×
Multi-Agent Parallel Worktree Execution
```

แนวคิด:

```text
Spec-Driven Cycle
 ↓
Task DAG
 ↓
Parallel isolated worktrees
 ↓
Specialized coding agents
 ↓
Independent reviewer agents
 ↓
Automated merge readiness
 ↓
Human approval for critical changes
```

แต่ **ห้าม implement Phase 20.3 ในงานนี้**

Phase 20.2 ต้องเน้น foundation ให้เสถียรก่อน

---

# 199. Completion Criteria

Codex ห้ามประกาศว่า Phase 20.2 เสร็จจนกว่าอย่างน้อย:

```text
[ ] application starts/builds according to repo convention
[ ] migrations valid
[ ] core state machine tests pass
[ ] artifact/version tests pass
[ ] task DAG tests pass
[ ] gate tests pass
[ ] Git safety tests pass
[ ] lock/recovery tests pass
[ ] verification tests pass
[ ] reviewer mock tests pass
[ ] approval tests pass
[ ] convergence tests pass
[ ] API/MCP integration tested where applicable
[ ] docs updated
[ ] final report written
```

ถ้ามีข้อใดทำไม่ได้ ให้ระบุ `BLOCKED/NOT_RUN` พร้อมเหตุผล

---

# 200. Final Command to Codex

```text
Implement Phase 20.2 now in the existing Pao-hubPro repository.

Do not create a new repository.
Do not replace Phase 19, Phase 20, or Phase 20.1.
Inspect the current codebase first and reuse its architecture.
Protect all existing user work and uncommitted changes.
Build the Spec-Driven AI SDLC Orchestrator as a persistent, auditable, recoverable, policy-gated production subsystem.

The result must support:
Idea → Specify → Clarify → Plan → Tasks → Analyze → Checklist → Implement → Verify → Review → Converge.

Use deterministic tests and security checks as mandatory evidence.
AI reviewers supplement verification; they do not replace it.
High-risk operations require policy enforcement and human approval.
Every important action must be traceable through cycle state, artifacts, evidence, gates, reviews, approvals, and audit logs.

Run the repository's real tests/build/lint/typecheck commands that exist.
Fix Phase-20.2-related failures.
Document pre-existing failures separately.
Finish only after producing the Phase 20.2 Final Verification Report.
```

---

# End of Phase 20.2 Specification

**Phase 20.2 — Pao AI Generation Studio × Spec-Driven AI SDLC Orchestrator**

เป้าหมายสูงสุดของ Phase นี้คือทำให้ **Pao-hubPro เปลี่ยนจาก “AI Coding Assistant Hub” ไปเป็น “AI Software Engineering Operating System”** ที่ไม่ได้เก่งแค่สร้างโค้ด แต่สามารถแปลง Idea ให้เป็น Requirement, Plan, Task, Implementation, Verification และ Production-ready decision ได้อย่างเป็นระบบ ตรวจสอบย้อนหลังได้ หยุดได้ Resume ได้ และไม่ข้าม Quality Gate ที่สำคัญ
