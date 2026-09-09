# Phase 23 — Pao-hubPro Autonomous Operations & Self-Healing Fleet (AOF) Specification

## 1. Vision and Strategic Purpose

With the completion of **Knowledge Grounding (Phase 21)** and **Autonomous Change Control (Phase 22)**, Pao-hubPro possesses both deep semantic context and safe self-evolving change governance.

**Phase 23 — Pao Autonomous Operations & Self-Healing Fleet (AOF)** provides the operational command plane:
> **A unified, autonomous management layer capable of orchestrating a heterogeneous fleet of agents (Desktop, Cloud VM, Mobile, and Browser workers), tracking service-level objectives (SLOs) and error budgets, detecting infrastructure degradation, performing automated failovers with state checkpoints, and enabling cross-agent swarm operations.**

```text
                  ┌─────────────────────────────────────────────────────────────┐
                  │             Pao Fleet Operations Control Plane              │
                  └──────────────────────────────┬──────────────────────────────┘
                                                 │
                   ┌─────────────────────────────┼─────────────────────────────┐
                   ▼                             ▼                             ▼
    ┌─────────────────────────────┐┌───────────────────────────┐┌─────────────────────────────┐
    │       Fleet Coordinator     ││    Self-Healing Watchdog  ││      SLO & Burn Governor    │
    │ (Node register, heartbeats) ││  (Dropout recovery, auto) ││ (Error budget, shedding)    │
    └──────────────┬──────────────┘└─────────────┬─────────────┘└──────────────┬──────────────┘
                   │                             │                             │
                   └─────────────────────────────┼─────────────────────────────┘
                                                 │
                                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │           Unified Swarm Bus & Workload Scheduler            │
                  │  ├── Stock Production Fleet  ├── Browser Scraping Missions │
                  │  ├── SDLC Code Worktrees     ├── Mobile Agent Automations  │
                  └──────────────────────────────┬──────────────────────────────┘
                                                 │
                                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │          Real-time Operations Console (`#operations`)       │
                  │   (Fleet Topology, Health Meters, Error Budget, Failover)   │
                  └─────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Pillars

1. **Heterogeneous Fleet Management**:
   - Manages four distinct node topologies:
     - `local_desktop`: Local host processes with direct vision and native filesystem access.
     - `remote_worker`: Standalone daemon workers connecting over persistent WebSocket/HTTP (Phase 20.14).
     - `cloud_vm`: Auto-bursted Runpod/cloud GPU compute nodes.
     - `mobile_gateway`: Android ARTEMIS mobile agent devices (Phase 20.12).
   - Dynamic load balancing based on active concurrency, capability tags, and ping latency.

2. **Self-Healing & Failover Engine**:
   - Heartbeat thresholding:
     - Missed $> 15\text{s}$ $\rightarrow$ State: `degraded`.
     - Missed $> 30\text{s}$ $\rightarrow$ State: `offline` $\rightarrow$ Triggers automated failover.
   - Migrates in-flight retryable tasks to the next healthiest node using persistent state checkpoints.

3. **SLO & Error Budget Governor**:
   - Computes rolling 24-hour and 7-day availability percentages (Target: 99.9%).
   - Tracks remaining error budget in minutes.
   - Calculates burn rates: if burn rate $> 2.0$, triggers proactive traffic shedding and alerts.

4. **Swarm Bus**:
   - Decoupled pub/sub event bus facilitating cross-agent collaboration (e.g. Trend Researcher passes brief to Stock Factory, which invokes Video Producer, audited by Reviewer Council).

---

## 3. Module Layout

```text
src/agent-os/operations/
├── types.ts          # Fleet node interfaces, job states, SLO schemas, failover events
├── fleet-manager.ts  # Node registration, heartbeat monitor, capacity balancer
├── failover-engine.ts# Dropout detector, state migration, auto-reassignment
├── slo-governor.ts   # Availability calculator, error budget, burn rate governor
├── swarm-bus.ts      # Multi-agent event broadcast & coordination bus
└── index.ts          # Public module exports and runtime singletons
```

---

## 4. Node State Transition Machine

```text
   [Register] ──> ONLINE
                    │
            Heartbeat timeout > 15s
                    ▼
                 DEGRADED ──> [Heartbeat recovered] ──> ONLINE
                    │
            Heartbeat timeout > 30s
                    ▼
                 OFFLINE ──> [Failover Engine Migrates Jobs]
                    │
              [Deregister / Drain]
                    ▼
                 DRAINING ──> TERMINATED
```

---

## 5. REST API Endpoints

Under `/api/agent-os/operations/`:
- `GET /fleet` — List all registered fleet nodes with real-time stats
- `POST /fleet/register` — Register a new node with capability tags
- `POST /fleet/:id/heartbeat` — Node health heartbeat update
- `POST /fleet/:id/drain` — Gracefully drain active jobs for maintenance
- `GET /jobs` — List all jobs with status, priority, and node assignments
- `POST /jobs` — Dispatch or enqueue a new fleet job
- `GET /slo` — Query availability percentage, error budget minutes, and burn rate
- `GET /failovers` — Audit history of self-healing and recovery events
