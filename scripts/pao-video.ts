#!/usr/bin/env bun
/**
 * Phase 20.13 — Pao-hubPro Video Intelligence CLI
 * Usage:
 *   bun scripts/pao-video.ts analyze <source> [options]
 *   bun scripts/pao-video.ts video analyze <source> [options]
 */

import { writeFileSync } from "node:fs";
import {
  getVideoJobManager,
  type VideoJobConfig,
  type VideoJobIntent,
} from "../src/agent-os/video-intelligence";

function printHelp(): void {
  console.log(`
Pao-hubPro Video Intelligence CLI (Phase 20.13)
Usage:
  pao video analyze <source> [options]

Commands:
  analyze <source>         Analyze video file or URL

Options:
  --intent <name>          Intent mode: general, adobe_stock_qc, hook_analysis, screen_debug, summary
  --profile <name>         Quality profile (standard, deep)
  --start <seconds>        Start time in seconds for range analysis
  --end <seconds>          End time in seconds for range analysis
  --sampling <mode>        Sampling mode: auto, scene, uniform (default: auto)
  --scene-threshold <val>  Threshold for scene change detection (0.1 - 1.0)
  --max-frames <num>       Maximum keyframes to extract
  --hook, --no-hook        Enable or disable 0-10s hook microscope analysis
  --local-only             Force 100% offline local analysis (no external API calls)
  --reviewer-council       Trigger multi-model Reviewer Council evaluation
  --output <file>          Write report output to specified file path
  --json                   Output machine-readable JSON instead of Markdown
  --help, -h               Show this help message
`);
}

export async function runVideoCli(args: string[]): Promise<number> {
  // Normalize args: support both `video analyze ...` and `analyze ...`
  let subArgs = [...args];
  if (subArgs[0] === "video") {
    subArgs = subArgs.slice(1);
  }

  const command = subArgs[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command !== "analyze") {
    console.error(`Unknown command: '${command}'. Use 'analyze <source>' or '--help'.`);
    return 1;
  }

  const source = subArgs[1];
  if (!source || source.startsWith("--")) {
    console.error("Error: Missing required <source> parameter (URL or file path).");
    return 1;
  }

  // Parse options
  const config: VideoJobConfig = {
    sampling: "auto",
    enableHookMicroscope: true,
  };

  let isJson = false;
  let outputPath: string | undefined;

  for (let i = 2; i < subArgs.length; i++) {
    const opt = subArgs[i];
    if (opt === "--intent" && subArgs[i + 1]) {
      config.intent = subArgs[++i] as VideoJobIntent;
    } else if (opt === "--profile" && subArgs[i + 1]) {
      const profile = subArgs[++i];
      if (profile === "deep") config.deepAnalysis = true;
    } else if (opt === "--start" && subArgs[i + 1]) {
      config.startSec = Number(subArgs[++i]);
    } else if (opt === "--end" && subArgs[i + 1]) {
      config.endSec = Number(subArgs[++i]);
    } else if (opt === "--sampling" && subArgs[i + 1]) {
      config.sampling = subArgs[++i] as any;
    } else if (opt === "--scene-threshold" && subArgs[i + 1]) {
      config.sceneThreshold = Number(subArgs[++i]);
    } else if (opt === "--max-frames" && subArgs[i + 1]) {
      config.maxFrames = Number(subArgs[++i]);
    } else if (opt === "--hook") {
      config.enableHookMicroscope = true;
    } else if (opt === "--no-hook") {
      config.enableHookMicroscope = false;
    } else if (opt === "--local-only") {
      config.localOnly = true;
    } else if (opt === "--reviewer-council") {
      config.reviewerCouncil = true;
    } else if (opt === "--output" && subArgs[i + 1]) {
      outputPath = subArgs[++i];
    } else if (opt === "--json") {
      isJson = true;
    }
  }

  try {
    const manager = getVideoJobManager();
    const job = await manager.submitJob(source, config);

    // Poll until completed or failed
    const startTime = Date.now();
    let current = manager.getJob(job.id);
    while (current && current.status !== "completed" && current.status !== "failed") {
      if (Date.now() - startTime > 120000) {
        throw new Error("Job timed out after 120 seconds");
      }
      await new Promise((r) => setTimeout(r, 80));
      current = manager.getJob(job.id);
    }

    if (!current || current.status === "failed") {
      console.error(`Analysis failed: ${current?.error ?? "Unknown error"}`);
      return 1;
    }

    const report = current.report;
    if (!report) {
      console.error("Analysis completed without report artifact.");
      return 1;
    }

    const outputText = isJson ? JSON.stringify(report, null, 2) : report.markdownReport;

    if (outputPath) {
      writeFileSync(outputPath, outputText, "utf8");
      console.log(`Report successfully written to ${outputPath}`);
    } else {
      console.log(outputText);
    }

    return 0;
  } catch (err) {
    console.error(`Error executing video analysis: ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runVideoCli(process.argv.slice(2));
  process.exit(exitCode);
}
