# Phase 20.96 — Pao-hubPro × AnythingMCP MCP Fabric

**Status:** IMPLEMENTED (control plane + live AnythingMCP adapter)
**Blueprint:** `docs/Phase_20.96_Pao-hubPro_x_AnythingMCP.md`
**Law:** AnythingMCP is a replaceable connector/protocol engine. Pao-hubPro owns policy, secrets, privacy, approval, versioning, audit, knowledge, and skills. Enterprise Edition source is not vendored.

## Architectural Modes

| Dimension | MOCK Mode (Default CI) | LIVE Integration Mode | PRODUCTION Enterprise Deployment |
|---|---|---|---|
| **Engine** | MockAnythingMcpAdapter | Containerized helpcodeai/anythingmcp | Dedicated hardened AnythingMCP cluster |
| **Target host** | In-process simulated connector | Loopback 127.0.0.1:14000 | Isolated private VPC / internal subnet |
| **MCP Protocol** | Synchronous memory stub | HTTP JSON-RPC 2.0 at POST /mcp | HTTP JSON-RPC 2.0 with mTLS & RBAC |
| **Auth Bearer** | Simulated | Scoped JWT accessToken | Rotating Vault service principal |
| **Tool Secrets** | In-memory secret:// lease | AES-256-GCM broker lease | Hardware KMS / Enterprise Vault |
| **CI Execution** | Always runs (bun test) | Opt-in via LIVE_ANYTHINGMCP=1 | Continuous automated health probe |

## Architecture Law

1. **AnythingMCP is not the control plane.** Agents never talk to it directly.
2. **Never auto-publish.** `CONNECTOR_AUTO_PUBLISH_ENABLED` defaults false.
3. **Secrets stay in `secret://` refs.** Credential values never enter model context, logs, or GUI.
4. **R2–R4 privacy fail-closed.** Raw upstream is withheld if shaping fails.
5. **R4 requires a human-approved request.** Production DB connectors are SELECT-only.
6. **Pao risk overrides weaker upstream annotations.** `destructiveHint=false` on DELETE still becomes R4.

## Feature flags (conservative production defaults)

`PHASE_20_96_ENABLED` / `PAO_MCP_FABRIC_ENABLED` (on), `ANYTHINGMCP_BRIDGE_ENABLED`, `CONNECTOR_AUTO_PUBLISH_ENABLED=false`, `TOOL_WRITE_ACTIONS_ENABLED=false`, `TOOL_DESTRUCTIVE_ACTIONS_ENABLED=false`, `SENSITIVE_RESPONSE_FAIL_CLOSED=true`, `LEARNED_SKILL_AUTO_APPLY=false`, `KNOWLEDGE_AUTO_APPROVE=false`.

## Honest gaps

- Streaming, gRPC, webhook ingestion, OpenTelemetry exporter, and other unreleased upstream roadmap items are not assumed.
- CI stays mock-only. Live proof is opt-in via `LIVE_ANYTHINGMCP=1` against an isolated loopback container.

## Live AnythingMCP (isolated, loopback)

### Execution Path

1. Agent calls McpFabricService.execute().
2. Schema & parameter validation via AJV inputSchema.
3. Tool publication & profile risk check (R0..R4).
4. Human approval gate (R4) & rate limiting.
5. Credential lease brokerage (secret:// refs).
6. AnythingMcpHttpAdapter session handshake (initialize / notifications/initialized).
7. JSON-RPC 2.0 tools/call via POST {PAO_ANYTHINGMCP_URL}/mcp.
8. AnythingMCP runtime verifies tool roles and calls upstream connector.
9. Upstream response is extracted and unwrapped.
10. Reflected credential check guards against bearer/secret leaks.
11. shapeResponse() privacy gateway scrubs PII, transport headers, and scans prompt injection candidates.
12. Audit record written to amf_executions and amf_events with full correlation.

### Authentication Model

- Control Plane: Agents never interact with AnythingMCP directly.
- Upstream Bearer Token: Sent as Authorization: Bearer <accessToken>.
- Tool Secrets: Tools bind to secret:// URIs. Broker issues scoped single-use leases.
- Redaction: Secrets and authorization headers are scrubbed before persistence.

### Health & Readiness

- Liveness: GET {PAO_ANYTHINGMCP_URL}/health (no auth).
- Readiness: POST {PAO_ANYTHINGMCP_URL}/mcp protocol handshake.
- Exposes status, engine, connectorCount, toolCount, latency, and readiness.

Official contract used by the adapter:

- Health: `GET {PAO_ANYTHINGMCP_URL}/health` (no auth). `healthy` only after a real 2xx.
- Execute: `POST {PAO_ANYTHINGMCP_URL}/mcp` Streamable HTTP JSON-RPC `tools/call`. There is no REST `/execute`.
- MCP bearer: `PAO_ANYTHINGMCP_TOKEN` is the AnythingMCP login `accessToken` (this image grants tool roles on the user JWT; a static `MCP_BEARER_TOKEN` is not enough). Tool secrets stay in `secret://` leases.

Start/stop the official image without vendoring AGPL source:

```powershell
cd scripts/anythingmcp-live
.\up.ps1
bun run .\provision.ts
```

Default loopback ports: UI `127.0.0.1:13000`, API/MCP `127.0.0.1:14000` (host :3000 is often taken). Bind is loopback-only.

```powershell
$env:PAO_ANYTHINGMCP_URL = "http://127.0.0.1:14000"
$env:PAO_ANYTHINGMCP_TOKEN = "<AnythingMCP login accessToken>"
$env:PAO_MCP_FABRIC_LIVE = "1"
$env:LIVE_ANYTHINGMCP = "1"
bun test tests/mcp-fabric-live.test.ts
```

Disable: `PAO_MCP_FABRIC_ENABLED=0`. Live mode never falls back to the mock engine. Secrets, JWT, and MCP bearer values are not committed.
