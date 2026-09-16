# Phase 20.28 Implementation Plan

Written before implementation, per the spec's preflight requirement.

## Preflight findings (existing execution entry points)

| Entry point | Module | Phase 20.28 treatment |
|---|---|---|
| Cockpit session launch (agent CLIs) | `src/agent-os/control-plane/cockpit-facade.ts` | Already governed (modes/approvals); future integration wraps its launches as governed dispatches |
| Local file ops (controlled read) | `src/agent-os/governance-gateway/` (NEW LocalWorkspaceProvider) | THE reference governed provider: file.read/write/delete behind grant+policy+audit |
| Shell execution | `media-acquisition/process-runner.ts` (allowlist), `control-plane` shell policy | Stays; governed shell performer is a documented follow-up (never raw) |
| MCP tool calls | `orchestration/mcp-tool-provider.ts`, `control-plane/mcp-tools.ts` | Governed via grant+policy when dispatched through the gateway; unknown tools classify as unknown→high |
| Browser | `agent-os/browser`, Chrome bridge | Already behind their own approval flows; governed browser performer = follow-up adapter on the same interface |
| Docker/RunPod/VPS | not present as generic execution | Provider interface + registry slots with honest not-registered failures (doc §17) |
| Approvals/audit | cockpit approvals, cp_approvals, registry audit | 20.28 adds its own hash-chained ledger specific to governed actions (separation per doc §52) |

## Schema changes

Additive `gov_*` tables on the shared Agent OS store (grants, action requests,
policy decisions, approvals, hash-chained audit, action payloads, global
state). No existing table touched; rollback = drop `gov_*`.

## Module locations

`src/agent-os/governance-gateway/` (types, policy-engine, store, gateway),
`src/server/management/governance-routes.ts`,
`tests/governance-gateway.test.ts`. (The `agent-os/governance/` directory is
the pre-existing Ponytail module — deliberately not reused for this.)

## Compatibility risks

Low: nothing existing is rewired in this slice; the gateway is opt-in via its
dispatch surface. Legacy routes remain but are documented for Stage C lock-down.

## Planned tests

Acceptance A–J (spec §70) + security regressions (§59): grant deny, deny>allow,
fail-closed policy, approval gating with exactly-one-execution, unknown-MCP
high risk, secret redaction, metadata/SSRF refusal, path scope, audit chain,
kill switch, honest provider-disabled failures.
