# Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router

> **Project:** Pao-hubPro  
> **Phase:** 20  
> **Depends on:** Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator  
> **Status:** Implementation Specification / Codex One-Shot Build Prompt  
> **Primary Goal:** เพิ่ม Cloud GPU orchestration ให้ Pao-hubPro สามารถเลือก Local ComfyUI หรือ RunPod GPU โดยอัตโนมัติ พร้อม Provision Pod, ตรวจสุขภาพ, route workload ตาม VRAM/โมเดล/ราคา, sync model/workflow, ดึงผลลัพธ์, failover และหยุด Pod อัตโนมัติเพื่อลดค่าใช้จ่าย  
> **RunPod Reference Template:** `hs44di56w7`  
> **Reference Deploy URL:** `https://console.runpod.io/deploy?template=hs44di56w7`  
> **Important:** `ref=` referral parameter ไม่ใช่ส่วนของ runtime integration และห้ามนำไป hardcode ในระบบ  
> **Implementation Rule:** Phase นี้ต้อง **ต่อยอด Pao-hubPro repository เดิมและ Phase 19 เดิม** เท่านั้น ห้ามสร้างโปรเจกต์ใหม่

---

# 0. Mission สำหรับ Codex

คุณคือ Senior Staff Engineer, Distributed Systems Engineer, GPU Infrastructure Engineer, FinOps Engineer, Security Engineer และ MLOps Architect ที่กำลังทำงานใน repository **Pao-hubPro**

งานของคุณคือ implement:

```text
Phase 20
Pao Multi-GPU Generation Grid
×
RunPod Intelligent Workload Router
```

ให้ใช้งานจริงแบบ end-to-end

เป้าหมายคือทำให้ Phase 19:

```text
Generation Job
    ↓
ComfyUI Provider
    ↓
Local GPU
```

กลายเป็น:

```text
Generation Job
    ↓
Workload Analyzer
    ↓
GPU Requirement Resolver
    ↓
Cost / Availability / Model Locality Router
    ↓
┌─────────────────────────────────────┐
│ Local ComfyUI                       │
│ Existing Remote ComfyUI             │
│ RunPod On-Demand Pod                │
│ Future RunPod Serverless            │
│ Future Other GPU Providers          │
└─────────────────────────────────────┘
    ↓
Generation
    ↓
Result Pull / Asset Sync
    ↓
Phase 19 Reviewer Council
    ↓
Adobe Stock QC
    ↓
Metadata
    ↓
Export
```

---

# 1. กฎสำคัญ

1. ห้ามสร้าง repository ใหม่
2. ห้ามสร้าง Generation subsystem ซ้ำกับ Phase 19
3. ต้อง inspect Phase 19 implementation จริงก่อนแก้
4. ต้อง reuse:
   - Job Orchestrator
   - Provider abstraction
   - Workflow Registry
   - Model Registry
   - Asset Storage
   - Reviewer Council
   - Adobe Stock Mode
   - Metadata
   - Export
   - MCP
   - Auth/RBAC
   - Audit Log
5. Phase 20 มีหน้าที่ขยาย **Provider + Routing + GPU Lifecycle + Cost Management**
6. ห้าม hardcode RunPod API key
7. ห้าม hardcode Pod ID
8. ห้าม hardcode GPU availability
9. ห้าม hardcodeราคาปัจจุบันเป็น source of truth
10. ราคาต้องอ่านจาก RunPod/API response หรือ persisted observation ที่มี timestamp
11. ห้ามเปิด ComfyUI public endpoint โดยไม่มี security control
12. ห้ามเก็บ RunPod API key ลง database แบบ plaintext
13. ห้าม log API key
14. ต้องรองรับ API failure
15. ต้องรองรับ GPU shortage
16. ต้องรองรับ Pod start failure
17. ต้องรองรับ ComfyUI boot ช้า
18. ต้องรองรับ model download ช้า
19. ต้องรองรับ job cancellation
20. ต้องมี Auto Stop / Idle Shutdown
21. ต้องมี Cost Guard ก่อน provision
22. ต้องมี Emergency Kill
23. ต้องมี audit log สำหรับ cloud resource changes
24. ต้องมี tests โดยไม่จำเป็นต้องใช้เงินจริงใน CI
25. ต้องมี mock RunPod API
26. ต้องไม่ลบ/terminate resource โดยผิด Pod
27. destructive cloud operations ต้องมี ownership/tag verification
28. ต้องรองรับ Windows host สำหรับ Pao-hubPro
29. ต้องรองรับ Linux deployment
30. ต้อง fail closed ในเรื่อง cost/security แต่ fail gracefully ต่อ application หลัก

---

# 2. Verified RunPod REST API Baseline

ณ วันที่จัดทำ Phase 20 ให้ถือ REST API เป็น integration หลัก:

```text
Base URL:
https://rest.runpod.io/v1
```

Authentication:

```http
Authorization: Bearer <RUNPOD_API_KEY>
```

Endpoints ที่ Phase นี้ต้องรองรับตาม API ปัจจุบัน:

```text
GET    /pods
GET    /pods/{podId}
POST   /pods
POST   /pods/{podId}/start
POST   /pods/{podId}/stop
DELETE /pods/{podId}

GET    /templates
GET    /templates/{templateId}

GET    /networkvolumes
GET    /networkvolumes/{networkVolumeId}

GET    /billing/pods
```

RunPod ยังมี GraphQL API แต่ Phase 20 ให้ **REST API เป็น default integration** เพื่อให้ implementation ง่าย, typed และ testable

GraphQL สามารถทำ adapter เพิ่มในอนาคตได้ แต่ห้ามสร้างสอง implementation โดยไม่จำเป็น

---

# 3. Current RunPod Concepts ที่ต้องเข้าใจ

## 3.1 Pod

Pod คือ GPU compute instance ที่สามารถ:

```text
create
start
stop
delete/terminate
```

Phase 20 ต้องแยก semantics ชัดเจน:

```text
STOP
=
หยุด compute
อาจยังมี storage cost
resource สามารถ resume ได้

DELETE / TERMINATE
=
ลบ Pod
ข้อมูลที่ไม่ได้อยู่ persistent/network storage อาจหาย
```

ห้ามใช้ terminate แทน stop โดย default

---

# 4. Network Volume

RunPod Network Volume เป็น persistent storage ที่อยู่แยกจาก compute

เป้าหมายใน Phase 20:

```text
Models
LoRA
Custom Nodes
ComfyUI
Cache
Shared Inputs
Shared Outputs (optional)
```

สามารถอยู่ใน persistent storage เพื่อ:

```text
ลด cold start
ลด download ซ้ำ
ลด bandwidth
ลดเวลา boot
```

Phase 20 ต้องรองรับทั้ง:

```text
No network volume
Local Pod volume
RunPod Network Volume
```

ห้าม assume ว่าทุก account/datacenter มี Network Volume

---

# 5. Reference Template

ผู้ใช้มี RunPod template:

```text
hs44di56w7
```

ให้ Phase 20 รองรับ profile:

```text
PAO_RUNPOD_DEFAULT_TEMPLATE_ID=hs44di56w7
```

แต่:

- ห้าม hardcodeใน source
- ต้อง config ผ่าน settings/env
- ต้อง query template metadata เมื่อ credential พร้อม
- ต้อง validateว่า template ใช้งานได้
- ต้องตรวจ ports
- ต้องตรวจ image
- ต้องตรวจ mount path
- ต้องตรวจว่าเป็น Pod template หรือ Serverless template
- ต้องแสดงข้อมูลให้ admin review

หาก template ไม่พร้อม:

```text
Provider state = template_invalid
```

ห้าม provision แบบเดา

---

# 6. Target Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                         Pao-hubPro                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 19 Generation Studio                                  │
│          │                                                   │
│          ▼                                                   │
│  Generation Job Orchestrator                                 │
│          │                                                   │
│          ▼                                                   │
│  Phase 20 Workload Analyzer                                  │
│          │                                                   │
│          ├── Required VRAM                                   │
│          ├── Required Model                                  │
│          ├── Workflow Capability                             │
│          ├── Job Priority                                    │
│          ├── Deadline / Urgency                              │
│          ├── Estimated Runtime                               │
│          └── Budget Policy                                   │
│          │                                                   │
│          ▼                                                   │
│  Intelligent Workload Router                                 │
│          │                                                   │
│  ┌───────┼────────────┬───────────────┬──────────────────┐   │
│  ▼       ▼            ▼               ▼                  │   │
│ Local   Remote       RunPod          Future              │   │
│ GPU     ComfyUI      Pods            Serverless          │   │
│          │            │                                  │   │
│          │      Cloud Resource Manager                   │   │
│          │            │                                  │   │
│          │      ┌─────┼──────┐                           │   │
│          │      ▼     ▼      ▼                           │   │
│          │    Create Start  Stop/Delete                  │   │
│          │            │                                  │   │
│          │            ▼                                  │   │
│          │     ComfyUI Bootstrap                         │   │
│          │            │                                  │   │
│          │            ▼                                  │   │
│          │      Health / Ready                           │   │
│          │            │                                  │   │
│          └────────────┴──────────┐                       │   │
│                                 ▼                       │   │
│                         Generation Execution             │   │
│                                 │                       │   │
│                                 ▼                       │   │
│                         Asset Synchronizer               │   │
│                                 │                       │   │
│                                 ▼                       │   │
│                  Phase 19 Review / Stock / Export        │   │
└──────────────────────────────────────────────────────────────┘
```

---

# 7. Phase 20 New Modules

Codex ต้องปรับเข้ากับ architecture จริง

logical modules แนะนำ:

```text
generation/
  routing/
    workload_analyzer
    requirement_resolver
    provider_ranker
    router
    policies

  cloud/
    runpod/
      client
      api_types
      pod_manager
      template_manager
      volume_manager
      billing
      readiness
      bootstrap
      security
      mock

  gpu/
    catalog
    capability
    vram
    benchmark
    locality

  cost/
    estimator
    budget_policy
    meter
    guard
    idle_shutdown

  sync/
    model_sync
    workflow_sync
    input_sync
    output_sync

  scheduler/
    placement
    leases
    lifecycle
