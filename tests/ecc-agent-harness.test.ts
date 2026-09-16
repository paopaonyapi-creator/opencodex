// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS Test Suite
//
// Comprehensive test coverage for:
// T1: ECC Status Detection & Graceful Degradation
// T2: Codex Native Plugin Detection & Version Extraction
// T3: Duplicate Installation Detection & Mutation Blocking
// T4: Skill Registry Indexing, 5-Tier Resolution, and Lazy Loading
// T5: Agent Role Registry Mappings and Tool Class Permissions
// T6: Safe Tool Gateway (Class A-E checks, Path Containment, Shell Guard)
// T7: Secret Redaction in Audit Logging (Zero Leaks)
// T8: Multi-Agent Execution Pipeline & Active Write Concurrency Lock
// T9: Reviewer Council Bridge Evidence Scoring & Critical Security BLOCK
// T10: Memory Vault Secret Filtering & Deduplication
// T11: Continuous Learning & Instinct Promotion Safety (No Auto-Escalation)
// T12: Rollback / Feature Flag Disabling
// T13: Management REST API Routes Integration

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { EccDetector } from "../src/agent-os/ecc/detector";
import { SkillsRegistry } from "../src/agent-os/ecc/skills-registry";
import { AgentRegistry } from "../src/agent-os/ecc/agent-registry";
import { SafeToolGateway } from "../src/agent-os/ecc/safe-tool-gateway";
import { redactSecrets, redactObject, EccAuditLogger } from "../src/agent-os/ecc/audit";
import { MemoryVault } from "../src/agent-os/ecc/memory";
import { ContinuousLearningEngine } from "../src/agent-os/ecc/learning";
import { ReviewerCouncilBridge } from "../src/agent-os/ecc/council-bridge";
import { AgentShieldAdapter } from "../src/agent-os/ecc/agentshield";
import { EccOrchestrator } from "../src/agent-os/ecc/orchestrator";
import { EccService } from "../src/agent-os/ecc/service";
import { EccStore } from "../src/agent-os/ecc/store";
import { handleECCRoutes } from "../src/server/management/ecc-routes";
import type { ManagementContext } from "../src/server/management/context";
import type { CouncilEvidencePacket } from "../src/agent-os/ecc/types";

function makeCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://localhost:10100${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    session: null,
    runtimeConfig: null as never,
    requestEpoch: 1,
  };
}

