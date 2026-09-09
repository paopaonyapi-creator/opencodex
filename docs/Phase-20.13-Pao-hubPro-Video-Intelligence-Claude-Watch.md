# Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch

> **Project:** Pao-hubPro  
> **Phase:** 20.13  
> **Codename:** Video Intelligence / Watch Engine  
> **Status:** Implementation Specification  
> **Primary Goal:** ทำให้ Pao-hubPro “ดู ฟัง อ่าน และวิเคราะห์วิดีโอ” ได้แบบ Agentic  
> **Upstream Inspiration:** `taoufik123-collab/claude-watch`  
> **Repository:** https://github.com/taoufik123-collab/claude-watch  
> **Upstream release baseline:** v0.2.0 — 2026-05-25  
> **Target Environment:** Windows / Linux / VPS / Local PC / Codex / MCP  
> **Primary Owner:** Pao  
> **Language:** Thai-first, English-compatible

---

# 1. Executive Summary

Phase 20.13 จะเพิ่ม **Video Intelligence Layer** ให้ Pao-hubPro โดยนำแนวคิดหลักจาก `claude-watch` มาประยุกต์ ได้แก่:

- ดาวน์โหลดหรือรับไฟล์วิดีโอ
- ตรวจ Scene Change
- ดึง Hero Frames
- วิเคราะห์ 0–10 วินาทีแรกแบบ Hook Microscope
- ดึง Transcript จาก Caption
- fallback ไป Whisper เมื่อไม่มี Caption
- วิเคราะห์จังหวะตัดต่อ
- สร้าง Structured Report
- ให้ AI วิเคราะห์ Frame + Transcript + Metadata ร่วมกัน

แต่ Pao-hubPro จะยกระดับจาก “Skill สำหรับดูวิดีโอ” ไปเป็น **Video Intelligence Service** ที่เรียกได้จาก:

- MCP
- Codex
- Web Dashboard
- Automation
- Adobe Stock Workflow
- Pao AI Video Factory
- Browser Agent
- Reviewer Council
- Local Knowledge Store

เป้าหมายคือให้ Pao-hubPro มี “ตา + หู” สำหรับวิดีโอ และสามารถนำผลไปทำงานต่ออัตโนมัติได้

---

# 2. Why This Phase Exists

ก่อน Phase 20.13 ระบบของ Pao-hubPro มีความสามารถด้าน:

- Browser Automation
- MCP tools
- File tools
- Web App / Dashboard
- AI image/video generation
- Adobe Stock workflow
- Video scraping / acquisition
- AI Reviewer Council

แต่ยังขาดชั้นที่ทำหน้าที่:

> “เข้าใจเนื้อหาภายในวิดีโออย่างเป็นระบบ”

Phase 20.13 จึงเติมช่องว่างระหว่าง:

```text
Video Acquisition
        ↓
Video Understanding
        ↓
Decision / QC / Automation
```

---

# 3. Relationship with Phase 20.10

Phase 20.10 และ Phase 20.13 ต้องไม่ซ้ำหน้าที่กัน

## Phase 20.10

เน้น:

```text
Video URL
   ↓
Scraping
   ↓
Metadata
   ↓
Download
   ↓
Local Media
```

## Phase 20.13

รับผลต่อจาก Phase 20.10:

```text
Local Media / URL
      ↓
Scene Analysis
      ↓
Transcript
      ↓
Hook Analysis
      ↓
Pacing
      ↓
Visual Understanding
      ↓
Structured Intelligence
```

## Combined Flow

```text
Phase 20.10
Video Scraping APIs
      ↓
Acquire Video
      ↓
Phase 20.13
Video Intelligence
      ↓
AI Reviewer
      ↓
Knowledge Store / Adobe Stock / Video Factory
```

---

# 4. Upstream Baseline

Phase 20.13 อ้างอิงแนวทางจาก `claude-watch` v0.2.0

ความสามารถหลักของ upstream ที่ต้องรักษาแนวคิดไว้:

1. Scene-change frame extraction
2. Hero-frame selection
3. Hook microscope 0–10 seconds
4. Word-level Whisper timestamps
5. Editorial pacing metrics
6. Structured `report.md`
7. Native captions first
8. Whisper fallback
9. Optional knowledge ingestion
10. Focused `--start` / `--end`
11. Frame-budget control
12. Secure subprocess argument handling

> ห้าม copy architecture แบบผูกกับ Claude Code หรือ Obsidian อย่างเดียว  
> Pao-hubPro ต้อง abstract ให้เป็น provider-neutral service

---

# 5. Primary Architecture

```text
                   ┌───────────────────────────┐
                   │       Pao-hubPro          │
                   └─────────────┬─────────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               │                 │                 │
          MCP Gateway       Web Dashboard      Codex Agent
               │                 │                 │
               └─────────────────┼─────────────────┘
                                 │
                      Video Intelligence API
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
     Acquisition             Media Probe           Cache Layer
          │                      │                      │
       yt-dlp                ffprobe               SQLite/Files
          │
          ▼
  ┌─────────────────────────────────────────────────────┐
  │                  Watch Engine                       │
  ├─────────────────────────────────────────────────────┤
  │ Scene Detector                                     │
  │ Frame Extractor                                    │
  │ Hook Microscope                                    │
  │ Transcript Engine                                  │
  │ Whisper Provider                                   │
  │ Pacing Analyzer                                    │
  │ Visual Reviewer                                    │
  │ Report Builder                                     │
  └──────────────────────────┬──────────────────────────┘
                             │
                             ▼
                    AI Analysis Router
           ┌─────────────────┼──────────────────┐
           │                 │                  │
       OpenAI/ChatGPT     Local Model        Claude
           │                 │                  │
           └─────────────────┼──────────────────┘
                             │
                       Reviewer Council
                             │
                             ▼
                   Structured Video Report
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
  Adobe Stock QC       Knowledge Store      Video Factory
```

---

# 6. Design Principles

## 6.1 Provider Neutral

ระบบต้องไม่ผูกกับ Claude เพียงตัวเดียว

รองรับอย่างน้อย:

```text
OpenAI
Claude
Local VLM
Local LLM
Groq Whisper
OpenAI Whisper
Local Whisper
```

---

## 6.2 Local-First

ไฟล์ Local ต้องสามารถวิเคราะห์ได้โดยไม่ส่งข้อมูลออก Cloud

Target:

```env
VIDEO_INTELLIGENCE_LOCAL_ONLY=true
```

เมื่อเปิด:

```text
Local Video
   ↓
Local ffmpeg
   ↓
Local faster-whisper
   ↓
Local VLM
   ↓
Local Report
```

ห้ามเรียก External API เว้นแต่ผู้ใช้ override

---

## 6.3 Budget Aware

ระบบต้องไม่ส่งทุก frame เข้าโมเดลโดยอัตโนมัติ

