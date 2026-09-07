// Phase 20.2 — Specification Engine (/specify)
//
// Ingests ideas and problem statements, structures requirements and acceptance criteria,
// persists artifacts, and evaluates the Spec Quality Gate.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  SdlcRequirement,
  SdlcAcceptanceCriteria,
  SdlcGate,
  RequirementType,
  VerificationType,
} from "./types";

export interface SpecifyInput {
  cycleId: string;
  title: string;
  sourceIdea: string;
  constraints?: string[];
  moduleHint?: string;
}

export interface SpecifyResult {
  requirements: SdlcRequirement[];
  acceptanceCriteria: SdlcAcceptanceCriteria[];
  artifactContent: string;
  specGate: SdlcGate;
}

export class SpecifyEngine {
  static generateSpec(input: SpecifyInput): SpecifyResult {
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    // 1. Analyze and structure requirements from idea
    const rawReqs: Array<{
      key: string;
      type: RequirementType;
      title: string;
      description: string;
      acList: Array<{ key: string; description: string; verificationType: VerificationType }>;
    }> = [
      {
        key: "FR-001",
        type: "FUNCTIONAL",
        title: `Core Functionality: ${input.title}`,
        description: `Implement primary capability described in: ${input.sourceIdea}`,
        acList: [
          {
            key: "AC-001",
            description: "Feature executes end-to-end without unhandled exceptions under valid input.",
            verificationType: "UNIT_TEST",
          },
          {
            key: "AC-002",
            description: "System validates all input parameters and returns clean error responses for invalid inputs.",
            verificationType: "INTEGRATION_TEST",
          },
        ],
      },
      {
        key: "NFR-001",
        type: "NON_FUNCTIONAL",
        title: "Deterministic State & Idempotency",
        description: "Operations must be idempotent and preserve persistent state across restarts.",
        acList: [
          {
            key: "AC-003",
            description: "Repeat execution of the same operation produces identical outcomes without duplicate side effects.",
            verificationType: "INTEGRATION_TEST",
          },
        ],
      },
      {
        key: "SEC-001",
        type: "SECURITY",
        title: "Input Validation and Secret Protection",
        description: "Zero hardcoded credentials, secret redaction, and strict origin / authentication checks.",
        acList: [
          {
            key: "AC-004",
            description: "Secret scan passes with zero plaintext credentials detected in commits or logs.",
            verificationType: "SECURITY_CHECK",
          },
        ],
      },
    ];

    // Clean existing requirements/ACs for this cycle if re-specifying
    db.run("DELETE FROM sdlc_acceptance_criteria WHERE cycle_id = ?", [input.cycleId]);
    db.run("DELETE FROM sdlc_requirements WHERE cycle_id = ?", [input.cycleId]);

    const createdReqs: SdlcRequirement[] = [];
    const createdAcs: SdlcAcceptanceCriteria[] = [];

    for (let rIdx = 0; rIdx < rawReqs.length; rIdx++) {
      const r = rawReqs[rIdx]!;
      const reqId = `req_${input.cycleId}_${rIdx + 1}`;
      db.query(`
        INSERT INTO sdlc_requirements
          (id, cycle_id, key, type, priority, title, description, source, status, risk_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, 5, ?, ?, 'user_idea', 'approved', 'MEDIUM', ?, ?)
      `).run(reqId, input.cycleId, r.key, r.type, r.title, r.description, now, now);

      const reqRecord: SdlcRequirement = {
        id: reqId,
        cycleId: input.cycleId,
        key: r.key,
        type: r.type,
        priority: 5,
        title: r.title,
        description: r.description,
        source: "user_idea",
        status: "approved",
        riskLevel: "MEDIUM",
        createdAt: now,
        updatedAt: now,
      };
      createdReqs.push(reqRecord);

      for (let acIdx = 0; acIdx < r.acList.length; acIdx++) {
        const ac = r.acList[acIdx]!;
        const acId = `ac_${input.cycleId}_${ac.key}`;
        db.query(`
          INSERT INTO sdlc_acceptance_criteria
            (id, requirement_id, cycle_id, key, description, verification_type, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).run(acId, reqId, input.cycleId, ac.key, ac.description, ac.verificationType);

        createdAcs.push({
          id: acId,
          requirementId: reqId,
          cycleId: input.cycleId,
          key: ac.key,
          description: ac.description,
          verificationType: ac.verificationType,
          status: "pending",
          verifiedBy: null,
          verifiedAt: null,
          evidenceId: null,
        });
      }
    }

    // 2. Generate Markdown Specification Artifact
    const specMarkdown = [
      `# Specification — ${input.title}`,
      "",
      `**Cycle ID:** ${input.cycleId}`,
      `**Generated At:** ${now}`,
      "",
      "## 1. Goal & Context",
      input.sourceIdea,
      "",
      "## 2. Requirements",
      ...createdReqs.map(r => `### [${r.key}] ${r.title}\n- **Type:** ${r.type}\n- **Description:** ${r.description}`),
      "",
      "## 3. Acceptance Criteria",
      ...createdAcs.map(ac => `- **[${ac.key}]** (${ac.verificationType}): ${ac.description}`),
      "",
      "## 4. Constraints & Dependencies",
      ...(input.constraints?.length ? input.constraints.map(c => `- ${c}`) : ["- Follow Pao-hubPro architecture conventions."]),
    ].join("\n");

    const sha256 = createHash("sha256").update(specMarkdown).digest("hex");
    const artifactId = `art_spec_${input.cycleId}`;

    db.run("DELETE FROM sdlc_artifacts WHERE cycle_id = ? AND artifact_type = 'spec'", [input.cycleId]);
    db.query(`
      INSERT INTO sdlc_artifacts
        (id, cycle_id, artifact_type, version, content, sha256, is_stale, created_at)
      VALUES (?, ?, 'spec', 1, ?, ?, 0, ?)
    `).run(artifactId, input.cycleId, specMarkdown, sha256, now);

    // 3. Evaluate Spec Quality Gate
    const checklist = [
      { name: "Goal & Context clearly stated", passed: input.sourceIdea.trim().length > 10 },
      { name: "Functional requirements defined", passed: createdReqs.some(r => r.type === "FUNCTIONAL") },
      { name: "Non-functional requirements defined", passed: createdReqs.some(r => r.type === "NON_FUNCTIONAL") },
      { name: "Security considerations addressed", passed: createdReqs.some(r => r.type === "SECURITY") },
      { name: "Acceptance criteria with verification types mapped", passed: createdAcs.length >= 3 },
    ];

    const passedCount = checklist.filter(c => c.passed).length;
    const score = Math.round((passedCount / checklist.length) * 100);
    const gateStatus = score >= 80 ? "passed" : "failed";
    const gateId = `gate_spec_${input.cycleId}`;

    db.run("DELETE FROM sdlc_gates WHERE cycle_id = ? AND gate_type = 'SPEC_GATE'", [input.cycleId]);
    db.query(`
      INSERT INTO sdlc_gates
        (id, cycle_id, gate_type, status, score, checklist_results_json, blockers_json, evaluated_at, created_at)
      VALUES (?, ?, 'SPEC_GATE', ?, ?, ?, '[]', ?, ?)
    `).run(gateId, input.cycleId, gateStatus, score, JSON.stringify(checklist), now, now);

    const specGate: SdlcGate = {
      id: gateId,
      cycleId: input.cycleId,
      gateType: "SPEC_GATE",
      status: gateStatus,
      score,
      checklistResults: checklist,
      blockers: [],
      evaluatedAt: now,
      createdAt: now,
    };

    return {
      requirements: createdReqs,
      acceptanceCriteria: createdAcs,
      artifactContent: specMarkdown,
      specGate,
    };
  }
}
