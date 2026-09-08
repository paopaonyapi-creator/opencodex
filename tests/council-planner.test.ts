// Phase 20.4 — Parallelization Planner / Classifier / Conflict Forecast tests
// (spec sections 162, 166, 170, 175).

import { describe, it, expect } from "bun:test";
import type { SdlcTask } from "../src/agent-os/sdlc/types";
import {
  classifyTask,
  classifyTaskClass,
  evaluateSerialization,
  buildFileIntentManifest,
  isOutOfScope,
} from "../src/agent-os/council/classify";
import {
  buildParallelizationPlan,
  buildParallelGroups,
  forecastPairConflict,
  computeIntegrationOrder,
  computeCriticalPath,
} from "../src/agent-os/council/planner";
import { classifyTasks } from "../src/agent-os/council/classify";
import {
  canTransitionCouncil,
  assertCouncilTransition,
  isTerminalCouncilState,
} from "../src/agent-os/council/state-machine";
import { loadCouncilConfig, resolveResourceBudget, isProtectedBranch } from "../src/agent-os/council/config";

function task(partial: Partial<SdlcTask> & { key: string }): SdlcTask {
  return {
    id: `task_${partial.key}`,
    cycleId: "cycle_test",
    key: partial.key,
    title: partial.title ?? "Untitled",
    description: partial.description ?? "",
    taskType: partial.taskType ?? "code",
    status: partial.status ?? "pending",
    dependencies: partial.dependencies ?? [],
    targetFiles: partial.targetFiles ?? [],
    acceptanceCriteriaKeys: partial.acceptanceCriteriaKeys ?? [],
    estimatedMinutes: partial.estimatedMinutes ?? 30,
    actualMinutes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as SdlcTask;
}

describe("Phase 20.4 — task classification (spec section 11)", () => {
  it("classifies backend, frontend, test, docs and migration tasks", () => {
    expect(
      classifyTaskClass(task({ key: "T1", title: "Add REST API endpoint", targetFiles: ["src/server/x.ts"] })),
    ).toBe("BACKEND");
    expect(
      classifyTaskClass(task({ key: "T2", title: "Build dashboard page", targetFiles: ["gui/src/pages/A.tsx"] })),
    ).toBe("FRONTEND");
    expect(classifyTaskClass(task({ key: "T3", title: "Write regression tests", taskType: "test" }))).toBe("TEST");
    expect(classifyTaskClass(task({ key: "T4", title: "Update docs", taskType: "doc" }))).toBe("DOCS");
    expect(classifyTaskClass(task({ key: "T5", title: "Schema migration", taskType: "migration" }))).toBe("MIGRATION");
  });

  it("routes auth/secret work to SECURITY ahead of generic backend", () => {
    expect(
      classifyTaskClass(task({ key: "S1", title: "Harden auth token validation", targetFiles: ["src/server/auth.ts"] })),
    ).toBe("SECURITY");
  });

  it("raises risk to HIGH for migration and security classes", () => {
    expect(classifyTask(task({ key: "M1", taskType: "migration", title: "migrate" })).risk).toBe("HIGH");
    expect(classifyTask(task({ key: "S2", title: "authorization change" })).risk).toBe("HIGH");
    expect(classifyTask(task({ key: "D1", taskType: "doc", title: "docs" })).risk).toBe("LOW");
  });
});

describe("Phase 20.4 — serialization rules (spec section 13)", () => {
  it("requires serialization for lockfile mutation", () => {
    const t = task({ key: "L1", title: "Bump dependency", targetFiles: ["bun.lock", "package.json"] });
    const res = evaluateSerialization(t, classifyTaskClass(t));
    expect(res.required).toBe(true);
    expect(res.reasons.some(r => r.includes("lockfile"))).toBe(true);
  });

  it("requires serialization for shared schema file", () => {
    const t = task({ key: "L2", title: "Add table", targetFiles: ["src/agent-os/db.ts"] });
    const res = evaluateSerialization(t, classifyTaskClass(t));
    expect(res.required).toBe(true);
  });

  it("does not serialize an isolated docs task", () => {
    const t = task({ key: "L3", taskType: "doc", title: "Update README", targetFiles: ["docs/readme.md"] });
    expect(evaluateSerialization(t, classifyTaskClass(t)).required).toBe(false);
  });
});

describe("Phase 20.4 — conflict forecast (spec sections 14, 63)", () => {
  it("flags two migrations as BLOCKING", () => {
    const [a, b] = classifyTasks([
      task({ key: "A", taskType: "migration", title: "migration one" }),
      task({ key: "B", taskType: "migration", title: "migration two" }),
    ]);
    expect(forecastPairConflict(a!, b!).risk).toBe("BLOCKING");
  });

  it("flags shared lockfile as BLOCKING", () => {
    const [a, b] = classifyTasks([
      task({ key: "A", title: "dep bump a", targetFiles: ["bun.lock"] }),
      task({ key: "B", title: "dep bump b", targetFiles: ["bun.lock"] }),
    ]);
    const f = forecastPairConflict(a!, b!);
    expect(f.risk).toBe("BLOCKING");
    expect(f.overlappingPaths.length).toBeGreaterThan(0);
  });

  it("flags same-file edits as HIGH", () => {
    const [a, b] = classifyTasks([
      task({ key: "A", title: "edit service", targetFiles: ["src/svc/a.ts"] }),
      task({ key: "B", title: "edit service too", targetFiles: ["src/svc/a.ts"] }),
    ]);
    expect(forecastPairConflict(a!, b!).risk).toBe("HIGH");
  });

  it("flags backend/frontend pairs as MEDIUM semantic risk without overlap", () => {
    const [a, b] = classifyTasks([
      task({ key: "A", title: "Change API response", targetFiles: ["src/server/api.ts"] }),
      task({ key: "B", title: "Build UI component", targetFiles: ["gui/src/c.tsx"] }),
    ]);
    const f = forecastPairConflict(a!, b!);
    expect(f.risk).toBe("MEDIUM");
    expect(f.reasons.join(" ")).toContain("semantic");
  });

  it("leaves genuinely unrelated tasks at LOW", () => {
    const [a, b] = classifyTasks([
      task({ key: "A", taskType: "doc", title: "docs", targetFiles: ["docs/a.md"] }),
      task({ key: "B", taskType: "test", title: "tests", targetFiles: ["tests/b.test.ts"] }),
    ]);
    expect(forecastPairConflict(a!, b!).risk).toBe("LOW");
  });
});

describe("Phase 20.4 — parallel grouping (spec sections 12, 166, 174)", () => {
  it("puts three independent tasks in one wave", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "Backend API", targetFiles: ["src/server/a.ts"] }),
      task({ key: "T2", taskType: "doc", title: "Docs", targetFiles: ["docs/a.md"] }),
      task({ key: "T3", taskType: "test", title: "Tests", targetFiles: ["tests/a.test.ts"] }),
    ]);
    const { parallelGroups } = buildParallelGroups(classified, { maxParallel: 4 });
    expect(parallelGroups.length).toBe(1);
    expect(parallelGroups[0]!.sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("never starts a dependent task in the same wave as its dependency", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "Backend API", targetFiles: ["src/server/a.ts"] }),
      task({ key: "T2", title: "Frontend integration", dependencies: ["T1"], targetFiles: ["gui/src/b.tsx"] }),
    ]);
    const { parallelGroups, serializedGroups } = buildParallelGroups(classified, { maxParallel: 4 });
    const all = [...parallelGroups, ...serializedGroups];
    const waveOf = (k: string): number => all.findIndex(w => w.includes(k));
    expect(waveOf("T1")).toBeLessThan(waveOf("T2"));
  });

  it("serializes two lockfile tasks into separate lanes (spec section 175)", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "dep a", targetFiles: ["bun.lock"] }),
      task({ key: "T2", title: "dep b", targetFiles: ["bun.lock"] }),
    ]);
    const { parallelGroups, serializedGroups } = buildParallelGroups(classified, { maxParallel: 4 });
    expect(parallelGroups.length).toBe(0);
    expect(serializedGroups.length).toBe(2);
  });

  it("respects the concurrency cap", () => {
    const classified = classifyTasks(
      Array.from({ length: 6 }, (_, i) =>
        task({ key: `T${i + 1}`, taskType: "doc", title: `doc ${i}`, targetFiles: [`docs/f${i}.md`] }),
      ),
    );
    const { parallelGroups } = buildParallelGroups(classified, { maxParallel: 2 });
    for (const wave of parallelGroups) expect(wave.length).toBeLessThanOrEqual(2);
  });

  it("caps concurrent high-risk tasks", () => {
    const classified = classifyTasks([
      task({ key: "S1", title: "auth change one", targetFiles: ["src/a/x.ts"] }),
      task({ key: "S2", title: "auth change two", targetFiles: ["src/b/y.ts"] }),
    ]);
    const { parallelGroups } = buildParallelGroups(classified, {
      maxParallel: 4,
      maxParallelHighRisk: 1,
    });
    for (const wave of parallelGroups) {
      expect(wave.length).toBeLessThanOrEqual(1);
    }
  });

  it("schedules every task exactly once", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "Backend", targetFiles: ["src/server/a.ts"] }),
      task({ key: "T2", title: "Frontend", dependencies: ["T1"], targetFiles: ["gui/src/b.tsx"] }),
      task({ key: "T3", taskType: "migration", title: "migration", targetFiles: ["migrations/1.sql"] }),
      task({ key: "T4", taskType: "doc", title: "docs", targetFiles: ["docs/a.md"] }),
    ]);
    const { parallelGroups, serializedGroups } = buildParallelGroups(classified, { maxParallel: 3 });
    const flat = [...parallelGroups, ...serializedGroups].flat();
    expect(flat.sort()).toEqual(["T1", "T2", "T3", "T4"]);
    expect(new Set(flat).size).toBe(4);
  });
});

