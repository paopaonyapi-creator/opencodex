// Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime
// Central Agent Runtime State Machine & Orchestrator
// Coordinates Planning, Policy Engine, AI Council, Human Approval, Execution & Audit.

import { openAgentOsDb } from "../../db";
import { randomUUID } from "node:crypto";
import type {
  AgentMode,
  ApprovalCard,
  ApprovalDecision,
  DesktopAgentRun,
  DesktopAgentState,
  GenerateRequest,
  ModelInfo,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolRisk,
} from "../types";
import { getAgentModeManager } from "../modes/agent-mode-manager";
import { getProviderRegistry } from "../providers/provider-registry";
import { getModelCapabilityRegistry } from "../providers/model-capability-registry";
import { getToolRegistry } from "../tools/tool-registry";
import { getToolRiskClassifier } from "../tools/risk-classifier";
import { getPolicyEngine } from "../policy/policy-engine";
import { getContextBuilder } from "../context/context-builder";
import { getApprovalGateway } from "../approval/approval-gateway";
import { getReviewerCouncilBridge } from "../reviewer-council/reviewer-council-bridge";
import { AuditLogger } from "../audit/audit-logger";
import { getPonytailGovernanceGate } from "../../governance";

export interface StartRunOptions {
  mission: string;
  agentMode?: AgentMode;
  providerId?: string;
  modelId?: string;
  workspaceRoot?: string;
  maxSteps?: number;
  timeoutMs?: number;
  approvalHandler?: (card: ApprovalCard) => Promise<ApprovalDecision>;
  onStateChange?: (state: DesktopAgentState, run: DesktopAgentRun) => void;
}

export class AgentRuntime {
  private auditLogger: AuditLogger;
  private activeAbortControllers = new Map<string, AbortController>();
  private executedToolKeys = new Set<string>();

  constructor(customAuditLogger?: AuditLogger) {
    this.auditLogger = customAuditLogger ?? new AuditLogger();
  }

