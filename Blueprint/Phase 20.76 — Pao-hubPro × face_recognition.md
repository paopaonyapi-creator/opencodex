# Phase 20.76 — Pao-hubPro × face_recognition

## Local Biometric Identity & Face Intelligence Runtime, Privacy-Preserving Face Embedding Registry, Real-Time Vision Recognition, Anti-Spoof Extension Layer, MCP Vision Gateway & Policy-Governed Identity Control Plane

> **Document type:** Production-Oriented Implementation Blueprint
> **Phase:** 20.76
> **Project:** Pao-hubPro
> **Source of Truth:** `Phase%2020.76.md` (filename URL-encoded; decoded = `Phase 20.76.md`), processed under `PAO-HUBPRO_MASTER_PHASE_REQUEST.md`
> **Primary upstream/provider:** `ageitgey/face_recognition` ecosystem (→ dlib) — **license [Needs Verification]**: verify the upstream license and dlib license before implementation
> **Status:** SPECIFICATION READY · **Architecture:** Local-First / Provider-Agnostic / MCP-Native · **Security Model:** Policy-Governed Biometric Runtime
> **Filename note:** Source filename is URL-encoded (`Phase%2020.76.md`); content identifies **Phase 20.76 — Pao-hubPro × face_recognition** — used as authoritative per master request §1.
> **⚠ Numbering note (master request §36):** Phase 20.75 (OpenAffiliate) recommended *"Phase 20.76 — Revenue Intelligence"* as its next phase. This document claims **20.76 for face_recognition** — therefore the recommended Revenue Intelligence phase must be renumbered (proposed: **20.77**) when created. No existing document collision; flag recorded for the phase registry.

> **Core architectural rule:**
> **Recognition provides identity evidence. Policy decides what that evidence is allowed to do.**
> `face_match == identity signal` — **NOT** `face_match == permission granted`

---

## 1. Executive Summary

Phase 20.76 extends Pao-hubPro with a **local-first biometric and face-intelligence subsystem** based on the `ageitgey/face_recognition` ecosystem, while deliberately preventing the rest of the platform from becoming tightly coupled to a single face-recognition library.

The purpose is not a "recognize a face" script — the target is a reusable **Vision Identity Control Plane** allowing ChatGPT, Codex, local agents, automation workers, camera pipelines, and future Pao-hubPro services to request face-related capabilities through a governed MCP/API boundary.

**Core principles (10):** local-first biometric processing; raw images stay local by default; agent access is capability-scoped; **face embeddings are treated as sensitive data**; recognition and authorization are separated; provider abstraction prevents vendor/library lock-in; high-impact actions require stronger verification than face match alone; auditable operations; revocable identity enrollment; future support for InsightFace/ONNX/other engines.

---

## 2. Problem Statement

Pao-hubPro is evolving into an agentic local/cloud control plane — agents can already interact with files, commands, repositories, MCP servers, browsers, external APIs, automation runtimes, local devices, and future cameras/IoT systems. A face-recognition subsystem adds a new dimension: **"Who is physically present?"**

Use cases: local user verification; camera event enrichment; family/private photo organization; authorized-person detection; privacy redaction; smart-home context; attendance-style workflows; operator confirmation; video indexing; asset organization.

**However: face recognition must NOT automatically equal authorization.** The architecture separates:

```text
Face Detection → Face Embedding → Identity Match → Confidence/Distance
→ Policy Evaluation → Optional Liveness/Second Factor → Approval/Action
```

---

## 3. Goals

**Local Vision Identity Service** responsible for: face detection; face encoding; face comparison; known-face search; enrollment; deletion; clustering; metadata lookup; privacy masking — callable through internal HTTP API, MCP tools, local SDK, and worker jobs.

**Raw images stay local by default:**

```text
Camera/Image → Local Vision Runtime → Face Detection/Embedding
→ Minimal Structured Result → Agent
```

Example response:

```json
{"faces_detected": 2,
 "matches": [{"person_id": "person_001", "confidence_state": "matched"}],
 "unknown_faces": 1}
```

**Do not send the original image to cloud models unless:** user explicitly requests it; policy allows it; the operation has a valid purpose; the request is logged.

---

## 4. Non-Goals

Phase 20.76 is NOT intended to become:

- mass-surveillance software; public-space identity tracking;
- covert biometric collection; automatic law-enforcement identification;
- autonomous access control based only on face match;
- emotion or personality inference from faces;
- health diagnosis from facial appearance; demographic profiling.

---

## 5. Why This Phase Exists — Design Principles & Key Rule

### Identity ≠ Authorization (critical rule)

```text
face_match == identity signal        (NOT permission granted)
```

Authorization flow:

```text
Face Match → Policy → Risk Level → Optional Liveness
→ Optional PIN / Device Trust → Human Approval → Action
```

