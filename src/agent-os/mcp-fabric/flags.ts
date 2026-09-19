export function mcpFabricEnabled(): boolean {
  const raw = (process.env.PAO_MCP_FABRIC_ENABLED ?? process.env.PHASE_20_96_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return fallback;
}

export function mcpFabricMockForced(): boolean {
  if ((process.env.PAO_MCP_FABRIC_MOCK ?? "").trim() === "1") return true;
  if ((process.env.PAO_MCP_FABRIC_LIVE ?? "").trim() === "1" || (process.env.LIVE_ANYTHINGMCP ?? "").trim() === "1") {
    return false;
  }
  return Boolean(process.env.BUN_TEST) || process.env.BUN_TEST_WORKER_ID != null || process.env.NODE_ENV === "test";
}

/** Configured AnythingMCP base URL. Only PAO_ANYTHINGMCP_URL — never a hardcoded port. */
export function anythingMcpBaseUrl(): string | undefined {
  const raw = (process.env.PAO_ANYTHINGMCP_URL ?? "").trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

/**
 * Live execution is opt-in. Under bun test the mock engine stays default so CI
 * never depends on a container. PAO_MCP_FABRIC_LIVE=1 or LIVE_ANYTHINGMCP=1
 * forces the real adapter and forbids mock fallback.
 */
export function anythingMcpLiveRequested(): boolean {
  if ((process.env.PAO_MCP_FABRIC_MOCK ?? "").trim() === "1") return false;
  const liveFlag = (process.env.PAO_MCP_FABRIC_LIVE ?? "").trim() === "1" || (process.env.LIVE_ANYTHINGMCP ?? "").trim() === "1";
  if (liveFlag) return true;
  if (mcpFabricMockForced()) return false;
  return Boolean(anythingMcpBaseUrl());
}

export function anythingMcpTransportToken(): string | undefined {
  const raw = (process.env.PAO_ANYTHINGMCP_TOKEN ?? "").trim();
  return raw || undefined;
}

export const MCP_FABRIC_FLAGS = {
  bridgeEnabled: () => bool("ANYTHINGMCP_BRIDGE_ENABLED", true),
  kgImportEnabled: () => bool("ANYTHINGMCP_KG_IMPORT_ENABLED", true),
  skillCaptureEnabled: () => bool("ANYTHINGMCP_AI_SKILL_CAPTURE_ENABLED", true),
  autoTestEnabled: () => bool("CONNECTOR_AUTO_TEST_ENABLED", true),
  autoPublishEnabled: () => bool("CONNECTOR_AUTO_PUBLISH_ENABLED", false),
  writeActionsEnabled: () => bool("TOOL_WRITE_ACTIONS_ENABLED", false),
  destructiveActionsEnabled: () => bool("TOOL_DESTRUCTIVE_ACTIONS_ENABLED", false),
  sensitiveFailClosed: () => bool("SENSITIVE_RESPONSE_FAIL_CLOSED", true),
  learnedSkillAutoApply: () => bool("LEARNED_SKILL_AUTO_APPLY", false),
  knowledgeAutoApprove: () => bool("KNOWLEDGE_AUTO_APPROVE", false),
};
