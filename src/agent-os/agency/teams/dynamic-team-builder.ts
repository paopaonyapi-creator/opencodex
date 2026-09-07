// Phase 20.8 — Dynamic Team Builder
// Constructs multi-disciplinary specialist teams tailored to a task mission.
// Enforces role balance, risk classification, mandatory reviewers, and Reality Checker gates.

import { getAgentRegistry } from "../registry/agent-registry";
import { getAgentSearchEngine } from "../search/lexical-search";
import { getPresetLoader } from "./preset-loader";
import type {
  DynamicTeam,
  RiskLevel,
  SelectedAgent,
  AgencyAgent,
} from "../types";

export interface TeamBuildOptions {
  presetId?: string;
  maxAgents?: number;
  mode?: "sequential" | "parallel" | "hybrid";
}

export class DynamicTeamBuilder {
  /**
   * Classifies task risk level into low, medium, high, or critical.
   */
  classifyRisk(mission: string): RiskLevel {
    const text = mission.toLowerCase();

    // Critical: destructive data operations, secret rotations, irreversible actions
    if (
      text.includes("delete data") ||
      text.includes("drop table") ||
      text.includes("rotate secret") ||
      text.includes("production db") ||
      text.includes("rm -rf") ||
      text.includes("irreversible")
    ) {
      return "critical";
    }

    // High: auth, credentials, permissions, network endpoints, migrations, deployments, MCP write tools
    if (
      text.includes("auth") ||
      text.includes("credential") ||
      text.includes("token") ||
      text.includes("permission") ||
      text.includes("rbac") ||
      text.includes("migration") ||
      text.includes("deploy") ||
      text.includes("mcp write") ||
      text.includes("security")
    ) {
      return "high";
    }

    // Medium: code modifications, new tests, config updates, tool additions
    if (
      text.includes("edit") ||
      text.includes("create") ||
      text.includes("build") ||
      text.includes("implement") ||
      text.includes("refactor") ||
      text.includes("test") ||
      text.includes("tool")
    ) {
      return "medium";
    }

    // Low: read-only, explain, search, summarize, documentation
    return "low";
  }

