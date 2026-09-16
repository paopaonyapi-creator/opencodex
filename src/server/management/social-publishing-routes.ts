// Phase 20.60 — Social Publishing management routes.
//
// Prefix-decode dispatcher (capability-lab precedent): the namespace check at
// the top is a route-scan anchor, so these routes intentionally carry no
// MANAGEMENT_ROUTES literal entries. Every handler resolves through
// getSocialPublishingService(); the service enforces enablement, policy, and
// hash-bound approval server-side before any remote mutation.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSocialPublishingService } from "../../agent-os/social-publishing/service";
import { SOCIAL_PUBLISHING_MCP_TOOLS } from "../../agent-os/social-publishing/mcp-tools";
import { SocialPublishingHttpError } from "../../agent-os/social-publishing/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof SocialPublishingHttpError) {
    return jsonResponse({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.httpStatus, req, {});
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

function actor(body: Record<string, unknown>): { type: "human" | "agent" | "system"; id: string } {
  const type = body.actorType === "agent" || body.actorType === "system" ? body.actorType : "human";
  return { type, id: String(body.actorId ?? "operator") };
}

export async function handleSocialPublishingRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/social-publishing/")) subPath = url.pathname.slice("/api/agent-os/social-publishing/".length);
  else if (url.pathname === "/api/agent-os/social-publishing") {
    subPath = "";
  }
  else return null;

  const service = getSocialPublishingService();

  try {
    if (req.method === "GET" && (subPath === "" || subPath === "health")) {
      const instances = service.listInstances();
      const accounts = service.listAccounts();
      const publications = service.listPublications();
      return jsonResponse({
        ok: true,
        phase: "20.60",
        enabled: instances.length > 0,
        instances: instances.length,
        accounts: accounts.length,
        readyAccounts: accounts.filter((a) => a.readinessState === "ready").length,
        accountsRequiringAction: accounts.filter((a) => ["requires_reauth", "requires_scope", "requires_review", "degraded", "disabled"].includes(a.readinessState)).length,
        publications: publications.length,
        awaitingApproval: publications.filter((p) => p.status === "approval_required").length,
        scheduled: publications.filter((p) => p.status === "scheduled").length,
        failed: publications.filter((p) => p.status === "failed" || p.status === "partial_success").length,
      }, 200, req, {});
    }

    // --- OpenPost instance registry ---

    if (subPath === "instances" && req.method === "GET") {
      return jsonResponse({ instances: service.listInstances() }, 200, req, {});
    }
    if (subPath === "instances" && req.method === "POST") {
      const body = await readJson(req);
      const instance = service.registerInstance({
        name: String(body.name ?? ""),
        baseUrl: String(body.baseUrl ?? ""),
        secretRef: body.secretRef ? String(body.secretRef) : undefined,
        mcpEndpoint: body.mcpEndpoint ? String(body.mcpEndpoint) : null,
        mcpScope: body.mcpScope === "mcp:full" ? "mcp:full" : body.mcpEndpoint ? "mcp:read" : null,
        transport: body.transport === "http" || body.transport === "mcp" || body.transport === "hybrid" ? body.transport : undefined,
        ...actor(body),
      });
      return jsonResponse({ instance }, 201, req, {});
    }
    if (subPath.startsWith("instances/")) {
      const rest = subPath.slice("instances/".length);
      const [id, action] = rest.split("/");
      if (req.method === "GET" && !action) {
        return jsonResponse({ instance: service.requireInstance(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "test") {
        return jsonResponse({ instance: await service.testInstance(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "sync") {
        return jsonResponse(await service.syncInstance(id), 200, req, {});
      }
      if (req.method === "DELETE" && !action) {
        service.deleteInstance(id);
        return jsonResponse({ deleted: true }, 200, req, {});
      }
    }

    // --- accounts ---

    if (subPath === "accounts" && req.method === "GET") {
      return jsonResponse({ accounts: service.listAccounts() }, 200, req, {});
    }
    if (subPath.startsWith("accounts/")) {
      const rest = subPath.slice("accounts/".length);
      const [id, action] = rest.split("/");
      if (req.method === "GET" && !action) {
        return jsonResponse({ account: service.requireAccount(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "refresh-capabilities") {
        return jsonResponse({ account: await service.refreshAccountCapabilities(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "enabled") {
        const body = await readJson(req);
        return jsonResponse({ account: service.setAccountEnabled(id, body.enabled === true) }, 200, req, {});
      }
    }

    // --- publications ---

    if (subPath === "publications" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ publications: service.listPublications(status ? { status } : undefined) }, 200, req, {});
    }
    if (subPath === "publications" && req.method === "POST") {
      const body = await readJson(req);
      const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(String) : [];
      const publication = service.createPublication({
        sourceType: (["image", "video", "text", "mixed", "external"].includes(String(body.sourceType)) ? String(body.sourceType) : "text") as "image" | "video" | "text" | "mixed" | "external",
        assetIds,
        masterTitle: body.masterTitle ? String(body.masterTitle) : null,
        masterCaption: body.masterCaption ? String(body.masterCaption) : null,
        masterDescription: body.masterDescription ? String(body.masterDescription) : null,
        masterTags: Array.isArray(body.masterTags) ? body.masterTags.map(String) : [],
        metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {},
        riskLevel: body.riskLevel === "high" || body.riskLevel === "elevated" ? body.riskLevel : "normal",
        scheduledAt: body.scheduledAt ? String(body.scheduledAt) : null,
        timezone: body.timezone ? String(body.timezone) : "UTC",
        ...actor(body),
      });
      return jsonResponse({ publication }, 201, req, {});
    }
    if (subPath.startsWith("publications/")) {
      const rest = subPath.slice("publications/".length);
      const [id, action] = rest.split("/");
      const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req) : {};
      if (req.method === "GET" && !action) {
        return jsonResponse(service.getPublication(id), 200, req, {});
      }
      if (req.method === "PATCH" && !action) {
        const publication = service.updatePublication(id, {
          masterTitle: body.masterTitle !== undefined ? String(body.masterTitle) : undefined,
          masterCaption: body.masterCaption !== undefined ? String(body.masterCaption) : undefined,
          masterDescription: body.masterDescription !== undefined ? String(body.masterDescription) : undefined,
          masterTags: Array.isArray(body.masterTags) ? body.masterTags.map(String) : undefined,
          metadataJson: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
          scheduledAt: body.scheduledAt !== undefined ? String(body.scheduledAt) : undefined,
        }, actor(body));
        return jsonResponse({ publication }, 200, req, {});
      }
      if (req.method === "POST" && action === "generate-renditions") {
        const accounts = Array.isArray(body.accounts) ? body.accounts.map(String) : [];
        const renditions = await service.generateRenditions(id, {
          accounts,
          format: ["post", "thread", "story", "short_video", "video"].includes(String(body.format)) ? body.format as "post" | "thread" | "story" | "short_video" | "video" : undefined,
          overrides: body.overrides && typeof body.overrides === "object" ? (body.overrides as Record<string, never>) : undefined,
          actorType: actor(body).type,
          actorId: actor(body).id,
        });
        return jsonResponse({ renditions }, 200, req, {});
      }
      if (req.method === "POST" && action === "validate") {
        return jsonResponse({ results: await service.validatePublication(id) }, 200, req, {});
      }
      if (req.method === "POST" && action === "request-approval") {
        return jsonResponse({ publication: service.requestApproval(id, actor(body)) }, 200, req, {});
      }
      if (req.method === "POST" && action === "approve") {
        const record = service.approve(id, {
          decision: body.decision === "rejected" ? "rejected" : "approved",
          approverId: String(body.approverId ?? "operator"),
          approverType: actor(body).type,
          scope: ["publication_all_destinations", "rendition_only", "schedule_only", "publish_now_only"].includes(String(body.scope)) ? body.scope as "publication_all_destinations" | "rendition_only" | "schedule_only" | "publish_now_only" : undefined,
          renditionId: body.renditionId ? String(body.renditionId) : null,
          note: body.note ? String(body.note) : null,
        });
        return jsonResponse({ approval: record }, 201, req, {});
      }
      if (req.method === "POST" && action === "schedule") {
        const job = await service.schedulePublication(id, {
          scheduledAt: String(body.scheduledAt ?? ""),
          actorType: actor(body).type,
          actorId: actor(body).id,
        });
        return jsonResponse({ job }, 202, req, {});
      }
      if (req.method === "POST" && action === "publish") {
        const job = await service.publishNow(id, actor(body));
        return jsonResponse({ job }, 202, req, {});
      }
      if (req.method === "POST" && action === "cancel") {
        return jsonResponse(await service.cancelPublication(id, actor(body)), 200, req, {});
      }
      if (req.method === "POST" && action === "reconcile") {
        return jsonResponse({ publication: await service.reconcilePublication(id) }, 200, req, {});
      }
      if (req.method === "GET" && action === "analytics") {
        return jsonResponse({ snapshots: service.listAnalytics({ publicationId: id }) }, 200, req, {});
      }
    }

    // --- approvals / jobs / analytics / audit / mcp tools ---

    if (subPath === "approvals" && req.method === "GET") {
      return jsonResponse({ pending: service.listPendingApprovals() }, 200, req, {});
    }
    if (subPath === "jobs" && req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const publicationId = url.searchParams.get("publication_id") ?? undefined;
      return jsonResponse({ jobs: service.listJobs({ status, publicationId }) }, 200, req, {});
    }
    if (subPath.startsWith("jobs/") && subPath.endsWith("/retry") && req.method === "POST") {
      const jobId = subPath.slice("jobs/".length, -"/retry".length);
      return jsonResponse({ job: await service.retryJob(jobId) }, 200, req, {});
    }
    if (subPath === "analytics/sync" && req.method === "POST") {
      return jsonResponse({ synced: await service.syncAnalytics() }, 200, req, {});
    }
    if (subPath === "audit" && req.method === "GET") {
      return jsonResponse({ events: service.store.listAudit() }, 200, req, {});
    }
    if (subPath === "mcp-tools" && req.method === "GET") {
      return jsonResponse({
        tools: SOCIAL_PUBLISHING_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          riskTier: tool.riskTier,
          readOnly: tool.readOnly,
        })),
        note: "High-impact tools verify policy + hash-bound approval server-side; agent-side claims are never sufficient.",
      }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
