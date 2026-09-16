// Phase 20.25 — Shared structural type for store access from search/ranking so
// those modules can be exercised without the SQLite handle.

import type { ToolRecord } from "./types";

export interface RegistryStoreLike {
  listTools(filter?: { status?: string; sourceKind?: string }): ToolRecord[];
}