```

ห้าม duplicate domain objects ของ Phase 19

---

# 8. New Domain Objects

## 8.1 ComputeProviderInstance

```text
id
provider_id
provider_type
external_id
name
lifecycle_state
health_state
gpu_type
gpu_count
gpu_memory_gb
region
datacenter_id
template_id
network_volume_id
base_url
internal_metadata
created_at
started_at
ready_at
last_seen_at
stopped_at
terminated_at
ownership_token
```

---

# 9. GPUCapabilityProfile

```text
id
gpu_type_id
display_name
vram_gb
architecture
provider
supports_cuda
allowed_workload_classes
observed_price_per_hour
price_observed_at
benchmark_score
enabled
notes
```

ราคาต้องมี:

```text
price_observed_at
```

เสมอ

เพื่อไม่ให้ค่าราคาเก่าถูกแสดงเป็นราคาปัจจุบันโดยไม่มีบริบท

---

# 10. WorkloadRequirement

สร้างจาก job + workflow + model:

```text
job_id
workflow_id
model_id
job_type
min_vram_gb
preferred_vram_gb
gpu_count
min_cuda
required_models
required_loras
required_custom_nodes
estimated_runtime_seconds
estimated_input_bytes
estimated_output_bytes
priority
deadline
stock_mode
requires_persistent_cache
```

---

# 11. PlacementDecision

```text
id
job_id
selected_provider
selected_instance
selected_gpu
decision_score
estimated_hourly_cost
estimated_job_cost
cold_start_penalty
queue_penalty
model_locality_score
availability_score
cost_score
performance_score
reason
alternatives
created_at
```

ต้องเก็บ reason เพื่อ audit/debug

---

# 12. CloudResourceLease

ป้องกัน worker/agent หลายตัวจัดการ Pod เดียวกัน

```text
id
resource_type
resource_id
owner
lease_token
acquired_at
expires_at
heartbeat_at
```

ทุก destructive action ต้องตรวจ lease/ownership

---

# 13. RunPodPodRecord

persist mapping:

```text
id
runpod_pod_id
template_id
gpu_type
gpu_count
datacenter_id
network_volume_id
desired_state
actual_state
cost_per_hour
created_by_pao
ownership_marker
current_job_id
last_active_at
idle_since
created_at
updated_at
```

---

# 14. Provider Abstraction Extension

Phase 19 น่าจะมี:

```text
GenerationProvider
```

Phase 20 ให้เพิ่ม lifecycle-capable interface เช่น:

```text
ElasticGenerationProvider
```

methods:

```text
discover_capacity()
estimate_cost()
provision()
start()
wait_ready()
health_check()
execute()
stop()
terminate()
get_billing()
sync_assets()
```

ComfyUI execution interface และ cloud lifecycle interface ควรแยก concerns

---

# 15. RunPod REST Client

สร้าง typed client

configuration:

```env
PAO_RUNPOD_ENABLED=false
PAO_RUNPOD_API_BASE_URL=https://rest.runpod.io/v1
PAO_RUNPOD_API_KEY=
PAO_RUNPOD_DEFAULT_TEMPLATE_ID=hs44di56w7
```

client ต้อง:

- timeout
- retry
- exponential backoff
- rate-limit awareness
- JSON validation
- redaction
- request IDs
- typed error
- cancellation support

ห้ามใช้ raw `requests` กระจายทั่ว codebase

---

# 16. RunPod API Operations

ขั้นต่ำ implement:

```text
list_pods()
get_pod()
create_pod()
start_pod()
stop_pod()
delete_pod()

list_templates()
get_template()

list_network_volumes()
get_network_volume()

get_pod_billing()
```

---

# 17. Create Pod Payload

รองรับ fields ที่จำเป็น เช่น:

```json
{
  "name": "pao-gen-...",
  "templateId": "hs44di56w7",
  "gpuTypeIds": [
    "NVIDIA GeForce RTX 4090"
  ],
  "gpuCount": 1
}
```

แต่ actual payload ต้อง derive จาก:

```text
RunPodDeploymentProfile
```

ไม่เขียน payload กระจายตาม service

---

# 18. RunPodDeploymentProfile

สร้าง config object:

```text
id
name
template_id
allowed_gpu_types
gpu_count
cloud_type
container_disk_gb
volume_gb
network_volume_id
volume_mount_path
ports
env_overrides
datacenter_ids
country_codes
global_networking
enabled
```

ตัวอย่าง:

```yaml
id: pao-comfy-default
name: Pao ComfyUI Default
template_id: hs44di56w7

allowed_gpu_types:
  - NVIDIA GeForce RTX 4090
  - NVIDIA GeForce RTX 5090
  - NVIDIA RTX A6000
  - NVIDIA A40

gpu_count: 1
volume_mount_path: /workspace
enabled: true
```

อย่า assume GPU list นี้พร้อมใช้งานทุกเวลา

---

# 19. GPU Catalog

Phase 20 ต้องมี dynamic GPU catalog

ให้ source จาก provider API ถ้าทำได้

อย่างน้อย model ต้องรองรับ GPU examples:

```text
RTX 3090      24 GB
RTX 3090 Ti   24 GB
A30           24 GB
A40           48 GB
A100          80 GB
RTX A6000     48 GB
L40 / L40S
RTX 4090
RTX 5090
H100
H200
B200
```

ห้ามกำหนด VRAM ของ GPU ที่ไม่ยืนยันจาก source/runtime แล้วใช้เป็นข้อเท็จจริงเด็ดขาด

ใช้ provider metadata เป็น source of truth

---

# 20. Workload Classes

สร้าง classification:

```text
LIGHT_IMAGE
STANDARD_IMAGE
HEAVY_IMAGE
IMAGE_EDIT
UPSCALE_IMAGE
LIGHT_VIDEO
HEAVY_VIDEO
VIDEO_UPSCALE
AUDIO
VISION
BATCH
```

mapping จาก workflow registry

---

# 21. VRAM Requirement Resolver

Workflow / Model Registry จาก Phase 19 ต้องเพิ่ม:

```text
min_vram_gb
recommended_vram_gb
preferred_gpu_types
supports_cpu_offload
supports_low_vram
expected_runtime_class
```

ตัวอย่าง logic:

```text
required_vram
=
max(
  workflow_min_vram,
  model_min_vram,
  operation_min_vram
)
```

เพิ่ม safety margin config:

```env
PAO_GPU_VRAM_SAFETY_MARGIN_GB=2
```

---

# 22. Router Goals

Router ต้อง balance:

```text
Cost
Performance
Availability
Queue Time
Cold Start
Model Locality
Job Priority
Reliability
```

ไม่เลือก "GPU ที่แรงที่สุด" เสมอ

---

# 23. Placement Scoring

ตัวอย่าง score:

```text
total_score =
  availability_weight * availability_score +
  locality_weight     * model_locality_score +
  performance_weight  * performance_score +
  cost_weight         * cost_score +
  queue_weight        * queue_score +
  reliability_weight  * reliability_score
  - cold_start_penalty
```

weights ต้อง config ได้

---

# 24. Default Routing Policy

แนะนำ:

```text
1. ใช้ Local GPU ก่อน ถ้า:
   - healthy
   - มี model
   - VRAM พอ
   - queue ไม่ยาวเกิน threshold

2. ใช้ Existing Warm RunPod ก่อนสร้าง Pod ใหม่

3. ถ้าไม่มี capacity:
   - evaluate RunPod GPU candidates

4. เลือก GPU ที่:
   - VRAM ผ่าน
   - ราคาอยู่ใน budget
   - availability สูง
   - model locality ดี

5. Provision

6. ถ้า provision ล้ม:
   - try next candidate

7. ถ้าทุก candidate ล้ม:
   - job → waiting_capacity
   ไม่ใช่ failed ทันที
