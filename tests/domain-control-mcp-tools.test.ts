import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DOMAIN_CONTROL_MCP_TOOLS } from "../src/agent-os/domain-control/mcp-tools";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { resetDomainControl, getDomainControlService } from "../src/agent-os/domain-control";
import { FakeDomainProvider } from "../src/agent-os/domain-control/providers/fake";
import { InMemoryProviderRegistry } from "../src/agent-os/domain-control/service";

let home: string;
const originalHome = process.env.OPENCODEX_HOME;
const originalAllowlist = process.env.DOMAIN_CONTROL_ALLOWLIST;
const originalProvider = process.env.DOMAIN_DEFAULT_PROVIDER;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dc-mcp-test-"));
  process.env.OPENCODEX_HOME = home;
  process.env.DOMAIN_CONTROL_ALLOWLIST = "example.com";
  process.env.DOMAIN_DEFAULT_PROVIDER = "fake";
  resetDomainControl();
});

afterEach(() => {
  resetDomainControl();
  closeAgentOsDbForTests();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  if (originalAllowlist === undefined) delete process.env.DOMAIN_CONTROL_ALLOWLIST;
  else process.env.DOMAIN_CONTROL_ALLOWLIST = originalAllowlist;
  if (originalProvider === undefined) delete process.env.DOMAIN_DEFAULT_PROVIDER;
  else process.env.DOMAIN_DEFAULT_PROVIDER = originalProvider;
  rmSync(home, { recursive: true, force: true });
});

function tool(name: string) {
  const found = DOMAIN_CONTROL_MCP_TOOLS.find((entry) => entry.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}

function parse(result: unknown): Record<string, unknown> {
  return JSON.parse(String(result)) as Record<string, unknown>;
}

describe("Phase 20.15 — MCP tool surface", () => {
  test("every tool has a name, a description, a schema, and a handler", () => {
    expect(DOMAIN_CONTROL_MCP_TOOLS.length).toBeGreaterThan(20);
    for (const entry of DOMAIN_CONTROL_MCP_TOOLS) {
      expect(entry.name.length).toBeGreaterThan(3);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.inputSchema.type).toBe("object");
      expect(typeof entry.handler).toBe("function");
      expect(["R0", "R1", "R2", "R3", "R4"]).toContain(entry.riskTier);
    }
  });

  test("tool names are unique", () => {
    const names = DOMAIN_CONTROL_MCP_TOOLS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the spec's domain, dns, ssl, and deployment surfaces are all present", () => {
    const names = new Set(DOMAIN_CONTROL_MCP_TOOLS.map((entry) => entry.name));
    for (const required of [
      "domain_list",
      "domain_get",
      "domain_status",
      "domain_nameservers",
      "domain_provider",
      "domain_health",
      "dns_list_zones",
      "dns_list_records",
      "dns_get_record",
      "dns_resolve",
      "dns_diff",
      "dns_check_propagation",
      "dns_create_record",
      "dns_update_record",
      "dns_delete_record",
      "dns_restore_record",
      "ssl_status",
      "ssl_inspect",
      "ssl_request",
      "ssl_verify",
      "deployment_plan",
      "deployment_list",
      "deployment_get",
      "deployment_attach_domain",
      "deployment_detach_domain",
      "deployment_check_route",
      "deployment_health",
    ]) {
      expect(names).toContain(required);
    }
  });

  test("read-only tools are marked read-only and mutating tools are not", () => {
    expect(tool("domain_list").readOnly).toBe(true);
    expect(tool("dns_list_records").readOnly).toBe(true);
    expect(tool("dns_diff").readOnly).toBe(true);
    expect(tool("dns_create_record").readOnly).toBe(false);
    expect(tool("dns_delete_record").readOnly).toBe(false);
    expect(tool("deployment_attach_domain").readOnly).toBe(false);
  });

  test("every mutating tool accepts the dry_run/approval envelope", () => {
    for (const entry of DOMAIN_CONTROL_MCP_TOOLS.filter((it) => !it.readOnly)) {
      const props = entry.inputSchema.properties;
      expect(props.dry_run, entry.name).toBeDefined();
      expect(props.approval_id, entry.name).toBeDefined();
      expect(props.request_id, entry.name).toBeDefined();
      expect(props.idempotency_key, entry.name).toBeDefined();
      expect(props.reason, entry.name).toBeDefined();
    }
  });
});