  /**
   * Builds an optimized dynamic team for a mission.
   */
  async buildTeam(mission: string, options: TeamBuildOptions = {}): Promise<DynamicTeam> {
    const registry = getAgentRegistry();
    const searchEngine = getAgentSearchEngine();
    const presetLoader = getPresetLoader();

    const riskLevel = this.classifyRisk(mission);
    const maxAgents = options.maxAgents ?? 6;
    const rationale: string[] = [];

    // If a preset was explicitly requested
    if (options.presetId) {
      const preset = presetLoader.getPreset(options.presetId);
      if (preset) {
        rationale.push(`Using explicitly requested preset '${preset.name}'`);
        return this.buildFromPreset(preset, mission, riskLevel);
      }
    }

    // Otherwise, search and construct a dynamic team based on intent
    const searchResults = searchEngine.search({
      query: mission,
      limit: 12,
    });

    const candidatePool = searchResults.map((r) => r.agent);
    const usedSlugs = new Set<string>();

    const toSelected = (agent: AgencyAgent, role: SelectedAgent["role"], reasons: string[]): SelectedAgent => {
      usedSlugs.add(agent.slug);
      return {
        slug: agent.slug,
        name: agent.name,
        role,
        division: agent.division,
        score: searchResults.find((r) => r.agent.slug === agent.slug)?.score ?? 0.85,
        reasons,
        color: agent.color,
        emoji: agent.emoji,
      };
    };

    const createFallbackAgent = (slug: string, name: string, division: string, capabilities: string[]): AgencyAgent => {
      const agent: AgencyAgent = {
        id: `agent_${slug}`,
        slug,
        name,
        description: `${name} specialist agent`,
        division,
        sourcePath: "bundled",
        capabilities,
        keywords: [slug, ...capabilities],
        deliverables: [],
        criticalRules: [],
        successMetrics: [],
        bodyLoaded: false,
        hashes: { metadata: "", body: "" },
        trust: { source: "bundled", verified: true },
        safety: { status: "clean", findings: [] },
        enabled: true,
        isCustom: false,
      };
      try {
        registry.upsertAgent(agent);
      } catch {
        // Best effort
      }
      return agent;
    };

    // 1. Pick Lead Specialist
    let leadAgent = candidatePool.find((a) => !usedSlugs.has(a.slug));
    if (!leadAgent) {
      leadAgent = registry.getAgentBySlug("software-architect") ?? registry.listAgents()[0] ?? createFallbackAgent("software-architect", "Software Architect", "engineering", ["architecture"]);
    }
    const lead = toSelected(leadAgent, "lead", [`Primary domain specialist for mission`]);
    rationale.push(`Assigned ${lead.name} as Team Lead`);

    // 2. Planners (0-1 for small/medium, 1-2 for high/critical)
    const planners: SelectedAgent[] = [];
    if (riskLevel === "high" || riskLevel === "critical" || mission.length > 50) {
      const plannerCandidate = candidatePool.find(
        (a) => !usedSlugs.has(a.slug) && (a.division === "engineering" || a.division === "project-management"),
      );
      if (plannerCandidate) {
        planners.push(toSelected(plannerCandidate, "planner", ["System architecture and task planning"]));
        rationale.push(`Added ${plannerCandidate.name} to structure implementation plan`);
      }
    }

    // 3. Builders (1 to 3)
    const builders: SelectedAgent[] = [];
    const builderCandidates = candidatePool.filter(
      (a) => !usedSlugs.has(a.slug) && a.division !== "testing",
    );

    for (const bc of builderCandidates) {
      if (builders.length >= 3 || (1 + planners.length + builders.length) >= (maxAgents - 2)) break;
      builders.push(toSelected(bc, "builder", ["Core capability builder for requested components"]));
    }

    // Ensure at least 1 builder
    if (builders.length === 0) {
      let fallbackBuilder =
        (!usedSlugs.has("backend-architect") ? registry.getAgentBySlug("backend-architect") : null) ??
        registry.getAgentBySlug("mcp-builder") ??
        registry.getAgentBySlug("frontend-developer") ??
        createFallbackAgent("mcp-builder", "MCP Builder", "engineering", ["tool-building"]);

      if (usedSlugs.has(fallbackBuilder.slug)) {
        fallbackBuilder = createFallbackAgent("fullstack-developer", "Fullstack Developer", "engineering", ["development"]);
      }
      builders.push(toSelected(fallbackBuilder, "builder", ["Core builder role"]));
    }

    // 4. Mandatory Reviewers
    const reviewers: SelectedAgent[] = [];

    // Security Reviewer if high or critical, or touching security topics
    if (riskLevel === "high" || riskLevel === "critical" || mission.toLowerCase().includes("auth")) {
      const secAgent = registry.getAgentBySlug("security-architect") ?? registry.getAgentBySlug("security-engineer") ?? createFallbackAgent("security-engineer", "Security Engineer", "security", ["security"]);
      if (!usedSlugs.has(secAgent.slug)) {
        reviewers.push(toSelected(secAgent, "reviewer", ["Mandatory security audit for high/critical risk operations"]));
        rationale.push(`Mandatory security reviewer ${secAgent.name} assigned`);
      }
    }

    // Code Reviewer for any code edits or risk >= medium
    if (riskLevel !== "low") {
      const crAgent = registry.getAgentBySlug("code-reviewer") ?? createFallbackAgent("code-reviewer", "Code Reviewer", "engineering", ["code-review"]);
      if (!usedSlugs.has(crAgent.slug)) {
        reviewers.push(toSelected(crAgent, "reviewer", ["Rigorous correctness and quality assurance"]));
        rationale.push(`Code Reviewer assigned to inspect diffs and proposed changes`);
      }
    }

    // 5. Mandatory Validators: Reality Checker for risk >= medium
    const validators: SelectedAgent[] = [];
    if (riskLevel !== "low") {
      const realityChecker = registry.getAgentBySlug("reality-checker") ?? registry.getAgentBySlug("evidence-collector") ?? createFallbackAgent("reality-checker", "Reality Checker", "testing", ["reality-validation"]);
      if (!usedSlugs.has(realityChecker.slug)) {
        validators.push(toSelected(realityChecker, "validator", ["Ground-truth claim and evidence verification"]));
        rationale.push(`Reality Checker assigned as mandatory validation gate`);
      }
    }

    const executionMode = options.mode ?? (builders.length > 1 ? "hybrid" : "sequential");

    return {
      id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `Team-${lead.name.replace(/\s+/g, "")}`,
      mission,
      riskLevel,
      lead,
      planners,
      builders,
      reviewers,
      validators,
      executionMode,
      rationale,
    };
  }

