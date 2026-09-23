// Phase 20.15 M2 — cleanup controller and leak detection.
//
// Source spec §46 lists twelve destroy steps and §47 lists seven surfaces to check. This module
// covers the surfaces the brokered port can actually see and says nothing about the rest:
// containers, registry rows, and sandboxes stranded mid-lifecycle. Networks, volumes, host
// processes and open ports are NOT checked here, because `DockerControlPort` deliberately exposes
// five verbs and adding a `listNetworks`/`listVolumes` surface to it is a security review of its
// own -- a broker that enumerates everything the daemon knows is drifting back toward the raw
// socket access §15 forbids.
//
// The distinction that matters throughout: a leak is reported, never silently repaired, except
// for orphans whose sandbox is already recorded destroyed. Repairing a container that belongs to
// a live sandbox because its label matched a prefix would destroy someone's running work.

import { CloudSandboxError } from "./errors";
import type { CloudEmulatorAdapterRegistry } from "./adapter-spi";
import type { CloudSandboxDbStore } from "./db-store";
import type { SandboxManager } from "./sandbox-manager";
import type { DockerControlPort } from "./docker-control/port";
import { SANDBOX_LABELS } from "./docker-control/port";
import type { CloudSandboxRecord, DestroyReport, LeakFinding } from "./types";

export interface CleanupDeps {
  store: CloudSandboxDbStore;
  adapters: CloudEmulatorAdapterRegistry;
  docker: DockerControlPort;
  manager: SandboxManager;
  now?: () => Date;
}

export interface CleanupCycleReport {
  startedAt: string;
  finishedAt: string;
  reaped: string[];
  reapFailures: Array<{ sandboxId: string; message: string }>;
  orphansRemoved: string[];
  /** Still outstanding after the cycle: never flattened into "clean". */
  outstandingLeaks: LeakFinding[];
  stranded: string[];
}

const DESTROYED_OR_ABSENT = new Set(["destroyed", "failed"]);

export class CleanupController {
  private readonly now: () => Date;