ใช้แนวคิด:

```text
Cheap Scan
   ↓
Scene Detection
   ↓
Hero Selection
   ↓
Interesting Moments
   ↓
Deep Analysis
```

---

## 6.4 Reproducible

ทุกงานต้องมี:

- job_id
- source hash
- config snapshot
- model/provider
- timestamps
- generated artifacts
- report version

เพื่อให้รันซ้ำและ audit ได้

---

# 7. Proposed Directory Structure

```text
pao-hubpro/
└── services/
    └── video_intelligence/
        ├── __init__.py
        ├── api.py
        ├── config.py
        ├── models.py
        ├── jobs.py
        ├── cache.py
        ├── security.py
        │
        ├── acquisition/
        │   ├── downloader.py
        │   ├── local_source.py
        │   └── metadata.py
        │
        ├── media/
        │   ├── probe.py
        │   ├── frames.py
        │   ├── scene_detector.py
        │   ├── hero_selector.py
        │   ├── hook.py
        │   └── pacing.py
        │
        ├── transcript/
        │   ├── captions.py
        │   ├── whisper.py
        │   ├── local_whisper.py
        │   ├── groq_whisper.py
        │   └── openai_whisper.py
        │
        ├── analysis/
        │   ├── router.py
        │   ├── visual.py
        │   ├── editorial.py
        │   ├── hooks.py
        │   ├── stock_qc.py
        │   └── debug_video.py
        │
        ├── reviewers/
        │   ├── base.py
        │   ├── openai_reviewer.py
        │   ├── claude_reviewer.py
        │   ├── local_reviewer.py
        │   └── council.py
        │
        ├── reports/
        │   ├── builder.py
        │   ├── schema.py
        │   ├── markdown.py
        │   └── json_report.py
        │
        ├── mcp/
        │   ├── tools.py
        │   └── schemas.py
        │
        └── tests/
            ├── test_probe.py
            ├── test_scene.py
            ├── test_frames.py
            ├── test_transcript.py
            ├── test_hook.py
            ├── test_pacing.py
            ├── test_stock_qc.py
            ├── test_security.py
            └── fixtures/
```

---

# 8. Input Sources

ระบบต้องรองรับ:

## URL

```text
YouTube
TikTok
Instagram
X
Facebook
Loom
Vimeo
Direct MP4
Other yt-dlp supported URLs
```

> การรองรับจริงขึ้นกับ `yt-dlp` และข้อจำกัดของแต่ละเว็บไซต์ ณ เวลารัน

## Local Files

```text
.mp4
.mov
.mkv
.webm
.avi
.m4v
```

---

# 9. Job Model

ตัวอย่าง:

```json
{
  "job_id": "vid_20260910_000001",
  "source_type": "url",
  "source": "https://example.com/video",
  "intent": "adobe_stock_qc",
  "local_only": false,
  "start": null,
  "end": null,
  "status": "queued",
  "created_at": "2026-09-10T01:00:00+07:00"
}
```

States:

```text
queued
downloading
probing
extracting_frames
transcribing
analyzing
reviewing
reporting
completed
failed
cancelled
```

---

# 10. Media Probe

ใช้ `ffprobe`

เก็บ:

```text
duration
width
height
fps
video_codec
audio_codec
bitrate
file_size
orientation
audio_channels
sample_rate
```

Output:

```json
{
  "duration_sec": 31.42,
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "video_codec": "h264",
  "audio_codec": "aac"
}
```

---

# 11. Scene Detection

ใช้ FFmpeg scene filter

แนวคิด:

```text
select='gt(scene,threshold)'
```

ต้อง configurable:

```env
VIDEO_SCENE_THRESHOLD=0.30
VIDEO_MAX_SCENE_FRAMES=100
```

Default behavior:

1. วิเคราะห์ scene boundaries
2. เลือก frame หลัง cut
3. จำกัด frame budget
4. จัด priority
5. เก็บ timestamp

Output:

```json
[
  {
    "timestamp": 0.0,
    "frame": "frame_0001.jpg",
    "scene_score": 0.82
  },
  {
    "timestamp": 2.4,
    "frame": "frame_0002.jpg",
    "scene_score": 0.55
  }
]
```

---

# 12. Uniform Sampling Fallback

Scene-change detection อาจไม่เหมาะกับ:

- Screen recording
- Tutorial
- Static presentation
- Talking head
- Gameplay ที่ภาพเปลี่ยนตลอด

ต้องมี fallback:

```text
scene-change
     ↓
too few useful frames?
     ↓ yes
uniform sampling
```

CLI:

```bash
pao video analyze input.mp4 --sampling auto
pao video analyze input.mp4 --sampling scene
pao video analyze input.mp4 --sampling uniform
```

---

# 13. Hero Frame Selection

เลือก frame สำคัญสำหรับ:

- Cover
- Report preview
- Adobe Stock QC
- Timeline
- Knowledge Store

คะแนนควรพิจารณา:

```text
scene_change_score
sharpness
motion blur
face visibility
subject clarity
text/logo presence
brightness
composition
duplicate similarity
```

Output:

```text
hero_01.jpg
hero_02.jpg
hero_03.jpg
```

---

# 14. Hook Microscope

วิเคราะห์ช่วง:

```text
00:00–00:10
```

Default:

```text
2 fps
≈ 20 frames
word-level transcript
```

ผลที่ต้องวิเคราะห์:

- First frame
- First spoken word
- First text overlay
- First visual change
- Hook type
- Promise
- Curiosity
- Pattern interruption
- CTA
- Shot frequency
- Visual-text synchronization

Output:

```markdown
## Hook Breakdown

00:00.0 — Visual opening
00:00.8 — First spoken phrase
00:01.5 — Text overlay appears
00:02.4 — Scene cut
00:04.1 — Main promise
00:07.8 — Payoff preview
```

---

# 15. Transcript Engine

Priority:

```text
Native Caption
     ↓ unavailable
Local Whisper
     ↓ unavailable / disabled
Groq Whisper
     ↓ unavailable
OpenAI Whisper
```

Config:

```env
VIDEO_TRANSCRIPT_PRIORITY=native,local,groq,openai
```

---

# 16. Local Whisper

เพิ่มเป็น first-class provider แม้ upstream stable baseline ยังใช้ Cloud Whisper เป็นหลัก

แนะนำ:

```text
faster-whisper
```

Config:

```env
LOCAL_WHISPER_MODEL=large-v3
LOCAL_WHISPER_DEVICE=auto
LOCAL_WHISPER_COMPUTE_TYPE=auto
```

ต้องรองรับ:

```text
Thai
English
Auto language detection
Word timestamps
Segment timestamps
```

---

# 17. Transcript Schema

