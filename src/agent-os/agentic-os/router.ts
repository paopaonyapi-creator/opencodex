// Phase 20.37 — deterministic auto router (§13): explainable scoring, hard
// disqualifiers (risk ceiling, disabled, denied tools), deterministic
// tie-break (lower risk → fewer tools → higher priority → lexical). Decision
// factors only — no chain-of-thought fields exist anywhere in this module.

import type { AgentManifest, RouteDecision, RouteRequest, SkillManifest } from "./types";

export interface RouterInput {
  request: RouteRequest;
  agents: AgentManifest[];
  skills: SkillManifest[];
  taskRisk: 0 | 1 | 2 | 3 | 4;
  availableTools?: string[];
}

export function routeTask(input: RouterInput): RouteDecision {
  const { request, agents, skills, taskRisk } = input;
  const goal = request.goal.toLowerCase();
  const availableTools = input.availableTools;
  const reasons: string[] = [];
  const rejected: RouteDecision["rejected"] = [];

  // Skill resolution: explicit request wins; otherwise trigger matching.
  let selectedSkills: SkillManifest[] = [];
  if (request.requestedSkill) {
    const explicit = skills.find((skill) => skill.slug === request.requestedSkill && skill.enabled);
    if (explicit) {
      selectedSkills.push(explicit);
      reasons.push(`explicit skill requested: ${explicit.slug}`);
    } else {
      reasons.push(`explicit skill '${request.requestedSkill}' not found or disabled — falling back to trigger match`);
    }
  }
  if (selectedSkills.length === 0) {
    const matches = skills
      .filter((skill) => skill.enabled && skill.triggerTerms.some((term) => goal.includes(term.toLowerCase())))
      .sort((a, b) => a.riskLevel - b.riskLevel || a.slug.localeCompare(b.slug));
    if (matches.length > 0) {
      selectedSkills.push(matches[0]!);
      reasons.push(`trigger match: skill '${matches[0]!.slug}'`);
    }
  }
  // Dependency skills of the selected skill (§11 loading rule).
  for (const selected of [...selectedSkills]) {
    for (const required of selected.workflow.requires) {
      const dependency = skills.find((skill) => skill.slug === required && skill.enabled);
      if (dependency && !selectedSkills.some((entry) => entry.slug === dependency.slug)) {
        selectedSkills.unshift(dependency);
        reasons.push(`dependency skill loaded: ${dependency.slug}`);
      }
    }
  }

  const requiredTools = [...new Set(selectedSkills.flatMap((skill) => skill.tools.required))];
  const missingTools = availableTools
    ? requiredTools.filter((tool) => !availableTools.includes(tool))
    : [];

  // Agent scoring.
  const scored = agents.map((agent) => {
    const agentReasons: string[] = [];
    let score = 0;
    let eligible = true;

    if (!agent.enabled) {
      eligible = false;
      agentReasons.push("agent disabled");
    }
    // The orchestrator's own execution is coordination (risk 1); for high-risk
    // tasks its job is to open the approval gate (§9.1), not to perform them.
    const effectiveRisk = agent.slug === "orchestrator" && taskRisk >= 3 ? 1 : taskRisk;
    if (effectiveRisk > agent.riskCeiling) {
      eligible = false;
      agentReasons.push(`risk ceiling ${agent.riskCeiling} below task risk ${taskRisk}`);
    }
    if (eligible && taskRisk >= 3 && agent.slug === "orchestrator") {
      score += 60;
      agentReasons.push("high-risk task: orchestrator opens the approval gate");
    }
    if (missingTools.length > 0) {
      eligible = false;
      agentReasons.push(`required tools unavailable: ${missingTools.join(", ")}`);
    }

    if (request.requestedAgent && request.requestedAgent === agent.slug) {
      score += 100;
      agentReasons.push("explicit agent requested");
    }
    const triggerHit = agent.routing.triggerTerms.find((term) => goal.includes(term.toLowerCase()));
    if (triggerHit) {
      score += 40;
      agentReasons.push(`trigger term '${triggerHit}'`);
    }
    const skillAffinity = selectedSkills.filter((skill) => agent.skills.includes(skill.slug)).length;
    if (skillAffinity > 0) {
      score += 30 * skillAffinity;
      agentReasons.push(`mapped skill affinity ×${skillAffinity}`);
    }
    score += agent.routing.priority / 10;

    // Write-capable task never routed to an agent that denies filesystem.write.
    const writesRequired = selectedSkills.some((skill) => skill.capabilities.includes("repo.write"));
    if (writesRequired && agent.tools.deny.includes("filesystem.write")) {
      eligible = false;
      agentReasons.push("task writes but agent denies filesystem.write (e.g. explorer)");
    }

    return { agent, score: Math.round(score * 10) / 10, eligible, agentReasons, skillAffinity };
  });

  for (const entry of scored.filter((entry) => !entry.eligible)) {
    rejected.push({ agentId: entry.agent.slug, reasons: entry.agentReasons });
  }

  const eligibleAgents = scored
    .filter((entry) => entry.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const riskDelta = a.agent.riskCeiling - b.agent.riskCeiling;
      if (riskDelta !== 0) return riskDelta;
      const toolDelta = a.agent.tools.allow.length - b.agent.tools.allow.length;
      if (toolDelta !== 0) return toolDelta;
      const priorityDelta = b.agent.routing.priority - a.agent.routing.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return a.agent.slug.localeCompare(b.agent.slug);
    });

  const winner = eligibleAgents[0];
  if (!winner) {
    return {
      agentId: "",
      skillIds: selectedSkills.map((skill) => skill.slug),
      riskLevel: taskRisk,
      approvalRequired: taskRisk >= 3,
      score: 0,
      reasons: [...reasons, "no eligible agent (all candidates disqualified)"],
      rejected,
    };
  }
  reasons.push(...winner.agentReasons);

  // Risk-3+ tasks always require approval before execution (§16).
  const approvalRequired = taskRisk >= 3;
  if (approvalRequired) reasons.push(`task risk ${taskRisk} requires approval`);

  return {
    agentId: winner.agent.slug,
    skillIds: selectedSkills.map((skill) => skill.slug),
    riskLevel: taskRisk,
    approvalRequired,
    score: winner.score,
    reasons,
    rejected,
  };
}
