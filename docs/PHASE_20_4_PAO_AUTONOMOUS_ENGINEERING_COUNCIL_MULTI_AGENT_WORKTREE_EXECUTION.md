# Phase 20.4 — Pao Autonomous Engineering Council × Multi-Agent Parallel Worktree Execution

> **Project:** Pao-hubPro  
> **Phase:** 20.4  
> **Status:** Implementation Specification / Codex One-Shot Build Prompt  
> **Depends on:**  
> - Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator  
> - Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router  
> - Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler  
> - Phase 20.2 — Pao AI Generation Studio × Spec-Driven AI SDLC Orchestrator  
> - Phase 20.3 — Pao Desktop Vision Control MCP × Local Realtime Agent × Application Skill Engine  
>
> **Primary Goal:** ยกระดับ Phase 20.2 จาก SDLC Orchestrator แบบ sequential/single-executor ให้กลายเป็น **Autonomous Engineering Council** ที่สามารถอ่าน Task DAG, แยกงานที่ทำคู่ขนานได้, สร้าง isolated Git worktrees, มอบหมายงานให้ specialized implementation agents, ตรวจงานด้วย independent reviewer agents, รัน deterministic verification, คำนวณ merge readiness, รวมงานผ่าน integration lane อย่างปลอดภัย และขอ Human Approval ในจุดเสี่ยง
>
> **Core Principle:** Parallelism ต้องเพิ่ม throughput โดย **ไม่แลกกับ Git safety, test evidence, reviewer independence, reproducibility หรือการปกป้องงานที่ผู้ใช้กำลังทำอยู่**
>
> **Important:** Phase นี้ต้องต่อยอด repository `Pao-hubPro` เดิมเท่านั้น ห้ามสร้าง repository ใหม่ ห้ามแทน Phase 20.2 และห้ามให้ agent หลายตัวเขียนทับ working tree เดียวกันโดยไม่มี isolation/locking

---

# 0. Roadmap Position

Roadmap ปัจจุบัน:

```text
Phase 20.2
Spec-Driven AI SDLC Orchestrator
        ↓
Phase 20.3
Desktop Vision Control MCP
        ↓
Phase 20.4
Autonomous Engineering Council
× Multi-Agent Parallel Worktree Execution
        ↓
Phase 20.5
Living Knowledge Brain
× LLM Wiki
× Persistent Knowledge Graph
```

Phase 20.4 เป็น execution multiplier ของ Phase 20.2

```text
Phase 20.2
รู้ว่า "ต้องทำอะไร"

Phase 20.4
รู้ว่า "งานไหนทำพร้อมกันได้"
"ใครควรทำ"
"ใครควร review"
"รวมอย่างไรไม่พัง"
```

---

# 1. Mission สำหรับ Codex

คุณคือ:

- Principal Software Architect
- Distributed Agent Systems Engineer
- Git / Source Control Engineer
- CI/CD Architect
- DevSecOps Engineer
- Staff Backend Engineer
- QA Architect
- AI Agent Orchestration Engineer
- SRE
- Security Engineer

กำลังทำงานใน repository:

```text
Pao-hubPro
```

ให้ implement:

```text
Phase 20.4
Pao Autonomous Engineering Council
×
Multi-Agent Parallel Worktree Execution
```

แบบ production-grade

---

# 2. What Phase 20.4 Must Change

จาก:

```text
Spec
 ↓
Plan
 ↓
Task A
 ↓
Implement
 ↓
Review
 ↓
Task B
 ↓
Implement
 ↓
Review
```

เป็น:

```text
Spec
 ↓
Task DAG
 ↓
Parallelization Planner
 ↓
┌──────────────────────────────────────┐
│ Worktree A → Backend Agent           │
│ Worktree B → Frontend Agent          │
│ Worktree C → Test Agent              │
│ Worktree D → Docs/Migration Agent    │
└──────────────────────────────────────┘
 ↓
Independent Reviewers
 ↓
Deterministic Verification
 ↓
Conflict / Integration Analysis
 ↓
Merge Queue
 ↓
Integration Worktree
 ↓
Full Verification
 ↓
Human Approval when required
 ↓
Merge Ready / Converge
```

---

# 3. Non-Negotiable Principles

1. ห้าม agent หลายตัวแก้ working tree เดียวกันพร้อมกัน
2. ห้ามแตะ uncommitted user work โดยไม่ explicit handling
3. ห้าม `git reset --hard` เพื่อแก้ปัญหาอัตโนมัติ
4. ห้าม `git clean -fd` บน user worktree
5. ห้าม force push
6. ห้าม push remote โดย default
7. ห้าม merge เข้า protected branch อัตโนมัติถ้า policy ไม่อนุญาต
8. ทุก implementation agent ต้องอยู่ใน isolated execution context
9. reviewer สำคัญต้อง independent จาก implementation agent
10. deterministic test/lint/typecheck/security checks มาก่อน AI approval
11. merge readiness ต้องมี evidence
12. failing task ห้ามบล็อกทุก task ถ้า DAG ระบุว่า independent
13. แต่ conflict-prone task ต้อง serialize
14. resource usage ต้องมี budget/cap
15. agent loop ต้อง cancel ได้
16. agent run ต้อง timeout ได้
17. worktree orphan ต้อง recover/cleanup ได้
18. branch/worktree naming ต้อง deterministic
19. ทุก task ต้อง trace กลับ requirement/acceptance criteria ได้
20. ทุก changeset ต้อง trace กลับ agent run ได้
21. ห้ามให้ reviewer แก้ diff โดยเงียบแล้ว approve ตัวเอง
22. reviewer สามารถเสนอ patch แต่ต้องสร้าง separate revision/run
23. merge conflict ห้าม resolve แบบเดาสุ่ม
24. migration/schema task ต้องมี stronger serialization policy
25. dependency lockfile task ต้องตรวจ collision
26. security/auth task ต้อง review เพิ่ม
27. production/deploy change ต้อง Human Approval ตาม Phase 20.2
28. secrets ห้ามเข้าระบบ prompt/log/diff
29. external agent provider failure ต้อง degrade gracefully
30. Phase 20.4 ต้อง disable ได้โดยไม่ทำให้ Phase 20.2 พัง

---

# 4. Relationship with Phase 20.2

Phase 20.2 ยังคงเป็น canonical owner ของ:

```text
Cycle
Spec
Clarification
Plan
Requirement
Acceptance Criteria
Task DAG
Quality Gates
Approval
Convergence
```

Phase 20.4 เพิ่ม:

```text
Parallelization Plan
Agent Assignment
Worktree Lifecycle
Task Lease
Execution Pool
Review Pool
Conflict Forecast
Merge Queue
Integration Lane
Merge Readiness
Council Decision
```

