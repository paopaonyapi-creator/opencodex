// Phase 20.15 M2 — Floci launch plan: the emulator's own configuration surface.
//
// Every name and default here is taken from the upstream configuration reference, not inferred
// from LocalStack habits: `FLOCI_PORT`, `FLOCI_STORAGE_MODE` (`memory|persistent|hybrid|wal`),
// `FLOCI_STORAGE_PERSISTENT_PATH` (default `./data`), `FLOCI_BASE_URL`, `FLOCI_HOSTNAME`,
// `FLOCI_DEFAULT_REGION`, `FLOCI_DEFAULT_ACCOUNT_ID`, and the console sidecar's
// `FLOCI_SERVICES_UI_*`. Recorded in docs/Phase-20.15 §10.2 with the digest this plan pins to.
//
// Two rules the shape of this module exists to enforce:
//
// 1. The plan is a value the broker hands to a container or a supervised process. It is never
//    applied to the host environment. Upstream's own quickstart is `eval $(floci env)`, which
//    would put fake AWS credentials and a local endpoint into every later process -- the exact
//    thing source spec §10 forbids, so this module has no path to `process.env` at all.
// 2. Persistent state gets a per-sandbox directory. `FLOCI_STORAGE_PERSISTENT_PATH` defaults to
//    `./data`, so two sandboxes in persistent mode sharing a working directory would silently
//    share emulator state and break the §39.3 isolation guarantee at the storage layer.

import { CloudSandboxError } from "../errors";
import { PROFILE_STORAGE_MODE } from "../types";
import type { SandboxProfile, StorageMode } from "../types";

/** Upstream default. Kept explicit so a drift in the pinned image is visible in a diff. */
export const FLOCI_DEFAULT_PORT = 4566;
export const FLOCI_DEFAULT_REGION = "us-east-1";
export const FLOCI_DEFAULT_ACCOUNT_ID = "000000000000";
export const FLOCI_IMAGE_REPOSITORY = "floci/floci";

/**
 * Pinned by digest because the published tag channel has no stable releases -- Docker Hub
 * carries `latest` plus dated `nightly-MMDDYYYY` builds only. Resolved 2026-09-23 from the
 * multi-arch index; the per-platform manifests are recorded in docs/Phase-20.15 §10.2.
 */
export const FLOCI_PINNED_IMAGE =
  `${FLOCI_IMAGE_REPOSITORY}@sha256:f5aa8c18302cedb4f2385f5c4e455b3efc77fee6bf7b6e5d1712b2817ba102db`;

export interface FlociLaunchPlanInput {
  sandboxId: string;
  /** Root under which this sandbox's isolated state directory is created. */
  stateRoot: string;
  port: number;
  profile: SandboxProfile;
  /** Overrides the profile mapping only when the profile is `resumable` or `durable`. */
  storageMode?: StorageMode;
  region?: string;
  /** Reachable address handed to Floci so URLs it returns resolve for the runner, not for the host. */
  hostname?: string;
  /**
   * Enables upstream's console sidecar. Off by default: it pulls its own image
   * (`floci/floci-ui`) and starts a container, which is a second, unapproved image path
   * through the Docker control port.
   */
  consoleEnabled?: boolean;
}

export interface FlociLaunchPlan {
  sandboxId: string;
  port: number;
  storageMode: StorageMode;
  /** Per-sandbox, so persistent and wal modes cannot share state across sandboxes. */
  storagePath: string;
  baseUrl: string;
  image: string;
  environment: Record<string, string>;
  labels: Record<string, string>;
}

const SANDBOX_ID_PATTERN = /^sbx_[A-Za-z0-9_-]{1,48}$/;

/**
 * Ports are refused outside the ephemeral range rather than trusted.
 *
 * `FLOCI_PORT` is a plain number to upstream, so without this bound an agent that can name a
 * port can bind 22, 445, or whatever the operator's own services are listening on, and a
 * collision that fails late inside the container reads as an emulator bug.
 */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export function planFlociLaunch(input: FlociLaunchPlanInput): FlociLaunchPlan {
  if (!SANDBOX_ID_PATTERN.test(input.sandboxId)) {
    throw new CloudSandboxError(
      "SANDBOX_START_FAILED",
      `sandbox id "${input.sandboxId}" must match sbx_[A-Za-z0-9_-]{1,48}; it names a state directory.`,
      { sandboxId: input.sandboxId, operation: "floci.plan" },
    );
  }
  if (!Number.isInteger(input.port) || input.port < MIN_PORT || input.port > MAX_PORT) {
    throw new CloudSandboxError(
      "SANDBOX_START_FAILED",
      `port ${input.port} is outside ${MIN_PORT}-${MAX_PORT}.`,
      { sandboxId: input.sandboxId, operation: "floci.plan" },
    );
  }

  const profileMode = PROFILE_STORAGE_MODE[input.profile];
  if (input.storageMode && input.storageMode !== profileMode && input.profile === "ephemeral") {
    // An ephemeral sandbox that writes a write-ahead log is a durability promise this profile
    // does not make, and the only signal would be disk usage nobody asked for.
    throw new CloudSandboxError(
      "SANDBOX_START_FAILED",
      `storageMode "${input.storageMode}" is not valid for profile "ephemeral"; it is memory-only.`,
      { sandboxId: input.sandboxId, operation: "floci.plan" },
    );
  }
  const storageMode = input.storageMode ?? profileMode;

  const region = input.region ?? FLOCI_DEFAULT_REGION;
  const port = input.port;
  const storagePath = `${input.stateRoot.replace(/\/+$/, "")}/${input.sandboxId}/state`;
  const baseUrl = `http://127.0.0.1:${port}`;

  const environment: Record<string, string> = {
    FLOCI_PORT: String(port),
    FLOCI_STORAGE_MODE: storageMode,
    FLOCI_STORAGE_PERSISTENT_PATH: storagePath,
    FLOCI_DEFAULT_REGION: region,
    FLOCI_DEFAULT_ACCOUNT_ID: FLOCI_DEFAULT_ACCOUNT_ID,
    FLOCI_BASE_URL: baseUrl,
    // The console is a container that pulls an image, so it is off unless explicitly asked for.
    FLOCI_SERVICES_UI_ENABLED: input.consoleEnabled ? "true" : "false",
  };
  if (input.hostname) environment.FLOCI_HOSTNAME = input.hostname;

  return {
    sandboxId: input.sandboxId,
    port,
    storageMode,
    storagePath,
    baseUrl,
    image: FLOCI_PINNED_IMAGE,
    environment,
    labels: {
      "pao.sandbox.id": input.sandboxId,
      "pao.plane": "cloud-sandbox",
    },
  };
}

/**
 * The environment an isolated runner receives to talk to a sandbox.
 *
 * Distinct from `planFlociLaunch`: that configures the emulator, this configures a client of it.
 * Keeping them separate is what lets §14 assert `env.inherit: false` and still give a Terraform
 * or AWS SDK process everything it needs.
 */
export function flociClientEnvironment(plan: Pick<FlociLaunchPlan, "baseUrl">, region = FLOCI_DEFAULT_REGION) {
  return {
    AWS_ENDPOINT_URL: plan.baseUrl,
    AWS_DEFAULT_REGION: region,
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}
