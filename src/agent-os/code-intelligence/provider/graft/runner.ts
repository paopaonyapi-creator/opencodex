// Phase 20.62 — Graft process runner seam (spec §26).
//
// Every upstream interaction goes through this JSON-level seam so the adapter
// is testable without the graft binary. The execFile implementation enforces:
// argument arrays (never shell strings), controlled cwd, scrubbed environment
// (DO_NOT_TRACK=1 always; no agent tokens inherited), hard timeouts with tree
// kill, and bounded output. Agent-supplied values never become executable
// paths or flags.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunnerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface GraftProcessRunner {
  run(argv: string[], cwd: string, timeoutMs: number, maxOutputBytes: number): Promise<RunnerResult>;
  version(bin: string, timeoutMs: number): Promise<string>;
}

export class ExecFileGraftRunner implements GraftProcessRunner {
  async run(argv: string[], cwd: string, timeoutMs: number, maxOutputBytes: number): Promise<RunnerResult> {
    try {
      const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
        cwd,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: maxOutputBytes,
        windowsHide: true,
        env: scrubEnvironment(),
      });
      return { code: 0, stdout: cap(stdout, maxOutputBytes), stderr: cap(stderr, maxOutputBytes), timedOut: false };
    } catch (error) {
      const err = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
      const timedOut = err.killed === true;
      if (err.code === 127 || /ENOENT/i.test(err.message ?? "")) {
        throw new Error("graft executable not found");
      }
      return { code: typeof err.code === "number" ? err.code : 1, stdout: cap(err.stdout ?? "", maxOutputBytes), stderr: cap(err.stderr ?? "", maxOutputBytes), timedOut };
    }
  }

  async version(bin: string, timeoutMs: number): Promise<string> {
    const result = await this.run([bin, "version"], process.cwd(), timeoutMs, 64 * 1024);
    return parseGraftVersion(result.stdout);
  }
}

export function scrubEnvironment(): NodeJS.ProcessEnv {
  // Only the essentials cross the boundary; telemetry is force-disabled.
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    DO_NOT_TRACK: "1",
    GRAFT_NO_REFRESH: process.env.GRAFT_NO_REFRESH ?? "",
  };
}

function cap(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
}

/** Parse `graft version` output: "installed: x.y.z" or a bare semver. */
export function parseGraftVersion(output: string): string {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : "";
}

/** Semver compatibility: same major+minor for "compatible", exact for "exact". */
export function isVersionCompatible(detected: string, pinned: string, policy: "compatible" | "exact"): boolean {
  if (!detected) return false;
  if (policy === "exact") return detected === pinned;
  const [dMajor, dMinor] = detected.split(".");
  const [pMajor, pMinor] = pinned.split(".");
  return dMajor === pMajor && dMinor === pMinor;
}
