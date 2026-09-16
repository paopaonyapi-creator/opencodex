// Phase 20.35 — compatibility shim. The provider adapter runtimes live in
// adapters.ts (renamed during review hardening); all consumers import from
// here so the public surface is stable.

export * from "./adapters";
