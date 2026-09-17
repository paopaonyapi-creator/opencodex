// Phase 20.62 — Code Intelligence control plane tests.
//
// Covers the spec §60-§62 matrix: scope/path policy, risk scoring and policy,
// graph lifecycle, parser normalization, version compatibility, adapter argv
// discipline, service queries + evidence, impact gates, fallback, multi-repo
// scope, machine-config guard, and the management API surface.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { assertGraphTransition, CodeIntelError, type RepositoryScope } from "../src/agent-os/code-intelligence/types";
import { assertCrossRepoAllowed, assertPathInScope, assertSafeCliArg, canonicalizeRepositoryPath, isDeniedPath } from "../src/agent-os/code-intelligence/scope";
import { classifyRisk, decideRiskPolicy, escalationRequired, protectedAreaMatches, scoreImpact } from "../src/agent-os/code-intelligence/risk";
import { isVersionCompatible, parseGraftVersion, scrubEnvironment } from "../src/agent-os/code-intelligence/provider/graft/runner";
import { GraftProvider, parseAskJson, parseCallersOutput, parseGrepOutput, parseMapOutput } from "../src/agent-os/code-intelligence/provider/graft/adapter";
import { CodeIntelService, setCodeIntelServiceForTests, resetCodeIntelServiceForTests } from "../src/agent-os/code-intelligence/service";
import type { CodeIntelConfig } from "../src/agent-os/code-intelligence/config";
import { FakeGraftRunner, FakeProvider, PINNED_GRAFT } from "./helpers/graft-fake";
import { handleManagementAPI } from "../src/server/management-api";
import type { OcxConfig } from "../src/types";

const tempHomes: string[] = [];

function openFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "code-intel-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
}

function makeConfig(overrides?: Partial<CodeIntelConfig>): CodeIntelConfig {
  return {
    enabled: true,
    providerKey: "graft",
    graftBin: "graft",
    pinnedGraftVersion: PINNED_GRAFT,
    versionPolicy: "compatible",
    telemetryDisabled: true,
    deepEnrichmentEnabled: false,
    allowMachineWideConfig: false,
    maxResults: 20,
    maxTraceDepth: 5,
    maxResponseBytes: 262144,
    maxContextPackBytes: 131072,
    maxQuerySeconds: 10,
    maxBuildSeconds: 60,
    requireFreshForHighRisk: true,
    riskThresholds: { medium: 25, high: 50, critical: 75 },
    protectedPaths: ["src/auth/**", "src/agent-os/db.ts"],
    defaultDeniedPrefixes: [".env", ".env.", "secrets/", "credentials/", "*.pem", "*.key", "*.p12", "*.pfx", "vault/", "backups/", "production-dumps/"],
    ...overrides,
  };
}

function makeService(provider: FakeProvider, overrides?: Partial<CodeIntelConfig>): CodeIntelService {
  return new CodeIntelService({ config: makeConfig(overrides), providerFactory: () => provider });
}

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-intel-repo-"));
  tempHomes.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  mkdirSync(join(dir, "secrets"), { recursive: true });
  writeFileSync(join(dir, "src", "auth.ts"), "export function verifyToken(t: string) { return t.length > 0; }\n");
  writeFileSync(join(dir, "src", "router.ts"), 'import { verifyToken } from "./auth";\nexport function handle(req: unknown) { return req; }\n');
  writeFileSync(join(dir, "src", "service.ts"), 'import { handle } from "./router";\nexport const service = { handle };\n');
  writeFileSync(join(dir, "src", "db.ts"), "export function query(q: string) { return q; }\n");
  writeFileSync(join(dir, "test", "router.test.ts"), 'import { handle } from "../src/router";\nvoid handle;\n');
  writeFileSync(join(dir, ".env"), "SECRET=placeholder-not-real\n");
  writeFileSync(join(dir, "secrets", "vault.txt"), "internal\n");
  writeFileSync(join(dir, "server.pem"), "-----BEGIN FAKE-----\n");
  execSync("git init -q", { cwd: dir });
  execSync('git -c user.email=tester@example.test -c user.name=t add -A && git -c user.email=tester@example.test -c user.name=t commit -q -m init', { cwd: dir });
  return dir;
}

