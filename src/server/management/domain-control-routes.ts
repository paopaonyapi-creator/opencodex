// Phase 20.15 — Domain Control Plane: Management REST API.
//
// Route surface (mirrored in src/server/management/route-registry.ts, which the
// reconciliation test enforces):
//   GET    /api/agent-os/domains                      overview + metrics + provider state
//   GET    /api/agent-os/domains/zones                zones with the allowlist verdict
//   GET    /api/agent-os/domains/records              records for ?hostname=
//   GET    /api/agent-os/domains/records/diff         intended-vs-observed diff
//   GET    /api/agent-os/domains/approvals            approval queue (?status=)
//   GET    /api/agent-os/domains/audit                append-only audit trail
//   GET    /api/agent-os/domains/providers            provider descriptors + masked credentials
//   GET    /api/agent-os/domains/bindings             domain-to-deployment bindings
//   POST   /api/agent-os/domains/records              create or update a record
//   POST   /api/agent-os/domains/records/delete       delete a record
//   POST   /api/agent-os/domains/records/restore      rollback to a prior state
//   POST   /api/agent-os/domains/approvals/decide     grant or deny a pending approval
//   POST   /api/agent-os/domains/deployment/plan      build a reviewable deploy plan
//   POST   /api/agent-os/domains/deployment/attach    run the attach flow
//   POST   /api/agent-os/domains/deployment/detach    remove route + binding
//
// Credentials never appear in a response: provider state is passed through
// maskSecret before it leaves this file.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getDeploymentService,
  getDomainControlService,
} from "../../agent-os/domain-control";
import { describeCredentialState, maskSecret, redactSecrets } from "../../agent-os/domain-control/config";
import { checkAllowlist, normalizeHostname } from "../../agent-os/domain-control/policy";
import {
  DomainControlError,
  type AuditActor,
  type DnsRecordIntent,
  type DnsRecordType,
} from "../../agent-os/domain-control/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "bad_request", message } }, 400, req, {});
}

/**
 * Convert a thrown error into the standardized error envelope.
 *
 * Free-text messages are redacted on the way out: a provider error can echo a
 * request URL, and that URL can carry a credential.
 */
function errorResponse(req: Request, error: unknown): Response {
  if (error instanceof DomainControlError) {
    const status =
      error.code === "DOMAIN_NOT_ALLOWED" || error.code === "VALIDATION_FAILED"
        ? 403
        : error.code === "APPROVAL_REQUIRED" || error.code === "APPROVAL_EXPIRED"
          ? 409
          : 502;
    return jsonResponse({ error: error.toJSON() }, status, req, {});
  }
  return jsonResponse(
    {
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: redactSecrets(String(error)),
        retryable: false,
        next_action: "inspect the control plane state",
      },
    },
    500,
    req,
    {},
  );
}

function envelopeFrom(body: Record<string, unknown>): {
  dry_run?: boolean;
  approval_id?: string | null;
  request_id?: string;
  idempotency_key?: string;
  reason?: string;
  actor?: AuditActor;
} {
  return {
    ...(body.dry_run === undefined ? {} : { dry_run: Boolean(body.dry_run) }),
    approval_id: body.approval_id === undefined ? null : (body.approval_id as string | null),
    ...(body.request_id ? { request_id: String(body.request_id) } : {}),
    ...(body.idempotency_key ? { idempotency_key: String(body.idempotency_key) } : {}),
    ...(body.reason ? { reason: String(body.reason) } : {}),
    // Requests arriving over HTTP are treated as agent-originated unless the
    // caller says otherwise. The admin token is readable by anything running as
    // the user, so it is not evidence of a human decision; the approval id is.
    actor: (body.actor as AuditActor) ?? "agent",
  };
}

function intentFrom(body: Record<string, unknown>): DnsRecordIntent {
  return {
    ...(body.record_id ? { id: String(body.record_id) } : {}),
    name: String(body.name ?? "@"),
    type: String(body.type ?? "").toUpperCase() as DnsRecordType,
    content: String(body.content ?? ""),
    ...(body.ttl === undefined ? {} : { ttl: Number(body.ttl) }),
    ...(body.priority === undefined ? {} : { priority: Number(body.priority) }),
  };
}

