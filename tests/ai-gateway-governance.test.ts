/**
 * Pao AI Gateway — Phase 20.51 integration tests: the governed execution path
 * through the real gateway server (quota-aware ordering, bounded fallback,
 * decision ledger, simulate, operator actions) against mock upstreams.
 *
 * No real API calls, no spend.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startGatewayServer, type GatewayServerHandle } from "../src/ai-gateway/server";
import { readDecisions, readGatewayEvents } from "../src/ai-gateway/traces/decision-ledger";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_ROOT = join(import.meta.dir, "..", ".tmp", "ai-gateway-test-governance");
const CONFIG_DIR = join(TEST_ROOT, "config", "ai-gateway");

const GATEWAY_PORT = 18799;
const ADMIN_KEY = "phase-2051-test-admin-key";
const FAIL_PORT = 19951; // always 429
const OK_PORT = 19952; // always 200

const failServer = Bun.serve({
  port: FAIL_PORT,
  fetch() {
    return new Response("rate limited", { status: 429 });
  },
});

const okServer = Bun.serve({
  port: OK_PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "gov-model-b" }] });
    }
    return Response.json({
      id: "ok-1",
      object: "chat.completion",
      created: 1,
      model: "gov-model-b",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });
  },
});

function setupTestConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  writeFileSync(
    join(CONFIG_DIR, "providers.yaml"),
    `
providers:
  gov-a:
    type: openai-compatible
    base_url: http://127.0.0.1:${FAIL_PORT}/v1
    api_key_env: TEST_GOV_KEY_A
  gov-b:
    type: openai-compatible
    base_url: http://127.0.0.1:${OK_PORT}/v1
    api_key_env: TEST_GOV_KEY_B
`,
  );

  writeFileSync(
    join(CONFIG_DIR, "models.yaml"),
    `
models:
  gov-model-a:
    provider: gov-a
    model: gov-model-a
    capabilities:
      chat: true
      tools: true
      structured_output: true
      vision: true
      reasoning: true
    limits:
      context_window: 128000
      max_output_tokens: 8192
    pricing:
      input_per_million_usd: 0
      output_per_million_usd: 0
    tags:
      - test
  gov-model-b:
    provider: gov-b
    model: gov-model-b
    capabilities:
      chat: true
      tools: true
      structured_output: true
      vision: true
      reasoning: true
    limits:
      context_window: 128000
      max_output_tokens: 8192
    pricing:
      input_per_million_usd: 0
      output_per_million_usd: 0
    tags:
      - test
`,
  );

  writeFileSync(
    join(CONFIG_DIR, "aliases.yaml"),
    `
aliases:
  pao-code:
    routes:
      - model: gov-model-a
        priority: 100
      - model: gov-model-b
        priority: 90
`,
  );

  writeFileSync(
    join(CONFIG_DIR, "policies.yaml"),
    `
identities:
  admin-pao:
    name: Admin
    aliases:
      allow:
        - pao-code
    max_request_usd: 5
    max_daily_usd: 50
`,
  );

  writeFileSync(
    join(CONFIG_DIR, "budgets.yaml"),
    `
budgets:
  global:
    daily_usd: 100
    monthly_usd: 1000
`,
  );
}

describe("Phase 20.51 — governed execution path", () => {
  let gateway: GatewayServerHandle | null = null;

  beforeAll(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    setupTestConfig();
    process.env.PAO_AI_GATEWAY_ENABLED = "true";
    process.env.PAO_AI_GATEWAY_PORT = String(GATEWAY_PORT);
    process.env.PAO_AI_GATEWAY_GOVERNANCE = "true";
    // A deterministic admin key makes authentication independent of whatever
    // PAO_GW_KEY_* variables exist in the running environment.
    process.env.PAO_AI_GATEWAY_ADMIN_KEY = ADMIN_KEY;
    delete process.env.PAO_GW_KEY_ADMIN_PAO;
    delete process.env.TEST_GOV_KEY_A;
    delete process.env.TEST_GOV_KEY_B;
    gateway = await startGatewayServer(TEST_ROOT);
  });

  afterAll(() => {
    gateway?.stop();
    delete process.env.PAO_AI_GATEWAY_ENABLED;
    delete process.env.PAO_AI_GATEWAY_PORT;
    delete process.env.PAO_AI_GATEWAY_GOVERNANCE;
    delete process.env.PAO_AI_GATEWAY_ADMIN_KEY;
    failServer.stop(true);
    okServer.stop(true);
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ADMIN_KEY}`,
  };

  const chat = () =>
    fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "pao-code", messages: [{ role: "user", content: "hello" }] }),
    });

  const admin = (path: string) => `http://127.0.0.1:${GATEWAY_PORT}/api/gateway/${path}`;

  test("a 429 on the primary route falls back to the healthy route", async () => {
    const resp = await chat();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Pao-Fallback-Depth")).toBe("1");
    expect(resp.headers.get("X-Pao-Selected-Model")).toBe("gov-model-b");
    expect(resp.headers.get("X-Pao-Router-Version")).toBe("router-v3-quota-aware");
    const body = (await resp.json()) as { model: string; choices: { message: { content: string } }[] };
    expect(body.model).toBe("pao-code");
    expect(body.choices[0]?.message.content).toBe("ok");
  });

  test("the decision ledger records the fallback trace and reason codes", () => {
    const decisions = readDecisions(TEST_ROOT);
    const fallbackDecision = decisions.find(d => d.fallbackDepth === 1);
    expect(fallbackDecision).toBeDefined();
    expect(fallbackDecision?.outcome).toBe("success");
    expect(fallbackDecision?.selectedModelId).toBe("gov-model-b");
    expect(fallbackDecision?.reasonCodes).toContain("FALLBACK_RATE_LIMIT");

    const events = readGatewayEvents(TEST_ROOT);
    expect(events.some(e => e.eventType === "ROUTE_ATTEMPT_FAILED" && e.reasonCode === "FALLBACK_RATE_LIMIT")).toBe(true);
    expect(events.some(e => e.eventType === "CONNECTION_STATE_CHANGED" && e.reasonCode === "CB_RATE_LIMIT")).toBe(true);
  });

  test("the failed route cools down and simulate reflects it", async () => {
    const resp = await fetch(admin("simulate"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ alias: "pao-code" }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      selected: { routeKey: string } | null;
      rejected: { routeKey: string; reasonCodes: string[] }[];
    };
    expect(body.selected?.routeKey).toBe("gov-b/gov-model-b");
    expect(
      body.rejected.some(r => r.routeKey === "gov-a/gov-model-a" && r.reasonCodes[0] === "ROUTE_REJECTED_COOLDOWN"),
    ).toBe(true);
  });

  test("operator disable removes the last healthy route; recover brings it back", async () => {
    const disable = await fetch(admin("connections"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ routeKey: "gov-b/gov-model-b", action: "disable" }),
    });
    expect(disable.status).toBe(200);

    const during = (await (
      await fetch(admin("simulate"), {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ alias: "pao-code" }),
      })
    ).json()) as { selected: unknown; rejected: { routeKey: string; reasonCodes: string[] }[] };
    expect(during.selected).toBeNull();
    expect(
      during.rejected.some(r => r.routeKey === "gov-b/gov-model-b" && r.reasonCodes[0] === "ROUTE_REJECTED_DISABLED"),
    ).toBe(true);

    const recover = await fetch(admin("connections"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ routeKey: "gov-b/gov-model-b", action: "recover" }),
    });
    expect(recover.status).toBe(200);

    const after = (await (
      await fetch(admin("simulate"), {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ alias: "pao-code" }),
      })
    ).json()) as { selected: { routeKey: string } | null };
    expect(after.selected?.routeKey).toBe("gov-b/gov-model-b");
  });

  test("a request through the recovered route succeeds without fallback", async () => {
    const resp = await chat();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Pao-Fallback-Depth")).toBe("0");
  });

  test("a wrong admin credential is rejected on the admin surface", async () => {
    const resp = await fetch(admin("quotas"), { headers: { Authorization: "Bearer not-the-key" } });
    expect(resp.status).toBe(401);
  });
});
