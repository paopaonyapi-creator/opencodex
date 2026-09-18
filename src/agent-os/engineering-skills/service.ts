// Phase 20.91b — Engineering Skill Runtime service facade.
// Single entry point for management routes, MCP tools, and the GUI. Reuses the
// registry/router/evidence/council/workflow singletons; adds no new state.

import { getEngineeringSkillRegistry, type PackImportInput, type PackImportResult, type PackRecord } from "./registry";
import { getSkillRouter, type SkillRoute } from "./router";
import { ContextPackager } from "./context";
import { getEvidenceCollector, type EvidenceRecord } from "./evidence";
import { getReviewerCouncil, requiredReviewLanes, type ReviewFinding } from "./review";
import { getWorkflowEngine, type TransitionResult, type WorkflowRecord } from "./workflow";
import { evaluatePermission, type PermissionEvaluation } from "./policy";
import { readEngineeringSkillsFlags, type EngineeringSkillsFlags, type NormalizedSkill, type PermissionClass, type SkipRequestReply } from "./types";
import { openAgentOsDb } from "../db";

export interface EngineeringSkillsCounts {
  packs: number;
  activePacks: number;
  skills: number;
  workflows: number;
  openWorkflows: number;
}

export class EngineeringSkillsService {
  health(): { ok: boolean; phase: string; counts: EngineeringSkillsCounts; flags: EngineeringSkillsFlags; invariantCheck: string } {
    const registry = getEngineeringSkillRegistry();
    const packs = registry.listPacks();
    const skills = registry.listSkills();
    const engine = getWorkflowEngine();
    const workflows = engine.listWorkflows();
    const counts: EngineeringSkillsCounts = {
      packs: packs.length,
      activePacks: packs.filter((p) => p.lifecycleStatus === "ACTIVE").length,
      skills: skills.length,
      workflows: workflows.length,
      openWorkflows: workflows.filter((w) => !["DONE", "CANCELLED", "FAILED_VERIFICATION", "FAILED_REVIEW"].includes(w.status)).length,
    };
    const seeded = packs.some((p) => p.name === "pao-core" && p.lifecycleStatus === "ACTIVE");
    return {
      ok: seeded && counts.activePacks > 0,
      phase: "20.91b",
      counts,
      flags: readEngineeringSkillsFlags(),
      invariantCheck: seeded ? "pao-core seed active; pack lifecycle quarantine→candidate→active enforced" : "pao-core seed missing",
    };
  }

  listPacks(): PackRecord[] {
    return getEngineeringSkillRegistry().listPacks();
  }

  getPackDetail(idOrName: string): { pack: PackRecord; skills: NormalizedSkill[]; versions: ReturnType<ReturnType<typeof getEngineeringSkillRegistry>["listPackVersions"]> } | null {
    const registry = getEngineeringSkillRegistry();
    const pack = registry.getPack(idOrName);
    if (!pack) return null;
    return { pack, skills: registry.listSkills(pack.id), versions: registry.listPackVersions(pack.id) };
  }

  importPack(input: PackImportInput, actor: string): PackImportResult {
    return getEngineeringSkillRegistry().importPack(input, actor);
  }

  validatePack(idOrName: string, actor: string) {
    return getEngineeringSkillRegistry().validatePack(idOrName, actor);
  }

  promotePack(idOrName: string, actor: string, note?: string): PackRecord {
    return getEngineeringSkillRegistry().promotePack(idOrName, actor, note);
  }

  rollbackPack(idOrName: string, actor: string, reason: string): PackRecord {
    return getEngineeringSkillRegistry().rollbackPack(idOrName, actor, reason);
  }

  setPackEnabled(idOrName: string, enabled: boolean, actor: string): PackRecord {
    return getEngineeringSkillRegistry().setPackEnabled(idOrName, enabled, actor);
  }

  setSkillEnabled(skillId: string, enabled: boolean, actor: string): NormalizedSkill {
    return getEngineeringSkillRegistry().setSkillEnabled(skillId, enabled, actor);
  }

  listSkills(enabledOnly = false): NormalizedSkill[] {
    return getEngineeringSkillRegistry().listSkills(undefined, { enabledOnly });
  }

  routeTask(taskText: string, provider?: string): SkillRoute {
    return getSkillRouter().routeTask(taskText, { provider });
  }

  /** L0–L4 packaged context for the routed skills (catalog + selected bodies). */
  packageContext(taskText: string): ReturnType<ContextPackager["catalog"]> {
    const route = this.routeTask(taskText);
    const packager = new ContextPackager();
    return packager.catalog(route.skills);
  }

  startWorkflow(input: { taskText: string; title?: string; taskId?: string; provider?: string; model?: string; actor?: string }): WorkflowRecord {
    return getWorkflowEngine().startWorkflow(input);
  }

  getWorkflow(id: string): WorkflowRecord | null {
    return getWorkflowEngine().getWorkflow(id);
  }

  listWorkflows(status?: string): WorkflowRecord[] {
    return getWorkflowEngine().listWorkflows(status ? { status } : undefined);
  }

  advanceWorkflow(id: string, actor: string): TransitionResult {
    return getWorkflowEngine().advance(id, actor);
  }

  approveShip(id: string, approver: string, rollbackTarget: string): TransitionResult {
    return getWorkflowEngine().approveShip(id, approver, rollbackTarget);
  }

  cancelWorkflow(id: string, reason: string, actor: string): WorkflowRecord {
    return getWorkflowEngine().cancel(id, reason, actor);
  }

  requestSkip(id: string, step: string, reason: string): SkipRequestReply {
    return getWorkflowEngine().requestSkip(id, step, reason);
  }

  recordEvidence(input: Parameters<ReturnType<typeof getEvidenceCollector>["record"]>[0]): EvidenceRecord {
    return getEvidenceCollector().record(input);
  }

  listEvidence(workflowId: string): EvidenceRecord[] {
    return getEvidenceCollector().list(workflowId);
  }

  submitReview(input: Parameters<ReturnType<typeof getReviewerCouncil>["submitReview"]>[0]) {
    return getReviewerCouncil().submitReview(input);
  }

  listReviews(workflowId: string): ReviewFinding[] {
    return getReviewerCouncil().listFindings(workflowId);
  }

  resolveFinding(findingId: string, actor: string): void {
    getReviewerCouncil().resolveFinding(findingId, actor);
  }

  requiredLanes(workflowId: string): string[] {
    const workflow = getWorkflowEngine().getWorkflow(workflowId);
    if (!workflow) return [];
    return requiredReviewLanes(workflow.risk, [workflow.taskText]);
  }

  evaluateSkillPermission(skillIdOrSlug: string, capability: PermissionClass, tier: string): PermissionEvaluation {
    const skill = getEngineeringSkillRegistry().getSkill(skillIdOrSlug);
    if (!skill) {
      return { decision: "DENY", granted: false, reason: `skill '${skillIdOrSlug}' is not registered`, escalation: false };
    }
    return evaluatePermission({ skill, capability, requestedTier: tier });
  }

  listAudit(limit = 100): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM esk_audit ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows;
  }
}

let singleton: EngineeringSkillsService | null = null;

export function getEngineeringSkillsService(): EngineeringSkillsService {
  if (!singleton) singleton = new EngineeringSkillsService();
  return singleton;
}
