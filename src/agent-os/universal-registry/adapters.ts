// Phase 20.25 — Tool adapters (doc §26, §54).
//
// The universal runtime only executes tools through these adapters. There is
// deliberately no shell/code executor here: shell.execute and code.execute
// tools stay non-executable in this runtime (they belong to the sandbox and
// orchestration runtimes, which have their own approval flows), and the
// permission engine still gates their PLANNED use.

import { readFile } from "node:fs/promises";
import type { ExecutionContext, ToolAdapter, ToolErrorCode, ToolExecutionResult, ToolRecord } from "./types";
import { validateAndNormalizeUrl, parseAllowlist } from "./url-safety";
import { summarizePayload } from "./util";

const URL_ALLOWLIST = parseAllowlist(process.env.REGISTRY_URL_ALLOWLIST);

function fail(code: ToolErrorCode, message: string, startedAt: number): ToolExecutionResult {
  return { ok: false, outputSummary: message, errorCode: code, latencyMs: Date.now() - startedAt };
}

/** GET-only HTTP adapter with SSRF protection (doc §62). */
export const HttpGetAdapter: ToolAdapter = {
  key: "http_get",
  supports: (tool) => tool.runtime.protocol === "https" || tool.runtime.protocol === "http",
  validate(_tool, input) {
    if (typeof input.url !== "string" || input.url.length === 0) return "INVALID_INPUT";
    const policy = validateAndNormalizeUrl(input.url, URL_ALLOWLIST);
    return policy.valid ? null : "SSRF_BLOCK";
  },
  async run(tool, input) {
    const started = Date.now();
    if (!tool.executable) {
      return fail("TOOL_UNAVAILABLE", `tool ${tool.id} is not executable through the universal runtime`, started);
    }
    const policy = validateAndNormalizeUrl(String(input.url ?? ""), URL_ALLOWLIST);
    if (!policy.valid) {
      return fail("SSRF_BLOCK", policy.reason ?? "blocked URL", started);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(policy.normalizedUrl, {
        method: "GET",
        headers: { "User-Agent": "Pao-hubPro-UniversalRegistry/1.0" },
        signal: controller.signal,
      });
      const body = await response.text();
      if (response.status === 429) return fail("RATE_LIMIT", "HTTP 429 from target host", started);
      if (response.status >= 500) return fail("PROVIDER_ERROR", `HTTP ${response.status} from target host`, started);
      if (response.status === 401 || response.status === 403) return fail("AUTH_ERROR", `HTTP ${response.status}: auth missing or invalid for ${tool.id}`, started);
      if (!response.ok) return fail("PROVIDER_ERROR", `HTTP ${response.status}`, started);
      return {
        ok: true,
        outputSummary: summarizePayload(body),
        data: { status: response.status, bytes: body.length },
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return fail("TIMEOUT", "request exceeded 10s timeout", started);
      return fail("PROVIDER_ERROR", error instanceof Error ? error.message : String(error), started);
    } finally {
      clearTimeout(timeout);
    }
  },
};

/** Read-only filesystem adapter, workspace-contained (doc §64). */
export const LocalFileReadAdapter: ToolAdapter = {
  key: "local_file_read",
  supports: (tool) => tool.capabilities.includes("filesystem.read"),
  validate(_tool, input) {
    return typeof input.path === "string" && input.path.length > 0 ? null : "INVALID_INPUT";
  },
  async run(tool, input, ctx) {
    const started = Date.now();
    if (!tool.executable) {
      return fail("TOOL_UNAVAILABLE", `tool ${tool.id} is not executable through the universal runtime`, started);
    }
    const path = String(input.path ?? "");
    const { resolve, isAbsolute } = await import("node:path");
    const normalized = isAbsolute(path) ? resolve(path) : resolve(ctx.workspaceRoot, path);
    const root = resolve(ctx.workspaceRoot).toLowerCase();
    if (!normalized.toLowerCase().startsWith(root)) {
      return fail("POLICY_BLOCK", `path escapes workspace root ${ctx.workspaceRoot}`, started);
    }
    try {
      const content = await readFile(normalized, "utf8");
      return {
        ok: true,
        outputSummary: summarizePayload(content),
        data: { path: normalized, bytes: content.length },
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: ToolErrorCode = message.includes("ENOENT") ? "INVALID_INPUT" : "PROVIDER_ERROR";
      return fail(code, message, started);
    }
  },
};

/**
 * Model adapter. This MVP records a deterministic routing receipt with unknown
 * cost rather than invoking a live model or inventing token prices (doc §38).
 */
export const ModelRouterAdapter: ToolAdapter = {
  key: "model_router",
  supports: (tool) => tool.id === "model:orchestration-router",
  validate(_tool, input) {
    return typeof input.prompt === "string" && input.prompt.length > 0 ? null : "INVALID_INPUT";
  },
  async run(tool, input) {
    const started = Date.now();
    const prompt = String(input.prompt ?? "");
    return {
      ok: true,
      outputSummary: summarizePayload(`model:${tool.id} accepted prompt (${prompt.length} chars); routed via orchestration model router`),
      data: { routed: true, estimatedCost: "unknown" },
      latencyMs: Date.now() - started,
    };
  },
};

export const DEFAULT_ADAPTERS: ToolAdapter[] = [HttpGetAdapter, LocalFileReadAdapter, ModelRouterAdapter];

/**
 * Adapter selection prefers the tool's declared executor key (ingestion sets
 * it for MCP built-ins), then falls back to protocol/capability heuristics.
 */
export function adapterFor(tool: ToolRecord, adapters: ToolAdapter[] = DEFAULT_ADAPTERS): ToolAdapter | null {
  if (tool.runtime.executor) {
    const declared = adapters.find((adapter) => adapter.key === tool.runtime.executor);
    if (declared) return declared;
  }
  return adapters.find((adapter) => adapter.supports(tool)) ?? null;
}

export type { ExecutionContext };
