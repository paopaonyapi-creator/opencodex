import { describe, expect, test } from "bun:test";
import {
  absoluteHostname,
  canonicalIntentPayload,
  diffDeletion,
  diffRecords,
  effectiveChanges,
} from "../src/agent-os/domain-control/diff";
import type { DnsRecord, DnsRecordIntent } from "../src/agent-os/domain-control/types";

function record(partial: Partial<DnsRecord> = {}): DnsRecord {
  return { id: "rec_1", name: "dev", type: "A", content: "1.2.3.4", ttl: 300, ...partial };
}

function intent(partial: Partial<DnsRecordIntent> = {}): DnsRecordIntent {
  return { name: "dev", type: "A", content: "203.0.113.10", ttl: 300, ...partial };
}

describe("Phase 20.15 — DNS diff engine", () => {
  test("creates an entry for a record that does not exist", () => {
    const diff = diffRecords([], [intent({ content: "203.0.113.10" })], { zone: "example.com" });
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]!.kind).toBe("create");
    expect(diff.entries[0]!.before).toBeNull();
    expect(diff.entries[0]!.hostname).toBe("dev.example.com");
    expect(diff.empty).toBe(false);
  });

  test("reports an in-place update when content differs", () => {
    const diff = diffRecords([record({ content: "1.2.3.4" })], [intent({ content: "5.6.7.8" })], {
      zone: "example.com",
    });
    expect(diff.entries[0]!.kind).toBe("update");
    expect(diff.entries[0]!.before?.content).toBe("1.2.3.4");
    expect(diff.entries[0]!.after?.content).toBe("5.6.7.8");
    expect(diff.entries[0]!.fields.join(" ")).toContain("content: 1.2.3.4 -> 5.6.7.8");
  });

  test("treats a case-only difference as no change, so apply never churns", () => {
    const diff = diffRecords(
      [record({ name: "DEV", content: "203.0.113.10" })],
      [intent({ name: "dev", content: "203.0.113.10" })],
      { zone: "example.com" },
    );
    expect(diff.entries[0]!.kind).toBe("noop");
    expect(diff.empty).toBe(true);
    expect(effectiveChanges(diff)).toHaveLength(0);
  });

  test("reports a TTL-only change as an update with the field named", () => {
    const diff = diffRecords(
      [record({ content: "203.0.113.10", ttl: 300 })],
      [intent({ content: "203.0.113.10", ttl: 600 })],
      { zone: "example.com" },
    );
    expect(diff.entries[0]!.kind).toBe("update");
    expect(diff.entries[0]!.fields).toEqual(["ttl: 300 -> 600"]);
  });

  test("applies the default TTL so an omitted TTL is explicit in the diff", () => {
    // ttl omitted deliberately: the helper's default must not mask the behaviour.
    const diff = diffRecords([], [{ name: "dev", type: "A", content: "203.0.113.10" }], {
      zone: "example.com",
      defaultTtl: 120,
    });
    expect(diff.entries[0]!.after?.ttl).toBe(120);
  });

  test("matches a specific record id when several share name and type", () => {
    const observed = [
      record({ id: "rec_a", content: "1.1.1.1" }),
      record({ id: "rec_b", content: "2.2.2.2" }),
    ];
    const diff = diffRecords(observed, [intent({ id: "rec_b", content: "9.9.9.9" })], {
      zone: "example.com",
    });
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]!.kind).toBe("update");
    expect(diff.entries[0]!.before?.id).toBe("rec_b");
  });

  test("reports a create when the addressed record id is absent, without guessing", () => {
    const diff = diffRecords([record({ id: "rec_a" })], [intent({ id: "rec_missing", content: "9.9.9.9" })], {
      zone: "example.com",
    });
    expect(diff.entries[0]!.kind).toBe("create");
    expect(diff.entries[0]!.fields.join(" ")).toContain("addressed record rec_missing not found");
  });

  test("describes a deletion with the doomed record, not an opaque action", () => {
    const diff = diffDeletion(record({ content: "1.2.3.4" }), "example.com");
    expect(diff.counts.delete).toBe(1);
    expect(diff.entries[0]!.before?.content).toBe("1.2.3.4");
    expect(diff.entries[0]!.after).toBeNull();
  });

  test("counts every kind and never marks a diff with changes as empty", () => {
    const diff = diffRecords(
      [record({ id: "rec_1", content: "1.2.3.4" }), record({ id: "rec_2", name: "old", content: "1.1.1.1" })],
      [intent({ content: "5.6.7.8" }), intent({ name: "new", content: "203.0.113.1" })],
      { zone: "example.com" },
    );
    expect(diff.counts.update).toBe(1);
    expect(diff.counts.create).toBe(1);
    expect(diff.empty).toBe(false);
  });

  test("builds an absolute hostname for apex and subdomain owners", () => {
    expect(absoluteHostname("@", "example.com")).toBe("example.com");
    expect(absoluteHostname("www", "example.com")).toBe("www.example.com");
    expect(absoluteHostname("", "example.com")).toBe("example.com");
  });

  test("canonical payload is order-insensitive but content-sensitive", () => {
    const a = canonicalIntentPayload([intent({ name: "b" }), intent({ name: "a" })]);
    const b = canonicalIntentPayload([intent({ name: "a" }), intent({ name: "b" })]);
    expect(a).toBe(b);
    expect(a).not.toBe(canonicalIntentPayload([intent({ name: "a" })]));
  });
});
