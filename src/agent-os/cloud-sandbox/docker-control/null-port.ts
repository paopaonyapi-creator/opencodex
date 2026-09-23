// Phase 20.15 — Cloud Sandbox Plane: the default Docker control port.
//
// Denies everything and reports itself unreachable. This is the port in use on any host
// without a Docker daemon, in every test, and in any process that has not set
// PAO_CLOUD_DOCKER_CONTROL_ENABLED.
//
// It exists so that "no Docker here" is an explicit, typed answer instead of a crash or a
// silently skipped code path: source spec §39.4 requires the Docker-unavailable failure
// mode to be tested, and docs/Phase-20.15 §10 makes it the normal case on this platform.

import { CloudSandboxError } from "../errors";
import {
  validateContainerSpec,
  type ContainerInfo,
  type ContainerSpec,
  type DockerControlPort,
  type DockerValidationResult,
} from "./port";

export class NullDockerControlPort implements DockerControlPort {
  readonly id = "null";

  async isReachable(): Promise<boolean> {
    return false;
  }

  /** Validation still runs, so a bad spec is rejected for the right reason, not for "no Docker". */
  validate(spec: ContainerSpec): DockerValidationResult {
    return validateContainerSpec(spec);
  }

  private refuse(operation: string): never {
    throw new CloudSandboxError(
      "DOCKER_UNAVAILABLE",
      `Docker control is not available, so "${operation}" cannot run. ` +
        "Enable PAO_CLOUD_DOCKER_CONTROL_ENABLED on a host with a running Docker daemon.",
      { operation },
    );
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const verdict = this.validate(spec);
    if (!verdict.ok) {
      throw new CloudSandboxError(
        "DOCKER_UNAVAILABLE",
        `Container spec rejected before scheduling: ${verdict.detail.join("; ")}`,
        { operation: "docker.createContainer" },
      );
    }
    return this.refuse("docker.createContainer");
  }

  async startContainer(): Promise<void> {
    return this.refuse("docker.startContainer");
  }

  async inspectContainer(): Promise<ContainerInfo> {
    return this.refuse("docker.inspectContainer");
  }

  async stopContainer(): Promise<void> {
    return this.refuse("docker.stopContainer");
  }

  async removeContainer(): Promise<void> {
    return this.refuse("docker.removeContainer");
  }

  /**
   * Empty rather than an error: leak detection asks this question during cleanup, and a
   * host with no Docker daemon genuinely has no orphaned containers to report. Failing
   * here would turn every ephemeral-sandbox teardown into a cleanup failure.
   */
  async listByLabel(): Promise<ContainerInfo[]> {
    return [];
  }
}

let singleton: NullDockerControlPort | null = null;

export function getNullDockerControlPort(): NullDockerControlPort {
  if (!singleton) singleton = new NullDockerControlPort();
  return singleton;
}
