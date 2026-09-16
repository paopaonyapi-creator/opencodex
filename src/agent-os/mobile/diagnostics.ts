/**
 * Phase 20.55 — runtime/device diagnostics mapped to ready/degraded/blocked.
 */

import { getArtemisProvider } from "./artemis-adapter";
import { getMobileConfig } from "./config";
import { getMobileDeviceRegistry } from "./device-registry";

export type DiagnosticVerdict = "ready" | "degraded" | "blocked";

export interface MobileDiagnosticReport {
  readonly verdict: DiagnosticVerdict;
  readonly runtime: { readonly name: string; readonly ok: boolean; readonly version?: string; readonly message?: string; readonly consoleBindable: boolean };
  readonly devices: Array<{ readonly id: string; readonly alias: string; readonly status: string; readonly usable: boolean }>;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly checkedAt: number;
}

export async function diagnoseMobileRuntime(): Promise<MobileDiagnosticReport> {
  const config = getMobileConfig();
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!config.enabled) blockers.push("PAO_MOBILE_ENABLED=false");
  if (config.artemisHost !== "127.0.0.1" && config.artemisHost !== "localhost") {
    blockers.push("ARTEMIS console host is not loopback; public bind is forbidden");
  }
  const health = await getArtemisProvider().health();
  if (!health.ok) warnings.push(health.message || "ARTEMIS runtime not ready");
  const devices = getMobileDeviceRegistry().listDevices().map((d) => ({
    id: d.id,
    alias: d.alias,
    status: d.status,
    usable: d.status === "ready" && d.allowAgent && d.trustLevel !== "blocked",
  }));
  if (devices.length === 0) warnings.push("no devices registered");
  if (!devices.some((d) => d.usable) && blockers.length === 0) warnings.push("no usable device");
  const verdict: DiagnosticVerdict = blockers.length ? "blocked" : (!health.ok || !devices.some((d) => d.usable) ? "degraded" : "ready");
  return {
    verdict,
    runtime: {
      name: "artemis",
      ok: health.ok,
      version: health.version,
      message: health.message,
      consoleBindable: config.artemisHost === "127.0.0.1" || config.artemisHost === "localhost",
    },
    devices,
    blockers,
    warnings,
    checkedAt: Date.now(),
  };
}

