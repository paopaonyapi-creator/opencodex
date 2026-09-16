// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Structured Output Validator & Parser

import { z } from "zod";

export interface StructuredOutputResult<T = unknown> {
  success: boolean;
  data?: T;
  rawJson?: string;
  error?: string;
}

export class StructuredOutputValidator {
  parseJsonFromText(text: string): { found: boolean; jsonString?: string; parsed?: unknown } {
    if (!text || typeof text !== "string") return { found: false };

    // 1. Try direct parse
    try {
      const parsed = JSON.parse(text);
      return { found: true, jsonString: text, parsed };
    } catch {
      // 2. Try markdown fenced code block
      const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
      const match = text.match(jsonBlockRegex);
      if (match && match[1]) {
        try {
          const innerParsed = JSON.parse(match[1]);
          return { found: true, jsonString: match[1], parsed: innerParsed };
        } catch {
          // Continue to next heuristic
        }
      }

      // 3. Try finding outermost { ... } or [ ... ]
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = text.slice(firstBrace, lastBrace + 1);
        try {
          const candidateParsed = JSON.parse(candidate);
          return { found: true, jsonString: candidate, parsed: candidateParsed };
        } catch {
          // Ignore
        }
      }
    }

    return { found: false };
  }

  validateWithZod<T>(schema: z.ZodType<T>, input: unknown): StructuredOutputResult<T> {
    const result = schema.safeParse(input);
    if (result.success) {
      return {
        success: true,
        data: result.data,
        rawJson: JSON.stringify(result.data),
      };
    }

    const issues = result.error?.issues ?? (result.error as { errors?: Array<{ path: (string | number)[]; message: string }> })?.errors ?? [];
    const message = issues.length > 0
      ? issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
      : result.error?.message || "Schema validation failed";

    return {
      success: false,
      error: message,
    };
  }
}
