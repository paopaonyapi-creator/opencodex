import { describe, expect, test } from "bun:test";
import {
  classifyRecordRisk,
  checkAllowlist,
  assertAllowed,
  isWithinZone,
  normalizeHostname,
  zoneOf,
  PROTECTED_HOSTNAMES,
} from "../src/agent-os/domain-control/policy";
import { DomainControlError, type DnsRecordIntent } from "../src/agent-os/domain-control/types";

function intent(partial: Partial<DnsRecordIntent> = {}): DnsRecordIntent {
  return { name: "dev", type: "A", content: "203.0.113.10", ...partial };
}

describe("Phase 20.15 — hostname validation", () => {
  test("normalizes case and trailing dot", () => {
    expect(normalizeHostname("WWW.Example.COM.").fqdn).toBe("www.example.com");
    expect(normalizeHostname("browser.example.com").labels).toEqual([
      "browser",
      "example",
      "com",
    ]);
  });

  test("flags wildcard owners instead of treating them as ordinary names", () => {
    expect(normalizeHostname("*.dev.example.com").wildcard).toBe(true);
    expect(normalizeHostname("dev.example.com").wildcard).toBe(false);
  });

  test("rejects URL-shaped input rather than silently normalizing it", () => {
    // A scheme in the input is how an allowlist check gets bypassed if the code
    // "helpfully" strips it.
    expect(() => normalizeHostname("https://evil.com")).toThrow(DomainControlError);
    expect(() => normalizeHostname("evil.com/path")).toThrow(DomainControlError);
    // The at-sign is the point: a value carrying credentials must never be treated
    // as a hostname. Built from parts so the literal is not itself an address.
    expect(() => normalizeHostname(`user${"@"}evil.example`)).toThrow(DomainControlError);
    expect(() => normalizeHostname("evil.com;whoami")).toThrow(DomainControlError);
    expect(() => normalizeHostname("evil.com\n2")).toThrow(DomainControlError);
  });

  test("rejects a single-label name and an over-long label", () => {
    expect(() => normalizeHostname("localhost")).toThrow(DomainControlError);
    expect(() => normalizeHostname(`${"a".repeat(64)}.com`)).toThrow(DomainControlError);
  });

  test("derives a zone and matches it boundary-sensitively", () => {
    expect(zoneOf("a.b.example.com")).toBe("example.com");
    expect(isWithinZone("www.example.com", "example.com")).toBe(true);
    expect(isWithinZone("example.com", "example.com")).toBe(true);
    // The suffix-confusion case: notexample.com must NOT match example.com.
    expect(isWithinZone("notexample.com", "example.com")).toBe(false);
    expect(isWithinZone("sub.notexample.com", "example.com")).toBe(false);
  });
});

describe("Phase 20.15 — domain allowlist", () => {
  test("denies everything when the allowlist is empty", () => {
    const decision = checkAllowlist("dev.example.com", []);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("empty");
  });

  test("admits a subdomain of an allowlisted zone but not a lookalike", () => {
    expect(checkAllowlist("dev.example.com", ["example.com"]).allowed).toBe(true);
    expect(checkAllowlist("notexample.com", ["example.com"]).allowed).toBe(false);
    expect(checkAllowlist("example.com.evil.com", ["example.com"]).allowed).toBe(false);
  });

  test("denylist wins over an allowlist entry", () => {
    const decision = checkAllowlist("mail.example.com", ["example.com"], ["mail.example.com"]);
    expect(decision.allowed).toBe(false);
    expect(decision.matchedDenyEntry).toBe("mail.example.com");
  });

  test("assertAllowed raises DOMAIN_NOT_ALLOWED with a next action", () => {
    try {
      assertAllowed("random-third-party.com", ["example.com"]);
      throw new Error("expected assertAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainControlError);
      const typed = error as DomainControlError;
      expect(typed.code).toBe("DOMAIN_NOT_ALLOWED");
      expect(typed.nextAction).toContain("DOMAIN_CONTROL_ALLOWLIST");
    }
  });
});

describe("Phase 20.15 — risk classification", () => {
  const base = { hostname: "dev.example.com", production: false, apex: false } as const;

  test("escalates NS to critical", () => {
    const risk = classifyRecordRisk({
      ...base,
      intent: intent({ type: "NS", content: "ns1.other.com" }),
      operation: "create",
    });
    expect(risk.level).toBe("critical");
    expect(risk.matchedRules).toContain("record.ns");
    expect(risk.approvalMode).toBe("MANUAL_CRITICAL");
  });

  test("escalates MX to critical", () => {
    const risk = classifyRecordRisk({
      ...base,
      intent: intent({ type: "MX", content: "10 mail.example.com" }),
      operation: "create",
    });
    expect(risk.level).toBe("critical");
    expect(risk.matchedRules).toContain("record.mx");
  });

  test("escalates the apex and wildcard owners", () => {
    const apex = classifyRecordRisk({
      ...base,
      intent: intent({ name: "@" }),
      apex: true,
      operation: "create",
    });
    expect(apex.matchedRules).toContain("hostname.apex");
    expect(apex.level).toBe("critical");

    const wildcard = classifyRecordRisk({
      ...base,
      intent: intent({ name: "*" }),
      operation: "create",
    });
    expect(wildcard.matchedRules).toContain("hostname.wildcard");
    expect(wildcard.level).toBe("critical");
  });

  test("escalates deletions above plain updates", () => {
    const del = classifyRecordRisk({ ...base, intent: intent(), operation: "delete" });
    const upd = classifyRecordRisk({ ...base, intent: intent(), operation: "update" });
    expect(del.level).toBe("critical");
    expect(del.matchedRules).toContain("mutation.delete");
    expect(upd.level).toBe("medium");
    expect(upd.matchedRules).toContain("mutation.update");
  });

  test("escalates mail-authentication TXT records", () => {
    const spf = classifyRecordRisk({
      ...base,
      intent: intent({ type: "TXT", content: "v=spf1 include:_spf.example.com ~all" }),
      operation: "create",
    });
    expect(spf.matchedRules).toContain("record.mail_auth");
    expect(spf.level).toBe("high");
  });

  test("escalates protected service hostnames", () => {
    for (const name of ["www", "mail", "_dmarc"]) {
      const risk = classifyRecordRisk({
        ...base,
        intent: intent({ name }),
        operation: "create",
      });
      expect(risk.matchedRules).toContain("hostname.protected");
    }
    expect(PROTECTED_HOSTNAMES).toContain("mail");
  });

  test("escalates out-of-scope record types and production zones", () => {
    const caa = classifyRecordRisk({
      ...base,
      intent: intent({ type: "CAA", content: '0 issue "letsencrypt.org"' }),
      operation: "create",
    });
    expect(caa.matchedRules).toContain("record.caa");
    expect(caa.matchedRules).toContain("record.out_of_scope_type");

    const prod = classifyRecordRisk({
      ...base,
      hostname: "app.prod-example.com",
      production: true,
      intent: intent(),
      operation: "create",
    });
    expect(prod.matchedRules).toContain("environment.production");
    expect(prod.level).toBe("high");
  });

  test("every mutating classification demands approval", () => {
    const risk = classifyRecordRisk({ ...base, intent: intent(), operation: "create" });
    expect(risk.requiresApproval).toBe(true);
    expect(risk.approvalMode).toBe("MANUAL_MUTATION");
    expect(risk.reasons.length).toBeGreaterThan(0);
  });
});
