/**
 * ocx seo — headless surface for the Phase 18 SEO Agent OS and the Phase 18.1
 * GEO Intelligence Engine. Read/audit/council only: every mutating website
 * action stays behind the dashboard's human-approval workflow.
 */
import {
  CliUsageError,
  printData,
  rejectArgs,
  runCliAction,
  runtimeRequest,
  takeFlag,
  type RuntimeApiDeps,
} from "./runtime-api";

const USAGE = `Usage:
  ocx seo health [--json]
  ocx seo capabilities [--json]
  ocx seo projects [--json]
  ocx seo analyze <projectId> [--json]
  ocx seo geo-audit <projectId> [--json]
  ocx seo council <projectId> [--json]
  ocx seo report <projectId> [--json]`;

function requireProjectId(argv: string[]): string {
  const id = argv.shift()?.trim();
  if (!id) throw new CliUsageError("project id is required", USAGE);
  return id;
}

async function health(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/seo/provider/health`, {}, deps);
  printData(result, wantsJson, [
    `${String((result as Record<string, unknown>).provider)}: ${String((result as Record<string, unknown>).status)} (mode ${String((result as Record<string, unknown>).activeMode)})`,
  ]);
}

async function capabilities(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/seo/provider/capabilities`, {}, deps);
  printData(result, wantsJson, [
    `${String((result as Record<string, unknown>).provider)}: ${Array.isArray((result as Record<string, unknown>).capabilities) ? ((result as Record<string, unknown>).capabilities as string[]).join(", ") : "none"}`,
  ]);
}

async function projects(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ projects?: Array<Record<string, unknown>> }>(`/api/agent-os/seo/projects`, {}, deps);
  const rows = result.projects ?? [];
  printData(result, wantsJson, rows.map(row => `${String(row.id)}  ${String(row.displayName || row.domain || "")}  ${String(row.domain ?? "")}`.trimEnd()));
}

async function analyze(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireProjectId(argv);
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/seo/projects/${encodeURIComponent(id)}/analyze`, { method: "POST" }, deps);
  printData(result, wantsJson, [
    `Analysis run ${String((result as Record<string, unknown>).runId)} (${String((result as Record<string, unknown>).provider)}, ${String((result as Record<string, unknown>).provenance)}).`,
  ]);
}

async function geoAudit(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireProjectId(argv);
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<Record<string, unknown>>(`/api/agent-os/seo/geo/projects/${encodeURIComponent(id)}/audit`, { method: "POST" }, deps);
  printData(result, wantsJson, [
    `GEO audit run ${String(result.runId)} — heuristic score ${String(result.heuristicscore)}/100.`,
    "All scores are heuristics; website changes still require human approval.",
  ]);
}

async function council(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireProjectId(argv);
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{
    council?: { final?: string; reviewers?: Array<{ reviewer: string; verdict: string; score: number; notes: string }> };
    fixPlan?: { executionPath?: string; steps?: Array<{ order: number; title: string; detail: string; target: string }> };
    policy?: Record<string, unknown>;
  }>(`/api/agent-os/seo/geo/projects/${encodeURIComponent(id)}/council`, { method: "POST" }, deps);
  const lines = [
    `Council verdict: ${result.council?.final ?? "unknown"}`,
    ...(result.council?.reviewers ?? []).map(reviewer =>
      `  ${reviewer.reviewer}: ${reviewer.verdict} (${reviewer.score}/100) — ${reviewer.notes}`),
    "Fix plan (plan only; human approval required for every step):",
    ...(result.fixPlan?.steps ?? []).map(step =>
      `  ${step.order}. ${step.title} → ${step.target}: ${step.detail}`),
    `executionPath: ${result.fixPlan?.executionPath ?? "none"}`,
  ];
  printData(result, wantsJson, lines);
}

async function report(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireProjectId(argv);
  rejectArgs(argv, USAGE);
  const [runs, geoRecs, allRecs] = await Promise.all([
    runtimeRequest<{ runs?: Array<Record<string, unknown>> }>(`/api/agent-os/seo/projects/${encodeURIComponent(id)}/runs`, {}, deps),
    runtimeRequest<{ recommendations?: Array<Record<string, unknown>> }>(`/api/agent-os/seo/geo/projects/${encodeURIComponent(id)}/recommendations`, {}, deps),
    runtimeRequest<{ recommendations?: Array<Record<string, unknown>> }>(`/api/agent-os/seo/projects/${encodeURIComponent(id)}/recommendations`, {}, deps),
  ]);
  const lines = [
    "Audit runs:",
    ...(runs.runs ?? []).map(run => `  ${String(run.id)} ${String(run.kind)} ${String(run.status)} (${String(run.provider)}, ${String(run.provenance)})`),
    "GEO recommendations:",
    ...(geoRecs.recommendations ?? []).map(rec => `  [${String(rec.impact)}] ${String(rec.title)} (${String(rec.status)})`),
    "SEO recommendations:",
    ...(allRecs.recommendations ?? []).filter(rec => !String(rec.title).startsWith("[GEO]")).map(rec => `  [${String(rec.impact)}] ${String(rec.title)} (${String(rec.status)})`),
  ];
  printData({ runs: runs.runs ?? [], geoRecommendations: geoRecs.recommendations ?? [], seoRecommendations: (allRecs.recommendations ?? []).filter(rec => !String(rec.title).startsWith("[GEO]")) }, wantsJson, lines);
}

export async function handleSeoCommand(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  const sub = argv.shift();
  const handlers: Record<string, (args: string[], deps: RuntimeApiDeps) => Promise<void>> = {
    health, capabilities, projects, analyze, "geo-audit": geoAudit, council, report,
  };
  const handler = sub ? handlers[sub] : undefined;
  if (!handler) {
    console.error(sub ? `unknown seo subcommand ${sub}` : "seo subcommand is required");
    console.error(USAGE);
    return 2;
  }
  return runCliAction(() => handler(argv, deps));
}

export const SEO_USAGE = USAGE;
