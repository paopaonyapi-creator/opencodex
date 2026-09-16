# Pao-hubPro × Open WebUI Integration Package

Phase 20.33 — Open WebUI is the **AI workspace / chat UX**; Pao-hubPro remains the
**orchestrator, policy engine, MCP gateway, provider router and runtime**. This
package integrates an upstream Open WebUI container against the Pao stack without
forking it.

- Pinned baseline: **v0.11.3** (see `VERSION`). Override with `OPEN_WEBUI_IMAGE`.
- Never `:main` / `:latest` in production. Never auto-upgrade.
- License/branding guard: do **not** rebrand or patch the upstream image — see
  `docs/integrations/open-webui-license.md`.

## 1. Start

```bash
cp env.example ../.env additions   # merge into your PRIVATE .env; fill PAO_PROXY_TOKEN
docker compose -f docker-compose.open-webui.yml up -d
python bootstrap/verify.py         # contract smoke: PAO /v1/models + MCP tools/list
```

The proxy token is printed by the Pao proxy at startup and stored in
`$OPENCODEX_HOME/admin-api-token`.

## 2. Connect Open WebUI to Pao (supported mechanisms only)

1. **Models (OpenAI-compatible):** Open WebUI → Settings → Admin → Connections →
   OpenAI API → set base URL to `PAO_LLM_BASE_URL` (the existing proxy
   `GET /v1/models` + `POST /v1/chat/completions`, streaming included) and the
   key to `PAO_PROXY_TOKEN`. Pao virtual aliases (`pao-fast`, `pao-coder`,
   `pao-local`, … from Phase 20.30) appear as ordinary models.
2. **Tools (MCP):** Settings → Tools → add a **MCP (Streamable HTTP)** server
   pointing at `PAO_MCP_URL` with header `Authorization: Bearer <PAO_PROXY_TOKEN>`.
   The gateway serves the `pao.*` catalog (`tools/list`) and executes governed
   calls (`tools/call`).
3. **Manual steps are the contract.** No private Open WebUI database writes, no
   scraping, no auto-login (doc §X). If an upstream release changes these
   settings screens, update this README instead of patching Open WebUI.

## 3. What runs where

| Concern | Owner |
| --- | --- |
| Chat UX, model selection, operator workspace | Open WebUI (upstream container) |
| Provider routing, streaming, fallbacks | Pao proxy (`/v1/*`) |
| Tool policy, approvals, grants, audit | Phase 20.28 governance gateway via `/api/agent-os/ai-workspace/mcp` |
| Agents, workflows, council | Phase 20.22 orchestration, Phase 20.29 automation (Pao dashboard) |
| Data | Separate stores: Open WebUI owns its volume; Pao owns its SQLite/agent-os store (doc §S) |

## 4. Upgrade / rollback

Upgrade: read upstream release notes → back up the `open_webui_data` volume →
change `OPEN_WEBUI_IMAGE` in a test environment → run `bootstrap/verify.py` →
verify MCP tools + provider routing + auth + chat history → promote.
Rollback: re-pin the previous image tag and `docker compose up -d`; the data
volume persists. If an upstream release migrated its DB, downgrade may be
unsafe — restore the volume backup instead.

## 5. Verify

`bootstrap/verify.py` checks (against the configured URLs):
`GET /v1/models` returns Pao models · MCP `initialize` → `tools/list` returns
`pao.*` entries · a read-only tool call succeeds · a high-risk tool call returns
`approval_required` (never executes).

Manual setup that remains: creating the operator's capability grants
(`POST /api/agent-os/governance/grants`) for the tools agents should be allowed
to call — the gateway is fail-closed without them.
