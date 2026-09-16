# Phase 20.27 — Reviewer Council Bridge

The gate never calls an LLM reviewer free-form (doc §71). The bridge accepts
**structured** review runs whose findings carry: reviewer role, verdict
(pass / pass_with_warning / changes_required), confidence, severity, title,
`needsVerification` label, evidence refs, and model.

- Inputs a reviewer receives: context snapshot, git diff summary, architecture
  impact, gate findings, test summary, risk classification, provider status.
- Blocker/critical findings must cite evidence; hypotheses are labeled
  `needs_verification` and mirrored into the evidence ledger as
  `reviewer_finding`.
- **Disagreement is surfaced, not majority-voted away**: when two reviewers'
  pass verdicts conflict, the run records an explicit disagreement entry
  (doc §75); a human decides when unresolved.
- Existing Phase 20.16/20.4 reviewer consensus machinery remains the
  execution path for real reviewer agents; this bridge is the control-plane
  contract between the gate and those reviewers.

Rolled into one file with the gate for MVP cohesion; see
`readiness-gate.md` and `evidence-ledger.md`.
