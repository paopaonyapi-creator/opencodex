// Phase 20.15 — Domain Control Plane: in-memory provider for tests and rehearsal.
//
// Every acceptance criterion in this phase can be exercised against this provider
// with no credential, no network, and no production risk. The failure-injection
// switches exist so the AMBIGUOUS_MUTATION path is testable at all: a provider that
// can only succeed cannot prove that a lost response is handled correctly.

import type {
  DnsRecord,
  DnsRecordIntent,
  DomainZone,
  ProviderDescriptor,
  ProviderHealth,
} from "../types";
import { DomainControlError } from "../types";
import type { DomainProvider, ProviderWriteResult } from "./base";
import { normalizeName, normalizeTtl } from "./base";

export interface FakeProviderOptions {
  readonly zones?: readonly { id: string; fqdn: string; status?: string }[];
  readonly records?: readonly (DnsRecord & { zoneId: string })[];
  /** Reject the next N mutating calls with PROVIDER_TIMEOUT after applying them. */
  timeoutAfterMutation?: number;
  /** Reject every mutating call with PROVIDER_AUTH_FAILED. */
  failAuth?: boolean;
  /** Number of leading mutating calls that return a transient unavailable error. */
  transientFailures?: number;
}

export class FakeDomainProvider implements DomainProvider {
  private zones = new Map<string, DomainZone>();
  private records = new Map<string, DnsRecord[]>();
  private sequence = 0;
  private timeoutAfterMutation = 0;
  private failAuth = false;
  private transientFailures = 0;

  /** Access log of every (operation, zone) pair, for assertions about call paths. */
  readonly calls: { operation: string; zoneId: string; recordId?: string }[] = [];

  constructor(options: FakeProviderOptions = {}) {
    for (const zone of options.zones ?? [{ id: "1", fqdn: "example.com" }]) {
      this.zones.set(zone.id, {
        id: zone.id,
        fqdn: zone.fqdn,
        label: zone.fqdn.split(".")[0] ?? zone.fqdn,
        status: zone.status ?? "active",
      });
      this.records.set(zone.id, []);
    }
    for (const record of options.records ?? []) {
      const bucket = this.records.get(record.zoneId) ?? [];
      bucket.push({
        id: record.id,
        name: record.name,
        type: record.type,
        content: record.content,
        ttl: record.ttl,
        ...(record.priority === undefined ? {} : { priority: record.priority }),
      });
      this.records.set(record.zoneId, bucket);
    }
    this.timeoutAfterMutation = options.timeoutAfterMutation ?? 0;
    this.failAuth = options.failAuth ?? false;
    this.transientFailures = options.transientFailures ?? 0;
  }

  descriptor(): ProviderDescriptor {
    return {
      id: "fake",
      displayName: "In-memory Fake Provider",
      kind: "fake",
      capabilities: { read: true, write: true, acme: true, asyncWrites: false },
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: "fake",
      reachable: true,
      authenticated: !this.failAuth,
      latencyMs: 0,
      detail: "Fake provider is in-memory and always reachable.",
    };
  }

  private log(operation: string, zoneId: string, recordId?: string): void {
    this.calls.push({ operation, zoneId, ...(recordId === undefined ? {} : { recordId }) });
  }

  private guardAuth(): void {
    if (this.failAuth) {
      throw new DomainControlError("PROVIDER_AUTH_FAILED", "Fake provider rejected the credential.", {
        nextAction: "verify the provider credential",
      });
    }
  }

  /**
   * Apply the mutation FIRST, then simulate the timeout. That ordering is the
   * hazard being modelled: the provider did the work, the caller never learned it,
   * and only a re-read of authoritative state reveals the truth.
   */
  private maybeTimeout(zoneId: string): void {
    if (this.transientFailures > 0) {
      this.transientFailures -= 1;
      throw new DomainControlError(
        "PROVIDER_UNAVAILABLE",
        "Fake provider transient failure before applying the write.",
        { retryable: true, nextAction: "retry the read" },
      );
    }
    if (this.timeoutAfterMutation > 0) {
      this.timeoutAfterMutation -= 1;
      throw new DomainControlError(
        "AMBIGUOUS_MUTATION",
        `Provider response was lost after applying a write to zone ${zoneId}.`,
        { retryable: false, nextAction: "re-read authoritative provider state before retrying" },
      );
    }
  }

  async listZones(): Promise<DomainZone[]> {
    this.log("listZones", "-");
    this.guardAuth();
    return [...this.zones.values()];
  }

  async getZone(zoneId: string): Promise<DomainZone | null> {
    this.log("getZone", zoneId);
    this.guardAuth();
    return this.zones.get(zoneId) ?? null;
  }