```json
{
  "language": "th",
  "provider": "faster-whisper",
  "segments": [
    {
      "start": 0.22,
      "end": 2.10,
      "text": "วันนี้เราจะ..."
    }
  ],
  "words": [
    {
      "start": 0.22,
      "end": 0.50,
      "word": "วันนี้"
    }
  ]
}
```

---

# 18. Pacing Analyzer

Metrics:

```text
shot_count
cuts_per_minute
mean_shot_length
median_shot_length
longest_shot
shortest_shot
opening_cut_rate
```

Extended:

```text
motion_score
camera_motion
static_ratio
transition_density
```

Example:

```json
{
  "shot_count": 14,
  "cuts_per_minute": 27.4,
  "mean_shot_length_sec": 2.19,
  "median_shot_length_sec": 1.82
}
```

---

# 19. AI Visual Analysis

AI Reviewer ต้องวิเคราะห์:

```text
Scene
Subject
Action
Composition
Lighting
Camera
Text
Logo
Artifacts
Faces
Hands
Motion
Continuity
Narrative
```

แต่ไม่ควรส่งทุก frame

Default:

```text
max 20 hero frames
+
hook microscope frames
+
flagged frames
```

---

# 20. Intent Modes

สร้าง `intent` เพื่อเปลี่ยน behavior

```text
general
summary
hook_analysis
competitor_analysis
adobe_stock_qc
screen_debug
tutorial_extract
metadata
knowledge_ingest
video_factory_review
```

Example:

```bash
pao video analyze video.mp4 --intent adobe_stock_qc
```

---

# 21. Adobe Stock QC Mode

นี่คือ extension สำคัญของ Pao-hubPro

```text
Generated Video
      ↓
Technical Probe
      ↓
Frame Review
      ↓
Motion Review
      ↓
Artifact Detection
      ↓
Commercial Review
      ↓
Metadata Draft
      ↓
PASS / REVIEW / FAIL
```

---

# 22. Adobe Stock Checks

ตรวจอย่างน้อย:

## Technical

- Resolution
- Aspect ratio
- Duration
- Codec
- Frame rate
- Black frames
- Frozen frames
- Audio presence
- Severe compression

## Visual

- AI deformation
- Bad hands
- Bad fingers
- Face distortion
- Flicker
- Temporal inconsistency
- Warping
- Morphing
- Ghosting
- Duplicate subjects
- Broken object geometry
- Text artifacts
- Logos
- Watermarks

## Commercial

- Subject clarity
- Commercial usability
- Copy space
- Distracting objects
- Brand exposure
- IP risk indicators
- Editorial-only indicators

---

# 23. Adobe Stock QC Result

```json
{
  "verdict": "review",
  "score": 82,
  "issues": [
    {
      "severity": "medium",
      "timestamp": 6.2,
      "type": "hand_deformation",
      "message": "Possible finger deformation"
    }
  ]
}
```

Verdict:

```text
PASS
REVIEW
FAIL
```

---

# 24. Adobe Stock Timeline Report

Example:

```markdown
## QC Timeline

| Time | Severity | Finding |
|---|---|---|
| 00:03.2 | Low | Slight background shimmer |
| 00:06.2 | Medium | Possible finger deformation |
| 00:09.7 | Medium | Object edge flicker |
```

---

# 25. Screen Recording Debug Mode

Use case:

```text
bug.mp4
   ↓
Watch Engine
   ↓
UI state detection
   ↓
Timeline
   ↓
Error moment
   ↓
Likely cause
```

Command:

```bash
pao video analyze bug.mp4 --intent screen_debug
```

Output:

```text
00:12 Login clicked
00:13 Loading
00:14 Modal appears
00:15 UI freezes
00:16 console-style error visible
```

AI report:

```text
Likely failure point: after API response
Suggested code area: auth state transition
Confidence: medium
```

---

# 26. Tutorial Extraction Mode

ใช้กับ:

- YouTube Tutorial
- Coding tutorial
- How-to video
- Product walkthrough

Output:

```markdown
# Tutorial Steps

1. Open Settings
2. Select API
3. Create key
4. Paste key into environment
5. Restart service
```

พร้อม:

```text
timestamp
frame
transcript
step
```

---

# 27. Competitor / Viral Video Analysis

Intent:

```text
competitor_analysis
hook_analysis
```

Analyze:

- Hook type
- Hook duration
- Shot pacing
- First CTA
- Text overlay timing
- Caption density
- Visual patterns
- Retention techniques
- Loop structure
- Payoff timing

---

# 28. Structured Report

ทุก job ต้องสร้าง:

```text
report.md
report.json
```

Suggested Markdown:

```markdown
# Video Intelligence Report

## Metadata

## TL;DR

## Intent

## Key Moments

## Hook Breakdown

## Scene Timeline

## Transcript Summary

## Editorial Profile

## Technical Profile

## Visual Findings

## QC Findings

## Quotable Moments

## Entities

## Concepts

## Recommendations

## Transcript

## Provenance
```

---

# 29. Report JSON Schema

```json
{
  "schema_version": "20.13.1",
  "job": {},
  "source": {},
  "media": {},
  "scenes": [],
  "hook": {},
  "transcript": {},
  "pacing": {},
  "visual_findings": [],
  "qc": {},
  "summary": {},
  "provenance": {}
}
```

---

# 30. Artifact Layout

```text
data/
└── video-intelligence/
    └── <job_id>/
        ├── source/
        │   └── source.mp4
        ├── frames/
        │   ├── scenes/
        │   ├── hook/
        │   └── hero/
        ├── audio/
        │   └── audio.wav
        ├── transcript/
        │   ├── transcript.json
        │   ├── transcript.txt
        │   └── captions.vtt
        ├── analysis/
        │   ├── pacing.json
        │   ├── scenes.json
        │   └── findings.json
        ├── report.md
        ├── report.json
        └── manifest.json
```

---

# 31. MCP Tools

เพิ่ม MCP tools อย่างน้อย:

```text
video.analyze
video.inspect
video.transcribe
video.extract_frames
video.analyze_hook
video.analyze_pacing
video.stock_qc
video.debug_screen
video.get_report
video.list_jobs
video.cancel_job
```

---

# 32. MCP Tool: video.analyze

Input:

```json
{
  "source": "video.mp4",
  "intent": "general",
  "start": null,
  "end": null,
  "local_only": true
}
```

Output:

```json
{
  "job_id": "vid_xxx",
  "status": "completed",
  "report_path": ".../report.md"
}
```

---

# 33. MCP Tool: video.stock_qc

Input:

```json
{
  "source": "generated_video.mp4",
  "strict": true,
  "local_only": false
}
```

Output:

```json
{
  "verdict": "review",
  "score": 82,
  "issues": [],
  "report_path": "..."
}
```

---

# 34. MCP Safety

ต้อง validate:

```text
URL scheme
file path
file extension
size
duration
command arguments
output path
```

