// Phase 20.91b — Engineering Skill Runtime MCP tools.
// Read-only surfaces are R0; mutating runtime surfaces traverse the policy
// engine inside the modules (deny-by-default, evidence gates, human ship gate).

import type { EngineeringSkillsService } from "./service";
import { EngineeringSkillsError } from "./types";

export interface EngineeringSkillsMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function errToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof EngineeringSkillsError) {
    return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message, detail: err.detail } };
  }
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createEngineeringSkillsMcpTools(service: EngineeringSkillsService): EngineeringSkillsMcpTool[] {
  return [
    {
      name: "engineering_skills.health",
      description: "Engineering Skill Runtime health (Phase 20.91): pack/skill/workflow counts, feature flags, seed invariant.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          return { ...service.health(), ok: true };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.list_packs",
      description: "List registered skill packs with lifecycle state (QUARANTINED/CANDIDATE/ACTIVE/ROLLED_BACK), trust, and pinned commit.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const packs = service.listPacks();
          return { ok: true, count: packs.length, packs };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.list_skills",
      description: "List normalized skills across packs: lifecycle stages, triggers, permissions, risk. Catalog metadata only (L0) — never full skill bodies.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: { enabledOnly: { type: "boolean", description: "Only enabled skills" } },
      },
      handler: async (args) => {
        try {
          const skills = service.listSkills(args.enabledOnly === true);
          return {
            ok: true,
            count: skills.length,
            skills: skills.map((s) => ({ id: s.id, packId: s.packId, slug: s.slug, stages: s.lifecycleStages, risk: s.riskLevel, permissions: s.permissions, enabled: s.enabled })),
          };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.route_task",
      description: "Route a task to the minimal covering skill set with a full explanation (intent, risk, selected, rejected+reasons).",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task text to route" },
          provider: { type: "string", description: "Optional provider compatibility filter" },
        },
        required: ["task"],
      },
      handler: async (args) => {
        try {
          const route = service.routeTask(String(args.task), typeof args.provider === "string" ? args.provider : undefined);
          return { ok: true, intent: route.intent, risk: route.risk, explanation: route.explanation, skills: route.skills.map((s) => s.slug) };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.start_workflow",
      description: "Start a lifecycle workflow run for a task (routes skills, classifies risk, persists an INTAKE run).",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string" },
          title: { type: "string" },
          provider: { type: "string" },
        },
        required: ["task"],
      },
      handler: async (args) => {
        try {
          const workflow = service.startWorkflow({ taskText: String(args.task), title: typeof args.title === "string" ? args.title : undefined, provider: typeof args.provider === "string" ? args.provider : undefined, actor: "mcp" });
          return { ok: true, workflow };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.get_workflow",
      description: "Get one workflow run: stage, status, route, risk, evidence-gate stop reason.",
      riskTier: "R0",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      handler: async (args) => {
        try {
          const workflow = service.getWorkflow(String(args.id));
          if (!workflow) return { ok: false, status: 404, error: { code: "WORKFLOW_NOT_FOUND", message: `workflow '${args.id}' not found` } };
          return { ok: true, workflow };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.record_evidence",
      description: "Record runtime evidence for a workflow (test/build/lint/browser/diff/...). Verified only when an exit code is captured from a real command — model claims are never evidence.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          type: { type: "string", description: "test_result|build_result|lint_result|typecheck_result|browser_runtime|diff|security_scan|artifact_exists|..." },
          producer: { type: "string" },
          command: { type: "string" },
          exitCode: { type: "number" },
          output: { type: "string", description: "Raw output to hash (sha256 by the runtime)" },
          artifactUri: { type: "string" },
        },
        required: ["workflowId", "type", "producer"],
      },
      handler: async (args) => {
        try {
          const record = service.recordEvidence({
            workflowId: String(args.workflowId),
            type: String(args.type) as never,
            producer: String(args.producer),
            command: typeof args.command === "string" ? args.command : null,
            exitCode: typeof args.exitCode === "number" ? args.exitCode : null,
            output: typeof args.output === "string" ? args.output : null,
            artifactUri: typeof args.artifactUri === "string" ? args.artifactUri : null,
          });
          return { ok: true, evidence: record };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.submit_review",
      description: "Submit an independent reviewer verdict for a workflow (code/test/security/webperf lane). Blocking findings gate READY_TO_SHIP.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          reviewerType: { type: "string", description: "code_reviewer|test_engineer|security_auditor|webperf_auditor" },
          reviewerIdentity: { type: "string" },
          verdict: { type: "string", description: "pass|pass_with_notes|changes_required|blocked" },
          findings: { type: "array", description: "Severity/category/title findings" },
        },
        required: ["workflowId", "reviewerType", "reviewerIdentity", "verdict"],
      },
      handler: async (args) => {
        try {
          const result = service.submitReview({
            workflowId: String(args.workflowId),
            reviewerType: String(args.reviewerType) as never,
            reviewerIdentity: String(args.reviewerIdentity),
            verdict: String(args.verdict) as never,
            findings: Array.isArray(args.findings) ? (args.findings as never) : [],
          });
          return { ok: true, ...result };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.approve_ship",
      description: "Human ship approval (R3): records approver + rollback target and opens SHIP. Deploy execution itself is never performed by the runtime.",
      riskTier: "R3",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, approver: { type: "string" }, rollbackTarget: { type: "string" } },
        required: ["id", "approver", "rollbackTarget"],
      },
      handler: async (args) => {
        try {
          const result = service.approveShip(String(args.id), String(args.approver), String(args.rollbackTarget));
          return { ok: true, ...result };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.request_skip",
      description: "Anti-rationalization probe: attempting to skip verify/review returns DENY with the exact required evidence.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, step: { type: "string" }, reason: { type: "string" } },
        required: ["id", "step", "reason"],
      },
      handler: async (args) => {
        try {
          const reply = service.requestSkip(String(args.id), String(args.step), String(args.reason));
          return { ok: true, reply };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "engineering_skills.cancel_workflow",
      description: "Cancel a workflow run with a reason (audited).",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
      },
      handler: async (args) => {
        try {
          const workflow = service.cancelWorkflow(String(args.id), String(args.reason), "mcp");
          return { ok: true, workflow };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
  ];
}