```

---

# 25. New Job States

Extend Phase 19:

```text
waiting_capacity
selecting_provider
provisioning
starting_provider
syncing_runtime
waiting_provider_ready
routing
```

full example:

```text
queued
↓
validating
↓
selecting_provider
↓
waiting_capacity
↓
provisioning
↓
starting_provider
↓
syncing_runtime
↓
waiting_provider_ready
↓
generating
↓
post_processing
↓
reviewing
↓
qc
↓
metadata
↓
exporting
↓
completed
```

---

# 26. RunPod Pod Lifecycle State Machine

```text
unknown
creating
provisioned
starting
booting
initializing_comfyui
syncing_models
ready
busy
idle
stopping
stopped
starting_again
terminating
terminated
failed
```

ต้อง map actual RunPod status เข้า normalized state

---

# 27. Provisioning Flow

```text
Job requires cloud
↓
Resolve Deployment Profile
↓
Resolve GPU Candidates
↓
Cost Guard
↓
Acquire Provisioning Lock
↓
POST /pods
↓
Persist RunPod Pod ID immediately
↓
Poll GET /pods/{id}
↓
Wait running
↓
Discover public/proxy endpoint
↓
Wait ComfyUI health
↓
Validate workflow/model
↓
Mark ready
↓
Assign job
```

ห้าม execute generation ก่อน readiness สำเร็จ

---

# 28. Pod Naming

ชื่อ resource ต้อง trace ได้:

```text
pao-gen-<env>-<short-job-id>-<timestamp>
```

เช่น:

```text
pao-gen-prod-a1b2c3-20260906
```

ห้ามใส่ prompt/user private data ลงชื่อ Pod

---

# 29. Ownership Marker

ทุก Pod ที่ Pao-hubPro สร้างต้องมี ownership record ฝั่ง Pao-hubPro

ก่อน:

```text
stop
terminate
update
```

ต้อง verify:

```text
pod exists
pod id matches DB record
created_by_pao = true
ownership marker valid
```

ห้าม terminate Pod ที่ user สร้างเองโดย default

---

# 30. Imported RunPod Pods

รองรับ:

```text
Managed Pod
Imported Pod
External Pod
```

Managed:

```text
Pao-hubPro สร้างและควบคุม lifecycle
```

Imported:

```text
ผู้ใช้เพิ่ม Pod ID มาให้
Pao-hubPro ใช้งานได้
แต่ destructive operation ต้อง opt-in
```

---

# 31. Readiness Probe

อย่าใช้แค่ RunPod state = RUNNING

ต้อง probe application:

```text
1. Pod exists
2. Pod running
3. HTTP endpoint reachable
4. ComfyUI responds
5. Required workflow endpoint works
6. Required model available
```

Normalized:

```text
compute_ready
runtime_ready
model_ready
```

---

# 32. ComfyUI Remote Endpoint

อย่า assume URL shape เดียว

สร้าง endpoint resolver abstraction

```text
RunPodEndpointResolver
```

result:

```text
base_url
ws_url
connection_method
tls
auth_mode
```

ถ้าไม่สามารถ discover safely ให้ require explicit profile configuration

---

# 33. Security of Remote ComfyUI

ห้ามถือว่า ComfyUI public endpoint ปลอดภัย

Phase 20 ต้องรองรับ:

```text
provider token
reverse proxy auth
RunPod proxy URL
private/global networking mode
custom auth header
```

ห้ามเปิด raw ComfyUI port โดยไม่มี auth ถ้าสามารถหลีกเลี่ยงได้

---

# 34. API Key Storage

RunPod API key ต้องใช้ secret mechanism เดิมของ Pao-hubPro

ถ้าไม่มี:

ขั้นต่ำ:

```text
.env
OS environment
secret file permission
```

ห้ามเก็บ plaintext ลง client-accessible config

UI:

```text
RUNPOD API KEY
••••••••••••
```

ต้องไม่ส่ง key กลับ frontend หลัง save

---

# 35. API Key Validation

Settings → RunPod:

```text
Save Key
↓
Test Connection
↓
GET /pods หรือ endpoint read-only
↓
Success/Failure
```

ห้าม create Pod เพื่อ test credential

---

# 36. Cost Guard

ก่อนสร้าง cloud resource:

```text
estimated_hourly_cost
estimated_runtime
estimated_job_cost
current_daily_spend
current_monthly_spend
budget_remaining
```

ต้องประเมิน

---

# 37. Budget Policies

รองรับ:

```text
max_gpu_price_per_hour
max_estimated_cost_per_job
daily_budget
monthly_budget
max_concurrent_cloud_pods
max_total_gpu_count
```

env example:

```env
PAO_RUNPOD_MAX_GPU_PRICE_PER_HOUR=1.50
PAO_RUNPOD_MAX_ESTIMATED_COST_PER_JOB=2.00
PAO_RUNPOD_DAILY_BUDGET=10.00
PAO_RUNPOD_MONTHLY_BUDGET=100.00
PAO_RUNPOD_MAX_ACTIVE_PODS=2
```

ค่าตัวอย่างไม่ใช่ข้อบังคับ

---

# 38. Budget Decision

```text
ALLOW
WARN
BLOCK
REQUIRE_APPROVAL
```

ตัวอย่าง:

```text
estimated cost <= soft threshold
→ ALLOW

soft < cost <= hard
→ WARN/REQUIRE_APPROVAL

cost > hard
→ BLOCK
```

---

# 39. Budget Overrides

Admin สามารถ override:

```text
reason required
actor recorded
audit logged
expiry
```

ห้าม override ถาวรแบบเงียบ ๆ

---

# 40. Cost Estimation

```text
estimated_job_cost =
estimated_runtime_hours
*
current_observed_gpu_hourly_price
+
estimated_storage_component
```

ต้องแสดงว่าเป็น estimate

ไม่เรียกว่า final cost

---

# 41. Actual Cost Metering

ใช้:

```text
GET /billing/pods
```

sync billing periodically

persist:

```text
provider
pod_id
gpu_type
period
amount
time_billed_ms
observed_at
```

---

# 42. FinOps Dashboard

สร้าง:

```text
AI Studio
→ Compute
→ Cost
```

แสดง:

```text
Today
This Week
This Month
By GPU
By Project
By Workflow
By Model
By Job
```

ถ้าข้อมูล mapping ไม่สมบูรณ์ต้อง label:

```text
unattributed
```

---

# 43. Cost Per Asset

ถ้า job batch 4:

```text
job cost
↓
allocation
↓
asset cost estimate
```

field:

```text
estimated_compute_cost
actual_compute_cost
```

ช่วยตัดสิน model profitability สำหรับ Adobe Stock

---

# 44. Idle Shutdown

สำคัญที่สุดด้านค่าใช้จ่าย

config:

```env
PAO_RUNPOD_IDLE_STOP_MINUTES=10
PAO_RUNPOD_IDLE_TERMINATE_MINUTES=60
```

policy:

```text
busy
↓
job done
↓
idle timer
↓
stop
↓
long-term idle
↓
terminate only if safe policy allows
```

---

# 45. Stop vs Terminate Policy

Default:

```text
stop_after_idle = true
terminate_after_idle = false
```

terminate ต้อง opt-in

เพราะข้อมูล local Pod storage อาจสูญหาย

---

# 46. Persistent Resource Policy

resource ที่มี:

```text
network volume
```

สามารถ terminate compute ได้ง่ายกว่า

resource ที่ไม่มี persistent storage:

```text
prefer stop
```

จน sync outputs/checkpoint เสร็จ

---

# 47. Emergency Kill

Admin UI:

```text
STOP ALL PAO MANAGED RUNPOD COMPUTE
```

ทำ:

- stop accepting cloud jobs
- cancel provisioning
- stop managed pods
- preserve network volumes
- audit action

แยกจาก:

```text
TERMINATE ALL
```

ซึ่งต้อง confirmation stronger และไม่ควร default

---

# 48. Spend Circuit Breaker

ถ้า:

```text
daily spend >= hard budget
```

automatic:

```text
block new cloud provisioning
```

option:

```text
stop idle pods
```

อย่าหยุด busy Pod กลาง job เว้น policy explicit

---

# 49. Pod Leak Detector

periodically:

```text
GET /pods
```

หา Pod ที่:

```text
name starts pao-gen-
but no active record/job
```

mark:

```text
orphan_candidate
```

ห้าม auto-deleteทันที

ต้อง:

```text
warn admin
age threshold
ownership verification
optional cleanup
```

---

# 50. Reconciliation Loop

ทุก N นาที:

```text
RunPod actual state
vs
Pao-hubPro desired state
```

resolve drift

ตัวอย่าง:

```text
DB says running
RunPod says stopped
→ instance state update
→ requeue job if appropriate
```

---

# 51. Warm Pool

optional feature flag:

```env
PAO_RUNPOD_WARM_POOL_ENABLED=false
PAO_RUNPOD_WARM_POOL_MIN_READY=0
PAO_RUNPOD_WARM_POOL_MAX_READY=1
```

สำหรับลด latency

แต่ default ปิดเพื่อประหยัดเงิน

---

# 52. Warm Reuse

ถ้ามี Pod ready:

router ควร reuse ก่อน create ใหม่ ถ้า:

- GPU เหมาะ
- model พร้อม
-ไม่มี job conflict
- health ผ่าน

---

# 53. Model Locality

Provider instance ต้อง track model availability:

```text
model_id
checkpoint_path
sha256 optional
size
ready
last_verified
```

router ให้ bonus ถ้า model มีอยู่แล้ว

---

# 54. Model Sync Strategy

ลำดับ preference:

```text
1. Model already on network volume
2. Model cached on Pod persistent volume
3. Pull from authorized model source
4. Sync from approved local/object storage
```

ห้าม download model จาก random URL

---

# 55. Model Manifest

สร้าง:

```text
model-manifest.json
```

fields:

```text
model_id
filename
size
sha256
source
license
commercial_use
destination
```

sync ต้อง checksum

---

# 56. Commercial License Gate

เพราะใช้ผลิต Adobe Stock

ก่อน remote sync model:

```text
commercial_use_status
```

ต้องเป็น:

```text
allowed
reviewed
unknown
blocked
```

`blocked` ห้าม Stock Mode ใช้

`unknown` ต้อง warning/manual approval ตาม Phase 19 policy

---

# 57. LoRA Sync

เหมือน model sync:

```text
manifest
checksum
compatibility
commercial notes
```

---

# 58. Workflow Sync

workflow JSON มีขนาดเล็ก

sync:

```text
registry version
↓
workflow file
↓
checksum
↓
remote location
↓
validate
```

อย่าแก้ workflow remote โดยไม่ version

---

# 59. Custom Node Sync

ห้าม auto-install arbitrary Git repository แบบ unchecked

ต้องมี allowlist manifest:

```text
name
repo
commit/tag
checksum/lock
required_by
approved
```

prefer custom Docker image/template ที่ bake nodes ไว้แล้ว

---

# 60. Golden RunPod Template

เป้าหมายระยะ production:

```text
Pao ComfyUI Golden Template
```

ควรมี:

```text
ComfyUI
approved custom nodes
Python deps
startup scripts
health check
security proxy
model mount layout
Pao bootstrap agent
```

Template `hs44di56w7` ใช้เป็น reference/default profile ได้

แต่ Phase 20 ต้องไม่ผูก architecture กับมัน

---

# 61. Template Inspection

Admin page:

```text
RunPod Templates
```

เมื่อเลือก template:

แสดง:

```text
ID
Name
Image
Category
Ports
Container Disk
Volume
Mount Path
Serverless flag
Public/Private
```

มี:

```text
Validate for Pao
```

---

# 62. Template Validation Rules

ตรวจ:

```text
template exists
GPU category compatible
not unexpectedly serverless
volume path valid
required ComfyUI port/config present
Docker image defined
startup compatible
```

status:

```text
ready
warning
incompatible
unknown
```

---

# 63. Port Policy

ห้าม expose:

```text
22/tcp
8188/http
```

แบบ public โดยไม่จำเป็น

Phase 20 ต้องใช้ minimum exposure

ถ้าใช้ SSH ให้ explicit opt-in

---

# 64. Network Volume Support

config:

```env
PAO_RUNPOD_NETWORK_VOLUME_ID=
```

ถ้ามี:

validate:

```text
GET /networkvolumes/{id}
```

ก่อน deploy

---

# 65. Network Volume Datacenter Constraint

router ต้องรู้ว่า network volume อยู่ datacenter ไหน

เพราะ storage locality อาจจำกัด GPU placement

ดังนั้น score ต้องพิจารณา:

```text
volume locality
GPU availability
```

---

# 66. Storage Layout on RunPod

แนะนำ:

```text
/workspace/
  pao/
    comfyui/
    models/
    loras/
    custom_nodes/
    workflows/
    inputs/
    outputs/
    cache/
    manifests/
