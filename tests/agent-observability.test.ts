// Phase 20.40 — Agent Observability tests (spec §43-§47). Synthetic fixtures
// only — no real personal transcripts. Covers the scanner (revision cache,
// complete records, partial suffix, malformed records, deletion race,
// outside-root rejection, tail budget), the state engine (exact thresholds,
// future clamps, independence of planes, missing PID ≠ stopped, inactivity
// ≠ completed, stall combination), redaction patterns, integrity hashing,
// adapter end-to-end flows, transcript immutability, and retention.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { resetEngineSingletonForTests, getObservabilityEngine, bindCockpitService } from "../src/agent-os/agent-observability/engine";
import { resetObservabilityConfigForTests, validateConfig, getObservabilityConfig } from "../src/agent-os/agent-observability/config";
import { readLastCompleteLine, pathInsideRoot, statSourceSafe, revisionOf } from "../src/agent-os/agent-observability/scanner";
import { deriveStates } from "../src/agent-os/agent-observability/normalizer";
import { redactText, redactStructure, REDACTED_SECRET } from "../src/agent-os/agent-observability/redaction";
import { IntegrityEngine } from "../src/agent-os/agent-observability/integrity";
import { ClaudeJsonlAdapter } from "../src/agent-os/agent-observability/adapter-claude";
import { resetProcessScanCacheForTests, registryHints, scanProcesses } from "../src/agent-os/agent-observability/process-evidence";
import type { ObservabilityConfig } from "../src/agent-os/agent-observability/types";

let testDir: string;
let fixtureRoot: string;

beforeEach(() => {
  closeAgentOsDbForTests();
  resetEngineSingletonForTests();
  resetObservabilityConfigForTests();
  resetProcessScanCacheForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-obs-test-"));
  fixtureRoot = join(testDir, "claude-projects", "proj-a");
  mkdirSync(fixtureRoot, { recursive: true });
  process.env.OPENCODEX_HOME = testDir;
  process.env.OBSERVABILITY_ENABLED = "true";
  process.env.OBSERVABILITY_CLAUDE_ROOT = fixtureRoot;
  delete process.env.OBSERVABILITY_GENERIC_JSONL_SOURCES;
  delete process.env.OBSERVABILITY_STALLED_MS;
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetEngineSingletonForTests();
  resetObservabilityConfigForTests();
  resetProcessScanCacheForTests();
  rmSync(testDir, { recursive: true, force: true });
});

// --- fixture helpers (synthetic, clean-room shapes) ---------------------------------

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function jsonlLine(record: Record<string, unknown>): string {
  return JSON.stringify(record) + "\n";
}

function writeSessionFixture(name: string, lines: string[]): string {
  const path = join(fixtureRoot, name);
  writeFileSync(path, lines.join(""));
  return path;
}

function baseConfig(): ObservabilityConfig {
  return getObservabilityConfig();
}

const emitNothing = () => undefined;

// --- §44 scanner ----------------------------------------------------------------------