**High-risk actions that must NOT rely on facial recognition alone:** server shell access; deleting files; sending payments; opening physical locks; changing secrets; adding API keys; disabling security systems.

### Provider abstraction (no direct library calls)

Pao-hubPro must **NOT** call `face_recognition` directly from business logic — provider contract:

```python
class BiometricProvider:
    def detect_faces(self, image): raise NotImplementedError
    def encode_faces(self, image): raise NotImplementedError
    def compare(self, embedding_a, embedding_b): raise NotImplementedError
    def search(self, embedding, registry): raise NotImplementedError
```

```text
BiometricProvider
├── FaceRecognitionProvider   → ageitgey/face_recognition → dlib   [initial]
├── InsightFaceProvider       [future]
├── ONNXFaceProvider          [future]
├── OpenCVProvider            [future]
└── RemoteProvider            [future]
```

Benefits (7): easy migration; benchmark multiple models; hardware-specific backends; future CUDA acceleration; provider fallback; model versioning; safer dependency upgrades.

### Pao-hubPro integration

```text
ChatGPT → Pao-hubPro {MCPProxy · Policy Engine · Audit Engine · Context Runtime
                      · Vision Identity Gateway} → Local Vision Runtime
```

Example Thai agent requests: *"ในรูปนี้มีกี่หน้า"* → `vision.detect_faces`; *"คนนี้อยู่ในรายชื่อที่ผมลงทะเบียนไว้ไหม"* → `vision.search_identity`; *"เบลอคนที่ไม่รู้จักทั้งหมด"* → `privacy.redact_unknown_faces`

---

## 6. Relationship to Pao-hubPro

### Layer mapping (Pao-hubPro core layers)

| Layer | Role in this phase |
|---|---|
| 05 MCP Gateway / MCPProxy (20.74) | Vision tool routing; capability `risk: biometric` |
| 07 Policy Engine | Scopes; consent; threshold protection |
| 08 Approval Engine | Enrollment/deletion/export approvals |
| 12 State / Session Layer | 6 biometric tables; consent registry |
| 14 Secrets & Credential Layer | Encryption keys via secrets manager |
| 15 Event / Queue Layer | 8 vision events; worker queue |
| 16 Observability Layer | 7 metrics (no personal names as labels) |
| 17 Audit Layer | 9 audited operation classes |
| 19 Web Dashboard | Vision Identity page (8 sections) |
| 20 External Provider Layer | face_recognition/dlib; future providers |

### Cross-phase integration

- **MCPProxy (20.74):** `Agent → MCPProxy → Tool Discovery → Policy → vision.*`; capability `{"tool": "vision.search_identity", "risk": "biometric", "requires": ["local_file_access", "biometric_scope"]}`
- **Context Mode (20.65 pending):** do not push visual payloads into agent context — `Image → Vision Runtime → Structured summary → Context Mode` (e.g., `{"faces": 3, "known": 2, "unknown": 1}`) — smaller context; better privacy; lower token usage; fewer accidental image disclosures
- **Adobe Stock / media pipelines:** privacy redaction supports stock media preparation, screenshots, monitoring footage exports, dataset sanitization, public sharing

### Ownership boundaries

**Pao-hubPro owns:** policy/scopes, consent registry, approval, audit, encryption key management, dashboards. **Vision runtime owns:** detection/encoding/comparison/search mechanics behind the provider contract. **Upstream library owns:** its algorithms (never called directly from business logic).

---

## 7. Upstream / External Project

### Upstream facts

- Provider: `ageitgey/face_recognition` (Python) → `dlib` — initial implementation only
- **License [Needs Verification]:** verify `face_recognition` (MIT-typical) and dlib (Boost Software License) before implementation; record in the license register
- **Future providers:** InsightFace, ONNX, OpenCV, Remote — plugged in **without changing MCP tool contracts**

### Risk assessment

- **License:** per-provider; verify at implementation (record `provider/model_id/embedding_schema_version` with every embedding)
- **Maintenance status:** face_recognition is mature but slow-moving; dlib build complexity (CMake/C++) — Docker deployment recommended
- **Dependency risk:** medium — native builds; CPU mode default; GPU future
- **Security surface:** biometric data = highest-sensitivity class in Pao-hubPro; embeddings treated as credentials (Section 12)
- **Vendor lock-in:** none — BiometricProvider abstraction; embeddings **not compatible across providers** (Section 12.6)
- **Migration strategy:** store provider/model/schema version per embedding; migration may require re-encoding source images

---

## 8. Current-State Assumptions

