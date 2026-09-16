# Runbook: Phase 20.24 Media Acquisition & MCP Engine Operations & Recovery

## 1. Subsystem Overview
Phase 20.24 introduces the local media acquisition engine for Pao-hubPro, designed with an external process adapter boundary (GPL-3.0 clean separation) for OmniGet, yt-dlp, and FFmpeg.

## 2. Health Check
Run diagnostic inspection from CLI:
```bash
bun run scripts/media-status.ts
```
Or via HTTP REST API:
```bash
curl http://127.0.0.1:43117/api/agent-os/media/health
```

Expected status:
- `native`: `healthy`
- `omniget`: `healthy` if installed in PATH, otherwise `offline`
- `ytdlp`: `healthy` if installed in PATH, otherwise `offline`

## 3. Operational Guardrails
- **SSRF Immunity**: The subsystem strictly forbids localhost (`127.0.0.1`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and cloud metadata (`169.254.169.254`).
- **Adobe Stock Safety**: Any acquired media flagged as `usageClass: "research_reference"` has `exportToStock = false`. Research assets cannot be pushed into stock production.
- **Process Isolation**: Only binaries on the allowlist (`omniget`, `yt-dlp`, `ffmpeg`, `ffprobe`, `whisper`) can be executed. No arbitrary shell strings are permitted.

## 4. Troubleshooting & Recovery

### Issue: "OmniGet binary offline or not found"
**Cause**: OmniGet CLI is not in the system `PATH`.
**Resolution**:
1. Download or install OmniGet on the host.
2. Add the directory containing `omniget.exe` or `omniget` to your system `PATH`.
3. The subsystem automatically falls back to `yt-dlp` or `native` mode without crashing.

### Issue: "Rate limit encountered (HTTP 429)"
**Cause**: Domain has throttled downloads.
**Resolution**:
- The queue engine automatically handles HTTP 429 with exponential backoff (5s, 15s, 45s).
- Domain concurrency is capped to 1 concurrent job by default to prevent bans.

### Issue: "Job stuck in running state"
**Cause**: Network stalled or external process hanging.
**Resolution**:
- Process runner has an active timeout (default 300s).
- Force cancel via REST API or MCP tool:
```bash
curl -X POST http://127.0.0.1:43117/api/agent-os/media/jobs/cancel -H "Content-Type: application/json" -d '{"id": "<JOB_ID>"}'
```
Or invoke MCP tool `media_cancel(jobId: "<JOB_ID>")`.
