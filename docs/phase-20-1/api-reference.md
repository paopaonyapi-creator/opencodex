# Phase 20.1 API & WebMCP Reference — Smart Queue & Auto Cloud Burst

## 1. REST Management Endpoints

All Smart Queue endpoints are mounted under `/api/generation/smart-queue/*` and aliased under `/api/v1/smart-queue/*`. They require an active dashboard session or admin token.

### `GET /api/generation/smart-queue/status`
Returns high-level status of the Smart Queue subsystem, including pause state, current burst mode, active scale plan, provider dispatch lanes, and recent snapshots.

**Response (200 OK):**
```json
{
  "enabled": true,
  "paused": false,
  "burstMode": "assisted",
  "activePlan": {
    "id": "plan_1234567890",
    "desiredTotalSlots": 3,
    "desiredCloudSlots": 2,
    "decision": "BURST_RECOMMENDED",
    "status": "pending",
    "estimatedDrainBefore": 1200,
    "estimatedDrainAfter": 400,
    "estimatedBatchCost": 0.49
  },
  "providers": [
    {
      "providerId": "comfyui-local",
      "availableSlots": 1,
      "maxSlots": 2,
      "leases": [
        { "slotIndex": 0, "jobId": "job-001", "attemptId": "att-1", "expiresAt": 1757230000000 }
      ]
    }
  ],
  "snapshots": [...]
}
```

---

### `POST /api/generation/smart-queue/pause` & `POST /api/generation/smart-queue/resume`
Pauses or resumes the dispatching of new jobs to providers. In-flight jobs continue running until completion.

**Response (200 OK):**
```json
{
  "success": true,
  "paused": true,
  "message": "Smart Queue dispatch paused"
}
```

---

### `POST /api/generation/smart-queue/burst-mode`
Dynamically changes the cloud burst mode.

**Request Body:**
```json
{
  "mode": "auto" // "off" | "manual" | "assisted" | "auto"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "burstMode": "auto"
}
```

---

### `POST /api/generation/smart-queue/plans/:id/approve` & `reject`
Approves or rejects a pending scale-out plan in `MANUAL` or `ASSISTED` mode. When approved, Pao immediately triggers RunPod pod provisioning to handle the burst.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Scale plan approved and 2 cloud GPU(s) provisioned"
}
```

---

### `POST /api/generation/smart-queue/reconcile`
Forces an immediate reconciliation cycle between native ComfyUI provider queues and the Pao SQLite database.

**Response (200 OK):**
```json
{
  "success": true,
  "reconciledCount": 1,
  "records": [
    {
      "nativePromptId": "ext-1",
      "mismatchType": "untracked_prompt",
      "resolutionStatus": "ignored",
      "actionTaken": "Preserved read-only: untracked non-Pao prompt ignored"
    }
  ]
}
```

---

## 2. WebMCP Agentic Tools

The following 7 tools are registered in `gui/src/webmcp/registry.ts`:

1. **`pao_get_smart_queue_status`**: Retrieve current smart queue status, burst mode, and provider dispatch lanes.
2. **`pao_set_burst_mode`**: Update cloud burst scheduling mode (`off`, `manual`, `assisted`, `auto`).
3. **`pao_pause_smart_queue_dispatch`**: Halt dispatching of queued jobs to GPU workers.
4. **`pao_resume_smart_queue_dispatch`**: Resume bounded job dispatching to GPU workers.
5. **`pao_approve_scale_plan`**: Approve and execute a pending cloud burst scale plan.
6. **`pao_reject_scale_plan`**: Reject a pending cloud burst scale plan.
7. **`pao_reconcile_smart_queue`**: Trigger immediate reconciliation between Pao and ComfyUI queues.
