// Phase 20.62 — GraftProvider: the production CodeIntelligenceProvider.
//
// Maps the neutral contract onto the verified upstream CLI (graft 0.18.0):
//   map -> `graft map`                    ask -> `graft ask "<q>" --json`
//   skeleton -> `graft skeleton <file>`   grep -> `graft grep <pattern>`
//   callers -> `graft callers <sym> --direction in|out -d N`
//   blast -> `graft blast --format json`  check -> `graft check --json`
//   build -> `graft build [--deep]`       version -> `graft version`
// All invocations are argv arrays through the runner seam; user inputs are
// validated (never option-shaped), outputs are capped and normalized here so
// upstream shapes never leak into domain types.

import { CodeIntelError, type BlastRadiusReport, type CodeIntelligenceCapabilities, type CodeIntelligenceProvider, type CodeOccurrence, type CodeSearchResult, type DependencyTrace, type FileApiSurface, type FindAllInput, type FindCodeInput, type FreshnessReport, type GraphBuildResult, type ProviderHealth, type RepositoryMap } from "../../types";
import { isVersionCompatible, parseGraftVersion, type GraftProcessRunner } from "./runner";
import { assertSafeCliArg } from "../../scope";

export interface GraftProviderOptions {
  runner: GraftProcessRunner;
  bin: string;
  pinnedVersion: string;
  versionPolicy: "compatible" | "exact";
  deepEnrichmentEnabled: boolean;
  maxQuerySeconds: number;
  maxBuildSeconds: number;
  maxResponseBytes: number;
  maxTraceDepth: number;
}

interface AskJson {
  results?: Array<{ title?: string; path?: string; symbol?: string; snippet?: string; score?: number }>;
}

interface CheckJson {
  fresh?: boolean;
  drift?: string;
}

interface BlastJson {
  changed_files?: string[];
  impacted_symbols?: string[];
  impacted_tests?: string[];
}

export class GraftProvider implements CodeIntelligenceProvider {
  readonly provider = "graft";
  private readonly options: GraftProviderOptions;
  private cachedHealth: ProviderHealth | null = null;

  constructor(options: GraftProviderOptions) {
    this.options = options;
  }

  private argv(...args: string[]): string[] {
    return [this.options.bin, ...args];
  }

