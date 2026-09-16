// Phase 20.20 — Research job lifecycle: route, cost guard, bounded fallback,
// normalization, dedupe, evidence persistence, usage ledger (spec sections 11-16, 23).
//
// State machine (spec section 23):
//   draft -> routed -> (approval_required -> approved)? -> running -> completed
//                                                              |-> failed
//   any gate failure lands on budget_blocked | policy_blocked | failed | cancelled.
//
// Approval tokens are short-lived, hashed at rest, tied to one job and a maximum
// approved amount, and single-use. There is deliberately no "approve all" token.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { recordSocialAudit } from "./audit";
import { clampMaxItems, getSocialConfig } from "./config";
import { getSocialCostGuard } from "./cost-guard";
import { markDuplicates } from "./dedupe";
import { isRetryableErrorCode, SocialError, toSocialError } from "./errors";
import { normalizeProviderItem } from "./normalizer";
import { getSocialProvider } from "./provider";
import { SocialRouter } from "./router";
import { SocialToolRegistry } from "./registry";
import { aggregateTrendSignals } from "./trends";
import { buildStockOpportunities } from "./stock-opportunity";
import type {
  NormalizedContentItem,
  SocialBudgetDecisionState,
  SocialErrorCode,
  SocialJobState,
  SocialResearchRequest,
  SocialRunStatus,
} from "./types";

const APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface SocialResearchJob {
  id: string;
  platform: string;
  capabilities: string[];
  query: string | null;
  maxItems: number;
  maxCostUsd: number;
  freshness: string;
  state: SocialJobState;
  selectedToolId: string | null;
  estimatedCostUsd: number | null;
  approvedMaxUsd: number | null;
  approvalExpiresAt: string | null;
  fallbackHistory: Array<{ toolId: string; attempt: number; errorCode: SocialErrorCode | null; at: string; note: string }>;
  resultSummary: Record<string, unknown>;
  errorCode: SocialErrorCode | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunJobOptions {
  approvalToken?: string;
}

export interface RunJobResult {
  job: SocialResearchJob;
  runs: SocialProviderRun[];
  items: NormalizedContentItem[];
  signals: number;
  opportunities: number;
  approvalToken?: string;
}

export interface SocialProviderRun {
  id: string;
  researchJobId: string;
  providerId: string;
  toolId: string;
  providerRunId: string | null;
  attempt: number;
  fallbackIndex: number;
  status: SocialRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  estimatedCost: number | null;
  actualCost: number | null;
  itemCount: number;
  errorCode: SocialErrorCode | null;
  errorMessage: string | null;
  fallbackReason: string | null;
}

export class SocialResearchOrchestrator {
  private readonly registry: SocialToolRegistry;
  private readonly router: SocialRouter;

  constructor(registry: SocialToolRegistry = new SocialToolRegistry()) {
    this.registry = registry;
    this.router = new SocialRouter(registry);
  }

  createJob(request: SocialResearchRequest): SocialResearchJob {
    const config = getSocialConfig();
    const db = openAgentOsDb();
    const id = `sjob_${randomUUID().slice(0, 16)}`;
    const now = new Date().toISOString();
    const capabilities = [...new Set(request.capabilities)];
    if (capabilities.length === 0) {
      throw new SocialError("INVALID_INPUT", "request must name at least one capability");
    }
    const maxItems = clampMaxItems(request.maxItems, config);
    const maxCostUsd = request.maxCostUsd ?? config.defaultMaxJobUsd;

    db.query(`INSERT INTO social_research_jobs (
      id, platform, capabilities_json, query, max_items, max_cost_usd, freshness,
      state, selected_tool_id, estimated_cost, fallback_history_json, result_summary_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?, ?)`).run(
      id,
      request.platform ?? "any",
      JSON.stringify(capabilities),
      request.query ?? null,
      maxItems,
      maxCostUsd,
      request.freshness ?? "cached_ok",
      JSON.stringify([]),
      JSON.stringify({}),
      now,
    );
    return this.getJob(id)!;
  }

  getJob(id: string): SocialResearchJob | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM social_research_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToJob(row) : null;
  }

  listJobs(limit = 50): SocialResearchJob[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM social_research_jobs ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 200)) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }

  getRun(id: string): SocialProviderRun | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM social_provider_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  listRuns(jobId: string): SocialProviderRun[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM social_provider_runs WHERE research_job_id = ? ORDER BY started_at")
      .all(jobId) as Record<string, unknown>[];
    return rows.map(rowToRun);
  }

  listEvidence(jobId: string): NormalizedContentItem[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM social_normalized_items WHERE research_job_id = ? ORDER BY rowid")
      .all(jobId) as Record<string, unknown>[];
    return rows.map(rowToItem);
  }

  /** Preview-only routing. Never executes a paid job and never mutates state. */
  async previewRoute(request: SocialResearchRequest) {
    return this.router.route(request);
  }

  /**
   * Issue a single-use approval token for a job in approval_required state. The token
   * is returned exactly once and stored only as a SHA-256 digest with an expiry.
   */
  approveJob(jobId: string, opts: { maxUsd: number }): { approvalToken: string; expiresAt: string } {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) throw new SocialError("TOOL_NOT_FOUND", `research job ${jobId} not found`);
    if (job.state !== "approval_required") {
      throw new SocialError("INVALID_INPUT", `job ${jobId} is in state ${job.state}, not approval_required`);
    }
    const token = `sapr_${randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    db.query(`UPDATE social_research_jobs SET
      approved_max_usd = ?, approval_token_hash = ?, approval_expires_at = ?, state = 'approval_required'
      WHERE id = ?`).run(
      opts.maxUsd,
      sha256(token),
      expiresAt,
      jobId,
    );
    // The token itself is never audited — only the grant and its ceiling.
    recordSocialAudit({
      event: "SOCIAL_APPROVAL_GRANTED",
      researchJobId: jobId,
      toolId: job.selectedToolId,
      detail: { approvedMaxUsd: opts.maxUsd, expiresAt },
    });
    return { approvalToken: token, expiresAt };
  }

  /**
   * Execute a research job end to end with bounded retry/fallback. Throws only for
   * invalid states; operational provider failures land on the job row instead.
   */
  async runJob(jobId: string, options: RunJobOptions = {}): Promise<RunJobResult> {
    const db = openAgentOsDb();
    const config = getSocialConfig();
    const guard = getSocialCostGuard();
    let job = this.getJob(jobId);
    if (!job) throw new SocialError("TOOL_NOT_FOUND", `research job ${jobId} not found`);
    if (job.state !== "draft" && job.state !== "routed" && job.state !== "approved" && job.state !== "approval_required") {
      throw new SocialError("INVALID_INPUT", `job ${jobId} is in state ${job.state} and cannot run`);
    }

    // Route.
    const route = await this.router.route({
      platform: (job.platform === "any" ? "any" : job.platform) as SocialResearchRequest["platform"],
      capabilities: job.capabilities as SocialResearchRequest["capabilities"],
      query: job.query ?? undefined,
      maxItems: job.maxItems,
      maxCostUsd: job.maxCostUsd,
      freshness: job.freshness as SocialResearchRequest["freshness"],
    });

    if (!route.decision.selectedToolId || !route.selectedTool) {
      this.transition(jobId, "failed", {
        errorCode: "UNSUPPORTED_CAPABILITY",
        summary: { blockedReason: route.decision.blockedReason },
      });
      job = this.getJob(jobId)!;
      return { job, runs: [], items: [], signals: 0, opportunities: 0 };
    }

    this.transition(jobId, "routed", {
      selectedToolId: route.selectedTool.id,
      estimatedCost: route.decision.estimatedCostUsd,
    });

    // Central cost gate — every run passes through here. Decide against the live
    // config (not the router's preview estimate) so the per-job limit participates.
    // A previously-approved job (within its approved maximum) skips the parking step.
    const estimate0 = route.decision.estimatedCostUsd ?? 0;
    const entryState = job.state;
    const previouslyApproved = entryState === "approved"
      && job.approvedMaxUsd !== null
      && estimate0 <= job.approvedMaxUsd;
    const budget = guard.decide({
      estimatedUsd: route.decision.estimatedCostUsd,
      pricingState: route.selectedTool.pricingState,
      jobId,
      jobLimitUsd: job.maxCostUsd,
      approvedMaxUsd: previouslyApproved ? job.approvedMaxUsd! : undefined,
    });
    const estimate = route.decision.estimatedCostUsd ?? 0;

    if (budget.state === "block_unknown_cost") {
      this.transition(jobId, "policy_blocked", { errorCode: "UNKNOWN_COST_BLOCKED", summary: { reason: budget.reason } });
      recordSocialAudit({
        event: "SOCIAL_POLICY_BLOCKED",
        researchJobId: jobId,
        toolId: route.selectedTool.id,
        providerId: route.selectedTool.providerId,
        detail: { reason: "unknown_cost", message: budget.reason },
      });
      return { job: this.getJob(jobId)!, runs: [], items: [], signals: 0, opportunities: 0 };
    }
    if (budget.state === "block_budget_exceeded") {
      this.transition(jobId, "budget_blocked", { errorCode: "BUDGET_EXCEEDED", summary: { reason: budget.reason } });
      recordSocialAudit({
        event: "SOCIAL_BUDGET_BLOCKED",
        researchJobId: jobId,
        toolId: route.selectedTool.id,
        providerId: route.selectedTool.providerId,
        detail: { reason: "budget_exceeded", message: budget.reason, estimatedCostUsd: estimate },
      });
      return { job: this.getJob(jobId)!, runs: [], items: [], signals: 0, opportunities: 0 };
    }

    if (route.decision.candidates.length > 0) {
      recordSocialAudit({
        event: "SOCIAL_ROUTE_DECIDED",
        researchJobId: jobId,
        toolId: route.selectedTool.id,
        providerId: route.selectedTool.providerId,
        detail: {
          score: route.decision.candidates[0]!.score,
          estimatedCostUsd: route.decision.estimatedCostUsd,
          requiresApproval: route.decision.requiresApproval,
          candidateCount: route.decision.candidates.length,
          budgetState: budget.state,
        },
      });
    }

    // Approval handling. The entry state (before the re-route transition above)
    // decides: a job parked in approval_required must present its single-use token;
    // a previously-approved job already passed the gate above. Re-parking is
    // unconditional because transition(routed) overwrote the approval_required
    // marker in the database.
    const parkedForApproval = entryState === "approval_required";
    const needsApprovalNow = budget.state === "require_approval";

    if (parkedForApproval || (needsApprovalNow && !previouslyApproved)) {
      if (parkedForApproval && options.approvalToken) {
        const consumed = this.consumeApproval(jobId, options.approvalToken, estimate);
        if (!consumed) {
          this.transition(jobId, "policy_blocked", {
            errorCode: "APPROVAL_REQUIRED",
            summary: { reason: "approval token invalid, expired, or below the approved amount" },
          });
          recordSocialAudit({
            event: "SOCIAL_POLICY_BLOCKED",
            researchJobId: jobId,
            toolId: route.selectedTool.id,
            providerId: route.selectedTool.providerId,
            detail: { reason: "approval_rejected", estimatedCostUsd: estimate },
          });
          return { job: this.getJob(jobId)!, runs: [], items: [], signals: 0, opportunities: 0 };
        }
      } else if (!previouslyApproved) {
        this.transition(jobId, "approval_required", { summary: { reason: budget.reason } });
        return { job: this.getJob(jobId)!, runs: [], items: [], signals: 0, opportunities: 0 };
      }
    }

    // Execute candidates with bounded attempts and fallback.
    this.transition(jobId, "running", {});
    if (route.selectedTool.pricingState !== "free") {
      recordSocialAudit({
        event: "SOCIAL_PAID_RUN_STARTED",
        researchJobId: jobId,
        toolId: route.selectedTool.id,
        providerId: route.selectedTool.providerId,
        detail: {
          estimatedCostUsd: estimate,
          pricingState: route.selectedTool.pricingState,
          approvedMaxUsd: this.getJob(jobId)?.approvedMaxUsd ?? null,
        },
      });
    }
    const startedAt = new Date().toISOString();
    const candidateTools = route.decision.candidates
      .map((c) => this.registry.getTool(c.toolId))
      .filter((t): t is NonNullable<typeof t> => t !== null && t.enabled);
    const provider = getSocialProvider(route.selectedTool.providerId);
    if (!provider) {
      this.transition(jobId, "failed", { errorCode: "PROVIDER_UNAVAILABLE", summary: { reason: "provider not registered" } });
      return { job: this.getJob(jobId)!, runs: [], items: [], signals: 0, opportunities: 0 };
    }

    const fallbackHistory: SocialResearchJob["fallbackHistory"] = [];
    const runs: SocialProviderRun[] = [];
    let succeeded: { toolId: string; run: SocialProviderRun; output: Awaited<ReturnType<typeof provider.run>> } | null = null;
    let totalAttempts = 0;

    for (let fallbackIndex = 0; fallbackIndex < candidateTools.length && totalAttempts < config.maxProviderAttempts; fallbackIndex++) {
      const tool = candidateTools[fallbackIndex]!;
      const estimate = route.decision.candidates[fallbackIndex]?.estimatedCostUsd ?? null;
      const maxToolAttempts = 1 + config.maxRetriesPerTool;

      // Every candidate run re-passes the central gate — no run bypasses cost policy,
      // including fallbacks whose cumulative spend may have eaten the job budget. The
      // job's approved maximum (if a token was consumed) covers paid candidates.
      const pre = guard.decide({
        estimatedUsd: estimate,
        pricingState: tool.pricingState,
        jobId,
        jobLimitUsd: job.maxCostUsd,
        approvedMaxUsd: this.getJob(jobId)?.approvedMaxUsd ?? undefined,
      });
      if (pre.state === "block_unknown_cost") {
        this.transition(jobId, "policy_blocked", { errorCode: "UNKNOWN_COST_BLOCKED", summary: { reason: pre.reason }, fallbackHistory });
        recordSocialAudit({
          event: "SOCIAL_POLICY_BLOCKED",
          researchJobId: jobId,
          toolId: tool.id,
          providerId: tool.providerId,
          detail: { reason: "unknown_cost", message: pre.reason, fallbackIndex },
        });
        return { job: this.getJob(jobId)!, runs, items: [], signals: 0, opportunities: 0 };
      }
      if (pre.state === "block_budget_exceeded") {
        fallbackHistory.push({ toolId: tool.id, attempt: totalAttempts, errorCode: "BUDGET_EXCEEDED", at: new Date().toISOString(), note: pre.reason });
        this.transition(jobId, "budget_blocked", { errorCode: "BUDGET_EXCEEDED", summary: { reason: pre.reason }, fallbackHistory });
        recordSocialAudit({
          event: "SOCIAL_BUDGET_BLOCKED",
          researchJobId: jobId,
          toolId: tool.id,
          providerId: tool.providerId,
          detail: { reason: "budget_exceeded", message: pre.reason, fallbackIndex, estimatedCostUsd: estimate },
        });
        return { job: this.getJob(jobId)!, runs, items: [], signals: 0, opportunities: 0 };
      }
      if (pre.state === "require_approval") {
        // This specific candidate was never approved; skip it, try the next one.
        fallbackHistory.push({ toolId: tool.id, attempt: totalAttempts, errorCode: "APPROVAL_REQUIRED", at: new Date().toISOString(), note: "candidate requires approval; skipped" });
        continue;
      }

      for (let attempt = 1; attempt <= maxToolAttempts && totalAttempts < config.maxProviderAttempts; attempt++) {
        totalAttempts++;
        const runId = `srun_${randomUUID().slice(0, 16)}`;
        const runStarted = new Date().toISOString();
        db.query(`INSERT INTO social_provider_runs (
          id, research_job_id, provider_id, tool_id, provider_run_id, attempt, fallback_index,
          status, started_at, estimated_cost, item_count
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'running', ?, ?, 0)`).run(
          runId, jobId, tool.providerId, tool.id, attempt, fallbackIndex, runStarted, estimate,
        );

        try {
          const output = await provider.run({
            tool: { id: tool.id, providerId: tool.providerId, externalId: tool.externalId, name: tool.name },
            query: job.query ?? "",
            maxItems: job.maxItems,
          });
          const durationMs = Date.now() - Date.parse(runStarted);
          const finishedAt = new Date().toISOString();
          db.query(`UPDATE social_provider_runs SET
            provider_run_id = ?, status = 'succeeded', finished_at = ?, duration_ms = ?,
            actual_cost = ?, item_count = ? WHERE id = ?`).run(
            output.providerRunId, finishedAt, durationMs, output.actualCostUsd, output.itemCount, runId,
          );
          this.registry.recordRunOutcome(tool.id, { ok: true, durationMs });
          const runRow = this.getRun(runId)!;
          runs.push(runRow);
          succeeded = { toolId: tool.id, run: runRow, output };
          break;
        } catch (error) {
          const socialError = toSocialError(error);
          const durationMs = Date.now() - Date.parse(runStarted);
          db.query(`UPDATE social_provider_runs SET
            status = 'failed', finished_at = ?, duration_ms = ?, error_code = ?, error_message = ?
            WHERE id = ?`).run(
            new Date().toISOString(), durationMs, socialError.code, socialError.message.slice(0, 500), runId,
          );
          this.registry.recordRunOutcome(tool.id, {
            ok: false,
            timeout: socialError.code === "PROVIDER_TIMEOUT",
            durationMs,
          });
          runs.push(this.getRun(runId)!);
          fallbackHistory.push({
            toolId: tool.id,
            attempt,
            errorCode: socialError.code,
            at: new Date().toISOString(),
            note: socialError.message.slice(0, 200),
          });

          if (!isRetryableErrorCode(socialError.code)) {
            // Non-retryable: stop everything — the next candidate would fail the same way.
            this.transition(jobId, "failed", {
              errorCode: socialError.code,
              summary: { reason: socialError.message.slice(0, 200) },
              fallbackHistory,
            });
            recordSocialAudit({
              event: "SOCIAL_RUN_FAILED",
              researchJobId: jobId,
              toolId: tool.id,
              providerId: tool.providerId,
              detail: {
                errorCode: socialError.code,
                retryable: false,
                attempt,
                fallbackIndex,
                durationMs,
              },
            });
            return { job: this.getJob(jobId)!, runs, items: [], signals: 0, opportunities: 0 };
          }
          if (attempt < maxToolAttempts && totalAttempts < config.maxProviderAttempts) {
            fallbackHistory.push({
              toolId: tool.id,
              attempt,
              errorCode: null,
              at: new Date().toISOString(),
              note: `retrying tool (${socialError.code})`,
            });
          }
        }
      }
      if (succeeded) break;
      if (fallbackIndex + 1 < candidateTools.length && totalAttempts < config.maxProviderAttempts) {
        fallbackHistory.push({
          toolId: tool.id,
          attempt: totalAttempts,
          errorCode: null,
          at: new Date().toISOString(),
          note: "falling back to next candidate",
        });
      }
    }

    if (!succeeded) {
      this.transition(jobId, "failed", {
        errorCode: "PROVIDER_UNAVAILABLE",
        summary: { reason: `all ${totalAttempts} attempts failed`, attempts: totalAttempts },
        fallbackHistory,
      });
      recordSocialAudit({
        event: "SOCIAL_RUN_FAILED",
        researchJobId: jobId,
        detail: { errorCode: "PROVIDER_UNAVAILABLE", attempts: totalAttempts, fallbackCount: fallbackHistory.length },
      });
      return { job: this.getJob(jobId)!, runs, items: [], signals: 0, opportunities: 0 };
    }

    // Normalize + dedupe + persist evidence.
    const { run, output } = succeeded;
    const selectedTool = candidateTools.find((t) => t.id === run.toolId) ?? route.selectedTool;
    const normalized: NormalizedContentItem[] = [];
    for (const raw of output.items) {
      const item = normalizeProviderItem(selectedTool, raw, {
        providerId: selectedTool.providerId,
        runId: run.id,
        platform: selectedTool.platform,
        fetchedAt: new Date().toISOString(),
      });
      if (item) normalized.push(item);
    }
    markDuplicates(normalized);

    const dbItems = db.query("SELECT COUNT(*) AS n FROM social_normalized_items WHERE research_job_id = ?").get(jobId) as { n: number };
    const remainingSlots = Math.max(0, config.maxItemsHardLimit * 4 - Number(dbItems.n));
    const persisted = normalized.slice(0, remainingSlots);
    for (const item of persisted) {
      db.query(`INSERT INTO social_normalized_items (
        id, research_job_id, run_id, platform, content_type, external_id, source_tool_id,
        source_url, author_external_id, author_display_name, title, text, description,
        published_at, observed_at, metrics_json, hashtags_json, mentions_json, language,
        duplicate_of, provenance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        item.id, jobId, run.id, item.platform, item.contentType, item.externalId, item.sourceToolId,
        item.sourceUrl, item.authorExternalId, item.authorDisplayName, item.title, item.text, item.description,
        item.publishedAt, item.observedAt, JSON.stringify(item.metrics), JSON.stringify(item.hashtags),
        JSON.stringify(item.mentions), item.language, item.duplicateOf, JSON.stringify(item.provenance),
      );
    }

    // Usage ledger: estimated and actual stay separate fields.
    guard.recordUsage({
      researchJobId: jobId,
      runId: run.id,
      providerId: selectedTool.providerId,
      toolId: selectedTool.id,
      estimatedCost: run.estimatedCost,
      actualCost: run.actualCost,
      currency: selectedTool.currency,
      inputItemCount: 1,
      outputItemCount: output.itemCount,
      status: "completed",
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    // Trend intelligence + opportunity proposals (evidence-only, honestly labeled).
    const signals = aggregateTrendSignals(jobId, persisted.filter((i) => !i.duplicateOf));
    const opportunities = buildStockOpportunities(jobId, persisted.filter((i) => !i.duplicateOf));

    const uniqueCount = persisted.filter((i) => !i.duplicateOf).length;
    this.transition(jobId, "completed", {
      summary: {
        itemCount: output.itemCount,
        normalizedCount: persisted.length,
        uniqueCount,
        duplicateCount: persisted.length - uniqueCount,
        signalCount: signals.length,
        opportunityCount: opportunities.length,
        estimatedCostUsd: run.estimatedCost,
        actualCostUsd: run.actualCost,
        selectedToolId: selectedTool.id,
        selectedToolExternalId: selectedTool.externalId,
      },
      fallbackHistory,
    });

    recordSocialAudit({
      event: "SOCIAL_RUN_COMPLETED",
      researchJobId: jobId,
      toolId: selectedTool.id,
      providerId: selectedTool.providerId,
      detail: {
        itemCount: output.itemCount,
        uniqueCount,
        duplicateCount: persisted.length - uniqueCount,
        signalCount: signals.length,
        opportunityCount: opportunities.length,
        estimatedCostUsd: run.estimatedCost,
        actualCostUsd: run.actualCost,
        fallbackCount: fallbackHistory.length,
      },
    });

    return {
      job: this.getJob(jobId)!,
      runs,
      items: persisted,
      signals: signals.length,
      opportunities: opportunities.length,
    };
  }

  private consumeApproval(jobId: string, token: string, estimatedUsd: number): boolean {
    const db = openAgentOsDb();
    // No state check here: runJob's route transition moves a parked job through
    // "routed" before consuming, and a non-null token hash can only exist because
    // approveJob was called for this exact job. Hash + expiry + amount carry the
    // security of the exchange.
    const row = db.query("SELECT approval_token_hash, approval_expires_at, approved_max_usd FROM social_research_jobs WHERE id = ?")
      .get(jobId) as { approval_token_hash: string | null; approval_expires_at: string | null; approved_max_usd: number | null } | undefined;
    if (!row || !row.approval_token_hash || !row.approval_expires_at) return false;
    if (row.approval_token_hash !== sha256(token)) return false;
    if (Date.parse(row.approval_expires_at) < Date.now()) return false;
    if (row.approved_max_usd === null || estimatedUsd > row.approved_max_usd) return false;
    // Single use: clear the hash as part of the same state transition.
    db.query("UPDATE social_research_jobs SET approval_token_hash = NULL, state = 'approved' WHERE id = ?").run(jobId);
    return true;
  }

  private transition(
    jobId: string,
    state: SocialJobState,
    extra: { errorCode?: SocialErrorCode; selectedToolId?: string; estimatedCost?: number | null; summary?: Record<string, unknown>; fallbackHistory?: SocialResearchJob["fallbackHistory"] } = {},
  ): void {
    const db = openAgentOsDb();
    const job = this.getJob(jobId);
    if (!job) return;
    const now = new Date().toISOString();
    const history = extra.fallbackHistory ?? job.fallbackHistory;
    const summary = extra.summary ? { ...job.resultSummary, ...extra.summary } : job.resultSummary;
    db.query(`UPDATE social_research_jobs SET
      state = ?,
      selected_tool_id = COALESCE(?, selected_tool_id),
      estimated_cost = COALESCE(?, estimated_cost),
      fallback_history_json = ?,
      result_summary_json = ?,
      error_code = ?,
      started_at = COALESCE(started_at, ?),
      completed_at = ?
      WHERE id = ?`).run(
      state,
      extra.selectedToolId ?? null,
      extra.estimatedCost === undefined ? null : extra.estimatedCost,
      JSON.stringify(history),
      JSON.stringify(summary),
      extra.errorCode ?? null,
      now,
      TERMINAL_STATES.has(state) ? now : null,
      jobId,
    );
  }
}

