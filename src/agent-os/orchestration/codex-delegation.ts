// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Codex Delegation Bridge

import { getCodexRuntimeService } from "../codex-runtime";
import type { CodexSession, CodexTurn } from "../codex-runtime/types";

export interface CodexDelegationRequest {
  prompt: string;
  workspaceRoot?: string;
  existingSessionId?: string;
  title?: string;
}

export interface CodexDelegationResult {
  sessionId: string;
  turnId: string;
  status: "completed" | "failed";
  output: string;
  rawTurn?: CodexTurn;
}

export class CodexDelegationBridge {
  async delegateCodingTask(req: CodexDelegationRequest): Promise<CodexDelegationResult> {
    const codexService = getCodexRuntimeService();

    let session: CodexSession;
    if (req.existingSessionId) {
      const found = codexService.store.getSession(req.existingSessionId);
      if (!found) {
        throw new Error(`Codex session '${req.existingSessionId}' not found`);
      }
      session = found;
    } else {
      session = codexService.createSession({
        workspaceRoot: req.workspaceRoot || process.cwd(),
        title: req.title || "Orchestration Delegated Coding Task",
      });
    }

    try {
      const turn = await codexService.executeTurn(session.id, req.prompt);
      const isFailed = turn.status === "failed";
      return {
        sessionId: session.id,
        turnId: turn.id,
        status: isFailed ? "failed" : "completed",
        output: turn.resultSummary || (isFailed ? turn.error || "Turn failed" : "Completed successfully"),
        rawTurn: turn,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        sessionId: session.id,
        turnId: `err_${Date.now()}`,
        status: "failed",
        output: `Codex delegation failed: ${message}`,
      };
    }
  }
}
