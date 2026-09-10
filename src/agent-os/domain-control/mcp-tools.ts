/**
 * Phase 20.15 — Pao-hubPro Domain Control Plane
 * WebMCP Tool Suite: domain.*, dns.*, ssl.*, deployment.*
 *
 * Tool naming follows this repository's existing convention (flat snake_case names
 * such as media_memory_search, video_analyze) rather than dotted MCP namespaces:
 * the tool NAME is what a model calls, and the dot is presentation. Each tool's
 * description states its namespace so an operator can still read the surface as
 * domain.*, dns.*, ssl.*, deployment.*.
 *
 * SAFETY CONTRACT FOR THIS FILE:
 *  - Every mutating tool forwards dry_run/approval_id/request_id/idempotency_key
 *    to the service and NEVER calls a provider directly.
 *  - No tool returns a credential. Config-shaped results go through maskSecret.
 *  - Read tools are read-only and never create an approval record.
 */

import { getDomainControlService, getDeploymentService } from "./index";
import { describeCredentialState, maskSecret, redactSecrets } from "./config";
import { normalizeHostname, checkAllowlist, readOnlyAssessment } from "./policy";
import { assertRoutableTarget } from "./proxy";
import { DomainControlError, type DnsRecordIntent, type DnsRecordType } from "./types";
import { verifyPropagation, type ResolveFn } from "./verification";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Uniform successful tool payload. */
function ok(payload: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...payload }, null, 2);
}

/**
 * Uniform failure payload. A DomainControlError becomes its standardized shape so
 * a caller can branch on `code` instead of parsing prose. Free-text errors are
 * run through redactSecrets because provider messages can echo a request URL.
 */
function fail(error: unknown): string {
  if (error instanceof DomainControlError) {
    return JSON.stringify({ ok: false, error: error.toJSON() }, null, 2);
  }
  return JSON.stringify(
    {
      ok: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: redactSecrets(String(error)),
        retryable: false,
        next_action: "inspect the control plane state",
      },
    },
    null,
    2,
  );
}

function envelope(args: Record<string, unknown>): {
  dry_run?: boolean;
  approval_id?: string | null;
  request_id?: string;
  idempotency_key?: string;
  reason?: string;
  actor?: "chatgpt" | "codex" | "user" | "system" | "agent";
} {
  return {
    ...(args.dry_run === undefined ? {} : { dry_run: Boolean(args.dry_run) }),
    approval_id: args.approval_id === undefined ? null : (args.approval_id as string | null),
    ...(args.request_id ? { request_id: String(args.request_id) } : {}),
    ...(args.idempotency_key ? { idempotency_key: String(args.idempotency_key) } : {}),
    ...(args.reason ? { reason: String(args.reason) } : {}),
    actor: (args.actor as "chatgpt" | "codex" | "agent" | "user" | "system") ?? "agent",
  };
}

function intentFrom(args: Record<string, unknown>): DnsRecordIntent {
  const type = String(args.type ?? "").toUpperCase() as DnsRecordType;
  return {
    ...(args.record_id ? { id: String(args.record_id) } : {}),
    name: String(args.name ?? "@"),
    type,
    content: String(args.content ?? ""),
    ...(args.ttl === undefined ? {} : { ttl: Number(args.ttl) }),
    ...(args.priority === undefined ? {} : { priority: Number(args.priority) }),
  };
}

/** Shared schema fragments, so every mutating tool accepts the same envelope. */
const MUTATION_PROPS: Record<string, unknown> = {
  dry_run: {
    type: "boolean",
    description:
      "Preview the diff without writing. Agent callers default to true and cannot disable that default without supplying approval_id.",
  },
  approval_id: {
    type: "string",
    description: "Id of a granted, unexpired approval for exactly this operation and hostname.",
  },
  request_id: { type: "string", description: "Correlation id recorded on the audit event." },
  idempotency_key: {
    type: "string",
    description:
      "Replay guard. Same key with the same payload returns the previous result; same key with a different payload is rejected.",
  },
  reason: { type: "string", description: "Why this change is being made; stored on the approval and audit rows." },
  actor: {
    type: "string",
    enum: ["chatgpt", "codex", "agent", "user", "system"],
    description: "Who is acting. Non-agent actors still require approval when the policy demands it.",
  },
};

