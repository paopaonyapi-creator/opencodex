// Phase 20.40 — Process evidence engine (spec §17). OS process scans are
// ADVISORY evidence: safe argv-only invocations (spawnSync with literal
// binary + literal flag arrays — never shell interpolation), timeout +
// output caps, 10s cache window, fail-soft (a failed scan yields
// "unknown", never "stopped"). High-confidence matches come from the
// Pao-hubPro child-process registry (20.39 supervisor); OS-name-only matches
// stay low-confidence and never claim exact session association.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { ProcessHint } from "./types";

export interface ProcessScanOutcome {
  hints: ProcessHint[];
  failed: boolean;
  scannedAt: string;
}

interface RawProcess {
  pid: number;
  name: string;
  commandLine: string | null;
}

const CACHE_WINDOW_MS = 10_000;
let cache: { at: number; outcome: ProcessScanOutcome } | null = null;

export function resetProcessScanCacheForTests(): void {
  cache = null;
}

function commandHashOf(commandLine: string): string {
  return "sha256:" + createHash("sha256").update(commandLine).digest("hex").slice(0, 16);
}

/** Windows: tasklist CSV (literal argv; no PowerShell, no policy changes). */
function scanWindows(): RawProcess[] {
  const result = spawnSync("tasklist", ["/fo", "csv", "/nh"], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false });
  if (result.status !== 0 || !result.stdout) return [];
  const text = result.stdout.toString("utf8");
  const processes: RawProcess[] = [];
  for (const row of text.split("\n")) {
    const columns = row.split('","').map((column) => column.replace(/^"|"$/g, ""));
    if (columns.length < 2) continue;
    const pid = Number(columns[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processes.push({ pid, name: columns[0] ?? "", commandLine: null });
  }
  return processes;
}

/** Unix: ps argv form (literal flags only). */
function scanUnix(): RawProcess[] {
  const result = spawnSync("ps", ["-eo", "pid=,comm="], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024, shell: false });
  if (result.status !== 0 || !result.stdout) return [];
  const processes: RawProcess[] = [];
  for (const row of result.stdout.toString("utf8").split("\n")) {
    const trimmed = row.trim();
    if (trimmed.length === 0) continue;
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex <= 0) continue;
    const pid = Number(trimmed.slice(0, spaceIndex));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processes.push({ pid, name: trimmed.slice(spaceIndex + 1).trim(), commandLine: null });
  }
  return processes;
}

/** One shared cached scan. Returns unknown-state outcome on failure — the
 *  caller must interpret absence of evidence as not_observed/unknown, NEVER
 *  as "agent stopped". */
export function scanProcesses(): ProcessScanOutcome {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_WINDOW_MS) return cache.outcome;
  let outcome: ProcessScanOutcome;
  try {
    const raw = process.platform === "win32" ? scanWindows() : scanUnix();
    outcome = {
      hints: raw.map((proc) => ({
        pid: proc.pid,
        processName: proc.name,
        runtime: "unknown" as const,
        // Name-only OS evidence is structurally weak: no session association.
        matchType: "process_name_only" as const,
        matchConfidence: 0.05,
        sessionId: null,
        commandHash: proc.commandLine ? commandHashOf(proc.commandLine) : null,
      })),
      failed: false,
      scannedAt: new Date().toISOString(),
    };
  } catch {
    outcome = { hints: [], failed: true, scannedAt: new Date().toISOString() };
  }
  cache = { at: now, outcome };
  return outcome;
}

/** Register exact matches from Pao-hubPro-owned child processes (20.39
 *  supervisor history). Registry evidence is high-confidence because we
 *  spawned the child ourselves. */
export function registryHints(supervisorProcesses: Array<{ pid: number | null; sessionId: string | null; providerId: string | null; state: string }>): ProcessHint[] {
  const hints: ProcessHint[] = [];
  for (const proc of supervisorProcesses) {
    if (proc.pid === null || proc.sessionId === null) continue;
    hints.push({
      pid: proc.pid,
      processName: proc.providerId ?? "pao-child",
      runtime: (proc.providerId === "codex" ? "openai_codex" : proc.providerId === "claude_code" ? "claude_code" : "pao_native"),
      matchType: "registry",
      matchConfidence: 0.9,
      sessionId: proc.sessionId,
      commandHash: null,
    });
  }
  return hints;
}