export async function handleDomainControlRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const prefix = "/api/agent-os/domains";
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const path = url.pathname.slice(prefix.length).replace(/^\//, "");

  const service = getDomainControlService();

  // -- Reads ---------------------------------------------------------------

  if (path === "" && req.method === "GET") {
    try {
      const domains = service.getStore().listDomains();
      const bindings = service.getStore().listBindings();
      const config = service.getConfig();
      return jsonResponse(
        {
          enabled: config.enabled,
          provider: config.defaultProvider,
          allowlistConfigured: config.allowlist.length > 0,
          requireApproval: config.requireApproval,
          proxyConfigured: Boolean(config.caddyAdminUrl),
          domains,
          bindings,
          metrics: service.metrics(),
          credentials: describeCredentialState().map((entry) => ({
            providerId: entry.providerId,
            configured: entry.configured,
            // Masked again at the boundary: this file is the last point a value
            // could escape, so it does not rely on the source having masked it.
            masked: maskSecret(entry.masked),
          })),
        },
        200,
        req,
        {},
      );
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "zones" && req.method === "GET") {
    try {
      const zones = await service.listZones();
      const config = service.getConfig();
      return jsonResponse(
        {
          zones: zones.map((zone) => {
            const decision = checkAllowlist(zone.fqdn, config.allowlist, config.denylist);
            return { ...zone, allowlisted: decision.allowed, allowlistReason: decision.reason };
          }),
        },
        200,
        req,
        {},
      );
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "records" && req.method === "GET") {
    const hostname = url.searchParams.get("hostname");
    if (!hostname) return badRequest(req, "Query parameter 'hostname' is required.");
    try {
      const { zone, records } = await service.listRecords(hostname);
      const type = url.searchParams.get("type");
      return jsonResponse(
        {
          zone: zone.fqdn,
          records: type ? records.filter((record) => record.type === type.toUpperCase()) : records,
        },
        200,
        req,
        {},
      );
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "records/diff" && req.method === "GET") {
    const hostname = url.searchParams.get("hostname");
    if (!hostname) return badRequest(req, "Query parameter 'hostname' is required.");
    try {
      const { diff } = await service.buildDiff(hostname, [
        intentFrom({
          name: url.searchParams.get("name") ?? "@",
          type: url.searchParams.get("type") ?? "",
          content: url.searchParams.get("content") ?? "",
          ...(url.searchParams.get("ttl") ? { ttl: url.searchParams.get("ttl") } : {}),
        }),
      ]);
      return jsonResponse({ diff }, 200, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "approvals" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") as
        | "pending"
        | "granted"
        | "denied"
        | "expired"
        | null;
      return jsonResponse({ approvals: service.listApprovals(status ?? undefined) }, 200, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "audit" && req.method === "GET") {
    try {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return jsonResponse(
        {
          events: service.listAudit({
            ...(url.searchParams.get("request_id")
              ? { requestId: url.searchParams.get("request_id")! }
              : {}),
            ...(url.searchParams.get("resource")
              ? { resource: url.searchParams.get("resource")! }
              : {}),
            ...(url.searchParams.get("operation")
              ? { operation: url.searchParams.get("operation")! }
              : {}),
            limit: Number.isFinite(limit) ? limit : 100,
          }),
        },
        200,
        req,
        {},
      );
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "providers" && req.method === "GET") {
    try {
      const providers = service.getRegistry().list().map((entry) => entry.descriptor());
      return jsonResponse(
        {
          providers,
          activeProvider: service.getConfig().defaultProvider,
          credentials: describeCredentialState(),
        },
        200,
        req,
        {},
      );
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "bindings" && req.method === "GET") {
    try {
      return jsonResponse({ bindings: service.getStore().listBindings() }, 200, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  // -- Mutations -----------------------------------------------------------

  if (path === "records" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const hostname = body.hostname;
      if (typeof hostname !== "string") return badRequest(req, "Field 'hostname' is required.");
      const outcome = await service.applyRecord(hostname, intentFrom(body), envelopeFrom(body));
      return jsonResponse({ outcome }, outcome.status === "applied" ? 200 : 202, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "records/delete" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.hostname !== "string" || typeof body.record_id !== "string") {
        return badRequest(req, "Fields 'hostname' and 'record_id' are required.");
      }
      const outcome = await service.deleteRecord(
        body.hostname,
        body.record_id,
        envelopeFrom(body),
      );
      return jsonResponse({ outcome }, outcome.status === "applied" ? 200 : 202, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "records/restore" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.hostname !== "string") return badRequest(req, "Field 'hostname' is required.");
      const outcome = await service.restoreRecord(body.hostname, intentFrom(body), envelopeFrom(body));
      return jsonResponse({ outcome }, outcome.status === "applied" ? 200 : 202, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "approvals/decide" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const approvalId = body.approval_id;
      const decision = body.decision;
      if (typeof approvalId !== "string" || (decision !== "grant" && decision !== "deny")) {
        return badRequest(req, "Fields 'approval_id' and 'decision' (grant|deny) are required.");
      }
      // This is the one endpoint whose whole purpose is a human decision, so the
      // actor is recorded as the user and never inherited from the body.
      const approval = service.decideApproval(approvalId, decision, "dashboard-session");
      if (!approval) {
        return jsonResponse(
          { error: { code: "not_found", message: `Approval ${approvalId} not found.` } },
          404,
          req,
          {},
        );
      }
      return jsonResponse({ approval }, 200, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "deployment/plan" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const deployments = getDeploymentService();
      const plan = await deployments.plan({
        hostname: String(body.hostname),
        targetIp: String(body.target_ip),
        targetPort: Number(body.target_port),
        ...(body.healthcheck_path ? { healthcheckPath: String(body.healthcheck_path) } : {}),
        ...(body.tls_mode ? { tlsMode: body.tls_mode as "auto" | "manual" | "off" } : {}),
      });
      return jsonResponse({ plan }, 200, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "deployment/attach" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const deployments = getDeploymentService();
      const result = await deployments.deploy({
        hostname: String(body.hostname),
        targetIp: String(body.target_ip),
        targetPort: Number(body.target_port),
        ...(body.deployment_id ? { deploymentId: String(body.deployment_id) } : {}),
        ...(body.healthcheck_path ? { healthcheckPath: String(body.healthcheck_path) } : {}),
        ...(body.tls_mode ? { tlsMode: body.tls_mode as "auto" | "manual" | "off" } : {}),
        ...(body.proxy_type ? { proxyType: body.proxy_type as "caddy" | "nginx" | "none" } : {}),
        ...envelopeFrom(body),
      });
      return jsonResponse({ result }, result.status === "applied" ? 200 : 202, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  if (path === "deployment/detach" && req.method === "POST") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.hostname !== "string") return badRequest(req, "Field 'hostname' is required.");
      // Validate the hostname here as well so a malformed value is a 400 rather
      // than a provider-shaped error from deeper in the stack.
      normalizeHostname(body.hostname);
      const deployments = getDeploymentService();
      const result = await deployments.detach(body.hostname, envelopeFrom(body));
      return jsonResponse({ result }, result.status === "applied" ? 200 : 202, req, {});
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  return jsonResponse(
    { error: { code: "not_found", message: `Domain control endpoint '/${path}' not found.` } },
    404,
    req,
    {},
  );
}
