// Phase 20.27 — Agent adapters (doc §14, §121).
//
// Adapters translate agent-specific mechanics ONLY. Detection is passive
// (PATH scan, no execution) so the cockpit can list what exists without
// spawning anything; doctor performs one bounded --version probe through the
// safe process runner. The control plane owns permissions, sessions, audit.

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import type { AgentAdapter, AgentCapabilities, AgentDetection, AgentType, CommandSpec } from "./cockpit-types";

/**
 * Cockpit process runner: its own allowlist (agent CLIs only), fixed argv,
 * shell disabled, bounded time and output. The media runner's allowlist is
 * intentionally NOT reused — the two surfaces authorize different programs.
 */
const AGENT_BINARIES = new Set(["codex", "claude", "gemini", "pao-agent", "codex.cmd", "claude.cmd", "gemini.cmd", "pao-agent.cmd", "codex.exe", "claude.exe", "gemini.exe"]);

export interface AgentProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runAgentProcess(binary: string, args: string[], cwd: string, timeoutMs: number): Promise<AgentProcessResult> {
  const normalized = binary.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";
  if (!AGENT_BINARIES.has(normalized)) {
    return Promise.resolve({ exitCode: -1, stdout: "", stderr: "binary '" + binary + "' is not in the cockpit agent allowlist", timedOut: false });
  }
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(binary, args, { cwd, shell: false, windowsHide: true });
    } catch (err) {
      return resolvePromise({ exitCode: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err), timedOut: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 512 * 1024) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 512 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: -1, stdout, stderr: stderr + err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 0, stdout, stderr, timedOut });
    });
  });
}

function findOnPath(binary: string): string | undefined {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const candidate of [binary, binary + ".exe", binary + ".cmd", binary + ".bat"]) {
      const full = join(dir, candidate);
      try {
        if (existsSync(full)) return full;
      } catch {
        // unreadable dir entry — skip
      }
    }
  }
  return undefined;
}

abstract class BaseCliAdapter implements AgentAdapter {
  abstract readonly type: AgentType;
  abstract readonly displayName: string;
  abstract readonly defaultBinary: string;
  private versionCache?: string;

  detect(): AgentDetection {
    const forced = process.env["PAO_" + this.type.toUpperCase() + "_BIN"];
    if (forced && existsSync(forced)) {
      return { type: this.type, detected: true, binary: forced };
    }
    const found = findOnPath(this.defaultBinary);
    if (!found) {
      return { type: this.type, detected: false, reason: this.defaultBinary + " not found on PATH" };
    }
    return { type: this.type, detected: true, binary: found, version: this.versionCache };
  }

  capabilities(): AgentCapabilities {
    return { chat: true, readFiles: true, writeFiles: true, runCommands: true, git: true, review: true };
  }

  buildCommand(input: { prompt: string; workspaceScope: string }): CommandSpec {
    // Fixed flag shapes only; the prompt travels as a single argv element, so
    // no shell interpretation is possible (doc §64). Subcommand per adapter:
    // codex exec / claude -p / gemini -p are their documented non-interactive
    // entrypoints; runtime verification is part of doctor.
    return {
      binary: this.detect().binary ?? this.defaultBinary,
      args: [this.execSubcommand(), input.prompt],
      cwd: input.workspaceScope,
      timeoutMs: 300_000,
    };
  }

  protected abstract execSubcommand(): string;

  /** One bounded --version probe for the doctor (doc §121). */
  async probeVersion(): Promise<string | undefined> {
    if (this.versionCache) return this.versionCache;
    const detection = this.detect();
    if (!detection.detected || !detection.binary) return undefined;
    const result = await runAgentProcess(detection.binary, ["--version"], process.cwd(), 15_000);
    if (result.exitCode !== 0) return undefined;
    this.versionCache = result.stdout.trim().split(/\r?\n/)[0]?.slice(0, 80);
    return this.versionCache;
  }
}

class CodexAdapter extends BaseCliAdapter {
  readonly type: AgentType = "codex";
  readonly displayName = "Codex CLI";
  readonly defaultBinary = "codex";
  protected execSubcommand(): string {
    return "exec";
  }
}

class ClaudeAdapter extends BaseCliAdapter {
  readonly type: AgentType = "claude";
  readonly displayName = "Claude Code";
  readonly defaultBinary = "claude";
  protected execSubcommand(): string {
    return "-p";
  }
}

class GeminiAdapter extends BaseCliAdapter {
  readonly type: AgentType = "gemini";
  readonly displayName = "Gemini CLI";
  readonly defaultBinary = "gemini";
  protected execSubcommand(): string {
    return "-p";
  }
}

class GenericCliAdapter extends BaseCliAdapter {
  readonly type: AgentType = "generic_cli";
  readonly displayName = "Generic CLI Agent";
  readonly defaultBinary = "pao-agent";
  protected execSubcommand(): string {
    return "run";
  }
}

/** All built-in adapters, in cockpit display order. */
export function builtinAgentAdapters(): AgentAdapter[] {
  return [new CodexAdapter(), new ClaudeAdapter(), new GeminiAdapter(), new GenericCliAdapter()];
}

export type { AgentAdapter };
