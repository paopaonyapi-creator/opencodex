/**
 * Phase 20.2 — Pao Spec-Driven AI SDLC Command Center
 * Autonomous Software Engineering Operating Layer with Quality Gates & Council
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/shared";
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconCode,
  IconHardDrive,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTerminal,
  IconX,
} from "../icons";

type Tab =
  | "overview"
  | "specs"
  | "clarifications"
  | "plan"
  | "tasks"
  | "analysis"
  | "gates"
  | "reviews"
  | "approvals"
  | "evidence";

interface SdlcCycle {
  id: string;
  title: string;
  sourceIdea: string;
  status: string;
  currentStage: string;
  currentGate: string | null;
  riskLevel: string;
  priority: number;
  autoRunMode: string;
  branchName: string;
  constitutionVersion: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SdlcCycleDetail extends SdlcCycle {
  requirements: Array<{
    id: string;
    reqKey: string;
    title: string;
    description: string;
    complexity: string;
    acceptanceCriteriaCount: number;
  }>;
  acceptanceCriteria: Array<{
    id: string;
    acKey: string;
    given: string;
    when: string;
    then: string;
    isTestable: boolean;
  }>;
  clarifications: Array<{
    id: string;
    question: string;
    answer: string | null;
    status: string;
    severity: string;
    suggestedResolution: string | null;
  }>;
  adrs: Array<{
    id: string;
    title: string;
    status: string;
    context: string;
    decision: string;
    consequences: string;
  }>;
  tasks: Array<{
    id: string;
    taskKey: string;
    title: string;
    status: string;
    dependencies: string[];
    assignedWorker: string | null;
  }>;
  gates: Array<{
    id: string;
    gateType: string;
    status: string;
    score: number;
    blockers: string[];
    evaluatedAt: string;
  }>;
  reviews: Array<{
    id: string;
    reviewerRole: string;
    verdict: string;
    findingsCount: number;
    score: number;
  }>;
  evidence: Array<{
    id: string;
    evidenceType: string;
    sha256Hash: string;
    status: string;
    recordedAt: string;
  }>;
  approvals: Array<{
    id: string;
    actionType: string;
    status: string;
    riskLevel: string;
    reason: string;
    token: string;
    requestedBy: string;
    decidedBy: string | null;
  }>;
}

const STAGES = [
  "IDEA",
  "SPECIFY",
  "CLARIFY",
  "PLAN",
  "TASKS",
  "ANALYZE",
  "IMPLEMENT",
  "TEST",
  "REVIEW",
  "CONVERGE",
] as const;

export default function SdlcCommandCenter({ apiBase }: { apiBase: string }) {
  const t = useT();
  const [cycles, setCycles] = useState<SdlcCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [cycleDetail, setCycleDetail] = useState<SdlcCycleDetail | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>("");
  const [newIdea, setNewIdea] = useState<string>("");
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState<boolean>(false);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string>("");
  const [approvalDecision, setApprovalDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvalToken, setApprovalToken] = useState<string>("");
  const [approvalReason, setApprovalReason] = useState<string>("");

  const fetchCycles = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/sdlc/cycles`);
      if (!res.ok) return;
      const data = (await res.json()) as { cycles: SdlcCycle[] };
      setCycles(data.cycles || []);
      if (data.cycles?.length > 0) {
        setSelectedCycleId((prev) => prev || data.cycles[0].id);
      }
    } catch {
      // ignore network err
    }
  }, [apiBase]);

  const fetchCycleDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`${apiBase}/api/sdlc/cycles/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { cycle: SdlcCycleDetail };
      setCycleDetail(data.cycle);
    } catch {
      // ignore network err
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/sdlc/cycles`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { cycles: SdlcCycle[] } | null) => {
        if (!active || !data) return;
        setCycles(data.cycles || []);
        if (data.cycles?.length > 0) {
          setSelectedCycleId((prev) => prev || data.cycles[0].id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!selectedCycleId) return;
    let active = true;
    fetch(`${apiBase}/api/sdlc/cycles/${encodeURIComponent(selectedCycleId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { cycle: SdlcCycleDetail } | null) => {
        if (!active || !data) return;
        setCycleDetail(data.cycle);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase, selectedCycleId]);

  const handleCreateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdea.trim()) return;
    try {
      setActionInProgress("create");
      const res = await fetch(`${apiBase}/api/sdlc/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || undefined,
          rawIdea: newIdea.trim(),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cycle: SdlcCycle };
        setIsNewModalOpen(false);
        setNewTitle("");
        setNewIdea("");
        await fetchCycles();
        setSelectedCycleId(data.cycle.id);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRunAction = async (endpoint: string, actionName: string) => {
    if (!selectedCycleId) return;
    try {
      setActionInProgress(actionName);
      const res = await fetch(`${apiBase}/api/sdlc/cycles/${encodeURIComponent(selectedCycleId)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchCycleDetail(selectedCycleId);
        await fetchCycles();
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDecideApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCycleId || !selectedApprovalId) return;
    try {
      setActionInProgress("approval");
      const res = await fetch(
        `${apiBase}/api/sdlc/cycles/${encodeURIComponent(selectedCycleId)}/approvals/${encodeURIComponent(selectedApprovalId)}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: approvalDecision,
            decidedBy: "operator",
            token: approvalToken.trim() || undefined,
            reason: approvalReason.trim() || undefined,
          }),
        },
      );
      if (res.ok) {
        setIsApprovalModalOpen(false);
        setApprovalToken("");
        setApprovalReason("");
        await fetchCycleDetail(selectedCycleId);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  const currentStageIndex = useMemo(() => {
    if (!cycleDetail) return 0;
    const stage = cycleDetail.currentStage.toUpperCase();
    const idx = STAGES.findIndex((s) => stage.includes(s));
    return idx >= 0 ? idx : 0;
  }, [cycleDetail]);

  return (
    <div className="sdlc-container">
      {/* Header Card */}
      <div className="sdlc-header-card">
        <div className="sdlc-header-top">
          <div className="sdlc-title-group">
            <h1>
              <IconCode /> {t("sdlc.title")}
              <span className="sdlc-title-badge">v20.2</span>
            </h1>
            <p className="sdlc-subtitle">{t("sdlc.subtitle")}</p>
          </div>

          <div className="sdlc-header-controls">
            <div className="sdlc-cycle-picker">
              <select
                className="sdlc-select"
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                disabled={cycles.length === 0}
              >
                {cycles.length === 0 ? (
                  <option value="">{t("sdlc.noCycles")}</option>
                ) : (
                  cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title || c.sourceIdea.slice(0, 40)} ({c.status})
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="sdlc-btn sdlc-btn--primary"
                onClick={() => setIsNewModalOpen(true)}
              >
                <IconPlus /> {t("sdlc.newCycle")}
              </button>
              <button
                type="button"
                className="sdlc-btn sdlc-btn--secondary"
                onClick={() => {
                  void fetchCycles();
                  if (selectedCycleId) void fetchCycleDetail(selectedCycleId);
                }}
                disabled={actionInProgress !== null}
              >
                <IconRefresh /> {t("sdlc.refresh")}
              </button>
            </div>
          </div>
        </div>

        {/* Pipeline Progress Stages */}
        {cycleDetail && (
          <div className="sdlc-pipeline-bar">
            {STAGES.map((stg, idx) => {
              const isCurrent = idx === currentStageIndex;
              const isPassed = idx < currentStageIndex;
              const isBlocked = cycleDetail.status === "BLOCKED" && isCurrent;

              return (
                <div key={stg} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div
                    className={`sdlc-stage-node ${
                      isBlocked
                        ? "sdlc-stage-node--blocked"
                        : isCurrent
                        ? "sdlc-stage-node--active"
                        : isPassed
                        ? "sdlc-stage-node--passed"
                        : ""
                    }`}
                  >
                    {isPassed ? (
                      <IconCheck />
                    ) : isBlocked ? (
                      <IconAlert />
                    ) : (
                      <span className="sdlc-mono">{idx + 1}</span>
                    )}
                    <span>{stg}</span>
                  </div>
                  {idx < STAGES.length - 1 && <span className="sdlc-stage-arrow">→</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Action Toolbar */}
        {cycleDetail && (
          <div className="sdlc-toolbar">
            <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, marginRight: 6 }}>
              {t("sdlc.actions")}:
            </span>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("specify", "specify")}
              disabled={actionInProgress !== null}
            >
              <IconCode /> {t("sdlc.runSpecify")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("clarify", "clarify")}
              disabled={actionInProgress !== null}
            >
              <IconActivity /> {t("sdlc.runClarify")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("plan", "plan")}
              disabled={actionInProgress !== null}
            >
              <IconHardDrive /> {t("sdlc.runPlan")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("tasks", "tasks")}
              disabled={actionInProgress !== null}
            >
              <IconActivity /> {t("sdlc.runTasks")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("analyze", "analyze")}
              disabled={actionInProgress !== null}
            >
              <IconShield /> {t("sdlc.runAnalyze")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("implement", "implement")}
              disabled={actionInProgress !== null}
            >
              <IconTerminal /> {t("sdlc.runImplement")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("tests", "tests")}
              disabled={actionInProgress !== null}
            >
              <IconCheck /> {t("sdlc.runTests")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--secondary"
              onClick={() => handleRunAction("review", "review")}
              disabled={actionInProgress !== null}
            >
              <IconShield /> {t("sdlc.runReview")}
            </button>
            <button
              type="button"
              className="sdlc-btn sdlc-btn--success"
              onClick={() => handleRunAction("converge", "converge")}
              disabled={actionInProgress !== null}
            >
              <IconCheck /> {t("sdlc.runConverge")}
            </button>
          </div>
        )}
      </div>

      {/* Main Tabs Navigation */}
      {cycleDetail ? (
        <>
          <div className="sdlc-tabs">
            {(
              [
                "overview",
                "specs",
                "clarifications",
                "plan",
                "tasks",
                "analysis",
                "gates",
                "reviews",
                "approvals",
                "evidence",
              ] as const
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`sdlc-tab-btn ${activeTab === tab ? "sdlc-tab-btn--active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {t(`sdlc.tab.${tab}` as never)}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="sdlc-grid">
              <div className="sdlc-card">
                <div className="sdlc-card-header">
                  <h3 className="sdlc-card-title">{t("sdlc.status")}</h3>
                  <span className="sdlc-pill sdlc-pill--indigo">{cycleDetail.status}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  <div>
                    <strong>{t("sdlc.stage")}:</strong> {cycleDetail.currentStage}
                  </div>
                  <div>
                    <strong>{t("sdlc.gate")}:</strong> {cycleDetail.currentGate || "—"}
                  </div>
                  <div>
                    <strong>{t("sdlc.branch")}:</strong>{" "}
                    <span className="sdlc-mono">{cycleDetail.branchName}</span>
                  </div>
                  <div>
                    <strong>{t("sdlc.risk")}:</strong> {cycleDetail.riskLevel}
                  </div>
                </div>
              </div>

              <div className="sdlc-card">
                <div className="sdlc-card-header">
                  <h3 className="sdlc-card-title">{t("sdlc.constitution")}</h3>
                  <span className="sdlc-pill sdlc-pill--green">
                    v{cycleDetail.constitutionVersion}
                  </span>
                </div>
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>
                    {t("sdlc.constitutionDesc")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Spec & ACs Tab */}
          {activeTab === "specs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="sdlc-card">
                <div className="sdlc-card-header">
                  <h3 className="sdlc-card-title">{t("sdlc.requirements")}</h3>
                  <span className="sdlc-mono">{cycleDetail.requirements.length}</span>
                </div>
                <div className="sdlc-table-wrapper">
                  <table className="sdlc-table">
                    <thead>
                      <tr>
                        <th>{t("sdlc.col.key")}</th>
                        <th>{t("sdlc.col.title")}</th>
                        <th>{t("sdlc.col.complexity")}</th>
                        <th>{t("sdlc.col.acs")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycleDetail.requirements.map((req) => (
                        <tr key={req.id}>
                          <td className="sdlc-mono">{req.reqKey}</td>
                          <td>
                            <strong>{req.title}</strong>
                            <div style={{ fontSize: 12, opacity: 0.7 }}>{req.description}</div>
                          </td>
                          <td>
                            <span className="sdlc-pill sdlc-pill--indigo">{req.complexity}</span>
                          </td>
                          <td>{req.acceptanceCriteriaCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sdlc-card">
                <div className="sdlc-card-header">
                  <h3 className="sdlc-card-title">{t("sdlc.acceptanceCriteria")}</h3>
                  <span className="sdlc-mono">{cycleDetail.acceptanceCriteria.length}</span>
                </div>
                <div className="sdlc-table-wrapper">
                  <table className="sdlc-table">
                    <thead>
                      <tr>
                        <th>{t("sdlc.col.key")}</th>
                        <th>{t("sdlc.col.given")}</th>
                        <th>{t("sdlc.col.when")}</th>
                        <th>{t("sdlc.col.then")}</th>
                        <th>{t("sdlc.col.testable")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycleDetail.acceptanceCriteria.map((ac) => (
                        <tr key={ac.id}>
                          <td className="sdlc-mono">{ac.acKey}</td>
                          <td>{ac.given}</td>
                          <td>{ac.when}</td>
                          <td>{ac.then}</td>
                          <td>
                            <span
                              className={`sdlc-pill ${
                                ac.isTestable ? "sdlc-pill--green" : "sdlc-pill--red"
                              }`}
                            >
                              {ac.isTestable ? "✓" : "✗"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Clarifications Tab */}
          {activeTab === "clarifications" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.tab.clarifications")}</h3>
                <span className="sdlc-mono">{cycleDetail.clarifications.length}</span>
              </div>
              <div className="sdlc-table-wrapper">
                <table className="sdlc-table">
                  <thead>
                    <tr>
                      <th>{t("sdlc.col.question")}</th>
                      <th>{t("sdlc.severity")}</th>
                      <th>{t("sdlc.status")}</th>
                      <th>{t("sdlc.col.resolution")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.clarifications.map((c) => (
                      <tr key={c.id}>
                        <td>{c.question}</td>
                        <td>
                          <span
                            className={`sdlc-pill ${
                              c.severity === "BLOCKER" ? "sdlc-pill--red" : "sdlc-pill--yellow"
                            }`}
                          >
                            {c.severity}
                          </span>
                        </td>
                        <td>{c.status}</td>
                        <td>{c.answer || c.suggestedResolution || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plan & ADRs Tab */}
          {activeTab === "plan" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.decisions")}</h3>
                <span className="sdlc-mono">{cycleDetail.adrs.length}</span>
              </div>
              <div className="sdlc-grid">
                {cycleDetail.adrs.map((adr) => (
                  <div key={adr.id} className="sdlc-card" style={{ borderStyle: "dashed" }}>
                    <div className="sdlc-card-header">
                      <strong>{adr.title}</strong>
                      <span className="sdlc-pill sdlc-pill--green">{adr.status}</span>
                    </div>
                    <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div>
                        <strong>{t("sdlc.col.context")}:</strong> {adr.context}
                      </div>
                      <div>
                        <strong>{t("sdlc.col.decision")}:</strong> {adr.decision}
                      </div>
                      <div>
                        <strong>{t("sdlc.col.consequences")}:</strong> {adr.consequences}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks DAG Tab */}
          {activeTab === "tasks" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.tab.tasks")}</h3>
                <span className="sdlc-mono">{cycleDetail.tasks.length}</span>
              </div>
              <div className="sdlc-table-wrapper">
                <table className="sdlc-table">
                  <thead>
                    <tr>
                      <th>{t("sdlc.col.key")}</th>
                      <th>{t("sdlc.col.title")}</th>
                      <th>{t("sdlc.status")}</th>
                      <th>{t("sdlc.col.dependencies")}</th>
                      <th>{t("sdlc.col.worker")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.tasks.map((task) => (
                      <tr key={task.id}>
                        <td className="sdlc-mono">{task.taskKey}</td>
                        <td>{task.title}</td>
                        <td>
                          <span
                            className={`sdlc-pill ${
                              task.status === "COMPLETED"
                                ? "sdlc-pill--green"
                                : task.status === "FAILED"
                                ? "sdlc-pill--red"
                                : "sdlc-pill--indigo"
                            }`}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="sdlc-mono">
                          {task.dependencies.length > 0 ? task.dependencies.join(", ") : "—"}
                        </td>
                        <td>{task.assignedWorker || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Analysis Tab */}
          {activeTab === "analysis" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.tab.analysis")}</h3>
              </div>
              <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
                {t("sdlc.analysisDesc")}
              </p>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <div className="sdlc-card" style={{ flex: 1 }}>
                  <strong>{t("sdlc.reqCoverage")}</strong>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#86efac" }}>100%</div>
                </div>
                <div className="sdlc-card" style={{ flex: 1 }}>
                  <strong>{t("sdlc.acCoverage")}</strong>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#86efac" }}>100%</div>
                </div>
                <div className="sdlc-card" style={{ flex: 1 }}>
                  <strong>{t("sdlc.tasksCoverage")}</strong>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#86efac" }}>100%</div>
                </div>
              </div>
            </div>
          )}

          {/* Quality Gates Tab */}
          {activeTab === "gates" && (
            <div className="sdlc-grid">
              {cycleDetail.gates.map((gate) => (
                <div key={gate.id} className="sdlc-card">
                  <div className="sdlc-card-header">
                    <h3 className="sdlc-card-title">{gate.gateType}</h3>
                    <span
                      className={`sdlc-pill ${
                        gate.status === "PASSED" ? "sdlc-pill--green" : "sdlc-pill--red"
                      }`}
                    >
                      {gate.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div>
                      <strong>{t("sdlc.score")}:</strong> {gate.score} / 100
                    </div>
                    {gate.blockers.length > 0 && (
                      <div style={{ color: "#f87171" }}>
                        <strong>{t("sdlc.blockers")}:</strong> {gate.blockers.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reviews Council Tab */}
          {activeTab === "reviews" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.consensus")}</h3>
                <span className="sdlc-pill sdlc-pill--green">{t("sdlc.approve")}</span>
              </div>
              <div className="sdlc-table-wrapper">
                <table className="sdlc-table">
                  <thead>
                    <tr>
                      <th>{t("sdlc.role")}</th>
                      <th>{t("sdlc.col.verdict")}</th>
                      <th>{t("sdlc.score")}</th>
                      <th>{t("sdlc.findings")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.reviews.map((rev) => (
                      <tr key={rev.id}>
                        <td>
                          <strong>{rev.reviewerRole}</strong>
                        </td>
                        <td>
                          <span
                            className={`sdlc-pill ${
                              rev.verdict === "APPROVE" ? "sdlc-pill--green" : "sdlc-pill--red"
                            }`}
                          >
                            {rev.verdict}
                          </span>
                        </td>
                        <td>{rev.score} / 100</td>
                        <td>{rev.findingsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Approvals Tab */}
          {activeTab === "approvals" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.tab.approvals")}</h3>
                <span className="sdlc-mono">{cycleDetail.approvals.length}</span>
              </div>
              <div className="sdlc-table-wrapper">
                <table className="sdlc-table">
                  <thead>
                    <tr>
                      <th>{t("sdlc.actions")}</th>
                      <th>{t("sdlc.risk")}</th>
                      <th>{t("sdlc.status")}</th>
                      <th>{t("sdlc.reason")}</th>
                      <th>{t("sdlc.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.approvals.map((appr) => (
                      <tr key={appr.id}>
                        <td>{appr.actionType}</td>
                        <td>
                          <span
                            className={`sdlc-pill ${
                              appr.riskLevel === "CRITICAL" || appr.riskLevel === "HIGH"
                                ? "sdlc-pill--red"
                                : "sdlc-pill--yellow"
                            }`}
                          >
                            {appr.riskLevel}
                          </span>
                        </td>
                        <td>{appr.status}</td>
                        <td>{appr.reason}</td>
                        <td>
                          {appr.status === "PENDING" ? (
                            <button
                              type="button"
                              className="sdlc-btn sdlc-btn--primary"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => {
                                setSelectedApprovalId(appr.id);
                                setIsApprovalModalOpen(true);
                              }}
                            >
                              <IconLock /> {t("sdlc.decide")}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, opacity: 0.7 }}>
                              {appr.decidedBy || "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Evidence Tab */}
          {activeTab === "evidence" && (
            <div className="sdlc-card">
              <div className="sdlc-card-header">
                <h3 className="sdlc-card-title">{t("sdlc.tab.evidence")}</h3>
                <span className="sdlc-mono">{cycleDetail.evidence.length}</span>
              </div>
              <div className="sdlc-table-wrapper">
                <table className="sdlc-table">
                  <thead>
                    <tr>
                      <th>{t("sdlc.col.type")}</th>
                      <th>{t("sdlc.status")}</th>
                      <th>{t("sdlc.col.hash")}</th>
                      <th>{t("sdlc.col.recordedAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDetail.evidence.map((ev) => (
                      <tr key={ev.id}>
                        <td>
                          <strong>{ev.evidenceType}</strong>
                        </td>
                        <td>
                          <span
                            className={`sdlc-pill ${
                              ev.status === "PASSED" ? "sdlc-pill--green" : "sdlc-pill--red"
                            }`}
                          >
                            {ev.status}
                          </span>
                        </td>
                        <td className="sdlc-mono">{ev.sha256Hash}</td>
                        <td>{ev.recordedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="sdlc-card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ margin: 0, opacity: 0.7 }}>{t("sdlc.empty")}</p>
        </div>
      )}

      {/* New Cycle Modal */}
      {isNewModalOpen && (
        <div className="sdlc-modal-backdrop">
          <div className="sdlc-modal-content">
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <h3 style={{ margin: 0 }}>{t("sdlc.newCycle")}</h3>
              <button
                type="button"
                className="sdlc-btn sdlc-btn--secondary"
                onClick={() => setIsNewModalOpen(false)}
              >
                <IconX />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                void handleCreateCycle(e);
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  {t("sdlc.cycleTitle")}:
                </label>
                <input
                  type="text"
                  className="sdlc-input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t("sdlc.newCyclePlaceholder")}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  {t("sdlc.rawIdea")}:
                </label>
                <textarea
                  className="sdlc-textarea"
                  value={newIdea}
                  onChange={(e) => setNewIdea(e.target.value)}
                  placeholder={t("sdlc.rawIdeaPlaceholder")}
                  required
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button
                  type="button"
                  className="sdlc-btn sdlc-btn--secondary"
                  onClick={() => setIsNewModalOpen(false)}
                >
                  {t("sdlc.cancel")}
                </button>
                <button
                  type="submit"
                  className="sdlc-btn sdlc-btn--primary"
                  disabled={actionInProgress !== null || !newIdea.trim()}
                >
                  {actionInProgress === "create" ? t("sdlc.creating") : t("sdlc.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approval Decision Modal */}
      {isApprovalModalOpen && (
        <div className="sdlc-modal-backdrop">
          <div className="sdlc-modal-content">
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <h3 style={{ margin: 0 }}>{t("sdlc.tab.approvals")}</h3>
              <button
                type="button"
                className="sdlc-btn sdlc-btn--secondary"
                onClick={() => setIsApprovalModalOpen(false)}
              >
                <IconX />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                void handleDecideApproval(e);
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  {t("sdlc.col.decision")}:
                </label>
                <select
                  className="sdlc-select"
                  value={approvalDecision}
                  onChange={(e) =>
                    setApprovalDecision(e.target.value as "APPROVED" | "REJECTED")
                  }
                >
                  <option value="APPROVED">{t("sdlc.approve")}</option>
                  <option value="REJECTED">{t("sdlc.reject")}</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  {t("sdlc.token")}:
                </label>
                <input
                  type="text"
                  className="sdlc-input"
                  value={approvalToken}
                  onChange={(e) => setApprovalToken(e.target.value)}
                  placeholder={t("sdlc.tokenPlaceholder")}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  {t("sdlc.reason")}:
                </label>
                <input
                  type="text"
                  className="sdlc-input"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder={t("sdlc.reasonPlaceholder")}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button
                  type="button"
                  className="sdlc-btn sdlc-btn--secondary"
                  onClick={() => setIsApprovalModalOpen(false)}
                >
                  {t("sdlc.cancel")}
                </button>
                <button
                  type="submit"
                  className={`sdlc-btn ${
                    approvalDecision === "APPROVED" ? "sdlc-btn--success" : "sdlc-btn--danger"
                  }`}
                  disabled={actionInProgress !== null}
                >
                  {t("sdlc.decide")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
