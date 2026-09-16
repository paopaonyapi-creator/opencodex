// Phase 20.39 — Process supervisor (spec §33) + safe local CLI bridge
// (spec §20). ALL process execution is delegated to the Phase 20.24
// runProcessSafely choke point (argv-only, shell never invoked, binary
// allowlist, env allowlist, timeout, output caps). The supervisor adds
// ManagedProcess bookkeeping: lifecycle states, per-session lookup, crash
// detection, and cooperative cancellation (turn callbacks stop consuming;
// the short-lived one-shot process finishes and is recorded). Nothing here
// ever scans the OS process table; we only ever reason about children we
// spawned ourselves.

import { runProcessSafely } from "../media-acquisition/process-runner";
import type { ManagedProcessInfo, ProcessState } from "./types";
import { CockpitError } from "./types";

const HISTORY_LIMIT = 500;

export interface ShellBridgeRequest {
  workspaceId: string;
  sessionId: string | null;
  providerId: string | null;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  envAllowlist?: Record<string, string>;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ShellBridgeResult {
  process: ManagedProcessInfo;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export class ProcessSupervisor {
  private history = new Map<string, ManagedProcessInfo>();

  list(): ManagedProcessInfo[] {
    return [...this.history.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).reverse();
  }

  get(processId: string): ManagedProcessInfo | null {
    return this.history.get(processId) ?? null;
  }

  listForSession(sessionId: string): ManagedProcessInfo[] {
    return this.list().filter((proc) => proc.sessionId === sessionId);
  }

  /** Detect processes recorded as RUNNING that have actually finished (crash
   *  detection between polls). Returns how many were flipped to a terminal
   *  state. */
  detectDeadProcesses(): number {
    let dead = 0;
    for (const proc of this.history.values()) {
      if (proc.state === "RUNNING" && Date.now() - Date.parse(proc.startedAt) > 30 * 60 * 1000) {
        // Supervisor delegates execution to awaited one-shot runs, so a
        // RUNNING record older than the await window means its await was
        // interrupted (backend restart) — treat as disconnected/crashed.
        this.record({ ...proc, state: "CRASHED" });
        dead += 1;
      }
    }
    return dead;
  }

  private record(info: ManagedProcessInfo): void {
    this.history.set(info.processId, info);
    if (this.history.size > HISTORY_LIMIT) {
      const oldest = this.list().pop();
      if (oldest) this.history.delete(oldest.processId);
    }
  }

  private nextProcessId(): string {
    return "mp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }

  /** Run one managed one-shot command through the 20.24 safe runner. */
  async runManaged(request: ShellBridgeRequest): Promise<ShellBridgeResult> {
    const processId = this.nextProcessId();
    const started: ManagedProcessInfo = {
      processId,
      sessionId: request.sessionId,
      providerId: request.providerId,
      pid: null,
      state: "RUNNING",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      exitCode: null,
    };
    this.record(started);

    let result;
    try {
      result = await runProcessSafely({
        binary: request.executable,
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs ?? 120_000,
        env: request.envAllowlist,
        onStdoutLine: (line) => {
          const current = this.history.get(processId);
          if (current) this.record({ ...current, lastHeartbeat: new Date().toISOString() });
          request.onStdoutLine?.(line);
        },
        onStderrLine: (line) => {
          request.onStderrLine?.(line);
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("MEDIA_PERMISSION_DENIED")) {
        throw new CockpitError("POLICY_DENIED", "executable is not in the cockpit CLI allowlist: " + request.executable);
      }
      const failed: ManagedProcessInfo = {
        ...started,
        state: message.includes("timed out") || message.includes("timeout") ? "TIMED_OUT" : "CRASHED",
        exitCode: null,
        lastHeartbeat: new Date().toISOString(),
      };
      this.record(failed);
      throw new CockpitError(failed.state === "TIMED_OUT" ? "PROCESS_TIMEOUT" : "PROCESS_FAILED", "managed process failed: " + message);
    }

    const state: ProcessState = result.killedDueToTimeout
      ? "TIMED_OUT"
      : result.exitCode === 0
        ? "EXITED"
        : "CRASHED";
    const finished: ManagedProcessInfo = {
      ...started,
      state,
      exitCode: result.exitCode,
      lastHeartbeat: new Date().toISOString(),
    };
    this.record(finished);
    return { process: finished, stdout: result.stdout, stderr: result.stderr, truncated: result.killedDueToTimeout };
  }

  /** Cooperative cancellation for the CLI bridge: one-shot runs are awaited
   *  through the 20.24 runner, so an in-flight turn cannot be SIGKILLed from
   *  here — the caller stops consuming output and the process record is
   *  marked CANCELLED. Documented graceful-degradation behavior (spec §33). */
  cancel(processId: string, reason = "cancelled by user"): boolean {
    const proc = this.history.get(processId);
    if (!proc) return false;
    if (proc.state === "RUNNING") {
      this.record({ ...proc, state: "CANCELLED", lastHeartbeat: new Date().toISOString() });
      void reason;
      return true;
    }
    return false;
  }

  cancelForSession(sessionId: string): number {
    let cancelled = 0;
    for (const proc of this.history.values()) {
      if (proc.sessionId === sessionId && proc.state === "RUNNING") {
        this.cancel(proc.processId, "session cancelled");
        cancelled += 1;
      }
    }
    return cancelled;
  }
}
