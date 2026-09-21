// Phase 20.99 — Unified Agent Fleet & Transcript Projection (§8, §9, §10).
//
// Key principles:
// - Aggregates agents across hosts and runtimes (Codex, OpenCode, Pao Native, OpenHermit).
// - Attention ordering: waiting_approval > blocked > error > done > working > idle > offline.
// - Transcript and Terminal point to the exact same underlying process/session identity.
// - Reconnect retains existing transcript without clearing history; marks state stale if offline.

import { newWhipId, nowIso, WhipStore } from "./store";
import {
  type TranscriptTurn,
  type WhipAgentStatus,
  type WhipAgentSummary,
  type WhipTranscript,
  WhipError,
} from "./types";

export const ATTENTION_ORDER: Record<WhipAgentStatus, number> = {
  waiting_approval: 0,
  blocked: 1,
  error: 2,
  done: 3,
  working: 4,
  idle: 5,
  offline: 6,
  unknown: 7,
};

export class UnifiedFleetManager {
  private readonly store: WhipStore;
  private readonly liveAgents = new Map<string, WhipAgentSummary>();

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  registerAgent(summary: WhipAgentSummary): void {
    this.liveAgents.set(`${summary.hostId}:${summary.agentId}`, summary);
  }

  listFleet(filter?: { hostId?: string; status?: WhipAgentStatus }): WhipAgentSummary[] {
    let list = Array.from(this.liveAgents.values());
    if (filter?.hostId) {
      list = list.filter((a) => a.hostId === filter.hostId);
    }
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }

    // Sort by attention priority (§8)
    return list.sort((a, b) => {
      const pA = ATTENTION_ORDER[a.status] ?? 99;
      const pB = ATTENTION_ORDER[b.status] ?? 99;
      return pA - pB;
    });
  }

  // -------------------------------------------------------------------------
  // Transcript Projection (§10)
  // -------------------------------------------------------------------------

  /**
   * Bind and return transcript for an active agent session.
   * Both Chat and Terminal must reference the exact same sessionId.
   */
  getOrCreateTranscript(agentId: string, sessionId: string, runtime = "codex"): WhipTranscript {
    const existing = this.store.getTranscript(agentId, sessionId);
    if (existing) return existing;

    const transcript: WhipTranscript = {
      id: newWhipId("whptr"),
      agentId,
      sessionId,
      runtime,
      revision: 1,
      sourceState: "live",
      turns: [],
      checkpoint: null,
      updatedAt: nowIso(),
    };
    this.store.upsertTranscript(transcript);
    return transcript;
  }

  appendTurn(
    agentId: string,
    sessionId: string,
    turn: Omit<TranscriptTurn, "id" | "turnNumber" | "timestamp">,
  ): WhipTranscript {
    const tr = this.getOrCreateTranscript(agentId, sessionId);
    const nextTurnNumber = tr.turns.length + 1;
    const fullTurn: TranscriptTurn = {
      ...turn,
      id: `turn_${nextTurnNumber}`,
      turnNumber: nextTurnNumber,
      timestamp: nowIso(),
    };

    tr.turns.push(fullTurn);
    tr.revision += 1;
    tr.updatedAt = nowIso();

    this.store.upsertTranscript(tr);
    return tr;
  }

  /**
   * Mark transcript state on network loss (retains content, sets stale).
   */
  markTranscriptStale(agentId: string, sessionId: string): WhipTranscript {
    const tr = this.getOrCreateTranscript(agentId, sessionId);
    tr.sourceState = "stale";
    tr.updatedAt = nowIso();
    this.store.upsertTranscript(tr);
    return tr;
  }
}
