// Phase 20.9 — Safe Local Sandbox
// Manages isolated workspace execution sessions with strict path bounds,
// timeouts, process limits, output truncation, and environment filtering.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type {
  Sandbox,
  SandboxOptions,
  SandboxSession,
  ExecRequest,
  ExecResult,
} from "../types";
import { PathGuard } from "../security/path-guard";

interface ActiveSessionData {
  session: SandboxSession;
  options: SandboxOptions;
  pathGuard: PathGuard;
  childProcesses: Set<any>;
}

export class SafeSandbox implements Sandbox {
  private sessions = new Map<string, ActiveSessionData>();
  private readonly defaultMaxOutputBytes = 512 * 1024; // 512 KB
  private readonly defaultTimeoutMs = 30000; // 30s
  private readonly defaultMaxProcessCount = 5;

  async createSession(options: SandboxOptions): Promise<SandboxSession> {
    const id = options.sessionId ?? `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const pathGuard = new PathGuard([options.workspaceRoot]);

    const session: SandboxSession = {
      id,
      workspaceRoot: options.workspaceRoot,
      createdAt: new Date().toISOString(),
      activeProcessCount: 0,
    };

    this.sessions.set(id, {
      session,
      options,
      pathGuard,
      childProcesses: new Set(),
    });

    return session;
  }

  async exec(sessionId: string, request: ExecRequest): Promise<ExecResult> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new Error(`Sandbox session '${sessionId}' not found`);
    }

    const { options, childProcesses } = sessionData;
    const maxProcesses = options.maxProcessCount ?? this.defaultMaxProcessCount;

    if (childProcesses.size >= maxProcesses) {
      throw new Error(`Maximum concurrent processes limit (${maxProcesses}) reached for session '${sessionId}'`);
    }

    const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? this.defaultTimeoutMs;
    const maxOutput = options.maxOutputBytes ?? this.defaultMaxOutputBytes;
    const startTime = Date.now();

    // Filter environment to avoid secret leakage
    const cleanEnv: Record<string, string> = {
      PATH: process.env.PATH || "",
      SYSTEMROOT: process.env.SYSTEMROOT || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
      HOME: process.env.HOME || "",
      USERPROFILE: process.env.USERPROFILE || "",
      NODE_ENV: "test",
      ...(request.env || {}),
    };

    const cwd = request.cwd
      ? sessionData.pathGuard.assertSafePath(request.cwd)
      : options.workspaceRoot;

    return new Promise<ExecResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;

      const child = spawn(request.command, request.args || [], {
        cwd,
        env: cleanEnv,
        shell: false,
      });

      childProcesses.add(child);
      sessionData.session.activeProcessCount = childProcesses.size;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already ended
        }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < maxOutput) {
          stdout += chunk.toString("utf8");
          if (stdout.length >= maxOutput) {
            stdout = stdout.slice(0, maxOutput) + "\n[OUTPUT TRUNCATED: Exceeded buffer limit]";
            truncated = true;
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < maxOutput) {
          stderr += chunk.toString("utf8");
          if (stderr.length >= maxOutput) {
            stderr = stderr.slice(0, maxOutput) + "\n[OUTPUT TRUNCATED: Exceeded buffer limit]";
            truncated = true;
          }
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        childProcesses.delete(child);
        sessionData.session.activeProcessCount = childProcesses.size;

        resolve({
          exitCode: timedOut ? 124 : (code ?? 0),
          stdout,
          stderr: timedOut ? `${stderr}\nCommand timed out after ${timeoutMs}ms` : stderr,
          durationMs: Date.now() - startTime,
          truncated,
          timedOut,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        childProcesses.delete(child);
        sessionData.session.activeProcessCount = childProcesses.size;

        resolve({
          exitCode: 1,
          stdout,
          stderr: `Process spawn error: ${err.message}`,
          durationMs: Date.now() - startTime,
          truncated,
          timedOut: false,
        });
      });
    });
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new Error(`Sandbox session '${sessionId}' not found`);
    }

    const safePath = sessionData.pathGuard.assertSafePath(path, sessionData.options.workspaceRoot);
    if (!existsSync(safePath)) {
      throw new Error(`File not found: ${path}`);
    }

    return readFileSync(safePath, "utf8");
  }

  async writeFile(sessionId: string, path: string, content: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new Error(`Sandbox session '${sessionId}' not found`);
    }

    const safePath = sessionData.pathGuard.assertSafePath(path, sessionData.options.workspaceRoot);
    mkdirSync(dirname(safePath), { recursive: true });
    writeFileSync(safePath, content, "utf8");
  }

  async destroySession(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return;

    // Terminate all remaining active processes
    for (const child of sessionData.childProcesses) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process might already be dead
      }
    }
    sessionData.childProcesses.clear();
    this.sessions.delete(sessionId);
  }
}

let defaultSandbox: SafeSandbox | null = null;
export function getSafeSandbox(): SafeSandbox {
  if (!defaultSandbox) {
    defaultSandbox = new SafeSandbox();
  }
  return defaultSandbox;
}
