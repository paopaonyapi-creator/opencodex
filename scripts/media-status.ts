// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Media Acquisition CLI Diagnostic & Status Tool

import { getMediaAcquisitionService } from "../src/agent-os/media-acquisition";

async function main() {
  console.log("==================================================");
  console.log("Pao-hubPro Media Acquisition Subsystem Diagnostics");
  console.log("==================================================");

  const service = getMediaAcquisitionService();
  const status = service.getStatus();
  console.log(`Storage Root: ${status.storageRoot}`);
  console.log(`Queue Depth:  ${status.queueDepth}`);
  console.log(`Providers:    ${status.providers.join(", ")}`);

  console.log("\n--- Provider Health ---");
  const health = await service.getHealth();
  for (const [provider, info] of Object.entries(health)) {
    console.log(`[${provider.toUpperCase()}]`);
    console.log(`  Status:    ${info.status}`);
    console.log(`  Available: ${info.available}`);
    console.log(`  Version:   ${info.version || "N/A"}`);
    if (info.latencyMs !== undefined) console.log(`  Latency:   ${info.latencyMs}ms`);
    if (info.errorMessage) console.log(`  Error:     ${info.errorMessage}`);
  }

  console.log("\n--- Telemetry Metrics ---");
  const metrics = service.metrics.getSnapshot(service.queue.getQueueDepth());
  console.log(`Total Jobs:      ${metrics.jobsTotal}`);
  console.log(`Running Jobs:    ${metrics.jobsRunning}`);
  console.log(`Completed Jobs:  ${metrics.jobsCompleted}`);
  console.log(`Failed Jobs:     ${metrics.jobsFailed}`);
  console.log(`Downloaded MB:   ${(metrics.downloadBytesTotal / (1024 * 1024)).toFixed(2)} MB`);

  console.log("\n--- Artifacts ---");
  const artifacts = service.registry.listArtifacts();
  console.log(`Total Artifacts: ${artifacts.length}`);
  for (const art of artifacts.slice(0, 5)) {
    console.log(`- ${art.artifactId} (${art.title}) [${art.usageClass}] ExportToStock: ${art.exportToStock}`);
  }

  console.log("\nDiagnostics completed successfully.");
}

main().catch((err) => {
  console.error("Diagnostic error:", err);
  process.exit(1);
});
