// Phase 20.9 — Central Context Builder
// Assembles token-budgeted prompt context for the model:
// System Rules, Workspace Policy, Scoped AGENTS.md, Stage 1 Skills, and Visible Tools.

import type { ToolDescriptor } from "../types";
import { getPolicyEngine } from "../policy/policy-engine";
import { getAgentsMarkdownResolver } from "../policy/agents-markdown-resolver";
import { getSkillsRuntime } from "../skills/skills-runtime";
import { getSecretRedactor } from "../security/secret-redactor";

export interface ContextBuildOptions {
  workspaceRoot?: string;
  targetPath?: string;
  activeSkillIds?: string[];
  maxTokens?: number;
  userPrompt?: string;
}

export interface AssembledContext {
  systemPrompt: string;
  visibleSkillsCount: number;
  agentsInstructionLoaded: boolean;
  tokenEstimate: number;
}

export class ContextBuilder {
  /**
   * Assembles a structured system prompt respecting token budgets and security boundaries.
   */
  assembleContext(
    visibleTools: ToolDescriptor[] = [],
    options: ContextBuildOptions = {},
  ): AssembledContext {
    const root = options.workspaceRoot ?? process.cwd();
    const target = options.targetPath ?? root;

    const policyEngine = getPolicyEngine();
    const agentsResolver = getAgentsMarkdownResolver();
    const skillsRuntime = getSkillsRuntime();
    const redactor = getSecretRedactor();

    const sections: string[] = [
      "You are Pao-hubPro Desktop AI Agent, an autonomous assistant operating under the Pao-hubPro Desktop Agent Operating Layer.",
      "INVARIANT: All tool executions, filesystem modifications, shell commands, and external calls are governed by the Policy Engine.",
      "Model outputs are PROPOSALS, not final authority. If an operation exceeds allowed bounds, it will be gated for human approval.",
      "",
    ];

    // 1. Workspace Policy Summary
    const policy = policyEngine.getPolicy();
    sections.push("### Workspace Security Policy");
    sections.push(`- Allowed Roots: ${policy.allowedRoots.join(", ")}`);
    sections.push(`- Denied Paths: ${policy.deniedPaths.join(", ")}`);
    sections.push(`- Git Push Policy: ${policy.gitPolicy.allowPush}`);
    sections.push(`- Force Push Permitted: ${policy.gitPolicy.allowForcePush ? "true" : "FALSE"}`);
    sections.push("");

    // 2. AGENTS.md Hierarchy
    const hierarchy = agentsResolver.resolveHierarchy(root, target);
    if (hierarchy.combinedInstructionText) {
      sections.push("### Workspace AGENTS.md Instructions");
      sections.push(hierarchy.combinedInstructionText);
      sections.push("");
    }

    // 3. Stage 1 Skills (Progressive Disclosure - lightweight metadata only)
    const stage1Skills = skillsRuntime.getStage1Descriptors();
    if (stage1Skills.length > 0) {
      sections.push("### Available Skills (Progressive Disclosure)");
      sections.push("To load complete skill instructions, propose calling 'load_skill' with the skill name.");
      for (const s of stage1Skills) {
        sections.push(`- ${s.name}: ${s.description}`);
      }
      sections.push("");
    }

    // 4. Visible Tools Overview
    if (visibleTools.length > 0) {
      sections.push("### Active Tool Capabilities");
      for (const t of visibleTools) {
        sections.push(`- ${t.id} (${t.risk}): ${t.description}`);
      }
      sections.push("");
    }

    const rawSystemPrompt = sections.join("\n");
    // Ensure zero secrets exist in the generated prompt context
    const redactedSystemPrompt = redactor.redact(rawSystemPrompt).redacted;

    return {
      systemPrompt: redactedSystemPrompt,
      visibleSkillsCount: stage1Skills.length,
      agentsInstructionLoaded: Boolean(hierarchy.rootInstruction || hierarchy.scopedInstructions.length > 0),
      tokenEstimate: Math.round(redactedSystemPrompt.length / 4),
    };
  }
}

let defaultContextBuilder: ContextBuilder | null = null;
export function getContextBuilder(): ContextBuilder {
  if (!defaultContextBuilder) {
    defaultContextBuilder = new ContextBuilder();
  }
  return defaultContextBuilder;
}
