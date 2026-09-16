# Phase 20.27 — Test Report

Suite: `tests/control-plane-cockpit.test.ts` — **22 tests, 22 pass, 0 fail**
(76 expect() calls), deterministic (no real agent launches; injected adapters).

| Area (spec §135-§146) | Tests | Result |
|---|---|---|
| Access-mode matrix (ASK reads-allow / writes-approval; APPROVE local-allow / remote-approval; FULL autonomy + invariants) | 3 | pass |
| Filesystem scope (traversal, protected paths, out-of-workspace) | 1 | pass |
| Hard destructive invariants in EVERY mode | 1 | pass |
| Command classification incl. chained commands | 2 | pass |
| Gate: healthy→clear-able, failed tests→blocked (prod/strict), detected-only providers warn, policy tamper critical, profile matrix, evidence TTL, hash determinism, override semantics | 7 | pass |
| Approvals: agent self-resolution refused, human resolution works | 1 | pass |
| Release marks + access-mode changes human-only | 1 | pass |
| Provider verification: detected ≠ verified, human attestation required, TTL'd | 1 | pass |
| Sessions degrade typed when agent absent; cancel ≠ success | 1 | pass |
| MCP tool surface (`pao_control_*`) | 1 | pass |
| `.pao/` versioned artifacts + traversal guard | 1 | pass |
| Passive adapter detection (no execution) | 1 | pass |

Regression: `bun run typecheck` clean; Phase 20.24/20.25/20.26 suites and the
route-registry parity suite re-run green; `lint:gui`/`build:gui`/`privacy:scan`
green.

## Not covered (honest)

- Live agent streaming (real Codex/Claude/Gemini REPL sessions) — the adapter
  shape + doctor are covered; interactive streaming rides on the existing
  WS/SSE layer as follow-up.
- CI workflow wiring (`pao gate check --profile pull_request` as a CI step)
  — the gate endpoint + exit codes exist; the workflow edit is a repo-infra
  change outside this phase's code.
- Architecture graph parsers (language-level) — evidence contract shipped,
  parsers are 20.27.x.
- E2E dashboard run of the full §186 workflow — REST surface tested at the
  unit layer; a full manual pass is part of release validation.