ห้าม:

```text
shell=True
raw user shell strings
unsafe path traversal
unvalidated option injection
```

ใช้:

```python
subprocess.run(
    ["yt-dlp", "--", url],
    check=True
)
```

---

# 35. SSRF / URL Safety

ก่อน download URL:

- allow `http`
- allow `https`
- reject `file://`
- reject localhost by default
- reject private network by default
- reject malformed URL
- configurable domain policy

Config:

```env
VIDEO_ALLOW_PRIVATE_NETWORK=false
```

---

# 36. File Safety

Local path ต้อง:

```text
resolve()
validate extension
check file exists
check max size
check allowed root
```

Config:

```env
VIDEO_ALLOWED_ROOTS=/data/videos,/mnt/data
VIDEO_MAX_FILE_GB=10
```

---

# 37. Privacy Modes

## Standard

Cloud providers allowed

## Private

```env
VIDEO_INTELLIGENCE_LOCAL_ONLY=true
```

ห้าม:

```text
OpenAI API
Groq API
Claude API
external uploader
```

## Strict Private

เพิ่ม:

```text
no URL downloads
no remote metadata
no telemetry
```

---

# 38. Cache

Hash source:

```text
SHA-256
```

Cache:

```text
media probe
transcript
frames
scene data
reports
```

Key:

```text
source_hash
+
config_hash
+
model_version
```

---

# 39. Performance Strategy

Default profiles:

## Fast

```text
max hero frames: 8
hook: off
whisper: native caption preferred
visual reviewer: 1
```

## Balanced

```text
max hero frames: 16
hook: on
visual reviewer: primary
```

## Deep

```text
max hero frames: 30
hook: on
reviewer council: on
motion checks: enhanced
```

---

# 40. Token Budget

Config:

```env
VIDEO_MAX_ANALYSIS_FRAMES=20
VIDEO_MAX_HOOK_FRAMES=20
VIDEO_MAX_TOTAL_FRAMES_TO_MODEL=40
```

Logic:

```text
Scene Frames
    ↓
Perceptual Dedup
    ↓
Quality Filter
    ↓
Hero Ranking
    ↓
Budget Filter
    ↓
AI
```

---

# 41. Perceptual Deduplication

ใช้:

```text
pHash
dHash
or SSIM
```

เพื่อลด frame ซ้ำ

Threshold configurable

---

# 42. AI Router

Pseudo:

```python
if local_only:
    use_local_models()
elif reviewer_council:
    run_multi_reviewer()
else:
    use_primary_provider()
```

---

# 43. Reviewer Council Integration

Phase 20.13 ต้องเชื่อม AI Reviewer Council

Flow:

```text
Video Findings
      ↓
OpenAI Reviewer
Claude Reviewer
Local Reviewer
      ↓
Consensus
      ↓
Final Verdict
```

แต่ไม่ควรรันทุก job

เปิดเฉพาะ:

```text
deep
adobe_stock_qc
high_risk
manual request
```

---

# 44. Reviewer Output

```json
{
  "reviewers": [
    {
      "name": "openai",
      "verdict": "review",
      "score": 84
    },
    {
      "name": "local",
      "verdict": "pass",
      "score": 90
    }
  ],
  "consensus": "review",
  "confidence": 0.82
}
```

---

# 45. Knowledge Store

ไม่ผูกกับ Obsidian

สร้าง abstraction:

```text
KnowledgeAdapter
```

Providers:

```text
Filesystem
SQLite
Obsidian
Vector DB
Pao Knowledge Store
```

---

# 46. Knowledge Ingest Record

```json
{
  "type": "video_analysis",
  "source": "...",
  "title": "...",
  "summary": "...",
  "concepts": [],
  "entities": [],
  "report_path": "...",
  "created_at": "..."
}
```

---

# 47. Web Dashboard

เพิ่มหน้า:

```text
Video Intelligence
```

Sections:

```text
Upload / URL
Intent
Privacy Mode
Analysis Profile
Run
Progress
Timeline
Frames
Transcript
Findings
Report
```

---

# 48. Dashboard Layout

```text
┌───────────────────────────────────────────────┐
│ Video Intelligence                           │
├───────────────────────────────────────────────┤
│ URL / Upload              [ Analyze ]         │
│ Intent: Adobe Stock QC                       │
│ Mode: Balanced                               │
│ Local Only: ON                               │
├───────────────────────┬───────────────────────┤
│ Video Preview         │ Findings              │
│                       │ Score 82               │
│                       │ REVIEW                 │
├───────────────────────┴───────────────────────┤
│ Timeline                                      │
│ ●────⚠────────●────────⚠────●                 │
├───────────────────────────────────────────────┤
│ Transcript / Frames / Report                  │
└───────────────────────────────────────────────┘
```

---

# 49. CLI

Base:

```bash
pao video analyze <source>
```

Examples:

```bash
pao video analyze video.mp4
```

```bash
pao video analyze "https://youtube.com/..." --intent summary
```

```bash
pao video analyze stock.mp4 --intent adobe_stock_qc --profile deep
```

```bash
pao video analyze bug.mp4 --intent screen_debug
```

```bash
pao video analyze tutorial.mp4 --start 120 --end 300
```

---

# 50. CLI Options

```text
--intent
--profile
--start
--end
--sampling
--scene-threshold
--max-frames
--hook
--no-hook
--local-only
--reviewer-council
--output
--json
```

---

# 51. Configuration

Create:

```env
# Video Intelligence
VIDEO_INTELLIGENCE_ENABLED=true
VIDEO_INTELLIGENCE_LOCAL_ONLY=false

# Files
VIDEO_ALLOWED_ROOTS=./data,/mnt/data
VIDEO_MAX_FILE_GB=10

# Sampling
VIDEO_SCENE_THRESHOLD=0.30
VIDEO_MAX_SCENE_FRAMES=100
VIDEO_MAX_ANALYSIS_FRAMES=20
VIDEO_MAX_HOOK_FRAMES=20

# Whisper
VIDEO_TRANSCRIPT_PRIORITY=native,local,groq,openai
LOCAL_WHISPER_MODEL=large-v3
LOCAL_WHISPER_DEVICE=auto

# APIs
GROQ_API_KEY=
OPENAI_API_KEY=

# Network
VIDEO_ALLOW_PRIVATE_NETWORK=false

# Knowledge
VIDEO_KNOWLEDGE_AUTO_INGEST=false
```

---

# 52. Dependency Strategy

Required:

```text
Python 3.11+
ffmpeg
ffprobe
yt-dlp
```

Optional:

```text
faster-whisper
OpenAI SDK
Groq
local VLM runtime
```

Install checks:

```bash
ffmpeg -version
ffprobe -version
yt-dlp --version
python --version
```

---

# 53. Upstream Compatibility Watch

