// Phase 20.15 M2 — real-Floci integration check.
//
// Opt-in only, because it needs a live emulator: `PAO_CLOUD_FLOCI_REAL=1 bun test
// tests/cloud-sandbox-floci-integration.test.ts`. Skipped otherwise, so the default suite stays
// hermetic and CI without Docker is unaffected.
//
// This is the file that turns the adapter's assumptions into observations. Everything asserted
// here was read off the pinned image `floci/floci@sha256:f5aa8c18…` running on loopback.

import { describe, expect, test } from "bun:test";

import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { FLOCI_HEALTH_PATH } from "../src/agent-os/cloud-sandbox/adapters/floci-config";

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
  },
);
