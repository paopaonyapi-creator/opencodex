/**
 * Pao AI Gateway — Core tests.
 *
 * Tests gateway startup, health, models, and basic request lifecycle
 * using mock providers (no real API calls, no spend).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startGatewayServer, type GatewayServerHandle } from "../src/ai-gateway/server";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_ROOT = join(import.meta.dir, "..", ".tmp", "ai-gateway-test-core");
const CONFIG_DIR = join(TEST_ROOT, "config", "ai-gateway");

function setupTestConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  writeFileSync(join(CONFIG_DIR, "providers.yaml"), `
providers:
  mock-openai:
    type: openai-compatible
    base_url: http://127.0.0.1:19876/v1
    api_key_env: TEST_MOCK_KEY
`);

  writeFileSync(join(CONFIG_DIR, "models.yaml"), `
models:
  mock-model:
    provider: mock-openai
    model: test-model
    capabilities:
      chat: true
      tools: false
      structured_output: false
      vision: false
      reasoning: false
    limits:
      context_window: 4096
      max_output_tokens: 1024
    pricing:
      input_per_million_usd: 0
      output_per_million_usd: 0
    tags:
      - test
`);

  writeFileSync(join(CONFIG_DIR, "aliases.yaml"), `
aliases:
  pao-fast:
    routes:
      - model: mock-model
        priority: 100
  pao-code:
    routes:
      - model: mock-model
        priority: 100
`);

  writeFileSync(join(CONFIG_DIR, "policies.yaml"), `
identities:
  admin-pao:
    name: Admin
    aliases:
      allow:
        - pao-fast
        - pao-code
    max_request_usd: 5
    max_daily_usd: 50

policies:
  admin-pao:
    fail_closed: false
    input:
      secret_leakage: block
    output:
      secret_leakage: block
`);

  writeFileSync(join(CONFIG_DIR, "budgets.yaml"), `
budgets:
  global:
    daily_usd: 100
    monthly_usd: 1000
`);
}

function cleanupTestConfig(): void {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("Pao AI Gateway Core", () => {
  let gateway: GatewayServerHandle | null = null;
  const PORT = 18787;

  beforeAll(() => {
    cleanupTestConfig();
    setupTestConfig();
    process.env.PAO_AI_GATEWAY_ENABLED = "true";
    process.env.PAO_AI_GATEWAY_PORT = String(PORT);
    process.env.TEST_MOCK_KEY = "test-key-12345";
  });

  afterAll(() => {
    gateway?.stop();
    delete process.env.PAO_AI_GATEWAY_ENABLED;
    delete process.env.PAO_AI_GATEWAY_PORT;
    delete process.env.TEST_MOCK_KEY;
    cleanupTestConfig();
  });

  test("gateway starts successfully", async () => {
    gateway = await startGatewayServer(TEST_ROOT);
    expect(gateway).toBeDefined();
    expect(gateway.config.enabled).toBe(true);
    expect(gateway.config.port).toBe(PORT);
  });

  test("GET /health returns ok", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { status: string; version: string; routerVersion: string };
    expect(data.status).toBe("ok");
    expect(data.version).toBe("20.13");
    expect(data.routerVersion).toBe("router-v1-rule-based");
  });

  test("GET /ready returns readiness", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/ready`);
    const data = (await resp.json()) as { ready: boolean };
    expect(typeof data.ready).toBe("boolean");
  });

  test("GET /v1/models returns aliases and models", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { object: string; data: { id: string }[] };
    expect(data.object).toBe("list");
    expect(data.data.length).toBeGreaterThan(0);
    const ids = data.data.map(m => m.id);
    expect(ids).toContain("pao-fast");
    expect(ids).toContain("pao-code");
  });

  test("POST /v1/chat/completions without auth returns 401 only when keys configured", async () => {
    if (!gateway) return;
    // In dev mode (no gateway keys configured), this falls through to admin
    const resp = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "pao-fast",
        messages: [{ role: "user", content: "test" }],
      }),
    });
    // Either 401 (keys configured) or 502 (dev mode, mock provider down)
    expect([401, 502]).toContain(resp.status);
  });

  test("POST /v1/chat/completions with missing model returns 400", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
    });
    expect(resp.status).toBe(400);
  });

  test("GET /api/gateway/providers returns provider info without raw keys", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/api/gateway/providers`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { providers: { id: string; type: string }[] };
    expect(data.providers.length).toBeGreaterThan(0);
    // Verify no raw API keys in the response
    const raw = JSON.stringify(data);
    expect(raw).not.toContain("test-key-12345");
  });

  test("GET /api/gateway/aliases returns configured aliases", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/api/gateway/aliases`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { aliases: { id: string }[] };
    expect(data.aliases.some(a => a.id === "pao-fast")).toBe(true);
  });

  test("GET /api/gateway/health returns gateway and provider health", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/api/gateway/health`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { gateway: { status: string }; providers: unknown[] };
    expect(data.gateway.status).toBe("ok");
  });

  test("unknown route returns 404", async () => {
    if (!gateway) return;
    const resp = await fetch(`http://127.0.0.1:${PORT}/v1/nonexistent`);
    expect(resp.status).toBe(404);
  });
});
