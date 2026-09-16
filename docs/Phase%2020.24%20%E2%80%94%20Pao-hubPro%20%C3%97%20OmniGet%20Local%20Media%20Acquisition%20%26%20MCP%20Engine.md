# Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine

> **Project:** Pao-hubPro  
> **Phase:** 20.24  
> **Codename:** OmniGet Local Media Acquisition & MCP Engine  
> **Status:** Planned / Ready for Codex Implementation  
> **Primary Goal:** เพิ่ม Local Media Acquisition Engine ให้ Pao-hubPro สามารถรับ URL จาก Browser/Agent, ตรวจสอบข้อมูล, ดาวน์โหลด, ประมวลผลสื่อ, จัดคิวงาน และ expose ความสามารถผ่าน MCP อย่างปลอดภัย  
> **Reference Project:** https://github.com/tonhowtf/omniget  
> **Architecture Policy:** Integrate via Adapter / CLI / Local API / MCP boundary — **do not copy GPL source directly into Pao-hubPro**

---

# 1. Executive Summary

Phase 20.24 จะเพิ่มชั้น **Media Acquisition & Processing** ให้ Pao-hubPro โดยนำแนวคิดสถาปัตยกรรมจาก OmniGet มาปรับใช้กับระบบของเรา

แกนหลักของ Phase นี้คือ:

```text
Browser / URL / Codex / Agent
            │
            ▼
     Pao-hubPro Gateway
            │
            ├── URL Inspector
            ├── Policy Guard
            ├── Permission Engine
            └── Job Router
                    │
                    ▼
          Media Acquisition Layer
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     OmniGet      Native      External
     Adapter      Tools       Providers
        │
        ▼
     Job Queue
        │
        ├── Download
        ├── Metadata
        ├── Audio Extract
        ├── Subtitle
        ├── Transcribe
        ├── Convert
        ├── Thumbnail
        └── Upscale
        │
        ▼
   Artifact Registry
        │
        ▼
 Reviewer / AI Pipeline
```

Phase นี้ไม่ควรสร้างเป็น “โปรแกรมโหลดวิดีโออีกตัว”

เป้าหมายที่ถูกต้องคือสร้าง:

> **Pao Media Acquisition Engine**

ซึ่งเป็น infrastructure กลางที่ Pao-hubPro, Codex, Browser Extension และ AI Agents สามารถเรียกใช้ได้

---

# 2. Why This Phase Exists

Pao-hubPro มีเป้าหมายเป็น MCP / Agentic Workspace ที่สามารถเชื่อม:

- ChatGPT
- Codex
- Local PC
- Browser
- Files
- Commands
- Media
- AI Generation
- Adobe Stock workflow
- Reviewer Council
- Automation

แต่ระบบยังต้องการ ingestion layer ที่แข็งแรงสำหรับข้อมูลประเภท:

- URL
- Video
- Audio
- Images
- Gallery
- Subtitles
- Metadata
- Public web media
- Reference material

OmniGet มีแนวคิดที่เข้ากับ Pao-hubPro หลายส่วน:

1. Local-first
2. Browser Extension → Local Bridge
3. MCP Server
4. JSON tool interface
5. Download Queue
6. Resume / Retry
7. Media processing
8. CLI integration
9. yt-dlp / FFmpeg ecosystem
10. Local authentication token

Phase 20.24 จะนำแนวคิดเหล่านี้มาทำเป็น architecture ที่เข้ากับ Pao-hubPro โดยตรง

---

# 3. Core Design Principle

## 3.1 Adapter First

ห้ามผูก Pao-hubPro กับ OmniGet แบบ hard dependency

ให้ใช้:

```text
Pao-hubPro
   │
   ├── Media Provider Interface
   │
   ├── OmniGet Adapter
   │
   ├── yt-dlp Adapter
   │
   ├── FFmpeg Adapter
   │
   └── Future Providers
```

ตัวอย่าง interface:

```ts
interface MediaProvider {
  inspect(input: InspectRequest): Promise<InspectResult>;
  download(input: DownloadRequest): Promise<JobResult>;
  cancel(jobId: string): Promise<void>;
  getStatus(jobId: string): Promise<JobStatus>;
  healthCheck(): Promise<ProviderHealth>;
}
```

เหตุผล:

- ลด lock-in
- เปลี่ยน provider ได้
- ทดสอบง่าย
- รักษา license boundary
- สามารถ fallback ได้
- รองรับ Windows/Linux/VPS

---

# 4. GPL License Boundary

OmniGet ใช้ GPL-3.0

ดังนั้น Phase นี้ให้ถือ OmniGet เป็น:

```text
External Process
or
External Local Service
or
CLI Provider
or
MCP Provider
```

ไม่ควร:

```text
Pao-hubPro Source
    +
Copy OmniGet GPL Source Directly
```

ควร:

```text
Pao-hubPro
   │
   ▼
Provider Adapter
   │
   ▼
External OmniGet Installation
```

## Mandatory Rule

ห้าม Codex copy source code จาก OmniGet เข้ามาใน core repository โดยตรง เว้นแต่มีการ review license อย่างชัดเจนก่อน

