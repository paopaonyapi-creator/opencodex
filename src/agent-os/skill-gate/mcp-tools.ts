// Phase 20.57 — Skill Gate MCP Tools
// (spec §9, §47; GOLD slice #5).
//
// Exposes constrained skill registry and inspection tools to agents
// using the shared WebMcpToolDefinition convention (R0–R1 read-only,
// deploy is high-risk and requires human approval via the service).

import { getSkillGateService } from "./service";
import type { SkillStatus } from "./types";

export interface SkillGateMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createSkillGateMcpTools(): SkillGateMcpTool[] {
  const service = getSkillGateService();

  return [
    {
      name: "pao.skill.list",
      description: "List registered agent skills with status, trust level, and risk tier.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "quarantined", "imported", "review_required", "revoked", "deprecated"] },
          namespace: { type: "string" },
        },
      },
      handler: async (args) => {
        const status = typeof args.status === "string" ? (args.status as SkillStatus) : undefined;
        const namespace = typeof args.namespace === "string" ? args.namespace : undefined;
        const skills = service.listSkills({ status, namespace });
        return {
          ok: true,
          count: skills.length,
          skills: skills.map((s) => ({
            id: s.id,
            namespace: s.namespace,
            slug: s.slug,
            displayName: s.displayName,
            version: s.currentVersion,
            status: s.status,
            trustLevel: s.trustLevel,
            riskLevel: s.riskLevel,
          })),
        };
      },
    },
    {
      name: "pao.skill.inspect",
      description: "Inspect a specific skill version, its manifest, risk score, and scan findings.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "Skill ID (sk_...)" },
          version: { type: "string", description: "Optional version string; defaults to currentVersion" },
        },
        required: ["skillId"],
      },
      handler: async (args) => {
        const skillId = String(args.skillId);
        const skill = service.getSkill(skillId);
        if (!skill) return { ok: false, error: "skill not found" };
        const versionStr = typeof args.version === "string" ? args.version : skill.currentVersion;
        const version = versionStr ? service.getVersion(skillId, versionStr) : null;
        const findings = version ? service.listFindings(version.id) : [];
        return {
          ok: true,
          skill,
          version,
          findings,
        };
      },
    },
    {
      name: "pao.skill.sources",
      description: "List skill sources (local, github, marketplace, capability-lab).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const sources = service.listSources();
        return { ok: true, count: sources.length, sources };
      },
    },
  ];
}
