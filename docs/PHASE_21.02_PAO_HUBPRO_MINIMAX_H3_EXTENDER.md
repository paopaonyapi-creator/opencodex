# Phase 21.02 — Pao-hubPro × MiniMax H3 Extender

## Persistent Long-Form H3 Video Sequencer, Multi-Clip Motion & Audio Continuity, FL2VA Visual Guide Timeline, Per-Clip LoRA Direction, Resume-Safe Disk Cache, Agent-Driven Prompt & Reference Bridges, Human-Gated Scene Validation & Stock-Ready Individual Clip Production Plane

**Project:** Pao-hubPro  
**Phase:** 21.02  
**Status:** Implementation-ready specification  
**Primary target:** ComfyUI + MiniMax H3 + Runpod + Pao-hubPro  
**Secondary target:** Adobe Stock video production workflow  
**Upstream:** `tritant/ComfyUI_MiniMax_H3_Extender`  
**Upstream version verified during design:** `2.8.1`  
**Design date:** 2026-09-22  
**Implementation policy:** Integrate upstream as an isolated dependency. Do not vendor/copy upstream implementation into Pao-hubPro core by default.

---

# 1. Executive Summary

Phase 21.02 turns **MiniMax H3 Extender** into a production-grade video execution backend for Pao-hubPro.

The phase is not intended to duplicate the Extender UI or rewrite its sequencing logic. Instead, Pao-hubPro becomes the control plane above ComfyUI and uses the Extender as a specialized generation engine.

The target operating model is:

```text
Idea / Stock Opportunity
        ↓
Pao-hubPro Project
        ↓
Script + Scene Planner
        ↓
Scene Prompt Director
        ↓
Reference / LoRA / Guide Planner
        ↓
Policy + Cost Preflight
        ↓
ComfyUI Job Compiler
        ↓
MiniMax H3 Extender
        ↓
Generate → Preview → Retry → Validate
        ↓
Final Decode / Individual Clip Export
        ↓
Technical QC
        ↓
Visual QC
        ↓
Similarity QC
        ↓
Adobe Stock Compliance Gate
        ↓
Human Submission Review
```

The major benefit is that Pao-hubPro can manage a video production project as a durable state machine rather than as a single ComfyUI queue execution.

---

# 2. Why This Phase Exists

A normal ComfyUI workflow is excellent for node-based generation, but a production pipeline needs more than generation.

Pao-hubPro needs to know:

- what project is currently being produced;
- how many scenes exist;
- which scene depends on which previous scene;
- which prompt and references generated each clip;
- which clips are approved;
- which clips need rerendering;
- what model, seed, LoRA and sampler settings were used;
- which cached outputs are still valid;
- whether a failed Runpod session can resume;
- whether an exported clip is technically suitable for stock;
- whether two clips are too similar;
- whether AI-generation disclosure is required;
- whether the final asset is ready for human submission review.

MiniMax H3 Extender already solves several difficult generation-layer problems:

- multi-clip sequencing;
- Motion Context continuation;
- disk/project caching;
- clip validation;
- Ref2VA;
- FL2VA;
- local/global references;
- prompt bridge;
- reference bridge;
- video/audio references;
- per-clip LoRA;
- per-clip color correction;
- project Save/Load;
- interrupt/save/resume;
- final assembly;
- optional individual clip export.

Phase 21.02 wraps these capabilities with orchestration, persistence, observability, policy and stock-production logic.

---

# 3. Scope

## 3.1 In Scope

Phase 21.02 SHALL implement:

1. H3 project registration inside Pao-hubPro.
2. Scene/clip planning.
3. Persistent clip state.
4. Prompt planning per clip.
5. Reference planning.
6. FL2VA guide planning.
7. Per-clip LoRA planning.
8. Extender project synchronization.
9. ComfyUI workflow compilation.
10. Runpod/remote ComfyUI execution.
11. Durable job tracking.
12. Resume after interruption.
13. Clip validation gates.
14. Retry policy.
15. Cost/GPU budget control.
16. Preview collection.
17. Individual clip export tracking.
18. Full-sequence export tracking.
19. Technical video QC.
20. Visual/commercial QC.
21. Similarity checks.
22. Adobe Stock pre-submission checks.
23. Provenance and audit log.
24. Human approval before final submission readiness.
25. Safe dependency/license boundary.

## 3.2 Out of Scope

Phase 21.02 SHALL NOT:

- automatically submit assets to Adobe Stock;
- bypass Adobe Stock moderation;
- declare that an asset will be accepted;
- automatically upload hundreds of near-duplicate clips;
- copy the upstream Extender source into Pao-hubPro core without explicit review;
- modify or delete user media without an explicit destructive action;
- expose Runpod, ComfyUI or storage secrets to the browser;
- silently overwrite a validated production clip;
- silently regenerate downstream clips without recording why.

---

# 4. Verified Upstream Capabilities

The upstream repository was verified during phase design.

Relevant capabilities include:

- project version `2.8.1`;
- long multi-clip MiniMax H3 generation;
- Ref2VA + Motion Context;
- Motion Context ON/OFF;
- FL2VA branch;
- up to 3 FL2VA guide images at exact frame positions;
- per-clip LoRA configuration;
- local and global references;
- up to 9 picture references;
- up to 3 video references;
- up to 3 standalone audio references;
- matching video-audio references;
- external Prompt Pack Bridge;
- external Reference Pack Bridge;
- stable reference slot identities;
- automatic source-video FPS correction to the H3 reference timeline;
- clip-by-clip validation;
- project Save/Load;
- interrupt/save/resume;
- per-clip non-destructive color correction;
- final sequence decoding;
- native VIDEO output;
- optional individual clip export after final processing;
- full-batch autosave.

Pao-hubPro SHOULD rely on these upstream features rather than reimplementing them unless a future upstream incompatibility requires an adapter.

---

# 5. Architecture Principle

The key architectural rule is:

> **Pao-hubPro owns intent, state, policy, orchestration and QC. MiniMax H3 Extender owns H3 sequence-generation mechanics.**

Do not make Pao-hubPro depend on Extender internal Python functions more than necessary.

Prefer:

```text
Pao-hubPro
    ↓
Versioned H3 Adapter
    ↓
ComfyUI API / workflow JSON
    ↓
MiniMax H3 Extender nodes
```

Avoid:

```text
Pao-hubPro Core
    ↓
Direct imports from extender.py internals
    ↓
Monkey patches throughout application code
```

This keeps upgrades manageable.

---

# 6. High-Level Architecture