- **[Needs Verification] Inspect first:** existing Pao-hubPro structure, auth/RBAC, policy engine, MCPProxy integration, worker/queue, audit, secret management, Docker conventions — reuse; do not rewrite unrelated components
- **[Assumption] Local processing only:** no cloud vision calls in baseline; `local_only` posture default
- **[Assumption] Scale:** Phase 1 = linear comparison (personal/family/small teams); vector indexes (FAISS/Qdrant/pgvector) later — **biometric vectors remain access-controlled regardless of index**
- **[Assumption] Paths:** approved roots configured via `PAO_ALLOWED_VISION_PATHS` (e.g., `/data/images, /data/camera, /data/uploads`)

---

## 9. Target Architecture

```text
┌──────────────────────────────────────────────┐
│                Pao-hubPro                    │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│          MCP Vision Gateway                  │
│ detect_faces · compare_faces · identify_face │
│ enroll_identity · redact_faces               │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│       Vision Identity Policy Engine          │
│ scope · consent · role · purpose             │
│ approval · audit                             │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│       Biometric Provider Interface           │
│ FaceRecognitionProvider [now]                │
│ InsightFaceProvider / ONNX / Custom [future] │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│          Local Biometric Registry            │
│ encrypted embeddings · person metadata       │
│ model/provider version · enrollment          │
│ provenance · retention policy                │
└──────────────────────────────────────────────┘
```

---

## 10. Architecture Diagram

```text
ChatGPT → MCPProxy → Pao-hubPro Policy Engine → MCP Vision Gateway
→ Vision Identity Runtime → Biometric Provider Interface
→ face_recognition / InsightFace / ONNX (future)
→ Encrypted Local Biometric Registry
```

**Repository structure:**

```text
apps/vision-identity/
packages/{biometric-core, biometric-policy, biometric-registry,
          biometric-audit, biometric-mcp, biometric-sdk}
providers/{face-recognition, insightface, onnx}
services/{vision-api, vision-worker}
data/biometric/{embeddings, indexes, metadata}
tests/biometric/
```

---

## 11. Core Components

| # | Component | Purpose |
|---|---|---|
| 1 | `BiometricProvider` interface | Provider-neutral detection/encoding/comparison/search |
| 2 | `FaceRecognitionProvider` | Initial adapter (ageitgey/face_recognition → dlib) |
| 3 | MCP Vision Gateway | 7 narrow tools (Section 12.2) |
| 4 | Vision Identity Policy Engine | Scopes; consent; approval; audit |
| 5 | Encrypted Local Biometric Registry | Encrypted embeddings + person metadata + versions + provenance + retention |
| 6 | Enrollment Pipeline | Multi-image; quality gate; outlier detection; duplicate detection |
| 7 | Privacy Redaction Pipeline | blur/pixelate/mask; 4 modes |
| 8 | Liveness Extension Point | `identity.verify` composition (future providers) |
| 9 | Vision API + Worker Queue | HTTP endpoints + heavy-job processing |
| 10 | Benchmark Harness | 7 metrics |

---

## 12. Component Responsibilities

### 12.1 MCP tool surface (narrow, safe tools only)

| Tool | Contract |
|---|---|
| `vision.detect_faces` | input `{"image_path": "/approved/path/image.jpg"}` → `{"count": 2, "faces": [{"box": {top, right, bottom, left}}]}` |
| `vision.encode_face` | **Do NOT return raw embeddings to generic agents** → `{"embedding_id": "emb_01J...", "provider": "face_recognition", "model_version": "v1"}` |
| `vision.compare_faces` | input `{"face_a": "emb_123", "face_b": "emb_456"}` → `{"match": true, "distance": 0.42, "policy_threshold": 0.50}` |
| `vision.search_identity` | → `{"result": "matched", "person_id": "person_001", "distance": 0.41, "provider": "face_recognition"}` |
| `identity.enroll` | MUST require: explicit user action; identity label; source provenance; retention rule; consent state; audit record. Input example: `{"display_name": "Owner", "source_images": ["/approved/enrollment/owner_01.jpg", ...]}` |
| `identity.delete` | Must remove: embeddings; indexes; cache records; linked metadata; derived biometric artifacts where applicable + append `biometric_identity_deleted` to audit |
| `privacy.blur_faces` / `privacy.redact_unknown_faces` / `privacy.redact_all_faces` | Use cases: stock media preparation; screenshots; monitoring footage exports; dataset sanitization; public sharing |

### 12.2 Face registry design (opaque IDs — never filenames)

```json
{"person_id": "person_01JXYZ", "display_name": "Owner", "status": "active",
 "provider": "face_recognition", "embedding_version": "1",
 "created_at": "ISO8601",
 "consent": {"status": "approved", "purpose": "local_user_verification"}}
```

Embeddings live separately: `identity metadata └─ embedding refs ├─ emb_001 ├─ emb_002 └─ emb_003`

**Encryption requirements (embeddings = sensitive credentials):** encrypt at rest; restrict filesystem permissions; **never** write embeddings to ordinary application logs; never include embeddings in agent prompts; never expose embeddings in frontend network logs; support deletion; version encryption keys; use secrets manager/secure key storage. Layering: `Application → Biometric Registry API → Encryption Layer → Encrypted Storage`.

