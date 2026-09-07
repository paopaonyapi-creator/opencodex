# Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler

> **Project:** Pao-hubPro  
> **Phase:** 20.1  
> **Depends on:**  
> - Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator  
> - Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router  
>
> **Status:** Implementation Specification / Codex One-Shot Build Prompt  
> **Primary Goal:** เพิ่ม Smart Queue Controller ให้ Pao-hubPro สามารถอ่านสถานะคิว ComfyUI แบบ real-time, ประเมินเวลารอ, จัดกลุ่มงานตาม Model/Workflow, ตัดสินใจ Cloud Burst ไป RunPod หลาย GPU, กระจายงานอย่างปลอดภัย, ป้องกันงานซ้ำ, และ Auto Scale-In / Stop เมื่อคิวลดลง  
> **Observed Production Scenario:** ComfyUI มี 50 active jobs โดย 1 running และ 49 queued พร้อม workload กลุ่ม MiniMax H3 / video generation  
> **Important:** Phase นี้ต้อง **ต่อยอด Phase 19 + Phase 20 ใน repository Pao-hubPro เดิม** เท่านั้น ห้ามสร้างโปรเจกต์ใหม่ และห้ามสร้าง queue system ซ้ำถ้า Phase 19/20 มีอยู่แล้ว

---

# 0. Mission สำหรับ Codex

คุณคือ Senior Distributed Systems Engineer, GPU Scheduler Engineer, Queueing Systems Engineer, MLOps Engineer, FinOps Engineer และ Full-stack Engineer ที่กำลังทำงานใน repository **Pao-hubPro**

ให้ implement:

```text
Phase 20.1
Pao ComfyUI Smart Queue
×
Auto Cloud Burst Scheduler
```

เป้าหมายคือแก้ปัญหา production queue แบบนี้:

```text
ComfyUI
1 Running
49 Queued
```

จากเดิม:

```text
50 Jobs
  ↓
ComfyUI Instance เดียว
  ↓
GPU เดียว
  ↓
1 Running
49 Waiting
```

ให้กลายเป็น:

```text
50 Jobs
   ↓
Pao Smart Queue Controller
   ↓
Workload Classification
   ↓
Batch Affinity
   ↓
Capacity Planner
   ↓
┌──────────────────────────────────────────┐
│ Local ComfyUI                            │
│ Warm RunPod #1                           │
│ Warm RunPod #2                           │
│ Newly Provisioned RunPod #3              │
└──────────────────────────────────────────┘
   ↓
Parallel Generation
   ↓
Queue Drain
   ↓
Scale-In
   ↓
Idle Stop
   ↓
Cost Recorded
```

---

# 1. Core Principles

1. ห้ามสร้าง queue ใหม่ซ้ำกับ Phase 19 ถ้ามี persistent job queue แล้ว
2. Phase 20.1 ต้องเป็น **scheduler/controller layer**
3. Pao-hubPro job database ต้องเป็น source of truth สำหรับงานที่ Pao สร้าง
4. ComfyUI native queue เป็น execution queue ไม่ใช่ canonical orchestration database
5. ต้องอ่าน ComfyUI queue เพื่อ capacity awareness
6. ห้ามย้ายงานที่กำลัง Running กลาง execution
7. งานที่ยัง Queued สามารถถูก reclaim/re-route ได้เฉพาะเมื่อ ownership ชัดเจน
8. ห้ามดึง queue ของบุคคลอื่น/ระบบอื่นออกจาก ComfyUI โดยเดา
9. ต้องป้องกัน duplicate generation
10. ทุก job ต้องมี idempotency / execution attempt tracking
11. ต้องมี queue hysteresis ป้องกันเปิด/ปิด RunPod ถี่เกินไป
12. ต้องมี scale-up cooldown
13. ต้องมี scale-down cooldown
14. ต้องมี maximum cloud pod limit
15. ต้องเคารพ Phase 20 Cost Guard
16. ต้อง reuse Phase 20 RunPod lifecycle manager
17. ต้อง reuse Phase 20 provider router
18. ต้อง reuse Phase 19 asset pipeline
19. ต้องรองรับ Local-only mode
20. ต้องรองรับ Cloud-disabled mode
21. ต้องรองรับ Manual mode
22. ต้องรองรับ Auto Cloud Burst mode
23. ต้องไม่ทำให้ ComfyUI native UI ใช้งานไม่ได้
24. ต้องไม่ลบ ComfyUI queue โดยไม่ตรวจ ownership
25. ต้องมี emergency stop
26. ต้องมี drain mode
27. ต้องมี observability
28. ต้องมี tests แบบไม่ใช้ GPU จริง
29. ต้องมี mock ComfyUI queue
30. ต้องมี mock RunPod
31. ห้ามใช้ค่า threshold แบบ hardcode
32. ต้อง config ได้ผ่าน Settings / env
33. ต้องทำงานได้บน Windows host
34. ต้องทำงานได้บน Linux host
35. ต้อง fail gracefully หาก ComfyUI offline
36. ต้อง fail gracefully หาก RunPod unavailable
37. ต้องไม่สร้าง Pod ซ้ำจาก race condition
38. ต้องไม่ submit prompt ซ้ำจาก retry
39. ต้องไม่ claim queue item ที่ไม่ใช่ของ Pao
40. ต้องมี audit trail

---

# 2. Production Scenario ที่ Phase นี้ต้องแก้

Observed example:

```text
ComfyUI endpoint:
192.168.1.140:8189

Active:
50

Running:
1

Queued:
49
```

ลักษณะ workload:

```text
video generation
MiniMax H3 / related workflow
multi-scene batch
output namesเป็น scene sequence
```

Phase 20.1 ต้องใช้สถานการณ์นี้เป็น acceptance test class:

```text
Large homogeneous batch
+
single local GPU
+
long queue
```

ห้าม hardcode IP `192.168.1.140:8189`

ให้ config ผ่าน provider record ของ Phase 19/20

---