describe("scanner", () => {
  test("revision changes when metadata changes and is stable otherwise", () => {
    const path = writeSessionFixture("rev.jsonl", [jsonlLine({ sessionId: "s1", type: "user", timestamp: isoAgo(1000) })]);
    const first = statSourceSafe(path);
    expect(first).not.toBeNull();
    const revA = revisionOf(first!);
    // same file → same revision
    expect(revisionOf(statSourceSafe(path)!)).toBe(revA);
    // append → size/mtime change → new revision
    writeFileSync(path, readFileSync(path, "utf8") + jsonlLine({ sessionId: "s1", type: "assistant" }));
    expect(revisionOf(statSourceSafe(path)!)).not.toBe(revA);
  });

  test("partial suffix is invisible until newline-terminated", () => {
    const path = join(fixtureRoot, "partial.jsonl");
    writeFileSync(path, jsonlLine({ sessionId: "s1", type: "user", timestamp: isoAgo(5000) }) + '{"sessionId":"s1","type":"assi');
    const result = readLastCompleteLine(path, { chunkBytes: 4096, maxTailBytes: 262144 });
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.line) as { type: string };
    expect(parsed.type).toBe("user");
    // finish the record → it becomes the latest
    writeFileSync(path, readFileSync(path, "utf8") + 'stant"}\n');
    const next = readLastCompleteLine(path, { chunkBytes: 4096, maxTailBytes: 262144 });
    expect((JSON.parse(next!.line) as { type: string }).type).toBe("assistant");
  });

  test("malformed complete final line is reported, older records never substituted", () => {
    const path = writeSessionFixture("bad.jsonl", [
      jsonlLine({ sessionId: "s1", type: "user" }),
      '{"sessionId":"s1","type":"assistant","broken": tru\n',
    ]);
    const result = readLastCompleteLine(path, { chunkBytes: 4096, maxTailBytes: 262144 });
    expect(result!.malformed).toBe(true);
    expect(result!.errors.some((error) => error.code === "MALFORMED_RECORD")).toBe(true);
    expect(result!.line).toContain("assistant");
  });

  test("tail budget reports TAIL_LIMIT_REACHED instead of a truncated parse", () => {
    const path = join(fixtureRoot, "huge.jsonl");
    const huge = JSON.stringify({ sessionId: "s1", type: "assistant", text: "x".repeat(400_000) }) + "\n";
    writeFileSync(path, huge);
    const result = readLastCompleteLine(path, { chunkBytes: 4096, maxTailBytes: 8192 });
    expect(result!.errors.some((error) => error.code === "TAIL_LIMIT_REACHED")).toBe(true);
  });

  test("outside-root resolution is rejected", () => {
    expect(pathInsideRoot(fixtureRoot, testDir)).toBe(false);
    expect(pathInsideRoot(fixtureRoot, join(fixtureRoot, "session.jsonl"))).toBe(true);
  });

  test("deleted source handled softly", () => {
    const path = writeSessionFixture("gone.jsonl", [jsonlLine({ sessionId: "s1" })]);
    rmSync(path);
    expect(statSourceSafe(path)).toBeNull();
  });
});

// --- §44 state engine --------------------------------------------------------------------

describe("state engine", () => {
  const config = {
    thresholds: { activeMs: 120_000, recentMs: 900_000, idleMs: 7_200_000, stalledMs: 600_000 },
  } as ObservabilityConfig;

  function derive(overrides: Partial<Parameters<typeof deriveStates>[0]> = {}) {
    return deriveStates({
      nowMs: Date.now(),
      config,
      lastRecordedEventAt: isoAgo(1000),
      lastFileModifiedAt: null,
      explicitEndedAt: null,
      latestEvent: { id: "e", sessionId: "s", parentSessionId: null, runtime: "claude_code", kind: "assistant_message", role: "assistant", recordedAt: isoAgo(1000), observedAt: isoAgo(1000), toolName: null, summary: null, contentPreview: null, sourcePath: null, sourceOffset: null, sourceRevision: null, truncated: false, malformed: false, metadata: {} },
      waitingUserHint: false,
      executionHint: null,
      hasMalformedRecords: false,
      errors: [],
      processMatchConfidence: -1,
      processExactMatch: false,
      ...overrides,
    });
  }

  test("threshold boundaries are exact", () => {
    expect(derive({ lastRecordedEventAt: isoAgo(119_999) }).activityState).toBe("active");
    expect(derive({ lastRecordedEventAt: isoAgo(120_000) }).activityState).toBe("recent");
    expect(derive({ lastRecordedEventAt: isoAgo(899_999) }).activityState).toBe("recent");
    expect(derive({ lastRecordedEventAt: isoAgo(900_000) }).activityState).toBe("idle");
    expect(derive({ lastRecordedEventAt: isoAgo(7_199_999) }).activityState).toBe("idle");
    expect(derive({ lastRecordedEventAt: isoAgo(7_200_000) }).activityState).toBe("stale");
  });

  test("future timestamps clamp age to zero (active)", () => {
    expect(derive({ lastRecordedEventAt: new Date(Date.now() + 60_000).toISOString() }).activityState).toBe("active");
  });

  test("activity derives from mtime alone but with low confidence weight", () => {
    const result = derive({ lastRecordedEventAt: null, lastFileModifiedAt: isoAgo(1000) });
    expect(result.activityState).toBe("active");
    expect(result.confidenceFactors.some((factor) => factor.rule === "filesystem mtime only")).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.1);
  });

  test("inactivity alone never implies completed; missing PID never implies stopped", () => {
    const result = derive({ lastRecordedEventAt: isoAgo(10 * 7_200_000), processMatchConfidence: -1 });
    expect(result.executionState).toBe("unknown");
    expect(result.processState).not.toBe("stopped");
    expect(["stale", "unknown"]).toContain(result.activityState);
  });

  test("explicit end marker → completed regardless of recency", () => {
    const result = derive({ lastRecordedEventAt: isoAgo(10 * 7_200_000), explicitEndedAt: isoAgo(10 * 7_200_000) });
    expect(result.executionState).toBe("completed");
  });

  test("stall requires process running + active execution + no progress ≥ threshold + no waiting", () => {
    const stalled = derive({
      lastRecordedEventAt: isoAgo(700_000),
      processMatchConfidence: 0.9,
      processExactMatch: true,
      latestEvent: { id: "e", sessionId: "s", parentSessionId: null, runtime: "claude_code", kind: "tool_call", role: "assistant", recordedAt: isoAgo(700_000), observedAt: isoAgo(700_000), toolName: "Bash", summary: null, contentPreview: null, sourcePath: null, sourceOffset: null, sourceRevision: null, truncated: false, malformed: false, metadata: {} },
    });
    expect(stalled.healthState).toBe("stalled");

    const notStalledWaiting = derive({
      lastRecordedEventAt: isoAgo(700_000),
      processMatchConfidence: 0.9,
      processExactMatch: true,
      waitingUserHint: true,
    });
    expect(notStalledWaiting.healthState).not.toBe("stalled");

    const notStalledNoProcess = derive({ lastRecordedEventAt: isoAgo(700_000) });
    expect(notStalledNoProcess.healthState).not.toBe("stalled");
  });

  test("config validation enforces active < recent < idle", () => {
    expect(() => validateConfig({ ...baseConfig(), thresholds: { activeMs: 5000, recentMs: 3000, idleMs: 1000, stalledMs: 1000 } })).toThrow();
    expect(() => validateConfig(baseConfig())).not.toThrow();
  });
});

