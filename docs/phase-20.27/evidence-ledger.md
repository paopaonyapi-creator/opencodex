# Phase 20.27 — Evidence Ledger

Append-oriented registry (`cockpit_evidence`) for file/line, git diff,
command results, test results, provider proof, schema/config checks, runtime
probes, reviewer findings, human attestations, and external adapter results.

## Record

`id · type · source · hash (sha256 of canonical payload) · summary · gitSha ·
contextSnapshotId · createdAt · expiresAt`. Runtime proof carries TTLs
(provider verification 24h, probes 1h); repo evidence does not expire by TTL —
it is invalidated by relevant change (git SHA binding).

## Rules

- Hash the canonical bytes; store the hash with the record (doc §161).
- Expired proof surfaces as `expired` and fails strict gates (doc §78).
- Reviewer blocker/critical findings are mirrored into the ledger with
  `needs_verification` labels preserved (doc §74).
- Approval decisions are auditable through `cockpit_approvals` (who/when/scope)
  and referenced by gate runs via `overriddenFindingIds`.
- Replay compares the recorded plan/context refs and current environment
  before re-running any side effect; old commands are never blindly re-run
  (doc §80).

## Future (doc §162)

Hash chains, signed release evidence, attestations, SBOM/provenance — not
required for MVP.