มี upstream PR ที่ควรติดตามแต่ห้ามถือว่า stable จนกว่าจะ merge/release:

- Local faster-whisper backend
- Long video focused-mode fixes
- Native-language transcript changes
- Windows UTF-8 fixes
- Sampling/pacing improvements

Pao-hubPro ควร implement อย่าง modular เพื่อ cherry-pick แนวคิดภายหลังได้ง่าย

---

# 54. Long Video Strategy

สำหรับวิดีโอยาว:

```text
Probe duration
      ↓
Chapter / scene segmentation
      ↓
Cheap pass
      ↓
Interesting ranges
      ↓
Focused deep pass
```

Threshold:

```env
VIDEO_LONG_THRESHOLD_MIN=10
```

---

# 55. Range Analysis

รองรับ:

```text
start
end
```

Example:

```bash
pao video analyze long.mp4 --start 600 --end 900
```

Transcript, frame extraction และ timing ต้อง normalize ให้มี:

```text
absolute timestamp
relative timestamp
```

---

# 56. Failure Handling

Errors:

```text
download_failed
unsupported_source
ffprobe_failed
frame_extract_failed
caption_failed
transcription_failed
analysis_failed
provider_failed
budget_exceeded
privacy_violation
```

ทุก error ต้องมี:

```json
{
  "code": "...",
  "message": "...",
  "retryable": true,
  "stage": "..."
}
```

---

# 57. Retry Policy

Retry เฉพาะ:

```text
network
provider timeout
temporary API
download interruption
```

ห้าม retry loop สำหรับ:

```text
invalid input
unsupported codec
policy violation
missing local file
```

---

# 58. Logging

Structured log:

```json
{
  "job_id": "vid_xxx",
  "stage": "transcription",
  "event": "provider_selected",
  "provider": "local_whisper"
}
```

ห้าม log:

```text
API keys
full auth cookies
secrets
private transcript unless debug explicitly enabled
```

---

# 59. Audit

บันทึก:

```text
who/agent initiated
source
intent
privacy mode
providers
config
model
result
timestamps
```

---

# 60. Testing Strategy

## Unit

- URL validation
- path validation
- ffprobe parser
- scene parser
- transcript parser
- frame budget
- hook timing
- pacing math
- report schema

## Integration

- local MP4
- public URL
- video with captions
- video without captions
- Thai audio
- English audio
- screen recording
- AI generated video

## Security

- URL beginning with `-`
- malformed URL
- path traversal
- localhost URL
- private IP
- oversized file
- malicious filename

---

# 61. Test Fixtures

Create small fixtures:

```text
fixtures/
├── static_screen.mp4
├── hard_cuts.mp4
├── thai_voice.mp4
├── no_audio.mp4
├── no_caption.mp4
├── vertical_short.mp4
└── ai_artifact.mp4
```

---

# 62. Acceptance Criteria — Core

Phase 20.13 ถือว่า Core Complete เมื่อ:

- [ ] วิเคราะห์ Local MP4 ได้
- [ ] วิเคราะห์ URL ผ่าน yt-dlp ได้
- [ ] ffprobe metadata สำเร็จ
- [ ] Scene detection ทำงาน
- [ ] Uniform fallback ทำงาน
- [ ] Hero frame selection ทำงาน
- [ ] Hook microscope ทำงาน
- [ ] Native caption ทำงาน
- [ ] Whisper fallback ทำงาน
- [ ] Thai transcript ทำงาน
- [ ] Pacing metrics ทำงาน
- [ ] `report.md` ถูกสร้าง
- [ ] `report.json` ถูกสร้าง
- [ ] MCP `video.analyze` ทำงาน
- [ ] CLI ทำงาน
- [ ] Security tests ผ่าน

---

# 63. Acceptance Criteria — Pao-hubPro Extension

- [ ] Local-only mode ทำงานจริง
- [ ] Local Whisper provider มี
- [ ] Adobe Stock QC mode มี
- [ ] Screen Debug mode มี
- [ ] Reviewer Council integration มี
- [ ] Dashboard แสดง job progress
- [ ] Timeline แสดง findings
- [ ] Knowledge adapter มี
- [ ] Cache/hash มี
- [ ] Audit record มี

---

# 64. Acceptance Criteria — Adobe Stock

- [ ] ตรวจ frame anomalies ได้
- [ ] มี timestamp ต่อ finding
- [ ] มี PASS / REVIEW / FAIL
- [ ] มี confidence
- [ ] มี technical profile
- [ ] มี commercial-risk section
- [ ] report อ่านง่ายก่อน upload
- [ ] ห้าม auto-submit Stock ใน Phase นี้

---

# 65. Non-Goals

Phase 20.13 ไม่ควรทำ:

- Full video editor
- Auto publishing
- Auto Adobe Stock submission
- Copyright bypass
- DRM bypass
- Private content scraping
- Browser cookie harvesting
- Re-encoding studio
- Full NLE replacement

---

# 66. Security Guardrails

สำคัญมาก:

1. ห้าม shell interpolation จาก user input
2. ห้าม `shell=True`
3. ใช้ argv list
4. แทรก `--` เมื่อ command รองรับ
5. validate URL
6. validate local path
7. deny private network default
8. redact secrets
9. cap filesize
10. cap duration/resource usage

---

# 67. Resource Limits

Config:

```env
VIDEO_MAX_DURATION_MIN=180
VIDEO_MAX_FILE_GB=10
VIDEO_MAX_JOB_MIN=30
VIDEO_MAX_CONCURRENT_JOBS=2
```

หากเกิน:

```text
reject
or
require focused range
```

---

# 68. GPU Routing

ถ้ามี GPU:

```text
Local Whisper
Local VLM
Motion analysis
```

ถ้าไม่มี:

```text
CPU fallback
Cloud optional
```

Pao-hubPro ต้อง detect:

```text
CUDA
Metal
CPU
```

---

# 69. Runpod Integration

Future-friendly interface:

```text
VideoComputeProvider
```

Implementations:

```text
local
runpod
remote_worker
```

เพื่อให้ Phase 20.x ที่เกี่ยว Runpod สามารถใช้ GPU remote ได้โดยไม่ผูก business logic

---

# 70. Pao AI Video Factory Integration

Flow:

```text
Prompt
   ↓
MiniMax H3 / Video Generator
   ↓
Generated Video
   ↓
Phase 20.13
   ↓
QC
   ↓
Reviewer Council
   ↓
PASS?
   ├─ Yes → Export
   └─ No  → Regenerate / Fix
```

---

# 71. Regeneration Feedback

Phase 20.13 ต้องส่ง structured feedback กลับ Video Factory:

```json
{
  "action": "regenerate",
  "reason": "temporal_hand_deformation",
  "timestamp": 6.2,
  "suggestion": "reduce hand movement and simplify interaction"
}
```

