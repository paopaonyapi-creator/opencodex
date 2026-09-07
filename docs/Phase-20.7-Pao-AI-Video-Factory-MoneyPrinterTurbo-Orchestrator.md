# Phase 20.7 — Pao AI Video Factory × MoneyPrinterTurbo Native AI Video Orchestrator

> **Project:** Pao-hubPro / Pao AI Video Factory / Pao Stock Asset Studio  
> **Phase:** 20.7  
> **Primary Goal:** เชื่อม MoneyPrinterTurbo เข้ากับระบบ Pao-hubPro ในฐานะ Production Engine/Adapter สำหรับสร้างวิดีโออัตโนมัติ โดยให้ Pao-hubPro เป็นสมองหลักในการวางแผน, routing, cost control, QC, reviewer council, metadata และ export  
> **Primary Market Mode:** Adobe Stock First  
> **Secondary Mode:** Social Video / Preview / Internal Production  
> **Implementation Style:** Additive Integration — ห้ามรื้อระบบเดิมถ้าไม่จำเป็น  
> **Codex Mode:** One-shot implementation prompt — อ่านไฟล์นี้แล้วทำงานตั้งแต่ตรวจ repo → implement → test → report ให้ครบ

---

# 0. คำสั่งหลักสำหรับ Codex

คุณคือ Senior Staff Engineer / AI Systems Architect ที่กำลังพัฒนา **Pao-hubPro** ซึ่งเป็น Agentic AI Workspace และ Production Orchestrator สำหรับงานสร้างภาพ/วิดีโอ โดยมี Adobe Stock เป็น use case สำคัญ

ภารกิจของคุณใน Phase 20.7 คือ:

> **Integrate MoneyPrinterTurbo as a first-class video production adapter inside the existing Pao-hubPro / Pao AI Video Factory architecture, with MiniMax H3, Seedance, OFox/Wan, stock-footage and local-media capabilities, while preserving Pao-hubPro as the control plane for orchestration, cost policy, queueing, retries, QC, Reviewer Council, metadata, export packaging, audit and human approval.**

ห้ามเริ่มจากการสร้างโปรเจกต์ใหม่ทันที

ให้ทำตามลำดับนี้เสมอ:

1. Inspect repository
2. Detect existing architecture
3. Detect Phase 20.1–20.6 work if present
4. Detect existing queue/provider/QC/asset/export modules
5. Reuse existing modules
6. Design minimal additive integration
7. Implement
8. Add migrations safely
9. Add tests
10. Run verification
11. Fix regressions caused by this phase
12. Produce final implementation report

ถ้าโครงสร้างจริงของ repository ต่างจากเอกสารนี้:

- ให้ยึด repository จริงเป็น source of truth
- preserve behavior เดิม
- ปรับชื่อ path/module ให้เข้ากับระบบจริง
- ห้าม duplicate ระบบที่มีอยู่แล้ว
- ห้าม reset database
- ห้าม drop table
- ห้ามลบข้อมูลผู้ใช้หรือ asset เดิม

---

# 1. Product Decision

MoneyPrinterTurbo **ไม่ใช่ application หลัก** ของระบบ

ให้ใช้รูปแบบ:

```text
Pao-hubPro / Pao AI Video Factory
        |
        | Control Plane
        v
Production Router
        |
        +-----------------------------+
        |                             |
        v                             v
MoneyPrinterTurbo Adapter       ComfyUI / Runpod Adapter
        |                             |
        +-----------+-----------------+
                    |
                    v
             Generated Assets
                    |
                    v
              Pao Stock QC
                    |
                    v
            Reviewer Council
                    |
                    v
         Metadata + Export Package
                    |
                    v
       HUMAN SUBMISSION REVIEW
```

หลักการสำคัญ:

- Pao-hubPro = สมอง / orchestration / policy
- MoneyPrinterTurbo = production engine
- ComfyUI/Runpod = alternate production engine
- Reviewer Council = independent quality/review layer
- Adobe Stock = human-reviewed export destination

ห้ามผูก business logic สำคัญไว้ใน MoneyPrinterTurbo fork จนทำให้ upgrade upstream ยาก

---

# 2. Upstream MoneyPrinterTurbo Baseline

ณ วันที่ออกแบบ Phase นี้ ให้รองรับ upstream capability ต่อไปนี้เป็นอย่างน้อย:

- WebUI
- API
- CLI
- Agent Skill workflow
- batch manifest CLI
- local images/videos
- Pexels
- Pixabay
- Coverr
- OpenAI-compatible image material source
- MiniMax H3 via Metaso
- Seedance via Volcano Engine Ark
- OFox multi-model video routing
- Wan-family provider through supported gateway where available
- Shengsuan / WaveSpeed style AI video sources when upstream supports them
- voiceover pipeline
- subtitles
- background music
- FFmpeg composition
- 9:16
- 16:9
- 1:1
- task history / generation presets where supported

Known MiniMax H3 capability baseline from current upstream release:

- 768P
- 2K
- 4–15 second source clips
- 9:16
- 16:9
- 1:1

Do not hard-code assumptions permanently.

Create a capability probe / adapter capability map so future upstream versions can differ without breaking the Pao control plane.

---

# 3. Phase 20.7 Scope

Implement the following major components:

1. MoneyPrinterTurbo Adapter
2. MoneyPrinterTurbo Runtime Manager
3. Agent Skill Bridge
4. Provider Capability Registry
5. Smart Production Router
6. MiniMax H3 Provider integration
7. Seedance Provider integration
8. OFox / Wan route integration
9. Local Media / Stock Footage route
10. Batch Production Queue
11. Retry / Resume / Recovery
12. Cost Guard
13. Production Policy Engine
14. Adobe Stock Mode
15. Social Mode
16. Technical Video QC
17. Visual/Commercial QC hook
18. Similarity Gate hook
19. Reviewer Council Gate
20. Metadata handoff
21. Export Package Builder
22. Audit / Usage / Cost logging
23. UI dashboard
24. Settings / secrets handling
25. Automated tests
26. Documentation

---

# 4. Non-Goals

Phase 20.7 ไม่ต้อง:

- rewrite MoneyPrinterTurbo ทั้งระบบ
- fork upstream แบบ hard divergence
- replace ComfyUI
- replace Runpod
- auto-submit ไป Adobe Stock
- auto-approve compliance
- bypass provider billing confirmation
- scrape credentials
- expose API key ไป client
- run arbitrary shell command จาก user input
- download copyrighted music อัตโนมัติ
- use default bundled music for Adobe Stock without rights verification
- publish social content automatically unless explicitly enabled by user policy

---

# 5. Repository Inspection Gate

ก่อนแก้โค้ดให้ Codex inspect อย่างน้อย:

```text
package.json
pnpm-lock.yaml / package-lock.json / yarn.lock / bun.lock
pyproject.toml
requirements.txt
Dockerfile*
docker-compose*.yml
.env.example
prisma/schema.prisma
src/
app/
pages/
server/
services/
lib/
workers/
queues/
providers/
adapters/
modules/
packages/
tests/
docs/
README*
```

ค้นหา keyword:

```text
MoneyPrinterTurbo
ComfyUI
Runpod
MiniMax
H3
Seedance
Wan
video provider
provider router
production job
queue
asset
collection
QC
reviewer
review council
metadata
Adobe Stock
export
audit
usage
cost
phase 20
phase 20.1
phase 20.2
phase 20.3
phase 20.4
phase 20.5
phase 20.6
```

สร้าง internal inspection summary ก่อนเริ่ม coding:

```text
Detected stack:
Detected database:
Detected queue:
Detected existing provider registry:
Detected asset model:
Detected QC pipeline:
Detected reviewer council:
Detected export pipeline:
Detected existing video generation modules:
Detected Phase 20.x modules:
Integration strategy:
Migration risk:
```

ห้ามหยุดเพื่อถาม user ถ้าสามารถ infer จาก repository ได้

---

# 6. Recommended Integration Strategy

Prefer integration order:

## Option A — API Adapter

ใช้เมื่อ MoneyPrinterTurbo runtime มี HTTP API ที่เหมาะสม

```text
Pao-hubPro Server
      |
      v
MPT Adapter
      |
      v
MoneyPrinterTurbo API
```

ข้อดี:

- upgrade upstream ง่าย
- isolate Python environment
- observability ชัด
- retry ง่าย
- security boundary ชัด

## Option B — CLI Adapter

ใช้เมื่อ CLI batch manifest stable กว่า API

```text
Pao Worker
   |
   v
Validated Manifest
   |
   v
MPT CLI
```

ต้อง:

- generate manifest จาก validated schema เท่านั้น
- ห้ามต่อ raw user text เข้า shell command
- use spawn/execFile style argument arrays
- sanitize filesystem paths
- enforce timeout
- capture stdout/stderr
- redact secrets

## Option C — Agent Skill Bridge

ใช้เป็น agent-assisted setup / production helper

```text
Pao Agent
  |
  v
MoneyPrinterTurbo Skill Bridge
  |
  v
mpt_agent workflow
```

ห้ามให้ Skill มี authority เหนือ Pao policy engine

## Option D — Embedded/Fork

ใช้เป็นทางเลือกสุดท้ายเท่านั้น

ถ้าจำเป็นต้อง patch upstream:

- isolate patches
- document diff
- keep upstream remote
- avoid invasive rewrite
- preserve easy rebasing/upgrading

---

# 7. Suggested Module Layout

ถ้า repo ไม่มี convention ที่ดีกว่า ให้สร้างแนวนี้:

```text
src/
  modules/
    video-production/
      domain/
        video-job.ts
        video-provider.ts
        video-capability.ts
        production-policy.ts
        cost-policy.ts
        qc-result.ts

      adapters/
        moneyprinterturbo/
          index.ts
          mpt-adapter.ts
          mpt-client.ts
          mpt-cli-runner.ts
          mpt-manifest.ts
          mpt-capabilities.ts
          mpt-runtime.ts
          mpt-errors.ts
          mpt-normalizer.ts
          mpt-health.ts

        comfyui/
          ...reuse existing...

        runpod/
          ...reuse existing...

      routing/
        production-router.ts
        provider-score.ts
        provider-health.ts
        provider-fallback.ts

      policy/
        production-policy.ts
        adobe-stock-policy.ts
        social-policy.ts
        cost-guard.ts
        rights-policy.ts

      queue/
        video-job-queue.ts
        video-job-worker.ts
        retry-policy.ts
        recovery.ts

      qc/
        technical-video-qc.ts
        visual-qc-adapter.ts
        similarity-gate.ts
        reviewer-council-gate.ts

      export/
        export-package.ts
        export-manifest.ts

      api/
        ...existing route convention...
```

ถ้า repo เป็น monorepo ให้ใส่ใน package ที่เหมาะสมแทน

---

# 8. Core Domain Model

Create a provider-neutral domain model.

Example TypeScript concept:

```ts
export type VideoProviderId =
  | "moneyprinterturbo"
  | "comfyui"
  | "runpod"
  | "metaso-minimax-h3"
  | "seedance"
  | "ofox"
  | "local-media";

export type ProductionMode =
  | "adobe_stock"
  | "social"
  | "preview"
  | "internal";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export interface VideoProductionRequest {
  jobId: string;
  mode: ProductionMode;
  conceptId?: string;
  assetCollectionId?: string;
  prompt: string;
  script?: string;
  aspectRatio: AspectRatio;
  resolution?: string;
  targetDurationSeconds?: number;
  voiceoverEnabled: boolean;
  subtitlesEnabled: boolean;
  musicMode: "none" | "user_owned" | "approved_library" | "provider";
  providerPreference?: VideoProviderId[];
  maxEstimatedCost?: number;
  allowPaidProviders: boolean;
  allowFallback: boolean;
  metadata?: Record<string, unknown>;
}
```

Add Zod schemas for every API/queue boundary.

---

# 9. Provider Capability Registry

สร้าง registry กลาง

Example:

```ts
interface VideoProviderCapabilities {
  providerId: string;
  available: boolean;
  textToVideo: boolean;
  imageToVideo: boolean;
  stockFootage: boolean;
  localMedia: boolean;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  supportsAudio?: boolean;
  supportsBatch?: boolean;
  supportsResume?: boolean;
  requiresPaidConfirmation?: boolean;
  health?: "healthy" | "degraded" | "offline" | "unknown";
}
```

