// Phase 20.15 — Domain Control Plane: DigitalPlat Domain-OSS adapter.
//
// Integration boundary (do not erode):
//  - Domain-OSS is an INDEPENDENT service reached over HTTP. No upstream source is
//    vendored or copied. Upstream is AGPL-3.0; keeping it at arm's length over the
//    API is what keeps this repository's MIT licensing position unambiguous.
//  - The API surface below was read from upstream source at integration time
//    (domain_oss/routes/api.py, docs/API.md) rather than assumed from a spec:
//      GET    /api/v1/domains                                  (domains:read)
//      GET    /api/v1/domains/{id}                             (domains:read)
//      GET    /api/v1/domains/{id}/records                     (dns:read)
//      POST   /api/v1/domains/{id}/records                     (dns:write)
//      PATCH  /api/v1/domains/{id}/records/{record_id}         (dns:write)
//      DELETE /api/v1/domains/{id}/records/{record_id}         (dns:write)
//      POST   /api/v1/domains/{id}/acme-challenges             (acme:write)
//      DELETE /api/v1/domains/{id}/acme-challenges/{token}     (acme:write)
//  - Writes are ASYNCHRONOUS upstream: POST returns 201 with { data, job_id,
//    sync_status } and PATCH returns { data, jobs }. That is why the service
//    re-reads provider state after every write instead of trusting this response.
//  - Auth is a bearer token. It is read per-call from the environment and is never
//    logged, never returned, and never placed in an error message.

import {
  type DnsRecord,
  type DnsRecordIntent,
  type DnsRecordType,
  type DomainZone,
  type ProviderDescriptor,
  type ProviderHealth,
  DomainControlError,
  ALL_RECORD_TYPES,
} from "../types";
import type { DomainProvider, ProviderWriteResult } from "./base";
import { normalizeName, normalizeTtl } from "./base";
import { redactSecrets, resolveDomainOssApiKey } from "../config";

export interface DomainOssOptions {
  readonly baseUrl: string;
  /** Credential resolver seam; production reads DOMAIN_OSS_API_KEY. */
  readonly apiKey?: () => string | undefined;
  readonly timeoutMs?: number;
  /** Injectable transport, so adapter tests never open a socket. */
  readonly fetchImpl?: typeof fetch;
}

interface DomainOssEnvelope<T> {
  readonly data?: T;
  readonly meta?: { page: number; per_page: number; total: number; pages: number };
  readonly job_id?: string;
  readonly jobs?: string[];
  readonly sync_status?: string;
  readonly error?: { message?: string; status?: number };
}

interface DomainOssDomain {
  readonly id: number;
  readonly name: string;
  readonly label?: string;
  readonly status?: string;
  readonly zone?: string;
  readonly created_at?: string;
}

interface DomainOssRecord {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly ttl?: number;
  readonly priority?: number | null;
}

export class DomainOssProvider implements DomainProvider {
  private readonly baseUrl: string;
  private readonly apiKey: () => string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private lastLatencyMs: number | null = null;

