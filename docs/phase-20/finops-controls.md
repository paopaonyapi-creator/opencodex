# FinOps Cost Guardrails & Protection Controls

## Core Principles

The FinOps Cost Guard ensures that automated GPU scaling never results in runaway cloud spend. It operates as an active gate before any cloud pod is provisioned or leased.

```
                  ┌──────────────────────────────┐
                  │    Incoming Generation Job   │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │   Circuit Breaker Tripped?   │──Yes──► [REJECT / FALLBACK]
                  └──────────────┬───────────────┘
                                 │ No
                                 ▼
                  ┌──────────────────────────────┐
                  │  Within Hourly GPU Max Rate? │──No───► [REJECT / FALLBACK]
                  └──────────────┬───────────────┘
                                 │ Yes
                                 ▼
                  ┌──────────────────────────────┐
                  │    Within Daily Budget?      │──No───► [REJECT / FALLBACK]
                  └──────────────┬───────────────┘
                                 │ Yes
                                 ▼
                  ┌──────────────────────────────┐
                  │   Within Monthly Budget?     │──No───► [REJECT / FALLBACK]
                  └──────────────┬───────────────┘
                                 │ Yes
                                 ▼
                         [APPROVE JOB]
```

## Configurable Guardrails

| Setting | Env Var | Default | Action on Breach |
| :--- | :--- | :--- | :--- |
| Daily Spending Limit | `PAO_RUNPOD_DAILY_BUDGET` | `$15.00` | Rejects cloud job; queues for local execution |
| Monthly Spending Limit | `PAO_RUNPOD_MONTHLY_BUDGET` | `$100.00` | Freezes cloud provisioning until reset |
| Max Cost Per Job | `PAO_RUNPOD_MAX_COST_PER_JOB` | `$2.00` | Flags job as exceeding threshold |
| Max Hourly GPU Price | `PAO_RUNPOD_MAX_HOURLY_GPU_PRICE`| `$1.50/hr` | Skips expensive instances during allocation |
| Idle Auto-Stop Timeout | `PAO_RUNPOD_AUTO_STOP_IDLE_MINUTES`| `10 min` | Automatically stops pods when idle |
| Idle Auto-Terminate Timeout | `PAO_RUNPOD_AUTO_TERMINATE_IDLE_MINUTES`| `60 min`| Terminates stopped pods to prevent storage fees |

## Emergency Stop Cutoff

In the event of an unexpected workload loop or emergency:
1. **Via Dashboard**: Navigate to **AI Studio** → **Compute & Grid** and click **Emergency Stop All**.
2. **Via WebMCP / Agent**: Call `emergency_stop_cloud_pods` with confirmation.
3. **Via API**:
   ```bash
   curl -X POST http://127.0.0.1:4040/api/generation/compute/emergency-stop \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```
This immediately issues GraphQL terminate mutations to all running and stopped RunPod pods associated with this tenant, stopping all billing instantly.