MoneyPrinterTurbo capability detection should not rely only on version string.

Use:

1. configured features
2. runtime health endpoint if available
3. supported CLI/API behavior
4. provider credentials presence
5. last successful execution
6. explicit overrides

---

# 10. MoneyPrinterTurbo Runtime Manager

Implement runtime modes:

```text
external_api
managed_docker
local_cli
agent_skill
```

Configuration example:

```env
MPT_ENABLED=true
MPT_RUNTIME_MODE=external_api
MPT_API_BASE_URL=http://127.0.0.1:8080
MPT_WEBUI_URL=http://127.0.0.1:8501
MPT_REQUEST_TIMEOUT_MS=1800000
MPT_HEALTH_TIMEOUT_MS=5000
MPT_ALLOW_AUTO_START=false
MPT_WORKDIR=
MPT_CLI_COMMAND=
```

Rules:

- never expose these settings to unauthorized users
- secret fields server-only
- health check must not leak credentials
- auto-start off by default
- arbitrary user-supplied executable path prohibited
- configured paths must be administrator-controlled

---

# 11. MoneyPrinterTurbo Adapter Interface

Implement adapter methods such as:

```ts
interface VideoProductionAdapter {
  id: string;
  healthCheck(): Promise<ProviderHealth>;
  getCapabilities(): Promise<VideoProviderCapabilities>;
  estimate(request: VideoProductionRequest): Promise<CostEstimate>;
  submit(request: VideoProductionRequest): Promise<ProviderSubmission>;
  getStatus(externalJobId: string): Promise<ProviderJobStatus>;
  cancel?(externalJobId: string): Promise<void>;
  recover?(externalJobId: string): Promise<ProviderRecoveryResult>;
  collectArtifacts(externalJobId: string): Promise<ProducedArtifact[]>;
}
```

Normalize MPT output into Pao domain objects.

Do not leak MPT-specific response format into unrelated modules.

---

# 12. MPT Manifest Builder

ถ้าใช้ CLI batch manifest ให้สร้าง schema กลาง

Example:

```json
{
  "request_id": "pao-job-...",
  "topic": "...",
  "script": "...",
  "aspect_ratio": "16:9",
  "video_source": "metaso_minimax",
  "voiceover": false,
  "subtitle": false,
  "music": "none"
}
```

Actual keys must follow installed MPT version.

Implementation requirement:

- inspect current CLI schema first
- map fields explicitly
- no arbitrary passthrough from browser input
- validate before writing manifest
- write manifest to isolated job workspace
- deterministic file names
- retain manifest for audit/debug with secrets removed

---

# 13. MiniMax H3 Route

Create explicit route for MPT MiniMax H3 provider.

Baseline capability:

```text
Provider: Metaso MiniMax H3
Resolutions: 768P, 2K
Clip duration: 4–15 seconds
Aspect ratios: 9:16, 16:9, 1:1
Billing: paid
Confirmation: required by cost policy
```

Do not hardcode provider price as permanent business logic.

Cost data should come from:

- configured rate table with observed date
- provider response if available
- admin override
- unknown if unavailable

Store:

```text
estimated_cost
actual_cost
currency
pricing_source
pricing_observed_at
pricing_confidence
```

Unknown remains null.

---

# 14. Seedance Route

Support native Seedance route exposed by MPT when configured.

Provider policy should include:

```text
text-to-video: yes
paid: yes/depends on account
batch: provider dependent
scene-based generation: supported through MPT workflow
```

Do not fabricate available models.

Provider model list must be configuration-driven or discovered.

---

# 15. OFox / Wan Route

Support multi-model gateway through MPT.

Requirements:

- provider and model separated
- no assumption that one API key supports every model forever
- validate provider/model pair
- handle provider_type_unavailable cleanly
- failed preflight should not count as successful submission
- billing state must distinguish:
  - not submitted
  - submitted unknown cost
  - billed
  - failed before billing

---

# 16. ComfyUI / Runpod Fallback

Do not replace existing ComfyUI/Runpod path.

Smart router should be able to route:

```text
MPT MiniMax H3
    ↓ fail/unhealthy/cost policy
MPT Seedance
    ↓ fail/unhealthy
Runpod ComfyUI H3
    ↓ fail/unavailable
other configured provider
```

Fallback must respect:

- user provider preference
- cost ceiling
- paid-provider permission
- aspect ratio
- resolution
- duration
- provider health
- Adobe Stock policy mode
- rights policy

No silent paid fallback.

---

# 17. Smart Production Router

Implement provider scoring.

Suggested factors:

```text
capability_match
provider_health
expected_quality
cost_fit
latency_fit
queue_depth
historical_success_rate
resolution_match
aspect_ratio_match
stock_mode_compatibility
rights_confidence
```

Do not store AI inference as observed provider metrics.

Example pseudo-score:

```text
score =
  capability_match * weight
+ health_score
+ quality_preference
+ cost_fit
+ historical_reliability
- policy_risk
```

Every routing decision should be explainable.

Store routing reason:

```json
{
  "selected": "moneyprinterturbo:metaso-minimax-h3",
  "reasons": [
    "supports 16:9",
    "supports requested resolution",
    "healthy",
    "within configured cost ceiling"
  ],
  "rejected": [
    {
      "provider": "...",
      "reason": "missing credentials"
    }
  ]
}
```

---

# 18. Cost Guard

This is mandatory.

Create states:

```text
FREE
ESTIMATED
REQUIRES_APPROVAL
APPROVED
BLOCKED_BY_LIMIT
COST_UNKNOWN
ACTUAL_RECORDED
```

Rules:

1. Free/local route may proceed according to policy
2. Paid route requires explicit policy permission
3. If estimated cost > job cap → block
4. If cost unknown and policy requires known cost → block
5. Never silently move to a more expensive provider
6. Retry must not create duplicate billable jobs without idempotency protection
7. Record provider task ID before polling
8. Record whether failure happened before or after submission

Admin settings:

```env
VIDEO_COST_GUARD_ENABLED=true
VIDEO_DEFAULT_MAX_JOB_COST=
VIDEO_ALLOW_UNKNOWN_COST=false
VIDEO_REQUIRE_PAID_CONFIRMATION=true
```

Do not commit secrets or real billing values.

---

# 19. Queue Engine

Reuse existing queue if present.

