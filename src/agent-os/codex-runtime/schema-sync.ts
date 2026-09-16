// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Codex App Server Schema Sync: Versioned TS & JSON-Schema Generation & Drift Detection.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CodexDetector } from "./detector";

export interface SchemaSyncResult {
  success: boolean;
  version: string;
  tsOutputDir: string;
  jsonSchemaOutputDir: string;
  tsFilesCount: number;
  jsonFilesCount: number;
  experimental: boolean;
  driftDetected: boolean;
  error?: string;
}

export class CodexSchemaSync {
  static sync(options?: {
    version?: string;
    experimental?: boolean;
    baseDir?: string;
  }): SchemaSyncResult {
    const bin = CodexDetector.getCodexBinaryPath();
    const detectedVersion = options?.version || CodexDetector.probeCodexVersion(bin) || "0.147.0";
    const experimental = options?.experimental ?? (process.env.PAO_CODEX_EXPERIMENTAL_API === "true");
    const baseDir = options?.baseDir || "generated/codex";

    const targetSubdir = experimental ? "experimental" : "stable";
    const tsOut = join(baseDir, detectedVersion, targetSubdir, "ts");
    const jsonOut = join(baseDir, detectedVersion, targetSubdir, "json-schema");

    mkdirSync(tsOut, { recursive: true });
    mkdirSync(jsonOut, { recursive: true });

    if (!bin) {
      // Check if schemas already exist in target or base version directory
      const existingTs = existsSync(tsOut) ? readdirSync(tsOut).length : 0;
      const existingJson = existsSync(jsonOut) ? readdirSync(jsonOut).length : 0;

      if (existingTs > 0 && existingJson > 0) {
        return {
          success: true,
          version: detectedVersion,
          tsOutputDir: tsOut,
          jsonSchemaOutputDir: jsonOut,
          tsFilesCount: existingTs,
          jsonFilesCount: existingJson,
          experimental,
          driftDetected: false,
        };
      }

      return {
        success: false,
        version: detectedVersion,
        tsOutputDir: tsOut,
        jsonSchemaOutputDir: jsonOut,
        tsFilesCount: 0,
        jsonFilesCount: 0,
        experimental,
        driftDetected: false,
        error: "Codex binary not found and no pre-existing schema generated",
      };
    }

    try {
      const expFlag = experimental ? " --experimental" : "";

      // 1. Generate TS
      execSync(`"${bin}" app-server generate-ts --out "${tsOut}"${expFlag}`, {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 20000,
      });

      // 2. Generate JSON-Schema
      execSync(`"${bin}" app-server generate-json-schema --out "${jsonOut}"${expFlag}`, {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 20000,
      });

      const tsCount = existsSync(tsOut) ? readdirSync(tsOut).length : 0;
      const jsonCount = existsSync(jsonOut) ? readdirSync(jsonOut).length : 0;

      return {
        success: true,
        version: detectedVersion,
        tsOutputDir: tsOut,
        jsonSchemaOutputDir: jsonOut,
        tsFilesCount: tsCount,
        jsonFilesCount: jsonCount,
        experimental,
        driftDetected: false,
      };
    } catch (err: unknown) {
      return {
        success: false,
        version: detectedVersion,
        tsOutputDir: tsOut,
        jsonSchemaOutputDir: jsonOut,
        tsFilesCount: 0,
        jsonFilesCount: 0,
        experimental,
        driftDetected: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  static detectDrift(version = "0.147.0", baseDir = "generated/codex"): {
    inSync: boolean;
    missingTsFiles: string[];
    missingJsonFiles: string[];
  } {
    const tsDir = join(baseDir, version, "stable", "ts");
    const jsonDir = join(baseDir, version, "stable", "json-schema");
    const tsExists = existsSync(tsDir) && readdirSync(tsDir).length > 0;
    const jsonExists = existsSync(jsonDir) && readdirSync(jsonDir).length > 0;
    return {
      inSync: tsExists && jsonExists,
      missingTsFiles: tsExists ? [] : ["ts output missing or empty"],
      missingJsonFiles: jsonExists ? [] : ["json schema output missing or empty"],
    };
  }
}

