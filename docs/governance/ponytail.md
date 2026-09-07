# Pao-hubPro — Ponytail Minimal-Code Governance Layer

## Overview

The Ponytail Minimal-Code Governance Layer enforces a disciplined **7-rung decision ladder** prior to code generation in Pao-hubPro. It guides coding agents to prefer reuse, standard library tools, native platform features, existing dependencies, and minimal localized patches before creating new abstractions or modules.

```text
User / Task Request
        │
        ▼
Pao-hubPro Task Classifier
        │
        ▼
Ponytail Governance Gate ──► [Mode Router: off | lite | full | ultra]
        │
        ├── Rung 1: Does the requested feature need to exist? (YAGNI)
        ├── Rung 2: Does equivalent functionality already exist in repo? (Reuse)
        ├── Rung 3: Can the standard library solve it? (Stdlib)
        ├── Rung 4: Can the native platform solve it? (Native)
        ├── Rung 5: Can an already-installed dependency solve it? (Existing dep)
        ├── Rung 6: Can it be implemented with a small local patch? (Small patch)
        └── Rung 7: Only then create the minimal new subsystem required.
        │
        ▼
Coding Agent (Codex / Desktop Agent Runtime)
        │
        ▼
Diff Guard & Dependency Guard
        │
        ▼
Quality Gates (Typecheck / Test / Lint)
        │
        ▼
Reviewer Council (Independent review — governance rules OFF)
```

## Governance Modes

| Mode | Target Scope | Description |
|---|---|---|
| `off` | Reviewers, Security Audits, Explicit bypass | Zero governance interference; agents apply full critical judgment. |
| `lite` | Exploratory spikes, prototypes, docs, non-code | Lightweight guidance without diff size constraints. |
| `full` | Standard features, bug fixes, refactoring | Full 7-rung ladder, dependency evaluation, and diff checks. |
| `ultra` | Production hotfixes, security-sensitive changes | Strict diff budget, zero new dependencies, mandatory council review. |

## Subagent Scoping Rules

To prevent circular reasoning or suppression of security findings:
1. **Coding / Bugfix / Feature Agents:** Run with `full` or `ultra` mode to prevent overengineering and code bloat.
2. **Reviewer Agents (Code Reviewer, Security Auditor, Reviewer Council):** Mode is **strictly locked to `off`**. Reviewers must never have their scrutiny constrained by minimal-code preferences.
3. **Research / Discovery Agents:** Mode is `off` or `lite`.

## Dependency Guard

- **Stdlib / Native Alternatives:** When an agent proposes adding a third-party package that is already served by Bun/Node APIs (e.g., `chalk`, `rimraf`, `node-fetch`, `mkdirp`), the dependency guard rejects the addition and provides the native equivalent.
- **Cosmetic Rejections:** Libraries added purely for syntax aesthetics or minor LOC reduction without protocol necessity are rejected.
- **Protocol Allowances:** Libraries required for explicit binary wire protocols or verified cryptographic operations are escalated to the Reviewer Council for formal review.

## Diff Guard

- Inspects proposed or uncommitted git changes.
- Alerts when a localized bugfix touches excessive files (default threshold: 5 files).
- Immediately raises high/critical flags if protected security boundaries (auth, crypto, policies, council hooks) are modified.

## Emergency Rollback & Bypass

If minimal-code governance ever needs to be paused or bypassed in emergencies:
- Set environment variable: `PAO_GOVERNANCE_ENABLED=false` or `PAO_GOVERNANCE_MODE=off`
- Or pass `--governance-mode off` via CLI / API payload.
