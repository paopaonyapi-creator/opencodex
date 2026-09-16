# Open WebUI Integration (Phase 20.33)

Architecture, setup and operations reference for the Open WebUI workspace
integration. Design rationale and reuse map:
[Phase 20.33 owner doc](../Phase_20.33_Pao-hubPro_Open_WebUI_Unified_AI_Workspace_MCP_Control_Plane_Multi_Model_Agent_Runtime.md).
Deployment package: [`integrations/open-webui/`](../../integrations/open-webui/README.md).

## Architecture

```text
Operator ──► Open WebUI (upstream container, pinned v0.11.3)
                │  models: OpenAI-compatible
                ▼
            Pao proxy  GET /v1/models · POST /v1/chat/completions (streaming, fallback)
                │
Operator/Agents ──► pao.* MCP gateway  POST /api/agent-os/ai-workspace/mcp (JSON-RPC)
                │
            Phase 20.28 governed dispatch (grants → deny-first policy → approvals → audit)
                │
            Existing executors: local fs · governed shell · review council
```

- **Open WebUI owns:** chat UX, its own data volume and user accounts.
- **Pao-hubPro owns:** models, providers, tool policy, approvals, tools, agents,
  workflows, audit, usage. The two stores never merge (bounded contexts, doc §S).

## Setup (short form)

```bash
# merge integrations/open-webui/env.example into your PRIVATE .env, then:
docker compose -f integrations/open-webui/docker-compose.open-webui.yml up -d
python integrations/open-webui/bootstrap/verify.py
```

1. **Models:** Open WebUI → Settings → Connections → OpenAI API →
   `PAO_LLM_BASE_URL` + `PAO_PROXY_TOKEN` (admin token from
   `$OPENCODEX_HOME/admin-api-token`). Aliases `pao-fast`, `pao-coder`, `pao-local`, …
   appear as models.
2. **Tools:** Open WebUI → Tools → MCP (Streamable HTTP) → `PAO_MCP_URL` with
   `Authorization: Bearer <PAO_PROXY_TOKEN>`.
3. **Grants (fail-closed):** create capability grants for the agent/user subjects
   that should be allowed tool calls:
   `POST /api/agent-os/governance/grants`. Without a grant everything is denied —
   that is the design.

## Ports

| Service | Default | Scope |
| --- | --- | --- |
| Open WebUI | 127.0.0.1:8080 | loopback; expose via your reverse proxy |
| Pao proxy | your existing port | already running |
| MCP gateway | same host, `/api/agent-os/ai-workspace/mcp` | management API (token) |

## Environment variables

`OPEN_WEBUI_IMAGE` (pin; never `:main`/`:latest` in production) ·
`OPEN_WEBUI_INTERNAL_URL` (health probe target) · `PAO_OPEN_WEBUI_URL` (launch link
for the dashboard) · `PAO_LLM_BASE_URL` · `PAO_PROXY_TOKEN` · `PAO_MCP_URL` ·
`PAO_ALLOWED_WORKSPACE_ROOTS` (shell/file tool scope). Full list in
`integrations/open-webui/env.example`. Never commit real tokens.

## Approval behavior

Governed tools run through the Phase 20.28 pipeline: `read` executes after grant
resolution; `write` executes inside the approved workspace and is audited;
`execute`/`delete`/`network`/`deploy`/`credential` require a human approval. The MCP
response carries `approval_required` + `approvalId`; the operator resolves it in the
AI Workspace dashboard (Pending Approvals) or via
`POST /api/agent-os/governance/approvals/resolve`; the client then re-calls
`tools/call` with the same arguments and the approval id. Approvals expire in
15 minutes and cannot be replayed with different arguments.

## Upgrade

Read upstream release notes → back up the `open_webui_data` volume → pin the new
tag in a test deployment → run `bootstrap/verify.py` → verify models, streaming,
MCP tools, approvals, chat history → promote. Never auto-upgrade production.

## Rollback

Re-pin the previous image tag and `docker compose up -d`. The data volume
persists. If an upstream release migrated its internal database, downgrade may be
unsafe — restore the volume backup instead.

## Troubleshooting

- **Every tool call returns `denied` (GOVERNANCE_GRANT_DENIED)** — expected until the
  operator creates capability grants; the dashboard shows the hint.
- **`misconfigured`/rolling tag warning in health** — `OPEN_WEBUI_IMAGE` uses
  `:main`/`:latest`; pin a release.
- **MCP connect fails** — check the token header and that
  `/api/agent-os/ai-workspace/mcp` is reachable from the Open WebUI container
  (`host.docker.internal` inside compose).
- **Models list empty** — the proxy serves `/v1/models` only when providers are
  configured; this is the proxy's normal behavior, not an integration defect.