# 3. Target Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                       Pao-hubPro                              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ Phase 19 Job Orchestrator                                     │
│          │                                                    │
│          ▼                                                    │
│ Phase 20.1 Smart Queue Controller                             │
│          │                                                    │
│          ├── Queue Observer                                   │
│          ├── Runtime Predictor                                │
│          ├── Backlog Analyzer                                 │
│          ├── Batch Affinity Planner                           │
│          ├── Capacity Planner                                 │
│          ├── Burst Decision Engine                            │
│          ├── Queue Reconciler                                 │
│          └── Scale-In Controller                              │
│          │                                                    │
│          ▼                                                    │
│ Phase 20 Intelligent Workload Router                          │
│          │                                                    │
│   ┌──────┼─────────────┬─────────────┐                        │
│   ▼      ▼             ▼             ▼                        │
│ Local   Warm Cloud   New RunPod    Future Provider            │
│          │                                                    │
│          ▼                                                    │
│ Provider-specific ComfyUI Queues                              │
│          │                                                    │
│          ▼                                                    │
│ Generation                                                    │
│          │                                                    │
│          ▼                                                    │
│ Phase 19 Assets → Review → Stock QC → Metadata → Export       │
└───────────────────────────────────────────────────────────────┘
```

---

# 4. Responsibility Boundary

## Phase 19

รับผิดชอบ:

```text
job
asset
workflow
model
review
stock
metadata
export
```

## Phase 20

รับผิดชอบ:

```text
provider selection
RunPod
GPU capacity
cost
provision
stop
terminate
```

## Phase 20.1

รับผิดชอบ:

```text
queue observation
backlog intelligence
runtime prediction
batch affinity
parallel queue placement
cloud burst trigger
scale-up target
scale-down target
queue ownership reconciliation
```

---

# 5. New Logical Modules

ปรับตาม codebase จริง

```text
generation/
  smart_queue/
    observer/
    snapshot/
    backlog/
    predictor/
    affinity/
    planner/
    burst/
    scaler/
    reconciler/
    ownership/
    policy/
    telemetry/
```

หรือ equivalent ตาม architecture เดิม

---

# 6. QueueSnapshot

สร้าง normalized object:

```text
provider_id
instance_id
captured_at

running_count
queued_count
total_active

running_items
queued_items

oldest_queued_at
newest_queued_at

estimated_backlog_seconds
estimated_drain_seconds

provider_health
gpu_utilization
vram_used
vram_total
```

GPU metrics optional ถ้า provider support

ห้าม require NVML เพื่อให้ระบบทำงานได้

---

# 7. QueueItem

```text
native_queue_id
pao_job_id
execution_attempt_id
provider_id
workflow_id
model_id
status
submitted_at
started_at
priority
prompt_hash
ownership_state
estimated_runtime_seconds
metadata
```

---

# 8. Queue Ownership States

```text
PAO_OWNED
EXTERNAL
UNKNOWN
IMPORTED
```

Rule:

```text
PAO_OWNED
→ scheduler สามารถ manage/re-route ตาม policy

EXTERNAL
→ observe only

UNKNOWN
→ observe only

IMPORTED
→ manage เฉพาะ permission ที่ explicit
```

---

# 9. Pao Queue Marker

เมื่อ submit job ไป ComfyUI ให้แนบ trace metadata เท่าที่ workflow/API รองรับ

อย่างน้อย Pao database ต้องเก็บ mapping:

```text
pao_job_id
execution_attempt_id
provider_id
comfy_prompt_id
submitted_at
```

ComfyUI prompt ID เป็น primary reconciliation handle

---

# 10. Canonical State Rule

Canonical orchestration:

```text
Pao Job DB
```

Execution state:

```text
ComfyUI queue/history
```

ห้ามกลับด้าน

---

# 11. ComfyUI Queue Observer

Phase 20.1 ต้องอ่านข้อมูลจาก ComfyUI APIs ที่ adapter Phase 19 รองรับ

logical methods:

```text
get_queue_snapshot()
get_running_items()
get_pending_items()
get_prompt_history()
get_prompt_status(prompt_id)
```

อย่าผูก controller กับ raw response schema

สร้าง normalization layer

---

# 12. Observation Interval

config:

```env
PAO_QUEUE_OBSERVER_INTERVAL_SECONDS=3
```

adaptive:

```text
busy queue
→ 2-5 sec

idle
→ 10-30 sec
```

อย่า poll ทุก 100ms

---

# 13. Queue Snapshot Storage

ไม่จำเป็นต้อง persistทุก snapshot ถี่ ๆ

เก็บ:

```text
current snapshot
aggregated telemetry
important transitions
```

Time-series retention config

---

# 14. Queue Event Types

```text
queue.snapshot
queue.backlog_high
queue.backlog_normal
queue.burst_requested
queue.scale_up
queue.scale_down
queue.drained
queue.external_job_detected
queue.ownership_conflict
queue.reconciliation_required
```

---

# 15. Backlog Metrics

คำนวณ:

```text
queued_count
running_count
queue_age_seconds
oldest_wait_seconds
estimated_drain_seconds
arrival_rate
completion_rate
```

---

# 16. Drain Time

พื้นฐาน:

```text
estimated_drain_seconds
=
sum(estimated_runtime_of_queued_jobs)
/
effective_parallel_capacity
```

ถ้าไม่มี per-job estimate:

ใช้ historical median ตาม:

```text
workflow
model
gpu_type
resolution
duration
```

---

# 17. Avoid Naive Queue Threshold Only

ห้าม scale cloud จาก:

```text
queued_count > 3
```

อย่างเดียว

ต้องดู:

```text
queue length
runtime
wait time
arrival rate
capacity
budget
cold start
```

---

# 18. Runtime Predictor

reuse telemetry จาก Phase 20

feature inputs:

```text
workflow_id
model_id
gpu_type
resolution
width
height
video_frames
duration
fps
batch_size
LoRA count
upscale factor
```

---

# 19. Runtime Prediction Fallback

ลำดับ:

```text
exact historical match
↓
workflow + gpu median
↓
workflow median
↓
workload class default
↓
unknown
```

Unknown ต้อง confidence ต่ำ

---

# 20. RuntimePrediction

```text
estimated_seconds
confidence
sample_count
basis
observed_at
```

---

# 21. Prediction Confidence

```text
HIGH
MEDIUM
LOW
UNKNOWN
```

router ใช้ confidence เพื่อลด aggressiveness

---

# 22. Batch Affinity

workload ที่ใช้:

```text
same model
same workflow family
same LoRA
same custom nodes
same video pipeline
```

ควรอยู่ provider เดียวกันเพื่อ:

```text
ลด model reload
ลด cold start
ลด VRAM thrash
เพิ่ม throughput
```

---

# 23. AffinityKey

```text
model_id
workflow_family
runtime_class
required_nodes_hash
model_manifest_hash
```

ไม่ใช้ prompt text เป็น affinity key

---

# 24. Scene Batch

รองรับ project ที่มี:

```text
scene001
scene002
...
scene050
```

แต่ internal grouping ใช้ structured project/job metadata

ไม่ parse filename เป็นหลักถ้ามี metadata

---

# 25. Batch Group Object

```text
group_id
project_id
affinity_key
job_ids
total_jobs
queued_jobs
running_jobs
completed_jobs
estimated_total_runtime
preferred_provider
```

---

# 26. Scheduler Goals

1. ลด total completion time
2. ลด cloud cost
3. ลด queue wait
4. ลด model reload
5. ไม่เกิน budget
6. ไม่ over-provision
7. ไม่ starve งาน priority ต่ำ
8. ไม่ disrupt งาน external

---

# 27. Burst Decision Engine

output:

```text
NO_BURST
BURST_RECOMMENDED
BURST_REQUIRED
BURST_BLOCKED_BY_BUDGET
BURST_BLOCKED_BY_POLICY
```

---

# 28. Burst Inputs

```text
local_queue_depth
local_estimated_drain_time
oldest_wait
arrival_rate
completion_rate
workflow urgency
batch size
warm cloud capacity
cloud cold start
estimated cloud cost
budget remaining
routing mode
user approval mode
```

---

# 29. Default Burst Policy

example:

```text
if local queue <= soft threshold
and estimated drain <= target
→ NO_BURST

