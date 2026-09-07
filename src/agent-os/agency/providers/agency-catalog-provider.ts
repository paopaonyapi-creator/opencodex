// Phase 20.8 — Unified Agency Catalog Provider Interface
import type { AgencyAgent, AgencySyncResult } from "../types";

export interface AgencyCatalogProvider {
  readonly name: string;
  readonly sourceType: "remote-git" | "local-clone" | "cached-snapshot" | "bundled-fallback";

  isAvailable(): Promise<boolean> | boolean;
  sync(): Promise<AgencySyncResult>;
  listAgents(): Promise<AgencyAgent[]>;
  getAgent(slug: string): Promise<AgencyAgent | null>;
  getAgentBody(slug: string): Promise<string>;
}
