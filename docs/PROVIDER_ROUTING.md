# Pao-hubPro Provider Routing & Budget Governance

> **Phase 20.85 OmniRoute Model Gateway Specifications**  
> **Updated:** 2026-09-17

## 1. Gateway Architecture

The Pao Model Gateway decouples business logic from commercial model strings through capability-aware semantic route groups:

```text
Agent / Workflow ---> Pao Policy Envelope ---> ModelGateway ---> Adapter ---> Inference Target
```

### Supported Route Groups
- **`coding-high`:** Quality-first coding; candidate chain: `claude-3-7-sonnet` -> `gpt-4o` -> `deepseek-coder`.
- **`coding-cheap`:** Cost-first coding; candidate chain: `deepseek-coder` -> `claude-3-5-haiku` -> `gpt-4o-mini` -> `ollama/deepseek-coder-v2`.
- **`private-local`:** Strict local execution; candidates: `ollama/deepseek-coder-v2`, `ollama/llama3.3`. Cloud fallback disabled.
- **`reviewer-independent`:** Multi-model consensus requiring $\ge 2$ distinct model families.
- **`fast-decision`:** Sub-second intent triage and classifier evaluation.

---

## 2. Hard Budget Governance

### Two-Layer Budget Control
1. **Pre-flight Check:** Rejects requests where estimated token cost exceeds `hardBudgetUsd`.
2. **Post-flight Deduction:** Tracks actual token consumption reported by provider headers.

### Zero-Zero Invariant
- Models with unknown pricing metadata are **denied by default** (`unknownPriceBehavior: "deny"`).
- Unknown prices are **never** treated as free ($0.00).

### Cumulative Retry Accounting Invariant
**Every retry and failover attempt is audited and billed toward the task budget.**  
If attempt 1 fails on a 429 after spending tokens, and attempt 2 succeeds on a secondary model, the cumulative task cost includes both attempts. The final report never hides failed attempt expenses.

---

## 3. Circuit Breaker & Failover Discipline

- **Failure Classes:**
  - `transient`: Eligible for bounded retry (max 2 attempts).
  - `rate_limit`: Exponential backoff (100ms..1600ms) or approved fallback.
  - `timeout`: Fallback to next approved candidate.
  - `permanent` (400, 401, capability mismatch): Immediate fail-closed abort.
- **Circuit Breaker States:**
  - `CLOSED`: Normal operation.
  - `OPEN`: 3 consecutive failures trip the breaker for 30 seconds.
  - `HALF_OPEN`: 5 probe requests verify health before returning to `CLOSED`.

---

## 4. Emergency Kill Switch & Direct Fallback

In the event of an OmniRoute service failure or container crash:
```bash
export PAO_OMNIROUTE_ENABLED=false
```
Setting this environment variable causes `PaoModelGateway` to switch instantaneously to `DirectGatewayAdapter`, executing in-process without pipeline interruption.