---

# 72. Smart Auto-Intent

ภายหลังสามารถ infer:

```text
vertical < 60 sec
→ short_form

source path contains stock
→ stock_qc candidate

screen recording
→ screen_debug candidate
```

แต่ใน 20.13:

> Auto-intent เป็น optional  
> Manual intent ต้อง override เสมอ

---

# 73. Database Tables

Suggested:

```sql
video_jobs
video_sources
video_frames
video_transcripts
video_findings
video_reports
video_reviews
```

---

# 74. `video_jobs`

Fields:

```text
id
source_id
intent
profile
local_only
status
created_at
started_at
completed_at
error_code
```

---

# 75. `video_findings`

Fields:

```text
id
job_id
timestamp_start
timestamp_end
category
severity
confidence
message
frame_path
reviewer
```

---

# 76. API Endpoints

Suggested:

```text
POST /api/video/jobs
GET  /api/video/jobs
GET  /api/video/jobs/{id}
POST /api/video/jobs/{id}/cancel
GET  /api/video/jobs/{id}/report
GET  /api/video/jobs/{id}/frames
GET  /api/video/jobs/{id}/transcript
```

---

# 77. WebSocket / SSE Progress

Events:

```text
job.created
job.downloading
job.probing
job.frames
job.transcribing
job.analyzing
job.reviewing
job.completed
job.failed
```

---

# 78. Progress Calculation

Example:

```text
Download       10%
Probe           5%
Frames         20%
Transcript     20%
Analysis       25%
Review         10%
Report         10%
```

---

# 79. UI Warning System

Severity:

```text
info
low
medium
high
critical
```

Stock QC UI:

```text
High → red marker
Medium → warning
Low → note
```

---

# 80. Report Provenance

ท้าย report:

```markdown
## Provenance

- Source Hash:
- Analysis Profile:
- Privacy Mode:
- Transcript Provider:
- Visual Provider:
- Reviewer Council:
- Generated At:
- Schema Version:
```

---

# 81. Versioning

Phase schema:

```text
20.13.1
```

Semantic changes:

```text
20.13.1 initial
20.13.2 bug fix
20.13.3 enhanced QC
```

---

# 82. Implementation Order

## Step 1 — Scaffold

- create package
- config
- job model
- report model

## Step 2 — Media

- ffprobe
- frames
- scenes
- hero frames

## Step 3 — Transcript

- captions
- local whisper
- cloud fallback

## Step 4 — Analysis

- hook
- pacing
- visual analysis

## Step 5 — Reports

- Markdown
- JSON
- artifacts

## Step 6 — MCP

- video.analyze
- video.get_report

## Step 7 — Adobe Stock

- stock_qc
- findings
- verdict

## Step 8 — Reviewer Council

- consensus

## Step 9 — Dashboard

- upload
- jobs
- timeline
- report

## Step 10 — Tests / Hardening

- security
- privacy
- failure handling
- docs

---

# 83. Phase 20.13 Sub-Phases

Suggested:

## 20.13.1 — Core Watch Engine

```text
probe
frames
scenes
transcript
report
```

## 20.13.2 — Hook & Editorial Intelligence

```text
hook microscope
pacing
hero frames
```

## 20.13.3 — Local Intelligence

```text
faster-whisper
local VLM
local-only
```

## 20.13.4 — Adobe Stock QC

```text
artifact timeline
QC score
verdict
```

## 20.13.5 — MCP + Dashboard

```text
tools
API
UI
progress
```

## 20.13.6 — Reviewer Council

```text
multi-review
consensus
```

---

# 84. Definition of Done

Phase 20.13 จบเมื่อผู้ใช้สามารถ:

```text
1. วาง URL หรือไฟล์
2. กด Analyze
3. ระบบดึง/อ่านวิดีโอ
4. ตรวจ scene
5. อ่าน transcript
6. วิเคราะห์ hook
7. วิเคราะห์ pacing
8. ตรวจ visual
9. สร้าง report
10. ส่งผลให้ Agent ตัวอื่นใช้ต่อ
```

โดยไม่ต้องทำ manual frame extraction เอง

---

# 85. Example User Commands

```text
ดูวิดีโอนี้แล้วสรุปให้ผม
```

```text
วิเคราะห์ 10 วินาทีแรกว่าทำไม hook ถึงน่าสนใจ
```

```text
ตรวจวิดีโอนี้ก่อนเอาไปขาย Adobe Stock
```

```text
ดู screen recording นี้แล้วหาจุดที่ UI เริ่มพัง
```

```text
ถอดขั้นตอนจาก tutorial นี้ออกมาเป็น checklist
```

---

# 86. Example Agent Flow

User:

```text
ตรวจ stock_001.mp4
```

Agent:

```text
video.stock_qc
      ↓
Watch Engine
      ↓
Report
      ↓
Reviewer Council
      ↓
Verdict
```

Output:

```text
REVIEW

00:06.2 — hand deformation
00:09.7 — minor flicker

Recommendation:
Regenerate before submission.
```

---

# 87. Best-Practice Defaults

Recommended defaults for Pao:

```text
Profile: balanced
Scene threshold: 0.30
Hero frames: 16
Hook microscope: enabled
Native caption: first
Local Whisper: second
Cloud fallback: opt-in
Reviewer Council: stock/deep only
Local-only: enabled for private files
```

---

# 88. Dependencies Checklist

- [ ] Python 3.11+
- [ ] ffmpeg
- [ ] ffprobe
- [ ] yt-dlp
- [ ] faster-whisper optional
- [ ] model/provider config
- [ ] storage directory
- [ ] MCP server
- [ ] database migration

---

# 89. Security Checklist

- [ ] no `shell=True`
- [ ] argv arrays only
- [ ] URL validation
- [ ] private network deny
- [ ] path traversal deny
- [ ] allowed roots
- [ ] size caps
- [ ] duration caps
- [ ] secret redaction
- [ ] safe temp files
- [ ] cleanup policy
- [ ] audit logs

---

# 90. QA Checklist

- [ ] Windows
- [ ] Linux
- [ ] Thai filenames
- [ ] Thai transcripts
- [ ] UTF-8 console
- [ ] video without audio
- [ ] video without captions
- [ ] vertical video
- [ ] horizontal video
- [ ] long video
- [ ] screen recording
- [ ] AI-generated video
- [ ] bad/corrupt input

---

# 91. Documentation

Create:

```text
docs/video-intelligence.md
docs/video-stock-qc.md
docs/video-local-only.md
docs/video-mcp-tools.md
```

---

# 92. README Section

Add:

```markdown
## Video Intelligence

Pao-hubPro can inspect video URLs and local files, extract scene-aware frames,
transcribe speech, analyze hooks and pacing, generate structured reports,
and run Adobe Stock-oriented quality review.
```

