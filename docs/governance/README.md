# Governance — Operator & Developer Guide

The Governance Gateway is the single boundary between Pao-hubPro agents and
real-world actions. **No governed action executes without a policy decision
and a pre-action audit event.** Fail closed everywhere.

## Mental model

```text
Agent → governedDispatch()
  → kill switch (normal | read_only | paused)
  → hard scope (protected paths, cloud metadata, workspace)
  → grant (does the agent hold this capability AT ALL?)
  → risk (deterministic: effect + destructive families + paths + hosts)
  → policy (DENY → approval → allow → default DENY)
  → human approval (blocking, one-shot, persisted payload)
  → audit (prepared/started) → provider.perform() → audit (succeeded/failed)
```

- **Grants answer** "does this agent hold this capability at all?"
- **Policy answers** "is this specific use allowed right now?"
- **Providers perform; they never authorize.** A provider may refuse an
  unsupported operation but must never decide "is agent X allowed?".

## Safe defaults

- Missing policy → DENY. Malformed deny → DENY. Broken allow → no grant.
- Unknown MCP tool → `unknown` effect → high risk minimum → approval.
- No grant → `GOVERNANCE_GRANT_DENIED` before the provider is touched.
- Secrets only travel as `credentialRefs`; raw values are redacted from
  arguments, previews, audit metadata, and logs.

## Example policies

`config/policies/` — `browser-safe-navigation.json`,
`codex-development.json`, `mcp-readonly-default.json`. Conditions are
structured objects (`all/any/not`, `eq/in/matches` over risk/effect/provider/
tool/resource fields) — there is deliberately **no eval and no free-text
expression language**. Activate via `POST /governance/policies {policy}`; the
baseline pack stays active whenever the persisted set is empty or malformed.

## Testing a policy (simulator, doc §43)

```bash
POST /api/agent-os/governance/policies/test
{ "action": { ...ActionRequest... } }
→ { "simulation": { "grant": {...}, "risk": "high",
    "decision": { "decision": "require_approval", "matchedRuleIds": [...] } } }
```

The simulator never executes the action.

## Common failure modes → codes

| Situation | Code |
|---|---|
| No active grant | `GOVERNANCE_GRANT_DENIED` |
| Deny rule matched / no allow matched | `GOVERNANCE_POLICY_DENIED` |
| Malformed policy/rule | `GOVERNANCE_POLICY_INVALID` |
| Approval needed / denied / expired | `GOVERNANCE_APPROVAL_REQUIRED / _DENIED / _EXPIRED` |
| Kill switch | `GOVERNANCE_GLOBAL_PAUSED` / `GOVERNANCE_READ_ONLY` |
| Provider not registered/available | `GOVERNANCE_PROVIDER_DISABLED` |
| Path/host outside scope | `GOVERNANCE_RESOURCE_OUT_OF_SCOPE` |
| Credential path | `GOVERNANCE_CREDENTIAL_DENIED` |
| Direct provider access attempt | `GOVERNANCE_BYPASS_BLOCKED` |

## Adding a provider

1. Implement `GovernanceProvider` (`perform(action, grant)` — execution only).
2. `gateway.registerProvider(...)` — unregistered providers fail honestly
   with `GOVERNANCE_PROVIDER_DISABLED`; never fake execution.
3. Define capabilities; authorization stays in the gateway.

## Adding a governed tool

Give it a stable name (`provider.area.verb`), classify its effect (or leave
`unknown` to be conservative), and add grants/policy rules for it. Nothing
else changes.

## Dashboard

`#governance` — kill switch, grants (revoke), approvals (approve/deny),
audit explorer (filterable event stream).