```

แต่ mount path ต้อง config ได้

---

# 67. Input Transfer

รองรับ strategies:

```text
HTTP upload
provider API
S3-compatible network volume API
shared storage
```

เลือกตาม provider capabilities

---

# 68. Output Transfer

หลัง generation:

1. verify output exists
2. capture checksum
3. copy/download to Pao-hubPro asset storage
4. verify checksum/size
5. register Phase 19 asset
6. only then mark job cloud execution complete

---

# 69. Do Not Keep Only Remote Output

Pao-hubPro ต้องถือ final asset ใน storage ที่ Phase 19 manage

RunPod เป็น compute provider

ไม่ใช่ canonical asset database

---

# 70. Temporary Remote Cleanup

หลัง successful sync:

optional cleanup:

```text
remote input
remote temp
remote generated intermediates
```

อย่าลบ:

```text
models
LoRA
approved cache
shared workflow
```

---

# 71. Failure Classes

สร้าง typed errors:

```text
RP_AUTH_FAILED
RP_API_UNAVAILABLE
RP_RATE_LIMITED
RP_TEMPLATE_NOT_FOUND
RP_TEMPLATE_INVALID
RP_GPU_UNAVAILABLE
RP_BUDGET_BLOCKED
RP_POD_CREATE_FAILED
RP_POD_START_FAILED
RP_POD_TIMEOUT
RP_RUNTIME_NOT_READY
RP_COMFYUI_UNREACHABLE
RP_MODEL_SYNC_FAILED
RP_VOLUME_NOT_FOUND
RP_OUTPUT_SYNC_FAILED
RP_STOP_FAILED
RP_TERMINATE_FAILED
RP_BILLING_SYNC_FAILED
```

---

# 72. Retry Matrix

```text
API 5xx
→ retry

network timeout
→ retry

GPU unavailable
→ next GPU candidate

template invalid
→ no retry

auth failed
→ no retry

budget blocked
→ no retry

ComfyUI boot timeout
→ inspect pod + retry readiness
→ optionally reprovision

model missing
→ sync / candidate switch

output sync interrupted
→ resume/retry sync
```

---

# 73. GPU Candidate Fallback

profile example:

```text
Priority 1: RTX 4090
Priority 2: RTX 5090
Priority 3: RTX A6000
Priority 4: A40
```

แต่ router ต้อง filter ก่อนด้วย:

```text
VRAM
availability
price limit
datacenter
network volume
model compatibility
```

---

# 74. Spot / Community / Secure Cloud

RunPod อาจมี pricing/capacity variants

Phase 20 ให้สร้าง generic:

```text
capacity_class
pricing_class
cloud_type
```

อย่า hardcode assumption ว่า spot เหมาะทุก job

---

# 75. Interruptibility

Job property:

```text
interruptible=true|false
```

stock batch สามารถเลือก interruptible ได้

critical/manual edit อาจ false

router ใช้เลือก pricing/capacity policy ในอนาคต

---

# 76. Estimated Runtime

เก็บ observed history:

```text
workflow
model
gpu_type
resolution
frames
duration
runtime_seconds
```

สร้าง moving estimate

ยิ่งใช้นาน router ยิ่งเลือก cost/performance ดีขึ้น

---

# 77. Benchmark Learning

ไม่ต้อง benchmark synthetic ทุก GPU

ใช้ real job telemetry:

```text
seconds_per_image
seconds_per_frame
seconds_per_megapixel
failure_rate
```

---

# 78. Provider Reliability

score:

```text
success_rate
startup_success_rate
average_boot_time
runtime_failure_rate
health_check_failure
```

router ใช้ reliability penalty

---

# 79. Cold Start Penalty

รวม:

```text
pod provisioning
container boot
ComfyUI load
model load
model download
custom node initialization
```

warm Pod ได้ score ดีกว่า

---

# 80. Local GPU Preference

เพิ่ม setting:

```env
PAO_GPU_PREFER_LOCAL=true
```

Local ใช้ก่อนถ้า:

- VRAM ผ่าน
- healthy
- queue delay ไม่เกิน threshold
- ไม่ขัด SLA

---

# 81. Cloud Burst

ใช้ RunPod เมื่อ:

```text
local queue > threshold
or
required VRAM > local
or
video workload
or
urgent batch
```

setting:

```env
PAO_CLOUD_BURST_QUEUE_THRESHOLD=3
```

---

# 82. Queue Prediction

ถ้ามี telemetry:

```text
expected local wait
vs
RunPod boot + execution
```

เลือก completion time ต่ำสุดภายใต้ budget

---

# 83. Routing Modes

UI:

```text
AUTO
LOCAL_ONLY
CLOUD_ONLY
CHEAPEST
FASTEST
BALANCED
```

definitions:

### AUTO/BALANCED

cost/performance weighted

### LOCAL_ONLY

ห้าม cloud

### CLOUD_ONLY

ไม่ใช้ local

### CHEAPEST

minimize estimated cost

### FASTEST

minimize expected completion timeภายใต้ hard budget

---

# 84. Job Override

Generate page:

```text
Compute:
[Auto ▼]
```

options:

```text
Auto
Local
RunPod
Specific Provider
```

admin/advanced user เท่านั้นสำหรับ specific provider

---

# 85. Cloud Approval Mode

setting:

```env
PAO_RUNPOD_REQUIRE_APPROVAL=false
```

ถ้า true:

job state:

```text
awaiting_cloud_approval
```

UI แสดง estimate ก่อน:

```text
GPU
Hourly price
Estimated runtime
Estimated cost
```

---

# 86. Auto Provision

```env
PAO_RUNPOD_AUTO_PROVISION=true
```

ถ้า false:

Pao-hubPro ใช้เฉพาะ imported/warm Pod

---

# 87. Auto Stop

```env
PAO_RUNPOD_AUTO_STOP=true
```

ควร default true

---

# 88. Auto Terminate

```env
PAO_RUNPOD_AUTO_TERMINATE=false
```

ควร default false

---

# 89. Safe Stop Preconditions

ก่อน stop:

```text
no active job
no pending output sync
no model sync
no unflushed telemetry
no worker lease
```

---

# 90. Safe Terminate Preconditions

เพิ่ม:

```text
all outputs synced
persistent data verified
ownership verified
termination policy allows
retention timer reached
```

---

# 91. Lifecycle Worker

สร้าง background worker:

```text
CloudLifecycleManager
```

responsibilities:

```text
provision
start
observe
ready
idle
stop
resume
terminate
reconcile
```

ไม่ให้ API controller ทำ long-running lifecycle loop

---

# 92. Polling

ใช้ exponential/adaptive polling

อย่ายิง:

```text
GET /pods/{id}
```

ถี่เกิน

config:

```env
PAO_RUNPOD_POLL_MIN_SECONDS=2
PAO_RUNPOD_POLL_MAX_SECONDS=15
```

---

# 93. Timeouts

```env
PAO_RUNPOD_CREATE_TIMEOUT_SECONDS=300
PAO_RUNPOD_START_TIMEOUT_SECONDS=300
PAO_RUNPOD_RUNTIME_READY_TIMEOUT_SECONDS=900
PAO_RUNPOD_MODEL_SYNC_TIMEOUT_SECONDS=3600
```

ต้อง config

---

# 94. Heartbeat

Instance heartbeat:

```text
RunPod API state
ComfyUI health
worker activity
```

---

# 95. Instance Health States

```text
unknown
healthy
degraded
unreachable
runtime_failed
provider_failed
```

---

# 96. Drain Mode

Admin สามารถ:

```text
Drain
```

ผล:

- ไม่รับ job ใหม่
- job ปัจจุบันทำต่อ
- เสร็จแล้ว idle/stop

เหมาะกับ maintenance

---

# 97. Provider Maintenance

RunPod หรือ datacenter มีปัญหา:

router ห้าม assign ใหม่

existing job:

```text
retry/failover according policy
```

---

# 98. Failover

กรณี Pod fail:

```text
Job
↓
mark execution interrupted
↓
verify no final output
↓
release provider lease
↓
select next provider
↓
requeue
```

---

# 99. Seed Reproducibility

failover ต้องใช้:

```text
resolved seed เดิม
workflow version เดิม
model version เดิม
parameters เดิม
```

เพื่อให้ผล reproducible เท่าที่ model/framework ทำได้

---

# 100. Duplicate Output Guard

ก่อน register result:

```text
sha256
job execution attempt id
```

ป้องกัน retry แล้ว asset ซ้ำ

---

# 101. ExecutionAttempt

เพิ่ม entity:

```text
id
job_id
attempt
provider
instance_id
gpu_type
started_at
completed_at
runtime_seconds
estimated_cost
actual_cost
status
error
```

---

# 102. Cost Attribution

billing record → pod → execution attempt → job → project

ถ้า overlap:

ใช้ proportional allocation ตาม runtime

label estimate ถ้าไม่สามารถ exact

---

# 103. RunPod Settings UI

```text
Settings
→ AI Studio
→ RunPod
```

sections:

```text
Connection
Template
GPU Policy
Budget
Lifecycle
Storage
Security
Advanced
```

---

# 104. Connection UI

fields:

```text
Enabled
API Key
API Base URL
Test Connection
```

display:

```text
Connected
Last checked
Pods visible
Templates visible
```

---

# 105. Template UI

fields:

```text
Default Template ID
hs44di56w7