export const DOMAIN_CONTROL_MCP_TOOLS: WebMcpToolDefinition[] = [
  // ---------------------------------------------------------------- domain.*
  {
    name: "domain_list",
    description:
      "domain.list — List every zone this installation can see at the configured DNS provider, with the allowlist verdict for each.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const service = getDomainControlService();
        const zones = await service.listZones();
        const config = service.getConfig();
        return ok({
          provider: config.defaultProvider,
          allowlistConfigured: config.allowlist.length > 0,
          total: zones.length,
          domains: zones.map((zone) => {
            const decision = checkAllowlist(zone.fqdn, config.allowlist, config.denylist);
            return {
              id: zone.id,
              fqdn: zone.fqdn,
              status: zone.status,
              label: zone.label ?? null,
              allowlisted: decision.allowed,
              allowlistReason: decision.reason,
            };
          }),
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_get",
    description: "domain.get — Read one domain by hostname, including its environment and risk classification.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string", description: "Fully-qualified domain name." } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const resolved = await service.resolveZoneFor(String(args.hostname));
        const registered = service.getStore().getDomain(resolved.zoneFqdn);
        return ok({
          hostname: resolved.hostname,
          zone: resolved.zone,
          registration: registered,
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_status",
    description: "domain.status — Summarize a domain: zone membership, record counts, allowlist verdict, and deployment binding.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const { zone, records } = await service.listRecords(String(args.hostname));
        const decision = checkAllowlist(zone.fqdn, service.getConfig().allowlist, service.getConfig().denylist);
        const binding = service.getStore().getBinding(String(args.hostname).toLowerCase());
        return ok({
          hostname: String(args.hostname).toLowerCase(),
          zone: zone.fqdn,
          zoneStatus: zone.status,
          recordCount: records.length,
          allowlisted: decision.allowed,
          binding: binding,
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_nameservers",
    description:
      "domain.nameservers — List the NS records currently published in a zone, i.e. its delegation targets.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const { zone, records } = await service.listRecords(String(args.hostname));
        const ns = records.filter((record) => record.type === "NS");
        return ok({
          zone: zone.fqdn,
          count: ns.length,
          nameservers: ns.map((record) => ({ name: record.name, content: record.content, ttl: record.ttl })),
          note:
            ns.length === 0
              ? "No NS records are visible in this zone; delegation is likely managed by the registrar or the provider's own zone config."
              : undefined,
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_provider",
    description:
      "domain.provider — Report the active provider, its capabilities, credential CONFIGURED state (never the credential), and reachability.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { provider_id: { type: "string", description: "Optional provider id; defaults to the configured provider." } },
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const provider = service.provider(args.provider_id ? String(args.provider_id) : undefined);
        return ok({
          descriptor: provider.descriptor(),
          credentials: describeCredentialState(),
          registeredProviders: service.getRegistry().list().map((entry) => entry.descriptor().id),
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_health",
    description:
      "domain.health — Probe the provider's reachability and authentication state without mutating anything.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { provider_id: { type: "string" } },
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const health = await service.providerHealth(args.provider_id ? String(args.provider_id) : undefined);
        return ok({ health });
      } catch (error) {
        return fail(error);
      }
    },
  },

  // ------------------------------------------------------------------- dns.*
  {
    name: "dns_list_zones",
    description: "dns.list_zones — List zones the provider exposes, with the allowlist verdict applied.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const service = getDomainControlService();
        const zones = await service.listZones();
        return ok({ zones });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_list_records",
    description: "dns.list_records — List every DNS record in the zone that contains the given hostname.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        type: { type: "string", description: "Optional record type filter, e.g. A or TXT." },
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const { zone, records } = await service.listRecords(String(args.hostname));
        const filtered = args.type
          ? records.filter((record) => record.type === String(args.type).toUpperCase())
          : records;
        return ok({ zone: zone.fqdn, count: filtered.length, records: filtered });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_get_record",
    description: "dns.get_record — Fetch one record by its provider-side record id.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        record_id: { type: "string" },
      },
      required: ["hostname", "record_id"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const { zone, provider } = await service.resolveZoneFor(String(args.hostname));
        const record = await provider.getRecord(zone.id, String(args.record_id));
        if (!record) {
          return ok({ found: false, recordId: String(args.record_id), zone: zone.fqdn });
        }
        return ok({ found: true, record, zone: zone.fqdn });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_resolve",
    description:
      "dns.resolve — Resolve a hostname through the configured resolvers, reporting what each one actually answers.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        type: { type: "string", description: "Record type to resolve (default A)." },
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const hostname = normalizeHostname(String(args.hostname)).fqdn;
        const type = String(args.type ?? "A").toUpperCase();
        const resolvers = service.getConfig().resolvers;
        const answers = await Promise.all(
          resolvers.map(async (resolver) => {
            try {
              const result = await systemResolve(hostname, type, resolver);
              return { resolver, values: result?.values ?? [], error: null };
            } catch (error) {
              return { resolver, values: [], error: redactSecrets(String(error)) };
            }
          }),
        );
        return ok({ hostname, type, answers });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_diff",
    description:
      "dns.diff — Compute the diff between observed provider records and an intended record. Read-only: it never writes and never creates an approval.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        name: { type: "string", description: "Owner name relative to the zone, e.g. @ or www." },
        type: { type: "string" },
        content: { type: "string" },
        ttl: { type: "number" },
        priority: { type: "number" },
      },
      required: ["hostname", "name", "type", "content"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const intent = intentFrom(args);
        const { zone, diff, observed } = await service.buildDiff(String(args.hostname), [intent]);
        return ok({
          zone: zone.fqdn,
          observedCount: observed.length,
          diff,
          risk: readOnlyAssessment(),
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_check_propagation",
    description:
      "dns.check_propagation — Poll the configured resolvers until they report the expected value, using bounded retries rather than a fixed sleep.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        type: { type: "string", description: "Record type (default A)." },
        expected: { type: "array", items: { type: "string" }, description: "Expected record values." },
      },
      required: ["hostname", "expected"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const config = service.getConfig();
        const expected = Array.isArray(args.expected) ? (args.expected as string[]) : [];
        if (expected.length === 0) {
          throw new DomainControlError("VALIDATION_FAILED", "At least one expected value is required.");
        }
        const verification = await verifyPropagation(
          {
            hostname: normalizeHostname(String(args.hostname)).fqdn,
            type: String(args.type ?? "A").toUpperCase(),
            expected,
            resolvers: config.resolvers,
            timeoutMs: config.verificationTimeoutMs,
            intervalMs: config.verificationIntervalMs,
          },
          systemResolve,
        );
        return ok({ verification });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_create_record",
    description:
      "dns.create_record — Create a DNS record (A, AAAA, CNAME, TXT). Defaults to a dry run for agents and requires an approval id to write.",
    riskTier: "R3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string", description: "The hostname being created, e.g. dev.example.com." },
        name: { type: "string", description: "Owner name relative to the zone; @ for the apex." },
        type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT"] },
        content: { type: "string" },
        ttl: { type: "number" },
        ...MUTATION_PROPS,
      },
      required: ["hostname", "name", "type", "content"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const outcome = await service.applyRecord(
          String(args.hostname),
          intentFrom(args),
          envelope(args),
        );
        return ok({ outcome });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_update_record",
    description:
      "dns.update_record — Update an existing record by id. Requires approval; a dry run reports the diff first.",
    riskTier: "R3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        record_id: { type: "string", description: "Provider-side id of the record to update." },
        name: { type: "string" },
        type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT"] },
        content: { type: "string" },
        ttl: { type: "number" },
        ...MUTATION_PROPS,
      },
      required: ["hostname", "record_id", "name", "type", "content"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const outcome = await service.applyRecord(
          String(args.hostname),
          intentFrom(args),
          envelope(args),
        );
        return ok({ outcome });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_delete_record",
    description:
      "dns.delete_record — Delete a record by id. Always classified critical: approval is mandatory and the doomed record is shown in the diff.",
    riskTier: "R4",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        record_id: { type: "string" },
        ...MUTATION_PROPS,
      },
      required: ["hostname", "record_id"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const outcome = await service.deleteRecord(
          String(args.hostname),
          String(args.record_id),
          envelope(args),
        );
        return ok({ outcome });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "dns_restore_record",
    description:
      "dns.restore_record — Roll a record back to a previously observed state. This is a NEW audited mutation with its own approval, never a silent undo.",
    riskTier: "R3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT"] },
        content: { type: "string" },
        ttl: { type: "number" },
        record_id: { type: "string", description: "Id of the record to restore, when it still exists." },
        ...MUTATION_PROPS,
      },
      required: ["hostname", "name", "type", "content"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const outcome = await service.restoreRecord(
          String(args.hostname),
          intentFrom(args),
          envelope(args),
        );
        return ok({ outcome });
      } catch (error) {
        return fail(error);
      }
    },
  },

  // ------------------------------------------------------------------- ssl.*
  {
    name: "ssl_status",
    description:
      "ssl.status — Report TLS state for every hostname this installation has a deployment binding for.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const service = getDomainControlService();
        const deployments = getDeploymentService();
        const bindings = service.getStore().listBindings();
        const results = await Promise.all(
          bindings.map(async (binding) => ({
            hostname: binding.hostname,
            tlsMode: binding.tlsMode,
            inspection: await deployments.inspectTls(binding.hostname),
          })),
        );
        return ok({ count: results.length, hostnames: results });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "ssl_inspect",
    description: "ssl.inspect — Inspect the certificate presented for one hostname, including expiry when a probe is configured.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        port: { type: "number", description: "TLS port (default 443)." },
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const inspection = await deployments.inspectTls(
          String(args.hostname),
          args.port === undefined ? 443 : Number(args.port),
        );
        return ok({ inspection });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "ssl_request",
    description:
      "ssl.request — Request certificate issuance. With Caddy automatic HTTPS, issuance follows from the route: this reports the ACME path that will be used rather than fabricating an order.",
    // Read-only in the honest sense: this tool creates no certificate order and
    // mutates nothing. It describes the ACME path that issuance will take once a
    // route is live. Marking it mutating would have implied an envelope it does not
    // need and a write it does not perform.
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        challenge: { type: "string", enum: ["http-01", "dns-01"], description: "ACME challenge type (default http-01 with Caddy)." },
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const { fqdn } = normalizeHostname(String(args.hostname));
        const challenge = String(args.challenge ?? "http-01");
        return ok({
          hostname: fqdn,
          challenge,
          automatic: challenge === "http-01",
          detail:
            challenge === "http-01"
              ? "With Caddy, a live route for this hostname triggers ACME HTTP-01 issuance automatically; no manual order is needed."
              : "DNS-01 requires publishing a challenge TXT record through the provider's ACME endpoint; use the provider adapter's challenge support.",
          note: "No certificate order is created by this tool; it reports the path that issuance will take.",
        });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "ssl_verify",
    description: "ssl.verify — Verify TLS for a hostname, returning an explicit unknown state when no probe is configured.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" }, port: { type: "number" } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const verification = await deployments.inspectTls(
          String(args.hostname),
          args.port === undefined ? 443 : Number(args.port),
        );
        return ok({ verification });
      } catch (error) {
        return fail(error);
      }
    },
  },

  // ------------------------------------------------------------ deployment.*
  {
    name: "deployment_plan",
    description:
      "deployment.plan — Build the reviewable plan for putting a hostname in front of an application: DNS, proxy route, TLS, health check, and binding steps, with the diff and risk. Read-only.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        target_ip: { type: "string", description: "Public IPv4 address of the application host." },
        target_port: { type: "number" },
        healthcheck_path: { type: "string", description: "Health endpoint path (default /health)." },
        tls_mode: { type: "string", enum: ["auto", "manual", "off"] },
      },
      required: ["hostname", "target_ip", "target_port"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const plan = await deployments.plan({
          hostname: String(args.hostname),
          targetIp: String(args.target_ip),
          targetPort: Number(args.target_port),
          ...(args.healthcheck_path ? { healthcheckPath: String(args.healthcheck_path) } : {}),
          ...(args.tls_mode ? { tlsMode: args.tls_mode as "auto" | "manual" | "off" } : {}),
        });
        return ok({ plan });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_list",
    description: "deployment.list — List every persisted domain-to-deployment binding.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const service = getDomainControlService();
        const bindings = service.getStore().listBindings();
        return ok({ count: bindings.length, bindings });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_get",
    description: "deployment.get — Read the binding for one hostname.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const binding = service.getStore().getBinding(normalizeHostname(String(args.hostname)).fqdn);
        return ok({ found: Boolean(binding), binding });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_attach_domain",
    description:
      "deployment.attach_domain — Run the full attach flow: DNS upsert, proxy route, binding, and health check. Defaults to a dry run for agents and requires an approval id to write.",
    riskTier: "R3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        target_ip: { type: "string" },
        target_port: { type: "number" },
        deployment_id: { type: "string" },
        healthcheck_path: { type: "string" },
        tls_mode: { type: "string", enum: ["auto", "manual", "off"] },
        proxy_type: { type: "string", enum: ["caddy", "nginx", "none"] },
        ...MUTATION_PROPS,
      },
      required: ["hostname", "target_ip", "target_port"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const result = await deployments.deploy({
          hostname: String(args.hostname),
          targetIp: String(args.target_ip),
          targetPort: Number(args.target_port),
          ...(args.deployment_id ? { deploymentId: String(args.deployment_id) } : {}),
          ...(args.healthcheck_path ? { healthcheckPath: String(args.healthcheck_path) } : {}),
          ...(args.tls_mode ? { tlsMode: args.tls_mode as "auto" | "manual" | "off" } : {}),
          ...(args.proxy_type ? { proxyType: args.proxy_type as "caddy" | "nginx" | "none" } : {}),
          ...envelope(args),
        });
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_detach_domain",
    description:
      "deployment.detach_domain — Remove the proxy route and the stored binding for a hostname. The DNS record is left in place; delete it deliberately with dns.delete_record.",
    riskTier: "R3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        ...MUTATION_PROPS,
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const result = await deployments.detach(String(args.hostname), envelope(args));
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_check_route",
    description: "deployment.check_route — Report whether the reverse proxy currently has a route for a hostname.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const proxy = (await import("./proxy")).createProxyAdapter({
          adminUrl: service.getConfig().caddyAdminUrl,
        });
        if (!proxy.available()) {
          return ok({
            available: false,
            present: false,
            detail: "No reverse proxy adapter is configured (CADDY_ADMIN_URL is unset).",
          });
        }
        const check = await proxy.checkRoute(String(args.hostname));
        return ok({ available: true, ...check });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "deployment_health",
    description: "deployment.health — HTTP health check for a hostname through its public URL.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        path: { type: "string", description: "Health path (default /health)." },
      },
      required: ["hostname"],
    },
    handler: async (args) => {
      try {
        const deployments = getDeploymentService();
        const health = await deployments.health(String(args.hostname), String(args.path ?? "/health"));
        return ok({ health });
      } catch (error) {
        return fail(error);
      }
    },
  },

  // --------------------------------------------------------- approvals/audit
  {
    name: "domain_list_approvals",
    description:
      "domain.list_approvals — List approval requests, newest first. Expired pending requests are transitioned before the list is returned.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "granted", "denied", "expired"] },
      },
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const approvals = service.listApprovals(
          args.status ? (args.status as "pending" | "granted" | "denied" | "expired") : undefined,
        );
        return ok({ count: approvals.length, approvals });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_audit_log",
    description: "domain.audit_log — Read the append-only audit trail, optionally filtered by request, resource, or operation.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string" },
        resource: { type: "string" },
        operation: { type: "string" },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      try {
        const service = getDomainControlService();
        const events = service.listAudit({
          ...(args.request_id ? { requestId: String(args.request_id) } : {}),
          ...(args.resource ? { resource: String(args.resource) } : {}),
          ...(args.operation ? { operation: String(args.operation) } : {}),
          ...(args.limit === undefined ? {} : { limit: Number(args.limit) }),
        });
        return ok({ count: events.length, events });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_metrics",
    description: "domain.metrics — Operation counters for the control plane, derived from the audit trail.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const service = getDomainControlService();
        return ok({ metrics: service.metrics() });
      } catch (error) {
        return fail(error);
      }
    },
  },
  {
    name: "domain_validate_target",
    description:
      "domain.validate_target — Check whether an IP is acceptable as a routing target before planning a deployment, surfacing private/loopback/link-local rejections early.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { target_ip: { type: "string" } },
      required: ["target_ip"],
    },
    handler: async (args) => {
      try {
        const target = assertRoutableTarget(String(args.target_ip));
        return ok({ acceptable: true, targetIp: target });
      } catch (error) {
        if (error instanceof DomainControlError) {
          return ok({ acceptable: false, error: error.toJSON() });
        }
        return fail(error);
      }
    },
  },
  {
    name: "domain_mask_secret",
    description:
      "domain.mask_secret — Mask a credential for display. Exposed so a caller can render a provider key safely instead of inventing its own masking.",
    riskTier: "R0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    handler: (args) => ok({ masked: maskSecret(String(args.value)) }),
  },
];

