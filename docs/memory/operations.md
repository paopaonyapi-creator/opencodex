# Memory Operations (Phase 20.43)

## Health & doctor

`GET /api/agent-memory/doctor` (dashboard Health tab) runs PASS/WARN/
FAIL/MANUAL checks: feature flag, PLUR CLI + store dir, fallback engine,
secret guard state, sync state, Codex adapter (hook trust = MANUAL
reminder), Hermes adapter (MANUAL), MCP tools, migrations, policy rules,
audit sink, pending approvals/conflicts. Doctor never prints secrets.

## Backups

- The Pao registry (scope/visibility/source/policy metadata + content for
  audit) lives in the shared agent-os SQLite store — include
  `$OPENCODEX_HOME/agent-os.sqlite3` in normal Pao backups.
- The PLUR store (`~/.plur` or `PLUR_PATH`) is upstream-owned; back it up
  with PLUR's own tooling. Rollback never deletes it.

## Reconciliation

External tools may write directly into the PLUR store. Reconciliation
(dashboard action / `POST /api/agent-memory/reconcile`; rate-limited on
startup) scans for PLUR engram IDs missing from the Pao registry, imports
them as `external`/native writes, runs non-destructive secret/policy
assessment, and surfaces violations in the inspector — never deleting
automatically. Pao-side policy filters can quarantine external memories
from auto-injection.

## Rollout stages (spec §33)

A: observe (status/doctor, manual recall only) → B: project-scoped auto
injection for trusted agents with receipts → C: governed learn (candidate
pipeline + approvals) → D: feedback + conflicts → E: opt-in sync with
mandatory dry-run.

## Rollback

Set `PAO_MEMORY_ENABLED=false` (routes answer a clear disabled state; no
scanning/learning happens), disable adapters without touching the PLUR
store, and preserve `~/.plur`. User memory is never deleted during
rollback.

## Retention

Injection receipts and audit events follow the shared store's operational
retention; authoritative engram registry rows are never deleted by
retention jobs (forget is an explicit, audited, policy-gated action).
