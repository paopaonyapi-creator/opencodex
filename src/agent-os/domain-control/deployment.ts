// Phase 20.15 — Domain Control Plane: domain-to-deployment bindings.
//
// The full deploy flow is deliberately NOT one method that does everything. It is
// a sequence of independent, individually observable steps, because Phase 20.15
// section 14 requires the operator to preview the actions and approve BEFORE
// anything is created, and because a partial failure has to be reportable step by
// step rather than as one opaque error.

import {
  type DeploymentBinding,
  type DnsRecordIntent,
  type HttpHealthVerification,
  type TlsVerification,
  DomainControlError,
} from "./types";
import { assertAllowed, normalizeHostname } from "./policy";
import { absoluteHostname } from "./diff";
import { type DomainControlService, type MutationOutcome } from "./service";
import type { ReverseProxyAdapter } from "./proxy";
import { assertRoutableTarget } from "./proxy";
import { getDomainControlStore, type DomainControlStore } from "./store";

export interface DeploymentPlanStep {
  readonly step: string;
  readonly detail: string;
  readonly mutating: boolean;
  /** Risk of the step, or null for pure reads. */
  readonly risk?: string | null;
}

export interface DeploymentPlan {
  readonly hostname: string;
  readonly zone: string;
  readonly targetIp: string;
  readonly targetPort: number;
  readonly steps: readonly DeploymentPlanStep[];
  readonly diff: unknown;
  readonly risk: unknown;
  readonly proxyAvailable: boolean;
  readonly approvalRequired: boolean;
}

export interface DeployRequest {
  readonly hostname: string;
  readonly targetIp: string;
  readonly targetPort: number;
  readonly deploymentId?: string;
  readonly healthcheckPath?: string;
  readonly tlsMode?: "auto" | "manual" | "off";
  readonly proxyType?: "caddy" | "nginx" | "none";
  readonly reason?: string;
  readonly actor?: "chatgpt" | "codex" | "user" | "system" | "agent";
  readonly dry_run?: boolean;
  readonly approval_id?: string | null;
  readonly request_id?: string;
  readonly idempotency_key?: string;
}

export interface DeploymentResult {
  readonly status: "planned" | "applied" | "partial" | "denied";
  readonly hostname: string;
  readonly steps: readonly DeploymentPlanStep[];
  readonly dns?: MutationOutcome;
  readonly proxy?: { applied: boolean; detail: string };
  readonly tls?: TlsVerification;
  readonly health?: HttpHealthVerification;
  readonly binding?: DeploymentBinding;
  readonly error?: { code: string; message: string; retryable: boolean; next_action: string };
}

export interface DeploymentDependencies {
  readonly service: DomainControlService;
  readonly proxy: ReverseProxyAdapter;
  readonly store?: DomainControlStore;
  readonly tlsProbe?: (hostname: string, port: number) => Promise<{
    ok: boolean;
    issuer?: string;
    validTo?: string;
    error?: string;
  }>;
  readonly httpProbe?: (url: string) => Promise<{ status: number; latencyMs: number }>;
}

export class DeploymentService {
  private service: DomainControlService;
  private proxy: ReverseProxyAdapter;
  private store: DomainControlStore;
  private tlsProbe?: DeploymentDependencies["tlsProbe"];
  private httpProbe?: DeploymentDependencies["httpProbe"];

  constructor(deps: DeploymentDependencies) {
    this.service = deps.service;
    this.proxy = deps.proxy;
    this.store = deps.store ?? getDomainControlStore();
    this.tlsProbe = deps.tlsProbe;
    this.httpProbe = deps.httpProbe;
  }

