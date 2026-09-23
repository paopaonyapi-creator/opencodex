import { describe, expect, test } from "bun:test";

import {
  CloudCapabilityRegistry,
  getCloudCapabilityRegistry,
} from "../src/agent-os/cloud-sandbox/capability-registry";

const registry = getCloudCapabilityRegistry();

describe("phase 20.15 — wave 1 is only what runs without Docker", () => {
  test("wave 1 contains no Docker-backed service", () => {
    const wave1 = registry.servicesForWave(1, false);
    expect(wave1.sort()).toEqual(
      ["dynamodb", "logs", "s3", "secretsmanager", "sns", "sqs", "ssm"].sort(),
    );
    for (const service of wave1) {
      expect(registry.requiresDocker(service)).toBe(false);
    }
  });

  test("lambda and rds are wave 2 and need a daemon", () => {
    // Source spec §75 recommends starting with Lambda, but §1.3 of the same document lists
    // it as Docker-backed. Recording the conflict as a test keeps the decision visible.
    expect(registry.definition("lambda")?.wave).toBe(2);
    expect(registry.requiresDocker("lambda")).toBe(true);
    expect(registry.requiresDocker("rds")).toBe(true);
    expect(registry.servicesForWave(2, false)).not.toContain("lambda");
    expect(registry.servicesForWave(2, true)).toContain("lambda");
  });

  test("high-footprint services sit in wave 3 and never approve themselves", () => {
    expect(registry.servicesForWave(3, true).sort()).toEqual(["ec2", "ecs", "eks", "msk"].sort());
    expect(registry.approvalModeOf("eks")).toBe("required");
    expect(registry.approvalModeOf("msk")).toBe("required");
    expect(registry.approvalModeOf("ec2")).toBe("conditional");
  });

  test("a custom definition list replaces the default rather than merging", () => {
    const custom = new CloudCapabilityRegistry([
      {
        service: "s3",
        baselineFidelity: "STUB",
        requiresDocker: false,
        risk: "low",
        approvalMode: "none",
        wave: 1,
        operations: ["create"],
      },
    ]);
    expect(custom.definitions()).toHaveLength(1);
    expect(custom.definition("lambda")).toBeUndefined();
    expect(custom.effectiveFidelity("s3", false)).toBe("STUB");
  });
});

describe("phase 20.15 — fidelity markers (source spec §42)", () => {
  test("an in-process service reports IN_PROCESS regardless of Docker", () => {
    expect(registry.effectiveFidelity("s3", true)).toBe("IN_PROCESS");
    expect(registry.effectiveFidelity("s3", false)).toBe("IN_PROCESS");
  });

  test("a Docker-backed service reports UNAVAILABLE when there is no daemon", () => {
    // This is the substitution that makes "local passed" meaningless on its own: the marker
    // travels with every resource and health report, so §43 can gate promotion on it.
    expect(registry.effectiveFidelity("lambda", true)).toBe("DOCKER_BACKED");
    expect(registry.effectiveFidelity("lambda", false)).toBe("UNAVAILABLE");
    expect(registry.effectiveFidelity("rds", false)).toBe("UNAVAILABLE");
    expect(registry.effectiveFidelity("eks", false)).toBe("UNAVAILABLE");
  });

  test("an unclassified service is UNKNOWN and takes the strictest approval mode", () => {
    expect(registry.effectiveFidelity("quantumledger", false)).toBe("UNKNOWN");
    expect(registry.isKnown("quantumledger")).toBe(false);
    expect(registry.approvalModeOf("quantumledger")).toBe("required");
    // Unknown must not be reachable by default: requiresDocker answers true, so it is
    // reported UNAVAILABLE rather than silently treated as in-process.
    expect(registry.requiresDocker("quantumledger")).toBe(true);
  });

  test("partial-fidelity services keep PARTIAL even with Docker available", () => {
    expect(registry.effectiveFidelity("eventbridge", true)).toBe("PARTIAL");
    expect(registry.effectiveFidelity("stepfunctions", true)).toBe("PARTIAL");
    expect(registry.effectiveFidelity("apigateway", true)).toBe("PARTIAL");
  });
});

describe("phase 20.15 — capability construction", () => {
  test("ids follow the provider.service shape from source spec §8.2", () => {
    expect(CloudCapabilityRegistry.capabilityId("aws", "s3")).toBe("aws.s3");
    expect(registry.build("aws", "s3", false)?.id).toBe("aws.s3");
  });

  test("an unknown service builds nothing rather than a permissive capability", () => {
    expect(registry.build("aws", "quantumledger", false)).toBeNull();
  });

  test("the credential class follows the trust zone, never the other way round", () => {
    // Source spec §5.6: local fake credentials must not become a real credential abstraction.
    expect(registry.build("aws", "s3", false)?.credentialProfile).toBe("LOCAL_FAKE");
    expect(registry.build("aws", "s3", false, ["local", "staging"])?.credentialProfile).toBe(
      "STAGING_LIMITED",
    );
    expect(
      registry.build("aws", "s3", false, ["local", "staging", "production"])?.credentialProfile,
    ).toBe("PRODUCTION_APPROVAL_ONLY");
  });

  test("fidelity in the built capability reflects the host, not the service's best case", () => {
    expect(registry.build("aws", "lambda", false)?.fidelity).toBe("UNAVAILABLE");
    expect(registry.build("aws", "lambda", true)?.fidelity).toBe("DOCKER_BACKED");
  });

  test("risk and approval mode survive the build", () => {
    const eks = registry.build("aws", "eks", true);
    expect(eks?.risk).toBe("high");
    expect(eks?.approvalMode).toBe("required");
    expect(eks?.requiresDocker).toBe(true);
  });

  test("the singleton is stable and resettable", () => {
    expect(getCloudCapabilityRegistry()).toBe(registry);
  });
});
