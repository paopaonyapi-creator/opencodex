// Phase 20.40 — Configuration from environment (repo convention: env, not
// yaml). Thresholds are validated: active < recent < idle, all positive.
// Observability is disable-able with a single flag (spec §51).

import { CockpitError } from "../coding-cockpit/types";
import type { ObservabilityConfig } from "./types";

function num(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

let cached: ObservabilityConfig | null = null;

export function getObservabilityConfig(): ObservabilityConfig {
  if (cached) return cached;
  const config: ObservabilityConfig = {
    enabled: bool("OBSERVABILITY_ENABLED", true),
    snapshotMs: num("OBSERVABILITY_SNAPSHOT_MS", 2000, 250),
    processMs: num("OBSERVABILITY_PROCESS_MS", 10_000, 1000),
    thresholds: {
      activeMs: num("OBSERVABILITY_ACTIVE_MS", 120_000, 1000),
      recentMs: num("OBSERVABILITY_RECENT_MS", 900_000, 1000),
      idleMs: num("OBSERVABILITY_IDLE_MS", 7_200_000, 1000),
      stalledMs: num("OBSERVABILITY_STALLED_MS", 600_000, 1000),
    },
    io: {
      tailChunkBytes: num("OBSERVABILITY_TAIL_CHUNK_BYTES", 4096, 256),
      headMaxBytes: num("OBSERVABILITY_HEAD_MAX_BYTES", 65_536, 1024),
      detailTailMaxBytes: num("OBSERVABILITY_DETAIL_TAIL_MAX_BYTES", 262_144, 4096),
      maxEventsPerSession: num("OBSERVABILITY_MAX_EVENTS_PER_SESSION", 100, 1),
      maxTimelineEvents: num("OBSERVABILITY_MAX_TIMELINE_EVENTS", 200, 1),
    },
    privacy: {
      persistContentPreview: bool("OBSERVABILITY_PERSIST_CONTENT_PREVIEW", true),
      exposeAbsolutePaths: bool("OBSERVABILITY_EXPOSE_ABSOLUTE_PATHS", false),
      persistAbsolutePaths: bool("OBSERVABILITY_PERSIST_ABSOLUTE_PATHS", false),
    },
    integrity: { algorithm: "sha256", autoHash: bool("OBSERVABILITY_AUTO_HASH", false) },
    adapters: {
      claudeJsonl: {
        enabled: bool("OBSERVABILITY_CLAUDE_JSONL_ENABLED", true),
        root: process.env.OBSERVABILITY_CLAUDE_ROOT ?? "~/.claude/projects",
      },
      codex: { enabled: bool("OBSERVABILITY_CODEX_ADAPTER_ENABLED", true) },
      paoNative: { enabled: bool("OBSERVABILITY_PAO_NATIVE_ENABLED", true) },
      genericJsonl: parseGenericSources(),
    },
    retention: {
      eventsDays: num("OBSERVABILITY_EVENTS_DAYS", 7, 1),
      scanCyclesDays: num("OBSERVABILITY_SCAN_CYCLES_DAYS", 7, 1),
      processEvidenceHours: num("OBSERVABILITY_PROCESS_EVIDENCE_HOURS", 24, 1),
      alertsDays: num("OBSERVABILITY_ALERTS_DAYS", 30, 1),
      integrityDays: num("OBSERVABILITY_INTEGRITY_DAYS", 30, 1),
    },
  };
  validateConfig(config);
  cached = config;
  return config;
}

export function resetObservabilityConfigForTests(): void {
  cached = null;
}

function parseGenericSources(): ObservabilityConfig["adapters"]["genericJsonl"] {
  const raw = process.env.OBSERVABILITY_GENERIC_JSONL_SOURCES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object")
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : "generic",
        root: typeof entry.root === "string" ? entry.root : "",
        sessionIdField: typeof entry.sessionIdField === "string" ? entry.sessionIdField : "session_id",
        timestampField: typeof entry.timestampField === "string" ? entry.timestampField : "timestamp",
        typeField: typeof entry.typeField === "string" ? entry.typeField : "type",
        roleField: typeof entry.roleField === "string" ? entry.roleField : "role",
        cwdField: typeof entry.cwdField === "string" ? entry.cwdField : "cwd",
      }))
      .filter((entry) => entry.root.length > 0);
  } catch {
    return [];
  }
}

export function validateConfig(config: ObservabilityConfig): void {
  const { activeMs, recentMs, idleMs } = config.thresholds;
  if (!(activeMs < recentMs && recentMs < idleMs)) {
    throw new CockpitError("VALIDATION_ERROR", "observability thresholds must satisfy active < recent < idle");
  }
  const positive = [activeMs, recentMs, idleMs, config.thresholds.stalledMs, config.snapshotMs, config.processMs];
  if (positive.some((value) => value <= 0)) {
    throw new CockpitError("VALIDATION_ERROR", "observability time windows must be positive");
  }
}
