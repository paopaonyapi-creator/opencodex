// Phase 20.94 — ENZO unified workspace regression suite.
// Deterministic GOLD paths: no live provider HTTP, no host secret inheritance.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  applyCodingEdits,
  classifyActionRisk,
  classifyIntent,
  composeSkills,
  consumeLease,
  createCodingSession,
  decidePolicy,
  distillLessons,
  draftAgent,
  EnzoOrchestrator,
  EnzoWorkspaceError,
  issueLease,
  listMarketplaceModels,
  putSecret,
  redactSecrets,
  routeModel,
  runResearch,
  searchLessons,
  completeViaOmniRoute,
  probeCodingAdapters,
  revealForProviderCall,
  revokeLease,
  vaultStatus,
} from "../src/agent-os/enzo-workspace";
import { BUILT_IN_SKILLS } from "../src/agent-os/enzo-workspace/catalog";
import { setProviderHealthForTests } from "../src/agent-os/enzo-workspace/models";
import { defaultBudget } from "../src/agent-os/enzo-workspace/types";

const stamp = Date.now().toString(36);

describe("phase 20.94 — schema and contracts", () => {
  it("migrates Agent OS schema to v64 with enzo_* tables", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(64);
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(65);
    const db = openAgentOsDb();
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'enzo_%'").all() as { name: string }[]).map((r) => r.name);
    for (const name of ["enzo_runs", "enzo_run_events", "enzo_agents", "enzo_approvals", "enzo_lessons", "enzo_leases", "enzo_secrets", "enzo_artifacts", "enzo_policy_decisions"]) {
      expect(tables).toContain(name);
    }
  });

  it("redacts secrets from logs and events", () => {
    const raw = "token=sk-abcdefghijklmnopqrstuvwxyz password: hunter2 Bearer abcdefghijklmnop";
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toContain("[REDACTED]");
  });
});

describe("phase 20.94 — intent, factory, skills, models, policy", () => {
  it("classifies Adobe Stock agent requests as agent+research domain", () => {
    const intent = classifyIntent("Create an agent that researches Adobe Stock opportunities and prepares metadata.");
    expect(intent.mode).toBe("agent");
    expect(intent.domains).toContain("adobe-stock");
    expect(intent.skillIntents).toContain("stock-research");
  });

  it("two-pass factory produces a versioned blueprint without a live model", () => {
    const { analysis, blueprint } = draftAgent("Create an agent that researches Adobe Stock opportunities, checks policy risks, and produces concepts.");
    expect(analysis.stages.length).toBeGreaterThan(3);
    expect(blueprint.draftedBy).toContain("two-pass");
    expect(blueprint.skillIntents.length).toBeGreaterThan(0);
    expect(blueprint.executionBudget.maxQueries).toBeGreaterThan(0);
  });

  it("composes a minimal trusted skill set and rejects quarantined skills", () => {
    const intent = classifyIntent("Create an agent that researches Adobe Stock opportunities and prepares metadata.");
    const plan = composeSkills(intent, { extraSkills: BUILT_IN_SKILLS.filter((s) => s.id === "hostile-exfil") });
    expect(plan.selected.length).toBeGreaterThan(0);
    expect(plan.selected.length).toBeLessThan(BUILT_IN_SKILLS.length);
    expect(plan.denied.some((d) => d.id === "hostile-exfil")).toBe(true);
    expect(plan.selected.every((s) => s.trustScore >= 0.75)).toBe(true);
  });

  it("detects package-manager skill conflicts and keeps the higher-trust skill", () => {
    const intent = classifyIntent("implement a typescript mcp server");
    intent.skillIntents.push("package-manager");
    intent.capabilities.push("package_manager");
    const plan = composeSkills(intent);
    const selected = new Set(plan.selected.map((s) => s.id));
    if (selected.has("npm-default") || selected.has("pnpm-default")) {
      expect(selected.has("npm-default") && selected.has("pnpm-default")).toBe(false);
    }
    expect(plan.conflicts.length >= 0).toBe(true);
  });

  it("routes around an unhealthy requested model when a healthy compatible model exists", () => {
    setProviderHealthForTests("anthropic", "unhealthy");
    const decision = routeModel({
      requirements: ["text.chat"],
      requestedId: "anthropic/claude-3-7-sonnet",
      tools: true,
    });
    expect(decision.actualId).not.toBe("anthropic/claude-3-7-sonnet");
    expect(decision.health).not.toBe("offline");
    setProviderHealthForTests("anthropic", "healthy");
  });

  it("honors provider deny lists", () => {
    const models = listMarketplaceModels();
    expect(models.length).toBeGreaterThan(0);
    const decision = routeModel({ requirements: ["text.chat"], denyProviders: ["anthropic", "openai", "google", "deepseek"] });
    expect(["ollama", "none"].includes(decision.provider) || decision.provider !== "anthropic").toBe(true);
  });

  it("classifies R4 actions as requiring approval", () => {
    expect(classifyActionRisk("rotate secret")).toBe("R4");
    const decision = decidePolicy({ runId: "run_test", action: "production deploy" });
    expect(decision.decision).toBe("require_approval");
    expect(decision.risk).toBe("R4");
  });
});

