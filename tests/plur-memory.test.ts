// Phase 20.43 — Pao x PLUR Shared Agent Memory Runtime tests (spec §28-§29).
// Scope resolution precedence + project isolation, no-global-on-ambiguity,
// secret guard block/redaction, policy allow/deny/approval, duplicate +
// conflict detection, token budget, disabled no-op path, sync fail-closed,
// injection receipts, engine disclosure, reconciliation no-op honesty.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { PaoMemoryService, getPlurMemoryService, resetPlurMemoryForTests } from "../src/agent-os/plur-memory/service";
import { ScopeResolver, MemorySecretGuard, MemoryPolicyEngine, parseScope } from "../src/agent-os/plur-memory/scopes";
import { LocalFallbackEngine, PlurMemoryAdapter } from "../src/agent-os/plur-memory/engine";
import { MemoryError } from "../src/agent-os/plur-memory/types";

let testDir: string;
let service: PaoMemoryService;

const OPERATOR = undefined; // default operator context

beforeEach(() => {
  closeAgentOsDbForTests();
  resetPlurMemoryForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-pm-test-"));
  process.env.OPENCODEX_HOME = testDir;
  process.env.PAO_MEMORY_ENABLED = "true";
  process.env.PAO_MEMORY_SYNC_ENABLED = "false";
  process.env.PAO_MEMORY_AUTO_LEARN = "false";
  service = getPlurMemoryService();
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetPlurMemoryForTests();
  rmSync(testDir, { recursive: true, force: true });
});

const FAKE_KEY = "sk-" + "a".repeat(24);

// --- scope resolver -------------------------------------------------------------------------

describe("scope resolver", () => {
  test("deterministic precedence: explicit > project > workspace > adapter > session > default > local", () => {
    const resolver = new ScopeResolver("project:pao-hubpro");
    expect(resolver.resolveWriteScope({ explicitScope: "project:alpha" }).scope).toBe("project:alpha");
    expect(resolver.resolveWriteScope({ projectId: "beta" }).scope).toBe("project:beta");
    expect(resolver.resolveWriteScope({ workspaceId: "ws1" }).scope).toBe("workspace:ws1");
    expect(resolver.resolveWriteScope({ agentScopeDefault: "agent:coder" }).scope).toBe("agent:coder");
    expect(resolver.resolveWriteScope({ sessionId: "sess1" }).scope).toBe("local");
    expect(resolver.resolveWriteScope({}).scope).toBe("project:pao-hubpro");
  });

  test("no silent global fallback on ambiguity — safe local fallback instead", () => {
    const resolver = new ScopeResolver("not-a-valid-scope");
    expect(resolver.resolveWriteScope({}).scope).toBe("local");
  });

  test("project isolation: project A cannot read project B scope; global allowed when policy permits", () => {
    const ctx = { actorType: "agent" as const, actorId: "a1", agentId: "a1", agentTrust: "trusted" as const, projectId: "alpha", workspaceId: null, sessionId: null, runId: null, correlationId: "c1" };
    expect(ScopeResolver.canReadScope(ctx, "project:alpha")).toBe(true);
    expect(ScopeResolver.canReadScope(ctx, "project:beta")).toBe(false);
    expect(ScopeResolver.canReadScope(ctx, "global")).toBe(true);
    expect(ScopeResolver.canReadScope(ctx, "local")).toBe(true);
  });

  test("invalid scopes are rejected; sanitized families accepted", () => {
    expect(parseScope("project:alpha")).not.toBeNull();
    expect(parseScope("user:pao")).not.toBeNull();
    expect(parseScope("project:../../etc")).toBeNull();
    expect(parseScope("banana:xyz")).toBeNull();
    expect(parseScope("global")).not.toBeNull();
  });

  test("read expansion never includes unrelated project scopes", () => {
    const resolver = new ScopeResolver("project:pao-hubpro");
    const scopes = resolver.expandReadScopes({ projectId: "alpha", includeGlobal: true });
    expect(scopes).toContain("project:alpha");
    expect(scopes).not.toContain("project:beta");
  });
});

// --- secret guard ------------------------------------------------------------------------------

describe("secret guard", () => {
  test("detects API keys, bearer tokens, JWTs, private keys, env assignments, db URLs", () => {
    const guard = new MemorySecretGuard();
    const cases: Array<[string, string]> = [
      ["openai key " + FAKE_KEY, "openai_key"],
      ["Authorization: Bearer abcdefghijklmnopqrst", "bearer"],
      ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4", "jwt"],
      ["-----BEGIN RSA PRIVATE KEY-----", "private_key"],
      ["API_KEY=supersecret123", "env_assignment"],
      ["postgres://user:pw@db.test/x", "db_url"],
    ];
    for (const [text, category] of cases) {
      const result = guard.scan(text);
      expect(result.clean).toBe(false);
      expect(result.findings.some((finding) => finding.category === category)).toBe(true);
      // fingerprints never contain the raw value
      for (const finding of result.findings) {
        expect(finding.fingerprint.includes(text)).toBe(false);
      }
    }
  });

  test("clean text passes; redaction scrubs findings", () => {
    const guard = new MemorySecretGuard();
    expect(guard.scan("Pao-hubPro uses bun; do not run npm install.").clean).toBe(true);
    const redacted = guard.redact("key " + FAKE_KEY);
    expect(redacted.includes(FAKE_KEY)).toBe(false);
  });
});