  /**
   * Execute an autonomous or supervised agent run from start to finish.
   */
  async runMission(options: StartRunOptions): Promise<DesktopAgentRun> {
    const runId = `run_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const createdAt = startedAt;
    const mode = options.agentMode ?? "ask";
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const maxSteps = options.maxSteps ?? 10;
    const timeoutMs = options.timeoutMs ?? 60000;

    const abortController = new AbortController();
    this.activeAbortControllers.set(runId, abortController);

    const timeoutTimer = setTimeout(() => {
      abortController.abort(new Error(`Mission execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let currentState: DesktopAgentState = "PLANNING";

    const run: DesktopAgentRun = {
      id: runId,
      mission: options.mission,
      agentMode: mode,
      providerId: options.providerId ?? "openai",
      modelId: options.modelId ?? "gpt-4o",
      status: currentState,
      activeTools: [],
      activeSkills: [],
      currentTask: options.mission,
      startedAt,
      createdAt,
    };

    const updateState = (newState: DesktopAgentState, taskDesc?: string) => {
      currentState = newState;
      run.status = newState;
      if (taskDesc) run.currentTask = taskDesc;
      this.persistRun(run);
      options.onStateChange?.(newState, run);
    };

    // 1. Initial persistence & Audit
    this.persistRun(run);
    this.auditLogger.logEvent({
      runId,
      eventType: "RUN_STARTED",
      status: "started",
      metadata: {
        mission: options.mission,
        mode,
        provider: run.providerId,
        model: run.modelId,
        workspaceRoot,
      },
    });

    try {
      // 2. Resolve Provider and Model Capabilities
      const providerRegistry = getProviderRegistry();
      const capabilityRegistry = getModelCapabilityRegistry();
      const toolRegistry = getToolRegistry();
      const policyEngine = getPolicyEngine();
      const approvalGateway = getApprovalGateway();
      const councilBridge = getReviewerCouncilBridge();
      const modeManager = getAgentModeManager();
      const contextBuilder = getContextBuilder();
      const riskClassifier = getToolRiskClassifier();

      const provider = providerRegistry.getProvider(run.providerId ?? "openai") ?? providerRegistry.listProviders()[0];
      if (!provider) {
        throw new Error(`No AI Provider found for '${run.providerId}'`);
      }
      const modelCaps = capabilityRegistry.resolveCapabilities(run.modelId ?? "gpt-4o", run.providerId ?? "openai");

      // 3. Assemble visible tools and context
      const visibleTools = toolRegistry.getVisibleTools({
        mode,
        modelCapabilities: modelCaps,
      });
      run.activeTools = visibleTools.map((t) => t.id);

      const context = contextBuilder.assembleContext(visibleTools, {
        workspaceRoot,
        userPrompt: options.mission,
      });

      // 3.1 Ponytail Minimal-Code Governance Evaluation
      const governanceGate = getPonytailGovernanceGate(workspaceRoot);
      const governanceDecision = governanceGate.evaluateTask(options.mission);
      const governancePrompt = governanceGate.buildGovernanceSystemPrompt(governanceDecision);
      const effectiveSystemPrompt = governancePrompt
        ? `${governancePrompt}\n\n${context.systemPrompt}`
        : context.systemPrompt;

      this.auditLogger.logEvent({
        runId,
        eventType: "GOVERNANCE_EVALUATED",
        status: "evaluated",
        metadata: {
          governanceMode: governanceDecision.mode,
          taskType: governanceDecision.taskType,
          risk: governanceDecision.risk,
          selectedRung: governanceDecision.selectedRung,
          reusedCandidates: governanceDecision.existingCandidates,
        },
      });

      const messages: GenerateRequest["messages"] = [
        { role: "system", content: effectiveSystemPrompt },
        { role: "user", content: options.mission },
      ];

      let step = 0;
      let completed = false;

      // 4. Execution Loop
      while (step < maxSteps && !completed) {
        if (abortController.signal.aborted) {
          throw new Error(`Run aborted: ${abortController.signal.reason}`);
        }

        step++;
        updateState("WAITING_MODEL", `Step ${step}: Requesting model decision`);

        this.auditLogger.logEvent({
          runId,
          eventType: "MODEL_REQUEST",
          status: "sent",
          metadata: { step, messageCount: messages.length },
        });

        const genResponse = await provider.generate({
          model: run.modelId ?? "gpt-4o",
          messages,
          tools: visibleTools,
          abortSignal: abortController.signal,
        });

        this.auditLogger.logEvent({
          runId,
          eventType: "MODEL_RESPONSE",
          status: "received",
          metadata: {
            step,
            finishReason: genResponse.finishReason,
            toolCallCount: genResponse.toolCalls?.length ?? 0,
          },
        });

        // If no tool calls proposed or stop condition met
        if (!genResponse.toolCalls || genResponse.toolCalls.length === 0) {
          updateState("COMPLETED", "Mission finished successfully");
          this.auditLogger.logEvent({
            runId,
            eventType: "RUN_COMPLETED",
            status: "success",
            metadata: { finalResponse: genResponse.text },
          });
          completed = true;
          break;
        }

        // 5. Handle Tool Proposals
        updateState("TOOL_PROPOSED", `Evaluating ${genResponse.toolCalls.length} proposed tool call(s)`);

        for (const tc of genResponse.toolCalls) {
          if (abortController.signal.aborted) {
            throw new Error(`Run aborted: ${abortController.signal.reason}`);
          }

          // Invariant: In 'off' mode, tool proposals are forbidden
          if (mode === "off") {
            const errorMsg = "Policy rejection: Agent Mode is 'off'; tool execution is completely disabled.";
            this.auditLogger.logEvent({
              runId,
              eventType: "POLICY_DENIED",
              tool: tc.name,
              status: "denied",
              metadata: { reason: errorMsg },
            });
            messages.push({
              role: "assistant",
              content: "",
              toolCalls: [tc],
            });
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: errorMsg }),
              toolCallId: tc.id,
            });
            continue;
          }

          // De-namespace tool name if needed (tc.name could be 'read_file' or 'builtin__read_file')
          const toolId = tc.name.includes("__") ? tc.name : `builtin__${tc.name}`;
          const tool = toolRegistry.getToolById(toolId) ?? toolRegistry.getTool("builtin", tc.name);
          const risk: ToolRisk = tool ? tool.risk : riskClassifier.classify(tc.name, tc.arguments);

          const toolReq: ToolExecutionRequest = {
            id: tc.id,
            runId,
            toolId: tool ? tool.id : toolId,
            namespace: tool ? tool.namespace : "builtin",
            name: tool ? tool.name : tc.name,
            risk,
            arguments: tc.arguments,
            idempotencyKey: `${runId}:${tc.name}:${JSON.stringify(tc.arguments)}`,
          };