  /**
   * Build the reviewable plan. Reads only: this is what an operator approves, and
   * it performs no mutation and creates no approval record.
   */
  async plan(request: DeployRequest): Promise<DeploymentPlan> {
    const { fqdn } = normalizeHostname(request.hostname);
    const targetIp = assertRoutableTarget(request.targetIp);
    const config = this.service.getConfig();
    assertAllowed(fqdn, config.allowlist, config.denylist);

    const intent: DnsRecordIntent = {
      name: "@",
      type: "A",
      content: targetIp,
      ttl: 300,
    };
    const { zone, diff, observed } = await this.service.buildDiff(fqdn, [intent]);
    const relative = fqdn === zone.fqdn ? "@" : fqdn.slice(0, -(zone.fqdn.length + 1));
    const risk = await this.peekRisk(fqdn, { ...intent, name: relative }, observed, zone.fqdn);

    const steps: DeploymentPlanStep[] = [
      { step: "resolve_zone", detail: `Zone ${zone.fqdn} (provider id ${zone.id}).`, mutating: false },
      { step: "check_hostname", detail: `${fqdn} is allowlisted and inside ${zone.fqdn}.`, mutating: false, risk: null },
      { step: "dns_diff", detail: `${diff.counts.create} create, ${diff.counts.update} update, ${diff.counts.delete} delete, ${diff.counts.noop} unchanged.`, mutating: false },
      { step: "dns_apply", detail: `Upsert A ${absoluteHostname(relative, zone.fqdn)} -> ${targetIp}.`, mutating: true, risk: (risk as { level?: string }).level ?? "unknown" },
      {
        step: "proxy_route",
        detail: this.proxy.available()
          ? `Create ${this.proxy.kind} route ${fqdn} -> ${targetIp}:${request.targetPort}.`
          : "No reverse proxy configured; route creation will be skipped and reported.",
        mutating: true,
      },
      {
        step: "tls",
        detail:
          (request.tlsMode ?? "auto") === "off"
            ? "TLS disabled by request."
            : "Certificate is issued automatically by the proxy (ACME HTTP-01) once the route is live.",
        mutating: false,
      },
      {
        step: "health_check",
        detail: `GET https://${fqdn}${request.healthcheckPath ?? "/health"}`,
        mutating: false,
      },
      { step: "persist_binding", detail: "Record the domain-to-deployment binding.", mutating: true },
      { step: "audit", detail: "Write an audit event for every applied step.", mutating: true },
    ];

    return {
      hostname: fqdn,
      zone: zone.fqdn,
      targetIp,
      targetPort: request.targetPort,
      steps,
      diff,
      risk,
      proxyAvailable: this.proxy.available(),
      approvalRequired: true,
    };
  }

