/**
 * Pao AI Gateway — Trace & Usage Ledger.
 *
 * Records metadata for each request and provider attempt.
 * Supports configurable content modes: off, metadata_only, redacted.
 *
 * Raw secrets are never persisted. Secret scanner runs before
 * storing prompt content when prompt storage is enabled.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  GatewayTraceRecord,
  GatewayAttemptRecord,
  TraceContentMode,
} from "../types";

const TRACES_DIR = "data/ai-gateway/traces";

function ensureDir(dirPath: string): void {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch {
    // Already exists
  }
}

/**
 * Get the trace file path for today's date.
 */
function traceFilePath(rootDir: string, date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return join(rootDir, TRACES_DIR, `${d}.jsonl`);
}

/**
 * Append a trace record to the daily trace file.
 */
export function recordTrace(rootDir: string, trace: GatewayTraceRecord): void {
  const filePath = traceFilePath(rootDir);
  ensureDir(dirname(filePath));
  const line = JSON.stringify(trace) + "\n";
  appendFileSync(filePath, line, "utf-8");
}

/**
 * Append an attempt record to the daily attempts file.
 */
export function recordAttempt(rootDir: string, attempt: GatewayAttemptRecord): void {
  const filePath = join(rootDir, TRACES_DIR, `${new Date().toISOString().slice(0, 10)}-attempts.jsonl`);
  ensureDir(dirname(filePath));
  const line = JSON.stringify(attempt) + "\n";
  appendFileSync(filePath, line, "utf-8");
}

/**
 * Read trace records for a specific date.
 */
export function readTraces(rootDir: string, date: string): GatewayTraceRecord[] {
  const filePath = traceFilePath(rootDir, date);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as GatewayTraceRecord);
  } catch {
    return [];
  }
}

/**
 * Read today's trace records.
 */
export function readTodayTraces(rootDir: string): GatewayTraceRecord[] {
  return readTraces(rootDir, new Date().toISOString().slice(0, 10));
}

/**
 * Aggregate usage summary from traces.
 */
export function aggregateUsage(traces: GatewayTraceRecord[]): {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  totalActualCostUsd: number;
  byIdentity: Record<string, { requests: number; costUsd: number }>;
  byAlias: Record<string, { requests: number; costUsd: number }>;
  byProvider: Record<string, { requests: number; costUsd: number }>;
  byStatus: Record<string, number>;
} {
  const byIdentity: Record<string, { requests: number; costUsd: number }> = {};
  const byAlias: Record<string, { requests: number; costUsd: number }> = {};
  const byProvider: Record<string, { requests: number; costUsd: number }> = {};
  const byStatus: Record<string, number> = {};

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostUsd = 0;
  let totalActualCostUsd = 0;

  for (const t of traces) {
    totalInputTokens += t.inputTokens;
    totalOutputTokens += t.outputTokens;
    totalEstimatedCostUsd += t.estimatedCostUsd;
    totalActualCostUsd += t.actualCostUsd ?? t.estimatedCostUsd;

    // By identity
    const idEntry = byIdentity[t.identityId] ??= { requests: 0, costUsd: 0 };
    idEntry.requests++;
    idEntry.costUsd += t.actualCostUsd ?? t.estimatedCostUsd;

    // By alias
    const aliasEntry = byAlias[t.alias] ??= { requests: 0, costUsd: 0 };
    aliasEntry.requests++;
    aliasEntry.costUsd += t.actualCostUsd ?? t.estimatedCostUsd;

    // By provider
    const provEntry = byProvider[t.selectedProviderId] ??= { requests: 0, costUsd: 0 };
    provEntry.requests++;
    provEntry.costUsd += t.actualCostUsd ?? t.estimatedCostUsd;

    // By status
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  return {
    totalRequests: traces.length,
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCostUsd,
    totalActualCostUsd,
    byIdentity,
    byAlias,
    byProvider,
    byStatus,
  };
}
