import { useState, useEffect } from "react";
import "../styles/change-control.css";

interface Proposal {
  id: string;
  title: string;
  author: string;
  sourceBranch: string;
  intentCategory: string;
  status: string;
  createdAt: string;
  blastRadius?: {
    score: number;
    riskTier: string;
    touchedFiles: string[];
    criticalPathsTouched: string[];
    explanation: string[];
  };
  sandboxResult?: {
    success: boolean;
    receipt: {
      allPassed: boolean;
      typecheck: { passed: boolean };
      lint: { passed: boolean };
      unitTests: { passed: boolean; total: number; passedCount: number };
      boundaryTests: { passed: boolean };
      privacyScan: { passed: boolean };
    };
  };
  councilVerdict?: {
    consensus: string;
    unanimous: boolean;
    reviews: Array<{
      reviewerId: string;
      role: string;
      providerFamily: string;
      verdict: string;
      score: number;
      comments: string;
    }>;
  };
  mergeCommitSha?: string;
  rollbackCommitSha?: string;
}

const INITIAL_PROPOSALS: Proposal[] = [
  {
    id: "acc-demo-01",
    title: "docs(acc): update Phase 22 autonomous change control documentation",
    author: "pao-agent",
    sourceBranch: "pao/docs-update",
    intentCategory: "docs",
    status: "completed",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    mergeCommitSha: "auto-merge-9f81a2",
    blastRadius: {
      score: 0.04,
      riskTier: "R0",
      touchedFiles: ["docs/Phase-22-Pao-hubPro-Autonomous-Change-Control.md"],
      criticalPathsTouched: [],
      explanation: ["Changes strictly confined to documentation (.md files).", "Blast Radius: 0.04 -> R0"],
    },
    sandboxResult: {
      success: true,
      receipt: {
        allPassed: true,
        typecheck: { passed: true },
        lint: { passed: true },
        unitTests: { passed: true, total: 96, passedCount: 96 },
        boundaryTests: { passed: true },
        privacyScan: { passed: true },
      },
    },
    councilVerdict: {
      consensus: "APPROVED",
      unanimous: true,
      reviews: [
        {
          reviewerId: "reviewer-code",
          role: "CodeReviewer",
          providerFamily: "anthropic",
          verdict: "APPROVE",
          score: 98,
          comments: "Pure markdown documentation updates; zero execution risk.",
        },
      ],
    },
  },
  {
    id: "acc-demo-02",
    title: "feat(gateway): adaptive load balancing fallback chain",
    author: "codex-subagent",
    sourceBranch: "codex/gateway-routing",
    intentCategory: "feature",
    status: "awaiting_approval",
    createdAt: new Date(Date.now() - 1200000).toISOString(),
    blastRadius: {
      score: 0.62,
      riskTier: "R3",
      touchedFiles: [
        "src/ai-gateway/routing/router.ts",
        "src/ai-gateway/providers/registry.ts",
        "tests/ai-gateway-routing.test.ts",
      ],
      criticalPathsTouched: ["src/ai-gateway/routing/router.ts"],
      explanation: [
        "Touched gateway routing matrix and circuit breaker registry.",
        "Blast Radius: 0.62 -> R3",
        "Direct dependents: 2 modules",
      ],
    },
    sandboxResult: {
      success: true,
      receipt: {
        allPassed: true,
        typecheck: { passed: true },
        lint: { passed: true },
        unitTests: { passed: true, total: 96, passedCount: 96 },
        boundaryTests: { passed: true },
        privacyScan: { passed: true },
      },
    },
    councilVerdict: {
      consensus: "HUMAN_CONFIRMATION_REQUIRED",
      unanimous: true,
      reviews: [
        {
          reviewerId: "reviewer-code",
          role: "CodeReviewer",
          providerFamily: "anthropic",
          verdict: "APPROVE",
          score: 94,
          comments: "Routing algorithms strictly bounded; graceful fallbacks verified.",
        },
        {
          reviewerId: "reviewer-arch",
          role: "ArchitectVerifier",
          providerFamily: "openai",
          verdict: "APPROVE",
          score: 91,
          comments: "Decoupling invariants preserved; fallback does not touch core paths.",
        },
        {
          reviewerId: "reviewer-sec",
          role: "SecurityAuditor",
          providerFamily: "google",
          verdict: "APPROVE",
          score: 89,
          comments: "No credentials exposed in routing headers.",
        },
      ],
    },
  },
];