if drain > target
and cloud can finish meaningfully faster
and budget passes
→ BURST_RECOMMENDED

if oldest wait > hard SLA
and cloud allowed
→ BURST_REQUIRED
```

---

# 30. Queue Threshold Config

```env
PAO_QUEUE_BURST_SOFT_DEPTH=4
PAO_QUEUE_BURST_HARD_DEPTH=12

PAO_QUEUE_TARGET_DRAIN_MINUTES=20
PAO_QUEUE_MAX_LOCAL_WAIT_MINUTES=30
```

ค่าตัวอย่าง

---

# 31. Real Scenario Suggested Baseline

สำหรับ production scenario:

```text
1 running
49 queued
```

scheduler ควรเห็นเป็น:

```text
Backlog High
```

แต่จำนวน Pod ที่เปิดต้องคำนวณจาก:

```text
runtime
GPU type
budget
max pods
```

ห้ามเปิด 49 Pods

---

# 32. Capacity Unit

หนึ่ง provider instance มี:

```text
effective_slots
```

default:

```text
1 heavy ComfyUI job per GPU
```

---

# 33. Desired Parallelism

```text
desired_slots
=
ceil(
  total_backlog_runtime
  /
  target_drain_time
)
```

clamped by:

```text
min slots
max slots
budget slots
available slots
```

---

# 34. Example

ถ้า:

```text
49 queued
median runtime = 4 min
target drain = 30 min
```

approx:

```text
196 GPU-min
/
30 min
≈ 6.54
```

desired parallel slots ≈ 7

แต่ scheduler ต้อง apply:

```text
local slot = 1
max cloud pods maybe 2
budget
```

ดังนั้นอาจเปิดเพียง:

```text
Local + 2 Cloud = 3 slots
```

และแสดง expected drain ใหม่

---

# 35. Scale-Up Controller

ต้องตัดสิน:

```text
current_slots
desired_slots
delta
```

---

# 36. Scale-Up Hysteresis

config:

```env
PAO_QUEUE_SCALE_UP_COOLDOWN_SECONDS=60
PAO_QUEUE_SCALE_UP_STABLE_WINDOW_SECONDS=30
```

backlog ต้องสูงต่อเนื่องก่อนเปิดเพิ่ม

---

# 37. Scale-Down Hysteresis

```env
PAO_QUEUE_SCALE_DOWN_COOLDOWN_SECONDS=300
PAO_QUEUE_SCALE_DOWN_STABLE_WINDOW_SECONDS=120
```

ป้องกัน:

```text
เปิด
ปิด
เปิด
ปิด
```

---

# 38. Minimum Useful Burst

Cloud burst ต้องลด expected completion timeอย่างมีนัยสำคัญ

config:

```env
PAO_QUEUE_MIN_BURST_TIME_SAVING_PERCENT=20
```

ถ้าประหยัดเวลา 2% ไม่คุ้ม cold start/cost

---

# 39. Cold Start Awareness

รวม:

```text
RunPod provision
container boot
ComfyUI boot
model sync
model load
```

---

# 40. Warm Pod Preference

ลำดับ:

```text
1 Local capacity
2 Existing warm compatible cloud
3 Stopped reusable managed Pod
4 New Pod
```

ตาม cost/performance policy

---

# 41. Queue Placement

scheduler ไม่ควร submit jobs ทั้งหมดเข้า provider queue ทันที

ใช้:

```text
dispatch window
```

---

# 42. Dispatch Window

ต่อ provider:

```env
PAO_QUEUE_MAX_PREFETCH_JOBS_PER_PROVIDER=2
```

ตัวอย่าง:

```text
1 running
1 queued/preloaded
```

แทน:

```text
1 running
49 queued
```

---

# 43. Why Dispatch Window

ช่วย:

- reroute pending jobs ได้
- scale cloud ได้
- cancel ได้ง่าย
- ไม่ล็อก backlog ไว้ ComfyUI instance เดียว
- ลด duplicate/reconciliation complexity

---

# 44. Pao Queue vs Native ComfyUI Queue

หลัง Phase 20.1:

```text
Pao Queue:
49 backlog

ComfyUI Local:
1 running
1 prefetched

RunPod #1:
1 running
1 prefetched

