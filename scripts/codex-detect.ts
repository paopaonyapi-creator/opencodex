#!/usr/bin/env bun
// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Codex Detection & Capability Reporting Script.

import { CodexDetector } from "../src/agent-os/codex-runtime/detector";

console.log("=================================================");
console.log(" Pao-hubPro x OpenAI Codex Detection & Capabilities");
console.log("=================================================");

const platform = CodexDetector.detectPlatform();
const binaryPath = CodexDetector.getCodexBinaryPath();
const version = CodexDetector.probeCodexVersion(binaryPath);
const capabilities = CodexDetector.detectCapabilities(true);
const compatibility = CodexDetector.checkCompatibility(version);

console.log(`Platform:              ${platform}`);
console.log(`Binary Path:           ${binaryPath || "NOT FOUND"}`);
console.log(`Detected Version:      ${version || "N/A"}`);
console.log(`Compatibility Status:  ${compatibility.status.toUpperCase()} (${compatibility.message})`);
console.log(`Python SDK:            ${capabilities.pythonSdkAvailable ? "Available" : "Not installed"}`);
console.log(`App Server:            ${capabilities.appServerAvailable ? "Available" : "Not available"}`);
console.log(`Exec Server:           ${capabilities.execServerAvailable ? "Available" : "Not available"}`);
console.log(`App Server Daemon:     ${capabilities.daemonAvailable ? "Supported" : "Not supported"}`);
console.log(`Experimental API:      ${capabilities.experimentalApiEnabled ? "Enabled" : "Disabled (Default)"}`);
console.log("=================================================");
console.log(JSON.stringify({ capabilities, compatibility }, null, 2));