ห้าม duplicate Spec/Plan engine

---

# 5. Relationship with Phase 20.3

Phase 20.3 สามารถทำหน้าที่:

```text
Desktop UI Smoke Test Executor
Visual Verification Executor
Local App Launch/Control
Evidence Capture
```

Phase 20.4 สามารถมอบหมาย verification job บางชนิดให้ Phase 20.3

แต่ Phase 20.4 ห้ามใช้ desktop automation แทน deterministic test ถ้ามี test API/CLI ที่ดีกว่า

---

# 6. Target Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                               Pao-hubPro                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                    Phase 20.2 SDLC Orchestrator                         │
│                               │                                          │
│                               ▼                                          │
│                           Task DAG                                       │
│                               │                                          │
│                               ▼                                          │
│                Phase 20.4 Engineering Council                            │
│                               │                                          │
│      ┌────────────────────────┼─────────────────────────┐                │
│      ▼                        ▼                         ▼                │
│ Parallelization         Assignment Engine         Resource Guard        │
│ Planner                       │                         │                │
│      └────────────────────────┼─────────────────────────┘                │
│                               ▼                                          │
│                     Worktree Coordinator                                 │
│                               │                                          │
│       ┌───────────────────────┼───────────────────────┐                 │
│       ▼                       ▼                       ▼                 │
│  Worktree A              Worktree B              Worktree C             │
│ Backend Agent            Frontend Agent           Test Agent             │
│       │                       │                       │                 │
│       └───────────────────────┼───────────────────────┘                 │
│                               ▼                                          │
│                     ChangeSet Registry                                   │
│                               │                                          │
│                               ▼                                          │
│                    Independent Reviewer Pool                             │
│                               │                                          │
│                               ▼                                          │
│                    Deterministic Verification                            │
│                               │                                          │
│                               ▼                                          │
│                       Conflict Analyzer                                  │
│                               │                                          │
│                               ▼                                          │
│                          Merge Queue                                     │
│                               │                                          │
│                               ▼                                          │
│                     Integration Worktree                                 │
│                               │                                          │
│                               ▼                                          │
│                     Full Repository Tests                                │
│                               │                                          │
│                               ▼                                          │
│                     Council / Human Gate                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# 7. Main Subsystems

```text
engineering_council/
  planner/
  scheduler/
  assignments/
  agents/
  providers/
  worktrees/
  leases/
  changesets/
  reviewers/
  verification/
  conflicts/
  merge_queue/
  integration/
  resources/
  policy/
  recovery/
  telemetry/
  persistence/
  api/
  mcp/
```

ปรับตาม codebase จริง

---

# 8. Core Domain Objects

ต้องมี logical models:

```text
CouncilRun
ParallelizationPlan
TaskExecutionSlot
AgentProfile
AgentAssignment
AgentRun
WorktreeRecord
TaskLease
ChangeSet
VerificationBundle
ReviewAssignment
ReviewResult
ConflictForecast
MergeCandidate
MergeQueueEntry
IntegrationRun
CouncilDecision
ResourceBudget
```

---

# 9. CouncilRun

Fields:

```text
council_run_id
cycle_id
status
created_at
started_at
ended_at
base_branch
base_commit_sha
parallelism_limit
policy_profile
budget_profile
integration_mode
current_stage
failure_reason
```

States:

```text
PLANNING
SCHEDULING
EXECUTING
REVIEWING
VERIFYING
INTEGRATING
WAITING_APPROVAL
MERGE_READY
COMPLETED
FAILED
CANCELLED
RECOVERY_REQUIRED
```

---

# 10. ParallelizationPlan

```text
plan_id
cycle_id
task_ids
parallel_groups
serialized_groups
conflict_risks
resource_estimate
generated_at
generator
version
```

ต้อง deterministic/reproducible เท่าที่เป็นไปได้

---

# 11. Task Classification

Classify task ตามประเภท:

```text
BACKEND
FRONTEND
DATABASE
MIGRATION
TEST
SECURITY
MCP
DESKTOP
DOCS
INFRA
CONFIG
REFACTOR
RESEARCH
```

ใช้เพื่อ:

```text
agent selection
reviewer selection
conflict policy
test policy
resource policy
```

---

# 12. Parallelization Rules

Task ทำพร้อมกันได้เมื่อ:

```text
dependencies satisfied
no explicit serialization edge
low predicted file overlap
no shared migration ordering
no shared generated artifact lock
no shared global config lock
resource budget allows
```

---

# 13. Serialization Rules

ต้อง serialize อย่างน้อยเมื่อมี:

```text
same migration chain
same schema file
same lockfile
same generated client output
same central router/index file with high collision
same release manifest
same version file
explicit task dependency
```

Policy configurable

---

# 14. Conflict Forecast

ก่อน launch agent ให้คำนวณ:

```text
likely file paths
module ownership
task tags
historical touched paths
dependency manifests
generated outputs
```

Output:

```text
LOW
MEDIUM
HIGH
BLOCKING
```

---

# 15. File Intent Manifest

ก่อน implementation agent เริ่ม ให้สร้าง optional manifest:

```text
expected_read_paths
expected_write_paths
possible_generated_paths
forbidden_paths
```

ไม่ต้องแม่น 100%

ใช้สำหรับ conflict prediction/policy

---

# 16. Task Lease

ก่อน execute:

```text
acquire task lease
```

Fields:

```text
lease_id
task_id
agent_run_id
worktree_id
owner
acquired_at
expires_at
heartbeat_at
status
```

ป้องกัน task เดียวถูกทำซ้ำ

---

# 17. Lease Expiry

ถ้า agent หาย:

```text
lease expires
```

แต่ห้าม launch replacement ทันทีถ้ายังไม่ตรวจ worktree state

ใช้:

```text
ORPHAN_INSPECTION
```

ก่อน retry

---

# 18. Agent Profiles

รองรับ profile เช่น:

```text
backend_implementer
frontend_implementer
database_engineer
test_engineer
security_reviewer
architecture_reviewer
api_reviewer
mcp_reviewer
integration_reviewer
docs_engineer
```

Profile ไม่ผูก provider

---

# 19. Agent Provider Adapters

รองรับ provider abstraction:

```text
Codex
OpenAI-compatible
Claude-compatible
Local Model
Future Provider
```

ระบบต้องไม่ hardcode provider เดียว

---

# 20. Agent Capability Metadata

```text
profile_id
provider_id
model
roles
languages
frameworks
max_context
supports_tools
supports_patch
supports_shell
supports_tests
cost_class
speed_class
enabled
```

---

# 21. Assignment Engine

เลือก agent จาก:

