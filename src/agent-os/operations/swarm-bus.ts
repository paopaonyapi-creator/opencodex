/**
 * Phase 23 — Pao Autonomous Operations: Swarm Bus
 * Event communication bus enabling multi-agent coordination across heterogeneous fleets.
 */

import type { SwarmMessage } from "./types";

export type SwarmSubscriber = (message: SwarmMessage) => Promise<void> | void;

export class SwarmBus {
  private subscribers: Map<string, Set<SwarmSubscriber>> = new Map();
  private messageHistory: SwarmMessage[] = [];
  private maxHistory: number;

  constructor(maxHistory = 200) {
    this.maxHistory = maxHistory;
  }

  /**
   * Publish message to a swarm topic
   */
  public publish(
    topic: string,
    senderAgentId: string,
    payload: Record<string, unknown>,
    correlationId?: string
  ): SwarmMessage {
    const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const message: SwarmMessage = {
      id,
      topic,
      senderAgentId,
      payload,
      timestamp: Date.now(),
      correlationId,
    };

    this.messageHistory.unshift(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.pop();
    }

    const handlers = this.subscribers.get(topic);
    if (handlers) {
      for (const handler of handlers) {
        try {
          void handler(message);
        } catch {
          // preserve bus safety
        }
      }
    }

    return message;
  }

  /**
   * Subscribe to a topic
   */
  public subscribe(topic: string, handler: SwarmSubscriber): () => void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }

    this.subscribers.get(topic)!.add(handler);

    return () => {
      this.subscribers.get(topic)?.delete(handler);
    };
  }

  /**
   * Get recent messages
   */
  public getRecentMessages(topic?: string, limit = 50): SwarmMessage[] {
    if (topic) {
      return this.messageHistory.filter((m) => m.topic === topic).slice(0, limit);
    }
    return this.messageHistory.slice(0, limit);
  }

  public clear(): void {
    this.messageHistory = [];
    this.subscribers.clear();
  }
}
