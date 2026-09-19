// Phase 20.94 — automatic skill composition.
// Merges the curated catalog with SkillsGate records. Never executes skill code.

import { BUILT_IN_SKILLS } from "./catalog";
import type { SkillCompositionPlan, SkillManifest, TaskIntent } from "./types";

export interface SkillSource {
  list(): SkillManifest[];
}

export const DEFAULT_TOKEN_BUDGET = 18000;
export const DEFAULT_MIN_TRUST = 0.75;

export function composeSkills(
  intent: TaskIntent,
  opts?: {
    source?: SkillSource;
    tokenBudget?: number;
    minTrust?: number;
    extraSkills?: SkillManifest[];
  },
): SkillCompositionPlan {
  const tokenBudget = opts?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const minTrust = opts?.minTrust ?? DEFAULT_MIN_TRUST;
  const pool = [
    ...BUILT_IN_SKILLS,
    ...(opts?.source?.list() ?? []),
    ...(opts?.extraSkills ?? []),
  ];
  const byId = new Map<string, SkillManifest>();
  for (const skill of pool) {
    const prev = byId.get(skill.id);
    if (!prev || skill.trust.score > prev.trust.score) byId.set(skill.id, skill);
  }

  const denied: SkillCompositionPlan["denied"] = [];
  const candidates: SkillManifest[] = [];
  for (const skill of byId.values()) {
    if (skill.trust.status !== "trusted") {
      denied.push({ id: skill.id, reason: "trust status " + skill.trust.status });
      continue;
    }
    if (skill.trust.score < minTrust) {
      denied.push({ id: skill.id, reason: "trust score " + skill.trust.score + " < " + minTrust });
      continue;
    }
    if (skill.risk === "R4") {
      denied.push({ id: skill.id, reason: "R4 skills cannot auto-compose" });
      continue;
    }
    candidates.push(skill);
  }

  const needed = new Set(intent.skillIntents);
  const neededCaps = new Set(intent.capabilities);
  const scored = candidates
    .map((skill) => ({ skill, score: relevance(skill, needed, neededCaps) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.skill.trust.score - a.skill.trust.score);

  const selected: SkillManifest[] = [];
  let totalTokens = 0;
  for (const row of scored) {
    if (totalTokens + row.skill.context.estimatedTokens > tokenBudget) {
      denied.push({ id: row.skill.id, reason: "context budget exceeded" });
      continue;
    }
    selected.push(row.skill);
    totalTokens += row.skill.context.estimatedTokens;
    for (const dep of row.skill.requires) {
      const depSkill = byId.get(dep);
      if (!depSkill) continue;
      if (depSkill.trust.status !== "trusted" || depSkill.trust.score < minTrust) {
        denied.push({ id: dep, reason: "required dependency failed trust" });
        continue;
      }
      if (!selected.some((s) => s.id === dep) && totalTokens + depSkill.context.estimatedTokens <= tokenBudget) {
        selected.push(depSkill);
        totalTokens += depSkill.context.estimatedTokens;
      }
    }
    if (covers(selected, needed, neededCaps) && selected.length >= 1) {
      // keep going only for required dependencies already handled
      if (needed.size === 0 || selected.some((s) => s.intents.some((i) => needed.has(i)))) {
        // stop once capabilities are covered to keep the set minimal
        const remainingCaps = [...neededCaps].filter((c) => !selected.some((s) => s.capabilities.includes(c)));
        const remainingIntents = [...needed].filter((i) => !selected.some((s) => s.intents.includes(i)));
        if (remainingCaps.length === 0 && remainingIntents.length === 0) break;
      }
    }
  }

  const conflicts = detectConflicts(selected);
  const dropped = new Set(conflicts.filter((c) => c.resolution.startsWith("drop:")).map((c) => c.resolution.slice(5)));
  const kept = selected.filter((s) => !dropped.has(s.id));
  for (const id of dropped) {
    denied.push({ id, reason: "conflict resolution dropped this skill" });
  }

  return {
    selected: kept.map((s) => ({
      id: s.id,
      version: s.version,
      reason: reasonFor(s, intent),
      trustScore: s.trust.score,
      estimatedTokens: s.context.estimatedTokens,
    })),
    denied,
    conflicts,
    totalTokens: kept.reduce((n, s) => n + s.context.estimatedTokens, 0),
    tokenBudget,
  };
}

function relevance(skill: SkillManifest, intents: Set<string>, caps: Set<string>): number {
  let score = 0;
  for (const intent of skill.intents) if (intents.has(intent)) score += 3;
  for (const cap of skill.capabilities) if (caps.has(cap)) score += 2;
  score += skill.trust.score;
  return score;
}

function covers(selected: SkillManifest[], intents: Set<string>, caps: Set<string>): boolean {
  const haveI = new Set(selected.flatMap((s) => s.intents));
  const haveC = new Set(selected.flatMap((s) => s.capabilities));
  return [...intents].every((i) => haveI.has(i)) && [...caps].every((c) => haveC.has(c));
}

function detectConflicts(selected: SkillManifest[]): SkillCompositionPlan["conflicts"] {
  const out: SkillCompositionPlan["conflicts"] = [];
  const pkg = selected.filter((s) => (s.conflicts ?? []).some((c) => c.startsWith("package-manager:")));
  if (pkg.length >= 2) {
    const winner = [...pkg].sort((a, b) => b.trust.score - a.trust.score)[0]!;
    for (const loser of pkg) {
      if (loser.id === winner.id) continue;
      out.push({
        a: winner.id,
        b: loser.id,
        field: "package-manager",
        resolution: "drop:" + loser.id,
      });
    }
  }
  return out;
}

function reasonFor(skill: SkillManifest, intent: TaskIntent): string {
  const matched = skill.intents.filter((i) => intent.skillIntents.includes(i));
  if (matched.length) return "intent match: " + matched.join(",");
  const caps = skill.capabilities.filter((c) => intent.capabilities.includes(c));
  if (caps.length) return "capability match: " + caps.join(",");
  return "dependency";
}
