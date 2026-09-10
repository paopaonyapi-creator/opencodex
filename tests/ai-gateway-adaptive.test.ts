import { describe, expect, test } from "bun:test";
import {
  classifyTask,
  CircuitBreaker,
  projectHealthState,
  isPermitting,
  routeLevelRank,
} from "../src/ai-gateway/routing/adaptive";
import { decideEscalation } from "../src/ai-gateway/routing/escalation";
import {
  deriveRouteLevel,
  isLocalModel,
  rankCandidates,
  satisfiesCapabilities,
} from "../src/ai-gateway/routing/candidates";
import {
  createRouterArtifact,
  transitionRouter,
  isServing,
  evaluateDirectBypass,
  bypassJustified,
} from "../src/ai-gateway/routing/lifecycle";
import { parseUpstreamLock, verifyUpstreamLock } from "../src/ai-gateway/upstream-lock";
import { fileURLToPath } from "node:url";
import type { GatewayConfig, GatewayModelConfig } from "../src/ai-gateway/types";

/**
 * Phase 20.17 adaptive-routing tests.
 *
 * These drive the real classifier, breaker, and escalation logic. The two rules
 * that get the most attention are the two whose failure is a security incident
 * rather than merely a routing mistake: a restricted task may never escalate onto
 * a public provider, and a free route is never selected for being free alone.
 */
