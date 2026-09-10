import { describe, expect, test } from "bun:test";
import {
  CaddyAdapter,
  NoopProxyAdapter,
  assertRoutableTarget,
  createProxyAdapter,
} from "../src/agent-os/domain-control/proxy";
import { DomainControlError } from "../src/agent-os/domain-control/types";

describe("Phase 20.15 — routing target validation (SSRF boundary)", () => {
  test("accepts a public IPv4 address", () => {
    expect(assertRoutableTarget("203.0.113.10")).toBe("203.0.113.10");
    expect(assertRoutableTarget("8.8.8.8")).toBe("8.8.8.8");
  });

  test("refuses loopback, private, link-local, and multicast targets", () => {
    // 169.254.169.254 is the cloud metadata endpoint: routing to it would turn the
    // reverse proxy into a credential-exfiltration pivot.
    for (const blocked of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "224.0.0.1",
      "0.0.0.0",
    ]) {
      expect(() => assertRoutableTarget(blocked)).toThrow(DomainControlError);
    }
  });

  test("refuses malformed and out-of-range octets", () => {
    expect(() => assertRoutableTarget("999.1.1.1")).toThrow(DomainControlError);
    expect(() => assertRoutableTarget("example.com")).toThrow(DomainControlError);
    expect(() => assertRoutableTarget("")).toThrow(DomainControlError);
    expect(() => assertRoutableTarget("1.2.3")).toThrow(DomainControlError);
  });

  test("refuses IPv6 rather than accepting it without a private-range check", () => {
    // Accepting ::1 or fd00::/8 here without a range check would be a hole, so the
    // honest answer is an explicit not-implemented refusal.
    try {
      assertRoutableTarget("::1");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as DomainControlError).code).toBe("NOT_IMPLEMENTED");
    }
  });
});

describe("Phase 20.15 — Caddy adapter", () => {
  function stubFetch(handler: (call: { url: string; method: string; body: unknown }) => { status: number; body?: unknown }) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const result = handler(call);
      return new Response(result.body === undefined ? "" : JSON.stringify(result.body), {
        status: result.status,
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  test("reports unavailable when no admin URL is configured", () => {
    const adapter = createProxyAdapter({ adminUrl: null });
    expect(adapter).toBeInstanceOf(NoopProxyAdapter);
    expect(adapter.available()).toBe(false);
  });

  test("a route to a valid target is created with an upstream dial", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200 }));
    const adapter = new CaddyAdapter({
      adminUrl: "http://caddy:2019/",
      apiToken: () => "tok",
      fetchImpl: impl,
    });
    const result = await adapter.applyRoute({
      hostname: "dev.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
      tlsMode: "auto",
    });
    expect(result.applied).toBe(true);
    expect(calls[0]!.url).toBe("http://caddy:2019/config/apps/http/servers/pao/routes");
    const body = calls[0]!.body as { match: { host: string[] }[]; handle: { upstreams: { dial: string }[] }[] };
    expect(body.match[0]!.host).toEqual(["dev.example.com"]);
    expect(body.handle[0]!.upstreams[0]!.dial).toBe("203.0.113.10:3000");
  });

  test("an invalid target or port is refused before any request is sent", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200 }));
    const adapter = new CaddyAdapter({ adminUrl: "http://caddy:2019", fetchImpl: impl });
    await expect(
      adapter.applyRoute({
        hostname: "dev.example.com",
        targetIp: "127.0.0.1",
        targetPort: 3000,
        tlsMode: "auto",
      }),
    ).rejects.toThrow(DomainControlError);
    await expect(
      adapter.applyRoute({
        hostname: "dev.example.com",
        targetIp: "203.0.113.10",
        targetPort: 70_000,
        tlsMode: "auto",
      }),
    ).rejects.toThrow(DomainControlError);
    expect(calls).toHaveLength(0);
  });

  test("a hostname carrying an injection attempt never reaches the request", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200 }));
    const adapter = new CaddyAdapter({ adminUrl: "http://caddy:2019", fetchImpl: impl });
    await expect(
      adapter.applyRoute({
        hostname: "evil.com\n{handler: \"exec\"}",
        targetIp: "203.0.113.10",
        targetPort: 3000,
        tlsMode: "auto",
      }),
    ).rejects.toThrow(DomainControlError);
    expect(calls).toHaveLength(0);
  });

  test("a Caddy failure surfaces PROXY_CONFIG_FAILED", async () => {
    const { impl } = stubFetch(() => ({ status: 500 }));
    const adapter = new CaddyAdapter({ adminUrl: "http://caddy:2019", fetchImpl: impl });
    try {
      await adapter.applyRoute({
        hostname: "dev.example.com",
        targetIp: "203.0.113.10",
        targetPort: 3000,
        tlsMode: "auto",
      });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as DomainControlError).code).toBe("PROXY_CONFIG_FAILED");
    }
  });

  test("checkRoute reports absence on 404 without throwing", async () => {
    const { impl } = stubFetch(() => ({ status: 404 }));
    const adapter = new CaddyAdapter({ adminUrl: "http://caddy:2019", fetchImpl: impl });
    const result = await adapter.checkRoute("dev.example.com");
    expect(result.present).toBe(false);
  });

  test("the noop adapter fails loudly instead of pretending to configure a route", async () => {
    const adapter = new NoopProxyAdapter();
    await expect(
      adapter.applyRoute({
        hostname: "dev.example.com",
        targetIp: "203.0.113.10",
        targetPort: 3000,
        tlsMode: "auto",
      }),
    ).rejects.toThrow(DomainControlError);
  });
});
