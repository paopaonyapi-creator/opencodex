#!/usr/bin/env bun
// Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer
// CLI Operational Diagnostics & Status Tool

import { getNotificationService } from "../src/agent-os/notifications";

async function main() {
  console.log("================================================================================");
  console.log("    PAO-HUBPRO UNIFIED NOTIFICATION GATEWAY & DISCORD RELIABILITY STATUS        ");
  console.log("================================================================================");

  try {
    const service = getNotificationService();
    const status = await service.getStatus();
    const metrics = service.getMetrics();

    console.log(`\n[System & Worker]`);
    console.log(`  Gateway Enabled:         ${status.enabled ? "YES" : "NO"}`);
    console.log(`  Worker Enabled:          ${status.workerEnabled ? "YES" : "NO"}`);
    console.log(`  Worker Active:           ${status.workerActive ? "RUNNING" : "STOPPED"}`);
    console.log(`  Discord Adapter Enabled: ${status.discordEnabled ? "YES" : "NO"}`);

    console.log(`\n[Destinations & Circuits]`);
    console.log(`  Total Destinations:      ${status.totalDestinations}`);
    console.log(`  Healthy Destinations:    ${status.healthyDestinations}`);
    console.log(`  Open Circuit Breakers:   ${status.openCircuits}`);

    console.log(`\n[Delivery Queues & Health]`);
    console.log(`  Queued Deliveries:       ${status.queuedDeliveries}`);
    console.log(`  Rate-Limited Deliveries: ${status.rateLimitedDeliveries}`);
    console.log(`  Open Dead Letters:       ${status.openDeadLetters}`);
    console.log(`  Invalid Requests (10m):  ${status.invalidRequests10m}`);

    console.log(`\n[Performance Metrics (Today)]`);
    console.log(`  Events Ingested:         ${metrics.eventsToday}`);
    console.log(`  Total Deliveries:        ${metrics.deliveriesToday}`);
    console.log(`  Delivered Successfully:  ${metrics.delivered}`);
    console.log(`  Retrying:                ${metrics.retrying}`);
    console.log(`  Failed / Dead-Lettered:  ${metrics.failed} / ${metrics.deadLetter}`);
    console.log(`  Success Rate:            ${metrics.successRate}%`);
    console.log(`  Rate-Limit Hits (10m):   ${metrics.rateLimitCount10m}`);

    const destinations = service.listDestinationsPublic();
    if (destinations.length > 0) {
      console.log(`\n[Configured Destinations]`);
      for (const d of destinations) {
        const healthBadge = d.health === "healthy" ? "OK" : d.health.toUpperCase();
        console.log(`  - [${d.id}] ${d.name.padEnd(24)} (${d.provider}) [${healthBadge}] enabled=${d.enabled ? "yes" : "no"}`);
      }
    }

    const { states: rateLimitStates, gates: providerGates } = service.listRateLimits();
    if (providerGates.length > 0) {
      console.log(`\n[Provider Global Pause Gates]`);
      for (const g of providerGates) {
        const paused = g.pausedUntilMs && g.pausedUntilMs > Date.now();
        console.log(`  - Provider: ${g.provider.padEnd(10)} Paused: ${paused ? `YES (until ${new Date(g.pausedUntilMs!).toISOString()})` : "NO"}`);
      }
    }

    if (rateLimitStates.length > 0) {
      console.log(`\n[Dynamic Rate Limit Observations]`);
      for (const s of rateLimitStates) {
        const blocked = s.blockedUntilMs && s.blockedUntilMs > Date.now();
        console.log(`  - Bucket: ${(s.bucketId ?? "default").padEnd(16)} remaining=${s.remaining ?? "?"}/${s.limit ?? "?"} resetAfter=${s.resetAfterMs ?? 0}ms blocked=${blocked ? "YES" : "NO"}`);
      }
    }

    const deadLetters = service.listDeadLetters(5);
    if (deadLetters.length > 0) {
      console.log(`\n[Recent Open Dead Letters (Sample: ${deadLetters.length})]`);
      for (const dl of deadLetters) {
        console.log(`  - [${dl.id}] dest=${dl.destinationId} reason=${dl.reason} attempts=${dl.attemptsCount}`);
      }
    }

    console.log("\n================================================================================");
    console.log("Status check completed successfully.");
  } catch (err) {
    console.error("\n[Error checking notification status]:", err);
    process.exit(1);
  }
}

void main();
