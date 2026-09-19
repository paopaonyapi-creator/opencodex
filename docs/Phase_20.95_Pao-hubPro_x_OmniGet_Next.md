# Phase 20.95 — Pao-hubPro × OmniGet Next

## Autonomous Content Acquisition Gateway, 1,800+ Site Media Intake, MCP-Native Local Tool Runtime, Authenticated Browser Retrieval, Agent-Driven Transcription & Research, Durable Download Orchestration, Knowledge Ingestion & Policy-Governed Digital Asset Supply Chain

> **Project:** Pao-hubPro  
> **Phase:** 20.95  
> **Status:** Implementation Specification / Codex-Ready  
> **Primary upstream:** https://github.com/tonhowtf/omniget  
> **Verified:** 2026-09-19  
> **Integration strategy:** MCP-first, CLI fallback, process-isolated, local-first, policy-governed  
> **Supersedes:** Phase 20.24 OmniGet integration concept  
> **Core rule:** Reuse existing Pao-hubPro policy, queue, artifact, browser, credential, knowledge, provider-routing, audit and observability systems. Do not build parallel infrastructure.

---

# 0. Executive Summary

Phase 20.95 upgrades OmniGet from a download utility integration into a first-class **Content Acquisition & Media Intake Plane** for Pao-hubPro.

The objective is **not** to rebuild OmniGet inside Pao-hubPro. Pao-hubPro remains the control plane and OmniGet becomes a replaceable local worker for retrieval and processing.

```text
OmniGet
= acquisition + local media/document processing worker

Pao-hubPro
= intent + policy + authorization + orchestration + identity
+ secrets + provenance + knowledge + budget + audit control plane
```

The target user experience is a single request such as:

```text
เอาลิงก์นี้มาศึกษา ถอดเสียง สรุป เก็บต้นฉบับ และเพิ่มเข้าคลังความรู้
```

Pao-hubPro must then be able to:

1. understand the intent;
2. inspect the source;
3. decide whether authentication is needed;
4. apply policy and approval gates;
5. choose OmniGet MCP or CLI;
6. run a durable acquisition job;
7. recover from interruption/rate limits;
8. normalize outputs into Pao-hubPro artifacts;
9. transcribe/process locally where practical;
10. create evidence-linked research output;
11. optionally ingest into the knowledge system;
12. preserve provenance and audit records;
13. keep credentials outside the agent context.

---

# 1. Why This Phase Exists

The original Phase 20.24 represented OmniGet mainly as a download capability. Current OmniGet has expanded into a broader local tool runtime with:

- roughly 1,800+ sites through yt-dlp plus native source handling;
- browser-assisted authenticated retrieval;
- a local MCP server;
- `omniget-cli`;
- queue/resume/retry behavior;
- FFmpeg processing;
- whisper.cpp transcription;
- aria2 accelerated downloads;
- gallery-dl acquisition;
- PDF/document/image/audio/subtitle/file tools;
- plugins;
- local-first data handling;
- AI-agent fetch/transcribe/research workflows.

Therefore **20.95 must upgrade 20.24, not duplicate it**.

---

# 2. Verified OmniGet Capabilities Used by This Design

As verified from the upstream README on 2026-09-19:

## 2.1 Acquisition

- Native handling for several media/social/course sources.
- Roughly 1,800 long-tail sites through yt-dlp.
- gallery-dl for galleries/profiles.
- aria2 for accelerated large-file downloads.
- direct HTTP and HLS/DASH workflows.
- bulk acquisition.
- resume, retry and backoff behavior.

## 2.2 Browser-Authenticated Retrieval

The OmniGet browser extension can forward page context, referer and cookies to the local app so it can retrieve content available to the user's logged-in browser session.

Pao-hubPro must treat this session material as **secret-class runtime data**.

## 2.3 Agent Runtime

OmniGet documents:

- a built-in MCP server exposing a subset of tools;
- agent client configuration support;
- a Claude Code plugin;
- fetch/transcribe/research/doctor-style workflows.

## 2.4 Local Processing

Relevant capabilities include:

- whisper.cpp transcription;
- subtitle operations;
- FFmpeg video/audio conversion;
- PDF extraction/sanitization/PDF-to-Markdown;
- OCR;
- image processing;
- duplicate detection;
- local file search.

## 2.5 Local-First Model

OmniGet documents local handling of files, cookies and API configuration and no download telemetry by default.

## 2.6 License Boundary

OmniGet is GPL-3.0.

**Architecture rule:** integrate through process/protocol boundaries (MCP/CLI) by default. Do not copy, vendor, statically link or embed GPL code into Pao-hubPro core without an explicit licensing review.

This is an engineering boundary, not legal advice.

---

# 3. Phase Objectives

## 3.1 Primary Objective

Create one canonical Pao-hubPro subsystem:

```text
Content Acquisition Gateway (CAG)
```

It must:

- accept acquisition/research intent from users or agents;
- inspect and normalize sources;
- map intent to capabilities;
- enforce policy;
- resolve authentication requirements;
- select execution adapter;
- submit and supervise durable jobs;
- normalize results into Pao-hubPro artifacts;
- invoke optional processing;
- optionally ingest knowledge;
- expose status, history and audit information;
- keep secrets hidden from agents.

## 3.2 Secondary Objectives

- Migrate/reuse Phase 20.24 instead of deleting blindly.
- Make OmniGet replaceable behind an adapter contract.
- Allow future acquisition engines to plug into the same gateway.
- Connect BrowserSkill/browser sessions without exposing cookies.
- Connect research workflows to the existing model/provider router.
- Keep acquisition, inference and commercial-rights decisions separate.

## 3.3 Non-Goals

This phase must not:

