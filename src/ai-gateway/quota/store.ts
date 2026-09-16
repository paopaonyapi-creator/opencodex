/**
 * Pao AI Gateway — Quota store (Phase 20.51).
 *
 * In-memory keyed store of normalized quota windows. Keyed by route key
 * (`providerId/modelId`) with a fallback provider-level key for gateway-wide
 * telemetry. Snapshots are ephemeral: the source of truth is the upstream
 * gateway's own telemetry, re-read on every sync cycle.
 */

import type { QuotaWindow } from "../types";
import { selectPrimaryWindow } from "./model";

export class QuotaStore {
  private readonly windows = new Map<string, QuotaWindow[]>();

  /** Replace all windows for a route key (one sync cycle's observation). */
  upsert(routeKey: string, windows: readonly QuotaWindow[]): void {
    if (windows.length === 0) return;
    this.windows.set(routeKey, [...windows]);
  }

  /** All windows recorded for a route key. */
  get(routeKey: string): readonly QuotaWindow[] {
    return this.windows.get(routeKey) ?? [];
  }

  /**
   * The single window that best represents the route's capacity, if any.
   * Falls back to the provider-level key (`providerId/_gateway`) when the
   * exact route has no observation.
   */
  primary(routeKey: string): QuotaWindow | undefined {
    const exact = selectPrimaryWindow(this.windows.get(routeKey) ?? []);
    if (exact) return exact;
    const providerKey = `${routeKey.split("/")[0]}/_gateway`;
    return selectPrimaryWindow(this.windows.get(providerKey) ?? []);
  }

  /** Route keys currently holding at least one window. */
  keys(): string[] {
    return [...this.windows.keys()];
  }

  /** Test seam. */
  clear(): void {
    this.windows.clear();
  }
}