```text
task type
risk
required skills
provider health
budget
current concurrency
historical success
review independence constraints
```

---

# 22. Reviewer Independence

อย่างน้อยงาน HIGH/CRITICAL:

```text
implementer identity != sole reviewer identity
```

และถ้า provider เดียวกัน:

```text
separate run
separate context
prefer separate model/profile when available
```

---

# 23. Agent Run Contract

Implementation agent ต้องรับ:

```text
task spec
acceptance criteria
relevant architecture context
allowed scope
worktree path
base SHA
commands available
security policy
expected final report
```

ไม่ส่ง repository ทั้งหมดโดยไม่จำเป็นถ้า retrieval/context builder มีอยู่

---

# 24. Agent Output Contract

ต้องส่ง:

```text
summary
files changed
commands run
tests run
test results
known limitations
assumptions
risks
requested follow-ups
commit SHA or changeset reference
```

---

# 25. Worktree Principle

ทุก parallel implementation task ใช้:

```text
git worktree
```

หรือ equivalent isolated checkout

ห้ามแชร์ active worktree

---

# 26. User Working Tree Protection

ก่อนสร้าง council run:

```text
inspect git status
```

ถ้า user worktree มี uncommitted changes:

```text
DO NOT RESET
DO NOT STASH AUTOMATICALLY BY DEFAULT
DO NOT CLEAN
```

สามารถ:

```text
create new worktree from selected committed base
```

โดยไม่แตะ user changes

---

# 27. Base Commit Pinning

CouncilRun ต้อง pin:

```text
base_commit_sha
```

ทุก worktree group สร้างจาก base ที่กำหนด

ถ้า base เปลี่ยนระหว่าง run:

```text
existing runs remain pinned
new plan requires explicit rebase/replan policy
```

---

# 28. Worktree Naming

ตัวอย่าง:

```text
.pao/worktrees/
  cycle-<cycle-id>/
    task-<task-id>-<short-run-id>/
```

หรือ external worktree root

ต้อง sanitize path

---

# 29. Branch Naming

ตัวอย่าง:

```text
pao/cycle-123/task-456/backend-auth
```

หลีกเลี่ยงชื่อยาวเกิน

---

# 30. WorktreeRecord

```text
worktree_id
cycle_id
task_id
path
branch
base_sha
head_sha
status
created_at
last_seen_at
cleanup_status
```

States:

```text
CREATING
READY
ACTIVE
DIRTY
COMMITTED
REVIEWING
INTEGRATED
FAILED
ORPHANED
CLEANUP_PENDING
CLEANED
```

---

# 31. Worktree Creation Safety

ตรวจ:

```text
path does not exist or is owned by orchestrator
branch collision
base sha exists
disk capacity
repo lock
Git version/capability
```

---

# 32. Worktree Locking

ต้องมี lock สำหรับ:

```text
worktree create/remove
branch create/delete
integration branch
merge queue
migration sequence
release files
```

---

# 33. No Automatic Destructive Git

ห้าม automatic:

```text
git reset --hard
git clean -fd
git checkout -- .
git restore . บน user tree
git push --force
git branch -D unknown branch
```

---

# 34. Agent Commit Policy

Implementation agent สามารถ commit ใน isolated branch ตาม policy

Commit message:

```text
pao(phase20.4): <task-id> <summary>
```

หรือ repo convention

ทุก commit map กับ:

```text
task_id
agent_run_id
worktree_id
```

---

# 35. ChangeSet

```text
changeset_id
task_id
worktree_id
base_sha
head_sha
diff_hash
files_changed
insertions
deletions
generated_files
migration_files
risk
created_at
```

---

# 36. Diff Safety Scan

ก่อน review:

```text
secret scan
unexpected path scan
binary file scan
large file scan
generated artifact check
forbidden file check
```

---

# 37. Unexpected Scope Change

ถ้า agent แก้ file นอก expected scope:

```text
flag SCOPE_DRIFT
```

ไม่ fail เสมอ แต่ reviewer ต้องเห็น

---

# 38. Command Execution Safety

Reuse Phase 20.2 safe runner

ต้องมี:

```text
command allow policy
timeout
output limit
cancellation
working directory confinement
environment sanitization
secret masking
```

---

# 39. No Shell-by-Text Protocol

Agent provider ห้ามส่ง arbitrary command ผ่าน unvalidated remote control channel

ต้องผ่าน approved execution interface

---

# 40. Task Execution Slot

```text
slot_id
task_id
agent_id
worktree_id
status
started_at
heartbeat_at
resource_class
```

---

# 41. Parallelism Limit

Config:

```env
PAO_COUNCIL_MAX_PARALLEL_AGENTS=4
PAO_COUNCIL_MAX_PARALLEL_HIGH_RISK=1
```

ตัวอย่าง

ต้อง configurable

---

# 42. Resource Budget

จำกัด:

```text
CPU
RAM
disk
process count
provider tokens
provider cost
wall-clock
```

---

# 43. Budget Modes

```text
ECONOMY
BALANCED
FAST
CUSTOM
```

FAST ไม่ได้แปลว่า bypass quality gate

---

# 44. Agent Heartbeat

```text
agent_run_id
status
current_stage
last_command
last_activity
worktree_head
timestamp
```

ห้าม log secret command args

---

# 45. Agent Timeouts

แยก:

```text
startup timeout
idle timeout
task wall timeout
command timeout
review timeout
```

---

# 46. Cancellation

Cancel council run:

```text
stop scheduling new tasks
cancel agents when safe
release leases
preserve worktrees for inspection
mark integration blocked
```

ห้ามลบทิ้งทันที

---

# 47. Partial Failure

ถ้า Task B fail แต่ A/C independent:

```text
A/C ทำต่อได้
```

แต่ downstream ของ B:

```text
BLOCKED_BY_DEPENDENCY
```

---

# 48. Retry

Retry implementation ต้องเป็น new:

```text
AgentRun
```

อาจ reuse worktree หรือสร้าง new revision ตาม policy

ต้องไม่ overwrite audit history

---

# 49. Revision Model

```text
Task
 ├─ Run 1 → ChangeSet 1 → Review FAIL
 └─ Run 2 → ChangeSet 2 → Review PASS
```

เก็บทั้งคู่

---

# 50. Reviewer Pool

Reviewer roles:

```text
Code Quality
Architecture
Security
Tests
Database
Frontend UX
MCP Contract
Integration
```

เลือกตาม task risk/type

---

# 51. Review Assignment

```text
review_assignment_id
changeset_id
reviewer_profile
reviewer_agent_run_id
required
status
created_at
```

---

# 52. Review Result

```text
decision
severity_counts
findings
required_fixes
suggestions
evidence
reviewer
reviewed_diff_hash
```

