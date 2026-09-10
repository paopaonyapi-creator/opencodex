import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDomainControlRoutes } from "../src/server/management/domain-control-routes";
import type { ManagementContext } from "../src/server/management/context";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { resetDomainControl } from "../src/agent-os/domain-control";

let home: string;
const originalHome = process.env.OPENCODEX_HOME;
const originalAllowlist = process.env.DOMAIN_CONTROL_ALLOWLIST;
const originalProvider = process.env.DOMAIN_DEFAULT_PROVIDER;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dc-routes-test-"));
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

function ctx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:10100${path}`);
  const headers = new Headers({ "content-type": "application/json" });
  const req = new Request(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { req, url, config: {} as never, configActions: {} as never } as unknown as ManagementContext;
}

describe("Phase 20.15 — domain control management routes", () => {
  test("returns null for an unrelated path so the dispatcher can continue", async () => {
    expect(await handleDomainControlRoutes(ctx("/api/unrelated"))).toBeNull();
  });

  test("GET overview reports configuration posture and masked credentials", async () => {
    process.env.DOMAIN_OSS_API_KEY = "dp_live_zzzzzzzzzzzzzzzz";
    try {
      const response = await handleDomainControlRoutes(ctx("/api/agent-os/domains"));
      expect(response!.status).toBe(200);
      const body = (await response!.json()) as Record<string, unknown>;
      expect(body.requireApproval).toBe(true);
      expect(body.proxyConfigured).toBe(false);
      // The credential value must not appear anywhere in the payload.
      expect(JSON.stringify(body)).not.toContain("dp_live_zzzzzzzzzzzzzzzz");
    } finally {
      delete process.env.DOMAIN_OSS_API_KEY;
    }
  });

  test("GET zones applies the allowlist verdict", async () => {
    const response = await handleDomainControlRoutes(ctx("/api/agent-os/domains/zones"));
    const body = (await response!.json()) as { zones: { fqdn: string; allowlisted: boolean }[] };
    expect(body.zones[0]!.fqdn).toBe("example.com");
    expect(body.zones[0]!.allowlisted).toBe(true);
  });

  test("GET records requires a hostname", async () => {
    const response = await handleDomainControlRoutes(ctx("/api/agent-os/domains/records"));
    expect(response!.status).toBe(400);
  });

  test("GET records returns the zone and its records", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records?hostname=dev.example.com"),
    );
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { zone: string; records: unknown[] };
    expect(body.zone).toBe("example.com");
    expect(Array.isArray(body.records)).toBe(true);
  });

  test("GET records/diff computes a diff without writing", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records/diff?hostname=dev.example.com&name=dev&type=A&content=203.0.113.10"),
    );
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { diff: { counts: { create: number } } };
    expect(body.diff.counts.create).toBe(1);
  });

  test("an unallowlisted hostname is refused with 403", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records?hostname=evil.other.com"),
    );
    expect(response!.status).toBe(403);
    const body = (await response!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  test("POST records from an unapproved agent requests approval rather than writing", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records", "POST", {
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
      }),
    );
    expect(response!.status).toBe(202);
    const body = (await response!.json()) as { outcome: { status: string } };
    expect(body.outcome.status).toBe("approval_required");
  });

  test("POST records with dry_run returns a preview", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records", "POST", {
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        dry_run: true,
      }),
    );
    expect(response!.status).toBe(202);
    const body = (await response!.json()) as { outcome: { status: string; approvalRequired: boolean } };
    expect(body.outcome.status).toBe("dry_run");
    expect(body.outcome.approvalRequired).toBe(true);
  });

  test("approvals can be listed and decided, and a second decision is refused", async () => {
    await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records", "POST", {
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
      }),
    );
    const listed = await handleDomainControlRoutes(ctx("/api/agent-os/domains/approvals?status=pending"));
    const listBody = (await listed!.json()) as { approvals: { id: string }[] };
    expect(listBody.approvals.length).toBeGreaterThan(0);
    const approvalId = listBody.approvals[0]!.id;

    const decided = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/approvals/decide", "POST", {
        approval_id: approvalId,
        decision: "grant",
      }),
    );
    expect(decided!.status).toBe(200);
    const decidedBody = (await decided!.json()) as { approval: { status: string } };
    expect(decidedBody.approval.status).toBe("granted");

    const again = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/approvals/decide", "POST", {
        approval_id: approvalId,
        decision: "deny",
      }),
    );
    expect(again!.status).toBe(409);
  });

  test("a granted approval lets the write through and it is audited", async () => {
    await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records", "POST", {
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        request_id: "route-apply",
      }),
    );
    const listed = await handleDomainControlRoutes(ctx("/api/agent-os/domains/approvals?status=pending"));
    const approvalId = ((await listed!.json()) as { approvals: { id: string }[] }).approvals[0]!.id;
    await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/approvals/decide", "POST", {
        approval_id: approvalId,
        decision: "grant",
      }),
    );
    const applied = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/records", "POST", {
        hostname: "dev.example.com",
        name: "dev",
        type: "A",
        content: "203.0.113.10",
        approval_id: approvalId,
        request_id: "route-apply",
      }),
    );
    expect(applied!.status).toBe(200);
    const body = (await applied!.json()) as { outcome: { status: string } };
    expect(body.outcome.status).toBe("applied");

    const audit = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/audit?request_id=route-apply"),
    );
    const auditBody = (await audit!.json()) as { events: unknown[] };
    expect(auditBody.events.length).toBeGreaterThan(0);
  });

  test("POST deployment/plan refuses a private target", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/deployment/plan", "POST", {
        hostname: "browser.example.com",
        target_ip: "169.254.169.254",
        target_port: 3000,
      }),
    );
    expect(response!.status).toBe(403);
  });

  test("POST deployment/detach requires an approval", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/deployment/detach", "POST", {
        hostname: "browser.example.com",
      }),
    );
    expect(response!.status).toBe(202);
    const body = (await response!.json()) as { result: { status: string } };
    expect(body.result.status).toBe("approval_required");
  });

  test("an unknown sub-path returns 404 rather than a wrong handler's answer", async () => {
    const response = await handleDomainControlRoutes(
      ctx("/api/agent-os/domains/does-not-exist"),
    );
    expect(response!.status).toBe(404);
  });

  test("GET providers lists descriptors with masked credential state", async () => {
    const response = await handleDomainControlRoutes(ctx("/api/agent-os/domains/providers"));
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { providers: { id: string }[] };
    expect(body.providers.map((entry) => entry.id)).toContain("fake");
  });
});
