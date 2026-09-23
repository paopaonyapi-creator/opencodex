// Phase 20.15 — Cloud Sandbox Plane: brokered Docker control port.
//
// Source spec §15 makes this a MUST: the forbidden topology is an agent that can reach
// `/var/run/docker.sock`, and the required one routes every Docker operation through the
// policy engine. That guarantee only holds if the validation lives here, in the port, and
// not in whichever adapter happens to want a container — an adapter that validated its own
// container spec would be one new adapter away from having no validation at all.
//
// Note the platform reality recorded in docs/Phase-20.15 §10: this repository has no
// Docker client and runs on win32, where Docker Desktop exposes a named pipe rather than
// a unix socket. `NullDockerControlPort` is therefore the default implementation, and a
// real one is deferred to milestone M7.

import { homedir } from "node:os";

export interface ContainerResourceLimits {
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
}

export interface ContainerSpec {
  image: string;
  name?: string;
  labels: Record<string, string>;
  env?: Record<string, string>;
  binds?: string[];
  ports?: string[];
  networkMode?: string;
  pidMode?: string;
  ipcMode?: string;
  privileged?: boolean;
  devices?: string[];
  readonlyRootfs?: boolean;
  limits?: ContainerResourceLimits;
}

export interface ContainerInfo {
  id: string;
  image: string;
  name: string;
  state: "created" | "running" | "exited" | "unknown";
  labels: Record<string, string>;
  createdAt: string;
}

export type DockerRejectionReason =
  | "privileged"
  | "host-network"
  | "host-pid"
  | "host-ipc"
  | "forbidden-bind-mount"
  | "device-passthrough"
  | "image-not-allowlisted";

export interface DockerValidationResult {
  ok: boolean;
  rejections: DockerRejectionReason[];
  detail: string[];
}

export interface DockerControlPort {
  readonly id: string;

  isReachable(): Promise<boolean>;

  /** Must be called before `createContainer`; the port enforces it regardless. */
  validate(spec: ContainerSpec): DockerValidationResult;

  createContainer(spec: ContainerSpec): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  inspectContainer(containerId: string): Promise<ContainerInfo>;
  stopContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;

  /** Source spec §47: leak detection needs to find orphans by sandbox label. */
  listByLabel(label: string): Promise<ContainerInfo[]>;
}

/** Source spec §47 label scheme. */
export const SANDBOX_LABELS = {
  sandbox: "pao.sandbox.id",
  workspace: "pao.workspace.id",
  run: "pao.run.id",
} as const;

/**
 * Source spec §37 host-protection list.
 *
 * These are prefixes, not exact matches, so `/home/user/x` and `/root/.aws` are both
 * caught. `docker.sock` is matched as a substring because its path differs per platform
 * (`/var/run/docker.sock` on Linux, a named pipe on Windows).
 */
export const FORBIDDEN_BIND_PREFIXES: readonly string[] = [
  "/",
  "/etc",
  "/root",
  "/home",
  "/var/run",
  "~/.ssh",
  "~/.aws",
  "~/.azure",
  "~/.config/gcloud",
  "~/.docker",
];

export const FORBIDDEN_BIND_SUBSTRINGS: readonly string[] = [
  "docker.sock",
  "docker_engine",
  ".ssh",
  ".aws/credentials",
];

export const ALLOWLISTED_NETWORK_MODES: readonly string[] = ["bridge", "none"];

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

/**
 * The running user's home directory, normalized once.
 *
 * §37 lists `/root`, `/home` and `~/.ssh`, which on Linux covers the profile — but on
 * Windows the profile is `C:\Users\<name>` and matches none of those spellings, so an
 * agent-controlled container could bind the entire profile, credentials included. `homedir()`
 * is the only form that is correct on both platforms, and this repository runs on win32.
 */
const HOME_DIR = normalizePath(homedir());

const WINDOWS_DRIVE_BIND = /^[A-Za-z]:[\\/]/;

/**
 * The Windows profiles root — the direct analogue of `/home`, which §37 already forbids.
 * Anchored on a drive letter so a POSIX path such as `/data/users/svc` is not caught by it.
 */
const WINDOWS_PROFILES_ROOT = /^[a-z]:\/users(?:\/|$)/;

/**
 * Source half of a `source:target[:mode]` bind spec.
 *
 * Splitting on ":" is wrong on Windows: `C:\Users\me:/workspace` yields "C", which matches
 * no forbidden prefix, so a home-directory mount would pass. The drive letter is re-joined
 * before the split.
 */
export function parseBindSource(bind: string): string {
  if (!WINDOWS_DRIVE_BIND.test(bind)) return bind.split(":")[0] ?? "";
  const afterDrive = bind.slice(2);
  const separator = afterDrive.indexOf(":");
  return separator === -1 ? bind : bind.slice(0, 2 + separator);
}

export function isForbiddenBind(source: string): boolean {
  const normalized = normalizePath(source);
  if (FORBIDDEN_BIND_SUBSTRINGS.some((needle) => normalized.includes(needle))) return true;

  // A bare Windows drive root is the same mount as "/" on Linux, and matching only the
  // POSIX spelling would let `C:\` through on the platform this repository runs on.
  if (/^[a-z]:\/?$/.test(normalized)) return true;
  if (WINDOWS_PROFILES_ROOT.test(normalized)) return true;

  // The profile itself, on whichever platform we are actually on. The static prefix list
  // stays because it also covers *other* users' homes, which homedir() does not.
  if (HOME_DIR && (normalized === HOME_DIR || normalized.startsWith(`${HOME_DIR}/`))) return true;

  return FORBIDDEN_BIND_PREFIXES.some((prefix) => {
    const target = prefix.toLowerCase();
    if (target === "/") return normalized === "/" || normalized === "//";
    return normalized === target || normalized.startsWith(`${target}/`);
  });
}

/**
 * Shared by every port implementation so the rules cannot drift between them.
 *
 * `allowlist` is optional: when omitted, image selection is not checked here, because the
 * mock port and tests have no image policy. A real port must pass one.
 */
export function validateContainerSpec(
  spec: ContainerSpec,
  allowlist?: readonly string[],
): DockerValidationResult {
  const rejections: DockerRejectionReason[] = [];
  const detail: string[] = [];

  if (spec.privileged === true) {
    rejections.push("privileged");
    detail.push("privileged containers are refused (source spec §37)");
  }
  if (spec.networkMode && !ALLOWLISTED_NETWORK_MODES.includes(spec.networkMode)) {
    rejections.push("host-network");
    detail.push(`network mode "${spec.networkMode}" is not in ${ALLOWLISTED_NETWORK_MODES.join(", ")}`);
  }
  if (spec.pidMode === "host") {
    rejections.push("host-pid");
    detail.push("host PID namespace is refused");
  }
  if (spec.ipcMode === "host") {
    rejections.push("host-ipc");
    detail.push("host IPC namespace is refused");
  }
  if (spec.devices && spec.devices.length > 0) {
    rejections.push("device-passthrough");
    detail.push(`device passthrough refused: ${spec.devices.join(", ")}`);
  }
  for (const bind of spec.binds ?? []) {
    const source = parseBindSource(bind);
    if (isForbiddenBind(source)) {
      if (!rejections.includes("forbidden-bind-mount")) rejections.push("forbidden-bind-mount");
      detail.push(`bind mount source "${source}" is on the host-protection list`);
    }
  }
  if (allowlist && !allowlist.includes(spec.image)) {
    rejections.push("image-not-allowlisted");
    detail.push(`image "${spec.image}" is not in the allowlist`);
  }

  return { ok: rejections.length === 0, rejections, detail };
}
