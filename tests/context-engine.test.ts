/**
 * Pao Context Control Plane — Phase 20.53 engine tests against a mock
 * OpenViking HTTP surface (hermetic; no real backend, no network beyond
 * loopback).
 *
 * Covers spec §126-129: capability probing, adapter normalization, ingestion
 * idempotency and blocking, retrieval policy reason codes, budget truncation,
 * suppression/pending exclusion, fail-early scope denial, breaker degradation,
 * memory governance defaults and review gates, sessions, and handoffs.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { OpenVikingAdapter } from "../src/agent-os/context/adapter/openviking";
import { ContextBackendBreaker } from "../src/agent-os/context/resilience";
import { ContextIngestPipeline } from "../src/agent-os/context/ingest";
import { RetrievalEngine, packBudget } from "../src/agent-os/context/retrieval";
import { MemoryGovernanceService, computeExperienceConfidence } from "../src/agent-os/context/governance";
import { ContextSessionService, HandoffService } from "../src/agent-os/context/sessions";
import { ContextDbStore } from "../src/agent-os/context/db-store";
import { ContextService } from "../src/agent-os/context/service";
import { loadContextConfig, BUDGET_PROFILES } from "../src/agent-os/context/config";
import type { ContextRetrievalRequest } from "../src/agent-os/context/types";

// ---------------------------------------------------------------------------
// Mock OpenViking
// ---------------------------------------------------------------------------

const MOCK_PORT = 19971;
const DOC_2051 = "# Phase 20.51 — 9Router AI Gateway\n\nPao owns policy; 9Router owns provider connectivity.";
const DOC_2053 = "# Phase 20.53 — Context Control Plane\n\nPao owns context governance; OpenViking owns viking:// storage.";
const USER_MEMORY_URI = "viking://user/alice/memories/pref-coding-style";
const USER_OTHER_URI = "viking://user/bob/memories/private-note";

let sessionCounter = 0;
const mockServer = Bun.serve({
  port: MOCK_PORT,
  fetch: async req => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", version: "v-mock-1" });
    }
    if (url.pathname === "/mcp") {
      return Response.json({ capabilities: {} });
    }
    if (url.pathname === "/api/viking/list") {
      return Response.json({ entries: [{ uri: "viking://resources/pao-hubpro/phases/", kind: "directory" }] });
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return Response.json({ sessions: [] });
    }
    if (url.pathname === "/api/viking/search" && req.method === "POST") {
      return Response.json({
        results: [
          { uri: "viking://resources/pao-hubpro/phases/20.51-9router", score: 0.94 },
          { uri: USER_MEMORY_URI, score: 0.81 },
          { uri: USER_OTHER_URI, score: 0.72 },
        ],
      });
    }
    if (url.pathname === "/api/viking/read") {
      const uri = url.searchParams.get("uri") ?? "";
      if (uri.includes("20.51")) return Response.json({ uri, content: DOC_2051, level: "L0" });
      if (uri.includes("alice")) return Response.json({ uri, content: "Prefers Bun and TypeScript.", level: "L0" });
      return Response.json({ uri, content: "Bob's private note.", level: "L0" });
    }
    if (url.pathname === "/api/resources/add" && req.method === "POST") {
      return Response.json({ task_id: `task-${Date.now()}` });
    }
    if (url.pathname === "/api/tasks") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      sessionCounter += 1;
      return Response.json({ session_id: `sess-${sessionCounter}` });
    }
    if (url.pathname === "/api/sessions/messages" && req.method === "POST") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/sessions/commit" && req.method === "POST") {
      return Response.json({ task_id: "commit-1" });
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => {
  mockServer.stop(true);
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const tempHomes: string[] = [];
let store: ContextDbStore;

function freshEnv(): void {
  const dir = mkdtempSync(join(tmpdir(), "context-eng-"));
  tempHomes.push(dir);
  process.env.OPENCODEX_HOME = dir;
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
  store = new ContextDbStore();
  store.init();
}

afterAll(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) {
    try {
      rmSync(tempHomes.pop()!, { recursive: true, force: true });
    } catch {}
  }
  delete process.env.MARKET_TEST_FIXTURE_KEY;
});

const PHASE_2051_URI = "viking://resources/pao-hubpro/phases/20.51-9router";

function retrievalRequest(overrides: Partial<ContextRetrievalRequest> = {}): ContextRetrievalRequest {
  return {
    requestId: `req-${Date.now()}`,
    userId: "alice",
    agentId: "codex",
    taskType: "coding",
    query: "How does Pao-hubPro route providers?",
    allowedScopes: ["shared", "user"],
    allowedRoots: ["viking://resources/pao-hubpro/", "viking://user/alice/"],
    budget: { ...BUDGET_PROFILES.coding },
    trace: true,
    ...overrides,
  };
}

describe("Phase 20.53 — adapter capabilities and ingestion", () => {
  beforeAll(() => {
    freshEnv();
  });

  test("capability probe verifies the resource, session and MCP surfaces", async () => {
    const adapter = new OpenVikingAdapter({ baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKeyEnv: "CTX_TEST_KEY", timeoutMs: 5000 });
    const probe = await adapter.probeCapabilities();
    expect(probe.status).toBe("compatible");
    expect(probe.serverVersion).toBe("v-mock-1");
    expect(probe.capabilities.resources).toBe(true);
    expect(probe.capabilities.sessions).toBe(true);
    expect(probe.capabilities.mcp).toBe(true);
    // Unverifiable capabilities are reported as false with an explicit warning,
    // never silently emulated.
    expect(probe.capabilities.acl).toBe(false);
    expect(probe.capabilities.warnings.length).toBeGreaterThan(0);
  });

  test("ingestion is idempotent: identical content is not resubmitted", async () => {
    const adapter = new OpenVikingAdapter({ baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKeyEnv: "CTX_TEST_KEY", timeoutMs: 5000 });
    const pipeline = new ContextIngestPipeline({ store, adapter });
    const first = await pipeline.ingest({
      sourceType: "phase_spec",
      sourceLocator: "docs/phases/phase-20.51.md",
      path: "docs/phases/phase-20.51.md",
      content: DOC_2051,
    });
    expect(first.ok).toBe(true);
    expect(first.status).toBe("ready");
    expect(first.targetUri).toContain("phases/");

    const second = await pipeline.ingest({
      sourceType: "phase_spec",
      sourceLocator: "docs/phases/phase-20.51.md",
      path: "docs/phases/phase-20.51.md",
      content: DOC_2051,
    });
    expect(second.status).toBe("skipped_idempotent");
  });

  test("secret-bearing documents are blocked before the backend sees them", async () => {
    const adapter = new OpenVikingAdapter({ baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKeyEnv: "CTX_TEST_KEY", timeoutMs: 5000 });
    const pipeline = new ContextIngestPipeline({ store, adapter });
    const outcome = await pipeline.ingest({
      sourceType: "markdown",
      sourceLocator: "docs/notes/config.md",
      path: "docs/notes/config.md",
      content: `Deploy using the key ${`sk-${"b".repeat(24)}`} tomorrow.`,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reasonCode).toBe("CTX_BLOCKED_SECRET");
    expect(outcome.status).toBe("blocked");
  });

  test("records with CTX_BLOCKED_SECRET never persist real content previews", async () => {
    const adapter = new OpenVikingAdapter({ baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKeyEnv: "CTX_TEST_KEY", timeoutMs: 5000 });
    const pipeline = new ContextIngestPipeline({ store, adapter });
    await pipeline.ingest({
      sourceType: "markdown",
      sourceLocator: "docs/notes/config2.md",
      path: "docs/notes/config2.md",
      content: `token: ${`ghp_${"c".repeat(24)}`}`,
    });
    for (const memory of store.listMemoryGovernance()) {
      expect(memory.contentPreview ?? "").not.toContain("ghp_");
    }
  });
});

describe("Phase 20.53 — governed retrieval", () => {
  let service: ContextService;

  beforeAll(() => {
    freshEnv();
    // Reviewer permission is read from env at service construction.
    process.env.PAO_CONTEXT_REVIEWER_ACTORS = "admin";
    const config = {
      ...loadContextConfig(),
      enabled: true,
      backendBaseUrl: `http://127.0.0.1:${MOCK_PORT}`,
    };
    service = new ContextService({ config });
  });

  test("returns shared resources with reason codes and excludes other users' scope", async () => {
    const response = await service.retrieve(retrievalRequest());
    expect(response.status).toBe("ok");
    const allowed = response.items.filter(i => i.allowed);
    const rejected = response.items.filter(i => !i.allowed);
    expect(allowed.some(i => i.uri === PHASE_2051_URI)).toBe(true);
    expect(allowed.find(i => i.uri === PHASE_2051_URI)?.reason).toBe("CTX_ALLOWED_SHARED_RESOURCE");
    // Bob's memory is under another user's namespace -> scope denial.
    expect(rejected.some(i => i.uri === USER_OTHER_URI && i.exclusionReason === "CTX_BLOCKED_SCOPE")).toBe(true);
    // Alice's own memory is allowed within her root.
    expect(allowed.some(i => i.uri === USER_MEMORY_URI && i.reason === "CTX_ALLOWED_USER_MEMORY")).toBe(true);
  });

  test("budget truncation is safe and explained", async () => {
    const response = await service.retrieve(
      retrievalRequest({
        budget: { ...BUDGET_PROFILES.fast, maxResults: 1, maxEstimatedTokens: 10 },
      }),
    );
    expect(response.truncated).toBe(true);
    expect(response.budget.estimatedTokens).toBeLessThanOrEqual(10);
    expect(response.injectionPlan.truncated === false || response.injectionPlan.items.length <= 1).toBe(true);
  });

  test("suppressed and pending-review memory is excluded from injection", async () => {
    const suppressed = service.memory.registerCandidate({
      memoryUri: USER_MEMORY_URI,
      ownerUserId: "alice",
      contentPreview: "Prefers Bun and TypeScript.",
    });
    expect(suppressed.record?.reviewState).toBe("auto_accepted_private");
    service.memory.suppress(suppressed.record!.id, "admin", "operator suppression", );

    const response = await service.retrieve(retrievalRequest());
    const hit = response.items.find(i => i.uri === USER_MEMORY_URI);
    expect(hit?.allowed).toBe(false);
    expect(hit?.exclusionReason).toBe("CTX_BLOCKED_SUPPRESSED");
  });

  test("cross-user roots fail early without contacting the backend", async () => {
    const response = await service.retrieve(
      retrievalRequest({ allowedRoots: ["viking://user/bob/"] }),
    );
    expect(response.status).toBe("blocked");
    expect(response.degradedReason).toBe("CTX_BLOCKED_SCOPE");
    // The audit trail records the denial with the reason code.
    const denial = service.auditTrail({ eventType: "context.retrieval.blocked", limit: 5 });
    expect(denial.some(a => a.reasonCode === "CTX_BLOCKED_SCOPE")).toBe(true);
  });

  test("backend unreachable degrades gracefully and opens the breaker", async () => {
    const deadConfig = {
      ...loadContextConfig(),
      enabled: true,
      backendBaseUrl: "http://127.0.0.1:1", // nothing listens here
    };
    const deadService = new ContextService({ config: deadConfig });
    const response = await deadService.retrieve(retrievalRequest());
    expect(response.status).toBe("blocked");
    expect(response.degradedReason).toBe("CTX_BACKEND_UNAVAILABLE");
    expect(deadService.breaker.snapshot().state).toBe("open");
    expect(deadService.health().circuitBreaker).toBe("open");
  });
});

describe("Phase 20.53 — memory governance and experience", () => {
  let service: ContextService;

  beforeAll(() => {
    freshEnv();
    process.env.PAO_CONTEXT_REVIEWER_ACTORS = "admin";
    const config = {
      ...loadContextConfig(),
      enabled: true,
      backendBaseUrl: `http://127.0.0.1:${MOCK_PORT}`,
    };
    service = new ContextService({ config });
  });

  afterAll(() => {
    delete process.env.PAO_CONTEXT_REVIEWER_ACTORS;
  });

  test("review state defaults: private auto-accepts, shared pends, secrets reject", () => {
    const priv = service.memory.registerCandidate({
      memoryUri: "viking://user/alice/memories/pref-1",
      ownerUserId: "alice",
      contentPreview: "Prefers short commit messages.",
    });
    expect(priv.record?.reviewState).toBe("auto_accepted_private");
    expect(priv.rejectedForSecret).toBe(false);

    const shared = service.memory.registerCandidate({
      memoryUri: "viking://resources/pao-hubpro/docs/lessons/lesson-1",
      workspaceId: "ws_pao",
      contentPreview: "This repo migrated to pnpm.",
    });
    expect(shared.record?.reviewState).toBe("pending_review");

    const secret = service.memory.registerCandidate({
      memoryUri: "viking://user/alice/memories/leak-attempt",
      ownerUserId: "alice",
      contentPreview: `My key is ${`sk-${"d".repeat(24)}`}`,
    });
    expect(secret.rejectedForSecret).toBe(true);
    expect(secret.record?.reviewState).toBe("rejected");
    expect(secret.record?.riskLevel).toBe("high");
  });

  test("non-reviewers cannot act; reviewers approve and pin", () => {
    const { record } = service.memory.registerCandidate({
      memoryUri: "viking://resources/pao-hubpro/docs/lessons/lesson-2",
      workspaceId: "ws_pao",
      contentPreview: "Always run typecheck before commit.",
    });
    expect(() => service.memory.approve(record!.id, "random-user")).toThrow(/not permitted/);
    const approved = service.memory.approve(record!.id, "admin");
    expect(approved.reviewState).toBe("approved");
    const pinned = service.memory.pin(record!.id, "admin", "stable convention");
    expect(pinned.pinned).toBe(true);
  });

  test("promotion of shared knowledge records provenance", () => {
    const { record } = service.memory.registerCandidate({
      memoryUri: "viking://resources/pao-hubpro/docs/lessons/lesson-3",
      workspaceId: "ws_pao",
      contentPreview: "Retry with backoff on provider 429s.",
    });
    const promoted = service.memory.promote(record!.id, "admin", "shared_architecture_invariant", "viking://resources/pao-hubpro/docs/lessons/retry.md");
    expect(promoted.reviewState).toBe("approved");
    expect(promoted.notes).toContain("promoted as shared_architecture_invariant");
    expect(promoted.notes).toContain("provenance");
  });

  test("experience confidence is advisory and reacts to evidence", () => {
    expect(computeExperienceConfidence({ reuseCount: 0, successCount: 0, failureCount: 0, humanApproved: false, now: Date.now })).toBe(0);
    const good = computeExperienceConfidence({ reuseCount: 6, successCount: 6, failureCount: 0, humanApproved: true, lastUsedAt: new Date().toISOString(), now: Date.now });
    const bad = computeExperienceConfidence({ reuseCount: 6, successCount: 0, failureCount: 6, humanApproved: false, now: Date.now });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(1);
  });
});

describe("Phase 20.53 — sessions and handoffs", () => {
  let service: ContextService;

  beforeAll(() => {
    freshEnv();
    const config = {
      ...loadContextConfig(),
      enabled: true,
      backendBaseUrl: `http://127.0.0.1:${MOCK_PORT}`,
    };
    service = new ContextService({ config });
  });

  test("session binding lifecycle: create, append, commit (idempotent)", async () => {
    const binding = await service.sessions.createSession({
      paoConversationId: "conv-1",
      userId: "alice",
      agentId: "codex",
      memoryPolicyId: "user_preferences_only",
    });
    expect(binding.status).toBe("active");
    await service.sessions.appendMessage(binding.id, "user", "Add quota failover to Pao-hubPro");
    const committed = await service.sessions.commit(binding.id);
    expect(committed.status).toBe("committed");
    const again = await service.sessions.commit(binding.id);
    expect(again.status).toBe("committed");
  });

  test("handoffs are URI-referencing and only consumable by the target agent", () => {
    const handoff = service.handoffs.create({
      fromAgentId: "research-agent",
      toAgentId: "codex",
      userId: "alice",
      summary: "Upstream OpenViking released a new version; re-check capabilities.",
      contextRefs: [{ uri: PHASE_2051_URI, level: "L1" }],
      pendingActions: ["Run capability probe"],
      ttlMinutes: 60,
    });
    const consumed = service.handoffs.consume(handoff.id, "codex");
    expect(consumed.contextRefs[0]?.uri).toBe(PHASE_2051_URI);
    expect(() => service.handoffs.consume(handoff.id, "hermes")).toThrow(/addressed to another agent/);
  });
});
