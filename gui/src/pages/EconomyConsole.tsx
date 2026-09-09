import { useState, useEffect } from "react";
import "../styles/economy-console.css";

interface BudgetRecord {
  id: string;
  scope: "global_daily" | "global_monthly" | "project" | "agent";
  targetId?: string;
  name: string;
  limitUsd: number;
  spentUsd: number;
  softWarningPercent: number;
  status: "healthy" | "warning" | "throttled" | "circuit_broken";
}

interface CostTransaction {
  id: string;
  budgetId: string;
  agentId?: string;
  projectId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  savingsUsd: number;
  wasDowngraded: boolean;
  timestamp: number;
}

interface BurnGuardStatus {
  hourlyBurnRateUsd: number;
  projectedDailySpendUsd: number;
  velocitySpikeDetected: boolean;
  safeguardAction: "none" | "throttle" | "downgrade_forced" | "circuit_broken";
  evaluatedAt: string;
}

interface RoutingRecommendation {
  recommendedTier: "tier1_ultra" | "tier2_balanced" | "tier3_economy";
  recommendedModelId: string;
  originalModelId?: string;
  downgraded: boolean;
  estimatedSavingsPercent: number;
  rationale: string;
}

const INITIAL_BUDGETS: BudgetRecord[] = [
  {
    id: "budget-global-daily",
    scope: "global_daily",
    name: "Global Daily Budget",
    limitUsd: 50.0,
    spentUsd: 12.45,
    softWarningPercent: 80,
    status: "healthy",
  },
  {
    id: "budget-global-monthly",
    scope: "global_monthly",
    name: "Global Monthly Budget",
    limitUsd: 500.0,
    spentUsd: 168.2,
    softWarningPercent: 85,
    status: "healthy",
  },
  {
    id: "budget-project-stock",
    scope: "project",
    targetId: "adobe-stock-production",
    name: "Stock Production Pipeline",
    limitUsd: 150.0,
    spentUsd: 64.1,
    softWarningPercent: 80,
    status: "healthy",
  },
  {
    id: "budget-agent-coder",
    scope: "agent",
    targetId: "pao-coder",
    name: "Autonomous Coder Specialist",
    limitUsd: 100.0,
    spentUsd: 82.5,
    softWarningPercent: 75,
    status: "warning",
  },
];

const INITIAL_TRANSACTIONS: CostTransaction[] = [
  {
    id: "tx-stock-01",
    budgetId: "budget-project-stock",
    agentId: "pao-video-producer",
    projectId: "adobe-stock-production",
    modelId: "claude-3-5-haiku-20241022",
    inputTokens: 12500,
    outputTokens: 3200,
    costUsd: 0.0071,
    savingsUsd: 0.081,
    wasDowngraded: true,
    timestamp: 1726000000000,
  },
  {
    id: "tx-coder-02",
    budgetId: "budget-agent-coder",
    agentId: "pao-coder",
    modelId: "claude-3-5-sonnet-20241022",
    inputTokens: 28400,
    outputTokens: 4100,
    costUsd: 0.1467,
    savingsUsd: 0,
    wasDowngraded: false,
    timestamp: 1726000000000,
  },
];

const INITIAL_BURN_GUARD: BurnGuardStatus = {
  hourlyBurnRateUsd: 2.14,
  projectedDailySpendUsd: 51.36,
  velocitySpikeDetected: false,
  safeguardAction: "none",
  evaluatedAt: new Date(1726000000000).toISOString(),
};

