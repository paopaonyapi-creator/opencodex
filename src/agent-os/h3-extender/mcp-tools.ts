// Phase 21.02 — MiniMax H3 Extender MCP Tools (pao.video.h3.*).

import { getH3ExtenderService } from "./service";

export interface H3McpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: number;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createH3McpTools(): H3McpToolDef[] {
  const svc = getH3ExtenderService();

  return [
    {
      name: "pao.video.h3.project.create",
      description: "Create a new MiniMax H3 Extender video production project.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          productionMode: { type: "string", enum: ["continuous", "independent"], description: "Video generation mode" },
          budgetLimit: { type: "number", description: "Optional budget limit in USD" },
        },
        required: ["name"],
      },
      riskLevel: 1,
      handler: async (args) => {
        const p = svc.createProject(String(args.name), (args.productionMode as any) || "continuous", args.budgetLimit ? Number(args.budgetLimit) : undefined);
        return { ok: true, project: p };
      },
    },
    {
      name: "pao.video.h3.clip.add",
      description: "Add a video scene clip to an H3 project sequence with structured prompt.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          sequenceIndex: { type: "number", description: "Order in video sequence (0, 1, ...)" },
          prompt: { type: "object", description: "Structured prompt JSON (subject, action, lighting, camera)" },
          duration: { type: "number", description: "Clip duration in seconds (e.g. 5.0)" },
          seed: { type: "string", description: "Optional deterministic generation seed" },
        },
        required: ["projectId", "sequenceIndex", "prompt"],
      },
      riskLevel: 1,
      handler: async (args) => {
        const c = svc.addClip(String(args.projectId), Number(args.sequenceIndex), (args.prompt as any) || {}, args.duration ? Number(args.duration) : 5.0, args.seed ? String(args.seed) : undefined);
        return { ok: true, clip: c };
      },
    },
    {
      name: "pao.video.h3.clip.generate",
      description: "Trigger video generation attempt for a clip via MiniMax H3 Extender.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string", description: "Clip ID to generate" },
        },
        required: ["clipId"],
      },
      riskLevel: 2,
      handler: async (args) => {
        const attempt = svc.generateClip(String(args.clipId));
        return { ok: true, attempt };
      },
    },
    {
      name: "pao.video.h3.clip.validate",
      description: "Human or Quality review validates a generated clip preview.",
      parameters: {
        type: "object",
        properties: {
          clipId: { type: "string", description: "Clip ID to validate" },
          validatorId: { type: "string", description: "Validator identity" },
        },
        required: ["clipId"],
      },
      riskLevel: 2,
      handler: async (args) => {
        const c = svc.validateClip(String(args.clipId), args.validatorId ? String(args.validatorId) : "human-operator");
        return { ok: true, clip: c };
      },
    },
  ];
}