[Inspect Template]
[Validate]
```

display metadata

---

# 106. GPU Policy UI

```text
Routing Mode
Allowed GPUs
Blocked GPUs
Min VRAM
Max $/hr
Secure/Community preference
Preferred Datacenters
```

---

# 107. Budget UI

cards:

```text
Today Spend
Monthly Spend
Budget Remaining
Current Active Cost/hr
```

limits editable by admin

---

# 108. Pod Manager UI

page:

```text
AI Studio → Compute → RunPod
```

table:

```text
Name
Pod ID
GPU
VRAM
Status
Health
Current Job
Cost/hr
Idle
Template
Volume
Actions
```

---

# 109. Pod Actions

```text
Open
Drain
Stop
Start
Terminate
Refresh
View Jobs
View Logs metadata
```

Terminate ต้อง confirmation:

```text
Type TERMINATE
```

ถ้า UI pattern เดิมมี destructive confirmation ให้ reuse

---

# 110. Resource Detail

แสดง:

```text
RunPod state
Pao normalized state
Endpoint
Template
GPU
Price
Storage
Network Volume
Created
Last Active
Current Job
Lifetime estimated spend
```

---

# 111. Compute Dashboard

ภาพรวม:

```text
Local GPU
RunPod GPU
Queue
Active Jobs
Idle Pods
Spend Rate
```

---

# 112. Router Explainability

Job detail:

```text
Why this provider?
```

ตัวอย่าง:

```text
Selected RunPod RTX 4090
- Local GPU VRAM insufficient
- RTX 4090 meets 24 GB requirement
- Existing warm Pod available
- Estimated cost within job budget
```

---

# 113. MCP Tools

เพิ่มต่อจาก Phase 19:

```text
pao_compute_list_providers
pao_compute_get_capacity
pao_compute_route_job
pao_runpod_list_pods
pao_runpod_get_pod
pao_runpod_start_pod
pao_runpod_stop_pod
pao_runpod_get_cost_summary
```

destructive:

```text
pao_runpod_terminate_pod
```

ต้อง permission สูงกว่า

---

# 114. MCP Safety

Agent ไม่ควร terminate Pod จาก natural language ambiguous command

tool ต้อง require:

```text
pod_id
ownership verification
explicit destructive flag
```

---

# 115. Automation Events

emit:

```text
compute.capacity_low
compute.provider_selected
runpod.pod_created
runpod.pod_ready
runpod.pod_idle
runpod.pod_stopped
runpod.pod_failed
runpod.budget_warning
runpod.budget_exceeded
runpod.orphan_detected
```

---

# 116. n8n / Workflow Automation

Phase 20 ไม่ให้ n8n คุม RunPod API key โดยตรงถ้าไม่จำเป็น

prefer:

```text
n8n
↓
Pao-hubPro API
↓
RunPod Adapter
```

เพื่อรวม security/audit/cost guard

---

# 117. API Routes

ใช้ convention Phase 19

ตัวอย่าง:

```text
GET  /api/v1/compute/providers
GET  /api/v1/compute/capacity
POST /api/v1/compute/route-preview

GET  /api/v1/runpod/pods
GET  /api/v1/runpod/pods/:id
POST /api/v1/runpod/pods/:id/start
POST /api/v1/runpod/pods/:id/stop
POST /api/v1/runpod/pods/:id/drain
DELETE /api/v1/runpod/pods/:id

GET  /api/v1/runpod/templates
GET  /api/v1/runpod/templates/:id
POST /api/v1/runpod/templates/:id/validate

GET  /api/v1/runpod/volumes

