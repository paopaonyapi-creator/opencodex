# Video Intelligence: Local-Only Mode & Privacy Enforcement

## 1. Overview
Pao-hubPro provides strict air-gapped privacy enforcement for internal footage, proprietary product demos, and confidential media files.

## 2. Configuration
Activate Local-Only mode globally via environment variable:
```env
VIDEO_INTELLIGENCE_LOCAL_ONLY=true
```
Or per-job via configuration:
```json
{
  "source": "./confidential_recording.mp4",
  "local_only": true
}
```

## 3. Strict Guardrails
When `local_only` is active:
1. **Zero External API Calls**: Blocks outgoing requests to OpenAI, Anthropic/Claude, Groq, or third-party transcription/VLM services.
2. **Local Transcription Cascade**: Forces Tier 1 native embedded captions or Tier 2 local `faster-whisper`.
3. **Local Probing & Extraction**: All media probing (`ffprobe`) and frame sampling run entirely on the local runtime.
4. **Data Redaction**: Sensitive dialogue text and source paths are kept strictly within local storage.
