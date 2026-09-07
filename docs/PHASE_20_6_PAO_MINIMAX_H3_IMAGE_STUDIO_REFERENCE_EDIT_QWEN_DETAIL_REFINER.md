# Phase 20.6 — Pao MiniMax H3 Image Studio × Reference Editing × Qwen Detail Refinement Pipeline

> สถานะเอกสาร: SPEC READY  
> กลุ่มงาน: Pao-hubPro / Pao AI Generation Studio / Adobe Stock Factory  
> แนวคิดหลัก: เอา `ComfyUI-MiniMax-H3-Image-Studio` เข้ามาเป็น **provider integration** ในระบบเดิม ไม่ทำเป็นโปรเจกต์แยก  
> แนวทางสถาปัตยกรรม: **API-first, Queue-first, Review-gated, License-aware, Stock-safe**

---

## 1) เป้าหมายของ Phase 20.6

Phase นี้มีหน้าที่ทำให้ `Pao-hubPro` ใช้งาน MiniMax H3 สำหรับการสร้างภาพนิ่งได้แบบจริงจังในเชิง production โดยเฉพาะงาน:

- Text-to-Image
- Image-to-Image
- Reference Edit
- Single-frame / one-image workflows
- Detail refinement ด้วย Qwen Image Edit 2511
- การเลือก preset สำหรับ quality / speed / turbo
- การตรวจความพร้อมของ model / workflow / license
- การทำงานผ่าน Queue และ API
- การทำ Reviewer + Technical QC + Stock QC
- การทำ export พร้อม metadata และบันทึก provenance

เป้าหมายสุดท้ายคือให้ระบบนี้กลายเป็น **สายการผลิตภาพ AI แบบควบคุมได้**, **ต่อยอดได้**, และ **ส่งงาน stock ได้ปลอดภัยขึ้น**

---

## 2) เหตุผลที่ควรมี Phase นี้

repo `ComfyUI-MiniMax-H3-Image-Studio` ไม่ได้เป็นแค่ node ธรรมดา แต่มีองค์ประกอบที่เหมาะกับการเอาเข้าระบบของเปามาก ได้แก่:

- มี node สำหรับ H3 ชัดเจน
- มี workflow ทั้ง UI / PNG / API JSON
- รองรับ T2I / I2I / REF2VA
- รองรับ reference edit หลายรูป
- มี detail refinement chain
- มี sampling preset หลายระดับ
- มี one-frame workflow แบบ experimental
- มีการแยก examples สำหรับ API ชัดเจน
- มี tests สำหรับ runtime และ release artifacts
- ตัว repo ใช้ Unlicense แต่ model assets บางส่วนมี license ของตัวเอง จึงต้องออกแบบ layer ตรวจสอบสิทธิ์การใช้งาน

ดังนั้น Phase 20.6 จึงไม่ใช่ “เพิ่ม node” อย่างเดียว  
แต่คือการทำให้ H3 กลายเป็น **production engine** ของ Pao AI Generation Studio

---

## 3) หลักการสำคัญของ Phase 20.6

### 3.1 API-first
ถ้า workflow เรียกผ่าน API ได้ ต้องให้ระบบเรียกผ่าน API ก่อน  
ไม่ควรใช้ Desktop Agent ไปกดหน้า ComfyUI เป็นวิธีหลัก

### 3.2 Queue-first
ทุกงาน generation ที่กิน GPU ต้องผ่าน queue orchestration  
เพื่อให้ต่อกับ Phase 20 / 20.1 ได้

### 3.3 Preset-over-raw-complexity
ผู้ใช้ไม่ควรต้องจำ sampler / scheduler / steps / adapter เองทุกครั้ง  
ระบบควรยกระดับขึ้นมาเป็น preset ที่เข้าใจง่าย

### 3.4 Review-gated
งานที่สร้างเสร็จแล้วต้องมีจุดคัดกรองก่อน export  
โดยเฉพาะงาน stock

### 3.5 License-aware
repo ใช้เชิงพาณิชย์ได้ แต่ model / adapter / community assets ต้องตรวจสิทธิ์แยก

### 3.6 Stock-safe
ห้ามปล่อย workflow ที่ยังไม่ผ่านนโยบายลิขสิทธิ์ / คน / logo / artifact QC  
เข้าระบบ Adobe Stock Mode โดยไม่มี gate

### 3.7 Provenance-always
ทุกภาพที่ออกจากระบบ ต้อง trace ได้ว่า:
- ใช้ workflow ไหน
- ใช้ seed อะไร
- ใช้ preset ไหน
- ใช้ model / adapter ตัวไหน
- ผ่าน refinement หรือไม่
- ผ่าน reviewer คนไหน / agent ไหน

---

## 4) ตำแหน่งของ Phase 20.6 ใน Roadmap

เชื่อมกับ phase เดิมดังนี้:

- **Phase 19** — Pao AI Generation Studio  
  เป็นฐานของ registry, project structure, generation workflow

- **Phase 20** — Multi-GPU / RunPod / Router  
  ใช้ตัดสินว่าจะรัน H3 บน local หรือ remote

- **Phase 20.1** — Smart Queue / Cloud Burst  
  ใช้จัดคิวงาน generation, GPU scheduling, retry, fallback

