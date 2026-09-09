import { describe, expect, test } from "bun:test";
import { QuarantineGuard } from "../src/agent-os/security/quarantine-guard";

describe("Phase 25 — QuarantineGuard", () => {
  test("starts agent in active state with allowance", () => {
    const guard = new QuarantineGuard();
    const allowance = guard.isAgentAllowed("agent-test-1");

    expect(allowance.allowed).toBe(true);
    expect(allowance.state).toBe("active");
  });

  test("immediately isolates agent into quarantine upon a single critical violation", () => {
    const guard = new QuarantineGuard();
    const agentId = "agent-critical-violator";

    guard.recordIncident(agentId, "critical", 0.99, "Destructive command injection attempt");

    const allowance = guard.isAgentAllowed(agentId);
    expect(allowance.allowed).toBe(false);
    expect(allowance.state).toBe("quarantined");
    expect(allowance.reason).toContain("Autonomous quarantine triggered: critical violation");
  });

  test("accumulates high severity violations and quarantines after threshold of 3", () => {
    const guard = new QuarantineGuard(10 * 60 * 1000);
    const agentId = "agent-repeat-offender";

    // 1st High violation -> moves to monitored
    guard.recordIncident(agentId, "high", 0.85, "Prompt injection attempt 1");
    expect(guard.isAgentAllowed(agentId).allowed).toBe(true);
    expect(guard.isAgentAllowed(agentId).state).toBe("monitored");

    // 2nd High violation -> remains monitored
    guard.recordIncident(agentId, "high", 0.85, "Prompt injection attempt 2");
    expect(guard.isAgentAllowed(agentId).allowed).toBe(true);
    expect(guard.isAgentAllowed(agentId).state).toBe("monitored");

    // 3rd High violation -> triggers autonomous quarantine
    guard.recordIncident(agentId, "high", 0.88, "Prompt injection attempt 3");
    const afterThird = guard.isAgentAllowed(agentId);
    expect(afterThird.allowed).toBe(false);
    expect(afterThird.state).toBe("quarantined");
    expect(afterThird.reason).toContain("accumulated 3 high-severity violations");
  });

  test("supports manual quarantine and release operator lifecycle", () => {
    const guard = new QuarantineGuard();
    const agentId = "agent-operator-test";

    // Quarantine manually
    guard.quarantineAgent(agentId, "Manual security audit requested by operator");
    let status = guard.isAgentAllowed(agentId);
    expect(status.allowed).toBe(false);
    expect(status.state).toBe("quarantined");

    // Release back to active
    guard.releaseAgent(agentId);
    status = guard.isAgentAllowed(agentId);
    expect(status.allowed).toBe(true);
    expect(status.state).toBe("active");
  });

  test("supports permanent agent revocation", () => {
    const guard = new QuarantineGuard();
    const agentId = "agent-rogue-compromised";

    guard.revokeAgent(agentId, "Compromised credential reported");
    const status = guard.isAgentAllowed(agentId);

    expect(status.allowed).toBe(false);
    expect(status.state).toBe("revoked");
    expect(status.reason).toContain("revoked permanently");
  });
});
