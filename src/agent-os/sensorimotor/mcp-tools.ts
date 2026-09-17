// Phase 20.82 — Sensorimotor Runtime MCP Tools (CortexKit AFT contract).
//
// Exposes constrained perception and transactional action tools to agents
// using the shared handler convention. All mutations ride the transactional
// executor (policy → lock → checkpoint → execute → verify → observe →
// rollback-on-failure); policy enforcement stays inside the runtime, never in
// the tool layer.
//
// MCP/REST parity contract: tools and routes call the SAME service methods,
// so authorization semantics, policy decisions, approval gating, idempotency,
// audit events, session/action ids, and error codes are identical by
// construction. Handlers normalize SensorimotorError into
// { ok: false, error: { code, message }, status } — the same code and message
// the REST surface returns.

import type { SensorimotorService } from "./service";
import type { ActionKind } from "./types";
import { SensorimotorError } from "./types";

export interface SensorimotorMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function normalizeArgs(args: Record<string, unknown>) {
  return {
    sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
    kind: typeof args.kind === "string" ? args.kind : "",
    target: typeof args.target === "string" ? args.target : "",
    content: typeof args.content === "string" ? args.content : undefined,
    destination: typeof args.destination === "string" ? args.destination : undefined,
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    maxAttempts: typeof args.maxAttempts === "number" ? Math.min(args.maxAttempts, 5) : undefined,
    idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey.slice(0, 128) : undefined,
  };
}

async function runAction(service: SensorimotorService, kind: ActionKind, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const normalized = normalizeArgs(args);
  try {
    const outcome = await service.executeAction({
      sessionId: normalized.sessionId || undefined,
      workspaceRoot: typeof args.workspaceRoot === "string" && args.workspaceRoot ? args.workspaceRoot : undefined,
      actorId: typeof args.actorId === "string" && args.actorId ? args.actorId.slice(0, 64) : undefined,
      kind,
      target: normalized.target,
      content: normalized.content,
      destination: normalized.destination,
      timeoutMs: normalized.timeoutMs,
      maxAttempts: normalized.maxAttempts,
      idempotencyKey: normalized.idempotencyKey,
    });
    return { ok: outcome.status === "succeeded", ...outcome };
  } catch (err) {
    if (err instanceof SensorimotorError) {
      return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
    }
    throw err;
  }
}

