// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Technical Debt Ledger: Lightweight Markdown Debt Tracker

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { TechnicalDebtItem } from "./types";

export class DebtLedger {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(process.cwd(), "docs", "governance", "technical-debt.md");
  }

  getFilePath(): string {
    return this.filePath;
  }

  /**
   * List all debt items currently recorded in the markdown file.
   */
  listDebts(): TechnicalDebtItem[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = readFileSync(this.filePath, "utf8");
      return this.parseMarkdown(content);
    } catch {
      return [];
    }
  }

  /**
   * Add a new technical debt entry.
   */
  recordDebt(item: Omit<TechnicalDebtItem, "id" | "date" | "status"> & { id?: string; date?: string; status?: "open" | "resolved" | "wontfix" }): TechnicalDebtItem {
    const date = item.date ?? new Date().toISOString().split("T")[0];
    const cleanDate = date.replace(/-/g, "");
    const existing = this.listDebts();
    const nextSeq = String(existing.length + 1).padStart(3, "0");
    const id = item.id ?? `DEBT-${cleanDate}-${nextSeq}`;

    const debt: TechnicalDebtItem = {
      ...item,
      id,
      date,
      status: item.status ?? "open",
    };

    existing.push(debt);
    this.saveMarkdown(existing);
    return debt;
  }

  private parseMarkdown(content: string): TechnicalDebtItem[] {
    const items: TechnicalDebtItem[] = [];
    const sections = content.split(/##\s+(DEBT-\d+-\d+)/g);

    for (let i = 1; i < sections.length; i += 2) {
      const id = sections[i].trim();
      const body = sections[i + 1] || "";

      const getField = (label: string): string => {
        const regex = new RegExp(`-\\s+${label}:\\s*(.+)`, "i");
        const match = body.match(regex);
        return match ? match[1].trim() : "";
      };

      const filesStr = getField("Related files");
      const relatedFiles = filesStr ? filesStr.split(",").map((f) => f.trim()) : [];
      const statusRaw = getField("Status").toLowerCase();
      const status = statusRaw === "resolved" ? "resolved" : statusRaw === "wontfix" ? "wontfix" : "open";

      items.push({
        id,
        date: getField("Date") || new Date().toISOString().split("T")[0],
        area: getField("Area") || "general",
        shortcut: getField("Shortcut") || "",
        reason: getField("Reason") || "",
        risk: getField("Risk") || "low",
        triggerToRevisit: getField("Trigger to revisit") || "",
        relatedFiles,
        owner: getField("Owner") || "developer",
        status,
      });
    }

    return items;
  }

  private saveMarkdown(items: TechnicalDebtItem[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const lines = [
      "# Pao-hubPro — Technical Debt Ledger",
      "",
      "> Managed by Ponytail Minimal-Code Governance Layer.",
      "> Tracks deliberate shortcuts, deferred refactors, and scheduled triggers for re-architecting.",
      "",
    ];

    for (const item of items) {
      lines.push(
        `## ${item.id}`,
        "",
        `- Date: ${item.date}`,
        `- Area: ${item.area}`,
        `- Shortcut: ${item.shortcut}`,
        `- Reason: ${item.reason}`,
        `- Risk: ${item.risk}`,
        `- Trigger to revisit: ${item.triggerToRevisit}`,
        `- Related files: ${item.relatedFiles.join(", ") || "none"}`,
        `- Owner: ${item.owner}`,
        `- Status: ${item.status}`,
        "",
      );
    }

    writeFileSync(this.filePath, lines.join("\n"), "utf8");
  }
}

let defaultDebtLedger: DebtLedger | null = null;
export function getDebtLedger(filePath?: string): DebtLedger {
  const resolved = filePath ?? configuredLedgerPath();
  if (!defaultDebtLedger || resolved) {
    defaultDebtLedger = new DebtLedger(resolved);
  }
  return defaultDebtLedger;
}

/**
 * Ledger path override.
 *
 * The default path is process.cwd()/docs/governance/technical-debt.md, which is a
 * TRACKED file. Any test that exercises the debt route through the management API
 * therefore appended a permanent entry to the repository — confirmed: the route's
 * own test added a DEBT-... row to docs/governance/technical-debt.md on every run,
 * with a UTC date that could make it look like a different day's edit.
 *
 * PAO_DEBT_LEDGER_PATH lets a test (or an operator) point the ledger at a temp file
 * instead. An unset variable keeps the production behaviour unchanged.
 */
function configuredLedgerPath(): string | undefined {
  const override = process.env.PAO_DEBT_LEDGER_PATH?.trim();
  return override && override.length > 0 ? override : undefined;
}

/** Test seam: forget the cached ledger so a new path (or none) takes effect. */
export function resetDebtLedger(filePath?: string): void {
  defaultDebtLedger = null;
  if (filePath !== undefined) defaultDebtLedger = new DebtLedger(filePath);
}
