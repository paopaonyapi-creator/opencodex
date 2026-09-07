// Phase 20.8 — Codex Agency Adapter
// Supports Mode A (Prompt Injection-Free Bounded Delegation)
// and Mode B (Temporary Custom Agent .toml Export to .pao/generated/codex-agents/).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLazyAgentLoader } from "../loader/lazy-agent-loader";
import { buildBoundedSpecialistPrompt } from "../security/prompt-sanitizer";
import type {
  ApprovedExecutionPlan,
  ExecutionResult,
  DelegationRequest,
  DynamicTeam,
} from "../types";

export interface CodexExportResult {
  exportedCount: number;
  exportDir: string;
  files: string[];
}

export class CodexAgencyAdapter {
  readonly name = "codex";

  /**
   * Mode A: Generates bounded instruction package for delegation to Codex.
   */
  async composeBoundedInstruction(delegation: DelegationRequest): Promise<string> {
    const loader = getLazyAgentLoader();
    const agent = await loader.loadAgentWithBody(delegation.agentSlug);
    const packaged = buildBoundedSpecialistPrompt(
      agent.name,
      agent.slug,
      agent.body ?? "",
      delegation,
    );
    return packaged.composedPrompt;
  }

  /**
   * Mode B: Exports selected team agents as Codex custom agent .toml files.
   * Saved safely in .pao/generated/codex-agents/ (never overwriting ~/.codex without explicit opt-in).
   */
  async exportTeamToCodexToml(team: DynamicTeam, targetDir?: string): Promise<CodexExportResult> {
    const loader = getLazyAgentLoader();
    const outDir = targetDir ?? join(process.cwd(), ".pao", "generated", "codex-agents");
    mkdirSync(outDir, { recursive: true });

    const allSlugs = new Set<string>([
      team.lead.slug,
      ...team.planners.map((p) => p.slug),
      ...team.builders.map((b) => b.slug),
      ...team.reviewers.map((r) => r.slug),
      ...team.validators.map((v) => v.slug),
    ]);

    const exportedFiles: string[] = [];

    for (const slug of allSlugs) {
      try {
        const agent = await loader.loadAgentWithBody(slug, { sanitize: true });
        const tomlContent = [
          `name = "${agent.name.replace(/"/g, '\\"')}"`,
          `description = "${agent.description.replace(/"/g, '\\"')}"`,
          `developer_instructions = """`,
          agent.body ?? "",
          `"""`,
        ].join("\n");

        const filePath = join(outDir, `${slug}.toml`);
        writeFileSync(filePath, tomlContent, "utf8");
        exportedFiles.push(filePath);
      } catch (err) {
        // Skip unresolvable agents
      }
    }

    return {
      exportedCount: exportedFiles.length,
      exportDir: outDir,
      files: exportedFiles,
    };
  }

  /**
   * Mock or safe execution hook for approved execution plan.
   */
  async execute(plan: ApprovedExecutionPlan): Promise<ExecutionResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const logs: string[] = [];

    logs.push(`Initiating Codex execution for mission: ${plan.mission}`);
    logs.push(`Assigned Lead: ${plan.team.lead.name} (${plan.team.lead.slug})`);

    for (const subtask of plan.plan) {
      logs.push(`Executing subtask [${subtask.id}]: ${subtask.title}`);
      artifacts.push(...subtask.expectedArtifacts);
    }

    return {
      success: true,
      executor: this.name,
      artifacts,
      logs,
      durationMs: Date.now() - startTime,
    };
  }
}

let defaultCodexAdapter: CodexAgencyAdapter | null = null;
export function getCodexAgencyAdapter(): CodexAgencyAdapter {
  if (!defaultCodexAdapter) {
    defaultCodexAdapter = new CodexAgencyAdapter();
  }
  return defaultCodexAdapter;
}
