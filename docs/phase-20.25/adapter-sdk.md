# Phase 20.25 — Adapter SDK

Every integration reaches execution through one interface
(`src/agent-os/universal-registry/types.ts`, implemented in `adapters.ts`):

```typescript
export interface ToolAdapter {
  /** Executor key, e.g. "http_get", "local_file_read". */
  readonly key: string;
  supports(tool: ToolRecord): boolean;
  validate(tool: ToolRecord, input: Record<string, unknown>): ToolErrorCode | null;
  /** Named `run` deliberately: the universal runtime never exposes raw `execute` surfaces. */
  run(tool: ToolRecord, input: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolExecutionResult>;
}
```

## Shipped adapters (safe subset)

| Key | Tool contract | Safety |
|---|---|---|
| `http_get` | `runtime.protocol` http/https | GET-only, 10s timeout, SSRF guard (`url-safety.ts`), no redirects, status → error-code mapping (429→RATE_LIMIT, 5xx→PROVIDER_ERROR, 401/403→AUTH_ERROR) |
| `local_file_read` | `filesystem.read` | Workspace-contained path resolution (absolute or relative to `OPENCODEX_HOME`); escapes are POLICY_BLOCK; read-only |
| `model_router` | the orchestration model-router tool | Deterministic routing receipt; cost reported `unknown`, never invented |

Selection order (`adapterFor`): declared `runtime.executor` key first, then
`supports()` heuristics. Tools without a matching adapter report
`TOOL_UNAVAILABLE` (a retryable error that drives the fallback chain) — an
honest failure, never a fake success.

## Deliberate exclusions

No shell or code executor exists in the universal runtime. Those capabilities
belong to the sandbox and orchestration runtimes with their own approval
flows. The registry still ingests, plans, ranks, and policy-gates them.

## Adding an adapter (developer experience, doc §96)

1. Implement `ToolAdapter` (validate + run).
2. Register it: pass adapters to `UniversalRegistryService` (DI) or append to
   `DEFAULT_ADAPTERS`.
3. Ingestion: set `runtime.executor` on the tool records it should serve.
4. No planner changes needed — the planner only speaks capabilities.

## Execution contract

`engine.ts` wraps every adapter call: JSON-safe input reduction → permission
check → approval gate → circuit breaker → `run()` → result reduced to
validated primitives (whitelisted error codes, sanitized summaries, finite
numbers) → persistence. Adapters cannot bypass policy because they are never
reached except through the engine.
