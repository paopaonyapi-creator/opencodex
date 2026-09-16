# Phase 20.27 — Git / Release Intelligence & Provider Verification

## Git intelligence (read-only)

`gitState()` normalizes branch, HEAD SHA, dirty flag (porcelain) through
fixed-argv, allowlisted `git` invocations (20s cap, 8MB buffer, shell off).
Worktree view and ahead/behind/tags/remotes are the next increment; worktrees
are never auto-deleted, and never deleted with uncommitted changes (doc §42).

## Diff & release intelligence (doc §43-§46)

`compareWithKnownGood()` produces: commit count, changed files,
**security-sensitive classification** (auth/permission/secret/security/policy/
gate/approval/redact/credential paths), and a SHA-256 diff hash for
traceability. Findings feed the gate and the Reviewer bridge.

## Known-good marks (doc §46)

`markRelease(sha, known_good|known_bad|unknown, markedBy)` — **human-only**
(an agent cannot mark known-good merely because tests passed; enforced and
tested). Marks persist in `cockpit_release_marks`.

## Provider verification (doc §49-§52)

Honest state machine: `not_detected → detected → configured →
verification_required → verified → degraded/failed`. Detection comes from
environment configuration (credential NAMES only — values are never read or
logged). **Repo evidence ≠ runtime proof**: `verified` requires an explicit
human attestation via `POST /providers/verify` (agent attestation is refused),
is recorded as TTL'd evidence (24h), and expires back to
`verification_required`. Failed/degraded providers become gate blockers.
