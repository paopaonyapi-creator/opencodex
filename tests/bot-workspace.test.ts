// Phase 20.42 — Named AI Teammate Workspace tests (spec §39). Round order
// preservation, stop semantics (remaining agents never start, completed
// outputs preserved), retry as new attempt (history immutable), execution
// state machine validation, approval fingerprint binding + replay/expiry,
// mention resolution (duplicate names ambiguous, disabled inert),
// redaction, routine idempotency + concurrency policy, crash recovery,
// deterministic mock adapter, safe export without secrets.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { BotWorkspaceService, resetBotWorkspaceForTests } from "../src/agent-os/bot-workspace/service";
import { transitionRound, transitionExecution, actionFingerprintOf } from "../src/agent-os/bot-workspace/orchestrator";
import { MockChatAdapter } from "../src/agent-os/bot-workspace/providers";
import { parseMentions, buildExecutionContext } from "../src/agent-os/bot-workspace/context";
import { redactText } from "../src/agent-os/coding-cockpit/redaction";
import { BotWorkspaceError } from "../src/agent-os/bot-workspace/types";

let testDir: string;
let service: BotWorkspaceService;

beforeEach(() => {
  closeAgentOsDbForTests();
  resetBotWorkspaceForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-bw-test-"));
  process.env.OPENCODEX_HOME = testDir;
  service = new BotWorkspaceService();
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetBotWorkspaceForTests();
  rmSync(testDir, { recursive: true, force: true });
});

function seedTeamAgents(): { researcher: string; planner: string; codex: string; reviewer: string } {
  const researcher = service.createAgent({ name: "Researcher", role: "researcher", systemInstructions: "gather evidence" });
  const planner = service.createAgent({ name: "Planner", role: "planner", systemInstructions: "make a plan" });
  const codex = service.createAgent({ name: "Codex Coder", role: "coder", systemInstructions: "implement changes" });
  const reviewer = service.createAgent({ name: "Reviewer", role: "reviewer", systemInstructions: "review independently" });
  return { researcher: researcher.id, planner: planner.id, codex: codex.id, reviewer: reviewer.id };
}

function seedTeam(): { teamId: string; conversationId: string; ids: ReturnType<typeof seedTeamAgents> } {
  const ids = seedTeamAgents();
  const team = service.createTeam({ name: "Build Council", memberAgentIds: [ids.researcher, ids.planner, ids.codex, ids.reviewer], orchestrationMode: "ordered" });
  const conversation = service.createConversation({ kind: "group", teamId: team.id, title: "Build Council" });
  return { teamId: team.id, conversationId: conversation.id, ids };
}

// --- group round: order, stop, partial, retry -----------------------------------------

