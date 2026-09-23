import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FLOCI_ENDPOINT,
  evaluateEnvironmentGate,
  readCloudSandboxFlags,
  validatePinnedImage,
  assertCloudSandboxEnabled,
} from "../src/agent-os/cloud-sandbox/flags";
import { CloudSandboxError, isRetryableCode } from "../src/agent-os/cloud-sandbox/errors";

type Env = NodeJS.ProcessEnv;

describe("phase 20.15 — cloud sandbox feature flags", () => {
  test("an unset environment activates nothing", () => {
    const flags = readCloudSandboxFlags({} as Env);
    expect(flags.enabled).toBe(false);
    // localOnly defaults ON: the safe reading of an absent variable is "stay local".
    expect(flags.localOnly).toBe(true);
    expect(flags.dockerControlEnabled).toBe(false);
    expect(flags.iacEnabled).toBe(false);
    expect(flags.productionPromotionEnabled).toBe(false);
    expect(flags.multiCloudEnabled).toBe(false);
    expect(flags.flociImage).toBeNull();
    expect(flags.flociEndpoint).toBe(DEFAULT_FLOCI_ENDPOINT);
    expect(flags.dbPathOverride).toBeNull();
  });

  test("truthy parsing accepts the usual spellings and rejects everything else", () => {
    for (const value of ["1", "true", "TRUE", "yes", " on "]) {
      expect(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_ENABLED: value } as Env).enabled).toBe(true);
    }
    for (const value of ["0", "false", "", "maybe", "enabled"]) {
      expect(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_ENABLED: value } as Env).enabled).toBe(false);
    }
  });

  test("localOnly is opt-OUT, so only an explicit false opens staging", () => {
    expect(readCloudSandboxFlags({} as Env).localOnly).toBe(true);
    expect(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_LOCAL_ONLY: "false" } as Env).localOnly).toBe(false);
    expect(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_LOCAL_ONLY: "0" } as Env).localOnly).toBe(false);
    // A typo must not silently disable the guard.
    expect(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_LOCAL_ONLY: "flase" } as Env).localOnly).toBe(true);
  });

  test("blank strings are treated as unset, not as a value", () => {
    const flags = readCloudSandboxFlags({
      PAO_CLOUD_FLOCI_IMAGE: "   ",
      PAO_CLOUD_FLOCI_ENDPOINT: "",
      PAO_CLOUD_SANDBOX_DB: "",
    } as Env);
    expect(flags.flociImage).toBeNull();
    expect(flags.flociEndpoint).toBe(DEFAULT_FLOCI_ENDPOINT);
    expect(flags.dbPathOverride).toBeNull();
  });

  test("assertCloudSandboxEnabled throws a non-retryable FEATURE_DISABLED", () => {
    expect(() => assertCloudSandboxEnabled(readCloudSandboxFlags({} as Env))).toThrow(CloudSandboxError);
    try {
      assertCloudSandboxEnabled(readCloudSandboxFlags({} as Env));
    } catch (err) {
      const cloudErr = err as CloudSandboxError;
      expect(cloudErr.code).toBe("FEATURE_DISABLED");
      expect(cloudErr.retryable).toBe(false);
    }
    expect(() =>
      assertCloudSandboxEnabled(readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_ENABLED: "1" } as Env)),
    ).not.toThrow();
  });
});

describe("phase 20.15 — image pinning (source spec §66)", () => {
  test("rejects every floating form, including the implicit one", () => {
    expect(validatePinnedImage(null).ok).toBe(false);
    expect(validatePinnedImage("").ok).toBe(false);
    expect(validatePinnedImage("floci/floci:latest").ok).toBe(false);
    expect(validatePinnedImage("floci/floci").ok).toBe(false);
    // A registry port is not a tag: this resolves to :latest and must be refused.
    expect(validatePinnedImage("registry.internal:5000/floci").ok).toBe(false);
  });

  test("accepts an explicit tag or a digest", () => {
    expect(validatePinnedImage("floci/floci:1.4.2").ok).toBe(true);
    expect(validatePinnedImage("registry.internal:5000/floci:1.4.2").ok).toBe(true);
    expect(
      validatePinnedImage("floci/floci@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").ok,
    ).toBe(true);
  });

  test("the rejection reason names the offending value", () => {
    const verdict = validatePinnedImage("floci/floci:latest");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("floci/floci:latest");
  });
});

