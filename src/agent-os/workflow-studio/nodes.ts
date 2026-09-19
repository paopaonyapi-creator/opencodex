// Phase 20.93 — Built-in node executors (local-first core set).
//
// Executors are PURE with respect to storage: they compute outputs; the
// durable runtime owns every filesystem write, artifact registration and
// lineage row. AI/MCP/HTTP nodes delegate to the existing gateways (20.85
// model gateway, 20.74 MCP gateway) and fail with structured codes when no
// provider is configured.

import { randomUUID } from "node:crypto";
import { WorkflowStudioError, type NodeExecutionContext } from "./types";

function newRequestId(runId: string, nodeId: string, attempt: number): string {
  const nonce = randomUUID().slice(0, 8);
  return `wfs-${runId}-${nodeId}-${attempt}-${nonce}`;
}

/** Read a dot path from a JSON value ("a.b.0" style). */
export function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".").filter(Boolean)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = current.at(Number(key));
      continue;
    }
    if (typeof current === "object") {
      const entry = Object.entries(current).find(([k]) => k === key);
      current = entry === undefined ? undefined : entry[1];
      continue;
    }
    return undefined;
  }
  return current;
}

/** Clone a JSON object and write one dot path (functional style). */
export function writePath(value: unknown, path: string, next: unknown): Record<string, unknown> {
  const keys = path.split(".").filter(Boolean);
  if (keys.length === 0) return (value ?? {}) as Record<string, unknown>;
  const head = keys[0] as string;
  const base = typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).filter(([k]) => k !== head)
    : [];
  if (keys.length === 1) {
    return Object.fromEntries([...base, [head, next]]);
  }
  const rest = path.slice(head.length + 1);
  const existingChild = base.filter(([k]) => k === head).map((entry) => entry[1])[0];
  const updatedChild = writePath(existingChild, rest, next);
  return Object.fromEntries([...base, [head, updatedChild]]);
}

const jsonInput = async (ctx: NodeExecutionContext) => ({ output: ctx.config.data ?? {} });

const jsonTransform = async (ctx: NodeExecutionContext) => {
  const input = ctx.inputs.input ?? {};
  const ops = Array.isArray(ctx.config.operations) ? ctx.config.operations as Array<Record<string, unknown>> : [];
  let current: unknown = input;
  for (const op of ops) {
    const kind = String(op.op ?? "");
    const path = String(op.path ?? "");
    if (kind === "pick") {
      current = readPath(current, path);
    } else if (kind === "set") {
      current = writePath(current, path, op.value ?? ctx.inputs.input);
    } else if (kind === "stringify") {
      current = JSON.stringify(current, null, 2);
    } else if (kind === "uppercase") {
      current = String(current).toUpperCase();
    } else {
      throw new WorkflowStudioError("NODE_FAILED", 422, `unknown transform op '${kind}'`, { nodeId: ctx.nodeId });
    }
  }
  return { output: current };
};

const validateFields = async (ctx: NodeExecutionContext) => {
  const value = ctx.inputs.input;
  const requireFields = Array.isArray(ctx.config.requireFields) ? ctx.config.requireFields as string[] : [];
  const missing = requireFields.filter((field) => {
    const found = readPath(value, field);
    return found === undefined || found === null || found === "";
  });
  if (missing.length > 0) {
    throw new WorkflowStudioError("NODE_FAILED", 422, `validation failed — missing fields: ${missing.join(", ")}`, { nodeId: ctx.nodeId });
  }
  return { output: value, valid: true };
};

const runCondition = async (ctx: NodeExecutionContext) => {
  const value = ctx.inputs.input;
  const operator = String(ctx.config.operator ?? "truthy");
  const compare = ctx.config.value;
  let result = false;
  if (operator === "truthy") result = Boolean(value);
  else if (operator === "equals") result = value === compare;
  else if (operator === "contains") result = String(value).includes(String(compare));
  else if (operator === "gt") result = Number(value) > Number(compare);
  else if (operator === "exists") result = value !== undefined && value !== null;
  else throw new WorkflowStudioError("NODE_FAILED", 422, `unknown condition operator '${operator}'`, { nodeId: ctx.nodeId });
  return result ? { true: value } : { false: value };
};

const runDelay = async (ctx: NodeExecutionContext) => {
  const ms = Math.min(60_000, Math.max(0, Number(ctx.config.ms ?? 0)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new WorkflowStudioError("NODE_FAILED", 499, "delay cancelled"));
    }, { once: true });
  });
  return { output: ctx.inputs.input };
};

const writeMemory = async (ctx: NodeExecutionContext) => {
  const key = String(ctx.config.key ?? "");
  if (!key) throw new WorkflowStudioError("NODE_FAILED", 422, "memory write requires a key", { nodeId: ctx.nodeId });
  ctx.memory.set(key, ctx.inputs.value ?? ctx.inputs.input ?? null);
  return { output: { key, stored: true } };
};

const readMemory = async (ctx: NodeExecutionContext) => {
  const key = String(ctx.config.key ?? "");
  const value = ctx.memory.has(key) ? ctx.memory.get(key) : (ctx.config.fallback ?? null);
  return { output: value };
};

/**
 * Save Artifact executor — PURE: returns the artifact payload; the durable
 * runtime performs the sandbox-guarded filesystem write, SHA-256 and lineage
 * registration.
 */
const prepareArtifact = async (ctx: NodeExecutionContext) => {
  const content = ctx.inputs.input;
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  const name = String(ctx.config.name ?? ctx.nodeId).replace(/[^\w.-]/g, "_");
  return { artifactName: name, content: text, sizeBytes: Buffer.byteLength(text) };
};