---

# 5. Target Architecture

```text
┌─────────────────────────────────────────────┐
│                USER / AI AGENT              │
│ ChatGPT / Codex / Browser / Dashboard       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│            Pao-hubPro API Gateway           │
│                                             │
│ Auth                                        │
│ RBAC                                        │
│ Rate Limit                                  │
│ Audit Log                                   │
│ Policy Guard                                │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│           Media Acquisition Service         │
│                                             │
│ inspect                                     │
│ download                                    │
│ batch                                       │
│ metadata                                    │
│ subtitle                                    │
│ audio                                       │
│ transcribe                                  │
│ convert                                     │
│ thumbnail                                   │
│ upscale                                     │
└──────────────────────┬──────────────────────┘
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
         OmniGet     yt-dlp    Native
         Adapter     Adapter    Tools
             │
             ▼
┌─────────────────────────────────────────────┐
│               Queue Engine                  │
│ pending → running → retry → completed       │
│                       ↘ failed/cancelled     │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│              Media Processor                │
│ FFmpeg                                      │
│ Whisper                                     │
│ Metadata                                    │
│ Thumbnail                                   │
│ Upscale                                     │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│             Artifact Registry               │
│ source                                      │
│ hashes                                      │
│ metadata                                    │
│ license note                                │
│ local path                                  │
│ generated derivatives                       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ AI / Research / Adobe Stock Workflow        │
└─────────────────────────────────────────────┘
```

---

# 6. Phase Scope

## Included

- OmniGet adapter
- Generic Media Provider interface
- URL inspection
- Download jobs
- Batch jobs
- Queue
- Retry
- Resume
- Cancel
- Status tracking
- Media metadata
- FFmpeg processing
- Subtitle handling
- Audio extraction
- Transcription adapter
- Browser Local Bridge
- MCP tools
- Secrets Vault integration
- Permission system
- Audit log
- Dashboard panel
- Health checks
- Provider fallback
- Storage policy
- Artifact registry

## Not Included Yet

- DRM bypass
- Paywall bypass
- CAPTCHA bypass
- Account takeover
- Credential harvesting
- Automated publishing to third-party platforms
- Unrestricted arbitrary shell
- Silent cookie export
- Copyright circumvention

---

# 7. Proposed Repository Structure

```text
pao-hubpro/
│
├── apps/
│   ├── dashboard/
│   └── browser-extension/
│
├── services/
│   ├── gateway/
│   ├── media-acquisition/
│   ├── queue/
│   ├── artifact-registry/
│   └── local-bridge/
│
├── packages/
│   ├── media-core/
│   │   ├── provider.ts
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   └── errors.ts
│   │
│   ├── provider-omniget/
│   │   ├── adapter.ts
│   │   ├── cli.ts
│   │   ├── mapper.ts
│   │   └── health.ts
│   │
│   ├── provider-ytdlp/
│   ├── media-processing/
│   ├── security/
│   ├── secrets/
│   └── mcp-tools/
│
├── runtime/
│   ├── downloads/
│   ├── temp/
│   ├── cache/
│   └── artifacts/
│
└── docs/
    └── phases/
        └── phase-20.24-omniget.md
```

---

# 8. Media Provider Interface

สร้าง abstraction กลางก่อน integrate OmniGet

## Required Functions

```text
inspectUrl()
download()
downloadBatch()
getJob()
listJobs()
pauseJob()
resumeJob()
cancelJob()
retryJob()
healthCheck()
```

## Inspect Result

```json
{
  "provider": "omniget",
  "url": "https://example.com/video",
  "title": "Example",
  "mediaType": "video",
  "duration": 120,
  "thumbnail": null,
  "formats": [],
  "subtitles": [],
  "author": null,
  "sourcePlatform": "unknown",
  "requiresAuth": false,
  "supported": true
}
```

---

# 9. Job Queue

ใช้ state machine ที่ชัดเจน

```text
queued
  ↓
validating
  ↓
running
  ↓
processing
  ↓
completed
```

Failure path:

```text
running
  ↓
retry_wait
  ↓
running
```

Final states:

```text
completed
failed
cancelled
blocked
```

## Required Job Fields

```text
id
type
provider
source_url
status
priority
created_at
started_at
finished_at
retry_count
max_retries
progress
speed
eta
output_path
error_code
error_message
requested_by
policy_result
```

---

# 10. Retry Policy

ใช้ exponential backoff

ตัวอย่าง:

```text
Attempt 1 → 5 sec
Attempt 2 → 15 sec
Attempt 3 → 45 sec
Attempt 4 → 120 sec
```

แต่ต้องจำแนก error

## Retryable

- timeout
- temporary network failure
- HTTP 429
- temporary provider failure
- interrupted download

## Non-Retryable

- unsupported URL
- policy blocked
- invalid destination
- permission denied
- authentication rejected
- file blocked
- DRM protected

---

# 11. Browser Extension Integration

เพิ่ม context menu:

```text
Send to Pao-hubPro
Inspect Media
Download Media
Download Audio
Get Transcript
Add to Research Queue
```

