import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  bindJevSchema,
  describeJevIntegration,
  OFFICIAL_TYPE_SAFE_SCHEMA,
  RealTypeSafeJevProvider,
  resetJevSchemaForTest,
  resolveJevConfiguration,
  validateJevReadiness,
} from "../src/agent-os/decision/provider-mode";
import { DecisionEngine } from "../src/agent-os/decision/engine";

describe("RealTypeSafeJevProvider Live Transport & Schema Binding", () => {
  const FAKE_KEY = "apikey_test_1234567890abcdef1234567890abcdef12345678";
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      PAO_JEV_PROVIDER: process.env.PAO_JEV_PROVIDER,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
      TYPESAFE_BASE_URL: process.env.TYPESAFE_BASE_URL,
    };
    resetJevSchemaForTest();
  });

  afterEach(() => {
    resetJevSchemaForTest();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("binding official schema transitions readiness report to pass when credential exists", () => {
    process.env.PAO_JEV_PROVIDER = "real";
    process.env.TYPESAFE_API_KEY = FAKE_KEY;

    bindJevSchema(OFFICIAL_TYPE_SAFE_SCHEMA);
    const config = resolveJevConfiguration(process.env);
    expect(config.schemaBound).toBe(true);
    expect(config.credentialPresent).toBe(true);
    expect(config.realAvailable).toBe(true);

    const report = validateJevReadiness(process.env);
    expect(report.realAvailable).toBe(true);
    expect(report.checks.find((c) => c.id === "credential")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "schema")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "transport")?.status).toBe("pass");
    expect(report.nextAction).toBeNull();

    const desc = describeJevIntegration(process.env);
    expect(desc.status).toBe("ready");
    expect(desc.realAvailable).toBe(true);
    expect(desc.backend).toContain("typesafe-jev");
  });

  it("evaluates live contract through RealTypeSafeJevProvider against mock server", async () => {
    // Start a lightweight loopback mock for deterministic test execution
    const mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        expect(req.headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
        return Response.json({
          model: "jev-1.13.0",
          answers: {
            decision: {
              type: "choice",
              choice: "codex",
              confidence: 0.99,
              probabilities: {
                codex: 0.99,
                reasoning_llm: 0.01,
              },
            },
          },
          usage: { input_tokens: 150, output_tokens: 25 },
        });
      },
    });

    try {
      process.env.PAO_JEV_PROVIDER = "real";
      process.env.TYPESAFE_API_KEY = FAKE_KEY;
      process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${mockServer.port}`;

      bindJevSchema(OFFICIAL_TYPE_SAFE_SCHEMA);

      const provider = new RealTypeSafeJevProvider();
      const result = await provider.computeDecision({
        requestId: "req_live_1",
        contractId: "agent.route",
        state: { goal: "fix unit test" },
      });

      expect(result.provider).toBe("typesafe-jev");
      expect(result.model).toBe("jev-1.13.0");
      expect(result.selected).toBe("codex");
      expect(result.confidence).toBe(0.99);
      expect(result.disposition).toBe("allow");
      expect(result.candidates).toHaveLength(2);
      expect(result.providerCostUsd).toBeGreaterThanOrEqual(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      mockServer.stop(true);
    }
  });

  it("decision engine in real mode evaluates through real provider when schema is bound", async () => {
    const mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          model: "jev-1.13.0",
          answers: {
            decision: {
              type: "choice",
              choice: "safe_read",
              confidence: 0.95,
              probabilities: {
                safe_read: 0.95,
                bounded_write: 0.05,
              },
            },
          },
          usage: { input_tokens: 100, output_tokens: 20 },
        });
      },
    });

    try {
      process.env.PAO_JEV_PROVIDER = "real";
      process.env.TYPESAFE_API_KEY = FAKE_KEY;
      process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${mockServer.port}`;

      bindJevSchema(OFFICIAL_TYPE_SAFE_SCHEMA);

      const engine = new DecisionEngine();
      const result = await engine.evaluate({
        requestId: "req_engine_1",
        contractId: "mcp.tool.risk",
        state: { toolName: "read_file" },
      });

      expect(result.provider).toBe("typesafe-jev");
      expect(result.selected).toBe("safe_read");
      expect(result.disposition).toBe("allow");
    } finally {
      mockServer.stop(true);
    }
  });
});
