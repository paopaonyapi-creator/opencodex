// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Safe Process Runner for External Tool Isolation

import { spawn } from "node:child_process";
import { MediaError } from "./errors";

export interface ProcessRunOptions {
  binary: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killedDueToTimeout: boolean;
}

const ALLOWED_BINARIES = new Set([
  "omniget",
  "omniget.exe",
  "yt-dlp",
  "yt-dlp.exe",
  "ffmpeg",
  "ffmpeg.exe",
  "ffprobe",
  "ffprobe.exe",
  "whisper",
  "whisper.exe",
  "whisper-cpp",
  "whisper-cpp.exe",
  // Phase 20.26: douyin-downloader CLI adapter runs via the system Python.
  "python",
  "python.exe",
  "python3",
  "python3.exe",
  "py",
  // Phase 20.33: governed shell provider (pao.shell.execute) runs dev-tool
  // binaries under argv discipline + approval. Shell interpreters stay banned
  // in the ai-workspace provider; this list only admits fixed binaries.
  "git",
  "git.exe",
  "bun",
  "bun.exe",
  "node",
  "node.exe",
  "npm",
  "npx",
  "ls",
  "cat",
  "echo",
  // Phase 20.39: coding cockpit CLI bridge runs the provider CLIs as one-shot
  // argv-only turns (probe / headless turn / native resume). No interpreters.
  "claude",
  "claude.exe",
  "claude.cmd",
  "codex",
  "codex.exe",
  "codex.cmd",
]);

const ALLOWED_ENV_VARS = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
  "LC_ALL",
];

export function sanitizeBinaryName(binary: string): string {
  const normalized = binary.toLowerCase().replace(/\\/g, "/").split("/").pop() || "";
  if (!ALLOWED_BINARIES.has(normalized)) {
    throw new MediaError(
      "MEDIA_PERMISSION_DENIED",
      `Binary '${binary}' (${normalized}) is not in the media acquisition process allowlist.`,
    );
  }
  return binary;
}

export async function runProcessSafely(options: ProcessRunOptions): Promise<ProcessRunResult> {
  const binary = sanitizeBinaryName(options.binary);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBuffer = options.maxBufferBytes ?? 10 * 1024 * 1024; // 10MB limit

  // Sanitize environment
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_VARS) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key];
    }
  }
  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      safeEnv[k] = v;
    }
  }

  const startTime = Date.now();
  let killedDueToTimeout = false;

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, options.args, {
        cwd: options.cwd,
        env: safeEnv,
        shell: false, // MANDATORY: never invoke a shell
        windowsHide: true,
      });
    } catch (err) {
      return reject(
        new MediaError(
          "MEDIA_PROVIDER_ERROR",
          `Failed to spawn binary '${binary}': ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timer = setTimeout(() => {
      killedDueToTimeout = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore if already exited
      }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutBytes < maxBuffer) {
          const text = chunk.toString("utf8");
          stdoutBuffer += text;
          stdoutBytes += chunk.length;
          if (options.onStdoutLine) {
            options.onStdoutLine(text);
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrBytes < maxBuffer) {
          const text = chunk.toString("utf8");
          stderrBuffer += text;
          stderrBytes += chunk.length;
          if (options.onStderrLine) {
            options.onStderrLine(text);
          }
        }
      });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer + `\nProcess error: ${err.message}`,
        durationMs: Date.now() - startTime,
        killedDueToTimeout: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (killedDueToTimeout) {
        resolve({
          exitCode: -1,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + `\nProcess terminated after exceeding timeout (${timeoutMs}ms).`,
          durationMs,
          killedDueToTimeout: true,
        });
      } else {
        resolve({
          exitCode: code ?? 0,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          durationMs,
          killedDueToTimeout: false,
        });
      }
    });
  });
}