RunPod #2:
1 running
1 prefetched
```

งานที่เหลือรอใน Pao queue

---

# 45. Critical Migration Behavior

หากตอน deploy Phase 20.1 มีอยู่แล้ว:

```text
49 jobs queued inside ComfyUI
```

ห้าม clear ทั้งหมดอัตโนมัติ

ต้อง:

```text
inspect
map
reconcile
```

---

# 46. Existing Native Queue Reconciliation

แบ่ง:

```text
Pao-owned known prompt IDs
External prompts
Unknown prompts
```

---

# 47. Known Pao Pending Jobs

ถ้า prompt ID match Pao DB:

scheduler อาจ:

```text
leave queued
or
reclaim/re-route
```

ขึ้นกับ capability ของ ComfyUI adapter

---

# 48. Reclaim Safety

ห้าม reclaim ถ้า:

```text
status running
ownership unknown
output may already exist
execution attempt unclear
```

---

# 49. Safe Reclaim Flow

```text
pending known Pao prompt
↓
mark reclaim requested
↓
remove/cancel exact prompt if API supports
↓
confirm prompt absent
↓
close old execution attempt as reclaimed
↓
create new attempt
↓
route
```

---

# 50. Native Queue Clear Button

Pao UI ห้าม expose generic:

```text
Clear All
```

แบบง่าย

ให้:

```text
Clear Pao Pending Jobs
```

และแยก:

```text
Open ComfyUI for External Queue Management
```

---

# 51. Dispatch Leasing

ก่อน worker dispatch job:

```text
acquire dispatch lease
```

prevents two schedulers submit same job

---

# 52. ExecutionAttempt ID

ทุก submit:

```text
attempt_id
```

unique

---

# 53. Prompt Submission Fingerprint

```text
sha256(
job_id
workflow_version
model_version
seed
attempt_id
)
```

สำหรับ tracing

---

# 54. Duplicate Guard

ก่อน new attempt:

ตรวจ:

```text
active Comfy prompt
Comfy history
existing asset
execution attempt
```

---

# 55. Job State Extension

เพิ่ม:

```text
awaiting_dispatch
dispatching
provider_queued
provider_running
reclaiming
rerouting
```

---

# 56. State Flow

```text
queued
↓
awaiting_dispatch
↓
routing
↓
dispatching
↓
provider_queued
↓
provider_running
↓
post_processing
```

---

# 57. Re-route Flow

```text
provider_queued
↓
reclaiming
↓
rerouting
↓
dispatching
```

---

# 58. Running Job Rule

```text
provider_running
```

ไม่ re-route เว้น provider crash

---

# 59. Provider Crash

```text
running prompt disappears
no history output
provider unhealthy
↓
execution interrupted
↓
retry policy
↓
reroute
```

---

# 60. Provider Queue Depth Limits

per provider:

```env
PAO_QUEUE_PROVIDER_MAX_PENDING=2
```

---

# 61. Provider Busy Signal

busy if:

```text
running >= effective_slots
```

---

# 62. GPU Utilization Optional

ถ้ามี:

```text
GPU utilization
VRAM
temperature
```

ใช้ telemetry

แต่ไม่จำเป็นต่อ scheduler core

---

# 63. Model Initialization Time

จาก workload เช่น MiniMax H3 มี model initialization

เก็บ:

```text
model_load_seconds
```

แยกจาก generation runtime

---

# 64. Runtime Telemetry

execution:

```text
queue_wait
model_load
generation
post_process
output_sync
total
```

---

# 65. Better Future Prediction

ใช้:

```text
generation_runtime
```

แยกจาก:

```text
cold_start
```

---

# 66. Affinity Stickiness

หลัง provider โหลด model:

```text
warm_affinity_until
```

scheduler ให้โบนัสกับ jobs model เดียวกัน

---

# 67. Affinity TTL

```env
PAO_QUEUE_AFFINITY_WARM_MINUTES=20
```

---

# 68. Fairness

อย่าให้ batch 50 scenes block interactive job

แบ่ง classes:

```text
INTERACTIVE
NORMAL
BATCH
BACKGROUND
```

---

# 69. Queue Priority

ตัวอย่าง:

```text
interactive = 20
normal      = 10
batch       = 5
background  = 1
```

reuse Phase 19 priority semantics ถ้ามี

---

# 70. Weighted Fair Scheduling

preferred:

```text
priority + age boost + affinity bonus
```

ไม่ใช้ strict priority จน starvation

---

# 71. Age Boost

```text
effective_priority
=
base_priority
+
wait_age_boost
```

---

# 72. Batch Chunking

50 scenes ไม่จำเป็นต้องเป็น group เดียว

แบ่ง:

```text
chunk size 4-10
```

เพื่อ fairness/rebalance

---

# 73. Chunk Size Config

```env
PAO_QUEUE_BATCH_CHUNK_SIZE=5
```

---

# 74. Project Concurrency

จำกัด per project:

```env
PAO_QUEUE_MAX_CONCURRENT_PER_PROJECT=4
```

---

# 75. User Concurrency

ถ้า multi-user:

```text
per-user quota
```

reuse RBAC/quota system ถ้ามี

---

# 76. Cloud Burst Modes

```text
OFF
MANUAL
ASSISTED
AUTO
```

---

# 77. OFF

ไม่เปิด cloud

---

# 78. MANUAL

แสดง recommendation

admin กด approve

---

# 79. ASSISTED

เปิด cloud หาก policy ผ่าน แต่ต้อง approval เมื่อ costเกิน soft limit

---

# 80. AUTO

scale ตาม policyอัตโนมัติ

---

# 81. Default Mode

Production default recommended:

```text
ASSISTED
```

จน confidence ดี

จากนั้น user ค่อยเปิด AUTO

---

# 82. Scale Plan Object

```text
current_local_slots
current_cloud_slots
desired_total_slots
desired_cloud_slots
reason
estimated_drain_before
estimated_drain_after
estimated_hourly_cost
estimated_batch_cost
confidence
```

---

# 83. Scale Plan Explainability

UI ต้องบอก:

```text
Why scale to 2 RunPod GPUs?
```

ตัวอย่าง:

```text
49 queued
estimated local drain 196 min
target 30 min
cloud budget allows max 2 pods
2 cloud pods reduce estimated drain to ~66 min
```

---

# 84. Cost Guard Integration

Phase 20 Cost Guard เป็น authoritative

Phase 20.1 ห้าม bypass

---

# 85. Burst Budget Allocation

สำหรับ batch:

```text
max total batch cloud budget
```

ไม่ใช่แค่ per job

---

# 86. BatchBudget

```text
project_id
batch_group_id
max_cost
spent
reserved
remaining
```

---

# 87. Cost Reservation

ก่อนเปิด cloud slot:

reserve estimate

ป้องกัน parallel controllers allocate budget ซ้ำ

---

# 88. Budget Reservation Expiry

reservation มี TTL

---

# 89. Scale-In

เมื่อ backlog ลด:

```text
desired_slots < current_slots
```

drain instance ก่อน stop

---

# 90. Scale-In Selection

เลือก stop instance ที่:

```text
idle
no queued Pao jobs
least model locality benefit
highest cost
lowest reliability
```

---

# 91. Do Not Stop Busy

ห้าม stop provider ที่:

```text
provider_running > 0
```

---

# 92. Drain Instance

```text
mark draining
no new dispatch
wait current job complete
sync output
stop
```

---

# 93. Cloud Idle Timer

reuse Phase 20:

```text
idle stop minutes
```

Phase 20.1 สามารถ request early drain

---

# 94. Queue Drained Event

เมื่อ:

```text
Pao backlog = 0
provider pending = 0
```

emit:

```text
queue.drained
```

---

# 95. Scale-In after Drain

```text
cloud providers → draining → idle → stop
local remains
```

---

# 96. Backlog Spike

arrival rate อาจพุ่ง

ใช้ stable window ป้องกัน overreaction

---

# 97. Arrival Rate

jobs/min moving window

---

# 98. Completion Rate

jobs/min/provider

---

# 99. Queue Pressure

optional normalized metric:

```text
0-100
```

derived:

```text
depth
age
drain time
arrival/completion ratio
```

---

# 100. Pressure Levels

```text
0-25   IDLE
26-50  NORMAL
51-75  HIGH
76-100 CRITICAL
```

UI only; schedulerใช้ raw metrics

---

# 101. Smart Queue Dashboard

เพิ่ม:

```text
AI Studio
→ Queue
→ Smart Queue
```

---

# 102. Dashboard Header

cards:

```text
Running
Queued
Estimated Drain
Queue Pressure
Local Slots
Cloud Slots
Current $/hr
Burst Mode
```

---

# 103. Provider Lanes

UI แบบ lane:

```text
Local GPU
├── Running
└── Prefetch