- **Phase 20.2** — Spec-Driven SDLC  
  ใช้ควบคุมการพัฒนา integration แบบมี spec / plan / tasks / review

- **Phase 20.3** — Desktop Vision Control  
  ใช้ fallback สำหรับดู visual state / debug / manual intervention บน ComfyUI

- **Phase 20.4** — Autonomous Engineering Council  
  ใช้ parallel coding / review / test / fix / merge สำหรับ phase นี้

- **Phase 20.5** — Living Knowledge Brain  
  ใช้เก็บ preset knowledge, troubleshooting, compatibility, tested recipes, known defects, stock-safe policy

- **Phase 20.6** — MiniMax H3 Production Image Engine  
  เป็นตัวลงมือทำ production pipeline สำหรับภาพ H3 จริง

---

## 5) ขอบเขตของงานใน Phase 20.6

### รวมใน phase นี้
- H3 provider integration
- workflow registry
- API payload templates
- preset system
- model stack registry
- license / commercial-use registry
- queue integration
- review gates
- detail refinement routing
- stock mode
- output packaging
- metadata persistence
- tests, docs, UI, MCP tools, API endpoints

### ไม่รวมใน phase นี้
- ระบบ video generation เต็มรูปแบบ
- ระบบ training / finetune model
- ระบบซื้อ cloud GPU อัตโนมัติ
- ระบบ auto-upload เข้า Adobe Stock โดยไม่มี human gate
- ระบบ clone / scrape third-party model pages แบบเต็ม
- ระบบประเมินความปลอดภัยทางกฎหมาย 100% อัตโนมัติ

---

## 6) สถาปัตยกรรมระดับสูง

```text
User / Prompt / Batch Request
            ↓
Pao Generation Studio UI / MCP / API
            ↓
H3 Intent Router
            ↓
Preset Resolver
            ↓
Model & License Validator
            ↓
Job Builder
            ↓
Phase 20.1 Smart Queue
            ↓
Execution Target Resolver
   ├─ Local ComfyUI
   └─ Remote ComfyUI / RunPod
            ↓
H3 Workflow Adapter
            ↓
ComfyUI API JSON
            ↓
MiniMax H3 Workflow
            ↓
Single Image Output / Candidate Batch
            ↓
Candidate Selector
            ↓
Visual QC / Reviewer Gate
      ├─ PASS → Export
      └─ FIX  → Qwen Detail Refiner
                      ↓
               Tone Lock Result
                      ↓
                 Re-Review
                      ↓
                  Stock QC
                      ↓
             Asset Package / Metadata
                      ↓
         Knowledge + Provenance + History
```

---

## 7) โมดูลหลักที่ต้องสร้าง

### 7.1 `H3ProviderAdapter`
หน้าที่:
- รับ job definition ภาษากลางของ Pao-hubPro
- แปลงเป็น workflow/API payload สำหรับ H3
- แยกตาม mode:
  - T2I
  - I2I
  - REF_EDIT
  - T2I_SINGLE
  - I2I_SINGLE
  - REF_SINGLE
  - DETAIL_REFINER

ต้องรองรับ:
- prompt
- negative prompt (ถ้า workflow นั้นรองรับ)
- seed
- frame profile
- resolution preset
- custom resolution
- sampling preset
- source image
- reference images
- source_fidelity
- output selector mode
- turbo adapter binding
- refinement options

---

### 7.2 `H3WorkflowRegistry`
เก็บ catalog ของ workflow ที่ระบบรู้จัก เช่น:

```text
H3_T2I
H3_T2I_SINGLE
H3_I2I
H3_I2I_SINGLE
H3_REFERENCE_EDIT
H3_REFERENCE_SINGLE
H3_I2I_TURBO
H3_DETAIL_REFINER
```

แต่ละ workflow ต้องเก็บอย่างน้อย:
- internal key
- display name
- supported mode
- API JSON path
- expected inputs
- expected outputs
- required model stack
- experimental flag
- stock-safe status
- last verified time
- compatible ComfyUI version range
- compatible node version range

---

### 7.3 `H3PresetResolver`
เปลี่ยนความซับซ้อนของ workflow ให้ user ใช้ง่ายขึ้น

preset ที่แนะนำ:

```text
QUALITY
BALANCED
FAST
TURBO_FAST
REFERENCE_EDIT
REFERENCE_EDIT_STRONG
DETAIL_REFINE
STOCK_SAFE
EXPERIMENTAL_SINGLE
```

ตัวอย่าง mapping:

- `QUALITY`
  - frame profile: recommended (5 frames)
  - sampling: base quality
  - target megapixel: 0.98 MP

- `BALANCED`
  - frame profile: recommended (5 frames)
  - sampling: official turbo 8-step หรือ base speed ตาม availability

- `FAST`
  - low-cost / quick preview

- `REFERENCE_EDIT`
  - REF2VA workflow
  - source_fidelity default 0.55–0.60

- `DETAIL_REFINE`
  - H3 output → Qwen detail pass → tone lock

- `STOCK_SAFE`
  - ห้ามใช้ experimental assets ที่ไม่ผ่าน license gate
  - enforce QC

---

