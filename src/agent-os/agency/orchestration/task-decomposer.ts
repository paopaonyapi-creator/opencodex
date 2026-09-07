// Phase 20.8 — Task Decomposer
// Decomposes high-level missions into dependency-ordered AgentSubtasks.

import type { DynamicTeam, AgentSubtask } from "../types";

export class TaskDecomposer {
  /**
   * Decomposes a mission into subtasks based on dynamic team composition.
   */
  decompose(team: DynamicTeam, mission: string): AgentSubtask[] {
    const subtasks: AgentSubtask[] = [];
    let taskCounter = 1;

    // 1. Planning Subtask (assigned to Planner or Lead)
    const plannerAgent = team.planners[0] ?? team.lead;
    const planTaskId = `subtask_${taskCounter++}`;
    subtasks.push({
      id: planTaskId,
      title: `Architectural Blueprint & Plan: ${mission.slice(0, 40)}`,
      objective: `Analyze mission requirements, define architecture boundaries, and scope subtasks for: ${mission}`,
      dependencies: [],
      assignedAgent: plannerAgent.slug,
      risk: "low",
      expectedArtifacts: ["implementation_plan.md", "architecture_spec.json"],
      doneCriteria: ["Requirements mapped", "Component boundaries defined", "Deliverables scoped"],
      status: "pending",
      attemptCount: 0,
    });

    // 2. Builder Subtasks
    const builderTaskIds: string[] = [];
    for (const builder of team.builders) {
      const bTaskId = `subtask_${taskCounter++}`;
      builderTaskIds.push(bTaskId);

      subtasks.push({
        id: bTaskId,
        title: `Component Implementation (${builder.name})`,
        objective: `Implement core functionality and modules according to blueprint for ${builder.name}`,
        dependencies: [planTaskId],
        assignedAgent: builder.slug,
        risk: team.riskLevel,
        expectedArtifacts: ["source_code", "unit_tests", "proposed_changes"],
        doneCriteria: ["Components written", "Edge cases handled", "Zero syntax errors"],
        status: "pending",
        attemptCount: 0,
      });
    }

    // 3. Reviewer Subtasks
    const reviewTaskIds: string[] = [];
    for (const reviewer of team.reviewers) {
      const rTaskId = `subtask_${taskCounter++}`;
      reviewTaskIds.push(rTaskId);

      subtasks.push({
        id: rTaskId,
        title: `Quality & Security Inspection (${reviewer.name})`,
        objective: `Inspect proposed changes for correctness, security, maintainability, and regression safety`,
        dependencies: [...builderTaskIds],
        assignedAgent: reviewer.slug,
        risk: "low",
        expectedArtifacts: ["review_report.json", "finding_list"],
        doneCriteria: ["All changes inspected", "Security boundaries verified", "Zero false approvals"],
        status: "pending",
        attemptCount: 0,
      });
    }

    // 4. Validation Subtask (Reality Checker)
    const validatorAgent = team.validators[0] ?? { slug: "reality-checker", name: "Reality Checker" };
    const valTaskId = `subtask_${taskCounter++}`;
    subtasks.push({
      id: valTaskId,
      title: `Evidence & Ground Truth Verification (${validatorAgent.name})`,
      objective: `Verify that all artifacts exist, claims have evidence, and no hallucinations occurred`,
      dependencies: [...reviewTaskIds],
      assignedAgent: validatorAgent.slug,
      risk: "low",
      expectedArtifacts: ["evidence_manifest.json", "reality_gate_result"],
      doneCriteria: ["Artifact paths verified", "Test outputs confirmed", "No missing evidence"],
      status: "pending",
      attemptCount: 0,
    });

    return subtasks;
  }
}

let defaultDecomposer: TaskDecomposer | null = null;
export function getTaskDecomposer(): TaskDecomposer {
  if (!defaultDecomposer) {
    defaultDecomposer = new TaskDecomposer();
  }
  return defaultDecomposer;
}