```text
┌───────────────────────────────────────────────────────────┐
│                    Pao-hubPro Web App                     │
│                                                           │
│ Project │ Story │ Scene Timeline │ QC │ Costs │ Approvals │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                 H3 Production Control Plane               │
│                                                           │
│ Project Service                                           │
│ Scene Planner                                             │
│ Prompt Director                                           │
│ Reference Director                                        │
│ LoRA Director                                             │
│ FL2VA Guide Planner                                       │
│ Dependency / Invalidation Engine                          │
│ Policy Engine                                             │
│ Budget Engine                                             │
│ Approval Engine                                           │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   H3 Extender Adapter                     │
│                                                           │
│ Capability Detection                                      │
│ Workflow Compiler                                         │
│ Prompt Pack Compiler                                      │
│ Reference Pack Compiler                                   │
│ Project Sync                                              │
│ Output Collector                                          │
│ Error Normalizer                                          │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│            ComfyUI / Runpod Execution Fabric              │
│                                                           │
│ MiniMax H3 Model                                          │
│ MiniMax H3 Extender                                       │
│ Ref2VA                                                    │
│ Motion Context                                            │
│ FL2VA                                                     │
│ VAE / Decode / Encoder                                    │
│ Optional Upscale / Post Processing                        │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    Asset & QC Plane                       │
│                                                           │
│ Preview Store                                             │
│ Final Clip Store                                          │
│ Technical QC                                              │
│ Visual QC                                                 │
│ Similarity QC                                             │
│ Metadata Draft                                            │
│ Adobe Stock Gate                                          │
└───────────────────────────────────────────────────────────┘
```

---

# 7. Core Services

## 7.1 `H3ProjectService`

Responsibilities:

- create an H3 production project;
- manage project status;
- connect project to an upstream `.ext` representation when available;
- preserve model/workflow versions;
- keep project-level defaults;
- maintain durable project state independently from ComfyUI runtime state.

Suggested project states:

```text
DRAFT
PLANNING
READY
GENERATING
PAUSED
REVIEWING
QC
EXPORTING
READY_FOR_HUMAN_SUBMISSION_REVIEW
HOLD
ARCHIVED
FAILED
```

---

## 7.2 `H3ScenePlanner`

Transforms a script/concept into production scenes.

Each scene SHOULD define:

- purpose;
- buyer use case;
- subject;
- action;
- environment;
- camera;
- duration;
- visual continuity requirement;
- audio requirement;
- desired opening state;
- desired closing state;
- copy-space intent;
- output role.

Example output roles:

```text
ESTABLISHING
ACTION
DETAIL
PROCESS
RESULT
LOOP
TRANSITION
STOCK_STANDALONE
```

For Adobe Stock projects, scenes SHOULD be designed so each exported clip has standalone commercial value.

---

## 7.3 `H3PromptDirector`

Generates structured per-clip prompt data.

Prompt specification:

```ts
type H3PromptSpec = {
  subject: string
  action: string
  environment?: string
  camera?: string
  composition?: string
  lighting?: string
  motion?: string
  continuity?: string
  audioIntent?: string
  copySpace?: string
  commercialUse?: string
  referenceTokens?: string[]
  avoid?: string[]
}
```

The final prompt MUST be stored separately from the structured prompt source.

This allows future regeneration using improved prompt compilers without losing original intent.

---

## 7.4 `H3ReferenceDirector`

Controls references instead of allowing arbitrary file injection.

Reference classes:

```text
GLOBAL_PICTURE
LOCAL_PICTURE
GLOBAL_VIDEO
LOCAL_VIDEO
GLOBAL_AUDIO
LOCAL_AUDIO
FL2VA_FIRST_FRAME
FL2VA_LAST_FRAME
FL2VA_GUIDE
```

Every reference SHALL have:

- immutable asset ID;
- content hash;
- source;
- slot;
- media type;
- width/height where applicable;
- FPS for video;
- duration;
- rights/provenance note;
- project ownership;
- active/inactive state.

Reference slot identities MUST remain stable.

Do not compact:

```text
Picture 1
Picture 3
```

into:

```text
Picture 1
Picture 2
```

if `Picture 2` is intentionally empty.

This matches the upstream stable-reference behavior.

---

# 8. Two Main Production Modes

## 8.1 Mode A — Continuous Story Sequence

Use:

```text
Ref2VA + Motion Context ON
```

Best for:

- same person across scenes;
- same animal/object;
- camera continuation;
- continuous action;
- narrative progression;
- long-form sequence;
- seamless transitions.

Dependency behavior:

```text
Clip 1
  ↓
Clip 2
  ↓
Clip 3
  ↓
Clip 4
```

If Clip 2 changes materially:

```text
Clip 2 = INVALIDATED
Clip 3 = INVALIDATED
Clip 4 = INVALIDATED
```

unless the adapter can prove those outputs are independent.

---

## 8.2 Mode B — Independent Stock Clip Factory

Use:

```text
Motion Context OFF
```

Best for Adobe Stock packs where each clip should stand alone.

Example:

```text
Smart Farm Collection

Clip 01 — wide irrigation field
Clip 02 — soil moisture sensor close-up
Clip 03 — farmer checks controller
Clip 04 — water pump starts
Clip 05 — irrigation line operating
Clip 06 — dashboard monitoring
```

Changing Clip 03 SHOULD NOT automatically invalidate clips 04–06 when the mode is explicitly independent.

This mode is recommended for high-throughput stock production because it provides better random-access rerendering and lower unnecessary GPU work.

---

# 9. FL2VA Director

The FL2VA planner allows a scene to have visual anchors.

Supported planner structure:

```text
First Frame
    ↓
Guide 1 @ frame_idx
    ↓
Guide 2 @ frame_idx
    ↓
Guide 3 @ frame_idx
    ↓
Last Frame
```

Use cases:

- pose progression;
- controlled camera evolution;
- product transformation;
- before/after sequences;
- machine process;
- human action staging;
- object assembly;
- visual metamorphosis.

Proposed model:

```ts
type H3VisualGuide = {
  type: "FIRST" | "GUIDE" | "LAST"
  assetId: string
  frameIndex?: number
  description?: string
}
```

Validation rules:

- maximum 3 intermediate guides;
- guide frame indices MUST be strictly increasing;
- first frame MUST precede guide frames;
- last frame MUST represent the final visible state;
- missing optional guides are allowed;
- changing a guide invalidates only the scope required by the active generation mode.

---

# 10. Per-Clip LoRA Director

Each clip can carry zero or more LoRA assignments.

Proposed structure:

```ts
type ClipLoraAssignment = {
  loraId: string
  strength: number
  order: number
  purpose?: string
}
```

Examples of purpose:

```text
motion
style
camera behavior
subject consistency
domain behavior
```

Rules:

- do not hardcode file paths in scene records;
- resolve LoRA ID to runtime path at job compile time;
- store checksums;
- fail preflight if a required LoRA is missing;
- never silently substitute another LoRA;
- expose upstream global LoRAs separately from per-clip LoRAs.

---

# 11. Prompt Pack Bridge Integration

Pao-hubPro SHOULD generate prompts externally and push them to ComfyUI through the Extender Prompt Pack Bridge.

Target flow:

