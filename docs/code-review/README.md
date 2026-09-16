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
- `src/agent-os/code-review/service.ts` — sessions, idempotency, persistence, fail-closed behavior
- `src/server/management/code-review-routes.ts` — REST surface

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
