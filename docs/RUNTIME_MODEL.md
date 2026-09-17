# Pao-hubPro Runtime Model & Lifecycle

> **Session, Task & Worker Execution State Machine**  
> **Updated:** 2026-09-17

## 1. Runtime State Model

```mermaid
stateDiagram-v2
    [*] --> Queued: Task Enqueued
    Queued --> Claimed: Worker Acquired Lease
    Claimed --> Running: Execution Started
    
    Running --> Evaluated: Output Generated
    Evaluated --> Gated: Policy & Security Review
    
    Gated --> Completed: Gate PASS
    Gated --> ReviewRequired: Gate REQUIRE_FIX / WARN
    Gated --> Blocked: Gate BLOCK
    
    ReviewRequired --> Running: Revision Submitted
    ReviewRequired --> Escalate: Max Rounds Exceeded
    
    Completed --> [*]
    Blocked --> [*]
    Escalate --> HumanIntervention
```

---

## 2. Session Persistence & Checkpointing

- Tasks persist state transitions in SQLite (`core_sessions`, `ar_tasks`, `cr_sessions`).
- Reversible mutations record diff snapshots, allowing instant rollback in the event of test failures or policy rejections.
- Session heartbeats detect orphaned worker leases after 30 seconds of inactivity and trigger automated reclamation.
