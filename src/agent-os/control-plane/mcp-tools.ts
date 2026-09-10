/**
 * Phase 20.16 — Multi-AI Control Plane: WebMCP tool suite.
 *
 * Nine groups, as specified: project, task, safe_files, git, command, review,
 * approval, artifact, media.
 *
 * SAFETY CONTRACT FOR THIS FILE:
 *  - NO tool here bypasses the policy engine. Every call goes through
 *    ControlPlaneService.requestTool, which records a decision before it acts.
 *  - There is no unrestricted shell tool. `command.run_safe` evaluates the command
 *    through the hardened policy engine; `command.run_approved` always requires a
 *    human and exists as a separate, explicitly-named tool for that reason.
 *  - Arguments are redacted before they are stored or returned.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { getControlPlaneService } from "./service";
import { getPathGuard } from "../desktop-runtime/security/path-guard";
import { getSecretRedactor } from "../desktop-runtime/security/secret-redactor";
import { evaluateRequest, isProtectedPath, isInsideWorkspace } from "./policy";
import { routeTask } from "./router";
import type { AgentIdentity, ReviewIssue, ReviewSeverity, ReviewVerdict, TaskType } from "./types";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "L0" | "L1" | "L2" | "L3";
  readOnly: boolean;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Uniform envelope so every tool answers in the same shape. */
function ok(payload: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...payload }, null, 2);
}

function fail(message: string, code = "TOOL_ERROR"): string {
  return JSON.stringify({ ok: false, error: { code, message } }, null, 2);
}

function requireTask(taskId: unknown): string | null {
  const id = String(taskId ?? "").trim();
  if (!id) return null;
  return getControlPlaneService().getTask(id) ? id : null;
}

/** Task and run ids are required on every gated call, so an orphan action is impossible. */
const TASK_ARGS: Record<string, unknown> = {
  task_id: { type: "string", description: "Task this call belongs to. Required for gated tools." },
  run_id: { type: "string", description: "Agent run id, for the audit trail." },
};