Architecture:

```text
Chrome / Edge
     │
     ▼
Pao Browser Extension
     │
     ▼
http://127.0.0.1:<port>
     │
     ▼
Local Bridge
     │
     ▼
Pao-hubPro
```

---

# 12. Local Bridge Security

Local Bridge ต้องไม่เชื่อใจ localhost โดยอัตโนมัติ

ต้องมี:

- installation token
- session token
- origin validation
- request signature
- nonce
- timestamp
- replay protection
- rate limit
- tool allowlist
- audit log

Example:

```text
Extension
  │
  ├── extension_id
  ├── nonce
  ├── timestamp
  └── signed token
        │
        ▼
Local Bridge
        │
        ├── verify
        ├── authorize
        └── execute
```

---

# 13. Secrets Vault

สร้าง vault กลางสำหรับ:

```text
API keys
session tokens
browser pairing tokens
provider credentials
cookies
proxy credentials
```

## Rules

ห้าม:

- log secret plaintext
- return secret ผ่าน MCP
- expose cookie ผ่าน tool output
- เก็บ secret ใน git
- เก็บ secret ใน frontend localStorage ถ้าเลี่ยงได้

ควรใช้:

- OS credential store
- encrypted local vault
- environment variables
- secret references

เช่น:

```json
{
  "cookieRef": "vault://browser/youtube/default"
}
```

แทนการส่ง cookie plaintext

---

# 14. MCP Tool Layer

เพิ่ม MCP tools แบบ explicit schema

## Safe Tools

```text
media.inspect
media.list_jobs
media.get_job
media.get_metadata
media.get_transcript
media.list_artifacts
media.health
```

## Controlled Tools

```text
media.download
media.download_batch
media.extract_audio
media.transcribe
media.convert
media.upscale
media.cancel
media.retry
```

## Never Expose Directly

```text
shell.exec(arbitrary)
filesystem.write(anywhere)
browser.cookies.export
vault.dump
credential.read_plaintext
```

---

# 15. MCP Tool Example

```json
{
  "name": "media.download",
  "description": "Download media from a supported public URL",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string"
      },
      "preset": {
        "enum": [
          "best",
          "video",
          "audio",
          "reference"
        ]
      }
    },
    "required": [
      "url"
    ]
  }
}
```

Output:

```json
{
  "jobId": "job_01ABC",
  "status": "queued",
  "provider": "omniget"
}
```

---

# 16. Permission Model

ใช้ risk tier

## Tier 0 — Read Only

อัตโนมัติได้

```text
inspect
metadata
status
health
list
```

## Tier 1 — Local Processing

อนุญาตตาม policy

```text
transcribe
convert
thumbnail
upscale
```

## Tier 2 — Network Acquisition

ต้องผ่าน URL policy

```text
download
batch download
```

## Tier 3 — Sensitive

ต้อง confirm หรือ deny by default

```text
authenticated session access
cookie use
account-specific content
bulk acquisition
```

## Tier 4 — Forbidden

```text
credential export
DRM bypass
arbitrary destructive commands
secret dumping
```

---

# 17. URL Policy Guard

ก่อนเริ่มงานทุกครั้ง:

```text
URL
 ↓
normalize
 ↓
scheme check
 ↓
domain check
 ↓
private IP check
 ↓
SSRF protection
 ↓
policy classification
 ↓
provider selection
```

Block:

```text
file://
ftp://   unless explicitly supported
localhost targets from remote requests
127.0.0.0/8
169.254.0.0/16
RFC1918 internal IP
cloud metadata endpoints
```

ยกเว้น internal calls ที่กำหนดไว้ใน allowlist

---

# 18. Provider Selection

Router:

```text
Request
  │
  ▼
Media Router
  │
  ├── OmniGet healthy?
  │       └── Yes → OmniGet
  │
  ├── yt-dlp available?
  │       └── Yes → yt-dlp
  │
  └── Fail → Unsupported
```

Provider priority config:

```yaml
providers:
  media:
    - omniget
    - ytdlp
    - native
```

---

# 19. OmniGet Adapter

รองรับ 3 integration modes

## Mode A — CLI

เหมาะกับ MVP

```text
Pao-hubPro
  ↓
spawn
  ↓
omniget CLI
```

ข้อดี:

- implement เร็ว
- isolation ดี
- debug ง่าย

---

## Mode B — Local API

ถ้า OmniGet expose local endpoint ที่เหมาะสม

```text
Pao-hubPro
  ↓
localhost API
  ↓
OmniGet
```

---

## Mode C — MCP-to-MCP

ใช้เมื่อเหมาะสม

```text
Pao-hubPro MCP
  ↓
Provider Client
  ↓
OmniGet MCP
```

แต่ไม่ควร expose nested tools โดยไม่มี policy layer

---

# 20. Process Isolation

External tools ทุกตัวต้องผ่าน Process Runner

```text
Process Runner
│
├── allowlisted executable
├── argument validation
├── cwd restriction
├── timeout
├── stdout limit
├── stderr limit
├── environment allowlist
└── kill tree
```

ห้ามใช้:

```ts
exec(userInput)
```