  private async runArgs(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
    const result = await this.options.runner.run(this.argv(...args), cwd, timeoutMs, this.options.maxResponseBytes);
    if (result.timedOut) {
      throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 504, "graft command timed out");
    }
    return result;
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const output = await this.options.runner.version(this.options.bin, 10_000);
      const version = parseGraftVersion(output);
      const compatible = isVersionCompatible(version, this.options.pinnedVersion, this.options.versionPolicy);
      this.cachedHealth = {
        available: Boolean(version),
        provider: this.provider,
        version: version || null,
        nodeVersion: process.versions.node ?? null,
        compatible,
        incompatibilityReason: compatible ? null : `graft ${version || "(undetected)"} does not satisfy the pinned ${this.options.pinnedVersion} (${this.options.versionPolicy})`,
        telemetryDisabled: true, // the runner always injects DO_NOT_TRACK=1
      };
      return this.cachedHealth;
    } catch {
      this.cachedHealth = {
        available: false, provider: this.provider, version: null,
        nodeVersion: process.versions.node ?? null, compatible: false,
        incompatibilityReason: "graft executable not found or not runnable",
        telemetryDisabled: true,
      };
      return this.cachedHealth;
    }
  }

  private async ensureAvailable(): Promise<ProviderHealth> {
    const health = this.cachedHealth ?? (await this.healthCheck());
    if (!health.available) {
      throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "graft is not installed or not runnable on this host");
    }
    if (!health.compatible) {
      throw new CodeIntelError("CODEINTEL_VERSION_MISMATCH", 409, health.incompatibilityReason ?? "graft version drift");
    }
    return health;
  }

  async getCapabilities(): Promise<CodeIntelligenceCapabilities> {
    const health = await this.healthCheck();
    return {
      provider: this.provider,
      version: health.version,
      structural: health.available,
      deepEnrichment: this.options.deepEnrichmentEnabled,
      mcpTools: ["graft_find_code", "graft_file_api", "graft_trace_calls", "graft_find_all", "graft_repo_map", "graft_check_freshness"],
      compatible: health.compatible,
      incompatibilityReason: health.incompatibilityReason,
    };
  }

  async getRepositoryMap(input: { cwd: string; scope?: string; maxDirs?: number }): Promise<RepositoryMap> {
    await this.ensureAvailable();
    const args = ["map"];
    if (input.scope) args.push("--in", assertSafeCliArg(input.scope, "scope"));
    if (input.maxDirs) args.push("--max-dirs", String(Math.max(1, Math.min(50, input.maxDirs))));
    const result = await this.runArgs(args, input.cwd, this.options.maxQuerySeconds * 1000);
    return parseMapOutput(result.stdout);
  }

  async findCode(input: FindCodeInput): Promise<CodeSearchResult[]> {
    await this.ensureAvailable();
    const question = assertSafeCliArg(input.question.replace(/"/g, ""), "question");
    const args = ["ask", question, "--json"];
    for (const scope of input.pathScope ?? []) args.push("--in", assertSafeCliArg(scope, "pathScope"));
    const result = await this.runArgs(args, input.cwd, this.options.maxQuerySeconds * 1000);
    return parseAskJson(result.stdout).slice(0, this.options.maxResponseBytes ? 20 : 20);
  }

  async getFileApi(input: { cwd: string; file: string }): Promise<FileApiSurface> {
    await this.ensureAvailable();
    const file = assertSafeCliArg(input.file, "file");
    const result = await this.runArgs(["skeleton", file], input.cwd, this.options.maxQuerySeconds * 1000);
    return {
      file,
      signatures: result.stdout.split("\n").filter((line) => line.trim().length > 0).slice(0, 200),
      rawText: result.stdout || null,
      truncated: Buffer.byteLength(result.stdout, "utf8") >= this.options.maxResponseBytes,
    };
  }

  async findAll(input: FindAllInput): Promise<CodeOccurrence[]> {
    await this.ensureAvailable();
    const pattern = assertSafeCliArg(input.pattern, "pattern");
    const args = ["grep", pattern];
    if (input.ignoreCase) args.push("-i");
    for (const scope of input.pathScope ?? []) args.push("--in", assertSafeCliArg(scope, "pathScope"));
    const result = await this.runArgs(args, input.cwd, this.options.maxQuerySeconds * 1000);
    return parseGrepOutput(result.stdout).slice(0, 50);
  }

  async traceCalls(input: { cwd: string; symbol: string; direction: "in" | "out"; depth: number }): Promise<DependencyTrace> {
    await this.ensureAvailable();
    const symbol = assertSafeCliArg(input.symbol, "symbol");
    const depth = Math.max(1, Math.min(this.options.maxTraceDepth, input.depth));
    const args = ["callers", symbol, "--direction", input.direction === "out" ? "out" : "in", "-d", String(depth)];
    const result = await this.runArgs(args, input.cwd, this.options.maxQuerySeconds * 1000);
    return parseCallersOutput(result.stdout, symbol, input.direction, depth);
  }

  async blastRadius(input: { cwd: string; baseRef?: string }): Promise<BlastRadiusReport> {
    await this.ensureAvailable();
    const args = ["blast", "--format", "json", "--depth", "all"];
    if (input.baseRef) args.push("--base", assertSafeCliArg(input.baseRef, "baseRef"));
    const result = await this.runArgs(args, input.cwd, this.options.maxQuerySeconds * 1000);
    let parsed: BlastJson = {};
    try {
      parsed = JSON.parse(result.stdout || "{}") as BlastJson;
    } catch {
      // Non-JSON fallback: keep text only.
    }
    return {
      baseRef: input.baseRef ?? null,
      changedFiles: (parsed.changed_files ?? []).map(String).slice(0, 200),
      impactedSymbols: (parsed.impacted_symbols ?? []).map(String).slice(0, 200),
      impactedTests: (parsed.impacted_tests ?? []).map(String).slice(0, 200),
      rawText: result.stdout || null,
      truncated: Buffer.byteLength(result.stdout, "utf8") >= this.options.maxResponseBytes,
    };
  }

  async checkFreshness(input: { cwd: string }): Promise<FreshnessReport> {
    await this.ensureAvailable();
    const result = await this.runArgs(["check", "--json"], input.cwd, this.options.maxQuerySeconds * 1000);
    if (result.code !== 0) {
      let parsed: CheckJson = {};
      try {
        parsed = JSON.parse(result.stdout || "{}") as CheckJson;
      } catch {
        // drift without structured detail
      }
      return { state: "stale", drift: parsed.drift ?? (result.stderr.slice(0, 200) || "graph drifted from the working tree") };
    }
    let parsed: CheckJson = {};
    try {
      parsed = JSON.parse(result.stdout || "{}") as CheckJson;
    } catch {
      // treat as fresh when exit 0
    }
    if (parsed.fresh === false) return { state: "stale", drift: parsed.drift ?? null };
    return { state: "fresh", drift: null };
  }

  async buildGraph(input: { cwd: string; deep?: boolean; extensions?: string[] }): Promise<GraphBuildResult> {
    await this.ensureAvailable();
    const started = Date.now();
    const args = ["build"];
    if (input.deep && this.options.deepEnrichmentEnabled) args.push("--deep");
    for (const ext of input.extensions ?? []) args.push("--extensions", assertSafeCliArg(ext, "extension"));
    const result = await this.runArgs(args, input.cwd, this.options.maxBuildSeconds * 1000);
    const files = matchCount(result.stdout, /(\d+)\s+files?/i);
    const symbols = matchCount(result.stdout, /(\d+)\s+(symbols?|nodes?)/i);
    return {
      ok: result.code === 0,
      indexedFiles: files,
      indexedSymbols: symbols,
      durationMs: Date.now() - started,
      deep: Boolean(input.deep && this.options.deepEnrichmentEnabled),
      rawSummary: (result.stdout || result.stderr).split("\n").slice(0, 5).join("\n") || null,
    };
  }
}

function matchCount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

// --- output parsers (upstream shapes normalized here) ---

export function parseAskJson(stdout: string): CodeSearchResult[] {
  try {
    const parsed = JSON.parse(stdout) as AskJson;
    return (parsed.results ?? []).map((r) => ({
      title: String(r.title ?? "").slice(0, 200),
      path: String(r.path ?? ""),
      symbol: r.symbol ? String(r.symbol) : null,
      snippet: r.snippet ? String(r.snippet).slice(0, 400) : null,
      score: typeof r.score === "number" ? r.score : null,
    })).filter((r) => r.path);
  } catch {
    // Non-JSON output: degrade to an empty result; the service marks reduced confidence.
    return [];
  }
}

export function parseGrepOutput(stdout: string): CodeOccurrence[] {
  return stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":"))
    .map((line) => {
      const segments = line.split(":");
      const path = segments[0].trim();
      const maybeLine = Number(segments[1]);
      const hasLine = segments.length >= 3 && Number.isFinite(maybeLine);
      return {
        path,
        line: hasLine ? maybeLine : null,
        text: segments.slice(hasLine ? 2 : 1).join(":").slice(0, 200) || null,
        symbol: null,
      };
    })
    .filter((o) => o.path)
    .slice(0, 50);
}

