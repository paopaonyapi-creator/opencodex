# Phase 22 — Pao-hubPro Autonomous Change Control (ACC) Specification

## 1. Vision and Purpose

In Pao-hubPro, knowledge grounding (Phase 21) established the system's ability to understand **"what the project is, what it contains, and why it was built that way."** 

Phase 22 — **Pao Autonomous Change Control (ACC)** takes the next decisive leap:
> **Autonomous Change Control allows the system to know what should change, how it should change, verify the change in an isolated sandbox, calculate blast radius, orchestrate multi-agent consensus, and know exactly when to proceed autonomously versus when to pause and await human confirmation.**

```text
  ┌─────────────────────────────────────────────────────────────┐
  │                 Knowledge Grounding (Phase 21)              │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │         1. Change Proposal & Intent Identification          │
  │     (AST Diff, Context Analysis, Intent Classification)     │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │         2. Blast Radius & Dependency Impact Analysis        │
  │    (Import graph depth, boundary checks, risk scoring R0-R5)│
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │         3. Isolated Sandboxed Worktree Execution            │
  │   (Ephemeral git worktree, typecheck, lint, test, privacy)  │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │    4. Reviewer Council Multi-Agent Consensus (Phase 20.13)  │
  │   (Independent LLM families, security audit, quorum voting) │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │    Autonomous Decision Gate  │
                  └──────────────┬───────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         │                                               │
         ▼                                               ▼
  [Risk <= R1 & 100% Green]                    [Risk >= R2 or Boundary]
  ┌──────────────────────────────┐              ┌──────────────────────────────┐
  │   Autonomous Fast-Forward    │              │      Freeze in Approval      │
  │      & Safe Merge to dev     │              │    Draft PR & Wait Human     │
  └──────────────┬───────────────┘              └──────────────┬───────────────┘
                 │                                             │
                 ▼                                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │       5. Post-Merge Stabilization Watchdog & Rollback       │
  │    (Monitors runtime health, auto-reverts on regression)    │
  └─────────────────────────────────────────────────────────────┘
```

---

## 2. Core Principles & Governance Guardrails

1. **Strict Human Gate for High Risk**:
   - Changes classified as **R2 (Medium)** through **R5 (Hyper-Critical)**, or any change touching sensitive boundaries (Authentication, Secrets, Billing, Database Schema, Core Proxy Lifecycle, Minimal-Code Governance rules) **MUST NEVER** be merged autonomously. They must transition to `awaiting_approval`.
   - Only **R0 (Trivial/Docs)** and **R1 (Low/Isolated fixes with comprehensive tests)** may be eligible for autonomous merge if and only if all automated gates and Reviewer Council quorum pass.

2. **Zero-Side-Effect Sandboxing**:
   - All compilation, execution, and test suites run in isolated Git worktrees under `.tmp/worktrees/acc-*` with dedicated environment boundaries.
   - Worktrees are safely reclaimed upon execution completion or failure.

3. **Vendor Independence Invariant**:
   - Reviewer Council evaluations must strictly enforce the rule from Phase 20.13: council members evaluating high-risk changes cannot belong to the same LLM provider family (e.g., Anthropic + OpenAI + Google + Local).

4. **Self-Healing & Watchdog Revert**:
   - Every autonomous merge is placed into a `stabilization` watch window (configurable, default 300s).
   - If health probes fail or crash metrics spike, the Watchdog executes an automated rollback to the pre-merge commit.

---

## 3. Architecture & Module Structure

The Autonomous Change Control engine lives under `src/agent-os/change-control/`:

```text
src/agent-os/change-control/
├── types.ts          # Domain definitions, risk tiers, proposal lifecycle states
├── analyzer.ts       # Git diff inspection, blast radius scoring, risk classifier
├── sandbox.ts        # Ephemeral worktree manager & test runner
├── controller.ts     # Master coordinator and decision gate engine
├── watchdog.ts       # Post-merge health observation and automated rollback
└── index.ts          # Public exports and lifecycle binding
```

---

## 4. Blast Radius & Risk Tier Rating

The **Blast Radius Score** ($0.0 \le B \le 1.0$) is calculated as:

$$B = \min\left(1.0, \, 0.2 \cdot \text{directFiles} + 0.05 \cdot \text{transitiveDependents} + 0.4 \cdot \text{boundaryPenalty}\right)$$

### Risk Tier Scale:
- **R0 (Trivial)**: Pure markdown documentation, comments, typos, asset updates. ($B < 0.1$)
- **R1 (Low)**: Isolated bugfix or unit test in a single leaf module without downstream dependents. ($B < 0.25$)
- **R2 (Medium)**: Component-level feature additions with controlled dependencies. ($0.25 \le B < 0.5$)
- **R3 (High)**: Shared library changes, API schema additions, multi-subsystem refactor. ($0.5 \le B < 0.75$)
- **R4 (Critical)**: Core proxy path touches, authentication/tokens, database schema migrations. ($0.75 \le B < 0.9$)
- **R5 (Hyper-Critical)**: Cryptographic routines, financial billing, release automation, minimal-code governance layer. ($B \ge 0.9$)

---

## 5. Decision Gate Matrix

| Risk Tier | Blast Radius | Auto-Merge Eligible? | Requirements for Auto-Merge |
| :---: | :---: | :---: | :--- |
| **R0** | $< 0.10$ | ✅ **YES** | Typecheck + Lint + Boundary test pass |
| **R1** | $< 0.25$ | ✅ **YES** | 100% Tests Green + Council R1 Approval + Zero Boundary Touches |
| **R2** | $0.25 - 0.49$ | ❌ **NO** | Requires Human Operator Sign-Off + 2 Independent Council Reviews |
| **R3** | $0.50 - 0.74$ | ❌ **NO** | Requires Human Operator Sign-Off + 3 Independent Council Reviews |
| **R4** | $0.75 - 0.89$ | ❌ **NO** | Human Sign-Off + Security Auditor Veto Power + Staging Smoke Test |
| **R5** | $\ge 0.90$ | ❌ **NO** | Human Sign-Off + Full Council Unanimous + Dual Operator Auth |

---

## 6. Management REST API

Under `/api/change-control/`:
- `POST /api/change-control/proposals` — Propose change from branch/commit/diff
- `GET /api/change-control/proposals` — List all change control proposals
- `GET /api/change-control/proposals/:id` — Inspect proposal, blast radius, test results, and reviews
- `POST /api/change-control/proposals/:id/sandbox` — Trigger isolated worktree testing
- `POST /api/change-control/proposals/:id/audit` — Trigger Reviewer Council consensus
- `POST /api/change-control/proposals/:id/gate` — Evaluate decision gate (auto-merge or freeze)
- `POST /api/change-control/proposals/:id/approve` — Human operator manual approval
- `POST /api/change-control/proposals/:id/reject` — Human operator manual rejection
- `POST /api/change-control/proposals/:id/rollback` — Trigger emergency rollback

---

## 7. GUI Operations Console (`#change-control`)

Features in React single-page app:
1. **Pipeline Stepper**: Real-time visualization of stage (`Proposal` → `Blast Radius` → `Sandbox` → `Council` → `Decision Gate` → `Merge/Watchdog`).
2. **Blast Radius Radar**: Visual representation of touched files, dependency depth, and critical path warnings.
3. **Risk Tier Meter**: Interactive badge displaying tier R0–R5 and risk justification.
4. **Council Verdict Matrix**: Live review cards showing independent LLM reviewer statements and consensus score.
5. **Action Bar**: "Run Sandbox", "Run Review", "Approve & Merge", "Emergency Rollback".
