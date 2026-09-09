#!/usr/bin/env bun
// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: CLI Runner
// Usage:
//   bun run scripts/pao-memory.ts stats
//   bun run scripts/pao-memory.ts search "<query>" [--min-score 0.2] [--type video|image] [--limit 5]
//   bun run scripts/pao-memory.ts similar <item_id> [--limit 5]
//   bun run scripts/pao-memory.ts rag "<query>" [--limit 3]
//   bun run scripts/pao-memory.ts index-video <report_json_file>

import { readFileSync, existsSync } from "node:fs";
import { getMediaMemoryIndex, getMediaMemoryRetriever } from "../src/agent-os/media-memory";
import type { MediaType } from "../src/agent-os/media-memory/types";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
Pao-hubPro Visual Knowledge & Media Memory CLI (Phase 20.14)

Commands:
  stats                                   Print memory index and storage statistics
  search <query> [options]                Semantic natural language search
  similar <item_id> [options]             Find nearest neighbor media assets
  rag <query> [options]                   Synthesize prompt context pack for AI agents
  index-video <file.json>                 Ingest a VideoAnalysisReport into media memory

Options:
  --min-score <score>                     Minimum similarity score (0.0 to 1.0)
  --type <video|image>                    Filter by media type
  --limit <k>                             Maximum results to return
  --json                                  Format output as JSON
`);
    process.exit(0);
  }

  const isJson = args.includes("--json");
  const getOpt = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const retriever = getMediaMemoryRetriever();
  const index = getMediaMemoryIndex();

  if (command === "stats") {
    const stats = index.getStats();
    if (isJson) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("\n--- Pao-hubPro Visual Knowledge & Media Memory Stats ---");
      console.log(`Total Media Items:     ${stats.totalItems}`);
      console.log(`  - Videos:            ${stats.videoCount}`);
      console.log(`  - Images:            ${stats.imageCount}`);
      console.log(`Total Vectors:         ${stats.totalVectors} (${stats.vectorDimensions} dims)`);
      console.log(`Index Size on Disk:    ${(stats.indexSizeBytes / 1024).toFixed(2)} KB\n`);
    }
    return;
  }

  if (command === "search") {
    const queryText = args[1];
    if (!queryText || queryText.startsWith("--")) {
      console.error("Error: Please provide a search query.");
      process.exit(1);
    }
    const minScore = getOpt("--min-score") ? Number(getOpt("--min-score")) : 0.15;
    const mediaType = getOpt("--type") as MediaType | undefined;
    const limit = getOpt("--limit") ? Number(getOpt("--limit")) : 10;

    const results = retriever.search({
      queryText,
      minScore,
      mediaType,
      limit,
    });

    if (isJson) {
      console.log(JSON.stringify({ query: queryText, total: results.length, results }, null, 2));
    } else {
      console.log(`\nFound ${results.length} match(es) for "${queryText}":\n`);
      for (const r of results) {
        const scorePct = Math.round(r.similarityScore * 100);
        console.log(`[${scorePct}%] ${r.item.title} (${r.item.mediaType})`);
        console.log(`      ID: ${r.item.id}`);
        console.log(`      Summary: ${r.item.summary}`);
        if (r.item.concepts?.length) {
          console.log(`      Concepts: ${r.item.concepts.join(", ")}`);
        }
        console.log("");
      }
    }
    return;
  }

  if (command === "similar") {
    const itemId = args[1];
    if (!itemId || itemId.startsWith("--")) {
      console.error("Error: Please provide a reference item ID.");
      process.exit(1);
    }
    const limit = getOpt("--limit") ? Number(getOpt("--limit")) : 5;
    const minScore = getOpt("--min-score") ? Number(getOpt("--min-score")) : 0.2;

    const results = retriever.findSimilar(itemId, limit, minScore);
    if (isJson) {
      console.log(JSON.stringify({ itemId, similar: results }, null, 2));
    } else {
      console.log(`\nFound ${results.length} similar item(s) to ${itemId}:\n`);
      for (const r of results) {
        const scorePct = Math.round(r.similarityScore * 100);
        console.log(`[${scorePct}%] ${r.item.title} (${r.item.id})`);
        console.log(`      ${r.item.summary}\n`);
      }
    }
    return;
  }

  if (command === "rag") {
    const query = args[1];
    if (!query || query.startsWith("--")) {
      console.error("Error: Please provide a query for RAG context generation.");
      process.exit(1);
    }
    const limit = getOpt("--limit") ? Number(getOpt("--limit")) : 3;
    const pack = retriever.buildRagContext(query, limit);

    if (isJson) {
      console.log(JSON.stringify(pack, null, 2));
    } else {
      console.log("\n" + pack.contextMarkdown);
      console.log(`(Estimated Tokens: ${pack.tokensEstimated})\n`);
    }
    return;
  }

  if (command === "index-video") {
    const filePath = args[1];
    if (!filePath || !existsSync(filePath)) {
      console.error(`Error: File '${filePath}' does not exist.`);
      process.exit(1);
    }
    const raw = readFileSync(filePath, "utf-8");
    const report = JSON.parse(raw);
    const res = retriever.indexVideoReport(report);
    if (isJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`\nSuccessfully indexed video report '${report.jobId}' into Media Memory.`);
      console.log(`Item ID: ${res.item.id}`);
      console.log(`Vectors Generated: ${res.vectors.length} (${res.vectors.map((v) => v.vectorType).join(", ")})\n`);
    }
    return;
  }

  console.error(`Unknown command: '${command}'. Use --help for usage.`);
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
