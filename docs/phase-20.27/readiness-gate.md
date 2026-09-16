# Phase 20.27 — Readiness Gate

## Model (doc §57-§70)

Evidence sources (repo scan, tests, git diff, provider verifications, security
checks, reviewer findings, CI, external adapters) → versioned conditional rules
→ normalized findings → profile verdict → stable exit codes.

- **Verdicts**: clear · warning · blocked · unknown (never a single score).
- **Severities**: info · warning · blocker · critical.
- **Finding schema**: id, ruleId (versioned `rule@vN`), severity, title,
  status, evidence[] (typed: file_line, git_diff, test_result, command_result,
  provider_verification, schema_check, config_check, runtime_probe,
  reviewer_finding, human_attestation, external_adapter,
  **verification_missing**), suggested actions, first/last seen.
- **Evidence honesty**: a blocker must cite evidence or an explicit
  verification-missing reason; LLM intuition alone can never create one.

## Shipped rules (v1)

`tests.evidence-fresh` (missing → warning; failed → blocker) ·
`provider.verification` (configured-unverified → warning; failed/degraded →
blocker) · `git.clean-state` (dirty → warning) · `secrets.exposure` (critical) ·
`migrations.destructive-pending` (blocker) · `policy.tamper` (critical).
Applicability predicates keep irrelevant rules silent (doc §63).

## Profiles & exit codes (doc §64, §149)

| Profile | Behavior | Exit |
|---|---|---|
| dev / pre_commit | critical → blocked; warnings allowed | 0/1 |
| pull_request / staging | critical → blocked; blockers → warning | 0/1 |
| production | any blocker/critical → blocked | 0/1 |
| strict_production | + refuses stale/expired proof, unfresh test evidence, unverified providers | 0/1 |

2 = execution/config error, 3 = required verification unavailable. Every run
persists findings + a `.pao/gates/<id>.json` artifact.

## Fix loop & overrides (doc §66-§70)

check → inspect finding → propose bounded fix → permission → apply → validate
→ re-check. Auto-fix only for bounded, reversible, workspace-scoped,
non-secret, deterministically-verifiable changes; everything else is a
proposal. Overrides record finding/reason/approver/scope/expiry; critical
production findings may be configured non-overridable.
