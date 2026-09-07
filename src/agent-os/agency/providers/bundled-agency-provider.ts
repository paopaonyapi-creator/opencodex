// Phase 20.8 — Bundled & Local Agency Provider
// Scans local agency skills directories and built-in specialist presets.
// Reads only metadata during sync; retrieves full prompt bodies on-demand.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseAgentMarkdown } from "../parser/agent-markdown-parser";
import type { AgencyAgent, AgencySyncResult } from "../types";
import type { AgencyCatalogProvider } from "./agency-catalog-provider";

export interface BundledProviderOptions {
  localSkillsDir?: string;
  customAgentsDir?: string;
}

export class BundledAgencyProvider implements AgencyCatalogProvider {
  readonly name = "bundled-local";
  readonly sourceType = "bundled-fallback";

  private localSkillsDir: string;
  private customAgentsDir: string;
  private agentIndex = new Map<string, AgencyAgent>();
  private bodyPathIndex = new Map<string, string>();

  constructor(options: BundledProviderOptions = {}) {
    this.localSkillsDir =
      options.localSkillsDir ??
      process.env.PAO_AGENCY_LOCAL_DIR ??
      "C:\\Users\\AD PAO\\.gemini\\config\\skills";
    this.customAgentsDir =
      options.customAgentsDir ??
      join(process.cwd(), ".pao", "agents", "custom");
  }

  isAvailable(): boolean {
    return existsSync(this.localSkillsDir) || existsSync(this.customAgentsDir);
  }

  async sync(): Promise<AgencySyncResult> {
    const startTime = Date.now();
    let syncedCount = 0;
    let skippedCount = 0;
    let blockedCount = 0;
    const errors: string[] = [];

    this.agentIndex.clear();
    this.bodyPathIndex.clear();

    // 1. Scan primary skills directory
    if (existsSync(this.localSkillsDir)) {
      try {
        const entries = readdirSync(this.localSkillsDir);
        for (const entry of entries) {
          if (!entry.toLowerCase().startsWith("agency-")) continue;

          const skillPath = join(this.localSkillsDir, entry);
          const skillFile = join(skillPath, "SKILL.md");

          if (existsSync(skillFile)) {
            try {
              const rawContent = readFileSync(skillFile, "utf8");
              const agent = parseAgentMarkdown(rawContent, {
                sourcePath: skillFile,
                trustSource: "bundled",
                includeBody: false,
              });

              if (agent.safety.status === "blocked") {
                blockedCount++;
              } else {
                syncedCount++;
              }

              this.agentIndex.set(agent.slug, agent);
              this.bodyPathIndex.set(agent.slug, skillFile);
            } catch (err) {
              skippedCount++;
              errors.push(`Failed to parse ${entry}: ${String(err)}`);
            }
          }
        }
      } catch (err) {
        errors.push(`Error reading local skills dir: ${String(err)}`);
      }
    }

    // 2. Scan custom user overrides in .pao/agents/custom/
    if (existsSync(this.customAgentsDir)) {
      try {
        const customEntries = readdirSync(this.customAgentsDir);
        for (const entry of customEntries) {
          if (!entry.endsWith(".md")) continue;
          const agentPath = join(this.customAgentsDir, entry);
          try {
            const raw = readFileSync(agentPath, "utf8");
            const agent = parseAgentMarkdown(raw, {
              sourcePath: agentPath,
              trustSource: "custom",
              includeBody: false,
            });

            this.agentIndex.set(agent.slug, agent);
            this.bodyPathIndex.set(agent.slug, agentPath);
            syncedCount++;
          } catch (err) {
            errors.push(`Error reading custom agent ${entry}: ${String(err)}`);
          }
        }
      } catch (err) {
        errors.push(`Error scanning custom dir: ${String(err)}`);
      }
    }

    // 3. If zero agents found (e.g., isolated test environment), inject built-in core specialists
    if (this.agentIndex.size === 0) {
      this.injectBuiltinMinimalSpecialists();
      syncedCount += this.agentIndex.size;
    }

    return {
      source: this.localSkillsDir,
      sourceType: this.sourceType,
      syncedCount,
      skippedCount,
      blockedCount,
      durationMs: Date.now() - startTime,
      errors,
    };
  }