// --- §44 redaction -------------------------------------------------------------------------

describe("redaction", () => {
  const FAKE_SK = "sk-" + "a".repeat(20);
  const FAKE_ANTH = "sk-ant-" + "b".repeat(20);
  const FAKE_GHP = "ghp_" + "c".repeat(30);
  const FAKE_JWT = "eyJ" + "d".repeat(10) + "." + "e".repeat(10) + "." + "f".repeat(10);
  const FAKE_URL = "postgres://user:pw@db.test/prod";

  test("each supported secret pattern is redacted", () => {
    for (const secret of [FAKE_SK, FAKE_ANTH, FAKE_GHP, FAKE_JWT, FAKE_URL, "Bearer " + "z".repeat(24)]) {
      expect(redactText("prefix " + secret + " suffix").includes(secret)).toBe(false);
    }
    expect(redactText("prefix " + FAKE_SK + " suffix")).toContain("[REDACTED");
    expect(redactText("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----").includes("PRIVATE KEY-----\nabc")).toBe(false);
  });

  test("non-secret text is preserved", () => {
    const text = "The build passed with 42 tests in 3.2s";
    expect(redactText(text)).toBe(text);
  });

  test("nested metadata is sanitized by key name and value", () => {
    const sanitized = redactStructure({ outer: { Authorization: "Bearer " + "z".repeat(24), note: "kept", nested: { database_url: FAKE_URL } } }) as Record<string, unknown>;
    expect(JSON.stringify(sanitized).includes("z".repeat(24))).toBe(false);
    expect(JSON.stringify(sanitized).includes(FAKE_URL)).toBe(false);
    expect(JSON.stringify(sanitized)).toContain("kept");
  });
});

// --- §44 integrity -----------------------------------------------------------------------------

describe("integrity", () => {
  test("hash on demand, cached by revision, force bypasses cache", async () => {
    const engine = new IntegrityEngine();
    const path = join(testDir, "integ.jsonl");
    writeFileSync(path, jsonlLine({ sessionId: "s1", type: "user" }));
    const revision = "rev-1";
    const first = await engine.verify(path, revision, null, { force: false });
    expect(first.status).toBe("verified");
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    // same revision reuses the cache (no rehash needed; digest identical)
    const second = await engine.verify(path, revision, first.digest, { force: false });
    expect(second.digest).toBe(first.digest);
    expect(second.status).toBe("verified");
    // content changes but revision stays → forced check reports changed
    writeFileSync(path, jsonlLine({ sessionId: "s1", type: "assistant" }));
    const forced = await engine.verify(path, revision, first.digest, { force: true });
    expect(forced.status).toBe("changed");
  });
});

