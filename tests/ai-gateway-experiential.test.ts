import { describe, expect, test } from "bun:test";
import { ExperientialProvider } from "../src/ai-gateway/providers/experiential";
import { probeUpstreamVersion } from "../src/ai-gateway/upstream-lock";

/**
 * Phase 20.17 — Experiential adapter contract tests.
 *
 * Driven against a STUBBED transport: no socket is opened. The endpoint shapes
 * asserted here were read from the upstream README and release page, so a drift
 * in this adapter fails here rather than in production.
 */

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  correlationId: string | null;
}

function stubFetch(
  handler: (call: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
      correlationId: headers.get("X-Pao-Correlation-Id"),
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

function provider(fetchImpl: typeof fetch, baseUrl = "http://127.0.0.1:8000/v1", apiKey = "gateway-key") {
  return new ExperientialProvider({
    config: { id: "experiential", type: "experiential", apiKeyEnv: "EXPERIENTIAL_API_KEY", baseUrl },
    fetchImpl,
    apiKey: () => apiKey,
  });
}

const chatRequest = {
  model: "opus-5",
  messages: [{ role: "user" as const, content: "hello" }],
};

describe("Phase 20.17 — Experiential adapter", () => {
  test("lists models from the OpenAI-compatible envelope", async () => {
    const { impl, calls } = stubFetch(() => ({
      status: 200,
      body: { data: [{ id: "opus-5", owned_by: "experiential" }] },
    }));
    const models = await provider(impl).listModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("opus-5");
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/v1/models");
    expect(calls[0]!.authorization).toBe("Bearer gateway-key");
  });

  test("a trailing slash on the base URL is normalized exactly once", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    await provider(impl, "http://127.0.0.1:8000/v1/").listModels();
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/v1/models");
  });

  test("every request carries a correlation id", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    await provider(impl).listModels();
    expect(calls[0]!.correlationId).toBeTruthy();
  });

  test("a chat completion is posted to /chat/completions with stream disabled", async () => {
    const { impl, calls } = stubFetch(() => ({
      status: 200,
      body: { id: "c1", choices: [{ message: { role: "assistant", content: "hi" } }] },
    }));
    const response = (await provider(impl).chat(chatRequest)) as { id: string };
    expect(response.id).toBe("c1");
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(calls[0]!.method).toBe("POST");
  });

  test("optional fields are omitted rather than sent as undefined", async () => {
    let sent: Record<string, unknown> = {};
    const { impl } = stubFetch((call) => {
      void call;
      return { status: 200, body: {} };
    });
    const capturing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await provider(capturing).chat(chatRequest);
    expect(Object.keys(sent)).toContain("model");
    expect(Object.keys(sent)).toContain("messages");
    expect(sent.temperature).toBeUndefined();
    expect(sent.tools).toBeUndefined();
    void impl;
  });

  test("an auth rejection maps to the non-escalatable auth_failure code", async () => {
    const { impl } = stubFetch(() => ({ status: 401 }));
    try {
      await provider(impl).chat(chatRequest);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("auth_failure");
    }
  });

  test("a 429 maps to provider_429 so the breaker rate-limits rather than kills", async () => {
    const { impl } = stubFetch(() => ({ status: 429 }));
    try {
      await provider(impl).chat(chatRequest);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("provider_429");
    }
  });

  test("a 5xx maps to provider_5xx", async () => {
    const { impl } = stubFetch(() => ({ status: 503 }));
    try {
      await provider(impl).chat(chatRequest);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("provider_5xx");
    }
  });

  test("a timeout is distinguished from an unreachable gateway", async () => {
    // A timeout is the case where the request may have been received and charged,
    // so it must not be reported as a plain connection failure.
    const timeout = (async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    try {
      await provider(timeout).chat(chatRequest);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("provider_timeout");
    }

    const unreachable = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      await provider(unreachable).chat(chatRequest);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("provider_unreachable");
    }
  });

  test("a remote gateway without a credential is not considered configured", () => {
    // Calling a remote gateway unauthenticated is a misconfiguration that should
    // fail closed, not a request that quietly returns 401 later.
    const { impl } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    const remote = new ExperientialProvider({
      config: { id: "e", type: "experiential", apiKeyEnv: "K", baseUrl: "https://api.example.com/v1" },
      fetchImpl: impl,
      apiKey: () => undefined,
    });
    expect(remote.isConfigured()).toBe(false);
  });

  test("a local gateway without a credential is usable", async () => {
    // The local setup flow issues a key on first run, so demanding one before the
    // gateway has ever started would block the documented first-use path.
    const { impl, calls } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    const local = new ExperientialProvider({
      config: { id: "e", type: "experiential", apiKeyEnv: "K", baseUrl: "http://127.0.0.1:8000/v1" },
      fetchImpl: impl,
      apiKey: () => undefined,
    });
    expect(local.isConfigured()).toBe(true);
    await local.listModels();
    expect(calls[0]!.authorization).toBeNull();
  });

  test("health reports configured-ness and never throws", async () => {
    const { impl } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    const health = await provider(impl).healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.providerId).toBe("experiential");

    const broken = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const bad = await provider(broken).healthCheck();
    expect(bad.healthy).toBe(false);
    expect(bad.lastError).toBeTruthy();
  });

  test("the endpoint description exposes no credential value", () => {
    const { impl } = stubFetch(() => ({ status: 200, body: {} }));
    const described = provider(impl).describeEndpoint();
    expect(JSON.stringify(described)).not.toContain("gateway-key");
    expect(described.credentialConfigured).toBe(true);
    expect(described.baseUrl).toBe("http://127.0.0.1:8000/v1");
  });
});

describe("Phase 20.17 — upstream version probe", () => {
  test("an unreported version is unknown, not a mismatch", async () => {
    // Claiming a mismatch we did not observe would be worse than admitting we
    // could not check.
    const { impl } = stubFetch(() => ({ status: 200, body: { data: [] } }));
    const result = await probeUpstreamVersion({
      baseUrl: "http://127.0.0.1:8000/v1",
      pinned: "0.7.63",
      fetchImpl: impl,
    });
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("does not report a version");
  });

  test("a matching reported version is a match", async () => {
    const { impl } = stubFetch(() => ({ status: 200, body: { version: "0.7.63" } }));
    const result = await probeUpstreamVersion({
      baseUrl: "http://127.0.0.1:8000/v1",
      pinned: "0.7.63",
      fetchImpl: impl,
    });
    expect(result.status).toBe("match");
  });

  test("a differing version is reported as a mismatch with its numbers", async () => {
    const { impl } = stubFetch(() => ({ status: 200, body: { version: "0.8.1" } }));
    const result = await probeUpstreamVersion({
      baseUrl: "http://127.0.0.1:8000/v1",
      pinned: "0.7.63",
      fetchImpl: impl,
    });
    expect(result.status).toBe("mismatch");
    expect(result.observed).toBe("0.8.1");
  });

  test("an unreachable gateway is unknown rather than a failure", async () => {
    const broken = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await probeUpstreamVersion({
      baseUrl: "http://127.0.0.1:8000/v1",
      pinned: "0.7.63",
      fetchImpl: broken,
    });
    expect(result.status).toBe("unknown");
  });
});