Decision:

```text
PASS
PASS_WITH_NOTES
CHANGES_REQUIRED
BLOCK
UNAVAILABLE
```

---

# 53. Stale Review Protection

Review ต้อง bind กับ:

```text
diff_hash
head_sha
```

ถ้ามี commit ใหม่:

```text
previous review = STALE
```

---

# 54. Deterministic Verification Bundle

รวม:

```text
unit tests
integration tests
lint
typecheck
build
security scan
migration test
contract test
targeted task tests
```

ตาม repo/Task policy

---

# 55. Verification Scope

มี 3 ระดับ:

```text
TASK_LOCAL
CHANGESET
INTEGRATION
```

---

# 56. Task-Local Verification

รันใน worktree task

เร็วและ focused

---

# 57. ChangeSet Verification

รัน broader suite ก่อนเข้า merge queue

---

# 58. Integration Verification

หลังรวมหลาย changeset ใน integration worktree

ต้องรัน full required suite ตาม Phase 20.2 gate

---

# 59. Test Evidence Rule

ห้าม parse คำว่า:

```text
"looks good"
```

เป็น test PASS

ต้องมี:

```text
command
exit code
timestamp
output summary
artifact/log ref
commit sha
```

---

# 60. Flaky Test Handling

สถานะ:

```text
PASS
FAIL
FLAKY_SUSPECTED
NOT_RUN
BLOCKED
```

ห้าม rerun จนผ่านแล้วซ่อน failure แรก

เก็บ history

---

# 61. Conflict Analyzer

ตรวจ conflict 2 แบบ:

```text
Textual Git Conflict
Semantic Conflict
```

---

# 62. Textual Conflict

เช่น:

```text
สอง changeset แก้บรรทัดเดียวกัน
```

ตรวจล่วงหน้าได้จาก merge-tree/diff analysis ถ้า Git รองรับ

---

# 63. Semantic Conflict

เช่น:

```text
Backend เปลี่ยน API response
Frontend ยังใช้ schema เก่า
```

ต้องอาศัย:

```text
contract tests
typecheck
integration tests
review
```

---

# 64. Merge Candidate

```text
merge_candidate_id
changeset_ids
target_base_sha
status
conflict_status
verification_status
review_status
approval_status
score
```

---

# 65. Merge Readiness

PASS เมื่อ:

```text
required task tests pass
required reviews pass
no blocking findings
no stale review
no unresolved conflict
dependency tasks satisfied
security gate passes
approval passes if required
```

---

# 66. Merge Readiness Score

สามารถมี score เพื่อ UI

แต่ final decision ต้อง rule-based

ห้าม score สูง override blocking gate

---

# 67. Merge Queue

Queue state:

```text
PENDING
READY
INTEGRATING
VERIFYING
WAITING_APPROVAL
MERGE_READY
FAILED
SUPERSEDED
```

---

# 68. Integration Worktree

ห้าม integrate ใน user's current worktree

สร้าง dedicated:

```text
integration worktree
```

pin base

---

# 69. Integration Strategy

Default:

```text
apply/merge candidates in dependency-safe order
```

support:

```text
merge commit
cherry-pick
rebase-like internal preparation
```

เลือกตาม repo policy

ห้าม rewrite published history โดย default

---

# 70. Integration Order

คำนวณจาก:

```text
Task DAG
migration order
dependency files
conflict risk
change type
```

---

# 71. Integration Conflict

ถ้า conflict:

```text
stop affected lane
create ConflictCase
preserve evidence
```

ห้าม auto choose ours/theirs แบบ blind

---

# 72. Conflict Resolution Options

```text
specialized resolver agent
original implementer revision
human resolution
re-plan task
```

ทุก resolution ต้อง re-run review/verification

---

# 73. ConflictCase

```text
conflict_id
candidate_ids
files
base_sha
conflict_type
status
resolver
resolution_changeset
```

---

# 74. Merge Commit Safety

ถ้า final merge เข้า target branch:

```text
check branch protection policy
check current head
check target not moved unexpectedly
```

ถ้า target moved:

```text
REBASE_OR_REINTEGRATE_REQUIRED
```

---

# 75. No Silent Main Merge

Default:

```text
merge-ready != merged
```

Human/operator หรือ existing policy เป็นผู้ trigger final merge ตาม risk

---

# 76. Protected Branch Policy

เช่น:

```text
main
master
production
release/*
```

ต้อง stricter

---

# 77. Remote Push Policy

Default:

```text
push_enabled = false
```

ถ้าเปิด:

```text
explicit config
RBAC
approval
audit
remote allowlist
```

---

# 78. Pull Request Integration

ถ้า repo ใช้ PR workflow:

Phase 20.4 ควรสามารถสร้าง merge-ready metadata/artifact

แต่ห้าม require GitHub-specific integration เพื่อ core completion

---

# 79. Council Decision

```text
APPROVE_MERGE_READY
REQUEST_CHANGES
BLOCK_SECURITY
BLOCK_TEST
BLOCK_CONFLICT
WAIT_HUMAN
CANCEL
```

---

# 80. Council Quorum

ตาม risk:

LOW:

```text
deterministic checks + 1 reviewer
```

MEDIUM:

```text
deterministic checks + relevant reviewer
```

HIGH:

```text
2 independent review roles + stronger tests
```

CRITICAL:

```text
required reviewers + human approval
```

policy configurable

---

# 81. Specialized Agent — Backend

Focus:

```text
API
business logic
services
database access
validation
tests
```

---

# 82. Specialized Agent — Frontend

Focus:

```text
UI
state
forms
API integration
accessibility
frontend tests
```

---

# 83. Specialized Agent — Database

Focus:

```text
schema
migration
indexes
rollback
data compatibility
```

Database agent task usually higher serialization risk

---

# 84. Specialized Agent — Test Engineer

ทำได้:

```text
add regression tests
improve test harness
reproduce bug
write fixtures
```

ห้ามแก้ production behavior เพียงเพื่อให้ test ผ่านโดยไม่แจ้ง

---

# 85. Specialized Agent — Security Reviewer

ตรวจ:

```text
auth
authorization
secrets
input validation
path traversal
command execution
network exposure
dangerous defaults
```

---

# 86. Specialized Agent — Architecture Reviewer

ตรวจ:

```text
duplicate subsystem
dependency direction
abstraction leak
state ownership
scalability
backward compatibility
```

---

# 87. Specialized Agent — MCP Reviewer

ตรวจ:

```text
tool schema
permissions
side effects
idempotency
error contract
tool exposure
```

---

# 88. Specialized Agent — Integration Reviewer

ดู multi-changeset behavior

---

