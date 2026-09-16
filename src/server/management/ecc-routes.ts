// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS Management REST API Routes

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getEccService } from "../../agent-os/ecc";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleEccRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getEccService();

  // 1. GET /api/agent-os/ecc/status
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/status") {
    const status = service.getStatus();
    const flags = service.getFeatureFlags();
    return jsonResponse({ status, flags }, 200, req, {});
  }

  // 2. GET /api/agent-os/ecc/skills
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/skills") {
    const stage = url.searchParams.get("stage");
    if (stage === "1") {
      const source = url.searchParams.get("source") as any;
      const tag = url.searchParams.get("tag") ?? undefined;
      const skills = service.skillsRegistry.getStage1Descriptors({ source, tag });
      return jsonResponse({ skills }, 200, req, {});
    }
    const skills = service.skillsRegistry.listAll();
    return jsonResponse({ skills }, 200, req, {});
  }

  // 3. GET /api/agent-os/ecc/agents
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/agents") {
    const agents = service.agentRegistry.listAgents();
    return jsonResponse({ agents }, 200, req, {});
  }

  // 4. GET /api/agent-os/ecc/memory
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/memory") {
    const query = url.searchParams.get("q") ?? undefined;
    const type = (url.searchParams.get("type") as any) ?? undefined;
    const memories = service.memoryVault.query({ keyword: query, type });
    return jsonResponse({ memories }, 200, req, {});
  }

  // 5. GET /api/agent-os/ecc/instincts
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/instincts") {
    const instincts = service.learningEngine.listInstincts();
    return jsonResponse({ instincts }, 200, req, {});
  }

  // 6. GET /api/agent-os/ecc/timeline
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/timeline") {
    const runs = service.store.listRuns(50);
    const auditEvents = service.auditLogger.getAuditTrail(100);
    return jsonResponse({ runs, auditEvents }, 200, req, {});
  }

  // 7. GET /api/agent-os/ecc/agentshield
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/agentshield") {
    const status = service.agentshield.detectStatus();
    return jsonResponse({ agentshield: status }, 200, req, {});
  }

  // GET /api/agent-os/ecc/doctor
  if (req.method === "GET" && pathname === "/api/agent-os/ecc/doctor") {
    const report = service.adapter.runDoctorCheck();
    return jsonResponse({ doctor: report }, 200, req, {});
  }

  // 8. POST /api/agent-os/ecc/plan
  if (req.method === "POST" && pathname === "/api/agent-os/ecc/plan") {
    const body = await readJsonBody(req);
    const goal = typeof body.goal === "string" ? body.goal : "";
    if (!goal) return badRequest(req, "Field 'goal' is required.");

    const assigned = service.agentRegistry.routeAgentsForTask({
      description: goal,
      isWriteTask: Boolean(body.isWriteTask),
      isSecurityTask: Boolean(body.isSecurityTask),
    });
    const skills = service.skillsRegistry.resolveSkillsForTask(goal);

    const plan = {
      summary: `Plan formulated for goal: ${goal}`,
      assignedRoles: assigned.map(a => a.role),
      candidateSkills: skills.map(s => s.id),
      steps: [
        "Step 1: Read-only exploration and context acquisition",
        "Step 2: Architecture / contract verification",
        "Step 3: Implementation execution under Safe Tool Gateway",
        "Step 4: Verification loop & unit test assertions",
        "Step 5: Reviewer Council evidence submission and verdict",
      ],
    };

    return jsonResponse({ plan }, 200, req, {});
  }

  // 9. POST /api/agent-os/ecc/execute
  if (req.method === "POST" && pathname === "/api/agent-os/ecc/execute") {
    const body = await readJsonBody(req);
    const goal = typeof body.goal === "string" ? body.goal : "";
    if (!goal) return badRequest(req, "Field 'goal' is required.");

    const result = await service.runTask({
      goal,
      isWriteTask: Boolean(body.isWriteTask),
      isSecurityTask: Boolean(body.isSecurityTask),
      isReleaseTask: Boolean(body.isReleaseTask),
      filesToModify: Array.isArray(body.filesToModify) ? body.filesToModify.map(String) : undefined,
    });

    return jsonResponse({ result }, 200, req, {});
  }

  // 10. POST /api/agent-os/ecc/verify
  if (req.method === "POST" && pathname === "/api/agent-os/ecc/verify") {
    const body = await readJsonBody(req);
    const packet = (body.evidence as any) ?? {};
    if (!packet.taskId || !packet.task) return badRequest(req, "Valid evidence packet required.");

    const result = service.councilBridge.evaluateEvidence(packet);
    return jsonResponse({ result }, 200, req, {});
  }

  // 11. POST /api/agent-os/ecc/instincts/promote
  if (req.method === "POST" && pathname === "/api/agent-os/ecc/instincts/promote") {
    const body = await readJsonBody(req);
    const instinctId = typeof body.instinctId === "string" ? body.instinctId : "";
    const approved = Boolean(body.approvedByOperator);
    if (!instinctId) return badRequest(req, "Field 'instinctId' is required.");

    try {
      const skill = service.learningEngine.promoteToSkill(instinctId, approved);
      return jsonResponse({ success: true, skill }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err?.message ?? "Promotion failed.");
    }
  }

  // 12. POST /api/agent-os/ecc/agentshield/scan
  if (req.method === "POST" && pathname === "/api/agent-os/ecc/agentshield/scan") {
    const body = await readJsonBody(req);
    const targetPath = typeof body.targetPath === "string" ? body.targetPath : ".";
    const scanResult = service.agentshield.scan(targetPath);
    return jsonResponse({ scan: scanResult }, 200, req, {});
  }

  return null;
}

export const handleECCRoutes = handleEccRoutes;
