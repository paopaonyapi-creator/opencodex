# Phase 20.29 — Pao-hubPro × ClawFlows Workflow Registry & Safe Automation Engine

> **Status:** Implemented (Stages A–C core + import security + scheduler core; MVP §70 slice)  
> **Inspiration:** nikilster/clawflows — WORKFLOW.md approach only; no upstream code  
> **Depends On:** Phase 20.28 Governance Gateway (side effects route through it), shared Agent OS store

## REST surface (route-registry deferral ownerDoc)

```text
GET  /api/agent-os/automation                    (registry + flags)
POST /api/agent-os/automation/import             (raw WORKFLOW.md or path; imported = disabled)
POST /api/agent-os/automation/enable | disable
POST /api/agent-os/automation/dry-run            (never side-effects)
POST /api/agent-os/automation/run                (approval gate if HIGH/CRITICAL)
GET  /api/agent-os/automation/runs?workflowId=
GET  /api/agent-os/automation/runs/detail?id=    (run + steps + audit)
POST /api/agent-os/automation/runs/cancel
POST /api/agent-os/automation/approvals/resolve  (approved resumes; denied cancels)
POST /api/agent-os/automation/runs/replay        (fresh approval for high risk)
GET  /api/agent-os/automation/audit?runId=
POST /api/agent-os/automation/scheduler/tick     (interval schedules, concurrency=single)
```

## What shipped

- **Parser** (`workflows/parser.ts`): YAML-subset front matter (maps, lists,
  lazy list typing), `## Steps` extraction, schema validation fail-closed.
- **Security scan** (§19-§20): `curl|bash`, `wget|sh`, `sudo`, `chmod 777`,
  `rm -rf` root/home, credential/env/cookie/secret dumps, private-key access,
  disk destruction → import **BLOCKED**, audited as `security.blocked`.
- **Compiler** (§7): permission manifest (12 deny-by-default domains), risk
  score 0-100 → LOW/MEDIUM/HIGH/CRITICAL, `requiresApproval` derivation
  (HIGH/CRITICAL always; `before_write/shell/external_action` honored),
  SHA-256 checksum.
- **Registry** (§17-§18): versions with checksums; imported workflows install
  **disabled**; checksum change after approval → `WORKFLOW_TAMPERED` block
  until re-approval (§56).
- **Runtime** (§12-§16): run states, per-step persistence (resume-ready),
  bounded retry, cancel (never reports success), replay with fresh approval
  for high risk, safe mode (shell/external/delete steps skipped + audited),
  dry-run (zero side effects).
- **Scheduler core** (§21-§23): interval schedules, concurrency=single
  duplicate-run protection, missed-run skip.
- **Side-effect honesty** (§17, §64): advisory markdown steps complete with
  "no side effect"; shell/external/delete steps are **skipped in safe mode**
  or **fail honestly** (`GOVERNANCE_PROVIDER_DISABLED`) until their governed
  performers are wired — they route through the Phase 20.28 gateway.

## Starter workflows (8, in `workflows/`)

github-repository-analysis · project-health-check · dependency-audit ·
code-review · adobe-stock-trend-research · adobe-stock-image-qc ·
adobe-stock-metadata-generator · ai-reviewer-council.

## Tests

`tests/workflow-engine.test.ts` — **15/15**: parser/schema, dangerous-pattern
scan (6 patterns), import-disabled default, deny>allow, risk levels, dry-run,
approval gate before execution, disabled-refusal, checksum tamper block,
replay re-approval, scheduler duplicate protection.

## Flags

`WORKFLOW_ENGINE_ENABLED`, `WORKFLOW_SCHEDULER_ENABLED`,
`WORKFLOW_IMPORT_ENABLED`, `WORKFLOW_BUILDER_ENABLED`,
`WORKFLOW_SAFE_MODE` (default on).

## Honest limitations

1. Scheduler supports **interval + manual** (cron stored, matcher is a
   20.29.x item); scheduler tick is API-invoked, not a daemon yet.
2. Side-effect performers (shell/browser/MCP) route through the Phase 20.28
   gateway once wired; until then they fail/skip honestly.
3. Visual builder + Markdown sync (§42-§43) are 20.30 (Visual Workflow
   Studio) work per doc §75.
4. Run workspaces (`.data/workflow-runs/<run-id>/`) and artifact registry
   rows (§37, §48) are reserved; artifacts currently stay in run/audit state.

Rollback: remove the automation route block; `wf_*` tables are additive.