- build another yt-dlp clone;
- bypass DRM;
- bypass paywalls;
- silently use private sessions without authorization;
- expose raw credentials to LLMs;
- expose all OmniGet tools to every agent;
- replace Pao-hubPro policy infrastructure;
- replace Pao-hubPro provider routing;
- replace the existing artifact store;
- treat downloaded media as commercially licensed merely because it was retrievable.

---

# 4. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                         User / Agent                         │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Pao-hubPro Intent Layer                   │
│ URL / File / Research / Archive / Audio / Gallery / Batch   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              Content Acquisition Gateway (CAG)               │
│ Resolver → Policy → Approval → Capability → Execution Plan  │
└───────────────┬────────────────────────┬─────────────────────┘
                │                        │
                ▼                        ▼
       OmniGet MCP Adapter       OmniGet CLI Adapter
          preferred                 fallback
                │                        │
                └────────────┬───────────┘
                             ▼
                    ┌────────────────┐
                    │    OmniGet     │
                    │ yt-dlp         │
                    │ aria2          │
                    │ gallery-dl     │
                    │ FFmpeg         │
                    │ whisper.cpp    │
                    └───────┬────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  Artifact Intake Pipeline                    │
│ inspect → hash → metadata → provenance → dedupe → store     │
└────────────────────┬──────────────────────┬──────────────────┘
                     │                      │
                     ▼                      ▼
             Derived Processing       Knowledge Pipeline
                     │                      │
                     ▼                      ▼
          Transcript / Converted      Chunks / Research /
               Media / PDF           Evidence / Embeddings
```

---

# 5. Responsibility Boundary

## Pao-hubPro decides

- whether an action is allowed;
- which capability is appropriate;
- which session/secret reference may be used;
- which adapter to call;
- what budget applies;
- where artifacts are stored;
- whether content enters knowledge;
- what agents may see;
- what requires human approval.

## OmniGet performs

- acquisition;
- local queue operations;
- selected media/document processing;
- selected transcription;
- selected local utility execution.

---

# 6. Canonical Acquisition Request

```ts
type AcquisitionIntent =
  | "download"
  | "inspect"
  | "audio_extract"
  | "transcribe"
  | "research"
  | "archive"
  | "gallery"
  | "document_extract"
  | "batch";

interface AcquisitionRequest {
  requestId: string;

  actor: {
    type: "user" | "agent" | "system";
    id: string;
    agentId?: string;
  };

  source: {
    kind: "url" | "file" | "manifest" | "batch";
    value: string | string[];
  };

  intent: AcquisitionIntent;

  options?: {
    quality?: string;
    audioOnly?: boolean;
    subtitleLanguages?: string[];
    outputFormat?: string;
    maxItems?: number;
    transcribe?: boolean;
    summarize?: boolean;
    ingestKnowledge?: boolean;
    preserveOriginal?: boolean;
  };

  authContext?: {
    requestedProfileId?: string;
    browserSessionRef?: string;
  };

  policyContext: {
    workspaceId: string;
    projectId?: string;
    purpose?: "research" | "personal_archive" | "work" | "stock_research" | "other";
  };
}
```

### Critical security rule

`browserSessionRef` must be an opaque reference only.

Never place the following into an agent-visible request:

```text
raw cookies
passwords
bearer tokens
API keys
browser profile secrets
```

---

# 7. Acquisition Plan

Every request must be planned before execution.

```ts
interface AcquisitionPlan {
  requestId: string;
  sourceHost?: string;
  sourceClass: string;
  authRequirement: "none" | "optional" | "required" | "unknown";
  selectedAdapter: "omniget_mcp" | "omniget_cli" | "native" | "unsupported";
  selectedCapability?: string;
  riskClass: "low" | "medium" | "high" | "blocked";
  approvalsRequired: string[];
  estimatedOutputs: string[];
  postProcessors: string[];
  knowledgePipeline?: string;
}
```

The plan must be inspectable through the dashboard and audit log.

---

# 8. Adapter Architecture

```ts
interface AcquisitionAdapter {
  id: string;
  probe(): Promise<AdapterHealth>;
  capabilities(): Promise<CapabilityDescriptor[]>;
  submit(job: AdapterJob): Promise<AdapterJobRef>;
  status(ref: AdapterJobRef): Promise<AdapterJobStatus>;
  pause?(ref: AdapterJobRef): Promise<void>;
  resume?(ref: AdapterJobRef): Promise<void>;
  cancel(ref: AdapterJobRef): Promise<void>;
}
```

Required adapters:

```text
OmniGetMcpAdapter       REQUIRED
OmniGetCliAdapter       REQUIRED
LegacyPhase2024Adapter  MIGRATION ONLY
MockAcquisitionAdapter  TESTING
```

---

# 9. MCP-First Integration

## 9.1 Preferred Path

MCP is the preferred integration when a matching capability is available because it provides structured tool calls and capability discovery.

```text
Pao-hubPro Agent
      │
      ▼
Pao Capability Facade
      │
      ▼
Policy / Scope Enforcement
      │
      ▼
OmniGet MCP Adapter
      │
      ▼