### 7.4 `H3ModelRegistry`
ต้องเก็บ stack ที่ใช้จริง เช่น:

#### กลุ่ม H3 หลัก
- diffusion model
- text encoder
- video VAE
- turbo adapters

#### กลุ่ม experimental one-frame
- hybrid diffusion model
- image VAE
- detail adapter

#### กลุ่ม detail refiner
- Qwen image edit diffusion model
- text encoder
- VAE
- lightning adapter

schema อย่างน้อย:
- model_key
- category
- filename
- expected_folder
- source_url
- official_or_community
- license_name
- commercial_use_status
- stock_use_status
- approved_for_local
- approved_for_remote
- checksum / fingerprint
- status
- notes

---

### 7.5 `H3LicensePolicyEngine`
ต้องมี policy ชัดว่า asset ไหน:

```text
ALLOWED
REVIEW_REQUIRED
DISALLOWED
UNKNOWN
```

เช่น:
- official H3 base stack → review ได้ / ใช้ได้ตาม policy
- community hybrid checkpoint → review required
- adapter ที่ license ไม่ชัด → block stock mode
- community experimental stack → ใช้ได้แค่ lab / internal mode

ระบบนี้ต้องผูกกับ:
- provider
- workflow
- preset
- export target
- Adobe Stock Mode

---

### 7.6 `H3JobBuilder`
รับ request จาก UI / MCP / API แล้ว compile เป็นงานมาตรฐาน เช่น:

```json
{
  "provider": "minimax_h3",
  "mode": "reference_edit",
  "preset": "reference_edit",
  "resolution": "native_detail",
  "frame_profile": 5,
  "seed": 123456789,
  "references": [
    {"role": "identity", "asset_id": "..."},
    {"role": "pose", "asset_id": "..."},
    {"role": "environment", "asset_id": "..."}
  ],
  "detail_refine": true,
  "stock_mode": true
}
```

---

### 7.7 `H3CandidateSelector`
H3 เป็นระบบที่มีแนวคิด frame packet ก่อนเลือก still image  
ดังนั้น phase นี้ต้องรองรับการเลือกภาพที่ดีที่สุดจากผลลัพธ์

ต้องรองรับ:
- recommended index
- first frame
- best diagnostic score
- manual pick
- keep all candidates
- auto-pick + human confirm

---

### 7.8 `H3DetailRefinerRouter`
เอา Qwen Detail Refiner มาเป็น post-process แบบมีเงื่อนไข

flow ที่แนะนำ:

```text
Initial H3 output
        ↓
Visual QC
   ├─ good → skip refiner
   └─ issue found
          ↓
   defect-targeted refine prompt
          ↓
   Qwen detail refinement
          ↓
   Detail Tone Lock
          ↓
   Re-review
```

ห้าม refine ทุกภาพโดย default เพราะ:
- กิน resource
- อาจ overprocess
- อาจเปลี่ยนภาพโดยไม่จำเป็น

---

### 7.9 `H3StockMode`
เป็นโหมดสำคัญสำหรับสาย Adobe Stock

ต้องมีอย่างน้อย:
- ตรวจ license ของ model assets
- ห้ามใช้ preset/adapter ที่ไม่ผ่าน stock policy
- ตรวจ text/logo/watermark
- ตรวจ artifact มือ หน้า ตา นิ้ว
- ตรวจคนดัง / ตัวละคร / IP recognizable
- ตรวจ nudity / safety / editorial-like content ตาม policy ภายใน
- บังคับบันทึก provenance และ metadata
- ต้องมี reviewer gate ก่อน final export

---

### 7.10 `H3KnowledgeHooks`
ทุก run ต้องส่ง knowledge กลับ Phase 20.5 เช่น:
- preset ไหนให้ผลดี
- workflow ไหนพังกับ ComfyUI version ไหน
- model ไหนใช้ memory มาก
- known issue
- troubleshooting notes
- best practice
- stock rejection patterns

---

## 8) โครงสร้าง workflow ที่ควรรองรับ

### 8.1 Text-to-Image
เหมาะกับ:
- ภาพใหม่จาก prompt
- stock concept
- mood / concept generation

input:
- prompt
- preset
- resolution
- frame profile
- seed

---

### 8.2 Image-to-Image
เหมาะกับ:
- transform concept
- restyle
- controlled edit

input:
- source image
- prompt
- denoise / fidelity policy
- preset
- frame profile

---

### 8.3 Reference Edit
เหมาะกับ:
- series consistency
- โยก pose
- เปลี่ยนองค์ประกอบจากหลาย reference

ต้องรองรับ reference หลายรูปและ role-based prompting เช่น:
- identity
- pose
- outfit
- lighting
- environment
- composition

ระบบต้องช่วย compile prompt จาก role ไม่ให้ user ต้องพิมพ์เองทุกครั้ง

---

### 8.4 Single-frame / Experimental workflows
ใช้สำหรับ:
- one-image output
- low-latency experimentation
- lab mode

ข้อควรระวัง:
- ต้องติดธง experimental
- ห้ามเปิดให้ stock mode ถ้า asset stack ยังไม่ผ่าน policy

---

### 8.5 Detail Refiner
ใช้เมื่อ:
- ตา / มือ / texture / edge / object detail มีปัญหา
- อยากได้ความเรียบร้อยเพิ่มโดยยังรักษา broad lighting / color

