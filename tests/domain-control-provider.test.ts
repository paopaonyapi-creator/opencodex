import { describe, expect, test } from "bun:test";
import { DomainOssProvider } from "../src/agent-os/domain-control/providers/domain-oss";
import { DomainControlError } from "../src/agent-os/domain-control/types";

/**
 * Adapter contract tests against a STUBBED transport.
 *
 * No socket is opened: the endpoint shapes asserted here were read from upstream
 * source (domain_oss/routes/api.py), so a change in this adapter that would drift
 * from the real API fails here rather than in production.
 */

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

function stubFetch(
  handler: (call: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("Authorization"),
    };
    calls.push(call);
    const result = await handler(call);
    return new Response(result.body === undefined ? "" : JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Phase 20.15 — Domain-OSS adapter", () => {
  test("lists domains from the documented data envelope", async () => {
    const { impl, calls } = stubFetch(() => ({
      status: 200,
      body: {
        data: [
          { id: 1, name: "Example.COM", label: "example", status: "active", zone: "example.com" },
        ],
        meta: { page: 1, per_page: 50, total: 1, pages: 1 },
      },
    }));
    const provider = new DomainOssProvider({
      baseUrl: "https://domains.example.org/",
      apiKey: () => "dp_live_test",
      fetchImpl: impl,
    });
    const zones = await provider.listZones();
    expect(zones).toHaveLength(1);
    expect(zones[0]!.fqdn).toBe("example.com");
    expect(zones[0]!.id).toBe("1");
    // Trailing slash normalized exactly once, and the bearer token attached.
    expect(calls[0]!.url).toBe("https://domains.example.org/api/v1/domains?per_page=100");
    expect(calls[0]!.authorization).toBe("Bearer dp_live_test");
  });

  test("maps the record shape, including priority and a default TTL", async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        data: [
          { id: 7, name: "@", type: "MX", content: "mail.example.com", ttl: 3600, priority: 10 },
          { id: 8, name: "www", type: "A", content: "203.0.113.10" },
        ],
      },
    }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: impl,
    });
    const records = await provider.listRecords("1");
    expect(records[0]!.priority).toBe(10);
    // An absent TTL becomes the documented default rather than 0 or undefined.
    expect(records[1]!.ttl).toBe(300);
  });

  test("marks create as pending because upstream writes are asynchronous", async () => {
    const { impl, calls } = stubFetch(() => ({
      status: 201,
      body: {
        data: { id: 9, name: "dev", type: "A", content: "203.0.113.10", ttl: 300 },
        job_id: "job_42",
        sync_status: "queued",
      },
    }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: impl,
    });
    const result = await provider.createRecord("1", {
      name: "dev",
      type: "A",
      content: "203.0.113.10",
      ttl: 300,
    });
    expect(result.jobId).toBe("job_42");
    // The write is not settled when this returns; the service must re-read.
    expect(result.pending).toBe(true);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://x.test/api/v1/domains/1/records");
  });

  test("uses PATCH for updates and reports the upstream jobs array", async () => {
    const { impl, calls } = stubFetch(() => ({
      status: 200,
      body: { data: { id: 9, name: "dev", type: "A", content: "5.6.7.8", ttl: 300 }, jobs: ["job_9"] },
    }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: impl,
    });
    const result = await provider.updateRecord("1", "9", {
      name: "dev",
      type: "A",
      content: "5.6.7.8",
    });
    expect(calls[0]!.method).toBe("PATCH");
    expect(result.jobId).toBe("job_9");
  });

  test("treats a 204 delete as success", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 204 }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: impl,
    });
    const result = await provider.deleteRecord("1", "9");
    expect(calls[0]!.method).toBe("DELETE");
    expect(result.record).toBeNull();
  });

  test("maps upstream error codes onto the standardized model", async () => {
    const cases: { status: number; expected: string }[] = [
      { status: 401, expected: "PROVIDER_AUTH_FAILED" },
      { status: 403, expected: "PROVIDER_AUTH_FAILED" },
      { status: 409, expected: "RECORD_CONFLICT" },
      { status: 404, expected: "VALIDATION_FAILED" },
      { status: 500, expected: "PROVIDER_UNAVAILABLE" },
    ];
    for (const testCase of cases) {
      const { impl } = stubFetch(() => ({
        status: testCase.status,
        body: { error: { message: "upstream said no", status: testCase.status } },
      }));
      const provider = new DomainOssProvider({
        baseUrl: "https://x.test",
        apiKey: () => "k",
        fetchImpl: impl,
      });
      try {
        await provider.listZones();
        throw new Error(`expected ${testCase.status} to throw`);
      } catch (error) {
        expect((error as DomainControlError).code).toBe(testCase.expected);
      }
    }
  });

  test("refuses to call out at all when no credential is configured", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => undefined,
      fetchImpl: impl,
    });
    try {
      await provider.listZones();
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as DomainControlError).code).toBe("PROVIDER_AUTH_FAILED");
    }
    // The request must not have been attempted; a missing key is a local refusal.
    expect(calls).toHaveLength(0);
  });

  test("never includes the credential in an error message", async () => {
    const secret = "dp_live_supersecrettoken1234";
    const { impl } = stubFetch(() => ({ status: 500, body: { error: { message: "boom" } } }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => secret,
      fetchImpl: impl,
    });
    try {
      await provider.listZones();
    } catch (error) {
      const serialized = JSON.stringify((error as DomainControlError).toJSON());
      expect(serialized).not.toContain(secret);
    }
  });

  test("health reports unconfigured vs authenticated distinctly", async () => {
    const unconfigured = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => undefined,
      fetchImpl: stubFetch(() => ({ status: 200, body: { data: [] } })).impl,
    });
    const unconfiguredHealth = await unconfigured.health();
    expect(unconfiguredHealth.authenticated).toBe(false);
    expect(unconfiguredHealth.reachable).toBe(false);

    const broken = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: stubFetch(() => ({ status: 401, body: { error: { message: "no" } } })).impl,
    });
    const brokenHealth = await broken.health();
    expect(brokenHealth.authenticated).toBe(false);
    expect(brokenHealth.detail).toBe("PROVIDER_AUTH_FAILED");
  });

  test("declares its capabilities honestly, including async writes", () => {
    const provider = new DomainOssProvider({ baseUrl: "https://x.test", apiKey: () => "k" });
    const descriptor = provider.descriptor();
    expect(descriptor.kind).toBe("external");
    expect(descriptor.capabilities.asyncWrites).toBe(true);
    expect(descriptor.capabilities.acme).toBe(true);
  });

  test("an unrecognized record type is preserved, not coerced into a known one", async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: { data: [{ id: 1, name: "x", type: "PTR", content: "host.example.com", ttl: 300 }] },
    }));
    const provider = new DomainOssProvider({
      baseUrl: "https://x.test",
      apiKey: () => "k",
      fetchImpl: impl,
    });
    const records = await provider.listRecords("1");
    // Coercing to TXT would make the diff compare the wrong record and could report
    // a live record as absent.
    expect(records[0]!.type).toBe("UNSUPPORTED");
  });
});
