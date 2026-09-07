# Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator

Phase 19 turns Pao-hubPro into an AI production operating layer: jobs are
queued persistently, executed against a real ComfyUI endpoint, reviewed by the
Reviewer Council building blocks, enriched with Adobe Stock metadata, and
exported as stock-safe packages with manifests and CSV.

## Architecture

```
Dashboard (AI Studio) / WebMCP tools
  → /api/generation/*  (management auth plane, no new credential class)
    → persistent job queue (SQLite, atomic claim, explicit state machine)
      → orchestrator worker (heartbeat, retry with backoff, cancel, recovery)
        → ComfyUI HTTP adapter (/prompt, /history, /view, /interrupt)
          → asset storage (UUID files, SHA-256, corruption checks)
            → Reviewer Council (reuses Phase 16 validators + rules)
              → Adobe Stock metadata → CSV → manifest export
```

New tables live in `agent-os.sqlite3` schema v6: `gen_projects`,
`gen_providers`, `gen_workflows`, `gen_models`, `gen_loras`, `gen_jobs`,
`gen_job_events`, `gen_assets`, `gen_reviews`, `gen_stock_metadata`,
`gen_export_packages`, `gen_audit_log`. The migration is additive and runs on
first open; existing Phase 2–18 tables are untouched.

## Key invariants

- No global busy flag: the SQLite queue with atomic conditional UPDATE claim is
  the only scheduling mechanism (spec sections 5, 7, 99).
- Job state machine transitions are explicit (`JOB_TRANSITIONS`); failure walks
  stage → failed → queued with exponential backoff, and only retryable error
  codes retry (spec sections 6, 55).
- `seed = -1` resolves to a concrete seed before queueing and is stored on the
  job and every asset (spec section 92).
- ComfyUI is a configured provider (`PAO_COMFYUI_BASE_URL`, default
  `http://127.0.0.1:8188`), never a hardcoded path in business logic (spec
  sections 8, 18).
- ComfyUI offline degrades generation only: the proxy, dashboard, and all other
  subsystems keep working; health shows offline (spec sections 7, 66, 91).
- Stock-ready export requires review + metadata + non-blocked council decision
  (stock safety gate, spec section 84); otherwise exports are manual-review
  only with explicit intent.
- CORS/auth: generation endpoints sit behind the existing management plane; no
  wildcard CORS was added; mutations require an admin/gui principal.

## API surface (`/api/generation/*`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | subsystem health, queue depth, provider status |
| GET/POST | /providers, /providers/:id/health | provider registry + health probe |
| GET/POST | /workflows, /workflows/:id, /workflows/:id/validate, /workflows/:id/enable | workflow registry |
| GET/POST | /models, /loras | model + LoRA registries |
| GET/POST | /projects | generation projects |
| POST/GET | /jobs | create (Idempotency-Key supported, batch splitting >4), list |
| GET | /jobs/:id, /jobs/:id/events | detail + SSE realtime events |
| POST | /jobs/:id/cancel, /jobs/:id/retry | queue control |
| GET/POST/PATCH/DELETE | /assets… | gallery, upload, favorite/rating, soft delete |
| POST | /assets/:id/review, /generate-metadata, /export | council, metadata, gated export |
| GET | /audit | audit trail |
| POST | /validate | subsystem validation report |

## WebMCP tools

`list_generation_workflows` (R0), `start_generation_job` (R2),
`get_generation_status` (R0), `cancel_generation_job` (R2). All go through the
same management API and auth gate as the human UI — no bypass path.

## Setup

1. Install and start ComfyUI at `http://127.0.0.1:8188` (or set
   `PAO_COMFYUI_BASE_URL`).
2. Copy `.env.example` values you want to override.
3. Start Pao-hubPro; migration v6 applies automatically.
4. Open AI Studio → Providers → Test Connection.
5. AI Studio → Workflows → Validate (the built-in `sdxl-text-to-image` seeds
   automatically; import more via `POST /api/generation/workflows`).
6. Generate: pick a workflow, enter a prompt, queue the job, watch the Queue
   tab (SSE progress), then review/export in Gallery or Stock Review.

## Known limitations

- LoRA application requires a workflow with a `loras` binding; workflows without
  one report the value as missing instead of silently dropping it.
- Video/audio/upscale execute through the same queue + adapter pattern, but only
  the image workflow ships built-in; register category workflows via the API.
- Near-duplicate detection is an exact-SHA-256 check; perceptual/CLIP similarity
  remains the Phase 16 engine for stock batches.
- The commercial score is resolution-driven until a vision analyzer is wired in.
- Multi-GPU routing selection is priority/health based; VRAM-aware scheduling is
  Phase 20 (the provider interface already supports it).