ระบบต้องรองรับ defect-specific prompt เช่น:
- repair eyes
- improve hands
- clean background artifacts
- fix small object edges
- restore facial detail
- keep composition unchanged

---

## 9) รูปแบบ prompt abstraction

แทนที่จะปล่อย prompt ดิบทั้งหมด  
ระบบควรมี schema เช่น:

```text
subject
environment
action
camera
lighting
style
mood
composition
negative constraints
reference roles
repair target
stock constraints
```

ตัวอย่าง:

```text
subject: young business woman working on laptop
environment: clean bright office
action: typing while looking at screen
camera: medium shot eye-level
lighting: soft natural daylight
style: photorealistic commercial stock photo
composition: clear subject separation and copy space
negative constraints: text watermark logo extra fingers malformed hands
stock constraints: no brand no trademark no copyright characters
```

แล้ว compiler แปลงเป็น prompt ที่เหมาะกับ workflow นั้น

---

## 10) Reference role system

ต้องทำชัดเจนว่ารูปที่ใส่เข้ามาแต่ละรูปมีหน้าที่อะไร

schema แนะนำ:

```text
PRIMARY_IDENTITY
POSE_REFERENCE
OUTFIT_REFERENCE
ENVIRONMENT_REFERENCE
LIGHTING_REFERENCE
STYLE_REFERENCE
COMPOSITION_REFERENCE
OBJECT_REFERENCE
COLOR_REFERENCE
```

ข้อบังคับ:
- Picture ordering ต้องนิ่ง
- prompt compiler ต้องอ้างอิง role และลำดับ
- ถ้าใช้ REF2VA ให้เตือนเรื่อง source_fidelity
- ต้อง validate ว่าจำนวน reference ไม่เกิน workflow capability

---

## 11) Resolution policy

preset resolution ที่ควรมี:

```text
NATIVE_DETAIL      ≈ 0.98 MP
TWO_MP             ≈ 2 MP
CUSTOM
```

หลัก:
- เริ่มจาก native detail เป็น default
- 2 MP เป็น optional ไม่ใช่ default
- higher resolution = higher runtime/memory
- ต้องบันทึก actual width/height ที่ใช้จริง

---

## 12) Frame profile policy

ต้องมี enum ที่อ่านง่าย:

```text
SINGLE_IMAGE
RECOMMENDED
EXTENDED
HIGH
MAXIMUM
```

mapping:
- 1
- 5
- 9
- 13
- 20

หลัก:
- default = RECOMMENDED
- single-frame = experimental
- high/maximum ต้องมี memory warning

---

## 13) Sampling profile policy

preset ที่ระบบควรเข้าใจ:

```text
BASE_QUALITY
BASE_SPEED
FL2VA_TURBO_8
FL2VA_TURBO_4_768
REF2VA_TURBO_4
HYBRID_SINGLE
CUSTOM
```

validation สำคัญ:
- ห้าม mix adapter ผิด family
- FL2VA adapter ต้องใช้กับ FL2VA path
- REF2VA adapter ต้องใช้กับ REF2VA path
- custom mode ต้องรู้ว่า ignore preset fields อะไรบ้าง

---

## 14) Target environments

### 14.1 Local ComfyUI
ใช้เมื่อ:
- dev
- quick test
- personal batch
- debug

### 14.2 Remote ComfyUI / RunPod
ใช้เมื่อ:
- batch ใหญ่
- queue ยาว
- local GPU ไม่พอ
- ต้องการแยก worker

resolver ต้องพิจารณา:
- VRAM
- active jobs
- model availability
- estimated runtime
- cost
- stock priority
- retry history

---

## 15) การเชื่อมกับ Queue (Phase 20.1)

ทุก job ควรมี metadata อย่างน้อย:

- job_id
- provider = minimax_h3
- mode
- preset
- stock_mode
- frame_profile
- estimated_memory
- estimated_runtime
- priority
- retry_count
- target_execution_node
- review_required

queue states:
- QUEUED
- VALIDATING
- WAITING_MODELS
- RUNNING
- SELECTING_OUTPUT
- REVIEW_REQUIRED
- REFINING
- QC
- COMPLETED
- FAILED
- BLOCKED_LICENSE
- BLOCKED_POLICY
- CANCELED

---

## 16) Output artifact model

ผลลัพธ์แต่ละงานต้องเก็บเป็น asset package เช่น:

```text
preview/
final/
candidates/
metadata/
prompt/
workflow/
logs/
review/
```

ต้องมีไฟล์หรือ record อย่างน้อย:
- final image
- candidate images (optional)
- workflow JSON used
- provider settings
- prompt package
- seed
- resolution
- frame profile
- preset
- model manifest
- review notes
- stock QC result

---

## 17) Metadata / provenance ที่ต้องเก็บ

อย่างน้อย:
- asset_id
- project_id
- job_id
- created_at
- provider_name
- provider_version
- workflow_key
- workflow_version
- preset
- mode
- prompt hash
- prompt text / structured prompt
- source image refs
- reference image refs
- model stack
- adapter stack
- seed
- width
- height
- frame profile
- detail refine used?
- reviewer result
- stock mode result
- export status

