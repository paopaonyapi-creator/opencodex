// Phase 20.15 M2/M7 — real-Floci integration.
//
// Opt-in: `PAO_CLOUD_FLOCI_REAL=1 bun test tests/cloud-sandbox-floci-integration.test.ts`.
// Skipped otherwise, so the default suite stays hermetic and CI without Docker is unaffected.
//
// The block provisions its OWN emulator through the brokered Docker port rather than assuming
// somebody started one on 4566. That distinction is not stylistic: the first version of this file
// read a manually-run container, and the moment the container was cleaned up four tests failed on
// a host that had done nothing wrong. A test that depends on leftover system state reports the
// state of the machine rather than the behaviour of the code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { FlociAwsAdapter } from "../src/agent-os/cloud-sandbox/adapters/floci-aws";
import { FLOCI_HEALTH_PATH, FLOCI_PINNED_IMAGE } from "../src/agent-os/cloud-sandbox/adapters/floci-config";
import { BrokeredCliDockerControlPort } from "../src/agent-os/cloud-sandbox/docker-control/brokered-cli-port";
import { SANDBOX_LABELS } from "../src/agent-os/cloud-sandbox/docker-control/port";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN = process.env.PAO_CLOUD_FLOCI_REAL === "1";
const PORT = 4571;
const BASE = `http://127.0.0.1:${PORT}`;
const SANDBOX_ID = "sbx_itgrat";

let adapter: FlociAwsAdapter;
let docker: BrokeredCliDockerControlPort;
let startError: unknown;

describe.skipIf(!RUN)("phase 20.15 — live Floci through the broker", () => {
  beforeAll(async () => {
    docker = new BrokeredCliDockerControlPort({ allowedImages: [FLOCI_PINNED_IMAGE] });
    adapter = new FlociAwsAdapter({
      docker,
      capabilities: new CloudCapabilityRegistry(),
      stateRoot: mkdtempSync(join(tmpdir(), "pao-floci-state-")),
      portBase: PORT,
      pollDeadlineMs: 120_000,
    });
    try {
      await adapter.startSandbox({
        id: SANDBOX_ID,
        workspaceId: "ws_itgrat",
        taskId: null,
        runId: null,
        actorId: "agent_integration",
        profile: "ephemeral",
        services: ["s3", "dynamodb", "lambda"],
        storageMode: "memory",
        ttlMinutes: 10,
      });
    } catch (err) {
      startError = err;
    }
  }, 240_000);

  afterAll(async () => {
    if (startError) return;
    await adapter?.destroy(SANDBOX_ID).catch(() => undefined);
    // Belt and braces: the destroy path asserts, this guarantees a crashed run cannot leave a
    // labelled container bound to a port on the developer's machine.
    const leftovers = await docker.listByLabel(`${SANDBOX_LABELS.sandbox}=${SANDBOX_ID}`);
    for (const orphan of leftovers) {
      await docker.stopContainer(orphan.id).catch(() => undefined);
      await docker.removeContainer(orphan.id).catch(() => undefined);
    }
  }, 120_000);

  test("the provisioned emulator is actually up", () => {
    // Surfaced first so every failure below reads as "could not start" rather than as a pile of
    // confusing network errors.
    if (startError) throw startError;
  });

  test(`GET ${FLOCI_HEALTH_PATH} answers with a parseable health document`, async () => {
    const response = await fetch(`${BASE}${FLOCI_HEALTH_PATH}`, { method: "GET" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version?: string; services?: Record<string, string> };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(body.services ?? {}).length).toBeGreaterThan(50);
  });

  test("the adapter's health path is the one the image healthchecks", async () => {
    // /health is served too and the trailing-slash form 404s, so the pinned path is the one the
    // container's own healthcheck.sh relies on.
    const canonical = await fetch(`${BASE}${FLOCI_HEALTH_PATH}`);
    const alias = await fetch(`${BASE}/health`);
    const trailing = await fetch(`${BASE}${FLOCI_HEALTH_PATH}/`);
    expect(canonical.status).toBe(200);
    expect(alias.status).toBe(200);
    expect(trailing.status).toBe(404);
  });

  test("health claims Docker-backed services the registry does not vouch for", async () => {
    // The cross-check that keeps fidelity in the registry: the emulator reports lambda running,
    // and our own probe of it says DOCKER_BACKED -- a state, not a promise that it works.
    const body = (await (await fetch(`${BASE}${FLOCI_HEALTH_PATH}`)).json()) as {
      services: Record<string, string>;
    };
    expect(body.services.lambda).toBe("running");
    expect(await adapter.serviceFidelity(SANDBOX_ID, "lambda")).toBe("DOCKER_BACKED");
    expect(await adapter.serviceFidelity(SANDBOX_ID, "s3")).toBe("IN_PROCESS");
  });

  test("an unsigned S3 list is served, which is why the bind address is a control", async () => {
    // Floci does not enforce SigV4 by default, so a published port on a routable interface would
    // be an open object store. The broker publishes on 127.0.0.1 and the mapping is rebuilt from
    // the container port, which is also why the base URL above is loopback.
    const response = await fetch(`${BASE}/?list-type=2`, { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ListAllMyBucketsResult");
  });

  test("the broker refuses a privileged container before the daemon sees it", async () => {
    await expect(
      docker.createContainer({
        image: FLOCI_PINNED_IMAGE,
        labels: { [SANDBOX_LABELS.sandbox]: "sbx_denied" },
        privileged: true,
      }),
    ).rejects.toThrow(/refused by the broker/);
  });

  test("destroy removes the container and leaves no labelled orphan", async () => {
    const report = await adapter.destroy(SANDBOX_ID);
    expect(report.ok).toBe(true);
    expect(report.leaked).toEqual([]);
    expect(await docker.listByLabel(`${SANDBOX_LABELS.sandbox}=${SANDBOX_ID}`)).toEqual([]);
  }, 120_000);
});
