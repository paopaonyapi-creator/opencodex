// Phase 20.15 — Cloud Sandbox Plane: subsystem entry point.
//
// Everything here is lazy. Importing this module must not open a SQLite file, probe Docker,
// or start a timer, because docs/Phase-20.15 §4.1 makes this an optional subsystem: a
// process that never sets PAO_CLOUD_SANDBOX_ENABLED has to pay nothing for its existence.
// `tests/cloud-sandbox-core-boundary.test.ts` enforces that the proxy core never reaches
// this file at all.

export * from "./types";
export * from "./errors";
export {
  DEFAULT_FLOCI_ENDPOINT,
  assertCloudSandboxEnabled,
  evaluateEnvironmentGate,
  readCloudSandboxFlags,
  validatePinnedImage,
  type CloudSandboxFlags,
  type EnvironmentGate,
} from "./flags";
export {
  CloudEmulatorAdapterRegistry,
  type CloudEmulatorAdapter,
} from "./adapter-spi";
export {
  CloudCapabilityRegistry,
  getCloudCapabilityRegistry,
  resetCloudCapabilityRegistryForTests,
  type AdoptionWave,
  type CloudServiceDefinition,
} from "./capability-registry";
export {
  CLOUD_SANDBOX_SCHEMA_VERSION,
  CloudSandboxDbStore,
  type BeginOperationInput,
  type BeginOperationResult,
} from "./db-store";
export {
  ALLOWLISTED_NETWORK_MODES,
  FORBIDDEN_BIND_PREFIXES,
  FORBIDDEN_BIND_SUBSTRINGS,
  SANDBOX_LABELS,
  isForbiddenBind,
  parseBindSource,
  validateContainerSpec,
  type ContainerInfo,
  type ContainerResourceLimits,
  type ContainerSpec,
  type DockerControlPort,
  type DockerRejectionReason,
  type DockerValidationResult,
} from "./docker-control/port";
export { NullDockerControlPort, getNullDockerControlPort } from "./docker-control/null-port";
export { MockCloudEmulatorAdapter, type MockAdapterOptions } from "./adapters/mock";
export { FlociAwsAdapter, type FlociAdapterOptions } from "./adapters/floci-aws";
export {
  FLOCI_DEFAULT_ACCOUNT_ID,
  FLOCI_DEFAULT_PORT,
  FLOCI_DEFAULT_REGION,
  FLOCI_IMAGE_REPOSITORY,
  FLOCI_PINNED_IMAGE,
  flociClientEnvironment,
  planFlociLaunch,
  type FlociLaunchPlan,
  type FlociLaunchPlanInput,
} from "./adapters/floci-config";
export {
  SandboxManager,
  type CloudAuthorizer,
  type ReapResult,
  type SandboxAccess,
  type SandboxManagerDeps,
} from "./sandbox-manager";
export {
  cloudPolicyVerdict,
  createCloudPolicyGate,
  type CloudGateCapability,
} from "./policy-gate";

import { CloudEmulatorAdapterRegistry } from "./adapter-spi";
import { CloudSandboxDbStore } from "./db-store";
import { getNullDockerControlPort } from "./docker-control/null-port";
import { MockCloudEmulatorAdapter } from "./adapters/mock";
import { readCloudSandboxFlags, type CloudSandboxFlags } from "./flags";

let flagsSingleton: CloudSandboxFlags | null = null;
let dbSingleton: CloudSandboxDbStore | null = null;
let adapterRegistrySingleton: CloudEmulatorAdapterRegistry | null = null;

/**
 * Read once per process. Flags come from the environment, so re-reading on every call would
 * let a sandbox created before a flag flip disagree with one created after it.
 */
export function getCloudSandboxFlags(): CloudSandboxFlags {
  if (!flagsSingleton) flagsSingleton = readCloudSandboxFlags();
  return flagsSingleton;
}

/**
 * The sidecar store, opened on first use.
 *
 * `PAO_CLOUD_SANDBOX_DB` overrides the path and exists for tests: without it a test suite
 * would write into the operator's real `$OPENCODEX_HOME`.
 */
export function getCloudSandboxDbStore(): CloudSandboxDbStore {
  if (!dbSingleton) {
    dbSingleton = new CloudSandboxDbStore(getCloudSandboxFlags().dbPathOverride ?? undefined);
  }
  return dbSingleton;
}

export function getCloudEmulatorAdapterRegistry(): CloudEmulatorAdapterRegistry {
  if (!adapterRegistrySingleton) adapterRegistrySingleton = new CloudEmulatorAdapterRegistry();
  return adapterRegistrySingleton;
}

/**
 * Activation seam for docs/Phase-20.15 §4.1.
 *
 * Registers the mock adapter and wires the Docker port it uses. A real Floci adapter
 * registers here in M2; until then the mock is the only implementation, and registering it
 * explicitly (rather than at import time) keeps an inactive process free of both.
 */
export function activateCloudSandboxPlane(): CloudEmulatorAdapterRegistry {
  const registry = getCloudEmulatorAdapterRegistry();
  if (!registry.get("mock-aws")) {
    registry.register(
      new MockCloudEmulatorAdapter({ docker: getNullDockerControlPort() }),
    );
  }
  return registry;
}

/**
 * Test-only teardown. Closes the SQLite handle rather than dropping the reference: WAL
 * leaves `-wal`/`-shm` siblings and an open handle makes `rmSync` fail with EBUSY on
 * Windows, which is what commit a6b97c01b fixed elsewhere in this repository.
 */
export function resetCloudSandboxForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  adapterRegistrySingleton?.clear();
  adapterRegistrySingleton = null;
  flagsSingleton = null;
}
