import { describe, expect, test } from "bun:test";
import {
  maskSecret,
  redactSecrets,
  redactDeep,
  describeCredentialState,
  loadDomainControlConfig,
} from "../src/agent-os/domain-control/config";

/**
 * Phase 20.15 section 18 requires that no credential reaches a log line, a UI
 * payload, an MCP result, or a committed file. These tests pin the masking
 * behaviour that everything else relies on.
 */

describe("Phase 20.15 — secret masking", () => {
  test("masks a long credential keeping only a short prefix and suffix", () => {
    const masked = maskSecret("dp_live_abcdefghijklmnop1234");
    expect(masked).toStartWith("dp_l");
    expect(masked).toEndWith("1234");
    expect(masked).toContain("*");
    expect(masked).not.toContain("abcdefghijklmnop");
  });

  test("a short secret reveals no characters at all", () => {
    // Count-the-asterisks must not be a way to recover a short token's length.
    expect(maskSecret("abc123")).toBe("********");
    expect(maskSecret("abc123")).not.toContain("abc");
  });

  test("empty and missing values produce an empty mask, not a fake one", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
    expect(maskSecret(null)).toBe("");
  });

  test("redacts bearer tokens in free text", () => {
    const redacted = redactSecrets("Authorization: Bearer dp_live_abcdef123456789");
    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("dp_live_abcdef123456789");
  });

  test("redacts credential-shaped tokens and query parameters", () => {
    expect(redactSecrets("token sk-abcdefghijklmnop")).not.toContain("sk-abcdefghijklmnop");
    expect(redactSecrets("token ghp_abcdefghijklmnop")).not.toContain("ghp_abcdefghijklmnop");
    const query = redactSecrets("https://api.example.com/v1?api_key=supersecret&x=1");
    expect(query).not.toContain("supersecret");
    expect(query).toContain("x=1");
  });

  test("redacts nested structures by value and by key name", () => {
    const redacted = redactDeep({
      hostname: "dev.example.com",
      headers: { Authorization: "Bearer dp_live_zzzzzzzzzzzzzz" },
      api_key: "plain-value-that-is-not-token-shaped",
      nested: { deeper: { token: "another-plain-value" } },
    }) as Record<string, unknown>;

    expect(redacted.hostname).toBe("dev.example.com");
    expect(JSON.stringify(redacted)).not.toContain("dp_live_zzzzzzzzzzzzzz");
    // Key-name redaction catches values that are not credential-shaped at all.
    expect(JSON.stringify(redacted)).not.toContain("plain-value-that-is-not-token-shaped");
    expect(JSON.stringify(redacted)).not.toContain("another-plain-value");
  });

  test("redactDeep survives a cycle instead of hanging", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(() => redactDeep(cyclic)).not.toThrow();
    expect(JSON.stringify(redactDeep(cyclic))).toContain("circular");
  });
});

describe("Phase 20.15 — configuration defaults", () => {
  test("an empty environment yields a disabled control plane with an empty allowlist", () => {
    const config = loadDomainControlConfig({});
    expect(config.enabled).toBe(false);
    // Deny-by-default: an unconfigured install can mutate nothing.
    expect(config.allowlist).toEqual([]);
    expect(config.requireApproval).toBe(true);
    expect(config.resolvers.length).toBeGreaterThan(1);
  });

  test("allowlist and denylist entries are normalized to lowercase", () => {
    const config = loadDomainControlConfig({
      DOMAIN_CONTROL_ALLOWLIST: "Example.COM, Dev.Example.com",
      DOMAIN_CONTROL_DENYLIST: "Mail.Example.COM",
      DOMAIN_CONTROL_PRODUCTION_ZONES: "Prod.Example.com",
    });
    expect(config.allowlist).toEqual(["example.com", "dev.example.com"]);
    expect(config.denylist).toEqual(["mail.example.com"]);
    expect(config.productionZones).toEqual(["prod.example.com"]);
  });

  test("an invalid numeric setting falls back rather than becoming NaN", () => {
    const config = loadDomainControlConfig({
      DOMAIN_APPROVAL_TTL_MINUTES: "not-a-number",
      DNS_VERIFY_TIMEOUT_SECONDS: "-5",
    });
    expect(Number.isFinite(config.approvalTtlMs)).toBe(true);
    expect(config.verificationTimeoutMs).toBeGreaterThan(0);
  });

  test("credential state reports configured-ness and a mask, never a value", () => {
    const state = describeCredentialState({
      DOMAIN_OSS_API_KEY: "dp_live_abcdefghijklmnop1234",
      CLOUDFLARE_API_TOKEN: "",
    });
    const domainOss = state.find((entry) => entry.providerId === "domain_oss")!;
    const cloudflare = state.find((entry) => entry.providerId === "cloudflare")!;
    expect(domainOss.configured).toBe(true);
    expect(domainOss.masked).not.toContain("abcdefghijklmnop");
    // An unset credential reports configured false rather than pretending a value.
    expect(cloudflare.configured).toBe(false);
    expect(cloudflare.masked).toBe("");
  });
});