  private buildFromPreset(preset: any, mission: string, riskLevel: RiskLevel): DynamicTeam {
    const registry = getAgentRegistry();
    const resolveAgent = (slugs: string[] = [], fallbackSlug = "software-architect"): AgencyAgent => {
      for (const s of slugs) {
        const found = registry.getAgentBySlug(s);
        if (found) return found;
      }
      return registry.getAgentBySlug(fallbackSlug) ?? registry.listAgents()[0] ?? {
        id: `agent_${fallbackSlug}`,
        slug: fallbackSlug,
        name: fallbackSlug,
        description: fallbackSlug,
        division: "engineering",
        sourcePath: "bundled",
        capabilities: [],
        keywords: [],
        deliverables: [],
        criticalRules: [],
        successMetrics: [],
        bodyLoaded: false,
        hashes: { metadata: "", body: "" },
        trust: { source: "bundled", verified: true },
        safety: { status: "clean", findings: [] },
        enabled: true,
        isCustom: false,
      };
    };

    const leadAgent = resolveAgent(preset.lead?.preferred, "software-architect");
    const lead: SelectedAgent = {
      slug: leadAgent.slug,
      name: leadAgent.name,
      role: "lead",
      division: leadAgent.division,
      score: 0.95,
      reasons: [`Designated team lead from preset '${preset.name}'`],
      color: leadAgent.color,
      emoji: leadAgent.emoji,
    };

    const planners: SelectedAgent[] = (preset.planners?.preferred ?? []).map((s: string) => {
      const a = resolveAgent([s]);
      return {
        slug: a.slug,
        name: a.name,
        role: "planner",
        division: a.division,
        score: 0.9,
        reasons: ["Preset planner role"],
      };
    });

    const builders: SelectedAgent[] = (preset.builders?.preferred ?? []).slice(0, 3).map((s: string) => {
      const a = resolveAgent([s], "backend-architect");
      return {
        slug: a.slug,
        name: a.name,
        role: "builder",
        division: a.division,
        score: 0.9,
        reasons: ["Preset builder role"],
      };
    });

    const reviewers: SelectedAgent[] = (preset.reviewers?.preferred ?? []).map((s: string) => {
      const a = resolveAgent([s], "code-reviewer");
      return {
        slug: a.slug,
        name: a.name,
        role: "reviewer",
        division: a.division,
        score: 0.9,
        reasons: ["Preset reviewer role"],
      };
    });

    const validators: SelectedAgent[] = (preset.validators?.preferred ?? ["reality-checker"]).map((s: string) => {
      const a = resolveAgent([s], "reality-checker");
      return {
        slug: a.slug,
        name: a.name,
        role: "validator",
        division: a.division,
        score: 0.95,
        reasons: ["Preset validator role"],
      };
    });

    return {
      id: `team_${preset.id}_${Date.now()}`,
      name: preset.name,
      mission,
      riskLevel,
      lead,
      planners,
      builders,
      reviewers,
      validators,
      executionMode: preset.defaultMode ?? "hybrid",
      rationale: [`Constructed directly from preset '${preset.name}'`],
    };
  }
}

let defaultTeamBuilder: DynamicTeamBuilder | null = null;
export function getDynamicTeamBuilder(): DynamicTeamBuilder {
  if (!defaultTeamBuilder) {
    defaultTeamBuilder = new DynamicTeamBuilder();
  }
  return defaultTeamBuilder;
}
