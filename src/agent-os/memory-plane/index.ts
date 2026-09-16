// Phase 20.41 — Clean re-export boundary for the Memory Plane.

export * from "./types";
export { MEMORY_SCOPES, SCOPE_IMPLICATIONS, RISK_CLASS_SCOPE, parseScopeList, grantedScopesInclude, evaluateScope, systemActor, dashboardActor, type ActorIdentity, type MemoryScope } from "./scopes";
export { contentHashOf, queryHashOf, signReceipt, verifyReceipt, pkceS256Challenge, oauthTokenHash, sha256Hex, resetSigningSecretForTests, signingSecret } from "./hashing";
export { chunkText, chunkHashOf, LocalHashEmbeddingProvider, cosineSimilarity, reciprocalRankFusion, type EmbeddingProvider } from "./embeddings";
export { MemoryStore } from "./store";
export { MemoryOpsStore } from "./store-ops";
export { executeRecall, keywordSearch, SemanticUnavailableError } from "./recall";
export { MutationEngine } from "./mutations";
export { MemoryPlaneService, getMemoryPlaneService, resetMemoryPlaneForTests, memoryConfigFromEnv } from "./service";
export { MemoryOAuthService, OAuthError, RateLimiter, oauthConfigFromEnv } from "./oauth";
export { MEMORY_PLANE_MCP_TOOLS } from "./mcp-tools";
