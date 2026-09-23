// Phase 20.15 M2 — real-Floci integration check.
//
// Opt-in only, because it needs a live emulator: `PAO_CLOUD_FLOCI_REAL=1 bun test
// tests/cloud-sandbox-floci-integration.test.ts`. Skipped otherwise, so the default suite stays
// hermetic and CI without Docker is unaffected.
//
// This is the file that turns the adapter's assumptions into observations. Everything asserted
// here was read off the pinned image `floci/floci@sha256:f5aa8c18…` running on loopback.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { FlociAwsAdapter } from "../src/agent-os/cloud-sandbox/adapters/floci-aws";
import {
  FLOCI_HEALTH_PATH,
  FLOCI_PINNED_IMAGE,
} from "../src/agent-os/cloud-sandbox/adapters/floci-config";
import { BrokeredCliDockerControlPort } from "../src/agent-os/cloud-sandbox/docker-control/brokered-cli-port";
import { SANDBOX_LABELS } from "../src/agent-os/cloud-sandbox/docker-control/port";

const RUN = process.env.PAO_CLOUD_FLOCI_REAL === "1";
const BASE = process.env.PAO_CLOUD_FLOCI_ENDPOINT ?? "http://127.0.0.1:4566";

describe.skipIf(!RUN)("phase 20.15 M2 — live Floci integration", () => {
    test(`GET ${FLOCI_HEALTH_PATH} answers with a parseable health document`, async () => {
      const response = await fetch(`${BASE}${FLOCI_HEALTH_PATH}`, { method: "GET" });
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        version?: string;
        services?: Record<string, string>;
      };
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(Object.keys(body.services ?? {}).length).toBeGreaterThan(50);
    });

    test("the adapter's health probe path is the one the image healthchecks", async () => {
      // /health is served too, but the container's own healthcheck.sh uses /_floci/health, and
      // the trailing-slash form 404s -- pinning to the image's choice is what keeps a future
      // alias removal from being discovered as a stuck sandbox.
      const canonical = await fetch(`${BASE}${FLOCI_HEALTH_PATH}`);
      const alias = await fetch(`${BASE}/health`);
      const trailing = await fetch(`${BASE}${FLOCI_HEALTH_PATH}/`);
      expect(canonical.status).toBe(200);
      expect(alias.status).toBe(200);
      expect(trailing.status).toBe(404);
    });

    test("health says 'running' for Docker-backed services it cannot actually run", async () => {
      // The single most important cross-check in this file. The container was started with no
      // Docker socket mounted, yet the health document lists lambda/rds/eks as running. If
      // fidelity were derived from health, an agent would be told a Lambda sandbox works.
      const body = (await (await fetch(`${BASE}${FLOCI_HEALTH_PATH}`)).json()) as {
        services: Record<string, string>;
      };
      expect(body.services.lambda).toBe("running");
      expect(body.services.rds).toBe("running");

      const registry = new CloudCapabilityRegistry();
      expect(registry.requiresDocker("lambda")).toBe(true);
      // With no reachable daemon our registry answers UNAVAILABLE, which is the disagreement
      // this test exists to keep honest.
      expect(registry.effectiveFidelity("lambda", false)).toBe("UNAVAILABLE");
    });

    test("an unsigned S3 list is served, which is why the bind address is a control", async () => {
      // Floci accepts unsigned requests unless FLOCI_SERVICES_S3_ENFORCE_AUTH is set. On
      // loopback that is a convenience; published on an interface, the same behaviour makes it
      // an open object store. The adapter therefore binds 127.0.0.1 and never a wildcard.
      const response = await fetch(`${BASE}/?list-type=2`, { method: "GET" });
      expect(response.status).toBe(200);
      const xml = await response.text();
      expect(xml).toContain("ListAllMyBucketsResult");
    });
  });

describe.skipIf(process.env.PAO_CLOUD_DOCKER_REAL !== "1")(
  "phase 20.15 M7 — brokered port to a real daemon",
  () => {
    test("Floci starts through the broker, answers health, and leaves nothing behind", async () => {
      // This is the §15 topology asserted end to end: the adapter reaches the daemon only through
      // the brokered port, and the emulator is gone afterwards with no orphan carrying its label.
      const docker = new BrokeredCliDockerControlPort({ allowedImages: [FLOCI_PINNED_IMAGE] });
      expect(await docker.isReachable()).toBe(true);

      const adapter = new FlociAwsAdapter({
        docker,
        capabilities: new CloudCapabilityRegistry(),
        stateRoot: mkdtempSync(join(tmpdir(), "pao-floci-state-")),
        portBase: 4571,
        pollDeadlineMs: 120_000,
      });

      const runtime = await adapter.startSandbox({
        id: "sbx_live01",
        workspaceId: "ws_live",
        taskId: null,
        runId: null,
        actorId: "agent_integration",
        profile: "ephemeral",
        services: ["s3", "dynamodb", "lambda"],
        storageMode: "memory",
        ttlMinutes: 10,
      });

      expect(runtime.endpoints.base).toBe("http://127.0.0.1:4571");

      const health = await adapter.health("sbx_live01");
      expect(health.state).toBe("healthy");
      expect(health.endpointReachable).toBe(true);
      expect((health.registeredServices?.length ?? 0)).toBeGreaterThan(50);

      // Docker-backed fidelity still comes from the registry, not from the emulator's own
      // "running" claim -- this is the disagreement that would otherwise be a silent lie.
      expect(await adapter.serviceFidelity("sbx_live01", "lambda")).toBe("DOCKER_BACKED");

      const published = await docker.listByLabel(`${SANDBOX_LABELS.sandbox}=sbx_live01`);
      expect(published.length).toBeGreaterThan(0);

      const report = await adapter.destroy("sbx_live01");
      expect(report.ok).toBe(true);
      expect(report.leaked).toEqual([]);

      const after = await docker.listByLabel(`${SANDBOX_LABELS.sandbox}=sbx_live01`);
      expect(after).toEqual([]);
    }, 180_000);

    test("the broker refuses a privileged container before the daemon sees it", async () => {
      const docker = new BrokeredCliDockerControlPort({ allowedImages: [FLOCI_PINNED_IMAGE] });
      await expect(
        docker.createContainer({
          image: FLOCI_PINNED_IMAGE,
          labels: { [SANDBOX_LABELS.sandbox]: "sbx_evil" },
          privileged: true,
        }),
      ).rejects.toThrow(/refused by the broker/);
    });
  },
);
