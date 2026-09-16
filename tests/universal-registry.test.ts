// Phase 20.25 — Pao-hubPro × Agentic AI Universal Registry & Toolchain
// Tests for ingestion, dedup, search, ranking, permissions, fallback,
// secrets safety, SSRF, replay, and audit (doc §87-§89).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { UniversalRegistryStore } from "../src/agent-os/universal-registry/registry-store";
import { UniversalRegistryService, resetUniversalRegistryServiceForTests } from "../src/agent-os/universal-registry/service";
import { syncRegistry, CATALOG_SEEDS } from "../src/agent-os/universal-registry/ingest";
import { searchTools } from "../src/agent-os/universal-registry/search";
import { rankForCapability, weightsForProfile } from "../src/agent-os/universal-registry/ranking";
import { createPlan } from "../src/agent-os/universal-registry/planner";
import { evaluatePermission, riskLevelFor, permissionClassFor } from "../src/agent-os/universal-registry/risk";
import { checkUrlSafety, validateAndNormalizeUrl } from "../src/agent-os/universal-registry/url-safety";
import { extractCapabilities, decomposeGoal, CAPABILITY_NAMESPACES } from "../src/agent-os/universal-registry/taxonomy";
import { sanitizeForAudit, auditSummary } from "../src/agent-os/universal-registry/util";
import type { ToolAdapter } from "../src/agent-os/universal-registry/types";

let testDir: string;

/** Deterministic success adapter for tests (echoes the input summary). */
const EchoAdapter: ToolAdapter = {
  key: "test_echo",
  supports: (tool) => tool.runtime.executor === "test_echo" || tool.runtime.protocol === "test_echo",
  validate: () => null,
  run: async (_tool, input) => ({
    ok: true,
    outputSummary: `echo(${Object.keys(input).join(",")})`,
    latencyMs: 1,
    data: { echoed: true },
  }),
};

/** Deterministic "provider down" adapter that triggers the fallback chain. */
const UnavailableAdapter: ToolAdapter = {
  key: "test_unavailable",
  supports: (tool) => tool.runtime.protocol === "test_unavailable",
  validate: () => null,
  run: async () => ({
    ok: false,
    outputSummary: "primary provider is down",
    errorCode: "TOOL_UNAVAILABLE",
    latencyMs: 2,
  }),
};

function echoTool(id: string, capability: string) {
  return {
    id,
    name: id,
    provider: "test",
    type: "local_tool" as const,
    capabilities: [capability],
    executable: true,
    runtime: { execution: "local" as const, protocol: "test_echo", executor: "test_echo" },
    source: { kind: "catalog" as const },
  };
}

beforeEach(() => {
  closeAgentOsDbForTests();
  resetUniversalRegistryServiceForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-universal-registry-test-"));
  process.env.OPENCODEX_HOME = testDir;
});

afterEach(() => {
  closeAgentOsDbForTests();
  rmSync(testDir, { recursive: true, force: true });
});

function seededStore(): UniversalRegistryStore {
  const store = new UniversalRegistryStore();
  syncRegistry(store, ["catalog"]);
  return store;
}

// --- Taxonomy ----------------------------------------------------------------

describe("Phase 20.25 capability taxonomy", () => {
  test("namespace list is well-formed", () => {
    for (const cap of CAPABILITY_NAMESPACES) {
      expect(cap).toMatch(/^[a-z_0-9]+(\.[a-z_0-9]+)+$/);
    }
  });

  test("extracts capabilities from free text", () => {
    const caps = extractCapabilities("scrape tiktok trends and generate a video");
    expect(caps).toContain("social.tiktok");
    expect(caps).toContain("web.scrape");
    expect(caps).toContain("video.generate");
  });

  test("goal decomposition picks a template and stays deterministic", () => {
    const first = decomposeGoal("find adobe stock trends and produce a stock video");
    expect(first.templateId).toBe("adobe_stock_video_production");
    expect(first.capabilities).toContain("video.generate");
    expect(decomposeGoal("adobe stock video")).toEqual(first);
  });
});

// --- Ingestion & dedup ---------------------------------------------------------