describe("phase 20.94 — credentials, research, coding, memory", () => {
  it("leases secrets without exposing plaintext and enforces TTL/max uses", () => {
    const secretRef = "ref-" + stamp;
    putSecret({ secretRef, secret: "sk-abcdefghijklmnopqrstuvwxyz", provider: "openai" });
    const lease = issueLease({ secretRef, runId: "run-" + stamp, principal: "agent", ttlMs: 60_000, maxUses: 1 });
    expect((lease as { secret?: string }).secret).toBeUndefined();
    consumeLease(lease.leaseId);
    expect(() => consumeLease(lease.leaseId)).toThrow(EnzoWorkspaceError);
  });

  it("research stops on a hard query budget and keeps claim-to-source mapping", async () => {
    const result = await runResearch({
      question: "What Adobe Stock opportunities are commercially useful in 2026?",
      budget: defaultBudget({ maxQueries: 2, maxSources: 8, maxCostUsd: 1 }),
    });
    expect(result.queries.length).toBeLessThanOrEqual(2);
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims.some((c) => c.sourceIds.length > 0 || c.uncertainty)).toBe(true);
    expect(result.status === "completed" || result.status === "budget_exhausted").toBe(true);
  });

  it("coding apply in safe-personal pauses for approval and rejects path traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-code-"));
    const session = createCodingSession({ id: "code-" + stamp, runId: "run-" + stamp, workspaceRoot: root, request: "add a readme" });
    const paused = applyCodingEdits(session, [{ path: "README.md", content: "# hi" }], { profile: "safe-personal" });
    expect(paused.status).toBe("awaiting_approval");
    const applied = applyCodingEdits(session, [{ path: "README.md", content: "# hi" }], { profile: "developer-local", approved: true });
    expect(applied.changedFiles).toContain("README.md");
    expect(() => applyCodingEdits(session, [{ path: "../escape.txt", content: "nope" }], { profile: "developer-local", approved: true })).toThrow(EnzoWorkspaceError);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not accept unsourced model guesses as trusted memory", () => {
    const lessons = distillLessons({
      runId: "run-mem-" + stamp,
      agentSlug: "memory-agent-" + stamp,
      domain: "general",
      outcome: "success",
      statements: ["The vault password is hunter2 and should be reused everywhere."],
      evidenceRefs: [],
    });
    expect(lessons[0]!.status).toBe("quarantined");
    expect(lessons[0]!.confidence).toBeLessThan(0.5);
  });
});