### 12.3 Anti-spoof / liveness extension layer

`face_recognition` alone is **not** a complete anti-spoof system. Extension point:

```text
identity.verify
  ├── face match        ├── device trust
  ├── liveness provider ├── session trust
  └── policy evaluation
```

```python
class LivenessProvider:
    def verify(self, frames): ...
```

Future strategies: blink/challenge sequence; head movement; depth camera; IR sensor; texture analysis; dedicated anti-spoof model.

### 12.4 Real-time camera pipeline (future-compatible)

```text
RTSP / USB Camera → Frame Sampler → Face Detector → Tracking
→ Embedding only when needed → Identity Search → Event Bus → Policy Engine
```

**Avoid encoding every frame** — optimized strategy: `detect → track → re-encode only after interval/change`.

**Batch photo intelligence:** `vision.scan_folder · vision.cluster_faces · vision.find_duplicate_people` — e.g., 10,000 images → Person Cluster A/B + Unknown Cluster C; **human decides whether to assign names.**

**Video intelligence (future):** `vision.scan_video` — `video → frame sampling → face detection → tracking → embedding → identity events → timeline`; output `{"people": [{"person_id": "person_001", "segments": [["00:01:20", "00:02:10"]]}]}`

**Privacy redaction pipeline:** `Input Image/Video → Face Detection → Known/Unknown Classification → Policy → Blur/Pixelate/Mask → Export`; modes: `ALL · UNKNOWN_ONLY · KNOWN_ONLY · SELECTED_IDS`

### 12.5 Enrollment pipeline + quality gate + duplicates

**Multi-image enrollment (do not rely on one photo):** `Person → 3–10 representative photos → Face Quality Validation → Embeddings → Outlier Detection → Identity Profile`. Reject images containing: no face; multiple faces; severe blur; extreme occlusion; unusable crop.

**Quality gate (7 steps before enrollment):** image loaded → exactly one usable face → minimum face size → quality check → embedding generated → duplicate check → enrollment approved.

**Duplicate identity detection:** new embedding → search registry → `{"duplicate_candidate": true, "candidate_person_id": "person_001"}` — **require human confirmation before merging identities.**

### 12.6 Confidence/threshold handling + migration + retention

**Do not expose binary output alone** — store match distance; configured threshold; provider; model version; environment:

```json
{"decision": "possible_match", "distance": 0.54, "threshold": 0.50}
```

Decision states: `strong_match · match · uncertain · no_match`. **Do not let agents arbitrarily modify thresholds — threshold changes require `vision.admin`.**

**Provider migration** (face_recognition → InsightFace): **do NOT assume embeddings from different providers are compatible** — store `provider · model_id · embedding_schema_version`; migration may require re-encoding source images.

**Data retention:** per-identity `retention_policy` (manual · 30_days · 90_days · until_project_end); deletion pipeline: `person → embeddings → indexes → cache → derived data → audit tombstone`.

**Consent registry:** store `purpose · scope · date · source · expiration · revoked_at` — e.g., `{"purpose": "home_device_verification", "scope": "local_only", "status": "active"}`.

### 12.12 Vector search + hardware + workers

**Vector search:** Phase 1 = linear comparison (personal/family/small teams); later FAISS/Qdrant/pgvector — **biometric vectors must remain access-controlled.** **Hardware modes:** CPU (`VISION_PROVIDER=face_recognition, VISION_DEVICE=cpu`) for development/small datasets/low-frequency tasks; GPU future (`VISION_DEVICE=cuda`); provider reports capability `{"provider": "face_recognition", "device": "cpu", "gpu_available": false}`. **Worker queue** for heavy operations (video scanning; large photo libraries; bulk redaction; embedding migration; registry re-indexing): `API → Job Queue → Vision Worker → Result Store`. **Docker deployment:** services `vision-api · vision-worker · biometric-registry`; **do not expose publicly by default** — `127.0.0.1` or private Docker network. **Benchmark harness:** `scripts/benchmark_biometrics.py` — detection latency; encoding latency; search latency; memory usage; false positives; false negatives; threshold sensitivity.

---

## 13. Data Flow

**Recognition flow:** Image (approved path) → detect → encode (embedding_id only) → compare/search → distance+threshold → policy evaluation → optional liveness/PIN/human approval → action → audit. **Enrollment flow:** quality gate → duplicate check → approval → encrypted registry. **Redaction flow:** Section 12.4. **Batch flow:** worker queue → clusters → human naming.

---

## 14. Control Flow

Policy decisions per scope; **identity match never directly grants high-risk authorization** (Section 5).

### Risk classification (R0–R4 mapping from source risk table)