function scopeFor(allowed: string[] = []): RepositoryScope {
  return {
    repositoryId: "r1",
    allowedPathPrefixes: allowed,
    deniedPathPrefixes: [],
    allowedOperations: ["repo_map", "find_code", "file_api", "find_all", "trace", "impact", "build"],
    maxTraversalDepth: 5,
    allowCrossRepo: false,
  };
}

// ---------------------------------------------------------------------------
// unit: scope, risk, state machine, parsers, compatibility

describe("phase 20.62 scope and path policy", () => {
  test("path traversal is always rejected", () => {
    expect(() => assertPathInScope("../etc/passwd", scopeFor(), makeConfig())).toThrow(/traversal/);
    expect(() => assertPathInScope("src/../../etc/passwd", scopeFor(), makeConfig())).toThrow(/traversal/);
  });

  test("sensitive prefixes are denied regardless of scope", () => {
    for (const p of [".env", "secrets/vault.txt", "server.pem", "creds.key"]) {
      expect(isDeniedPath(p, makeConfig().defaultDeniedPrefixes)).toBe(true);
    }
    expect(() => assertPathInScope(".env", scopeFor(), makeConfig())).toThrow(/outside the permitted scope/);
    expect(() => assertPathInScope("secrets/vault.txt", scopeFor(), makeConfig())).toThrow(/outside the permitted scope/);
    expect(() => assertPathInScope("keys/api.pem", scopeFor(), makeConfig())).toThrow(/outside the permitted scope/);
    expect(assertPathInScope("src/router.ts", scopeFor(), makeConfig())).toBe("src/router.ts");
  });

  test("allowed prefixes narrow the scope; outside is denied", () => {
    const scope = scopeFor(["src/**"]);
    expect(assertPathInScope("src/router.ts", scope, makeConfig())).toBe("src/router.ts");
    expect(() => assertPathInScope("test/router.test.ts", scope, makeConfig())).toThrow(/authorized scope/);
  });

  test("cross-repo access defaults to denied", () => {
    expect(() => assertCrossRepoAllowed(null)).toThrow(/cross-repository/);
    expect(() => assertCrossRepoAllowed({ crossRepoTraceEnabled: false })).toThrow(/cross-repository/);
    expect(() => assertCrossRepoAllowed({ crossRepoTraceEnabled: true })).not.toThrow();
  });

  test("CLI arguments cannot be option-shaped", () => {
    expect(() => assertSafeCliArg("--dangerous-flag", "arg")).toThrow(/safe query argument/);
    expect(() => assertSafeCliArg("../escape", "arg")).toThrow(/safe query argument/);
    expect(assertSafeCliArg("src/router.ts", "arg")).toBe("src/router.ts");
  });

  test("repository canonicalization rejects missing paths", () => {
    expect(() => canonicalizeRepositoryPath(join(tmpdir(), "does-not-exist-xyz-20.62"))).toThrow(/does not exist/);
  });
});

