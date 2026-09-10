# Runbook — LLM Router rollback

Use this when the adaptive router is causing harm and you need the previous
behaviour back without losing history.

## What rollback does and does not do

Rollback disables the ADAPTIVE layer. It does not touch:

- MCP permissions
- file, shell, and browser approval boundaries
- the workspace boundary
- audit history or traces
- the Phase 20.13 gateway, which keeps serving without the adaptive layer

Rollback never requires a destructive database operation. No table is dropped and
no row is deleted; disabling a flag is enough.

## Immediate rollback (30 seconds)

```bash
# 1. Stop preferring the adaptive decision. The gateway falls back to plain alias
#    resolution, which is the Phase 20.13 behaviour.
PAO_LLM_FREE_FIRST=false

# 2. If escalation is the problem, disable it entirely rather than tuning it.
PAO_LLM_MAX_ESCALATIONS=0

# 3. If the gateway itself is the problem, disable the provider. Other providers
#    keep working; the registry isolates failures.
EXPERIENTIAL_ENABLED=false

# 4. Restart the proxy so the configuration is re-read.
```

Step 1 alone is usually enough, and it is the safest first move: it changes only
candidate ORDERING, leaving capability, privacy, and budget filters exactly as they
were. If the symptom persists after step 1, the router was not the cause.

## Full rollback

```bash
PAO_AI_GATEWAY_ENABLED=false
```

This returns every client to its direct-provider path. The Phase 20.13 gateway is
behind this flag and it is how the adaptive layer is reached, so disabling it
disables both.

## Rollback a promoted router artifact

A learned router that was promoted to ACTIVE is rolled back through the lifecycle,
not by deleting it:

```
ACTIVE -> DEPRECATED      (stop serving new traffic)
DEPRECATED -> ROLLED_BACK (record the regression)
ROLLED_BACK -> DRAFT      (eligible for a future repair)
```

`transitionRouter` refuses any other path into or out of ACTIVE, so a rollback
cannot skip the record-keeping step. The artifact's history retains who moved it,
when, and why.

## Preserve history

Before any rollback, copy the trace directory:

```bash
cp -r data/ai-gateway/traces ./traces-backup-$(date +%Y%m%d)
```

The traces are the evidence for what went wrong, and the input for the next router
optimization run. Losing them means diagnosing the same regression twice.

## Credentials

No key rotation is required for a rollback. Rotate only if you have reason to
believe a credential was exposed, and rotate it through the gateway's own key
management rather than by editing a file.

## Verification after rollback

```bash
# The gateway should be gone from the request path.
curl -s http://127.0.0.1:8787/health | head

# The router suites should still pass: they do not depend on the gateway running.
bun test tests/ai-gateway-adaptive.test.ts tests/ai-gateway-routing.test.ts
```

