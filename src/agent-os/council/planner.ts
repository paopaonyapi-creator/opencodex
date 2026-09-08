// Phase 20.4 — Parallelization Planner & Conflict Forecaster
// (spec sections 10, 12, 13, 14, 70, 128, 130).
//
// Consumes the Phase 20.2 Task DAG (SdlcTask.dependencies) and produces a
// deterministic, reproducible plan: which tasks may run concurrently, which
// must be serialized, and what the predicted conflicts are.
//
// Deterministic by construction (spec section 10): tasks are sorted by key
// before grouping, so the same DAG always yields the same planHash.

import { createHash } from "node:crypto";
import { topologicalSortTasks } from "../sdlc/tasks";
import type { SdlcTask } from "../sdlc/types";
import {
  DEFAULT_SERIALIZATION_POLICY,
  classifyTasks,
  type SerializationPolicy,
} from "./classify";
import type {
  ClassifiedTask,
  ConflictForecast,
  ConflictRisk,
  ParallelizationPlan,
  ResourceEstimate,
} from "./types";

export const PLANNER_VERSION = 1;
export const PLANNER_GENERATOR = "pao.council.planner.v1";

export interface PlannerInput {
  councilRunId: string;
  cycleId: string;
  tasks: SdlcTask[];
  maxParallel: number;
  maxParallelHighRisk?: number;
  policy?: SerializationPolicy;
  cycleRisk?: import("../sdlc/types").RiskLevel;
}

function keyOf(task: SdlcTask): string {
  return task.taskKey || task.key || task.id;
}

/** Normalize a path for overlap comparison. */
function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * Two paths overlap when they are equal, or one is a directory prefix of the
 * other. "src/agent-os/" overlaps "src/agent-os/council/planner.ts".
 */
function pathsOverlap(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const xDir = x.endsWith("/") ? x : `${x}/`;
  const yDir = y.endsWith("/") ? y : `${y}/`;
  return x.startsWith(yDir) || y.startsWith(xDir);
}

function overlappingPaths(a: ClassifiedTask, b: ClassifiedTask): string[] {
  const hits: string[] = [];
  for (const pa of a.targetPaths) {
    for (const pb of b.targetPaths) {
      if (pathsOverlap(pa, pb)) hits.push(norm(pa) === norm(pb) ? pa : `${pa} ~ ${pb}`);
    }
  }
  return [...new Set(hits)];
}

const RISK_ORDER: ConflictRisk[] = ["LOW", "MEDIUM", "HIGH", "BLOCKING"];