---

## 18) UI ที่ควรมี

### 18.1 H3 Studio Panel
ส่วนกรอก:
- mode
- preset
- prompt
- structured prompt helper
- source image
- reference image slots
- resolution
- seed
- stock mode
- refine toggle

### 18.2 Job Monitor
แสดง:
- queue state
- current stage
- selected execution target
- preview
- logs
- errors
- retry

### 18.3 Candidate Picker
แสดง:
- recommended image
- candidate list
- score / diagnostics (ถ้ามี)
- choose final
- send to refine

### 18.4 Stock QC Panel
แสดง:
- license status
- people/IP/logo checks
- artifact checks
- reviewer checklist
- approve / reject / refine

---

## 19) MCP tools ที่ควรมี

```text
h3_list_workflows
h3_list_presets
h3_list_models
h3_validate_stack

h3_create_job
h3_estimate_job
h3_run_job
h3_get_job
h3_cancel_job

h3_submit_reference_edit
h3_submit_i2i
h3_submit_t2i
h3_submit_detail_refine

h3_get_candidates
h3_select_candidate
h3_send_to_refine

h3_run_stock_qc
h3_get_provenance
h3_export_asset

h3_get_known_issues
h3_sync_knowledge
```

permission model:
- `h3.read`
- `h3.run`
- `h3.review`
- `h3.export`
- `h3.admin`

---

## 20) REST API ที่ควรมี

```text
GET  /api/h3/workflows
GET  /api/h3/presets
GET  /api/h3/models
POST /api/h3/validate

POST /api/h3/jobs
GET  /api/h3/jobs/:id
POST /api/h3/jobs/:id/run
POST /api/h3/jobs/:id/cancel

GET  /api/h3/jobs/:id/candidates
POST /api/h3/jobs/:id/select-candidate
POST /api/h3/jobs/:id/refine

POST /api/h3/jobs/:id/stock-qc
GET  /api/h3/assets/:id/provenance
POST /api/h3/assets/:id/export
```

---

## 21) Realtime events

```text
h3.job.created
h3.job.validated
h3.job.started
h3.job.progress
h3.job.candidate_ready
h3.job.review_required
h3.job.refine_started
h3.job.stock_qc_completed
h3.job.completed
h3.job.failed

h3.model.missing
h3.license.blocked
h3.export.completed
```

---

## 22) Adobe Stock Mode — กฎสำคัญ

### 22.1 ก่อน generate
ต้องตรวจ:
- workflow ผ่าน stock policy หรือไม่
- model stack ผ่านหรือไม่
- preset ผ่านหรือไม่
- reference images มีสิทธิ์ใช้หรือไม่

### 22.2 หลัง generate
ต้องตรวจ:
- recognizable logo
- readable copyrighted text
- watermark
- deformed hands
- unnatural eyes
- malformed objects
- overprocessed skin
- weird reflections
- merged limbs
- fake UI / text noise ถ้าไม่ต้องการ
- trademark / character / brand lookalike

### 22.3 ก่อน export
ต้องมี checklist เช่น:
- [ ] model license approved
- [ ] output reviewed
- [ ] no restricted logo/text
- [ ] no famous person / character
- [ ] hands/face acceptable
- [ ] metadata attached
- [ ] provenance recorded

---

## 23) License governance ที่ต้องเข้ม

ต้องแยก 3 ชั้น:

### ชั้น 1: code repository license
ตัว repo อาจใช้ได้เชิงพาณิชย์

### ชั้น 2: model asset license
model / checkpoint / adapter / VAE ต้องดูแยกตัว

### ชั้น 3: output usage policy
บาง stack อาจ “generate ได้” แต่ยัง “ไม่อนุญาต stock mode”

ดังนั้นห้ามใช้ logic ว่า:
> repo ใช้เชิงพาณิชย์ได้ → output ทุกอย่างปลอดภัย

ต้องมี `Model License Registry` จริง

---

## 24) การเชื่อมกับ Phase 20.5 Knowledge Brain

ทุกครั้งที่ run สำเร็จหรือ fail ต้องส่ง knowledge candidate เช่น:

- H3 turbo 8-step กับ native detail บน GPU รุ่นใดใช้เวลากี่วินาที
- preset ไหนเหมาะกับ stock people
- REF2VA source_fidelity ช่วงไหนถ่ายโอน pose ดี
- Qwen refine ช่วยแก้ defect ประเภทใดได้ผล
- workflow ไหนพังกับ ComfyUI version ไหน
- adapter mismatch เกิด error แบบไหน
- stock QC rejection patterns

Knowledge page ตัวอย่าง:
- `MiniMax H3 Overview`
- `MiniMax H3 Presets`
- `MiniMax H3 Known Issues`
- `MiniMax H3 Stock Policy`
- `MiniMax H3 Reference Editing Best Practices`
- `MiniMax H3 Detail Refinement Playbook`

---

## 25) การเชื่อมกับ Desktop Agent (Phase 20.3)

Desktop Agent มีไว้สำหรับ:
- ดู canvas ของ ComfyUI
- verify visual state
- debug node missing
- import workflow UI json
- manual intervention เฉพาะตอนจำเป็น