describe("Phase 20.25 registry ingestion & deduplication", () => {
  test("sync is idempotent with stable canonical ids", () => {
    const store = new UniversalRegistryStore();
    const first = syncRegistry(store, ["catalog"]);
    const second = syncRegistry(store, ["catalog"]);
    expect(second.ingested).toBe(first.ingested);
    expect(store.listTools().length).toBe(first.ingested);
    const apify = store.getToolBySlug("tiktok-scraper", "apify");
    expect(apify).not.toBeNull();
    expect(apify!.capabilities).toContain("social.tiktok");
  });

  test("operator-disabled tools keep their disabled status across resync", () => {
    const store = seededStore();
    const tool = store.getToolBySlug("serpapi", "serpapi")!;
    store.setToolStatus(tool.id, "disabled");
    syncRegistry(store, ["catalog"]);
    expect(store.getTool(tool.id)!.status).toBe("disabled");
  });

  test("catalog entries are metadata-only data, never executable", () => {
    const store = seededStore();
    for (const tool of store.listTools({ sourceKind: "catalog" })) {
      expect(tool.executable).toBe(false);
      expect(tool.status).toBe("metadata_only");
      expect(tool.source.repository).toBeTruthy();
    }
    expect(CATALOG_SEEDS.length).toBeGreaterThanOrEqual(10);
  });

  test("auth records hold env references, never secret values", () => {
    const store = seededStore();
    for (const tool of store.listTools({ sourceKind: "catalog" })) {
      if (tool.auth.type !== "none") {
        expect(tool.auth.ref).toMatch(/^[A-Za-z0-9_:-]+$/);
        // The secret VALUE never enters the record — only its env name.
        expect(JSON.stringify(tool.auth)).not.toMatch(/sk-|ghp_|token=/i);
      }
    }
  });
});

// --- Search & ranking ----------------------------------------------------------

describe("Phase 20.25 search", () => {
  test("keyword search ranks relevant tools", () => {
    const store = seededStore();
    const result = searchTools(store, "tiktok scraper");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].tool.capabilities).toContain("social.tiktok");
  });

  test("capability search finds the exact namespace", () => {
    const store = seededStore();
    const result = searchTools(store, "social.tiktok");
    expect(result.results[0].tool.capabilities).toContain("social.tiktok");
  });

  test("filters narrow candidates", () => {
    const store = seededStore();
    const result = searchTools(store, "scraper", { sourceKind: "catalog", executableOnly: false });
    for (const entry of result.results) {
      expect(entry.tool.source.kind).toBe("catalog");
    }
  });
});

describe("Phase 20.25 ranking & profiles", () => {
  test("profiles adjust weights but always normalize to 1", () => {
    for (const profile of ["balanced", "cheap", "quality", "local_first", "privacy_first", "adobe_stock_production"] as const) {
      const weights = weightsForProfile(profile);
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(total - 1)).toBeLessThan(0.001);
    }
    // Cheap mode must weight cost higher than balanced mode.
    expect(weightsForProfile("cheap").cost).toBeGreaterThan(weightsForProfile("balanced").cost);
  });

  test("ranking is explainable", () => {
    const store = seededStore();
    const ranked = rankForCapability(store, "web.search", { profile: "balanced" });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
    expect(ranked[0].reasons.join(" ")).toContain("capability");
  });

  test("user preference weight moves the ranking", () => {
    const store = seededStore();
    const ranked = rankForCapability(store, "web.search", { profile: "balanced" });
    const first = ranked[0].tool;
    store.setPreference(first.id, 1, "test preference");
    const after = rankForCapability(store, "web.search", { profile: "balanced" });
    expect(after[0].tool.id).toBe(first.id);
  });
});

// --- Permissions ---------------------------------------------------------------

