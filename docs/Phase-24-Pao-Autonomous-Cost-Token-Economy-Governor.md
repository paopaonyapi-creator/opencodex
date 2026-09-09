# Phase 24 — Pao-hubPro Autonomous Cost & Token Economy Governor (ACEG) Specification

## 1. Vision and Strategic Purpose

Following the operational command plane established in **Phase 23 (Autonomous Operations & Self-Healing Fleet)**, Pao-hubPro requires financial intelligence and resource governance:
> **An autonomous financial governance and token economy layer capable of tracking multi-dimensional AI budgets (per agent, project, campaign, and global daily/monthly quotas), monitoring cost burn rate velocities ($/hour), enforcing dynamic circuit-breaker safeguards, and autonomously optimizing model tiers (Ultra, Balanced, Local/Free) based on task ROI.**

```text
                  ┌─────────────────────────────────────────────────────────────┐
                  │          Pao Autonomous Cost & Token Economy Plane          │
                  └──────────────────────────────┬──────────────────────────────┘
                                                 │
                   ┌─────────────────────────────┼─────────────────────────────┐
                   ▼                             ▼                             ▼
    ┌─────────────────────────────┐┌───────────────────────────┐┌─────────────────────────────┐
    │     Budget Ledger & Quota   ││     Burn Guard & Velocity ││     Model Tier Optimizer    │
    │  (Agent, Project, Global)   ││  (Spike detect, Breakers) ││  (ROI Downgrade, Savings)   │
    └──────────────┬──────────────┘└─────────────┬─────────────┘└──────────────┬──────────────┘
                   │                             │                             │
                   └─────────────────────────────┼─────────────────────────────┘
                                                 │
                                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │                  Autonomous Safeguard Router                │
                  │  ├── Normal Spend: Fast & Ultra Models (Claude 3.5 / o1)    │
                  │  ├── Velocity Alert: Throttling & Proactive Model Tier Drop │
                  │  └── Hard Limit Trip: Force Tier 3 / Local / Ollama         │
                  └──────────────────────────────┬──────────────────────────────┘
                                                 │
                                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │           Real-time Economy Console (`#economy`)            │
                  │  (Financial Meters, Burn Velocity, Model Tiers, Audit Log)  │
                  └─────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Pillars

1. **Multi-Dimensional Budget Ledger**:
   - Manages hierarchical budgets across:
     - `global_daily` & `global_monthly`: Hard limits and soft notification boundaries.
     - `project`: Dedicated budgets for initiatives (e.g. `youtube-god-os`, `adobe-stock-campaign`).
     - `agent`: Quotas per autonomous agent specialist (e.g. `pao-coder`, `stock-creator`, `reviewer-council`).
   - Tracks debit amounts, token consumption (input, output, cache-read, cache-write), and percentage utilization.

2. **Burn Guard Velocity Engine**:
   - Computes rolling burn velocity in USD per hour ($/hr) and projected end-of-month spend.
   - Triggers dynamic actions:
     - **Soft Alert (80% utilization)**: Warning notification logged.
     - **Velocity Spike ($>3.0\times$ normal burn rate)**: Activates rate throttling.
     - **Hard Cap Reached (100% utilization)**: Circuit breaker trips $\rightarrow$ Automatically forces model downgrade or blocks non-critical calls.

3. **Autonomous Model Tier Optimizer**:
   - Categorizes models into 3 economic tiers:
     - **Tier 1 (Ultra / Frontier)**: Claude 3.5 Sonnet, GPT-4o, OpenAI o1 ($3.00 - $15.00 / Mtok).
     - **Tier 2 (Balanced / Efficient)**: Claude 3.5 Haiku, Gemini 1.5 Flash, DeepSeek-V3 ($0.15 - $1.00 / Mtok).
     - **Tier 3 (Local / Free)**: Local Ollama, Qwen 2.5 32B, DeepSeek-R1 Local ($0.00 / Mtok).
   - Maps task complexity (e.g. simple query vs complex refactor vs creative video prompt) to the optimal tier, calculating accumulated cost savings.

---

## 3. Module Layout

```text
src/agent-os/economy/
├── types.ts            # Budget schemas, transaction receipts, tier classifications
├── budget-ledger.ts    # Multi-dimensional budget quotas, debits, and balance tracking
├── burn-guard.ts       # Velocity calculator, spike detection, circuit breaker
├── model-optimizer.ts  # Task ROI evaluator, tier recommendation, savings receipts
└── index.ts            # Public module singletons and registry
```

---

## 4. REST Management API Endpoints

Under `/api/agent-os/economy/`:
- `GET /budgets` — List all active budgets with limits, spend, and utilization
- `POST /budgets` — Create or update budget quota allocation
- `GET /transactions` — Audit ledger of recorded token costs and savings receipts
- `POST /transactions/record` — Record a completed transaction with token usage
- `GET /burn-guard` — Query live burn rate ($/hr), velocity alerts, and safeguard status
- `POST /optimize-route` — Query governor for recommended model tier given task & remaining budget
