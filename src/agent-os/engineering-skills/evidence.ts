// Phase 20.91b — Engineering Skill Runtime: immutable Evidence system.
//
// Evidence law (source §14.4): an agent message saying "Tests passed." is not
// evidence. Pao-hubPro needs command + exit code + output/artifact + timestamp,
// captured by the RUNTIME (hashes and timestamps are generated here, never by
// the model). Model-authored summaries are stored separately from raw evidence.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { EvidenceType } from "./types";

export interface EvidenceRecord {
  id: string;
  workflowId: string;
  stepId: string | null;
  type: EvidenceType;
  producer: string;
  command: string | null;
  exitCode: number | null;
  artifactUri: string | null;
  sha256: string | null;
  verified: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface RecordEvidenceInput {
  workflowId: string;
  stepId?: string | null;
  type: EvidenceType;
  producer: string;
  command?: string | null;
  exitCode?: number | null;
  /** Raw output/artifact content to hash — provided by the tool runtime, not the model. */
  output?: string | null;
  artifactUri?: string | null;
  metadata?: Record<string, unknown>;
}

export class EvidenceCollector {
  /**
   * Record an immutable evidence row. Verification is runtime-derived:
   * an exit code captured from a real command execution makes the record
   * verified; anything else stays unverified until a gate checks it.
   */
  record(input: RecordEvidenceInput): EvidenceRecord {
    const id = `esk_${randomUUID().slice(0, 16)}`;
    const now = new Date().toISOString();
    const sha256 = input.output !== undefined && input.output !== null ? createHash("sha256").update(input.output).digest("hex") : null;
    const verified = input.exitCode !== undefined && input.exitCode !== null;

    const db = openAgentOsDb();
    db.run(
      "INSERT INTO esk_evidence (id, workflow_id, step_id, type, producer, command, exit_code, artifact_uri, sha256, metadata_json, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id, input.workflowId, input.stepId ?? null, input.type, input.producer,
        input.command ?? null, input.exitCode ?? null, input.artifactUri ?? null,
        sha256, JSON.stringify(input.metadata ?? {}), verified ? 1 : 0, now,
      ],
    );

    return {
      id, workflowId: input.workflowId, stepId: input.stepId ?? null, type: input.type,
      producer: input.producer, command: input.command ?? null, exitCode: input.exitCode ?? null,
      artifactUri: input.artifactUri ?? null, sha256, verified, createdAt: now,
      metadata: input.metadata ?? {},
    };
  }

  list(workflowId: string): EvidenceRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM esk_evidence WHERE workflow_id = ? ORDER BY created_at").all(workflowId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToRecord(r));
  }

  /**
   * The gate: does the workflow hold verified evidence of the required types?
   * A plain model claim produces NO row, so an unmet requirement fails here —
   * the fake "tests passed" scenario (source test G) cannot pass.
   */
  hasVerifiedEvidence(workflowId: string, requiredTypes: EvidenceType[]): { satisfied: boolean; missing: EvidenceType[] } {
    const held = new Set(this.list(workflowId).filter((e) => e.verified).map((e) => e.type));
    const missing = requiredTypes.filter((t) => !held.has(t));
    return { satisfied: missing.length === 0, missing };
  }

  private rowToRecord(row: Record<string, unknown>): EvidenceRecord {
    return {
      id: String(row.id),
      workflowId: String(row.workflow_id),
      stepId: row.step_id === null ? null : String(row.step_id),
      type: String(row.type) as EvidenceType,
      producer: String(row.producer),
      command: row.command === null ? null : String(row.command),
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      artifactUri: row.artifact_uri === null ? null : String(row.artifact_uri),
      sha256: row.sha256 === null ? null : String(row.sha256),
      verified: Number(row.verified) === 1,
      createdAt: String(row.created_at),
      metadata: JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>,
    };
  }
}

let singleton: EvidenceCollector | null = null;

export function getEvidenceCollector(): EvidenceCollector {
  if (!singleton) singleton = new EvidenceCollector();
  return singleton;
}
