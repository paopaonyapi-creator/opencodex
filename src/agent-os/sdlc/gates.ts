// Phase 20.2 — Quality Gate Engine
//
// Authoritative governor evaluating gate prerequisites and blocking progression on failures.

import { openAgentOsDb } from "../db";
import type { GateType, GateStatus, SdlcGate } from "./types";

export class QualityGateEngine {
  static getGate(cycleId: string, gateType: GateType): SdlcGate | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM sdlc_gates WHERE cycle_id = ? AND gate_type = ?").get(cycleId, gateType) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      cycleId: row.cycle_id as string,
      gateType: row.gate_type as GateType,
      status: row.status as GateStatus,
      score: row.score as number,
      checklistResults: JSON.parse((row.checklist_results_json as string) || "[]"),
      blockers: JSON.parse((row.blockers_json as string) || "[]"),
      evaluatedAt: row.evaluated_at as string | null,
      createdAt: row.created_at as string,
    };
  }

  static listGates(cycleId: string): SdlcGate[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM sdlc_gates WHERE cycle_id = ? ORDER BY created_at ASC").all(cycleId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as string,
      cycleId: row.cycle_id as string,
      gateType: row.gate_type as GateType,
      status: row.status as GateStatus,
      score: row.score as number,
      checklistResults: JSON.parse((row.checklist_results_json as string) || "[]"),
      blockers: JSON.parse((row.blockers_json as string) || "[]"),
      evaluatedAt: row.evaluated_at as string | null,
      createdAt: row.created_at as string,
    }));
  }

  static assertGatePassed(cycleId: string, gateType: GateType): void {
    const gate = this.getGate(cycleId, gateType);
    if (!gate) {
      throw new Error(`Mandatory gate '${gateType}' has not been evaluated for cycle ${cycleId}`);
    }
    if (gate.status !== "passed" && gate.status !== "bypassed") {
      const blockerMsg = gate.blockers.length > 0 ? `: ${gate.blockers.join("; ")}` : "";
      throw new Error(`Mandatory gate '${gateType}' failed (score: ${gate.score}%)${blockerMsg}`);
    }
  }

  static recordGate(gate: Omit<SdlcGate, "id" | "createdAt">): SdlcGate {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const id = `gate_${gate.gateType.toLowerCase()}_${gate.cycleId}`;

    db.run("DELETE FROM sdlc_gates WHERE cycle_id = ? AND gate_type = ?", [gate.cycleId, gate.gateType]);
    db.query(`
      INSERT INTO sdlc_gates
        (id, cycle_id, gate_type, status, score, checklist_results_json, blockers_json, evaluated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      gate.cycleId,
      gate.gateType,
      gate.status,
      gate.score,
      JSON.stringify(gate.checklistResults),
      JSON.stringify(gate.blockers),
      gate.evaluatedAt ?? now,
      now,
    );

    return {
      ...gate,
      id,
      createdAt: now,
    };
  }
}
