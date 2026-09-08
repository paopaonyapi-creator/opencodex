// Phase 20.12 — Browser Task Memory Manager
//
// Persistent learned knowledge of interactive element signatures across domains.
// Enables cross-workflow learning, layout-drift adaptation, and accelerated execution.

import { openAgentOsDb } from "../../db";
import type { ElementSignature, TaskMemoryRecord } from "./types";

export class TaskMemoryManager {
  /**
   * Normalizes a URL or raw domain into a standard domain hostname.
   */
  public normalizeDomain(raw: string): string {
    try {
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        const u = new URL(raw);
        return u.hostname.toLowerCase();
      }
    } catch {
      // Fallback
    }
    return raw.replace(/^https?:\/\//i, "").split(/[/:]/)[0].toLowerCase();
  }

  /**
   * Records a successful element interaction into domain task memory.
   */
  public recordSuccess(
    rawDomain: string,
    taskPattern: string,
    elementKey: string,
    signature: ElementSignature,
  ): void {
    const domain = this.normalizeDomain(rawDomain);
    const db = openAgentOsDb();
    const now = Date.now();

    // Check existing record for domain and taskPattern
    const existing = db
      .query(
        "SELECT * FROM browser_task_memories WHERE domain = ? AND task_pattern = ? LIMIT 1",
      )
      .get(domain, taskPattern) as Record<string, unknown> | null;

    if (existing) {
      let signatures: Record<string, ElementSignature> = {};
      try {
        signatures = JSON.parse(String(existing.element_signatures_json || "{}"));
      } catch {
        signatures = {};
      }
      signatures[elementKey] = signature;

      const currentRate = Number(existing.success_rate || 1.0);
      const newRate = Math.min(1.0, currentRate * 0.95 + 0.05);

      db.query(`
        UPDATE browser_task_memories
        SET element_signatures_json = ?, success_rate = ?, last_used_at = ?
        WHERE id = ?
      `).run(JSON.stringify(signatures), newRate, now, String(existing.id));
    } else {
      const id = `tm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const signatures: Record<string, ElementSignature> = { [elementKey]: signature };

      db.query(`
        INSERT INTO browser_task_memories (id, domain, task_pattern, element_signatures_json, success_rate, last_used_at, created_at)
        VALUES (?, ?, ?, ?, 1.0, ?, ?)
      `).run(id, domain, taskPattern, JSON.stringify(signatures), now, now);
    }
  }

  /**
   * Records a failure for a domain task pattern to adjust success rate downward.
   */
  public recordFailure(rawDomain: string, taskPattern: string): void {
    const domain = this.normalizeDomain(rawDomain);
    const db = openAgentOsDb();
    const existing = db
      .query(
        "SELECT * FROM browser_task_memories WHERE domain = ? AND task_pattern = ? LIMIT 1",
      )
      .get(domain, taskPattern) as Record<string, unknown> | null;

    if (existing) {
      const currentRate = Number(existing.success_rate || 1.0);
      const newRate = Math.max(0.1, currentRate * 0.8);
      db.query(`
        UPDATE browser_task_memories
        SET success_rate = ?, last_used_at = ?
        WHERE id = ?
      `).run(newRate, Date.now(), String(existing.id));
    }
  }

  /**
   * Retrieves a learned element signature for a domain and element key.
   */
  public getSignature(rawDomain: string, elementKey: string): ElementSignature | null {
    const domain = this.normalizeDomain(rawDomain);
    const db = openAgentOsDb();

    const rows = db
      .query("SELECT element_signatures_json FROM browser_task_memories WHERE domain = ? ORDER BY last_used_at DESC")
      .all(domain) as Record<string, unknown>[];

    for (const r of rows) {
      try {
        const sigs = JSON.parse(String(r.element_signatures_json || "{}")) as Record<string, ElementSignature>;
        if (elementKey in sigs) {
          return sigs[elementKey];
        }
        // Substring matching on keys
        for (const [k, v] of Object.entries(sigs)) {
          if (k.toLowerCase().includes(elementKey.toLowerCase()) || elementKey.toLowerCase().includes(k.toLowerCase())) {
            return v;
          }
        }
      } catch {
        // ignore parse error
      }
    }

    return null;
  }

  /**
   * Lists task memory records, optionally filtered by domain.
   */
  public listMemory(rawDomain?: string): TaskMemoryRecord[] {
    const db = openAgentOsDb();
    let rows: Record<string, unknown>[];

    if (rawDomain) {
      const domain = this.normalizeDomain(rawDomain);
      rows = db
        .query("SELECT * FROM browser_task_memories WHERE domain = ? ORDER BY last_used_at DESC")
        .all(domain) as Record<string, unknown>[];
    } else {
      rows = db
        .query("SELECT * FROM browser_task_memories ORDER BY last_used_at DESC LIMIT 100")
        .all() as Record<string, unknown>[];
    }

    return rows.map((r) => {
      let sigs = {};
      try {
        sigs = JSON.parse(String(r.element_signatures_json || "{}"));
      } catch {
        // ignore
      }

      return {
        id: String(r.id),
        domain: String(r.domain),
        taskPattern: String(r.task_pattern),
        elementSignatures: sigs,
        successRate: Number(r.success_rate),
        lastUsedAt: Number(r.last_used_at),
        createdAt: Number(r.created_at),
      };
    });
  }

  /**
   * Clears memory records for a domain or entirely.
   */
  public clearMemory(rawDomain?: string): void {
    const db = openAgentOsDb();
    if (rawDomain) {
      const domain = this.normalizeDomain(rawDomain);
      db.query("DELETE FROM browser_task_memories WHERE domain = ?").run(domain);
    } else {
      db.query("DELETE FROM browser_task_memories").run();
    }
  }
}

let taskMemoryManagerInstance: TaskMemoryManager | null = null;
export function getTaskMemoryManager(): TaskMemoryManager {
  if (!taskMemoryManagerInstance) {
    taskMemoryManagerInstance = new TaskMemoryManager();
  }
  return taskMemoryManagerInstance;
}