OmniGet MCP Server
```

### Do not expose OmniGet MCP directly to generic agents

General agents should call a governed Pao-hubPro capability such as:

```text
pao.acquire
```

Pao-hubPro then resolves the underlying OmniGet tool.

## 9.2 MCP Capability Discovery

At startup or health refresh:

1. connect to configured/discovered OmniGet bridge;
2. authenticate through secret reference;
3. list tools;
4. normalize tool descriptors;
5. map through capability aliases;
6. classify risk;
7. enable only allowlisted tools;
8. record compatibility/version data.

Do not depend on a hardcoded tool count at runtime.

---

# 10. Tool Exposure Policy

## 10.1 Normally Allowed After Standard Policy Checks

Examples:

- metadata/info inspection;
- download submission;
- owned-job status;
- pause/resume/cancel owned jobs;
- transcription;
- PDF text extraction;
- PDF sanitization;
- OCR;
- image resizing;
- duplicate detection;
- workspace-scoped file search;
- aria2 download;
- gallery-dl retrieval;
- non-destructive conversion.

## 10.2 Approval-Required / Restricted

- authenticated private-source retrieval;
- social publishing/posting;
- account-specific personal/profile reads;
- startup/system configuration;
- uninstall operations;
- cache deletion;
- secure delete;
- registry modification;
- hardening/debloat operations;
- any external account write.

## 10.3 Never Auto-Expose to Generic Agents

- raw cookie export;
- credential export;
- unrestricted filesystem search;
- destructive system operations;
- arbitrary auto-clicker execution;
- actions outside workspace or explicit user scope.

---

# 11. CLI Fallback

Use `omniget-cli` when:

- MCP is unavailable;
- MCP lacks a required capability;
- deterministic CLI execution is preferable;
- migration support needs it;
- diagnostics require it.

Never concatenate raw shell commands from user input.

Correct pattern:

```ts
spawn(binary, ["download", normalizedUrl, "-q", quality, "-o", outputDir], {
  shell: false,
  env: sanitizedEnv,
});
```

Minimum mappings:

```text
omniget info <url>
omniget download <url> ...
omniget batch <file> ...
omniget import-cookies <file>  # controlled admin workflow only
```

---

# 12. Authenticated Browser Retrieval

## 12.1 Architecture

```text
Pao-hubPro Browser / BrowserSkill
              │
              ▼
     Session Reference Broker
              │
              ▼
         Policy Approval
              │
              ▼
       OmniGet Adapter
              │
              ▼
   Local OmniGet Browser Bridge
```

## 12.2 Mandatory Rules

1. Raw cookies never enter LLM context.
2. Raw cookies never enter ordinary audit logs.
3. Jobs store only opaque session IDs.
4. Session refs are domain-scoped.
5. Session refs have expiry/TTL.
6. Authorization actor is recorded.
7. Cross-domain use requires re-evaluation.
8. No silent account switching.
9. User can revoke a session immediately.
10. Secrets remain local where possible.

## 12.3 Auth Classes

```text
PUBLIC
SESSION_OPTIONAL
SESSION_REQUIRED
ACCOUNT_WRITE_CAPABLE
BLOCKED_OR_DRM
```

Account-write actions must be authorized independently from read/download operations.

---

# 13. Policy Engine Contract

```ts
interface AcquisitionPolicyDecision {
  decision: "allow" | "allow_with_limits" | "require_approval" | "deny";
  reasonCodes: string[];
  constraints?: {
    maxItems?: number;
    maxBytes?: number;
    allowedDomains?: string[];
    allowedOutputRoot?: string;
    allowAuthentication?: boolean;
    allowKnowledgeIngest?: boolean;
  };
}
```

Required checks:

- actor permission;
- workspace permission;
- source/domain class;
- authentication requirement;
- public/private classification;
- batch/item limit;
- output path;
- file type;
- external-write risk;
- destructive-tool risk;
- retention;
- knowledge-ingestion permission;
- commercial-rights metadata.

---

# 14. Copyright / Terms / Commercial Use Guardrail

The UI and artifact metadata must distinguish:

```text
Technically retrievable
≠
Authorized to copy
≠
Authorized to redistribute
≠
Licensed for commercial resale
```

For Adobe Stock or other commercial pipelines:

- third-party downloaded media is **not** automatically sale-ready;
- commercial rights default to `unknown`;
- research/reference assets stay separated from export-ready stock assets;
- no DRM bypass workflow is implemented.

---

# 15. Durable Job State Machine

```text
CREATED
  ↓
PLANNING
  ↓
POLICY_CHECK
  ├──→ BLOCKED
  ├──→ WAITING_APPROVAL
  ↓
QUEUED
  ↓
ACQUIRING
  ├──→ PAUSED
  ├──→ RETRY_WAIT
  ├──→ AUTH_REQUIRED
  ├──→ RATE_LIMITED
  ↓
VERIFYING
  ↓
PROCESSING
  ↓
INGESTING
  ↓
COMPLETED

Any active state may become:
FAILED / CANCELLED
```

---

# 16. Error Taxonomy and Retry Policy

```text
TRANSIENT_NETWORK
RATE_LIMIT
EXPIRED_SESSION
UNSUPPORTED_SOURCE
DRM_OR_PROTECTED
OUTPUT_IO
TOOL_CRASH
POLICY_DENIED
USER_CANCELLED
UNKNOWN
```

| Error | Default behavior |
|---|---|
| TRANSIENT_NETWORK | exponential backoff |
| RATE_LIMIT | longer backoff + lower concurrency |
| EXPIRED_SESSION | pause, require session refresh |
| UNSUPPORTED_SOURCE | try approved fallback or fail |
| DRM_OR_PROTECTED | stop; no bypass |
| OUTPUT_IO | verify path/disk, retry only if safe |
| TOOL_CRASH | restart worker once, then fail |
| POLICY_DENIED | no retry |
| USER_CANCELLED | no retry |

---

# 17. Crash Recovery

After Pao-hubPro restart:

- reload all non-terminal jobs;
- reconcile external OmniGet state;
- inspect partial artifacts;
- resume only when safe/idempotent;
- preserve attempt history;
- prevent duplicate completed downloads;
- preserve retry/error metadata.

Idempotency key should include normalized source + intent + important output options + workspace scope.

---

# 18. Artifact Intake Pipeline

```text
raw result
   ↓
file/type inspection
   ↓
SHA-256
   ↓
metadata extraction
   ↓
source provenance
   ↓
deduplication
   ↓