| Operation | Source risk | R-level | Handling |
|---|---|---|---|
| Detect faces | Low | R0 | auto within scope |
| Blur faces | Low | R0/R1 | auto within scope |
| Compare two supplied faces | Medium | R2 | policy + audit |
| Search identity registry | Medium | R2 | policy + audit |
| Enroll person | High | R3 | **explicit approval** |
| Delete identity | High | R3 | **explicit approval** |
| Export biometric data | Critical | R4 | **explicit approval; default deny** |
| Change thresholds globally | Critical | R4 | **`vision.admin` only** |

### Policy scopes + agent policies

```text
vision.detect · vision.compare · vision.identify · vision.enroll
vision.delete · vision.redact · vision.admin
```

```yaml
chatgpt:     {allow: [vision.detect, vision.redact], deny: [vision.enroll, vision.delete]}
codex:       {allow: [vision.detect, vision.compare]}
local_admin: {allow: [vision.*]}
```

**Path security:** never accept arbitrary paths (`../../secret.jpg` unsafe) — require approved roots from `PAO_ALLOWED_VISION_PATHS`; resolve and validate paths before opening files.

**Rate limiting:** identity searches; bulk scans; enrollment attempts; failed verifications — reduces abuse and accidental runaway agent loops.

---

## 15. Agent / Worker Model

**Terminology (strictly separated):**

| Term | Definition |
|---|---|
| Person | Registered identity (opaque `person_id`; consent-bound) |
| Embedding | Encrypted biometric vector (provider/model-versioned; never exposed) |
| Enroll | Consent-gated identity creation (High risk) |
| Match | Distance-based identity signal (not authorization) |
| Verification | Composite: face match + liveness + device/session trust + policy |
| Redaction | Privacy masking operation (Low risk) |

**Worker queue:** heavy operations (video scanning; large libraries; bulk redaction; embedding migration; re-indexing) — never block the API.

---

## 16. Session / State Model

- **Person lifecycle:** `enrolled (consent-bound) → active → disabled → deleted (tombstone)`
- **Consent lifecycle:** `granted → active → expired | revoked` (purpose/scope-bound)
- **Verification states:** `strong_match / match / uncertain / no_match` + threshold stored
- **Embedding lifecycle:** created (versioned) → valid → migrated (provider change) → deleted
- **Event model (8):** `vision.face.detected · vision.face.unknown · vision.face.matched · vision.identity.enrolled · vision.identity.deleted · vision.identity.verification_failed · vision.identity.verification_passed · vision.privacy.redaction_completed` — example `{"event": "vision.face.matched", "person_id": "person_001", "camera_id": "front_camera", "timestamp": "ISO8601", "match": {"distance": 0.43}}`; **do not put raw biometric vectors in event payloads**

---

## 17. MCP Integration

See Section 12.1 (7 tools) + MCPProxy routing (20.74): `Agent → MCPProxy → Tool Discovery → Policy → vision.*`; capability declares `"risk": "biometric"` requiring `local_file_access + biometric_scope`. Tools are narrow — no raw embeddings, no arbitrary paths, no threshold mutation, no biometric export.

---

## 18. Capability Registry

- **Person registry:** opaque IDs + consent + retention policy
- **Embedding registry:** encrypted; provider/model/schema-versioned; separate from metadata
- **Provider registry:** FaceRecognition (now) / InsightFace / ONNX / OpenCV / Remote (future) with capability reports
- **Scope registry:** 7 vision scopes + per-agent policies

---

## 19. Policy Model

Scopes (Section 14) + consent registry + threshold protection (`vision.admin` only) + path allowlist + rate limits. **Authorization flow never shortcuts:** face match → policy → risk → optional liveness/PIN/device trust → human approval → action.

---

## 20. Security Model

### Threat model (10 — protect against)

```text
unauthorized enrollment · biometric database theft · embedding exfiltration
image path traversal · malicious image payloads · spoofed API callers
agent overreach · threshold tampering · replay attacks
poisoned enrollment data
```

**Controls:** provider abstraction (no direct library calls); encrypted registry; opaque IDs; path allowlist; scope-based policy; threshold protection; rate limits; consent registry; audit (9 event classes: enrollment created/deleted; identity lookup; identity verification; threshold override; biometric export attempt; registry access; administrative changes; policy override).

**Audit example:**

```json
{"event": "biometric.identity.lookup", "actor": "agent:codex",
 "purpose": "local_user_verification", "person_result": "matched",
 "timestamp": "ISO8601", "policy_decision": "allow"}
```

**Never log:** raw images unless explicitly configured; raw embeddings; encryption keys.

**Error model (8):** `VISION_NO_FACE · VISION_MULTIPLE_FACES · VISION_LOW_QUALITY · VISION_PROVIDER_UNAVAILABLE · VISION_POLICY_DENIED · VISION_IDENTITY_NOT_FOUND · VISION_DUPLICATE_IDENTITY · VISION_PATH_DENIED`