/**
 * System resolver. Uses Bun's DNS API, which performs a real lookup through the
 * platform resolver, and returns null (rather than throwing) for NXDOMAIN so a
 * caller can distinguish no-answer from a resolver failure.
 */
export const systemResolve: ResolveFn = async (hostname, type, resolver) => {
  const dns = await import("node:dns/promises");
  // A dedicated Resolver bound to the named server. Without setServers, every
  // "resolver" would return the system resolver's answer, so a multi-resolver
  // propagation check would report one observation several times and call it
  // agreement.
  const client = new dns.Resolver({ timeout: 4000, tries: 2 });
  try {
    client.setServers([resolver]);
  } catch {
    return { resolver, values: [] };
  }
  const target: string[] = [];
  try {
    if (type === "A" || type === "AAAA" || type === "NS" || type === "CNAME") {
      const resolved = await client.resolve(hostname, type as "A");
      for (const entry of resolved) target.push(typeof entry === "string" ? entry : String(entry));
    } else if (type === "TXT") {
      const records = await client.resolveTxt(hostname);
      for (const chunks of records) target.push(chunks.join(""));
    } else {
      const records = await client.resolve(hostname, type as "MX");
      for (const entry of records) target.push(String(entry));
    }
  } catch {
    // NXDOMAIN/ENODATA is a legitimate observation (the record does not exist yet),
    // not a resolver failure: report an empty answer so propagation polling keeps
    // waiting instead of ending early. Every other failure also reports empty, for
    // the same reason — a resolver error is not an observed value.
    return { resolver, values: [] };
  }
  return { resolver, values: target };
};