// --- policy engine ---------------------------------------------------------------------------------

describe("policy engine", () => {
  test("deny on secrets; approval for rescope to shared; allow project rules from trusted agents", () => {
    const engine = new MemoryPolicyEngine();
    const ctx = { actorType: "agent" as const, actorId: "a1", agentId: "a1", agentTrust: "trusted" as const, projectId: "alpha", workspaceId: null, sessionId: null, runId: null, correlationId: "c1" };
    const denied = engine.evaluate({ operation: "learn", ctx, scope: "project:alpha", sensitivity: "normal", memoryType: "preference", sourceKind: "explicit", secretFindings: 2, contentChars: 100 });
    expect(denied.decision).toBe("deny");
    expect(denied.matchedRuleIds).toContain("deny_secrets");

    const approval = engine.evaluate({ operation: "rescope", ctx, scope: "group:org/team-x", sensitivity: "normal", memoryType: "preference", sourceKind: "explicit", secretFindings: 0, contentChars: 0 });
    expect(approval.decision).toBe("require_approval");

    const allowed = engine.evaluate({ operation: "learn", ctx, scope: "project:alpha", sensitivity: "normal", memoryType: "behavioral_rule", sourceKind: "explicit", secretFindings: 0, contentChars: 0 });
    expect(allowed.decision).toBe("allow");
  });
});

// --- learn / recall / inject / receipts -------------------------------------------------------------

