# Isolated AnythingMCP (Phase 20.96 live validation)

AnythingMCP stays an external connector engine. This folder only references the official image `helpcodeai/anythingmcp:latest`. AGPL/EE source is not vendored.

## Start / stop

```powershell
cd scripts/anythingmcp-live
.\up.ps1
bun run .\provision.ts
.\down.ps1
```

`up.ps1` writes a gitignored `.env` on first run. Keep `ENCRYPTION_KEY`; losing it means re-entering connector credentials.

Loopback binds only:

- UI: `http://127.0.0.1:13000` (host port 3000 is often already taken)
- API / MCP / health: `http://127.0.0.1:14000`
- Health: `GET http://127.0.0.1:14000/health` (no auth)
- MCP: `POST http://127.0.0.1:14000/mcp` JSON-RPC `tools/call`

## Pao-hubPro env

```powershell
$env:PAO_ANYTHINGMCP_URL = "http://127.0.0.1:14000"
$env:PAO_ANYTHINGMCP_TOKEN = "<AnythingMCP login accessToken>"
$env:PAO_MCP_FABRIC_LIVE = "1"
$env:LIVE_ANYTHINGMCP = "1"
$env:PAO_ANYTHINGMCP_ADMIN_EMAIL = "<from .env>"
$env:PAO_ANYTHINGMCP_ADMIN_PASSWORD = "<from .env>"
```

Disable the fabric: `PAO_MCP_FABRIC_ENABLED=0`.

## Live test

```powershell
bun test tests/mcp-fabric-live.test.ts
```

Ordinary CI uses `tests/mcp-fabric.test.ts` and does not start this container.