optional quarantine/safety checks
   ↓
canonical artifact store
   ↓
derived artifacts
   ↓
optional knowledge ingest
```

## 18.1 Canonical Artifact Contract

```ts
interface AcquiredArtifact {
  id: string;
  jobId: string;
  parentArtifactId?: string;

  source: {
    url?: string;
    host?: string;
    sourceId?: string;
    fetchedAt: string;
  };

  file: {
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  };

  provenance: {
    adapter: string;
    tool: string;
    toolVersion?: string;
    authenticated: boolean;
    sessionRef?: string;
  };

  classification: {
    visibility: "public" | "authenticated" | "unknown";
    commercialRights: "unknown" | "user_asserted" | "verified" | "restricted";
  };

  metadata: Record<string, unknown>;
}
```

---

# 19. Storage Model

Reuse the existing artifact store if it exists. Logical layout:

```text
data/
└── acquisitions/
    ├── raw/<job-id>/
    ├── derived/<job-id>/
    ├── transcripts/
    ├── research/
    ├── thumbnails/
    ├── manifests/
    └── quarantine/

runtime/
└── acquisition-tmp/<job-id>/
```

Agents receive artifact references, not arbitrary absolute filesystem paths.

---

# 20. Database Schema

Adapt to the current DB and migration framework.

## 20.1 `acquisition_jobs`

```sql
CREATE TABLE acquisition_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  request_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_value_json TEXT NOT NULL,
  source_host TEXT,
  selected_adapter TEXT,
  selected_capability TEXT,
  auth_class TEXT,
  policy_decision TEXT,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  error_message_redacted TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
```

## 20.2 `acquisition_attempts`

```sql
CREATE TABLE acquisition_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  adapter TEXT NOT NULL,
  external_job_ref TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  error_class TEXT,
  diagnostics_json TEXT,
  FOREIGN KEY(job_id) REFERENCES acquisition_jobs(id)
);
```

## 20.3 `acquisition_artifacts`

```sql
CREATE TABLE acquisition_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  parent_artifact_id TEXT,
  artifact_type TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  source_url TEXT,
  source_host TEXT,
  source_id TEXT,
  authenticated INTEGER NOT NULL DEFAULT 0,
  commercial_rights TEXT NOT NULL DEFAULT 'unknown',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES acquisition_jobs(id)
);
```

## 20.4 `acquisition_session_refs`

```sql
CREATE TABLE acquisition_session_refs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  domain_scope_json TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL,
  external_secret_ref TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
```

Raw cookie blobs must not be stored in these normal application tables.

---

# 21. Internal API Surface

```text
POST   /api/acquisition/plan
POST   /api/acquisition/jobs
GET    /api/acquisition/jobs/:id
POST   /api/acquisition/jobs/:id/pause
POST   /api/acquisition/jobs/:id/resume
POST   /api/acquisition/jobs/:id/cancel
POST   /api/acquisition/jobs/:id/retry
GET    /api/acquisition/jobs/:id/artifacts
GET    /api/acquisition/capabilities
GET    /api/acquisition/adapters/health
POST   /api/acquisition/session-refs/:id/revoke
```

All mutation routes require authorization and audit.

---

# 22. Event Model

```text
acquisition.requested
acquisition.planned
acquisition.policy.allowed
acquisition.policy.blocked
acquisition.approval.required
acquisition.queued
acquisition.started
acquisition.progress
acquisition.rate_limited
acquisition.auth_required
acquisition.paused
acquisition.resumed
acquisition.retry_scheduled
acquisition.completed
acquisition.failed
acquisition.cancelled
artifact.acquired
artifact.derived
artifact.knowledge_ingested
```

Example:

```json
{
  "type": "artifact.acquired",
  "jobId": "acq_123",
  "artifactId": "art_456",
  "mimeType": "video/mp4",
  "sizeBytes": 123456789,
  "sha256": "...",
  "sourceHost": "example.com"
}
```

Never include secrets in events.

---

# 23. Transcription Pipeline

Decision order:

```text
trusted existing subtitles
        ↓ if unavailable
embedded subtitle track
        ↓ if unavailable
local whisper.cpp
        ↓ optional approved fallback
cloud STT provider
```

Default: prefer the cheapest safe local path.

Output artifacts:

```text
transcript.txt
transcript.md
transcript.srt
transcript.json
```

Normalized structure:

```ts
interface Transcript {
  language?: string;
  durationMs?: number;
  segments: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence?: number;
  }>;
}
```

---

# 24. Research Pipeline

A `research` intent should be a multi-step pipeline:

```text
inspect source
      ↓
fetch subtitles/text or acquire media
      ↓
transcribe if needed
      ↓
normalize timestamps/pages
      ↓
chunk with source anchors
      ↓
extract topics/claims/entities
      ↓
route inference through Pao provider router
      ↓
generate research note
      ↓
optional knowledge ingest
```

## 24.1 Research Note Template

```md
# Research Note

## Source
- URL:
- Title:
- Retrieved:
- Duration:

## Executive Summary
...

## Key Findings
- Finding `[00:03:12]`

## Important Claims
- Claim — timestamp/page evidence

## Actionable Ideas for Pao-hubPro
- ...

## Open Questions
- ...
```

Timestamp/page anchors must be retained when available.

---

# 25. Knowledge Ingestion

Knowledge ingestion is **optional**, not the default consequence of every download.

Eligibility:

- policy permits indexing;
- artifact is not quarantined;
- workspace allows knowledge ingest;
- workflow/user requested it;
- artifact type is supported.

Store references to:

- source URL;
- artifact ID;
- transcript ID;
- research note ID;
- timestamps/page anchors;
- extraction tool/version;
- retrieval date.

Deduplicate by content hash and normalized source identity.

---

# 26. Capability Registry

Register capabilities centrally instead of hardcoding prompts.

```yaml
id: acquisition.omniget.download
provider: omniget
transport: mcp
risk: medium
side_effects:
  network: true
  filesystem_write: true
  account_write: false
