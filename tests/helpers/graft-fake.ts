// Phase 20.62 test helper — deterministic Graft fakes.
//
// FakeGraftRunner: scripted GraftProcessRunner (adapter-level tests, argv
// assertions, no binary). FakeProvider: deterministic
// CodeIntelligenceProvider (service-level tests, fixture graph, no subprocess).

import { CodeIntelError } from "../../src/agent-os/code-intelligence/types";
import type {
  BlastRadiusReport, CodeIntelligenceCapabilities, CodeIntelligenceProvider, CodeOccurrence,
  CodeSearchResult, DependencyTrace, FileApiSurface, FindAllInput, FindCodeInput,
  FreshnessReport, GraphBuildResult, ProviderHealth, RepositoryMap,
} from "../../src/agent-os/code-intelligence/types";
import type { GraftProcessRunner, RunnerResult } from "../../src/agent-os/code-intelligence/provider/graft/runner";

export const PINNED_GRAFT = "0.18.0";

export class FakeGraftRunner implements GraftProcessRunner {
  readonly calls: string[][] = [];
  versionOutput = "graft version 0.18.0 (installed) / 0.18.0 (latest)";
  faults: Array<{ match: string; exitCode: number; stdout?: string; stderr?: string; times: number }> = [];

  async run(argv: string[], _cwd: string, _timeoutMs: number, _maxOutputBytes: number): Promise<RunnerResult> {
    const joined = argv.join(" ");
    this.calls.push(argv);
    const fault = this.faults.find((f) => f.times > 0 && joined.includes(f.match));
    if (fault) {
      fault.times -= 1;
      return { code: fault.exitCode, stdout: fault.stdout ?? "", stderr: fault.stderr ?? "", timedOut: false };
    }
    if (argv.includes("check")) {
      return { code: 0, stdout: JSON.stringify({ fresh: true }), stderr: "", timedOut: false };
    }
    if (argv.includes("blast")) {
      return {
        code: 0,
        stdout: JSON.stringify({ changed_files: ["src/service.ts"], impacted_symbols: ["service.handle"], impacted_tests: ["test/service.test.ts"] }),
        stderr: "",
        timedOut: false,
      };
    }
    if (argv.includes("ask")) {
      return {
        code: 0,
        stdout: JSON.stringify({ results: [{ title: "route handling", path: "src/router.ts", symbol: "router.handle", snippet: "export function handle()", score: 0.9 }] }),
        stderr: "",
        timedOut: false,
      };
    }
    if (argv.includes("callers")) {
      return { code: 0, stdout: "auth.verifyToken\nrouter.handle -> auth.verifyToken\ndb.query -> router.handle", stderr: "", timedOut: false };
    }
    if (argv.includes("grep")) {
      return { code: 0, stdout: "src/router.ts:12: handle(req)\ntest/router.test.ts:3: handle({})", stderr: "", timedOut: false };
    }
    if (argv.includes("map")) {
      return { code: 0, stdout: "src/  4 files\nsrc/test  2 files\nhotspot: src/router.ts (coupling 7)", stderr: "", timedOut: false };
    }
    if (argv.includes("build")) {
      return { code: 0, stdout: "Indexed 6 files, 42 symbols in 1.2s", stderr: "", timedOut: false };
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  async version(): Promise<string> {
    return this.versionOutput;
  }
}

export interface FakeProviderConfig {
  available?: boolean;
  version?: string | null;
  fresh?: "fresh" | "stale" | "missing";
  dependents?: string[];
  blast?: { changedFiles: string[]; impactedTests: string[] };
}

export class FakeProvider implements CodeIntelligenceProvider {
  readonly provider = "graft";
  private readonly cfg: Required<FakeProviderConfig>;

  constructor(cfg: FakeProviderConfig = {}) {
    this.cfg = {
      available: cfg.available ?? true,
      version: cfg.version ?? PINNED_GRAFT,
      fresh: cfg.fresh ?? "fresh",
      dependents: cfg.dependents ?? ["src/service.ts:service.handle"],
      blast: cfg.blast ?? { changedFiles: ["src/service.ts"], impactedTests: ["test/service.test.ts"] },
    };
  }

  private ensureAvailable(): void {
    if (!this.cfg.available) {
      throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "graft is not installed (fake)");
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const compatible = this.cfg.available && this.cfg.version === PINNED_GRAFT;
    return {
      available: this.cfg.available,
      provider: this.provider,
      version: this.cfg.version,
      nodeVersion: process.versions.node ?? null,
      compatible,
      incompatibilityReason: compatible ? null : this.cfg.available ? "version drift" : "graft not installed",
      telemetryDisabled: true,
    };
  }

  async getCapabilities(): Promise<CodeIntelligenceCapabilities> {
    return { provider: this.provider, version: this.cfg.version, structural: this.cfg.available, deepEnrichment: false, mcpTools: [], compatible: this.cfg.available && this.cfg.version === PINNED_GRAFT, incompatibilityReason: null };
  }

  async getRepositoryMap(): Promise<RepositoryMap> {
    this.ensureAvailable();
    return {
      clusters: [{ path: "src", files: 4 }, { path: "test", files: 2 }],
      hotspots: [{ path: "src/router.ts", coupling: 7 }],
      rawText: null,
      truncated: false,
    };
  }

  async findCode(input: FindCodeInput): Promise<CodeSearchResult[]> {
    this.ensureAvailable();
    return [{ title: "route handling", path: "src/router.ts", symbol: "router.handle", snippet: "matched: " + input.question.slice(0, 30), score: 0.9 }];
  }

  async getFileApi(input: { cwd: string; file: string }): Promise<FileApiSurface> {
    this.ensureAvailable();
    return { file: input.file, signatures: ["export function handle(req): Response"], rawText: null, truncated: false };
  }

  async findAll(input: FindAllInput): Promise<CodeOccurrence[]> {
    this.ensureAvailable();
    return [{ path: "src/router.ts", line: 12, text: "handle(" + input.pattern + ")", symbol: null }];
  }

  async traceCalls(input: { symbol: string; direction: "in" | "out"; depth: number }): Promise<DependencyTrace> {
    this.ensureAvailable();
    return {
      symbol: input.symbol,
      direction: input.direction,
      depth: input.depth,
      dependents: input.direction === "in" ? this.cfg.dependents : [],
      dependencies: input.direction === "out" ? this.cfg.dependents : [],
      edges: this.cfg.dependents.map((d) => ({ from: d, to: input.symbol })),
    };
  }

  async blastRadius(): Promise<BlastRadiusReport> {
    this.ensureAvailable();
    return { baseRef: null, changedFiles: this.cfg.blast.changedFiles, impactedSymbols: [], impactedTests: this.cfg.blast.impactedTests, rawText: null, truncated: false };
  }

  async checkFreshness(): Promise<FreshnessReport> {
    this.ensureAvailable();
    return { state: this.cfg.fresh, drift: this.cfg.fresh === "fresh" ? null : "working tree changed" };
  }

  async buildGraph(input: { deep?: boolean }): Promise<GraphBuildResult> {
    this.ensureAvailable();
    return { ok: true, indexedFiles: 6, indexedSymbols: 42, durationMs: 12, deep: Boolean(input.deep), rawSummary: "6 files, 42 symbols" };
  }
}