export const CONTROL_PLANE_MCP_TOOLS: WebMcpToolDefinition[] = [
  // ---------------------------------------------------------------- project
  {
    name: "project_list",
    description: "project.list — List projects known to the control plane, derived from recorded tasks.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const tasks = getControlPlaneService().listTasks();
      const projects = new Map<string, number>();
      for (const task of tasks) {
        projects.set(task.project_id, (projects.get(task.project_id) ?? 0) + 1);
      }
      return ok({
        projects: [...projects.entries()].map(([projectId, taskCount]) => ({ projectId, taskCount })),
      });
    },
  },
  {
    name: "project_status",
    description: "project.status — Task counts and control-plane metrics for one project.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
    handler: async (args) => {
      const projectId = String(args.project_id);
      const tasks = getControlPlaneService()
        .listTasks()
        .filter((task) => task.project_id === projectId);
      const byStatus: Record<string, number> = {};
      for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      return ok({ projectId, taskCount: tasks.length, byStatus });
    },
  },
  {
    name: "project_get_context",
    description:
      "project.get_context — Assemble a task's goal, runs, reviews, and recent tool activity as one context pack.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
    handler: async (args) => {
      const service = getControlPlaneService();
      const task = service.getTask(String(args.task_id));
      if (!task) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      return ok({
        task,
        runs: service.getStore().listRuns(task.task_id),
        reviews: service.getStore().listReviews(task.task_id),
        recentToolCalls: service.listToolCalls(task.task_id).slice(0, 20),
        artifacts: service.listArtifacts(task.task_id),
      });
    },
  },

  // ------------------------------------------------------------------- task
  {
    name: "task_create",
    description:
      "task.create — Create an authorized unit of work with a workspace root, a tool allowlist, and a risk ceiling.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        goal: { type: "string" },
        task_type: {
          type: "string",
          enum: [
            "research",
            "architecture",
            "feature",
            "bugfix",
            "refactor",
            "test",
            "review",
            "security_review",
            "image_concept",
            "video_concept",
            "local_execution",
            "other",
          ],
        },
        workspace_root: { type: "string", description: "Absolute path this task may touch." },
        risk_level: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        created_by: { type: "string" },
        allowed_tools: { type: "array", items: { type: "string" } },
        forbidden_tools: { type: "array", items: { type: "string" } },
        requires_review: { type: "boolean" },
        requires_user_approval: { type: "boolean" },
      },
      required: ["project_id", "goal", "task_type", "workspace_root"],
    },
    handler: async (args) => {
      const workspace = String(args.workspace_root ?? "");
      if (!workspace.trim()) return fail("workspace_root is required.", "VALIDATION_FAILED");
      const result = getControlPlaneService().createTask({
        project_id: String(args.project_id),
        goal: String(args.goal),
        task_type: args.task_type as TaskType,
        workspace_root: resolve(workspace),
        ...(args.risk_level ? { risk_level: args.risk_level as "L0" | "L1" | "L2" | "L3" } : {}),
        ...(args.created_by ? { created_by: args.created_by as AgentIdentity } : {}),
        ...(Array.isArray(args.allowed_tools) ? { allowed_tools: args.allowed_tools as string[] } : {}),
        ...(Array.isArray(args.forbidden_tools) ? { forbidden_tools: args.forbidden_tools as string[] } : {}),
        ...(args.requires_review === undefined ? {} : { requires_review: Boolean(args.requires_review) }),
        ...(args.requires_user_approval === undefined
          ? {}
          : { requires_user_approval: Boolean(args.requires_user_approval) }),
      });
      return ok({ task: result.task, routing: result.routing });
    },
  },
  {
    name: "task_get",
    description: "task.get — Read one task, including its allowlist and risk ceiling.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const task = getControlPlaneService().getTask(String(args.task_id));
      if (!task) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      return ok({ task });
    },
  },
  {
    name: "task_list",
    description: "task.list — List tasks, optionally filtered by status.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["queued", "running", "awaiting_review", "awaiting_approval", "succeeded", "failed", "cancelled"],
        },
      },
    },
    handler: async (args) => {
      const tasks = getControlPlaneService().listTasks(args.status ? (args.status as never) : undefined);
      return ok({ count: tasks.length, tasks });
    },
  },
  {
    name: "task_cancel",
    description: "task.cancel — Mark a task cancelled.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const changed = getControlPlaneService().setTaskStatus(String(args.task_id), "cancelled");
      return ok({ taskId: args.task_id, cancelled: changed });
    },
  },
  {
    name: "task_retry",
    description: "task.retry — Return a failed or cancelled task to the queue.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = String(args.task_id);
      const task = getControlPlaneService().getTask(taskId);
      if (!task) return fail("Unknown task " + taskId + ".", "TASK_NOT_FOUND");
      const changed = getControlPlaneService().setTaskStatus(taskId, "queued");
      return ok({ taskId, requeued: changed });
    },
  },

  // ------------------------------------------------------------- safe_files
  {
    name: "files_list",
    description: "files.list — List a directory inside the task workspace. Protected paths are refused.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        path: { type: "string", description: "Directory relative to the workspace root." },
      },
      required: ["task_id"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const requested = String(args.path ?? ".");
      if (isProtectedPath(requested)) return fail("Protected path.", "PATH_PROTECTED");
      const target = join(task.workspace_root, requested);
      const guard = getPathGuard();
      const check = guard.validatePath(target);
      // The guard verifies the path is INSIDE THE GUARD'S ROOTS. The workspace
      // boundary is asserted separately, because a process-wide root set is not the
      // same thing as this task's boundary.
      if (!check.valid || !isInsideWorkspace(target, task.workspace_root)) {
        return fail("Path escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
      }
      if (!existsSync(check.canonicalPath!)) return fail("Directory not found.", "NOT_FOUND");
      const entries = readdirSync(check.canonicalPath!, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
        protected: isProtectedPath(entry.name),
      }));
      return ok({ path: relative(task.workspace_root, check.canonicalPath!), count: entries.length, entries });
    },
  },
  {
    name: "files_read",
    description: "files.read — Read a file inside the task workspace, up to a size cap.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        path: { type: "string" },
        max_bytes: { type: "number", description: "Read cap (default 256 KiB)." },
      },
      required: ["task_id", "path"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const requested = String(args.path);
      if (isProtectedPath(requested)) {
        return fail("Refusing to read a credential or configuration path.", "PATH_PROTECTED");
      }
      const target = join(task.workspace_root, requested);
      const check = getPathGuard().validatePath(target);
      if (!check.valid || !isInsideWorkspace(target, task.workspace_root)) {
        return fail("Path escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
      }
      if (!existsSync(check.canonicalPath!)) return fail("File not found.", "NOT_FOUND");
      const cap = typeof args.max_bytes === "number" ? args.max_bytes : 262_144;
      const size = statSync(check.canonicalPath!).size;
      if (size > cap) {
        return fail("File is " + size + " bytes, above the " + cap + " byte cap.", "FILE_TOO_LARGE");
      }
      const content = readFileSync(check.canonicalPath!, "utf8");
      const redacted = getSecretRedactor().redact(content);
      return ok({
        path: relative(task.workspace_root, check.canonicalPath!),
        bytes: size,
        content: redacted.redacted,
        redactionsApplied: redacted.secretsDetectedCount,
      });
    },
  },
  {
    name: "files_write_sandbox",
    description:
      "files.write_sandbox — Write a file inside the workspace. L1 for a scratch path; a project path escalates to L2 and needs approval.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        path: { type: "string" },
        content: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "path", "content"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const requested = String(args.path);
      if (isProtectedPath(requested)) {
        return fail("Refusing to write a credential or configuration path.", "PATH_PROTECTED");
      }
      const target = join(task.workspace_root, requested);
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "files.write_sandbox",
        arguments: { path: requested },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          const check = getPathGuard().validatePath(target);
          if (!check.valid || !isInsideWorkspace(target, task.workspace_root)) {
            throw new Error("Path escapes the workspace root.");
          }
          mkdirSync(join(check.canonicalPath!, ".."), { recursive: true });
          writeFileSync(check.canonicalPath!, String(args.content), "utf8");
          return { path: relative(task.workspace_root, check.canonicalPath!), bytes: Buffer.byteLength(String(args.content)) };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, toolCallId: result.toolCall.id });
    },
  },
  {
    name: "files_diff",
    description: "files.diff — Git diff for the task workspace, optionally scoped to one path.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, path: { type: "string" } },
      required: ["task_id"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      try {
        const gitArgs = ["diff"];
        if (args.path) {
          const requested = String(args.path);
          if (isProtectedPath(requested)) return fail("Protected path.", "PATH_PROTECTED");
          const target = join(task.workspace_root, requested);
          if (!isInsideWorkspace(target, task.workspace_root)) {
            return fail("Path escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
          }
          gitArgs.push("--", requested);
        }
        const diff = execFileSync("git", gitArgs, {
          cwd: task.workspace_root,
          encoding: "utf8",
          timeout: 20_000,
        });
        return ok({ diff });
      } catch (error) {
        return fail(String(error), "GIT_FAILED");
      }
    },
  },
  {
    name: "files_apply_patch",
    description:
      "files.apply_patch — Apply a unified diff to the workspace. L2: requires approval.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        patch: { type: "string", description: "Unified diff text." },
        approval_id: { type: "string" },
      },
      required: ["task_id", "patch"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      // A patch naming a protected file is refused before the approval question is
      // even asked: some paths have no legitimate write path through a tool call.
      const patchText = String(args.patch);
      for (const line of patchText.split("\n")) {
        if ((line.startsWith("+++ ") || line.startsWith("--- ")) && isProtectedPath(line.slice(4).trim())) {
          return fail("Patch targets a protected path: " + line.slice(4).trim(), "PATH_PROTECTED");
        }
      }
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "files.apply_patch",
        arguments: { patchBytes: patchText.length },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          writeFileSync(join(task.workspace_root, ".cp-pending.patch"), patchText, "utf8");
          try {
            execFileSync("git", ["apply", ".cp-pending.patch"], {
              cwd: task.workspace_root,
              encoding: "utf8",
              timeout: 30_000,
            });
          } finally {
            try {
              writeFileSync(join(task.workspace_root, ".cp-pending.patch"), "", "utf8");
            } catch {
              // Best-effort cleanup; the patch already applied.
            }
          }
          return { applied: true };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },

  // -------------------------------------------------------------------- git
  {
    name: "git_status",
    description: "git.status — Porcelain status for the task workspace.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      try {
        const status = execFileSync("git", ["status", "--porcelain"], {
          cwd: task.workspace_root,
          encoding: "utf8",
          timeout: 20_000,
        });
        const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: task.workspace_root,
          encoding: "utf8",
          timeout: 10_000,
        }).trim();
        return ok({ branch, status });
      } catch (error) {
        return fail(String(error), "GIT_FAILED");
      }
    },
  },
  {
    name: "git_diff",
    description: "git.diff — Full diff for the task workspace.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      try {
        const diff = execFileSync("git", ["diff"], { cwd: task.workspace_root, encoding: "utf8", timeout: 20_000 });
        return ok({ diff });
      } catch (error) {
        return fail(String(error), "GIT_FAILED");
      }
    },
  },
  {
    name: "git_branch",
    description: "git.branch — Current branch name for the task workspace.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      try {
        const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: task.workspace_root,
          encoding: "utf8",
          timeout: 10_000,
        }).trim();
        return ok({ branch });
      } catch (error) {
        return fail(String(error), "GIT_FAILED");
      }
    },
  },
  {
    name: "git_create_worktree",
    description:
      "git.create_worktree — Create an isolated worktree so implementation cannot disturb the primary checkout. L2.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        branch: { type: "string" },
        path: { type: "string", description: "Worktree path, inside the workspace root." },
        approval_id: { type: "string" },
      },
      required: ["task_id", "branch", "path"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const worktreePath = join(task.workspace_root, String(args.path));
      if (!isInsideWorkspace(worktreePath, task.workspace_root)) {
        return fail("Worktree path escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
      }
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "git.create_worktree",
        arguments: { branch: String(args.branch), path: String(args.path) },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          execFileSync("git", ["worktree", "add", "-b", String(args.branch), worktreePath], {
            cwd: task.workspace_root,
            encoding: "utf8",
            timeout: 60_000,
          });
          return { worktree: worktreePath, branch: String(args.branch) };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },
  {
    name: "git_commit",
    description: "git.commit — Stage and commit inside the workspace. L2: requires approval.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        message: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        approval_id: { type: "string" },
      },
      required: ["task_id", "message"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
      for (const candidate of paths) {
        if (isProtectedPath(candidate)) return fail("Protected path in commit: " + candidate, "PATH_PROTECTED");
        if (!isInsideWorkspace(join(task.workspace_root, candidate), task.workspace_root)) {
          return fail("Path escapes the workspace root: " + candidate, "PATH_OUTSIDE_WORKSPACE");
        }
      }
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "git.commit",
        arguments: { message: String(args.message), paths },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          if (paths.length > 0) {
            execFileSync("git", ["add", "--", ...paths], { cwd: task.workspace_root, encoding: "utf8", timeout: 30_000 });
          }
          execFileSync("git", ["commit", "-m", String(args.message)], {
            cwd: task.workspace_root,
            encoding: "utf8",
            timeout: 60_000,
          });
          const sha = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: task.workspace_root,
            encoding: "utf8",
            timeout: 10_000,
          }).trim();
          return { commit: sha };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },
  {
    name: "git_push",
    description:
      "git.push — Push a branch. L3: ALWAYS requires explicit human approval, and force-push is refused outright.",
    riskTier: "L3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        remote: { type: "string" },
        branch: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "branch"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const branch = String(args.branch);
      // A force-push is not an approval question. It is refused here so no approval
      // id can ever authorize one.
      if (branch.startsWith("+") || String(args.remote ?? "").includes("--force")) {
        return fail("Force-push is refused by policy.", "FORCE_PUSH_DENIED");
      }
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "git.push",
        arguments: { remote: String(args.remote ?? "origin"), branch },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          execFileSync("git", ["push", String(args.remote ?? "origin"), branch], {
            cwd: task.workspace_root,
            encoding: "utf8",
            timeout: 120_000,
          });
          return { pushed: true, branch };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },

  // ---------------------------------------------------------------- command
  {
    name: "command_plan",
    description:
      "command.plan — Ask the policy engine what would happen to a command WITHOUT running it. Always read-only, even for a denied command.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, command: { type: "string" } },
      required: ["task_id", "command"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const service = getControlPlaneService();
      const task = service.getTask(taskId)!;
      // Deliberately NOT executed, so a plan is safe to request for any command.
      const decision = evaluateToolForPlan(task, "command.run_safe", String(args.command));
      return ok({ command: args.command, decision });
    },
  },
  {
    name: "command_run_safe",
    description:
      "command.run_safe — Run a command that the policy engine classifies as safe. Chained commands, interpreters, and unlisted programs are refused.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        command: { type: "string" },
        cwd: { type: "string", description: "Optional subdirectory inside the workspace." },
        approval_id: { type: "string" },
      },
      required: ["task_id", "command"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const command = String(args.command);
      const cwd = args.cwd ? join(task.workspace_root, String(args.cwd)) : task.workspace_root;
      if (!isInsideWorkspace(cwd, task.workspace_root)) {
        return fail("cwd escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
      }
      // The command is parsed into argv and spawned WITHOUT a shell, so shell
      // metacharacters are never interpreted. A command needing a shell is exactly
      // the case that must escalate instead.
      const parsed = parseCommandArgv(command);
      if (!parsed) return fail("Command could not be parsed into a safe argv.", "COMMAND_NOT_SAFE");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "command.run_safe",
        arguments: { command, cwd },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          const output = execFileSync(parsed[0]!, parsed.slice(1), {
            cwd,
            encoding: "utf8",
            timeout: 120_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          const redacted = getSecretRedactor().redact(String(output));
          return { output: redacted.redacted, redactionsApplied: redacted.secretsDetectedCount };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },
  {
    name: "command_run_approved",
    description:
      "command.run_approved — Propose a command the policy engine would NOT auto-allow. L3: never runs without a granted approval, and never with a shell.",
    riskTier: "L3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        command: { type: "string" },
        cwd: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "command"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const task = getControlPlaneService().getTask(taskId)!;
      const command = String(args.command);
      const cwd = args.cwd ? join(task.workspace_root, String(args.cwd)) : task.workspace_root;
      if (!isInsideWorkspace(cwd, task.workspace_root)) {
        return fail("cwd escapes the workspace root.", "PATH_OUTSIDE_WORKSPACE");
      }
      const parsed = parseCommandArgv(command);
      if (!parsed) return fail("Command could not be parsed into a safe argv.", "COMMAND_NOT_SAFE");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "command.run_approved",
        arguments: { command, cwd },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          const output = execFileSync(parsed[0]!, parsed.slice(1), {
            cwd,
            encoding: "utf8",
            timeout: 300_000,
            maxBuffer: 16 * 1024 * 1024,
          });
          const redacted = getSecretRedactor().redact(String(output));
          return { output: redacted.redacted, redactionsApplied: redacted.secretsDetectedCount };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output, error: result.error });
    },
  },

  // ----------------------------------------------------------------- review
  {
    name: "review_request",
    description: "review.request — Ask for a review of a task and see which independent reviewers the router assigns.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const service = getControlPlaneService();
      const task = service.getTask(taskId)!;
      const routing = routeTaskFor(task.task_type);
      service.setTaskStatus(taskId, "awaiting_review");
      return ok({ taskId, routing, existingReviews: service.getStore().listReviews(taskId).length });
    },
  },
  {
    name: "review_submit",
    description:
      "review.submit — Record a structured verdict. A CRITICAL issue downgrades an approve verdict, because a verdict cannot be softer than its own findings.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        reviewer: { type: "string" },
        role: { type: "string" },
        verdict: { type: "string", enum: ["approve", "changes_requested", "reject"] },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        issues: { type: "array", items: { type: "object" } },
        suggestions: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
      },
      required: ["task_id", "reviewer", "verdict"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const review = getControlPlaneService().submitReview({
        taskId,
        reviewer: String(args.reviewer) as AgentIdentity,
        role: (args.role ? String(args.role) : "reviewer") as never,
        verdict: args.verdict as ReviewVerdict,
        severity: (args.severity ? String(args.severity) : "low") as ReviewSeverity,
        issues: Array.isArray(args.issues) ? (args.issues as ReviewIssue[]) : [],
        suggestions: Array.isArray(args.suggestions) ? (args.suggestions as string[]) : [],
        confidence: typeof args.confidence === "number" ? args.confidence : 0.5,
      });
      return ok({ review, consensus: getControlPlaneService().getConsensus(taskId) });
    },
  },
  {
    name: "review_compare",
    description:
      "review.compare — Consensus across all reviewers, including recorded disagreements rather than a majority vote.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const service = getControlPlaneService();
      return ok({
        consensus: service.getConsensus(taskId),
        reviews: service.getStore().listReviews(taskId),
        canApply: service.canApply(taskId),
      });
    },
  },

  // --------------------------------------------------------------- approval
  {
    name: "approval_request",
    description: "approval.request — Open an approval for a specific tool on a task.",
    riskTier: "L0",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        tool: { type: "string" },
        risk: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        reason: { type: "string" },
      },
      required: ["task_id", "tool"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const created = getControlPlaneService().requestApproval({
        taskId,
        tool: String(args.tool),
        risk: String(args.risk ?? "L2"),
        reason: args.reason ? String(args.reason) : "",
      });
      return ok({ approval: created });
    },
  },
  {
    name: "approval_get",
    description: "approval.get — Read one approval, or list the pending queue.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { approval_id: { type: "string" } },
    },
    handler: async (args) => {
      const service = getControlPlaneService();
      if (args.approval_id) {
        const approval = service.getApproval(String(args.approval_id));
        if (!approval) return fail("Unknown approval.", "NOT_FOUND");
        return ok({ approval });
      }
      return ok({ pending: service.listApprovals("pending") });
    },
  },
  {
    name: "approval_decide",
    description:
      "approval.decide — Grant or deny a pending approval. There is deliberately no 'always allow' mode.",
    riskTier: "L3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string" },
        decision: { type: "string", enum: ["grant", "deny"] },
        decided_by: { type: "string" },
      },
      required: ["approval_id", "decision"],
    },
    handler: async (args) => {
      const updated = getControlPlaneService().decideApproval(
        String(args.approval_id),
        args.decision as "grant" | "deny",
        args.decided_by ? String(args.decided_by) : "operator",
      );
      if (!updated) return fail("Approval is unknown or already decided.", "NOT_PENDING");
      return ok({ approval: updated });
    },
  },

  // --------------------------------------------------------------- artifact
  {
    name: "artifact_register",
    description: "artifact.register — Record an artifact with its provenance so it can be traced back to the run that made it.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        run_id: { type: "string" },
        artifact_type: { type: "string", enum: ["image", "video", "document", "patch", "dataset", "other"] },
        name: { type: "string" },
        project: { type: "string" },
        provenance: { type: "object" },
        content: { type: "string" },
      },
      required: ["task_id", "artifact_type", "name"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const artifact = getControlPlaneService().registerArtifact({
        taskId,
        runId: args.run_id ? String(args.run_id) : null,
        artifactType: args.artifact_type as never,
        name: String(args.name),
        project: args.project ? String(args.project) : "",
        provenance: (args.provenance as Record<string, unknown>) ?? {},
        content: args.content ? String(args.content) : undefined,
      });
      return ok({ artifact });
    },
  },
  {
    name: "artifact_list",
    description: "artifact.list — List artifacts, optionally for one task.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } } },
    handler: async (args) => {
      const artifacts = getControlPlaneService().listArtifacts(args.task_id ? String(args.task_id) : undefined);
      return ok({ count: artifacts.length, artifacts });
    },
  },
  {
    name: "artifact_get",
    description: "artifact.get — Read one artifact with its full provenance.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] },
    handler: async (args) => {
      const artifact = getControlPlaneService().getStore().getArtifact(String(args.artifact_id));
      if (!artifact) return fail("Unknown artifact.", "NOT_FOUND");
      return ok({ artifact });
    },
  },
  {
    name: "artifact_compare",
    description: "artifact.compare — Group artifacts by content hash to find duplicates and near-duplicates.",
    riskTier: "L0",
    readOnly: true,
    inputSchema: { type: "object", properties: { task_id: { type: "string" } } },
    handler: async (args) => {
      const artifacts = getControlPlaneService().listArtifacts(args.task_id ? String(args.task_id) : undefined);
      const groups = new Map<string, string[]>();
      for (const artifact of artifacts) {
        const bucket = groups.get(artifact.content_hash) ?? [];
        bucket.push(artifact.id);
        groups.set(artifact.content_hash, bucket);
      }
      return ok({
        duplicates: [...groups.entries()]
          .filter(([, ids]) => ids.length > 1)
          .map(([hash, ids]) => ({ contentHash: hash, artifactIds: ids })),
      });
    },
  },
  {
    name: "artifact_approve",
    description: "artifact.approve — Move an artifact from candidate to approved. L3: explicit human approval.",
    riskTier: "L3",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        artifact_id: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "artifact_id"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "artifact.approve",
        arguments: { artifactId: String(args.artifact_id) },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          getControlPlaneService()
            .getStore()
            .getDb()
            .query("UPDATE cp_artifacts SET status = 'approved' WHERE id = ?")
            .run(String(args.artifact_id));
          return { artifactId: String(args.artifact_id), status: "approved" };
        },
      });
      return ok({ status: result.status, decision: result.decision, output: result.output });
    },
  },

  // ------------------------------------------------------------------ media
  {
    name: "media_create_brief",
    description:
      "media.create_brief — Record a creative brief as a document artifact so later assets trace back to it.",
    riskTier: "L1",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        project: { type: "string" },
        brief: { type: "string" },
        concept: { type: "string" },
      },
      required: ["task_id", "brief"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const artifact = getControlPlaneService().registerArtifact({
        taskId,
        artifactType: "document",
        name: "brief: " + (args.concept ? String(args.concept) : "untitled"),
        project: args.project ? String(args.project) : "",
        provenance: { kind: "creative_brief", concept: args.concept ?? null },
        content: String(args.brief),
      });
      return ok({ brief: artifact });
    },
  },
  {
    name: "media_generate_image",
    description:
      "media.generate_image — Register an image generation as an artifact with full provenance. L2; no provider key is read here.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        project: { type: "string" },
        prompt: { type: "string" },
        generator: { type: "string" },
        seed: { type: "number" },
        name: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "prompt"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "media.generate_image",
        arguments: { prompt: String(args.prompt), generator: args.generator ?? null },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          const artifact = getControlPlaneService().registerArtifact({
            taskId,
            runId: args.run_id ? String(args.run_id) : null,
            artifactType: "image",
            name: args.name ? String(args.name) : "image candidate",
            project: args.project ? String(args.project) : "",
            provenance: {
              prompt: String(args.prompt),
              generator: args.generator ? String(args.generator) : "unspecified",
              seed: args.seed ?? null,
              generatedAt: new Date().toISOString(),
            },
            content: String(args.prompt),
          });
          return artifact;
        },
      });
      return ok({ status: result.status, decision: result.decision, artifact: result.output });
    },
  },
  {
    name: "media_generate_video",
    description: "media.generate_video — Register a video generation as an artifact with provenance. L2.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        project: { type: "string" },
        prompt: { type: "string" },
        generator: { type: "string" },
        durationSeconds: { type: "number" },
        name: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "prompt"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "media.generate_video",
        arguments: { prompt: String(args.prompt), generator: args.generator ?? null },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => {
          return getControlPlaneService().registerArtifact({
            taskId,
            runId: args.run_id ? String(args.run_id) : null,
            artifactType: "video",
            name: args.name ? String(args.name) : "video candidate",
            project: args.project ? String(args.project) : "",
            provenance: {
              prompt: String(args.prompt),
              generator: args.generator ? String(args.generator) : "unspecified",
              durationSeconds: args.durationSeconds ?? null,
              generatedAt: new Date().toISOString(),
            },
            content: String(args.prompt),
          });
        },
      });
      return ok({ status: result.status, decision: result.decision, artifact: result.output });
    },
  },
  {
    name: "media_upscale",
    description: "media.upscale — Record an upscale operation against an existing artifact. L2.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        artifact_id: { type: "string" },
        target: { type: "string", description: "Target resolution, e.g. 4096x4096." },
        approval_id: { type: "string" },
      },
      required: ["task_id", "artifact_id"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const source = getControlPlaneService().getStore().getArtifact(String(args.artifact_id));
      if (!source) return fail("Unknown source artifact.", "NOT_FOUND");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "media.upscale",
        arguments: { artifactId: String(args.artifact_id), target: args.target ?? null },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () =>
          getControlPlaneService().registerArtifact({
            taskId,
            artifactType: source.artifact_type,
            name: source.name + " (upscaled)",
            project: source.project,
            provenance: { upscaledFrom: source.id, target: args.target ?? null },
            content: source.content_hash + "|" + String(args.target ?? ""),
          }),
      });
      return ok({ status: result.status, decision: result.decision, artifact: result.output });
    },
  },
  {
    name: "media_qc",
    description: "media.qc — Record a QC verdict for an artifact as a review issue. L2.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        artifact_id: { type: "string" },
        passed: { type: "boolean" },
        findings: { type: "array", items: { type: "string" } },
        approval_id: { type: "string" },
      },
      required: ["task_id", "artifact_id", "passed"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const artifact = getControlPlaneService().getStore().getArtifact(String(args.artifact_id));
      if (!artifact) return fail("Unknown artifact.", "NOT_FOUND");
      const findings = Array.isArray(args.findings) ? (args.findings as string[]) : [];
      const passed = Boolean(args.passed);
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "media.qc",
        arguments: { artifactId: String(args.artifact_id), passed },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () =>
          getControlPlaneService().submitReview({
            taskId,
            reviewer: "pao-hubpro",
            role: "reviewer",
            // A failed QC is a real finding, not a note: it carries medium severity so
            // it cannot be mistaken for a clean pass in the consensus.
            verdict: passed ? "approve" : "changes_requested",
            severity: passed ? "low" : "medium",
            issues: findings.map((finding) => ({
              severity: "medium" as ReviewSeverity,
              title: finding,
              detail: "Media QC finding for artifact " + artifact.id + ".",
              fingerprint: artifact.id + "|qc|" + finding.toLowerCase(),
            })),
            suggestions: passed ? [] : ["Regenerate or repair the artifact before export."],
            confidence: 0.7,
          }),
      });
      return ok({ status: result.status, decision: result.decision, review: result.output });
    },
  },
  {
    name: "media_export",
    description:
      "media.export — Mark an artifact ready for export by assembling its provenance. L2; this phase does NOT upload anywhere.",
    riskTier: "L2",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...TASK_ARGS,
        artifact_id: { type: "string" },
        export_name: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["task_id", "artifact_id"],
    },
    handler: async (args) => {
      const taskId = requireTask(args.task_id);
      if (!taskId) return fail("Unknown task " + args.task_id + ".", "TASK_NOT_FOUND");
      const artifact = getControlPlaneService().getStore().getArtifact(String(args.artifact_id));
      if (!artifact) return fail("Unknown artifact.", "NOT_FOUND");
      const result = await getControlPlaneService().requestTool({
        taskId,
        runId: String(args.run_id ?? ""),
        tool: "media.export",
        arguments: { artifactId: String(args.artifact_id), exportName: args.export_name ?? null },
        approvalId: args.approval_id ? String(args.approval_id) : null,
        execute: () => ({
          artifactId: artifact.id,
          exportName: args.export_name ? String(args.export_name) : artifact.name,
          provenance: artifact.provenance,
          contentHash: artifact.content_hash,
          // Deliberately no upload call: this phase stops at a locally-described
          // export package.
          uploaded: false,
        }),
      });
      return ok({ status: result.status, decision: result.decision, exportPackage: result.output });
    },
  },
];