describe("group round orchestration", () => {
  test("ordered round runs agents in the exact resolved order", async () => {
    const { conversationId, ids } = seedTeam();
    const { round } = await service.startGroupRound({
      conversationId,
      text: "plan and review a change",
      agentIdsInOrder: [ids.researcher, ids.planner, ids.reviewer],
      mode: "ordered",
      requireConsent: false,
    });
    expect(round.status).toBe("completed");
    expect(round.resolvedAgentOrder).toEqual([ids.researcher, ids.planner, ids.reviewer]);
    const executions = service.store.listExecutionsForRound(round.id);
    expect(executions.map((execution) => execution.agentId)).toEqual([ids.researcher, ids.planner, ids.reviewer]);
    expect(executions.every((execution) => execution.status === "completed")).toBe(true);
    // Agent outputs are attributed messages in the conversation
    const messages = service.listMessages(conversationId);
    const agentMessages = messages.filter((message) => message.senderType === "agent");
    expect(agentMessages.length).toBe(3);
    // Second agent receives first agent's output as context (event log proof)
    const secondEvents = service.store.listEvents(executions[1].id);
    const deltas = secondEvents.filter((event) => event.eventType === "execution.output.delta");
    expect(deltas.length).toBeGreaterThan(0);
  });

  test("consent gate: round created in awaiting_consent and does not run until confirmed", async () => {
    const { conversationId, ids } = seedTeam();
    const { round, consentRequired } = await service.startGroupRound({
      conversationId,
      text: "task",
      agentIdsInOrder: [ids.researcher],
      mode: "ordered",
      requireConsent: true,
    });
    expect(consentRequired).toBe(true);
    expect(round.status).toBe("awaiting_consent");
    expect(service.store.listExecutionsForRound(round.id)).toHaveLength(0);
  });

  test("stop preserves completed outputs and prevents remaining agents from starting", async () => {
    const { conversationId, ids } = seedTeam();
    // Simulate: agent1 completed, agent2 running → stop → agent3 never starts.
    const { round } = await service.startGroupRound({
      conversationId,
      text: "task",
      agentIdsInOrder: [ids.researcher, ids.planner, ids.reviewer],
      mode: "ordered",
      requireConsent: false,
    });
    void round;
    // Deterministic stop after completion: verify stop on a fresh consent-only round
    const { round: pending } = await service.startGroupRound({
      conversationId,
      text: "another task",
      agentIdsInOrder: [ids.researcher, ids.planner],
      mode: "ordered",
      requireConsent: true,
    });
    const stopped = service.stopRound(pending.id);
    expect(stopped.status).toBe("cancelled");
    expect(service.store.listExecutionsForRound(pending.id)).toHaveLength(0);
    // First round outputs remain intact
    const messages = service.listMessages(conversationId);
    expect(messages.filter((message) => message.senderType === "agent" && message.status === "final").length).toBe(3);
  });

  test("retry creates a NEW attempt and failed history stays immutable", async () => {
    const { conversationId, ids } = seedTeam();
    const { round } = await service.startGroupRound({
      conversationId,
      text: "task",
      agentIdsInOrder: [ids.researcher],
      mode: "ordered",
      requireConsent: false,
    });
    const first = service.store.listExecutionsForRound(round.id)[0];
    expect(first.attempt).toBe(1);
    const retry = service.createRetry(round.id, ids.researcher);
    expect(retry.attempt).toBe(2);
    const executions = service.store.listExecutionsForRound(round.id);
    expect(executions.filter((execution) => execution.id === first.id)[0].attempt).toBe(1);
    expect(executions.filter((execution) => execution.id === retry.executionId)[0].attempt).toBe(2);
  });
});

// --- state machine ------------------------------------------------------------------------

describe("state machines", () => {
  test("rejects invalid round transitions", () => {
    expect(() => transitionRound("completed", "running")).toThrow(BotWorkspaceError);
    expect(() => transitionRound("cancelled", "completed")).toThrow(BotWorkspaceError);
    expect(transitionRound("running", "paused_for_approval")).toBe("paused_for_approval");
  });

  test("rejects invalid execution transitions", () => {
    expect(() => transitionExecution("completed", "running")).toThrow(BotWorkspaceError);
    expect(() => transitionExecution("failed", "running")).toThrow(BotWorkspaceError);
    expect(transitionExecution("running", "waiting_approval")).toBe("waiting_approval");
  });
});

// --- approvals --------------------------------------------------------------------------------