RunPod #1
├── Running
└── Prefetch

RunPod #2
├── Running
└── Prefetch

Pao Backlog
├── Job...
├── Job...
└── Job...
```

---

# 104. Batch Groups UI

แสดง:

```text
MiniMax H3 — Project X
31 jobs
Affinity: warm on RunPod #1
ETA
```

---

# 105. Queue Timeline

chart optional:

```text
queued
running
cloud slots
estimated drain
```

ใช้ chart library เดิม

---

# 106. Control Panel

```text
Burst Mode
Target Drain Time
Max Cloud Pods
Max $/hr
Pause Dispatch
Drain Cloud
Emergency Stop
```

---

# 107. Pause Dispatch

หยุดส่ง job ใหม่

ไม่หยุด running

---

# 108. Resume Dispatch

กลับมาส่งต่อ

---

# 109. Manual Move

advanced:

```text
Move Pending Pao Job → Provider
```

ต้องเฉพาะ job ที่ยังไม่ running

---

# 110. Pin Provider

job override:

```text
provider_pin
```

---

# 111. Provider Pin Safety

ถ้า provider incompatible:

reject

ไม่ forceจน crash

---

# 112. Bulk Operations

```text
Pause selected
Change priority
Assign batch policy
Cancel Pao jobs
```

---

# 113. No Bulk External Mutation

external queue items read-only

---

# 114. Queue Inspector

debug view:

```text
native prompt id
Pao job id
attempt
ownership
workflow
provider
state
```

admin only

---

# 115. Reconciliation Page

แสดง mismatches:

```text
Pao says queued but prompt missing
Comfy prompt exists but no Pao job
Pao says running but Comfy history complete
```

---

# 116. Auto Reconciliation

safe cases:

```text
history output exists
→ complete/recover

prompt missing + no output
→ interrupted/retry
```

---

# 117. Manual Reconciliation Required

ambiguous:

```text
prompt duplicated
unknown ownership
partial output
```

---

# 118. Native ComfyUI Existing Queue Migration Tool

optional admin command:

```text
Analyze Existing ComfyUI Queue
```

ผล:

```text
49 pending
32 match Pao jobs
10 external
7 unknown
```

ไม่มี mutation

---

# 119. Import Known Jobs

ถ้า metadata/DB mappingชัด:

สามารถ import status

---

# 120. Queue Clear Safety

ห้ามเรียก native clear queue endpointแบบ global จาก auto controller

---

# 121. Cancellation

Pao job cancel:

```text
if awaiting_dispatch
→ cancel DB

if provider_queued and Pao-owned
→ cancel exact prompt
→ confirm

if provider_running
→ explicit interrupt policy
```

---

# 122. Running Interrupt Policy

default:

```text
do not interrupt running
```

user can explicit force cancel

---

# 123. Video Job Consideration

Video workload long-running

scheduler ต้อง:

```text
longer timeout
higher runtime estimate
strong affinity
avoid preemption
```

---

# 124. MiniMax H3 Profile

Workflow registry สามารถเพิ่ม:

```text
workload_class: HEAVY_VIDEO
queue_class: BATCH
affinity_strong: true
```

ห้าม hardcode model logicใน scheduler core

---

# 125. LTX Profile

เหมือนกันผ่าน registry

---

# 126. Image Workload

short image jobsอาจไม่คุ้ม provisionใหม่

ใช้:

```text
burst benefit threshold
```

---

# 127. Mixed Queue

ถ้า queue มี:

```text
image
video
upscale
```

scheduler groupตาม affinity/capability

---

# 128. Capability Routing

provider บางตัวมี model A แต่ไม่มี model B

scheduler ต้องไม่ assignผิด

---

# 129. Storage Locality

RunPod Network Volume มี model cache

ใช้ affinity bonus

---

# 130. Queue Forecast

compute:

```text
estimated completion timestamp
```

label estimate

---

# 131. ETA Confidence

แสดง:

```text
High/Medium/Low
```

---

# 132. No False ETA

ถ้า unknown:

```text
ETA unavailable
```

ไม่เดา

---

# 133. Adaptive Burst

หลังเปิด Pod 1:

observe throughputจริง

ก่อนเปิด Pod 2

เว้น critical backlog

---

# 134. Progressive Scale-Up

default:

```text
+1 slot per scale decision
```

ลด overprovision

---

# 135. Aggressive Mode

optional:

```env
PAO_QUEUE_AGGRESSIVE_SCALE_UP=false
```

ถ้า true scaleหลาย slots ตาม plan

---

# 136. Max RunPod Pods

reuse Phase 20:

```text
PAO_RUNPOD_MAX_ACTIVE_PODS
```

---

# 137. Per-Workflow Max Parallelism

registry:

```text
max_parallel_instances
```

---

# 138. API Endpoints

reuse convention

```text
GET  /api/v1/smart-queue/status
GET  /api/v1/smart-queue/snapshot
GET  /api/v1/smart-queue/plan
POST /api/v1/smart-queue/plan/refresh

POST /api/v1/smart-queue/dispatch/pause
POST /api/v1/smart-queue/dispatch/resume

POST /api/v1/smart-queue/burst/enable
POST /api/v1/smart-queue/burst/disable
POST /api/v1/smart-queue/burst/approve

POST /api/v1/smart-queue/providers/:id/drain

GET  /api/v1/smart-queue/reconciliation
POST /api/v1/smart-queue/reconciliation/:id/resolve
```

---

# 139. Route Preview Integration

Phase 20 route-preview เพิ่ม:

```text
queue_context
```

---

# 140. Queue Context

```json
{
  "local_queue_depth": 49,
  "estimated_drain_seconds": 11760,
  "burst_mode": "assisted"
}
```

---

# 141. MCP Tools

เพิ่ม:

```text
pao_queue_get_status
pao_queue_get_backlog
pao_queue_get_scale_plan
pao_queue_pause_dispatch
pao_queue_resume_dispatch
pao_queue_set_burst_mode
pao_queue_drain_provider
```

---

# 142. MCP Destructive Safety

agent ห้าม:

```text
clear all queue
terminate all
```

ผ่าน vague command

---

# 143. Automation Events

```text
smart_queue.pressure_high
smart_queue.pressure_critical
smart_queue.burst_recommended
smart_queue.scale_up
smart_queue.scale_down
smart_queue.drained
smart_queue.reconciliation_issue
```

---

# 144. Notifications

example:

```text
Queue reached 49 pending jobs.
Estimated local drain exceeds target.
RunPod burst of 2 GPUs recommended.
```

---

# 145. Auto Notification Noise Control

debounce

ไม่ส่งทุก snapshot

---

# 146. Alert Cooldown

```env
PAO_QUEUE_ALERT_COOLDOWN_MINUTES=15
```

---

# 147. Metrics

```text
smart_queue_backlog
smart_queue_running
smart_queue_estimated_drain_seconds
smart_queue_pressure
smart_queue_dispatch_rate
smart_queue_completion_rate
smart_queue_burst_events_total
smart_queue_scale_up_total
smart_queue_scale_down_total
smart_queue_reclaims_total
smart_queue_duplicate_prevented_total
smart_queue_reconciliation_issues
```

---

# 148. Cost/Throughput Metrics

```text
gpu_minutes_per_asset
cost_per_asset
assets_per_gpu_hour
video_seconds_per_gpu_hour
```

---

# 149. Scheduler Decision Log

ทุก decision:

```json
{
  "decision": "SCALE_UP",
  "reason": "...",
  "backlog": 49,
  "estimated_drain_before": 11760,
  "desired_slots": 3,
  "current_slots": 1,
  "cost_guard": "ALLOW"
}
```

---

# 150. Decision Audit

persistสำคัญ:

```text
scale up
scale down
reclaim
manual override
burst approval
policy changes
```

---

# 151. Configuration

เพิ่ม `.env.example`:

```env
# =========================================
# Phase 20.1 - Smart Queue
# =========================================