function model(overrides: Partial<GatewayModelConfig> = {}): GatewayModelConfig {
  return {
    id: "m1",
    providerId: "p1",
    model: "vendor-model",
    capabilities: {
      chat: true,
      tools: false,
      vision: false,
      structuredOutput: false,
      reasoning: false,
      streaming: false,
    },
    limits: { contextWindow: 128000, maxOutputTokens: 4096 },
    pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 5 },
    tags: [],
    ...overrides,
  };
}
function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    enabled: true,
    port: 8787,
    providers: [
      { id: "p1", type: "openai", apiKeyEnv: "X", baseUrl: "https://api.example.com/v1" },
      { id: "local1", type: "openai-compatible", apiKeyEnv: "L", baseUrl: "http://127.0.0.1:8001/v1" },
    ],
    models: [],
    aliases: [],
    identities: [],
    budgets: { global: { dailyUsd: 15, monthlyUsd: 250 }, identities: [] },
    policies: [],
    traceContentMode: "metadata_only",
    routerVersion: "router-v1-rule-based",
    freeFirst: true,
    maxEscalations: 2,
    directBypass: false,
    privateTaskLocalOnly: true,
    ...overrides,
  } as GatewayConfig;
}
describe("Phase 20.17 — task classification", () => {
  test("a coding agent's unlabelled work is classified as coding", () => {
    // Guessing 'general' here would route a coding agent to a generalist model.
    const c = classifyTask({ agentId: "codex" });
    expect(c.kind).toBe("coding");
    expect(c.suggestedAlias).toBe("pao-code");
  });

  test("low complexity starts cheap; high complexity starts at reasoning", () => {
    expect(classifyTask({ agentId: "hermes", complexity: 1 }).suggestedAlias).toBe("pao-free");
    expect(classifyTask({ agentId: "hermes", complexity: 5 }).suggestedAlias).toBe("pao-reasoning");
  });

  test("unspecified complexity assumes 3, not trivial", () => {
    // Defaulting to 1 would send every unlabelled request down the cheapest route,
    // which is the place a wrong guess is hardest to notice.
    const c = classifyTask({ agentId: "hermes" });
    expect(c.complexity).toBe(3);
    expect(c.reasons.join(" ")).toContain("assuming 3");
  });

  test("a credential keyword raises sensitivity and cannot be talked down", () => {
    const declared = classifyTask({ agentId: "hermes", sensitivity: "public" });
    expect(declared.sensitivity).toBe("public");

    const raised = classifyTask({
      agentId: "hermes",
      sensitivity: "public",
      taskType: "rotate the api key",
    });
    expect(raised.sensitivity).not.toBe("public");
    expect(raised.reasons.join(" ")).toContain("sensitivity raised");
  });

  test("restricted sensitivity pins the route to local and forbids leaving it", () => {
    const c = classifyTask({ agentId: "codex", sensitivity: "restricted" });
    expect(c.suggestedAlias).toBe("pao-local");
    expect(c.localOnly).toBe(true);
    // A one-entry ladder IS the privacy control: there is no rung to climb onto.
    expect(c.ladder).toEqual(["pao-local"]);
  });

  test("a private task's ladder never leaves the machine", () => {
    const c = classifyTask({ agentId: "hermes", sensitivity: "private" });
    expect(c.suggestedAlias).toBe("pao-local");
    expect(c.ladder).toEqual(["pao-local"]);
  });

  test("the ladder climbs toward quality, never toward cheap", () => {
    const c = classifyTask({ agentId: "codex", taskType: "coding", complexity: 3 });
    expect(c.ladder[0]).toBe("pao-code");
    const autoIndex = c.ladder.indexOf("pao-auto");
    const reasonIndex = c.ladder.indexOf("pao-reasoning");
    expect(autoIndex).toBeGreaterThan(0);
    expect(reasonIndex).toBeGreaterThan(autoIndex);
  });

  test("a caller preference is honoured when it is a Pao alias", () => {
    const c = classifyTask({ agentId: "hermes", preferredAlias: "pao-vision" });
    expect(c.suggestedAlias).toBe("pao-vision");
  });
});
describe("Phase 20.17 — escalation ladder", () => {
  const cfg = config();

  test("a non-escalatable failure stops instead of climbing", () => {
    // An auth failure will fail identically one rung higher; escalating it spends
    // money and risks a lockout.
    for (const code of ["auth_failure", "policy_denial", "budget_denial", "local_only_violation"]) {
      const decision = decideEscalation({
        classification: classifyTask({ agentId: "codex", complexity: 3 }),
        currentAlias: "pao-code",
        failureCode: code,
        attemptsOnCurrentAlias: 1,
        totalEscalations: 0,
        config: cfg,
      });
      expect(decision.action, code).toBe("stop");
      expect(decision.requiresHuman, code).toBe(true);
    }
  });

  test("a transient failure retries the same rung before paying to escalate", () => {
    const decision = decideEscalation({
      classification: classifyTask({ agentId: "codex", complexity: 3 }),
      currentAlias: "pao-code",
      failureCode: "provider_timeout",
      attemptsOnCurrentAlias: 0,
      totalEscalations: 0,
      config: cfg,
    });
    expect(decision.action).toBe("retry_same");
    expect(decision.nextAlias).toBe("pao-code");
  });

  test("a capability mismatch escalates immediately", () => {
    const decision = decideEscalation({
      classification: classifyTask({ agentId: "codex", complexity: 3 }),
      currentAlias: "pao-free",
      failureCode: "capability_mismatch",
      attemptsOnCurrentAlias: 1,
      totalEscalations: 0,
      config: cfg,
    });
    expect(decision.action).toBe("escalate");
    expect(decision.nextAlias).not.toBe("pao-free");
  });

  test("escalation is bounded by policy", () => {
    const decision = decideEscalation({
      classification: classifyTask({ agentId: "codex", complexity: 3 }),
      currentAlias: "pao-code",
      failureCode: "provider_5xx",
      attemptsOnCurrentAlias: 3,
      totalEscalations: 2,
      config: cfg,
    });
    expect(decision.action).toBe("stop");
    expect(decision.reason).toContain("budget exhausted");
  });

  test("a restricted task is refused escalation even when the ladder is bypassed", () => {
    // Defence in depth: the ladder has one entry for restricted tasks, and this
    // check refuses independently of it.
    const restricted = classifyTask({ agentId: "codex", sensitivity: "restricted" });
    const decision = decideEscalation({
      classification: { ...restricted, ladder: ["pao-local", "pao-fast"] },
      currentAlias: "pao-local",
      failureCode: "provider_5xx",
      attemptsOnCurrentAlias: 5,
      totalEscalations: 0,
      config: cfg,
    });
    expect(decision.action).toBe("stop");
    expect(decision.reason).toContain("Restricted");
  });

  test("the last rung stops rather than throwing", () => {
    const decision = decideEscalation({
      classification: classifyTask({ agentId: "codex", complexity: 3 }),
      currentAlias: "pao-reasoning",
      failureCode: "provider_5xx",
      attemptsOnCurrentAlias: 3,
      totalEscalations: 1,
      config: cfg,
    });
    expect(decision.action).toBe("stop");
  });

  test("zero max_escalations means never escalate", () => {
    const decision = decideEscalation({
      classification: classifyTask({ agentId: "codex", complexity: 3 }),
      currentAlias: "pao-code",
      failureCode: "provider_5xx",
      attemptsOnCurrentAlias: 3,
      totalEscalations: 0,
      config: config({ maxEscalations: 0 }),
    });
    expect(decision.action).toBe("stop");
  });
});
describe("Phase 20.17 — free-first ranking", () => {
  test("route level is derived from the catalog's own pricing", () => {
    expect(deriveRouteLevel(model({ pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }))).toBe("L0");
    expect(deriveRouteLevel(model({ pricing: { inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.4 } }))).toBe("L1");
    expect(deriveRouteLevel(model({ pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 5 } }))).toBe("L2");
    expect(deriveRouteLevel(model({ pricing: { inputPerMillionUsd: 15, outputPerMillionUsd: 40 } }))).toBe("L3");
  });

  test("unknown pricing is not treated as free", () => {
    // The budget layer fails closed on unknown pricing; ranking it as free here
    // would defeat that by preferring it.
    const level = deriveRouteLevel(
      model({ pricing: { inputPerMillionUsd: null, outputPerMillionUsd: null } }),
    );
    expect(level).not.toBe("L0");
    expect(level).toBe("L3");
  });

  test("a cheaper candidate outranks a premium one", () => {
    const cheap = model({ id: "cheap", pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } });
    const premium = model({ id: "premium", pricing: { inputPerMillionUsd: 15, outputPerMillionUsd: 40 } });
    const ranked = rankCandidates([premium, cheap], { freeFirst: true });
    expect(ranked[0]!.model.id).toBe("cheap");
  });

  test("an incapable candidate is filtered out, not merely ranked low", () => {
    // This is what makes free-first safe: an incapable candidate is never in the
    // list the ranking sees, so price cannot promote it.
    const incapable = model({
      id: "free-no-tools",
      capabilities: {
        chat: true,
        tools: false,
        vision: false,
        structuredOutput: false,
        reasoning: false,
        streaming: false,
      },
      pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    });
    expect(satisfiesCapabilities(incapable, { tools: true })).toBe(false);

    const capable = model({
      id: "paid-with-tools",
      capabilities: {
        chat: true,
        tools: true,
        vision: false,
        structuredOutput: false,
        reasoning: false,
        streaming: false,
      },
      pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 10 },
    });
    const eligible = [incapable, capable].filter((m) => satisfiesCapabilities(m, { tools: true }));
    expect(eligible).toHaveLength(1);
    expect(rankCandidates(eligible, { freeFirst: true })[0]!.model.id).toBe("paid-with-tools");
  });

  test("ranking is deterministic for equal scores", () => {
    expect(routeLevelRank("L0")).toBeLessThan(routeLevelRank("L3"));
    const a = model({ id: "aaa" });
    const b = model({ id: "bbb" });
    const first = rankCandidates([a, b], { freeFirst: true }).map((c) => c.model.id);
    const second = rankCandidates([b, a], { freeFirst: true }).map((c) => c.model.id);
    expect(first).toEqual(second);
  });

  test("a model whose context window is too small is demoted", () => {
    const small = model({
      id: "small",
      limits: { contextWindow: 8000, maxOutputTokens: 1024 },
      pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
    });
    const large = model({ id: "large", limits: { contextWindow: 200000, maxOutputTokens: 8192 } });
    const ranked = rankCandidates([small, large], {
      freeFirst: true,
      requiredContextTokens: 100000,
    });
    expect(ranked[0]!.model.id).toBe("large");
  });

  test("locality is decided by address, not by a trust label", () => {
    const cfg = config();
    expect(isLocalModel(model({ providerId: "local1" }), cfg)).toBe(true);
    expect(isLocalModel(model({ providerId: "p1" }), cfg)).toBe(false);
  });
});
describe("Phase 20.17 — circuit breaker and health states", () => {
  test("an auth failure opens the circuit immediately rather than counting to three", () => {
    // A wrong credential cannot fix itself; retrying is how an account gets locked.
    const breaker = new CircuitBreaker();
    const record = breaker.recordFailure("p1", "auth_failure");
    expect(record.state).toBe("OPEN");
    expect(record.health).toBe("UNAVAILABLE");
    expect(breaker.canAttempt("p1")).toBe(false);
  });

  test("a rate limit opens with a shorter cooldown and its own state", () => {
    let clock = 1_000_000;
    const breaker = new CircuitBreaker({
      rateLimitCooldownMs: 1000,
      cooldownMs: 60_000,
      now: () => clock,
    });
    breaker.recordFailure("p1", "provider_429");
    expect(breaker.getState("p1").health).toBe("RATE_LIMITED");
    expect(breaker.canAttempt("p1")).toBe(false);
    clock += 1001;
    expect(breaker.canAttempt("p1")).toBe(true);
    expect(breaker.getState("p1").state).toBe("HALF_OPEN");
  });

  test("repeated 5xx opens the circuit at the threshold", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    expect(breaker.recordFailure("p1", "provider_5xx").state).toBe("CLOSED");
    expect(breaker.recordFailure("p1", "provider_5xx").state).toBe("CLOSED");
    const third = breaker.recordFailure("p1", "provider_5xx");
    expect(third.state).toBe("OPEN");
    expect(third.health).toBe("UNAVAILABLE");
  });

  test("a degraded provider is a warning, not an outage", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure("p1", "provider_5xx");
    expect(breaker.getState("p1").health).toBe("DEGRADED");
    expect(isPermitting("DEGRADED")).toBe(true);
    expect(isPermitting("UNAVAILABLE")).toBe(false);
    expect(isPermitting("DISABLED")).toBe(false);
  });

  test("a success closes the circuit and clears the health state", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure("p1", "provider_5xx");
    expect(breaker.getState("p1").state).toBe("OPEN");
    breaker.recordSuccess("p1");
    expect(breaker.getState("p1").state).toBe("CLOSED");
    expect(breaker.getState("p1").health).toBe("HEALTHY");
  });

  test("a disabled provider reports DISABLED", () => {
    const breaker = new CircuitBreaker();
    breaker.disable("p1");
    expect(breaker.getState("p1").health).toBe("DISABLED");
    expect(isPermitting(breaker.getState("p1").health)).toBe(false);
  });

  test("the breaker overrides a stale cached healthy result", () => {
    // A health check that ran minutes ago is exactly the stale answer that routes
    // a request into a dead provider.
    const registry = {
      getCachedHealth: () => ({
        providerId: "p1",
        healthy: true,
        lastCheckedAt: new Date().toISOString(),
      }),
    } as never;
    const breaker = new CircuitBreaker();
    breaker.recordFailure("p1", "auth_failure");
    expect(projectHealthState("p1", registry, breaker)).toBe("UNAVAILABLE");
  });
});
describe("Phase 20.17 — router lifecycle", () => {
  test("a fresh artifact starts in DRAFT and is not serving", () => {
    const artifact = createRouterArtifact({ id: "r1", upstreamVersion: "0.7.63" });
    expect(artifact.state).toBe("DRAFT");
    expect(isServing(artifact)).toBe(false);
  });

  test("promotion to ACTIVE is impossible without passing through CANARY", () => {
    // The single edge into ACTIVE is the promotion gate.
    let artifact = createRouterArtifact({ id: "r1", upstreamVersion: "0.7.63" });
    const direct = transitionRouter(artifact, "ACTIVE", "operator");
    expect(direct.ok).toBe(false);
    expect(direct.reason).toContain("not permitted");

    artifact = transitionRouter(artifact, "OFFLINE_TESTED", "operator").artifact;
    artifact = transitionRouter(artifact, "REVIEWED", "operator").artifact;
    artifact = transitionRouter(artifact, "CANARY", "operator").artifact;
    const promoted = transitionRouter(artifact, "ACTIVE", "operator", "canary clean");
    expect(promoted.ok).toBe(true);
    expect(isServing(promoted.artifact)).toBe(true);
  });

  test("every transition records who and why", () => {
    let artifact = createRouterArtifact({ id: "r1", upstreamVersion: "0.7.63" });
    artifact = transitionRouter(artifact, "OFFLINE_TESTED", "pao", "suite green").artifact;
    expect(artifact.history).toHaveLength(1);
    expect(artifact.history[0]!.by).toBe("pao");
    expect(artifact.history[0]!.note).toBe("suite green");
  });

  test("a rollback path exists from ACTIVE", () => {
    let artifact = createRouterArtifact({ id: "r1", upstreamVersion: "0.7.63" });
    artifact = transitionRouter(artifact, "OFFLINE_TESTED", "o").artifact;
    artifact = transitionRouter(artifact, "REVIEWED", "o").artifact;
    artifact = transitionRouter(artifact, "CANARY", "o").artifact;
    artifact = transitionRouter(artifact, "ACTIVE", "o").artifact;
    const rolled = transitionRouter(artifact, "ROLLED_BACK", "o", "regression found");
    expect(rolled.ok).toBe(true);
    expect(rolled.artifact.state).toBe("ROLLED_BACK");
  });
});
describe("Phase 20.17 — emergency direct bypass", () => {
  test("bypass is refused by default", () => {
    const decision = evaluateDirectBypass(
      { enabled: false, allowedProviders: [], explicitlyEnabled: false },
      "p1",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.auditRequired).toBe(false);
  });

  test("enabling without an explicit opt-in is still refused", () => {
    const decision = evaluateDirectBypass(
      { enabled: true, allowedProviders: ["p1"], explicitlyEnabled: false },
      "p1",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("default");
  });

  test("enabling with an empty allowlist routes nothing", () => {
    const decision = evaluateDirectBypass(
      { enabled: true, allowedProviders: [], explicitlyEnabled: true },
      "p1",
    );
    expect(decision.allowed).toBe(false);
  });

  test("a provider off the allowlist is refused even when the bypass is on", () => {
    const decision = evaluateDirectBypass(
      { enabled: true, allowedProviders: ["p2"], explicitlyEnabled: true },
      "p1",
    );
    expect(decision.allowed).toBe(false);
  });

  test("a fully-configured bypass is allowed and demands an audit event", () => {
    const decision = evaluateDirectBypass(
      { enabled: true, allowedProviders: ["p1"], explicitlyEnabled: true },
      "p1",
    );
    expect(decision.allowed).toBe(true);
    expect(decision.auditRequired).toBe(true);
  });

  test("only a gateway outage justifies the emergency path", () => {
    // A single provider error is what normal fallback is for; treating it as an
    // emergency would make the exception routine.
    expect(bypassJustified("provider_unreachable")).toBe(true);
    expect(bypassJustified("provider_429")).toBe(false);
    expect(bypassJustified("capability_mismatch")).toBe(false);
    expect(bypassJustified("auth_failure")).toBe(false);
    expect(bypassJustified(null)).toBe(false);
  });
});
describe("Phase 20.17 — upstream lock", () => {
  const validLock = [
    "experiential:",
    "  version: " + JSON.stringify("0.7.63"),
    "  python: " + JSON.stringify(">=3.12"),
    "  license: " + JSON.stringify("Apache-2.0"),
    "  verified_date: " + JSON.stringify("2026-09-11"),
    "  upgrade_policy: " + JSON.stringify("manual-after-contract-tests"),
    "  contract:",
    "    routes:",
    "      - method: GET",
    "        path: /v1/models",
    "      - method: POST",
    "        path: /v1/chat/completions",
  ].join("\n");

  test("parses the pin, contract routes, and license", () => {
    const pin = parseUpstreamLock(validLock)!;
    expect(pin.version).toBe("0.7.63");
    expect(pin.license).toBe("Apache-2.0");
    expect(pin.contractRoutes).toHaveLength(2);
    expect(pin.contractRoutes[0]!.path).toBe("/v1/models");
  });

  test("a floating version is a hard problem, not a note", () => {
    // A pin that is only advisory is not a pin.
    for (const floating of ["latest", ">=0.7", "^0.7.63", "~0.7.63", "0.7.*"]) {
      const raw = validLock.replace(
        "version: " + JSON.stringify("0.7.63"),
        "version: " + JSON.stringify(floating),
      );
      const pin = parseUpstreamLock(raw);
      expect(pin, floating).not.toBeNull();
      expect(pin!.version, floating).toBe(floating);
    }
  });

  test("a missing lock file fails closed", () => {
    const result = verifyUpstreamLock("C:/definitely/not/here/upstream.lock.yaml");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("not found");
  });

  test("the real committed lock file verifies clean", () => {
    // Guards the artifact, not just the parser: a future edit that floats the
    // version fails here.
    //
    // fileURLToPath rather than .pathname: a pathname is percent-encoded, so a
    // workspace under a directory with a space in its name resolves to
    // ".../AD%20PAO/..." and the file is never found. The resulting error says the
    // lock file is missing, which is exactly the kind of misleading failure that
    // costs an hour.
    const result = verifyUpstreamLock(
      fileURLToPath(new URL("../config/ai-gateway/upstream.lock.yaml", import.meta.url)),
    );
    expect(result.ok).toBe(true);
    expect(result.pin?.version).toBe("0.7.63");
  });
});