ไม่ควรใช้ Desktop Agent เป็นเส้นทางหลักของ production run  
แต่ควรใช้เป็น:
- support mode
- debugging mode
- rescue mode
- validation mode

---

## 26) การเชื่อมกับ Engineering Council (Phase 20.4)

Council ใช้กับงาน:
- inspect repo structure
- propose integration design
- implement adapter
- add tests
- review stock mode
- review security / license policy
- run migration
- fix breakages
- create docs
- produce final report

อาจแยก agent roles เช่น:
- Architecture Agent
- ComfyUI Adapter Agent
- Queue/Infra Agent
- Stock Policy Agent
- Testing Agent
- Documentation Agent

---

## 27) ความปลอดภัยและข้อควรระวัง

### 27.1 Secret safety
ห้ามเก็บ:
- API keys ใน workflow JSON แบบถาวร
- token ใน exported artifacts
- remote endpoint secrets ใน logs

### 27.2 Path safety
validate file path ของ model และ workflow

### 27.3 Remote execution safety
ถ้าใช้ remote ComfyUI:
- auth required
- rate limits
- project isolation
- asset cleanup policy

### 27.4 Prompt safety
ต้องมี policy ว่าไม่ควร generate เนื้อหาที่ผิดกฎของระบบ

### 27.5 Reference safety
reference images ต้องมีสิทธิ์ใช้งาน  
โดยเฉพาะ stock mode

---

## 28) โครงสร้างข้อมูลที่ควรมีในฐานข้อมูล

ตารางเชิงตรรกะ:

```text
h3_workflows
h3_workflow_versions
h3_presets
h3_models
h3_model_files
h3_license_policies
h3_jobs
h3_job_inputs
h3_job_outputs
h3_candidates
h3_reviews
h3_stock_qc_results
h3_exports
h3_execution_targets
h3_runtime_metrics
h3_known_issues
```

ถ้ามีตารางเดิมใน Pao-hubPro อยู่แล้ว ให้ **reuse / extend**  
ห้ามสร้างระบบซ้ำถ้าของเดิมรองรับได้

---

## 29) Definition of Done

### ด้าน workflow
- [ ] มี H3 provider adapter
- [ ] รัน T2I ได้
- [ ] รัน I2I ได้
- [ ] รัน Reference Edit ได้
- [ ] รัน Detail Refiner ได้
- [ ] รองรับ preset system

### ด้าน orchestration
- [ ] ต่อ Phase 20.1 queue ได้
- [ ] เลือก local/remote target ได้
- [ ] มี job states ชัดเจน
- [ ] retry / cancel / resume ทำงานได้

### ด้าน quality
- [ ] มี candidate selection
- [ ] มี review flow
- [ ] มี stock QC
- [ ] มี provenance

### ด้าน compliance
- [ ] มี model registry
- [ ] มี license policy engine
- [ ] stock mode block asset ที่ไม่ผ่านได้

### ด้าน knowledge
- [ ] ส่ง run knowledge เข้า Phase 20.5 ได้
- [ ] มี known issue collection
- [ ] มี troubleshooting notes

### ด้าน engineering
- [ ] tests
- [ ] docs
- [ ] config example
- [ ] migration / backfill
- [ ] final verification report

---

## 30) Manual smoke tests

```text
[ ] list H3 workflows
[ ] validate official H3 stack
[ ] run T2I preset QUALITY
[ ] run I2I preset BALANCED
[ ] run REF_EDIT with 2 references
[ ] choose candidate output
[ ] send output to detail refiner
[ ] pass through tone lock
[ ] run stock QC
[ ] export asset package
[ ] inspect provenance
[ ] enqueue remote run
[ ] cancel and retry a job
[ ] block export when license status is unknown
[ ] sync knowledge note to Brain
```

---

## 31) Final Verification Report format

Codex ต้องสรุปอย่างน้อย:

1. Existing Pao-hubPro components reused  
2. Files added  
3. Files modified  
4. Database migrations  
5. H3 provider architecture  
6. Workflow registry  
7. Preset system  
8. Model registry  
9. License policy engine  
10. Queue integration  
11. Local/remote execution routing  
12. Candidate selection  
13. Detail refinement routing  
14. Stock mode and QC  
15. Provenance and metadata  
16. MCP tools  
17. REST API  
18. Realtime events  
19. Dashboard/UI  
20. Knowledge Brain integration  
21. Tests added  
22. Commands executed  
23. Test results  
24. Known limitations  
25. Manual setup required  
26. Recommended next step

ห้ามรายงาน PASS ถ้ายังไม่ได้รันจริง

---

## 32) ลำดับการพัฒนาแนะนำ

```text
1  Inspect existing Generation Studio / Queue / Review / Brain infrastructure
2  Decide where H3 integration belongs in current repo
3  Create workflow registry
4  Create provider adapter
5  Create model registry + license registry
6  Add preset resolver
7  Add job schema
8  Connect to queue
9  Add local/remote execution target resolution
10 Add candidate selection flow
11 Add detail refiner routing
12 Add review + stock QC
13 Add provenance storage
14 Add MCP and REST API
15 Add dashboard / UI
16 Add Knowledge Brain integration
17 Add tests
18 Add docs
19 Run migrations / tests / build
20 Produce final verification report
```