describe("Phase 20.15 — MCP tools go through the pipeline", () => {
  test("dns_diff is read-only and reports the diff without writing", async () => {
    const result = parse(
      await tool("dns_diff").handler({
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
      }),
    );
    expect(result.ok).toBe(true);
    const diff = result.diff as { counts: { create: number } };
    expect(diff.counts.create).toBe(1);
  });

  test("dns_create_record from an agent defaults to no write", async () => {
    const result = parse(
      await tool("dns_create_record").handler({
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
      }),
    );
    const outcome = result.outcome as { status: string };
    expect(outcome.status).toBe("approval_required");
  });

  test("dns_create_record with dry_run reports a diff and requires no approval row", async () => {
    const result = parse(
      await tool("dns_create_record").handler({
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        dry_run: true,
      }),
    );
    const outcome = result.outcome as { status: string; approvalRequired: boolean };
    expect(outcome.status).toBe("dry_run");
    expect(outcome.approvalRequired).toBe(true);
  });

  test("a mutation outside the allowlist is refused by the tool", async () => {
    const result = parse(
      await tool("dns_create_record").handler({
        hostname: "evil.other.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        actor: "user",
      }),
    );
    const outcome = result.outcome as { error?: { code: string } };
    expect(outcome.error?.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  test("SSRF target validation is reachable as a tool", async () => {
    const good = parse(await tool("domain_validate_target").handler({ target_ip: "203.0.113.10" }));
    expect(good.acceptable).toBe(true);

    const bad = parse(await tool("domain_validate_target").handler({ target_ip: "169.254.169.254" }));
    expect(bad.ok).toBe(true);
    expect(bad.acceptable).toBe(false);
    expect((bad.error as { code: string }).code).toBe("VALIDATION_FAILED");
  });

  test("domain_mask_secret never returns the input value", async () => {
    const result = parse(await tool("domain_mask_secret").handler({ value: "dp_live_abcdefghijklmnop" }));
    expect(String(result.masked)).not.toContain("abcdefghijklmnop");
  });

  test("domain_provider reports credential state masked, never a value", async () => {
    process.env.DOMAIN_OSS_API_KEY = "dp_live_zzzzzzzzzzzzzzzz";
    try {
      const result = parse(await tool("domain_provider").handler({}));
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("dp_live_zzzzzzzzzzzzzzzz");
      const credentials = result.credentials as { providerId: string; masked: string }[];
      expect(credentials.find((entry) => entry.providerId === "domain_oss")!.masked).not.toContain(
        "zzzzzzzzzzzzzzzz",
      );
    } finally {
      delete process.env.DOMAIN_OSS_API_KEY;
    }
  });

  test("domain_list_approvals and domain_audit_log return structured payloads", async () => {
    await tool("dns_create_record").handler({
      hostname: "dev.example.com",
      name: "dev",
      type: "A",
      content: "203.0.113.10",
    });
    const approvals = parse(await tool("domain_list_approvals").handler({}));
    expect(Array.isArray(approvals.approvals)).toBe(true);

    const audit = parse(await tool("domain_audit_log").handler({ limit: 20 }));
    expect(Array.isArray(audit.events)).toBe(true);
  });

  test("domain_metrics derives counters from the audit trail", async () => {
    await tool("dns_create_record").handler({
      hostname: "dev.example.com",
      name: "dev",
      type: "A",
      content: "203.0.113.10",
      dry_run: true,
    });
    const result = parse(await tool("domain_metrics").handler({}));
    const metrics = result.metrics as Record<string, number>;
    expect(metrics.domain_operations_total).toBeGreaterThan(0);
  });

  test("deployment_check_route reports unavailability honestly when no proxy is set", async () => {
    const result = parse(await tool("deployment_check_route").handler({ hostname: "dev.example.com" }));
    expect(result.available).toBe(false);
    expect(String(result.detail)).toContain("CADDY_ADMIN_URL");
  });
});

describe("Phase 20.15 — fake provider rehearsal path", () => {
  test("a full approved write against the fake provider settles and is audited", async () => {
    // Register a fake provider whose zone matches the allowlist, then walk the same
    // request/approve/apply path an operator would.
    const service = getDomainControlService();
    const registry = new InMemoryProviderRegistry();
    registry.register(new FakeDomainProvider());
    void registry;

    const request = parse(
      await tool("dns_create_record").handler({
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        request_id: "rehearsal-1",
      }),
    );
    const approvalId = (request.outcome as { approval: { id: string } }).approval.id;
    service.decideApproval(approvalId, "grant", "pao");

    const applied = parse(
      await tool("dns_create_record").handler({
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        approval_id: approvalId,
        request_id: "rehearsal-1",
      }),
    );
    const outcome = applied.outcome as { status: string; verification: { settled: boolean } };
    expect(outcome.status).toBe("applied");
    expect(outcome.verification.settled).toBe(true);

    const audit = parse(await tool("domain_audit_log").handler({ requestId: "rehearsal-1" }));
    expect((audit.events as unknown[]).length).toBeGreaterThan(0);
  });
});