describe("Phase 20.20 — ECC Agent Harness OS", () => {
  let tempDir: string;
  let store: EccStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pao-ecc-test-"));
    store = new EccStore();
  });

  // -------------------------------------------------------------------------
  // T1: ECC Status Detection & Graceful Degradation
  // -------------------------------------------------------------------------
  describe("T1: ECC Status Detection & Graceful Degradation", () => {
    test("detects uninstalled/inactive status cleanly without throwing", () => {
      const detector = new EccDetector({
        workspaceRoot: tempDir,
        codexHome: join(tempDir, ".codex-nonexistent"),
        mockCodexVersion: null,
      });

      const result = detector.detect();
      expect(result.codexAvailable).toBe(false);
      expect(result.nativePluginInstalled).toBe(false);
      expect(result.localCheckoutPresent).toBe(false);
      expect(result.legacySyncPresent).toBe(false);
      expect(result.duplicateInstall).toBe(false);
    });

    test("reports supported plugin ecosystem when codex is present", () => {
      const detector = new EccDetector({
        workspaceRoot: tempDir,
        codexHome: join(tempDir, ".codex"),
        mockCodexVersion: "0.147.0",
        mockPluginListJson: JSON.stringify({ plugins: [] }),
      });

      const result = detector.detect();
      expect(result.codexAvailable).toBe(true);
      expect(result.codexVersion).toBe("0.147.0");
      expect(result.pluginSupport).toBe(true);
      expect(result.nativePluginInstalled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // T2: Codex Native Plugin Detection & Version Extraction
  // -------------------------------------------------------------------------
  describe("T2: Codex Native Plugin Detection & Version Extraction", () => {
    test("detects affaan-m/ECC native plugin when listed in plugin list", () => {
      const pluginJson = JSON.stringify({
        plugins: [
          {
            id: "affaan-m/ECC",
            name: "ECC",
            version: "1.4.2",
            enabled: true,
          },
        ],
      });

      const detector = new EccDetector({
        workspaceRoot: tempDir,
        codexHome: join(tempDir, ".codex"),
        mockCodexVersion: "0.150.0",
        mockPluginListJson: pluginJson,
      });

      const result = detector.detect();
      expect(result.nativePluginInstalled).toBe(true);
      expect(result.nativePluginEnabled).toBe(true);
      expect(result.nativePluginVersion).toBe("1.4.2");
      expect(result.duplicateInstall).toBe(false);
    });

    test("detects ecc@ecc alternative marketplace package", () => {
      const pluginJson = JSON.stringify({
        plugins: [
          {
            id: "ecc@ecc",
            name: "Every Context Cloned",
            version: "2.0.1",
            enabled: true,
          },
        ],
      });

      const detector = new EccDetector({
        workspaceRoot: tempDir,
        codexHome: join(tempDir, ".codex"),
        mockCodexVersion: "0.150.0",
        mockPluginListJson: pluginJson,
      });

      const result = detector.detect();
      expect(result.nativePluginInstalled).toBe(true);
      expect(result.nativePluginVersion).toBe("2.0.1");
    });
  });

  // -------------------------------------------------------------------------
  // T3: Duplicate Installation Detection & Mutation Blocking
  // -------------------------------------------------------------------------
  describe("T3: Duplicate Installation Detection & Mutation Blocking", () => {
    test("detects conflict when both native plugin and legacy ~/.codex sync artifacts exist", () => {
      const codexHome = join(tempDir, ".codex");
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(join(codexHome, "ecc.json"), JSON.stringify({ synced: true }));

      const detector = new EccDetector({
        workspaceRoot: tempDir,
        codexHome,
        mockCodexVersion: "0.150.0",
        mockPluginListJson: JSON.stringify({
          plugins: [{ id: "affaan-m/ECC", version: "1.0.0", enabled: true }],
        }),
      });

      const result = detector.detect();
      expect(result.nativePluginInstalled).toBe(true);
      expect(result.legacySyncPresent).toBe(true);
      expect(result.duplicateInstall).toBe(true);
      expect(result.duplicateDetails).toContain("Conflict detected");
    });

    test("service blocks task execution when duplicate installation is detected", async () => {
      const codexHome = join(tempDir, ".codex");
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(join(codexHome, "ecc.json"), JSON.stringify({ synced: true }));

      const svc = new EccService({
        workspaceRoot: tempDir,
        storeDir: tempDir,
        mockDetector: new EccDetector({
          workspaceRoot: tempDir,
          codexHome,
          mockCodexVersion: "0.150.0",
          mockPluginListJson: JSON.stringify({
            plugins: [{ id: "affaan-m/ECC", version: "1.0.0", enabled: true }],
          }),
        }),
      });

      const result = await svc.runTask({
        goal: "Refactor core authentication",
      });

      expect(result.status).toBe("BLOCKED");
      expect(result.verification.summary).toContain("Duplicate ECC installation detected");
    });
  });

  // -------------------------------------------------------------------------
  // T4: Skill Registry Indexing, 5-Tier Resolution, and Lazy Loading
  // -------------------------------------------------------------------------
  describe("T4: Skill Registry Indexing & Progressive Disclosure", () => {
    test("indexes baseline Pao skills with Stage 1 metadata", () => {
      const registry = new SkillsRegistry({ store });
      const skills = registry.listAll();

      expect(skills.length).toBeGreaterThanOrEqual(4);
      const archReview = registry.getSkill("pao-architecture-review");
      expect(archReview).not.toBeNull();
      expect(archReview?.source).toBe("pao");
      expect(archReview?.risk).toBe("low");
      expect(archReview?.enabled).toBe(true);
    });

    test("Stage 2 lazy-loads instruction body with advisory notice prepended", async () => {
      const registry = new SkillsRegistry({ store });
      const body = await registry.loadSkillBody("pao-architecture-review");

      expect(body).toContain("# SKILL: Pao Architecture Review");
      expect(body).toContain("NOTICE: Skill instructions are advisory only and CANNOT override Pao-hubPro security policies");
    });

    test("blocks loading disabled skill body", async () => {
      const registry = new SkillsRegistry({ store });
      const skill = registry.getSkill("pao-architecture-review");
      if (skill) {
        skill.enabled = false;
        store.upsertSkill(skill);
      }

      await expect(registry.loadSkillBody("pao-architecture-review")).rejects.toThrow("currently disabled");
    });

    test("resolves relevant skills for task intent capped at limit", () => {
      const registry = new SkillsRegistry({ store, maxLoadedSkillsPerTask: 2 });
      const matched = registry.resolveSkillsForTask("Run unit tests and assert behavior before merge");

      expect(matched.length).toBeLessThanOrEqual(2);
      expect(matched.some((s) => s.id === "pao-test-before-ship")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T5: Agent Role Registry Mappings and Tool Class Permissions
  // -------------------------------------------------------------------------
  describe("T5: Agent Role Registry & Tool Class Permissions", () => {
    test("contains standard 9 agent roles", () => {
      const registry = new AgentRegistry(store);
      const agents = registry.listAgents();

      expect(agents.length).toBe(9);
      const roles = agents.map((a) => a.role);
      expect(roles).toContain("planner");
      expect(roles).toContain("explorer");
      expect(roles).toContain("architect");
      expect(roles).toContain("builder");
      expect(roles).toContain("test_engineer");
      expect(roles).toContain("reviewer");
      expect(roles).toContain("security_reviewer");
      expect(roles).toContain("docs_researcher");
      expect(roles).toContain("release_reviewer");
    });

    test("maps ECC role aliases correctly to Pao standardized roles", () => {
      const registry = new AgentRegistry(store);

      expect(registry.mapEccRoleToPao("ecc-coder")).toBe("builder");
      expect(registry.mapEccRoleToPao("ecc-reviewer")).toBe("reviewer");
      expect(registry.mapEccRoleToPao("ecc-tester")).toBe("test_engineer");
      expect(registry.mapEccRoleToPao("ecc-security")).toBe("security_reviewer");
      expect(registry.mapEccRoleToPao("ecc-docs")).toBe("docs_researcher");
    });

    test("enforces read-only agent boundaries against Class B (write) and Class E (high-impact)", () => {
      const registry = new AgentRegistry(store);

      // Planner and Explorer are read-only (Class A only)
      expect(registry.canRoleExecute("planner", "A", "read_file")).toBe(true);
      expect(registry.canRoleExecute("planner", "B", "write_file")).toBe(false);
      expect(registry.canRoleExecute("planner", "E", "destroy_cluster")).toBe(false);

      expect(registry.canRoleExecute("explorer", "A", "read_file")).toBe(true);
      expect(registry.canRoleExecute("explorer", "B", "patch_file")).toBe(false);

      // Builder is read-write (Class A, B, C)
      expect(registry.canRoleExecute("builder", "A", "read_file")).toBe(true);
      expect(registry.canRoleExecute("builder", "B", "write_file")).toBe(true);
      expect(registry.canRoleExecute("builder", "C", "run_command")).toBe(true);
      expect(registry.canRoleExecute("builder", "E", "force_push")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // T6: Safe Tool Gateway (Risk Classes A-E, Path Containment, Shell Guard)
  // -------------------------------------------------------------------------
  describe("T6: Safe Tool Gateway", () => {
    let gateway: SafeToolGateway;

    beforeEach(() => {
      gateway = new SafeToolGateway({
        workspaceRoot: tempDir,
        allowedHosts: ["localhost", "127.0.0.1", "github.com", "registry.npmjs.org"],
      });
    });

    test("classifies tools into 5 risk classes accurately", () => {
      expect(gateway.classifyTool("read_file", {})).toBe("A");
      expect(gateway.classifyTool("write_file", {})).toBe("B");
      expect(gateway.classifyTool("run_command", {})).toBe("C");
      expect(gateway.classifyTool("fetch_url", {})).toBe("D");
      expect(gateway.classifyTool("sudo_execute", {})).toBe("E");
      expect(gateway.classifyTool("drop_database", {})).toBe("E");
    });

    test("blocks Class E high-impact tools by default", () => {
      const decision = gateway.evaluate("destroy_environment", {});
      expect(decision.allowed).toBe(false);
      expect(decision.riskClass).toBe("E");
      expect(decision.requiresApproval).toBe(true);
    });

    test("blocks path traversal outside workspace containment", () => {
      const decision = gateway.evaluate("write_file", {
        path: join(tempDir, "../../etc/passwd"),
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("resolves outside workspace root");
    });

    test("blocks protected system and credential paths", () => {
      const decision = gateway.evaluate("read_file", {
        path: join(tempDir, ".env"),
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("Access to protected sensitive path");
    });

    test("blocks dangerous shell commands via tokenizer and sanitizer", () => {
      const d1 = gateway.evaluate("run_command", {
        command: "rm -rf /",
      });
      expect(d1.allowed).toBe(false);
      expect(d1.reason).toContain("Destructive shell pattern detected");

      const d2 = gateway.evaluate("run_command", {
        command: "git push origin main --force",
      });
      expect(d2.allowed).toBe(false);
      expect(d2.reason).toContain("Destructive shell pattern detected");
    });

    test("allows safe in-workspace operations", () => {
      const safePath = join(tempDir, "src", "index.ts");
      const decision = gateway.evaluate("write_file", {
        path: safePath,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.riskClass).toBe("B");
    });
  });

  // -------------------------------------------------------------------------
  // T7: Secret Redaction in Audit Logging (Zero Leaks)
  // -------------------------------------------------------------------------
  describe("T7: Secret Redaction & Audit Logging", () => {
    test("redacts API keys, PATs, bearer tokens, and private keys", () => {
      const fakeSkAnt = "sk-ant-api03-" + "a5".repeat(18);
      const fakeGhp = "ghp_" + "c5".repeat(18);
      const fakeJwt = "eyJ" + "d5".repeat(12) + ".xyz";
      const raw = `
        ${fakeSkAnt}
        ${fakeGhp}
        Bearer ${fakeJwt}
        password="SuperSecretPassword123"
        -----BEGIN RSA PRIVATE KEY-----
        MIIEowIBAAKCAQEA0
        -----END RSA PRIVATE KEY-----
      `;

      const { text, redacted } = redactSecrets(raw);
      expect(redacted).toBe(true);
      expect(text).not.toContain(fakeGhp);
      expect(text).not.toContain("SuperSecretPassword123");
      expect(text).not.toContain(fakeJwt);
      expect(text).toContain("[REDACTED_SECRET]");
    });

    test("redactObject deeply scrubs sensitive properties in nested payloads", () => {
      const payload = {
        config: {
          apiKey: "sk-" + "9".repeat(26),
          token: "ghp_" + "f5".repeat(20),
          database: {
            connectionString: "postgres://user:super_secret_pw@localhost:5432/db",
          },
        },
        publicName: "Safe Project",
      };

      const { sanitized, redacted } = redactObject(payload);
      expect(redacted).toBe(true);
      expect(sanitized.publicName).toBe("Safe Project");
      expect(sanitized.config.apiKey).toBe("[REDACTED]");
      expect(sanitized.config.database.connectionString).toContain("[REDACTED]");
      expect(sanitized.config.database.connectionString).not.toContain("super_secret_pw");
    });

    test("audit service logs clean records to SQLite with zero secret leakage", () => {
      const audit = new EccAuditLogger(store);
      const fakeAuditSk = "sk-" + "s5".repeat(13);
      audit.logToolExecution({
        runId: "task-001",
        agentRole: "builder",
        requestedTool: "run_command",
        riskClass: "C",
        policyDecision: { allowed: true, riskClass: "C", requiresApproval: false, reason: "Allowed" },
        actionSummary: `curl -H 'Authorization: Bearer ${fakeAuditSk}' https://api.example.com`,
      });

      const events = store.listAuditEvents(10);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].requestedTool).toBe("run_command");
      expect(events[0].actionSummary).not.toContain(fakeAuditSk);
      expect(events[0].actionSummary).toContain("[REDACTED_SECRET]");
    });
  });

  // -------------------------------------------------------------------------
  // T8: Multi-Agent Execution Pipeline & Active Concurrency Lock
  // -------------------------------------------------------------------------
  describe("T8: Multi-Agent Execution Pipeline & Concurrency Lock", () => {
    test("orchestrates end-to-end task execution with state machine progression", async () => {
      const svc = new EccService({
        workspaceRoot: tempDir,
        storeDir: tempDir,
      });

      const result = await svc.runTask({
        goal: "Analyze code architecture and run test verification",
        isWriteTask: false,
      });

      expect(result.status).toBe("PASS");
      expect(result.agentRolesUsed.length).toBeGreaterThan(0);
      expect(result.councilResult).toBeDefined();
      expect(result.councilResult?.decision).toBe("approve");
    });

    test("blocks concurrent write tasks using active write lock", async () => {
      const svc = new EccService({
        workspaceRoot: tempDir,
        storeDir: tempDir,
      });

      // Launch first write task modifying components
      const p1 = svc.orchestrator.executeTask({
        goal: "First write task modifying components",
        isWriteTask: true,
        filesToModify: ["src/index.ts"],
      });

      // Launch second write task concurrently on overlapping file
      const p2 = svc.orchestrator.executeTask({
        goal: "Second concurrent write task attempting to modify workspace",
        isWriteTask: true,
        filesToModify: ["src/index.ts"],
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      const statuses = [r1.status, r2.status];
      expect(statuses).toContain("BLOCKED");
      const blocked = r1.status === "BLOCKED" ? r1 : r2;
      expect(blocked.verification.summary).toContain("Concurrent overlapping write conflict");
    });
  });

  // -------------------------------------------------------------------------
  // T9: Reviewer Council Bridge Evidence Scoring & Critical Security BLOCK
  // -------------------------------------------------------------------------
  describe("T9: Reviewer Council Bridge Evidence Scoring", () => {
    let council: ReviewerCouncilBridge;

    beforeEach(() => {
      council = new ReviewerCouncilBridge();
    });

    test("approves clean evidence with passing tests and no security issues", () => {
      const packet: CouncilEvidencePacket = {
        taskId: "task-clean",
        goal: "Add utility function",
        plan: {
          steps: [{ description: "Add math utility", role: "builder", riskClass: "B" }],
          estimatedRisk: "low",
        },
        filesModified: ["src/math.ts"],
        testResults: { total: 10, passed: 10, failed: 0 },
        securityFindings: [],
      };

      const result = council.evaluateEvidence(packet);
      expect(result.decision).toBe("approve");
      expect(result.scores.correctness).toBeGreaterThanOrEqual(0.9);
      expect(result.scores.security).toBe(1.0);
    });

    test("hard BLOCK invariant: critical security finding triggers BLOCK decision", () => {
      const packet: CouncilEvidencePacket = {
        taskId: "task-critical",
        goal: "Expose admin token in HTTP response",
        plan: {
          steps: [{ description: "Modify auth endpoint", role: "builder", riskClass: "B" }],
          estimatedRisk: "high",
        },
        filesModified: ["src/server/auth.ts"],
        testResults: { total: 5, passed: 5, failed: 0 },
        securityFindings: [
          {
            severity: "critical",
            rule: "no-hardcoded-secrets",
            description: "Admin auth token serialized directly in unauthenticated endpoint.",
          },
        ],
      };

      const result = council.evaluateEvidence(packet);
      expect(result.decision).toBe("block");
      expect(result.blockingFindings.some((b) => b.includes("[CRITICAL SECURITY]"))).toBe(true);
      expect(result.scores.security).toBeLessThanOrEqual(0.2);
    });

    test("issues revise decision when automated tests fail", () => {
      const packet: CouncilEvidencePacket = {
        taskId: "task-test-failure",
        goal: "Refactor database query",
        plan: {
          steps: [{ description: "Update SQL query", role: "builder", riskClass: "B" }],
          estimatedRisk: "medium",
        },
        filesModified: ["src/db.ts"],
        testResults: { total: 8, passed: 6, failed: 2 },
        securityFindings: [],
      };

      const result = council.evaluateEvidence(packet);
      expect(result.decision).toBe("revise");
      expect(result.blockingFindings.some((b) => b.includes("Automated tests failed"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T10: Memory Vault Secret Filtering & Deduplication
  // -------------------------------------------------------------------------
  describe("T10: Memory Vault Secret Filtering & Deduplication", () => {
    let vault: MemoryVault;

    beforeEach(() => {
      vault = new MemoryVault(store);
    });

    test("stores memories and scrubs confidential secrets automatically", () => {
      vault.storeMemory({
        type: "architecture_decisions",
        source: "migration-test",
        summary: "Database migration completed with connection postgres://user:secret123@localhost/db",
        detail: "JWT token: Bearer " + "eyJ" + "e5".repeat(12) + ".payload",
        tags: ["database", "schema"],
      });

      const memories = vault.query({ tag: "database" });
      expect(memories.length).toBe(1);
      expect(memories[0].summary).not.toContain("secret123");
      expect(memories[0].summary).toContain("[REDACTED]");
      expect(memories[0].detail).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload");
    });

    test("deduplicates identical memories across calls", () => {
      vault.storeMemory({
        type: "repository_conventions",
        source: "convention-test",
        summary: "Always check types before committing",
        tags: ["quality"],
      });

      vault.storeMemory({
        type: "repository_conventions",
        source: "convention-test",
        summary: "Always check types before committing",
        tags: ["quality"],
      });

      const memories = vault.query({ keyword: "check types" });
      expect(memories.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // T11: Continuous Learning & Instinct Promotion Safety
  // -------------------------------------------------------------------------
  describe("T11: Continuous Learning & Instinct Promotion Safety", () => {
    let learningEngine: ContinuousLearningEngine;

    beforeEach(() => {
      learningEngine = new ContinuousLearningEngine(store);
    });

    test("synthesizes positive candidate instincts from successful tasks", () => {
      const instinct = learningEngine.evaluateCompletedTask({
        taskId: "task-100",
        goal: "Implement comprehensive test coverage for routing",
        success: true,
        stepsExecuted: 4,
        filesChanged: ["src/router.ts", "tests/router.test.ts"],
        testPassed: true,
        warningsCount: 0,
        criticalIssuesCount: 0,
      });

      expect(instinct).not.toBeNull();
      expect(instinct?.trigger).toBe("test_expansion");
      expect(instinct?.promotedToSkill).toBe(false);
    });

    test("rejects instinct generation from failed tasks", () => {
      const instinct = learningEngine.evaluateCompletedTask({
        taskId: "task-failed",
        goal: "Fix database concurrency bug",
        success: false,
        stepsExecuted: 2,
        filesChanged: ["src/db.ts"],
        testPassed: false,
        warningsCount: 1,
        criticalIssuesCount: 1,
      });

      expect(instinct).toBeNull();
    });

    test("HARD SAFETY INVARIANT: instinct promotion requires human operator authorization", () => {
      const instinct = learningEngine.registerInstinct({
        trigger: "safe_deploy",
        pattern: "Always perform canary test before full deployment",
        confidence: 0.95,
        successCount: 10,
        failureCount: 0,
      });

      // Attempt promotion without operator approval
      expect(() => {
        learningEngine.promoteToSkill(instinct.id, false);
      }).toThrow("Safety Violation: Instinct");

      // Attempt promotion with operator approval
      const skill = learningEngine.promoteToSkill(instinct.id, true);
      expect(skill).toBeDefined();
      expect(skill.name).toContain("Learned: safe deploy");
      expect(skill.risk).toBe("low");
    });
  });

  // -------------------------------------------------------------------------
  // T12: Rollback / Feature Flag Disabling
  // -------------------------------------------------------------------------
  describe("T12: Rollback & Feature Flag Disabling", () => {
    test("disabling ECC harness via rollback prevents task execution", async () => {
      const svc = new EccService({
        workspaceRoot: tempDir,
        store,
      });

      expect(svc.getFeatureFlags().enabled).toBe(true);

      // Perform rollback
      const rollbackResult = svc.rollback("Emergency disable requested by operator");
      expect(rollbackResult.success).toBe(true);
      expect(svc.getFeatureFlags().enabled).toBe(false);

      // Task execution should fail closed
      const runResult = await svc.runTask({
        goal: "Modify critical service",
      });

      expect(runResult.status).toBe("BLOCKED");
      expect(runResult.verification.summary).toContain("ECC Agent Harness is disabled");
    });
  });

  // -------------------------------------------------------------------------
  // T13: Management REST API Routes Integration
  // -------------------------------------------------------------------------
  describe("T13: Management REST API Routes Integration", () => {
    test("GET /api/agent-os/ecc/status returns comprehensive status payload", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/status", "GET");
      const res = await handleECCRoutes(ctx);

      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);

      const data = (await res?.json()) as { status: { available: boolean }; flags: { enabled: boolean } };
      expect(data.status).toBeDefined();
      expect(typeof data.flags.enabled).toBe("boolean");
    });

    test("GET /api/agent-os/ecc/skills returns registered skills list", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/skills", "GET");
      const res = await handleECCRoutes(ctx);

      expect(res?.status).toBe(200);
      const data = (await res?.json()) as { skills: Array<{ id: string; name: string }> };
      expect(Array.isArray(data.skills)).toBe(true);
      expect(data.skills.length).toBeGreaterThan(0);
    });

    test("GET /api/agent-os/ecc/agents returns standard agents list", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/agents", "GET");
      const res = await handleECCRoutes(ctx);

      expect(res?.status).toBe(200);
      const data = (await res?.json()) as { agents: Array<{ role: string; name: string }> };
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBe(9);
    });

    test("GET /api/agent-os/ecc/doctor runs diagnostic checks", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/doctor", "GET");
      const res = await handleECCRoutes(ctx);

      expect(res?.status).toBe(200);
      const data = (await res?.json()) as { doctor: { healthy: boolean; issues: string[]; details: Record<string, unknown> } };
      expect(data.doctor).toBeDefined();
      expect(typeof data.doctor.healthy).toBe("boolean");
      expect(Array.isArray(data.doctor.issues)).toBe(true);
    });

    test("GET /api/agent-os/ecc/agentshield returns safety status and guidance", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/agentshield", "GET");
      const res = await handleECCRoutes(ctx);

      expect(res?.status).toBe(200);
      const data = (await res?.json()) as { agentshield: { installed: boolean; guidance?: string } };
      expect(data.agentshield).toBeDefined();
      expect(typeof data.agentshield.installed).toBe("boolean");
      expect(typeof data.agentshield.guidance === "string" || data.agentshield.guidance === undefined).toBe(true);
    });

    test("POST /api/agent-os/ecc/execute executes task and returns council verdict", async () => {
      const ctx = makeCtx("/api/agent-os/ecc/execute", "POST", {
        goal: "Validate API route handlers and run diagnostics",
        isWriteTask: false,
      });

      const res = await handleECCRoutes(ctx);
      expect(res?.status).toBe(200);

      const data = (await res?.json()) as { result: { status: string; councilResult?: { decision: string } } };
      expect(data.result).toBeDefined();
      expect(data.result.status).toBe("PASS");
      expect(data.result.councilResult?.decision).toBe("approve");
    });
  });
});
