# Phase 20.33 — Pao-hubPro × Open WebUI Unified AI Workspace, MCP Control Plane & Multi-Model Agent Runtime

> **Status:** Implemented (reuse-first delta over the existing stack)
> **Upstream:** `open-webui/open-webui`, known-good baseline **v0.11.3**, upstream container, no fork
> **Principle:** "Own the orchestration. Integrate the workspace." (spec §65)
> **Validated:** 2026-09-13

---

## 0. What this phase is

Open WebUI becomes the operator-facing **AI workspace** (chat UX, model selection, tool
interaction); Pao-hubPro remains the **orchestrator, policy engine, MCP gateway, provider
router and runtime**. Open WebUI runs as an upstream pinned container and connects to the
existing proxy for models and to a new policy-aware MCP endpoint for tools. No hard fork,
no rebranding, no private-database writes into Open WebUI.

## 1. Reuse map (spec §46 — EXISTING / EXTEND / NEW / SKIP)

| Spec component | Verdict | Where it lives |
| --- | --- | --- |
| Pao LLM Router (`/v1/models`, `/v1/chat/completions`, streaming, fallback, all provider adapters) | **EXISTING** | the opencodex proxy itself (`src/server/index.ts`, `chat-completions.ts`); Phase 20.30 adds the pao/* alias + policy + budget control plane (`/api/agent-os/ai-gateway/*`) |
| Tool risk model, approval engine (ALLOW_ONCE/SESSION/DENY semantics), audit | **EXISTING** | Phase 20.28 governance gateway: deny-first policy, capability grants, human approvals with expiry, hash-chained audit, kill switch |
| Safe file tools + path containment | **EXISTING** | Phase 20.28 `LocalWorkspaceProvider` + `isInsideWorkspace`/`isProtectedPath`; Phase 20.16/20.27 path policy |
| Safe command execution | **EXTEND** | Phase 20.24 `runProcessSafely` (argv-only, env-sanitized, timeout, output caps) + new `PaoShellProvider` allowlist/cwd discipline |
| MCP tool catalog + tool policy + agent runtime + reviewer council + model router + approval bridge | **EXISTING** | Phase 20.22 `src/agent-os/orchestration/` (McpToolProvider, ToolPolicyEngine, langchain-runtime, reviewer-council, model-router, approval-bridge) |
| Browser / Codex / local bridge / ComfyUI / RunPod / image / video / stock / voice / workflow | **EXISTING (surfaced, not duplicated)** | Phases 20.19, 20.21, 20.24, 20.7, 20.32, 20.29 — exposed as metadata-only `surface` tools in the catalog |
| Events / audit / usage | **EXISTING** | `agent_events` trail, governance audit, ai-gateway spend records |
| Open WebUI integration package | **NEW** | `integrations/open-webui/` (compose overlay, pin, env, verify script) |
| pao.* MCP gateway over HTTP | **NEW (thin)** | `src/agent-os/ai-workspace/` + `POST /api/agent-os/ai-workspace/mcp` |
| Aggregate health + dashboard control center | **NEW** | `/api/agent-os/ai-workspace/health` + GUI AI Workspace page |

## 2. Net-new modules

```
src/agent-os/ai-workspace/
├── catalog.ts        pao.* tool catalog: 7 governed tools (explicit effects) +
│                     9 surface tools with honest "available via" pointers (§6.2, §7)
├── providers.ts      PaoShellProvider (argv-only, interpreter-banned, cwd contained
│                     in PAO_ALLOWED_WORKSPACE_ROOTS, clamped timeouts), PaoReviewProvider
│                     (Phase 20.22 council bridge, read-only)
├── gateway.ts        AiWorkspaceGateway: builds ActionRequests, routes through
│                     governedDispatch, handles the approval re-call (same args +
│                     valid approval id), aggregate health, Open WebUI pin/reachability
src/server/management/
├── mcp-gateway-protocol.ts   MCP JSON-RPC (initialize, tools/list, tools/call, ping)
└── ai-workspace-routes.ts    /api/agent-os/ai-workspace/{status,health,tools,mcp,tools/call,openwebui}
integrations/open-webui/      README, VERSION (0.11.3), env.example,
                              docker-compose.open-webui.yml, bootstrap/verify.py
```

`governance-routes.ts` now exports `getSharedGovernanceGateway()` so the MCP gateway
dispatches through the SAME gateway instance as the governance REST surface (one policy
set, one approval queue, one audit chain). `process-runner.ts` allowlist gains fixed dev
binaries (git/bun/node/npm/ls/cat/echo) for the governed shell provider — shell
interpreters remain hard-banned.

## 3. Risk model mapping (spec §7 → Phase 20.28)

| Spec risk | Governance effect | Baseline behavior |
| --- | --- | --- |
| read | read | allow + audit |
| write-low | write | allow + audit (workspace-scoped, grant-bound) |
| write-high / execute | execute | approval |
| network | external_write | approval |
| deploy | admin/execute | approval |
| delete | destructive | approval |
| credential | credential | approval; credential paths hard-denied |

The model cannot self-upgrade: capability grants are operator-created
(`POST /api/agent-os/governance/grants`), effects are declared per catalog entry (no
name sniffing), and every dispatch re-runs deny-first policy. Approvals expire (15 min)
and an approval re-call must present the SAME arguments (redacted-argument-preview
match) and the SAME approval id.

## 4. MCP endpoint

`POST /api/agent-os/ai-workspace/mcp` — JSON-RPC 2.0 (`initialize`, `tools/list`,
`tools/call`, `ping`), token-authenticated by the management API. Open WebUI connects
via its MCP (Streamable HTTP) connector with `Authorization: Bearer <PAO_PROXY_TOKEN>`.
`tools/list` exposes the full catalog with `annotations.risk/executable/requiresApproval`;
`tools/call` returns governed outcomes (`success`, `approval_required` + approvalId,
`denied` + reason, `failed` + code, `surface` + availableVia) — a surface tool never
pretends to execute.

## 5. Tests

`tests/ai-workspace.test.ts` (10 tests): catalog risk metadata + no secret material;
MCP handshake/list/notifications/unknown-method; unknown + surface honesty; fail-closed
grant denial; read/write execution with audit rows; out-of-scope + protected-path denial;
destructive/execute approval flow incl. bogus-approval refusal and one-shot execution;
shell argv discipline (interpreter ban, non-array args, outside cwd) + redacted approval
previews; degraded-not-dead health; rolling-tag pin guard.

## 6. Honest accounting / follow-ups

- The dubbing-style placeholder trap is avoided: every non-executable catalog entry is
  explicitly `surface` with the owning module named (spec §65; "clean partial over fake
  completeness").
- Codex/browser/ComfyUI/RunPod/image/video/stock/voice/workflow deep-function tools
  remain available through their owning modules' dashboards and routes; promoting them
  to governed executors is a mechanical follow-up per tool (register a provider,
  add a catalog entry).
- Open WebUI SSO is staged (doc §31): Stage A (separate logins behind the reverse proxy)
  ships; OIDC is documented as Stage B. No static-credential auto-login exists.
- `bootstrap/verify.py` is an operator smoke tool with a strict fetch guard (http(s)
  only, loopback/private by default, metadata/link-local refused).
- Compose overlay binds Open WebUI to loopback by default; the operator owns the
  reverse proxy in front of it.