```text
Pao-hubPro Scene Planner
        ↓
Prompt Director
        ↓
Prompt Policy Check
        ↓
H3 Prompt Pack Compiler
        ↓
MiniMax H3 Prompt Pack Bridge
        ↓
MiniMax H3 Extender
```

Advantages:

- prompts remain versioned in Pao-hubPro;
- AI agents can revise prompts;
- prompts are reproducible;
- prompt generation is decoupled from ComfyUI frontend;
- scenes can be generated from Web App without manually pasting prompt text.

---

# 12. Reference Pack Bridge Integration

Use Reference Pack Bridge for generated or externally processed images.

Example:

```text
Reference Asset Library
      ↓
Crop / Resize / Preprocess
      ↓
Reference Pack Compiler
      ↓
MiniMax H3 Reference Pack Bridge
      ↓
MiniMax H3 Extender
```

Possible Pao-hubPro reference sources:

- generated concept image;
- approved identity reference;
- user-uploaded reference;
- previous generated frame;
- extracted video frame;
- prepared product image;
- FL2VA anchor;
- Pao Stock Asset Studio asset.

All external inputs MUST have provenance recorded.

---

# 13. Clip State Machine

Every clip SHALL use a deterministic state machine.

```text
PLANNED
  ↓
READY
  ↓
QUEUED
  ↓
RUNNING
  ↓
GENERATED
  ↓
PREVIEW_READY
  ├──→ RETRY_REQUESTED
  │        ↓
  │      QUEUED
  │
  ├──→ REJECTED
  │
  └──→ VALIDATED
           ↓
         QC_PENDING
           ↓
    ┌──────┴────────┐
    ↓               ↓
 QC_PASSED        QC_FAILED
    ↓               ↓
 EXPORT_READY     NEEDS_FIXES
    ↓
 EXPORTED
```

Optional states:

```text
INVALIDATED
BLOCKED
CANCELLED
HOLD_COMPLIANCE
```

---

# 14. Validation Semantics

Validation is not merely a UI checkbox.

A `VALIDATED` clip means:

1. the expected output exists;
2. the preview was reviewed;
3. no known blocking issue remains;
4. the generation specification hash is frozen;
5. its dependency relationship is known;
6. downstream execution may use it as approved context.

Store:

```text
validatedBy
validatedAt
validationNote
generationHash
previewAssetId
```

If generation-critical parameters change after validation, validation MUST be revoked.

Critical parameters include:

- prompt;
- seed;
- duration;
- model;
- sampler;
- sampling settings;
- reference media;
- Motion Context;
- FL2VA anchors;
- LoRA assignment.

---

# 15. Invalidation Engine

Pao-hubPro SHALL calculate invalidation scope before regeneration.

Example dependency graph:

```text
A → B → C → D
```

Changing A under Motion Context ON:

```text
invalidate A, B, C, D
```

Changing C:

```text
keep A, B
invalidate C, D
```

Under Motion Context OFF:

```text
changing C
↓
invalidate C only
```

FL2VA independent cards SHOULD follow the upstream independent-cache behavior unless project-level dependencies explicitly override it.

Every invalidation event MUST be logged with:

```text
reason
source clip
affected clips
previous hash
new hash
actor
timestamp
```

---

# 16. Generation Hash

Every generation attempt SHOULD have a reproducibility hash.

Conceptual hash input:

```text
model
model checksum
prompt
negative/avoid constraints
seed
duration
resolution
sampler
steps
cfg/settings
motion context settings
references + hashes
LoRAs + hashes + strength
FL2VA guides + hashes + frame positions
adapter version
workflow template version
```

Example:

```text
generationHash = SHA256(canonicalGenerationSpec)
```

This hash allows Pao-hubPro to detect:

- stale previews;
- cache mismatch;
- accidental rerenders;
- invalid validation;
- duplicated generation attempts.

---

# 17. ComfyUI Adapter

Create a dedicated adapter:

```text
packages/h3-extender-adapter/
```

or the closest equivalent matching the existing Pao-hubPro repository structure.

Responsibilities:

```text
detectCapabilities()
compileWorkflow()
compilePromptPack()
compileReferencePack()
createExtenderProjectPayload()
queuePrompt()
interruptJob()
readHistory()
collectOutputs()
normalizeError()
verifyOutput()
```

No business policy should live inside the adapter.

---

# 18. Capability Detection

Do not assume every remote ComfyUI machine has identical nodes.

The adapter SHOULD detect:

```json
{
  "comfyuiReachable": true,
  "h3Available": true,
  "extenderAvailable": true,
  "extenderVersion": "2.8.1",
  "promptBridge": true,
  "referenceBridge": true,
  "fl2va": true,
  "motionContext": true,
  "individualClipExport": true,
  "nativeVideoOutput": true
}
```

If a required feature is unavailable:

```text
PROJECT / JOB = BLOCKED
```

with actionable remediation.

Never silently degrade a production workflow if the missing feature affects reproducibility.

---

# 19. Workflow Template Registry

Create versioned workflow templates.

Example:

```text
H3_REF2VA_CONTINUOUS_V1
H3_REF2VA_INDEPENDENT_V1
H3_FL2VA_GUIDED_V1
H3_STOCK_BATCH_V1
```

Each template record SHOULD include:

```text
templateId
templateVersion
displayName
workflowJson
requiredNodes
minimumExtenderVersion
modelRequirements
outputContract
createdAt
deprecatedAt
```

A project pins to a template version.

A template upgrade MUST NOT silently rewrite existing projects.

---

# 20. Execution Job Model

One production project can create multiple execution jobs.

Job types:

```text
PREFLIGHT
GENERATE_CLIP
GENERATE_BATCH
PREVIEW
FINAL_DECODE
EXPORT_INDIVIDUAL
EXPORT_SEQUENCE
TECHNICAL_QC
VISUAL_QC
SIMILARITY_QC
METADATA
```

Job states:

```text
PENDING
WAITING_FOR_RESOURCE
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
RETRYING
BLOCKED
```

Each job stores:

- provider/worker;
- ComfyUI server;
- prompt ID;
- start/end timestamps;
- GPU type if known;
- estimated cost;
- actual cost if available;
- logs;
- normalized error;
- retry count;
- output asset IDs.

---

# 21. Runpod / Remote GPU Integration

The phase SHOULD integrate through a generic worker abstraction rather than hardcoding Runpod.

```ts
interface VideoWorker {
  health(): Promise<WorkerHealth>
  capabilities(): Promise<WorkerCapabilities>
  submit(job: CompiledWorkflow): Promise<RemoteJobRef>
  status(ref: RemoteJobRef): Promise<JobStatus>
  interrupt(ref: RemoteJobRef): Promise<void>
  outputs(ref: RemoteJobRef): Promise<WorkerOutput[]>
}
```

Initial implementation:

```text
ComfyUIWorker
  └─ Runpod-hosted ComfyUI
```

Future:

```text
LocalComfyUIWorker
LANComfyUIWorker
CloudGpuWorker
```

---

# 22. GPU Budget Guard

Before queueing expensive generation:

