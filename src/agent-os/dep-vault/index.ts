// Phase 20.38 — Dependency Vault public surface for routes/MCP/tools.
// The service itself lives in vault.ts; this module is the stable import
// boundary (the §24 install gate is a method on DependencyVaultService).

export { getDependencyVaultService, resetDependencyVaultForTests } from "./vault";
export type { InstallMode } from "./types";