const TERMINAL_STATES: ReadonlySet<SocialJobState> = new Set([
  "completed", "failed", "cancelled", "budget_blocked", "policy_blocked",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rowToJob(row: Record<string, unknown>): SocialResearchJob {
  let fallbackHistory: SocialResearchJob["fallbackHistory"] = [];
  try {
    const parsed = JSON.parse(String(row.fallback_history_json ?? "[]"));
    if (Array.isArray(parsed)) fallbackHistory = parsed;
  } catch { /* keep empty */ }
  let resultSummary: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.result_summary_json ?? "{}"));
    if (parsed && typeof parsed === "object") resultSummary = parsed;
  } catch { /* keep empty */ }
  return {
    id: String(row.id),
    platform: String(row.platform),
    capabilities: safeStringArray(row.capabilities_json),
    query: (row.query as string | null) ?? null,
    maxItems: Number(row.max_items),
    maxCostUsd: Number(row.max_cost_usd),
    freshness: String(row.freshness),
    state: String(row.state) as SocialJobState,
    selectedToolId: (row.selected_tool_id as string | null) ?? null,
    estimatedCostUsd: row.estimated_cost === null || row.estimated_cost === undefined ? null : Number(row.estimated_cost),
    approvedMaxUsd: row.approved_max_usd === null || row.approved_max_usd === undefined ? null : Number(row.approved_max_usd),
    approvalExpiresAt: (row.approval_expires_at as string | null) ?? null,
    fallbackHistory,
    resultSummary,
    errorCode: (row.error_code as SocialErrorCode | null) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

function rowToRun(row: Record<string, unknown>): SocialProviderRun {
  return {
    id: String(row.id),
    researchJobId: String(row.research_job_id),
    providerId: String(row.provider_id),
    toolId: String(row.tool_id),
    providerRunId: (row.provider_run_id as string | null) ?? null,
    attempt: Number(row.attempt),
    fallbackIndex: Number(row.fallback_index),
    status: String(row.status) as SocialRunStatus,
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    estimatedCost: row.estimated_cost === null || row.estimated_cost === undefined ? null : Number(row.estimated_cost),
    actualCost: row.actual_cost === null || row.actual_cost === undefined ? null : Number(row.actual_cost),
    itemCount: Number(row.item_count ?? 0),
    errorCode: (row.error_code as SocialErrorCode | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    fallbackReason: (row.fallback_reason as string | null) ?? null,
  };
}

function rowToItem(row: Record<string, unknown>): NormalizedContentItem {
  let metrics: NormalizedContentItem["metrics"] = {
    views: null, likes: null, comments: null, shares: null, saves: null, followers: null,
  };
  try {
    const parsed = JSON.parse(String(row.metrics_json ?? "{}"));
    if (parsed && typeof parsed === "object") metrics = parsed;
  } catch { /* keep defaults */ }
  let provenance: NormalizedContentItem["provenance"] = {
    provider: String(row.provider_id ?? "unknown"),
    toolId: String(row.source_tool_id),
    runId: String(row.run_id),
    fetchedAt: String(row.observed_at),
  };
  try {
    const parsed = JSON.parse(String(row.provenance_json ?? "{}"));
    if (parsed && typeof parsed === "object") provenance = parsed;
  } catch { /* keep defaults */ }
  return {
    id: String(row.id),
    platform: String(row.platform) as NormalizedContentItem["platform"],
    sourceToolId: String(row.source_tool_id),
    sourceUrl: (row.source_url as string | null) ?? null,
    contentType: String(row.content_type) as NormalizedContentItem["contentType"],
    externalId: (row.external_id as string | null) ?? null,
    authorExternalId: (row.author_external_id as string | null) ?? null,
    authorDisplayName: (row.author_display_name as string | null) ?? null,
    text: (row.text as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    observedAt: String(row.observed_at),
    metrics,
    hashtags: safeStringArray(row.hashtags_json),
    mentions: safeStringArray(row.mentions_json),
    language: (row.language as string | null) ?? null,
    duplicateOf: (row.duplicate_of as string | null) ?? null,
    provenance,
  };
}

function safeStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export type { SocialBudgetDecisionState };