```text
Estimate
    ↓
Budget Policy
    ↓
ALLOW / REQUIRE_APPROVAL / DENY
```

Proposed controls:

```text
maxCostPerClip
maxCostPerProject
maxRetryPerClip
maxConcurrentJobs
maxGpuMinutesPerRun
maxFullBatchClips
```

Rules:

- retries SHALL be bounded;
- automatic retry SHALL only target known transient failures;
- quality retry SHALL require policy or human decision;
- never use unlimited retry loops;
- display cumulative project generation cost where provider data exists.

If exact provider cost is unavailable, show:

```text
Estimated / Unknown
```

rather than inventing a value.

---

# 23. Retry Policy

Classify failure:

## Transient

Examples:

- remote connection lost;
- worker temporarily unavailable;
- queue timeout;
- recoverable output fetch failure.

May auto-retry within configured limits.

## Deterministic

Examples:

- missing node;
- incompatible model;
- missing LoRA;
- invalid workflow;
- invalid reference;
- corrupt asset.

Do not repeatedly retry.

## Quality

Examples:

- anatomy issue;
- malformed object;
- poor motion;
- visual artifact;
- unwanted text;
- broken continuity.

Quality rerender requires a new generation attempt record.

---

# 24. Persistent Resume Strategy

Pao-hubPro is the source of truth for orchestration state.

The Extender `.ext` project is treated as an important execution artifact, not the sole database.

On resume:

```text
1. Load Pao-hubPro project.
2. Check remote worker health.
3. Verify Extender capability/version.
4. Locate most recent Extender project artifact.
5. Reconcile clip hashes.
6. Reconcile exported output hashes.
7. Mark stale/missing runtime items.
8. Resume only from the earliest required clip/job.
```

Never assume the remote GPU filesystem is permanent.

Important artifacts SHOULD be copied to durable storage after successful generation.

---

# 25. Storage Layout

Proposed logical layout:

```text
/projects/{projectId}/
  manifest.json
  source/
  references/
  prompts/
  extender/
    project.ext
    workflow.json
  previews/
  clips/
    clip-001/
      attempts/
      approved/
    clip-002/
      attempts/
      approved/
  sequence/
  qc/
  metadata/
  audit/
```

Use database IDs as canonical references; paths are implementation details.

---

# 26. Proposed Database Schema

Adapt naming to the existing Pao-hubPro database conventions.

```prisma
model H3Project {
  id                    String   @id @default(cuid())
  name                  String
  status                String
  productionMode        String
  workflowTemplateId    String?
  workflowTemplateVer   Int?
  upstreamVersion       String?
  modelId               String?
  budgetLimit           Decimal?
  estimatedCost         Decimal?
  actualCost            Decimal?
  projectArtifactId     String?
  createdById           String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  clips                  H3Clip[]
  assets                 H3Asset[]
  jobs                   H3Job[]
  approvals              H3Approval[]
  auditEvents            H3AuditEvent[]
}
```

```prisma
model H3Clip {
  id                    String   @id @default(cuid())
  projectId             String
  sequenceIndex         Int
  name                  String?
  state                 String
  mode                  String
  durationSeconds       Float?
  promptStructured      Json?
  promptFinal           String?
  seed                  String?
  modelId               String?
  generationHash        String?
  validatedHash         String?
  validatedAt           DateTime?
  validatedById         String?
  activeAttemptId       String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  project               H3Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  attempts              H3ClipAttempt[]
  references            H3ClipReference[]
  loras                 H3ClipLora[]
  guides                H3ClipGuide[]

  @@unique([projectId, sequenceIndex])
}
```

```prisma
model H3ClipAttempt {
  id                    String   @id @default(cuid())
  clipId                String
  attemptNumber         Int
  generationHash        String
  status                String
  remotePromptId        String?
  workerId              String?
  previewAssetId        String?
  outputAssetId         String?
  failureClass          String?
  failureCode           String?
  failureMessage        String?
  estimatedCost         Decimal?
  actualCost            Decimal?
  startedAt             DateTime?
  finishedAt            DateTime?
  createdAt             DateTime @default(now())

  clip                  H3Clip @relation(fields: [clipId], references: [id], onDelete: Cascade)

  @@unique([clipId, attemptNumber])
}
```