export function parseCallersOutput(stdout: string, symbol: string, direction: "in" | "out", depth: number): DependencyTrace {
  const entries = stdout.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const edges = entries
    .filter((l) => l.includes("->"))
    .map((l) => {
      const [from, to] = l.split("->").map((s) => s.trim());
      return { from, to };
    });
  const names = entries.filter((l) => !l.includes("->"));
  return {
    symbol,
    direction,
    depth,
    dependents: direction === "in" ? names : [],
    dependencies: direction === "out" ? names : [],
    edges: edges.slice(0, 200),
  };
}

export function parseMapOutput(stdout: string): RepositoryMap {
  const clusters: RepositoryMap["clusters"] = [];
  const hotspots: RepositoryMap["hotspots"] = [];
  for (const line of stdout.split("\n")) {
    const cluster = line.match(/^\s*([^\s].*?)\s{2,}(\d+)\s*(?:files?)?$/i);
    if (cluster) {
      clusters.push({ path: cluster[1].trim(), files: Number(cluster[2]) });
      continue;
    }
    const hotspot = line.match(/hotspot[:\s]+(\S+)\s*\(?(?:coupling\s*)?(\d+)\)?/i);
    if (hotspot) {
      hotspots.push({ path: hotspot[1], coupling: Number(hotspot[2]) });
    }
  }
  return {
    clusters: clusters.slice(0, 50),
    hotspots: hotspots.slice(0, 50),
    rawText: stdout ? stdout.slice(0, 8000) : null,
    truncated: Buffer.byteLength(stdout, "utf8") > 8000,
  };
}
