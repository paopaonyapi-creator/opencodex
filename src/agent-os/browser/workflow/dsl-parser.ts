// Phase 20.12 — Workflow DSL Parser & Variable Interpolator
//
// Parses YAML/JSON workflow representations, validates step schemas,
// and interpolates template expressions (e.g. {{asset.title}}, {{keywords}}).

import type { WorkflowDefinition, WorkflowStep } from "./types";

export class WorkflowDslParser {
  /**
   * Interpolates template expressions {{key.subkey}} within strings, objects, or arrays.
   */
  public interpolate<T>(input: T, variables: Record<string, unknown>): T {
    if (typeof input === "string") {
      return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path) => {
        const val = this.resolveVariable(path, variables);
        return val !== undefined && val !== null ? String(val) : "";
      }) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.interpolate(item, variables)) as unknown as T;
    }

    if (input !== null && typeof input === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        result[key] = this.interpolate(val, variables);
      }
      return result as unknown as T;
    }

    return input;
  }

  private resolveVariable(path: string, variables: Record<string, unknown>): unknown {
    if (path in variables) {
      return variables[path];
    }

    // Support dot notation, e.g. "asset.title"
    const parts = path.split(".");
    let curr: any = variables;
    for (const part of parts) {
      if (curr && typeof curr === "object" && part in curr) {
        curr = curr[part];
      } else {
        return undefined;
      }
    }
    return curr;
  }

  /**
   * Parses JSON or structured object into a normalized WorkflowDefinition.
   */
  public parse(raw: string | Record<string, unknown>): WorkflowDefinition {
    let parsed: Record<string, unknown>;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Simple YAML / KV fallback parser
        parsed = this.parseSimpleYaml(raw);
      }
    } else {
      parsed = raw;
    }

    const id = String(parsed.id || `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const name = String(parsed.name || "Untitled Workflow");
    const description = String(parsed.description || "");
    const version = Number(parsed.version || 1);

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: WorkflowStep[] = rawSteps.map((s: any, idx: number) => {
      let action = s.action || s.tool;
      let args: Record<string, unknown> = s.arguments || s.args || {};

      // If shorthand notation like: `- browser.navigate: { url: ... }`
      if (!action) {
        const keys = Object.keys(s).filter((k) => k !== "name" && k !== "validations" && k !== "id");
        if (keys.length > 0) {
          action = keys[0];
          args = typeof s[keys[0]] === "object" && s[keys[0]] !== null ? s[keys[0]] : {};
        }
      }

      return {
        id: String(s.id || `step_${idx + 1}`),
        name: String(s.name || `Step ${idx + 1}: ${action}`),
        action: String(action || "browser.navigate"),
        arguments: args,
        validations: Array.isArray(s.validations) ? s.validations : undefined,
        recoveryStrategy: s.recoveryStrategy || "heal",
        maxRetries: typeof s.maxRetries === "number" ? s.maxRetries : 2,
        isCheckpoint: Boolean(s.isCheckpoint || s.checkpoint),
        timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : 15000,
      };
    });

    return {
      id,
      name,
      description,
      version,
      steps,
      parameters: (parsed.parameters as any) || {},
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      createdAt: Number(parsed.createdAt || Date.now()),
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  }

  private parseSimpleYaml(raw: string): Record<string, unknown> {
    const result: Record<string, unknown> = { steps: [] };
    const lines = raw.split("\n");
    let currentStep: Record<string, unknown> | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      if (line.startsWith("name:")) {
        result.name = line.replace("name:", "").trim();
      } else if (line.startsWith("description:")) {
        result.description = line.replace("description:", "").trim();
      } else if (line.startsWith("- ")) {
        if (currentStep) {
          (result.steps as any[]).push(currentStep);
        }
        currentStep = {};
        const stepContent = line.replace("- ", "").trim();
        const colonIdx = stepContent.indexOf(":");
        if (colonIdx !== -1) {
          const k = stepContent.slice(0, colonIdx).trim();
          const v = stepContent.slice(colonIdx + 1).trim();
          currentStep.action = k;
          if (v) currentStep.arguments = { value: v.replace(/^['"]|['"]$/g, "") };
        } else {
          currentStep.action = stepContent;
        }
      } else if (currentStep && line.includes(":")) {
        const colonIdx = line.indexOf(":");
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        currentStep.arguments = currentStep.arguments || {};
        (currentStep.arguments as any)[k] = v.replace(/^['"]|['"]$/g, "");
      }
    }

    if (currentStep) {
      (result.steps as any[]).push(currentStep);
    }

    return result;
  }
}

let dslParserInstance: WorkflowDslParser | null = null;
export function getWorkflowDslParser(): WorkflowDslParser {
  if (!dslParserInstance) {
    dslParserInstance = new WorkflowDslParser();
  }
  return dslParserInstance;
}