  constructor(private readonly deps: CleanupDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  /**
   * §47, container surface.
   *
   * A container carrying a sandbox label whose sandbox row is destroyed, failed, or simply gone
   * is an orphan by definition -- the registry already believes it was cleaned up.
   */
  async detectContainerLeaks(): Promise<LeakFinding[]> {
    const containers = await this.deps.docker.listByLabel(SANDBOX_LABELS.sandbox);
    const findings: LeakFinding[] = [];

    for (const container of containers) {
      const sandboxId = container.labels[SANDBOX_LABELS.sandbox];
      if (!sandboxId) continue;
      const record = this.deps.store.getSandbox(sandboxId);
      if (!record || DESTROYED_OR_ABSENT.has(record.status)) {
        findings.push({ kind: "container", identifier: container.id, sandboxId });
      }
    }

    return findings;
  }

  /**
   * §47, registry surface.
   *
   * Resource rows attached to a sandbox that is no longer live mean the destroy path removed the
   * runtime but not the inventory, which would make every later "no leaks" verdict read from
   * rows that no longer describe anything real.
   */
  detectRegistryLeaks(): LeakFinding[] {
    const findings: LeakFinding[] = [];
    for (const record of this.deps.store.listSandboxes(undefined, 1000)) {
      if (record.destroyedAt === null) continue;
      for (const resource of this.deps.store.listResources(record.id)) {
        findings.push({ kind: "registry", identifier: resource.id, sandboxId: record.id });
      }
    }
    return findings;
  }

  /**
   * Sandboxes left in `destroying` -- the shape a crash between "mark destroying" and
   * "mark destroyed" produces, and the reason destroy is not allowed to assume it finished.
   */
  detectStranded(): string[] {
    return this.deps.store
      .listSandboxes(undefined, 1000)
      .filter((record) => record.status === "destroying" || record.status === "provisioning")
      .map((record) => record.id);
  }

  async detectLeaks(): Promise<LeakFinding[]> {
    return [...(await this.detectContainerLeaks()), ...this.detectRegistryLeaks()];
  }

  /**
   * Remove only what the registry already considers gone.
   *
   * Bounded by detectContainerLeaks(), so a live sandbox's container is never touched. Removal
   * failures are collected as still-outstanding leaks rather than thrown: one wedged container
   * must not stop the sweep of the rest, and swallowing it as success would be worse.
   */
  async removeOrphans(): Promise<{ removed: string[]; stillLeaked: LeakFinding[] }> {
    const orphans = await this.detectContainerLeaks();
    const removed: string[] = [];
    const stillLeaked: LeakFinding[] = [];

    for (const orphan of orphans) {
      try {
        await this.deps.docker.stopContainer(orphan.identifier);
        await this.deps.docker.removeContainer(orphan.identifier);
        removed.push(orphan.identifier);
      } catch {
        stillLeaked.push(orphan);
      }
    }

    return { removed, stillLeaked };
  }

  /**
   * One full cycle: reap expired, then sweep orphans, then re-measure.
   *
   * Re-measuring after removal rather than reporting "clean" from the removal loop's own
   * bookkeeping is deliberate -- the second opinion is what catches a daemon that accepted a
   * stop and never actually released the container.
   */
  async runCycle(): Promise<CleanupCycleReport> {
    const startedAt = this.timestamp();
    const reaped = await this.deps.manager.reapExpired();
    const sweep = await this.removeOrphans();
    const outstandingLeaks = await this.detectLeaks();
    const stranded = this.detectStranded();

    return {
      startedAt,
      finishedAt: this.timestamp(),
      reaped: reaped.destroyed,
      reapFailures: reaped.failed,
      orphansRemoved: sweep.removed,
      outstandingLeaks,
      stranded,
    };
  }

  /**
   * §46 steps 4-5 and 10-11 for one sandbox: collect final evidence, then prove emptiness.
   *
   * Returns the destroy report enriched with leaks that the adapter alone cannot see -- an
   * emulator-side container is visible to it, a stale registry row is not.
   */
  async destroyWithVerification(sandboxId: string, reason = "manual"): Promise<DestroyReport> {
    const record: CloudSandboxRecord = this.deps.manager.get(sandboxId);
    const adapter = this.deps.adapters.get(record.adapter);
    if (!adapter) {
      throw new CloudSandboxError(
        "ADAPTER_UNAVAILABLE",
        `Cannot destroy ${sandboxId}: adapter "${record.adapter}" is not registered.`,
        { sandboxId, operation: "cloud.sandbox.destroy" },
      );
    }

    // Collected before teardown: after destroy there is nothing left to read.
    const logs = await adapter.collectLogs(sandboxId).catch(() => null);
    const inventory = this.deps.store.listResources(sandboxId);

    // manager.destroy answers with an outcome wrapper: { sandboxId, report, resourcesRemoved }.
    // Reading `leaked` off the wrapper yields undefined, and spreading undefined crashes on the
    // success path -- the one path that must never throw.
    const outcome = await this.deps.manager.destroy(sandboxId, reason);
    const containerLeaks = await this.detectContainerLeaks();
    const registryLeaks = this.detectRegistryLeaks().filter((row) => row.sandboxId === sandboxId);

    const leaked = [...outcome.report.leaked, ...containerLeaks, ...registryLeaks];

    return {
      sandboxId,
      destroyedAt: outcome.report.destroyedAt,
      // The store's own count is what was actually wiped; the inventory length is what the
      // registry knew beforehand, and evidence (§31) needs the larger of the two.
      resourcesRemoved: Math.max(outcome.resourcesRemoved, inventory.length),
      leaked,
      ok: leaked.length === 0 && logs !== null && logs.streams.length > 0,
    };
  }
}