---

## 21. Approval Model

### R0–R4 summary

See Section 14 — High/Critical operations (enroll, delete, biometric export, global threshold change) require explicit approval; export defaults to deny.

### Consent + duplicate confirmation

Enrollment requires explicit user action + consent state + retention rule + audit record; duplicate identity detection returns candidates requiring **human confirmation before merging**; identity deletion removes all dependent records + audit tombstone.

---

## 22. Failure Handling

**Error codes (8 — Section 20):** mapped to user-safe messages; provider unavailable ⇒ fail closed for biometric operations (detection/redaction may degrade per policy); **never fabricate recognition results**; path denied before file access; multiple faces ⇒ reject for enrollment but report for detection.

---

## 23. Recovery Model

- **Registry recovery:** encrypted store; key versioning; deletion tombstones
- **Provider migration recovery:** embeddings re-encoded from source images when providers change; schema version tracked per embedding
- **Worker recovery:** queue-persisted heavy jobs; partial batch results tracked
- **Consent recovery:** revoked consent ⇒ identity operations denied; data deletion per retention policy

---

## 24. Observability

**Metrics (7):** `vision_requests_total · vision_detection_latency · vision_encoding_latency · vision_match_latency · vision_unknown_faces_total · vision_policy_denied_total · vision_enrollment_total` — **do not label metrics with personal names.**

---

## 25. Audit

9 audited operation classes (Section 20) + 8 event types (Section 16) + tombstones on deletion; audit example per Section 20; **never log raw images (unless explicitly configured), raw embeddings, or encryption keys.**

---

## 26. Data Model

**Tables (6):** `biometric_persons` (id, display_name, status, created_at, updated_at) · `biometric_embeddings` (id, person_id, provider, provider_version, encrypted_embedding, created_at) · `biometric_consents` · `biometric_events` · `biometric_policy` · `biometric_provider_versions`

---

## 27. API / Event Contracts

### 27.1 API surface

```text
POST /v1/vision/detect      POST /v1/vision/encode
POST /v1/vision/compare     POST /v1/vision/search
POST /v1/identity/enroll    DELETE /v1/identity/{id}
POST /v1/privacy/redact
GET  /health   GET /ready   GET /providers
```

### 27.2 Common envelope

Standard Pao envelope + decision states (`strong_match/match/uncertain/no_match`) + 8 error codes (Section 20) + events (Section 16).

---

## 28. Configuration

```env
VISION_PROVIDER=face_recognition
VISION_DEVICE=cpu
PAO_ALLOWED_VISION_PATHS=/data/images,/data/camera,/data/uploads
```

Plus policy scopes, thresholds (admin-only mutation), retention policies, consent registry — per Section 14/19.

---

## 29. Feature Flags

| Flag | Default | Gates |
|---|---|---|
| `VISION_PROVIDER` | `face_recognition` | Provider selection (capability-reported) |
| `VISION_DEVICE` | `cpu` | cuda = future (provider must report capability) |
| `PAO_ALLOWED_VISION_PATHS` | configured roots | File access boundary |
| Enrollment/delete/export approval gates | **required** | High/Critical operations |
| `vision.admin` threshold changes | restricted | Global threshold mutation |
| Camera/video/liveness tools | **disabled (future)** | Stage 7 extensions |

---

## 30. Repository / Module Structure

See Section 10 tree (apps/vision-identity; packages biometric-*; providers; services; data/biometric; tests/biometric) — adapt to existing repo conventions.

---

## 31. Dashboard Integration

Add **Vision Identity** page — 8 sections: `Overview · Known Identities · Enrollment · Recognition Tests · Privacy Redaction · Providers · Audit · Settings`

**Identity card (per identity):**

```text
Owner ──────────────
Status: Active · Samples: 5
Provider: face_recognition · Last Updated: ...
Consent: Active
[Test] [Add Sample] [Disable] [Delete]
```

**Avoid displaying embeddings.** **Provider dashboard:** Provider; Version; Model; Device; Status; Average latency; Registry compatibility — e.g., `face_recognition · Provider status: Healthy · Mode: CPU`.

---

## 32. Dependencies

### Required

- **Pao-hubPro existing primitives:** auth/RBAC, policy engine, approval engine, audit store, secret management, worker queue, Docker tooling
- **ageitgey/face_recognition + dlib** (initial provider; license verified; Docker build for native deps)

### Recommended

- **MCPProxy (20.74)** — vision tool routing; **Context Mode (20.65 pending)** — structured summaries instead of image payloads; **OpenPost/media pipelines (20.60/20.31)** — redaction consumers; **Secrets manager** — key storage

### Optional

- InsightFace/ONNX providers (future); FAISS/Qdrant/pgvector indexes (later scale); liveness providers; camera/RTSP infrastructure

