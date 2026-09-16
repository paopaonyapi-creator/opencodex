// Phase 20.39 — Clean re-export boundary for the coding cockpit module.

export * from "./types";
export { canonicalizePath, canonicalizeRoot, resolveInsideWorkspace, staysInsideWorkspace, relativizeForDisplay } from "./paths";
export { evaluatePolicy, scoreRisk, riskBand, classifyToolAction, defaultExecutionLevel, parseExecutionLevel, TRUST_MAX_LEVEL } from "./policy";
export { redactText, redactStructure, redactJsonForAudit, sanitizeToolRecord } from "./redaction";
export { CockpitStore } from "./store";
export { CockpitEventBus } from "./events";
export { WorkspaceLockManager } from "./locks";
export { ApprovalGateway } from "./approvals";
export { ContextRegistry, SlashCommandRegistry, CONTEXT_TYPES } from "./context";
export { ProcessSupervisor } from "./supervisor";
export { ProviderRegistry, capabilitiesOf, providerDisplayName } from "./providers";
export { MockProvider } from "./providers-mock";
export { CodexCockpitAdapter, normalizeCodexEvent } from "./providers-codex";
export { ClaudeCodeAdapter } from "./providers-claude";
export { CockpitService, getCockpitService, resetCockpitServiceForTests } from "./service";
export { COCKPIT_MCP_TOOLS } from "./mcp-tools";