          // Idempotency check
          if (toolReq.idempotencyKey && this.executedToolKeys.has(toolReq.idempotencyKey)) {
            messages.push({
              role: "assistant",
              content: "",
              toolCalls: [tc],
            });
            messages.push({
              role: "tool",
              content: JSON.stringify({ message: "Cached idempotent result: tool already executed" }),
              toolCallId: tc.id,
            });
            continue;
          }

          // 6. Policy Engine Evaluation
          updateState("POLICY_CHECK", `Checking security policy for tool '${toolReq.name}'`);
          const targetPath = (tc.arguments.path ?? tc.arguments.filePath ?? tc.arguments.dirPath) as string | undefined;
          const command = tc.arguments.command as string | undefined;

          const actionType = command ? "shell_exec" : targetPath ? (tc.name.includes("write") ? "fs_write" : "fs_read") : "unknown";
          const policyEval = policyEngine.evaluateAction({
            actionType,
            targetPath,
            command,
          });

          if (!policyEval.allowed) {
            this.auditLogger.logEvent({
              runId,
              eventType: "POLICY_DENIED",
              tool: toolReq.name,
              risk,
              status: "denied",
              metadata: { reason: policyEval.reason },
            });
            messages.push({
              role: "assistant",
              content: "",
              toolCalls: [tc],
            });
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: `Security Policy Denied: ${policyEval.reason}` }),
              toolCallId: tc.id,
            });
            continue;
          }

          this.auditLogger.logEvent({
            runId,
            eventType: "POLICY_ALLOWED",
            tool: toolReq.name,
            risk,
            status: "allowed",
            metadata: { risk },
          });

          // 7. AI Reviewer Council (for high/critical actions)
          if (councilBridge.shouldTriggerCouncil(risk, tc.name)) {
            updateState("REVIEWING", `Reviewer Council deliberating on '${toolReq.name}'`);
            this.auditLogger.logEvent({
              runId,
              eventType: "COUNCIL_REVIEW",
              tool: toolReq.name,
              risk,
              status: "deliberating",
            });

            const councilDecision = await councilBridge.evaluate({
              runId,
              mission: options.mission,
              toolCall: toolReq,
              risk,
              governanceEvidence: {
                selectedRung: governanceDecision.selectedRung,
                taskType: governanceDecision.taskType,
                risk: governanceDecision.risk,
                reasoningSummary: governanceDecision.reasoningSummary,
                existingCandidates: governanceDecision.existingCandidates,
              },
            });

            if (councilDecision.decision === "reject") {
              const rejectReason = `Reviewer Council rejected operation: ${councilDecision.reasons.join("; ")}`;
              this.auditLogger.logEvent({
                runId,
                eventType: "POLICY_DENIED",
                tool: toolReq.name,
                risk,
                status: "council_rejected",
                metadata: { reasons: councilDecision.reasons },
              });
              messages.push({
                role: "assistant",
                content: "",
                toolCalls: [tc],
              });
              messages.push({
                role: "tool",
                content: JSON.stringify({ error: rejectReason }),
                toolCallId: tc.id,
              });
              continue;
            }
          }

          // 8. Human-in-the-Loop Approval Check
          const permissionCheck = modeManager.evaluatePermission(mode, risk, toolReq.toolId);
          const needsApproval =
            permissionCheck.requiresApproval ||
            risk === "critical" ||
            (risk === "high" && mode !== "full_auto");

          if (needsApproval) {
            // Check session approval (strictly prohibited for critical)
            const isSessionApproved = modeManager.hasSessionApproval(toolReq.toolId);
            if (!isSessionApproved || risk === "critical") {
              updateState("WAITING_APPROVAL", `Waiting for human approval for '${toolReq.name}' (${risk})`);

              const card = approvalGateway.requestApproval({
                runId,
                toolCall: toolReq,
                model: run.modelId ?? "gpt-4o",
                command,
                affectedFiles: targetPath ? [targetPath] : [],
                reason: permissionCheck.reason,
              });

              this.auditLogger.logEvent({
                runId,
                eventType: "APPROVAL_REQUESTED",
                tool: toolReq.name,
                risk,
                status: "pending",
                metadata: { approvalId: card.id },
              });

              let approvalResult: { decision: ApprovalDecision };
              if (options.approvalHandler) {
                const decision = await options.approvalHandler(card);
                approvalResult = approvalGateway.decide(card.id, decision);
              } else {
                approvalResult = await approvalGateway.waitForDecision(card.id, options.timeoutMs ?? 60000);
              }
              if (approvalResult.decision === "reject") {
                this.auditLogger.logEvent({
                  runId,
                  eventType: "APPROVAL_REJECTED",
                  tool: toolReq.name,
                  risk,
                  status: "rejected",
                });
                messages.push({
                  role: "assistant",
                  content: "",
                  toolCalls: [tc],
                });
                messages.push({
                  role: "tool",
                  content: JSON.stringify({ error: "Operation rejected by user operator." }),
                  toolCallId: tc.id,
                });
                continue;
              }

              this.auditLogger.logEvent({
                runId,
                eventType: "APPROVAL_GRANTED",
                tool: toolReq.name,
                risk,
                status: "granted",
                metadata: { decision: approvalResult.decision },
              });
            }
          }

          // 9. Tool Execution
          updateState("EXECUTING", `Executing tool '${toolReq.name}'`);
          this.auditLogger.logEvent({
            runId,
            eventType: "TOOL_STARTED",
            tool: toolReq.name,
            risk,
            status: "running",
            metadata: { args: tc.arguments },
          });

          this.recordToolCall(toolReq, "running");

          const execResult = await toolRegistry.executeTool(
            toolReq.toolId,
            tc.arguments,
            { runId, workspaceRoot, abortSignal: abortController.signal },
          );

          updateState("OBSERVING", `Observed result from '${toolReq.name}'`);

          if (execResult.success) {
            this.auditLogger.logEvent({
              runId,
              eventType: "TOOL_COMPLETED",
              tool: toolReq.name,
              risk,
              status: "success",
              metadata: { latencyMs: execResult.latencyMs },
            });
            this.updateToolCall(tc.id, "completed", execResult);
          } else {
            this.auditLogger.logEvent({
              runId,
              eventType: "TOOL_FAILED",
              tool: toolReq.name,
              risk,
              status: "failed",
              metadata: { error: execResult.errorMessage },
            });
            this.updateToolCall(tc.id, "failed", execResult);
          }

          if (toolReq.idempotencyKey) {
            this.executedToolKeys.add(toolReq.idempotencyKey);
          }

          // Append assistant message and tool response to conversation
          messages.push({
            role: "assistant",
            content: "",
            toolCalls: [tc],
          });
          messages.push({
            role: "tool",
            content: JSON.stringify(execResult.output ?? { error: execResult.errorMessage }),
            toolCallId: tc.id,
          });
        }
      }

      if (!completed && step >= maxSteps) {
        updateState("COMPLETED", `Reached maximum allowed step budget (${maxSteps})`);
      }
    } catch (err) {
      const isAbort = abortController.signal.aborted;
      const isTimeout = String(err).includes("timed out");
      const finalState = isTimeout ? "TIMEOUT" : isAbort ? "CANCELLED" : "FAILED";

      updateState(finalState, `Execution terminated: ${err instanceof Error ? err.message : String(err)}`);
      run.errorMessage = err instanceof Error ? err.message : String(err);

      this.auditLogger.logEvent({
        runId,
        eventType: isAbort ? "RUN_CANCELLED" : "RUN_COMPLETED",
        status: finalState.toLowerCase(),
        metadata: { error: run.errorMessage },
      });
    } finally {
      clearTimeout(timeoutTimer);
      this.activeAbortControllers.delete(runId);
      run.finishedAt = new Date().toISOString();
      this.persistRun(run);
    }

    return run;
  }

  /**
   * Cooperative cancellation for a running mission.
   */
  cancelRun(runId: string, reason = "User requested cancellation"): boolean {
    const controller = this.activeAbortControllers.get(runId);
    if (controller) {
      controller.abort(new Error(reason));
      this.activeAbortControllers.delete(runId);
      return true;
    }
    return false;
  }

  /**
   * Retrieve an existing run by ID from SQLite.
   */
  getRun(runId: string): DesktopAgentRun | null {
    try {
      const db = openAgentOsDb();
      const row = db.query(`
        SELECT id, mission, agent_mode, provider_id, model_id, status,
               active_tools_json, active_skills_json, current_task, error_message,
               started_at, finished_at, created_at
        FROM desktop_agent_runs
        WHERE id = ?
      `).get(runId) as {
        id: string;
        mission: string;
        agent_mode: string;
        provider_id: string | null;
        model_id: string | null;
        status: string;
        active_tools_json: string;
        active_skills_json: string;
        current_task: string | null;
        error_message: string | null;
        started_at: string;
        finished_at: string | null;
        created_at: string;
      } | undefined;

      if (!row) return null;

      return {
        id: row.id,
        mission: row.mission,
        agentMode: row.agent_mode as AgentMode,
        providerId: row.provider_id ?? undefined,
        modelId: row.model_id ?? undefined,
        status: row.status as DesktopAgentState,
        activeTools: JSON.parse(row.active_tools_json || "[]"),
        activeSkills: JSON.parse(row.active_skills_json || "[]"),
        currentTask: row.current_task ?? undefined,
        errorMessage: row.error_message ?? undefined,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? undefined,
        createdAt: row.created_at,
      };
    } catch {
      return null;
    }
  }

  /**
   * List recent runs.
   */
  listRuns(limit = 50): DesktopAgentRun[] {
    try {
      const db = openAgentOsDb();
      const rows = db.query(`
        SELECT id, mission, agent_mode, provider_id, model_id, status,
               active_tools_json, active_skills_json, current_task, error_message,
               started_at, finished_at, created_at
        FROM desktop_agent_runs
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as Array<{
        id: string;
        mission: string;
        agent_mode: string;
        provider_id: string | null;
        model_id: string | null;
        status: string;
        active_tools_json: string;
        active_skills_json: string;
        current_task: string | null;
        error_message: string | null;
        started_at: string;
        finished_at: string | null;
        created_at: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        mission: r.mission,
        agentMode: r.agent_mode as AgentMode,
        providerId: r.provider_id ?? undefined,
        modelId: r.model_id ?? undefined,
        status: r.status as DesktopAgentState,
        activeTools: JSON.parse(r.active_tools_json || "[]"),
        activeSkills: JSON.parse(r.active_skills_json || "[]"),
        currentTask: r.current_task ?? undefined,
        errorMessage: r.error_message ?? undefined,
        startedAt: r.started_at,
        finishedAt: r.finished_at ?? undefined,
        createdAt: r.created_at,
      }));
    } catch {
      return [];
    }
  }

  private persistRun(run: DesktopAgentRun): void {
    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO desktop_agent_runs (
          id, mission, agent_mode, provider_id, model_id, status,
          active_tools_json, active_skills_json, current_task, error_message,
          started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_task = excluded.current_task,
          error_message = excluded.error_message,
          finished_at = excluded.finished_at,
          active_tools_json = excluded.active_tools_json,
          active_skills_json = excluded.active_skills_json
      `).run(
        run.id,
        run.mission,
        run.agentMode,
        run.providerId ?? null,
        run.modelId ?? null,
        run.status,
        JSON.stringify(run.activeTools),
        JSON.stringify(run.activeSkills),
        run.currentTask ?? null,
        run.errorMessage ?? null,
        run.startedAt,
        run.finishedAt ?? null,
        run.createdAt,
      );
    } catch (err) {
      console.warn(`[AgentRuntime] Failed to persist run: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private recordToolCall(req: ToolExecutionRequest, status: string): void {
    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO desktop_agent_tool_calls (
          id, run_id, tool_id, namespace, name, risk, input_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.id,
        req.runId,
        req.toolId,
        req.namespace,
        req.name,
        req.risk,
        JSON.stringify(req.arguments),
        status,
        new Date().toISOString(),
      );
    } catch {
      // Best-effort
    }
  }

  private updateToolCall(id: string, status: string, res: ToolExecutionResult): void {
    try {
      const db = openAgentOsDb();
      db.query(`
        UPDATE desktop_agent_tool_calls
        SET status = ?, output_json = ?, error_message = ?, latency_ms = ?
        WHERE id = ?
      `).run(
        status,
        res.output !== undefined ? JSON.stringify(res.output) : null,
        res.errorMessage ?? null,
        res.latencyMs,
        id,
      );
    } catch {
      // Best-effort
    }
  }
}

let defaultAgentRuntime: AgentRuntime | null = null;
export function getAgentRuntime(): AgentRuntime {
  if (!defaultAgentRuntime) {
    defaultAgentRuntime = new AgentRuntime();
  }
  return defaultAgentRuntime;
}
