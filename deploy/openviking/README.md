# OpenViking context-database sidecar — deployment notes (Phase 20.53)

OpenViking (https://github.com/volcengine/OpenViking) runs as the Context
Database sidecar: it owns the `viking://` filesystem, L0/L1/L2 hierarchical
retrieval, sessions, memory extraction and its native MCP surface. Pao-hubPro
owns context policy, identity mapping, budgets, memory governance, audit and
review. The boundary is enforced by the compatibility adapter
(`src/agent-os/context/adapter/openviking.ts`) — no upstream source is
vendored.

## License boundary (AGPLv3)

The main OpenViking project is AGPLv3. Keep it a separate service, preserve
license notices, document the pinned version, and do not copy upstream source
into this repository. Commercial hosted/distributed use needs legal review.
This note is technical guidance, not legal advice.

## Bring-up

```bash
cd deploy/openviking
cp .env.openviking.example .env.openviking   # fill in the user-level key
docker compose -f docker-compose.openviking.yml up -d
curl http://127.0.0.1:1933/health            # smoke check
```

Then in the repository: set `PAO_CONTEXT_ENABLED=true`,
`PAO_OPENVIKING_URL=http://127.0.0.1:1933`, and
`PAO_OPENVIKING_API_KEY` (user-level key, never the root key). Start the
context server and verify `GET /api/context/capabilities` reports
`compatible`.

## Pinning and rollback

`latest` is for first bring-up only. Before production:

1. Pin a tested tag or digest in the compose file and record it here:

   > Pinned version: **(fill in after the first soak test)**

2. Run the compatibility probe and the context test suite against the pinned
   image before rollout (spec §94 upgrade workflow).
3. Rollback: restore the previous pinned image line and `docker compose up -d`;
   the `openviking_data` volume is left intact. Pao-side rollback is
   flag-driven without touching OpenViking data:
   `PAO_CONTEXT_MEMORY_WRITE_ENABLED=false`, then
   `PAO_CONTEXT_RETRIEVAL_ENABLED=false`, then `PAO_CONTEXT_ENABLED=false`.

## Security posture

- Loopback binding by default; remote access needs reverse proxy + TLS + auth.
- Root API key stays in the OpenViking configuration only; Pao services use
  user-level credentials. Never put the root key in browser clients.
- Restrict Studio access; it requires stronger controls than the MCP/API
  surface.
- Resource ACLs on shared `viking://resources/...` are enabled deliberately,
  with a migration audit of existing shared resources.
