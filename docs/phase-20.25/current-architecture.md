# Phase 20.25 — Current Architecture (discovery record)

Recorded before implementation, per the phase spec's Migration Rules.

## What the repository already had (and Phase 20.25 reuses)

| Concern | Existing module | Phase 20.25 relationship |
|---|---|---|
| Runtime | Bun-native TypeScript, strict, ESM, no compile step | Followed |
| Database | `src/agent-os/db.ts` SQLite under `OPENCODEX_HOME`, additive migrations, schema version constant | v31 migration added; registry store opens the shared handle |
| Tool policy / risk | `src/agent-os/orchestration/tool-policy.ts` (`ToolPolicyEngine`, R0–R4) | Reused for workspace containment + dangerous-command checks; registry adds the numeric 0–4 ladder and permission classes |
| MCP tool catalog | `src/agent-os/orchestration/mcp-tool-provider.ts` | Ingested as the source of MCP tools (with executor mapping); never duplicated |
| Model routing | `src/agent-os/orchestration/model-router.ts` | Registered as the `ai_model` capability provider; provider facts stay in the canonical catalog |
| Agents | `src/agent-os/registry.ts` | Ingested as `agent` tools |
| Skills | `src/agent-os/skills.ts` | Ingested as `local_tool` entries |
| Codex runtime | `codex_runtime_capabilities` table (Phase 20.21) | Ingested defensively (optional subsystem, errors swallowed) |
| Capability taxonomy | `src/agent-os/agency/search/capability-taxonomy.ts` (agents) | Extended (not replaced) by the registry namespace in `taxonomy.ts` |
| Approvals | Phase 05 `approvals` ledger, Phase 20.22 orchestration approvals | Registry has its own `registry_approvals` ledger scoped to universal-runtime runs; same fail-closed semantics |
| Reviewer Council | `src/agent-os/council/`, `orchestration/reviewer-council.ts` | Out of scope for the MVP executor; plan notes reference it |
| GUI | React + Vite, hash routing, per-phase glassmorphic pages, 11 locales | New `universal-registry` page follows the exact pattern |
| Management API | Chain-link dispatch in `agent-os-routes.ts` + declared `MANAGEMENT_ROUTES` + route registry test | Followed; all 17 routes declared with a phase deferral |
| Feature flags | Env-var convention | `flags.ts` with the five spec flags |
| Tests | Flat `tests/*.test.ts`, Bun test runner, `OPENCODEX_HOME` temp-dir isolation | `tests/universal-registry.test.ts` |

## Where Phase 20.25 integrated

- `src/agent-os/universal-registry/` — the whole subsystem (new directory, sibling of `media-acquisition/`, `notifications/`, `orchestration/`).
- `src/agent-os/db.ts` — v31 migration + version bump.
- `src/server/management/registry-routes.ts` + dispatch + route declarations.
- `gui/src/pages/UniversalRegistry.tsx`, `gui/src/styles/universal-registry.css`, `App.tsx`, `app-routing.ts`, `gui/src/i18n/*.ts`.
- `tests/universal-registry.test.ts`.
- `docs/phase-20.25/*` and the main phase doc.

## Duplicates deliberately avoided

- No second policy engine, no second MCP runtime, no second database layer,
  no second auth system, no second logger, no new API framework, no new
  dependencies (Bun/stdlib only, per the Dependency Guard).