GET  /api/v1/runpod/cost
GET  /api/v1/runpod/billing
```

---

# 118. Route Preview

ก่อน submit optional:

```json
{
  "workflow_id": "minimax-h3-i2v",
  "resolution": "1080x1920",
  "duration": 5,
  "routing_mode": "balanced"
}
```

response:

```json
{
  "recommended": {
    "provider": "runpod",
    "gpu": "...",
    "estimated_cost": 0.0,
    "estimated_startup_seconds": 0
  },
  "alternatives": []
}
```

ต้อง label estimates

---

# 119. Database Migration

inspect DB Phase 19

เพิ่ม/extend:

```text
compute_provider_instances
gpu_capability_profiles
placement_decisions
cloud_resource_leases
runpod_pods
runpod_billing_records
generation_execution_attempts
compute_price_observations
```

reuse generic provider table ถ้ามี

---

# 120. Secret Migration

ห้าม schema field:

```text
api_key TEXT
```

ถ้า project มี secret vault/reference:

เก็บ:

```text
secret_ref
```

---

# 121. Audit Actions

เพิ่ม:

```text
runpod_connected
runpod_settings_changed
runpod_pod_created
runpod_pod_started
runpod_pod_stopped
runpod_pod_terminated
runpod_budget_override
runpod_emergency_stop
runpod_orphan_cleanup
routing_policy_changed
```

---

# 122. Structured Logs

ตัวอย่าง:

```json
{
  "module": "runpod",
  "action": "provision",
  "job_id": "...",
  "pod_id": "...",
  "gpu_type": "...",
  "cost_per_hour": 0.0,
  "message": "RunPod Pod provisioned"
}
```

ห้าม log secret

---

# 123. Redaction

redact patterns:

```text
Authorization
Bearer
RUNPOD_API_KEY
query param api_key
```

รวม HTTP debug logs

---

# 124. Mock RunPod Server

สร้าง fixture/mock:

```text
tests/fixtures/runpod
```

simulate:

```text
GET /v1/pods
GET /v1/pods/{id}
POST /v1/pods
POST /v1/pods/{id}/start
POST /v1/pods/{id}/stop
DELETE /v1/pods/{id}
GET /v1/templates/{id}
GET /v1/networkvolumes
GET /v1/billing/pods
```

---

# 125. Mock Scenarios

- success
- auth failure
- rate limit
- 500
- create delay
- GPU unavailable
- pod stuck booting
- pod disappears
- template missing
- volume missing
- billing delayed
- malformed response

---

# 126. Integration Test: Cloud Route

```text
create heavy job
↓
local insufficient
↓
router selects mock RunPod
↓
provision mock pod
↓
wait ready
↓
mock ComfyUI generation
↓
sync output
↓
Phase 19 asset
↓
stop after idle
```

---

# 127. Integration Test: Budget Block

```text
estimated cost > hard budget
↓
no POST /pods
↓
job awaiting approval/blocked
```

assert no cloud charge action attempted

---

# 128. Integration Test: Failover

```text
GPU A unavailable
↓
candidate B
↓
provision success
```

---

# 129. Integration Test: Restart Recovery

Pao-hubPro restart ขณะ:

```text
pod ready
job generating
```

startup reconciliation ต้อง restore association

---

# 130. Unit Tests

อย่างน้อย:

- placement scoring
- GPU filtering
- VRAM filter
- budget guard
- price freshness
- idle shutdown
- safe terminate
- ownership verification
- router fallback
- lease locking
- billing attribution
- model locality
- deployment profile validation

---

# 131. Security Tests

- invalid API key
- secret not returned
- non-admin terminate denied
- imported Pod destructive denied
- forged Pod ID denied
- wildcard endpoint blocked
- URL injection/SSRF protections
- invalid template ID
- path traversal remote sync

---

# 132. SSRF Protection

Remote provider URL เป็นจุดเสี่ยง

ต้อง validate:

```text
scheme
host
allowed domain/IP policy
```

ถ้า custom remote provider:

require admin

อย่าให้ user ทั่วไป submit arbitrary callback/base URL

---

# 133. RunPod API Host Allowlist

default:

```text
https://rest.runpod.io
```

custom base URL เฉพาะ dev/test/admin

production override ต้อง explicit

---

# 134. Price Freshness

field:

```text
observed_at
```

router ถ้าราคา stale เกิน:

```env
PAO_GPU_PRICE_MAX_AGE_MINUTES=15
```

ให้ refresh ก่อน provision

---

# 135. Unknown Price

ถ้าไม่รู้ราคา:

default:

```text
do not auto-provision
```

เว้น policy:

```text
allow_unknown_price=true
```

และต้อง warning

---

# 136. Billing Drift

estimate vs actual:

```text
delta
delta_percent
```

เก็บเพื่อปรับ estimator

---

# 137. Runtime Forecast

ใช้ historical median / moving average

ห้ามใช้โมเดล ML ซับซ้อนถ้ายังไม่มี data

---

# 138. GPU Preference Profiles

ตัวอย่าง:

```text
Economy
Balanced
Performance
Video Heavy
Large VRAM
```

แต่ underlying router ยังใช้ dynamic data

---

# 139. Adobe Stock Production Profile

สำหรับ stock:

```text
routing_mode: cheapest/balanced
interruptible: true
batchable: true
deadline: relaxed
reuse_warm: true
auto_stop: true
```

---

# 140. Interactive Edit Profile

```text
routing_mode: fastest
deadline: low latency
reuse_warm: true
batchable: false
```

---

# 141. Video Production Profile

```text
min_vram: workflow-specific
prefer_cloud: true
timeout: extended
persistent_cache: true
```

---

# 142. Batch Packing

ถ้ามีหลาย jobs model เดียวกัน:

scheduler สามารถ group:

```text
same model
same workflow family
same provider
```

เพื่อลด model reload

แต่ไม่ทำให้ queue starvation

---

# 143. Job Affinity

affinity:

```text
model_id
workflow_family
project
```

router พยายามส่งงานถัดไปเข้า warm Pod เดิม

---

# 144. Anti-Starvation

job priority ต่ำต้องไม่รอไม่สิ้นสุด

ใช้ age boost

---

# 145. Maximum Queue Wait

ถ้า local wait ยาว:

cloud burst ตาม policy

---

# 146. Concurrency

Pod/ComfyUI default:

```text
1 heavy job / GPU
```

เพิ่ม concurrency เฉพาะ validated workflow/profile

---

# 147. Multi-GPU Pod

architecture ต้องรองรับ:

```text
gpu_count > 1
```

แต่ Phase 20 ไม่ต้อง force multi-GPU execution ถ้า ComfyUI workflow ไม่รองรับ

---

# 148. Future Serverless Adapter

สร้าง interface boundary เผื่อ:

```text
RunPodServerlessProvider
```

แต่ **ไม่ต้อง implement เต็ม Phase 20**

REST endpoint creation ปัจจุบันสามารถสร้าง Serverless endpoint ได้ แต่ Phase นี้ focus Pods

---

# 149. Do Not Overbuild

ห้าม implement:

- Kubernetes
- distributed training
- custom GPU scheduler daemon บน RunPod host
- RunPod Serverless เต็มระบบ
- multi-cloud marketplace aggregation

เว้นแต่ codebase มีอยู่แล้ว

---

# 150. CLI

ถ้า Pao-hubPro มี CLI:

```text
pao compute status
pao compute route --workflow ...
pao runpod pods
pao runpod test
pao runpod reconcile
pao runpod cost
```

---

# 151. Diagnostics

command/page:

```text
RunPod Diagnostics
```

ตรวจ:

```text
API credential
template
network volume
GPU catalog
budget
managed pods
orphan pods
ComfyUI readiness
```

---

# 152. Example Diagnostic

```text
[OK] RunPod API authenticated
[OK] Template hs44di56w7 reachable
[OK] Network volume
[WARN] RTX 4090 unavailable
[OK] A40 available
[OK] Monthly budget 72% remaining
[WARN] 1 managed pod idle 14 min
```

ห้าม claim GPU availability จาก static list

---

# 153. Startup Behavior

RunPod disabled:

```text
Phase 19 works normally
Local GPU works
```

RunPod credential invalid:

```text
RunPod provider degraded
Pao-hubPro still starts
```

---

# 154. Graceful Shutdown

ก่อน app shutdown:

- stop new provisioning
- persist leases
- cancel internal polling
- do not automatically kill busy RunPod pod
- preserve reconciliation state

---

# 155. Crash Recovery

startup:

1. load managed Pod records
2. GET actual Pods
3. reconcile
4. restore leases
5. recover running jobs
6. mark unknown/orphans
7. restart idle timers safely

---

# 156. Split Brain Protection

ถ้า Pao-hubPro สอง instance:

cloud lifecycle manager ต้อง leader/lease based

ห้ามทั้งสอง terminate/start Pod พร้อมกัน

---

# 157. Lease TTL

config:

```env
PAO_CLOUD_LEASE_TTL_SECONDS=60
PAO_CLOUD_LEASE_HEARTBEAT_SECONDS=20
```

---

# 158. Observability Metrics

```text
compute_route_total
compute_route_local_total
compute_route_cloud_total
runpod_pods_created_total
runpod_pods_failed_total
runpod_pods_active
runpod_idle_seconds
runpod_cost_estimated_total
runpod_cost_actual_total
runpod_budget_blocks_total
runpod_boot_seconds
runpod_runtime_ready_seconds
gpu_job_runtime_seconds
gpu_failure_rate
```

---

# 159. Admin Alerts

แจ้ง:

```text
Budget 80%
Budget 100%
Pod idle too long
Orphan detected
Pod failed
Repeated API auth failure
Cloud spend spike
```

ผ่าน notification system เดิม

---

# 160. Spend Spike Detection

simple rule:

```text
current hourly burn
>
configured threshold
```

ไม่ต้อง anomaly ML

---

# 161. UX: Generate Page

เพิ่ม:

```text
Compute
[ Auto ▼ ]

Estimated:
Provider: Auto
GPU: selected at queue time
Cost: estimate after routing
```

---

# 162. UX: Queue Page

เพิ่ม columns:

```text
Compute
GPU
Provider State
Estimated Cost
Actual Cost
Routing Reason
```

---

# 163. UX: Job Detail

section:

```text
Compute Timeline
```

example:

```text
23:01 Queued
23:01 Local rejected — insufficient VRAM
23:01 RunPod candidate selected
23:02 Pod created
23:04 ComfyUI ready
23:04 Model ready
23:05 Generation started
23:08 Output synced
23:08 Pod idle
23:18 Pod stopped
```

---

# 164. Cost Confirmation UX

ถ้าต้อง approval:

```text
Run this job on cloud?

GPU: ...
Estimated max hourly rate: ...
Estimated job cost: ...
Budget remaining: ...

[Cancel] [Approve]
```

---

# 165. No False Precision

อย่าแสดง:

```text
$0.137428 exact
```

ถ้าเป็น estimate

แสดง:

```text
~$0.14 estimated
```

---

# 166. Template `hs44di56w7`

Phase 20 migration/bootstrap สามารถ seed profile:

```text
id: runpod-template-hs44di56w7
template_id: hs44di56w7
enabled: false until validated
```

เหตุผลที่ default disabled:

- ต้องมี credential
- ต้อง inspect template ปัจจุบัน
- public template อาจเปลี่ยน
- port/image settings ต้อง verify

---

# 167. Template Drift

เมื่อ template metadata เปลี่ยน:

persist snapshot hash

แจ้ง:

```text
Template changed since last validation
```

require validation ก่อน next provision ถ้า change สำคัญ

---

# 168. Deployment Snapshot

ทุก Pod record เก็บ snapshot:

```text
template_id
template_metadata_hash
image_name
ports
volume
gpu selection
```

เพื่อ audit/repro

---

# 169. Container Image Pinning

ถ้าสร้าง Pao template เองในอนาคต:

prefer:

```text
image:tag immutable
or digest
```

ไม่ใช้:

```text
latest
```

ใน production

---

# 170. Bootstrap Agent

optional small script inside Pod:

```text
pao-bootstrap
```

ทำ:

- verify filesystem
- verify ComfyUI
- verify models
- expose health
- report manifest

แต่ห้ามต้องมี privileged access

---

# 171. Health Contract

remote runtime endpoint:

```json
{
  "status": "ready",
  "comfyui": true,
  "models": [...],
  "workflow_version": "...",
  "gpu": {...}
}
```

ถ้าไม่ได้ใช้ bootstrap ให้ buildจาก ComfyUI APIs

---

# 172. Model Cache Warmup

หลัง Pod ready:

optional:

```text
load target model
small validation operation
```

เฉพาะถ้าคุ้มค่า

ไม่ generate เสีย GPU โดยไม่มีเหตุผล

---

# 173. Preflight

ก่อนส่ง job:

```text
model
workflow
nodes
input
disk
provider health
```

---

# 174. Disk Guard

ก่อน model sync:

```text
required bytes
free bytes
safety margin
```

ถ้าไม่พอ:

fail before download

---

# 175. Download Resume

model sync ใหญ่ควรรองรับ resume ถ้า tool/source รองรับ

---

# 176. Checksum

mandatory สำหรับ internal model artifacts ที่มี known hash

---

# 177. Remote Path Safety

ใช้ canonical root:

```text
/workspace/pao
```

ห้าม allow:

```text
../../
```

จาก registry/user

---

# 178. Output Naming

ไม่ใช้ prompt เป็น filename

ใช้:

```text
asset UUID
job ID
attempt ID
```

---

# 179. Multi-Tenant Future Proofing

ทุก cloud resource association:

```text
workspace/org/project
```

ตาม auth model เดิม

---

# 180. Rate Limiting

cloud lifecycle API admin endpoints ต้อง rate limit

ป้องกัน accidental create loop

---

# 181. Provision Cooldown

config:

```env
PAO_RUNPOD_PROVISION_COOLDOWN_SECONDS=30
```

ถ้า repeatedly fail

---

# 182. Maximum Provision Attempts

```env
PAO_RUNPOD_MAX_PROVISION_ATTEMPTS=3
```

ต่อ job

---

# 183. Candidate Blacklist TTL

ถ้า GPU/datacenter fail:

temporary blacklist

```text
gpu + datacenter
TTL
reason
```

---

# 184. Orchestrator Idempotency

Create Pod operation ต้องมี logical provision request ID

ถ้า API timeout:

ก่อน retry create:

```text
reconcile/list Pods
```

ป้องกันสร้าง Pod ซ้ำ

---

# 185. Provision Record First

persist:

```text
provision_request
```

ก่อน API mutation

---

# 186. Transaction Boundary

DB state และ external RunPod API ไม่ atomic

ใช้ saga pattern:

```text
intent
external action
observe
commit
compensate
```

---

# 187. Provision Saga

```text
REQUESTED
↓
API_CREATE_SENT
↓
POD_DISCOVERED
↓
PERSISTED
↓
READY
```

failure:

```text
UNKNOWN_EXTERNAL_STATE
```

ต้อง reconcile ไม่สร้างใหม่ทันที

---

# 188. Stop Saga

same concept

ห้าม mark stopped จน observe actual state

---

# 189. Terminate Saga

after DELETE:

GET/list verify disappearance/terminal state ตาม API behavior

persist terminated_at

---

# 190. Resource Finalizer

managed Pod record ห้าม hard-delete

เก็บ lifecycle history

---

# 191. Billing Retention

เก็บ aggregated billing อย่างน้อยตาม policy

ไม่ต้อง copyทุก provider raw response ถ้าใหญ่

---

# 192. Data Privacy

ห้ามส่ง prompt/asset metadata เข้า RunPod control API

เฉพาะ runtime generation endpointเท่าที่จำเป็น

---

# 193. RunPod Control vs Data Plane

แยก:

```text
Control Plane
rest.runpod.io/v1

