// ocx stock / pao stock — Adobe Stock Autonomous Production Pipeline CLI
// (Phase 20.10, Phase 20.31, Phase 21.1; GOLD §25).

import {
  CliUsageError,
  printData,
  rejectArgs,
  runCliAction,
  takeFlag,
  takeOption,
  type RuntimeApiDeps,
} from "./runtime-api";
import { StockAutonomousPipelineEngine } from "../agent-os/stock-pipeline/pipeline-engine";

export const USAGE = `Usage:
  ocx stock run --query <topic> [--market <code>] [--count <n>] [--json]
  ocx stock status [<id>] [--json]
  ocx stock list [--limit <n>] [--json]`;

async function runStockCommand(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const args = [...argv];
  const subcommand = args[0] && !args[0].startsWith("-") ? args.shift()! : "status";
  const json = takeFlag(args, "--json");

  const engine = new StockAutonomousPipelineEngine();

  if (subcommand === "run") {
    const queryOpt = takeOption(args, "--query");
    const marketOpt = takeOption(args, "--market");
    const countOpt = takeOption(args, "--count");
    rejectArgs(args, USAGE);

    if (!queryOpt) {
      throw new CliUsageError("stock run requires --query <topic>\n\n" + USAGE);
    }

    const run = await engine.runFullPipeline({
      query: queryOpt,
      market: marketOpt || "US",
      targetAssetCount: countOpt ? Number(countOpt) : 10,
    });

    printData(run, json, [
      "--- Adobe Stock Autonomous Pipeline Run ---",
      "Pipeline ID:   " + run.id,
      "Status:        " + run.status + " (Stage " + String(run.currentStage) + ")",
      "Query:         " + queryOpt,
      "Target Assets: " + String(run.targetAssetCount),
      "Market:        " + run.market,
    ]);
    return;
  }

  if (subcommand === "status") {
    const id = args[0] && !args[0].startsWith("-") ? args.shift()! : undefined;
    rejectArgs(args, USAGE);

    if (id) {
      const run = engine.getPipelineRun(id);
      if (!run) {
        throw new CliUsageError("Pipeline run not found: " + id);
      }
      printData(run, json, [
        "Pipeline ID:   " + run.id,
        "Status:        " + run.status + " (Stage " + String(run.currentStage) + ")",
        "Query:         " + run.query + " (Market: " + run.market + ")",
        "Target Assets: " + String(run.targetAssetCount),
      ]);
      return;
    }

    const runs = engine.listPipelineRuns({ limit: 5 });
    printData(runs, json, [
      "Recent Adobe Stock Pipeline Runs (" + String(runs.length) + "):",
      ...runs.map((r) => "  " + r.id + " | " + r.query + " | " + r.status + " | Stage " + String(r.currentStage)),
    ]);
    return;
  }

  if (subcommand === "list") {
    const limitOpt = takeOption(args, "--limit");
    rejectArgs(args, USAGE);

    const limit = limitOpt ? Math.max(1, Number(limitOpt) || 20) : 20;
    const runs = engine.listPipelineRuns({ limit });

    printData(runs, json, [
      "Adobe Stock Pipeline Runs (" + String(runs.length) + "):",
      ...runs.map((r) => "  " + r.id + " | " + r.query + " | " + r.status + " | Stage " + String(r.currentStage)),
    ]);
    return;
  }

  throw new CliUsageError("Unknown stock subcommand: " + subcommand + "\n\n" + USAGE);
}

export async function handleStock(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  return runCliAction(() => runStockCommand(argv, deps));
}
