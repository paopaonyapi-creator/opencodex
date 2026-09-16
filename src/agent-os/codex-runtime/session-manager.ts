// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Session Manager: Thread Mapping, Concurrency Queue, Cancellation & Crash Recovery.

import { CodexRuntimeStore } from "./store";
import { CodexEventBus } from "./event-bus";
import { CodexAuditService } from "./audit";
import type {
  CodexSession,
  CodexTurn,
  CodexPolicyProfile,
  CodexRuntimeMode,
} from "./types";

export interface CreateSessionOptions {
  workspaceRoot: string;
  nodeId?: string;
  runtimeMode?: CodexRuntimeMode;
  policyProfile?: CodexPolicyProfile;
  title?: string;
}

export class SessionManager {
  private maxConcurrentTurns = 3;
  private runningTurns = new Set<string>();
  private turnQueue: Array<{
    turn: CodexTurn;
    execute: () => Promise<void>;
  }> = [];

  constructor(
    private store = new CodexRuntimeStore(),
    private eventBus = new CodexEventBus(),
    private audit = new CodexAuditService(),
  ) {
    const envMax = process.env.PAO_CODEX_MAX_CONCURRENT_TURNS;
    if (envMax && !isNaN(Number(envMax))) {
      this.maxConcurrentTurns = Math.max(1, Number(envMax));
    }
  }

  createSession(options: CreateSessionOptions): CodexSession {
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const session: CodexSession = {
      id,
      threadId: null,
      workspaceRoot: options.workspaceRoot,
      nodeId: options.nodeId || "local_pc",
      runtimeMode: options.runtimeMode || "auto",
      status: "idle",
      policyProfile: options.policyProfile || "NORMAL",
      title: options.title || `Session ${new Date().toLocaleTimeString()}`,
      activeTurnId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.store.createSession(session);
    this.audit.log({
      sessionId: id,
      action: "session.create",
      risk: "low",
      result: "ok",
      metadata: {
        workspaceRoot: options.workspaceRoot,
        policyProfile: session.policyProfile,
      },
    });

    return session;
  }

  getSession(id: string): CodexSession | null {
    return this.store.getSession(id);
  }

  listSessions(limit = 100): CodexSession[] {
    return this.store.listSessions(limit);
  }

  bindThread(sessionId: string, threadId: string): void {
    this.store.updateSessionThreadId(sessionId, threadId);
    this.eventBus.emit(sessionId, null, {
      type: "ThreadStarted",
      threadId,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  async enqueueTurn(
    sessionId: string,
    prompt: string,
    executor: (turn: CodexTurn) => Promise<void>,
  ): Promise<CodexTurn> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const turn: CodexTurn = {
      id: turnId,
      sessionId,
      threadId: session.threadId,
      nodeId: session.nodeId,
      prompt,
      status: "queued",
      fileChanges: [],
      resultSummary: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };

    this.store.createJob(turn);
    this.store.updateSessionStatus(sessionId, "running", turnId);

    const runTask = async () => {
      this.runningTurns.add(turnId);
      turn.status = "running";
      turn.startedAt = new Date().toISOString();
      this.store.updateJobState(turnId, "running");

      this.eventBus.emit(sessionId, turnId, {
        type: "TurnStarted",
        turnId,
        threadId: session.threadId || "",
        sessionId,
        prompt,
        timestamp: turn.startedAt,
      });

      try {
        await executor(turn);
        turn.status = "completed";
        turn.finishedAt = new Date().toISOString();
        this.store.updateJobState(turnId, "completed", null, turn.finishedAt);
        this.store.updateSessionStatus(sessionId, "idle", null);

        this.eventBus.emit(sessionId, turnId, {
          type: "TurnCompleted",
          turnId,
          resultSummary: turn.resultSummary ?? "Turn completed successfully",
          fileChanges: turn.fileChanges,
          timestamp: turn.finishedAt,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        turn.status = "failed";
        turn.error = message;
        turn.finishedAt = new Date().toISOString();
        this.store.updateJobState(turnId, "failed", message, turn.finishedAt);
        this.store.updateSessionStatus(sessionId, "failed", null, message);

        this.eventBus.emit(sessionId, turnId, {
          type: "RuntimeError",
          code: "TURN_FAILED",
          message,
          timestamp: turn.finishedAt,
        });
      } finally {
        this.runningTurns.delete(turnId);
        this.processQueue();
      }
    };

    if (this.runningTurns.size < this.maxConcurrentTurns) {
      // Execute immediately
      void runTask();
    } else {
      // Queue for backpressure
      this.turnQueue.push({ turn, execute: runTask });
    }

    return turn;
  }

  private processQueue(): void {
    while (this.runningTurns.size < this.maxConcurrentTurns && this.turnQueue.length > 0) {
      const next = this.turnQueue.shift();
      if (next) {
        void next.execute();
      }
    }
  }

  cancelTurn(turnId: string, reason = "Cancelled by user"): boolean {
    const job = this.store.getJob(turnId);
    if (!job) return false;

    if (job.status === "queued" || job.status === "running") {
      const now = new Date().toISOString();
      this.store.updateJobState(turnId, "cancelled", reason, now);
      this.store.updateSessionStatus(job.sessionId, "cancelled", null, reason);
      this.runningTurns.delete(turnId);

      this.eventBus.emit(job.sessionId, turnId, {
        type: "TurnCancelled",
        turnId,
        reason,
        timestamp: now,
      });

      this.audit.log({
        sessionId: job.sessionId,
        turnId,
        action: "turn.cancel",
        risk: "low",
        result: "ok",
        metadata: { reason },
      });

      this.processQueue();
      return true;
    }
    return false;
  }

  // Crash recovery reconciliation
  reconcileOnStartup(): { staleSessionsRecovered: number } {
    const sessions = this.store.listSessions(100);
    let count = 0;
    for (const sess of sessions) {
      if (sess.status === "running") {
        this.store.updateSessionStatus(sess.id, "stale", null, "Session marked stale after system restart");
        count++;
      }
    }
    return { staleSessionsRecovered: count };
  }
}
