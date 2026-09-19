export * from "./types";
export { acquisitionEnabled, acquisitionRoot } from "./flags";
export { inferIntent, classifySource } from "./classify";
export { decideAcquisitionPolicy } from "./policy";
export { buildPlan } from "./planner";
export { MockAcquisitionAdapter, OmniGetCliAdapter, OmniGetMcpAdapter, LegacyPhase2024Adapter } from "./adapters";
export { AcquisitionGateway, getAcquisitionGateway, resetAcquisitionGatewayForTests, resolveAcquisitionPath } from "./service";
export { createAcquisitionMcpTools } from "./mcp-tools";
