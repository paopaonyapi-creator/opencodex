// Phase 20.98 — In-memory fake OpenHermit provider for deterministic offline testing.
// Implements the HermitRuntimeProvider contract without real network calls.

import type {
  HermitEventEnvelope,
  HermitHealth,
  HermitRemoteAgent,
  HermitRemoteSession,
  HermitRuntimeProvider,
} from "./types";

export interface FakeHermitOptions {
  healthStatus?: HermitHealth;
  version?: string;
  capabilities?: string[];
  failNextCall?: string;
}

export class FakeHermitProvider implements HermitRuntimeProvider {
  readonly provider = "openhermit-fake";

  private healthStatus: HermitHealth;
  private version: string;
  private capabilities: string[];
  private failNext: string | null = null;

  readonly agents = new Map<string, HermitRemoteAgent>();
  readonly sessions = new Map<string, HermitRemoteSession>();
  readonly messages = new Map<string, string[]>();
  readonly checkpoints = new Map<string, unknown>();
  readonly events: HermitEventEnvelope[] = [];

  constructor(opts: FakeHermitOptions = {}) {
    this.healthStatus = opts.healthStatus ?? "healthy";
    this.version = opts.version ?? "1.4.2";
    this.capabilities = opts.capabilities ?? [
      "agent.lifecycle",
      "agent.status",
      "session.create",
      "session.message",
      "events",
      "streaming",
      "checkpoint",
      "resume",
      "sandbox",
      "skills",
      "mcp",
      "research",
    ];
    this.failNext = opts.failNextCall ?? null;
  }

  setHealth(health: HermitHealth): void {
    this.healthStatus = health;
  }

  setFailNext(method: string | null): void {
    this.failNext = method;
  }

  private checkFailure(method: string): void {
    if (this.failNext === method) {
      this.failNext = null;
      throw new Error(`simulated failure in ${method}`);
    }
  }

  async health(): Promise<{ health: HermitHealth; version: string | null; capabilities: string[]; message?: string }> {
    this.checkFailure("health");
    return {
      health: this.healthStatus,
      version: this.version,
      capabilities: [...this.capabilities],
    };
  }

  async createAgent(input: {
    name: string;
    instruction: string;
    skills?: string[];
    mcpServers?: string[];
  }): Promise<{ runtimeAgentId: string }> {
    this.checkFailure("createAgent");
    const runtimeAgentId = `hermit_agent_${crypto.randomUUID().slice(0, 8)}`;
    this.agents.set(runtimeAgentId, {
      runtimeAgentId,
      state: "stopped",
      health: "healthy",
    });
    this.recordEvent("agent.created", { runtimeAgentId, name: input.name });
    return { runtimeAgentId };
  }

  async startAgent(runtimeAgentId: string): Promise<{ state: string }> {
    this.checkFailure("startAgent");
    const a = this.agents.get(runtimeAgentId);
    if (!a) throw new Error(`agent not found: ${runtimeAgentId}`);
    a.state = "running";
    this.recordEvent("agent.started", { runtimeAgentId });
    return { state: "running" };
  }

  async stopAgent(runtimeAgentId: string, reason: string): Promise<{ state: string }> {
    this.checkFailure("stopAgent");
    const a = this.agents.get(runtimeAgentId);
    if (!a) throw new Error(`agent not found: ${runtimeAgentId}`);
    a.state = "stopped";
    this.recordEvent("agent.stopped", { runtimeAgentId, reason });
    return { state: "stopped" };
  }

  async restartAgent(runtimeAgentId: string): Promise<{ state: string }> {
    this.checkFailure("restartAgent");
    const a = this.agents.get(runtimeAgentId);
    if (!a) throw new Error(`agent not found: ${runtimeAgentId}`);
    a.state = "running";
    this.recordEvent("agent.restarted", { runtimeAgentId });
    return { state: "running" };
  }

  async getAgent(runtimeAgentId: string): Promise<HermitRemoteAgent | null> {
    this.checkFailure("getAgent");
    return this.agents.get(runtimeAgentId) ?? null;
  }

  async deleteAgent(runtimeAgentId: string): Promise<void> {
    this.checkFailure("deleteAgent");
    this.agents.delete(runtimeAgentId);
    this.recordEvent("agent.deleted", { runtimeAgentId });
  }

  async createSession(runtimeAgentId: string, input: { traceId: string }): Promise<{ runtimeSessionId: string }> {
    this.checkFailure("createSession");
    const runtimeSessionId = `hermit_sess_${crypto.randomUUID().slice(0, 8)}`;
    this.sessions.set(runtimeSessionId, {
      runtimeSessionId,
      state: "active",
    });
    this.messages.set(runtimeSessionId, []);
    this.recordEvent("session.created", { runtimeAgentId, runtimeSessionId, traceId: input.traceId });
    return { runtimeSessionId };
  }

  async sendMessage(runtimeSessionId: string, message: string): Promise<{ accepted: boolean }> {
    this.checkFailure("sendMessage");
    const s = this.sessions.get(runtimeSessionId);
    if (!s) throw new Error(`session not found: ${runtimeSessionId}`);
    const list = this.messages.get(runtimeSessionId) ?? [];
    list.push(message);
    this.messages.set(runtimeSessionId, list);
    this.recordEvent("session.message", { runtimeSessionId, messageLength: message.length });
    return { accepted: true };
  }

  async getSession(runtimeSessionId: string): Promise<HermitRemoteSession | null> {
    this.checkFailure("getSession");
    return this.sessions.get(runtimeSessionId) ?? null;
  }

  async checkpointSession(runtimeSessionId: string): Promise<{ checkpoint: unknown }> {
    this.checkFailure("checkpointSession");
    const s = this.sessions.get(runtimeSessionId);
    if (!s) throw new Error(`session not found: ${runtimeSessionId}`);
    const cp = {
      runtimeSessionId,
      messages: (this.messages.get(runtimeSessionId) ?? []).length,
      timestamp: new Date().toISOString(),
    };
    this.checkpoints.set(runtimeSessionId, cp);
    this.recordEvent("session.checkpoint", { runtimeSessionId });
    return { checkpoint: cp };
  }

  async resumeSession(runtimeSessionId: string): Promise<{ state: string }> {
    this.checkFailure("resumeSession");
    const s = this.sessions.get(runtimeSessionId);
    if (!s) throw new Error(`session not found: ${runtimeSessionId}`);
    s.state = "active";
    this.recordEvent("session.resumed", { runtimeSessionId });
    return { state: "active" };
  }

  async closeSession(runtimeSessionId: string): Promise<void> {
    this.checkFailure("closeSession");
    const s = this.sessions.get(runtimeSessionId);
    if (s) s.state = "closed";
    this.recordEvent("session.closed", { runtimeSessionId });
  }

  async listEvents(input: { runtimeAgentId?: string; since?: string }): Promise<HermitEventEnvelope[]> {
    this.checkFailure("listEvents");
    return this.events.filter((e) => {
      if (input.runtimeAgentId && e.agentId !== input.runtimeAgentId) return false;
      if (input.since && e.occurredAt < input.since) return false;
      return true;
    });
  }

  private recordEvent(type: string, payload: Record<string, unknown>): void {
    this.events.push({
      type,
      occurredAt: new Date().toISOString(),
      agentId: typeof payload.runtimeAgentId === "string" ? payload.runtimeAgentId : undefined,
      sessionId: typeof payload.runtimeSessionId === "string" ? payload.runtimeSessionId : undefined,
      payload,
    });
  }
}