Data Plane
remote ComfyUI endpoint
```

client/service แยกกัน

---

# 194. Time Synchronization

use UTC timestamps internally

UI localizes

---

# 195. HTTP Client

reuse project HTTP client

ต้อง support:

```text
connect timeout
read timeout
retries
TLS verify
proxy optional
```

---

# 196. No TLS Disable

ห้าม:

```text
verify=False
rejectUnauthorized=false
```

production default

---

# 197. Test Mode

```env
PAO_RUNPOD_MOCK=true
```

เฉพาะ dev/test

production must ignore/forbid insecure accidental mock config ตาม environment policy

---

# 198. Dry Run

Admin:

```text
Routing Dry Run
```

คำนวณ candidate/cost

ไม่ provision

---

# 199. Cost Simulator

input:

```text
workflow
batch
resolution
duration
```

output estimate

ใช้ historical data

---

# 200. Definition of Done

Phase 20 complete เมื่อ:

## Core

- [ ] Phase 19 ยังทำงาน
- [ ] RunPod feature flag มี
- [ ] REST client typed
- [ ] credential secure
- [ ] Test Connection ทำงาน
- [ ] Template `hs44di56w7` inspect/validate ได้เมื่อ credential เข้าถึง
- [ ] Pod list/get ทำงาน
- [ ] Create Pod ทำงาน
- [ ] Start Pod ทำงาน
- [ ] Stop Pod ทำงาน
- [ ] Safe terminate ทำงาน
- [ ] Managed vs imported resource แยกชัด

## Router

- [ ] Workload Requirement Resolver
- [ ] VRAM filtering
- [ ] Dynamic candidate selection
- [ ] Local preference
- [ ] Warm Pod reuse
- [ ] RunPod fallback
- [ ] Explainable placement
- [ ] Routing modes
- [ ] Failover

## Cost

- [ ] Estimated hourly cost
- [ ] Estimated job cost
- [ ] Budget guard
- [ ] Daily/monthly budgets
- [ ] Active cost/hour
- [ ] Pod billing sync
- [ ] Cost attribution
- [ ] Cost dashboard
- [ ] Spend circuit breaker

## Lifecycle

- [ ] Provision state machine
- [ ] readiness probe
- [ ] ComfyUI readiness
- [ ] job assignment
- [ ] idle detection
- [ ] auto stop
- [ ] terminate policy
- [ ] reconciliation
- [ ] restart recovery
- [ ] orphan detector
- [ ] emergency stop

## Sync

- [ ] workflow sync
- [ ] model manifest support
- [ ] LoRA sync abstraction
- [ ] input sync
- [ ] output sync
- [ ] checksum validation
- [ ] asset imported into Phase 19 storage

## Security

- [ ] API key never returned
- [ ] secret redaction
- [ ] RBAC
- [ ] destructive ownership checks
- [ ] SSRF protection
- [ ] HTTPS verification
- [ ] Audit logs
- [ ] imported Pod safe mode

## Tests

- [ ] unit tests
- [ ] RunPod mock
- [ ] cloud routing integration test
- [ ] budget blocking test
- [ ] failover test
- [ ] restart recovery test
- [ ] security tests
- [ ] no real RunPod cost in CI

## UI

- [ ] Compute Dashboard
- [ ] RunPod settings
- [ ] Template inspection
- [ ] GPU policy
- [ ] Budget settings
- [ ] Pod manager
- [ ] Job compute timeline
- [ ] Routing explanation
- [ ] Cost summary

## Docs

- [ ] Phase 20 docs
- [ ] RunPod setup
- [ ] security
- [ ] budget/cost
- [ ] troubleshooting
- [ ] template setup
- [ ] network volume guide
- [ ] `.env.example`

## Verification

- [ ] migration passes
- [ ] lint passes
- [ ] typecheck passes
- [ ] tests pass
- [ ] frontend build passes
- [ ] backend build/test passes
- [ ] local mode works without RunPod
- [ ] RunPod-disabled mode works
- [ ] no secrets committed

---

# 201. Environment Variables

เพิ่มโดยปรับ naming convention เดิมถ้ามี:

```env
# =========================================
# Phase 20 - RunPod / Multi GPU
# =========================================

PAO_RUNPOD_ENABLED=false

PAO_RUNPOD_API_BASE_URL=https://rest.runpod.io/v1
PAO_RUNPOD_API_KEY=

PAO_RUNPOD_DEFAULT_TEMPLATE_ID=hs44di56w7
PAO_RUNPOD_NETWORK_VOLUME_ID=

PAO_RUNPOD_AUTO_PROVISION=true
PAO_RUNPOD_AUTO_STOP=true
PAO_RUNPOD_AUTO_TERMINATE=false

PAO_RUNPOD_IDLE_STOP_MINUTES=10
PAO_RUNPOD_IDLE_TERMINATE_MINUTES=60

PAO_RUNPOD_MAX_ACTIVE_PODS=2
PAO_RUNPOD_MAX_PROVISION_ATTEMPTS=3
PAO_RUNPOD_PROVISION_COOLDOWN_SECONDS=30

PAO_RUNPOD_MAX_GPU_PRICE_PER_HOUR=1.50
PAO_RUNPOD_MAX_ESTIMATED_COST_PER_JOB=2.00
PAO_RUNPOD_DAILY_BUDGET=10.00
PAO_RUNPOD_MONTHLY_BUDGET=100.00

PAO_RUNPOD_REQUIRE_APPROVAL=false

PAO_RUNPOD_CREATE_TIMEOUT_SECONDS=300
PAO_RUNPOD_START_TIMEOUT_SECONDS=300
PAO_RUNPOD_RUNTIME_READY_TIMEOUT_SECONDS=900
PAO_RUNPOD_MODEL_SYNC_TIMEOUT_SECONDS=3600

PAO_RUNPOD_POLL_MIN_SECONDS=2
PAO_RUNPOD_POLL_MAX_SECONDS=15

PAO_GPU_PREFER_LOCAL=true
PAO_GPU_VRAM_SAFETY_MARGIN_GB=2
PAO_GPU_PRICE_MAX_AGE_MINUTES=15

PAO_CLOUD_BURST_QUEUE_THRESHOLD=3

PAO_CLOUD_LEASE_TTL_SECONDS=60
PAO_CLOUD_LEASE_HEARTBEAT_SECONDS=20

PAO_RUNPOD_WARM_POOL_ENABLED=false
PAO_RUNPOD_WARM_POOL_MIN_READY=0
PAO_RUNPOD_WARM_POOL_MAX_READY=1
```

ตัวเลข budget เป็น example เท่านั้น

Codex ต้องไม่ทำให้ค่า example กลายเป็น hidden hard limit

---

# 202. Documentation Files

สร้างตาม docs convention:

```text
docs/phase-20/
  README.md
  architecture.md
  runpod-setup.md
  runpod-template.md
  gpu-routing.md
  cost-control.md
  network-volume.md
  lifecycle.md
  security.md
  troubleshooting.md
```

---

# 203. `runpod-setup.md`

ต้องอธิบาย:

1. สร้าง RunPod API key
2. ใส่ใน Pao-hubPro secret/env
3. เปิด `PAO_RUNPOD_ENABLED`
4. ใส่ template ID
5. Test Connection
6. Inspect Template
7. Validate Template
8. ตั้ง Allowed GPU
9. ตั้ง Max $/hour
10. ตั้ง Daily/Monthly budget
11. ตั้ง idle stop
12. test route แบบ dry-run
13. test Pod provisioning
14. verify ComfyUI ready
15. test one image job
16. verify asset sync
17. verify auto stop
18. verify billing

---

# 204. `runpod-template.md`

reference:

```text
Template ID: hs44di56w7
```

ระบุ:

```text
Template เป็น external dependency
metadata อาจเปลี่ยน
ต้อง validate runtime
```

ห้าม document unknown fields เป็น facts จน client inspect ได้จริง

---

# 205. Official RunPod Documentation References

ใช้ในการ implement/verify:

```text
Create Pod
https://docs.runpod.io/api-reference/pods/POST/pods

