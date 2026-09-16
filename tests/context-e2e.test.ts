/**
 * Pao Context Control Plane — Phase 20.53 end-to-end test through the real
 * HTTP server (spec §132 DoD flow, hermetic via a mock OpenViking).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startContextServer, type ContextServerHandle } from "../src/agent-os/context/server";
import { closeAgentOsDbForTests } from "../src/agent-os/db";

const PORT = 18793;
const ADMIN = "fixture-e2e-context-admin-for-tests-only";
const tempHome = mkdtempSync(join(tmpdir(), "context-e2e-"));
let gateway: ContextServerHandle | null = null;

const base = `http://127.0.0.1:${PORT}`;
const admin = (path: string) => `${base}/api/context/${path}`;
const adminHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN}` };

// Mock OpenViking surface.
const MOCK_PORT = 19981;
const mockServer = Bun.serve({
  port: MOCK_PORT,
  fetch: async req => {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ status: "ok", version: "v-mock-e2e" });
    if (url.pathname === "/mcp") return Response.json({ capabilities: {} });
    if (url.pathname === "/api/viking/list") return Response.json({ entries: [] });
    if (url.pathname === "/api/sessions" && req.method === "GET") return Response.json({ sessions: [] });
    if (url.pathname === "/api/sessions" && req.method === "POST") return Response.json({ session_id: `sess-${Date.now()}` });
    if (url.pathname === "/api/viking/search" && req.method === "POST") {
      return Response.json({ results: [{ uri: "viking://resources/pao-hubpro/phases/20.51-9router", score: 0.94 }] });
    }
    if (url.pathname === "/api/viking/read") {
      return Response.json({ uri: url.searchParams.get("uri"), content: "# Phase 20.51 — 9Router\n\nGateway governance doc." });
    }
    if (url.pathname === "/api/resources/add") return Response.json({ task_id: `task-${Date.now()}` });
    if (url.pathname === "/api/tasks") return Response.json({ status: "ready" });
    if (url.pathname === "/api/sessions/messages") return Response.json({ ok: true });
    if (url.pathname === "/api/sessions/commit") return Response.json({ task_id: "commit-1" });
    return new Response("not found", { status: 404 });
  },
});

describe("Phase 20.53 — context control plane end-to-end", () => {
  beforeAll(async () => {
    process.env.OPENCODEX_HOME = tempHome;
    closeAgentOsDbForTests();
    process.env.PAO_CONTEXT_ENABLED = "true";
    process.env.PAO_CONTEXT_MODULE_PORT = String(PORT);
    process.env.PAO_CONTEXT_ADMIN_KEY = ADMIN;
    process.env.PAO_CONTEXT_REVIEWER_ACTORS = "admin";
    process.env.PAO_CONTEXT_OPERATOR_ACTORS = "admin";
    process.env.PAO_OPENVIKING_URL = `http://127.0.0.1:${MOCK_PORT}`;
    process.env.PAO_CONTEXT_TRACE_ENABLED = "true";
    gateway = await startContextServer();
  });

  afterAll(() => {
    gateway?.stop();
    mockServer.stop(true);
    closeAgentOsDbForTests();
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {}
    for (const key of [
      "PAO_CONTEXT_ENABLED",
      "PAO_CONTEXT_MODULE_PORT",
      "PAO_CONTEXT_ADMIN_KEY",
      "PAO_CONTEXT_REVIEWER_ACTORS",
      "PAO_CONTEXT_OPERATOR_ACTORS",
      "PAO_OPENVIKING_URL",
      "PAO_CONTEXT_TRACE_ENABLED",
    ]) {
      delete process.env[key];
    }
  });

  test("health + capability probe expose backend state without secrets", async () => {
    const health = (await (await fetch(admin("health"))).json()) as { overall: string; backend: { reachable: boolean } };
    expect(health.backend.reachable).toBe(true);
    const caps = (await (await fetch(admin("capabilities"), { headers: adminHeaders })).json()) as {
      status: string;
      serverVersion?: string;
      capabilities: { resources: boolean };
    };
    expect(caps.status).toBe("compatible");
    expect(caps.capabilities.resources).toBe(true);
    const healthText = await (await fetch(admin("health"))).text();
    expect(healthText).not.toContain(ADMIN);
  });

  test("register + ingest a phase source, then retrieve it with a trace", async () => {
    const ingestResp = await fetch(admin("sources"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        path: "docs/phases/phase-20.51.md",
        sourceType: "phase_spec",
        sourceLocator: "docs/phases/phase-20.51.md",
        content: "# Phase 20.51 — 9Router\n\nGateway governance doc.",
      }),
    });
    expect(ingestResp.status).toBe(201);
    const { outcome } = (await ingestResp.json()) as { outcome: { ok: boolean; status: string; targetUri: string } };
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe("ready");
    expect(outcome.targetUri).toContain("viking://resources/pao-hubpro/phases/");

    const searchResp = await fetch(admin("search"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ query: "How does Pao-hubPro route providers?" }),
    });
    expect(searchResp.status).toBe(200);
    const retrieval = (await searchResp.json()) as {
      retrievalRunId: string;
      status: string;
      items: { uri: string; allowed: boolean; reason: string }[];
    };
    expect(retrieval.status).toBe("ok");
    expect(retrieval.items.some(i => i.uri.includes("20.51") && i.allowed)).toBe(true);

    const traceResp = await fetch(admin(`retrievals/${retrieval.retrievalRunId}`), { headers: adminHeaders });
    expect(traceResp.status).toBe(200);
  });

  test("a secret-bearing source is blocked with the reason code", async () => {
    const resp = await fetch(admin("sources"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        path: "docs/notes/leaked.md",
        sourceType: "markdown",
        sourceLocator: "docs/notes/leaked.md",
        content: `Rotate this credential: ${"sk-" + "e".repeat(24)}`,
      }),
    });
    expect(resp.status).toBe(422);
    const { outcome } = (await resp.json()) as { outcome: { reasonCode?: string } };
    expect(outcome.reasonCode).toBe("CTX_BLOCKED_SECRET");
  });

  test("session commit + memory review + handoff flow", async () => {
    const sessionResp = await fetch(admin("sessions"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ userId: "alice", agentId: "codex", memoryPolicyId: "user_preferences_only" }),
    });
    expect(sessionResp.status).toBe(201);
    const { binding } = (await sessionResp.json()) as { binding: { id: string; status: string } };
    expect(binding.status).toBe("active");

    await fetch(admin(`sessions/${binding.id}/messages`), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ role: "user", content: "For this repo use pnpm, not npm." }),
    });
    const commitResp = await fetch(admin(`sessions/${binding.id}/commit`), { method: "POST", headers: adminHeaders });
    expect(commitResp.status).toBe(200);
    const { binding: committed } = (await commitResp.json()) as { binding: { status: string } };
    expect(committed.status).toBe("committed");

    const handoffResp = await fetch(admin("handoffs"), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        fromAgentId: "research-agent",
        toAgentId: "codex",
        userId: "alice",
        summary: "Check new upstream release.",
        contextRefs: [{ uri: "viking://resources/pao-hubpro/phases/20.51-9router", level: "L1" }],
      }),
    });
    expect(handoffResp.status).toBe(201);
    const { handoff } = (await handoffResp.json()) as { handoff: { id: string; toAgentId: string } };
    const consumeResp = await fetch(admin(`handoffs/${handoff.id}/consume`), {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ agentId: "codex" }),
    });
    expect(consumeResp.status).toBe(200);
  });

  test("unauthorized access is rejected", async () => {
    const resp = await fetch(admin("sources"), { headers: { Authorization: "Bearer not-the-key" } });
    expect(resp.status).toBe(401);
  });
});
