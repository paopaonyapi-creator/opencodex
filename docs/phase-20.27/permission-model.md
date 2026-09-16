# Phase 20.27 — Permission Model

Access modes are **runtime policy**, not UI labels (doc §15-§20). Evaluation
lives in `access-policy.ts` and wraps the Phase 20.16 policy engine's proven
guards (workspace containment, protected-path list, shell tokenizer, desktop
shell policy).

## Risk ladder

R0 informational · R1 read-only · R2 reversible local write · R3
command/network side effect · R4 destructive/credential/remote · R5
production/irreversible. Action → base risk; `cmd.run` → command-class risk.

## Mode matrix (tested)

| | read | local write | build/test cmd | git push / package install | destructive | secrets | deploy | policy change |
|---|---|---|---|---|---|---|---|---|
| ASK | allow | approval | approval | approval | deny* | deny | approval | deny |
| APPROVE | allow | allow | allow | approval | approval* | deny | approval | deny |
| FULL | allow | allow | allow | approval | deny* / approval | deny | approval | deny |

\* Hard invariants (`rm -rf /`, `git push --force`, `git reset --hard`,
`git clean -f`, `drop table`, `curl | sh`, fork bomb, disk format) are DENIED
in every mode; the desktop shell policy's refusals escalate risk to R4 and the
mode matrix still decides; opaque shell constructs are denied.

## Full mode is not root (doc §18)

Secret reads deny; policy tampering by an agent denies; deployment always
needs a human; unscoped destructive operations deny; self-approval is
impossible (approvals resolve only for `operator|dashboard|user|human|owner`).

## Approval records

action, agent, session, resource, risk, reason, preview, scope
(once/session/task/workspace/policy_rule), expiry (default 24h), approver,
timestamps. Scope/expiry are stored — "always allow" does not exist. Expired
approvals resolve to `expired`.

## Custom profiles

`policyProfile` is carried on sessions/agents (default `coding-safe`) and is
data, not UI logic; additional profiles (review-only, release-manager, …) map
onto the same `evaluateCockpitAction` decision path.

## Command classification (doc §24)

read_only · build_test · write_local · network_read/network_write ·
package_install · git_write · git_remote · process_control · system_admin ·
destructive · unknown (unknown → approval/deny per mode; chains inherit their
most dangerous segment).
