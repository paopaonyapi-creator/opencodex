# Video Intelligence: WebMCP & Agent-to-Agent Tool Reference

## 1. Overview
The Video Intelligence subsystem exposes a standardized WebMCP tool suite allowing AI agents (Codex, Claude Code, Reviewer Council) to inspect, probe, transcribe, and review video assets autonomously.

## 2. Tool Reference

| Tool Name | Risk Tier | Description |
| :--- | :--- | :--- |
| `video_analyze` | `R1` | Full multi-stage pipeline analysis (URL or local file) |
| `video_inspect` | `R0` | Probes media format, dimensions, orientation, codecs, duration |
| `video_transcribe` | `R0` | Speech transcription with segment and word timestamps |
| `video_extract_frames` | `R0` | Scene cut detection and hero keyframe selection |
| `video_analyze_hook` | `R0` | 0–10s Hook Microscope evaluation and retention scoring |
| `video_analyze_pacing` | `R0` | Cuts-per-minute (CPM) and rhythm profile calculation |
| `video_stock_qc` | `R0` | Automated Adobe Stock QC review and verdict generation |
| `video_debug_screen` | `R0` | Screen recording analysis for UI glitches and failure states |
| `video_get_report` | `R0` | Retrieves markdown summary and structured JSON artifact |
| `video_list_jobs` | `R0` | Lists and filters active and completed video analysis jobs |
| `video_cancel_job` | `R1` | Cancels an ongoing or queued job |