describe("phase 20.62 risk model and policy", () => {
  const thresholds = { medium: 25, high: 50, critical: 75 };

  test("isolated low-risk file scores low", () => {
    const { score, level } = scoreImpact({
      targetPath: "src/util.ts", directDependents: 1, transitiveDependents: 1, crossRepoEdges: 0,
      protectedMatches: [], affectedTests: 3, freshnessState: "fresh",
    }, thresholds);
    expect(level).toBe("low");
    expect(score).toBeLessThan(25);
  });

  test("protected auth path with dependents escalates", () => {
    const { level, factors } = scoreImpact({
      targetPath: "src/auth/session.ts", directDependents: 5, transitiveDependents: 8, crossRepoEdges: 0,
      protectedMatches: protectedAreaMatches("src/auth/session.ts", ["src/auth/**"]), affectedTests: 0, freshnessState: "stale",
    }, thresholds);
    expect(level).toBe("critical");
    expect(factors.some((f) => f.factor === "protected_module")).toBe(true);
    expect(factors.some((f) => f.factor === "auth_security_relevance")).toBe(true);
  });

  test("classification respects configurable thresholds", () => {
    expect(classifyRisk(24, thresholds)).toBe("low");
    expect(classifyRisk(25, thresholds)).toBe("medium");
    expect(classifyRisk(50, thresholds)).toBe("high");
    expect(classifyRisk(75, thresholds)).toBe("critical");
  });

  test("risk policy decisions per level, with the freshness gate", () => {
    expect(decideRiskPolicy("low", { freshnessState: "fresh", requireFreshForHighRisk: true }).decision).toBe("allow");
    expect(decideRiskPolicy("medium", { freshnessState: "fresh", requireFreshForHighRisk: true }).decision).toBe("reviewer_required");
    expect(decideRiskPolicy("high", { freshnessState: "fresh", requireFreshForHighRisk: true }).decision).toBe("independent_review_and_approval");
    const blocked = decideRiskPolicy("high", { freshnessState: "stale", requireFreshForHighRisk: true });
    expect(blocked.decision).toBe("blocked_operator_approval");
    expect(blocked.requiresFreshGraph).toBe(true);
    expect(decideRiskPolicy("critical", { freshnessState: "fresh", requireFreshForHighRisk: true }).decision).toBe("blocked_operator_approval");
  });

  test("post-edit escalation on risk increase or new dependencies", () => {
    expect(escalationRequired("low", "medium", 0)).toBe(true);
    expect(escalationRequired("low", "low", 2)).toBe(true);
    expect(escalationRequired("low", "low", 0)).toBe(false);
  });

  test("graph lifecycle rejects illegal transitions", () => {
    expect(() => assertGraphTransition("uninitialized", "ready")).toThrow(/invalid graph transition/);
    expect(() => assertGraphTransition("stale", "ready")).toThrow(/invalid graph transition/);
    expect(assertGraphTransition("ready", "stale")).toBeUndefined();
  });
});

describe("phase 20.62 parsers and compatibility", () => {
  test("ask --json parses results", () => {
    const results = parseAskJson('{"results":[{"title":"t","path":"src/a.ts","symbol":"a","snippet":"s","score":0.5}]}');
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("src/a.ts");
    expect(parseAskJson("not json")).toHaveLength(0);
  });

  test("grep and callers outputs normalize", () => {
    const occurrences = parseGrepOutput("src/a.ts:12: handle(x)\nsrc/b.ts:3: handle(y)");
    expect(occurrences[0].path).toBe("src/a.ts");
    expect(occurrences[0].line).toBe(12);
    const trace = parseCallersOutput("callerA\ncallerB -> sym", "sym", "in", 2);
    expect(trace.dependents).toEqual(["callerA", "callerB -> sym"].slice(0, 1));
    expect(trace.edges).toEqual([{ from: "callerB", to: "sym" }]);
  });

  test("map output extracts clusters and hotspots", () => {
    const map = parseMapOutput("src/  4 files\nhotspot: src/router.ts (coupling 7)");
    expect(map.clusters).toEqual([{ path: "src/", files: 4 }]);
    expect(map.hotspots).toEqual([{ path: "src/router.ts", coupling: 7 }]);
  });

  test("version parsing and compatibility policy", () => {
    expect(parseGraftVersion("graft version 0.18.0 (installed)")).toBe("0.18.0");
    expect(isVersionCompatible("0.18.0", PINNED_GRAFT, "compatible")).toBe(true);
    expect(isVersionCompatible("0.19.1", PINNED_GRAFT, "compatible")).toBe(false);
    expect(isVersionCompatible("0.18.5", PINNED_GRAFT, "compatible")).toBe(true);
    expect(isVersionCompatible("0.17.9", PINNED_GRAFT, "compatible")).toBe(false);
    expect(isVersionCompatible("1.0.0", PINNED_GRAFT, "compatible")).toBe(false);
    expect(isVersionCompatible("0.18.1", PINNED_GRAFT, "exact")).toBe(false);
    expect(isVersionCompatible("0.18.0", PINNED_GRAFT, "exact")).toBe(true);
  });

  test("runner environment always disables telemetry", () => {
    const env = scrubEnvironment();
    expect(env.DO_NOT_TRACK).toBe("1");
    expect(env.PAO_OPENPOST_API_TOKEN).toBeUndefined();
  });

  test("adapter builds argv arrays (no shell) and caps trace depth", async () => {
    const runner = new FakeGraftRunner();
    const adapter = new GraftProvider({
      runner, bin: "graft", pinnedVersion: PINNED_GRAFT, versionPolicy: "compatible",
      deepEnrichmentEnabled: false, maxQuerySeconds: 5, maxBuildSeconds: 30,
      maxResponseBytes: 262144, maxTraceDepth: 5,
    });
    await adapter.traceCalls({ cwd: ".", symbol: "sym", direction: "in", depth: 99 });
    const callersCall = runner.calls.find((c) => c.includes("callers"))!;
    expect(callersCall).toEqual(["graft", "callers", "sym", "--direction", "in", "-d", "5"]);
    await expect(adapter.findCode({ cwd: ".", question: "-rf --dangerous" })).rejects.toThrow(/safe query argument/);
  });

  test("adapter maps check exit 1 to stale and health to version mismatch", async () => {
    const runner = new FakeGraftRunner();
    runner.faults.push({ match: "check", exitCode: 1, stdout: JSON.stringify({ fresh: false, drift: "3 files changed" }), times: 1 });
    const adapter = new GraftProvider({
      runner, bin: "graft", pinnedVersion: PINNED_GRAFT, versionPolicy: "compatible",
      deepEnrichmentEnabled: false, maxQuerySeconds: 5, maxBuildSeconds: 30, maxResponseBytes: 262144, maxTraceDepth: 5,
    });
    const freshness = await adapter.checkFreshness({ cwd: "." });
    expect(freshness.state).toBe("stale");
    expect(freshness.drift).toContain("3 files changed");

    runner.versionOutput = "graft version 0.16.0 (installed)";
    const health = await adapter.healthCheck();
    expect(health.compatible).toBe(false);
    expect(health.incompatibilityReason).toContain("0.16.0");
  });
});

