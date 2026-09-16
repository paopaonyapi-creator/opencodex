# Phase 20.25 — Permission Model

Policy lives outside the LLM (`src/agent-os/universal-registry/risk.ts`).
The planner can only REQUEST; only `evaluatePermission()` plus a human
approval can ALLOW. Everything fails closed.

## Permission classes → risk levels (doc §21–§22)

| Class | Risk | Examples |
|---|---|---|
| read_only | 0 | llm.reason, research.summarize, stock.metadata |
| network_read | 0 | web.search, web.scrape, social.*, browser.navigate |
| file_write | 1 | filesystem.write, filesystem.move, git.commit, media.download, export.package |
| network_write | 2 | browser.click/type/fill, notification.*, account_action |
| shell_execute | 3 | shell.execute |
| code_execute | 3 | code.execute, test.run, process.start |
| delete | 4 | filesystem.delete |
| financial_action | 4 | (reserved — no current tool maps here) |
| publish | 2 | stock.export |

Risk ≥ 3 ⇒ `requiresApproval` ⇒ every execution stops for a human decision.

## Decisions

- **allowed** — within policy (optionally because an approved action key
  matched `toolId::capability`).
- **approval_required** — creates a `registry_approvals` row (pending) and
  parks the run in `waiting_approval`.
- **denied** — outright block, audited with `POLICY_BLOCK`: disabled tools,
  dangerous commands (reuses the Phase 20.22 `ToolPolicyEngine` pattern
  list), and paths escaping the workspace root.

## Human approvals (doc §23)

- **Approve once** — consumed by the single execution that used it.
- **Approve for session** — valid for the process session, max 8 hours
  (enforced by `expires_at`). There is deliberately **no approve-forever**.
- Rejection is final for that request; the run stays failed/stopped.
- The approval shows tool, action, reason, risk level, and a sanitized
  preview of the summarized payload — never secret values.

## Replay

Replay always creates a NEW run with cleared grants: destructive steps
re-request approval every time (spec §36, §88; covered by tests).

## Learning boundary

User feedback only moves ranking preference weights (registry_preferences).
No feedback path can modify security policy.