PAO_SMART_QUEUE_ENABLED=true

PAO_QUEUE_OBSERVER_INTERVAL_SECONDS=3

PAO_QUEUE_BURST_MODE=assisted

PAO_QUEUE_BURST_SOFT_DEPTH=4
PAO_QUEUE_BURST_HARD_DEPTH=12

PAO_QUEUE_TARGET_DRAIN_MINUTES=20
PAO_QUEUE_MAX_LOCAL_WAIT_MINUTES=30

PAO_QUEUE_MIN_BURST_TIME_SAVING_PERCENT=20

PAO_QUEUE_SCALE_UP_COOLDOWN_SECONDS=60
PAO_QUEUE_SCALE_UP_STABLE_WINDOW_SECONDS=30

PAO_QUEUE_SCALE_DOWN_COOLDOWN_SECONDS=300
PAO_QUEUE_SCALE_DOWN_STABLE_WINDOW_SECONDS=120

PAO_QUEUE_PROVIDER_MAX_PENDING=2
PAO_QUEUE_MAX_PREFETCH_JOBS_PER_PROVIDER=2

PAO_QUEUE_BATCH_CHUNK_SIZE=5
PAO_QUEUE_MAX_CONCURRENT_PER_PROJECT=4

PAO_QUEUE_AFFINITY_WARM_MINUTES=20

PAO_QUEUE_ALERT_COOLDOWN_MINUTES=15

PAO_QUEUE_AGGRESSIVE_SCALE_UP=false
```

---

# 152. Settings UI

```text
AI Studio
→ Settings
→ Smart Queue
```

sections:

```text
Observer
Dispatch
Burst
Scaling
Batch
Affinity
Fairness
Alerts
Advanced
```

---

# 153. Smart Queue Feature Flag

```text
PAO_SMART_QUEUE_ENABLED=false
```

เมื่อปิด:

Phase 19/20 ยังทำงานตามปกติ

---

# 154. Safety if Phase 20 Disabled

Smart Queue:

```text
local scheduling only
```

ห้ามพยายาม cloud

---

# 155. Safety if ComfyUI Offline

observer:

```text
provider unavailable
```

queue DB ยังอยู่

schedulerไม่ drop jobs

---

# 156. Safety if RunPod Offline

burst decision:

```text
cloud unavailable
```

local queueดำเนินต่อ

---

# 157. Restart Recovery

startup:

1. load scheduler state
2. observe providers
3. load active attempts
4. match prompt IDs
5. inspect history
6. reconcile
7. restore dispatch leases
8. recalculate scale plan
9. resume

---

# 158. Scheduler Singleton

ถ้า appหลาย instances:

ใช้ leader lease

---

# 159. Scheduler Lease

reuse Phase 20 cloud lease infra

---

# 160. Database Extensions

inspect Phase 19/20 schema

เพิ่มเท่าที่จำเป็น:

```text
queue_snapshots_aggregated
queue_decisions
batch_affinity_groups
dispatch_leases
queue_reconciliation_issues
runtime_observations
budget_reservations
```

อย่าสร้างถ้ามี generic equivalent

---

# 161. RuntimeObservation

```text
job_id
attempt_id
provider_id
gpu_type
workflow_id
model_id
queue_wait_seconds
model_load_seconds
generation_seconds
postprocess_seconds
total_seconds
success
observed_at
```

---

# 162. Testing Strategy

ไม่มี real GPU ใน CI

---

# 163. Mock ComfyUI Queue

simulate:

```text
queue empty
1 running 49 queued
mixed queue
external queue
prompt completes
prompt fails
prompt disappears
history completed
queue clear conflict
provider offline
```

---

# 164. Mock RunPod

reuse Phase 20 mock

---

# 165. Integration Test A — 1 Running 49 Queued

initial:

```text
local slots=1
backlog=49
burst mode=AUTO/ASSISTED
max cloud=2
```

expected:

```text
scale plan desired cloud=2
provider lifecycle called
jobs dispatched incrementally
not all 49 submitted to one provider
```

---

# 166. Integration Test B — Dispatch Window

assert each provider:

```text
running <= slots
pending <= configured prefetch
```

---

# 167. Integration Test C — Batch Affinity

10 MiniMax jobs

expected:

```text
same compatible warm provider preferred
```

---

# 168. Integration Test D — Interactive Fairness

batch backlog 49

new interactive job arrives

expected:

```text
interactive job scheduled promptly
```

---

# 169. Integration Test E — Budget Block

backlog high

Phase 20 cost guard blocks

expected:

```text
no new Pod
queue continues local
decision explains budget block
```

---

# 170. Integration Test F — Scale-In

backlog goes:

```text
49 → 5 → 0
```

expected:

```text
cloud drain
idle
stop
```

after hysteresis

---

# 171. Integration Test G — No Thrash

queue oscillates:

```text
3
5
3
5
```

within cooldown

expected:

```text
no repeated provision/stop
```

---

# 172. Integration Test H — External Queue

ComfyUI:

```text
10 external
5 Pao
```

expected:

```text
observe all
manage only 5 Pao
```

---

# 173. Integration Test I — Restart

restart with:

```text
2 providers
3 running attempts
```

expected:

```text
reconcile without duplicate submission
```

---

# 174. Integration Test J — Prompt Already Complete

Pao thinks running

Comfy history completed

expected:

```text
recover asset/status
no rerun
```

---

# 175. Unit Tests

- pressure calculation
- drain estimate
- desired slots
- hysteresis
- cooldown
- affinity score
- fairness
- age boost
- dispatch window
- ownership
- duplicate guard
- runtime predictor
- burst benefit threshold
- scale-in selection
- batch chunking

---

# 176. Race Tests

two scheduler workers:

```text
same job
```

assert one dispatch only

---

# 177. Failure Injection

simulate:

```text
Comfy 500
WS disconnect
RunPod create timeout
DB transaction failure
asset sync failure
```

---

# 178. No Lost Jobs

ทุก failure:

job remains in deterministic state

---

# 179. No Duplicate Jobs

critical invariant:

```text
one logical job
may have multiple attempts
but only one successful final asset set per attempt policy
```

---

# 180. Invariants

1. Running jobไม่ re-route
2. External jobไม่ auto cancel
3. Unknown queueไม่ auto mutate
4. Cloud createผ่าน Cost Guard
5. Scale-downไม่หยุด busy
6. Prompt submitมี attempt mapping
7. Completed historyไม่ regenerate
8. Restartไม่ duplicate
9. Scheduler singleton/leases work
10. Phase 19 asset pipeline unchanged

---

# 181. Performance Target

Scheduler overheadต่ำ

ห้ามให้ queue observer consume significant CPU

---

# 182. API Rate Safety

ComfyUI LAN polling:

adaptive

RunPod control API:

reuse Phase 20 cooldown/rate strategy

---

# 183. Browser UI Performance

50/500 jobs:

use pagination/virtualization

---

# 184. Queue Scale Target

design:

```text
1000 Pao backlog jobs
```

โดยไม่ loadทั้งหมดเข้า browser

---

# 185. Large Batch

Pao DB ถือ backlog

Comfy provider queueถือ small dispatch window

---

# 186. Migration from Old Behavior

ถ้าเดิม Phase 19 submit batchทั้งหมดตรง ComfyUI:

เปลี่ยน:

```text
create logical jobs
↓
awaiting_dispatch
↓
scheduler dispatch window
```

---

# 187. Backward Compatibility

single job API ยังใช้งานเหมือนเดิม

เบื้องหลัง scheduler dispatch

---

# 188. Feature Rollout

แนะนำ:

```text
Stage 1 Observe Only
Stage 2 Assisted
Stage 3 Auto Local Scheduling
Stage 4 Auto Cloud Burst
```

---

# 189. Observe-Only Mode

config:

```text
PAO_QUEUE_BURST_MODE=off
```

แต่ observer/dashboardทำงาน

---

# 190. Assisted Pilot

เหมาะเริ่ม production

---

# 191. Auto Rollout Gate

ก่อน enable AUTO:

ต้องมี:

```text
runtime samples
cost policy
RunPod tested
reconciliation clean
idle stop verified
```

---

# 192. Queue Policy Profiles

สร้าง:

```text
Economy
Balanced
Fast Batch
Interactive
Stock Overnight
```

---

# 193. Economy

```text
prefer local
higher burst threshold
low cloud max
longer target drain
```

---

# 194. Balanced

default production

---

# 195. Fast Batch

```text
more cloud slots
lower target drain
```

within budget

---

# 196. Interactive

prioritize latency

---

# 197. Stock Overnight

```text
local-heavy
cheap cloud
long deadline
batch affinity
```

---

# 198. Project Policy

project can choose profile

---

# 199. Manual Override Logging

every override audit

---

# 200. Documentation

สร้าง:

```text
docs/phase-20.1/
  README.md
  architecture.md
  smart-queue.md
  cloud-burst.md
  batch-affinity.md
  queue-ownership.md
  reconciliation.md
  scaling.md
  tuning.md
  troubleshooting.md