# 89. Agent Prompt Isolation

แต่ละ agent รับเฉพาะ context ที่จำเป็น

ห้าม feed secret/env dump

---

# 90. Context Builder

Context sources:

```text
task spec
acceptance criteria
relevant code
architecture docs
dependency interfaces
previous findings
```

---

# 91. Context Freshness

context ต้อง map กับ:

```text
base_sha
worktree_head_sha
```

ถ้า stale ต้อง rebuild

---

# 92. Provider Outage

ถ้า provider unavailable:

```text
assignment engine picks compatible fallback
```

ถ้าไม่มี:

```text
BLOCKED_PROVIDER
```

ไม่ bypass reviewer requirement

---

# 93. Provider Cost Tracking

เก็บ:

```text
tokens
estimated cost
duration
provider/model
task
role
```

ถ้า provider ไม่มี usage metric ให้ mark unknown

---

# 94. Resource Scheduler

คุมทั้ง:

```text
agent concurrency
test concurrency
CPU-heavy jobs
integration lanes
desktop test lanes
```

---

# 95. Desktop Test Lane

Phase 20.3 อาจ require interactive desktop

จำกัด:

```text
one active exclusive desktop control lane per machine/session
```

เว้นแต่ architecture รองรับ isolation จริง

---

# 96. Database Test Lane

migration tests อาจต้อง isolated DB/schema

ห้าม agents แชร์ test database state แบบไม่ isolate

---

# 97. Port Allocation

parallel test servers ต้องมี:

```text
dynamic port allocation
```

ป้องกัน collision

---

# 98. Temp Directory Isolation

แต่ละ AgentRun มี temp dir ของตัวเอง

---

# 99. Environment Isolation

ไม่แชร์ mutable env state

แต่ละ run ได้ sanitized env

---

# 100. Secret Injection

ถ้าจำเป็น:

```text
least privilege
scoped secret
not logged
not persisted in prompt
```



---

# 101. Security Boundary

Agent can:

```text
read allowed repo files
edit isolated worktree
run approved repo commands
write test artifacts
```

Agent cannot by default:

```text
push remote
change global git config
read arbitrary home secrets
modify user working tree
access unrelated repositories
deploy production
change credentials
```

---

# 102. Git Configuration Isolation

ใช้ local/repo scoped config เท่าที่จำเป็น

ห้ามเปลี่ยน:

```text
global user config
credential helpers
remote URLs
hooks
```

โดยอัตโนมัติ

---

# 103. Git Hooks

ต้อง respect existing hooks

ถ้า hook ล้มเหลว:

```text
report actual failure
```

ห้าม bypass ด้วย `--no-verify` โดย default

---

# 104. Submodules

ถ้า repo มี submodule:

```text
detect
document policy
avoid accidental recursive modification
```

---

# 105. Monorepo Awareness

Task planner ต้องรู้ package/module boundaries

ใช้:

```text
workspace manifests
package graph
build graph
ownership map
```

ถ้ามี

---

# 106. Generated Files

ถ้า task แก้ source ที่ generate files:

```text
run canonical generator
record command
verify generated diff
```

---

# 107. Dependency Lockfiles

Task ที่แก้ dependencies ต้อง:

```text
serialize lockfile mutation where needed
run package manager canonical command
review transitive changes
security scan if repo has it
```

---

# 108. Migration Safety

Migration tasks:

```text
ordered
reviewed
rollback-aware
tested
```

ห้าม parallelize migration sequence ที่ order-dependent

---

# 109. API Contract Change

ถ้า backend API changed:

```text
detect consumers
generate/update contract tests
block merge if known consumers incompatible
```

---

# 110. Feature Flag Integration

งานใหญ่ควรใช้ feature flag ถ้า repo convention มี

แต่ห้ามสร้าง flag proliferation โดยไม่จำเป็น

---

# 111. Build Cache

สามารถ share read-only cache ตาม toolchain

แต่ห้าม share mutable output directories ถ้าเสี่ยง collision

---

# 112. Incremental Verification

หลัง agent แก้ไฟล์:

```text
run targeted tests first
```

ก่อน full suite

ช่วยลด cost/latency

---

# 113. Verification Policy Matrix

ตัวอย่าง:

```text
BACKEND
  unit + integration + typecheck + lint

FRONTEND
  unit + typecheck + build + targeted UI

DATABASE
  migration test + integration + rollback where possible

SECURITY
  targeted security checks + full relevant tests

MCP
  schema + permission + integration
```

configurable

---

# 114. Test Selection Engine

ใช้:

```text
changed files
dependency graph
task type
historical mapping
repo scripts
```

แต่ high-risk ไม่ควร rely only on impacted tests

---

# 115. Baseline Failure Awareness

ก่อน Phase 20.4 run ต้องรู้ baseline failures จาก Phase 20.2 ถ้ามี

ใหม่ vs เก่า:

```text
PRE_EXISTING
INTRODUCED
UNKNOWN
```

---

# 116. Regression Ownership

ถ้า integration test fail หลังรวม A+B:

```text
identify likely responsible changesets
```

แต่ห้ามกล่าวโทษจาก heuristic อย่างเดียว

สร้าง investigation task

---

# 117. Investigation Task

สำหรับ failure cross-cutting:

```text
type = INVESTIGATION
```

read-only ก่อน

---

# 118. Council Discussion Artifact

สามารถเก็บ structured deliberation summary:

```text
issue
evidence
options
decision
rationale
dissent
```

ไม่ต้องเก็บ hidden chain-of-thought

เก็บเฉพาะ concise decision rationale

---

# 119. No Hidden Chain-of-Thought Storage

ห้าม persist internal reasoning token stream

เก็บ:

```text
decision
evidence
summary
findings
```

---

# 120. Review Finding Schema

```text
finding_id
severity
category
file
line
title
description
evidence
suggested_fix
blocking
```

Severity:

```text
INFO
LOW
MEDIUM
HIGH
CRITICAL
```

---

# 121. Finding Deduplication

หลาย reviewer พบเรื่องเดียวกัน:

```text
group by location/category/fingerprint
```

แต่ preserve reviewer sources

---

# 122. Finding Resolution

```text
OPEN
ACCEPTED
FIXED
WONT_FIX_APPROVED
FALSE_POSITIVE
SUPERSEDED
```

HIGH/CRITICAL `WONT_FIX` ต้อง stronger approval

---

# 123. Reviewer Feedback Loop

CHANGES_REQUIRED:

```text
create revision task
 ↓
implement
 ↓
new changeset
 ↓
reverify
 ↓
re-review
```

---

# 124. Review Budget

Config:

```env
PAO_COUNCIL_MAX_REVIEW_ROUNDS=3
```

