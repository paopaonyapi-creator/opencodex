// Phase 20.43 — Clean re-export boundary for the PLUR memory control plane.

export * from "./types";
export { MemoryError, type MemoryErrorCode } from "./types";
export { plurMemoryConfigFromEnv, type PlurMemoryConfig } from "./service";
export { ScopeResolver, parseScope, MemorySecretGuard, MemoryPolicyEngine, DEFAULT_POLICY_RULES, memoryCorrelationId } from "./scopes";
export { PlurMemoryAdapter, LocalFallbackEngine, selectEngine } from "./engine";
export { PaoMemoryService, getPlurMemoryService, resetPlurMemoryForTests } from "./service";
export { PLUR_MEMORY_MCP_TOOLS } from "./mcp-tools";
