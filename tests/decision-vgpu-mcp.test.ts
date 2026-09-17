/**
 * Phase 20.84 / 20.64 — MCP Tool Surface Tests
 */

import { describe, expect, it } from "bun:test";
import { createDecisionMcpTools } from "../src/agent-os/decision/mcp-tools";
import { handleVgpuToolCall, VGPU_MCP_TOOLS } from "../src/agent-os/visual-compute/mcp-tools";

describe("Phase 20.84 — Decision MCP Tools", () => {
  it("lists versioned decision contracts with risk tiers", async () => {
    const tools = createDecisionMcpTools();
    const contractsTool = tools.find((t) => t.name === "pao.decision.contracts");
    expect(contractsTool).toBeDefined();

    const result = await contractsTool!.handler({});
    expect(result.ok).toBe(true);
    const contracts = result.contracts as Array<{ id: string; riskTier: string }>;
    expect(contracts.length).toBeGreaterThanOrEqual(4);

    const ids = contracts.map((c) => c.id);
    expect(ids).toContain("agent.route");
    expect(ids).toContain("mcp.tool.risk");
    expect(ids).toContain("shell.command.risk");
  });

  it("evaluates agent.route contract with calibrated confidence via MCP surface", async () => {
    const tools = createDecisionMcpTools();
    const evaluateTool = tools.find((t) => t.name === "pao.decision.evaluate");
    expect(evaluateTool).toBeDefined();

    const result = await evaluateTool!.handler({
      contractId: "agent.route",
      state: { taskType: "coding", repo: "frontend" },
    });

    expect(result.ok).toBe(true);
    expect(result.disposition).toBe("allow");
    expect(Number(result.confidence)).toBeGreaterThan(0.9);
  });
});

describe("Phase 20.64 — vgpu MCP Tools", () => {
  it("declares three capability tools with R0-R2 risk tiers", () => {
    expect(VGPU_MCP_TOOLS.length).toBe(3);
    const names = VGPU_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("pao.vgpu.capabilities");
    expect(names).toContain("pao.vgpu.validate_shader");
    expect(names).toContain("pao.vgpu.execute_kernel");
  });

  it("returns capability snapshot via MCP handler", async () => {
    const snapshot = (await handleVgpuToolCall("pao.vgpu.capabilities", {})) as {
      available: boolean;
      adapterName: string;
    };
    expect(snapshot.available).toBe(true);
    expect(snapshot.adapterName).toBe("vc-deterministic-mock");
  });
});