export function createSensorimotorMcpTools(service: SensorimotorService): SensorimotorMcpTool[] {
  return [
    {
      name: "pao.aft.health",
      description: "Inspect sensorimotor runtime liveness: policy version, active sessions, 24h action/failure counters (Phase 20.82).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ...service.health(), ok: true }),
    },
    {
      name: "pao.aft.readiness",
      description:
        "Component readiness matrix for the AFT runtime: sensorimotor runtime, workspace, policy engine, checkpoint store, audit trail, " +
        "OmniRoute daemon, and TypeSafe Jev. Optional external dependencies report degraded — never crash or fail the whole runtime.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ...(await service.readiness()) }),
    },
    {
      name: "pao.aft.perceive",
      description: "Take a deterministic workspace snapshot (tree or symbol-aware) for a session. Read-only; never throws on unreadable paths.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          kind: { type: "string", enum: ["tree", "symbols"] },
          maxFiles: { type: "number", description: "Max files to snapshot (default 500, cap 2000)" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        try {
          const sessionId = String(args.sessionId);
          const kind = args.kind === "symbols" ? "symbols" : "tree";
          const maxFiles = typeof args.maxFiles === "number" ? args.maxFiles : undefined;
          const perception = service.perceive(sessionId, kind, maxFiles);
          return {
            ok: true,
            perceptionId: perception.perceptionId,
            sessionId: perception.sessionId,
            kind: perception.kind,
            fileCount: perception.fileCount,
            symbolCount: perception.symbolCount,
            contentHash: perception.contentHash,
          };
        } catch (err) {
          if (err instanceof SensorimotorError) {
            return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
          }
          throw err;
        }
      },
    },
    {
      name: "pao.aft.act",
      description:
        "Execute a transactional workspace action (fs.write, fs.delete, fs.move) with policy gate, workspace lock, checkpoint, " +
        "post-action verification, health observation, and rollback on failure. Paths are sandbox-checked against the session workspace. " +
        "Pass idempotencyKey to make retries safe: a key with a terminal outcome replays it instead of re-executing.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          kind: { type: "string", enum: ["fs.write", "fs.delete", "fs.move"] },
          target: { type: "string", description: "Relative path inside the session workspace" },
          content: { type: "string", description: "New file content for fs.write" },
          destination: { type: "string", description: "Relative destination for fs.move" },
          timeoutMs: { type: "number" },
          maxAttempts: { type: "number", description: "Bounded retry attempts (default 3, cap 5)" },
          idempotencyKey: { type: "string", description: "Optional idempotency key (≤128 chars); duplicate calls replay the terminal outcome" },
        },
        required: ["sessionId", "kind", "target"],
      },
      handler: async (args) => runAction(service, String(args.kind) as ActionKind, args),
    },
    {
      name: "pao.aft.shell",
      description:
        "Execute a sandbox-checked shell command within a session workspace. Nested shells, command chaining, and code-carrying " +
        "interpreter flags are blocked; the command runs via the sanctioned runner with timeout and bounded retry.",
      riskTier: "R3",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          target: { type: "string", description: "Command binary (e.g. 'bun', 'node', 'git')" },
          content: { type: "string", description: "Command arguments as a single string" },
          timeoutMs: { type: "number", description: "Timeout in ms (default 30000)" },
          maxAttempts: { type: "number", description: "Bounded retry attempts (default 3, cap 5)" },
          idempotencyKey: { type: "string", description: "Optional idempotency key (≤128 chars)" },
        },
        required: ["sessionId", "target"],
      },
      handler: async (args) => runAction(service, "shell.exec", args),
    },
    {
      name: "pao.aft.git",
      description:
        "Execute a git subcommand within a session workspace. Destructive operations (push, clean, reset --hard, forced checkout/restore, " +
        "branch deletion, destructive rebase, stash drop/clear, worktree remove, repository-redirecting flags) are blocked by policy; " +
        "inspection commands (status/log/diff/show) pass through the normal policy gate without extra approval.",
      riskTier: "R3",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Sensorimotor session id" },
          subcommand: { type: "string", description: "Git subcommand and arguments (e.g. 'add -A', 'commit -m msg', 'status')" },
          timeoutMs: { type: "number", description: "Timeout in ms (default 30000)" },
          idempotencyKey: { type: "string", description: "Optional idempotency key (≤128 chars)" },
        },
        required: ["sessionId", "subcommand"],
      },
      handler: async (args) => {
        // git.mutate pins the binary to git; subcommand + args ride `content`.
        return runAction(service, "git.mutate", {
          ...args,
          target: "git",
          content: typeof args.subcommand === "string" ? args.subcommand : undefined,
          maxAttempts: 1, // git commands never retry
        });
      },
    },
    {
      name: "pao.aft.session.create",
      description: "Create a new sensorimotor session for transactional workspace operations.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Absolute path to workspace root" },
          actorId: { type: "string", description: "Actor identifier (agent/user id)" },
          goal: { type: "string", description: "Optional session goal description" },
        },
        required: ["workspaceRoot", "actorId"],
      },
      handler: async (args) => {
        try {
          const session = service.createSession({
            workspaceRoot: String(args.workspaceRoot),
            actorId: String(args.actorId).slice(0, 64),
            goal: typeof args.goal === "string" ? args.goal.slice(0, 512) : undefined,
          });
          return { ok: true, session };
        } catch (err) {
          if (err instanceof SensorimotorError) {
            return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
          }
          throw err;
        }
      },
    },
    {
      name: "pao.aft.session.close",
      description: "Close or abort a sensorimotor session.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session id to close" },
          status: { type: "string", enum: ["closed", "aborted"], description: "Session close status (default: closed)" },
        },
        required: ["sessionId"],
      },
      handler: async (args) => {
        try {
          const status = args.status === "aborted" ? "aborted" : "closed";
          const session = service.closeSession(String(args.sessionId), status as "closed" | "aborted");
          return { ok: true, session };
        } catch (err) {
          if (err instanceof SensorimotorError) {
            return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
          }
          throw err;
        }
      },
    },
  ];
}
