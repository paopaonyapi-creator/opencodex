/**
 * Phase 20.55 — Flash/Pro router, diagnostics, MCP aliases, device leases.
 * Hermetic: uses the existing mock ARTEMIS adapter, no live phone.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { selectMobileProfile } from "../src/agent-os/mobile/profile-router";
import { DeviceLockService } from "../src/agent-os/mobile/device-lock";
import { diagnoseMobileRuntime } from "../src/agent-os/mobile/diagnostics";
import { createMobileMcpTools } from "../src/agent-os/mobile/mcp-tools";
import { ArtemisMcpAdapter } from "../src/agent-os/mobile/runtime-adapter";

const prevHome = process.env.OPENCODEX_HOME;

describe("Phase 20.55 — mobile runtime upgrades", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pao-m55-"));
    process.env.OPENCODEX_HOME = dir;
    process.env.PAO_MOBILE_ENABLED = "true";
    process.env.ARTEMIS_HOST = "127.0.0.1";
    process.env.ARTEMIS_TRANSPORT = "mock";
    closeAgentOsDbForTests();
    openAgentOsDb(dir);
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    rmSync(dir, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = prevHome;
    process.env.ARTEMIS_HOST = "127.0.0.1";
    process.env.ARTEMIS_TRANSPORT = "mock";
    process.env.PAO_MOBILE_ENABLED = "true";
  });

  test("Flash/Pro router is deterministic and auditable", () => {
    expect(selectMobileProfile({ instruction: "Open Settings and read battery" }).profile).toBe("flash");
    const debug = selectMobileProfile({ instruction: "investigate the crash and capture logcat" });
    expect(debug.profile).toBe("pro");
    expect(debug.reason).toContain("exploratory-language");
    expect(selectMobileProfile({ instruction: "tap one button", forcedProfile: "pro" }).reason).toMatch(/^forced:/);
    expect(selectMobileProfile({ instruction: "read battery", riskLevel: "R3" }).profile).toBe("pro");
  });

  test("device leases are exclusive until released or expired", () => {
    const locks = new DeviceLockService();
    const first = locks.acquire("dev-1", "task-a");
    expect(first.taskId).toBe("task-a");
    expect(() => locks.acquire("dev-1", "task-b")).toThrow(/DEVICE_BUSY/);
    locks.release("dev-1", "task-a");
    const second = locks.acquire("dev-1", "task-b");
    expect(second.taskId).toBe("task-b");
  });

  test("diagnostics fail closed when the console is not loopback", async () => {
    process.env.ARTEMIS_HOST = "0.0.0.0";
    const report = await diagnoseMobileRuntime();
    expect(report.verdict).toBe("blocked");
    expect(report.blockers.some((b) => b.includes("loopback"))).toBe(true);
  });

  test("MCP tools expose stable pao.mobile.* aliases", () => {
    const tools = createMobileMcpTools();
    const names = new Set(tools.map((t) => t.name));
    for (const name of ["pao.mobile.run", "pao.mobile.observe", "pao.mobile.manage", "pao.mobile.inspect", "pao.mobile.diagnose", "pao.mobile.devices", "pao.mobile.approve"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test("ARTEMIS adapter is the Pao runtime boundary", async () => {
    const adapter = new ArtemisMcpAdapter();
    expect(adapter.runtimeName()).toBe("artemis");
    const version = await adapter.runtimeVersion();
    expect(version).toBeTruthy();
  });
});
