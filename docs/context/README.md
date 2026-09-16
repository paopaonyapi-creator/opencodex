# Pao Context Control Plane

Phase 20.53 subsystem. Governed persistent context for Pao-hubPro agents with
OpenViking as the external version-pinned context-database sidecar.

Full architecture, configuration and scope accounting:
[docs/phases/phase-20.53-openviking.md](../phases/phase-20.53-openviking.md).

## The one-paragraph version

Agents recall shared project knowledge, user preferences and execution
experience through one governed plane: every retrieval has an explicit budget,
every allow/deny carries a stable reason code, every memory mutation is
reviewed/audited, secrets never enter context storage, and cross-user scope is
denied Pao-side before any backend call. OpenViking owns `viking://` storage,
L0/L1/L2 retrieval, sessions and memory extraction; Pao owns policy.

## Namespace

```text
viking://resources/pao-hubpro/          shared objective knowledge
  ├── project/    ├── phases/    ├── docs/    └── references/
viking://user/{user_id}/                private profile, memories, sessions
viking://user/{user_id}/peers/{peer}/   workspace(peer)-scoped memory
viking://agent/skills/                  agent skills (SKILL.md)
```

Peer identity derives deterministically from the git origin
(`https://github.com/acme/pao-hubpro.git` → `github.com-acme-pao-hubpro`) —
never from directory names or free text.

## Security model

- Deterministic secret scan + path deny rules run BEFORE ingestion and before
  any memory candidate; blocked material never reaches OpenViking, and
  findings never echo the secret.
- Retrieved content is DATA: instruction-shaped text is flagged so prompt
  assembly delimits it, never executes it.
- Memory review states (`auto_accepted_private`, `pending_review`, `approved`,
  `rejected`, `suppressed`, `expired`, `superseded`) gate injection; promoted
  shared knowledge requires a human reviewer and preserves provenance.
- All timestamps UTC; every operation carries correlation IDs into the audit
  log (`GET /api/context/audit`).

## Quick start

```bash
# 1. Deploy the sidecar (see deploy/openviking/README.md), then:
PAO_CONTEXT_ENABLED=true PAO_CONTEXT_ADMIN_KEY=<key> \
PAO_OPENVIKING_URL=http://127.0.0.1:1933 PAO_OPENVIKING_API_KEY=<user-key> \
  bun -e 'const { startContextServer } = await import("./src/agent-os/context/index.ts");
           const gw = await startContextServer();
           console.log("context on 127.0.0.1:8791");'

# 2. Probe compatibility
curl -s http://127.0.0.1:8791/api/context/capabilities -H "Authorization: Bearer $PAO_CONTEXT_ADMIN_KEY"
```

## Testing

```bash
bun test tests/context-security.test.ts tests/context-engine.test.ts tests/context-e2e.test.ts
```

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `CTX_BACKEND_UNAVAILABLE` | OpenViking unreachable — check the sidecar (`docker ps`, port 1933 loopback); the breaker opens and recall degrades explicitly. |
| `CTX_BLOCKED_SECRET` | Deterministic secret filter blocked material — inspect findings (codes only, never values); fix the source, not the filter. |
| `CTX_BLOCKED_SCOPE` | Request outside allowed roots/user — fail-early denial, audited. |
| `CTX_BLOCKED_SUPPRESSED` | Memory suppressed by governance — review via `/api/context/memories`. |
| capabilities `degraded` | Some surfaces unverifiable — read the probe warnings; pin and verify the sidecar version. |