If none exists, create a production-grade abstraction that can later use Redis/BullMQ or existing project infrastructure.

Job states:

```text
DRAFT
VALIDATING
WAITING_APPROVAL
QUEUED
ROUTING
SUBMITTING
PROVIDER_RUNNING
COLLECTING
POST_PROCESSING
QC_PENDING
QC_RUNNING
REVIEW_PENDING
READY_FOR_EXPORT
NEEDS_FIXES
HOLD_FOR_COMPLIANCE_REVIEW
REJECTED_INTERNAL
FAILED_RETRYABLE
FAILED_FINAL
CANCELLED
```

Each transition must be validated.

No invalid jumps.

---

# 20. Idempotency

Paid generation requires strong idempotency.

Create:

```text
client_request_id
job_id
attempt_id
provider_submission_key
external_provider_job_id
```

Before submitting paid generation:

```text
check existing active submission
→ if exists: resume polling
→ if not: submit once
```

Retry polling separately from retry submission.

Never resubmit just because polling timed out.

---

# 21. Retry Policy

Separate error classes:

```text
CONFIG_ERROR
AUTH_ERROR
VALIDATION_ERROR
RATE_LIMIT
NETWORK_ERROR
PROVIDER_TIMEOUT
PROVIDER_REJECTED
PROVIDER_CAPACITY
POLL_TIMEOUT
ARTIFACT_DOWNLOAD_ERROR
LOCAL_PROCESSING_ERROR
POLICY_BLOCK
UNKNOWN
```

Retryable examples:

- temporary network error
- 429 with retry-after
- provider temporary capacity error
- artifact download timeout

Non-retryable examples:

- invalid credentials
- invalid model
- policy block
- unsupported aspect ratio
- malformed user request

Use exponential backoff + jitter where appropriate.

---

# 22. Resume / Recovery

On server restart:

1. Find incomplete jobs
2. Do not resubmit immediately
3. Query provider using stored external job ID
4. Continue polling
5. Recover artifacts if already finished
6. Mark stale if provider state cannot be resolved
7. Require human/admin action if billing state is ambiguous

Create admin action:

```text
Resume
Retry collection
Retry post-process
Retry QC
Cancel local workflow
Mark provider job externally resolved
```

Destructive/manual overrides require audit note.

---

# 23. Job Workspace

Use isolated directories:

```text
storage/
  production-jobs/
    <job-id>/
      request.json
      sanitized-manifest.json
      provider/
      raw/
      processed/
      qc/
      export/
      logs/
```

Requirements:

- prevent path traversal
- no user-controlled absolute paths
- no executable upload trust
- sanitize filenames
- redact secrets
- configurable retention

---

# 24. Adobe Stock Mode

Adobe Stock Mode must be more strict than Social Mode.

Recommended defaults:

```text
voiceover = false
subtitles = false
music = none
watermark = none
logo = none
social overlay = none
auto publish = false
human review = required
```

Why:

Stock buyers generally need reusable footage rather than finished social narration packages.

However, do not encode that as an immutable marketplace rule.

Implement as Pao production preset/policy.

Adobe Stock Mode should prioritize:

- clean source footage
- useful commercial composition
- no unwanted text
- no logo
- no watermark
- copy-space intent when concept requests it
- strong standalone clip value
- clean audio policy
- valid rights/provenance notes
- meaningful variation instead of near duplicates

---

# 25. Music Rights Gate

MoneyPrinterTurbo upstream may include bundled/default music whose rights may not be appropriate for stock redistribution.

For Adobe Stock Mode:

```text
musicMode default = none
```

Allowed only when:

```text
user_owned
approved_library
explicitly_rights_verified_asset
```

Store rights metadata:

```text
music_asset_id
source
license_type
license_reference
rights_verified_by
rights_verified_at
notes
```

If rights unknown:

```text
HOLD_FOR_COMPLIANCE_REVIEW
```

Never label something legally safe automatically.

---

# 26. Generated AI Content Tracking

Every generated artifact should retain lineage:

```text
provider
provider_model
provider_version_if_known
prompt
negative_prompt_if_any
seed_if_available
source_images
source_videos
script
scene_id
job_id
attempt_id
generated_at
AI_generated = true/false/unknown
```

Do not store secrets in lineage.

---

# 27. Scene Model

Create reusable scene entities if not already present.

Example:

```text
VideoProject
  ├─ Scene 01
  ├─ Scene 02
  ├─ Scene 03
  └─ Scene 04
```

Scene fields:

```text
scene_index
buyer_story
script_segment
visual_prompt
negative_prompt
provider
model
aspect_ratio
duration
status
source_type
source_asset_id
output_asset_id
qc_status
```

Allow regeneration of one scene without rebuilding the whole project.

---

# 28. Stock-Footage Route

MoneyPrinterTurbo may use:

- Pexels
- Pixabay
- Coverr
- local media

For Pao Stock Mode, never assume downloaded third-party stock footage can be re-uploaded to Adobe Stock.

Therefore:

```text
Third-party stock source
        |
        v
RIGHTS POLICY GATE
        |
        +--> allowed for social/internal
        |
        +--> blocked/held for Adobe Stock export unless rights are explicitly verified for redistribution
```

This gate is critical.

Use source provenance:

```text
source_provider
source_url
source_asset_id
license_reference
observed_at
rights_status
```

---

# 29. Technical Video QC

Implement automated technical inspection using existing tools or ffprobe/ffmpeg where available.

Check at minimum:

```text
file exists
container format
video codec
audio codec if present
width
height
aspect ratio
fps
duration
bitrate
file size
stream count
decode errors
black/frozen frame indicators if feasible
missing frames if detectable
```

Normalize QC result:

```ts
interface TechnicalVideoQCResult {
  passed: boolean;
  checks: QCCheck[];
  warnings: QCCheck[];
  failures: QCCheck[];
  inspectedAt: string;
}
```

Do not hardcode current Adobe technical limits unless verified and source-dated.

Keep technical requirements configurable.

---

# 30. Visual QC Hook

If existing AI vision QC exists, reuse it.

Potential checks:

```text
visible watermark
brand/logo
malformed text
AI artifacts
warping
flicker
anatomy issues
object morphing
unwanted overlays
scene continuity
subject clipping
commercial clarity
copy space
```