**Do not assume other phases are implemented.** Standalone path: provider interface + FaceRecognition adapter + encrypted registry + API + MCP tools + policy work as an isolated service (Docker, loopback/private); MCPProxy/policy integrations activate when those phases exist.

---

## 33. Compatibility

- **Provider migration:** embeddings **not compatible across providers** — store provider/model_id/embedding_schema_version; re-encode source images when migrating
- **Threshold compatibility:** policy-protected; changes require `vision.admin` + audit
- **Backward compatibility:** additive tables; existing Pao components untouched; MCP tool contracts stable across provider changes
- **Platform:** CPU default; GPU future; Docker first
- **Legal/ethical compatibility:** non-goals (Section 4) enforced by scope design — no mass surveillance/tracking/covert collection surfaces

---

## 34. Migration

- Additive migrations (6 tables); reversible where feasible
- Provider migration = re-encoding pipeline + version tracking (never assume cross-provider embedding compatibility)
- Consent records migrated with identities; missing consent ⇒ identity disabled until consent confirmed
- Encryption key rotation supported via key versioning

---

## 35. Rollback

```text
1. Disable vision.* MCP tools / API routes (flag)
2. In-flight enrollment: complete or safely discard per quality-gate state
3. Encrypted registry retained (evidence); deletion only via approved identity.delete
4. Provider rollback: previous pinned provider version; embeddings versioned per provider
5. Threshold/policy rollback via admin audit trail
6. Audit tombstones preserved — ห้ามลบประวัติการลบข้อมูลชีวมิติ
```

---

## 36. Testing Strategy

### 36.1 Unit tests (5)

Provider interface; thresholds; encryption; policy; path validation.

### 36.2 Integration tests (7)

image → detect; image → embedding; compare; search; enroll; delete; redact.

### 36.3 Security tests (5)

Traversal; unauthorized registry access; embedding exposure; policy bypass; audit integrity.

### 36.4 Agent-specific tests

Tool-selection test (agents reach only the 7 narrow tools); hallucinated-tool test (unknown vision tools denied); **approval-bypass test (enroll/delete/export unreachable without approval; thresholds not agent-mutable)**; context-isolation test (no raw embeddings in prompts/logs/network); **authorization-separation test (face match alone cannot grant high-risk action)**.

---

## 37. Acceptance Criteria

- [ ] `BiometricProvider` interface exists; `FaceRecognitionProvider` implemented
- [ ] Local vision API operational; MCP tools registered
- [ ] **Embeddings are not returned to generic agents**
- [ ] Encrypted biometric registry implemented
- [ ] Enrollment requires policy approval; identity deletion removes dependent records
- [ ] Audit events are generated
- [ ] Face detection works on local images; comparison works; known identity search works; privacy face redaction works
- [ ] Provider/model version stored; threshold configuration is policy protected
- [ ] Docker deployment works; health checks exist
- [ ] **High-risk authorization does not rely on face match alone**
- [ ] Tests pass

---

## 38. Implementation Roadmap

| Stage | Content |
|---|---|
| 1 — Foundation | provider interface → face_recognition adapter → basic tests |
| 2 — Registry | person metadata; embeddings; encryption |
| 3 — API | detect; compare; search |
| 4 — MCP | `vision.* · identity.* · privacy.*` |
| 5 — Policy | scope; approval; audit |
| 6 — UI | enrollment; identity management; audit |
| 7 — Advanced | camera; video; liveness; provider migration |

**Future extensions (5 follow-up phases):** Pao-hubPro × InsightFace · × Anti-Spoof Runtime · × Camera Event Intelligence · × Photo Library Face Clustering · × Smart Home Presence Engine

---

## 39. Risks

| Risk | Mitigation |
|---|---|
| Unauthorized enrollment | Explicit approval + consent registry + audit |
| Biometric database theft / embedding exfiltration | Encryption at rest; key versioning; no embeddings in logs/prompts/network; access-controlled vectors |
| Image path traversal | Approved roots + canonical resolution (Section 14) |
| Malicious image payloads | Decode validation; size/type limits |
| Spoofed API callers / agent overreach | Scopes; rate limits; approval gates |
| Threshold tampering | `vision.admin` only + audit |
| Replay attacks | Audit + verification composition |
| Poisoned enrollment data | Quality gate + outlier detection + duplicate human confirmation |
| Face match treated as authorization | Identity ≠ Authorization separation (Invariant); high-risk list (Section 5) |
| Cross-provider embedding assumptions | Version tracking; re-encoding pipeline |
| Privacy redaction incomplete | Modes + policy + human review; redaction = best-effort masking |
| Scope creep to surveillance | Non-goals (Section 4) enforced by design |

---

## 40. Security Checklist