describe("Phase 20.4 — plan determinism (spec section 10)", () => {
  const tasks = [
    task({ key: "T1", title: "Backend API", targetFiles: ["src/server/a.ts"] }),
    task({ key: "T2", title: "Frontend", dependencies: ["T1"], targetFiles: ["gui/src/b.tsx"] }),
    task({ key: "T3", taskType: "doc", title: "Docs", targetFiles: ["docs/a.md"] }),
  ];

  it("produces the same planHash for the same input", () => {
    const a = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 4 });
    const b = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 4 });
    expect(a.planHash).toBe(b.planHash);
  });

  it("is insensitive to input task ordering", () => {
    const a = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 4 });
    const b = buildParallelizationPlan({
      councilRunId: "r1",
      cycleId: "c1",
      tasks: [...tasks].reverse(),
      maxParallel: 4,
    });
    expect(a.planHash).toBe(b.planHash);
  });

  it("changes planHash when concurrency changes the shape", () => {
    const a = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 4 });
    const b = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 1 });
    expect(a.planHash).not.toBe(b.planHash);
  });

  it("estimates one extra worktree for the integration lane", () => {
    const plan = buildParallelizationPlan({ councilRunId: "r1", cycleId: "c1", tasks, maxParallel: 4 });
    expect(plan.resourceEstimate.estimatedWorktrees).toBe(plan.resourceEstimate.maxConcurrency + 1);
    expect(plan.resourceEstimate.taskCount).toBe(3);
  });
});

