# Orchestration Control Plane (Phase 20.37)

Agentic Development OS: a governed control plane where tasks enter through
intake, a deterministic router picks an agent + skills, hooks enforce safety
policy before anything runs, execution goes through guarded tool calls,
verification and review gate the result, and everything lands in a redacted
append-only audit. Clean-room implementation — registry/hook/router/worktree
**patterns** adapted, no OrchestKit code.

## Architecture

```text
intake → PRE_ROUTE hooks → deterministic router (agent + skills, reasoned)
      → risk ≥ 3? approval gate (human-only) → agent runtime adapter
      → guarded tool calls (path/command guards, audit) → verifier
      → reviewer council (Phase 20.22 bridge) → critical finding blocks DONE
      → memory (redacted) → audit events
```

Reused subsystems: Phase 20.27 command/path classification, Phase 20.24
process runner (worktree git ops), Phase 20.22 reviewer council bridge,
Phase 20.35 redaction. New: registries, router, state machine, hook engine,
worktree manager, memory store.

## Risk model (§16)

| Risk | Meaning | Behavior |
| --- | --- | --- |
| 0 | Read-only | auto-run |
| 1 | Workspace write | auto-run inside approved scope |
| 2 | Local commands (build/test/install) | auto-run when classified safe |
| 3 | External/privileged mutation | **approval required** |
| 4 | Destructive/system-level | **never auto-runs** |

## Agents (seeded)

orchestrator (coordinates, opens gates) · explorer (read-only discovery) ·
planner · implementer (ceiling 2, worktree isolation) · reviewer · verifier ·
security-auditor (critical findings block DONE) · test-engineer · memory-curator.

## Skills (seeded)

brainstorm, explore, plan, implement, verify, review, security-audit, test,
refactor, docs, remember, commit-check — loaded on demand (explicit request →
trigger match → dependencies only).

## Hooks (§17-§18)

Priority-ordered policy handlers per lifecycle event. Bands: 0-99 security,
100-199 workspace/git, 200-299 approval/risk, 300-399 quality, 400+ audit.
Deny stops; approval pauses; audit hooks record. Security hooks fail closed.
Defaults: `.env`/`.pem`/`id_rsa`/`.ssh` writes denied, outside-workspace writes
denied, destructive git (`reset --hard`, `clean -fd`, `push --force`) denied,
risk ≥ 3 requires approval, unverified commits denied.

## API

`/api/agent-os/orch/*` — `GET health` (doctor) · `GET agents` +
`POST agents/enable` (human) · `GET skills` · `GET hooks` · `POST route`
(preview, never executes) · `POST/GET runs` + `runs/detail` + `runs/cancel` ·
`GET approvals` + `POST approvals/resolve` (human) · `GET worktrees` +
`POST worktrees/allocate|release` (release refuses dirty) · `GET/POST memories`
(redacted) · `GET audit` (filters: runId/eventType/severity).

## Configuration

`PAO_ORCH_WORKTREE_ROOT` (default `.pao/worktrees`) · `PAO_ORCH_HOOK_MODE` ·
`PAO_ORCH_MAX_PARALLEL_AGENTS=3` · `PAO_ORCH_APPROVAL_TTL_MINUTES=60`.

## Runbook

- **Doctor:** `GET /api/agent-os/orch/health` — registry/db/adapters/audit checks.
- **Stuck run:** `POST runs/cancel` (pre-terminal only); terminal states immutable.
- **Approval stuck:** resolve from the Orchestration dashboard (human session);
  agents are structurally unable to self-approve.
- **Dirty worktree:** it is `PRESERVED` automatically; clean it up manually via
  git — the system never deletes uncommitted work.
- **Rollback:** the module is additive; tables remain but the chain link in
  `agent-os-routes.ts` can be removed without touching other phases.