describe("Phase 20.25 permission engine (policy outside the LLM)", () => {
  const shellTool = {
    id: "mcp:builtin_terminal:run_shell_command",
    name: "run_shell_command",
    status: "active" as const,
    executable: false,
    risk: { level: 3 as const, permissionClass: "shell_execute" as const, requiresApproval: true },
  };

  test("shell.execute requires approval", () => {
    const result = evaluatePermission({ tool: shellTool, capability: "shell.execute" });
    expect(result.decision).toBe("approval_required");
    expect(result.riskLevel).toBe(3);
  });

  test("approved once allows a specific action", () => {
    const result = evaluatePermission({ tool: shellTool, capability: "shell.execute", approved: true });
    expect(result.decision).toBe("allowed");
  });

  test("dangerous commands are denied outright", () => {
    const result = evaluatePermission({
      tool: shellTool,
      capability: "shell.execute",
      args: { command: "rm -rf /" },
    });
    expect(result.decision).toBe("denied");
  });

  test("path traversal outside the workspace is denied", () => {
    const result = evaluatePermission({
      tool: { ...shellTool, id: "mcp:builtin_fs:read_file", name: "read_file" },
      capability: "filesystem.read",
      args: { path: "../../../Windows/System32/config" },
      workspaceRoot: "C:/tmp/workspace",
    });
    expect(result.decision).toBe("denied");
  });

  test("risk ladder maps capabilities to levels 0-4", () => {
    expect(riskLevelFor("web.search")).toBe(0);
    expect(riskLevelFor("filesystem.write")).toBe(1);
    expect(riskLevelFor("notification.discord")).toBe(2);
    expect(riskLevelFor("shell.execute")).toBe(3);
    expect(riskLevelFor("filesystem.delete")).toBe(4);
    expect(permissionClassFor("stock.export")).toBe("publish");
  });

  test("disabled tools are denied regardless of approval", () => {
    const result = evaluatePermission({ tool: { ...shellTool, status: "disabled" as never }, capability: "shell.execute", approved: true });
    expect(result.decision).toBe("denied");
  });
});

// --- SSRF / URL safety ----------------------------------------------------------

describe("Phase 20.25 URL safety (SSRF)", () => {
  test("blocks loopback, private ranges, and cloud metadata", () => {
    for (const url of [
      "http://127.0.0.1:8080/x",
      "http://localhost/admin",
      "http://10.0.0.5/internal",
      "http://192.168.1.1/router",
      "http://172.16.0.9/vault",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "file:///C:/Windows/System32/config",
      "ftp://files.example.com/x",
    ]) {
      expect(checkUrlSafety(url).ok).toBe(false);
    }
  });

  test("accepts public https targets and admin allowlist overrides loopback", () => {
    expect(validateAndNormalizeUrl("https://api.example.com/v1/search").valid).toBe(true);
    expect(checkUrlSafety("http://127.0.0.1:3000", new Set(["127.0.0.1"])).ok).toBe(true);
  });

  test("validate returns an invalid policy instead of throwing on garbage", () => {
    expect(validateAndNormalizeUrl("not a url").valid).toBe(false);
  });
});

// --- Planner & execution --------------------------------------------------------