describe("Phase 20.4 — integration order & critical path (spec sections 70, 128)", () => {
  it("orders migrations first", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "Backend", targetFiles: ["src/server/a.ts"] }),
      task({ key: "T2", taskType: "migration", title: "migration", targetFiles: ["migrations/1.sql"] }),
    ]);
    expect(computeIntegrationOrder(classified)[0]).toBe("T2");
  });

  it("computes the longest dependency chain", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "a", estimatedMinutes: 10 }),
      task({ key: "T2", title: "b", dependencies: ["T1"], estimatedMinutes: 20 }),
      task({ key: "T3", title: "c", dependencies: ["T2"], estimatedMinutes: 30 }),
      task({ key: "T4", taskType: "doc", title: "d", estimatedMinutes: 5 }),
    ]);
    const cp = computeCriticalPath(classified);
    expect(cp.path).toEqual(["T1", "T2", "T3"]);
    expect(cp.totalMinutes).toBe(60);
  });

  it("survives a dependency cycle without hanging", () => {
    const classified = classifyTasks([
      task({ key: "T1", title: "a", dependencies: ["T2"] }),
      task({ key: "T2", title: "b", dependencies: ["T1"] }),
    ]);
    expect(() => computeCriticalPath(classified)).not.toThrow();
  });
});