---

# 93. Migration Safety

ห้ามแก้ระบบเดิมแบบ breaking

หลัก:

```text
additive changes
feature flag
backwards compatible
```

Feature flag:

```env
VIDEO_INTELLIGENCE_ENABLED=false
```

เปิดเมื่อทดสอบพร้อม

---

# 94. Rollback

Rollback = ปิด:

```env
VIDEO_INTELLIGENCE_ENABLED=false
```

ไม่กระทบ:

```text
Browser
MCP core
Stock generation
Video factory
Existing phases
```

---

# 95. Metrics

Track:

```text
jobs_total
jobs_success
jobs_failed
avg_duration
avg_frames
avg_transcription_time
avg_analysis_time
cache_hit_rate
provider_cost
stock_pass_rate
```

---

# 96. Cost Tracking

Cloud use ต้อง log estimated cost:

```json
{
  "transcription_cost": 0.02,
  "vision_cost": 0.12,
  "review_cost": 0.04,
  "total_estimated": 0.18
}
```

Local:

```text
API cost = 0
compute time tracked
```

---

# 97. Future Ideas — Not Required for 20.13

- OCR timeline
- Logo detector
- Face tracking
- Shot classification
- Camera movement classification
- Music beat alignment
- Audio quality scoring
- NSFW classifier
- Local embedding index
- Automatic B-roll extraction
- Auto storyboard
- Video-to-prompt reverse engineering
- Video similarity search
- Story continuity scoring

---

# 98. Upstream Reference Notes

Repository:

```text
https://github.com/taoufik123-collab/claude-watch
```

Baseline release:

```text
v0.2.0
2026-05-25
```

Important upstream concepts:

```text
scene-change extraction
hook microscope
pacing metrics
word timestamps
structured report
native caption
Whisper fallback
focused ranges
```

Phase 20.13 ต้องให้เครดิต upstream ตาม license และไม่ลบ attribution ที่จำเป็น

---

# 99. License

`claude-watch` ใช้ MIT License

เมื่อ reuse code:

- preserve license
- preserve copyright/attribution
- document modifications
- แยก upstream-derived code ให้ตรวจย้อนหลังง่าย

---

# 100. Final Architecture Summary

```text
                         Pao-hubPro
                             │
                 ┌───────────┴───────────┐
                 │                       │
              Codex                    Web UI
                 │                       │
                 └───────────┬───────────┘
                             │
                        MCP / API
                             │
                             ▼
                    Video Intelligence
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
       yt-dlp             ffmpeg             ffprobe
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
            ┌────────────────┼─────────────────┐
            │                │                 │
          Scenes          Transcript          Hook
            │                │                 │
            └────────────────┼─────────────────┘
                             │
                           Pacing
                             │
                      Visual Analysis
                             │
                     Reviewer Council
                             │
              ┌──────────────┼──────────────┐
              │              │              │
          Stock QC       Debug Video     Knowledge
              │              │              │
              └──────────────┼──────────────┘
                             │
                          report.md
                          report.json
```

---

# 101. Recommended Implementation Decision

**สร้าง Phase 20.13 เป็น service ใหม่ ไม่แก้ upstream ตรง ๆ**

เหตุผล:

1. อัปเดต upstream ได้ง่าย
2. ไม่ผูกกับ Claude
3. รองรับ MCP ได้เต็ม
4. ทำ Local-only ได้จริง
5. เพิ่ม Adobe Stock QC ได้โดยไม่ทำ fork เละ
6. เชื่อม Reviewer Council ได้
7. รองรับ Runpod/Local GPU ในอนาคต
8. เขียน test และ security policy ของ Pao-hubPro ได้เอง

---

# 102. Codex One-Shot Implementation Prompt

> คัดลอก block ด้านล่างไปให้ Codex ได้เลย