- [ ] BiometricProvider abstraction — no direct face_recognition calls in business logic
- [ ] Embeddings encrypted at rest; keys versioned via secrets manager; never in logs/prompts/frontend network traces
- [ ] Opaque person IDs; no filenames as identity keys
- [ ] Raw images local by default; cloud upload only with explicit request + policy + purpose + log
- [ ] Raw embeddings never returned to generic agents (embedding_id only)
- [ ] Approved-path validation (PAO_ALLOWED_VISION_PATHS); traversal denied
- [ ] Enrollment: explicit action + consent + retention + audit + quality gate + duplicate human confirmation
- [ ] Deletion: embeddings + indexes + cache + derived data + audit tombstone
- [ ] Identity ≠ Authorization: high-risk actions require liveness/PIN/device trust/human approval beyond face match
- [ ] Thresholds mutated only via `vision.admin` + audit
- [ ] Rate limits on searches/bulk scans/enrollments/failed verifications
- [ ] Consent registry (purpose/scope/expiration/revocation) enforced
- [ ] No personal names as metric labels; no raw biometric vectors in events
- [ ] Non-goals (surveillance/tracking/inference) hold by design

---

## 41. Production Readiness Checklist

### Quality gates

Unit (5) + integration (7) + security (5) suites pass; Docker deployment works; health/readiness/providers endpoints live; benchmark harness executed (`detection/encoding/search latency, memory, false positives/negatives, threshold sensitivity`); **never fabricate recognition results.**

### Documentation required

Architecture; provider setup (incl. dlib build); policy/consent model; encryption/key management; privacy redaction guide; enrollment runbook; provider migration guide; benchmark results; license register entries (face_recognition + dlib).

### Final report

Changed files; architecture notes; security decisions; test results; migration notes; unresolved risks.

---

## 42. Future Extensions

Follow-up phases: Pao-hubPro × InsightFace · × Anti-Spoof Runtime · × Camera Event Intelligence · × Photo Library Face Clustering · × Smart Home Presence Engine. Plus: GPU acceleration profiles; vector index backends (FAISS/Qdrant/pgvector) with access control; `vision.scan_video` timeline intelligence.

---

## 43. Definition of Done

Phase 20.76 is complete when Pao-hubPro gains a reusable **Local Biometric Identity & Face Intelligence Control Plane** (not a standalone face-recognition script) where:

```text
Recognition provides identity evidence.
Policy decides what that evidence is allowed to do.
```

…keeping the system compatible with Pao-hubPro's broader direction: local-first AI; MCP federation; secure agent execution; privacy-aware automation; auditable operations; human approval for sensitive actions; replaceable AI/provider components; policy-governed autonomous systems.

**Phase status:** `Phase: 20.76 · Status: SPECIFICATION READY · Primary Provider: ageitgey/face_recognition · Architecture: Local-First / Provider-Agnostic / MCP-Native · Security Model: Policy-Governed Biometric Runtime`

---

## 44. Codex One-Shot Implementation Prompt

```text
You are implementing Phase 20.76 of Pao-hubPro.

Goal:
Build a local-first biometric identity and face intelligence runtime using
ageitgey/face_recognition as the initial provider while keeping the system
provider-agnostic.

Implement:

1. BiometricProvider interface.
2. FaceRecognitionProvider adapter.
3. Face detection.
4. Face encoding.
5. Face comparison.
6. Known identity search.
7. Multi-image enrollment.
8. Identity deletion.
9. Encrypted embedding registry.
10. Provider/model version tracking.
11. Privacy redaction tools.
12. MCP tools:
    - vision.detect_faces
    - vision.compare_faces
    - vision.search_identity
    - identity.enroll
    - identity.delete
    - privacy.blur_faces
    - privacy.redact_unknown_faces
13. Scope-based policy engine.
14. Approval requirements for biometric enrollment/deletion.
15. Structured audit events.
16. Safe path validation.
17. Rate limiting.
18. Docker deployment.
19. Health/readiness endpoints.
20. Unit, integration, and security tests.

Security requirements:

- Never expose raw embeddings to generic agents.
- Never log raw embeddings.
- Raw images remain local by default.
- Encrypt embeddings at rest.
- Do not allow arbitrary filesystem paths.
- Identity match must never directly grant high-risk authorization.
- Enrollment and deletion require explicit permission.
- Provider/model/schema versions must be stored with embeddings.

Architecture:

Agent
  -> MCPProxy
  -> Pao-hubPro Policy Engine
  -> MCP Vision Gateway
  -> Vision Identity Runtime
  -> BiometricProvider
  -> FaceRecognitionProvider
  -> Encrypted Local Registry

Design the implementation so additional providers such as InsightFace and
ONNX can be plugged in later without changing MCP tool contracts.

Do not rewrite unrelated Pao-hubPro components.

Run tests after implementation and provide:
- changed files
- architecture notes
- security decisions
- test results
- migration notes
- unresolved risks
```