describe("Phase 20.25 planner & execution runtime", () => {
  test("goal produces a persisted executable plan with fallbacks", () => {
    const service = new UniversalRegistryService();
    service.sync();
    const run = service.plan({ goal: "research topic and summarize", profile: "balanced" });
    expect(run.plan.steps.length).toBeGreaterThan(0);
    expect(run.status).toBe("planned");
    const stored = service.getRun(run.id);
    expect(stored?.run.goal).toBe(run.goal);
  });

  test("dry run never executes", async () => {
    const service = new UniversalRegistryService();
    service.sync();
    const run = service.plan({ goal: "scrape public web page", dryRun: true });
    const result = await service.executeRun(run.id);
    expect(result.mode).toBe("dry_run");
    const detail = service.getRun(run.id)!;
    for (const step of detail.steps) {
      expect(step.status).toBe("pending");
    }
  });

  test("execution falls back when the primary candidate cannot run", async () => {
    const service = new UniversalRegistryService(new UniversalRegistryStore(), [EchoAdapter, UnavailableAdapter]);
    service.upsertTool({
      ...echoTool("tool_primary_dead", "web.search"),
      name: "AAA Primary Search",
      runtime: { execution: "remote", protocol: "test_unavailable", executor: "test_unavailable" },
    });
    service.upsertTool({ ...echoTool("tool_echo_backup", "web.search"), name: "Echo Search" });

    const run = service.plan({ goal: "search the web" });
    const step = run.plan.steps.find((s) => s.capability === "web.search");
    expect(step).toBeTruthy();
    expect(step!.selectedToolId).toBe("tool_primary_dead");
    expect(step!.fallbackToolIds).toContain("tool_echo_backup");

    const result = await service.executeRun(run.id);
    expect(result.status).toBe("completed");
    const detail = service.getRun(run.id)!;
    const webStep = detail.steps.find((s) => s.capability === "web.search")!;
    expect(webStep.status).toBe("fallback_used");
    expect(webStep.toolId).toBe("tool_echo_backup");
  });

  test("every execution writes audit events, never secrets", async () => {
    const service = new UniversalRegistryService(new UniversalRegistryStore(), [EchoAdapter]);
    service.upsertTool(echoTool("tool_echo_research", "research.discover"));
    const run = service.plan({ goal: "discover new trends" });
    await service.executeRun(run.id);
    const events = service.audit(50, run.id);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const text = JSON.stringify(event);
      expect(text).not.toMatch(/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}/);
    }
  });

  test("destructive steps stop for approval and replay requires a fresh one", async () => {
    const service = new UniversalRegistryService(new UniversalRegistryStore(), [EchoAdapter]);
    service.upsertTool(echoTool("tool_echo_shell", "shell.execute"));

    const run = service.plan({ goal: "run a shell command" });
    expect(run.approvalRequired).toBe(true);

    // First attempt must stop: risk 3 always needs a human decision.
    const stopped = await service.executeRun(run.id);
    expect(stopped.status).toBe("waiting_approval");
    const pending = service.listApprovals("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].toolId).toBe("tool_echo_shell");

    // Approving once lets the run finish; the "once" grant is consumed.
    const resolved = service.resolveApproval(pending[0].id, "approved");
    expect(resolved!.status).toBe("approved");
    const finished = await service.executeRun(run.id);
    expect(finished.status).toBe("completed");
    expect(service.listApprovals("pending").length).toBe(0);

    // Replay starts a fresh run with cleared approvals — it must stop again.
    const replayed = await service.replay(run.id, "exact");
    expect(replayed.id).not.toBe(run.id);
    expect(replayed.status).toBe("waiting_approval");
    expect(service.listApprovals("pending").length).toBe(1);
  });
});

// --- Service surface -------------------------------------------------------------

describe("Phase 20.25 service surface", () => {
  test("status and stats expose counts and flags", () => {
    const service = new UniversalRegistryService();
    service.sync(["catalog"]);
    const status = service.status();
    expect(status.totalTools).toBeGreaterThan(0);
    const stats = service.stats();
    expect(stats.toolsTotal).toBeGreaterThan(0);
    expect((status.flags as Record<string, boolean>).registry).toBe(true);
  });

  test("toggle disable/enable round-trips", () => {
    const service = new UniversalRegistryService();
    service.sync(["catalog"]);
    const tool = service.listTools({ sourceKind: "catalog" })[0];
    const disabled = service.setToolEnabled(tool.id, false);
    expect(disabled!.status).toBe("disabled");
    const enabled = service.setToolEnabled(tool.id, true);
    expect(enabled!.status).toBe("active");
  });

  test("feedback adjusts preference within bounds", () => {
    const service = new UniversalRegistryService();
    service.sync(["catalog"]);
    const tool = service.listTools({ sourceKind: "catalog" })[0];
    service.feedback(tool.id, true, true);
    expect(service.store.getPreferenceWeight(tool.id)).toBeGreaterThan(0);
    service.feedback(tool.id, false, false);
    service.feedback(tool.id, false, false);
    service.feedback(tool.id, false, false);
    expect(service.store.getPreferenceWeight(tool.id)).toBeLessThanOrEqual(0);
  });
});

// --- Sanitizer -------------------------------------------------------------------

describe("Phase 20.25 audit sanitizer", () => {
  test("strips control chars and SQL-significant punctuation", () => {
    const dirty = "npm 'install'; --force /* x */ \u0000 DROP TABLE users--";
    const clean = sanitizeForAudit(dirty);
    expect(clean).not.toContain("'");
    expect(clean).not.toContain(";");
    expect(clean).not.toContain("--");
    expect(clean).not.toContain("/*");
    expect(auditSummary("plain payload")).toBe("plain payload");
  });
});
