/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Security Vault: Tamper-Evident Incident Ledger & Shield Metrics
 */

import { randomUUID } from "node:crypto";
import type { SecurityShieldMetrics, ThreatCategory, ThreatIncident, ThreatSeverity } from "./types";

export interface IncidentFilter {
  category?: ThreatCategory;
  severity?: ThreatSeverity;
  agentId?: string;
  limit?: number;
}

export class SecurityVault {
  private incidents: ThreatIncident[] = [];
  private maxCapacity: number;

  constructor(maxCapacity: number = 2000) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Records a detected threat incident into the immutable vault ledger.
   */
  public logIncident(input: Omit<ThreatIncident, "id" | "timestamp">): ThreatIncident {
    const id = `inc_${randomUUID().slice(0, 10)}`;
    const timestamp = new Date().toISOString();
    const incident: ThreatIncident = {
      id,
      timestamp,
      ...input,
    };

    this.incidents.unshift(incident); // newest first
    if (this.incidents.length > this.maxCapacity) {
      this.incidents.length = this.maxCapacity;
    }

    return { ...incident };
  }

  /**
   * Queries threat incidents by filter criteria.
   */
  public listIncidents(filter: IncidentFilter = {}): ThreatIncident[] {
    let result = [...this.incidents];

    if (filter.agentId) {
      result = result.filter((i) => i.agentId === filter.agentId);
    }
    if (filter.category) {
      result = result.filter((i) => i.category === filter.category);
    }
    if (filter.severity) {
      result = result.filter((i) => i.severity === filter.severity);
    }

    const limit = filter.limit ?? 100;
    return result.slice(0, limit);
  }

  /**
   * Computes real-time system shield metrics.
   */
  public getMetrics(
    activeAgentsCount: number,
    quarantinedAgentsCount: number,
    activeTripwiresCount: number
  ): SecurityShieldMetrics {
    const totalThreatsDetected = this.incidents.length;
    const totalThreatsBlocked = this.incidents.filter((i) => i.blocked).length;
    const criticalThreatsCount = this.incidents.filter((i) => i.severity === "critical").length;

    let shieldStatus: SecurityShieldMetrics["shieldStatus"] = "ARMED & IMMUNE";
    if (criticalThreatsCount > 5 || quarantinedAgentsCount > 3) {
      shieldStatus = "DEGRADED";
    }

    return {
      shieldStatus,
      totalThreatsDetected,
      totalThreatsBlocked,
      criticalThreatsCount,
      activeTripwiresCount,
      activeAgentsCount,
      quarantinedAgentsCount,
      lastIncidentTimestamp: this.incidents[0]?.timestamp,
    };
  }

  public clear(): void {
    this.incidents = [];
  }
}
