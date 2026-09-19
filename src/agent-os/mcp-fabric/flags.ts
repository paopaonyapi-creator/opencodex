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
  return process.env.PAO_MCP_FABRIC_MOCK === "1" || Boolean(process.env.BUN_TEST);
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
