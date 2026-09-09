# Pao-hubPro Video Intelligence: Architecture & Operation

## 1. Overview
The Pao-hubPro Video Intelligence subsystem (Phase 20.13) provides autonomous agents with local-first, multi-modal video perception capabilities:
- **Technical Media Probing (`MediaProbe`)**: Dimensions, orientation, codecs, bitrate, frame rate, and duration.
- **Scene-Change & Keyframe Extraction (`FrameExtractor`)**: Scene change thresholding, uniform fallback sampling, and hero frame aesthetic contrast scoring.
- **0–10s Hook Microscope (`HookAnalyzer`)**: Micro-timeline analysis, visual hook scoring, and kinetic/narrative/ambient style classification.
- **Multi-Tier Audio Transcription (`TranscriptEngine`)**: Native captions first, local `faster-whisper` second, and cloud providers as optional fallback.
- **Editorial Pacing & Rhythm (`PacingAnalyzer`)**: Cuts per minute (CPM), mean shot length, and rhythm profiling (`HIGH-ENERGY`, `MODERATE`, `CONTEMPLATIVE`, `STATIC`).
- **Adobe Stock Quality Control (`StockQcEngine`)**: Commercial asset evaluation against Adobe Stock submission standards (verdicts: `PASS`, `REVIEW`, `FAIL`).

## 2. Ingestion & Execution Flow
```text
Video Source (URL or Local File)
       │
       ▼
Security Validation (SSRF, Argument Boundary '--', Path Traversal)
       │
       ▼
Asynchronous Video Job Pipeline:
1. Probing (MediaProbe)
2. Frame & Scene Extraction (FrameExtractor)
3. Audio Transcription (TranscriptEngine)
4. Hook & Editorial Pacing Analysis (HookAnalyzer, PacingAnalyzer)
5. Quality Control & Review (StockQcEngine)
6. Synthesis (ReportBuilder)
       │
       ▼
Markdown (`report.md`) & Structured Machine JSON (`report.json`)
```

## 3. Endpoints & GUI Studio
- **REST API**: `/api/agent-os/video-intelligence/*` and `/api/video/*`
- **Dashboard Studio**: Web GUI at `#video-intelligence`
