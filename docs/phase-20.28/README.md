# Phase 20.28 — Pao-hubPro × OpenBot-inspired Governed Agent Computer & Safe Execution Fabric

> **Status:** Implemented (Governance Gateway core + Local provider + acceptance A–J; milestones B/C core of doc §55)  
> **Reference:** CopilotKit/OpenBot — concepts only (gateway = action boundary, deny-first, fail-closed, skill ≠ permission, unknown-MCP conservative, pre-action audit, human takeover); no code, no runtime dependency  
> **Depends On:** Phase 20.16 policy guards, Phase 20.27 cockpit patterns

## 1. Executive summary

One authoritative **Pao Governance Gateway** now stands between agents and
real-world actions: `governedDispatch()` runs grant resolution → deterministic
risk classification → deny-first/fail-closed policy → blocking human approval
→ pre-action audit → provider dispatch → post-action audit, with `actionId`
correlation end-to-end and SHA-256 hash chaining on the audit ledger. The
invariant is enforced and tested: **no governed action executes without a
policy decision and a pre-action audit event; unknown capabilities fail
closed.**

## 1b. Completion update (same phase, second pass)

Policy persistence (`gov_policies`, `GET/POST /governance/policies`), the
no-execution **policy simulator** (`POST /governance/policies/test`, doc §43),
the example policy pack (`config/policies/`), operator docs
(`docs/governance/README.md`), and the `#governance` dashboard page (kill
switch, approvals inbox, grant manager, audit explorer) are now also shipped.

## 2. Architecture implemented

```text
governedDispatch(actionId…)
  ├─ saveActionRequest (idempotent per actionId, §50)
  ├─ audit: action.requested
  ├─ kill switch: normal | read_only | paused            (§29)
  ├─ hard scope invariants (protected paths, cloud metadata,
  │  workspace containment) — outrank grants
  ├─ grant resolver (subject/provider/capability, effect ceiling,
  │  resource pattern, expiry; expired/disabled = denied)  (§10)
  ├─ risk classifier (deterministic: effect baselines, destructive
  │  command families, sensitive paths, metadata hosts, credentials,
  │  production environment)                              (§13)
  ├─ deny-first policy engine (deny → approval → allow → default
  │  deny; broken rules never grant)                       (§11)
  ├─ approval (blocking; persisted payload; one-shot approved
  │  dispatch; replay blocked)                             (§14)
  ├─ audit: action.prepared/started
  ├─ provider registry dispatch (providers perform, never authorize, §68)
  └─ audit: action.succeeded/failed (redacted)
```

Files: `src/agent-os/governance-gateway/` (`types.ts`, `policy-engine.ts`,
`store.ts`, `gateway.ts`), `src/server/management/governance-routes.ts`,
`tests/governance-gateway.test.ts`. (`agent-os/governance/` is the pre-existing
Ponytail module — intentionally untouched.)

## 3. Provider adapters

- **local** — wired: `file.read`, `file.write`, `file.delete` with workspace
  containment + grant resource patterns (real governed execution).
- **docker / browser / mcp / chrome-extension / vps / runpod** — registry
  slots; unregistered providers fail `GOVERNANCE_PROVIDER_DISABLED` honestly
  (never fake execution, doc §17). Browser human-takeover control mode
  (`agent|human|paused`) modeled with audit events.

## 4. Governance flow / API / audit

Pipeline above; REST: status, dispatch (internal), grants (list/create/
delete), approvals (list/resolve-with-one-shot-dispatch), audit (filter by
actionId), emergency mode, computer control mode. Audit events:
action.requested → grant.allowed/denied → policy.* → approval.* →
action.prepared → action.started → action.succeeded/failed, hash-chained via
`prev_event_hash`/`event_hash`, all redacted (§25-§27). Error taxonomy per
§47 (`GOVERNANCE_GRANT_DENIED` … `GOVERNANCE_BYPASS_BLOCKED`).

## 5. Policy examples

Baseline pack (`BASELINE_POLICY`): deny sensitive paths + cloud metadata;
approval for high/critical risk and side-effect effects; allow workspace
read/write. Structured condition DSL (all/any/not, eq/in/matches) — no eval.

## 6. Database migrations

Additive `gov_*` tables (grants, action_requests, policy_decisions, approvals,
audit_events with chain columns, action_payloads, state) on the shared Agent
OS store. Rollback: disable the routes/flags, drop `gov_*`.

## 7. Security hardening

Fail closed (missing/malformed policy denies; broken allow never grants);
sensitive paths and cloud metadata refused ahead of grants; workspace
containment; unknown MCP → unknown effect → high risk minimum; secrets
redacted from arguments/previews/audit (synthetic-pattern-tested); approval
replay blocked; idempotent action requests.

## 8. Tests

`tests/governance-gateway.test.ts` — **15/15 pass**: acceptance A (safe read),
B (missing grant → no execution + audited), C (deny overrides allow), D
(destructive → approval, nothing executes), E/F (approve = exactly one
execution; deny = zero; replay blocked), G (unknown MCP high), H (redaction),
I (human control modeled), J (pause/read-only kill switch), + regressions
(sensitive path, metadata host, out-of-workspace, audit chain, honest
provider-disabled).

## 9. Known limitations

1. **Local provider wires file.read/write/delete only** — governed shell,
   Docker, browser, and MCP performers are the immediate follow-up (interface
   + registry ready; honest failures until wired).
2. **Dashboard surfaces** (governance overview/approvals/audit pages) are the
   next slice; the REST surface + cockpit approvals cover the operational
   core meanwhile. Approval-inbox reuse across 20.27/20.28 to be unified.
3. **Policy editor/simulator UI** and persistence of custom policy packs are
   follow-ups (engine + test path exist; `POST /dispatch` is the internal
   entry, protected by the management API).
4. Delegation depth/budgets (§30), RunPod cost constraints (§34), SSE events
   (§38) — interfaces reserved, not yet wired.
5. Real Codex/Claude/Gemini launches remain governed by Phase 20.27 cockpit
   policy; routing them through this gateway's dispatch is the Stage C/B
   integration work (doc §55).

## 10. Manual verification

```bash
bun run typecheck
bun test ./tests/governance-gateway.test.ts
# approval flow: POST /governance/dispatch with a destructive action →
# GOVERNANCE_APPROVAL_REQUIRED → POST /governance/approvals/resolve
# {decision:"approved"} → exactly one execution visible in /governance/audit
```

## 11. Rollback

Flags off / remove dispatch branch + registry block; drop `gov_*` tables.
Existing phases untouched (regression suites stay green).

## 12. Recommended Phase 20.29

Per doc §75: Autonomous Runtime Scheduler, Durable Agent Jobs & Governed
Recovery — only after governed performers cover shell/browser/MCP.
