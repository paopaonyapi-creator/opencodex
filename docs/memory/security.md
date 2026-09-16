# Memory Security (Phase 20.43)

## Secret guard (defense-in-depth, spec §11)

Runs before EVERY durable learn and before sync — independent of any
upstream PLUR secret detection. Detector categories: OpenAI/Anthropic
keys, GitHub tokens, Slack tokens, JWTs, bearer tokens, private key
blocks, `.env`-style assignments, JSON secret fields, database URLs,
AWS access keys.

Responses: **block** (default for learn), redact-then-approve (sensitive
policy), allow metadata-only. Audit records store ONLY category, field
path, sha256 fingerprint, operation, decision — never the raw value.
UI applies render-time redaction; malformed upstream memories containing
secrets still never display raw values.

## Policy engine

Deterministic rule evaluation with explainable output (matched rule IDs +
reason). Defaults include: deny secret material, deny unknown-remote sync,
require approval for rescope-to-shared and bulk forget, allow
project-scoped rules from trusted agents, deny unrelated-project reads,
force `local` for temporary context, redact sensitive content. Policy
decisions are visible in audit events and the dashboard Policies view.

## Sync hazards

Sync is **disabled by default** (`PAO_MEMORY_SYNC_ENABLED=false`); a
config validation failure fails closed. `local` scope never syncs;
private visibility blocks; secret findings block; unknown profiles fail
closed (`MEMORY_SYNC_UNSAFE_REMOTE`). Remote credentials live only as
secret references in sync profiles — never plaintext DB fields, never
logs. A public remote can never be selected automatically for personal
memory sync; if privacy cannot be verified, execution fails closed.

## RBAC + agent capability

Human permissions map to the management-API admin model; destructive
routes (forget/rescope/sync execute/conflict resolve) additionally require
human actors and pass the policy engine. Agents need adapter-level
capability + trust level (`low|standard|trusted|system`); low-trust
agents cannot write authoritative/sensitive memories through policy.

## No injection surfaces

PLUR CLI bridge uses the literal `plur` binary with literal subcommands
and dedicated argv value positions (`shell: false`) — no shell
interpolation anywhere. Scope strings are regex-validated and never reach
the filesystem. Memory body logging is disabled by default; debug logging
still redacts.
