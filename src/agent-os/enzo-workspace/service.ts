// Phase 20.94 — workspace service facade consumed by REST and MCP.

import { openAgentOsDb } from "../db";
import { getSkillGateService } from "../skill-gate/service";
import { putSecret, issueLease, publicLeaseView, getLease, vaultStatus } from "./broker";
import { probeCodingAdapters } from "./adapters";
import { composeSkills, type SkillSource } from "./composer";
import { applyCodingEdits, createCodingSession, reviewCodingSession, testCodingSession } from "./coding";
import { draftAgent } from "./factory";
import { enzoWorkspaceEnabled } from "./flags";
import { classifyIntent } from "./intent";
import { searchLessons, setLessonStatus } from "./memory";
import { listMarketplaceModels, routeModel } from "./models";
import { EnzoOrchestrator, getEnzoOrchestrator, type CreateRunInput } from "./orchestrator";
import { runResearch } from "./research";
import { EnzoWorkspaceError, defaultBudget, type AgentBlueprint, type LessonStatus, type ModelRouteRequest } from "./types";

export class EnzoWorkspaceService {
  constructor(private readonly orchestrator = getEnzoOrchestrator()) {}

  health(): Record<string, unknown> {
    const models = listMarketplaceModels();
    const db = openAgentOsDb();
    const runs = (db.query("SELECT COUNT(*) AS n FROM enzo_runs").get() as { n: number }).n;
    return {
      ok: true,
      phase: "20.94",
      enabled: enzoWorkspaceEnabled(),
      surfaces: ["chat", "models", "agents", "skills", "research", "code", "operations"],
      models: models.length,
      runs,
      vault: vaultStatus(),
      adapters: probeCodingAdapters(),
      ownership: {
        models: "OmniRoute / Phase 20.85 model-gateway",
        skills: "SkillsGate + curated catalog",
        tools: "MCPProxy / Phase 20.74",
        credentials: "Phase 20.59 credential runtime + workspace leases",
        coding: "sandbox adapter over coding-cockpit/AFT",
        memory: "enzo_lessons + Memory Plane when enabled",
      },
    };
  }

  models() {
    return listMarketplaceModels();
  }

  route(req: ModelRouteRequest) {
    return routeModel(req);
  }

  draft(request: string, slug?: string) {
    return draftAgent(request, slug);
  }

  listAgents(): Array<{ id: string; slug: string; version: number; name: string; status: string; createdAt: string }> {
    const rows = openAgentOsDb().query("SELECT id, slug, version, name, status, created_at FROM enzo_agents ORDER BY created_at DESC LIMIT 100").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      version: Number(row.version),
      name: String(row.name),
      status: String(row.status),
      createdAt: String(row.created_at),
    }));
  }

  getAgent(slug: string, version: number): AgentBlueprint {
    const row = openAgentOsDb().query("SELECT blueprint_json FROM enzo_agents WHERE slug = ? AND version = ?").get(slug, version) as { blueprint_json: string } | undefined;
    if (!row) throw new EnzoWorkspaceError("AGENT_NOT_FOUND", 404, "agent not found");
    return JSON.parse(row.blueprint_json) as AgentBlueprint;
  }

  saveDraft(blueprint: AgentBlueprint, actor: string): AgentBlueprint {
    const db = openAgentOsDb();
    const existing = db.query("SELECT version FROM enzo_agents WHERE slug = ? ORDER BY version DESC LIMIT 1").get(blueprint.slug) as { version: number } | undefined;
    const version = existing ? Number(existing.version) + 1 : blueprint.version || 1;
    blueprint.version = version;
    db.run(
      "INSERT INTO enzo_agents (id, slug, version, name, blueprint_json, status, drafted_by, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
      [blueprint.id + "-v" + version, blueprint.slug, version, blueprint.name, JSON.stringify(blueprint), blueprint.draftedBy, actor, new Date().toISOString()],
    );
    return blueprint;
  }

  resolveSkills(request: string) {
    const intent = classifyIntent(request);
    const source: SkillSource = {
      list: () => {
        try {
          return getSkillGateService().listSkills().map((s) => ({
            id: s.id,
            version: "0",
            name: s.slug ?? s.id,
            summary: s.description ?? "",
            intents: [],
            capabilities: [],
            requires: [],
            optional: [],
            allowedTools: [],
            risk: "R1" as const,
            trust: {
              provenance: "imported" as const,
              score: 0.5,
              status: (String((s as { status?: string }).status ?? "quarantined") === "published" ? "trusted" : "quarantined") as "trusted" | "quarantined",
            },
            context: { estimatedTokens: 2000 },
          }));
        } catch {
          return [];
        }
      },
    };
    return { intent, composition: composeSkills(intent, { source }) };
  }

  createAndRun(input: CreateRunInput) {
    const run = this.orchestrator.createRun(input);
    return this.orchestrator.executeRun(run.id, input.actor ?? "operator", { workspaceRoot: input.workspaceRoot });
  }

  inspect(runId: string) {
    return this.orchestrator.inspect(runId);
  }

  listRuns() {
    return this.orchestrator.listRuns();
  }

  cancel(runId: string, actor?: string) {
    return this.orchestrator.cancel(runId, actor);
  }

  replay(runId: string, mode: "inspect-only" | "re-run-same-plan", actor?: string) {
    return this.orchestrator.replay(runId, mode, actor);
  }

  approvals() {
    return this.orchestrator.listApprovals();
  }

  decideApproval(id: string, approve: boolean, actor: string, note?: string) {
    return this.orchestrator.decideApproval(id, approve, actor, note);
  }

  async research(question: string, budget?: Partial<import("./types").Budget>) {
    return runResearch({ question, budget: defaultBudget(budget ?? {}) });
  }

  coding = {
    start: createCodingSession,
    apply: applyCodingEdits,
    test: testCodingSession,
    review: reviewCodingSession,
  };

  memorySearch(query: string, agentSlug?: string) {
    return searchLessons(query, agentSlug);
  }

  lessonStatus(id: string, status: LessonStatus) {
    return setLessonStatus(id, status);
  }

  putSecret(input: { secretRef: string; provider?: string; secret: string; scopes?: string[] }) {
    return putSecret(input);
  }

  issueLease(input: Parameters<typeof issueLease>[0]) {
    return publicLeaseView(issueLease(input));
  }

  getLease(id: string) {
    return publicLeaseView(getLease(id));
  }

  invokeTool(input: Parameters<EnzoOrchestrator["invokeTool"]>[0]) {
    return this.orchestrator.invokeTool(input);
  }
}

let svc: EnzoWorkspaceService | null = null;
export function getEnzoWorkspaceService(): EnzoWorkspaceService {
  if (!svc) svc = new EnzoWorkspaceService();
  return svc;
}
export function resetEnzoWorkspaceServiceForTests(): void {
  svc = null;
}
