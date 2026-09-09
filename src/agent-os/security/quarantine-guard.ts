/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Quarantine Guard: Dynamic Agent State Machine & Autonomous Isolation
 */

import type { AgentSecurityRecord, AgentSecurityState, ThreatSeverity } from "./types";

interface IncidentTracker {
  timestamp: number;
  severity: ThreatSeverity;
  score: number;
}

export class QuarantineGuard {
  private records: Map<string, AgentSecurityRecord> = new Map();
  private incidentHistory: Map<string, IncidentTracker[]> = new Map();
  private windowMs: number;

  constructor(windowMs: number = 15 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  private getOrCreateRecord(agentId: string): AgentSecurityRecord {
    let rec = this.records.get(agentId);
    if (!rec) {
      const now = new Date().toISOString();
      rec = {
        agentId,
        state: "active",
        threatScore: 0.0,
        incidentCount: 0,
        registeredAt: now,
        updatedAt: now,
      };
      this.records.set(agentId, rec);
    }
    return rec;
  }

  public getAgentRecord(agentId: string): AgentSecurityRecord {
    return { ...this.getOrCreateRecord(agentId) };
  }

  public listAgentRecords(): AgentSecurityRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  /**
   * Checks whether the agent is permitted to execute actions or tools.
   */
  public isAgentAllowed(agentId: string): { allowed: boolean; state: AgentSecurityState; reason?: string } {
    const rec = this.getOrCreateRecord(agentId);
    if (rec.state === "quarantined") {
      return {
        allowed: false,
        state: "quarantined",
        reason: `Agent '${agentId}' is quarantined: ${rec.reason ?? "Security policy isolation."}`,
      };
    }
    if (rec.state === "revoked") {
      return {
        allowed: false,
        state: "revoked",
        reason: `Agent '${agentId}' credentials have been revoked permanently: ${rec.reason ?? "Compromise event."}`,
      };
    }
    return { allowed: true, state: rec.state };
  }

  /**
   * Evaluates and records a threat incident against an agent, triggering autonomous quarantine if thresholds are exceeded.
   */
  public recordIncident(
    agentId: string,
    severity: ThreatSeverity,
    score: number,
    summary: string,
    now: number = Date.now()
  ): AgentSecurityRecord {
    const rec = this.getOrCreateRecord(agentId);
    rec.incidentCount += 1;
    rec.lastIncidentAt = new Date(now).toISOString();
    rec.updatedAt = new Date(now).toISOString();
    rec.threatScore = Math.max(rec.threatScore, score);

    // Track sliding window history
    let history = this.incidentHistory.get(agentId);
    if (!history) {
      history = [];
      this.incidentHistory.set(agentId, history);
    }
    history.push({ timestamp: now, severity, score });

    // Prune history older than windowMs
    const cutoff = now - this.windowMs;
    const recent = history.filter((i) => i.timestamp >= cutoff);
    this.incidentHistory.set(agentId, recent);

    // Evaluate Autonomous Isolation Triggers
    if (severity === "critical") {
      rec.state = "quarantined";
      rec.quarantinedAt = new Date(now).toISOString();
      rec.reason = `Autonomous quarantine triggered: critical violation (${summary})`;
    } else {
      const highCount = recent.filter((i) => i.severity === "high").length;
      const medCount = recent.filter((i) => i.severity === "medium").length;

      if (highCount >= 3) {
        rec.state = "quarantined";
        rec.quarantinedAt = new Date(now).toISOString();
        rec.reason = `Autonomous quarantine: accumulated ${highCount} high-severity violations within window`;
      } else if (medCount >= 5 || highCount >= 1) {
        if (rec.state === "active") {
          rec.state = "monitored";
        }
      }
    }

    return { ...rec };
  }

  /**
   * Manually isolates an agent.
   */
  public quarantineAgent(agentId: string, reason: string): AgentSecurityRecord {
    const rec = this.getOrCreateRecord(agentId);
    const now = new Date().toISOString();
    rec.state = "quarantined";
    rec.quarantinedAt = now;
    rec.reason = reason;
    rec.updatedAt = now;
    return { ...rec };
  }

  /**
   * Releases an agent from quarantine back to active status.
   */
  public releaseAgent(agentId: string): AgentSecurityRecord {
    const rec = this.getOrCreateRecord(agentId);
    const now = new Date().toISOString();
    rec.state = "active";
    rec.quarantinedAt = undefined;
    rec.reason = undefined;
    rec.threatScore = 0.0;
    rec.updatedAt = now;
    this.incidentHistory.delete(agentId);
    return { ...rec };
  }

  /**
   * Permanently revokes an agent.
   */
  public revokeAgent(agentId: string, reason: string): AgentSecurityRecord {
    const rec = this.getOrCreateRecord(agentId);
    const now = new Date().toISOString();
    rec.state = "revoked";
    rec.quarantinedAt = now;
    rec.reason = reason;
    rec.updatedAt = now;
    return { ...rec };
  }
}