```prisma
model H3Asset {
  id                    String   @id @default(cuid())
  projectId             String
  type                  String
  role                  String?
  path                  String
  sha256                String
  mimeType              String?
  width                 Int?
  height                Int?
  fps                   Float?
  durationSeconds       Float?
  sizeBytes             BigInt?
  provenance            Json?
  createdAt             DateTime @default(now())

  project               H3Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

```prisma
model H3ClipReference {
  id                    String   @id @default(cuid())
  clipId                String
  assetId               String
  scope                 String
  kind                  String
  slot                  Int
  active                Boolean  @default(true)
  createdAt             DateTime @default(now())

  clip                  H3Clip @relation(fields: [clipId], references: [id], onDelete: Cascade)

  @@unique([clipId, kind, slot])
}
```

```prisma
model H3ClipLora {
  id                    String   @id @default(cuid())
  clipId                String
  loraId                String
  loraHash              String?
  strength              Float
  orderIndex            Int
  purpose               String?

  clip                  H3Clip @relation(fields: [clipId], references: [id], onDelete: Cascade)
}
```

```prisma
model H3ClipGuide {
  id                    String   @id @default(cuid())
  clipId                String
  type                  String
  assetId               String
  frameIndex            Int?
  orderIndex            Int

  clip                  H3Clip @relation(fields: [clipId], references: [id], onDelete: Cascade)
}
```

```prisma
model H3Job {
  id                    String   @id @default(cuid())
  projectId             String
  clipId                String?
  type                  String
  state                 String
  workerId              String?
  remoteJobId           String?
  retryCount            Int      @default(0)
  estimatedCost         Decimal?
  actualCost            Decimal?
  errorCode             String?
  errorMessage          String?
  metadata              Json?
  startedAt             DateTime?
  finishedAt            DateTime?
  createdAt             DateTime @default(now())

  project               H3Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

```prisma
model H3Approval {
  id                    String   @id @default(cuid())
  projectId             String
  clipId                String?
  stage                 String
  decision              String
  decidedById           String?
  note                  String?
  createdAt             DateTime @default(now())

  project               H3Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

```prisma
model H3AuditEvent {
  id                    String   @id @default(cuid())
  projectId             String
  actorId               String?
  eventType             String
  targetType            String?
  targetId              String?
  before                Json?
  after                 Json?
  metadata              Json?
  createdAt             DateTime @default(now())

  project               H3Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

Use additive migrations only.

Do not reset an existing production database.

---

# 27. API Design

Suggested namespace:

```text
/api/video/h3
```

## Projects

```text
POST   /api/video/h3/projects
GET    /api/video/h3/projects/:id
PATCH  /api/video/h3/projects/:id
POST   /api/video/h3/projects/:id/plan
POST   /api/video/h3/projects/:id/preflight
POST   /api/video/h3/projects/:id/pause
POST   /api/video/h3/projects/:id/resume
```

## Clips

```text
POST   /api/video/h3/projects/:id/clips
PATCH  /api/video/h3/clips/:clipId
POST   /api/video/h3/clips/:clipId/generate
POST   /api/video/h3/clips/:clipId/retry
POST   /api/video/h3/clips/:clipId/validate
POST   /api/video/h3/clips/:clipId/reject
POST   /api/video/h3/clips/:clipId/invalidate
```

## References

```text
POST   /api/video/h3/clips/:clipId/references
DELETE /api/video/h3/clips/:clipId/references/:referenceId
```

## LoRA

```text
POST   /api/video/h3/clips/:clipId/loras
PATCH  /api/video/h3/clips/:clipId/loras/:id
DELETE /api/video/h3/clips/:clipId/loras/:id
```

## FL2VA Guides

```text
POST   /api/video/h3/clips/:clipId/guides
PATCH  /api/video/h3/clips/:clipId/guides/:id
DELETE /api/video/h3/clips/:clipId/guides/:id
```

## Export

```text
POST   /api/video/h3/projects/:id/export/sequence
POST   /api/video/h3/projects/:id/export/clips
GET    /api/video/h3/projects/:id/exports
```

## QC

```text
POST   /api/video/h3/assets/:assetId/qc
GET    /api/video/h3/assets/:assetId/qc
POST   /api/video/h3/projects/:id/stock-review
```

## Worker

```text
GET    /api/video/h3/workers
POST   /api/video/h3/workers/:id/preflight
GET    /api/video/h3/jobs/:jobId
POST   /api/video/h3/jobs/:jobId/cancel
```

---

# 28. API Safety Rules

All mutation endpoints SHALL:

- validate with the repository's existing validation library, preferably Zod if already used;
- verify project ownership/authorization;
- reject unknown IDs;
- reject unsafe local paths;
- never accept arbitrary shell commands;
- prevent path traversal;
- enforce file type/size limits;
- record audit events for important mutations;
- use idempotency where duplicate execution would be expensive.

Generation requests SHOULD accept an idempotency key.

---

# 29. Web App UX

Add a dedicated workspace:

```text
Video Factory
  └─ MiniMax H3
```

Primary layout:

```text
┌───────────────────────────────────────────────────────────┐
│ Project Header                                            │
│ Model | Worker | Mode | Budget | Status | Cost            │
├─────────────────────┬─────────────────────────────────────┤
│ Scene Timeline      │ Scene Inspector                     │
│                     │                                     │
│ [01] ✓              │ Prompt                              │
│ [02] ✓              │ References                          │
│ [03] !              │ LoRA                                │
│ [04] ○              │ FL2VA Guides                        │
│                     │ Seed / Duration                     │
│                     │ Preview                             │
├─────────────────────┴─────────────────────────────────────┤
│ Job Console | QC | History | Audit                        │
└───────────────────────────────────────────────────────────┘
```

Recommended visual language:

- clean Apple-like hierarchy;
- large previews;
- low visual noise;
- status represented by icon + text, not color alone;
- advanced settings collapsed by default;
- destructive actions separated from normal controls;
- persistent project status at top.

---

# 30. Scene Card

Each timeline card SHOULD show:

```text
Scene number
Name
Duration
Mode
Generation state
Validation state
QC state
Seed
Reference count
LoRA count
Retry count
Preview thumbnail
Cost indicator
```

Actions:

```text
Generate
Preview
Retry
Validate
Reject
Duplicate as new concept
Edit prompt
References
LoRA
Guides
History
```

Do not put a generic destructive `Regenerate All` button next to normal actions.

---

# 31. Full Batch Workflow

Recommended state:

```text
Project Ready
    ↓
Preflight
    ↓
Budget Check
    ↓
Human confirmation if policy requires
    ↓
Full Batch Queue
    ↓
Clip Generation
    ↓
Autosave
    ↓
Final Decode
    ↓
Individual Clip Export
    ↓
Collect Outputs
    ↓
QC
```

For long jobs, Pao-hubPro SHOULD continuously persist:

- active clip;
- completed clip IDs;
- output hashes;
- current remote prompt/job ID;
- latest Extender project artifact if available.

This allows resumption without relying solely on an active browser tab.

---

# 32. Clip-by-Clip Workflow

Preferred workflow for high-quality productions:

```text
Generate
    ↓
Preview
    ↓
AI-assisted QC
    ↓
Human Review
    ├─ Retry
    ├─ Edit
    └─ Validate
          ↓
       Next Clip
```

For continuity-heavy work, this remains safer than blind full-batch generation.

---

# 33. AI-Assisted Review

An AI reviewer MAY flag:

- deformed hands;
- extra fingers;
- unstable faces;
- incorrect eye direction;
- duplicated objects;
- geometry jumps;
- temporal flicker;
- broken text;
- unexpected logos;
- abrupt exposure shifts;
- continuity failure;
- subject identity drift;
- camera discontinuity;
- malformed machinery;
- implausible physical action.

The AI reviewer MUST NOT silently validate a final stock asset.

Human approval remains the authoritative validation gate.

---

# 34. Technical QC

Run in this order:

## 34.1 File Integrity

Check:

- file exists;
- readable;
- non-zero size;
- duration readable;
- video stream readable;
- audio stream readable when expected.

## 34.2 Video Properties

Record:

```text
container
codec
width
height
fps
duration
bitrate
pixel format
audio codec
sample rate
channel count
```

For Adobe Stock video export, the pipeline SHOULD target current accepted video requirements and verify them again at submission time.

As of the design snapshot, Adobe documents MOV or MP4 with H.264 among accepted standard video upload requirements.

## 34.3 Artifact Detection

Flag:

- broken frames;
- black frames;
- frozen tail;
- visible seam;
- compression damage;
- extreme flicker;
- unexpected embedded text;
- watermark/signature;
- malformed subject.

---

# 35. Visual QC

Use score-independent pass/fail flags rather than pretending to predict Adobe acceptance.

Suggested checks:

```text
subject_clear
composition_useful
motion_natural
camera_motion_usable
lighting_consistent
anatomy_ok
object_geometry_ok
text_clean
no_unexpected_brand
no_watermark
continuity_ok
commercial_use_case_clear
```

Possible outputs:

```text
PASS
NEEDS_FIXES
HOLD_FOR_COMPLIANCE_REVIEW
REJECT_INTERNALLY
```

---

# 36. Similarity QC

Do not upload every generation.

Compare:

- concept;
- prompt;
- composition;
- camera;
- action;
- reference configuration;
- perceptual similarity;
- temporal similarity;
- semantic description.

A meaningful stock pack should vary buyer utility, not only:

- crop;
- color;
- filter;
- seed;
- slight camera offset;
- small pose change.

For Adobe Stock generative AI content, current guidance emphasizes distinct submissions and warns against excessive similar variations.

Pao-hubPro SHOULD therefore have:

```text
Similarity Cluster
    ↓
Human Curator
    ↓
Keep strongest representative assets
```

---

# 37. Adobe Stock Gate

This phase SHALL implement a pre-submission gate, not auto-submission.

Current Adobe requirements verified during design include:

- generative AI content must be labeled appropriately during submission;
- generative AI video is accepted when current technical, legal and quality requirements are met;
- contributors are responsible for verifying they have appropriate rights from the AI tool/provider;
- prompts, titles and keywords should not include prohibited references such as artist names, real people, fictional characters or copyrighted works under Adobe's generative-AI rules;
- AI video should avoid embedded text, signature/watermarks and model inconsistencies;
- required model/property releases remain the contributor's responsibility;
- similar generative-AI submissions must be curated rather than mass-uploaded.

Final gate values:

```text
READY_FOR_HUMAN_SUBMISSION_REVIEW
NEEDS_FIXES
HOLD_FOR_COMPLIANCE_REVIEW
REJECT_INTERNALLY
```

Never store a state called:

```text
GUARANTEED_ADOBE_ACCEPTANCE
```

---

# 38. Stock Clip Export Strategy

For stock production, `Save Individual Clips` SHOULD be the preferred output where appropriate.

Example project:

```text
Concept: Smart Farm Irrigation
```

Sequence:

```text
01 Establishing aerial/wide view
02 Sensor in soil
03 Farmer checks controller
04 Pump activates
05 Water flows through irrigation
06 Monitoring dashboard
```

Export:

```text
project-sequence.mp4
stock-clips/
  01-establishing.mp4
  02-soil-sensor.mp4
  03-controller.mp4
  04-water-pump.mp4
  05-irrigation.mp4
  06-dashboard.mp4
```

Each clip is evaluated separately.

The assembled sequence is not automatically assumed to be the stock product.

---

# 39. Metadata Draft

For each candidate stock clip create:

```ts
type StockMetadataDraft = {
  title: string
  keywords: string[]
  category?: string
  generativeAi: true
  fictionalPeople?: boolean
  notes?: string[]
}
```

Rules:

- title describes what is actually visible;
- strongest keywords first;
- remove duplicates;
- avoid keyword stuffing;
- do not add concepts not visible;
- avoid prohibited names/IP;
- metadata remains a draft until human review.

---

# 40. Example Production Profile

```json
{
  "profile": "ADOBE_STOCK_INDEPENDENT_H3",
  "mode": "REF2VA_MOTION_OFF",
  "validation": "CLIP_BY_CLIP",
  "individualClipExport": true,
  "fullSequenceExport": true,
  "autoRetryTransient": 2,
  "qualityRetry": "HUMAN_OR_POLICY",
  "technicalQc": true,
  "visualQc": true,
  "similarityQc": true,
  "metadataDraft": true,
  "autoSubmit": false
}
```

---

# 41. Security

Secrets SHALL remain server-side.

Examples:

```text
RUNPOD_API_KEY
COMFYUI_REMOTE_TOKEN
STORAGE_CREDENTIALS
AI_PROVIDER_KEYS
```

Browser receives only opaque identifiers.

Do not expose:

```text
raw secret
remote private filesystem paths
SSH private keys
provider master tokens
```

---

# 42. Filesystem Security

All media operations MUST use approved roots.

Disallow:

```text
../../
absolute arbitrary paths
UNC escape paths
symlink escapes
```

Prefer content-addressed storage:

```text
sha256/<hash>
```

User filenames are metadata, not trusted paths.

---

# 43. Remote Execution Safety

ComfyUI integration SHALL submit only approved workflow templates.

Do not allow an untrusted browser payload to inject:

- arbitrary Python nodes;
- arbitrary shell commands;
- arbitrary local paths;
- arbitrary URLs without policy validation.

Pao-hubPro compiles user intent into a known workflow schema.

---

# 44. Dependency / License Boundary

The upstream repository currently contains an Apache License 2.0 license file.

Its `THIRD_PARTY_NOTICE.md` states that motion-context temporal anchor/payload patch logic is adapted from `NikoDemon80/ComfyUI-H3-Motion-Context`, whose upstream license is GPL-3.0.

Therefore Phase 21.02 SHALL follow this default:

```text
Pao-hubPro Core
      │
      │ API/workflow boundary
      ▼
ComfyUI Runtime
      │
      └── ComfyUI_MiniMax_H3_Extender
```

Do not copy adapted motion-context implementation into proprietary/internal core modules without a dedicated license review.

Before redistribution, packaging or selling a bundled build:

1. inspect the current upstream `LICENSE`;
2. inspect `THIRD_PARTY_NOTICE.md`;
3. inspect modified/derived source files;
4. preserve required notices;
5. determine obligations for the chosen distribution model.

This specification is not legal advice.

---

# 45. Observability

Add structured events:

```text
h3.project.created
h3.project.preflight.completed
h3.clip.queued
h3.clip.started
h3.clip.generated
h3.clip.preview_ready
h3.clip.retry_requested
h3.clip.validated
h3.clip.invalidated
h3.clip.qc_failed
h3.clip.qc_passed
h3.batch.started
h3.batch.interrupted
h3.batch.resumed
h3.export.started
h3.export.completed
h3.stock_review.ready
h3.stock_review.hold
```

Metrics:

```text
clips_generated_total
clip_retry_total
generation_seconds
gpu_minutes
project_gpu_minutes
estimated_cost
actual_cost
qc_failure_count
continuity_failure_count
similarity_rejection_count
export_failure_count
```

---

# 46. Audit Log

Record important human and agent actions.

Example:

```json
{
  "eventType": "h3.clip.validated",
  "actorType": "USER",
  "actorId": "user_x",
  "targetId": "clip_003",
  "metadata": {
    "generationHash": "..."
  }
}
```

Agent recommendations and human decisions MUST remain distinguishable.

---

# 47. Error Normalization

Map upstream/runtime errors into stable Pao-hubPro codes.

Examples:

```text
H3_WORKER_UNREACHABLE
H3_EXTENDER_NOT_INSTALLED
H3_EXTENDER_VERSION_UNSUPPORTED
H3_MODEL_MISSING
H3_LORA_MISSING
H3_REFERENCE_INVALID
H3_REFERENCE_TOO_LARGE
H3_WORKFLOW_INVALID
H3_GPU_OOM
H3_GENERATION_INTERRUPTED
H3_OUTPUT_MISSING
H3_OUTPUT_CORRUPT
H3_PROJECT_RESTORE_FAILED
H3_LICENSE_REVIEW_REQUIRED
H3_BUDGET_EXCEEDED
```

UI should show a human-readable action beside each code.

---

# 48. Version Compatibility Matrix

Store a compatibility registry.

Example:

```yaml
h3Extender:
  "2.8.x":
    promptBridge: true
    referenceBridge: true
    fl2vaGuides: 3
    individualClipExport: true
    projectFormatExpected: 4
```

This is an example adapter registry.

At runtime, verify actual capabilities rather than trusting the registry alone.

---

# 49. Automated Preflight

Before generation:

```text
[ ] Project exists
[ ] Worker online
[ ] ComfyUI reachable
[ ] H3 model found
[ ] Extender found
[ ] Required bridge nodes found
[ ] Required LoRAs found
[ ] References readable
[ ] References within configured limits
[ ] Workflow template compatible
[ ] Output path writable
[ ] Budget allowed
[ ] No blocking compliance issue
```

Preflight result:

```text
PASS
PASS_WITH_WARNINGS
BLOCKED
```

---

# 50. Production Checklist

## Before Generation

```text
[ ] Concept has buyer use case
[ ] Scene list is distinct
[ ] Production mode selected
[ ] Prompts reviewed
[ ] IP/person-name scan passed
[ ] References have provenance
[ ] Seeds/settings stored
[ ] LoRAs resolved
[ ] Worker preflight passed
[ ] Budget accepted
```

## During Generation

```text
[ ] Job state persisted
[ ] Preview stored
[ ] Errors normalized
[ ] Retry count bounded
[ ] Approved clips not unnecessarily regenerated
[ ] Invalidation scope correct
```

## Before Export

```text
[ ] Required clips validated
[ ] Final decode succeeds
[ ] Individual clips exported where requested
[ ] Output hashes recorded
```

## Before Stock Review

```text
[ ] File integrity pass
[ ] Video technical QC pass
[ ] Visual QC pass
[ ] No watermark/signature
[ ] No malformed embedded text
[ ] Similarity review pass
[ ] Metadata draft ready
[ ] AI disclosure flag set
[ ] Rights/release issues reviewed
```

---

# 51. Acceptance Criteria

Phase 21.02 is complete only when all required items below pass.

## Core

```text
[ ] Create H3 project from Pao-hubPro
[ ] Create/reorder/edit clips
[ ] Persist project after restart
[ ] Persist clip prompt/seed/duration/settings
[ ] Store generation hash
```

## Adapter

```text
[ ] Detect ComfyUI
[ ] Detect Extender
[ ] Detect version/capabilities
[ ] Compile known workflow template
[ ] Submit workflow
[ ] Track remote job
[ ] Collect outputs
```

## Prompt / Reference

```text
[ ] Prompt Pack integration works
[ ] Stable reference slot mapping works
[ ] Global references work
[ ] Clip-local references work
[ ] Provenance recorded
```

## Motion Context

```text
[ ] Continuous mode invalidates downstream correctly
[ ] Independent mode only invalidates target clip
[ ] Validated clips remain untouched when safe
```

## FL2VA

```text
[ ] First frame works
[ ] Last frame works
[ ] Up to 3 guide frames work
[ ] Frame indices validated
[ ] Guide changes trigger correct invalidation
```

## LoRA

```text
[ ] Multiple per-clip LoRAs supported
[ ] Strength persisted
[ ] Missing LoRA blocks preflight
[ ] No silent substitution
```

## Resume

```text
[ ] Interrupt a batch
[ ] Preserve completed clips
[ ] Restart Pao-hubPro
[ ] Reconnect worker
[ ] Resume without regenerating valid completed clips
```

## Export

```text
[ ] Full sequence export works
[ ] Individual clip export works
[ ] Export outputs registered as assets
[ ] Output hashes stored
```

## QC

```text
[ ] Technical QC runs
[ ] Visual QC status stored
[ ] Similarity review runs
[ ] Stock review gate works
[ ] Human submission review is required
```

## Safety

```text
[ ] Secrets server-side
[ ] Path traversal blocked
[ ] Arbitrary workflow injection blocked
[ ] Arbitrary shell execution not exposed
[ ] Audit trail created
[ ] Destructive actions require explicit intent
```

## Engineering

```text
[ ] Typecheck passes
[ ] Lint passes
[ ] Unit tests pass
[ ] Integration tests pass
[ ] Production build passes
[ ] Existing Pao-hubPro behavior remains intact
```

---

# 52. Required Tests

## Unit Tests

Test:

- generation spec canonicalization;
- generation hash;
- invalidation rules;
- guide ordering;
- reference slot preservation;
- retry classification;
- cost policy;
- stock gate;
- adapter error normalization.

## Integration Tests

Test:

```text
Pao-hubPro → Adapter → Mock ComfyUI
```

Then optionally:

```text
Pao-hubPro → Real ComfyUI → H3 Extender
```

## Resume Test

Scenario:

```text
1. Generate clips 1–3.
2. Interrupt before clip 4.
3. Persist state.
4. Restart services.
5. Resume.
6. Confirm clips 1–3 are not regenerated.
7. Continue from clip 4.
```

## Invalidation Test

Continuous mode:

```text
Validate clips 1–5.
Change clip 3 prompt.
Expect 3–5 invalidated.
Expect 1–2 unchanged.
```

Independent mode:

```text
Validate clips 1–5.
Change clip 3 prompt.
Expect only clip 3 invalidated.
```

---

# 53. Suggested Delivery Order

## Stage A — Foundation

- DB models;
- project service;
- clip service;
- asset service;
- audit.

## Stage B — Adapter

- capability detection;
- workflow registry;
- ComfyUI queue/history/output integration.

## Stage C — Generation

- prompt pack;
- reference pack;
- Ref2VA;
- Motion Context mode;
- clip generation.

## Stage D — Advanced H3

- FL2VA guides;
- per-clip LoRA;
- video/audio refs;
- resume.

## Stage E — Export

- final decode;
- individual clips;
- sequence export;
- durable output collection.

## Stage F — Stock Production

- technical QC;
- visual QC;
- similarity QC;
- metadata;
- Adobe Stock gate.

## Stage G — Hardening

- permission tests;
- failure recovery;
- observability;
- cost controls;
- upgrade compatibility.

---

# 54. Recommended Default for Pao

For the Adobe Stock workflow, use:

```text
Production Profile:
ADOBE_STOCK_INDEPENDENT_H3

Motion Context:
OFF by default

Generation:
Clip-by-Clip during quality-sensitive work

Batch:
Use Full Batch only after prompts/references are stable

Individual Clip Export:
ON

Sequence Export:
ON for review/archive

AI QC:
ON

Human Validation:
REQUIRED

Adobe Auto Submit:
OFF
```

For storytelling or continuous-action videos:

```text
Production Profile:
H3_CONTINUOUS_SEQUENCE

Motion Context:
ON

Validation:
Generate → Preview → Retry → Validate → Continue
```

---

# 55. Recommended Pao-hubPro Module Tree

Adapt paths to the repository after inspection.

```text
src/
  modules/
    video/
      h3/
        application/
          project-service.ts
          clip-service.ts
          generation-service.ts
          validation-service.ts
          invalidation-service.ts
          export-service.ts
          qc-service.ts

        domain/
          h3-project.ts
          h3-clip.ts
          generation-spec.ts
          generation-hash.ts
          reference.ts
          visual-guide.ts
          lora-assignment.ts
          states.ts

        infrastructure/
          comfyui/
            client.ts
            worker.ts
            history.ts
            outputs.ts

          extender/
            adapter.ts
            capabilities.ts
            workflow-compiler.ts
            prompt-pack.ts
            reference-pack.ts
            project-sync.ts
            errors.ts

          storage/
            asset-store.ts

        policy/
          budget-policy.ts
          retry-policy.ts
          stock-policy.ts
          path-policy.ts

        qc/
          technical-qc.ts
          visual-qc.ts
          similarity-qc.ts

        api/
          routes/
          schemas/
```

Do not force this tree if the existing repository already has a stronger convention.

---

# 56. Codex Implementation Plan

Codex should execute in this order.

## Step 1 — Repository Reconnaissance

Inspect:

```text
package manager
workspace structure
framework
database
Prisma schema
auth
API conventions
queue/job system
storage abstraction
existing ComfyUI integration
existing Runpod integration
existing Adobe Stock modules
tests
lint/typecheck/build scripts
```

Do not start by creating parallel infrastructure if equivalent modules already exist.

## Step 2 — Write Integration Design Note

Before broad changes, create:

```text
docs/phases/21.02-h3-extender-integration.md
```

Record:

- modules reused;
- new modules;
- database additions;
- adapter boundary;
- migration strategy;
- rollback plan.

## Step 3 — Add Database Models

Only additive migration.

No resets.

No destructive schema shortcuts.

## Step 4 — Build Adapter

Create capability detection first.

Do not make actual expensive generation the first test.

## Step 5 — Add Mock Worker

Implement deterministic mock responses so orchestration can be tested without GPU cost.

## Step 6 — Implement Core State Machine

Project / clip / job state must work before UI polish.

## Step 7 — Implement Generation Hash + Invalidation

These are required before validation.

## Step 8 — Add Real ComfyUI Execution

Queue, history, interrupt and outputs.

## Step 9 — Add Prompt/Reference Bridges

Ensure stable slot behavior.

## Step 10 — Add FL2VA + LoRA

Keep feature flags/capability guards.

## Step 11 — Add Resume

Test process restart and worker reconnect.

## Step 12 — Add Export

Sequence + individual clips.

## Step 13 — Add QC

Technical → Visual → Similarity → Compliance.

## Step 14 — Add UI

Build timeline and inspector around stable backend contracts.

## Step 15 — Hardening

Run:

```text
typecheck
lint
unit tests
integration tests
production build
```

Fix regressions caused by this phase.

Clearly report pre-existing failures separately.

---

# 57. One-Shot Build Contract for Codex

When this phase is handed to Codex, Codex MUST:

1. inspect the real repository first;
2. preserve current architecture;
3. reuse existing services;
4. use additive migrations;
5. keep secrets server-side;
6. create a versioned H3 Extender adapter;
7. avoid copying upstream implementation into core;
8. implement mockable worker interfaces;
9. implement persistent states;
10. implement deterministic generation hashes;
11. implement dependency invalidation;
12. support Ref2VA continuous and independent mode;
13. support FL2VA visual guides;
14. support per-clip LoRA;
15. support prompt/reference bridges;
16. support pause/resume;
17. support final sequence + individual clip export;
18. implement technical/visual/similarity QC;
19. implement human-gated stock review;
20. add tests and run the repository's real verification commands.

Completion report MUST include:

```text
Changed files
New files
Database migrations
Environment variables
API routes
Tests run
Build status
Known limitations
Security notes
License/dependency notes
Manual verification steps
```

---

# 58. Definition of Done

Phase 21.02 is DONE when Pao can:

```text
1. Open Pao-hubPro.
2. Create an H3 video project.
3. Enter a stock concept or script.
4. Generate a scene plan.
5. Edit scene prompts.
6. Attach references.
7. Configure LoRA/FL2VA guides.
8. Choose continuous or independent mode.
9. Run preflight.
10. Generate a clip.
11. Preview it.
12. Retry or validate it.
13. Stop the production.
14. Close/restart the application.
15. Resume from the correct position.
16. Export the full sequence.
17. Export individual final clips.
18. Run QC.
19. See similarity warnings.
20. Receive stock metadata drafts.
21. Reach READY_FOR_HUMAN_SUBMISSION_REVIEW.
```

without manually rebuilding a large repeated H3 node chain for each scene.

---

# 59. Final Architectural Decision

**Adopt MiniMax H3 Extender as a specialized upstream video sequencing engine.**

Do not fork its entire implementation into Pao-hubPro unless future maintenance requires it.

Pao-hubPro should own:

```text
Intent
Planning
Agent orchestration
Project state
Policy
Budget
Approvals
Provenance
QC
Metadata
Audit
```

MiniMax H3 Extender should own:

```text
H3 sequence mechanics
Motion Context
Ref2VA
FL2VA
Extender cache
Extender project format
Clip continuation
Final decode
Individual clip generation/export mechanics
```

This boundary provides the best balance of capability, upgradeability and operational safety.

---

# 60. Phase 21.02 Outcome

After this phase, Pao-hubPro gains a **durable MiniMax H3 production plane** instead of merely having access to a ComfyUI workflow.

The resulting system can support:

- long-form AI video;
- multi-scene visual continuity;
- independent stock clip packs;
- guided FL2VA transformations;
- Runpod GPU execution;
- pause/resume production;
- per-scene quality control;
- reusable production profiles;
- stock-oriented curation;
- controlled human approval.

This phase also creates the foundation for later capabilities such as:

```text
automatic storyboard generation
multi-provider video routing
GPU scheduler
agent reviewer council
video captioning
automatic metadata ranking
portfolio learning
cost-aware rerender selection
distributed render workers
```

---

# 61. Source Snapshot

Verified during design on 2026-09-22:

1. MiniMax H3 Extender repository  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender

2. MiniMax H3 Extender README  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/README.md

3. `pyproject.toml` — upstream version metadata  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/pyproject.toml

4. Prompt Pack Bridge  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/prompt_bridge.py

5. Reference Pack Bridge  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/reference_bridge.py

6. FL2VA engine  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/fl2va_engine.py

7. Third-party notice  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/THIRD_PARTY_NOTICE.md

8. Upstream license  
   https://github.com/tritant/ComfyUI_MiniMax_H3_Extender/blob/main/LICENSE

9. Adobe Stock Generative AI Guidelines  
   https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/

10. Adobe Stock Generative AI Video Guidelines  
    https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/generative-ai-video-submission-guidelines.html

11. Adobe Stock Generative AI FAQ  
    https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/adobe-stock-generative-ai-faq.html

12. Adobe Stock distinct generative AI submission best practices  
    https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/distinct-generative-ai-submission-best-practices.html

---

**End of Phase 21.02 specification**
