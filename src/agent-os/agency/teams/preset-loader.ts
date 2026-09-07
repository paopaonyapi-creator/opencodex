// Phase 20.8 — Agency Team Preset Loader
// Defines pre-seeded production teams for Pao-hubPro.

import { openAgentOsDb } from "../../db";
import type { TeamPreset } from "../types";

export const DEFAULT_TEAM_PRESETS: TeamPreset[] = [
  {
    id: "pao-dev",
    name: "Pao Dev Team",
    description: "Full-stack software engineering team for core platform features and bug fixes.",
    lead: {
      preferred: ["software-architect", "backend-architect"],
      capabilities: ["architecture", "backend"],
    },
    planners: {
      preferred: ["software-architect"],
      capabilities: ["architecture"],
    },
    builders: {
      preferred: ["frontend-developer", "backend-architect", "ai-engineer"],
      capabilities: ["backend", "frontend", "ai-engineering"],
    },
    reviewers: {
      preferred: ["code-reviewer", "security-architect"],
      capabilities: ["code-review", "security"],
    },
    validators: {
      preferred: ["reality-checker"],
      capabilities: ["reality-validation"],
    },
    maxAgents: 6,
    defaultMode: "hybrid",
  },
  {
    id: "pao-mcp",
    name: "Pao MCP Team",
    description: "Specialized team for building, testing, and hardening Model Context Protocol servers & tools.",
    lead: {
      preferred: ["mcp-builder"],
      capabilities: ["mcp"],
    },
    planners: {
      preferred: ["software-architect"],
      capabilities: ["architecture"],
    },
    builders: {
      preferred: ["backend-architect", "ai-engineer"],
      capabilities: ["mcp", "backend"],
    },
    reviewers: {
      preferred: ["code-reviewer", "security-architect"],
      capabilities: ["code-review", "security"],
    },
    validators: {
      preferred: ["reality-checker"],
      capabilities: ["reality-validation"],
    },
    maxAgents: 6,
    defaultMode: "hybrid",
  },
  {
    id: "pao-stock-research",
    name: "Pao Stock Research Team",
    description: "Market intelligence, visual trend analysis, and keyword research for commercial stock media.",
    lead: {
      preferred: ["trend-researcher"],
      capabilities: ["market-research", "research"],
    },
    builders: {
      preferred: ["seo-specialist", "content-creator", "image-prompt-engineer"],
      capabilities: ["seo", "content", "prompt-engineering"],
    },
    reviewers: {
      preferred: ["code-reviewer"],
      capabilities: ["research"],
    },
    validators: {
      preferred: ["reality-checker"],
      capabilities: ["reality-validation"],
    },
    maxAgents: 5,
    defaultMode: "sequential",
  },
  {
    id: "pao-stock-production",
    name: "Pao Stock Production Team",
    description: "Creative visual prompt engineering, batch generation optimization, and commercial utility grading.",
    lead: {
      preferred: ["brand-guardian"],
      capabilities: ["prompt-engineering"],
    },
    builders: {
      preferred: ["image-prompt-engineer", "workflow-optimizer", "ai-engineer"],
      capabilities: ["image-generation", "workflow-optimization"],
    },
    reviewers: {
      preferred: ["code-reviewer"],
      capabilities: ["stock-production"],
    },
    validators: {
      preferred: ["reality-checker"],
      capabilities: ["reality-validation"],
    },
    maxAgents: 6,
    defaultMode: "hybrid",
  },
  {
    id: "pao-security",
    name: "Pao Security Review Team",
    description: "Application security audit, threat detection, credential isolation, and permission verification.",
    lead: {
      preferred: ["security-architect"],
      capabilities: ["security"],
    },
    builders: {
      preferred: ["security-engineer"],
      capabilities: ["application-security"],
    },
    reviewers: {
      preferred: ["security-engineer", "code-reviewer"],
      capabilities: ["security", "identity-access"],
    },
    validators: {
      preferred: ["reality-checker"],
      capabilities: ["reality-validation"],
    },
    maxAgents: 5,
    defaultMode: "sequential",
  },
];

export class PresetLoader {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Initializes or refreshes pre-seeded team presets in SQLite.
   */
  initPresets(): void {
    const now = new Date().toISOString();
    for (const preset of DEFAULT_TEAM_PRESETS) {
      this.db.query(`
        INSERT INTO agency_team_presets (
          id, name, description, lead_roles_json, planner_roles_json, builder_roles_json,
          reviewer_roles_json, validator_roles_json, max_agents, default_mode, is_system, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          lead_roles_json = excluded.lead_roles_json,
          planner_roles_json = excluded.planner_roles_json,
          builder_roles_json = excluded.builder_roles_json,
          reviewer_roles_json = excluded.reviewer_roles_json,
          validator_roles_json = excluded.validator_roles_json,
          max_agents = excluded.max_agents,
          default_mode = excluded.default_mode
      `).run(
        preset.id,
        preset.name,
        preset.description,
        JSON.stringify(preset.lead),
        JSON.stringify(preset.planners ?? {}),
        JSON.stringify(preset.builders),
        JSON.stringify(preset.reviewers),
        JSON.stringify(preset.validators),
        preset.maxAgents,
        preset.defaultMode,
        now,
      );
    }
  }

  /**
   * Retrieves a preset by ID.
   */
  getPreset(id: string): TeamPreset | null {
    const row = this.db.query("SELECT * FROM agency_team_presets WHERE id = ?").get(id) as any;
    if (!row) {
      // Fallback to in-memory list
      return DEFAULT_TEAM_PRESETS.find((p) => p.id === id) ?? null;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      lead: JSON.parse(row.lead_roles_json || "{}"),
      planners: JSON.parse(row.planner_roles_json || "{}"),
      builders: JSON.parse(row.builder_roles_json || "{}"),
      reviewers: JSON.parse(row.reviewer_roles_json || "{}"),
      validators: JSON.parse(row.validator_roles_json || "{}"),
      maxAgents: Number(row.max_agents || 6),
      defaultMode: row.default_mode,
    };
  }

  /**
   * Lists all available team presets.
   */
  listPresets(): TeamPreset[] {
    const rows = this.db.query("SELECT * FROM agency_team_presets ORDER BY is_system DESC, name ASC").all() as any[];
    if (rows.length === 0) {
      return DEFAULT_TEAM_PRESETS;
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      lead: JSON.parse(row.lead_roles_json || "{}"),
      planners: JSON.parse(row.planner_roles_json || "{}"),
      builders: JSON.parse(row.builder_roles_json || "{}"),
      reviewers: JSON.parse(row.reviewer_roles_json || "{}"),
      validators: JSON.parse(row.validator_roles_json || "{}"),
      maxAgents: Number(row.max_agents || 6),
      defaultMode: row.default_mode,
    }));
  }
}

let defaultPresetLoader: PresetLoader | null = null;
export function getPresetLoader(): PresetLoader {
  if (!defaultPresetLoader) {
    defaultPresetLoader = new PresetLoader();
    defaultPresetLoader.initPresets();
  }
  return defaultPresetLoader;
}
