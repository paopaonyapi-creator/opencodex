// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Normalized Event Bus for Realtime Streaming & Subscriber Management.

import { EventEmitter } from "node:events";
import { CodexRuntimeStore } from "./store";
import type { PaoRuntimeEvent } from "./types";

export type EventCallback = (event: PaoRuntimeEvent) => void;

export class CodexEventBus {
  private emitter = new EventEmitter();
  private store: CodexRuntimeStore;

  constructor(store = new CodexRuntimeStore()) {
    this.store = store;
    this.emitter.setMaxListeners(100);
  }

  emit(sessionId: string, turnId: string | null, event: PaoRuntimeEvent): void {
    // 1. Persist to store
    try {
      this.store.recordEvent(sessionId, turnId, event);
    } catch {
      // ignore persistence error in non-critical paths
    }

    // 2. Emit to session listeners and global listeners
    this.emitter.emit(`session:${sessionId}`, event);
    this.emitter.emit("all", { sessionId, turnId, event });
  }

  subscribeSession(sessionId: string, callback: EventCallback): () => void {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }

  subscribeAll(callback: (payload: { sessionId: string; turnId: string | null; event: PaoRuntimeEvent }) => void): () => void {
    this.emitter.on("all", callback);
    return () => {
      this.emitter.off("all", callback);
    };
  }

  async *streamSession(sessionId: string, abortSignal?: AbortSignal): AsyncIterable<PaoRuntimeEvent> {
    const queue: PaoRuntimeEvent[] = [];
    let resolver: (() => void) | null = null;
    let done = false;

    const push = (ev: PaoRuntimeEvent) => {
      queue.push(ev);
      if (resolver) {
        resolver();
        resolver = null;
      }
      if (ev.type === "TurnCompleted" || ev.type === "TurnCancelled" || ev.type === "RuntimeDisconnected") {
        done = true;
      }
    };

    const unsubscribe = this.subscribeSession(sessionId, push);

    const onAbort = () => {
      done = true;
      if (resolver) resolver();
    };
    abortSignal?.addEventListener("abort", onAbort);

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolver = r;
          });
        }
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    } finally {
      unsubscribe();
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }
}
