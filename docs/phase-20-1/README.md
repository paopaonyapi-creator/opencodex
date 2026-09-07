# Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler

## Executive Summary

Phase 20.1 extends **Pao AI Generation Studio** (`Phase 19`) and the **Multi-GPU RunPod Router** (`Phase 20`) with an enterprise-grade Smart Queue & Auto Cloud Burst Scheduler. It transforms Pao into a high-capacity generation grid capable of handling massive job backlogs (e.g. 50+ concurrent requests) safely in SQLite without crashing local ComfyUI or overflowing GPU VRAM.

### Core Pillars

1. **SQLite Backlog Cushion**:
   Multi-job requests (such as 50 batch generations submitted simultaneously) are stored durably in Pao's SQLite ledger (`gen_jobs`). Only a bounded number of jobs are dispatched to ComfyUI at any one time, entirely eliminating ComfyUI server crashes, lost jobs, and memory exhaustion.

2. **Bounded Dispatch Window (1 Running + 1 Prefetch)**:
   For every active GPU/worker (local or RunPod), Pao strictly permits at most 2 jobs in flight:
   - **Slot 0**: Currently executing job.
   - **Slot 1**: Prefetched job queued in native ComfyUI, eliminating pipeline stall between generations.
   - Additional slots are blocked until Slot 0 completes and its lease is released.

3. **Batch Affinity Grouping & Warm Model Reuse**:
   Jobs with matching `(modelId, workflowFamily, runtimeClass)` are grouped into deterministic affinity batches. Providers that already have model weights warm in GPU VRAM receive an affinity priority boost (+10), minimizing slow checkpoint reloading.

4. **Runtime Predictor & Capacity Planning**:
   Predicts execution times per workflow family (SD1.5, SDXL, Flux, SD3.5, Video) and computes total backlog drain time. If drain time exceeds the target threshold (e.g., > 20 minutes) and backlog depth exceeds soft/hard limits, a scale plan is generated.

5. **FinOps-Gated Cloud Bursting**:
   Recommends or automatically provisions RunPod cloud GPUs based on the active `BurstMode` (`OFF`, `MANUAL`, `ASSISTED`, `AUTO`). All scale-out decisions are strictly validated against `CostGuard` daily and monthly budget caps.

6. **Automated Scale-In & Reaping**:
   When the queue clears, cloud pods are marked as draining, allowed to complete in-flight jobs, and stopped/terminated. The local ComfyUI provider (`comfyui-local`) is permanently exempt from scale-in and is never drained or stopped.

7. **Strict Non-Destructive Invariant**:
   Prompts originating outside Pao (`EXTERNAL` or `UNKNOWN` ownership) detected in native ComfyUI queues are strictly read-only: they are never cancelled, modified, interrupted, or deleted by Pao.

---

## Directory & Subsystem Map

- `src/agent-os/generation/smart-queue/`:
  - `types.ts`: Domain types for snapshots, batch groups, scale plans, leases, and reconciliations.
  - `observer.ts`: Real-time native ComfyUI `/queue` polling and ownership tagging.
  - `runtime-predictor.ts`: Heuristic and historical runtime prediction engine.
  - `batch-affinity.ts`: Deterministic affinity hashing and job sorting.
  - `capacity-planner.ts`: Drain time estimation and desired GPU slot calculation.
  - `burst-controller.ts`: Burst decision engine with hysteresis and cooldown windows.
  - `dispatch-window.ts`: Slot lease manager enforcing the 1-running + 1-prefetch rule.
  - `scale-in-controller.ts`: Safe pod draining and idle termination governor.
  - `queue-reconciler.ts`: State mismatch detector between SQLite and ComfyUI.
  - `smart-queue-controller.ts`: Master controller orchestrating all smart queue subsystems.
- `src/server/management/smart-queue-routes.ts`: REST management endpoints mounted on `/api/generation/smart-queue/*`.
- `gui/src/pages/AiStudio.tsx`: Smart Queue Hub in the Generation Studio UI.
- `gui/src/webmcp/registry.ts`: 7 WebMCP tools for AI agent interaction.