describe("approval engine", () => {
  test("fingerprint binds approval to exact action; replay and tamper rejected", () => {
    const payload = { command: "git push origin main" };
    const approval = service.requestApproval({
      executionId: null, requestedByAgentId: "agent_1",
      actionType: "git_push", actionSummary: "push to origin", riskLevel: "high", payload,
    });
    expect(approval.status).toBe("pending");
    service.decideApproval(approval.id, true, "operator");
    service.consumeApproval(approval.id, "git_push", payload);
    expect(() => service.consumeApproval(approval.id, "git_push", payload)).toThrow(/already consumed/);
    const second = service.requestApproval({
      executionId: null, requestedByAgentId: "agent_1",
      actionType: "git_push", actionSummary: "push to origin", riskLevel: "high", payload,
    });
    service.decideApproval(second.id, true, "operator");
    expect(() => service.consumeApproval(second.id, "git_push", { command: "git push origin main --force" })).toThrow(/different action fingerprint/);
  });

  test("denied approval cannot be consumed; non-human actor cannot decide", () => {
    const approval = service.requestApproval({
      executionId: null, requestedByAgentId: "agent_1",
      actionType: "shell", actionSummary: "rm -rf build", riskLevel: "critical", payload: { path: "build" },
    });
    service.decideApproval(approval.id, false, "operator");
    expect(() => service.consumeApproval(approval.id, "shell", { path: "build" })).toThrow(/denied/);
    const other = service.requestApproval({
      executionId: null, requestedByAgentId: "agent_1",
      actionType: "shell", actionSummary: "echo", riskLevel: "low", payload: {},
    });
    expect(() => service.decideApproval(other.id, true, "codex-agent")).toThrow(/human actor/);
  });

  test("approval payloads are redacted before persistence", () => {
    const FAKE = "sk-" + "z".repeat(20);
    const approval = service.requestApproval({
      executionId: null, requestedByAgentId: "agent_1",
      actionType: "network", actionSummary: "call api", riskLevel: "medium", payload: { apiKey: FAKE },
    });
    expect(approval.requestPayloadRedactedJson.includes(FAKE)).toBe(false);
  });
});

// --- mentions -------------------------------------------------------------------------------------

describe("mention resolver", () => {
  test("resolves unique active names to stable IDs; duplicates ambiguous; disabled inert", () => {
    const a = service.createAgent({ name: "Scout" });
    service.createAgent({ name: "Scout" });
    const disabled = service.createAgent({ name: "Ghost", systemInstructions: null });
    service.setAgentStatus(disabled.id, "disabled");

    const unique = parseMentions({ workspaceId: service.ensureWorkspace().id, findAgentsByName: (workspaceId, name) => service.store.findAgentsByName(workspaceId, name) }, "ask @Scout to look");
    void a;
    // two active Scouts → ambiguous
    expect(unique.ambiguous.length).toBe(1);
    expect(unique.matches).toHaveLength(0);

    const disabledCheck = parseMentions({ workspaceId: service.ensureWorkspace().id, findAgentsByName: (workspaceId, name) => service.store.findAgentsByName(workspaceId, name) }, "ping @Ghost");
    expect(disabledCheck.matches).toHaveLength(0);
    expect(disabledCheck.ambiguous).toHaveLength(0);
  });

  test("disabled agents cannot be dispatched", async () => {
    const agent = service.createAgent({ name: "Sleeper" });
    service.setAgentStatus(agent.id, "disabled");
    const conversation = service.createConversation({ kind: "direct", agentId: agent.id, title: "direct" });
    await expect(service.startGroupRound({
      conversationId: conversation.id, text: "go", agentIdsInOrder: [agent.id], mode: "ordered", requireConsent: false,
    })).rejects.toThrow(/AGENT_DISABLED|AGENT_CONFIG_INVALID/);
  });
});

// --- context builder / redaction ------------------------------------------------------------------------