---

## 33) Anti-patterns ที่ห้ามทำ

ห้าม:
- ทำเป็น repo ใหม่โดยไม่จำเป็น
- เรียก ComfyUI ผ่าน desktop clicking เป็นวิธีหลัก
- ปล่อยให้ user ใส่ sampler/adapter ผิด family ง่าย ๆ
- refine ทุกภาพอัตโนมัติ
- export stock โดยไม่ตรวจ license
- ใช้ community experimental assets เป็น default production
- เก็บ output โดยไม่มี provenance
- ทำ preset เป็นแค่ชื่อ แต่ไม่ผูก validation
- ไม่แยก spec-ready กับ implemented
- ใช้ “generate ได้” เท่ากับ “พร้อมขาย stock”

---

## 34) ชื่อ phase ที่แนะนำ

```text
Phase 20.6 — Pao MiniMax H3 Image Studio × Reference Editing × Qwen Detail Refinement Pipeline
```

ชื่อย่อภายใน:
```text
Pao H3 Production Image Engine
```

---

## 35) คำสั่งยาวสำหรับสั่ง Codex ครั้งเดียว

```text
Implement Phase 20.6 now in the existing Pao-hubPro repository.

Do not create a new repository.

This phase must integrate the GitHub project "ComfyUI-MiniMax-H3-Image-Studio" into the existing Pao-hubPro architecture as a provider/integration layer for Pao AI Generation Studio.

Do not build a disconnected prototype.
Do not implement this as a separate standalone app unless the existing repository structure absolutely requires a contained module.
Reuse and extend existing infrastructure wherever possible, especially:
- Generation Studio
- project structure
- Phase 20 GPU/router logic
- Phase 20.1 Smart Queue / Cloud Burst
- Phase 20.3 Desktop Vision Control
- Phase 20.4 Autonomous Engineering Council patterns
- Phase 20.5 Knowledge Brain
- auth / RBAC
- audit
- event bus
- telemetry
- dashboard
- review flows
- asset storage
- existing database models
- existing MCP / REST conventions

Build Phase 20.6 as:
Pao MiniMax H3 Image Studio
× Reference Editing
× Qwen Detail Refinement Pipeline

Core requirements:

1. H3 Provider Integration
- Create a provider adapter for MiniMax H3 image generation.
- Support modes:
  - text_to_image
  - image_to_image
  - reference_edit
  - text_to_image_single
  - image_to_image_single
  - reference_edit_single
  - detail_refiner
- Use ComfyUI API-first execution.
- Desktop automation is only a fallback/debug path, not the main production path.

2. Workflow Registry
- Add a workflow registry that knows available H3 workflows and versions.
- Track UI/API workflow references where useful.
- Track whether a workflow is stable, experimental, stock-safe, or blocked.

3. Preset System
- Implement user-friendly presets such as:
  - QUALITY
  - BALANCED
  - FAST
  - TURBO_FAST
  - REFERENCE_EDIT
  - REFERENCE_EDIT_STRONG
  - DETAIL_REFINE
  - STOCK_SAFE
  - EXPERIMENTAL_SINGLE
- Map each preset to the correct H3 workflow configuration.

4. H3 Model Stack Registry
- Track required models, text encoders, VAEs, turbo adapters, and detail-refiner components.
- Track official vs community assets.
- Track source URL, expected path, filename, fingerprint/checksum if possible, and installation status.
- Track license metadata and whether each asset is approved for commercial use and Adobe Stock Mode.

5. License / Commercial Policy Engine
- Build a policy engine that separately evaluates:
  - repository/code license
  - model/checkpoint/adapter/VAE license
  - output usage restrictions
- Add statuses like:
  - ALLOWED
  - REVIEW_REQUIRED
  - DISALLOWED
  - UNKNOWN
- Block Adobe Stock Mode whenever the required model stack is not approved.

6. Queue and Execution
- Integrate H3 jobs into Phase 20.1 Smart Queue.
- Support execution target resolution:
  - local ComfyUI
  - remote ComfyUI / RunPod worker
- Capture estimated runtime, memory profile, priority, and retry states.
- Add job states like:
  - QUEUED
  - VALIDATING
  - WAITING_MODELS
  - RUNNING
  - SELECTING_OUTPUT
  - REVIEW_REQUIRED
  - REFINING
  - QC
  - COMPLETED
  - FAILED
  - BLOCKED_LICENSE
  - BLOCKED_POLICY
  - CANCELED

7. Candidate Selection
- Support the H3 multi-frame packet / still-image selection concept.
- Preserve candidate outputs when configured.
- Implement recommended selection and manual selection.
- Expose candidate review in UI and API.

8. Reference Role Abstraction
- Implement reference-role support such as:
  - PRIMARY_IDENTITY
  - POSE_REFERENCE
  - OUTFIT_REFERENCE
  - ENVIRONMENT_REFERENCE
  - LIGHTING_REFERENCE
  - STYLE_REFERENCE
  - COMPOSITION_REFERENCE
  - OBJECT_REFERENCE
  - COLOR_REFERENCE
- Compile these into the correct provider prompt structure and reference ordering.

9. Detail Refinement
- Integrate the Qwen Image Edit 2511 detail-refinement path as a second-pass option.
- Make refinement conditional, not mandatory by default.
- Support defect-targeted refine prompts such as eyes/hands/edges/texture cleanup.
- Preserve broad lighting and color behavior via a tone-lock-style output path.
- Do not run refinement automatically on every image unless explicitly configured.

10. Stock Mode
- Add an Adobe Stock Mode with strict gating.
- Before export, validate:
  - workflow stability
  - model-license approval
  - output QC
  - logo/text/watermark issues
  - obvious anatomy defects
  - prohibited IP / character / brand issues
- Require provenance and reviewer approval before final export.

11. Provenance and Metadata
- Persist metadata for every generated asset:
  - job id
  - provider
  - workflow
  - preset
  - prompt package
  - source/reference inputs
  - model stack
  - seed
  - frame profile
  - resolution
  - refinement usage
  - review results
  - export results
- Make provenance queryable via UI/API/MCP.

12. Knowledge Brain Integration
- Integrate Phase 20.6 with Phase 20.5 Living Knowledge Brain.
- Store:
  - tested presets
  - compatibility notes
  - troubleshooting
  - known failures
  - runtime observations
  - stock-safe guidance
- Sync useful knowledge after successful or failed runs.

13. MCP Tools
Add MCP tools such as:
- h3_list_workflows
- h3_list_presets
- h3_list_models
- h3_validate_stack
- h3_create_job
- h3_estimate_job
- h3_run_job
- h3_get_job
- h3_cancel_job
- h3_submit_reference_edit
- h3_submit_i2i
- h3_submit_t2i
- h3_submit_detail_refine
- h3_get_candidates
- h3_select_candidate
- h3_send_to_refine
- h3_run_stock_qc
- h3_get_provenance
- h3_export_asset
- h3_get_known_issues
- h3_sync_knowledge

14. REST API
Add REST endpoints for workflows, presets, jobs, candidates, stock QC, provenance, and export.

15. Realtime Events
Add realtime events for job lifecycle, candidate readiness, stock QC, export, model availability, and license blocks.

16. Dashboard / UI
Add or extend UI panels for:
- H3 Studio
- job monitor
- candidate picker
- stock QC
- provenance viewer
- model/license registry

17. Engineering Standards
- Follow Phase 20.2 spec-driven development.
- Reuse existing repository conventions.
- Add tests.
- Add documentation.
- Add config examples.
- Add migrations only where needed.
- Preserve existing user work.

18. Testing
At minimum add tests for:
- workflow registry
- preset mapping
- model stack validation
- license blocking
- queue integration
- candidate selection
- stock mode gating
- provenance persistence
- API routes
- MCP tools
- knowledge sync hooks

19. Commands
Run the real repository commands for:
- install / sync dependencies as needed
- database migration
- tests
- lint
- typecheck
- build
Fix Phase-20.6-related failures.
Document pre-existing failures separately.

20. Final output
Finish only after producing a full Phase 20.6 Final Verification Report with:
- files added
- files changed
- migrations
- architecture
- commands run
- results
- known limitations
- manual setup steps
- recommended next phase

Important constraints:
- Do not create a disconnected parallel generation platform.
- Do not rely on desktop clicking as the primary execution strategy.
- Do not treat repository code license as equivalent to model-asset license.
- Do not enable Adobe Stock Mode for unreviewed or unknown-license model stacks.
- Do not auto-export final assets without review gates.
- Do not omit provenance.
- Keep “spec status” and “implementation status” separate.
```

