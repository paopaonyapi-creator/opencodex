# Runbook — LLM Router upstream upgrade

Experiential ships frequently. This procedure exists because a floating version
would let a routing-behaviour change arrive with an unrelated deploy, and because
the failure mode of a bad upgrade is silent: traffic simply routes differently.

**Never auto-upgrade. Never edit the pin without running the contract tests.**

## 1. Read the upstream release diff

```text
https://github.com/experientiallabs/experiential/releases
```

Read the changelog for the range between the current pin and the candidate. The
question to answer is narrow: does anything in the contract surface change? The
contract this repository depends on is recorded in
`config/ai-gateway/upstream.lock.yaml` and is deliberately small:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/models` | GET | model discovery and health |
| `/v1/chat/completions` | POST | inference |

Anything outside that list is not a dependency. A change elsewhere in upstream is
not by itself a reason to block the upgrade.

## 2. Pin the candidate

Edit `config/ai-gateway/upstream.lock.yaml`:

```yaml
experiential:
  version: "0.8.0"          # the candidate, exactly
  verified_date: "YYYY-MM-DD"
```

An exact version only. `verifyUpstreamLock` refuses `latest`, `>=x`, `^x`, `~x`, and
`x.*`, and the refusal is a hard failure rather than a warning — a pin that is only
advisory is not a pin.

## 3. Run the contract tests

```bash
bun test tests/ai-gateway-experiential.test.ts
bun test tests/ai-gateway-adaptive.test.ts
bun test tests/ai-gateway-core.test.ts tests/ai-gateway-routing.test.ts \
         tests/ai-gateway-budget.test.ts tests/ai-gateway-traces.test.ts
```

All four must pass. A failure here means the candidate is not compatible; revert
the pin and stop.

## 4. Run it against a real gateway

The contract tests use a stubbed transport, so they prove the adapter matches the
DOCUMENTED shape. They cannot prove the running gateway behaves as documented.

```bash
# Start the candidate gateway locally.
pip install experiential==0.8.0
exp

# Point the adapter at it and confirm discovery plus one completion.
export EXPERIENTIAL_BASE_URL=http://127.0.0.1:8000/v1
export EXPERIENTIAL_API_KEY=<key issued by the gateway>
```

Then confirm, against the live gateway:

- `/v1/models` returns at least one alias
- one chat completion returns a well-formed response
- a wrong key produces an auth rejection rather than a retry loop

## 5. Verify the pin remotely

`probeUpstreamVersion` compares the running gateway's reported version with the pin.
An `unknown` result is normal: upstream is not required to report a version, and the
probe says so rather than inventing a mismatch.

## 6. Canary

Before promoting, confirm in the dashboard that:

- provider health for the gateway reads HEALTHY
- the error rate on the gateway provider is unchanged
- fallback and escalation counts have not risen

A rise in fallback count is the earliest signal that a behaviour change is
incompatible, and it appears before user-visible failures do.

## 7. Promote or revert

Promote manually. If anything in step 4 or 6 is wrong, revert the pin instead of
tuning around it — an upgrade that needs a workaround is not an upgrade.

See `llm-router-rollback.md` for the revert path.