function maxRisk(a: ConflictRisk, b: ConflictRisk): ConflictRisk {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

/**
 * Spec section 14 — forecast the conflict risk between two tasks that the DAG
 * would otherwise allow to run concurrently.
 */
export function forecastPairConflict(
  a: ClassifiedTask,
  b: ClassifiedTask,
  policy: SerializationPolicy = DEFAULT_SERIALIZATION_POLICY,
): ConflictForecast {
  const reasons: string[] = [];
  let risk: ConflictRisk = "LOW";

  const overlap = overlappingPaths(a, b);

  // Both tasks in the same migration chain must never interleave.
  if (a.taskClass === "MIGRATION" && b.taskClass === "MIGRATION") {
    risk = "BLOCKING";
    reasons.push("both tasks are migrations in an order-dependent chain");
  }

  const sharesFrom = (patterns: string[]): string[] =>
    overlap.filter(o => patterns.some(pat => norm(o).includes(norm(pat))));

  const lockHits = sharesFrom(policy.lockfiles);
  if (lockHits.length > 0) {
    risk = maxRisk(risk, "BLOCKING");
    reasons.push(`both tasks mutate a dependency lockfile (${lockHits.join(", ")})`);
  }

  const schemaHits = sharesFrom(policy.schemaPaths);
  if (schemaHits.length > 0) {
    risk = maxRisk(risk, "BLOCKING");
    reasons.push(`both tasks mutate shared schema (${schemaHits.join(", ")})`);
  }

  const generatedHits = sharesFrom(policy.generatedPaths);
  if (generatedHits.length > 0) {
    risk = maxRisk(risk, "HIGH");
    reasons.push(`both tasks write generated output (${generatedHits.join(", ")})`);
  }

  const releaseHits = sharesFrom(policy.releaseManifests);
  if (releaseHits.length > 0) {
    risk = maxRisk(risk, "HIGH");
    reasons.push(`both tasks touch a release manifest (${releaseHits.join(", ")})`);
  }

  const hotspotHits = sharesFrom(policy.hotspotPaths);
  if (hotspotHits.length > 0) {
    risk = maxRisk(risk, "HIGH");
    reasons.push(`both tasks touch a high-collision hotspot (${hotspotHits.join(", ")})`);
  }

  // Generic file overlap that is not one of the special cases above.
  if (overlap.length > 0 && reasons.length === 0) {
    const exact = overlap.some(o => !o.includes(" ~ "));
    risk = maxRisk(risk, exact ? "HIGH" : "MEDIUM");
    reasons.push(
      exact
        ? `tasks write the same file(s): ${overlap.join(", ")}`
        : `tasks write overlapping directories: ${overlap.join(", ")}`,
    );
  }

  // A semantic pairing worth flagging even without textual overlap
  // (spec section 63): backend contract change + frontend consumer.
  if (
    overlap.length === 0 &&
    ((a.taskClass === "BACKEND" && b.taskClass === "FRONTEND") ||
      (a.taskClass === "FRONTEND" && b.taskClass === "BACKEND"))
  ) {
    risk = maxRisk(risk, "MEDIUM");
    reasons.push(
      "backend/frontend pair: possible semantic (API contract) conflict without textual overlap",
    );
  }

  return {
    taskA: a.taskKey,
    taskB: b.taskKey,
    risk,
    overlappingPaths: overlap,
    reasons,
  };
}

/** Dependency-closure: every task key that must finish before `key`. */
function transitiveDeps(key: string, byKey: Map<string, ClassifiedTask>): Set<string> {
  const out = new Set<string>();
  const walk = (k: string): void => {
    const node = byKey.get(k);
    for (const d of node?.task.dependencies ?? []) {
      if (!byKey.has(d) || out.has(d)) continue;
      out.add(d);
      walk(d);
    }
  };
  walk(key);
  return out;
}

/**
 * Spec sections 12/13/130 — build waves.
 *
 * Algorithm: repeatedly take the set of tasks whose dependencies are all
 * already scheduled ("ready"), then pack them into a wave while respecting
 * (a) the concurrency cap, (b) BLOCKING/HIGH pairwise conflict forecasts, and
 * (c) tasks that demand a serialized lane of their own. Anything that cannot
 * join the current wave falls through to the next one.
 */
export function buildParallelGroups(
  classified: ClassifiedTask[],
  options: {
    maxParallel: number;
    maxParallelHighRisk?: number;
    policy?: SerializationPolicy;
  },
): {
  parallelGroups: string[][];
  serializedGroups: string[][];
  conflicts: ConflictForecast[];
} {
  const policy = options.policy ?? DEFAULT_SERIALIZATION_POLICY;
  const maxParallel = Math.max(1, options.maxParallel);
  const maxHighRisk = Math.max(1, options.maxParallelHighRisk ?? 1);

  // Deterministic order (spec section 10).
  const sorted = [...classified].sort((a, b) => a.taskKey.localeCompare(b.taskKey));
  const byKey = new Map(sorted.map(t => [t.taskKey, t]));

  // Topologically order so dependencies are always considered first. Falls back
  // to key order if Phase 20.2 reports a cycle (it validates this itself).
  let topo: ClassifiedTask[];
  try {
    const ordered = topologicalSortTasks(sorted.map(c => c.task));
    topo = ordered.map(t => byKey.get(keyOf(t))!).filter(Boolean);
  } catch {
    topo = sorted;
  }

  // Pairwise forecast across every pair that could theoretically co-run
  // (i.e. neither depends on the other).
  const conflicts: ConflictForecast[] = [];
  const pairRisk = new Map<string, ConflictRisk>();
  const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

  for (let i = 0; i < topo.length; i++) {
    for (let j = i + 1; j < topo.length; j++) {
      const a = topo[i]!;
      const b = topo[j]!;
      const aDeps = transitiveDeps(a.taskKey, byKey);
      const bDeps = transitiveDeps(b.taskKey, byKey);
      if (aDeps.has(b.taskKey) || bDeps.has(a.taskKey)) continue; // ordered by DAG already
      const forecast = forecastPairConflict(a, b, policy);
      if (forecast.risk !== "LOW" || forecast.reasons.length > 0) conflicts.push(forecast);
      pairRisk.set(pairKey(a.taskKey, b.taskKey), forecast.risk);
    }
  }

  const scheduled = new Set<string>();
  const parallelGroups: string[][] = [];
  const serializedGroups: string[][] = [];
  const remaining = new Set(topo.map(t => t.taskKey));

  const depsSatisfied = (t: ClassifiedTask): boolean =>
    (t.task.dependencies ?? []).every(d => !byKey.has(d) || scheduled.has(d));

  let guard = 0;
  while (remaining.size > 0) {
    if (++guard > topo.length + 5) break; // defensive: never spin forever

    const ready = topo.filter(t => remaining.has(t.taskKey) && depsSatisfied(t));
    if (ready.length === 0) break; // remaining tasks are blocked by missing deps

    const wave: string[] = [];
    let highRiskInWave = 0;

    for (const cand of ready) {
      if (wave.length >= maxParallel) break;

      // A task that needs its own lane goes alone in a serialized group.
      if (cand.requiresSerialization) continue;

      const conflictsWithWave = wave.some(w => {
        const r = pairRisk.get(pairKey(cand.taskKey, w));
        return r === "BLOCKING" || r === "HIGH";
      });
      if (conflictsWithWave) continue;

      const isHighRisk = cand.risk === "HIGH" || cand.risk === "CRITICAL";
      if (isHighRisk && highRiskInWave >= maxHighRisk) continue;

      wave.push(cand.taskKey);
      if (isHighRisk) highRiskInWave++;
    }

    if (wave.length > 0) {
      for (const k of wave) {
        scheduled.add(k);
        remaining.delete(k);
      }
      parallelGroups.push(wave);
      continue;
    }

    // Nothing could be packed in parallel -> emit one serialized task.
    // Prefer a serialization-required task, else the first ready task.
    const solo = ready.find(t => t.requiresSerialization) ?? ready[0]!;
    scheduled.add(solo.taskKey);
    remaining.delete(solo.taskKey);
    serializedGroups.push([solo.taskKey]);
  }

  // Any task still remaining could not be scheduled (unsatisfiable deps).
  if (remaining.size > 0) {
    serializedGroups.push([...remaining].sort());
  }

  return { parallelGroups, serializedGroups, conflicts };
}

export function estimateResources(
  classified: ClassifiedTask[],
  parallelGroups: string[][],
  serializedGroups: string[][],
  maxParallel: number,
): ResourceEstimate {
  const byKey = new Map(classified.map(c => [c.taskKey, c]));
  const minutesFor = (key: string): number =>
    byKey.get(key)?.task.estimatedMinutes ?? 30;

  // Each parallel wave costs its slowest member; serialized tasks add fully.
  let wallClock = 0;
  for (const wave of parallelGroups) {
    wallClock += Math.max(0, ...wave.map(minutesFor));
  }
  for (const grp of serializedGroups) {
    wallClock += grp.reduce((sum, k) => sum + minutesFor(k), 0);
  }

  const concurrency = Math.min(
    maxParallel,
    Math.max(1, ...parallelGroups.map(w => w.length), 1),
  );

  return {
    taskCount: classified.length,
    maxConcurrency: concurrency,
    estimatedWallClockMinutes: wallClock,
    // +1 for the dedicated integration worktree (spec section 68).
    estimatedWorktrees: classified.length > 0 ? concurrency + 1 : 0,
    estimatedAgentRuns: classified.length,
  };
}

/** Spec section 10 — the full plan. Pure: no DB writes, no git, no worktrees. */
export function buildParallelizationPlan(input: PlannerInput): ParallelizationPlan {
  const classified = classifyTasks(input.tasks, {
    cycleRisk: input.cycleRisk,
    policy: input.policy,
  });

  const { parallelGroups, serializedGroups, conflicts } = buildParallelGroups(classified, {
    maxParallel: input.maxParallel,
    maxParallelHighRisk: input.maxParallelHighRisk,
    policy: input.policy,
  });

  const resourceEstimate = estimateResources(
    classified,
    parallelGroups,
    serializedGroups,
    input.maxParallel,
  );

  const taskKeys = classified.map(c => c.taskKey).sort();

  // planHash covers only plan-shaping inputs, so it is stable across runs and
  // usable as a reproducibility check (spec section 10).
  const planHash = createHash("sha256")
    .update(
      JSON.stringify({
        generator: PLANNER_GENERATOR,
        version: PLANNER_VERSION,
        cycleId: input.cycleId,
        maxParallel: input.maxParallel,
        maxParallelHighRisk: input.maxParallelHighRisk ?? 1,
        taskKeys,
        parallelGroups,
        serializedGroups,
      }),
    )
    .digest("hex");

  return {
    id: `cplan_${planHash.slice(0, 16)}`,
    councilRunId: input.councilRunId,
    cycleId: input.cycleId,
    taskKeys,
    parallelGroups,
    serializedGroups,
    conflictRisks: conflicts,
    resourceEstimate,
    generator: PLANNER_GENERATOR,
    version: PLANNER_VERSION,
    planHash,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Spec section 70 — integration order. Dependencies first, then serialized
 * (migration/lockfile) work ahead of ordinary changes, then by key.
 */
export function computeIntegrationOrder(classified: ClassifiedTask[]): string[] {
  const byKey = new Map(classified.map(c => [c.taskKey, c]));
  let ordered: ClassifiedTask[];
  try {
    ordered = topologicalSortTasks(
      [...classified].sort((a, b) => a.taskKey.localeCompare(b.taskKey)).map(c => c.task),
    )
      .map(t => byKey.get(keyOf(t))!)
      .filter(Boolean);
  } catch {
    ordered = [...classified].sort((a, b) => a.taskKey.localeCompare(b.taskKey));
  }

  const rank = (c: ClassifiedTask): number => {
    if (c.taskClass === "MIGRATION") return 0;
    if (c.requiresSerialization) return 1;
    if (c.taskClass === "DATABASE") return 2;
    return 3;
  };

  // Stable sort that preserves topological order within the same rank.
  return ordered
    .map((c, i) => ({ c, i }))
    .sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i)
    .map(({ c }) => c.taskKey);
}

/** Spec section 128 — approximate critical path (longest dependency chain). */
export function computeCriticalPath(classified: ClassifiedTask[]): {
  path: string[];
  totalMinutes: number;
} {
  const byKey = new Map(classified.map(c => [c.taskKey, c]));
  const memo = new Map<string, { path: string[]; minutes: number }>();

  const walk = (key: string, seen: Set<string>): { path: string[]; minutes: number } => {
    const cached = memo.get(key);
    if (cached) return cached;
    if (seen.has(key)) return { path: [], minutes: 0 }; // cycle guard

    const node = byKey.get(key);
    if (!node) return { path: [], minutes: 0 };

    const nextSeen = new Set(seen).add(key);
    let best: { path: string[]; minutes: number } = { path: [], minutes: 0 };
    for (const dep of node.task.dependencies ?? []) {
      if (!byKey.has(dep)) continue;
      const r = walk(dep, nextSeen);
      if (r.minutes > best.minutes) best = r;
    }

    const own = node.task.estimatedMinutes ?? 30;
    const result = { path: [...best.path, key], minutes: best.minutes + own };
    memo.set(key, result);
    return result;
  };

  let longest: { path: string[]; minutes: number } = { path: [], minutes: 0 };
  for (const c of [...classified].sort((a, b) => a.taskKey.localeCompare(b.taskKey))) {
    const r = walk(c.taskKey, new Set());
    if (r.minutes > longest.minutes) longest = r;
  }

  return { path: longest.path, totalMinutes: longest.minutes };
}
