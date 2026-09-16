# Phase 20.35 — Pao-hubPro × Transgentic-inspired Unified AI Runtime Control Plane

> **Status:** Implemented (control-plane delta over the existing gateway; clean-room)
> **Clean-room:** Transgentic is an architectural *reference only* — see [`docs/phase-20.35/CLEAN_ROOM_NOTES.md`](./phase-20.35/CLEAN_ROOM_NOTES.md)
> **Validated:** 2026-09-13

---

## 0. The architecture decision that shapes this phase

This repository **already is** the unified gateway the spec describes: the opencodex
proxy serves `GET /v1/models` and `POST /v1/chat/completions` (streaming, fallback,
all provider adapters), Phase 20.30 adds the pao/* alias + policy + budget control
plane with reasoned route previews, Phase 20.28 provides the policy engine with
circuit-breaking governance, Phase 20.22 the reviewer council, Phase 20.27 the CLI
runtime, and Phase 20.33 the MCP gateway. Per spec §77 ("preserve what exists, reuse,
do not rewrite"), Phase 20.35 therefore ships the **missing control-plane layer** on
top — not a second gateway.

## 1. Reuse map

| Spec component | Verdict | Lives in |
| --- | --- | --- |
| OpenAI-compatible gateway (`/v1/*`, streaming, fallback) | **EXISTING** | the proxy itself |
| pao/* virtual models, budgets, reasoned preview | **EXISTING** (extended) | Phase 20.30 ai-router + new `unified_providers` mode-affinity catalog |
| Policy engine, approvals, audit | **EXISTING** | Phase 20.28 governance gateway |
| Reviewer Council | **EXISTING** | Phase 20.22 `orchestration/reviewer-council.ts` (+ `pao.review.council` MCP tool from 20.33) |
| MCP server / gateway / tool router | **EXISTING** | Phase 20.33 `/api/agent-os/ai-workspace/mcp` + governed pao.* catalog |
| CLI runtime (Codex / Claude Code) | **EXISTING** | Phase 20.27 cockpit adapters (detect-without-execute) |
| Local-first routing | **EXISTING + EXTENDED** | Ollama provider in the proxy + new `pao/private` fail-closed mode |
| SSRF policy, secret redaction | **EXISTING** | Phase 20.24 url-policy; redaction layers everywhere |
| Mode/intent router, capability resolver, provider circuits, context fabric, secret firewall, workspace permission model, attachment engine | **NEW** | `src/agent-os/unified-runtime/` |

## 2. Net-new module (`src/agent-os/unified-runtime/`)

| File | Role (spec §) |
| --- | --- |
| `types.ts` | canonical contracts: ProviderManifest, 17-capability taxonomy, AIMode, ContextEnvelope, AttachmentRef, workspace permissions (§A, §I, §L) |
| `router.ts` | requirement extraction + hard capability filter (§2.2), deterministic intent detection across 11 modes (§9), configurable weighted score engine with cooldown/failure penalties (§10), reasoned route preview (§11), retry classification (§12), per-provider circuit breaker CLOSED/OPEN/HALF_OPEN (§13) |
| `security.ts` | workspace permissions default-deny (§20), provider/agent execution classes (§2.3/§22), context firewall with sensitivity tags — LOCAL_ONLY never leaves the machine (§18), secret firewall with `secret://` references and shape-based redaction (§19) |
| `attachments.ts` | multimodal attachment pipeline: size caps, magic-byte MIME sniffing vs extension mismatch, sha256, zip-bomb guard, confined staging, HTTPS-only remote fetch through the Phase 20.24 SSRF policy (§26-§29) |
| `adapters.ts` | provider manifests + adapter runtimes: native gateway (execution delegated to the proxy /v1), Ollama/LM Studio local HTTP (loopback-only plain HTTP, URL-object path resolution), Codex/Claude CLI (cockpit detection without execution), MCP provider; deterministic fakes for tests (§68) |
| `registry-store.ts` | v35 tables: `unified_providers`, `unified_provider_health`, `unified_route_executions`, `unified_workspace_grants`, `unified_audit` (§X) |
| `executor.ts` | the store-boundary runner: orchestrator persists a sanitized request and passes only the execution id; the executor reloads from the store before touching any adapter |
| `control-plane.ts` | `UnifiedRuntimeService`: preview (pure), routeRequest (sanitize → persist → reload → fallback loop with circuits → redacted response → usage/audit), grants (human-only), attachment entry (§E-§H) |
| `mcp-tools.ts` | 7 `pao_*` WebMCP tools: providers list/health, router preview/execute, context inspect, workspace permissions, health summary (§24-§25) |

Database: `AGENT_OS_SCHEMA_VERSION` 34 → **35**, additive migration only.

## 3. REST surface (12 routes, `/api/agent-os/unified/*`)

`GET /health` · `GET /providers` · `POST /providers/{test,enable}` ·
`POST /router/{preview,execute}` · `POST /context/inspect` ·
`POST /workspaces/grants{,/set}` · `POST /attachments/validate` · `GET /usage` ·
`GET /audit`. Full-literal guards, registered under `UNIFIED_RUNTIME_VERB_DEFERRAL`.

## 4. Behavior highlights

- **Capability mismatch is a hard rejection** (§2.2/§E): a vision requirement excludes
  the text-only provider before scoring; agent-mode capability needs (`filesystem_access`,
  `shell_access`) are only satisfied inside an authorized workspace.
- **Explainable routing** (§11/§48): the preview lists every candidate with its score
  and reasons, every exclusion with its policy/capability/health cause, and the
  fallback order — the dashboard playground renders exactly this.
- **Fail-closed privacy** (§42/AT-04): `pao/private` excludes all cloud providers and
  falls back to nothing; LOCAL_ONLY context items are dropped (not redacted) for cloud
  targets, and SECRET/CREDENTIAL items are redacted in every direction.
- **Circuit breaker** (§13): 5 failures / 60 s opens for 120 s, then HALF_OPEN;
  config via `UNIFIED_CIRCUIT_*` env vars; states visible on the dashboard.
- **Retry discipline** (§12): timeouts/resets/429/5xx are retryable; auth, policy,
  invalid input, unsupported capability and workspace denials are terminal.
- **Provider/agent mode separation** (§2.3/§22): agent-mode requests without the
  matching workspace grants are denied and audited; grants are human-only.
- **Secret firewall** (§19): `secret://providers/x/api-key` references resolve from the
  environment (last path segment names the variable); credential-shaped strings are
  redacted in outputs, context and audit.

## 5. Tests (17, all deterministic — no paid API)

The §69 acceptance set: AT-01 healthy capability-matched selection with reasons ·
AT-02 managed fallback · AT-03 vision never routed to text-only · AT-04 pao/private
cloud exclusion + LOCAL_ONLY firewall · AT-05 agent denial without grants + human
release · AT-07 secret redaction in outputs/context + env-only `secret://` resolution ·
circuit state machine · retry matrix · attachment MIME-mismatch/extension/SSRF/zip
guards. Plus intent detection determinism and grant human-only invariants.

## 6. Honest accounting / remaining P1/P2

- Browser adapters remain an interface + default-disabled policy entry (§16/§Q) — no
  browser automation ships here.
- Streaming event normalization (§37) is deferred: current adapters return complete
  responses; the event names are documented for the follow-up.
- Execution for the native-gateway and CLI manifests is *delegated by design* (the
  proxy serves /v1 natively; CLI sessions belong to the cockpit) — `routeRequest`
  reports this honestly instead of faking a result.
- Adobe Stock mode (§43) ships as a mode + routing hooks; the full pipeline stages
  live in the existing video/stock modules.
- Budget guard (§41) reuses the Phase 20.30 spend/budget records; a unified daily
  budget roll-up is a follow-up.
- Next phase (§79): durable agent graph on this foundation (Phase 20.36).