AI QC is advisory.

Do not let one model silently become final authority.

---

# 31. Similarity Gate

Before export, compare against:

- sibling clips in same batch
- recent generated clips
- existing asset library where feasible

Similarity dimensions:

```text
prompt similarity
concept similarity
scene similarity
visual embedding similarity
motion similarity if available
composition similarity
```

Do not reject solely based on one numeric embedding score.

Use human-review flags:

```text
LOW
MEDIUM
HIGH
NEAR_DUPLICATE
```

---

# 32. Reviewer Council Gate

Integrate with existing Pao Reviewer Council if present.

Desired council:

```text
Primary Reviewer
    + ChatGPT/OpenAI reviewer
    + Local AI reviewer
    + Claude/alternate reviewer if configured
    + deterministic technical QC
```

Review categories:

```text
technical_quality
commercial_usefulness
stock_suitability
artifact_risk
similarity_risk
IP/trademark risk
rights risk
metadata readiness
```

Aggregation should produce:

```text
READY FOR HUMAN SUBMISSION REVIEW
NEEDS FIXES
HOLD FOR COMPLIANCE REVIEW
REJECT INTERNALLY
```

Never produce:

```text
GUARANTEED ACCEPTED BY ADOBE
100% LEGALLY SAFE
```

---

# 33. Metadata Handoff

Do not let MoneyPrinterTurbo social captions become Adobe Stock metadata automatically.

Create explicit adapter:

```text
Final Approved Asset
      |
      v
Pao Metadata Engine
      |
      +--> title
      +--> keywords
      +--> description if required by workflow
      +--> AI-generated flag state
```

Metadata must describe actual visible content.

No keyword stuffing.

First keywords should be strongest and most specific.

No artist/person/character/IP names when prohibited by policy.

---

# 34. Export Package

Create standardized package:

```text
export/<asset-id>/
  video.mp4
  metadata.json
  metadata.csv
  qc-report.json
  review-report.json
  lineage.json
  rights.json
  manifest.json
  preview.jpg
```

Optional:

```text
README.txt
```

The package must not contain API keys or secret provider payloads.

---

# 35. Human Approval Boundary

Adobe Stock workflow ends at:

```text
READY FOR HUMAN SUBMISSION REVIEW
```

Do not implement automatic Adobe submission in this Phase.

UI should include buttons such as:

```text
Approve for export
Needs fix
Hold
Reject internally
Regenerate scene
Regenerate full project
```

Human override requires note if it changes a compliance/QC decision materially.

---

# 36. Social Mode

Social Mode may enable:

- voiceover
- subtitles
- music
- captions
- portrait 9:16
- automated composition
- supported publishing integrations

But publishing should remain off by default unless existing system already has explicit authorization/policy.

Separate Social Mode settings from Adobe Stock Mode.

---

# 37. Database Changes

Inspect Prisma/schema first.

If suitable models do not exist, consider additive models similar to:

```prisma
model VideoProductionJob {
  id                    String   @id @default(cuid())
  mode                  String
  status                String
  selectedProvider      String?
  externalProviderJobId String?
  clientRequestId       String?  @unique
  requestJson           Json
  routingJson           Json?
  estimatedCost         Decimal?
  actualCost            Decimal?
  currency              String?
  pricingObservedAt     DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model VideoProductionAttempt {
  id                    String   @id @default(cuid())
  jobId                 String
  attemptNumber         Int
  provider              String
  providerModel         String?
  externalProviderJobId String?
  status                String
  errorCode             String?
  errorMessage          String?
  submittedAt           DateTime?
  finishedAt            DateTime?
  usageJson             Json?
  costJson              Json?
  createdAt             DateTime @default(now())
}

model VideoProductionArtifact {
  id          String   @id @default(cuid())
  jobId       String
  attemptId   String?
  type        String
  path        String
  mimeType    String?
  width       Int?
  height      Int?
  durationMs  Int?
  lineageJson Json?
  qcJson      Json?
  createdAt   DateTime @default(now())
}
```

Adapt names to existing schema.

Do not create duplicates if equivalent models already exist.

---

# 38. Database Migration Safety

Mandatory:

- additive migration
- no prisma migrate reset
- no drop database
- no destructive migration against unknown DB
- backup-aware instructions
- safe backfill for new non-null fields
- index frequently queried status/job/provider fields
- use transactions for multi-record workflow transitions

---

# 39. Audit Events

Add/reuse events such as:

```text
VIDEO_JOB_CREATED
VIDEO_PROVIDER_SELECTED
VIDEO_COST_APPROVAL_REQUESTED
VIDEO_COST_APPROVED
VIDEO_PROVIDER_SUBMITTED
VIDEO_PROVIDER_RESUMED
VIDEO_ARTIFACT_COLLECTED
VIDEO_QC_STARTED
VIDEO_QC_COMPLETED
VIDEO_REVIEW_COMPLETED
VIDEO_JOB_HELD
VIDEO_EXPORT_APPROVED
VIDEO_EXPORT_CREATED
VIDEO_JOB_CANCELLED
VIDEO_MANUAL_OVERRIDE
```

Audit payload must not contain secrets.

---

# 40. Usage Tracking

Record where available:

```text
provider
model
job
attempt
submitted_at
completed_at
latency
input_duration
output_duration
resolution
usage units
estimated cost
actual cost
currency
billing confidence
```

Unknown values stay null.

Never invent cost.

---

# 41. Settings UI

Create or extend:

```text
Settings
  └─ Video Production
       ├─ General
       ├─ MoneyPrinterTurbo
       ├─ MiniMax H3
       ├─ Seedance
       ├─ OFox
       ├─ ComfyUI / Runpod
       ├─ Cost Guard
       ├─ Adobe Stock Policy
       └─ Social Policy
```

Rules:

- password-type fields for secrets
- never return secret value after save
- show configured/not configured
- test connection button
- health indicator
- provider capability preview
- admin-only sensitive settings

---

# 42. Dashboard UI

Create production dashboard with:

```text
Overview
Queue
Active Jobs
Needs Approval
Needs QC
Needs Review
Ready for Export
Failed / Recovery
Provider Health
Cost Usage
```

Each job row should show:

```text
job id
mode
concept
provider
model
status
progress
estimated cost
actual cost
created time
last update
```

