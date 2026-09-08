// Phase 20.4 — Task Classification & Serialization Policy
// (spec sections 11, 12, 13, 15).
//
// Pure functions over Phase 20.2 SdlcTask rows. No DB writes, no git calls, so
// this stays cheap enough to run inside PLAN_ONLY dry runs.

import type { RiskLevel, SdlcTask } from "../sdlc/types";
import type { ClassifiedTask, CouncilTaskClass, FileIntentManifest } from "./types";

/** Path globs that force serialization when two tasks share them (spec section 13). */
export interface SerializationPolicy {
  /** Lockfiles — concurrent mutation produces unmergeable churn. */
  lockfiles: string[];
  /** Generated output that must be produced by the canonical generator only. */
  generatedPaths: string[];
  /** Central router/index files with historically high collision rates. */
  hotspotPaths: string[];
  /** Release/version manifests. */
  releaseManifests: string[];
  /** Migration/schema files — order dependent. */
  schemaPaths: string[];
}

export const DEFAULT_SERIALIZATION_POLICY: SerializationPolicy = {
  lockfiles: ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"],
  generatedPaths: ["src/generated/", "gui/src/generated/", "src/adapters/cursor/gen/"],
  hotspotPaths: [
    "src/server/management-api.ts",
    "src/agent-os/db.ts",
    "src/index.ts",
    "src/router.ts",
    "gui/src/App.tsx",
    "gui/src/app-routing.ts",
  ],
  releaseManifests: ["package.json", "gui/package.json", "CHANGELOG.md"],
  schemaPaths: ["src/agent-os/db.ts", "migrations/", "schema.sql"],
};

interface ClassRule {
  taskClass: CouncilTaskClass;
  /** Matched against task type, title, description (lowercased). */
  keywords: string[];
  /** Matched against target file paths. */
  pathHints: string[];
}

// Order matters: the first rule that matches wins, so put the
// higher-consequence classes (migration, security) before generic code.
const CLASS_RULES: ClassRule[] = [
  {
    taskClass: "MIGRATION",
    keywords: ["migration", "migrate", "schema change", "alter table"],
    pathHints: ["migrations/", "schema.sql"],
  },
  {
    taskClass: "DATABASE",
    keywords: ["database", "schema", "sqlite", "index", "table", "rollback"],
    pathHints: ["db.ts", "storage/", "/store"],
  },
  {
    taskClass: "SECURITY",
    keywords: ["security", "auth", "authorization", "credential", "secret", "token", "rbac", "permission"],
    pathHints: ["auth", "oauth/", "policy", "gateway"],
  },
  {
    taskClass: "MCP",
    keywords: ["mcp", "tool schema", "webmcp", "tool contract"],
    pathHints: ["webmcp", "/mcp", "mcp/"],
  },
  {
    taskClass: "DESKTOP",
    keywords: ["desktop", "ui smoke", "screenshot", "vision control"],
    pathHints: ["desktop/", "tray/"],
  },
  {
    taskClass: "TEST",
    keywords: ["test", "regression", "fixture", "harness", "coverage"],
    pathHints: ["tests/", ".test.ts", "__tests__/"],
  },
  {
    taskClass: "FRONTEND",
    keywords: ["ui", "frontend", "dashboard", "page", "component", "css", "accessibility"],
    pathHints: ["gui/", ".tsx", ".css"],
  },
  {
    taskClass: "DOCS",
    keywords: ["doc", "documentation", "readme", "changelog"],
    pathHints: ["docs/", ".md", "devlog/"],
  },
  {
    taskClass: "INFRA",
    keywords: ["ci", "pipeline", "docker", "deploy", "workflow", "infra"],
    pathHints: [".github/", "Dockerfile", "compose.yaml", "scripts/"],
  },
  {
    taskClass: "CONFIG",
    keywords: ["config", "env", "setting", "flag"],
    pathHints: [".env", "config.ts", "config/"],
  },
  {
    taskClass: "REFACTOR",
    keywords: ["refactor", "rename", "extract", "cleanup", "dedupe"],
    pathHints: [],
  },
  {
    taskClass: "RESEARCH",
    keywords: ["research", "investigate", "spike", "explore", "evaluate"],
    pathHints: [],
  },
  {
    taskClass: "BACKEND",
    keywords: ["api", "endpoint", "service", "backend", "route", "handler", "business logic"],
    pathHints: ["src/server/", "src/agent-os/", "src/providers/"],
  },
];

function taskKeyOf(task: SdlcTask): string {
  return task.taskKey || task.key || task.id;
}

function normalizedTargets(task: SdlcTask): string[] {
  return (task.targetFiles ?? []).map(p => p.replace(/\\/g, "/")).filter(Boolean);
}

