# Deterministic Code Review Runtime (GOLD slice on the Phase 20.81 contract)

The deterministic layer of the Phase 20.81 OpenCodeReview integration:
diff capture, deterministic file selection, rule resolution, review units,
line-anchored findings, and the quality gate. LLM reviewers attach later as
bounded reasoning inside review units; an OpenCodeReview CLI adapter can
slot behind the same seam.

## Architecture

- `src/agent-os/code-review/types.ts` — request/preview/unit/finding/gate schemas
- `src/agent-os/code-review/capture.ts` — read-only git capture (via the Phase 20.4 council git-safety boundary)
- `src/agent-os/code-review/diff-parser.ts` — pure unified-diff parsing + line anchoring
- `src/agent-os/code-review/rules.ts` — deterministic rule registry, protected paths, exclusions
- `src/agent-os/code-review/engine.ts` — review units, deterministic checkers, normalization, gate
- `src/agent-os/code-review/reviewer.ts` — ReviewProvider seam, bounded prompt, consensus-lite
- `src/agent-os/code-review/service.ts` — sessions, idempotency, persistence, fail-closed behavior, revision lineage (v53)
- `src/server/management/code-review-routes.ts` — REST surface (sub-dispatched via agent-os-routes)

## Delegation & Consensus Model (Slice #2)

- Opt-in (`delegate: true` on `/run`); fail-closed when no provider is registered/available.
- ReviewProvider receives bounded excerpts (capped by unit guards, max 32KB total) + deterministic findings as context.
- Provider output is validated against changed files and line ranges; corroborated findings become `verified`; uncorroborated or CRITICAL claims become `needs_context`.
- Gate consensus rule (§33-34): `needs_context` can soften the gate to `HUMAN_APPROVAL`, but cannot harden it to `BLOCK` on its own.
- Revision lineage (§46): re-reviewing the same change target with a new diff automatically sets `revision = parent.revision + 1` and links `parent_session_id`. Proves E2E-3 (finding → fix → re-review → PASS).

## Routes (CLI verbs deferred to the Phase 20.81 code-review CLI follow-up)

- `GET  /api/agent-os/code-review` — status + gate breakdown
- `POST /api/agent-os/code-review/preview` — deterministic preview; never invokes an LLM
- `POST /api/agent-os/code-review/run` — run a review session
- `GET  /api/agent-os/code-review/sessions` — list sessions
- `GET  /api/agent-os/code-review/sessions/:id` — session detail with findings and gate

## Security model

- Review is read-only over the target repository; git runs through the
  council git-safety boundary (denylist, no push, non-interactive).
- Refs are shape-validated before use (no option injection).
- The gate (`PASS / WARN / REQUIRE_FIX / HUMAN_APPROVAL / BLOCK`) is an
  input to the human/policy merge workflow — never the merge authority.
- Fail-closed: capture or engine failures persist a failed session and
  never produce a PASS.