  /**
   * Apply a deployment.
   *
   * Stops at the first refusal. The DNS write goes through the control plane's own
   * mutation path, so it inherits the allowlist, the diff, the approval gate, and
   * the audit row without this method re-implementing any of them.
   */
  async deploy(request: DeployRequest): Promise<DeploymentResult> {
    const plan = await this.plan(request);
    const { fqdn } = normalizeHostname(request.hostname);
    const targetIp = plan.targetIp;
    const relative = fqdn === plan.zone ? "@" : fqdn.slice(0, -(plan.zone.length + 1));

    const dns = await this.service.applyRecord(
      fqdn,
      { name: relative, type: "A", content: targetIp, ttl: 300 },
      {
        ...(request.dry_run === undefined ? {} : { dry_run: request.dry_run }),
        approval_id: request.approval_id ?? null,
        ...(request.request_id ? { request_id: request.request_id } : {}),
        ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}),
        reason: request.reason ?? `deploy ${fqdn}`,
        actor: request.actor ?? "agent",
      },
    );

    if (dns.status === "approval_required" || dns.status === "denied") {
      return {
        status: "denied",
        hostname: fqdn,
        steps: plan.steps,
        dns,
        ...(dns.error ? { error: dns.error } : {}),
      };
    }
    if (dns.status === "dry_run" || dns.status === "noop") {
      return { status: "planned", hostname: fqdn, steps: plan.steps, dns };
    }

    const applied: DeploymentPlanStep[] = [];
    let proxyResult: { applied: boolean; detail: string } | undefined;
    if (this.proxy.available() && (request.proxyType ?? "caddy") !== "none") {
      try {
        proxyResult = await this.proxy.applyRoute({
          hostname: fqdn,
          targetIp,
          targetPort: request.targetPort,
          tlsMode: request.tlsMode ?? "auto",
        });
        applied.push({ step: "proxy_route", detail: proxyResult.detail, mutating: true });
      } catch (error) {
        const failure = toErrorShape(error);
        return {
          status: "partial",
          hostname: fqdn,
          steps: [...applied, { step: "proxy_route", detail: failure.message, mutating: true }],
          dns,
          error: failure,
        };
      }
    }

    const binding = this.store.createBinding({
      deploymentId: request.deploymentId ?? `dep_${Date.now().toString(36)}`,
      hostname: fqdn,
      targetIp,
      targetPort: request.targetPort,
      proxyType: request.proxyType ?? (this.proxy.available() ? "caddy" : "none"),
      tlsMode: request.tlsMode ?? "auto",
      ...(request.healthcheckPath
        ? { healthcheckUrl: `https://${fqdn}${request.healthcheckPath}` }
        : {}),
      zone: plan.zone,
    });
    applied.push({
      step: "persist_binding",
      detail: `Binding ${binding.id} recorded.`,
      mutating: true,
    });

    const health = await this.health(fqdn, request.healthcheckPath ?? "/health");
    applied.push({
      step: "health_check",
      detail: health.ok
        ? `Healthy (${health.status}) in ${health.latencyMs ?? "?"}ms.`
        : `Health check failed: ${health.error ?? health.status}.`,
      mutating: false,
    });

    return {
      status: "applied",
      hostname: fqdn,
      steps: [...plan.steps, ...applied],
      dns,
      ...(proxyResult ? { proxy: proxyResult } : {}),
      health,
      binding,
    };
  }

  /**
   * Remove a proxy route and its stored binding.
   *
   * Routed through the same approval gate as every other mutation: removing a
   * route takes a live hostname offline, which is at least as consequential as
   * editing a DNS record. The DNS record is deliberately left alone — deleting it
   * is a separate, separately-approved action.
   */
  async detach(
    hostname: string,
    envelope: {
      approval_id?: string | null;
      request_id?: string;
      reason?: string;
      actor?: "chatgpt" | "codex" | "user" | "system" | "agent";
      dry_run?: boolean;
    } = {},
  ): Promise<{ removed: boolean; proxy?: string; status: string; approval?: unknown }> {
    const { fqdn } = normalizeHostname(hostname);
    const requestId = envelope.request_id ?? `dcreq_${Date.now().toString(36)}`;
    const actor = envelope.actor ?? "agent";

    const gate = await this.service.requestOrCheckApproval({
      operation: "deployment.detach_domain",
      resource: fqdn,
      risk: {
        level: "high",
        approvalMode: "MANUAL_MUTATION",
        requiresApproval: true,
        reasons: ["Removing a proxy route takes the hostname offline."],
        matchedRules: ["deployment.detach"],
      },
      requestId,
      envelope: {
        approval_id: envelope.approval_id ?? null,
        request_id: requestId,
        reason: envelope.reason ?? `detach ${fqdn}`,
        actor,
        ...(envelope.dry_run === undefined ? {} : { dry_run: envelope.dry_run }),
      },
    });

    const previewOnly = envelope.dry_run === true;
    if (!gate.granted || previewOnly) {
      this.store.appendAudit({
        requestId,
        actor,
        operation: "deployment.detach_domain",
        resource: fqdn,
        before: null,
        after: null,
        approvalId: gate.approval ? (gate.approval as { id: string }).id : null,
        provider: this.proxy.kind,
        result: previewOnly ? "dry_run" : "approval_required",
        errorCode: null,
        verification: null,
      });
      return {
        removed: false,
        status: previewOnly ? "dry_run" : "approval_required",
        ...(gate.approval ? { approval: gate.approval } : {}),
      };
    }

    let proxyDetail: string | undefined;
    if (this.proxy.available()) {
      const result = await this.proxy.removeRoute(fqdn);
      proxyDetail = result.detail;
    }
    const removed = this.store.deleteBinding(fqdn);
    this.store.appendAudit({
      requestId,
      actor,
      operation: "deployment.detach_domain",
      resource: fqdn,
      before: { binding: removed },
      after: null,
      approvalId: gate.approval ? (gate.approval as { id: string }).id : null,
      provider: this.proxy.kind,
      result: "success",
      errorCode: null,
      verification: proxyDetail ? { proxy: proxyDetail } : null,
    });
    return { removed, status: "applied", ...(proxyDetail ? { proxy: proxyDetail } : {}) };
  }

  async health(hostname: string, path = "/health"): Promise<HttpHealthVerification> {
    const { fqdn } = normalizeHostname(hostname);
    const url = `https://${fqdn}${path.startsWith("/") ? path : `/${path}`}`;
    const { verifyHttpHealth } = await import("./verification");
    return verifyHttpHealth(url, this.httpProbe ?? defaultProbe);
  }

  /** TLS inspection. Returns an honest "unknown" when no probe is wired. */
  async inspectTls(hostname: string, port = 443): Promise<TlsVerification> {
    const { fqdn } = normalizeHostname(hostname);
    if (!this.tlsProbe) {
      return {
        hostname: fqdn,
        ok: false,
        error: "No TLS probe configured; certificate state is unknown.",
      };
    }
    const { verifyTls } = await import("./verification");
    return verifyTls(fqdn, this.tlsProbe, port);
  }

  private async peekRisk(
    hostname: string,
    intent: DnsRecordIntent,
    observed: readonly { name: string; type: string; id: string; content: string }[],
    zoneFqdn: string,
  ): Promise<unknown> {
    const { classifyRecordRisk } = await import("./policy");
    const config = this.service.getConfig();
    const existing = observed.find(
      (record) => record.name.toLowerCase() === intent.name.toLowerCase() && record.type === intent.type,
    );
    return classifyRecordRisk({
      intent,
      hostname,
      production: config.productionZones.some(
        (entry) => zoneFqdn === entry || zoneFqdn.endsWith(`.${entry}`),
      ),
      apex: intent.name === "@",
      operation: existing ? "update" : "create",
    });
  }
}

function toErrorShape(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  next_action: string;
} {
  if (error instanceof DomainControlError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      next_action: error.nextAction,
    };
  }
  return {
    code: "PROXY_CONFIG_FAILED",
    message: String(error),
    retryable: false,
    next_action: "inspect the reverse proxy configuration",
  };
}

const defaultProbe = async (url: string): Promise<{ status: number; latencyMs: number }> => {
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  return { status: response.status, latencyMs: Date.now() - started };
};
