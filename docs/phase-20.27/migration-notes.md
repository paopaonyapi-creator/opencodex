# Phase 20.27 — Migration Notes

## Reuse map (doc §130-§131)

| Existing | Reused as |
|---|---|
| Phase 20.16 control-plane module | The base — cockpit files extend it in-place |
| Phase 20.16 policy engine + guards | Single authorization layer under `access-policy.ts` |
| Phase 20.25 Universal Registry | `control.*` capability registration (new `cockpit` ingest source) |
| Phase 20.21 Codex runtime | Codex stays an adapter type — no special-case path |
| Phase 20.4/20.16 reviewers | Reviewer bridge target |
| Shared Agent OS store | `cockpit_*` additive tables (no second DB) |
| Management API conventions | `/api/agent-os/cockpit/*` + route-registry declarations |

## Schema

Additive `CREATE TABLE IF NOT EXISTS` for `cockpit_agents, cockpit_sessions,
cockpit_events, cockpit_approvals, cockpit_gate_runs, cockpit_gate_findings,
cockpit_evidence, cockpit_context_snapshots, cockpit_release_marks,
cockpit_providers, cockpit_tasks, cockpit_review_runs`. Rollback = stop using
the cockpit routes/flags; tables are projections and can be dropped without
touching other phases' data.

## Backward compatibility

Existing Codex integration, MCP tools, local file/command tools, browser
bridge, jobs, automations, media pipelines: untouched (verified by regression:
Phase 20.24/20.25/20.26 suites stay green). Feature flags allow disabling the
cockpit surface entirely without affecting the core app (doc §132-§133).

## Duplicates avoided

No second agent registry, audit log, task queue, permission system, secret
vault, MCP gateway, git service, notification service, WebSocket layer, or
database abstraction.