const emitNotify = async (ctx: NodeExecutionContext) => {
  return { output: { message: String(ctx.config.message ?? "workflow notification"), at: new Date().toISOString() } };
};

const resolveApproval = async (ctx: NodeExecutionContext) => {
  // The runtime intercepts approval nodes BEFORE execution and pauses the run;
  // reaching the executor means an approval decision arrived.
  const approved = ctx.memory.get(`__approval_${ctx.nodeId}`) === "APPROVED";
  return approved ? { approved: ctx.inputs.input } : { rejected: ctx.inputs.input };
};

export const EXECUTORS: Record<string, (ctx: NodeExecutionContext) => Promise<Record<string, unknown>>> = {
  jsonInput, jsonTransform, validateFields, runCondition, runDelay,
  writeMemory, readMemory, prepareArtifact, emitNotify, resolveApproval,
};

// Named bindings — the registry references these directly (no string dispatch).
export const localJsonInput = jsonInput;
export const localJsonTransform = jsonTransform;
export const localValidateFields = validateFields;
export const localRunCondition = runCondition;
export const localRunDelay = runDelay;
export const localWriteMemory = writeMemory;
export const localReadMemory = readMemory;
export const localPrepareArtifact = prepareArtifact;
export const localEmitNotify = emitNotify;
export const localResolveApproval = resolveApproval;

// ---------------------------------------------------------------------------
// Remote-plane executors — thin, typed invocations of the existing gateways.
// Bound method aliases keep these call sites symmetric with the Phase 20.89
// gateway registration pattern.
// ---------------------------------------------------------------------------

const callModel = async (ctx: NodeExecutionContext) => {
  const gatewayModule = await import("../model-gateway/gateway");
  const gateway = gatewayModule.getModelGateway();
  const invoke = gateway.execute.bind(gateway);
  const prompt = String(ctx.config.prompt ?? ctx.inputs.input ?? "");
  try {
    const response = (await invoke({
      requestId: newRequestId(ctx.runId, ctx.nodeId, ctx.attempt),
      actorId: ctx.actor,
      taskType: "chat",
      prompt,
      capabilityRequirements: [],
      policy: { routeGroup: "default" },
    })) as unknown as Record<string, unknown>;
    const text = typeof response.output === "string" ? response.output : JSON.stringify(response.output ?? response);
    return { output: text, provider: String(response.provider ?? "gateway"), model: String(response.model ?? "auto") };
  } catch (err) {
    throw new WorkflowStudioError("PROVIDER_UNAVAILABLE", 503, `agent node could not reach a model provider: ${err instanceof Error ? err.message : String(err)}`, { nodeId: ctx.nodeId });
  }
};

const callMcpTool = async (ctx: NodeExecutionContext) => {
  const gatewayModule = await import("../mcp-gateway/gateway");
  const gateway = gatewayModule.getMcpToolGateway();
  const invoke = gateway.execute.bind(gateway);
  const toolName = String(ctx.config.tool ?? "");
  if (!toolName) throw new WorkflowStudioError("NODE_FAILED", 422, "mcp tool node requires config.tool", { nodeId: ctx.nodeId });
  const raw = (await invoke({
    requestId: newRequestId(ctx.runId, ctx.nodeId, ctx.attempt),
    toolName,
    actorId: ctx.actor,
    workspacePath: ctx.studioRoot,
    arguments: (ctx.config.arguments ?? {}) as Record<string, unknown>,
    humanApproved: ctx.config.approved === true,
  })) as unknown as { status?: string; output?: unknown; error?: string };
  if ((raw.status ?? "failed") !== "success") {
    throw new WorkflowStudioError("CAPABILITY_UNAVAILABLE", 422, `mcp tool '${toolName}' did not succeed: ${raw.error ?? "no output"}`, { nodeId: ctx.nodeId });
  }
  return { output: raw.output ?? null };
};

const callHttp = async (ctx: NodeExecutionContext) => {
  const rawUrl = String(ctx.config.url ?? "");
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new WorkflowStudioError("NODE_FAILED", 422, "http node has an invalid url", { nodeId: ctx.nodeId });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new WorkflowStudioError("NODE_FAILED", 422, "http node allows only http/https", { nodeId: ctx.nodeId });
  }
  // SSRF guard: loopback/private targets require the explicit dev override.
  const host = target.hostname;
  const privateHost = host === "localhost" || host === "0.0.0.0" || host === "::1"
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost && process.env.PAO_WORKFLOW_ALLOW_PRIVATE_HTTP !== "true") {
    throw new WorkflowStudioError("NODE_FAILED", 422, "http node refused a private/loopback host (SSRF guard)", { nodeId: ctx.nodeId, host });
  }
  const method = String(ctx.config.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(30_000, Number(ctx.config.timeoutMs ?? 10_000)));
  ctx.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(target.href, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(ctx.inputs.input ?? {}),
      signal: controller.signal,
    });
    const body = await res.text();
    return { output: { status: res.status, body: body.slice(0, 10_000) }, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
};

export const REMOTE_EXECUTORS: Record<string, (ctx: NodeExecutionContext) => Promise<Record<string, unknown>>> = {
  callModel, callMcpTool, callHttp,
};

// Named bindings for the remote plane (registry references these directly).
export const remoteCallModel = callModel;
export const remoteCallMcpTool = callMcpTool;
export const remoteCallHttp = callHttp;
