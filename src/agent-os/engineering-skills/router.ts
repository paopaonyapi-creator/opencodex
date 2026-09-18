// Phase 20.91b — Engineering Skill Runtime: metadata-first Skill Router.
//
// Routing is deterministic: intent extraction + risk classification + candidate
// generation from registry metadata → permission filter → MINIMAL COVERING SET
// (smallest set covering intent, stage, risk, platform, changed surface — never
// "load all skills just in case", source §11.2). Every route carries an
// explanation with rejected candidates and reasons (source §30.2).

import { readEngineeringSkillsFlags } from "./types";
import { getEngineeringSkillRegistry, STAGE_ORDER, type PackRecord } from "./registry";
import { classifyRisk, type RiskClassification } from "./policy";
import type { LifecycleStage, NormalizedSkill, RouteExplanation } from "./types";

/** Intents recognized from the task text; most specific rules come first. */
const INTENT_RULES: Array<{ intent: string; keywords: RegExp; stages: LifecycleStage[] }> = [
  { intent: "fix", keywords: /\b(fix|bug|broken|crash|regression|error)\b/i, stages: ["verify", "build", "review"] },
  { intent: "document", keywords: /\b(document|readme|docs|adr|write a prd|spec)\b/i, stages: ["define", "ship"] },
  { intent: "review", keywords: /\b(review|audit|check)\b/i, stages: ["review"] },
  { intent: "ship", keywords: /\b(deploy|release|ship|production|launch)\b/i, stages: ["review", "ship"] },
  { intent: "optimize", keywords: /\b(optimi[sz]e|performance|speed up|slow)\b/i, stages: ["review", "build"] },
  { intent: "new_feature", keywords: /\b(add|create|implement|build|feature|new)\b/i, stages: ["define", "plan", "build", "verify", "review"] },
];

/** Ceremony stages a LOW-risk implement/fix/optimize task may skip (source §10: default map, not a load-everything requirement). */
const CEREMONY_STAGES: LifecycleStage[] = ["define", "plan", "review"];

export interface SkillRoute {
  intent: string;
  risk: RiskClassification;
  skills: NormalizedSkill[];
  explanation: RouteExplanation;
}

export class SkillRouter {
  constructor(private registry = getEngineeringSkillRegistry()) {}

