# Phase 20 Architecture & State Machine

## Subsystem Interaction

```mermaid
sequenceDiagram
    participant User as Operator / Agent
    participant Orch as Generation Orchestrator
    participant Guard as FinOps Cost Guard
    participant Router as Workload Router
    participant Lifecycle as Pod Lifecycle Manager
    participant RunPod as RunPod Cloud API
    participant Comfy as Remote / Local ComfyUI

    User->>Orch: Submit Generation Job (Prompt, Model, Params)
    Orch->>Router: Analyze Workload (VRAM, Runtime, Routing Mode)
    Router-->>Orch: Route Decision (Target Provider, GPU Type, Est. Cost)
    
    alt Target is Cloud
        Orch->>Guard: Validate Budget (Job Cost vs Daily/Monthly Cap)
        Guard-->>Orch: Approved (or Denied / Circuit Breaker)
        
        alt Warm Pod Exists
            Orch->>Lifecycle: Lease Warm Pod
        else Provision New Pod Needed
            Orch->>Lifecycle: Provision On-Demand Pod
            Lifecycle->>RunPod: GraphQL podFindAndDeployOnDemand
            RunPod-->>Lifecycle: Pod Created (IP, Port, Status)
        end
        
        Orch->>Comfy: Dispatch Prompt via WebSocket / API
        Comfy-->>Orch: Render Progress & Image Output
        Orch->>Orch: Download Asset & Verify SHA-256 Checksum
        Orch->>Guard: Record Spend in Ledger
    else Target is Local
        Orch->>Comfy: Dispatch to Local ComfyUI (127.0.0.1:8188)
        Comfy-->>Orch: Render Output Directly to Storage
    end

    Orch-->>User: Job Complete (Asset ID, License, Explainability Metadata)
```

## Pod Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> PROVISIONING: Launch Request
    PROVISIONING --> RUNNING: Pod Boot & ComfyUI Healthy
    PROVISIONING --> TERMINATED: Provisioning Timeout / Error
    
    RUNNING --> BUSY: Job Assigned
    BUSY --> RUNNING: Job Completed / Idle
    
    RUNNING --> STOPPED: Idle Timeout (10m)
    STOPPED --> RUNNING: Resume Workload
    
    STOPPED --> TERMINATED: Inactivity Limit (60m)
    RUNNING --> TERMINATED: Emergency Stop / Manual Delete
    BUSY --> TERMINATED: Force Emergency Stop
    
    TERMINATED --> [*]
```

## Database Schema (v7)

### `generation_cloud_leases`
- `id` (TEXT PRIMARY KEY)
- `runpod_pod_id` (TEXT UNIQUE)
- `provider` (TEXT NOT NULL, default 'runpod')
- `gpu_type` (TEXT NOT NULL)
- `cost_per_hour` (REAL NOT NULL)
- `state` (TEXT NOT NULL: `PENDING`, `RUNNING`, `STOPPED`, `TERMINATED`)
- `comfy_endpoint` (TEXT)
- `last_heartbeat_at` (INTEGER NOT NULL)
- `idle_since` (INTEGER)
- `created_at` (INTEGER NOT NULL)

### `generation_spend_ledger`
- `id` (TEXT PRIMARY KEY)
- `job_id` (TEXT NOT NULL)
- `provider` (TEXT NOT NULL)
- `pod_id` (TEXT)
- `gpu_type` (TEXT NOT NULL)
- `runtime_seconds` (INTEGER NOT NULL)
- `cost_amount` (REAL NOT NULL)
- `created_at` (INTEGER NOT NULL)
