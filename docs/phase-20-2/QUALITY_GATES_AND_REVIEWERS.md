# Quality Gates, Safe Implementation Runner & Reviewer Council

## 1. Quality Gates Architecture

Phase 20.2 replaces informal approvals with mandatory, automated Quality Gates. Progression between stages is blocked unless all prerequisite gate conditions are satisfied:

```text
/specify    →   SPEC_GATE        (Completeness, Acceptance Criteria defined, NFRs captured)
/plan       →   PLAN_GATE        (System boundaries, ADRs documented, risks evaluated)
/tasks      →   TASKS_GATE       (Acyclic DAG, all ACs mapped, estimates bounded)
/checklist  →   IMPLEMENT_GATE   (Prerequisites green, clean git working tree, constitution active)
/review     →   REVIEW_GATE      (Council consensus score >= 80%, ZERO critical findings)
/converge   →   CONVERGE_GATE    (100% AC verified with evidence, zero blocking review findings)
```

---

## 2. Software Reviewer Council

The Reviewer Council consists of 5 specialized personas that independently evaluate engineering changes:

| Reviewer Role | Focus Area | Veto Authority |
|---|---|---|
| **Architect** | System modularity, coupling, domain boundaries, ADR consistency | Warning / Conditional Pass |
| **Security** | Vulnerability scanning, secret leakage, auth invariants, sanitization | **CRITICAL VETO** |
| **QA** | Acceptance criteria verification, negative test coverage, edge cases | Conditional Pass / Fail |
| **CodeQuality** | Typing strictness, lint compliance, cyclomatic complexity | Warning / Conditional Pass |
| **SRE** | Telemetry logging, error recovery, idempotency, resource bounds | Warning / Conditional Pass |

### Critical Finding Veto Rule
If any reviewer flags an issue with `severity: "CRITICAL"`, the entire council verdict is immediately forced to `FAIL`, `hasBlockingFindings` is set to `true`, and progression to `/converge` is strictly blocked until rework is completed.

### Reviewer Independence
The author/implementer of a change cannot serve as a reviewer on the council for that change. If an agent executes an implementation task, that agent role is automatically omitted from the council evaluation to prevent self-approval.

### Provider Degradation Handling
If an external LLM provider encounters an outage or rate limit during review, the council does not crash. The affected role gracefully degrades to `ABSTAIN` with a diagnostic finding, allowing healthy roles to continue evaluation.

---

## 3. Safe Implementation Runner

The Implementation Runner executes tasks with strict safety constraints:

1. **Git Working Tree Invariant (`git status --porcelain`)**:
   - The runner refuses to execute if the working tree has uncommitted user edits.
   - Prevents AI tasks from overwriting or commingling with unstaged operator work.
2. **Exclusive Task Lock Leases (`sdlc_locks`)**:
   - Each task acquisition reserves an exclusive lease with a TTL (default: 300s).
   - Concurrent workers are blocked from mutating the same task simultaneously.
   - Leases can be renewed periodically or released cleanly upon completion.
3. **Subprocess Execution Guardrails**:
   - Commands are bounded by explicit timeouts (`PAO_SDLC_COMMAND_TIMEOUT_MS = 60000`).
   - Standard output, standard error, exit codes, and durations are captured in structured audit logs.
4. **Human Approval Gate**:
   - High-risk operations (`HIGH` or `CRITICAL` risk level, destructive migrations, production deployments) generate a cryptographic approval token.
   - Execution is blocked until an operator explicitly approves via `/api/sdlc/approvals/:id/approve` or WebMCP tool `pao_sdlc_decide_approval`.