ถ้าเกิน:

```text
ESCALATE_HUMAN
```

ไม่ loop ไม่รู้จบ

---

# 125. Merge Queue Fairness

อย่าให้ task ใหญ่ block taskเล็ก independent ตลอด

แต่ dependency priority มาก่อน fairness

---

# 126. Priority

Task priority:

```text
CRITICAL
HIGH
NORMAL
LOW
```

แต่ priority ไม่ override dependency/safety

---

# 127. Scheduler Policy

พิจารณา:

```text
ready tasks
priority
conflict risk
agent availability
budget
resource lanes
critical path
```

---

# 128. Critical Path Awareness

คำนวณ approximate critical path จาก Task DAG

ช่วยเลือกงานที่ควรเริ่มก่อน

---

# 129. Work Stealing

Agent pool อาจรับ task ใหม่หลังจบ

แต่ห้ามเปลี่ยน role ไปทำ task ที่ capability ไม่ตรง

---

# 130. Parallel Group Example

```text
Group A:
  Backend API
  Frontend layout
  Docs

Group B after API:
  Frontend integration
  Integration tests

Serialized:
  Migration
  Lockfile update
```

---

# 131. Council State Machine

```text
CREATED
 ↓
PLANNING
 ↓
SCHEDULED
 ↓
EXECUTING
 ↓
REVIEWING
 ↓
VERIFYING
 ↓
INTEGRATING
 ↓
FULL_VERIFY
 ↓
WAITING_APPROVAL?
 ↓
MERGE_READY
 ↓
COMPLETED
```

Failure branches:

```text
BLOCKED
FAILED
RECOVERY_REQUIRED
CANCELLED
```

---

# 132. Recovery on Restart

หลัง Pao-hubPro restart:

```text
load active CouncilRuns
inspect leases
inspect worktrees
inspect agent processes
inspect branch heads
inspect verification state
```

ห้าม re-run agent blindly

---

# 133. Orphan Worktree

ถ้า worktree exists แต่ DB says missing:

```text
quarantine/inspect
```

ห้ามลบทันที

---

# 134. Orphan Branch

branch created by prior run:

```text
detect ownership metadata
```

ถ้า uncertain:

```text
leave untouched
```

---

# 135. Cleanup Policy

หลัง success:

```text
cleanup worktrees only after changes safely integrated/preserved
```

Config retention:

```text
keep failed worktrees
keep last N successful
cleanup after N days
```

---

# 136. Disk Pressure

ถ้า disk ต่ำ:

```text
stop scheduling new worktrees
cleanup eligible caches/worktrees
notify operator
```

ห้ามลบ unknown directory

---

# 137. Council Emergency Stop

ต้องมี:

```text
stop scheduling
cancel safe agent jobs
prevent merge
preserve worktrees
release noncritical leases
```

---

# 138. Human Approval Triggers

อย่างน้อย:

```text
protected branch final merge
production deployment
destructive migration
security boundary change
auth model change
remote exposure
secret/credential change
high-risk conflict resolution
```

reuse Phase 20.2

---

# 139. Approval Staleness

approval bind กับ:

```text
integration head SHA
verification bundle hash
review bundle hash
```

head เปลี่ยน → approval stale

---

# 140. Merge Readiness Artifact

สร้าง:

```text
MERGE_READINESS.md/json
```

logical content:

```text
base sha
integration sha
tasks
changesets
tests
reviews
findings
conflicts
approvals
known limitations
```

---

# 141. Change Provenance

ทุก line diff ไม่ต้อง map agent token-level

แต่ changeset ต้อง map:

```text
task
agent run
commit
review
verification
```

---

# 142. Audit Events

อย่างน้อย:

```text
council.created
council.started
council.cancelled
council.completed

parallel.plan.created
task.assigned
task.lease.acquired
task.lease.expired

worktree.created
worktree.ready
worktree.dirty
worktree.committed
worktree.orphaned
worktree.cleaned

agent.started
agent.heartbeat
agent.completed
agent.failed

changeset.created
changeset.scope_drift

review.assigned
review.completed
review.stale

verification.started
verification.completed

conflict.detected
conflict.resolved

merge_queue.enqueued
integration.started
integration.failed
integration.verified

council.merge_ready
```

---

# 143. Telemetry

Metrics:

```text
active_agents
ready_tasks
blocked_tasks
parallelism
task_duration
agent_success_rate
review_rounds
changeset_conflict_rate
integration_failure_rate
worktree_count
orphan_worktrees
provider_cost
verification_time
critical_path_time
```

---

# 144. Dashboard — Engineering Council

เพิ่มหน้า/section:

```text
Engineering Council
```

---

# 145. Council Dashboard

แสดง:

```text
Cycle
Task DAG
Parallel Groups
Active Agents
Worktrees
Reviews
Verification
Conflicts
Merge Queue
Budget
Timeline
```

---

# 146. DAG View

สี state:

```text
READY
RUNNING
REVIEW
PASS
FAIL
BLOCKED
INTEGRATED
```

---

# 147. Agent Cards

แสดง:

```text
role
task
provider/model
worktree
elapsed
last heartbeat
status
cost
```

ห้ามแสดง secrets/prompt raw โดย default

---

# 148. Worktree View

แสดง:

```text
branch
base sha
head sha
files changed
dirty status
verification
cleanup
```

---

# 149. Review View

แสดง findings grouped by:

```text
severity
file
reviewer role
status
```

---

# 150. Conflict View

แสดง:

```text
candidate A/B
files
type
resolution state
```

---

# 151. Merge Queue UI

ปุ่ม:

```text
Reverify
Reintegrate
Request Approval
Mark Merge Ready
Cancel Candidate
```

ตาม RBAC

---

# 152. MCP Tools

Logical:

```text
council_create_run
council_get_run
council_cancel_run
council_plan_parallelism
council_list_ready_tasks
council_assign_task
council_get_agent_runs
council_get_worktrees
council_get_changesets
council_request_review
council_get_reviews
council_run_verification
council_get_conflicts
council_build_integration
council_get_merge_readiness
```

---

# 153. Dangerous MCP Tools

การ:

```text
final merge
push
delete worktree
delete branch
```

ต้องแยก permissions/approval

---

# 154. REST API

Logical:

```text
POST /api/council/runs
GET  /api/council/runs/:id
POST /api/council/runs/:id/cancel

GET  /api/council/runs/:id/tasks
GET  /api/council/runs/:id/agents
GET  /api/council/runs/:id/worktrees
GET  /api/council/runs/:id/reviews
GET  /api/council/runs/:id/conflicts
GET  /api/council/runs/:id/merge-readiness

POST /api/council/runs/:id/verify
POST /api/council/runs/:id/integrate
```

