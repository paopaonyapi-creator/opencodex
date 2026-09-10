// Phase 20.15 — Domain Control Plane: reverse proxy adapter (Caddy first).
//
// This repository had no reverse proxy before this phase, so the adapter is
// deliberately thin and provider-shaped rather than a new subsystem:
//   - Caddy's admin API is used directly; no new dependency, no config-file
//     templating, and no shell interpolation of user input anywhere.
//   - The route hostname is validated as a hostname BEFORE it is JSON-encoded, so
//     a crafted "hostname" can never become a Caddy directive.
//   - Unconfigured means "not available", reported honestly, not silently skipped.

import { type HttpHealthVerification, DomainControlError } from "./types";
import { normalizeHostname } from "./policy";
import { resolveCaddyApiToken } from "./config";
import { verifyHttpHealth, type HttpProbeFn } from "./verification";

export interface ProxyRoute {
  readonly hostname: string;
  readonly targetIp: string;
  readonly targetPort: number;
  readonly tlsMode: "auto" | "manual" | "off";
  readonly healthcheckPath?: string;
}

export interface ReverseProxyAdapter {
  readonly kind: "caddy" | "nginx" | "none";
  available(): boolean;
  applyRoute(route: ProxyRoute): Promise<{ applied: boolean; detail: string }>;
  removeRoute(hostname: string): Promise<{ applied: boolean; detail: string }>;
  checkRoute(hostname: string): Promise<{ present: boolean; detail: string }>;
}

/** Private and link-local targets are refused: a route to 169.254.169.254 or
 * 127.0.0.1 turns the proxy into an SSRF pivot into the host or its metadata. */
export function assertRoutableTarget(ip: string): string {
  const value = String(ip ?? "").trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => octet > 255)) {
      throw new DomainControlError("VALIDATION_FAILED", `${value} is not a valid IPv4 address.`);
    }
    const [a, b] = octets as [number, number, number, number];
    const blocked =
      a === 127 ||
      a === 0 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a >= 224;
    if (blocked) {
      throw new DomainControlError(
        "VALIDATION_FAILED",
        `Target ${value} is a private, loopback, link-local, or multicast address.`,
        { nextAction: "target the public address of the application host" },
      );
    }
    return value;
  }
  // IPv6 (including IPv4-mapped) is not accepted for routing targets in this
  // release. Accepting it without a full private-range check would be a hole.
  if (value.includes(":")) {
    throw new DomainControlError(
      "NOT_IMPLEMENTED",
      "IPv6 routing targets are not supported in this release.",
      { nextAction: "use an IPv4 target address" },
    );
  }
  throw new DomainControlError("VALIDATION_FAILED", `Target "${value}" is not an IP address.`, {
    nextAction: "supply an IPv4 address",
  });
}

export interface CaddyAdapterOptions {
  readonly adminUrl: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Health-probe seam so route tests never open a socket. */
  readonly healthProbe?: HttpProbeFn;
  /** Credential seam; production reads CADDY_API_TOKEN. */
  readonly apiToken?: () => string | undefined;
}

export class CaddyAdapter implements ReverseProxyAdapter {
  readonly kind = "caddy" as const;
  private adminUrl: string | null;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private healthProbe: HttpProbeFn;
  private apiToken: () => string | undefined;

  constructor(options: CaddyAdapterOptions) {
    this.adminUrl = options.adminUrl ? options.adminUrl.replace(/\/+$/, "") : null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.healthProbe = options.healthProbe ?? defaultHttpProbe;
    this.apiToken = options.apiToken ?? (() => resolveCaddyApiToken());
  }

  available(): boolean {
    return Boolean(this.adminUrl);
  }