export default function EconomyConsole({ apiBase }: { apiBase?: string }) {
  const [budgets, setBudgets] = useState<BudgetRecord[]>(INITIAL_BUDGETS);
  const [transactions, setTransactions] = useState<CostTransaction[]>(INITIAL_TRANSACTIONS);
  const [burnGuard, setBurnGuard] = useState<BurnGuardStatus>(INITIAL_BURN_GUARD);
  const [activeTab, setActiveTab] = useState<"budgets" | "optimizer" | "burn_guard" | "transactions">("budgets");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Optimizer simulator state
  const [simModel, setSimModel] = useState("claude-3-5-sonnet-20241022");
  const [simTask, setSimTask] = useState("simple_query");
  const [recommendation, setRecommendation] = useState<RoutingRecommendation | null>(null);

  useEffect(() => {
    const base = apiBase || "";
    const fetchLive = () => {
      Promise.all([
        fetch(`${base}/api/agent-os/economy/budgets`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/economy/transactions`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/api/agent-os/economy/burn-guard`).then((r) => (r.ok ? r.json() : null)),
      ])
        .then(([budgetData, txData, burnData]) => {
          if (budgetData?.budgets && budgetData.budgets.length > 0) setBudgets(budgetData.budgets);
          if (txData?.transactions) setTransactions(txData.transactions);
          if (burnData?.burnGuard) setBurnGuard(burnData.burnGuard);
        })
        .catch(() => {
          // Fallback to local state
        });
    };

    fetchLive();
    const interval = setInterval(fetchLive, 10000);
    return () => clearInterval(interval);
  }, [apiBase, tick]);

  const handleTripCircuitBreaker = async () => {
    setFeedback("Tripping emergency economic circuit breaker...");
    try {
      await fetch(`${apiBase || ""}/api/agent-os/economy/burn-guard/trip`, {
        method: "POST",
      });
      setTick((t) => t + 1);
    } catch {
      setBurnGuard((prev) => ({ ...prev, safeguardAction: "circuit_broken" }));
    }
    setFeedback("Circuit breaker tripped: all expensive models now force-downgraded to Tier 3 Local LLM.");
  };

  const handleResetCircuitBreaker = async () => {
    setFeedback("Resetting circuit breaker...");
    try {
      await fetch(`${apiBase || ""}/api/agent-os/economy/burn-guard/reset`, {
        method: "POST",
      });
      setTick((t) => t + 1);
    } catch {
      setBurnGuard((prev) => ({ ...prev, safeguardAction: "none" }));
    }
    setFeedback("Circuit breaker reset: normal model routing restored.");
  };

  const handleSimulateOptimization = async () => {
    try {
      const res = await fetch(`${apiBase || ""}/api/agent-os/economy/optimize-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedModelId: simModel,
          taskType: simTask,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecommendation(data.recommendation);
        return;
      }
    } catch {
      // Local fallback
    }

    const isLow = simTask === "simple_query" || simTask === "summary";
    if (burnGuard.safeguardAction === "circuit_broken") {
      setRecommendation({
        recommendedTier: "tier3_economy",
        recommendedModelId: "ollama/qwen2.5-coder:32b",
        originalModelId: simModel,
        downgraded: true,
        estimatedSavingsPercent: 100,
        rationale: "Emergency circuit breaker active; forced fallback to Tier 3 Local/Free LLM.",
      });
    } else if (isLow && simModel.includes("sonnet")) {
      setRecommendation({
        recommendedTier: "tier2_balanced",
        recommendedModelId: "claude-3-5-haiku-20241022",
        originalModelId: simModel,
        downgraded: true,
        estimatedSavingsPercent: 85,
        rationale: `Task '${simTask}' is low complexity; routed to cost-efficient Tier 2 model.`,
      });
    } else {
      setRecommendation({
        recommendedTier: "tier1_ultra",
        recommendedModelId: simModel,
        originalModelId: simModel,
        downgraded: false,
        estimatedSavingsPercent: 0,
        rationale: "Task demands high fidelity reasoning; executing on requested Tier 1 model.",
      });
    }
  };

  const totalSpend = Number(budgets.reduce((s, b) => s + b.spentUsd, 0).toFixed(2));
  const totalLimit = Number(budgets.reduce((s, b) => s + b.limitUsd, 0).toFixed(2));
  const totalSavings = Number(transactions.reduce((s, t) => s + t.savingsUsd, 0).toFixed(2));

  return (
    <div className="economy-container" id="economy-console-view">
      {/* Header */}
      <header className="economy-header">
        <div className="economy-title-group">
          <h1>Autonomous Cost & Token Economy Governor (ACEG)</h1>
          <p className="economy-subtitle">
            Multi-Dimensional Quotas • Real-time Burn Guard • Autonomous Model Downgrade & ROI Optimizer
          </p>
        </div>
        <div className="economy-actions">
          <button
            className="btn-aceg btn-aceg-secondary"
            id="btn-refresh-economy"
            onClick={() => setTick((t) => t + 1)}
          >
            Refresh Ledger
          </button>
          {burnGuard.safeguardAction === "circuit_broken" ? (
            <button
              className="btn-aceg btn-aceg-primary"
              id="btn-reset-breaker"
              onClick={handleResetCircuitBreaker}
            >
              Reset Circuit Breaker
            </button>
          ) : (
            <button
              className="btn-aceg btn-aceg-danger"
              id="btn-trip-breaker"
              onClick={handleTripCircuitBreaker}
            >
              Trip Circuit Breaker
            </button>
          )}
        </div>
      </header>

      {/* Feedback Alert */}
      {feedback && (
        <div
          style={{
            background: "rgba(52, 211, 153, 0.1)",
            border: "1px solid rgba(52, 211, 153, 0.3)",
            color: "#34d399",
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            fontSize: "0.875rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{feedback}</span>
          <button
            style={{ background: "transparent", border: "none", color: "#34d399", cursor: "pointer", fontWeight: "bold" }}
            onClick={() => setFeedback(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Metric Cards Grid */}
      <section className="economy-metrics-grid">
        <div className="aceg-metric-card" id="metric-total-spend">
          <div className="aceg-metric-header">
            <span>Total Spend</span>
            <span>All Allocations</span>
          </div>
          <div className="aceg-metric-val">${totalSpend}</div>
          <div className="aceg-metric-sub">${totalLimit} Total Combined Limit</div>
          <div className="aceg-progress-bg">
            <div
              className="aceg-progress-fill"
              style={{
                width: `${Math.min(100, (totalSpend / Math.max(1, totalLimit)) * 100)}%`,
                background: "linear-gradient(90deg, #34d399, #10b981)",
              }}
            />
          </div>
        </div>

        <div className="aceg-metric-card" id="metric-burn-velocity">
          <div className="aceg-metric-header">
            <span>Burn Velocity</span>
            <span style={{ color: burnGuard.velocitySpikeDetected ? "#f87171" : "#4ade80" }}>
              {burnGuard.safeguardAction}
            </span>
          </div>
          <div className="aceg-metric-val">${burnGuard.hourlyBurnRateUsd} / hr</div>
          <div className="aceg-metric-sub">Projected Daily: ${burnGuard.projectedDailySpendUsd}</div>
          <div className="aceg-progress-bg">
            <div
              className="aceg-progress-fill"
              style={{
                width: `${Math.min(100, (burnGuard.hourlyBurnRateUsd / 10) * 100)}%`,
                background: burnGuard.safeguardAction === "circuit_broken" ? "#ef4444" : "linear-gradient(90deg, #38bdf8, #818cf8)",
              }}
            />
          </div>
        </div>

        <div className="aceg-metric-card" id="metric-accumulated-savings">
          <div className="aceg-metric-header">
            <span>Realized Savings</span>
            <span style={{ color: "#34d399" }}>ROI OPTIMIZED</span>
          </div>
          <div className="aceg-metric-val" style={{ color: "#34d399" }}>${totalSavings}</div>
          <div className="aceg-metric-sub">Via Autonomous Model Tier Downgrading</div>
          <div className="aceg-progress-bg">
            <div
              className="aceg-progress-fill"
              style={{ width: "100%", background: "linear-gradient(90deg, #34d399, #059669)" }}
            />
          </div>
        </div>

        <div className="aceg-metric-card" id="metric-safeguard-status">
          <div className="aceg-metric-header">
            <span>Governor Safeguard</span>
            <span>{budgets.length} Quotas</span>
          </div>
          <div className="aceg-metric-val">
            <span className={`budget-status-badge ${burnGuard.safeguardAction === "circuit_broken" ? "circuit_broken" : "healthy"}`}>
              {burnGuard.safeguardAction === "circuit_broken" ? "CIRCUIT BROKEN" : "PROTECTED"}
            </span>
          </div>
          <div className="aceg-metric-sub">
            {budgets.filter((b) => b.status === "warning").length} in Warning • {budgets.filter((b) => b.status === "circuit_broken").length} Tripped
          </div>
          <div className="aceg-progress-bg">
            <div
              className="aceg-progress-fill"
              style={{
                width: "100%",
                background: burnGuard.safeguardAction === "circuit_broken" ? "#ef4444" : "#22c55e",
              }}
            />
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="aceg-tabs">
        <button
          className={`aceg-tab-btn ${activeTab === "budgets" ? "active" : ""}`}
          onClick={() => setActiveTab("budgets")}
        >
          Budget Allocations ({budgets.length})
        </button>
        <button
          className={`aceg-tab-btn ${activeTab === "optimizer" ? "active" : ""}`}
          onClick={() => setActiveTab("optimizer")}
        >
          Model Tier Optimizer
        </button>
        <button
          className={`aceg-tab-btn ${activeTab === "transactions" ? "active" : ""}`}
          onClick={() => setActiveTab("transactions")}
        >
          Transaction Audit ({transactions.length})
        </button>
      </nav>

      {/* Tab 1: Budgets Grid */}
      {activeTab === "budgets" && (
        <section className="budgets-grid" id="budgets-allocation-grid">
          {budgets.map((budget) => {
            const pct = Math.min(100, Number(((budget.spentUsd / Math.max(0.001, budget.limitUsd)) * 100).toFixed(1)));
            return (
              <div className="budget-card" key={budget.id} id={`budget-card-${budget.id}`}>
                <div className="budget-card-header">
                  <div className="budget-title-area">
                    <h3>{budget.name}</h3>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "monospace" }}>{budget.id}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
                    <span className={`budget-status-badge ${budget.status}`}>{budget.status}</span>
                    <span className="budget-scope-badge">{budget.scope}</span>
                  </div>
                </div>

                <div className="budget-amounts">
                  <div className="budget-spent">${budget.spentUsd}</div>
                  <div className="budget-limit">Limit: ${budget.limitUsd}</div>
                </div>

                <div className="aceg-progress-bg">
                  <div
                    className="aceg-progress-fill"
                    style={{
                      width: `${pct}%`,
                      background: pct >= 100 ? "#ef4444" : pct >= budget.softWarningPercent ? "#facc15" : "#34d399",
                    }}
                  />
                </div>

                <div style={{ fontSize: "0.8rem", color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                  <span>Utilization: {pct}%</span>
                  <span>Soft Alert: {budget.softWarningPercent}%</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Tab 2: Model Tier Optimizer Simulator */}
      {activeTab === "optimizer" && (
        <section className="optimizer-box" id="optimizer-simulator-panel">
          <h2 style={{ fontSize: "1.2rem", margin: 0 }}>Autonomous Model Tier Optimizer</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>
            ACEG continuously evaluates task complexity and financial budget health, routing requests to the highest ROI model tier.
          </p>

          <div className="tier-pills-row">
            <div className="tier-pill ultra">
              <h4>Tier 1: Ultra / Frontier</h4>
              <p>Claude 3.5 Sonnet, GPT-4o, OpenAI o1</p>
              <p style={{ marginTop: "0.5rem", color: "#818cf8" }}>Best for: Architecture, complex refactoring, multi-file changes</p>
            </div>
            <div className="tier-pill balanced">
              <h4>Tier 2: Balanced / Efficient</h4>
              <p>Claude 3.5 Haiku, Gemini 1.5 Flash, DeepSeek-V3</p>
              <p style={{ marginTop: "0.5rem", color: "#38bdf8" }}>Best for: Unit tests, summarization, prompt synthesis (~80% savings)</p>
            </div>
            <div className="tier-pill economy">
              <h4>Tier 3: Local / Free</h4>
              <p>Ollama Qwen 2.5 32B, Local DeepSeek-R1</p>
              <p style={{ marginTop: "0.5rem", color: "#34d399" }}>Best for: Routine linting, formatting, emergency fallback (100% savings)</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center", background: "rgba(0,0,0,0.2)", padding: "1rem", borderRadius: "8px" }}>
            <div>
              <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "0.3rem" }}>
                Target Model:
              </label>
              <select
                style={{ background: "#1e293b", color: "#f8fafc", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "0.4rem 0.8rem" }}
                value={simModel}
                onChange={(e) => setSimModel(e.target.value)}
              >
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Tier 1)</option>
                <option value="gpt-4o">GPT-4o (Tier 1)</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Tier 2)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "0.3rem" }}>
                Task Complexity:
              </label>
              <select
                style={{ background: "#1e293b", color: "#f8fafc", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "0.4rem 0.8rem" }}
                value={simTask}
                onChange={(e) => setSimTask(e.target.value)}
              >
                <option value="simple_query">Simple Query / Summary (Low)</option>
                <option value="json_formatting">JSON Formatting (Low)</option>
                <option value="feature_code">Feature Code Refactoring (High)</option>
              </select>
            </div>

            <button
              className="btn-aceg btn-aceg-primary"
              style={{ alignSelf: "flex-end", height: "36px" }}
              onClick={handleSimulateOptimization}
            >
              Simulate Route Recommendation
            </button>
          </div>

          {recommendation && (
            <div style={{ background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.3)", borderRadius: "8px", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 700, color: "#34d399", fontSize: "1rem" }}>
                  Recommendation: {recommendation.recommendedModelId}
                </span>
                {recommendation.downgraded && (
                  <span className="tag-downgraded">
                    {recommendation.estimatedSavingsPercent}% Estimated Savings
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "#e2e8f0" }}>
                {recommendation.rationale}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Tab 3: Transactions Table */}
      {activeTab === "transactions" && (
        <section className="aceg-panel" id="transactions-audit-panel">
          <h2 style={{ fontSize: "1.2rem", margin: "0 0 1rem 0" }}>Token Spend & Savings Audit Ledger</h2>
          <table className="aceg-table">
            <thead>
              <tr>
                <th>Tx ID</th>
                <th>Budget ID</th>
                <th>Model</th>
                <th>Tokens (In / Out)</th>
                <th>Cost ($)</th>
                <th>Savings ($)</th>
                <th>Tier Downgraded</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{tx.id}</td>
                  <td>{tx.budgetId}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#38bdf8" }}>{tx.modelId}</td>
                  <td>{tx.inputTokens} / {tx.outputTokens}</td>
                  <td style={{ fontWeight: 600 }}>${tx.costUsd}</td>
                  <td style={{ color: tx.savingsUsd > 0 ? "#34d399" : "#94a3b8", fontWeight: 600 }}>
                    ${tx.savingsUsd}
                  </td>
                  <td>
                    {tx.wasDowngraded ? (
                      <span className="tag-downgraded">YES (Optimized)</span>
                    ) : (
                      <span style={{ color: "#64748b" }}>Standard</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