requires:
  - policy.acquisition
inputs:
  - url
  - quality
outputs:
  - artifact
fallback:
  transport: cli
```

```yaml
id: acquisition.omniget.transcribe
provider: omniget
transport: mcp
risk: low
side_effects:
  network: false
  filesystem_write: true
requires:
  - artifact.read
outputs:
  - transcript
```

---

# 27. Pao-hubPro Skill Registry

Recommended high-level skills:

```text
acquire-url
inspect-url
acquire-audio
acquire-gallery
transcribe-media
research-media
archive-source
extract-document
batch-acquire
acquisition-doctor
```

## 27.1 `research-media`

Input example:

```text
เอาคลิปนี้มาศึกษา ถอดเสียง สรุป และเก็บเข้าคลังความรู้
```

Resolved workflow:

```text
inspect-url
→ policy-check
→ fetch subtitles OR acquire media
→ transcribe if required
→ research note
→ knowledge ingest
```

Optimization rule: if reliable subtitles are enough for the user's goal, avoid downloading the full video.

---

# 28. Hook Policy

## Pre-execution

```text
before_acquisition_plan
before_policy_decision
before_authenticated_retrieval
before_external_write_action
before_large_batch
before_knowledge_ingest
```

## Post-execution

```text
after_artifact_acquired
after_transcript_created
after_research_note_created
after_knowledge_ingest
after_acquisition_failure
```

Authenticated retrieval and external account writes must remain separately blockable.

---

# 29. BrowserSkill Integration

Recommended responsibility split:

```text
BrowserSkill / Pao Browser
  ├─ navigate
  ├─ login
  ├─ inspect page
  ├─ allow user takeover
  └─ issue approved session reference

OmniGet
  ├─ fetch binary/media
  ├─ queue/resume/retry
  ├─ extract subtitles
  └─ process artifacts
```

Do not route large binary downloads through browser automation if OmniGet has a safer/more durable native path.

---

# 30. ENZO / Unified Workspace Integration

Workspace agents should see a single high-level Pao tool:

```ts
acquire_content({
  source,
  intent,
  options
})
```

They must not receive:

- OmniGet's local token;
- raw browser cookies;
- raw credential files.

---

# 31. OmniRoute / Provider Routing Integration

Keep acquisition separate from inference:

```text
OmniGet
→ obtain/transcribe/normalize source

OmniRoute / Pao provider router
→ choose model/provider for summarization/research
```

OmniGet-native AI tools can exist as optional worker capabilities, but they do not become the global routing authority.

---

# 32. Budget Governance

Track cost classes independently:

```text
NETWORK_TRANSFER
LOCAL_CPU
LOCAL_GPU
CLOUD_STT
CLOUD_LLM
STORAGE
```

Example:

```yaml
research_media:
  prefer_subtitles: true
  prefer_local_whisper: true
  cloud_stt_fallback: approval_required
  cloud_llm_budget_usd: 0.50
  max_video_duration_minutes: 180
```

---

# 33. Security Threat Model

Consider:

- malicious URLs;
- shell injection;
- path traversal;
- oversized downloads;
- disk exhaustion;
- credential leakage;
- cross-domain cookie misuse;
- malicious files;
- poisoned subtitle/text content;
- prompt injection inside acquired documents;
- SSRF-like targets;
- unsafe tool expansion;
- privilege escalation through system tools.

Required controls:

- URL parser + scheme allowlist;
- private network target restrictions;
- canonical output root;
- filename sanitization;
- size/item limits;
- argument-array process spawning;
- secret redaction;
- session scope/TTL/revocation;
- explicit tool allowlist;
- workspace filesystem sandbox;
- destructive-action deny/approval gates;
- provenance labels;
- untrusted-content tagging.

---

# 34. Prompt Injection Boundary

Anything acquired from the internet is **untrusted external content**.

Agents must never treat instructions inside downloaded text, subtitles, PDFs, webpages or transcripts as system instructions.

Internal envelope example:

```json
{
  "trust": "untrusted_external_content",
  "sourceArtifactId": "art_456",
  "content": "..."
}
```

---

# 35. SSRF / Network Restrictions

Default behavior:

- allow `http` and `https`;
- authorize magnet/torrent separately;
- reject remote `file://` use;
- block localhost/private/link-local/cloud metadata addresses unless explicitly allowed;
- re-evaluate redirects when practical.

The acquisition gateway must not become a generic internal-network fetch proxy.

---

# 36. File Safety

For every result:

1. inspect extension and magic bytes separately;
2. compute SHA-256;
3. normalize/sanitize filename;
4. enforce output root;
5. never auto-execute acquired binaries;
6. quarantine suspicious artifacts when required;
7. limit recursive archive extraction;
8. sanitize PDFs before downstream ingestion when policy requires;
9. preserve original provenance.

---

# 37. Observability

Metrics:

```text
acquisition_jobs_total
acquisition_jobs_active
acquisition_success_rate
acquisition_failure_rate
acquisition_bytes_total
acquisition_duration_seconds
acquisition_retry_total
acquisition_rate_limit_total
acquisition_auth_refresh_total
transcription_duration_seconds
knowledge_ingest_total
adapter_health
```

Structured log example:

```json
{
  "jobId": "acq_123",
  "adapter": "omniget_mcp",
  "event": "download_started",
  "host": "youtube.com"
}
```

Never log:

```text
Cookie
Authorization bearer values
raw session blobs
API keys
passwords
```

Audit must answer:

- who requested the action;
- source domain;
- policy decision;
- whether auth was used;
- adapter/capability;
- produced artifacts;
- whether knowledge ingest occurred;
- approval actor for restricted actions.

---

# 38. Dashboard / UI

Add an **Acquisition** area:

```text
Acquisition
├── New Request
├── Active Jobs
├── Waiting Approval
├── Completed
├── Failed
├── Artifacts
├── Sessions
└── Adapter Health
```

## Job card

Show:

- source host/title;
- intent;
- state/progress;
- adapter;
- auth badge;
- policy state;
- size;
- output artifacts;
- retries;
- pause/resume/cancel/retry.

Never show raw cookies.

## New Request

Fields:

```text
URL / file / batch
Intent
Quality
Audio only
Subtitle language
Transcribe
Research note
Add to knowledge
Workspace/project
```

Plan preview example:

```text
Source: YouTube
Auth: not required
Adapter: OmniGet MCP
Plan:
  ✓ fetch subtitles
  ✓ audio only if transcription required
  ✓ local whisper fallback
  ✓ research note
  ✓ knowledge ingest
Risk: Low
```

---

# 39. Agent UX

Expose one default high-level tool:

```text
pao.acquire
```

Example call:

```json
{
  "source": "https://...",
  "intent": "research",
  "options": {
    "ingestKnowledge": true
  }
}
```

The gateway decides lower-level tools.

Only specialized trusted agents should receive narrower expert capabilities.

---

# 40. Migration from Phase 20.24

Do not delete 20.24 first.

Migration sequence:

```text
Inventory
→ classify reusable parts
→ compatibility wrapper
→ introduce canonical contracts
→ migrate data/history
→ switch traffic
→ verify
→ deprecate legacy path
→ remove dead code only after tests
```

Classify every legacy component:

```text
KEEP
ADAPT
MIGRATE
REMOVE_AFTER_CUTOVER
```

If legacy code directly calls:

```ts
omniget.download(url)
```

route through:

```ts
const plan = await acquisitionGateway.plan({
  source: { kind: "url", value: url },
  intent: "download",
  // existing actor/policy context
});

await acquisitionGateway.submit(plan);
```

---

# 41. Implementation Work Packages

## WP-1 — Repository Audit

Find existing:

- Phase 20.24 OmniGet code;
- policy engine;
- MCP registry;
- durable queue/job runtime;
- artifact store;
- browser/session bridge;
- credential broker;
- knowledge ingestion;
- provider router;
- observability/audit.

Deliver:

```text
docs/phases/20.95/INTEGRATION_AUDIT.md
```

## WP-2 — Contracts

Implement:

- AcquisitionRequest;
- AcquisitionPlan;
- AcquisitionJob;
- AcquiredArtifact;
- AcquisitionAdapter;
- normalized errors.

## WP-3 — OmniGet MCP Adapter

Implement:

- connection config;
- token reference;
- health probe;
- tool discovery;
- allowlist;
- input/output normalization;
- timeout/reconnect behavior.

## WP-4 — OmniGet CLI Adapter

Implement:

- binary discovery;
- version detection;
- safe spawn;
- sanitized environment;
- cancellation;
- output normalization;
- secret-redacted diagnostics.

## WP-5 — Policy Integration

Implement:

- source classification;
- auth policy;
- batch limits;
- account-write separation;
- destructive-tool blocklist;
- approval gates;
- commercial-rights labels.

## WP-6 — Durable Orchestration

Implement:

- state machine;
- persistence;
- retries;
- crash recovery;
- idempotency;
- cancellation;
- external-job reconciliation.

## WP-7 — Artifact Intake

Implement:

- canonical storage;
- hash;
- MIME detection;
- provenance;
- duplicate detection;
- derived-parent linkage.

## WP-8 — Transcription / Research

Implement:

- subtitle-first path;
- local whisper fallback;
- normalized transcript;
- timestamp research notes;
- provider-router handoff.

## WP-9 — Knowledge Integration

Implement:

- opt-in ingestion;
- chunking;
- timestamp/page anchors;
- artifact backreferences;
- dedupe/update semantics.

## WP-10 — Browser Session Broker

Implement:

- opaque references;
- domain scope;
- expiry;
- revocation;
- approval;
- secure handoff.

## WP-11 — UI

Implement:

- Acquisition dashboard;
- plan preview;
- approval panel;
- sessions;
- adapter health;
- artifacts;
- retry/cancel controls.

## WP-12 — Observability / Audit

Implement metrics, logs, events and audit.

## WP-13 — Migration

Migrate Phase 20.24 with rollback.

---

# 42. Suggested Configuration

```yaml
acquisition:
  enabled: true

  adapters:
    omniget_mcp:
      enabled: true
      priority: 100
      endpoint: "http://127.0.0.1:<resolved-port>"
      token_secret_ref: "secret://omniget/mcp-token"

    omniget_cli:
      enabled: true
      priority: 50
      binary: "auto"

  policy:
    allow_authenticated_retrieval: true
    authenticated_requires_approval: true
    max_batch_items: 100
    max_job_bytes: 21474836480
    allow_private_network_targets: false

  processing:
    prefer_existing_subtitles: true
    prefer_local_transcription: true
    knowledge_ingest_default: false

  storage:
    raw_retention_days: 30
    derived_retention_days: 90
```

Do not hardcode OmniGet's local bridge port. Upstream documents a localhost port range; use configuration/discovery.

---

# 43. Secret References

Prefer the existing Pao-hubPro secret system.

Logical refs:

```text
secret://omniget/mcp-token
secret://browser/session-store
```

Do not spread the same credential across many `.env` files.

If a temporary local environment file is unavoidable, generate it with least privilege and restrictive permissions.

---

# 44. Health Check

Endpoint:

```text
GET /api/acquisition/adapters/health
```