describe("Phase 20.4 — file intent manifest & scope drift (spec sections 15, 37)", () => {
  it("marks paths outside declared writes as out of scope", () => {
    const c = classifyTask(task({ key: "T1", title: "backend", targetFiles: ["src/server/"] }));
    const manifest = buildFileIntentManifest(c);
    expect(isOutOfScope("src/server/a.ts", manifest)).toBe(false);
    expect(isOutOfScope("gui/src/App.tsx", manifest)).toBe(true);
  });

  it("always forbids git internals and env files", () => {
    const manifest = buildFileIntentManifest(classifyTask(task({ key: "T1", title: "x" })));
    expect(manifest.forbiddenPaths).toContain(".git/");
    expect(manifest.forbiddenPaths).toContain(".env");
  });
});

describe("Phase 20.4 — council state machine (spec section 131)", () => {
  it("allows the documented happy path", () => {
    expect(canTransitionCouncil("CREATED", "PLANNING")).toBe(true);
    expect(canTransitionCouncil("PLANNING", "SCHEDULING")).toBe(true);
    expect(canTransitionCouncil("SCHEDULING", "EXECUTING")).toBe(true);
    expect(canTransitionCouncil("INTEGRATING", "FULL_VERIFY")).toBe(true);
    expect(canTransitionCouncil("FULL_VERIFY", "MERGE_READY")).toBe(true);
    expect(canTransitionCouncil("MERGE_READY", "COMPLETED")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransitionCouncil("CREATED", "MERGE_READY")).toBe(false);
    expect(canTransitionCouncil("COMPLETED", "EXECUTING")).toBe(false);
    expect(() => assertCouncilTransition("CREATED", "COMPLETED")).toThrow();
  });

  it("lets a moved target branch pull MERGE_READY back to integration (spec section 178)", () => {
    expect(canTransitionCouncil("MERGE_READY", "INTEGRATING")).toBe(true);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(isTerminalCouncilState("COMPLETED")).toBe(true);
    expect(isTerminalCouncilState("CANCELLED")).toBe(true);
    expect(isTerminalCouncilState("EXECUTING")).toBe(false);
  });
});

describe("Phase 20.4 — config defaults (spec sections 158, 159, 77)", () => {
  it("is disabled by default so Phase 20.2 keeps working", () => {
    expect(loadCouncilConfig({}).enabled).toBe(false);
  });

  it("defaults to PLAN_ONLY, push disabled, no protected auto-merge", () => {
    const c = loadCouncilConfig({});
    expect(c.defaultExecutionMode).toBe("PLAN_ONLY");
    expect(c.remotePushEnabled).toBe(false);
    expect(c.autoMergeProtectedBranch).toBe(false);
  });

  it("matches protected branch patterns including release/*", () => {
    const c = loadCouncilConfig({});
    expect(isProtectedBranch("main", c)).toBe(true);
    expect(isProtectedBranch("release/2.46", c)).toBe(true);
    expect(isProtectedBranch("pao/cycle-1/task-2", c)).toBe(false);
  });

  it("ECONOMY lowers concurrency; FAST does not raise high-risk parallelism", () => {
    const c = loadCouncilConfig({ PAO_COUNCIL_MAX_PARALLEL_AGENTS: "6" });
    expect(resolveResourceBudget(c, "ECONOMY").maxParallelAgents).toBeLessThanOrEqual(2);
    expect(resolveResourceBudget(c, "FAST").maxParallelHighRisk).toBe(c.maxParallelHighRisk);
  });
});