Actions context-dependent.

---

# 43. Job Detail UI

Tabs:

```text
Summary
Scenes
Provider
Artifacts
QC
Reviewer Council
Metadata
Rights
Cost
Logs
Audit
Export
```

Show routing explanation.

Show why provider was selected/rejected.

Show retry history separately from provider submissions.

---

# 44. Create Job UI

Fields:

```text
Production Mode
Concept/Opportunity
Prompt
Script
Aspect Ratio
Duration
Resolution
Provider Preference
Allow Paid Provider
Maximum Cost
Voiceover
Subtitle
Music
Fallback Policy
```

When Adobe Stock Mode selected:

Auto defaults:

```text
voiceover off
subtitle off
music none
auto-publish off
human review on
```

Display these as policy-driven defaults, not hard-coded irreversible values.

---

# 45. UI Design Direction

Follow Pao Stock Asset Studio direction:

```text
Desktop-first
Premium SaaS
White base
Blue + Green accent
Dense but readable
Clear status hierarchy
```

Must implement:

- loading
- empty
- error
- stale data
- disabled state
- permission state

Do not create a flashy consumer-video UI that conflicts with Pao-hubPro workspace style.

---

# 46. API Routes

Adapt to actual framework.

Potential routes:

```text
POST   /api/video/jobs
GET    /api/video/jobs
GET    /api/video/jobs/:id
POST   /api/video/jobs/:id/approve-cost
POST   /api/video/jobs/:id/cancel
POST   /api/video/jobs/:id/resume
POST   /api/video/jobs/:id/retry
POST   /api/video/jobs/:id/qc
POST   /api/video/jobs/:id/review
POST   /api/video/jobs/:id/export
GET    /api/video/providers
GET    /api/video/providers/health
POST   /api/video/providers/mpt/test
```

All input validated with Zod or existing validation framework.

Auth/role guard required.

---

# 47. Security Requirements

Mandatory:

1. API keys server-side only
2. secrets encrypted at rest if existing settings system supports it
3. redact secrets from logs
4. redact secrets from errors
5. validate URL configuration
6. treat provider URLs as SSRF-sensitive
7. restrict arbitrary filesystem access
8. no raw shell interpolation
9. no arbitrary command execution from user input
10. safe file download validation
11. content-type and size checks
12. timeout all external requests
13. permission-check admin settings
14. audit critical actions
15. CORS must remain restrictive

---

# 48. Provider URL Safety

For configurable MPT base URL:

- admin-only
- validate protocol
- consider allowlist / private-network policy according to deployment architecture
- do not let normal user provide arbitrary URL per request
- do not proxy arbitrary URLs blindly

If Pao-hubPro and MPT are intentionally on same private network, document this explicitly.

---

# 49. MPT Upstream Compatibility

Create version metadata:

```text
runtimeVersion
adapterCompatibilityVersion
capabilitiesDetectedAt
```

Do not block solely because upstream minor version differs.

Instead:

```text
probe capabilities
run compatibility check
warn if unknown
```

Add adapter tests using fixtures from current supported upstream response shapes.

---

# 50. Health Checks

Provider health:

```text
healthy
degraded
offline
misconfigured
unknown
```

MPT health should test:

- API reachable
- required route reachable
- runtime version if available
- storage accessible if needed
- provider credentials configured status where safely detectable

Do not trigger paid generation from health check.

---

# 51. Observability

Use structured logs.

Example:

```json
{
  "event": "video.provider.submitted",
  "jobId": "...",
  "attemptId": "...",
  "provider": "moneyprinterturbo",
  "providerModel": "metaso-minimax-h3",
  "externalJobId": "..."
}
```

Never log:

```text
API keys
tokens
full auth headers
private credential files
```

---

# 52. Error UX

Convert low-level error to actionable UI.

Examples:

```text
Missing MiniMax H3 credential
Provider unavailable
Unsupported aspect ratio
Cost exceeds job limit
Provider job submitted but polling timed out
Artifact download failed
QC failed
Rights status unknown
```

Show:

- what happened
- whether user was billed if known
- safe next action
- whether retry will resubmit or only resume

---

# 53. Testing Strategy

Add tests for:

## Unit

```text
manifest mapping
capability matching
routing score
cost guard
state transitions
retry classification
rights policy
Adobe Stock defaults
metadata handoff
secret redaction
```

## Integration

```text
MPT API client mocked
MPT CLI runner mocked
job submission
provider polling
artifact collection
recovery
QC transition
review transition
export package
```

## Failure Tests

```text
missing credential
401 provider
429 provider
network timeout
poll timeout
provider finished but download fails
restart during polling
duplicate retry
cost cap exceeded
unknown cost blocked
MPT unavailable → fallback
paid fallback prohibited
rights unknown in Adobe Stock mode
```

## Security Tests

```text
path traversal
shell injection
SSRF-like configured URL misuse
secret returned to client
secret logged in error
unauthorized settings access
```

---

# 54. Mock Provider

Provide a deterministic fake provider for local development/tests.

Modes:

```text
success
slow_success
fail_before_submit
fail_after_submit
rate_limit
poll_timeout
artifact_download_failure
```

This allows testing without spending provider credits.

Clearly label mock output.

---

# 55. End-to-End Scenario A — Adobe Stock / MiniMax H3

```text
Create Concept
↓
Create Video Job
Mode = Adobe Stock
16:9
2K
Music = None
Voice = Off
Subtitle = Off
↓
Router checks providers
↓
MPT MiniMax H3 selected
↓
Cost estimate
↓
User approval if required
↓
Submit once
↓
Poll provider
↓
Collect video
↓
ffprobe technical QC
↓
Visual QC
↓
Similarity Gate
↓
Reviewer Council
↓
Metadata
↓
Export Package
↓
READY FOR HUMAN SUBMISSION REVIEW
```

---

# 56. End-to-End Scenario B — Provider Failure

```text
MPT MiniMax H3 selected
↓
Provider capacity error before billable submission
↓
Retry according to policy
↓
Still fails
↓
Router evaluates fallback
↓
Seedance available
↓
Cost policy requires approval
↓
WAITING_APPROVAL
↓
User approves
↓
Submit Seedance
```

No silent extra cost.

---

# 57. End-to-End Scenario C — Polling Timeout

