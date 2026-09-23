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
export { FlociAwsAdapter, type FlociAdapterOptions, type FlociHealthProbe } from "./adapters/floci-aws";
export {
  FLOCI_DEFAULT_ACCOUNT_ID,
  FLOCI_DEFAULT_PORT,
  FLOCI_DEFAULT_REGION,
  FLOCI_HEALTH_PATH,
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
  CleanupController,
  type CleanupCycleReport,
  type CleanupDeps,
} from "./cleanup";
export {
  cloudPolicyVerdict,
  createCloudPolicyGate,
  type CloudGateCapability,
} from "./policy-gate";

import { join } from "node:path";
import { getConfigDir } from "../../config";
import { CloudEmulatorAdapterRegistry } from "./adapter-spi";
import { CloudSandboxDbStore } from "./db-store";
import type { DockerControlPort } from "./docker-control/port";
import { getNullDockerControlPort } from "./docker-control/null-port";
import { BrokeredCliDockerControlPort } from "./docker-control/brokered-cli-port";
import { MockCloudEmulatorAdapter } from "./adapters/mock";
import { FlociAwsAdapter } from "./adapters/floci-aws";
import { readCloudSandboxFlags, validatePinnedImage, type CloudSandboxFlags } from "./flags";
import { getCloudCapabilityRegistry } from "./capability-registry";

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
 * Registration is chosen by configuration, never by assumption about the host: with the Docker
 * control flag off, or no pinned image named, the plane registers only the mock, so a process
 * that set nothing pays nothing and a host without a daemon gets an honest refusal instead of a
 * half-working emulator. `docker` is injectable for tests; nothing in this function spawns
 * anything by itself.
 */
export function activateCloudSandboxPlane(overrides: { docker?: DockerControlPort } = {}): CloudEmulatorAdapterRegistry {
  const registry = getCloudEmulatorAdapterRegistry();
  const flags = getCloudSandboxFlags();

  const imageVerdict = validatePinnedImage(flags.flociImage);
  if (flags.dockerControlEnabled && imageVerdict.ok) {
    if (!registry.get("floci-aws")) {
      registry.register(
        new FlociAwsAdapter({
          docker: overrides.docker ?? new BrokeredCliDockerControlPort({ allowedImages: [flags.flociImage!] }),
          capabilities: getCloudCapabilityRegistry(),
          stateRoot: join(getConfigDir(), "cloud", "sandboxes"),
        }),
      );
    }
  }

  if (!registry.get("mock-aws")) {
    registry.register(new MockCloudEmulatorAdapter({ docker: overrides.docker ?? getNullDockerControlPort() }));
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