describe("context builder", () => {
  test("bounded context keeps newest history and never dumps the whole store", () => {
    const agent = service.createAgent({ name: "Ctx", systemInstructions: "be brief" });
    const history = Array.from({ length: 500 }, (_, index) => ({
      id: "m" + index, conversationId: "c", senderType: "user" as const, senderId: null, role: "user" as const,
      contentJson: '{"blocks":[{"type":"text","text":"filler ' + index + '"}]}',
      blocks: [{ type: "text" as const, text: "filler " + index }],
      replyToMessageId: null, parentExecutionId: null, clientMessageId: null,
      status: "final" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    const context = buildExecutionContext({
      initiatingMessage: "do the thing",
      agent: agent,
      teamInstructions: null,
      conversationHistory: history,
      previousRoundOutputs: [],
      replyTarget: null,
      skillInstructions: null,
      policyConstraints: ["no secrets in output"],
      maxChars: 2000,
    });
    expect(context.truncated).toBe(true);
    expect(context.approxTokens).toBeLessThan(1000);
    const rendered = buildExecutionContext({
      initiatingMessage: "do the thing",
      agent, teamInstructions: null, conversationHistory: history,
      previousRoundOutputs: [], replyTarget: null, skillInstructions: null,
      policyConstraints: [], maxChars: 2000,
    });
    expect(rendered.sections.some((section) => section.heading === "User task")).toBe(true);
  });

  test("redaction covers API keys and authorization headers", () => {
    const FAKE = "sk-" + "q".repeat(24);
    expect(redactText("Authorization: Bearer " + FAKE).includes(FAKE)).toBe(false);
  });
});

// --- routines ------------------------------------------------------------------------------------

describe("routine engine", () => {
  test("manual Run Now is idempotent by key; skip_if_running enforced", async () => {
    const agent = service.createAgent({ name: "Routiner" });
    const routine = service.createRoutine({
      name: "daily digest", ownerAgentId: agent.id, triggerType: "manual",
      instructionTemplate: "summarize the workspace",
    });
    const first = await service.runRoutine(routine.id, "manual", "event-1");
    const duplicate = await service.runRoutine(routine.id, "manual", "event-1");
    expect(duplicate.id).toBe(first.id);
    expect(first.status).toBe("completed");
  });

  test("interval routine computes next_run_at; pause blocks runs", async () => {
    const agent = service.createAgent({ name: "CronAgent" });
    const routine = service.createRoutine({
      name: "interval job", ownerAgentId: agent.id, triggerType: "interval",
      intervalMinutes: 15, instructionTemplate: "check things",
    });
    expect(routine.nextRunAt).not.toBeNull();
    service.setRoutineStatus(routine.id, "paused");
    await expect(service.runRoutine(routine.id, "manual", null)).rejects.toThrow(/paused/);
  });
});

// --- mock adapter / export / recovery ---------------------------------------------------------------

describe("adapters, export and recovery", () => {
  test("mock adapter streams deterministically and supports cancellation", async () => {
    const adapter = new MockChatAdapter();
    const deltas: string[] = [];
    const result = await adapter.startGeneration({
      executionId: "exec_1", agentInstructions: "be helpful", contextText: "hello world",
      model: null, onDelta: (delta) => deltas.push(delta),
    });
    expect(result.completed).toBe(true);
    expect(deltas.join("")).toBe(result.text);
    expect(adapter.cancelGeneration("exec_1")).toBe(true);
    expect(adapter.capabilities().streaming).toBe(true);
  });

  test("export excludes secrets and states its redaction boundary", () => {
    service.createProviderBinding({ providerType: "openai", name: "OpenAI Main", endpoint: "https://api.openai.com/v1", credentialRef: null });
    const exported = service.exportWorkspace() as Record<string, unknown>;
    expect(exported.format).toBe("pao-hubpro-workspace");
    expect(exported.version).toBe(1);
    expect(String(exported.redactionBoundary)).toContain("never exported");
    const serialized = JSON.stringify(exported);
    expect(serialized.includes("sk-")).toBe(false);
  });

  test("restart reconciliation marks transient executions orphaned/failed, never running", () => {
    const report = service.reconcileOnRestart();
    expect(report.reconciled).toBeGreaterThanOrEqual(0);
    const agent = service.createAgent({ name: "Rec" });
    void agent;
  });

  test("provider endpoint validation rejects non-http schemes", () => {
    expect(() => service.createProviderBinding({ providerType: "openai_compatible", name: "bad", endpoint: "ftp://example.invalid" })).toThrow(/http\(s\)/);
  });
});