  async listAgents(): Promise<AgencyAgent[]> {
    if (this.agentIndex.size === 0) {
      await this.sync();
    }
    return Array.from(this.agentIndex.values());
  }

  async getAgent(slug: string): Promise<AgencyAgent | null> {
    if (this.agentIndex.size === 0) {
      await this.sync();
    }
    return this.agentIndex.get(slug) ?? null;
  }

  async getAgentBody(slug: string): Promise<string> {
    const filePath = this.bodyPathIndex.get(slug);
    if (filePath && existsSync(filePath)) {
      return readFileSync(filePath, "utf8");
    }

    // Fallback to built-in prompt body if mocked/in-memory
    const fallback = BUILTIN_PROMPTS[slug];
    if (fallback) return fallback;

    throw new Error(`Agent body not found for slug '${slug}'`);
  }

  private injectBuiltinMinimalSpecialists(): void {
    for (const [slug, rawMarkdown] of Object.entries(BUILTIN_PROMPTS)) {
      const agent = parseAgentMarkdown(rawMarkdown, {
        sourcePath: `virtual://bundled/${slug}.md`,
        trustSource: "bundled",
        includeBody: false,
      });
      this.agentIndex.set(agent.slug, agent);
    }
  }
}

const BUILTIN_PROMPTS: Record<string, string> = {
  "mcp-builder": `---
name: MCP Builder
description: Expert Model Context Protocol developer who designs, builds, and tests MCP servers that extend AI agent capabilities with custom tools, resources, and prompts.
---
# MCP Builder Agent
You are MCP Builder, a specialist in building Model Context Protocol servers.
## 🎯 Core Mission
Build production-quality MCP servers with safe tool schemas, error handling, and TypeScript interfaces.
## 🔧 Critical Rules
1. Descriptive tool names.
2. Typed parameters with Zod.
3. Return structured JSON output.
`,
  "software-architect": `---
name: Software Architect
description: Expert software architect specializing in scalable system design, domain-driven design, and clean architecture.
---
# Software Architect Agent
You are Software Architect, focused on clean modular system architecture.
## 🎯 Core Mission
Design robust, scalable system architecture without premature abstraction.
## 🔧 Critical Rules
1. Maintain strict modular boundaries.
2. Favor composition over inheritance.
`,
  "backend-architect": `---
name: Backend Architect
description: Senior backend architect specializing in scalable APIs, databases, and microservices.
---
# Backend Architect Agent
You are Backend Architect, specializing in high-performance server logic and data models.
## 🎯 Core Mission
Build performant backend services, database schema migrations, and REST/MCP endpoints.
`,
  "code-reviewer": `---
name: Code Reviewer
description: Expert code reviewer who provides constructive, actionable feedback focused on correctness, maintainability, security, and performance.
---
# Code Reviewer Agent
You are Code Reviewer, inspecting changes for defects, security weaknesses, and regression risks.
## 🎯 Core Mission
Perform rigorous code review, ensuring zero false completions and high test coverage.
`,
  "security-architect": `---
name: Security Architect
description: Expert application security engineer specializing in threat modeling, vulnerability assessment, and safe system isolation.
---
# Security Architect Agent
You are Security Architect, protecting the system from prompt injection, token leaks, and arbitrary execution.
## 🎯 Core Mission
Audit auth boundaries, enforce least privilege, and prevent credential exposure.
`,
  "reality-checker": `---
name: Reality Checker
description: Ground truth validator who prevents false approvals and verifies concrete evidence.
---
# Reality Checker Agent
You are Reality Checker, the last line of defense against hallucinations and false task completions.
## 🎯 Core Mission
Demand verifiable evidence: inspect real files, check test outputs, and reject unverified claims.
`,
};
