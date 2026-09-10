// Phase 20.15 — Domain Control Plane: provider abstraction.
//
// The MCP layer never calls a DNS provider directly. Every call travels
//   MCP/API -> Domain Service -> Policy -> Approval -> Provider Adapter -> HTTP
// so that a new provider is a new adapter and never a new call path.

import type {
  DnsRecord,
  DnsRecordIntent,
  DomainZone,
  ProviderDescriptor,
  ProviderHealth,
} from "../types";

/**
 * A write outcome. asyncWrites providers (Domain-OSS) return a job handle rather
 * than a settled record, which is exactly why the service re-reads provider state
 * after a write instead of trusting the write response.
 */
export interface ProviderWriteResult {
  readonly record: DnsRecord | null;
  readonly jobId?: string;
  /** True when the provider accepted the write but has not yet applied it. */
  readonly pending?: boolean;
  readonly raw?: unknown;
}

export interface DomainProvider {
  descriptor(): ProviderDescriptor;
  health(): Promise<ProviderHealth>;

  listZones(): Promise<DomainZone[]>;
  getZone(zoneId: string): Promise<DomainZone | null>;
  listRecords(zoneId: string): Promise<DnsRecord[]>;
  getRecord(zoneId: string, recordId: string): Promise<DnsRecord | null>;

  createRecord(zoneId: string, intent: DnsRecordIntent): Promise<ProviderWriteResult>;
  updateRecord(zoneId: string, recordId: string, intent: DnsRecordIntent): Promise<ProviderWriteResult>;
  deleteRecord(zoneId: string, recordId: string): Promise<ProviderWriteResult>;

  /** Publish an ACME DNS-01 challenge value. Returns a one-time cleanup token. */
  publishAcmeChallenge?(
    zoneId: string,
    input: { value: string; name?: string },
  ): Promise<{ token: string }>;
  removeAcmeChallenge?(zoneId: string, token: string): Promise<void>;
}

/** Normalizes provider payloads: a TTL must be a positive integer or it is 300. */
export function normalizeTtl(value: unknown, fallback = 300): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 86_400);
}

/** Normalizes an owner name to the cached/diffed form. */
export function normalizeName(value: unknown, zoneFqdn?: string): string {
  let name = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!name) return "@";
  if (zoneFqdn) {
    const zone = zoneFqdn.toLowerCase().replace(/\.$/, "");
    if (name === zone) return "@";
    if (name.endsWith(`.${zone}`)) name = name.slice(0, -(zone.length + 1));
  }
  return name || "@";
}
