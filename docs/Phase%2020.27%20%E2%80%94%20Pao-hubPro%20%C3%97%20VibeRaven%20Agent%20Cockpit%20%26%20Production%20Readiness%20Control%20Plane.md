# Phase 20.27 — Pao-hubPro × VibeRaven Agent Cockpit & Production Readiness Control Plane

> **Status:** Implemented (Milestones A–C + Gate slice of D; MVP scope §180)  
> **Project:** Pao-hubPro | **Phase:** 20.27 | **Codename:** Raven Control Plane  
> **Reference:** https://github.com/ohad6k/VibeRaven (MIT) — reference inspiration + optional flagged evidence adapter  
> **Depends On:** Phase 20.21 Codex Native Runtime, Phase 20.25 Universal Registry, Phase 20.16 Control Plane (extended, not replaced)

## Executive decision (honored)

Pao-hubPro remains the control plane. Phase 20.27 **extends the existing Phase
20.16 control-plane module** (`src/agent-os/control-plane/`) with the cockpit
layer instead of creating a parallel cockpit architecture. VibeRaven is
reference-only + an optional, flag-off external evidence adapter.

## What shipped

| Area | Delivered |
|---|---|
| Agent Cockpit | `AgentAdapter` contract; passive detection + doctor for Codex / Claude Code / Gemini CLI / generic CLI (no hard-coded Codex); persisted access modes |
| Access modes as policy | ASK/APPROVE/FULL evaluated by `access-policy.ts` on top of the Phase 20.16 guards (workspace containment, protected paths, shell tokenizer/policy). FULL ≠ root: secrets deny, policy-tamper deny, deploy approval, hard destructive invariants deny in every mode |
| Approvals | Scoped (once/session/task/workspace/policy_rule) with expiry; **agents can never resolve their own approval or mark releases or attest providers** (human-only, enforced) |
| Sessions | Governed sessions through a cockpit-local agent-CLI allowlist runner (fixed argv, shell off, bounded); normalized event stream; cancel never reports success |
| Context plane | `.pao/` versioned artifacts (`schema_version`, `generated_at`) with traversal-guarded writes; immutable context snapshots bound to git SHA + policy hash + attachments |
| Git/Release intel | Read-only git via fixed argv (status/branch/HEAD/dirty); release drift vs last known-good incl. security-sensitive file classification + diff hash; known-good/bad marks are human-only |
| Providers | Detected / configured / verification_required / verified states; **repo evidence ≠ runtime proof** — verification requires human attestation and expires (TTL) |
| Readiness Gate | Versioned conditional rules (tests, providers, git state, secrets, migrations, policy tamper); verdicts clear/warning/blocked/unknown; profiles dev/pre-commit/PR/staging/production/strict; stable exit codes (0/1/2/3); strict requires fresh test evidence |
| Evidence Ledger | SHA-256 hashed, typed, expiring records (provider proof/probes TTL) |
| Reviewer bridge | Structured review runs (verdict/confidence/severity/needs_verification); disagreements surfaced, never majority-voted away |
| MCP | `pao_control_*` tool surface (10 named tools) through the cockpit |
| REST | 24 routes under `/api/agent-os/cockpit/*` |
| VibeRaven adapter | Flag OFF by default; status/degradation + conservative finding normalizer (unknown severity maps UP to blocker) |

## Security invariants (doc §183 — all enforced in code + tests)

No agent bypasses policy; no secret exposure (credential names only); no
external evidence trusted blindly (conservative normalization); no
destructive self-approval (human-only resolution); no production-ready claim
without evidence (strict gate refuses stale/missing proof); no gate weakening
by the judged agent (policy.manage by agents denied); no workspace escape
(sep-aware containment); no cancelled-session success.

## REST surface

overview, agents, agents/doctor, agents/access-mode, sessions (start/list/
one/cancel), approvals (list/create/resolve), gate (run/latest), evidence,
providers (list/verify), releases (compare/mark), context-snapshot (create/
get), reviews (submit/list), tasks (list/create). CLI verbs deferred (owner:
this doc).

## Flags

`CONTROL_PLANE_ENABLED`, `AGENT_COCKPIT_ENABLED`, `ARCHITECTURE_GRAPH_ENABLED`,
`READINESS_GATE_ENABLED`, `PROVIDER_VERIFICATION_ENABLED`,
`VIBERAVEN_ADAPTER_ENABLED` (off), `REVIEWER_GATE_ENABLED`.

## Validation

```bash
bun run typecheck
bun test tests/control-plane-cockpit.test.ts   # 22 tests
bun test tests/management-route-registry.test.ts
bun run lint:gui && bun run build:gui && bun run privacy:scan
```

## Honest limitations

1. Sessions are **one bounded CLI invocation per send** (documented shape
   `codex exec` / `claude -p` / `gemini -p`), not interactive REPL streaming;
   real streaming rides on the existing WebSocket/SSE layer as follow-up.
2. Architecture graph: the scanner surface (flags + graph module) ships; deep
   language parsers are Phase 20.27.x — gate rules today consume the evidence
   ledger, providers, git state, and review findings.
3. VibeRaven adapter is availability + normalization only (flag off); no
   upstream binary was executed during this integration; commit SHA must be
   pinned before enabling.
4. No signed evidence yet (hash only) — hash chains/attestations are §162.

## Next

Phase 20.28 (Multi-Agent Worktree Orchestrator) per §202 — only after this
permission/evidence/gate/context base stabilizes.