```

---

# 201. smart-queue.md

อธิบาย:

```text
Pao queue vs Comfy queue
dispatch window
ownership
```

---

# 202. tuning.md

include examples:

```text
small local GPU
24GB GPU
video batch
large backlog
```

อย่า claim one threshold fits all

---

# 203. troubleshooting.md

cases:

```text
queue stuck
job duplicated
external prompts
provider offline
RunPod not scaling
cost guard blocked
model locality mismatch
```

---

# 204. Admin Diagnostic

button:

```text
Smart Queue Diagnostics
```

---

# 205. Diagnostic Output

```text
[OK] Scheduler leader
[OK] Local ComfyUI reachable
[INFO] 1 running
[WARN] 49 queued
[INFO] Estimated local drain: ...
[OK] RunPod available
[OK] Cost Guard allows burst
[INFO] Recommended cloud slots: 2
[OK] No ownership conflicts
```

---

# 206. CLI

ถ้ามี CLI:

```text
pao queue status
pao queue plan
pao queue diagnose
pao queue pause
pao queue resume
pao queue reconcile
```

---

# 207. Dry Run

```text
pao queue plan --dry-run
```

ห้าม provision

---

# 208. Simulation Tool

dev/admin:

input:

```text
49 backlog
runtime 4 min
max cloud 2
```

แสดง plan

---

# 209. Acceptance Scenario — Real Screenshot Class

Given:

```text
ComfyUI active = 50
running = 1
queued = 49
provider slots = 1
workload = heavy video
```

System must:

1. Detect backlog high
2. Estimate local drain
3. Detect batch affinity
4. Keep running job untouched
5. Avoid stuffing additional 49 jobs into native queue
6. Produce scale plan
7. Pass Phase 20 cost guard
8. Reuse warm cloud if available
9. Provision only required allowed slots
10. Dispatch incrementally
11. Track execution attempt per job
12. Pull outputs
13. Continue Phase 19 reviewer pipeline
14. Drain cloud after backlog
15. Stop idle RunPod
16. Record cost/throughput

---

# 210. Definition of Done — Queue Intelligence

- [ ] Queue Observer works
- [ ] Running/Pending normalized
- [ ] Pao/External ownership recognized
- [ ] Backlog metrics
- [ ] Drain estimate
- [ ] Runtime predictor
- [ ] Queue pressure
- [ ] Arrival/completion metrics

---

# 211. Definition of Done — Scheduling

- [ ] Persistent backlog remains in Pao queue
- [ ] Dispatch window
- [ ] Per-provider pending cap
- [ ] Batch affinity
- [ ] Fairness
- [ ] Age boost
- [ ] Batch chunking
- [ ] No starvation
- [ ] No duplicate dispatch

---

# 212. Definition of Done — Cloud Burst

- [ ] Burst policy
- [ ] Scale plan
- [ ] Phase 20 router reuse
- [ ] Cost Guard reuse
- [ ] Warm Pod reuse
- [ ] New Pod scale-up
- [ ] Hysteresis
- [ ] Cooldowns
- [ ] Progressive scaling
- [ ] Budget reservation

---

# 213. Definition of Done — Scale-In

- [ ] Drain mode
- [ ] No new dispatch
- [ ] Busy Pod protected
- [ ] idle detection
- [ ] auto stop
- [ ] queue drained event
- [ ] no scaling thrash

---

# 214. Definition of Done — Reconciliation

- [ ] Prompt ID mapping
- [ ] startup reconciliation
- [ ] history recovery
- [ ] external queue read-only
- [ ] unknown queue read-only
- [ ] safe Pao reclaim
- [ ] ownership conflict handling
- [ ] no global auto clear

---

# 215. Definition of Done — UI

- [ ] Smart Queue dashboard
- [ ] cards
- [ ] provider lanes
- [ ] backlog
- [ ] batch groups
- [ ] scale plan
- [ ] burst mode
- [ ] cost
- [ ] routing reasons
- [ ] reconciliation view
- [ ] diagnostics

---

# 216. Definition of Done — Testing

- [ ] mock 1 running / 49 queued
- [ ] batch affinity
- [ ] fairness
- [ ] external queue
- [ ] scale-up
- [ ] scale-down
- [ ] no thrash
- [ ] budget block
- [ ] restart recovery
- [ ] duplicate guard
- [ ] race tests

---

# 217. Definition of Done — Engineering

- [ ] migrations
- [ ] lint
- [ ] typecheck
- [ ] unit tests
- [ ] integration tests
- [ ] frontend build
- [ ] backend tests
- [ ] docs
- [ ] `.env.example`
- [ ] no secrets
- [ ] Phase 19 still works
- [ ] Phase 20 still works

---

# 218. Implementation Order

## Step 1 — Inspect Existing Phase 19/20

Find:

```text
job queue
provider adapter
ComfyUI client
RunPod router
cost guard
lifecycle
telemetry
DB
UI
MCP
```

---

## Step 2 — Queue Normalization

build observer/snapshot

---

## Step 3 — Ownership Mapping

Pao job ↔ prompt ID

---

## Step 4 — Dispatch Window

change batch submit behavior

---

## Step 5 — Runtime Telemetry

collect timings

---

## Step 6 — Predictor

historical estimate

---

## Step 7 — Backlog Analyzer

drain/pressure

---

## Step 8 — Batch Affinity

grouping

---

## Step 9 — Scheduler

fairness/priority

---

## Step 10 — Burst Planner

desired slots

---

## Step 11 — Phase 20 Integration

router + cost + lifecycle

---

## Step 12 — Scale-In

drain/stop

---

## Step 13 — Reconciliation

existing queue/restart

---

## Step 14 — UI

dashboard/settings

---

## Step 15 — MCP / Events

safe controls

---

## Step 16 — Tests

full scenarios

---

## Step 17 — Docs

complete

---

## Step 18 — Verification

run:

```text
install
migration
lint
format
typecheck
tests
frontend build
backend tests
```

fix all Phase 20.1 errors

---

# 219. Do Not Implement Incorrectly

ห้าม:

```text
if queue > 10: create 5 pods
```

แบบ hardcode

ห้าม:

```text
clear ComfyUI queue
```

อัตโนมัติ

ห้าม:

```text
submit all jobs to all GPUs
```

ห้าม:

```text
duplicate job when timeout
```

ห้าม:

```text
terminate provider while output syncing
```

---

# 220. Desired End State

จาก:

```text
ComfyUI
1 running
49 queued
```

ไปเป็น:

```text
Pao Backlog
43 waiting

