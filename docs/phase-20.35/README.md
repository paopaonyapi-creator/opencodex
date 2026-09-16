# Unified AI Runtime — Operations Reference (Phase 20.35)

Design rationale and reuse map:
[Phase 20.35 owner doc](../Phase_20.35_Pao-hubPro_Transgentic_Inspired_Unified_AI_Runtime_Control_Plane.md) ·
Clean-room record: [CLEAN_ROOM_NOTES.md](./CLEAN_ROOM_NOTES.md)

## What it is

A control-plane layer over the existing gateway: it decides **which provider serves a
request and why**, enforces capability/mode/privacy/permission policy, wraps execution
in circuit breakers with disciplined retries, and filters context and secrets before
dispatch. Inference itself stays in the existing proxy (`/v1/*`), the local runtimes
(Ollama/LM Studio), the Phase 20.27 CLI cockpit, and the Phase 20.33 MCP gateway.

## Routing pipeline

```text
request → intent/mode detection (deterministic)
        → capability requirements (attachments/tools/json/agent-mode)
        → policy filter (pao/private local-only; browser adapters disabled by default)
        → capability hard filter (mismatch = rejection)
        → health + circuit filter
        → weighted score (capability 100, mode 40, health 30, privacy 30,
                          reliability 30, preference 20, latency 15, cost −15,
                          cooldown −50, recent failures ≤ −25)
        → selected provider + ordered fallbacks (max 2), every decision reasoned
```

Execution: sanitize → persist → reload from store → attempt provider → on retryable
failure fall through; on terminal failure stop. Circuits open after
`UNIFIED_CIRCUIT_FAILURES` (5) failures in `UNIFIED_CIRCUIT_WINDOW_MS` (60 s) for
`UNIFIED_CIRCUIT_OPEN_MS` (120 s), then HALF_OPEN.

## Modes

`general · coding · research · writing · image · video · audio · automation · review ·
adobe_stock · private_local` — detected deterministically from the prompt or forced via
`mode`/`pao/*` model names. `private_local` excludes every cloud provider (fail closed)
and marks context LOCAL_ONLY.

## Workspaces

Permissions (`READ_FILES … CLOUD_MODEL`) default to **deny**. Agent-mode requests
require the matching grants (`filesystem_access → READ_FILES`, `shell_access →
RUN_COMMANDS`, `mcp_client → MCP_TOOLS`); denials are audited. Grants are changed only
by human actors via `POST /api/agent-os/unified/workspaces/grants/set`.

## Context & secrets

Sensitivity tags: `PUBLIC INTERNAL PRIVATE SECRET CREDENTIAL LOCAL_ONLY`. For cloud
providers, LOCAL_ONLY items are dropped and PRIVATE items withheld; SECRET/CREDENTIAL
items are redacted in every direction. Secrets pass only as
`secret://providers/x/api-key` references — the last path segment names the
environment variable resolved at call time. Credential-shaped strings are redacted in
outputs and audit.

## Attachments

Images/video/audio/PDF/text/JSON/CSV/ZIP/code. Size caps (25 MB, archives 50 MB / 500
entries), magic-byte MIME sniffing with extension-mismatch rejection, sha256 hashing,
staging inside the confined workspace, HTTPS-only remote fetch through the shared SSRF
policy (private/loopback/metadata refused).

## Providers

Seeded automatically: `pao-gateway-native` (the proxy itself), `ollama-local` /
`lmstudio-local` when `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL` are set, `codex-cli` /
`claude-code-cli` (detected via the cockpit, agent-mode only), and `pao-mcp-gateway`.
Deterministic fake providers exist only under `FEATURE_UNIFIED_FAKE_PROVIDERS=true`.

## API (`/api/agent-os/unified/*`, management-token auth)

`GET /health` · `GET /providers` · `POST /providers/test|enable` ·
`POST /router/preview|execute` · `POST /context/inspect` ·
`POST /workspaces/grants|grants/set` · `POST /attachments/validate` ·
`GET /usage` · `GET /audit`. MCP: `pao_providers_list`, `pao_providers_health`,
`pao_router_preview`, `pao_router_execute`, `pao_context_inspect`,
`pao_workspace_permissions`, `pao_health_summary`.

## Troubleshooting

- **"no eligible provider"** — the preview body lists every exclusion reason
  (capability mismatch, health, policy). Fix the requirement or enable/configure a
  provider.
- **"agent mode denied: missing workspace grants"** — expected under default deny;
  a human sets the grants via the workspaces endpoint.
- **Provider stuck in `cooldown`** — the circuit opened; reset happens automatically
  after the open window or on the next successful `providers/test`.
- **Route reports "executes via its native surface"** — that provider's inference is
  served by the proxy /v1 endpoints or the cockpit by design; the control plane does
  not duplicate it.