describe("memory lifecycle", () => {
  test("learn → recall within same project (fallback engine disclosed)", async () => {
    const result = await service.learn({
      title: "Package manager convention",
      content: "Pao-hubPro uses bun; do not run npm install.",
      memoryType: "project_convention",
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("active");
    expect(result.engine).toBe("pao-local-fallback"); // PLUR absent in this environment
    const recalled = await service.recall({ query: "bun package manager npm" });
    expect(recalled.results.length).toBeGreaterThanOrEqual(1);
    expect(recalled.results[0].title).toBe("Package manager convention");
    expect(recalled.engine).toBe("pao-local-fallback");
    expect(recalled.fallbackMode).toContain("PLUR unavailable");
  });

  test("exact duplicate strengthens existing memory instead of creating noise", async () => {
    const input = { title: "Deploy rule", content: "Production database migrations require backup verification before apply.", memoryType: "deployment_rule" as const };
    const first = await service.learn(input);
    const second = await service.learn(input);
    expect(second.state).toBe("duplicate");
    expect(second.duplicateOf).toBe(first.engramRegistryId);
  });

  test("fake API key write is blocked; no raw credential in registry or audit", async () => {
    const result = await service.learn({
      title: "My key",
      content: "the key is " + FAKE_KEY,
      memoryType: "note",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("blocked_secret");
    expect(result.reason).toContain("MEMORY_SECRET_DETECTED");
    const serialized = JSON.stringify(service.listEngrams({})) + JSON.stringify(await service.status());
    expect(serialized.includes(FAKE_KEY)).toBe(false);
  });

  test("auto-learn off stores candidates; approval activates; reject blocks", async () => {
    const candidate = await service.learn({
      title: "Candidate rule", content: "prefer pnpm workspaces for monorepos", memoryType: "project_convention", sourceKind: "candidate",
    });
    expect(candidate.state).toBe("candidate");
    expect((await service.recall({ query: "pnpm workspaces" })).results).toHaveLength(0);
    expect(service.approveCandidate(candidate.engramRegistryId as string, "operator")).toBe(true);
    expect((await service.recall({ query: "pnpm workspaces" })).results.length).toBe(1);
    const rejected = await service.learn({ title: "Bad rule", content: "always force push to main", memoryType: "note", sourceKind: "candidate" });
    expect(service.rejectCandidate(rejected.engramRegistryId as string, "operator")).toBe(true);
  });

  test("injection enforces token budget and persists a receipt", async () => {
    await service.learn({ title: "Rule A", content: "constraint text one two three", memoryType: "constraint" });
    await service.learn({ title: "Rule B", content: "another constraint four five six", memoryType: "constraint" });
    const injection = await service.inject({ query: "constraint", budgetTokens: 40 });
    expect(injection.injectedCount).toBeGreaterThanOrEqual(1);
    expect(injection.usedTokens).toBeLessThanOrEqual(40);
    expect(injection.receiptId).toBeDefined();
    const receipts = service.listReceipts(5);
    expect(receipts.some((receipt) => receipt.id === injection.receiptId)).toBe(true);
  });

  test("forget retires; feedback counts stored", async () => {
    const learned = await service.learn({ title: "To forget", content: "stale operational lesson", memoryType: "operational_lesson" });
    await service.feedback(learned.engramRegistryId as string, "positive", "helpful once");
    const forgotten = await service.forget(learned.engramRegistryId as string);
    expect(forgotten.ok).toBe(true);
    const row = service.listEngrams({}).find((engram) => engram.id === learned.engramRegistryId);
    expect(row?.state).toBe("retired");
  });

  test("rescope to shared scope requires approval (policy-gated)", async () => {
    const learned = await service.learn({ title: "private fact", content: "user prefers dark mode terminals", memoryType: "preference", scope: "user:pao" });
    const result = await service.rescope(learned.engramRegistryId as string, "group:org/team-x");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("MEMORY_APPROVAL_REQUIRED");
  });
});

// --- conflicts / episodes / sync / doctor / reconciliation ----------------------------------------------

describe("conflicts, episodes, sync, doctor", () => {
  test("contradiction detection creates a conflict; resolution closes it", async () => {
    await service.learn({ title: "Use bun scripts", content: "always run repository scripts with bun run", memoryType: "project_convention" });
    const conflictId = service.detectConflict("Use bun scripts differently", "do not run repository scripts with bun run", "project:pao-hubpro");
    expect(conflictId).not.toBeNull();
    expect(service.listConflicts().some((conflict) => conflict.id === conflictId)).toBe(true);
    expect(service.resolveConflict(conflictId as string, "keep A", "operator")).toBe(true);
  });

  test("episode capture and timeline retrieval", () => {
    const episode = service.captureEpisode({ summary: "production deploy completed", eventType: "deployment", severity: "info" });
    expect(episode.ok).toBe(true);
    const timeline = service.timeline({ eventType: "deployment" });
    expect(timeline.some((entry) => entry.summary === "production deploy completed")).toBe(true);
  });

  test("sync is disabled by default and fails closed; execute without PLUR is engine-unavailable", async () => {
    const preview = await service.syncPreview("anything");
    expect(preview.ok).toBe(false);
    expect(preview.status).toBe("disabled");
    process.env.PAO_MEMORY_SYNC_ENABLED = "true";
    const gated = new PaoMemoryService({ ...service.config, syncEnabled: true });
    const preview2 = await gated.syncPreview("unknown-profile");
    expect(preview2.status).toBe("blocked");
    expect(preview2.warnings.some((warning) => warning.includes("MEMORY_SYNC_UNSAFE_REMOTE"))).toBe(true);
    const executed = await gated.syncExecute("unknown-profile");
    expect(executed.ok).toBe(false);
  });

  test("doctor returns PASS/WARN/FAIL/MANUAL checks without secrets", async () => {
    const doctor = await service.doctor();
    expect(["healthy", "degraded", "unhealthy"]).toContain(doctor.overall);
    const names = doctor.checks.map((check) => check.name);
    expect(names).toContain("codex-adapter");
    expect(names).toContain("hermes-adapter");
    const codexCheck = doctor.checks.find((check) => check.name === "codex-adapter");
    expect(codexCheck?.severity).toBe("MANUAL");
  });

  test("reconciliation without PLUR is an honest no-op", async () => {
    const report = await service.reconcile();
    expect(report.discovered).toBe(0);
    expect(report.note).toContain("PLUR unavailable");
  });

  test("status discloses engine + adapter registry", async () => {
    const status = await service.status();
    expect(status.engine).toBe("pao-local-fallback");
    expect(status.plurAvailable).toBe(false);
    const keys = status.adapters.map((adapter) => adapter.adapterKey);
    expect(keys).toContain("codex");
    expect(keys).toContain("hermes");
    expect(keys).toContain("mcp");
  });
});

// --- engine behavior --------------------------------------------------------------------------------

describe("engines", () => {
  test("PLUR adapter reports unavailable honestly without the binary", async () => {
    const adapter = new PlurMemoryAdapter();
    const caps = await adapter.capabilities(true);
    expect(caps.cliAvailable).toBe(false);
    expect(caps.detail).toContain("not found");
    expect(await adapter.available()).toBe(false);
  });

  test("local fallback engine learns and recalls scope-filtered", async () => {
    const engine = new LocalFallbackEngine();
    await engine.learn({ title: "alpha rule", content: "alpha content", memoryType: "rule", scope: "project:alpha", visibility: "project" });
    await engine.learn({ title: "beta rule", content: "beta content", memoryType: "rule", scope: "project:beta", visibility: "project" });
    const alpha = await engine.recall({ query: "alpha", scopes: ["project:alpha"], limit: 10 });
    expect(alpha).toHaveLength(1);
    expect(alpha[0].title).toBe("alpha rule");
  });

  test("disabled memory throws MEMORY_DISABLED", async () => {
    const disabled = new PaoMemoryService({ ...service.config, enabled: false });
    await expect(disabled.learn({ title: "x", content: "y", memoryType: "note" })).rejects.toThrow(/MEMORY_DISABLED/);
    resetPlurMemoryForTests();
  });
});