ให้ใช้:

```ts
spawn(binary, validatedArgs, options)
```

---

# 21. Media Processing Pipeline

ตัวอย่าง video workflow:

```text
Downloaded Video
       │
       ├── ffprobe
       │
       ├── metadata
       │
       ├── thumbnail
       │
       ├── audio extraction
       │
       ├── transcript
       │
       └── proxy preview
```

---

# 22. FFmpeg Tools

เพิ่ม tool abstraction:

```text
media.ffprobe
media.convert
media.extract_audio
media.thumbnail
media.normalize_audio
media.make_proxy
```

อย่า expose raw FFmpeg arguments จาก AI โดยตรง

ใช้ preset เช่น:

```text
web_preview
audio_wav
audio_mp3
thumbnail_1080
video_h264
video_h265
```

---

# 23. Transcription Layer

สร้าง provider interface

```text
TranscriptionProvider
│
├── whisper.cpp
├── local whisper
├── future API
└── future GPU worker
```

Output:

```json
{
  "language": "th",
  "duration": 120,
  "segments": [],
  "text": "..."
}
```

---

# 24. Artifact Registry

ทุก output ต้องลง registry

ตัวอย่าง:

```json
{
  "artifactId": "art_01ABC",
  "jobId": "job_01ABC",
  "type": "video",
  "sourceUrl": "https://...",
  "localPath": "runtime/artifacts/...",
  "sha256": "...",
  "mimeType": "video/mp4",
  "size": 1234567,
  "createdAt": "...",
  "derivedFrom": null
}
```

---

# 25. Provenance

เก็บ provenance สำหรับ research workflow

```text
source_url
source_platform
acquisition_time
provider
original_filename
sha256
derived_files
processing_steps
notes
```

ห้ามใช้ provenance เป็นข้ออ้างเรื่องสิทธิ์ใช้งาน

มันเป็นเพียง traceability

---

# 26. Adobe Stock Integration Boundary

Phase นี้ทำหน้าที่:

```text
Reference Acquisition
        ↓
Analysis
        ↓
Trend / Concept Research
        ↓
Generation Planning
```

ไม่ให้ Phase นี้ตีความว่า:

```text
download someone else's work
        ↓
repackage
        ↓
upload Adobe Stock
```

ต้องคง separation:

```text
REFERENCE ASSET
≠
SALEABLE ASSET
```

---

# 27. Research Mode

เพิ่ม preset:

```text
research_reference
```

ทำสิ่งต่อไปนี้:

```text
inspect
download low-resolution reference when allowed
metadata
thumbnail
transcript
AI summary
concept extraction
```

และ mark:

```json
{
  "usageClass": "research_reference",
  "exportToStock": false
}
```

---

# 28. Storage Layout

```text
runtime/
└── media/
    ├── incoming/
    ├── jobs/
    ├── cache/
    ├── temp/
    ├── references/
    ├── transcripts/
    ├── thumbnails/
    └── processed/
```

---

# 29. File Naming

ใช้ deterministic safe names

```text
{date}_{platform}_{jobid}_{slug}.{ext}
```

ตัวอย่าง:

```text
2026-09-12_youtube_job01_example-video.mp4
```

sanitize:

- path traversal
- control chars
- reserved Windows names
- excessive length

---

# 30. Database Tables

ขั้นต่ำ:

```text
media_jobs
media_artifacts
media_sources
media_events
media_provider_health
media_permissions
media_presets
secret_references
```

## media_jobs

```sql
id
type
provider
source_url
status
priority
progress
retry_count
max_retries
requested_by
created_at
started_at
finished_at
error_code
error_message
```

---

# 31. Event System

ทุก job ส่ง events:

```text
job.created
job.validated
job.started
job.progress
job.retrying
job.processing
job.completed
job.failed
job.cancelled
artifact.created
provider.offline
provider.recovered
```

สามารถต่อ:

```text
WebSocket
SSE
Dashboard
Discord webhook
Telegram
future automation
```

---

# 32. Dashboard UI

เพิ่มเมนู:

```text
Media
├── Acquire
├── Queue
├── Library
├── Transcripts
├── Providers
└── Settings
```

## Acquire Page

ช่อง:

```text
Paste URL
[ Inspect ]

Source:
Title:
Type:
Duration:
Provider:

Preset:
[ Best ]
[ Audio ]
[ Reference ]
[ Transcript ]

[ Add to Queue ]
```

---

# 33. Queue Dashboard

แสดง:

```text
Status
Progress
Speed
ETA
Provider
Retry
Output
```

Actions:

```text
Pause
Resume
Cancel
Retry
Open Folder
Inspect
```

---

# 34. Provider Dashboard

แสดง:

```text
OmniGet      Healthy
yt-dlp       Healthy
FFmpeg       Healthy
Whisper      Offline
Upscaler     Optional
```

พร้อม:

```text
version
path
last check
latency
capabilities
```

---

# 35. Health Check

สร้าง:

```text
GET /health/media
```

Response:

```json
{
  "status": "degraded",
  "providers": {
    "omniget": "healthy",
    "ytdlp": "healthy",
    "ffmpeg": "healthy",
    "whisper": "offline"
  }
}
```

---

# 36. Audit Logging

Log:

```text
who
tool
action
url domain
job id
permission result
provider
timestamp
result
```

อย่า log:

```text
cookies
API keys
authorization headers
secret values
```

---

# 37. Observability

Metrics:

```text
jobs_total
jobs_running
jobs_failed
downloads_bytes_total
download_duration
provider_failures
rate_limit_events
retry_count
queue_depth
processing_duration
```

---

# 38. Rate Limit Handling

ต่อยอดแนวคิด adaptive queue

```text
HTTP 429
  ↓
detect
  ↓
lower concurrency
  ↓
backoff
  ↓
retry
```

เก็บ domain-level limiter:

```text
youtube.com
instagram.com
tiktok.com
etc.
```

แต่ห้ามออกแบบเพื่อหลบ anti-abuse protection

เป้าหมายคือ respectful throttling

---

# 39. Concurrency

Config:

```yaml
media:
  queue:
    max_global_jobs: 3
    max_per_domain: 1
    max_processing_jobs: 2
```

Dashboard สามารถแก้ค่าผ่าน admin settings

---

# 40. Proxy Support

ทำเป็น optional provider setting

```text
proxyRef: vault://proxy/default
```

ห้าม hardcode proxy credentials

ต้องมี:

```text
disabled by default
per-provider policy
audit trail
```

และห้ามใช้เพื่อ bypass platform enforcement

---

# 41. Browser Cookie Handling

ใช้เฉพาะกรณีที่ผู้ใช้ตั้งใจอนุญาต

Flow:

```text
User enables authenticated acquisition
        ↓
Browser Extension
        ↓
Local encrypted session reference
        ↓
Provider receives temporary access
        ↓
Operation completes
```

ไม่ให้ MCP เห็น cookie plaintext

---

# 42. Threat Model

ต้องป้องกันอย่างน้อย:

- SSRF
- command injection
- path traversal
- secret leakage
- malicious filename
- poisoned metadata
- oversized output
- zip bomb
- local port abuse
- replay attacks
- cross-origin local requests
- arbitrary binary execution
- queue flooding

---

# 43. Safe Defaults

Default:

```text
public URLs only
3 concurrent jobs max
restricted output directory
no cookies
no proxy
no arbitrary shell
no automatic publishing
no destructive operations
```

---

# 44. Feature Flags

```yaml
features:
  omniget_provider: true
  authenticated_media: false
  proxy: false
  transcription: true
  upscale: false
  browser_bridge: true
```

---

# 45. Configuration Example

```yaml
media:
  enabled: true

  storage_root: "./runtime/media"

  providers:
    preferred:
      - omniget
      - ytdlp

  queue:
    max_global_jobs: 3
    max_per_domain: 1
    retries: 3

  security:
    public_urls_only: true
    allow_authenticated_sessions: false
    block_private_networks: true
```

---

# 46. API Endpoints

```text
POST /api/media/inspect
POST /api/media/jobs
POST /api/media/jobs/batch

GET  /api/media/jobs
GET  /api/media/jobs/:id

POST /api/media/jobs/:id/pause
POST /api/media/jobs/:id/resume
POST /api/media/jobs/:id/cancel
POST /api/media/jobs/:id/retry

GET  /api/media/artifacts
GET  /api/media/providers
GET  /api/media/health
```

---

# 47. Validation

ใช้ schema validation ทุก boundary

Recommended:

```text
Zod
JSON Schema
Pydantic
```

ขึ้นกับ stack ปัจจุบัน

ทุก MCP tool ต้องใช้ schema เดียวกับ API ถ้าเป็นไปได้

---

# 48. Error Codes

มาตรฐาน:

```text
MEDIA_UNSUPPORTED_URL
MEDIA_PROVIDER_OFFLINE
MEDIA_PROVIDER_ERROR
MEDIA_AUTH_REQUIRED
MEDIA_PERMISSION_DENIED
MEDIA_POLICY_BLOCKED
MEDIA_RATE_LIMITED
MEDIA_TIMEOUT
MEDIA_DOWNLOAD_FAILED
MEDIA_PROCESSING_FAILED
MEDIA_STORAGE_FAILED
MEDIA_CANCELLED
```

---

# 49. Test Matrix

## Unit Tests

- schema validation
- URL normalization
- provider routing
- filename sanitization
- retry logic
- permission logic
- state transitions

## Integration Tests

- OmniGet available
- OmniGet unavailable
- yt-dlp fallback
- FFmpeg missing
- download interrupted
- retry
- cancellation
- invalid URL
- private IP blocked

## Security Tests

- command injection
- `../../`
- localhost SSRF
- metadata endpoint SSRF
- forged local bridge request
- replay token
- secret leakage
- oversized output

---

# 50. Acceptance Criteria

Phase 20.24 ถือว่าเสร็จเมื่อ:

- [ ] มี Media Provider abstraction
- [ ] มี OmniGet adapter
- [ ] มี fallback provider อย่างน้อย 1 ตัว
- [ ] inspect URL ได้
- [ ] download job ได้
- [ ] batch queue ได้
- [ ] cancel / retry ได้
- [ ] progress แสดงใน Dashboard
- [ ] artifact registry ทำงาน
- [ ] FFmpeg processing ใช้งานได้
- [ ] transcription adapter พร้อม
- [ ] MCP tools ใช้งานได้
- [ ] Browser Extension ส่ง URL เข้า Local Bridge ได้
- [ ] Local Bridge มี pairing/auth
- [ ] private network SSRF ถูก block
- [ ] arbitrary shell ไม่ถูก expose
- [ ] secrets ไม่ปรากฏใน logs
- [ ] health endpoint ทำงาน
- [ ] audit log ทำงาน
- [ ] test suite ผ่าน
- [ ] README / architecture docs อัปเดต

---

# 51. Implementation Order

## Step 1

สร้าง:

```text
packages/media-core
```

พร้อม types + schemas + provider interface

## Step 2

สร้าง:

```text
provider-omniget
```

เริ่มจาก CLI adapter

## Step 3

สร้าง Queue Engine

## Step 4

สร้าง Artifact Registry

## Step 5

สร้าง REST API

## Step 6

สร้าง MCP tools

## Step 7

ต่อ Dashboard

## Step 8

ต่อ Browser Extension

## Step 9

เพิ่ม Secrets Vault + authenticated mode

## Step 10

ทำ security hardening + test suite

---

# 52. MVP

MVP Phase 20.24 ต้องทำได้:

```text
Paste URL
    ↓
Inspect
    ↓
Queue
    ↓
Download
    ↓
Progress
    ↓
Completed
    ↓
Open Artifact
```

และ Codex สามารถเรียก:

```text
media.inspect
media.download
media.get_job
media.list_artifacts
```

---

# 53. Phase 20.24.1 Candidate

หลัง MVP:

> **Pao-hubPro × Browser Media Capture**

เพิ่ม:

- detect media on page
- extension toolbar
- one-click capture
- context menu
- research queue
- authenticated reference acquisition

---

# 54. Phase 20.24.2 Candidate

> **Pao Media Intelligence Pipeline**

```text
Acquire
 ↓
Transcribe
 ↓
Scene Detect
 ↓
Metadata
 ↓
LLM Analyze
 ↓
Trend Tags
 ↓
Concept Ideas
```

ใช้กับ Adobe Stock research

---

# 55. Phase 20.24.3 Candidate

> **Distributed Media Worker**

แยก processing ไป:

```text
Local PC
VPS
Runpod GPU
Worker Node
```

ใช้ job protocol เดียวกัน

---

# 56. Definition of Done

```text
Agent
  │
  ▼
MCP
  │
  ▼
Pao Policy Layer
  │
  ▼
Media Provider
  │
  ▼
OmniGet / yt-dlp
  │
  ▼
Queue
  │
  ▼
Media Processor
  │
  ▼
Artifact Registry
  │
  ▼
Dashboard / AI Workflow
```

ต้องทำงานครบ end-to-end

และต้อง:

```text
observable
auditable
permissioned
recoverable
provider-agnostic
safe by default
```

---

# 57. One-Shot Codex Implementation Prompt

คัดลอกข้อความด้านล่างไปใช้กับ Codex ได้ทันที

