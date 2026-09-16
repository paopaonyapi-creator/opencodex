// Phase 20.62 — Code Intelligence management routes.
//
// Prefix-decode dispatcher (capability-lab precedent; namespace anchor needs
// no MANAGEMENT_ROUTES literals). Mutation endpoints (register/build) are
// operator actions; query endpoints authenticate through the service, which
// enforces scope, path policy, evidence persistence, and audit.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCodeIntelService } from "../../agent-os/code-intelligence/service";
import { CODE_INTEL_MCP_TOOLS } from "../../agent-os/code-intelligence/mcp-tools";
import { CodeIntelError } from "../../agent-os/code-intelligence/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof CodeIntelError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "internal_error", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleCodeIntelRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/code-intelligence/")) subPath = url.pathname.slice("/api/agent-os/code-intelligence/".length);
  else if (url.pathname === "/api/agent-os/code-intelligence") {
    subPath = "";
  }
  else return null;

  const service = getCodeIntelService();

  try {
    if (req.method === "GET" && (subPath === "" || subPath === "health")) {
      const repos = service.listRepositories();
      return jsonResponse({
        ok: true,
        phase: "20.62",
        repositories: repos.length,
        ready: repos.filter((r) => r.graphState === "ready").length,
        stale: repos.filter((r) => r.graphState === "stale").length,
        failed: repos.filter((r) => r.graphState === "failed").length,
      }, 200, req, {});
    }

    if (subPath === "provider/status" && req.method === "GET") {
      return jsonResponse({ status: await service.refreshProviderStatus() }, 200, req, {});
    }

    // --- repositories (operator registry) ---

    if (subPath === "repositories" && req.method === "GET") {
      return jsonResponse({ repositories: service.listRepositories() }, 200, req, {});
    }
    if (subPath === "repositories" && req.method === "POST") {
      const body = await readJson(req);
      const repo = service.registerRepository({
        name: String(body.name ?? ""),
        path: String(body.path ?? ""),
        actorId: String(body.actorId ?? "operator"),
        repoType: body.repoType === "monorepo" || body.repoType === "workspace-folder" ? body.repoType : undefined,
        trustLevel: body.trustLevel === "sandbox" || body.trustLevel === "untrusted" ? body.trustLevel : undefined,
        sensitivity: body.sensitivity === "sensitive" ? "sensitive" : undefined,
        deepEnrichmentEnabled: body.deepEnrichmentEnabled === true,
      });
      return jsonResponse({ repository: repo }, 201, req, {});
    }
    if (subPath.startsWith("repositories/")) {
      const rest = subPath.slice("repositories/".length);
      const [id, action] = rest.split("/");
      if (req.method === "GET" && !action) {
        return jsonResponse({ repository: service.requireRepository(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "build") {
        const body = await readJson(req);
        return jsonResponse(
          await service.buildGraph(id, { deep: body.deep === true, actorId: String(body.actorId ?? "operator") }),
          200,
          req,
          {},
        );
      }
      if (req.method === "POST" && action === "check") {
        return jsonResponse(await service.checkFreshness(id), 200, req, {});
      }
      if (req.method === "POST" && action === "map") {
        const outcome = await service.repositoryMap(id, { actorId: String((await readJson(req)).actorId ?? "operator") });
        return jsonResponse({ ...outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence }, 200, req, {});
      }
      if (req.method === "POST" && action === "find") {
        const body = await readJson(req);
        const pathScope = Array.isArray(body.pathScope) ? body.pathScope.map(String) : [];
        const outcome = await service.findCode(id, { question: String(body.question ?? ""), pathScope, actorId: String(body.actorId ?? "operator") });
        return jsonResponse({ results: outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence }, 200, req, {});
      }
      if (req.method === "POST" && action === "file-api") {
        const body = await readJson(req);
        const outcome = await service.fileApi(id, { file: String(body.file ?? ""), actorId: String(body.actorId ?? "operator") });
        return jsonResponse({ ...outcome.result, evidenceId: outcome.evidence.id }, 200, req, {});
      }
      if (req.method === "POST" && action === "find-all") {
        const body = await readJson(req);
        const pathScope = Array.isArray(body.pathScope) ? body.pathScope.map(String) : [];
        const outcome = await service.findAll(id, { pattern: String(body.pattern ?? ""), pathScope, actorId: String(body.actorId ?? "operator") });
        return jsonResponse({ occurrences: outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence }, 200, req, {});
      }
      if (req.method === "POST" && action === "trace") {
        const body = await readJson(req);
        const outcome = await service.traceCalls(id, {
          symbol: String(body.symbol ?? ""),
          direction: body.direction === "out" ? "out" : "in",
          depth: typeof body.depth === "number" ? body.depth : undefined,
          actorId: String(body.actorId ?? "operator"),
          taskId: body.taskId ? String(body.taskId) : null,
        });
        return jsonResponse({ ...outcome.result, evidenceId: outcome.evidence.id }, 200, req, {});
      }
      if (req.method === "POST" && action === "impact") {
        const body = await readJson(req);
        const report = await service.createImpactReport(id, {
          targetRef: String(body.targetRef ?? ""),
          targetType: body.targetType === "symbol" || body.targetType === "path" ? body.targetType : undefined,
          direction: body.direction === "out" ? "out" : "in",
          depth: typeof body.depth === "number" ? body.depth : undefined,
          actorId: String(body.actorId ?? "operator"),
          taskId: body.taskId ? String(body.taskId) : null,
          worktreePath: body.worktreePath ? String(body.worktreePath) : null,
          diffFileCount: typeof body.diffFileCount === "number" ? body.diffFileCount : undefined,
        });
        return jsonResponse({ report }, 201, req, {});
      }
      if (req.method === "POST" && action === "post-edit-verify") {
        const body = await readJson(req);
        return jsonResponse(
          await service.postEditVerification(id, {
            beforeReportId: String(body.beforeReportId ?? ""),
            actorId: String(body.actorId ?? "operator"),
            taskId: body.taskId ? String(body.taskId) : null,
            worktreePath: body.worktreePath ? String(body.worktreePath) : null,
          }),
          200,
          req,
          {},
        );
      }
      if (req.method === "POST" && action === "context-pack") {
        const body = await readJson(req);
        return jsonResponse(
          await service.buildContextPack(id, {
            taskIntent: String(body.taskIntent ?? ""),
            symbol: body.symbol ? String(body.symbol) : undefined,
            pathScope: Array.isArray(body.pathScope) ? body.pathScope.map(String) : undefined,
            actorId: String(body.actorId ?? "operator"),
          }),
          200,
          req,
          {},
        );
      }
      if (req.method === "GET" && action === "evidence") {
        return jsonResponse({ evidence: service.store.listEvidence(id) }, 200, req, {});
      }
      if (req.method === "GET" && action === "impact-reports") {
        return jsonResponse({ reports: service.store.listImpactReports(id) }, 200, req, {});
      }
    }

    if (subPath === "impact-reports" && req.method === "GET") {
      return jsonResponse({ reports: service.store.listImpactReports() }, 200, req, {});
    }
    if (subPath.startsWith("impact-reports/") && req.method === "GET") {
      return jsonResponse({ report: service.store.getImpactReport(subPath.slice("impact-reports/".length)) }, 200, req, {});
    }

    // --- workspace membership ---

    if (subPath === "workspace/join" && req.method === "POST") {
      const body = await readJson(req);
      service.joinWorkspace({
        workspaceId: String(body.workspaceId ?? ""),
        repositoryId: String(body.repositoryId ?? ""),
        crossRepoTraceEnabled: body.crossRepoTraceEnabled === true,
        actorId: String(body.actorId ?? "operator"),
      });
      return jsonResponse({ joined: true }, 201, req, {});
    }

    if (subPath === "audit" && req.method === "GET") {
      return jsonResponse({ entries: service.store.listAudit() }, 200, req, {});
    }
    if (subPath === "mcp-tools" && req.method === "GET") {
      return jsonResponse({
        tools: CODE_INTEL_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskTier: tool.riskTier,
          readOnly: tool.readOnly,
        })),
        note: "Raw Graft MCP is never exposed; repository-derived content is data, not instructions.",
      }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
