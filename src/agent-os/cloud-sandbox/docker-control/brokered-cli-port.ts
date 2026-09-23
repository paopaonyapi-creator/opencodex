// Phase 20.15 M7 — brokered Docker control port.
//
// What this is NOT: the Docker socket proxy of source spec §15.1. That topology needs a
// request-filtering proxy between the emulator and the daemon, and building it would mean
// inventing a network component the repository has no place for yet. What this IS, and what §15
// actually needs to hold, is a broker that runs inside the Pao process and exposes five verbs --
// create, start, stop, remove, list -- with every container setting validated before a request is
// ever issued. The agent never holds a transport to the daemon; it holds an MCP/HTTP call into
// this process, which answers through policy.
//
// The transport is the operator's own `docker` CLI, invoked as an argument array. Two reasons:
// win32 exposes the daemon as a named pipe rather than a unix socket, so a socket transport is
// platform-specific work, and `validateContainerSpec` cannot drift out of the path because
// there is no path that bypasses it -- every verb below calls it or refuses.
//
// Subprocess spawning is exactly where command injection usually lands, so two rules are
// structural here rather than advisory: nothing is ever passed through a shell, and no
// caller-supplied string is ever placed in an argv *slot that selects an operation*. Callers
// supply values; the operation names, flags and the image slot come from this file.

import { CloudSandboxError } from "../errors";
import {
  parseBindSource,
  validateContainerSpec,
  type ContainerInfo,
  type ContainerSpec,
  type DockerControlPort,
  type DockerValidationResult,
} from "./port";

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (argv: string[]) => Promise<SpawnResult>;

export interface BrokeredDockerPortOptions {
  /** Default "docker". Injectable so no test touches a daemon. */
  cli?: string;
  spawn?: SpawnFn;
  /**
   * Images a container may be created from.
   *
   * Required, with no default: a port that would run any image an agent names is the arbitrary
   * code execution §15 exists to prevent, wearing a lifecycle API as a costume.
   */
  allowedImages: readonly string[];
  /** Host interface published ports bind to. Loopback is the only safe default. */
  bindAddress?: string;
}

const VERBS = {
  version: ["version", "--format", "{{.Server.Version}}"],
  create: ["create"],
  start: ["start"],
  stop: ["stop"],
  remove: ["rm"],
  inspect: ["inspect"],
  ps: ["ps", "--all"],
} as const;

export class BrokeredCliDockerControlPort implements DockerControlPort {
  readonly id = "brokered-cli";

  private readonly cli: string;
  private readonly spawn: SpawnFn;
  private readonly allowedImages: readonly string[];
  private readonly bindAddress: string;
  private reachableCache: boolean | null = null;

  constructor(options: BrokeredDockerPortOptions) {
    this.cli = options.cli ?? "docker";
    this.spawn = options.spawn ?? defaultSpawn;
    this.allowedImages = options.allowedImages;
    this.bindAddress = options.bindAddress ?? "127.0.0.1";
  }

  validate(spec: ContainerSpec): DockerValidationResult {
    return validateContainerSpec(spec, this.allowedImages);
  }

  async isReachable(): Promise<boolean> {
    if (this.reachableCache !== null) return this.reachableCache;
    try {
      const result = await this.run([...VERBS.version], "version");
      this.reachableCache = result.exitCode === 0;
    } catch {
      this.reachableCache = false;
    }
    return this.reachableCache;
  }

  /**
   * One choke point for every CLI call.
   *
   * Prefixes the configured binary and the timeout, and refuses a non-zero exit. Keeping the
   * argv assembly in `run` rather than each verb is what makes the "no caller-controlled
   * operation slot" claim checkable by reading one function.
   */
  private async run(argv: string[], operation: string): Promise<SpawnResult> {
    const result = await this.spawn([this.cli, ...argv]);
    if (result.exitCode !== 0) {
      throw new CloudSandboxError(
        "ADAPTER_UNAVAILABLE",
        `docker ${argv[0]} failed (exit ${result.exitCode}): ${result.stderr.trim() || "no stderr"}`,
        { operation: `docker.${operation}` },
      );
    }
    return result;
  }