```text
You are working inside the existing Pao-hubPro repository.

Implement Phase 20.24:

"Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine"

GOAL
Build a secure, provider-agnostic local media acquisition subsystem inspired by the architecture of OmniGet.

IMPORTANT LICENSE RULE
OmniGet is GPL-3.0. Do NOT copy OmniGet source code into the Pao-hubPro core repository.
Treat OmniGet as an external provider/process/service and integrate through an adapter boundary.

DO NOT rewrite unrelated parts of Pao-hubPro.
First inspect the existing repository, architecture, package manager, runtime, API framework, MCP implementation, dashboard conventions, database layer, authentication, logging and test infrastructure.
Reuse existing conventions whenever possible.

==================================================
CORE ARCHITECTURE
==================================================

Implement:

User / Browser / Codex
        ->
Pao-hubPro Gateway
        ->
Policy + Permission Layer
        ->
Media Acquisition Service
        ->
Media Provider Interface
        ->
OmniGet Adapter / fallback provider
        ->
Job Queue
        ->
Media Processing
        ->
Artifact Registry

==================================================
1. MEDIA CORE
==================================================

Create a reusable media-core package/module.

Required concepts:

MediaProvider
InspectRequest
InspectResult
DownloadRequest
JobResult
JobStatus
ProviderHealth
MediaArtifact
MediaSource
MediaPreset

Required provider methods:

inspect()
download()
getStatus()
cancel()
healthCheck()

Add provider routing and fallback support.

Preferred provider order:

1. OmniGet
2. yt-dlp fallback
3. native provider where appropriate

==================================================
2. OMNIGET ADAPTER
==================================================

Create an OmniGet provider adapter.

Start with the safest practical integration mode:

CLI / external process adapter.

Do not execute raw user-generated shell strings.

Use spawn-style execution with:

- executable allowlist
- validated arguments
- restricted cwd
- timeout
- bounded stdout/stderr
- environment allowlist
- child process tree termination

Detect whether OmniGet is installed.

Expose provider health.

Do not hard fail the whole media subsystem if OmniGet is unavailable.

==================================================
3. QUEUE ENGINE
==================================================

Implement job states:

queued
validating
running
processing
retry_wait
completed
failed
cancelled
blocked

Support:

- queue
- retry
- exponential backoff
- cancel
- status
- progress
- max concurrency
- per-domain concurrency

Use safe default limits.

==================================================
4. URL POLICY GUARD
==================================================

Normalize and validate every URL before acquisition.

Protect against SSRF.

Block by default:

- file://
- localhost
- 127.0.0.0/8
- RFC1918 private networks
- link-local addresses
- cloud metadata endpoints
- malformed schemes

Authenticated/internal exceptions must require explicit allowlist configuration.

==================================================
5. ARTIFACT REGISTRY
==================================================

Store every output as an artifact.

Fields should include:

artifactId
jobId
type
sourceUrl
sourcePlatform
localPath
sha256
mimeType
size
createdAt
derivedFrom
usageClass

Support:

usageClass = research_reference

Research references must default to:

exportToStock = false

==================================================
6. MEDIA PROCESSING
==================================================

Create safe processing abstractions for:

ffprobe
convert
extract_audio
thumbnail
normalize_audio
proxy_preview

Do not expose unrestricted raw FFmpeg args to MCP/AI.

Use named presets.

Design transcription provider abstraction supporting:

whisper.cpp
future local Whisper
future GPU worker

==================================================
7. MCP TOOLS
==================================================

Expose explicit schema-based MCP tools.

Read-safe:

media.inspect
media.list_jobs
media.get_job
media.get_metadata
media.get_transcript
media.list_artifacts
media.health

Controlled action tools:

media.download
media.download_batch
media.extract_audio
media.transcribe
media.convert
media.cancel
media.retry

Do NOT expose:

arbitrary shell
arbitrary filesystem writes
cookie export
vault dump
plaintext credential reads

Reuse the repository's existing MCP conventions.

==================================================
8. PERMISSION MODEL
==================================================

Implement risk tiers.

Tier 0:
read/inspect/status

Tier 1:
local processing

Tier 2:
network acquisition

Tier 3:
authenticated session usage / bulk acquisition

Tier 4:
forbidden dangerous capabilities

Integrate with existing Pao-hubPro auth/RBAC/policy infrastructure where available.

==================================================
9. LOCAL BRIDGE
==================================================

Add or extend the Pao-hubPro local bridge for browser extension communication.

Required controls:

installation token
session token
origin validation
nonce
timestamp
replay protection
rate limiting
tool allowlist
audit logging

Never trust localhost alone.

==================================================
10. BROWSER EXTENSION
==================================================

If the repository already has the Pao-hubPro Chrome extension, extend it.

Add:

Send to Pao-hubPro
Inspect Media
Download Media
Download Audio
Get Transcript
Add to Research Queue

If the extension does not yet exist in the current repository, create only the minimal bridge-compatible extension scaffold and document integration.

==================================================
11. SECRETS
==================================================

Use secret references instead of plaintext secret propagation.

Never log:

cookies
authorization headers
API keys
proxy passwords
session tokens

Authenticated acquisition must be disabled by default.

Do not expose cookies through MCP.

==================================================
12. STORAGE
==================================================

Use a restricted media root.

Suggested logical layout:

runtime/media/incoming
runtime/media/jobs
runtime/media/cache
runtime/media/temp
runtime/media/references
runtime/media/transcripts
runtime/media/thumbnails
runtime/media/processed

Prevent path traversal.

Use safe filenames.

==================================================
13. API
==================================================

Add equivalent endpoints using the current Pao-hubPro API framework:

POST /api/media/inspect
POST /api/media/jobs
POST /api/media/jobs/batch

GET /api/media/jobs
GET /api/media/jobs/:id

POST /api/media/jobs/:id/pause
POST /api/media/jobs/:id/resume
POST /api/media/jobs/:id/cancel
POST /api/media/jobs/:id/retry

GET /api/media/artifacts
GET /api/media/providers
GET /api/media/health

Adapt exact routes to existing project conventions if needed.

==================================================
14. DASHBOARD
==================================================

Add Media navigation:

Media
- Acquire
- Queue
- Library
- Transcripts
- Providers
- Settings

Acquire view:

URL input
Inspect button
Source info
Title
Media type
Duration
Provider
Preset selector
Add to Queue

Queue view:

status
progress
speed
ETA
provider
retry count
output

Actions:

pause
resume
cancel
retry
inspect
open artifact

Provider health view:

provider
version
path
status
last check
capabilities

Follow existing Pao-hubPro UI design system.

==================================================
15. DATABASE
==================================================

Add required migrations using the repository's existing DB tooling.

Logical tables:

media_jobs
media_artifacts
media_sources
media_events
media_provider_health
media_permissions
media_presets
secret_references

Do not create a parallel DB system if the project already has one.

==================================================
16. EVENTS
==================================================

Emit:

job.created
job.validated
job.started
job.progress
job.retrying
job.processing
job.completed
job.failed
job.cancelled
artifact.created
provider.offline
provider.recovered

Integrate with existing SSE/WebSocket/event infrastructure if available.

==================================================
17. AUDIT
==================================================

Audit:

actor
tool
action
domain
job id
permission decision
provider
timestamp
result

Redact secrets.

==================================================
18. OBSERVABILITY
==================================================

Add metrics or equivalent structured telemetry:

jobs_total
jobs_running
jobs_failed
downloads_bytes_total
download_duration
provider_failures
rate_limit_events
retry_count
queue_depth
processing_duration

Reuse existing telemetry if present.

==================================================
19. RATE LIMITING
==================================================

Handle HTTP 429 and temporary provider failures respectfully.

Reduce concurrency and back off.

Do not implement mechanisms intended to bypass anti-abuse enforcement.

==================================================
20. SECURITY TESTS
==================================================

Add tests covering:

command injection
path traversal
SSRF
localhost access
cloud metadata address access
malicious filename
replay request
forged local bridge origin
secret leakage
queue flooding
oversized stdout/stderr
provider timeout

==================================================
21. FEATURE FLAGS
==================================================

Support configuration equivalent to:

omniget_provider = enabled
authenticated_media = disabled
proxy = disabled
transcription = enabled
upscale = disabled
browser_bridge = enabled

Use the existing config system.

==================================================
22. SAFE DEFAULTS
==================================================

Defaults:

public URLs only
max 3 concurrent acquisition jobs
restricted media directory
no cookies
no proxy
no arbitrary shell
no automatic publishing
no destructive operations

==================================================
23. ADOBE STOCK SAFETY BOUNDARY
==================================================

The media acquisition subsystem may support research/reference workflows.

It must never assume downloaded third-party media is licensable or uploadable.

Research material must be marked separately from generated/saleable assets.

REFERENCE ASSET != SALEABLE ASSET

==================================================
24. TESTING
==================================================

Run:

lint
typecheck
unit tests
integration tests
security tests
build

Fix errors introduced by this Phase.

Do not suppress failures blindly.

==================================================
25. DOCUMENTATION
==================================================

Add:

architecture documentation
provider documentation
security model
OmniGet installation/configuration guide
MCP tool reference
browser bridge setup
troubleshooting
license boundary note
Adobe Stock research usage note

==================================================
26. FINAL REPORT
==================================================

When complete, output:

1. Repository inspection summary
2. Architecture decisions
3. Files created
4. Files modified
5. Database migrations
6. New API endpoints
7. MCP tools
8. Browser extension changes
9. Security controls
10. Tests run
11. Test/build results
12. Remaining TODOs
13. Manual setup required
14. OmniGet installation requirements
15. Exact commands to start and test Phase 20.24

Do not stop after only scaffolding.

Implement the largest coherent working slice possible while keeping the current repository functional.
```