  constructor(options: DomainOssOptions) {
    // Trailing slashes are stripped once here so every path join is unambiguous.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? (() => resolveDomainOssApiKey());
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  descriptor(): ProviderDescriptor {
    return {
      id: "domain_oss",
      displayName: "DigitalPlat Domain OSS",
      kind: "external",
      capabilities: { read: true, write: true, acme: true, asyncWrites: true },
    };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    const keyConfigured = Boolean(this.apiKey());
    if (!keyConfigured) {
      return {
        provider: "domain_oss",
        reachable: false,
        authenticated: false,
        latencyMs: null,
        detail: "DOMAIN_OSS_API_KEY is not configured; adapter cannot authenticate.",
      };
    }
    try {
      await this.listZones();
      return {
        provider: "domain_oss",
        reachable: true,
        authenticated: true,
        latencyMs: Date.now() - started,
        detail: "Domain-OSS responded to an authenticated domains list.",
      };
    } catch (error) {
      const code = error instanceof DomainControlError ? error.code : "PROVIDER_UNAVAILABLE";
      return {
        provider: "domain_oss",
        reachable: code !== "PROVIDER_UNAVAILABLE" && code !== "PROVIDER_TIMEOUT",
        authenticated: code === "PROVIDER_AUTH_FAILED" ? false : null,
        latencyMs: Date.now() - started,
        detail: code,
      };
    }
  }

  /**
   * One place where a credential enters a request, and one place where a provider
   * response becomes a typed value or a standardized error.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; payload: DomainOssEnvelope<T> | null }> {
    const key = this.apiKey();
    if (!key) {
      throw new DomainControlError(
        "PROVIDER_AUTH_FAILED",
        "Domain-OSS credential is not configured. Set DOMAIN_OSS_API_KEY.",
        { nextAction: "configure the provider credential in the environment" },
      );
    }
    const url = `${this.baseUrl}/api/v1${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      // An aborted write is AMBIGUOUS, not failed: the request may have been
      // applied. Reporting it as retryable is how duplicate records are created.
      if (error instanceof Error && error.name === "AbortError") {
        throw new DomainControlError(
          "PROVIDER_TIMEOUT",
          `Domain-OSS did not respond within ${this.timeoutMs}ms for ${method} ${path}.`,
          {
            retryable: method === "GET",
            nextAction:
              method === "GET"
                ? "retry the read"
                : "re-read authoritative provider state before retrying the write",
          },
        );
      }
      throw new DomainControlError(
        "PROVIDER_UNAVAILABLE",
        redactSecrets(`Domain-OSS request failed for ${method} ${path}: ${String(error)}`),
        { retryable: method === "GET", nextAction: "verify DOMAIN_OSS_BASE_URL and network reachability" },
      );
    } finally {
      clearTimeout(timer);
      this.lastLatencyMs = Date.now() - started;
    }

    if (response.status === 204) return { status: 204, payload: null };

    let payload: DomainOssEnvelope<T> | null = null;
    const text = await response.text();
    if (text.trim() !== "") {
      try {
        payload = JSON.parse(text) as DomainOssEnvelope<T>;
      } catch {
        payload = null;
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new DomainControlError(
        "PROVIDER_AUTH_FAILED",
        `Domain-OSS rejected the credential or scope (HTTP ${response.status}).`,
        { nextAction: "verify the API key and its domains/dns scopes" },
      );
    }
    if (response.status === 409) {
      throw new DomainControlError(
        "RECORD_CONFLICT",
        payload?.error?.message ?? "Domain-OSS reported a record conflict.",
        { nextAction: "re-read records; a conflicting record already exists" },
      );
    }
    if (response.status === 404) {
      throw new DomainControlError("VALIDATION_FAILED", "Domain-OSS reported the resource as not found.", {
        nextAction: "re-read zones and records to refresh identifiers",
      });
    }
    if (!response.ok) {
      throw new DomainControlError(
        "PROVIDER_UNAVAILABLE",
        redactSecrets(
          `Domain-OSS returned HTTP ${response.status}: ${payload?.error?.message ?? "no message"}`,
        ),
        { retryable: false, nextAction: "inspect the provider's error response" },
      );
    }
    return { status: response.status, payload };
  }

  async listZones(): Promise<DomainZone[]> {
    const { payload } = await this.request<DomainOssDomain[]>("GET", "/domains?per_page=100");
    const rows = payload?.data ?? [];
    return rows.map((row) => ({
      id: String(row.id),
      fqdn: String(row.name).toLowerCase(),
      ...(row.label ? { label: row.label } : {}),
      status: row.status ?? "unknown",
      ...(row.zone ? { zone: row.zone } : {}),
      ...(row.created_at ? { createdAt: row.created_at } : {}),
    }));
  }

  async getZone(zoneId: string): Promise<DomainZone | null> {
    try {
      const { payload } = await this.request<DomainOssDomain>("GET", `/domains/${zoneId}`);
      const row = payload?.data;
      if (!row) return null;
      return {
        id: String(row.id),
        fqdn: String(row.name).toLowerCase(),
        ...(row.label ? { label: row.label } : {}),
        status: row.status ?? "unknown",
        ...(row.zone ? { zone: row.zone } : {}),
        ...(row.created_at ? { createdAt: row.created_at } : {}),
      };
    } catch (error) {
      if (error instanceof DomainControlError && error.code === "VALIDATION_FAILED") return null;
      throw error;
    }
  }

  async listRecords(zoneId: string): Promise<DnsRecord[]> {
    const { payload } = await this.request<DomainOssRecord[]>(
      "GET",
      `/domains/${zoneId}/records`,
    );
    return (payload?.data ?? []).map(mapRecord);
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord | null> {
    // Upstream exposes no single-record GET route, so this reads the RRset and
    // selects. Documented here rather than faked with a made-up endpoint.
    const records = await this.listRecords(zoneId);
    return records.find((record) => record.id === recordId) ?? null;
  }

  async createRecord(zoneId: string, intent: DnsRecordIntent): Promise<ProviderWriteResult> {
    const { payload } = await this.request<DomainOssRecord>("POST", `/domains/${zoneId}/records`, {
      name: intent.name,
      type: intent.type,
      content: intent.content,
      ttl: intent.ttl ?? 300,
      ...(intent.priority === undefined ? {} : { priority: intent.priority }),
    });
    return {
      record: payload?.data ? mapRecord(payload.data) : null,
      ...(payload?.job_id ? { jobId: payload.job_id } : {}),
      // Upstream applies the change through a worker job, so the record is not
      // guaranteed live when this returns.
      pending: true,
      raw: payload,
    };
  }

  async updateRecord(
    zoneId: string,
    recordId: string,
    intent: DnsRecordIntent,
  ): Promise<ProviderWriteResult> {
    const { payload } = await this.request<DomainOssRecord>(
      "PATCH",
      `/domains/${zoneId}/records/${recordId}`,
      {
        name: intent.name,
        type: intent.type,
        content: intent.content,
        ttl: intent.ttl ?? 300,
        ...(intent.priority === undefined ? {} : { priority: intent.priority }),
      },
    );
    const jobs = payload?.jobs ?? [];
    return {
      record: payload?.data ? mapRecord(payload.data) : null,
      ...(jobs[0] ? { jobId: jobs[0] } : {}),
      pending: true,
      raw: payload,
    };
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<ProviderWriteResult> {
    const { status } = await this.request<unknown>(
      "DELETE",
      `/domains/${zoneId}/records/${recordId}`,
    );
    if (status !== 204) {
      throw new DomainControlError(
        "PROVIDER_UNAVAILABLE",
        `Unexpected status ${status} deleting record ${recordId}.`,
      );
    }
    return { record: null, pending: true };
  }

  async publishAcmeChallenge(
    zoneId: string,
    input: { value: string; name?: string },
  ): Promise<{ token: string }> {
    const { payload } = await this.request<{ token?: string }>(
      "POST",
      `/domains/${zoneId}/acme-challenges`,
      { value: input.value, ...(input.name ? { name: input.name } : {}) },
    );
    const token = payload?.data?.token;
    if (!token) {
      throw new DomainControlError(
        "TLS_PROVISION_FAILED",
        "Domain-OSS did not return an ACME challenge token.",
        { nextAction: "inspect the provider ACME response" },
      );
    }
    return { token };
  }

  async removeAcmeChallenge(zoneId: string, token: string): Promise<void> {
    await this.request<unknown>("DELETE", `/domains/${zoneId}/acme-challenges/${token}`);
  }

  lastLatency(): number | null {
    return this.lastLatencyMs;
  }
}

function mapRecord(row: DomainOssRecord): DnsRecord {
  const type = String(row.type).toUpperCase();
  // An unrecognized upstream type is preserved as UNSUPPORTED rather than coerced
  // into a known type. A coerced type would make the diff compare the wrong record
  // and could report a live record as absent, which is how an "update" silently
  // overwrites a record nobody looked at. UNSUPPORTED is also non-mutable.
  const resolvedType: DnsRecordType = (ALL_RECORD_TYPES as readonly string[]).includes(type)
    ? (type as DnsRecordType)
    : "UNSUPPORTED";
  return {
    id: String(row.id),
    name: normalizeName(row.name),
    type: resolvedType,
    content: String(row.content),
    ttl: normalizeTtl(row.ttl),
    ...(row.priority === undefined || row.priority === null ? {} : { priority: row.priority }),
  };
}