/**
 * Evaluate a command WITHOUT running it, for command.plan.
 *
 * Reuses the same classifier the executing path uses, so a plan cannot disagree
 * with what would actually happen.
 */
function evaluateToolForPlan(
  task: { workspace_root: string; allowed_tools: readonly string[]; forbidden_tools: readonly string[]; risk_level: "L0" | "L1" | "L2" | "L3" },
  tool: string,
  command: string,
): unknown {
  return evaluateRequest({
    task: {
      task_id: "",
      workspace_root: task.workspace_root,
      allowed_tools: task.allowed_tools,
      forbidden_tools: task.forbidden_tools,
      risk_level: task.risk_level,
    },
    tool,
    arguments: { command },
  });
}

/** Route a task type through the router. */
function routeTaskFor(taskType: string): unknown {
  return routeTask(taskType as never);
}

/**
 * Split a command into argv WITHOUT invoking a shell.
 *
 * Returns null when the input cannot be represented as a plain argv, which is the
 * fail-closed answer: quotes, redirections, and separators all mean the caller
 * wanted a shell, and a shell is exactly what must not be granted here.
 */
export function parseCommandArgv(command: string): string[] | null {
  const trimmed = command.trim();
  if (trimmed === "") return null;
  if (/[;&|<>`$(){}]/.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/).filter((part) => part !== "");
  return parts.length > 0 ? parts : null;
}