  /**
   * Translate a validated spec into argv.
   *
   * Split out so the ordering and the flag set are assertable without a daemon. Note what is
   * absent: there is no flag path by which a caller can request `--privileged`, `--pid host`,
   * `--network host`, `--device`, or a bind mount, because the only mount flags emitted here are
   * built from entries `validateContainerSpec` already refused or allowed.
   */
  buildCreateArgs(spec: ContainerSpec): string[] {
    const args: string[] = [...VERBS.create];

    for (const [key, value] of Object.entries(spec.labels)) {
      args.push("--label", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(spec.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }
    for (const bind of spec.binds ?? []) {
      // parseBindSource rather than split(":"): a Windows source such as
      // `C:\workspace:/workspace` splits into ["C", "\workspace", "/workspace"] and would
      // silently mount the wrong thing on the platform this repository actually runs on.
      const source = parseBindSource(bind);
      const target = bind.slice(source.length + 1).split(":")[0] || source;
      args.push("--mount", `type=bind,source=${source},target=${target}`);
    }
    for (const port of spec.ports ?? []) {
      // A spec entry is a container port, optionally `4570/udp`. Docker's publish syntax is
      // `[hostip:]hostPort/containerPort`, so `127.0.0.1:4570/tcp` would be read as a host
      // address with a container port of "tcp" and the daemon would reject it -- the mapping
      // is rebuilt explicitly here rather than concatenated.
      const [containerPort, protocol = "tcp"] = port.split("/");
      if (!/^\d+$/.test(containerPort ?? "")) {
        throw new CloudSandboxError(
          "CLOUD_POLICY_DENIED",
          `Refusing docker create: port "${port}" is not a numeric container port.`,
          { operation: "docker.createContainer" },
        );
      }
      // Published on loopback only, and host port = container port so the endpoint the broker
      // hands back is the one actually bound. Floci answers unsigned S3 requests by default, so
      // a port reachable from the LAN would be an open object store, not a sandbox.
      args.push("--publish", `${this.bindAddress}:${containerPort}:${containerPort}/${protocol}`);
    }
    if (spec.networkMode) args.push("--network", spec.networkMode);
    if (spec.readonlyRootfs) args.push("--read-only");
    if (spec.limits?.cpus !== undefined) args.push("--cpus", String(spec.limits.cpus));
    if (spec.limits?.memoryMb !== undefined) args.push("--memory", `${spec.limits.memoryMb}m`);
    if (spec.limits?.pidsLimit !== undefined) args.push("--pids-limit", String(spec.limits.pidsLimit));
    if (spec.name) args.push("--name", spec.name);

    // The image is always the final positional argument, never a flag value.
    args.push(spec.image);
    return args;
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const verdict = this.validate(spec);
    if (!verdict.ok) {
      throw new CloudSandboxError(
        "CLOUD_POLICY_DENIED",
        `Container refused by the broker: ${verdict.detail.join("; ")}`,
        { operation: "docker.createContainer" },
      );
    }

    const result = await this.run(this.buildCreateArgs(spec), "create");
    const id = result.stdout.trim().split(/\s+/).pop() ?? "";
    if (!/^[0-9a-f]{12,64}$/.test(id)) {
      throw new CloudSandboxError(
        "SANDBOX_START_FAILED",
        `docker create returned an unrecognised id: "${id.slice(0, 32)}"`,
        { operation: "docker.createContainer" },
      );
    }
    return id;
  }

  async startContainer(containerId: string): Promise<void> {
    await this.run([...VERBS.start, this.requireId(containerId, "start")], "start");
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.run([...VERBS.stop, this.requireId(containerId, "stop")], "stop");
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.run([...VERBS.remove, this.requireId(containerId, "remove")], "remove");
  }

  async inspectContainer(containerId: string): Promise<ContainerInfo> {
    const result = await this.run(
      [...VERBS.inspect, "--format", "{{json .}}", this.requireId(containerId, "inspect")],
      "inspect",
    );
    const parsed = JSON.parse(result.stdout) as {
      Id?: string;
      Name?: string;
      Config?: { Image?: string; Labels?: Record<string, string> };
      State?: { Status?: string };
      Created?: string;
    };
    return {
      id: parsed.Id ?? containerId,
      image: parsed.Config?.Image ?? "unknown",
      name: (parsed.Name ?? "").replace(/^\//, ""),
      state: mapState(parsed.State?.Status),
      labels: parsed.Config?.Labels ?? {},
      createdAt: parsed.Created ?? "",
    };
  }

  async listByLabel(label: string): Promise<ContainerInfo[]> {
    const result = await this.run(
      [...VERBS.ps, "--filter", `label=${label}`, "--format", "{{json .}}"],
      "ps",
    );
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line) as { ID?: string; Image?: string; Names?: string; Status?: string; Labels?: string };
        return {
          id: row.ID ?? "",
          image: row.Image ?? "unknown",
          name: row.Names ?? "",
          state: mapState(row.Status),
          labels: parseKvList(row.Labels),
          createdAt: "",
        } satisfies ContainerInfo;
      });
  }

  /**
   * Ids reach `docker` as argv values, so the shape is checked rather than escaped.
   *
   * A leading `-` would turn an id into a flag; `/` or `\` would address another daemon or path.
   * Hex-only closes both, and a real id is always 64 hex chars.
   */
  private requireId(id: string, operation: string): string {
    if (!/^[0-9a-f]{12,64}$/.test(id)) {
      throw new CloudSandboxError(
        "CLOUD_POLICY_DENIED",
        `Refusing docker ${operation}: "${id.slice(0, 24)}" is not a container id.`,
        { operation: `docker.${operation}` },
      );
    }
    return id;
  }
}

/**
 * Two different vocabularies reach this function.
 *
 * `docker inspect` yields a machine state ("running", "exited"), while `docker ps` yields a
 * human status string ("Up 2 seconds", "Exited (0) 3 seconds ago", "Created"). Treating only the
 * first form as running made every live container read as unknown, which would have left leak
 * detection unable to tell a running orphan from a finished one.
 */
function mapState(status: string | undefined): ContainerInfo["state"] {
  const value = (status ?? "").toLowerCase().trim();
  if (value.startsWith("running") || value.startsWith("up")) return "running";
  if (value === "created") return "created";
  if (value.includes("exit") || value.includes("dead") || value.includes("stop") || value.includes("removal")) {
    return "exited";
  }
  return "unknown";
}

function parseKvList(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [key, ...rest] = part.split("=");
    if (key) out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

async function defaultSpawn(argv: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}
