# Pao-hubPro Reviewer Council & Correlation Guard

> **Multi-Model Review Consensus & Correlation Detection**  
> **Updated:** 2026-09-17

## 1. Overview

The Pao-hubPro Reviewer Council acts as an authoritative, multi-agent adjudication body for code reviews, architectural decisions, and security quality gates.

```text
ChangeSet / Patch
        │
        ▼
Reviewer Council
  ├── Reviewer 1 (claude-3-7-sonnet)  ──> Vote: PASS
  ├── Reviewer 2 (gpt-4o)             ──> Vote: PASS
  └── Reviewer 3 (gemini-2.0-flash)   ──> Vote: PASS
        │
        ▼
Reviewer Correlation Guard
  * Checks distinct model families (claude, gpt-4, gemini)
  * Verifies quorum independence
        │
        ▼
Consensus Verdict: PASS
```

---

## 2. Reviewer Correlation Guard (Phase 20.85 §43)

### The Correlation Vulnerability
When multiple reviewer aliases resolve to identical underlying model weights or the same provider family (for example, `gpt-4o` and `chatgpt-4o-latest`), their reasoning is strongly correlated. Treating them as independent votes creates false confidence and consensus illusions.

### Correlation Guard Enforcement
1. **Model Family Inspection:** The guard inspects the resolved `model_family` of each reviewer vote.
2. **Minimum Distinct Families:** For High and Critical risk tasks, a minimum of 2 distinct model families is required.
3. **Vote Weight Dilution:** If two reviewers share a model family, each vote's weight is diluted ($1 / N$), ensuring a single family cannot dominate the consensus.
4. **Audit Persistence:** Every reviewer consensus run is logged into `core_reviewer_runs` and `core_reviewer_votes` with correlation flags.

---

## 3. Consensus Decision Ladder

- **`BLOCK`:** Emitted if any reviewer identifies a critical security vulnerability or if a hard policy is violated. Immediate fail-closed merge blocker.
- **`CHANGES_REQUIRED`:** Emitted if open blocking findings exist.
- **`PASS_WITH_NOTES`:** Emitted if non-blocking suggestions or minor defects exist.
- **`PASS`:** Emitted if clean consensus is achieved across independent model families.
