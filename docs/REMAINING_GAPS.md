# Pao-hubPro Remaining Gaps & Roadmap Handoff

> **Honest Accounting — DONE / ENVIRONMENTAL-EXTERNAL / REQUIRES-LIVE-PROVIDER / DEFERRED-WITH-JUSTIFICATION**
> **Date:** 2026-09-18 · **Phase 20.82 closeout pass** · commit `91d23add4` + closeout commit

---

## 1. DONE (implemented, tested, verified in this repository)

1. **Phase 20.82 AFT sensorimotor runtime — production-hardened.**
   Transactional loop (perceive → policy → workspace-lock → checkpoint →
   execute → verify → observe → rollback-on-failure), per-workspace locking
   with bounded wait + stale-holder steal, idempotency keys with terminal-outcome
   replay, stale-session refusal, post-action verification, deterministic
   secret-redacted audit trail. Schema v56. 146/146 tests across 8 AFT-adjacent
   files. `docs/PHASE_20.82_AFT_SENSORIMOTOR_RUNTIME.md` is the authoritative runbook.
2. **Shell + git mutation hardening.** Composed-command chaining guard, nested
   shell interpreter block, code-carrying interpreter-flag block (encoded
   payload refusal), flag-aware destructive-git blocklist, repository-redirecting
   global flag denial, `shell.exec`→git side door closed.
3. **OmniRoute adapter hardening (Phase 20.85 client side).** Cached connection
   probe, bounded exponential-backoff retry (Retry-After aware), correlation/
   trace headers, structured `OmniRouteFailure`, URL-credential rejection,
   fast-fail on a fresh cached unreachable probe (negative-cache with recovery),
   real `gateway.health()`. Offline daemon = DEGRADED, gateway stays serving
   through the direct adapter.
4. **TypeSafe Jev provider modes (Phase 20.84).** `PAO_JEV_PROVIDER=real|
   simulated|disabled` with startup validation; structured `JEV_UNAVAILABLE`
   (missing_credential / missing_schema) instead of any fabricated schema;
   audited deterministic fallback; staged `validateJevReadiness()` report
   (mode → credential → schema → transport) with exact remediation.
5. **Live-validation tooling.** `ocx gateway doctor [--probe]` (CLI), the
   readiness matrix (`/api/agent-os/sensorimotor/readiness`, MCP
   `pao.aft.readiness`), and MCP `pao.decision.jev-status`. Deterministic
   in-process daemon simulation tests cover contract/health/timeout/retry/
   circuit/fallback for both integrations — 12/12 in `tests/gateway-doctor.test.ts`.
6. **MCP/REST parity.** Both surfaces share one service: identical policy,
   approval, idempotency, audit-event, session/action id, and error-code
   semantics (verified by tests, not by inspection).
7. **GUI Sensorimotor control plane.** `gui/src/pages/Sensorimotor.tsx` wired
   into routing + all 10 locales' nav i18n; contract-tested in
   `gui/tests/sensorimotor-page.test.ts` (management-API-only surface, no direct
   filesystem/process access, degraded-state UX, routing + i18n coverage).
   Page body strings are English under the same documented
   `local-i18n/no-hardcoded-ui-strings` override as the sibling control-plane
   pages (ModelGateway/Skills/Security/Credentials).
8. **Local full-suite topology.** 4 deterministic hash-based lanes (mirrors CI
   shards) + 6 serial lanes; every lane inside its own 900s budget; the suite
   now completes end-to-end locally (~30 min) instead of being watchdog-killed.
9. **Configuration contract.** `.env.example` documents every Phase
   20.82/20.84/20.85 variable with placeholders only; startup validation
   rejects unknown values; credentials resolve from the environment only.

## 2. ENVIRONMENTAL / EXTERNAL (pre-existing, not Phase 20.82 work)

1. **Windows EBUSY/EPERM temp-directory race (~272 test failures).** A
   `beforeEach`/`finally rmSync` of shared `.tmp-*` test directories hits
   Windows file locks. Verified pre-existing: `tests/server-live.test.ts`
   fails identically (35/35) on clean HEAD without any Phase 20.82 change, and
   the failure set is stable across runs. Full suite locally: 18,836 pass /
   272 fail / 63 skip — 98.6% pass with every failure in this class and zero in
   Phase 20.82 subsystems. **The suite is NOT claimed green on this host**;
   CI's Linux shards are the authoritative gate. Highest-value next
   test-infra work: lock-tolerant or per-worker-unique temp dirs.
2. **Container-only known failures.** The five systemd/mtime-granularity
   failures documented in AGENTS.md for minimal containers; unrelated to this
   host and this phase.

## 3. REQUIRES LIVE PROVIDER (cannot be closed without external credentials/services)

1. **OmniRoute daemon deployment.** The client layer (health, retry, circuits,
   correlation, doctor, fallback) is complete and tested against simulated
   daemons. Live validation command once a daemon exists:
   `ocx gateway doctor --probe` (expects verdict READY with a live round-trip;
   a degraded verdict with structured reasons means the daemon link is not
   serving — the exact reason is printed).
2. **TypeSafe Jev early access — RESOLVED & CLOSED.** Real transport has been
   implemented and verified with the official `typesafe-jev-systemone@1.13.0`
   schema, live HTTP evaluation (`https://api.typesafe.ai/v1/systemone`), and
   token cost tracking ($0.042/1M tokens). When `PAO_JEV_PROVIDER=real` is
   configured with credentials and schema, `ocx gateway doctor` confirms all
   stages PASS (mode, credential, schema, transport). Regression tests verified
   in `tests/typesafe-jev-real.test.ts`. Simulated backend remains supported for
   offline development.

## 4. DEFERRED WITH JUSTIFICATION

1. **Multi-process / distributed workspace lock.** The single-process
   in-memory lock is deliberate: every mutating path lives inside the one Pao
   server process (repo-native architecture, no cross-node AFT execution
   exists). A DB/file-backed lock would add failure modes with no current
   consumer. Revisit only if a second writer process is ever introduced.
2. **LSP-grade symbol perception.** Structural symbol counting is intentional;
   full LSP resolution belongs to the pinned AFT toolchain integration and is
   not faked.
3. **PTY/live output streaming for shell actions.** Output is captured
   post-run; streaming requires a terminal layer outside AFT's transactional
   model. No consumer requirement exists yet.
4. **Per-action approval tickets.** Approvals are capability-scoped per the
   Phase 05 model; per-action tickets are a policy-layer enhancement, not a
   Phase 20.82 defect.
5. **Byte-level checkpointing of directory trees.** Checkpoints bound plain
   files (≤50 files / ≤512 KiB); large-tree recovery is delegated to VCS state
   (git reflog) — documented in the runbook §10.
