// Phase 20.15 — Domain Control Plane: intended-state diff engine.
//
// Pure functions over observed and intended records. Kept free of provider and
// database access so the diff shown to an approver is computed from exactly the
// data the executor will use, and so it can be asserted without a network or a
// database handle.

import {
  type DnsDiff,
  type DnsDiffEntry,
  type DnsRecord,
  type DnsRecordIntent,
  type DnsRecordType,
  type DnsChangeKind,
} from "./types";

/** Case-insensitive record identity: (name, type, content). */
function contentKey(record: { name: string; type: DnsRecordType; content: string }): string {
  return `${record.name.toLowerCase()}|${record.type}|${record.content.trim().toLowerCase()}`;
}

/** Case-insensitive record address: (name, type). */
function addressKey(record: { name: string; type: DnsRecordType }): string {
  return `${record.name.toLowerCase()}|${record.type}`;
}

function toIntent(record: DnsRecord): DnsRecordIntent {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    content: record.content,
    ttl: record.ttl,
    ...(record.priority === undefined ? {} : { priority: record.priority }),
  };
}

/** Absolute hostname for an owner name relative to a zone. */
export function absoluteHostname(name: string, zone: string): string {
  const n = name.trim();
  if (n === "@" || n === "") return zone;
  return `${n}.${zone}`;
}

export interface DiffOptions {
  readonly zone: string;
  /** TTL applied when an intent omits one; compared explicitly so it shows as a change. */
  readonly defaultTtl?: number;
}

/**
 * Compare the zone's observed records against an intended record.
 *
 * Output is one entry per effective change:
 *  - same (name, type, content)  -> noop, unless TTL or priority differs
 *  - same (name, type)           -> update
 *  - intent with neither         -> create
 *  - observed with no intent     -> delete (only when explicitly requested)
 *
 * Matching is case-insensitive on name, type, and content because DNS is, and a
 * case-only difference reported as a change would produce a churn loop where every
 * apply looks like a modification and every verification looks like drift.
 */
export function diffRecords(
  observed: readonly DnsRecord[],
  intents: readonly DnsRecordIntent[],
  options: DiffOptions,
): DnsDiff {
  const { zone } = options;
  const defaultTtl = options.defaultTtl ?? 300;
  const entries: DnsDiffEntry[] = [];

  const observedByContent = new Map<string, DnsRecord>();
  const observedByAddress = new Map<string, DnsRecord[]>();
  for (const record of observed) {
    observedByContent.set(contentKey(record), record);
    const key = addressKey(record);
    const bucket = observedByAddress.get(key);
    if (bucket) bucket.push(record);
    else observedByAddress.set(key, [record]);
  }

  for (const intent of intents) {
    const hostname = absoluteHostname(intent.name, zone);
    const exact = observedByContent.get(contentKey(intent));
    const wantedTtl = intent.ttl ?? defaultTtl;

    if (exact) {
      const fields: string[] = [];
      if (exact.ttl !== wantedTtl) fields.push(`ttl: ${exact.ttl} -> ${wantedTtl}`);
      if ((exact.priority ?? null) !== (intent.priority ?? null)) {
        fields.push(`priority: ${exact.priority ?? "-"} -> ${intent.priority ?? "-"}`);
      }
      entries.push({
        kind: fields.length === 0 ? "noop" : "update",
        hostname,
        name: intent.name,
        type: intent.type,
        before: toIntent(exact),
        after: { ...intent, id: exact.id, ttl: wantedTtl },
        fields,
      });
      continue;
    }

    // Same name+type but different content is an in-place update.
    //
    // The address fallback is used ONLY when the caller did not name a record id.
    // When a caller DID name one and it is absent, retargeting the update onto
    // whatever record happens to sit at that address would silently overwrite a
    // record nobody identified — the caller believed they were editing rec_a and
    // the write would land on rec_b. That case falls through to the create branch
    // below, which reports the discrepancy instead of acting on the wrong record.
    const sameAddress = observedByAddress.get(addressKey(intent)) ?? [];
    const candidate = intent.id
      ? sameAddress.find((r) => r.id === intent.id)
      : sameAddress.length === 1
        ? sameAddress[0]
        : undefined;
    if (candidate) {
      const fields: string[] = [];
      if (candidate.content.trim().toLowerCase() !== intent.content.trim().toLowerCase()) {
        fields.push(`content: ${candidate.content} -> ${intent.content}`);
      }
      if (candidate.ttl !== wantedTtl) fields.push(`ttl: ${candidate.ttl} -> ${wantedTtl}`);
      if ((candidate.priority ?? null) !== (intent.priority ?? null)) {
        fields.push(`priority: ${candidate.priority ?? "-"} -> ${intent.priority ?? "-"}`);
      }
      entries.push({
        kind: "update",
        hostname,
        name: intent.name,
        type: intent.type,
        before: toIntent(candidate),
        after: { ...intent, id: candidate.id, ttl: wantedTtl },
        fields,
      });
      continue;
    }

    if (intent.id) {
      // The caller named a record that is not there. Reported as a create so the
      // approver sees the intent, and the executor refuses rather than silently
      // creating a second record at an address the caller believed was unique.
      entries.push({
        kind: "create",
        hostname,
        name: intent.name,
        type: intent.type,
        before: null,
        after: { ...intent, ttl: wantedTtl },
        fields: [`addressed record ${intent.id} not found; would create`],
      });
      continue;
    }

    entries.push({
      kind: "create",
      hostname,
      name: intent.name,
      type: intent.type,
      before: null,
      after: { ...intent, ttl: wantedTtl },
      fields: ["new record"],
    });
  }

  const counts = countKinds(entries);
  return {
    zone,
    entries,
    empty: entries.every((entry) => entry.kind === "noop"),
    counts,
  };
}

/**
 * Diff a deletion: the entry describes what would be removed, so an approver sees
 * the doomed record rather than an opaque "delete" action.
 */
export function diffDeletion(record: DnsRecord, zone: string): DnsDiff {
  const entry: DnsDiffEntry = {
    kind: "delete",
    hostname: absoluteHostname(record.name, zone),
    name: record.name,
    type: record.type,
    before: toIntent(record),
    after: null,
    fields: ["record removed"],
  };
  return { zone, entries: [entry], empty: false, counts: countKinds([entry]) };
}

export function countKinds(entries: readonly DnsDiffEntry[]): Record<DnsChangeKind, number> {
  const counts: Record<DnsChangeKind, number> = { create: 0, update: 0, delete: 0, noop: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** Effective (non-noop) entries only. */
export function effectiveChanges(diff: DnsDiff): readonly DnsDiffEntry[] {
  return diff.entries.filter((entry) => entry.kind !== "noop");
}

/** Canonical JSON payload used for idempotency payload hashing. */
export function canonicalIntentPayload(intents: readonly DnsRecordIntent[]): string {
  const normalized = intents
    .map((intent) => ({
      id: intent.id ?? null,
      name: intent.name.toLowerCase(),
      type: intent.type,
      content: intent.content.trim(),
      ttl: intent.ttl ?? null,
      priority: intent.priority ?? null,
    }))
    .sort((a, b) => `${a.name}|${a.type}|${a.content}`.localeCompare(`${b.name}|${b.type}|${b.content}`));
  return JSON.stringify(normalized);
}