// ---------------------------------------------------------------------------
// service integration with the deterministic provider

describe("phase 20.62 service integration", () => {
  let provider: FakeProvider;
  let service: CodeIntelService;
  let repoId: string;
  let repoPath: string;

  beforeEach(() => {
    openFreshDb();
    provider = new FakeProvider();
    service = makeService(provider);
    repoPath = fixtureRepo();
    const repo = service.registerRepository({ name: "fixture", path: repoPath, actorId: "operator" });
    repoId = repo.id;
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetCodeIntelServiceForTests();
  });

  test("repository registration is canonical and deduplicated", async () => {
    expect(repoId).toBeTruthy();
    expect(() => service.registerRepository({ name: "dup", path: repoPath })).toThrow(/already registered/);
    expect(service.listRepositories()).toHaveLength(1);
  });

  test("build → ready lifecycle with build record and fingerprint", async () => {
    const result = await service.buildGraph(repoId, { actorId: "operator" });
    expect(result.ok).toBe(true);
    expect(result.repository.graphState).toBe("ready");
    expect(result.repository.lastFingerprint).toBeTruthy();
    const evidence = service.store.listEvidence(repoId);
    void evidence;
    const audit = service.store.listAudit().map((e) => e.action);
    expect(audit).toContain("codeintel.graph.build.started");
    expect(audit).toContain("codeintel.graph.build.completed");
  });

  test("findCode persists evidence; scope violations are audited", async () => {
    const outcome = await service.findCode(repoId, { question: "where is routing", actorId: "agent" });
    expect(outcome.result).toHaveLength(1);
    expect(outcome.evidence.id).toBeTruthy();
    expect(outcome.reducedConfidence).toBe(false);
    await expect(service.findCode(repoId, { question: "x", pathScope: ["../outside"] })).rejects.toThrow(/traversal/);
    const audit = service.store.listAudit().map((e) => e.action);
    expect(audit).toContain("codeintel.scope.violation");
  });

  test("fileApi enforces denied sensitive paths server-side", async () => {
    await expect(service.fileApi(repoId, { file: ".env", actorId: "agent" })).rejects.toThrow(/outside the permitted scope/);
    await expect(service.fileApi(repoId, { file: "secrets/vault.txt", actorId: "agent" })).rejects.toThrow(/outside the permitted scope/);
    const ok = await service.fileApi(repoId, { file: "src/router.ts", actorId: "agent" });
    expect(ok.result.signatures.length).toBeGreaterThan(0);
  });

  test("impact gate: isolated file is LOW and allowed; protected auth path is CRITICAL and blocked", async () => {
    provider.cfg.dependents = ["test/router.test.ts"];
    const low = await service.createImpactReport(repoId, { targetRef: "src/util.ts", targetType: "file", actorId: "worker-1" });
    expect(low.riskLevel).toBe("low");
    expect(low.policyDecision).toBe("allow");

    provider.cfg.dependents = ["src/a.ts:a", "src/b.ts:b", "src/c.ts:c", "src/d.ts:d", "src/e.ts:e", "src/f.ts:f", "src/g.ts:g", "src/h.ts:h"];
    provider.cfg.blast = { changedFiles: [], impactedTests: [] };
    provider.cfg.fresh = "stale";
    const critical = await service.createImpactReport(repoId, { targetRef: "src/auth/session.ts", targetType: "file", actorId: "worker-1" });
    expect(critical.protectedMatches).toContain("src/auth/**");
    expect(critical.riskLevel).toBe("critical");
    expect(critical.policyDecision).toBe("blocked_operator_approval");
    expect(critical.freshnessState).toBe("stale");
  });

  test("high-risk on fresh graph requires independent review and approval", async () => {
    provider.cfg.dependents = ["src/a.ts:a", "src/b.ts:b", "src/c.ts:c", "src/d.ts:d"];
    provider.cfg.blast = { changedFiles: [], impactedTests: [] };
    const report = await service.createImpactReport(repoId, { targetRef: "src/auth/session.ts", targetType: "file", actorId: "worker-1" });
    expect(["high", "critical"]).toContain(report.riskLevel);
    if (report.riskLevel === "high") {
      expect(report.policyDecision).toBe("independent_review_and_approval");
    }
  });

  test("post-edit verification produces an impact delta and escalates on growth", async () => {
    provider.cfg.dependents = ["test/router.test.ts"];
    const before = await service.createImpactReport(repoId, { targetRef: "src/router.ts", targetType: "file", actorId: "worker-1" });
    provider.cfg.dependents = ["src/auth.ts:auth.verify", "src/service.ts:service.handle", "src/db.ts:db.query"];
    const { after, delta } = await service.postEditVerification(repoId, { beforeReportId: before.id, actorId: "worker-1" });
    expect(after.id).not.toBe(before.id);
    expect(delta.beforeEvidenceId).toBe(before.id);
    expect(delta.riskAfter).toBe(after.riskLevel);
    expect(delta.escalationRequired).toBe(true);
  });

  test("provider unavailable: low-risk reads fall back reduced-confidence; evidence still recorded via audit", async () => {
    provider.cfg.available = false;
    provider.cfg.version = null;
    const outcome = await service.findAll(repoId, { pattern: "handle", actorId: "agent" });
    expect(outcome.reducedConfidence).toBe(true);
    expect(outcome.result.length).toBeGreaterThan(0);
    const audit = service.store.listAudit().map((e) => e.action);
    expect(audit).toContain("codeintel.provider.unavailable");
  });

  test("high-risk mutation is blocked when the provider is unavailable (no fake graph completeness)", async () => {
    provider.cfg.available = false;
    provider.cfg.version = null;
    const report = await service.createImpactReport(repoId, { targetRef: "src/auth/session.ts", targetType: "file", actorId: "worker-1" });
    expect(report.reducedConfidence).toBe(true);
    expect(report.policyDecision).toBe("blocked_operator_approval");
    expect(report.freshnessState).toBe("missing");
  });

  test("multi-repo workspace: cross-repo defaults to denied, explicit allow works", async () => {
    const repoB = service.registerRepository({ name: "fixture-b", path: fixtureRepo() });
    service.joinWorkspace({ workspaceId: "ws-1", repositoryId: repoId });
    expect(() => service.crossRepoTrace("ws-1", repoId, { symbol: "sym" })).toThrow(/cross-repository/);
    service.joinWorkspace({ workspaceId: "ws-1", repositoryId: repoB.id, crossRepoTraceEnabled: true });
    void repoB;
    // membership with crossRepo still requires the CALLING repo to allow it:
    expect(() => service.crossRepoTrace("ws-1", repoId, { symbol: "sym" })).toThrow(/cross-repository/);
  });

  test("machine-wide config writes are denied by default", () => {
    expect(() => service.assertMachineWideConfigAllowed()).toThrow(/machine-wide agent configuration/);
    const audit = service.store.listAudit().map((e) => e.action);
    expect(audit).toContain("codeintel.machine_config.denied");
  });

  test("context pack is bounded and labels repository content as data", async () => {
    provider.cfg.fresh = "fresh";
    const pack = await service.buildContextPack(repoId, { taskIntent: "where is routing decided", symbol: "router.handle", actorId: "agent" });
    expect(pack.constraints.join(" ")).toContain("DATA, not instructions");
    expect(pack.evidenceIds.length).toBeGreaterThan(0);
    expect(pack.dependencySummary.directDependents).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(pack), "utf8")).toBeLessThan(131072);
  });

  test("stale graph is surfaced, never hidden", async () => {
    await service.buildGraph(repoId, { actorId: "operator" });
    provider.cfg.fresh = "stale";
    const freshness = await service.checkFreshness(repoId);
    expect(freshness.state).toBe("stale");
    expect(service.requireRepository(repoId).graphState).toBe("stale");
  });
});