```text
You are working inside my existing Pao-hubPro repository.

Implement Phase 20.13:
"Pao-hubPro Video Intelligence × Claude Watch"

Reference upstream:
https://github.com/taoufik123-collab/claude-watch

IMPORTANT:
- Do not blindly copy the upstream repository.
- Study the upstream architecture and preserve MIT attribution where code or substantial logic is reused.
- Build a provider-neutral Video Intelligence service inside Pao-hubPro.
- Do not break existing phases, routes, MCP tools, browser functions, stock workflow, or dashboard.
- Prefer additive changes and feature flags.
- Detect the repository's actual language/framework before implementing.
- Follow existing project conventions.
- Do not ask me questions unless absolutely blocked by missing secrets or impossible external dependencies.
- If a provider key is unavailable, implement the provider interface and graceful fallback.
- Keep all user input safe. Never use shell=True.

GOALS

1. Add a Video Intelligence service capable of:
   - local video files
   - supported remote video URLs via yt-dlp
   - ffprobe metadata
   - scene-change frame extraction
   - uniform fallback sampling
   - hero-frame selection
   - 0–10s hook microscope
   - native caption extraction
   - Whisper fallback
   - local faster-whisper provider
   - Thai + English transcripts
   - word/segment timestamps
   - pacing metrics
   - structured Markdown + JSON reports

2. Add intent modes:
   - general
   - summary
   - hook_analysis
   - competitor_analysis
   - adobe_stock_qc
   - screen_debug
   - tutorial_extract
   - knowledge_ingest
   - video_factory_review

3. Add Adobe Stock QC:
   - technical media checks
   - artifact timeline
   - flicker/warping/deformation finding framework
   - text/logo/watermark finding framework
   - temporal consistency finding framework
   - PASS / REVIEW / FAIL verdict
   - score
   - timestamped findings
   - confidence
   - structured recommendations
   - DO NOT auto-submit to Adobe Stock

4. Add privacy modes:
   VIDEO_INTELLIGENCE_LOCAL_ONLY=true
   must prevent OpenAI/Groq/Claude/external provider calls.

5. Implement local Whisper using faster-whisper when installed.
   Provider priority:
   native captions -> local whisper -> Groq -> OpenAI
   Make priority configurable.

6. Add MCP tools:
   video.analyze
   video.inspect
   video.transcribe
   video.extract_frames
   video.analyze_hook
   video.analyze_pacing
   video.stock_qc
   video.debug_screen
   video.get_report
   video.list_jobs
   video.cancel_job

7. Add CLI commands if the repository already has CLI conventions:
   pao video analyze <source>
   pao video analyze <source> --intent adobe_stock_qc
   pao video analyze <source> --intent screen_debug
   support:
   --intent
   --profile
   --start
   --end
   --sampling
   --scene-threshold
   --max-frames
   --hook
   --no-hook
   --local-only
   --reviewer-council
   --output
   --json

8. Add report artifacts:
   report.md
   report.json
   manifest.json
   transcript.json
   scenes.json
   pacing.json
   findings.json

9. Use a deterministic per-job directory:
   data/video-intelligence/<job_id>/

10. Add hashing/cache:
   source SHA-256
   config hash
   model/provider identity
   cache reusable intermediate artifacts.

11. Add Reviewer Council integration if the current repository already contains the council phase.
   Do not hard-depend on it.
   Use an adapter/interface.
   Enable it primarily for:
   deep
   adobe_stock_qc
   high-risk/manual review

12. Add KnowledgeAdapter abstraction:
   filesystem first
   future Obsidian/vector/Pao Knowledge Store providers
   Do not hard-code Obsidian.

13. Add API routes following existing backend conventions:
   POST /api/video/jobs
   GET /api/video/jobs
   GET /api/video/jobs/{id}
   POST /api/video/jobs/{id}/cancel
   GET /api/video/jobs/{id}/report
   GET /api/video/jobs/{id}/frames
   GET /api/video/jobs/{id}/transcript

14. Add dashboard UI if the repo has a dashboard:
   - URL / Upload
   - intent
   - privacy mode
   - profile
   - run button
   - progress
   - video preview
   - timeline
   - frames
   - transcript
   - findings
   - report
   Keep the existing Pao-hubPro design system.

15. Add job states:
   queued
   downloading
   probing
   extracting_frames
   transcribing
   analyzing
   reviewing
   reporting
   completed
   failed
   cancelled

16. Security:
   - never shell=True
   - argv arrays only
   - validate URL schemes
   - deny localhost/private IP by default
   - reject file://
   - defend against yt-dlp option injection
   - use "--" before user URL where supported
   - resolve local paths
   - prevent path traversal
   - enforce allowed roots
   - file-size cap
   - duration/resource caps
   - redact API keys/tokens/cookies from logs
   - safe temp directories
   - cleanup policy

17. Add configuration:
   VIDEO_INTELLIGENCE_ENABLED
   VIDEO_INTELLIGENCE_LOCAL_ONLY
   VIDEO_ALLOWED_ROOTS
   VIDEO_MAX_FILE_GB
   VIDEO_MAX_DURATION_MIN
   VIDEO_SCENE_THRESHOLD
   VIDEO_MAX_SCENE_FRAMES
   VIDEO_MAX_ANALYSIS_FRAMES
   VIDEO_MAX_HOOK_FRAMES
   VIDEO_TRANSCRIPT_PRIORITY
   LOCAL_WHISPER_MODEL
   LOCAL_WHISPER_DEVICE
   VIDEO_ALLOW_PRIVATE_NETWORK
   VIDEO_KNOWLEDGE_AUTO_INGEST

18. Performance:
   profiles fast/balanced/deep
   perceptual frame dedup
   frame budget before multimodal model calls
   long-video cheap-pass -> focused deep-pass
   focused --start/--end analysis

19. Tests:
   unit + integration + security.
   Include tests for:
   - malformed URL
   - URL starting with option-like input
   - private IP
   - localhost
   - path traversal
   - missing video
   - no audio
   - no captions
   - Thai transcript
   - scene-change video
   - static screen recording
   - vertical short
   - long focused range
   - corrupted file
   - local-only mode blocks cloud providers

20. Documentation:
   docs/video-intelligence.md
   docs/video-stock-qc.md
   docs/video-local-only.md
   docs/video-mcp-tools.md

IMPLEMENTATION PROCESS

A. Inspect the repository first.
B. Identify current backend, frontend, MCP, DB, worker/job, config, tests, and Reviewer Council architecture.
C. Write a short implementation plan into:
   docs/phases/phase-20.13-plan.md
D. Implement in small modules.
E. Run existing tests before changes if practical.
F. Implement tests for the new phase.
G. Run formatter/linter/typecheck/tests.
H. Fix failures caused by this phase.
I. Do not delete unrelated user code.
J. Do not rewrite existing stable architecture unnecessarily.

UPSTREAM

Use claude-watch concepts:
- scene-aware frames
- hook microscope
- pacing
- captions
- Whisper fallback
- structured report
- safe subprocess invocation

Do not assume unmerged upstream PRs are stable dependencies.
Design interfaces so local-whisper, language handling, long-video fixes,
and Windows UTF-8 improvements can be incorporated independently.

DEFINITION OF DONE

I can give Pao-hubPro:
- a public video URL
- a local MP4
- an AI-generated stock video
- or a screen recording

and receive:
- metadata
- scene-aware frames
- transcript
- hook analysis
- pacing
- visual findings
- report.md
- report.json

For Adobe Stock intent I also receive:
- timestamped QC findings
- PASS/REVIEW/FAIL
- score
- confidence
- recommendations

Local-only mode must operate without calling cloud providers.

DELIVERABLE AT THE END

Print a concise completion report containing:

1. files created
2. files changed
3. architecture implemented
4. commands to install dependencies
5. commands to run
6. commands to test
7. environment variables
8. known limitations
9. security decisions
10. next recommended Phase 20.13.x improvement

Then create/update:
docs/phases/Phase-20.13-Pao-hubPro-Video-Intelligence-Claude-Watch.md

Do the implementation now.
```

---

# 103. Final Checklist for Pao

ก่อนให้ Codex merge:

- [ ] อ่าน diff ทั้ง Phase
- [ ] เช็กว่าไม่แก้ระบบเดิมเกินจำเป็น
- [ ] เช็กไม่มี `shell=True`
- [ ] เช็ก `.env` ไม่ถูก commit
- [ ] เช็ก URL validation
- [ ] เช็ก private IP deny
- [ ] เช็ก Local-only ไม่มี Cloud call
- [ ] ทดสอบวิดีโอภาษาไทย
- [ ] ทดสอบ screen recording
- [ ] ทดสอบ Adobe Stock QC
- [ ] ทดสอบ report.md
- [ ] ทดสอบ report.json
- [ ] ทดสอบ MCP tool
- [ ] ทดสอบบน Windows
- [ ] ทดสอบบน Linux/VPS
- [ ] รัน test suite เดิมทั้งหมด
- [ ] Commit แยก Phase 20.13

---

# 104. Recommended Next Phase

หลัง Phase 20.13 เสถียร:

```text
Phase 20.14
Pao-hubPro Visual Knowledge & Media Memory
```

แนวทาง:

```text
Video Intelligence
      ↓
Image Intelligence
      ↓
Transcript
      ↓
Embeddings
      ↓
Searchable Media Memory
      ↓
Agent Retrieval
```

แต่ **ยังไม่ควรเริ่ม Phase 20.14 ก่อน 20.13 ผ่าน Acceptance Criteria หลัก**

---

# END — Phase 20.13

**Recommended action:** ใช้ One-Shot Codex Prompt ในหัวข้อ 102 เพื่อเริ่ม implementation โดยให้ Codex inspect repository ปัจจุบันก่อนทุกครั้ง