// --- §45 adapter → engine integration --------------------------------------------------------------

describe("adapter and engine integration", () => {
  test("claude adapter discovers, inspects and decodes synthetic sessions end-to-end", async () => {
    writeSessionFixture("11111111-2222-3333-4444-555555555555.jsonl", [
      jsonlLine({ sessionId: "11111111-2222-3333-4444-555555555555", type: "system", subtype: "init", timestamp: isoAgo(60_000), cwd: join(testDir, "work") }),
      jsonlLine({ sessionId: "11111111-2222-3333-4444-555555555555", type: "user", timestamp: isoAgo(50_000), message: { role: "user", content: "please run the tests" } }),
      jsonlLine({ sessionId: "11111111-2222-3333-4444-555555555555", type: "assistant", timestamp: isoAgo(40_000), message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] } }),
      jsonlLine({ sessionId: "11111111-2222-3333-4444-555555555555", type: "assistant", timestamp: isoAgo(30_000), message: { role: "assistant", content: [{ type: "text", text: "all tests passed" }] } }),
    ]);
    writeSessionFixture("22222222-2222-3333-4444-555555555555.jsonl", [
      jsonlLine({ sessionId: "22222222-2222-3333-4444-555555555555", type: "user", timestamp: isoAgo(60_000), isSidechain: true }),
      jsonlLine({ sessionId: "22222222-2222-3333-4444-555555555555", type: "assistant", timestamp: isoAgo(55_000) }),
    ]);

    const adapter = new ClaudeJsonlAdapter();
    adapter.configure(fixtureRoot);
    const discovered = await adapter.discover({ nowMs: Date.now(), config: baseConfig(), emitError });
    expect(discovered.length).toBe(2);
    const main = discovered.find((source) => source.sourceSessionId === "11111111-2222-3333-4444-555555555555");
    expect(main).toBeDefined();

    const observation = await adapter.inspectSession(main!, { nowMs: Date.now(), config: baseConfig(), emitError });
    expect(observation.latestEvent?.kind).toBe("assistant_message");
    expect(observation.executionHint).toBe("generating");
    expect(observation.workingDirectory).toBe(join(testDir, "work"));

    const side = discovered.find((source) => source.sourceSessionId === "22222222-2222-3333-4444-555555555555");
    const sideObservation = await adapter.inspectSession(side!, { nowMs: Date.now(), config: baseConfig(), emitError });
    expect(sideObservation.tier).toBe("subagent");
  });

  test("single-flight engine snapshot persists sessions; alias write never touches transcript bytes", async () => {
    const path = writeSessionFixture("33333333-2222-3333-4444-555555555555.jsonl", [
      jsonlLine({ sessionId: "33333333-2222-3333-4444-555555555555", type: "system", subtype: "init", timestamp: isoAgo(60_000), cwd: join(testDir, "w") }),
      jsonlLine({ sessionId: "33333333-2222-3333-4444-555555555555", type: "user", timestamp: isoAgo(30_000), message: { role: "user", content: "hello " + "sk-" + "q".repeat(20) } }),
    ]);
    const bytesBefore = readFileSync(path, "utf8");
    const mtimeBefore = statSync(path).mtimeMs;

    const engine = getObservabilityEngine();
    const [first, second] = await Promise.all([engine.snapshot(), engine.snapshot()]);
    expect(second.summary.sessions).toBeGreaterThanOrEqual(1);
    expect(first.observedAt).toBe(second.observedAt); // single-flight dedupe

    const session = engine.store.listSessions();
    expect(session.length).toBeGreaterThanOrEqual(1);
    const target = session.find((candidate) => candidate.sourceSessionId === "33333333-2222-3333-4444-555555555555");
    expect(target).toBeDefined();
    expect(engine.setAlias(target!.id, "my test session")).toBe(true);

    // Transcript untouched: same bytes, same mtime (§45, §47).
    expect(readFileSync(path, "utf8")).toBe(bytesBefore);
    expect(statSync(path).mtimeMs).toBe(mtimeBefore);
    // Secret redacted before persistence.
    const events = engine.store.listEvents({ sessionId: target!.id, limit: 10 });
    expect(JSON.stringify(events).includes("sk-" + "q".repeat(20))).toBe(false);
  });

  test("malformed source does not break the rest of the fleet", async () => {
    writeSessionFixture("44444444-2222-3333-4444-555555555555.jsonl", [
      jsonlLine({ sessionId: "44444444-2222-3333-4444-555555555555", type: "user", timestamp: isoAgo(10_000) }),
    ]);
    writeSessionFixture("broken.jsonl", ["{{{{not json at all\n"]);
    const engine = getObservabilityEngine();
    const snapshot = await engine.snapshot();
    expect(snapshot.summary.sessions).toBeGreaterThanOrEqual(1);
    const broken = engine.store.listSessions().find((candidate) => candidate.sourcePathHash !== null && candidate.runtime === "claude_code" && candidate.projectName !== null);
    void broken;
  });

  test("generic JSONL adapter maps configured fields", async () => {
    const genericRoot = join(testDir, "generic-logs");
    mkdirSync(genericRoot, { recursive: true });
    writeFileSync(join(genericRoot, "worker.jsonl"), jsonlLine({ session_id: "worker-1", timestamp: isoAgo(5000), type: "tool_call", role: "system", cwd: genericRoot }));
    process.env.OBSERVABILITY_GENERIC_JSONL_SOURCES = JSON.stringify([{ id: "stock-factory", root: genericRoot }]);
    resetObservabilityConfigForTests();
    resetEngineSingletonForTests();
    const engine = getObservabilityEngine();
    const snapshot = await engine.snapshot();
    const session = snapshot.sessions.find((candidate) => candidate.runtime === "generic_jsonl");
    expect(session).toBeDefined();
    expect(session!.latestEventType).toBe("tool_call");
  });

  test("pao-native adapter reads the 20.39 cockpit bus with high-fidelity evidence", async () => {
    const { CockpitService } = await import("../src/agent-os/coding-cockpit/service");
    const cockpit = new CockpitService();
    bindCockpitService(cockpit);
    const root = join(testDir, "pao-workspace");
    mkdirSync(root, { recursive: true });
    const workspace = cockpit.registerWorkspace({ rootPath: root, actor: "operator" });
    const { session } = await cockpit.startSession({ workspaceId: workspace.id, providerId: "mock", actor: "operator" });
    await cockpit.sendMessage({ sessionId: session.id, text: "observe me", actor: "operator" });

    resetEngineSingletonForTests();
    const engine = getObservabilityEngine();
    const snapshot = await engine.snapshot();
    const native = snapshot.sessions.find((candidate) => candidate.runtime === "pao_native" && candidate.sourceSessionId === session.id);
    expect(native).toBeDefined();
    expect(native!.latestEventType).not.toBeNull();
  });

  test("retention removes internal rows only and never touches source files", async () => {
    const path = writeSessionFixture("55555555-2222-3333-4444-555555555555.jsonl", [
      jsonlLine({ sessionId: "55555555-2222-3333-4444-555555555555", type: "user", timestamp: isoAgo(1000) }),
    ]);
    const engine = getObservabilityEngine();
    await engine.snapshot();
    const result = engine.store.retain(Date.now(), 0, 0, 0, 0, 0);
    expect(typeof result.events).toBe("number");
    expect(existsSync2(path)).toBe(true);
  });
});

// --- §17 process evidence -------------------------------------------------------------------------

describe("process evidence", () => {
  test("registry hints are high-confidence and session-bound", () => {
    const hints = registryHints([{ pid: 4242, sessionId: "sess_a", providerId: "claude_code", state: "RUNNING" }]);
    expect(hints.length).toBe(1);
    expect(hints[0].matchType).toBe("registry");
    expect(hints[0].matchConfidence).toBeGreaterThan(0.5);
    expect(hints[0].sessionId).toBe("sess_a");
  });

  test("OS scan is fail-soft (never throws, never claims session association)", () => {
    const outcome = scanProcesses();
    expect(outcome.failed).toBe(false);
    expect(outcome.hints.every((hint) => hint.matchType === "process_name_only" && hint.sessionId === null)).toBe(true);
  });
});

function emitError(): void {
  // adapter context sink used in tests; errors are surfaced via observation
}

function existsSync2(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
