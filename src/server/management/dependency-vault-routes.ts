// Phase 20.38 — Dependency Vault routes (repo convention:
// /api/agent-os/dep-vault/*). Full-literal pathname guards; ids in the JSON
// body; destructive actions (reverify/delete) are human-governed.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getDependencyVaultService } from "../../agent-os/dep-vault/vault";
import { DependencyVaultError } from "../../agent-os/dep-vault/policy";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message } }, 400, req, {});
}

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  const code = match ? match[1] : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : code === "DEPENDENCY_POLICY_DENIED" ? 403 : 422;
  return jsonResponse({ ok: false, error: { code, message } }, status, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleDependencyVaultRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getDependencyVaultService();

  // 1. GET /api/agent-os/dep-vault/status
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/status") {
    return jsonResponse({ ok: true, data: service.status() }, 200, req, {});
  }

  // 2. GET /api/agent-os/dep-vault/packages
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/packages") {
    return jsonResponse({ ok: true, data: { packages: service.listPackages(), artifacts: service.listArtifacts() } }, 200, req, {});
  }

  // 3. POST /api/agent-os/dep-vault/scan
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/scan") {
    const body = await readJsonBody(req);
    if (typeof body.projectDir !== "string") return badRequest(req, "Field 'projectDir' is required");
    try {
      const graph = service.scanProject(body.projectDir, (body.packageManager as never) ?? "npm");
      return jsonResponse({ ok: true, data: { projectKey: graph.projectKey, lockfileType: graph.lockfileType, lockfileHash: graph.lockfileHash, packages: graph.nodes.length } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 4. POST /api/agent-os/dep-vault/ensure
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/ensure") {
    const body = await readJsonBody(req);
    if (typeof body.projectDir !== "string") return badRequest(req, "Field 'projectDir' is required");
    try {
      return jsonResponse({ ok: true, data: await service.ensureProject({
        projectDir: body.projectDir,
        packageManager: body.packageManager as never,
        mode: (body.mode as never) ?? "OFFLINE_PREFERRED",
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. POST /api/agent-os/dep-vault/install
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/install") {
    const body = await readJsonBody(req);
    if (typeof body.projectDir !== "string") return badRequest(req, "Field 'projectDir' is required");
    try {
      return jsonResponse({ ok: true, data: service.installProject({
        projectDir: body.projectDir,
        mode: (body.mode as never) ?? "OFFLINE_PREFERRED",
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. POST /api/agent-os/dep-vault/profiles/prewarm
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/profiles/prewarm") {
    const body = await readJsonBody(req);
    if (typeof body.profileId !== "string") return badRequest(req, "Field 'profileId' is required");
    try {
      return jsonResponse({ ok: true, data: await service.ensureProfile(body.profileId, (body.mode as never) ?? "OFFLINE_PREFERRED", typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. GET /api/agent-os/dep-vault/profiles
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/profiles") {
    return jsonResponse({ ok: true, data: { profiles: service.listProfiles() } }, 200, req, {});
  }

  // 8. POST /api/agent-os/dep-vault/bundles/export
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/bundles/export") {
    const body = await readJsonBody(req);
    try {
      return jsonResponse({ ok: true, data: service.exportBundle({
        name: typeof body.name === "string" ? body.name : "bundle",
        projectDir: typeof body.projectDir === "string" ? body.projectDir : undefined,
        packageManager: body.packageManager as never,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. POST /api/agent-os/dep-vault/bundles/import
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/bundles/import") {
    const body = await readJsonBody(req);
    if (typeof body.bundleDir !== "string") return badRequest(req, "Field 'bundleDir' is required");
    try {
      return jsonResponse({ ok: true, data: service.importBundle({ bundleDir: body.bundleDir, actor: typeof body.actor === "string" ? body.actor : "dashboard" }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 10. GET /api/agent-os/dep-vault/quarantine
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/quarantine") {
    return jsonResponse({ ok: true, data: { artifacts: service.listQuarantine() } }, 200, req, {});
  }

  // 11. POST /api/agent-os/dep-vault/quarantine/reverify (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/quarantine/reverify") {
    const body = await readJsonBody(req);
    if (typeof body.artifactId !== "string") return badRequest(req, "Field 'artifactId' is required");
    try {
      return jsonResponse({ ok: true, data: service.reverifyQuarantined(body.artifactId, typeof body.expectedIntegrity === "string" ? body.expectedIntegrity : null, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. POST /api/agent-os/dep-vault/sbom
  if (req.method === "POST" && pathname === "/api/agent-os/dep-vault/sbom") {
    const body = await readJsonBody(req);
    if (typeof body.projectDir !== "string") return badRequest(req, "Field 'projectDir' is required");
    try {
      return jsonResponse({ ok: true, data: service.generateSbom(body.projectDir, (body.packageManager as never) ?? "npm") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 13. GET /api/agent-os/dep-vault/audit
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { events: service.listAudit(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  // 14. GET /api/agent-os/dep-vault/policy/decisions
  if (req.method === "GET" && pathname === "/api/agent-os/dep-vault/policy/decisions") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { decisions: service.listPolicyDecisions(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  return null;
}

export { DependencyVaultError };
