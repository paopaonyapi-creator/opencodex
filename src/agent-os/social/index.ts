// Phase 20.20 — Pao-hubPro Social Intelligence Engine.
//
// Provider-agnostic social research subsystem: Apify provider adapter, local tool
// registry with idempotent catalog refresh, explainable router, central cost guard,
// bounded-fallback run lifecycle, normalized evidence with provenance, trend signal
// aggregation, and original-concept Adobe Stock opportunity proposals.

export * from "./types";
export * from "./config";
export * from "./errors";
export * from "./audit";
export * from "./capabilities";
export * from "./url-policy";
export * from "./provider";
export * from "./apify-provider";
export * from "./registry";
export * from "./cost-guard";
export * from "./router";
export * from "./normalizer";
export * from "./dedupe";
export * from "./research";
export * from "./trends";
export * from "./stock-opportunity";
export * from "./mcp-tools";
