/**
 * Pao AI Gateway — Route decision & event ledger (Phase 20.51).
 *
 * Persists the full decision trace (ordered candidates, rejections with
 * reason codes, attempts, outcome) plus gateway events (state transitions,
 * breaker actions, recovery probes) as daily JSONL files under
 * data/ai-gateway/. Same append-only convention as traces/ledger.ts.
 *
 * Records carry route keys, reason codes, and counts — never prompts, never
 * credentials, never account identifiers.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GatewayEventRecord, RouteAttemptRecord, RouteDecisionRecord } from "../types";

const DECISIONS_DIR = "data/ai-gateway/decisions";
const EVENTS_DIR = "data/ai-gateway/events";

function ensureDir(dirPath: string): void {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch {
    // Already exists
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function appendJsonl(filePath: string, record: unknown): void {
  ensureDir(dirname(filePath));
  try {
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    // Ledger writes must never break the request path.
  }
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function recordDecision(rootDir: string, decision: RouteDecisionRecord): void {
  appendJsonl(join(rootDir, DECISIONS_DIR, `${today()}.jsonl`), decision);
}

export function readDecisions(rootDir: string, date?: string): RouteDecisionRecord[] {
  return readJsonl<RouteDecisionRecord>(join(rootDir, DECISIONS_DIR, `${date ?? today()}.jsonl`));
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export function recordRouteAttempt(rootDir: string, attempt: RouteAttemptRecord): void {
  appendJsonl(join(rootDir, DECISIONS_DIR, `${today()}-attempts.jsonl`), attempt);
}

export function readRouteAttempts(rootDir: string, date?: string): RouteAttemptRecord[] {
  return readJsonl<RouteAttemptRecord>(join(rootDir, DECISIONS_DIR, `${date ?? today()}-attempts.jsonl`));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function recordGatewayEvent(rootDir: string, event: GatewayEventRecord): void {
  appendJsonl(join(rootDir, EVENTS_DIR, `${today()}.jsonl`), event);
}

export function readGatewayEvents(rootDir: string, date?: string): GatewayEventRecord[] {
  return readJsonl<GatewayEventRecord>(join(rootDir, EVENTS_DIR, `${date ?? today()}.jsonl`));
}
