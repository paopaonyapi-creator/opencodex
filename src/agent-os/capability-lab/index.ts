/**
 * Phase 20.56 — Micro-App Capability Lab public entry.
 */
export { CapabilityLab, getCapabilityLab, resetCapabilityLabForTests, writeSeedFiles } from "./service";
export { analyzePythonSource, discoverPythonFiles } from "./analyzer";
export { scoreRisk } from "./risk";
export { decideInvoke, decidePublish } from "./policy";
export { compileAdapters } from "./adapters";
export { FIRST_PARTY_RUNNERS } from "./runners";
export { CapError } from "./types";
export type {
  AnalysisResult,
  CapabilityRecord,
  CapabilityRecipe,
  CapabilityRun,
  CapabilitySource,
  RiskLevel,
} from "./types";