  async listRecords(zoneId: string): Promise<DnsRecord[]> {
    this.log("listRecords", zoneId);
    this.guardAuth();
    return [...(this.records.get(zoneId) ?? [])];
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord | null> {
    this.log("getRecord", zoneId, recordId);
    this.guardAuth();
    return (this.records.get(zoneId) ?? []).find((record) => record.id === recordId) ?? null;
  }

  async createRecord(zoneId: string, intent: DnsRecordIntent): Promise<ProviderWriteResult> {
    this.log("createRecord", zoneId);
    this.guardAuth();
    const zone = this.zones.get(zoneId);
    if (!zone) {
      throw new DomainControlError("PROVIDER_UNAVAILABLE", `Unknown zone ${zoneId}.`);
    }
    const bucket = this.records.get(zoneId) ?? [];
    const name = normalizeName(intent.name, zone.fqdn);
    // Mirror the conflict behaviour a real provider exhibits, so conflict handling
    // is exercised in tests rather than discovered in production.
    if (bucket.some((record) => record.name === name && record.type === intent.type && record.content === intent.content)) {
      throw new DomainControlError(
        "RECORD_CONFLICT",
        `A ${intent.type} record for ${name} with identical content already exists.`,
        { nextAction: "re-read records and treat the existing record as the intended state" },
      );
    }
    const created: DnsRecord = {
      id: `rec_${++this.sequence}`,
      name,
      type: intent.type,
      content: intent.content,
      ttl: normalizeTtl(intent.ttl),
      ...(intent.priority === undefined ? {} : { priority: intent.priority }),
    };
    bucket.push(created);
    this.records.set(zoneId, bucket);
    this.maybeTimeout(zoneId);
    return { record: created, raw: created };
  }

  async updateRecord(
    zoneId: string,
    recordId: string,
    intent: DnsRecordIntent,
  ): Promise<ProviderWriteResult> {
    this.log("updateRecord", zoneId, recordId);
    this.guardAuth();
    const zone = this.zones.get(zoneId);
    const bucket = this.records.get(zoneId) ?? [];
    const index = bucket.findIndex((record) => record.id === recordId);
    if (!zone || index < 0) {
      throw new DomainControlError("RECORD_CONFLICT", `Record ${recordId} no longer exists.`, {
        nextAction: "re-read records before retrying",
      });
    }
    const current = bucket[index]!;
    const updated: DnsRecord = {
      id: current.id,
      name: normalizeName(intent.name ?? current.name, zone.fqdn),
      type: intent.type ?? current.type,
      content: intent.content ?? current.content,
      ttl: normalizeTtl(intent.ttl, current.ttl),
      ...(intent.priority === undefined
        ? current.priority === undefined
          ? {}
          : { priority: current.priority }
        : { priority: intent.priority }),
    };
    bucket[index] = updated;
    this.records.set(zoneId, bucket);
    this.maybeTimeout(zoneId);
    return { record: updated, raw: updated };
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<ProviderWriteResult> {
    this.log("deleteRecord", zoneId, recordId);
    this.guardAuth();
    const bucket = this.records.get(zoneId) ?? [];
    const index = bucket.findIndex((record) => record.id === recordId);
    if (index < 0) {
      throw new DomainControlError("RECORD_CONFLICT", `Record ${recordId} no longer exists.`, {
        nextAction: "re-read records; the record may already be gone",
      });
    }
    const [removed] = bucket.splice(index, 1);
    this.records.set(zoneId, bucket);
    this.maybeTimeout(zoneId);
    return { record: removed ?? null };
  }

  async publishAcmeChallenge(
    zoneId: string,
    input: { value: string; name?: string },
  ): Promise<{ token: string }> {
    this.log("publishAcmeChallenge", zoneId);
    this.guardAuth();
    const token = `faketok_${++this.sequence}`;
    const created = await this.createRecord(zoneId, {
      name: input.name ?? "_acme-challenge",
      type: "TXT",
      content: input.value,
      ttl: 60,
    });
    return { token: created.record ? token : token };
  }

  async removeAcmeChallenge(zoneId: string, token: string): Promise<void> {
    this.log("removeAcmeChallenge", zoneId);
    this.guardAuth();
    void token;
  }

  // -- Test helpers --------------------------------------------------------

  /** Direct write used to seed "existing provider state" in a test. */
  seedRecord(zoneId: string, record: Omit<DnsRecord, "id"> & { id?: string }): DnsRecord {
    const bucket = this.records.get(zoneId) ?? [];
    const created: DnsRecord = {
      id: record.id ?? `rec_${++this.sequence}`,
      name: record.name,
      type: record.type,
      content: record.content,
      ttl: record.ttl,
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    };
    bucket.push(created);
    this.records.set(zoneId, bucket);
    return created;
  }

  setFailAuth(value: boolean): void {
    this.failAuth = value;
  }

  setTimeoutAfterMutation(count: number): void {
    this.timeoutAfterMutation = count;
  }
}
