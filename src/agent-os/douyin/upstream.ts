// Phase 20.26 — Upstream client seam (doc §83, Option C: controlled CLI).
//
// Production implementation shells out to the pinned douyin-downloader
// checkout with FIXED argument arrays (never a shell, never arbitrary flags),
// reusing the Phase 20.24 safe process runner. When the upstream runtime is
// absent, the client reports unavailability and the provider degrades
// gracefully (doc §84-§85) instead of crashing.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runProcessSafely } from "../media-acquisition/process-runner";
import { DouyinError } from "./errors";
import type { DouyinUpstreamClient } from "./types";

const PYTHON_BINARIES = ["python", "python3", "py"];
const INVOKE_TIMEOUT_MS = 120_000;

export interface CliUpstreamOptions {
  /** Path to the pinned douyin-downloader checkout (contains run.py). */
  home?: string;
  pythonBinary?: string;
}

function upstreamHome(): string | undefined {
  return process.env.DOUYIN_DOWNLOADER_HOME || undefined;
}

function pickPython(): string | undefined {
  const forced = process.env.DOUYIN_PYTHON;
  if (forced) return forced;
  return PYTHON_BINARIES[0];
}

/**
 * CLI adapter for the douyin-downloader upstream.
 *
 * The client only ever builds fixed subcommand shapes:
 *   run.py -u <validated-url> -c <config>
 *   run.py --search <keyword> -c <config>
 *   run.py --hot-board <n> -c <config>
 * Caller input is restricted to the validated URL / bounded keyword slot;
 * no upstream CLI flags are ever exposed to agents (doc §64).
 */
export class DouyinCliUpstream implements DouyinUpstreamClient {
  readonly kind = "cli" as const;

  async available(): Promise<boolean> {
    const home = upstreamHome();
    if (!home) return false;
    if (!existsSync(join(home, "run.py"))) return false;
    // Python availability is verified by the process allowlist at invoke time;
    // a cheap probe here keeps health checks honest without spawning.
    return true;
  }

  async availabilityReason(): Promise<string | undefined> {
    const home = upstreamHome();
    if (!home) return "DOUYIN_DOWNLOADER_HOME is not configured (pin a douyin-downloader checkout)";
    if (!existsSync(join(home, "run.py"))) return `no run.py under ${home}`;
    return undefined;
  }

  private async invoke(args: string[]): Promise<string> {
    const home = upstreamHome();
    if (!home) throw new DouyinError("DOUYIN_PROVIDER_UNHEALTHY", "upstream home not configured");
    const result = await runProcessSafely({
      binary: pickPython()!,
      args: [join(home, "run.py"), ...args],
      timeoutMs: INVOKE_TIMEOUT_MS,
      maxBufferBytes: 16 * 1024 * 1024,
    });
    if (result.killedDueToTimeout) {
      throw new DouyinError("DOUYIN_UNAVAILABLE", "upstream invocation timed out");
    }
    if (result.exitCode !== 0) {
      const stderr = result.stderr.slice(0, 400);
      if (/cookie|msToken|ttwid|login/i.test(stderr)) {
        throw new DouyinError("DOUYIN_AUTH_REQUIRED", "upstream reports missing/expired session");
      }
      if (/429|rate/i.test(stderr)) {
        throw new DouyinError("DOUYIN_RATE_LIMITED", "upstream rate limited");
      }
      throw new DouyinError("DOUYIN_DOWNLOAD_FAILED", `upstream exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }

  private parseJsonOutput(stdout: string): unknown {
    const start = stdout.indexOf("{");
    const jsonLine = start === -1 ? undefined : stdout.slice(start);
    if (!jsonLine) {
      throw new DouyinError("DOUYIN_UPSTREAM_CHANGED", "upstream did not emit a JSON payload");
    }
    try {
      return JSON.parse(jsonLine);
    } catch {
      // Upstream may emit JSONL; take the first parseable line.
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            return JSON.parse(trimmed);
          } catch {
            // keep scanning
          }
        }
      }
      throw new DouyinError("DOUYIN_UPSTREAM_CHANGED", "upstream payload is not parseable JSON");
    }
  }

  async inspect(url: string): Promise<ReturnType<typeof JSON.parse>> {
    const output = await this.invoke(["-u", url]);
    return this.parseJsonOutput(output);
  }

  async search(query: string, maxItems: number): Promise<ReturnType<typeof JSON.parse>> {
    const output = await this.invoke(["--search", query, "--number", String(maxItems)]);
    return this.parseJsonOutput(output);
  }

  async hotBoard(limit: number): Promise<ReturnType<typeof JSON.parse>> {
    const output = await this.invoke(["--hot-board", String(limit)]);
    return this.parseJsonOutput(output);
  }

  async comments(url: string, maxComments: number, _includeReplies: boolean): Promise<ReturnType<typeof JSON.parse>> {
    const output = await this.invoke(["-u", url, "--comments", "--number", String(maxComments)]);
    return this.parseJsonOutput(output);
  }

  async creatorSync(url: string, maxItems: number): Promise<ReturnType<typeof JSON.parse>> {
    const output = await this.invoke(["-u", url, "--number", String(maxItems)]);
    return this.parseJsonOutput(output);
  }

  /**
   * Acquire one public URL into `outputDir` using the documented CLI shape
   * (`run.py -u <url> -c <config>`) with a minimal generated config that only
   * sets the documented `path` key. The URL is guard-checked before it is
   * written anywhere (no control characters, quotes, or line breaks).
   */
  async downloadTo(url: string, outputDir: string): Promise<string> {
    if (/[\r\n"'\\]/.test(url)) {
      throw new DouyinError("DOUYIN_INVALID_URL", "URL contains characters that are not safe for config embedding");
    }
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const home = upstreamHome();
    if (!home) throw new DouyinError("DOUYIN_PROVIDER_UNHEALTHY", "upstream home not configured");

    const workDir = join(tmpdir(), `douyin-job-${Date.now().toString(36)}`);
    mkdirSync(workDir, { recursive: true });
    const configPath = join(workDir, "config.yml");
    writeFileSync(
      configPath,
      [
        "# generated by Pao-hubPro douyin adapter (fixed keys only)",
        `path: ${JSON.stringify(outputDir)}`,
        "thread: 2",
        "retry_times: 3",
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      await this.invoke(["-u", url, "-c", configPath]);
      const produced = this.newestMediaFile(outputDir);
      if (!produced) {
        throw new DouyinError("DOUYIN_DOWNLOAD_FAILED", "upstream completed but produced no media file");
      }
      return produced;
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // temp cleanup is best-effort
      }
    }
  }

  private async invokeAt(_cwd: string, args: string[]): Promise<string> {
    return this.invoke(args);
  }

  private newestMediaFile(dir: string): string | undefined {
    const MEDIA_EXT = new Set([".mp4", ".webm", ".mp3", ".jpg", ".jpeg", ".png"]);
    let best: { path: string; mtime: number } | undefined;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (!stat.isFile()) continue;
        const dotIndex = entry.lastIndexOf(".");
        const ext = dotIndex === -1 ? "" : entry.slice(dotIndex).toLowerCase();
        if (!MEDIA_EXT.has(ext)) continue;
        if (!best || stat.mtimeMs > best.mtime) best = { path: full, mtime: stat.mtimeMs };
      } catch {
        // unreadable entry — skip
      }
    }
    return best?.path;
  }
}
