// Phase 20.39 — Unified event bus (spec §12). Monotonic per-session
// sequences, idempotent ingestion (a duplicate sequence returns the already
// persisted envelope instead of writing again), replay from any last event
// id, and an in-memory fan-out for live SSE streams. Deltas are persisted as
// coalesced MessageCompleted records; only structural events hit the store
// (spec §12: avoid persisting token-by-token deltas indefinitely).

import type { AgentEventEnvelope, NormalizedAgentEvent } from "./types";
import type { CockpitStore } from "./store";

type LiveSink = (envelope: AgentEventEnvelope) => void;

/** Event types that are persisted verbatim; pure deltas are coalesced. */
const COALESCED_TYPES: ReadonlySet<string> = new Set(["MessageDelta"]);

export class CockpitEventBus {
  private live = new Map<string, Set<LiveSink>>();

  constructor(
    private readonly store: CockpitStore,
    private readonly metaFor: (sessionId: string) => { workspaceId: string; providerId: string } | null,
  ) {}

  /** Ingest one normalized event: assign the next monotonic sequence, dedupe
   *  on the (session_id, sequence) unique index (a racing duplicate returns
   *  the already persisted envelope), coalesce pure deltas for live streaming
   *  only, fan out to live subscribers. Returns the persisted envelope, the
   *  ephemeral delta envelope, or the pre-existing row on duplicate. */
  ingest(sessionId: string, runId: string | null, event: NormalizedAgentEvent, rawRef: string | null = null): AgentEventEnvelope | null {
    const meta = this.metaFor(sessionId);
    if (!meta) return null;

    if (COALESCED_TYPES.has(event.type)) {
      // Deltas are never persisted (spec §12); live subscribers still see
      // them for smooth streaming.
      const ephemeral = this.buildEnvelope(sessionId, meta, runId, event, rawRef, this.store.maxSequence(sessionId) + 1);
      this.fanOut(sessionId, ephemeral);
      return ephemeral;
    }

    const sequence = this.store.maxSequence(sessionId) + 1;
    let persisted: AgentEventEnvelope;
    try {
      persisted = this.store.insertEvent({ sessionId, runId, sequence, type: event.type, payload: event, rawRef });
    } catch (error) {
      // Unique violation on (session_id, sequence) = duplicate ingestion.
      const stored = this.store.findEventBySequence(sessionId, sequence);
      if (stored) return stored;
      throw error;
    }
    this.fanOut(sessionId, { ...persisted, workspaceId: meta.workspaceId, providerId: meta.providerId });
    return persisted;
  }

  /** Persist a completed-message record (deltas folded in by the caller). */
  persistCompleted(sessionId: string, runId: string | null, event: NormalizedAgentEvent): AgentEventEnvelope | null {
    return this.ingest(sessionId, runId, event, null);
  }

  private buildEnvelope(sessionId: string, meta: { workspaceId: string; providerId: string }, runId: string | null, event: NormalizedAgentEvent, rawRef: string | null, sequence: number): AgentEventEnvelope {
    return {
      id: "cev_" + sessionId.slice(4, 12) + "_" + sequence,
      sessionId,
      workspaceId: meta.workspaceId,
      providerId: meta.providerId,
      runId,
      sequence,
      type: event.type,
      timestamp: new Date().toISOString(),
      payload: event,
      rawRef,
    };
  }

  private fanOut(sessionId: string, envelope: AgentEventEnvelope): void {
    const sinks = this.live.get(sessionId);
    if (!sinks) return;
    for (const sink of sinks) {
      try {
        sink(envelope);
      } catch {
        // A dead SSE client must never break ingestion.
      }
    }
  }

  subscribe(sessionId: string, sink: LiveSink): () => void {
    const set = this.live.get(sessionId) ?? new Set<LiveSink>();
    set.add(sink);
    this.live.set(sessionId, set);
    return () => {
      const current = this.live.get(sessionId);
      if (!current) return;
      current.delete(sink);
      if (current.size === 0) this.live.delete(sessionId);
    };
  }

  connectionCount(sessionId: string): number {
    return this.live.get(sessionId)?.size ?? 0;
  }

  /** Replay from after the given sequence (SSE Last-Event-ID support). */
  replay(sessionId: string, afterSequence: number): AgentEventEnvelope[] {
    return this.store.listEvents(sessionId, afterSequence, 500);
  }
}