Example:

```json
{
  "omniget_mcp": {
    "status": "healthy",
    "latencyMs": 12,
    "capabilityCount": 37,
    "version": "detected"
  },
  "omniget_cli": {
    "status": "healthy",
    "binary": "/path/to/omniget",
    "version": "detected"
  }
}
```

Counts shown in diagnostics may reflect discovery. Never use the documented count as a permanent compatibility assumption.

---

# 45. `/acquisition-doctor`

Add a diagnostic command that checks:

- OmniGet detected/running;
- MCP reachable;
- MCP auth valid;
- CLI present;
- output directory writable;
- disk space;
- FFmpeg/tool availability when discoverable;
- session broker health;
- artifact store health;
- knowledge store health;
- provider router health.

Return remediation steps without secrets.

---

# 46. Testing Strategy

## Unit

- URL normalization;
- request validation;
- domain/source classification;
- policy decisions;
- adapter selection;
- state transitions;
- error classification;
- path safety;
- filename sanitization;
- hashing;
- secret redaction.

## MCP Adapter

Mock:

- healthy connection;
- unauthorized token;
- tool missing;
- malformed response;
- timeout;
- reconnect;
- accepted job;
- progress;
- completion;
- cancellation.

## CLI Adapter

Test:

- normal exit;
- non-zero exit;
- cancellation;
- unicode/spaces in paths;
- malicious shell characters;
- timeout.

## Integration

At minimum:

1. public URL inspect;
2. public media acquisition;
3. audio-only acquisition;
4. existing subtitle path;
5. whisper fallback;
6. PDF extraction;
7. gallery acquisition;
8. pause/resume;
9. transient retry;
10. duplicate detection.

## Authenticated

Use dedicated test accounts/sessions:

- valid session;
- expired session;
- revoked session;
- wrong domain scope;
- approval required;
- no secret leakage.

## Security

Test:

- shell metacharacters;
- `../` traversal;
- redirect to private IP;
- localhost target;
- cloud metadata target;
- huge batch;
- disk quota;
- malicious filename;
- prompt injection in transcript/PDF;
- blocked system tool request;
- raw-cookie request.

## Recovery

Simulate:

- Pao-hubPro crash mid-job;
- OmniGet restart;
- network loss;
- rate limiting;
- disk full;
- partial output;
- repeated identical request.

---

# 47. End-to-End Scenarios

## A — Research a Video

```text
User request
→ inspect URL
→ metadata/subtitle probe
→ policy allow
→ use subtitles if sufficient
→ whisper only if needed
→ provider-router research
→ timestamped research note
→ optional knowledge ingest
```

Do not download the full video if the user's goal can be fulfilled safely from reliable text tracks.

## B — Authenticated Course Archive

```text
identify authenticated source
→ resolve scoped session ref
→ explicit approval
→ OmniGet acquisition
→ protected/DRM items reported and skipped
→ artifact intake
→ optional research/knowledge
```

No DRM bypass.

## C — Gallery Research

```text
classify source
→ policy/auth check
→ bounded gallery acquisition
→ artifact hashing
→ duplicate detection
→ optional research metadata
```

## D — Batch Research

```text
parse list
→ normalize/dedupe URLs
→ batch policy limit
→ durable parent job
→ bounded child concurrency
→ aggregate progress
→ consolidated research index
```

---

# 48. Acceptance Checklist

## Architecture

- [ ] Content Acquisition Gateway is canonical entry point.
- [ ] OmniGet is behind an adapter boundary.
- [ ] MCP is preferred when healthy/capable.
- [ ] CLI fallback works.
- [ ] Existing Pao-hubPro policy/queue/artifact/knowledge infrastructure is reused.

## Security

- [ ] Raw cookies never enter agent context.
- [ ] Secrets never enter logs/events.
- [ ] Session refs are opaque, scoped, expiring and revocable.
- [ ] Dangerous OmniGet tools are not auto-exposed.
- [ ] No shell interpolation of user input.
- [ ] Output paths are sandboxed.
- [ ] Private-network targets are blocked by default.
- [ ] Acquired text is tagged as untrusted external content.

## Jobs

- [ ] Durable state machine implemented.
- [ ] Pause/resume/cancel works where supported.
- [ ] Error taxonomy implemented.
- [ ] Retry policy implemented.
- [ ] Crash recovery verified.
- [ ] Idempotency/deduplication verified.

## Artifacts

- [ ] Every output has an artifact ID.
- [ ] SHA-256 recorded.
- [ ] Source provenance recorded.
- [ ] Auth usage recorded without secrets.
- [ ] Derived artifacts link to parents.
- [ ] Commercial rights default to `unknown`.

## Processing

- [ ] Subtitle-first transcription works.
- [ ] Local whisper fallback works.
- [ ] Research notes retain source anchors.
- [ ] Knowledge ingestion is optional/provenance-aware.

## UI

- [ ] New request form exists.
- [ ] Plan preview exists.
- [ ] Active/completed/failed jobs visible.
- [ ] Approval queue visible.
- [ ] Session refs can be revoked.
- [ ] Artifact outputs visible.
- [ ] Adapter health visible.

## Migration

- [ ] Phase 20.24 audited.
- [ ] Reusable code retained.
- [ ] Legacy calls route through gateway or are formally deprecated.
- [ ] Useful history preserved.
- [ ] Regression tests pass before removing legacy code.

## Quality

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Security tests pass.
- [ ] Recovery tests pass.
- [ ] Type check passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] No secrets committed.

---

# 49. Definition of Done

Phase 20.95 is DONE only when this high-level request works end-to-end:

```text
เอาลิงก์นี้มาศึกษา ถอดเสียง สรุป เก็บไฟล์ต้นฉบับ และเพิ่มเข้าคลังความรู้
```

