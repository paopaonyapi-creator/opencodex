// Phase 20.40 — Clean re-export boundary for the agent observability module.

export * from "./types";
export { getObservabilityConfig, validateConfig, resetObservabilityConfigForTests } from "./config";
export {
  readLastCompleteLine, readHeadText, readCompleteRecordsWindow,
  revisionOf, statSourceSafe, pathInsideRoot, listCandidateFiles, makeError,
} from "./scanner";
export { IntegrityEngine } from "./integrity";
export { redactText, redactStructure, redactJson, buildContentPreview, REDACTED_SECRET } from "./redaction";
export { scanProcesses, registryHints, resetProcessScanCacheForTests } from "./process-evidence";
export { ObservabilityStore, pathHashOf } from "./persistence";
export { ClaudeJsonlAdapter } from "./adapter-claude";
export { CodexObservabilityAdapter, GenericJsonlAdapter, PaoNativeAdapter } from "./adapter-misc";
export { deriveStates, deriveActivity } from "./normalizer";
export { AlertEngine, BUILT_IN_RULES } from "./alerts";
export { ObservabilityEngine, getObservabilityEngine, resetEngineSingletonForTests, bindCockpitService } from "./engine";
export { AGENT_OBSERVABILITY_MCP_TOOLS } from "./mcp-tools";