List Pods
https://docs.runpod.io/api-reference/pods/GET/pods

Get Pod
https://docs.runpod.io/api-reference/pods/GET/pods/podId

Start Pod
https://docs.runpod.io/api-reference/pods/POST/pods/podId/start

Stop Pod
https://docs.runpod.io/api-reference/pods/POST/pods/podId/stop

Delete Pod
https://docs.runpod.io/api-reference/pods/DELETE/pods/podId

Find Template
https://docs.runpod.io/api-reference/templates/GET/templates/templateId

Network Volumes
https://docs.runpod.io/storage/network-volumes

Pod Billing
https://docs.runpod.io/api-reference/billing/GET/billing/pods

GPU Types
https://docs.runpod.io/references/gpu-types
```

ก่อน implement request/response schema ให้ Codex ตรวจ official docs ถ้ามี internet access

ถ้าไม่มี ให้ isolate API types เพื่อแก้ schema ภายหลังได้ง่าย

---

# 206. Implementation Order

## Step 1 — Inspect Phase 19

หา:

```text
GenerationProvider
Provider Router
Job Orchestrator
Workflow Registry
Model Registry
Asset Storage
Settings
Auth
RBAC
MCP
Queue
Audit
```

---

## Step 2 — RunPod Domain / Config

สร้าง:

```text
deployment profile
instance
billing
placement
lease
```

migration

---

## Step 3 — REST Client

implement read-only ก่อน:

```text
list pods
get pod
template
volume
billing
```

tests

แล้วค่อย mutation:

```text
create/start/stop/delete
```

---

## Step 4 — Security

secret storage
redaction
RBAC
ownership
SSRF guard

ก่อนเปิด mutation ให้ UI/MCP

---

## Step 5 — GPU Requirement Resolver

extend Phase 19 model/workflow metadata

---

## Step 6 — Router

local
warm remote
RunPod

with explainability

---

## Step 7 — Lifecycle Manager

provision
ready
idle
stop
reconcile

---

## Step 8 — ComfyUI Remote Runtime

endpoint resolver
health
generation

reuse Phase 19 ComfyUI adapter

---

## Step 9 — Asset Sync

input/output/checksum

---

## Step 10 — Model / Workflow Locality

manifest
sync
cache

---

## Step 11 — Cost Guard

estimate
budget
billing
circuit breaker

---

## Step 12 — UI

Compute dashboard
RunPod manager
Settings
Costs
Routing detail

---

## Step 13 — MCP

safe tools

---

## Step 14 — Recovery / Reconcile

restart
orphan
split-brain lease

---

## Step 15 — Tests

mock RunPod
mock ComfyUI
full flow

---

## Step 16 — Docs

complete

---

## Step 17 — Verification

run:

```text
install
migration
lint
format
typecheck
unit tests
integration tests
frontend build
backend tests
```

แก้ errors จาก Phase 20

---

# 207. Acceptance Scenario A — Local Image

```text
User Generate
↓
Router sees local ready
↓
Local selected
↓
No RunPod API mutation
↓
Phase 19 generation
↓
Review
↓
Stock export
```

PASS เมื่อ Phase 20 ไม่บังคับ cloud

---

# 208. Acceptance Scenario B — Heavy Video

```text
MiniMax/LTX heavy job
↓
Local VRAM/capacity insufficient
↓
RunPod candidates
↓
Budget passes
↓
Pod created
↓
ComfyUI ready
↓
workflow/model ready
↓
generate
↓
output sync
↓
Reviewer
↓
idle
↓
auto stop
```

---

# 209. Acceptance Scenario C — GPU Unavailable

```text
Preferred GPU unavailable
↓
Candidate 2
↓
Candidate 3
↓
successful provision
```

ไม่ fail job หลัง candidate แรก

---

# 210. Acceptance Scenario D — Budget Exceeded

```text
RunPod required
↓
estimated cost > hard limit
↓
no cloud mutation
↓
job waiting approval/blocked
↓
UI explains why
```

---

# 211. Acceptance Scenario E — Pod Boot Failure

```text
Pod created
↓
runtime never ready
↓
timeout
↓
record attempt failure
↓
stop/cleanup according policy
↓
next provider candidate
```

---

# 212. Acceptance Scenario F — App Restart

```text
Pod busy
↓
Pao-hubPro crash/restart
↓
reconciliation
↓
Pod rediscovered
↓
job state recovered
↓
no duplicate Pod
```

---

# 213. Acceptance Scenario G — Orphan

```text
Managed-named Pod
no DB active job
↓
orphan candidate
↓
admin alert
↓
no immediate delete
```

---

# 214. Acceptance Scenario H — Imported Pod

```text
Admin imports Pod
↓
generation uses it
↓
agent requests terminate
↓
system blocks unless imported destructive management explicitly enabled
```

---

# 215. Acceptance Scenario I — Stock Batch

```text
20 concepts
↓
router batches by model
↓
warm Pod reuse
↓
assets produced
↓
review council
↓
top assets
↓
upscale
↓
metadata
↓
export
↓
Pod idle
↓
stop
```

---

# 216. Recommended Phase 21

หลัง Phase 20 เสถียร:

```text
Phase 21 — Pao Stock Autonomous Campaign Planner
× Trend-to-Asset Portfolio Intelligence
```

flow:

```text
Trend Research
↓
Niche Scoring
↓
Concept Planner
↓
Prompt Batch
↓
Phase 20 GPU Router
↓
Phase 19 Production
↓
Stock Review
↓
Metadata
↓
Portfolio Learning
```

**ห้าม implement Phase 21 ในงานนี้**

---

# 217. Final Instructions to Codex

เริ่ม implement Phase 20 ใน Pao-hubPro repository ปัจจุบัน

ห้ามถามสิ่งที่ค้นได้จาก codebase

หาก Phase 19 implementation ต่างจาก specification:

```text
ใช้ implementation จริงเป็น source of truth
```

แล้ว integrate ให้เหมาะสม

อย่าสร้าง subsystem ซ้ำ

อย่าทำ demo-only

อย่าทำ mock-only

RunPod mock ใช้เฉพาะ tests

Production path ต้องใช้ real REST adapter

ห้ามใช้เงินจริงใน automated tests

ถ้ามี RunPod API key ใน environment ระหว่าง development:

**อย่า provision resource จริงโดยอัตโนมัติในการ test**

real cloud mutation ต้องเกิดจาก:

```text
explicit manual integration test
or
explicit admin action
```

---

# 218. Codex Final Verification Report

เมื่อเสร็จ ให้ตอบ:

```text
Phase 20 Implementation Complete

1. Existing Phase 19 components reused
2. Architecture changes
3. Files added
4. Files modified
5. Database migrations
6. RunPod REST operations implemented
7. Router policies implemented
8. GPU requirement system
9. Cost guard / budgets
10. Lifecycle / auto-stop
11. Model/workflow sync
12. UI pages
13. MCP tools
14. Security controls
15. Tests added
16. Mock scenarios
17. Commands executed
18. Lint/typecheck results
19. Test results
20. Build result
21. Manual setup required
22. RunPod template validation status
23. Known limitations
24. Recommended next phase
```

ต้องรายงานผลจริง

ห้ามบอกว่า:

```text
tests pass
build pass
template validated
RunPod connected
```

ถ้ายังไม่ได้รันจริง

---

# 219. Final Goal

Phase 20 ต้องทำให้ Pao-hubPro สามารถทำสิ่งนี้ได้:

```text
"สร้างวิดีโอ Stock ชุดนี้ให้ผม 10 แบบ"
                 ↓
        Pao-hubPro วิเคราะห์งาน
                 ↓
          Local GPU พอไหม?
          /             \
       Yes               No
       ↓                  ↓
     Local            RunPod
                         ↓
                เลือก GPU ที่เหมาะ
                         ↓
                   ตรวจ Budget
                         ↓
                   Provision Pod
                         ↓
                   ComfyUI Ready
                         ↓
                     Generate
                         ↓
                  Pull Outputs
                         ↓
                  Reviewer Council
                         ↓
                  Adobe Stock QC
                         ↓
                    Metadata
                         ↓
                     Export
                         ↓
                 Auto Stop RunPod
                         ↓
                    Cost Recorded
```

ระบบต้อง:

```text
เร็ว
ประหยัด
ตรวจสอบย้อนหลังได้
ปลอดภัย
recover ได้
ไม่สร้าง Pod ซ้ำ
ไม่ลืมเปิด GPU ทิ้ง
ไม่ใช้โมเดลที่ไม่พร้อม
ไม่เกิน budget โดยไม่รู้ตัว
และพร้อมต่อยอด multi-cloud ในอนาคต
```

---

# End of Phase 20 Specification

**Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router**

Phase นี้เปลี่ยน Pao-hubPro จากระบบ AI Generation ที่มี provider หลายตัว ให้กลายเป็น **GPU Compute Orchestration Layer** ที่สามารถตัดสินใจว่า workload ควรรันที่ไหน, ต้องใช้ GPU ระดับใด, ราคาเท่าไร, ควรเปิดหรือปิด compute เมื่อใด และเชื่อมผลลัพธ์กลับเข้าสู่ Production Pipeline ของ Phase 19 โดยอัตโนมัติ
