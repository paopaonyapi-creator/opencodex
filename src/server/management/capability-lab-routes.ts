// Phase 20.56 — Capability Lab management routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCapabilityLab } from "../../agent-os/capability-lab";
import { CapError } from "../../agent-os/capability-lab/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof CapError) {
    return jsonResponse({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "internal_error", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return {}; }
}

export async function handleCapabilityLabRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/capability-lab/")) subPath = url.pathname.slice("/api/agent-os/capability-lab/".length);
  else if (url.pathname === "/api/agent-os/capability-lab") {
    subPath = "";
  }
  else return null;

  const lab = getCapabilityLab();

  try {
    if (req.method === "GET" && (subPath === "" || subPath === "health")) {
      return jsonResponse({
        ok: true,
        phase: "20.56",
        sources: lab.listSources().length,
        recipes: lab.listRecipes().length,
        capabilities: lab.listCapabilities().length,
      }, 200, req, {});
    }
    if (req.method === "POST" && subPath === "seed") {
      return jsonResponse(lab.bootstrapSeed(), 201, req, {});
    }
    if (req.method === "POST" && subPath === "sources/import/local") {
      const body = await readJson(req);
      const path = String(body.path ?? "");
      if (!path) return jsonResponse({ error: { code: "invalid_body", message: "path is required" } }, 400, req, {});
      return jsonResponse({ source: lab.importLocal(path, String(body.importedBy ?? "operator")) }, 201, req, {});
    }
    if (req.method === "GET" && subPath === "sources") return jsonResponse({ sources: lab.listSources() }, 200, req, {});
    if (req.method === "POST" && subPath.startsWith("sources/") && subPath.endsWith("/analyze")) {
      const id = subPath.slice("sources/".length, -"/analyze".length);
      return jsonResponse({ recipes: lab.analyze(id) }, 200, req, {});
    }
    if (req.method === "GET" && subPath === "recipes") return jsonResponse({ recipes: lab.listRecipes() }, 200, req, {});
    if (req.method === "POST" && subPath.startsWith("recipes/") && subPath.endsWith("/manifest")) {
      const id = subPath.slice("recipes/".length, -"/manifest".length);
      return jsonResponse({ capability: lab.generateManifest(id) }, 201, req, {});
    }
    if (req.method === "GET" && subPath === "capabilities") return jsonResponse({ capabilities: lab.listCapabilities() }, 200, req, {});
    if (req.method === "POST" && subPath.startsWith("capabilities/") && subPath.endsWith("/compile")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length, -"/compile".length));
      return jsonResponse({ capability: lab.compile(key) }, 200, req, {});
    }
    if (req.method === "POST" && subPath.startsWith("capabilities/") && subPath.endsWith("/review")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length, -"/review".length));
      const body = await readJson(req);
      return jsonResponse({ capability: lab.review(key, String(body.actorId ?? "admin"), body.decision === "rejected" ? "rejected" : "approved") }, 200, req, {});
    }
    if (req.method === "POST" && subPath.startsWith("capabilities/") && subPath.endsWith("/publish")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length, -"/publish".length));
      const body = await readJson(req);
      return jsonResponse({ capability: lab.publish(key, String(body.actorId ?? "admin"), body.autonomous === true) }, 200, req, {});
    }
    if (req.method === "POST" && subPath.startsWith("capabilities/") && subPath.endsWith("/test")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length, -"/test".length));
      return jsonResponse({ run: await lab.test(key) }, 200, req, {});
    }
    if (req.method === "POST" && subPath.startsWith("capabilities/") && subPath.endsWith("/invoke")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length, -"/invoke".length));
      const body = await readJson(req);
      const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : body;
      return jsonResponse({ run: await lab.invoke(key, args, String(body.caller ?? "agent")) }, 200, req, {});
    }
    if (req.method === "GET" && subPath.startsWith("capabilities/")) {
      const key = decodeURIComponent(subPath.slice("capabilities/".length));
      return jsonResponse({ capability: lab.getCapability(key) }, 200, req, {});
    }
    if (req.method === "GET" && subPath === "runs") return jsonResponse({ runs: lab.listRuns() }, 200, req, {});
    return jsonResponse({ error: { code: "not_found" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}

