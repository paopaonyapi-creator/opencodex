/**
 * Phase 24 — Pao Autonomous Cost & Token Economy: Budget Ledger
 * Tracks multi-dimensional quotas, debits spend, and maintains audit transaction receipts.
 */

import type {
  BudgetRecord,
  BudgetScope,
  CostTransaction,
  RecordTransactionInput,
} from "./types";

export interface RegisterBudgetInput {
  id?: string;
  scope: BudgetScope;
  targetId?: string;
  name: string;
  limitUsd: number;
  softWarningPercent?: number;
}

export class BudgetLedger {
  private budgets: Map<string, BudgetRecord> = new Map();
  private transactions: CostTransaction[] = [];
  private maxTransactions: number;

  constructor(maxTransactions = 500) {
    this.maxTransactions = maxTransactions;
  }

  /**
   * Register or update a budget allocation
   */
  public registerBudget(input: RegisterBudgetInput): BudgetRecord {
    const id = input.id ?? `budget-${input.scope}-${input.targetId ? `${input.targetId}-` : ""}${Date.now().toString(36)}`;
    const now = Date.now();

    const existing = this.budgets.get(id);
    if (existing) {
      existing.name = input.name;
      existing.limitUsd = input.limitUsd;
      if (input.softWarningPercent !== undefined) {
        existing.softWarningPercent = input.softWarningPercent;
      }
      existing.updatedAt = now;
      this.recalculateStatus(existing);
      return existing;
    }

    const budget: BudgetRecord = {
      id,
      scope: input.scope,
      targetId: input.targetId,
      name: input.name,
      limitUsd: input.limitUsd,
      spentUsd: 0,
      softWarningPercent: input.softWarningPercent ?? 80,
      status: "healthy",
      createdAt: now,
      updatedAt: now,
    };

    this.budgets.set(id, budget);
    return budget;
  }

  /**
   * Debit spend against a specific budget
   */
  public debitBudget(budgetId: string, amountUsd: number): BudgetRecord {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget '${budgetId}' not found`);
    }

    budget.spentUsd = Number((budget.spentUsd + amountUsd).toFixed(4));
    budget.updatedAt = Date.now();
    this.recalculateStatus(budget);

    return budget;
  }

  /**
   * Record a cost transaction and debit the corresponding budget
   */
  public recordTransaction(input: RecordTransactionInput): CostTransaction {
    const now = Date.now();
    const id = `tx-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Estimate cost if not provided based on generic blended token pricing ($2.50 / Mtok input, $10 / Mtok output)
    const cost =
      input.costUsd !== undefined
        ? input.costUsd
        : Number(((input.inputTokens * 2.5 + input.outputTokens * 10.0) / 1_000_000).toFixed(5));

    const savings = input.savingsUsd ?? 0;

    // Find applicable budget or fallback to first available
    let targetBudgetId = input.budgetId;
    if (!targetBudgetId) {
      if (input.agentId) {
        const agentBudget = Array.from(this.budgets.values()).find(
          (b) => b.scope === "agent" && b.targetId === input.agentId
        );
        if (agentBudget) targetBudgetId = agentBudget.id;
      } else if (input.projectId) {
        const projBudget = Array.from(this.budgets.values()).find(
          (b) => b.scope === "project" && b.targetId === input.projectId
        );
        if (projBudget) targetBudgetId = projBudget.id;
      }
    }

    if (!targetBudgetId) {
      const defaultDaily = Array.from(this.budgets.values()).find((b) => b.scope === "global_daily");
      targetBudgetId = defaultDaily ? defaultDaily.id : "budget-global-daily";
      if (!this.budgets.has(targetBudgetId)) {
        this.registerBudget({
          id: targetBudgetId,
          scope: "global_daily",
          name: "Global Daily Budget",
          limitUsd: 50.0,
        });
      }
    }

    // Debit the budget
    this.debitBudget(targetBudgetId, cost);

    const transaction: CostTransaction = {
      id,
      budgetId: targetBudgetId,
      agentId: input.agentId,
      projectId: input.projectId,
      modelId: input.modelId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: cost,
      savingsUsd: savings,
      wasDowngraded: input.wasDowngraded ?? false,
      timestamp: now,
    };

    this.transactions.unshift(transaction);
    if (this.transactions.length > this.maxTransactions) {
      this.transactions.pop();
    }

    return transaction;
  }

  public getBudget(id: string): BudgetRecord | undefined {
    return this.budgets.get(id);
  }

  public listBudgets(scopeFilter?: BudgetScope): BudgetRecord[] {
    const all = Array.from(this.budgets.values());
    if (scopeFilter) {
      return all.filter((b) => b.scope === scopeFilter);
    }
    return all;
  }

  public listTransactions(limit = 50): CostTransaction[] {
    return this.transactions.slice(0, limit);
  }

  public getTotalSpend(): number {
    return Number(
      Array.from(this.budgets.values())
        .reduce((sum, b) => sum + b.spentUsd, 0)
        .toFixed(4)
    );
  }

  public getTotalSavings(): number {
    return Number(
      this.transactions.reduce((sum, tx) => sum + tx.savingsUsd, 0).toFixed(4)
    );
  }

  private recalculateStatus(budget: BudgetRecord): void {
    const percent = (budget.spentUsd / Math.max(0.001, budget.limitUsd)) * 100;
    if (percent >= 100) {
      budget.status = "circuit_broken";
    } else if (percent >= budget.softWarningPercent) {
      budget.status = "warning";
    } else {
      budget.status = "healthy";
    }
  }
}