Local
1 running
1 prefetch

RunPod #1
1 running
1 prefetch

RunPod #2
1 running
1 prefetch
```

จากนั้น scheduler dispatchต่อเมื่อ slotว่าง

---

# 221. Dynamic Drain Example

```text
T0
49 backlog
Local 1
Cloud 0

T1
Scale Plan → Cloud 2

T2
Local 1
Cloud 2
3 running total

T3
Backlog 20

T4
Backlog 5
No new scale-up

T5
Backlog 0
Cloud providers drain

T6
Cloud idle
Auto Stop

T7
Local remains ready
Cloud cost rate → 0
```

---

# 222. Final Codex Instructions

เริ่ม implement Phase 20.1 ใน Pao-hubPro repository เดิมทันที

ใช้ implementation จริงของ Phase 19/20 เป็น source of truth

ถ้าชื่อ class/table/API แตกต่างจาก specification:

```text
adapt
ไม่ duplicate
```

ห้ามหยุดที่ scaffolding

ห้ามทิ้ง critical TODO

ห้ามใช้ RunPod จริงใน automated tests

ห้าม mutate existing external ComfyUI queue โดยไม่ ownership proof

---

# 223. Codex Final Verification Report

ตอบเมื่อเสร็จ:

```text
Phase 20.1 Implementation Complete

1. Phase 19 components reused
2. Phase 20 components reused
3. Smart Queue architecture
4. Files added
5. Files modified
6. Migrations
7. Queue Observer
8. Ownership mapping
9. Dispatch window
10. Runtime predictor
11. Batch affinity
12. Burst planner
13. Scale-up
14. Scale-down
15. Cost Guard integration
16. Reconciliation
17. UI
18. MCP tools
19. Tests
20. Commands executed
21. Test results
22. Build results
23. Known limitations
24. Production rollout steps
25. Recommended next phase
```

ห้ามรายงานว่า pass ถ้ายังไม่ได้รันจริง

---

# 224. Recommended Phase 20.2

หลัง Phase 20.1 เสถียร:

```text
Phase 20.2 — Pao Distributed ComfyUI Model Cache
× Network Volume Sync
× Zero-Download Warm Start
```

focus:

```text
shared models
LoRA
custom nodes
workflow cache
model manifests
checksum
network volume locality
fast cold-start
```

**ห้าม implement Phase 20.2 ในงานนี้**

---

# Final Goal

Phase 20.1 ต้องทำให้ Pao-hubPro เปลี่ยนจากระบบที่:

```text
โยนงานทั้งหมดเข้า ComfyUI
แล้วรอคิว
```

เป็นระบบที่:

```text
เก็บ backlogไว้ที่ Pao-hubPro
↓
รู้ว่า GPU แต่ละตัวกำลังทำอะไร
↓
รู้ว่า queue จะใช้เวลาอีกเท่าไร
↓
รู้ว่างานไหนควรอยู่ GPU เดียวกัน
↓
รู้ว่าเมื่อไรควรเปิด RunPod
↓
รู้ว่าควรเปิดกี่ตัว
↓
รู้ว่า budget อนุญาตไหม
↓
dispatch ทีละพอดี
↓
ไม่สร้างงานซ้ำ
↓
ไม่ยุ่งงาน external
↓
scale-in เมื่อคิวลด
↓
หยุด cloud เมื่อคิวหมด
```

ผลลัพธ์สุดท้าย:

```text
Higher Throughput
Lower Queue Wait
Lower Model Reload
Controlled Cloud Cost
No Duplicate Jobs
Safe ComfyUI Integration
Automatic Cloud Burst
Automatic Scale-In
Production-grade Observability
```

---

# End of Phase 20.1 Specification

**Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler**