  /** Route a task to the minimal covering skill set, with a debuggable explanation. */
  routeTask(taskText: string, opts?: { provider?: string }): SkillRoute {
    const flags = readEngineeringSkillsFlags();
    if (!flags.routerEnabled) {
      throw new Error("Engineering Skill Router is disabled by flag");
    }
    const intent = this.extractIntent(taskText);
    const risk = classifyRisk(taskText);
    const neededStages = this.stagesFor(intent, risk.risk);
    const skills = this.registry.listSkills(undefined, { enabledOnly: true });
    const activePacks = new Map(this.registry.listPacks({ enabled: true }).map((p) => [p.id, p] as const));

    // Candidates from metadata: keyword hits are EXPLICIT task surfaces (always
    // routed); intent-only hits are FILL candidates competing for stage coverage.
    const explicit: NormalizedSkill[] = [];
    const fills: NormalizedSkill[] = [];
    const rejected: RouteExplanation["rejected"] = [];
    for (const skill of skills) {
      const pack = activePacks.get(skill.packId);
      if (!pack) {
        rejected.push({ slug: skill.slug, reason: "pack not enabled/active" });
        continue;
      }
      if (opts?.provider && skill.compatibleProviders.length > 0 && !skill.compatibleProviders.includes(opts.provider)) {
        rejected.push({ slug: skill.slug, reason: `provider '${opts.provider}' not compatible` });
        continue;
      }
      const keywordHit = skill.triggers.keywords.some((k) => taskText.toLowerCase().includes(k.toLowerCase()));
      if (keywordHit) {
        explicit.push(skill);
        continue;
      }
      if (skill.triggers.intents.includes(intent.intent)) fills.push(skill);
      else rejected.push({ slug: skill.slug, reason: "no trigger match" });
    }

    const selected: NormalizedSkill[] = [...explicit];
    const selectedReasons = new Map<string, string>();
    for (const skill of explicit) {
      const stages = skill.lifecycleStages.filter((s) => neededStages.includes(s));
      selectedReasons.set(skill.slug, `explicit trigger match (${stages.join("/") || "supporting"})`);
    }
    // Fill uncovered stages with the most specialized remaining candidate —
    // minimal covering set, never "load all skills just in case" (source §11.2).
    for (const stage of neededStages) {
      if (selected.some((s) => s.lifecycleStages.includes(stage))) continue;
      const pool = fills
        .filter((s) => s.lifecycleStages.includes(stage) && !selected.includes(s))
        .sort((a, b) => this.specialization(b, stage) - this.specialization(a, stage) || a.slug.localeCompare(b.slug));
      if (pool.length === 0) continue;
      const chosen = pool[0]!;
      selected.push(chosen);
      selectedReasons.set(chosen.slug, `covers stage '${stage}' (intent fill)`);
    }
    // Mandatory security rider on high/critical tasks.
    if (risk.risk === "high" || risk.risk === "critical") {
      const security = [...explicit, ...fills].find((s) => s.slug === "security-and-hardening");
      if (security && !selected.includes(security)) {
        selected.push(security);
        selectedReasons.set(security.slug, `mandatory on ${risk.risk}-risk task (${risk.matchedRules.join(", ")})`);
      }
    }

    const ordered = selected.sort((a, b) => this.earliestStage(a) - this.earliestStage(b) || a.slug.localeCompare(b.slug));
    const explanation: RouteExplanation = {
      intent: intent.intent,
      risk: risk.risk,
      selected: ordered.map((s) => ({ slug: s.slug, packId: s.packId, stage: s.lifecycleStages[0] ?? "build", reason: selectedReasons.get(s.slug) ?? "candidate" })),
      rejected,
      stagesCovered: [...new Set(ordered.flatMap((s) => s.lifecycleStages))].filter((s) => neededStages.includes(s)).sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b)),
    };
    return { intent: intent.intent, risk, skills: ordered, explanation };
  }

  private stagesFor(intent: { intent: string; stages: LifecycleStage[] }, risk: string): LifecycleStage[] {
    if (risk === "low" && ["implement", "fix", "optimize"].includes(intent.intent)) {
      return intent.stages.filter((s) => !CEREMONY_STAGES.includes(s));
    }
    return intent.stages;
  }

  private extractIntent(taskText: string): { intent: string; stages: LifecycleStage[] } {
    for (const rule of INTENT_RULES) {
      if (rule.keywords.test(taskText)) return { intent: rule.intent, stages: rule.stages };
    }
    return { intent: "implement", stages: ["plan", "build", "verify", "review"] };
  }

  /** Specialization: skills whose FIRST stage is the needed one are preferred. */
  private specialization(skill: NormalizedSkill, stage: LifecycleStage): number {
    const first = skill.lifecycleStages[0];
    const coverage = skill.lifecycleStages.filter((s) => CEREMONY_STAGES.concat(["build", "verify", "intake", "observe"] as LifecycleStage[]).includes(s)).length;
    return (first === stage ? 10 : 0) + coverage;
  }

  private earliestStage(skill: NormalizedSkill): number {
    const idx = skill.lifecycleStages.map((s) => STAGE_ORDER.indexOf(s)).filter((i) => i >= 0);
    return idx.length > 0 ? Math.min(...idx) : STAGE_ORDER.length;
  }
}

let routerSingleton: SkillRouter | null = null;

export function getSkillRouter(): SkillRouter {
  if (!routerSingleton) routerSingleton = new SkillRouter();
  return routerSingleton;
}

export type { PackRecord };
