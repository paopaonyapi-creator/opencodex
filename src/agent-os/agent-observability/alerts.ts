// Phase 20.40 — Alert engine (spec §35). Built-in conditions with dedupe
// keys, cooldown windows, first/last seen tracking and resolution. Local
// only — no third-party notification is configured in this phase.

import type { ObservabilityStore } from "./persistence";
import type { AgentSession, AlertSeverity, FleetSnapshot } from "./types";

export const BUILT_IN_RULES: Array<{ name: string; conditionType: AlertCondition; severity: AlertSeverity; cooldownSeconds: number }> = [
  { name: "session-stalled", conditionType: "session_stalled", severity: "warning", cooldownSeconds: 900 },
  { name: "explicit-failure", conditionType: "explicit_failure", severity: "error", cooldownSeconds: 300 },
  { name: "adapter-unhealthy", conditionType: "adapter_unhealthy", severity: "warning", cooldownSeconds: 600 },
  { name: "repeated-parse-errors", conditionType: "repeated_parse_errors", severity: "warning", cooldownSeconds: 600 },
  { name: "integrity-changed", conditionType: "integrity_changed", severity: "warning", cooldownSeconds: 1800 },
  { name: "silent-running", conditionType: "silent_running", severity: "info", cooldownSeconds: 1800 },
];

type AlertCondition = "session_stalled" | "explicit_failure" | "adapter_unhealthy" | "repeated_parse_errors" | "integrity_changed" | "silent_running";

export class AlertEngine {
  constructor(private readonly store: ObservabilityStore) {}

  ensureBuiltInRules(): void {
    for (const rule of BUILT_IN_RULES) {
      this.store.upsertAlertRule(rule);
    }
  }

  /** Evaluate one snapshot; returns newly opened/refreshed alert events. */
  evaluate(snapshot: FleetSnapshot, parseErrorCounts: Map<string, number>): Array<{ alertId: string; opened: boolean }> {
    const raised: Array<{ alertId: string; opened: boolean }> = [];
    for (const rule of this.store.listAlertRules()) {
      if (!rule.enabled) continue;
      switch (rule.conditionType) {
        case "session_stalled": {
          for (const session of snapshot.sessions.filter((candidate) => candidate.healthState === "stalled")) {
            raised.push(this.raise(rule.id, rule.severity, session.id, "session stalled: " + sessionDisplayName(session), { sessionId: session.id, runtime: session.runtime }, rule.cooldownSeconds, "stall:" + session.id));
          }
          break;
        }
        case "explicit_failure": {
          for (const session of snapshot.sessions.filter((candidate) => candidate.executionState === "failed" || candidate.healthState === "error")) {
            raised.push(this.raise(rule.id, rule.severity, session.id, "explicit failure: " + sessionDisplayName(session), { sessionId: session.id, errors: session.errors.slice(0, 3) }, rule.cooldownSeconds, "fail:" + session.id));
          }
          break;
        }
        case "adapter_unhealthy": {
          if (snapshot.scan.adapterErrors > 0) {
            raised.push(this.raise(rule.id, rule.severity, null, snapshot.scan.adapterErrors + " adapter error(s) in last scan", { adapterErrors: snapshot.scan.adapterErrors }, rule.cooldownSeconds, "adapter:scan"));
          }
          break;
        }
        case "repeated_parse_errors": {
          for (const [sessionKey, count] of parseErrorCounts) {
            if (count >= 3) {
              raised.push(this.raise(rule.id, rule.severity, sessionKey.startsWith("obs_") ? sessionKey : null, "repeated parse errors (" + count + ")", { sessionKey, count }, rule.cooldownSeconds, "parse:" + sessionKey));
            }
          }
          break;
        }
        case "integrity_changed": {
          for (const session of snapshot.sessions.filter((candidate) => candidate.integrityState === "changed")) {
            raised.push(this.raise(rule.id, rule.severity, session.id, "content changed since previous verified revision: " + sessionDisplayName(session), { sessionId: session.id }, rule.cooldownSeconds, "integrity:" + session.id));
          }
          break;
        }
        case "silent_running": {
          for (const session of snapshot.sessions.filter((candidate) => candidate.processState === "running" && (candidate.activityState === "stale" || candidate.activityState === "idle"))) {
            raised.push(this.raise(rule.id, rule.severity, session.id, "no event for an extended period while process evidence remains running: " + sessionDisplayName(session), { sessionId: session.id }, rule.cooldownSeconds, "silent:" + session.id));
          }
          break;
        }
        default:
          break;
      }
    }
    // Resolution: alerts whose condition no longer holds resolve.
    this.resolveStaleAlerts(snapshot);
    return raised;
  }

  private raise(ruleId: string, severity: AlertSeverity, sessionId: string | null, title: string, details: Record<string, unknown>, cooldownSeconds: number, dedupeKey: string): { alertId: string; opened: boolean } {
    if (this.store.cooldownHit(ruleId, dedupeKey, cooldownSeconds)) {
      const existing = this.store.listAlerts({ unresolvedOnly: true }).find((alert) => alert.ruleId === ruleId && alert.dedupeKey === dedupeKey);
      if (existing) return { alertId: existing.id, opened: false };
      return { alertId: "", opened: false };
    }
    const alert = this.store.openAlert(ruleId, sessionId, severity, title, details, dedupeKey);
    return { alertId: alert.id, opened: alert.resolvedAt === null };
  }

  private resolveStaleAlerts(snapshot: FleetSnapshot): void {
    const stalledIds = new Set(snapshot.sessions.filter((session) => session.healthState === "stalled").map((session) => session.id));
    const failedIds = new Set(snapshot.sessions.filter((session) => session.executionState === "failed" || session.healthState === "error").map((session) => session.id));
    for (const alert of this.store.listAlerts({ unresolvedOnly: true })) {
      if (alert.sessionId === null) continue;
      if (alert.title.startsWith("session stalled") && !stalledIds.has(alert.sessionId)) {
        this.store.resolveAlert(alert.id);
      }
      if (alert.title.startsWith("explicit failure") && !failedIds.has(alert.sessionId)) {
        this.store.resolveAlert(alert.id);
      }
    }
  }
}

function sessionDisplayName(session: AgentSession): string {
  return session.alias ?? session.projectName ?? session.sourceSessionId ?? session.id;
}
