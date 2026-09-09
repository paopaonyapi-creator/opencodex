/**
 * Pao AI Gateway — Reviewer Council & Risk Classifier Tests.
 *
 * Validates Phase 20.13.8:
 * - Risk classification accuracy across R0 to R5
 * - Provider independence invariant (developer family excluded from review)
 * - Council vote aggregation & security veto
 * - Fail-closed human approval gating on R5 operations
 * - End-to-end evaluation and HTTP endpoint integration
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  classifyRisk,
  getReviewRequirementForRisk,
  selectReviewers,
  getProviderFamily,
  aggregateCouncilVotes,
  evaluateWithCouncil,
  type CouncilReviewTarget,
  type ReviewerFeedback,
} from "../src/ai-gateway/council";
import { startGatewayServer, type GatewayServerHandle } from "../src/ai-gateway/server";
import type { GatewayModelConfig, GatewayProviderConfig } from "../src/ai-gateway/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS: GatewayProviderConfig[] = [
  { id: "openai-main", type: "openai", apiKeyEnv: "TEST_OAI_KEY" },
  { id: "anthropic-main", type: "anthropic", apiKeyEnv: "TEST_ANT_KEY" },
  { id: "gemini-main", type: "gemini", apiKeyEnv: "TEST_GEM_KEY" },
  { id: "local-vllm", type: "openai-compatible", baseUrl: "http://127.0.0.1:8001/v1" },
];

const MOCK_MODELS: GatewayModelConfig[] = [
  {
    id: "gpt-4o",
    providerId: "openai-main",
    model: "gpt-4o",
    capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
    limits: { contextWindow: 128000, maxOutputTokens: 4096 },
    pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 15 },
    tags: ["coding"],
  },
  {
    id: "claude-3-5-sonnet",
    providerId: "anthropic-main",
    model: "claude-3-5-sonnet-20241022",
    capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
    limits: { contextWindow: 200000, maxOutputTokens: 8192 },
    pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
    tags: ["review", "security"],
  },
  {
    id: "gemini-1-5-pro",
    providerId: "gemini-main",
    model: "gemini-1.5-pro",
    capabilities: { chat: true, tools: true, structuredOutput: true, vision: true, reasoning: true },
    limits: { contextWindow: 1000000, maxOutputTokens: 8192 },
    pricing: { inputPerMillionUsd: 3.5, outputPerMillionUsd: 10.5 },
    tags: ["architecture"],
  },
  {
    id: "llama-3-8b-local",
    providerId: "local-vllm",
    model: "llama-3-8b-instruct",
    capabilities: { chat: true, tools: false, structuredOutput: false, vision: false, reasoning: false },
    limits: { contextWindow: 8192, maxOutputTokens: 2048 },
    pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    tags: ["local"],
  },
];

describe("Pao AI Gateway — Reviewer Council & Risk Classifier", () => {
  describe("Risk Classification (R0 to R5)", () => {
    test("classifies informational / question prompt as R0", () => {
      const res = classifyRisk({ text: "How does the TCP three-way handshake work?" });
      expect(res.level).toBe("R0");
      expect(res.reviewRequirement.type).toBe("none");
      expect(res.reviewRequirement.minReviewers).toBe(0);
    });

    test("classifies single-file targeted edit as R1", () => {
      const res = classifyRisk({
        text: "Fix typo in log message",
        affectedFiles: ["src/utils/logger.ts"],
      });
      expect(res.level).toBe("R1");
      expect(res.reviewRequirement.type).toBe("none");
    });

    test("classifies multi-file feature as R2", () => {
      const res = classifyRisk({
        text: "Implement user profile card component",
        affectedFiles: ["src/components/Card.tsx", "src/components/Card.css"],
      });
      expect(res.level).toBe("R2");
      expect(res.reviewRequirement.type).toBe("optional");
    });

    test("classifies dependency and configuration changes as R3", () => {
      const res = classifyRisk({
        text: "Add bun install redis client",
        affectedFiles: ["package.json"],
      });
      expect(res.level).toBe("R3");
      expect(res.reviewRequirement.type).toBe("mandatory_single");
      expect(res.reviewRequirement.requireDifferentProviders).toBe(true);
    });

    test("classifies privileged command execution as R4", () => {
      const res = classifyRisk({
        text: "Run service restart with elevated permissions",
        command: "sudo systemctl restart nginx",
      });
      expect(res.level).toBe("R4");
      expect(res.reviewRequirement.type).toBe("full_council");
      expect(res.reviewRequirement.minReviewers).toBe(2);
      expect(res.reviewRequirement.requireDifferentProviders).toBe(true);
    });

    test("classifies explicit pao-critical alias as R4 council review", () => {
      const res = classifyRisk({
        text: "Evaluate architecture changes",
        alias: "pao-critical",
      });
      expect(res.level).toBe("R4");
      expect(res.reviewRequirement.type).toBe("full_council");
    });

    test("classifies destructive operations as R5 fail-closed", () => {
      const res = classifyRisk({
        text: "Clean up system data directory",
        command: "rm -rf /data/cache/*",
      });
      expect(res.level).toBe("R5");
      expect(res.score).toBe(100);
      expect(res.reviewRequirement.type).toBe("human_approval_required");
      expect(res.reviewRequirement.humanApprovalRequired).toBe(true);
    });

    test("classifies database drop as R5", () => {
      const res = classifyRisk({
        text: "Reset database tables",
        command: "DROP DATABASE test_db;",
      });
      expect(res.level).toBe("R5");
      expect(res.reviewRequirement.humanApprovalRequired).toBe(true);
    });
  });

  describe("Provider Independence Selection", () => {
    test("determines correct provider families", () => {
      expect(getProviderFamily("openai-main", "openai")).toBe("openai");
      expect(getProviderFamily("anthropic-main", "anthropic")).toBe("anthropic");
      expect(getProviderFamily("gemini-main", "gemini")).toBe("gemini");
      expect(getProviderFamily("local-vllm", "openai-compatible")).toBe("local");
    });

    test("excludes developer provider family from reviewer assignment", () => {
      const requirement = getReviewRequirementForRisk("R4");
      // Developer used OpenAI
      const assignments = selectReviewers(requirement, MOCK_MODELS, MOCK_PROVIDERS, "openai-main");

      expect(assignments.length).toBe(2);
      for (const a of assignments) {
        // Neither reviewer should be from the OpenAI family
        expect(a.providerFamily).not.toBe("openai");
        expect(a.isIndependent).toBe(true);
      }
    });

    test("selects diverse provider families across assigned reviewers", () => {
      const requirement = getReviewRequirementForRisk("R4");
      const assignments = selectReviewers(requirement, MOCK_MODELS, MOCK_PROVIDERS, "openai-main");

      const families = assignments.map(a => a.providerFamily);
      const uniqueFamilies = new Set(families);
      expect(uniqueFamilies.size).toBe(assignments.length);
    });
  });

  describe("Decision Aggregator", () => {
    const feedbackApprove1: ReviewerFeedback = {
      reviewerRole: "reviewer-security",
      providerId: "anthropic-main",
      modelId: "claude-3-5-sonnet",
      vote: "approve",
      summary: "No security issues found.",
      findings: [],
      durationMs: 120,
    };

    const feedbackApprove2: ReviewerFeedback = {
      reviewerRole: "reviewer-architecture",
      providerId: "gemini-main",
      modelId: "gemini-1-5-pro",
      vote: "approve",
      summary: "Clean architecture alignment.",
      findings: [],
      durationMs: 150,
    };

    test("approves when all required reviewers vote approve", () => {
      const decision = aggregateCouncilVotes([feedbackApprove1, feedbackApprove2], "R4");
      expect(decision.state).toBe("approved");
      expect(decision.votes.approve).toBe(2);
      expect(decision.votes.reject).toBe(0);
    });

    test("rejects when security reviewer casts a veto", () => {
      const feedbackReject: ReviewerFeedback = {
        reviewerRole: "reviewer-security",
        providerId: "anthropic-main",
        modelId: "claude-3-5-sonnet",
        vote: "reject",
        summary: "Potential unauthorized secret extraction.",
        findings: [
          {
            severity: "critical",
            title: "Credential Exposure",
            description: "Attempted to dump environment secrets.",
          },
        ],
        durationMs: 130,
      };

      const decision = aggregateCouncilVotes([feedbackApprove2, feedbackReject], "R4");
      expect(decision.state).toBe("rejected");
      expect(decision.votes.reject).toBe(1);
      expect(decision.blockingReasons.length).toBeGreaterThan(0);
    });

    test("requests changes when any reviewer votes request_changes", () => {
      const feedbackChanges: ReviewerFeedback = {
        reviewerRole: "reviewer-architecture",
        providerId: "gemini-main",
        modelId: "gemini-1-5-pro",
        vote: "request_changes",
        summary: "Please add unit tests for the newly added method.",
        findings: [
          {
            severity: "medium",
            title: "Missing Coverage",
            description: "No automated tests covering new error branch.",
            suggestedFix: "Add test in tests/gateway.test.ts",
          },
        ],
        durationMs: 140,
      };

      const decision = aggregateCouncilVotes([feedbackApprove1, feedbackChanges], "R3");
      expect(decision.state).toBe("changes_requested");
      expect(decision.fixInstructions.length).toBeGreaterThan(0);
    });

    test("R5 requires explicit human approval token even when all reviewers approve", () => {
      // Without token
      const decisionNoToken = aggregateCouncilVotes([feedbackApprove1, feedbackApprove2], "R5");
      expect(decisionNoToken.state).toBe("pending_human_approval");
      expect(decisionNoToken.blockingReasons).toContain(
        "Risk level R5 requires explicit human approval token before execution.",
      );

      // With valid human approval token
      const decisionWithToken = aggregateCouncilVotes(
        [feedbackApprove1, feedbackApprove2],
        "R5",
        "pao-approved-operator-admin",
      );
      expect(decisionWithToken.state).toBe("approved");
      expect(decisionWithToken.humanApprovalGranted).toBe(true);
    });
  });

  describe("End-to-End Council Orchestration", () => {
    const ctx = {
      availableModels: MOCK_MODELS,
      providers: MOCK_PROVIDERS,
    };

    test("bypasses review directly for low-risk R0 inquiries", async () => {
      const target: CouncilReviewTarget = {
        summary: "What is the capital of Japan?",
      };

      const decision = await evaluateWithCouncil(target, ctx);
      expect(decision.state).toBe("approved");
      expect(decision.riskLevel).toBe("R0");
      expect(decision.feedback.length).toBe(0);
    });

    test("enforces council review for high-risk R4 privileged commands", async () => {
      const target: CouncilReviewTarget = {
        summary: "Restart docker container",
        commandToExecute: "sudo docker restart production-gateway",
        developerProviderId: "openai-main",
      };

      const decision = await evaluateWithCouncil(target, ctx);
      expect(decision.riskLevel).toBe("R4");
      expect(decision.feedback.length).toBe(2);
      // Confirms reviewer independence
      for (const fb of decision.feedback) {
        expect(fb.providerId).not.toBe("openai-main");
      }
    });

    test("blocks destructive command in deterministic evaluation", async () => {
      const target: CouncilReviewTarget = {
        summary: "Purge directory",
        commandToExecute: "rm -rf /var/log/all",
      };

      const decision = await evaluateWithCouncil(target, ctx);
      expect(decision.riskLevel).toBe("R5");
      expect(decision.state).toBe("rejected");
    });
  });

  describe("HTTP Gateway Endpoints Integration", () => {
    const TEST_ROOT = join(process.cwd(), ".tmp", "test-council-http");
    const CONFIG_DIR = join(TEST_ROOT, "config", "ai-gateway");
    let gateway: GatewayServerHandle | null = null;
    const PORT = 18789;

    beforeAll(async () => {
      try {
        rmSync(TEST_ROOT, { recursive: true, force: true });
      } catch {}
      mkdirSync(CONFIG_DIR, { recursive: true });

      writeFileSync(join(CONFIG_DIR, "providers.yaml"), `
providers:
  mock-openai:
    type: openai
    api_key_env: TEST_MOCK_KEY
  mock-anthropic:
    type: anthropic
    api_key_env: TEST_MOCK_KEY
`);

      writeFileSync(join(CONFIG_DIR, "models.yaml"), `
models:
  mock-model-1:
    provider: mock-openai
    model: gpt-4o
    capabilities:
      chat: true
    pricing:
      input_per_million_usd: 2
      output_per_million_usd: 6
  mock-model-2:
    provider: mock-anthropic
    model: claude-3-5-sonnet
    capabilities:
      chat: true
    pricing:
      input_per_million_usd: 3
      output_per_million_usd: 15
`);

      writeFileSync(join(CONFIG_DIR, "aliases.yaml"), `
aliases:
  pao-fast:
    routes:
      - model: mock-model-1
        priority: 100
  pao-critical:
    routes:
      - model: mock-model-2
        priority: 100
    constraints:
      review_required: true
`);

      writeFileSync(join(CONFIG_DIR, "policies.yaml"), `
identities:
  admin-pao:
    name: Admin
    aliases:
      allow:
        - pao-fast
        - pao-critical
`);

      writeFileSync(join(CONFIG_DIR, "budgets.yaml"), `
budgets:
  global:
    daily_usd: 100
    monthly_usd: 1000
`);

      process.env.PAO_AI_GATEWAY_ENABLED = "true";
      process.env.PAO_AI_GATEWAY_PORT = String(PORT);
      process.env.PAO_AI_GATEWAY_ADMIN_KEY = "admin-secret-test-key";
      process.env.TEST_MOCK_KEY = "mock-secret";

      gateway = await startGatewayServer(TEST_ROOT);
    });

    afterAll(() => {
      gateway?.stop();
      delete process.env.PAO_AI_GATEWAY_ENABLED;
      delete process.env.PAO_AI_GATEWAY_PORT;
      delete process.env.PAO_AI_GATEWAY_ADMIN_KEY;
      delete process.env.TEST_MOCK_KEY;
      try {
        rmSync(TEST_ROOT, { recursive: true, force: true });
      } catch {}
    });

    test("GET /api/gateway/council/policies returns risk policy matrix", async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/gateway/council/policies`, {
        headers: { Authorization: "Bearer admin-secret-test-key" },
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { levels: Array<{ level: string }>; roles: string[] };
      expect(data.levels.length).toBe(6);
      expect(data.roles).toContain("reviewer-security");
      expect(data.roles).toContain("reviewer-architecture");
    });

    test("POST /api/gateway/council/classify returns risk classification", async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/gateway/council/classify`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-secret-test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Install redis driver",
          command: "bun add ioredis",
          affectedFiles: ["package.json"],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { classification: { level: string; score: number } };
      expect(data.classification.level).toBe("R3");
      expect(data.classification.score).toBeGreaterThan(0);
    });

    test("POST /api/gateway/council/evaluate executes council evaluation", async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/gateway/council/evaluate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-secret-test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: "Refactor user authentication routes",
          affectedFiles: ["src/routes/auth.ts", "src/services/auth.ts"],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { decision: { state: string; riskLevel: string } };
      expect(data.decision.riskLevel).toBe("R2");
      expect(data.decision.state).toBe("approved");
    });
  });
});
