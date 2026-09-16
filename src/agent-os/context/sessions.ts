/**
 * Pao Context Control Plane — session bindings + cross-agent handoffs
 * (Phase 20.53 §24-25, §37).
 *
 * A Pao conversation binds to exactly one OpenViking session per agent run
 * policy; commit is request-idempotent and its processing task is polled.
 * Handoffs carry URI references — never full conversation copies.
 */

import { nextId } from "./events";
import type { AgentHandoffPackage, ContextSessionBinding } from "./types";
import type { ContextDbStore } from "./db-store";
import type { OpenVikingAdapter } from "./adapter/openviking";

export interface SessionServiceDeps {
  readonly store: ContextDbStore;
  readonly adapter: OpenVikingAdapter;
  readonly now?: () => Date;
}

export class ContextSessionService {
  private readonly store: ContextDbStore;
  private readonly adapter: OpenVikingAdapter;
  private readonly now: () => Date;

  constructor(deps: SessionServiceDeps) {
    this.store = deps.store;
    this.adapter = deps.adapter;
    this.now = deps.now ?? (() => new Date());
  }

  async createSession(input: {
    paoConversationId: string;
    paoRunId?: string;
    userId: string;
    workspaceId?: string;
    agentId: string;
    peerId?: string;
    memoryPolicyId: string;
  }): Promise<ContextSessionBinding> {
    const { sessionId } = await this.adapter.createSession({ userId: input.userId, peerId: input.peerId });
    const ts = this.now().toISOString();
    const binding: ContextSessionBinding = {
      id: nextId("ctxsb"),
      paoConversationId: input.paoConversationId,
      paoRunId: input.paoRunId,
      openVikingSessionId: sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      peerId: input.peerId,
      memoryPolicyId: input.memoryPolicyId,
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.saveSessionBinding(binding);
    return binding;
  }

  async appendMessage(bindingId: string, role: "user" | "assistant" | "tool", content: string): Promise<void> {
    const binding = this.store.getSessionBinding(bindingId);
    if (!binding) throw new Error("CTX_SESSION_NOT_FOUND");
    await this.adapter.appendSessionMessage(binding.openVikingSessionId, { role, content });
  }

  /** Commit is idempotent per binding: committing twice returns the record. */
  async commit(bindingId: string): Promise<ContextSessionBinding> {
    const binding = this.store.getSessionBinding(bindingId);
    if (!binding) throw new Error("CTX_SESSION_NOT_FOUND");
    if (binding.status === "committed") return binding;
    if (binding.status === "committing") {
      // A commit is already in flight; do not double-submit.
      return binding;
    }
    this.store.updateSessionBindingStatus(bindingId, "committing");
    try {
      await this.adapter.commitSession(binding.openVikingSessionId);
      this.store.updateSessionBindingStatus(bindingId, "committed");
      return this.store.getSessionBinding(bindingId)!;
    } catch (err) {
      this.store.updateSessionBindingStatus(bindingId, "failed");
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export interface HandoffServiceDeps {
  readonly store: ContextDbStore;
  readonly now?: () => Date;
}

export class HandoffService {
  private readonly store: ContextDbStore;
  private readonly now: () => Date;

  constructor(deps: HandoffServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  create(input: {
    fromAgentId: string;
    toAgentId: string;
    userId: string;
    workspaceId?: string;
    summary: string;
    contextRefs: ReadonlyArray<{ uri: string; level: "L0" | "L1" | "L2" }>;
    pendingActions?: readonly string[];
    constraints?: readonly string[];
    provenance?: readonly string[];
    ttlMinutes?: number;
  }): AgentHandoffPackage {
    const ts = this.now();
    const handoff: AgentHandoffPackage = {
      id: nextId("ctxh"),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      summary: input.summary,
      contextRefs: input.contextRefs,
      pendingActions: input.pendingActions ?? [],
      constraints: input.constraints ?? [],
      provenance: input.provenance ?? [],
      expiresAt: input.ttlMinutes ? new Date(ts.getTime() + input.ttlMinutes * 60_000).toISOString() : undefined,
      createdAt: ts.toISOString(),
    };
    this.store.saveHandoff(handoff);
    return handoff;
  }

  /** Consuming a handoff validates the target agent and expiry. */
  consume(handoffId: string, requestingAgentId: string): AgentHandoffPackage {
    const handoff = this.store.getHandoff(handoffId);
    if (!handoff) throw new Error("CTX_HANDOFF_NOT_FOUND");
    if (handoff.toAgentId !== requestingAgentId) {
      throw new Error("CTX_HANDOFF_FORBIDDEN: handoff is addressed to another agent");
    }
    if (handoff.expiresAt && this.now().getTime() >= Date.parse(handoff.expiresAt)) {
      throw new Error("CTX_HANDOFF_EXPIRED");
    }
    return handoff;
  }
}
