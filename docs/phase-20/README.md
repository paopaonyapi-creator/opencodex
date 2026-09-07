# Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router

## Overview

Phase 20 elevates Pao AI Generation Studio from a single-machine local workstation setup to an intelligent, multi-node hybrid generation grid. It bridges local ComfyUI installations with cloud GPU infrastructure powered by RunPod, governed by rigorous FinOps cost controls.

```
                  ┌──────────────────────────────────────────────┐
                  │          Pao AI Generation Studio            │
                  │   (Interactive GUI / WebMCP Agent / API)     │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       Workload Analyzer & Cost Guard         │
                  │  - Estimates VRAM & Job Runtime              │
                  │  - Checks Daily/Monthly Spend & Price Limits │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │   Intelligent GPU Router    │
                          └──────┬───────────────┬──────┘
                                 │               │
                     Local Node  │               │ Cloud Burst
                                 ▼               ▼
                       ┌────────────────┐ ┌───────────────────┐
                       │  Local ComfyUI │ │  RunPod Pod Fleet │
                       │  (RTX 4090/etc)│ │ (Warm / On-Demand)│
                       └────────────────┘ └─────────┬─────────┘
                                                    │
                                                    ▼
                                          ┌───────────────────┐
                                          │ SHA-256 Verified  │
                                          │ Remote Asset Sync │
                                          └───────────────────┘
```

## Key Features

1. **Intelligent Multi-GPU Workload Routing**:
   - Analyzes checkpoint model size (Flux, SD3.5, SDXL, SD1.5), resolution, LoRA stacks, and batch count.
   - 5 Routing Modes:
     - `AUTO`: Routes locally if local GPU has sufficient VRAM and low queue; bursts to warm/on-demand cloud if overloaded or model requires heavy VRAM.
     - `LOCAL_ONLY`: Never spawns or targets cloud pods.
     - `WARM_POD_FIRST`: Prioritizes already running cloud pods before spinning new ones.
     - `BURST_ON_QUEUE`: Triggers cloud scaling when local queue depth exceeds threshold.
     - `FORCE_CLOUD`: Always routes to cloud GPUs.

2. **FinOps Cost Guard**:
   - Daily and monthly budget hard caps.
   - Maximum price-per-job and price-per-hour safeguards.
   - Immediate circuit breaker cutoff on allocation anomalies or budget limits.
   - One-click Emergency Stop to terminate all active cloud pods.

3. **Autonomous Pod Lifecycle**:
   - Auto-stops pods after 10 minutes of idle time.
   - Auto-terminates stopped pods after 60 minutes.
   - Automated heartbeat monitoring and lease expiration tracking.

4. **Remote-to-Local Asset Sync**:
   - Automatically transfers rendered images and videos from RunPod into local workspace storage.
   - Computes SHA-256 hashes to guarantee byte-for-byte data integrity.
   - Preserves prompt provenance, seed, and commercial stock licensing parameters.