Pao-hubPro must:

1. understand intent;
2. plan minimum necessary acquisition;
3. enforce policy;
4. obtain approval where required;
5. select MCP or CLI;
6. run durably;
7. recover from common failures;
8. generate traceable artifacts;
9. process/transcribe locally where appropriate;
10. route inference through the central provider layer;
11. create evidence-linked research output;
12. optionally ingest knowledge;
13. expose results in dashboard;
14. keep credentials outside agent context;
15. preserve complete audit trail.

---

# 50. Recommended Build Order

```text
1. Audit Phase 20.24 + existing Pao-hubPro infrastructure
2. Define canonical contracts
3. Build gateway skeleton
4. Integrate policy
5. Build OmniGet MCP adapter
6. Build CLI fallback
7. Add durable job orchestration
8. Add artifact intake/provenance
9. Add transcription
10. Add research pipeline
11. Add knowledge ingestion
12. Add session broker handoff
13. Add dashboard
14. Add observability/audit
15. Migrate Phase 20.24
16. Run E2E/security/recovery tests
17. Remove proven-dead legacy code
```

---

# 51. Recommended Repository Deliverables

```text
docs/phases/20.95/
├── PHASE_20.95.md
├── INTEGRATION_AUDIT.md
├── THREAT_MODEL.md
├── MIGRATION_20.24_TO_20.95.md
├── TEST_MATRIX.md
└── RUNBOOK.md

src/.../acquisition/
├── contracts/
├── gateway/
├── adapters/
│   ├── omniget-mcp/
│   └── omniget-cli/
├── policy/
├── jobs/
├── artifacts/
├── processing/
├── knowledge/
├── events/
└── tests/
```

Actual paths must follow the repository conventions discovered during audit.

---

# 52. Runbook Requirements

Document:

- OmniGet install/detection;
- MCP enablement;
- token registration through secret broker;
- MCP health verification;
- CLI fallback verification;
- token rotation/revocation;
- browser session revocation;
- stalled job recovery;
- safe cleanup of orphan temp files;
- failure inspection without exposing secrets;
- upstream OmniGet upgrade procedure;
- adapter compatibility verification.

---

# 53. Upgrade Compatibility

Upstream may change tool names/counts.

Therefore:

- discover tools dynamically;
- map through internal capability aliases;
- maintain an adapter compatibility table;
- detect version when possible;
- fail closed on unexpected critical changes;
- never auto-enable newly discovered high-risk tools.

Concept:

```ts
const aliases = {
  "media.download": ["download", "download_video", "queue_url"],
  "media.transcribe": ["transcribe", "whisper_transcribe"],
};
```

Populate actual aliases from real discovery/testing rather than assumptions.

---

# 54. Failure-Safe Behavior

If MCP fails:

```text
probe MCP
→ unavailable/insufficient
→ probe CLI
→ CLI sufficient: execute
→ otherwise: fail with actionable diagnostics
```

Do not silently move to an unrelated online downloader with different privacy/credential characteristics.

If authentication expires:

```text
pause
→ AUTH_REQUIRED
→ obtain approved refreshed session ref
→ resume same durable job
```

Do not hammer the source repeatedly with an invalid session.

---

# 55. Codex Implementation Rules

Before writing code, Codex must locate and understand:

```text
existing policy engine
existing queue/job runtime
existing artifact store/registry
existing knowledge pipeline
existing secret/session broker
existing MCP registry
existing browser bridge
existing provider router
Phase 20.24 OmniGet implementation
```

Then create an integration map:

```text
REUSE
EXTEND
ADAPT
MIGRATE
REMOVE_AFTER_CUTOVER
```

### Mandatory coding rules

- do not duplicate existing canonical services;
- do not embed OmniGet UI into Pao-hubPro core;
- do not copy GPL source into core by default;
- do not expose raw secrets;
- do not hardcode MCP tool counts;
- do not hardcode localhost bridge port if discovery/config exists;
- do not use shell string concatenation;
- do not auto-enable high-risk upstream tools;
- do not delete Phase 20.24 until migration tests pass;
- implement tests alongside each work package;
- keep rollback possible until cutover is verified.

---

# 56. Final Architecture Principle

The correct implementation is **not**:

```text
OmniGet embedded everywhere inside Pao-hubPro
```

The correct implementation is:

```text
Pao-hubPro Content Acquisition Control Plane
        │
        ├── policy
        ├── authorization
        ├── durable jobs
        ├── provenance
        ├── secrets
        ├── knowledge
        ├── provider routing
        └── audit
                │
                ▼
      replaceable worker adapters
                │
                ▼
             OmniGet
```

This architecture gives Pao-hubPro a reusable **policy-governed digital asset supply chain** rather than a one-off downloader integration.

---

# 57. Source References

Primary upstream:

- https://github.com/tonhowtf/omniget

Upstream areas used for this specification:

- README — roughly 1,800+ site support and native extractors;
- README — browser extension cookie/referer handoff;
- README — 158 tools / 25 categories;
- README — local MCP server and agent integration;
- README — `omniget-cli`;
- README — whisper.cpp / FFmpeg / aria2 / gallery-dl;
- README — local-first privacy model;
- README — GPL-3.0 license;
- README — no DRM/paywall bypass behavior.

---

# 58. Phase 20.95 Completion Statement

When complete, OmniGet is no longer treated as a standalone downloader inside the project.

It becomes a governed local execution backend that Pao-hubPro can use for:

```text
Acquire
→ Verify
→ Normalize
→ Process
→ Transcribe
→ Research
→ Index
→ Audit
```

while Pao-hubPro remains the single authority for policy, identity, secrets, model routing, provenance, knowledge and human approval.

---

**END OF PHASE 20.95 SPECIFICATION**