/** Spec section 11 — classify one Phase 20.2 task. */
export function classifyTaskClass(task: SdlcTask): CouncilTaskClass {
  const haystack = [task.title, task.description, String(task.taskType)]
    .join(" ")
    .toLowerCase();
  const paths = normalizedTargets(task).map(p => p.toLowerCase());

  // Task type from Phase 20.2 is a strong signal for a few classes.
  if (task.taskType === "migration") return "MIGRATION";
  if (task.taskType === "doc") return "DOCS";

  for (const rule of CLASS_RULES) {
    if (rule.keywords.some(k => haystack.includes(k))) return rule.taskClass;
    if (rule.pathHints.some(h => paths.some(p => p.includes(h.toLowerCase())))) {
      return rule.taskClass;
    }
  }

  if (task.taskType === "test") return "TEST";
  if (task.taskType === "config") return "CONFIG";
  if (task.taskType === "setup") return "INFRA";
  return "BACKEND";
}

/** Baseline risk from class; callers may raise it from cycle/plan risk. */
export function baselineRiskForClass(taskClass: CouncilTaskClass): RiskLevel {
  switch (taskClass) {
    case "MIGRATION":
    case "SECURITY":
      return "HIGH";
    case "DATABASE":
    case "INFRA":
    case "MCP":
      return "MEDIUM";
    case "DOCS":
    case "RESEARCH":
    case "INVESTIGATION":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

function matchesAny(path: string, patterns: string[]): boolean {
  const p = path.toLowerCase();
  return patterns.some(pat => {
    const q = pat.toLowerCase();
    return q.endsWith("/") ? p.includes(q) : p === q || p.endsWith(`/${q}`) || p.includes(q);
  });
}

/**
 * Spec section 13 — does this task need a serialized lane of its own?
 * Returns the reasons so the planner and the dashboard can explain themselves.
 */
export function evaluateSerialization(
  task: SdlcTask,
  taskClass: CouncilTaskClass,
  policy: SerializationPolicy = DEFAULT_SERIALIZATION_POLICY,
): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const paths = normalizedTargets(task);

  // Migration chains are order dependent (spec section 108).
  if (taskClass === "MIGRATION") reasons.push("migration chain is order-dependent");

  for (const path of paths) {
    if (matchesAny(path, policy.lockfiles)) reasons.push(`touches dependency lockfile: ${path}`);
    if (matchesAny(path, policy.schemaPaths)) reasons.push(`touches shared schema file: ${path}`);
    if (matchesAny(path, policy.generatedPaths))
      reasons.push(`touches generated output: ${path}`);
    if (matchesAny(path, policy.releaseManifests))
      reasons.push(`touches release/version manifest: ${path}`);
  }

  return { required: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export function classifyTask(
  task: SdlcTask,
  options: { cycleRisk?: RiskLevel; policy?: SerializationPolicy } = {},
): ClassifiedTask {
  const taskClass = classifyTaskClass(task);
  const policy = options.policy ?? DEFAULT_SERIALIZATION_POLICY;
  const serialization = evaluateSerialization(task, taskClass, policy);

  const order: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const baseline = baselineRiskForClass(taskClass);
  const cycleRisk = options.cycleRisk;
  const risk =
    cycleRisk && order.indexOf(cycleRisk) > order.indexOf(baseline) ? cycleRisk : baseline;

  return {
    task,
    taskKey: taskKeyOf(task),
    taskClass,
    risk,
    targetPaths: normalizedTargets(task),
    requiresSerialization: serialization.required,
    serializationReasons: serialization.reasons,
  };
}

export function classifyTasks(
  tasks: SdlcTask[],
  options: { cycleRisk?: RiskLevel; policy?: SerializationPolicy } = {},
): ClassifiedTask[] {
  return tasks.map(t => classifyTask(t, options));
}

/**
 * Spec section 15 — build the optional File Intent Manifest. Not required to be
 * exact; it feeds conflict prediction and the SCOPE_DRIFT check (section 37).
 */
export function buildFileIntentManifest(classified: ClassifiedTask): FileIntentManifest {
  const write = [...classified.targetPaths];
  const read = [...write];
  const generated: string[] = [];

  for (const p of write) {
    if (matchesAny(p, DEFAULT_SERIALIZATION_POLICY.generatedPaths)) generated.push(p);
  }

  // Never let an implementation agent touch credentials, VCS internals, or the
  // user's home config, regardless of task (spec sections 101, 102).
  const forbiddenPaths = [
    ".git/",
    ".git/config",
    ".env",
    ".env.local",
    "node_modules/",
    "~/.ssh/",
    "~/.aws/",
    ".pao/worktrees/",
  ];

  return {
    taskKey: classified.taskKey,
    expectedReadPaths: [...new Set(read)],
    expectedWritePaths: [...new Set(write)],
    possibleGeneratedPaths: [...new Set(generated)],
    forbiddenPaths,
  };
}

/** True when the path is outside every declared write path (spec section 37). */
export function isOutOfScope(path: string, manifest: FileIntentManifest): boolean {
  const p = path.replace(/\\/g, "/");
  if (manifest.expectedWritePaths.length === 0) return false;
  return !manifest.expectedWritePaths.some(w => {
    const q = w.replace(/\\/g, "/");
    return q.endsWith("/") ? p.startsWith(q) : p === q || p.startsWith(`${q}/`);
  });
}