  private headers(): Record<string, string> {
    const token = this.apiToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    if (!this.adminUrl) {
      throw new DomainControlError(
        "PROXY_CONFIG_FAILED",
        "CADDY_ADMIN_URL is not configured; the Caddy adapter is unavailable.",
        { nextAction: "set CADDY_ADMIN_URL to the Caddy admin endpoint" },
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.adminUrl}${path}`, {
        method,
        headers: this.headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new DomainControlError(
        "PROXY_CONFIG_FAILED",
        `Caddy admin request ${method} ${path} failed: ${String(error)}`,
        { nextAction: "verify the Caddy admin endpoint is reachable" },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async applyRoute(route: ProxyRoute): Promise<{ applied: boolean; detail: string }> {
    const { fqdn } = normalizeHostname(route.hostname);
    const targetIp = assertRoutableTarget(route.targetIp);
    if (!Number.isInteger(route.targetPort) || route.targetPort < 1 || route.targetPort > 65535) {
      throw new DomainControlError(
        "VALIDATION_FAILED",
        `Target port ${route.targetPort} is outside 1-65535.`,
      );
    }
    // Automatic HTTPS is Caddy's default; the explicit branch exists because an
    // install may deliberately serve plain HTTP behind a load balancer.
    const body = {
      "@id": `pao-${fqdn}`,
      match: [{ host: [fqdn] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `${targetIp}:${route.targetPort}` }],
        },
      ],
      terminal: true,
      ...(route.tlsMode === "off" ? {} : { automatic_https: { disable: false } }),
    };
    const response = await this.call("POST", "/config/apps/http/servers/pao/routes", body);
    if (!response.ok && response.status !== 409) {
      throw new DomainControlError(
        "PROXY_CONFIG_FAILED",
        `Caddy rejected the route for ${fqdn} with HTTP ${response.status}.`,
        { nextAction: "inspect Caddy's admin API response" },
      );
    }
    return {
      applied: true,
      detail:
        response.status === 409
          ? `Route for ${fqdn} already existed and was left in place.`
          : `Route for ${fqdn} -> ${targetIp}:${route.targetPort} created.`,
    };
  }

  async removeRoute(hostname: string): Promise<{ applied: boolean; detail: string }> {
    const { fqdn } = normalizeHostname(hostname);
    const response = await this.call("DELETE", `/id/pao-${encodeURIComponent(fqdn)}`);
    if (!response.ok && response.status !== 404) {
      throw new DomainControlError(
        "PROXY_CONFIG_FAILED",
        `Caddy rejected route removal for ${fqdn} with HTTP ${response.status}.`,
      );
    }
    return { applied: true, detail: `Route for ${fqdn} removed.` };
  }

  async checkRoute(hostname: string): Promise<{ present: boolean; detail: string }> {
    const { fqdn } = normalizeHostname(hostname);
    const response = await this.call("GET", `/id/pao-${encodeURIComponent(fqdn)}`);
    if (response.status === 404) {
      return { present: false, detail: `No route found for ${fqdn}.` };
    }
    if (!response.ok) {
      return { present: false, detail: `Caddy returned HTTP ${response.status} for ${fqdn}.` };
    }
    return { present: true, detail: `Route for ${fqdn} is configured.` };
  }

  /** Post-deploy health check through the configured hostname. */
  async checkHealth(hostname: string, path = "/health"): Promise<HttpHealthVerification> {
    const { fqdn } = normalizeHostname(hostname);
    const url = `https://${fqdn}${path.startsWith("/") ? path : `/${path}`}`;
    return verifyHttpHealth(url, this.healthProbe);
  }
}

const defaultHttpProbe: HttpProbeFn = async (url) => {
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  return { status: response.status, latencyMs: Date.now() - started };
};

/** Adapter used when no proxy is configured. Reports unavailability honestly. */
export class NoopProxyAdapter implements ReverseProxyAdapter {
  readonly kind = "none" as const;
  available(): boolean {
    return false;
  }
  async applyRoute(): Promise<{ applied: boolean; detail: string }> {
    throw new DomainControlError(
      "PROXY_CONFIG_FAILED",
      "No reverse proxy adapter is configured.",
      { nextAction: "set CADDY_ADMIN_URL to enable automatic route creation" },
    );
  }
  async removeRoute(): Promise<{ applied: boolean; detail: string }> {
    throw new DomainControlError("PROXY_CONFIG_FAILED", "No reverse proxy adapter is configured.");
  }
  async checkRoute(): Promise<{ present: boolean; detail: string }> {
    return { present: false, detail: "No reverse proxy adapter is configured." };
  }
}

export function createProxyAdapter(options: CaddyAdapterOptions): ReverseProxyAdapter {
  return options.adminUrl ? new CaddyAdapter(options) : new NoopProxyAdapter();
}