ปรับตาม repo convention

---

# 155. Realtime Events

```text
council.run.state
council.task.state
council.agent.state
council.review.state
council.verification.state
council.conflict
council.merge_queue
council.approval.required
```

---

# 156. Database Tables

Logical:

```text
council_runs
parallelization_plans
agent_profiles
agent_assignments
agent_runs
worktree_records
task_leases
changesets
review_assignments
review_results
verification_bundles
conflict_cases
merge_candidates
merge_queue_entries
integration_runs
council_decisions
resource_usage
```

reuse existing tables if Phase 20.2 already covers parts

---

# 157. Migration Rules

- additive first
- no destructive migration without need
- foreign keys/indexes
- state fields indexed
- large logs outside core rows
- rollback where stack supports

---

# 158. Configuration

Example:

```env
PAO_COUNCIL_ENABLED=false
PAO_COUNCIL_MAX_PARALLEL_AGENTS=4
PAO_COUNCIL_MAX_PARALLEL_HIGH_RISK=1
PAO_COUNCIL_DEFAULT_BUDGET_MODE=BALANCED
PAO_COUNCIL_MAX_REVIEW_ROUNDS=3
PAO_COUNCIL_AGENT_IDLE_TIMEOUT_SECONDS=300
PAO_COUNCIL_TASK_TIMEOUT_SECONDS=1800
PAO_COUNCIL_KEEP_FAILED_WORKTREES=true
PAO_COUNCIL_REMOTE_PUSH_ENABLED=false
PAO_COUNCIL_AUTO_MERGE_PROTECTED_BRANCH=false
```

---

# 159. Feature Flag

Default:

```text
disabled or manual mode
```

Phase 20.2 ต้องยังใช้ single executor ได้

---

# 160. Execution Modes

```text
PLAN_ONLY
MANUAL_ASSIGN
PARALLEL_ASSISTED
AUTONOMOUS_SAFE
```

`PLAN_ONLY`:
ไม่สร้าง worktree

`MANUAL_ASSIGN`:
operator เลือก agents

`PARALLEL_ASSISTED`:
ระบบ schedule แต่ merge gate manual

`AUTONOMOUS_SAFE`:
เฉพาะ policy-safe tasks

---

# 161. Dry Run

Council dry-run:

```text
Task DAG
Parallel groups
Predicted conflicts
Agent assignments
Resource estimate
Expected worktrees
Review plan
Verification plan
```

ไม่สร้าง branch/worktreeจริง

---

# 162. Test Strategy

ต้องมี:

```text
Unit
Task DAG
Scheduler
Lease
Worktree
Git Safety
Agent Adapter
Review
Verification
Conflict
Merge Queue
Integration
Recovery
RBAC
MCP/API
Resource Budget
```

---

# 163. Mock Git Repository

สร้าง fixture repo สำหรับ test

ห้าม Git safety tests ใช้ user repo

---

# 164. Worktree Tests

```text
create
branch collision
parallel worktrees
dirty state
remove
orphan
disk failure
```

---

# 165. Git Safety Tests

ต้องยืนยันว่าไม่ใช้ destructive command กับ user tree

---

# 166. Scheduler Tests

```text
independent tasks parallel
dependency task waits
high conflict serializes
resource cap respected
priority/critical path behavior
```

---

# 167. Lease Tests

```text
acquire
duplicate blocked
heartbeat
expiry
recovery inspection
```

---

# 168. Reviewer Tests

```text
independent reviewer
stale diff invalidates review
blocking finding
review round cap
provider unavailable
```

---

# 169. Verification Tests

```text
test PASS
test FAIL
pre-existing failure
NOT_RUN
timeout
flaky suspected
```

---

# 170. Conflict Tests

```text
text conflict
semantic contract failure
migration collision
lockfile collision
```

---

# 171. Integration Tests

```text
multiple passing changesets
integration test pass
target branch moved
approval stale
integration fail
```

---

# 172. Recovery Tests

simulate service restart mid:

```text
agent run
review
integration
cleanup
```

ต้อง resume safely

---

# 173. Acceptance Scenario — 3 Independent Tasks

Given:

```text
Backend API
Frontend layout
Docs
```

Then:

```text
3 isolated worktrees
parallel execution
independent changesets
reviews
integration
```

---

# 174. Acceptance Scenario — Dependency

Given:

```text
Task B depends on A
```

Then B must not start before A reaches configured dependency state

---

# 175. Acceptance Scenario — Lockfile Collision

Two dependency tasks:

```text
both touch package lock
```

Expected:

```text
serialize or controlled reintegration
```

---

# 176. Acceptance Scenario — User Dirty Tree

Given user has uncommitted changes

Expected:

```text
no reset
no auto stash by default
new isolated worktrees from committed base
user work untouched
```

---

# 177. Acceptance Scenario — Reviewer Rejects

```text
ChangeSet 1
→ Security CHANGES_REQUIRED
→ revision run
→ ChangeSet 2
→ reverify
→ new review
```

---

# 178. Acceptance Scenario — Target Branch Moves

Before final merge:

```text
main HEAD != pinned expected HEAD
```

Expected:

```text
MERGE_READY invalidated
reintegration required
```

---

# 179. Acceptance Scenario — Agent Dies

Expected:

```text
lease timeout
worktree preserved
orphan inspection
replacement only after state evaluation
```

---

# 180. Acceptance Scenario — Phase 20.3 UI Smoke

One task requires desktop smoke verification

Expected:

```text
Phase 20.3 approved skill
exclusive desktop lane
evidence attached
gate result recorded
```

---

# 181. Implementation Order

```text
1  Inspect Phase 20.2 implementation
2  Map existing task DAG / runner / reviewer / approval
3  Add Council domain/state
4  Add agent profiles/providers
5  Add parallelization planner
6  Add scheduler/resource guard
7  Add task leases
8  Add worktree coordinator
9  Add changeset registry
10 Add reviewer pool
11 Add verification bundles
12 Add conflict analyzer
13 Add merge queue
14 Add integration worktree
15 Add recovery/cleanup
16 Add Phase 20.3 verification lane
17 Add MCP/API/events
18 Add dashboard
19 Add tests
20 Add docs/config
21 Run real verification
```

---

# 182. Repository Inspection Checklist

Before coding:

```text
git version
worktree support
branch conventions
CI scripts
test scripts
Phase 20.2 state models
agent provider adapters
safe command runner
reviewer council
approval engine
audit
event bus
database
RBAC
dashboard patterns
```

---

# 183. No Duplicate Reviewer Council

ถ้า Phase 19/20.2 มี Reviewer Council:

```text
reuse/extend
```