---

# 58. Recommended Codex Strategy

ให้ Codex ทำตามลำดับ:

```text
Inspect Repository
      ↓
Map Existing Architecture
      ↓
Create Media Core
      ↓
Provider Adapter
      ↓
Queue
      ↓
Artifact Registry
      ↓
API
      ↓
MCP
      ↓
Dashboard
      ↓
Browser Bridge
      ↓
Security
      ↓
Tests
```

อย่าเริ่มจาก UI ก่อน

---

# 59. Recommended First Production Target

เป้าหมายแรก:

```text
Codex
 ↓
media.inspect(URL)
 ↓
Pao-hubPro
 ↓
OmniGet Adapter
 ↓
Result
```

ต่อด้วย:

```text
media.download(URL)
 ↓
Queue
 ↓
OmniGet
 ↓
Artifact
 ↓
Dashboard
```

ถ้า 2 flow นี้เสถียร Phase 20.24 จะมีฐานที่แข็งแรงมาก

---

# 60. Final Architecture Vision

Phase 20.24 จะทำให้ Pao-hubPro เปลี่ยนจาก:

```text
AI Agent + Local Tools
```

เป็น:

```text
AI Agent
   │
   ▼
Pao-hubPro
   │
   ├── Browser
   ├── Files
   ├── Commands
   ├── Coding
   ├── Media Acquisition
   ├── Media Processing
   ├── AI Generation
   ├── Reviewer Council
   └── Automation
```

และ Media Acquisition จะกลายเป็น infrastructure กลางสำหรับ:

```text
Research
Adobe Stock
Video Factory
Image Factory
Browser Agent
Trend Analysis
Dataset Preparation
Transcription
Content Intelligence
```

---

# Phase 20.24 Status

```text
DESIGN: READY
IMPLEMENTATION: READY FOR CODEX
SECURITY MODEL: DEFINED
MCP MODEL: DEFINED
OMNIGET BOUNDARY: DEFINED
ADOBE STOCK BOUNDARY: DEFINED
```

**Next Action:** Run the One-Shot Codex Implementation Prompt inside the current Pao-hubPro repository.