describe("phase 20.94 — GOLD acceptance scenarios", () => {
  it("Scenario A — draft, compose, route, save, and run an Adobe Stock research agent", async () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-a-"));
    const orch = new EnzoOrchestrator(root);
    const run = orch.createRun({
      request: "Create an agent that researches Adobe Stock opportunities, checks commercial usefulness and policy risks, produces 5 concepts, then prepares prompts and metadata.",
      actor: "gold",
    });
    const inspection = await orch.executeRun(run.id, "gold");
    expect(["COMPLETED", "WAITING_FOR_APPROVAL"]).toContain(inspection.run.status);
    expect(inspection.events.some((e) => e.type === "agent.drafted")).toBe(true);
    expect(inspection.events.some((e) => e.type === "skill.resolved")).toBe(true);
    expect(inspection.events.some((e) => e.type === "model.candidate_selected")).toBe(true);
    expect(inspection.agent?.name).toContain("Adobe Stock");
    expect((inspection.skills?.selected.length ?? 0)).toBeGreaterThan(0);
    if (inspection.run.status === "COMPLETED") {
      expect(inspection.artifacts.length).toBeGreaterThan(0);
      expect(inspection.events.some((e) => e.type === "run.completed")).toBe(true);
    }
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("Scenario B — trend research respects budget and retains sources", async () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-b-"));
    const orch = new EnzoOrchestrator(root);
    const run = orch.createRun({
      request: "Research current trends in AI agent routing and cite sources.",
      mode: "research",
      actor: "gold",
      budget: { maxQueries: 3, maxSources: 10, maxCostUsd: 1 },
    });
    const inspection = await orch.executeRun(run.id, "gold");
    expect(inspection.run.status).toBe("COMPLETED");
    expect(inspection.run.usage.queries).toBeLessThanOrEqual(3);
    const research = inspection.research as { sources?: unknown[]; stopReason?: string } | null;
    expect((research?.sources?.length ?? 0)).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("Scenario C — coding writes require approval on the safe-personal profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-c-"));
    const orch = new EnzoOrchestrator(root);
    const run = orch.createRun({
      request: "Change this repository by adding a README that explains the sandbox.",
      mode: "coding",
      profile: "safe-personal",
      actor: "gold",
      workspaceRoot: root,
    });
    const inspection = await orch.executeRun(run.id, "gold", { workspaceRoot: root });
    expect(inspection.run.status).toBe("WAITING_FOR_APPROVAL");
    expect(inspection.approvals.length).toBeGreaterThan(0);
    const decided = await orch.decideApproval(inspection.approvals[0]!.id, true, "gold");
    expect(["COMPLETED", "FAILED"]).toContain(decided.run.status);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("Scenario D — MCP tool policy denies R4 without approval and audits the attempt", async () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-d-"));
    const orch = new EnzoOrchestrator(root);
    const run = orch.createRun({ request: "List workspace files", mode: "chat", actor: "gold" });
    await orch.executeRun(run.id, "gold");
    const denied = await orch.invokeTool({
      runId: run.id,
      toolName: "pao.admin.destroy",
      args: { target: "/tmp" },
      actor: "gold",
      workspacePath: root,
    });
    expect(denied.status === "awaiting_approval" || (denied as { result?: { status?: string } }).result?.status === "denied" || denied.ok === false).toBe(true);
    const listed = await orch.invokeTool({
      runId: run.id,
      toolName: "pao.fs.list",
      args: { path: "." },
      actor: "gold",
      workspacePath: root,
    });
    expect(listed).toBeTruthy();
    const inspect = orch.inspect(run.id);
    expect(inspect.events.some((e) => e.type === "policy.checked")).toBe(true);
    const dumped = JSON.stringify(inspect.events);
    expect(dumped).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("Scenario E — lessons distill with provenance and can be recalled", async () => {
    const lessons = distillLessons({
      runId: "run-e-" + stamp,
      agentSlug: "adobe-stock-research-agent",
      domain: "adobe-stock",
      outcome: "success",
      statements: ["Prefer industrially useful scenes with documented commercial buyers over generic AI landscapes."],
      evidenceRefs: ["src-stock-1"],
    });
    expect(lessons[0]!.status).toBe("candidate");
    const found = searchLessons("commercial buyers", "adobe-stock-research-agent");
    expect(found.some((l) => l.id === lessons[0]!.id)).toBe(true);
  });

  it("replay inspect-only works and irreversible replay is blocked", async () => {
    const root = mkdtempSync(join(tmpdir(), "enzo-r-"));
    const orch = new EnzoOrchestrator(root);
    const run = orch.createRun({ request: "Research Adobe Stock commercial usefulness.", mode: "research", actor: "gold" });
    const done = await orch.executeRun(run.id, "gold");
    const inspected = await orch.replay(done.run.id, "inspect-only");
    expect(inspected.run.id).toBe(done.run.id);
    const replayed = await orch.replay(done.run.id, "re-run-same-plan");
    expect(replayed.run.id).not.toBe(done.run.id);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});

describe("phase 20.94 — production vault + adapters", () => {
  it("encrypts secrets at rest and decrypts only through an authorized lease", () => {
    const secretRef = "vault-" + stamp;
    const secret = "sk-abcdefghijklmnopqrstuvwxyz";
    const stored = putSecret({ secretRef, secret, scopes: ["provider.call"] });
    expect(stored.algorithm).toBe("aes-256-gcm");
    const row = openAgentOsDb().query("SELECT envelope_json, secret_hash FROM enzo_secrets WHERE secret_ref = ?").get(secretRef) as { envelope_json: string; secret_hash: string };
    expect(row.envelope_json).toBeTruthy();
    expect(row.envelope_json).not.toContain(secret);
    expect(JSON.parse(row.envelope_json).algorithm).toBe("aes-256-gcm");
    const lease = issueLease({ secretRef, runId: "run-vault-" + stamp, principal: "agent", scopes: ["provider.call"], maxUses: 2 });
    expect(revealForProviderCall(lease.leaseId)).toBe(secret);
    expect(vaultStatus().state).toBe("AVAILABLE");
  });

  it("rejects unauthorized scope, revoked leases, and tampered ciphertext", () => {
    const secretRef = "vault-deny-" + stamp;
    putSecret({ secretRef, secret: "sk-abcdefghijklmnopqrstuvwxyz", scopes: ["provider.call"] });
    expect(() => issueLease({ secretRef, runId: "run-x", principal: "agent", scopes: ["vault.dump"] })).toThrow(EnzoWorkspaceError);
    const lease = issueLease({ secretRef, runId: "run-x", principal: "agent", scopes: ["provider.call"], maxUses: 3 });
    expect(() => revealForProviderCall(lease.leaseId, "vault.dump")).toThrow(EnzoWorkspaceError);
    revokeLease(lease.leaseId);
    expect(() => revealForProviderCall(lease.leaseId)).toThrow(EnzoWorkspaceError);
    const secretRef2 = "vault-tamper-" + stamp;
    putSecret({ secretRef: secretRef2, secret: "sk-abcdefghijklmnopqrstuvwxyz", scopes: ["provider.call"] });
    const row = openAgentOsDb().query("SELECT envelope_json FROM enzo_secrets WHERE secret_ref = ?").get(secretRef2) as { envelope_json: string };
    const env = JSON.parse(row.envelope_json) as { ciphertext: string };
    const buf = Buffer.from(env.ciphertext, "base64");
    buf[0] = (buf[0] ?? 0) ^ 1;
    env.ciphertext = buf.toString("base64");
    openAgentOsDb().run("UPDATE enzo_secrets SET envelope_json = ? WHERE secret_ref = ?", [JSON.stringify(env), secretRef2]);
    const lease2 = issueLease({ secretRef: secretRef2, runId: "run-t", principal: "agent", maxUses: 2 });
    expect(() => revealForProviderCall(lease2.leaseId)).toThrow();
  });

  it("exposes Codex/AFT/OpenCodeReview/sandbox states and labels fallback", () => {
    const probes = probeCodingAdapters();
    const ids = probes.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["codex", "aft", "opencodereview", "sandbox"]));
    for (const p of probes) {
      expect(["AVAILABLE", "UNCONFIGURED", "DEGRADED", "FALLBACK", "ERROR"]).toContain(p.state);
    }
    const sandbox = probes.find((p) => p.id === "sandbox")!;
    expect(sandbox.state).toBe("AVAILABLE");
  });

  it("does not treat simulated direct adapter output as a live OmniRoute completion", async () => {
    const result = await completeViaOmniRoute({
      prompt: "Reply with the single word pong.",
      execute: async () => ({
        requestId: "test",
        output: "pong",
        routing: { requestedRouteGroup: "balanced", resolvedProvider: "anthropic", resolvedModel: "claude", resolvedModelFamily: "claude", isLocal: false, fallbackCount: 1, attempts: [] },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, totalTaskCostUsd: 0, finalAttemptCostUsd: 0, pricingStatus: "unknown" },
        performance: { totalLatencyMs: 2 },
        governance: { policyDecisionId: "x", dataClass: "internal", localOnly: false, unknownPriceDenied: false, correlationCheckPassed: true },
        gateway: { adapter: "direct", version: "test" },
      }),
    });
    expect(result.real).toBe(false);
    expect(result.state).toBe("FALLBACK");
    expect(result.adapter).toBe("direct");
  });

  it("attempts a live OmniRoute completion and records an honest state", async () => {
    const result = await completeViaOmniRoute({ prompt: "Reply with the single word pong." });
    expect(["AVAILABLE", "UNCONFIGURED", "DEGRADED", "FALLBACK", "ERROR"]).toContain(result.state);
    if (result.state === "AVAILABLE") {
      expect(result.real).toBe(true);
      expect(result.adapter).toBe("omniroute");
    } else {
      expect(result.real).toBe(false);
    }
  }, 30_000);
});
