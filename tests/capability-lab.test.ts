/**
 * Phase 20.56 — Micro-App Capability Lab.
 * Hermetic: local seed Python is analyzed, never executed on the host.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { analyzePythonSource } from "../src/agent-os/capability-lab/analyzer";
import { decidePublish, decideInvoke } from "../src/agent-os/capability-lab/policy";
import { CapabilityLab, resetCapabilityLabForTests } from "../src/agent-os/capability-lab";
import { CapError } from "../src/agent-os/capability-lab/types";

const prevHome = process.env.OPENCODEX_HOME;

describe("Phase 20.56 — capability lab", () => {
  let dir: string;
  let lab: CapabilityLab;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pao-cap56-"));
    process.env.OPENCODEX_HOME = dir;
    process.env.PAO_CAPABILITY_ENABLED = "true";
    process.env.PAO_CAPABILITY_SANDBOX_BACKEND = "process";
    closeAgentOsDbForTests();
    openAgentOsDb(dir);
    resetCapabilityLabForTests();
    lab = new CapabilityLab(dir);
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    resetCapabilityLabForTests();
    rmSync(dir, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = prevHome;
  });

  test("static analysis never needs a Python interpreter and flags unsafe recipes", () => {
    const safe = analyzePythonSource("checksum.py", "import hashlib\n\ndef run(text):\n    return hashlib.sha256(text.encode()).hexdigest()\n");
    expect(safe.recommendation).toBe("GOOD_CANDIDATE");
    expect(safe.riskLevel).toBe("low");
    const bad = analyzePythonSource("dangerous_shell.py", "import os, subprocess, requests\neval(os.environ['SECRET'])\nsubprocess.check_output('ls', shell=True)\n");
    expect(bad.recommendation).toBe("UNSAFE");
    expect(bad.riskLevel).toBe("critical");
    const gui = analyzePythonSource("gui_app.py", "import tkinter\n\ndef main():\n    tkinter.Tk().mainloop()\n");
    expect(gui.recommendation).toBe("INTERACTIVE_ONLY");
  });

  test("policy denies autonomous publish of high/critical and unpublished invoke", () => {
    expect(decidePublish("critical", true).effect).toBe("deny");
    expect(decidePublish("low", true).effect).toBe("allow");
    expect(decideInvoke({
      id: "x", key: "utility.checksum", namespace: "utility", name: "x", description: "", status: "MANIFESTED",
      recipeId: null, version: "1.0.0", channel: "dev", adapters: [], createdAt: "", updatedAt: "",
      manifest: {
        apiVersion: "pao.dev/v1", kind: "Capability",
        metadata: { id: "utility.checksum", namespace: "utility", name: "x", version: "1.0.0", description: "", source: { type: "pao-seed", path: "x" }, license: { spdx: "MIT", attributionRequired: false } },
        runtime: { language: "typescript", entrypoint: "utility.checksum", timeoutSeconds: 30, networkMode: "none" },
        inputs: {}, outputs: {}, permissions: [], risk: { level: "low", score: 0, reasons: [] },
        policy: { approvalRequired: false, allowedCallers: ["agent"] }, adapters: { mcp: true, skill: true, rest: true },
        integrity: { sourceSha256: "a", wrapperSha256: "b" },
      },
    }, "agent").effect).toBe("deny");
  });

  test("seed import analyzes recipes, quarantines unsafe code, and promotes trusted demos", async () => {
    const boot = lab.bootstrapSeed();
    expect(boot.recipes.length).toBeGreaterThanOrEqual(4);
    const unsafe = boot.recipes.find((r) => r.filePath.includes("dangerous"));
    expect(unsafe?.recommendation).toBe("UNSAFE");
    const quarantined = boot.capabilities.find((c) => c.status === "QUARANTINED");
    expect(quarantined).toBeTruthy();

    const checksum = boot.capabilities.find((c) => c.key === "utility.checksum");
    expect(checksum).toBeTruthy();
    await lab.test("utility.checksum");
    const published = lab.publish("utility.checksum", "admin");
    expect(published.status).toBe("PUBLISHED");
    const compiled = lab.compile("utility.checksum");
    expect(compiled.adapters.some((a) => a.type === "mcp" && a.name === "pao.cap.utility.checksum")).toBe(true);

    const run = await lab.invoke("utility.checksum", { text: "hello-pao" }, "agent");
    expect(run.status).toBe("success");
    expect(String((run.output as { digest?: string }).digest)).toMatch(/^[a-f0-9]{64}$/);
    expect(run.artifactIds.length).toBe(1);

    expect(lab.invoke("utility.checksum", { text: "x" }, "agent").then(() => lab.getCapability(quarantined!.key))).resolves.toBeTruthy();
    await expect(lab.invoke(quarantined!.key, {}, "agent")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(() => lab.publish(quarantined!.key, "admin", true)).toThrow(/POLICY_DENIED/);
  });

  test("imported Python is not executed on the host", async () => {
    const boot = lab.bootstrapSeed();
    const imported = boot.capabilities.find((c) => c.manifest.runtime.language === "python" && c.status !== "QUARANTINED");
    if (imported) {
      await expect(lab.invoke(imported.key, {}, "agent")).rejects.toBeInstanceOf(CapError);
    }
    const dangerous = boot.capabilities.find((c) => c.key.includes("dangerous") || c.status === "QUARANTINED");
    expect(dangerous).toBeTruthy();
    await expect(lab.test(dangerous!.key)).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
});
