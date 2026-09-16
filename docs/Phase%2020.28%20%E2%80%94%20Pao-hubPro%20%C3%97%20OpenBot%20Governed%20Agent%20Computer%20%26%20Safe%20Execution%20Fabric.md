# Phase 20.28 — Pao-hubPro × OpenBot-inspired Governed Agent Computer & Safe Execution Fabric

> **Status:** Implemented (Governance Gateway core + Local provider; acceptance A–J green)  
> **Project:** Pao-hubPro | **Phase:** 20.28  
> **Reference:** CopilotKit/OpenBot — concepts only (gateway = action boundary, deny-first, fail-closed, skill ≠ permission, unknown MCP conservative, pre-action audit, human takeover); no code vendored, no runtime dependency  
> **Depends On:** Phase 20.16 policy guards, Phase 20.27 cockpit patterns

## REST surface (this document is the route-registry deferral ownerDoc)

```text
GET    /api/agent-os/governance/status
POST   /api/agent-os/governance/dispatch            (internal governed execution)
GET    /api/agent-os/governance/grants
POST   /api/agent-os/governance/grants
DELETE /api/agent-os/governance/grants?id=
GET    /api/agent-os/governance/approvals?status=
POST   /api/agent-os/governance/approvals/resolve
GET    /api/agent-os/governance/audit?actionId=
POST   /api/agent-os/governance/emergency           (normal|read_only|paused)
POST   /api/agent-os/governance/computers/control   (agent|human|paused)
```

CLI verbs deferred to the follow-up (owner: this document).

## Architecture

`src/agent-os/governance-gateway/`: `governedDispatch()` = idempotent action
request → audit `action.requested` → kill switch (normal/read_only/paused) →
hard scope invariants (protected paths, cloud metadata, workspace containment)
→ grant resolution (provider/capability, effect ceiling, resource pattern,
expiry) → deterministic risk classification → deny-first policy engine
(deny → approval → allow → default deny; broken rules never grant) → blocking
human approval with persisted one-shot payload → pre-action audit → provider
dispatch → post-action audit. Providers PERFORM and never authorize; the local
provider wires governed `file.read/write/delete`; docker/browser/mcp/vps are
registry slots that fail `GOVERNANCE_PROVIDER_DISABLED` honestly until wired.

Full details: `docs/phase-20.28/README.md`; report: `PHASE_20_28_REPORT.md`;
plan: `PHASE_20_28_IMPLEMENTATION_PLAN.md`.

## Tests

`tests/governance-gateway.test.ts` — 15/15: acceptance A–J (safe read, missing
grant, deny>allow, destructive→approval, one-shot execution, deny→zero,
unknown-MCP high risk, secret redaction, human control, kill switch) +
security regressions (sensitive paths, metadata host, workspace escape, audit
hash chain, honest provider failures).

## Flags/rollback

No flag required (dispatch is opt-in); rollback = remove the route block +
drop the additive `gov_*` tables. Existing phases untouched.