```text
Paid job submitted
↓
external job ID stored
↓
poll timeout
↓
FAILED_RETRYABLE / PROVIDER_STATE_PENDING
↓
Resume
↓
query same external job ID
```

Do NOT submit a second paid generation automatically.

---

# 58. End-to-End Scenario D — Third-Party Stock Footage

```text
MPT selects Pexels/Pixabay/Coverr
↓
Source provenance stored
↓
Production completed
↓
Adobe Stock mode
↓
Rights redistribution status unknown
↓
HOLD FOR COMPLIANCE REVIEW
```

Social/Internal mode may have a different rights policy but still requires correct licensing behavior.

---

# 59. Environment Documentation

Extend `.env.example` only with placeholders.

Example categories:

```env
# MoneyPrinterTurbo
MPT_ENABLED=false
MPT_RUNTIME_MODE=external_api
MPT_API_BASE_URL=http://127.0.0.1:8080
MPT_WEBUI_URL=http://127.0.0.1:8501
MPT_REQUEST_TIMEOUT_MS=1800000

# Cost policy
VIDEO_COST_GUARD_ENABLED=true
VIDEO_REQUIRE_PAID_CONFIRMATION=true
VIDEO_ALLOW_UNKNOWN_COST=false
VIDEO_DEFAULT_MAX_JOB_COST=

# Optional provider credentials
METASO_MINIMAX_API_KEY=
SEEDANCE_API_KEY=
OFOX_API_KEY=
```

Actual provider environment names must follow project/upstream conventions.

Do not duplicate secrets already managed elsewhere.

---

# 60. Docker / Deployment

If project uses Docker Compose, add MPT as optional profile/service rather than mandatory dependency where appropriate.

Example concept:

```yaml
services:
  moneyprinterturbo:
    profiles: ["video-mpt"]
```

Do not copy blindly.

Inspect current deployment first.

Consider:

- persistent volume
- output volume
- internal network
- API port
- healthcheck
- restart policy
- no public exposure unless needed

---

# 61. Upgrade Strategy

Document how to upgrade MPT:

```text
1. record current supported version
2. update runtime
3. run capability probe
4. run adapter contract tests
5. run mock E2E
6. run one non-paid smoke test
7. optionally run one paid manual test
8. promote
```

If fork used:

```text
upstream/main
pao/mpt-integration
```

Keep Pao patches minimal.

---

# 62. Feature Flags

Add/reuse feature flags:

```text
videoProductionEnabled
moneyPrinterTurboEnabled
mptMiniMaxH3Enabled
mptSeedanceEnabled
mptOFoxEnabled
videoCostGuardEnabled
adobeStockVideoModeEnabled
reviewerCouncilVideoGateEnabled
```

Default new paid-provider features to safe/off unless configuration explicitly enables them.

---

# 63. Permissions

Suggested permissions:

```text
video.jobs.read
video.jobs.create
video.jobs.cancel
video.jobs.retry
video.jobs.approve_cost
video.jobs.review
video.jobs.export
video.providers.read
video.providers.manage
video.settings.manage
```

Use existing auth/role system.

---

# 64. Acceptance Criteria

Phase 20.7 is complete only when all applicable items pass:

## Integration

- [ ] Existing repo inspected before implementation
- [ ] Existing video/provider modules reused
- [ ] MoneyPrinterTurbo adapter implemented
- [ ] runtime health check implemented
- [ ] capability registry implemented
- [ ] MiniMax H3 route supported
- [ ] Seedance route supported when configured
- [ ] OFox route supported when configured
- [ ] ComfyUI/Runpod preserved
- [ ] routing/fallback works

## Cost / Reliability

- [ ] Cost Guard implemented
- [ ] Paid provider requires policy approval
- [ ] No silent paid fallback
- [ ] Job idempotency exists
- [ ] Poll retry separated from resubmission
- [ ] Resume after restart supported
- [ ] external provider job ID persisted

## Adobe Stock

- [ ] Adobe Stock preset implemented
- [ ] Voice/Subtitles/Music default off
- [ ] no auto publish
- [ ] third-party stock rights gate exists
- [ ] technical QC exists
- [ ] visual QC hook exists
- [ ] similarity gate exists/reused
- [ ] Reviewer Council gate exists/reused
- [ ] human review boundary enforced
- [ ] metadata handoff exists
- [ ] export package works

## Security

- [ ] API keys server-side
- [ ] secrets redacted
- [ ] no shell interpolation from user input
- [ ] path traversal blocked
- [ ] provider URL validation exists
- [ ] privileged settings protected
- [ ] audit events recorded

## UI

- [ ] provider health screen
- [ ] production queue
- [ ] job detail
- [ ] cost approval
- [ ] QC/review states
- [ ] export readiness
- [ ] loading/empty/error/stale states

## Tests

- [ ] unit tests
- [ ] integration tests
- [ ] failure tests
- [ ] security tests
- [ ] production build passes

---

# 65. Definition of Done

Before Codex reports done, run actual project commands discovered from repository.

At minimum attempt:

```text
typecheck
lint
unit tests
integration tests
production build
```

If Python/MPT helper code is added:

```text
python tests / lint / format checks according to repo configuration
```

If Docker changes:

```text
docker compose config validation
```

If Prisma changes:

```text
prisma validate
migration review
```

Do not invent successful test results.

Report failures honestly.

---

# 66. Final Codex Report Format

When implementation ends, output:

```text
# Phase 20.7 Implementation Report

## Status
COMPLETE / PARTIAL / BLOCKED

## Architecture Detected
...

## Integration Strategy Used
API / CLI / Agent Skill / Hybrid

## Files Added
...

## Files Modified
...

## Database Migrations
...

## New Environment Variables
...

## Provider Support
- MoneyPrinterTurbo
- MiniMax H3
- Seedance
- OFox/Wan
- ComfyUI
- Runpod

## Cost Guard
...

## Queue / Retry / Resume
...

## Adobe Stock Mode
...

## QC / Reviewer Council
...

## Security Review
...

## Tests Run
command → result

## Build Result
...

## Known Limitations
...

## Manual Setup Required
...

## Recommended Next Phase
...
```

---

# 67. Recommended Implementation Order

Codex should implement in this order:

```text
STEP 1  Repo inspection
STEP 2  Architecture map
STEP 3  Domain schema
STEP 4  Capability registry
STEP 5  MPT health/runtime/client
STEP 6  MPT adapter
STEP 7  MiniMax/Seedance/OFox mapping
STEP 8  Provider router
STEP 9  Cost Guard
STEP 10 Queue + state machine
STEP 11 Idempotency
STEP 12 Retry + recovery
STEP 13 Artifact collection
STEP 14 Adobe Stock policy
STEP 15 Rights gate
STEP 16 Technical QC
STEP 17 Visual/similarity hooks
STEP 18 Reviewer Council
STEP 19 Metadata handoff
STEP 20 Export package
STEP 21 API
STEP 22 UI
STEP 23 Audit/usage
STEP 24 Tests
STEP 25 Build verification
STEP 26 Documentation
STEP 27 Final report
```

---

# 68. Architecture Target

Final architecture should resemble:

```text
┌──────────────────────────────────────────────────────────────┐
│                         Pao-hubPro                           │
│                                                              │
│  Research → Opportunity → Concept → Production Planner       │
│                               │                              │
│                               v                              │
│                    Production Policy Engine                  │
│                               │                              │
│                    Cost Guard / Rights Gate                  │
│                               │                              │
│                               v                              │
│                    Smart Production Router                   │
│                       /       |        \                     │
│                      /        |         \                    │
│                     v         v          v                   │
│                   MPT      ComfyUI     Runpod                │
│                    │                                         │
│          ┌─────────┼──────────────┐                          │
│          v         v              v                          │
│      MiniMax H3  Seedance      OFox/Wan                      │
│          │         │              │                          │
│          └─────────┴──────────────┘                          │
│                    │                                         │
│                    v                                         │
│                Asset Library                                 │
│                    │                                         │
│                    v                                         │
│           Technical + Visual QC                              │
│                    │                                         │
│                    v                                         │
│              Similarity Gate                                 │
│                    │                                         │
│                    v                                         │
│              Reviewer Council                                │
│                    │                                         │
│                    v                                         │
│             Metadata + Export                                │
│                    │                                         │
│                    v                                         │
│        READY FOR HUMAN SUBMISSION REVIEW                     │
└──────────────────────────────────────────────────────────────┘
```

---

# 69. Engineering Principles

Follow these principles throughout implementation:

```text
Pao owns policy
Adapters own provider translation
Providers never own workflow state
Queue owns execution lifecycle
Cost Guard owns paid-action permission
QC is separate from generation
Reviewer Council is separate from provider
Human approval is separate from AI review
Assets retain provenance
Unknown data stays unknown
Secrets stay server-side
Migrations stay additive
Upstream stays replaceable
```

---

# 70. Critical Guardrails

DO NOT:

```text
- rebuild the whole Pao project
- replace working modules unnecessarily
- delete old phases
- reset database
- hardcode API keys
- expose secrets in browser
- auto-submit Adobe Stock
- claim Adobe acceptance
- claim legal safety
- treat AI QC as final legal judgment
- silently retry billable submissions
- silently switch to expensive provider
- use third-party stock footage as Adobe resale material without rights verification
- assume bundled music is redistributable
- log credentials
- interpolate raw user strings into shell commands
- invent costs or marketplace data
```

---

# 71. Success Outcome

Phase 20.7 should make Pao-hubPro capable of receiving a production request such as:

```text
สร้าง Adobe Stock video
Concept: AI-powered smart factory inspection
Aspect Ratio: 16:9
Resolution: 2K preferred
Duration: 8 sec
No voice
No subtitle
No music
Budget <= configured limit
Prefer MiniMax H3
Fallback allowed
```

and automatically execute:

```text
validate
→ policy
→ provider capability check
→ cost guard
→ route
→ request approval if needed
→ generate
→ poll safely
→ recover if interrupted
→ collect asset
→ technical QC
→ visual QC
→ similarity
→ reviewer council
→ metadata
→ export package
→ human review
```

without tying the whole application directly to one AI provider.

---

# 72. Recommended Next Phase

After Phase 20.7 is stable, recommend:

## Phase 20.8 — Pao AI Video Factory × Adaptive Multi-Provider Benchmark & Auto-Router

Possible scope:

- controlled benchmark jobs
- provider quality scoring
- latency tracking
- actual cost tracking
- failure-rate tracking
- model-specific scorecards
- prompt/model matching
- adaptive routing
- budget-aware provider selection
- quality-per-cost ranking
- Adobe Stock production performance feedback

Important:

Do not implement Phase 20.8 automatically unless explicitly requested.

---

# 73. Upstream References

Use these for implementation verification and update checks:

```text
MoneyPrinterTurbo Repository:
https://github.com/harry0703/MoneyPrinterTurbo

English README:
https://github.com/harry0703/MoneyPrinterTurbo/blob/main/README-en.md

Releases:
https://github.com/harry0703/MoneyPrinterTurbo/releases

Agent Skill:
https://raw.githubusercontent.com/harry0703/MoneyPrinterTurbo/main/docs/skill/SKILL.md
```

Current baseline verified for this Phase:

```text
Release line: v1.3.6
Major relevant additions:
- native Volcano Engine Ark Seedance source generation
- OFox multi-model text-to-video
- Metaso MiniMax H3
- OpenAI-compatible text-to-image material source
- CLI batch manifest mode
- centralized AI video provider settings
- stricter same-origin browser API access by default
```

Before implementing against a later release, inspect upstream again.

---

# 74. Final Instruction to Codex

**เริ่มทำงานได้ทันที**

Do not stop at architecture documentation.

Do not only create TODO files.

Do not only scaffold empty modules.

Inspect the real repository, implement the integration as far as the repository permits, run the real checks, fix issues introduced by Phase 20.7, and return a precise implementation report.

If external API credentials are unavailable:

- implement complete adapter logic
- implement mocks
- implement capability health states
- implement tests
- mark live paid E2E as NOT RUN
- do not fabricate successful provider calls

If a feature already exists:

- reuse it
- extend it
- do not duplicate it

If a design choice is ambiguous:

choose the option that best preserves:

```text
security
upgradeability
provider independence
human approval
cost safety
Adobe Stock compliance workflow
existing repository behavior
```

**End of Phase 20.7 specification.**