Phase 20.4 เพิ่ม scheduling/independence/parallel review orchestration

---

# 184. No Duplicate Agent Runtime

ถ้ามี agent execution service เดิม:

```text
extend adapter + pool
```

---

# 185. Documentation

สร้าง/อัปเดต:

```text
docs/engineering-council/README.md
docs/engineering-council/architecture.md
docs/engineering-council/worktrees.md
docs/engineering-council/review-policy.md
docs/engineering-council/merge-queue.md
docs/engineering-council/recovery.md
docs/engineering-council/security.md
```

---

# 186. Manual Smoke Checklist

```text
[ ] create PLAN_ONLY run
[ ] view parallel plan
[ ] create 2 worktrees
[ ] verify user tree untouched
[ ] run two mock agents
[ ] create changesets
[ ] assign independent reviewers
[ ] stale review invalidation works
[ ] integrate candidates
[ ] full tests recorded
[ ] merge readiness generated
[ ] cancel preserves inspectable state
[ ] cleanup works
```

---

# 187. Definition of Done — Core

```text
[ ] CouncilRun state machine
[ ] Parallelization planner
[ ] Scheduler
[ ] Resource guard
[ ] Task leases
[ ] Agent assignment
[ ] Worktree coordinator
[ ] ChangeSet registry
[ ] Review pool
[ ] Verification bundle
[ ] Conflict analyzer
[ ] Merge queue
[ ] Integration worktree
[ ] Recovery
```

---

# 188. Definition of Done — Safety

```text
[ ] user dirty tree protected
[ ] no destructive git defaults
[ ] no force push
[ ] remote push disabled by default
[ ] reviewer independence
[ ] stale review protection
[ ] stale approval protection
[ ] secret scan
[ ] path/scope policy
[ ] bounded concurrency
[ ] timeout/cancel
[ ] orphan inspection
```

---

# 189. Definition of Done — Integration

```text
[ ] Phase 20.2 task DAG reuse
[ ] Phase 20.2 gates/approval reuse
[ ] Phase 20.3 desktop test lane
[ ] MCP
[ ] REST API
[ ] Realtime events
[ ] Dashboard
```

---

# 190. Definition of Done — Engineering

```text
[ ] migrations
[ ] tests
[ ] mock repo
[ ] docs
[ ] .env.example
[ ] telemetry
[ ] health checks
[ ] final verification report
```

---

# 191. Codex Must Not Finish With

ห้ามจบ:

```text
Scaffold only
Mock only
TODO core orchestration
Worktree concept added
Parallel agent placeholder
```

ถ้าทำจริงได้ต้องทำจริง

---

# 192. Final Verification Report

Codex ต้องตอบ:

```text
Phase 20.4 Implementation Complete

1. Repository inspected
2. Phase 20.2 components reused
3. Phase 20.3 integration
4. Council architecture
5. Files added
6. Files modified
7. Migrations
8. Agent profiles/providers
9. Parallelization planner
10. Scheduler/resource guard
11. Task leases
12. Worktree lifecycle
13. Git safety controls
14. ChangeSet registry
15. Reviewer independence
16. Verification bundles
17. Conflict analyzer
18. Merge queue
19. Integration worktree
20. Human approval integration
21. MCP tools
22. API endpoints
23. Realtime events
24. Dashboard
25. Tests added
26. Commands actually executed
27. Test results
28. Build result
29. Known limitations
30. Manual setup
31. Cleanup/recovery
32. Security notes
33. Recommended Phase 20.5
```

ห้ามรายงาน PASS ถ้าไม่ได้รัน

---

# 193. Recommended Phase 20.5 — DO NOT IMPLEMENT

ต่อไป:

```text
Phase 20.5
Pao Living Knowledge Brain
× LLM Wiki
× Persistent Knowledge Graph
```

เป้าหมาย:

```text
Phase docs
Source code
Decisions
Agent runs
Reviews
Incidents
Research
External docs
 ↓
Knowledge Compiler
 ↓
Living Markdown Wiki
+
Claim/Entity Graph
+
Provenance
+
Contradiction Detection
 ↓
Shared Long-Term Knowledge for all Pao agents
```

ต้อง reuse Pao Brain Universe เดิม ไม่สร้าง knowledge system ซ้ำ

---

# 194. Final Command to Codex

```text
Implement Phase 20.4 now in the existing Pao-hubPro repository.

Do not create a new repository.
Do not replace Phase 20.2.
Inspect the current codebase first and reuse the existing SDLC cycle, Task DAG, safe command runner, reviewer council, approval engine, audit, database, auth/RBAC, MCP, events, realtime infrastructure, settings, and dashboard patterns.

Build:

Pao Autonomous Engineering Council
× Multi-Agent Parallel Worktree Execution

The implementation must:

- analyze the Phase 20.2 Task DAG
- detect which tasks are safe to parallelize
- serialize conflict-prone tasks
- assign specialized implementation agents
- run every parallel implementation task in an isolated Git worktree
- protect the user's existing working tree and all uncommitted work
- never use destructive Git cleanup/reset as a recovery shortcut
- create traceable ChangeSets
- run deterministic task-level verification
- assign independent reviewer agents according to risk
- invalidate reviews when the diff changes
- forecast and detect textual/semantic conflicts
- integrate passing ChangeSets in a dedicated integration worktree
- run full required verification on the integrated head
- calculate rule-based merge readiness
- require human approval where Phase 20.2 policy requires it
- keep final protected-branch merge separate from merge-ready state by default
- disable remote push by default
- support cancellation, timeout, crash recovery, orphan worktree inspection, and safe cleanup
- enforce concurrency/resource/provider budget limits
- expose MCP tools, REST API, realtime events, dashboard, audit, telemetry, health, docs, and tests
- integrate Phase 20.3 as an optional desktop/UI verification lane

Run the repository's real test/lint/typecheck/build commands.
Fix Phase-20.4-related failures.
Record pre-existing failures separately.

Do not claim Windows/UI verification, provider execution, Git integration, or tests passed unless they were actually run.

Protect all current user work.

Finish only after producing the Phase 20.4 Final Verification Report.
```

---

# End of Phase 20.4 Specification

**Phase 20.4 — Pao Autonomous Engineering Council × Multi-Agent Parallel Worktree Execution**

เป้าหมายสูงสุด:

```text
หนึ่ง Spec
→ หลาย Task
→ หลาย Agent
→ หลาย Worktree
→ Review อิสระ
→ Verification จริง
→ Integration ปลอดภัย
→ Merge Ready ที่ตรวจสอบย้อนหลังได้
```

โดยไม่แลกกับ:

```text
Git Safety
Deterministic Evidence
Human Control
Reviewer Independence
Recoverability
```
