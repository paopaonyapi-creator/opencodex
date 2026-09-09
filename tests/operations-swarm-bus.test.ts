import { describe, expect, test } from "bun:test";
import { SwarmBus } from "../src/agent-os/operations/swarm-bus";

describe("Phase 23 — SwarmBus", () => {
  test("publishes messages to a topic and stores in history", () => {
    const bus = new SwarmBus();
    const msg = bus.publish("stock_campaign", "agent-planner", { campaignId: "c-01" }, "corr-123");

    expect(msg.topic).toBe("stock_campaign");
    expect(msg.senderAgentId).toBe("agent-planner");
    expect(msg.payload.campaignId).toBe("c-01");
    expect(msg.correlationId).toBe("corr-123");
    expect(msg.timestamp).toBeGreaterThan(0);

    const history = bus.getRecentMessages();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(msg.id);
  });

  test("dispatches messages to active subscribers", () => {
    const bus = new SwarmBus();
    const received: string[] = [];

    const unsubscribe = bus.subscribe("code_worktree", (m) => {
      received.push(m.senderAgentId);
    });

    bus.publish("code_worktree", "agent-coder", { file: "test.ts" });
    bus.publish("code_worktree", "agent-reviewer", { approved: true });
    bus.publish("other_topic", "agent-other", {});

    expect(received).toEqual(["agent-coder", "agent-reviewer"]);

    // Unsubscribe
    unsubscribe();
    bus.publish("code_worktree", "agent-late", {});
    expect(received.length).toBe(2);
  });

  test("filters recent messages by topic and trims history to max limit", () => {
    const bus = new SwarmBus(5);

    for (let i = 1; i <= 8; i++) {
      bus.publish(i % 2 === 0 ? "topic_even" : "topic_odd", `agent-${i}`, { index: i });
    }

    const all = bus.getRecentMessages();
    expect(all.length).toBe(5); // capped at maxHistory 5

    const evens = bus.getRecentMessages("topic_even");
    expect(evens.every((m) => m.topic === "topic_even")).toBe(true);
  });

  test("clears messages and subscriptions", () => {
    const bus = new SwarmBus();
    bus.publish("t1", "a1", {});
    expect(bus.getRecentMessages().length).toBe(1);

    bus.clear();
    expect(bus.getRecentMessages().length).toBe(0);
  });
});