describe("phase 20.15 — trust-zone gate (source spec §5.6)", () => {
  const enabled = readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_ENABLED: "1" } as Env);
  const opened = readCloudSandboxFlags({
    PAO_CLOUD_SANDBOX_ENABLED: "1",
    PAO_CLOUD_SANDBOX_LOCAL_ONLY: "false",
  } as Env);
  const fullyOpened = readCloudSandboxFlags({
    PAO_CLOUD_SANDBOX_ENABLED: "1",
    PAO_CLOUD_SANDBOX_LOCAL_ONLY: "false",
    PAO_CLOUD_PRODUCTION_PROMOTION_ENABLED: "1",
  } as Env);

  test("a disabled plane refuses every environment", () => {
    const off = readCloudSandboxFlags({} as Env);
    for (const target of ["local", "staging", "production"] as const) {
      const gate = evaluateEnvironmentGate(off, target);
      expect(gate.allowed).toBe(false);
      expect(gate.errorCode).toBe("FEATURE_DISABLED");
    }
  });

  test("local is reachable once enabled", () => {
    expect(evaluateEnvironmentGate(enabled, "local")).toEqual({ allowed: true, target: "local" });
  });

  test("localOnly blocks staging and production on its own", () => {
    const staging = evaluateEnvironmentGate(enabled, "staging");
    expect(staging.allowed).toBe(false);
    expect(staging.errorCode).toBe("CLOUD_POLICY_DENIED");

    const production = evaluateEnvironmentGate(enabled, "production");
    expect(production.allowed).toBe(false);
    expect(production.errorCode).toBe("CLOUD_POLICY_DENIED");
  });

  test("production needs BOTH switches, so neither alone opens it", () => {
    // localOnly lifted but promotion not enabled: staging opens, production does not.
    expect(evaluateEnvironmentGate(opened, "staging").allowed).toBe(true);
    const production = evaluateEnvironmentGate(opened, "production");
    expect(production.allowed).toBe(false);
    expect(production.errorCode).toBe("PRODUCTION_GATE_DENIED");

    expect(evaluateEnvironmentGate(fullyOpened, "production").allowed).toBe(true);
  });
});

describe("phase 20.15 — retry policy (source spec §59)", () => {
  test("transient conditions are retryable", () => {
    for (const code of [
      "SANDBOX_START_FAILED",
      "SANDBOX_NOT_READY",
      "ADAPTER_UNAVAILABLE",
      "DOCKER_UNAVAILABLE",
      "RESOURCE_DISCOVERY_FAILED",
      "TEST_FAILED",
    ] as const) {
      expect(isRetryableCode(code)).toBe(true);
    }
  });

  test("destructive and trust-crossing operations are never retryable", () => {
    for (const code of [
      "CLEANUP_FAILED",
      "LEAK_DETECTED",
      "PROMOTION_DIGEST_MISMATCH",
      "PRODUCTION_GATE_DENIED",
      "CLOUD_POLICY_DENIED",
      "CLOUD_APPROVAL_REQUIRED",
      "CREDENTIAL_LEASE_FAILED",
      "IDEMPOTENCY_CONFLICT",
      "IMAGE_NOT_PINNED",
      "FEATURE_DISABLED",
    ] as const) {
      expect(isRetryableCode(code)).toBe(false);
    }
  });

  test("an error carries its verdict and is safe to serialize", () => {
    const err = new CloudSandboxError("SANDBOX_EXPIRED", "ttl elapsed", {
      sandboxId: "sbx_1",
      operation: "cloud.iac.apply_local",
    });
    expect(err.retryable).toBe(false);
    expect(err.toJSON()).toEqual({
      code: "SANDBOX_EXPIRED",
      message: "ttl elapsed",
      retryable: false,
      sandboxId: "sbx_1",
      operation: "cloud.iac.apply_local",
    });
  });
});
