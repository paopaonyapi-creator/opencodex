#!/usr/bin/env bun
// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Codex Schema Sync Utility.

import { CodexSchemaSync } from "../src/agent-os/codex-runtime/schema-sync";

const args = process.argv.slice(2);
const experimental = args.includes("--experimental");

console.log("=================================================");
console.log(` Synchronizing Codex Schemas (experimental: ${experimental})`);
console.log("=================================================");

const result = CodexSchemaSync.sync({ experimental });

if (result.success) {
  console.log(`[SUCCESS] Generated schema for Codex version: ${result.version}`);
  console.log(`TypeScript bindings:   ${result.tsFilesCount} files in ${result.tsOutputDir}`);
  console.log(`JSON-Schema bindings:  ${result.jsonFilesCount} files in ${result.jsonSchemaOutputDir}`);
  process.exit(0);
} else {
  console.error(`[ERROR] Failed to sync schema: ${result.error}`);
  process.exit(1);
}