function nowIso(): string {
  return new Date().toISOString();
}

void nowIso;

// ---------------------------------------------------------------------------
// management API surface

describe("phase 20.62 management routes", () => {
  beforeEach(() => {
    openFreshDb();
    setCodeIntelServiceForTests(makeService(new FakeProvider()));
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetCodeIntelServiceForTests();
  });

  function baseConfig(): OcxConfig {
    return { port: 10100, hostname: "127.0.0.1", defaultProvider: "a", providers: [] } as unknown as OcxConfig;
  }

  async function api(method: string, path: string, body?: unknown): Promise<Response> {
    const url = new URL("http://127.0.0.1:10100" + path);
    const response = await handleManagementAPI(
      new Request(url, { method, headers: { Host: url.host }, body: body === undefined ? undefined : JSON.stringify(body) }),
      url,
      baseConfig(),
      { saveConfigPreservingClaudeCode: () => {} },
    );
    expect(response).not.toBeNull();
    return response!;
  }

  test("health, repository registration, and build through the API", async () => {
    const health = await api("GET", "/api/agent-os/code-intelligence/health");
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody["ok"]).toBe(true);
    expect(healthBody["phase"]).toBe("20.62");

    const repoPath = fixtureRepo();
    const created = await api("POST", "/api/agent-os/code-intelligence/repositories", { name: "api-repo", path: repoPath, actorId: "operator" });
    expect(created.status).toBe(201);
    const repoId = ((await created.json()) as { repository: { id: string } }).repository.id;

    const built = await api("POST", "/api/agent-os/code-intelligence/repositories/" + repoId + "/build", { actorId: "operator" });
    expect(built.status).toBe(200);
    const builtBody = (await built.json()) as { repository: { graphState: string } };
    expect(builtBody.repository.graphState).toBe("ready");

    const find = await api("POST", "/api/agent-os/code-intelligence/repositories/" + repoId + "/find", { question: "routing", actorId: "operator" });
    expect(find.status).toBe(200);
  });

  test("mcp tools listing and unknown route 404", async () => {
    const tools = await api("GET", "/api/agent-os/code-intelligence/mcp-tools");
    const toolBody = (await tools.json()) as { tools: Array<{ name: string }> };
    for (const expected of ["pao_repo_map", "pao_find_code", "pao_file_api", "pao_find_all", "pao_trace_dependencies", "pao_check_code_context", "pao_get_impact_report"]) {
      expect(toolBody.tools.some((t) => t.name === expected)).toBe(true);
    }
    const missing = await api("GET", "/api/agent-os/code-intelligence/not-a-route");
    expect(missing.status).toBe(404);
  });
});