---

## 36) ผลลัพธ์ที่คาดหวังหลังจบ Phase 20.6

หลัง phase นี้ Pao-hubPro ควรทำได้ดังนี้:

1. เลือกงาน H3 จาก UI / MCP / API ได้  
2. ระบบเลือก preset ให้แบบเข้าใจง่าย  
3. ระบบตรวจ model stack และ license ก่อนรัน  
4. งานถูกส่งผ่าน queue ไปยัง local หรือ remote ได้  
5. ได้ผลลัพธ์เป็น candidate / final image แบบมี provenance  
6. ส่งเข้ารอบ refine ได้เมื่อจำเป็น  
7. ผ่าน reviewer และ stock QC ได้  
8. export เป็น asset package พร้อม metadata ได้  
9. บันทึก knowledge เข้า Brain ได้  
10. ใช้งานซ้ำได้แบบเป็นระบบ ไม่ใช่แค่ทดลองชั่วคราว

---

## 37) สรุปสั้นที่สุด

Phase 20.6 คือการเปลี่ยน `ComfyUI-MiniMax-H3-Image-Studio`  
จาก “workflow ที่น่าสนใจ” ให้กลายเป็น “เครื่องผลิตภาพระดับ production” ภายใน Pao-hubPro

จุดสำคัญที่สุดของ phase นี้คือ:

- ใช้งานง่ายขึ้นผ่าน preset
- ทำงานจริงผ่าน queue และ API
- ปลอดภัยขึ้นด้วย license / stock gates
- คุณภาพดีขึ้นด้วย reviewer + refiner
- เก็บความรู้ได้ด้วย Knowledge Brain

---

# End of Phase 20.6 Specification
