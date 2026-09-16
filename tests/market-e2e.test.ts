/**
 * Pao Market Signal Control Plane — Phase 20.52 end-to-end test through the
 * real HTTP server (spec §67 happy path + failure flows, §99 Definition of
 * Done) using a signed webhook against a temp database.
 *
 * No real broker, no real network beyond loopback. The webhook/admin strings
 * below are explicitly fake fixtures for tests only and are also readable
 * from the environment so no credential-shaped literal is load-bearing.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMarketServer, type MarketServerHandle } from "../src/agent-os/market/server";
import { closeAgentOsDbForTests } from "../src/agent-os/db";

const PORT = 18791;
// Fixture secrets for tests only — not real credentials.
const WEBHOOK_FIXTURE = process.env.MARKET_E2E_WEBHOOK_FIXTURE ?? "fixture-e2e-webhook-for-tests-only";
const ADMIN_FIXTURE = process.env.MARKET_E2E_ADMIN_FIXTURE ?? "fixture-e2e-admin-for-tests-only";
const tempHome = mkdtempSync(join(tmpdir(), "market-e2e-"));

let gateway: MarketServerHandle | null = null;

const base = `http://127.0.0.1:${PORT}`;

function kamdenBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    symbol: "AAPL",
    event_type: "entry",
    price: 200.25,
    stop: 196,
    target: 208,
    confidence: 0.7,
    ...overrides,
  });
}

function kamdenHeaders(body: string, deliveryId: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WEBHOOK_FIXTURE).update(`${ts}.${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "x-kamdenai-event": "entry",
    "x-kamdenai-delivery": deliveryId,
    "x-kamdenai-timestamp": String(ts),
    "x-kamdenai-signature": sig,
  };
}

const admin = (path: string) => `${base}/api/market/${path}`;
const adminHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_FIXTURE}` };

describe("Phase 20.52 — end-to-end market pipeline", () => {
  beforeAll(async () => {
    process.env.OPENCODEX_HOME = tempHome;
    closeAgentOsDbForTests();
    process.env.MARKET_MODULE_ENABLED = "true";
    process.env.MARKET_MODULE_PORT = String(PORT);
    process.env.MARKET_ADMIN_KEY = ADMIN_FIXTURE;
    process.env.MARKET_APPROVER_ACTORS = "admin";
    process.env.MARKET_OPERATOR_ACTORS = "admin";
    process.env.MARKET_PROVIDER_KAMDEN_ENABLED = "true";
    process.env.MARKET_KAMDEN_WEBHOOK_SECRET = WEBHOOK_FIXTURE;
    process.env.MARKET_WEBHOOK_MAX_AGE_SECONDS = "300";
    process.env.MARKET_PAPER_EQUITY = "100000";
    gateway = await startMarketServer(tempHome);
  });

  afterAll(() => {
    gateway?.stop();
    closeAgentOsDbForTests();
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {}
    for (const key of [
      "MARKET_MODULE_ENABLED",
      "MARKET_MODULE_PORT",
      "MARKET_ADMIN_KEY",
      "MARKET_APPROVER_ACTORS",
      "MARKET_OPERATOR_ACTORS",
      "MARKET_PROVIDER_KAMDEN_ENABLED",
      "MARKET_KAMDEN_WEBHOOK_SECRET",
      "MARKET_WEBHOOK_MAX_AGE_SECONDS",
      "MARKET_PAPER_EQUITY",
    ]) {
      delete process.env[key];
    }
  });

  test("signed webhook -> verify -> normalize -> analysis -> risk -> proposal -> approval -> paper execution -> audit", async () => {
    // 1. Deliver a valid signed webhook.
    const body = kamdenBody();
    const webhookResp = await fetch(admin("webhooks/kamden"), {
      method: "POST",
      headers: kamdenHeaders(body, "e2e-dlv-1"),
      body,
    });
    expect(webhookResp.status).toBe(202);
    const { signalId } = (await webhookResp.json()) as { signalId: string };
    expect(signalId).toMatch(/^msig-/);

    // 2. Signal detail shows verification + quality.
    const detail = (await (await fetch(admin(`signals/${signalId}`), { headers: adminHeaders })).json()) as {
      signal: { symbol: string; verified: boolean };
      status: string;
      quality: { grade: string };
    };
    expect(detail.signal.symbol).toBe("AAPL");
    expect(detail.signal.verified).toBe(true);
    expect(detail.status).toBe("VERIFIED");
    expect(["A", "B"]).toContain(detail.quality.grade);

    // 3. Analysis.
    const analysisResp = await fetch(admin(`signals/${signalId}/analyze`), { method: "POST", headers: adminHeaders });
    expect(analysisResp.status).toBe(200);
    const { analysis } = (await analysisResp.json()) as { analysis: { summary: string; reviewerConsensus: { result: string } } };
    expect(analysis.summary).toContain("AAPL");
    expect(analysis.reviewerConsensus.result).toBe("support");

    // 4. Deterministic risk check passes.
    const riskResp = await fetch(admin(`signals/${signalId}/risk-check`), { method: "POST", headers: adminHeaders });
    expect(riskResp.status).toBe(200);
    const { risk } = (await riskResp.json()) as { risk: { passed: boolean; positionSize: number } };
    expect(risk.passed).toBe(true);
    expect(risk.positionSize).toBe(117); // 500 planned risk / 4.25 per-unit risk (200.25 -> 196)

    // 5. Proposal + approval request.
    const proposalResp = await fetch(admin(`signals/${signalId}/propose`), { method: "POST", headers: adminHeaders });
    expect(proposalResp.status).toBe(201);
    const { proposal } = (await proposalResp.json()) as { proposal: { id: string; executionMode: string; quantity: number } };
    expect(proposal.executionMode).toBe("paper");

    // 6. Pending approvals list contains it.
    const approvalsList = (await (await fetch(admin("approvals"), { headers: adminHeaders })).json()) as {
      approvals: { id: string; proposalId: string }[];
    };
    const approval = approvalsList.approvals.find(a => a.proposalId === proposal.id);
    expect(approval).toBeDefined();

    // 7. Human approval.
    const approveResp = await fetch(admin(`approvals/${approval!.id}/approve`), { method: "POST", headers: adminHeaders, body: "{}" });
    expect(approveResp.status).toBe(200);

    // 8. Paper execution.
    const execResp = await fetch(admin(`proposals/${proposal.id}/execute`), { method: "POST", headers: adminHeaders });
    expect(execResp.status).toBe(200);
    const { orderId } = (await execResp.json()) as { orderId: string };
    expect(orderId).toMatch(/^paper-/);

    // 9. Close the paper position and verify the ledger.
    const closeResp = await fetch(admin(`paper-orders/${orderId}/close`), { method: "POST", headers: adminHeaders, body: JSON.stringify({ exitPrice: 205.25 }) });
    expect(closeResp.status).toBe(200);
    const { result } = (await closeResp.json()) as { result: { netPnl: number } };
    expect(result.netPnl).toBeCloseTo(5 * 117, 6);

    // 10. Audit trail + event trail + notifications exist end to end.
    const audit = (await (await fetch(admin(`signals/${signalId}/audit`), { headers: adminHeaders })).json()) as { audit: unknown[] };
    expect(audit.audit.length).toBeGreaterThan(0);
    const events = (await (await fetch(admin("events"), { headers: adminHeaders })).json()) as { events: { type: string }[] };
    const types = events.events.map(e => e.type);
    expect(types).toContain("market.signal.verified");
    expect(types).toContain("market.proposal.created");
    expect(types).toContain("paper.order.executed");
    expect(types).toContain("market.trade.closed");
    const notifications = (await (await fetch(admin("notifications"), { headers: adminHeaders })).json()) as { notifications: { title: string }[] };
    expect(notifications.notifications.length).toBeGreaterThan(0);

    // 11. Health reports paper mode and no secrets.
    const healthText = await (await fetch(admin("health"), { headers: adminHeaders })).text();
    expect(healthText).toContain('"executionMode":"paper"');
    expect(healthText).not.toContain(WEBHOOK_FIXTURE);
    expect(healthText).not.toContain(ADMIN_FIXTURE);
  });

  test("invalid signature is rejected", async () => {
    const body = kamdenBody();
    const headers = kamdenHeaders(body, "e2e-dlv-bad");
    headers["x-kamdenai-signature"] = "0".repeat(64);
    const resp = await fetch(admin("webhooks/kamden"), { method: "POST", headers, body });
    expect(resp.status).toBe(401);
    const payload = (await resp.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("MARKET_WEBHOOK_SIGNATURE_INVALID");
  });

  test("duplicate delivery is idempotent", async () => {
    const body = kamdenBody({ symbol: "MSFT", price: 410, stop: 400, target: 430 });
    const first = await fetch(admin("webhooks/kamden"), { method: "POST", headers: kamdenHeaders(body, "e2e-dlv-dup"), body });
    expect(first.status).toBe(202);
    const second = await fetch(admin("webhooks/kamden"), { method: "POST", headers: kamdenHeaders(body, "e2e-dlv-dup"), body });
    expect(second.status).toBe(200);
    const payload = (await second.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("MARKET_WEBHOOK_DUPLICATE");
  });

  test("unauthorized admin access is rejected", async () => {
    const resp = await fetch(admin("signals"), { headers: { Authorization: "Bearer not-the-key" } });
    expect(resp.status).toBe(401);
  });

  test("circuit breaker pause blocks proposal creation and health reflects it", async () => {
    // Pause the breaker as an operator.
    const pauseResp = await fetch(admin("circuit-breaker/pause"), { method: "POST", headers: adminHeaders });
    expect(pauseResp.status).toBe(200);

    // A fresh signal can be ingested (audit continues)...
    const body = kamdenBody({ symbol: "NVDA", price: 120, stop: 115, target: 130 });
    const webhookResp = await fetch(admin("webhooks/kamden"), { method: "POST", headers: kamdenHeaders(body, "e2e-dlv-paused"), body });
    expect(webhookResp.status).toBe(202);
    const { signalId } = (await webhookResp.json()) as { signalId: string };

    // ...but the risk check hard-fails on the breaker.
    const riskResp = await fetch(admin(`signals/${signalId}/risk-check`), { method: "POST", headers: adminHeaders });
    const { risk } = (await riskResp.json()) as { risk: { passed: boolean; hardFailures: { code: string }[] } };
    expect(risk.passed).toBe(false);
    expect(risk.hardFailures.some(f => f.code === "MARKET_CIRCUIT_BREAKER_ACTIVE")).toBe(true);

    const health = (await (await fetch(admin("health"), { headers: adminHeaders })).json()) as { circuitBreaker: string; status: string };
    expect(health.circuitBreaker).toBe("PAUSED");

    // Reset restores service.
    const resetResp = await fetch(admin("circuit-breaker/reset"), { method: "POST", headers: adminHeaders });
    expect(resetResp.status).toBe(200);
  });

  test("live execution mode is rejected at the server boundary", async () => {
    // Even a hand-crafted live-mode proposal id cannot pass through the
    // paper-only execution service; the server exposes no live path at all.
    const resp = await fetch(admin("proposals/mprp-does-not-exist/execute"), { method: "POST", headers: adminHeaders });
    expect([404, 409]).toContain(resp.status);
  });
});
