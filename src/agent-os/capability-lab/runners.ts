/**
 * First-party trusted runners for seed/demo capabilities.
 * Imported GitHub Python is never used as the host implementation.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RunnerContext {
  readonly workspace: string;
  readonly runId: string;
}

export interface RunnerResult {
  readonly output: Record<string, unknown>;
  readonly artifacts: Array<{ name: string; path: string; mimeType: string }>;
}

export type CapabilityRunner = (input: Record<string, unknown>, ctx: RunnerContext) => RunnerResult;

function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export const FIRST_PARTY_RUNNERS: Readonly<Record<string, CapabilityRunner>> = {
  "utility.checksum": (input, ctx) => {
    const value = String(input.text ?? input.content ?? "");
    const digest = sha256(value);
    mkdirSync(ctx.workspace, { recursive: true });
    const path = join(ctx.workspace, "checksum.txt");
    writeFileSync(path, digest, "utf-8");
    return { output: { algorithm: "sha256", digest, bytes: value.length }, artifacts: [{ name: "checksum.txt", path, mimeType: "text/plain" }] };
  },
  "text.normalize": (input) => {
    const value = String(input.text ?? "");
    const normalized = value.replace(/\s+/g, " ").trim();
    return { output: { text: normalized, length: normalized.length }, artifacts: [] };
  },
  "json.transform": (input) => {
    const raw = input.value;
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const keys = Object.keys(obj).sort();
    const picked: Record<string, unknown> = {};
    for (const key of keys) picked[key] = obj[key];
    return { output: { value: picked, keys }, artifacts: [] };
  },
};

export function trustedRunnerForRecipe(filePath: string, analysisSummary: string): string | null {
  const base = filePath.toLowerCase();
  if (base.includes("checksum") || base.includes("hash")) return "utility.checksum";
  if (base.includes("normalize") || /text/.test(base) && /trim|white/.test(analysisSummary.toLowerCase())) return "text.normalize";
  if (base.includes("json")) return "json.transform";
  return null;
}