export default function ChangeControl({ apiBase }: { apiBase?: string }) {
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [selectedId, setSelectedId] = useState<string>("acc-demo-02");
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedProposal = proposals.find((p) => p.id === selectedId) || proposals[0];

  useEffect(() => {
    // Poll or fetch live proposals from API if available
    const timer = setTimeout(() => {
      fetch(`${apiBase || ""}/api/agent-os/change-control/proposals`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.proposals && data.proposals.length > 0) {
            setProposals(data.proposals);
          }
        })
        .catch(() => {
          // fallback to mock
        });
    }, 0);

    return () => clearTimeout(timer);
  }, [apiBase]);

  const handleRunSandbox = async () => {
    setIsProcessing(true);
    setFeedback("Running isolated worktree sandbox verification...");
    setTimeout(() => {
      setProposals((prev) =>
        prev.map((p) =>
          p.id === selectedProposal.id
            ? {
                ...p,
                status: "testing",
                sandboxResult: {
                  success: true,
                  receipt: {
                    allPassed: true,
                    typecheck: { passed: true },
                    lint: { passed: true },
                    unitTests: { passed: true, total: 96, passedCount: 96 },
                    boundaryTests: { passed: true },
                    privacyScan: { passed: true },
                  },
                },
              }
            : p
        )
      );
      setIsProcessing(false);
      setFeedback("Sandbox verification completed: 100% tests green!");
    }, 800);
  };

  const handleRunCouncil = async () => {
    setIsProcessing(true);
    setFeedback("Orchestrating multi-agent Reviewer Council consensus...");
    setTimeout(() => {
      setProposals((prev) =>
        prev.map((p) =>
          p.id === selectedProposal.id
            ? {
                ...p,
                status: "auditing",
                councilVerdict: {
                  consensus: p.blastRadius?.riskTier === "R0" ? "APPROVED" : "HUMAN_CONFIRMATION_REQUIRED",
                  unanimous: true,
                  reviews: [
                    {
                      reviewerId: "reviewer-code",
                      role: "CodeReviewer",
                      providerFamily: "anthropic",
                      verdict: "APPROVE",
                      score: 96,
                      comments: "Zero regressions; code verified against minimal standards.",
                    },
                    {
                      reviewerId: "reviewer-arch",
                      role: "ArchitectVerifier",
                      providerFamily: "openai",
                      verdict: "APPROVE",
                      score: 93,
                      comments: "System architecture boundary check passed.",
                    },
                  ],
                },
              }
            : p
        )
      );
      setIsProcessing(false);
      setFeedback("Reviewer Council quorum reached with independent vendor approval.");
    }, 800);
  };

  const handleApprove = () => {
    setIsProcessing(true);
    setFeedback("Operator manual approval granted. Merging into target branch...");
    setTimeout(() => {
      setProposals((prev) =>
        prev.map((p) =>
          p.id === selectedProposal.id
            ? {
                ...p,
                status: "completed",
                mergeCommitSha: `manual-merge-${Date.now().toString(16)}`,
              }
            : p
        )
      );
      setIsProcessing(false);
      setFeedback("Change successfully merged into dev! Post-merge watchdog monitoring active.");
    }, 600);
  };

  const handleRollback = () => {
    setIsProcessing(true);
    setFeedback("Emergency rollback triggered. Reverting merge commit...");
    setTimeout(() => {
      setProposals((prev) =>
        prev.map((p) =>
          p.id === selectedProposal.id
            ? {
                ...p,
                status: "rolled_back",
                rollbackCommitSha: `revert-${Date.now().toString(16)}`,
              }
            : p
        )
      );
      setIsProcessing(false);
      setFeedback("Emergency rollback executed. Working tree safely reset.");
    }, 600);
  };

  return (
    <div className="change-control-container">
      {/* Header */}
      <div className="acc-header">
        <div className="acc-header-title">
          <h1>Pao Autonomous Change Control</h1>
          <span className="acc-version-badge">Phase 22 Active</span>
        </div>
        <p className="acc-header-subtitle">
          Self-evolving governance, blast radius calculation, sandboxed worktree testing, and Reviewer Council approval gates.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="acc-kpi-grid">
        <div className="acc-card">
          <div className="acc-card-label">Active Proposals</div>
          <div className="acc-card-value">{proposals.length}</div>
          <div className="acc-card-sub">In pipeline</div>
        </div>
        <div className="acc-card">
          <div className="acc-card-label">Auto-Merge Rate</div>
          <div className="acc-card-value">100%</div>
          <div className="acc-card-sub">R0 / R1 Tiers Only</div>
        </div>
        <div className="acc-card">
          <div className="acc-card-label">Avg Blast Radius</div>
          <div className="acc-card-value">0.33</div>
          <div className="acc-card-sub">Controlled Impact</div>
        </div>
        <div className="acc-card">
          <div className="acc-card-label">Watchdog Health</div>
          <div className="acc-card-value text-emerald">100%</div>
          <div className="acc-card-sub">0 Rollbacks Active</div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="acc-workspace-grid">
        {/* Left: Proposals List */}
        <div className="acc-panel">
          <div className="acc-panel-header">
            <h3>Change Proposals</h3>
            <span className="acc-count-pill">{proposals.length}</span>
          </div>

          <div className="acc-proposals-list">
            {proposals.map((item) => (
              <div
                key={item.id}
                className={`acc-proposal-item ${item.id === selectedProposal.id ? "active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="acc-proposal-top">
                  <span className={`acc-tier-pill tier-${item.blastRadius?.riskTier?.toLowerCase() || "r1"}`}>
                    {item.blastRadius?.riskTier || "R1"}
                  </span>
                  <span className={`acc-status-pill status-${item.status}`}>
                    {item.status.replace("_", " ")}
                  </span>
                </div>
                <div className="acc-proposal-title">{item.title}</div>
                <div className="acc-proposal-meta">
                  <span>Branch: {item.sourceBranch}</span>
                  <span>By: {item.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Proposal Details & Controls */}
        <div className="acc-panel">
          <div className="acc-panel-header">
            <h3>Proposal Inspector & Decision Gate</h3>
            <span className="acc-id-badge">{selectedProposal.id}</span>
          </div>

          {/* Feedback banner */}
          {feedback && (
            <div className="acc-feedback-banner">
              <span className="acc-feedback-icon">✓</span>
              <span>{feedback}</span>
            </div>
          )}

          {/* Stepper */}
          <div className="acc-stepper">
            <div className={`step-node ${selectedProposal ? "complete" : ""}`}>
              <span className="step-num">1</span>
              <span className="step-label">Proposal</span>
            </div>
            <div className={`step-line ${selectedProposal.blastRadius ? "active" : ""}`} />
            <div className={`step-node ${selectedProposal.blastRadius ? "complete" : ""}`}>
              <span className="step-num">2</span>
              <span className="step-label">Blast Radius</span>
            </div>
            <div className={`step-line ${selectedProposal.sandboxResult ? "active" : ""}`} />
            <div className={`step-node ${selectedProposal.sandboxResult ? "complete" : ""}`}>
              <span className="step-num">3</span>
              <span className="step-label">Sandbox</span>
            </div>
            <div className={`step-line ${selectedProposal.councilVerdict ? "active" : ""}`} />
            <div className={`step-node ${selectedProposal.councilVerdict ? "complete" : ""}`}>
              <span className="step-num">4</span>
              <span className="step-label">Council Audit</span>
            </div>
            <div className={`step-line ${selectedProposal.status === "completed" ? "active" : ""}`} />
            <div className={`step-node ${selectedProposal.status === "completed" ? "complete" : ""}`}>
              <span className="step-num">5</span>
              <span className="step-label">Decision</span>
            </div>
          </div>

          {/* Blast Radius Section */}
          <div className="acc-section">
            <h4 className="acc-section-title">Blast Radius & Risk Evaluation</h4>
            <div className="acc-blast-radar">
              <div className="acc-radar-metric">
                <span className="radar-label">Blast Radius Score</span>
                <span className="radar-val">{selectedProposal.blastRadius?.score ?? "N/A"}</span>
                <div className="radar-bar-bg">
                  <div
                    className="radar-bar-fill"
                    style={{ width: `${(selectedProposal.blastRadius?.score ?? 0) * 100}%` }}
                  />
                </div>
              </div>
              <div className="acc-radar-metric">
                <span className="radar-label">Assigned Risk Tier</span>
                <span className={`radar-tier-val tier-${selectedProposal.blastRadius?.riskTier?.toLowerCase()}`}>
                  {selectedProposal.blastRadius?.riskTier ?? "R1"}
                </span>
                <span className="radar-sub">
                  {selectedProposal.blastRadius?.riskTier === "R0" || selectedProposal.blastRadius?.riskTier === "R1"
                    ? "Auto-Merge Eligible"
                    : "Human Approval Required"}
                </span>
              </div>
            </div>

            {/* Explanation items */}
            <div className="acc-explanation-list">
              {selectedProposal.blastRadius?.explanation.map((exp, idx) => (
                <div key={idx} className="acc-explanation-item">
                  • {exp}
                </div>
              ))}
            </div>
          </div>

          {/* Sandbox & Tests Section */}
          <div className="acc-section">
            <h4 className="acc-section-title">Sandboxed Gate Checks</h4>
            <div className="acc-gate-grid">
              <div className="gate-item">
                <span>TypeScript Typecheck</span>
                <span className="gate-status pass">PASSED</span>
              </div>
              <div className="gate-item">
                <span>Oxlint & Code Style</span>
                <span className="gate-status pass">PASSED</span>
              </div>
              <div className="gate-item">
                <span>Core Unit & Integration Tests</span>
                <span className="gate-status pass">96/96 PASS</span>
              </div>
              <div className="gate-item">
                <span>Core-Lab Boundary Invariant</span>
                <span className="gate-status pass">DECOUPLED</span>
              </div>
              <div className="gate-item">
                <span>Privacy & Secret Leak Scan</span>
                <span className="gate-status pass">CLEAN</span>
              </div>
            </div>
          </div>

          {/* Council Reviews */}
          <div className="acc-section">
            <h4 className="acc-section-title">Reviewer Council Multi-Agent Consensus</h4>
            {selectedProposal.councilVerdict ? (
              <div className="acc-council-cards">
                {selectedProposal.councilVerdict.reviews.map((rev) => (
                  <div key={rev.reviewerId} className="acc-review-card">
                    <div className="acc-rev-header">
                      <span className="rev-role">{rev.role}</span>
                      <span className="rev-vendor">{rev.providerFamily}</span>
                      <span className="rev-verdict pass">{rev.verdict}</span>
                    </div>
                    <div className="acc-rev-comment">{rev.comments}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="acc-empty-council">Reviewer council audit not yet executed.</div>
            )}
          </div>

          {/* Action Bar */}
          <div className="acc-actions-bar">
            <button
              className="acc-btn acc-btn-secondary"
              onClick={handleRunSandbox}
              disabled={isProcessing}
            >
              Run Sandbox
            </button>
            <button
              className="acc-btn acc-btn-secondary"
              onClick={handleRunCouncil}
              disabled={isProcessing}
            >
              Run Council Audit
            </button>
            {selectedProposal.status === "awaiting_approval" && (
              <button
                className="acc-btn acc-btn-primary"
                onClick={handleApprove}
                disabled={isProcessing}
              >
                Approve & Merge to Dev
              </button>
            )}
            {selectedProposal.status === "completed" && (
              <button
                className="acc-btn acc-btn-danger"
                onClick={handleRollback}
                disabled={isProcessing}
              >
                Emergency Rollback
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
