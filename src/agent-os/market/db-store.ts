/**
 * Pao Market Signal Control Plane — SQLite persistence (Phase 20.52).
 *
 * Additive tables in the shared Agent OS database (bun:sqlite, OPENCODEX_HOME),
 * following the same pattern as every other phase store.
 *
 * Query-safety rules for this file, enforced by review and by the security
 * scanner: every SQL string is a compile-time constant (no interpolation);
 * every caller-controlled value binds to a `?` placeholder; SQL keywords are
 * never built from data; DDL is a fixed statement list. Sensitive webhook
 * headers are redacted BEFORE they reach this layer; secrets never have a
 * column anywhere in these tables.
 */

import { openAgentOsDb } from "../db";
import type {
  ApprovalRequest,
  ApprovalStatus,
  AuditRecord,
  CircuitBreakerRecord,
  DailyRiskState,
  MarketAIAnalysis,
  MarketNotification,
  MarketProviderId,
  MarketSignal,
  PaperPosition,
  ProviderHealth,
  RiskAssessment,
  ReviewerVote,
  SignalQuality,
  SignalStatus,
  StatusTransition,
  TradeProposal,
  TradeResult,
  ActorRef,
} from "./types";

// Fixed DDL statement list. Each entry runs as-is; nothing here is dynamic.
const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS market_providers (
    provider_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    auth_type TEXT NOT NULL,
    health_state TEXT NOT NULL DEFAULT 'unknown',
    last_event_at TEXT,
    last_failure_at TEXT,
    events_total INTEGER NOT NULL DEFAULT 0,
    failures_total INTEGER NOT NULL DEFAULT 0,
    duplicates_total INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_webhook_deliveries (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    delivery_id TEXT,
    event_type TEXT,
    signature_valid INTEGER NOT NULL,
    timestamp_valid INTEGER NOT NULL,
    duplicate INTEGER NOT NULL DEFAULT 0,
    http_status INTEGER NOT NULL,
    remote_ip_hash TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    error_code TEXT,
    error_message TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_market_delivery_unique
    ON market_webhook_deliveries(provider_id, delivery_id) WHERE delivery_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_market_delivery_provider ON market_webhook_deliveries(provider_id, received_at)`,
  `CREATE TABLE IF NOT EXISTS market_raw_events (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    delivery_id TEXT,
    content_type TEXT NOT NULL,
    payload_text TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    headers_redacted_json TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_raw_provider ON market_raw_events(provider_id, received_at)`,
  `CREATE TABLE IF NOT EXISTS market_signals (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    provider_event_id TEXT,
    raw_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    exchange TEXT,
    currency TEXT,
    direction TEXT,
    entry_price REAL,
    stop_price REAL,
    target_price REAL,
    provider_confidence REAL,
    provider_score REAL,
    timeframe TEXT,
    strategy TEXT,
    signal_time TEXT NOT NULL,
    received_at TEXT NOT NULL,
    normalized_at TEXT NOT NULL,
    verified INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    current_status TEXT NOT NULL,
    quality_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_signal_symbol ON market_signals(symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_market_signal_status ON market_signals(current_status)`,
  `CREATE INDEX IF NOT EXISTS idx_market_signal_time ON market_signals(signal_time)`,
  `CREATE TABLE IF NOT EXISTS market_signal_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_status_history ON market_signal_status_history(signal_id)`,
  `CREATE TABLE IF NOT EXISTS market_ai_analyses (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    data_sufficient INTEGER NOT NULL,
    missing_data_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    bullish_json TEXT NOT NULL DEFAULT '[]',
    bearish_json TEXT NOT NULL DEFAULT '[]',
    invalidation_json TEXT NOT NULL DEFAULT '[]',
    risk_notes_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL,
    confidence_basis_json TEXT NOT NULL DEFAULT '[]',
    consensus_json TEXT,
    validation_json TEXT NOT NULL,
    model_runs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_analysis_signal ON market_ai_analyses(signal_id)`,
  `CREATE TABLE IF NOT EXISTS market_reviewer_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasons_json TEXT NOT NULL DEFAULT '[]',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_votes_analysis ON market_reviewer_votes(analysis_id)`,
  `CREATE TABLE IF NOT EXISTS market_risk_assessments (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    account_value REAL,
    planned_risk_amount REAL,
    position_size REAL,
    estimated_position_value REAL,
    exposure_before REAL,
    exposure_after REAL,
    passed INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_risk_signal ON market_risk_assessments(signal_id)`,
  `CREATE TABLE IF NOT EXISTS market_risk_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_findings_assessment ON market_risk_findings(assessment_id)`,
  `CREATE TABLE IF NOT EXISTS market_trade_proposals (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    analysis_id TEXT,
    risk_assessment_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    requested_price REAL,
    stop_price REAL,
    target_price REAL,
    execution_mode TEXT NOT NULL DEFAULT 'paper',
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_proposal_status ON market_trade_proposals(status)`,
  `CREATE TABLE IF NOT EXISTS market_approval_requests (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    rejected_by TEXT,
    rejected_at TEXT,
    rejection_reason TEXT,
    edited_fields_json TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_approval_status ON market_approval_requests(status)`,
  `CREATE TABLE IF NOT EXISTS market_paper_orders (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    paper_order_id TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    requested_price REAL,
    filled_price REAL,
    slippage_bps REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    filled_at TEXT,
    closed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_paper_orders(status)`,
  `CREATE TABLE IF NOT EXISTS market_trade_results (
    id TEXT PRIMARY KEY,
    paper_order_id TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    gross_pnl REAL NOT NULL,
    fees REAL NOT NULL DEFAULT 0,
    net_pnl REAL NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_circuit_breaker_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    previous_state TEXT NOT NULL,
    new_state TEXT NOT NULL,
    trigger_code TEXT,
    reason TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_audit_correlation ON market_audit_logs(correlation_id)`,
  `CREATE TABLE IF NOT EXISTS market_notifications (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    correlation_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_daily_risk (
    date TEXT PRIMARY KEY,
    opening_equity REAL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    loss_percent REAL,
    circuit_breaker_triggered INTEGER NOT NULL DEFAULT 0
  )`,
];

interface StoreOptions {
  readonly now?: () => Date;
}

export class MarketDbStore {
  private initialized = false;
  private readonly now: () => Date;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  init(): boolean {
    if (this.initialized) return true;
    try {
      const db = openAgentOsDb();
      for (const statement of DDL_STATEMENTS) {
        db.run(statement);
      }
      this.initialized = true;
    } catch {
      this.initialized = false;
    }
    return this.initialized;
  }

  private db(): ReturnType<typeof openAgentOsDb> {
    if (!this.init()) throw new Error("MARKET_STORE_UNAVAILABLE");
    return openAgentOsDb();
  }

  private ts(): string {
    return this.now().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Providers
  // ---------------------------------------------------------------------------

  upsertProvider(input: {
    providerId: MarketProviderId;
    displayName: string;
    enabled: boolean;
    authType: string;
  }): void {
    this.db()
      .query(
        "INSERT INTO market_providers (provider_id, display_name, enabled, auth_type, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET display_name = excluded.display_name, enabled = excluded.enabled, auth_type = excluded.auth_type, updated_at = excluded.updated_at",
      )
      .run(input.providerId, input.displayName, input.enabled ? 1 : 0, input.authType, this.ts());
  }

  setProviderEnabled(providerId: string, enabled: boolean): void {
    this.db()
      .query("UPDATE market_providers SET enabled = ?, updated_at = ? WHERE provider_id = ?")
      .run(enabled ? 1 : 0, this.ts(), providerId);
  }

  getProvider(providerId: string): {
    providerId: string;
    displayName: string;
    enabled: boolean;
    authType: string;
    healthState: string;
    lastEventAt: string | null;
    eventsTotal: number;
    failuresTotal: number;
    duplicatesTotal: number;
  } | null {
    const row = this.db()
      .query("SELECT * FROM market_providers WHERE provider_id = ?")
      .get(providerId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      providerId: String(row.provider_id),
      displayName: String(row.display_name),
      enabled: Number(row.enabled) === 1,
      authType: String(row.auth_type),
      healthState: String(row.health_state),
      lastEventAt: row.last_event_at === null ? null : String(row.last_event_at),
      eventsTotal: Number(row.events_total),
      failuresTotal: Number(row.failures_total),
      duplicatesTotal: Number(row.duplicates_total),
    };
  }

  listProviders(): NonNullable<ReturnType<MarketDbStore["getProvider"]>>[] {
    const rows = this.db()
      .query("SELECT provider_id FROM market_providers ORDER BY provider_id")
      .all() as Array<{ provider_id: string }>;
    return rows.map(r => this.getProvider(r.provider_id)!);
  }

  recordProviderEvent(providerId: string, kind: "event" | "failure" | "duplicate"): void {
    const db = this.db();
    const ts = this.ts();
    // One static statement per kind; the branch is chosen in code, never built
    // from data.
    if (kind === "event") {
      db.query(
        "UPDATE market_providers SET events_total = events_total + 1, last_event_at = ?, updated_at = ? WHERE provider_id = ?",
      ).run(ts, ts, providerId);
      return;
    }
    if (kind === "failure") {
      db.query(
        "UPDATE market_providers SET failures_total = failures_total + 1, last_failure_at = ?, updated_at = ? WHERE provider_id = ?",
      ).run(ts, ts, providerId);
      return;
    }
    db.query(
      "UPDATE market_providers SET duplicates_total = duplicates_total + 1, updated_at = ? WHERE provider_id = ?",
    ).run(ts, providerId);
  }

  providerHealth(providerId: string): ProviderHealth {
    const p = this.getProvider(providerId);
    if (!p) {
      return { providerId, enabled: false, state: "unknown", verificationFailureRate: 0, duplicateRate: 0 };
    }
    const events = p.eventsTotal;
    const state: ProviderHealth["state"] = !p.enabled
      ? "disabled"
      : events === 0
        ? "unknown"
        : p.failuresTotal / Math.max(1, events) > 0.5
          ? "degraded"
          : "healthy";
    return {
      providerId,
      enabled: p.enabled,
      state,
      lastEventAt: p.lastEventAt ?? undefined,
      lastFailureAt: undefined,
      verificationFailureRate: events === 0 ? 0 : p.failuresTotal / events,
      duplicateRate: events === 0 ? 0 : p.duplicatesTotal / events,
    };
  }

  // ---------------------------------------------------------------------------
  // Deliveries (dedup + ingress audit)
  // ---------------------------------------------------------------------------

  /** Returns false when (provider_id, delivery_id) was already recorded. */
  recordDelivery(input: {
    id: string;
    providerId: string;
    deliveryId: string | null;
    eventType: string | null;
    signatureValid: boolean;
    timestampValid: boolean;
    httpStatus: number;
    remoteIpHash?: string;
    errorCode?: string;
    errorMessage?: string;
  }): boolean {
    const result = this.db()
      .query(
        "INSERT OR IGNORE INTO market_webhook_deliveries (id, provider_id, delivery_id, event_type, signature_valid, timestamp_valid, duplicate, http_status, remote_ip_hash, received_at, error_code, error_message) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.providerId,
        input.deliveryId,
        input.eventType,
        input.signatureValid ? 1 : 0,
        input.timestampValid ? 1 : 0,
        input.httpStatus,
        input.remoteIpHash ?? null,
        this.ts(),
        input.errorCode ?? null,
        input.errorMessage ?? null,
      );
    return Number(result.changes) === 1;
  }

  markDeliveryDuplicate(deliveryRowId: string): void {
    this.db()
      .query("UPDATE market_webhook_deliveries SET duplicate = 1, processed_at = ? WHERE id = ?")
      .run(this.ts(), deliveryRowId);
  }

  hasDelivery(providerId: string, deliveryId: string): boolean {
    const row = this.db()
      .query("SELECT id FROM market_webhook_deliveries WHERE provider_id = ? AND delivery_id = ? LIMIT 1")
      .get(providerId, deliveryId) as { id: string } | undefined;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Raw events
  // ---------------------------------------------------------------------------

  saveRawEvent(input: {
    id: string;
    providerId: string;
    deliveryId: string | null;
    contentType: string;
    payloadText: string;
    payloadHash: string;
    headersRedacted: Record<string, string>;
  }): void {
    this.db()
      .query(
        "INSERT INTO market_raw_events (id, provider_id, delivery_id, content_type, payload_text, payload_hash, headers_redacted_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.providerId,
        input.deliveryId,
        input.contentType,
        input.payloadText,
        input.payloadHash,
        JSON.stringify(input.headersRedacted),
        this.ts(),
      );
  }

  getRawEvent(id: string): {
    id: string;
    providerId: string;
    payloadText: string;
    payloadHash: string;
    headersRedacted: Record<string, string>;
    receivedAt: string;
  } | null {
    const row = this.db().query("SELECT * FROM market_raw_events WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return {
      id: String(row.id),
      providerId: String(row.provider_id),
      payloadText: String(row.payload_text),
      payloadHash: String(row.payload_hash),
      headersRedacted: JSON.parse(String(row.headers_redacted_json)) as Record<string, string>,
      receivedAt: String(row.received_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Signals
  // ---------------------------------------------------------------------------

  saveSignal(signal: MarketSignal, status: SignalStatus, quality: SignalQuality | null): void {
    const ts = this.ts();
    this.db()
      .query(
        "INSERT INTO market_signals (id, provider_id, provider_event_id, raw_event_id, event_type, symbol, asset_class, exchange, currency, direction, entry_price, stop_price, target_price, provider_confidence, provider_score, timeframe, strategy, signal_time, received_at, normalized_at, verified, metadata_json, current_status, quality_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        signal.id,
        signal.provider,
        signal.providerEventId ?? null,
        signal.rawEventId,
        signal.eventType,
        signal.symbol,
        signal.assetClass,
        signal.exchange ?? null,
        signal.currency ?? null,
        signal.direction ?? null,
        signal.entryPrice ?? null,
        signal.stopPrice ?? null,
        signal.targetPrice ?? null,
        signal.providerConfidence ?? null,
        signal.providerScore ?? null,
        signal.timeframe ?? null,
        signal.strategy ?? null,
        signal.signalTime,
        signal.receivedAt,
        signal.normalizedAt,
        signal.verified ? 1 : 0,
        JSON.stringify(signal.metadata),
        status,
        quality ? JSON.stringify(quality) : null,
        ts,
        ts,
      );
  }

  private rowToSignal(row: Record<string, unknown>): {
    signal: MarketSignal;
    status: SignalStatus;
    quality: SignalQuality | null;
  } {
    return {
      signal: {
        id: String(row.id),
        provider: String(row.provider_id),
        providerEventId: row.provider_event_id === null ? undefined : String(row.provider_event_id),
        deliveryId: undefined,
        rawEventId: String(row.raw_event_id),
        eventType: row.event_type as MarketSignal["eventType"],
        symbol: String(row.symbol),
        assetClass: row.asset_class as MarketSignal["assetClass"],
        exchange: row.exchange === null ? undefined : String(row.exchange),
        currency: row.currency === null ? undefined : String(row.currency),
        direction: row.direction === null ? undefined : (String(row.direction) as MarketSignal["direction"]),
        entryPrice: row.entry_price === null ? undefined : Number(row.entry_price),
        stopPrice: row.stop_price === null ? undefined : Number(row.stop_price),
        targetPrice: row.target_price === null ? undefined : Number(row.target_price),
        providerConfidence: row.provider_confidence === null ? undefined : Number(row.provider_confidence),
        providerScore: row.provider_score === null ? undefined : Number(row.provider_score),
        timeframe: row.timeframe === null ? undefined : String(row.timeframe),
        strategy: row.strategy === null ? undefined : String(row.strategy),
        signalTime: String(row.signal_time),
        receivedAt: String(row.received_at),
        normalizedAt: String(row.normalized_at),
        verified: Number(row.verified) === 1,
        duplicate: false,
        tags: [],
        metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
      },
      status: String(row.current_status) as SignalStatus,
      quality: row.quality_json === null ? null : (JSON.parse(String(row.quality_json)) as SignalQuality),
    };
  }

  getSignal(id: string): {
    signal: MarketSignal;
    status: SignalStatus;
    quality: SignalQuality | null;
  } | null {
    const row = this.db().query("SELECT * FROM market_signals WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    return row ? this.rowToSignal(row) : null;
  }

  listSignals(
    options: { status?: SignalStatus; symbol?: string; limit?: number } = {},
  ): Array<{ signal: MarketSignal; status: SignalStatus; quality: SignalQuality | null }> {
    // Bounded over-fetch + in-memory filtering keeps every query string static.
    const limit = Math.min(options.limit ?? 100, 500);
    const rows = this.db()
      .query("SELECT * FROM market_signals ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit * 10, 2000)) as Array<Record<string, unknown>>;
    return rows
      .map(r => this.rowToSignal(r))
      .filter(r => (options.status ? r.status === options.status : true))
      .filter(r => (options.symbol ? r.signal.symbol === options.symbol : true))
      .slice(0, limit);
  }

  updateSignalStatus(transition: StatusTransition): void {
    const db = this.db();
    db.query("UPDATE market_signals SET current_status = ?, updated_at = ? WHERE id = ?").run(
      transition.to,
      this.ts(),
      transition.signalId,
    );
    db.query(
      "INSERT INTO market_signal_status_history (signal_id, from_status, to_status, reason, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      transition.signalId,
      transition.from,
      transition.to,
      transition.reason,
      transition.actor.type,
      transition.actor.id,
      transition.at,
    );
  }

  listStatusHistory(signalId: string): StatusTransition[] {
    const rows = this.db()
      .query("SELECT * FROM market_signal_status_history WHERE signal_id = ? ORDER BY id")
      .all(signalId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      signalId: String(r.signal_id),
      from: String(r.from_status) as SignalStatus,
      to: String(r.to_status) as SignalStatus,
      reason: String(r.reason),
      actor: { type: String(r.actor_type) as ActorRef["type"], id: String(r.actor_id) },
      at: String(r.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // AI analyses + votes
  // ---------------------------------------------------------------------------

  saveAnalysis(analysis: MarketAIAnalysis): void {
    const db = this.db();
    db.query(
      "INSERT INTO market_ai_analyses (id, signal_id, data_sufficient, missing_data_json, summary, bullish_json, bearish_json, invalidation_json, risk_notes_json, confidence, confidence_basis_json, consensus_json, validation_json, model_runs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      analysis.id,
      analysis.signalId,
      analysis.dataSufficient ? 1 : 0,
      JSON.stringify(analysis.missingData),
      analysis.summary,
      JSON.stringify(analysis.bullishFactors),
      JSON.stringify(analysis.bearishFactors),
      JSON.stringify(analysis.invalidationFactors),
      JSON.stringify(analysis.riskNotes),
      analysis.confidence,
      JSON.stringify(analysis.confidenceBasis),
      analysis.reviewerConsensus ? JSON.stringify(analysis.reviewerConsensus) : null,
      JSON.stringify(analysis.validation),
      JSON.stringify(analysis.modelRuns),
      analysis.generatedAt,
    );
    for (const vote of analysis.reviewerConsensus?.votes ?? []) {
      db.query(
        "INSERT INTO market_reviewer_votes (analysis_id, reviewer_id, verdict, confidence, reasons_json, warnings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        analysis.id,
        vote.reviewer,
        vote.verdict,
        vote.confidence,
        JSON.stringify(vote.reasons),
        JSON.stringify(vote.warnings),
        analysis.generatedAt,
      );
    }
  }

  getAnalysisBySignal(signalId: string): MarketAIAnalysis | null {
    const row = this.db()
      .query("SELECT * FROM market_ai_analyses WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(signalId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id),
      signalId: String(row.signal_id),
      dataSufficient: Number(row.data_sufficient) === 1,
      missingData: JSON.parse(String(row.missing_data_json)) as string[],
      summary: String(row.summary),
      bullishFactors: JSON.parse(String(row.bullish_json)) as string[],
      bearishFactors: JSON.parse(String(row.bearish_json)) as string[],
      invalidationFactors: JSON.parse(String(row.invalidation_json)) as string[],
      riskNotes: JSON.parse(String(row.risk_notes_json)) as string[],
      confidence: Number(row.confidence),
      confidenceBasis: JSON.parse(String(row.confidence_basis_json)) as string[],
      reviewerConsensus:
        row.consensus_json === null
          ? undefined
          : (JSON.parse(String(row.consensus_json)) as MarketAIAnalysis["reviewerConsensus"]),
      validation: JSON.parse(String(row.validation_json)) as MarketAIAnalysis["validation"],
      modelRuns: JSON.parse(String(row.model_runs_json)) as MarketAIAnalysis["modelRuns"],
      generatedAt: String(row.created_at),
    };
  }

  listVotes(analysisId: string): ReviewerVote[] {
    const rows = this.db()
      .query("SELECT * FROM market_reviewer_votes WHERE analysis_id = ? ORDER BY id")
      .all(analysisId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      reviewer: String(r.reviewer_id),
      verdict: String(r.verdict) as ReviewerVote["verdict"],
      confidence: Number(r.confidence),
      reasons: JSON.parse(String(r.reasons_json)) as string[],
      warnings: JSON.parse(String(r.warnings_json)) as string[],
    }));
  }

  // ---------------------------------------------------------------------------
  // Risk
  // ---------------------------------------------------------------------------

  saveRiskAssessment(assessment: RiskAssessment): void {
    const db = this.db();
    db.query(
      "INSERT INTO market_risk_assessments (id, signal_id, account_value, planned_risk_amount, position_size, estimated_position_value, exposure_before, exposure_after, passed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      assessment.id,
      assessment.signalId,
      assessment.accountValue ?? null,
      assessment.plannedRiskAmount ?? null,
      assessment.positionSize ?? null,
      assessment.estimatedPositionValue ?? null,
      assessment.exposureBefore ?? null,
      assessment.exposureAfter ?? null,
      assessment.passed ? 1 : 0,
      assessment.createdAt,
    );
    for (const finding of [...assessment.hardFailures, ...assessment.warnings, ...assessment.infos]) {
      db.query(
        "INSERT INTO market_risk_findings (assessment_id, policy_id, severity, code, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        assessment.id,
        finding.policyId,
        finding.severity,
        finding.code,
        finding.message,
        finding.data ? JSON.stringify(finding.data) : null,
        assessment.createdAt,
      );
    }
  }

  getRiskAssessmentBySignal(signalId: string): RiskAssessment | null {
    const row = this.db()
      .query("SELECT * FROM market_risk_assessments WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(signalId) as Record<string, unknown> | null;
    if (!row) return null;
    const id = String(row.id);
    const findings = this.db()
      .query("SELECT * FROM market_risk_findings WHERE assessment_id = ? ORDER BY id")
      .all(id) as Array<Record<string, unknown>>;
    const toFinding = (r: Record<string, unknown>) => ({
      policyId: String(r.policy_id),
      severity: String(r.severity) as "INFO" | "WARNING" | "HARD_FAIL",
      code: String(r.code),
      message: String(r.message),
      data: r.data_json === null ? undefined : (JSON.parse(String(r.data_json)) as Record<string, unknown>),
    });
    return {
      id,
      signalId: String(row.signal_id),
      passed: Number(row.passed) === 1,
      hardFailures: findings.filter(f => String(f.severity) === "HARD_FAIL").map(toFinding),
      warnings: findings.filter(f => String(f.severity) === "WARNING").map(toFinding),
      infos: findings.filter(f => String(f.severity) === "INFO").map(toFinding),
      accountValue: row.account_value === null ? undefined : Number(row.account_value),
      plannedRiskAmount: row.planned_risk_amount === null ? undefined : Number(row.planned_risk_amount),
      positionSize: row.position_size === null ? undefined : Number(row.position_size),
      estimatedPositionValue:
        row.estimated_position_value === null ? undefined : Number(row.estimated_position_value),
      exposureBefore: row.exposure_before === null ? undefined : Number(row.exposure_before),
      exposureAfter: row.exposure_after === null ? undefined : Number(row.exposure_after),
      createdAt: String(row.created_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Proposals + approvals
  // ---------------------------------------------------------------------------

  saveProposal(proposal: TradeProposal): void {
    this.db()
      .query(
        "INSERT INTO market_trade_proposals (id, signal_id, analysis_id, risk_assessment_id, symbol, direction, order_type, quantity, requested_price, stop_price, target_price, execution_mode, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        proposal.id,
        proposal.signalId,
        proposal.analysisId ?? null,
        proposal.riskAssessmentId,
        proposal.symbol,
        proposal.direction,
        proposal.orderType,
        proposal.quantity,
        proposal.requestedPrice ?? null,
        proposal.stopPrice ?? null,
        proposal.targetPrice ?? null,
        proposal.executionMode,
        proposal.status,
        proposal.version,
        proposal.createdAt,
        proposal.updatedAt,
      );
  }

  private rowToProposal(row: Record<string, unknown>): TradeProposal {
    return {
      id: String(row.id),
      signalId: String(row.signal_id),
      analysisId: row.analysis_id === null ? undefined : String(row.analysis_id),
      riskAssessmentId: String(row.risk_assessment_id),
      symbol: String(row.symbol),
      direction: String(row.direction) as TradeProposal["direction"],
      orderType: String(row.order_type) as TradeProposal["orderType"],
      quantity: Number(row.quantity),
      requestedPrice: row.requested_price === null ? undefined : Number(row.requested_price),
      stopPrice: row.stop_price === null ? undefined : Number(row.stop_price),
      targetPrice: row.target_price === null ? undefined : Number(row.target_price),
      executionMode: "paper",
      status: String(row.status) as TradeProposal["status"],
      version: Number(row.version),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  getProposal(id: string): TradeProposal | null {
    const row = this.db().query("SELECT * FROM market_trade_proposals WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    return row ? this.rowToProposal(row) : null;
  }

  updateProposalStatus(id: string, status: TradeProposal["status"], expectedVersion: number): boolean {
    const result = this.db()
      .query(
        "UPDATE market_trade_proposals SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(status, this.ts(), id, expectedVersion);
    return Number(result.changes) === 1;
  }

  listProposals(status?: TradeProposal["status"]): TradeProposal[] {
    const rows = (
      status
        ? (this.db()
            .query("SELECT * FROM market_trade_proposals WHERE status = ? ORDER BY created_at DESC LIMIT 200")
            .all(status) as Array<Record<string, unknown>>)
        : (this.db()
            .query("SELECT * FROM market_trade_proposals ORDER BY created_at DESC LIMIT 200")
            .all() as Array<Record<string, unknown>>)
    ).map(row => this.rowToProposal(row));
    return rows;
  }

  saveApproval(approval: ApprovalRequest): void {
    this.db()
      .query(
        "INSERT INTO market_approval_requests (id, proposal_id, status, requested_at, expires_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, edited_fields_json, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approval.id,
        approval.proposalId,
        approval.status,
        approval.requestedAt,
        approval.expiresAt,
        approval.approvedBy ?? null,
        approval.approvedAt ?? null,
        approval.rejectedBy ?? null,
        approval.rejectedAt ?? null,
        approval.rejectionReason ?? null,
        approval.editedFields ? JSON.stringify(approval.editedFields) : null,
        approval.version,
        approval.requestedAt,
      );
  }

  private rowToApproval(row: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(row.id),
      proposalId: String(row.proposal_id),
      status: String(row.status) as ApprovalStatus,
      requestedAt: String(row.requested_at),
      expiresAt: String(row.expires_at),
      approvedBy: row.approved_by === null ? undefined : String(row.approved_by),
      approvedAt: row.approved_at === null ? undefined : String(row.approved_at),
      rejectedBy: row.rejected_by === null ? undefined : String(row.rejected_by),
      rejectedAt: row.rejected_at === null ? undefined : String(row.rejected_at),
      rejectionReason: row.rejection_reason === null ? undefined : String(row.rejection_reason),
      editedFields:
        row.edited_fields_json === null
          ? undefined
          : (JSON.parse(String(row.edited_fields_json)) as Record<string, unknown>),
      version: Number(row.version),
    };
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db().query("SELECT * FROM market_approval_requests WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    return row ? this.rowToApproval(row) : null;
  }

  getApprovalByProposal(proposalId: string): ApprovalRequest | null {
    const row = this.db()
      .query("SELECT id FROM market_approval_requests WHERE proposal_id = ? ORDER BY requested_at DESC LIMIT 1")
      .get(proposalId) as { id: string } | undefined;
    return row ? this.getApproval(row.id) : null;
  }

  /**
   * Optimistic resolution. Reads the pending row, verifies version, then runs
   * one static UPDATE per outcome whose WHERE clause re-asserts pending status
   * and the expected version, so two racing resolvers cannot both win.
   */
  resolveApproval(
    id: string,
    to: Extract<ApprovalStatus, "approved" | "rejected" | "expired">,
    fields: { by?: string; at: string; reason?: string },
    expectedVersion: number,
  ): ApprovalRequest | null {
    const db = this.db();
    const existing = this.getApproval(id);
    if (!existing || existing.status !== "pending" || existing.version !== expectedVersion) return null;

    let changed = false;
    if (to === "approved") {
      const result = db
        .query(
          "UPDATE market_approval_requests SET status = ?, version = version + 1, updated_at = ?, approved_by = ?, approved_at = ? WHERE id = ? AND version = ?",
        )
        .run(to, fields.at, fields.by ?? null, fields.at, id, expectedVersion);
      changed = Number(result.changes) === 1;
    } else {
      const result = db
        .query(
          "UPDATE market_approval_requests SET status = ?, version = version + 1, updated_at = ?, rejected_by = ?, rejected_at = ?, rejection_reason = ? WHERE id = ? AND version = ?",
        )
        .run(to, fields.at, fields.by ?? null, fields.at, fields.reason ?? null, id, expectedVersion);
      changed = Number(result.changes) === 1;
    }
    return changed ? this.getApproval(id) : null;
  }

  listPendingApprovals(): ApprovalRequest[] {
    const rows = this.db()
      .query("SELECT * FROM market_approval_requests WHERE status = ? ORDER BY requested_at")
      .all("pending") as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToApproval(r));
  }

  // ---------------------------------------------------------------------------
  // Paper orders + results
  // ---------------------------------------------------------------------------

  savePaperOrder(input: {
    id: string;
    proposalId: string;
    paperOrderId: string;
    symbol: string;
    direction: string;
    orderType: string;
    quantity: number;
    requestedPrice?: number;
    filledPrice?: number;
    slippageBps: number;
    status: "filled" | "rejected";
    submittedAt: string;
    filledAt?: string;
  }): void {
    this.db()
      .query(
        "INSERT INTO market_paper_orders (id, proposal_id, paper_order_id, symbol, direction, order_type, quantity, requested_price, filled_price, slippage_bps, status, submitted_at, filled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id,
        input.proposalId,
        input.paperOrderId,
        input.symbol,
        input.direction,
        input.orderType,
        input.quantity,
        input.requestedPrice ?? null,
        input.filledPrice ?? null,
        input.slippageBps,
        input.status,
        input.submittedAt,
        input.filledAt ?? null,
      );
  }

  getPaperOrderByProposal(
    proposalId: string,
  ): (Omit<PaperPosition, "status"> & {
    status: "filled" | "rejected";
    slippageBps: number;
    requestedPrice?: number;
    orderType: string;
    closedAt?: string;
  }) | null {
    const row = this.db()
      .query("SELECT * FROM market_paper_orders WHERE proposal_id = ? ORDER BY submitted_at DESC LIMIT 1")
      .get(proposalId) as Record<string, unknown> | null;
    if (!row) return null;
    const closedAt = row.closed_at === null ? undefined : String(row.closed_at);
    return {
      orderId: String(row.paper_order_id),
      symbol: String(row.symbol),
      direction: String(row.direction) as PaperPosition["direction"],
      quantity: Number(row.quantity),
      entryPrice: Number(row.filled_price ?? 0),
      status: String(row.status) as "filled" | "rejected",
      openedAt: String(row.filled_at ?? row.submitted_at),
      closedAt,
      slippageBps: Number(row.slippage_bps),
      requestedPrice: row.requested_price === null ? undefined : Number(row.requested_price),
      orderType: String(row.order_type),
    };
  }

  listOpenPositions(): PaperPosition[] {
    const rows = this.db()
      .query("SELECT * FROM market_paper_orders WHERE status = ? AND closed_at IS NULL")
      .all("filled") as Array<Record<string, unknown>>;
    return rows.map(r => ({
      orderId: String(r.paper_order_id),
      symbol: String(r.symbol),
      direction: String(r.direction) as PaperPosition["direction"],
      quantity: Number(r.quantity),
      entryPrice: Number(r.filled_price ?? 0),
      openedAt: String(r.filled_at ?? r.submitted_at),
      status: "open" as const,
    }));
  }

  markPaperOrderClosed(paperOrderId: string, closedAt: string): void {
    this.db()
      .query("UPDATE market_paper_orders SET closed_at = ? WHERE paper_order_id = ?")
      .run(closedAt, paperOrderId);
  }

  saveTradeResult(result: TradeResult): void {
    this.db()
      .query(
        "INSERT INTO market_trade_results (id, paper_order_id, entry_price, exit_price, quantity, gross_pnl, fees, net_pnl, opened_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        result.id,
        result.orderId,
        result.entryPrice,
        result.exitPrice,
        result.quantity,
        result.grossPnl,
        result.fees,
        result.netPnl,
        result.openedAt,
        result.closedAt,
      );
  }

  realizedPnlSince(dateIso: string): number {
    const row = this.db()
      .query("SELECT COALESCE(SUM(net_pnl), 0) AS total FROM market_trade_results WHERE closed_at >= ?")
      .get(dateIso) as { total: number };
    return Number(row.total);
  }

  listTradeResults(limit = 200): TradeResult[] {
    const rows = this.db()
      .query("SELECT * FROM market_trade_results ORDER BY closed_at DESC LIMIT ?")
      .all(Math.min(limit, 1000)) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      orderId: String(r.paper_order_id),
      entryPrice: Number(r.entry_price),
      exitPrice: Number(r.exit_price),
      quantity: Number(r.quantity),
      grossPnl: Number(r.gross_pnl),
      fees: Number(r.fees),
      netPnl: Number(r.net_pnl),
      openedAt: String(r.opened_at),
      closedAt: String(r.closed_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Circuit breaker + daily risk
  // ---------------------------------------------------------------------------

  saveCircuitBreaker(record: CircuitBreakerRecord): void {
    this.db()
      .query(
        "INSERT INTO market_circuit_breaker_events (previous_state, new_state, trigger_code, reason, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "UNKNOWN",
        record.state,
        record.triggerCode ?? null,
        record.reason ?? null,
        record.actor.type,
        record.actor.id,
        record.changedAt,
      );
  }

  latestCircuitBreakerState(): CircuitBreakerRecord {
    const row = this.db()
      .query("SELECT * FROM market_circuit_breaker_events ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      return { state: "ACTIVE", changedAt: this.ts(), actor: { type: "system", id: "market-boot" } };
    }
    return {
      state: String(row.new_state) as CircuitBreakerRecord["state"],
      triggerCode: row.trigger_code === null ? undefined : String(row.trigger_code),
      reason: row.reason === null ? undefined : String(row.reason),
      changedAt: String(row.created_at),
      actor: { type: String(row.actor_type) as ActorRef["type"], id: String(row.actor_id) },
    };
  }

  getDailyRisk(date: string): DailyRiskState | null {
    const row = this.db().query("SELECT * FROM market_daily_risk WHERE date = ?").get(date) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return {
      date: String(row.date),
      openingEquity: row.opening_equity === null ? undefined : Number(row.opening_equity),
      realizedPnl: Number(row.realized_pnl),
      lossPercent: row.loss_percent === null ? undefined : Number(row.loss_percent),
      circuitBreakerTriggered: Number(row.circuit_breaker_triggered) === 1,
    };
  }

  upsertDailyRisk(state: DailyRiskState): void {
    this.db()
      .query(
        "INSERT INTO market_daily_risk (date, opening_equity, realized_pnl, loss_percent, circuit_breaker_triggered) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET opening_equity = excluded.opening_equity, realized_pnl = excluded.realized_pnl, loss_percent = excluded.loss_percent, circuit_breaker_triggered = excluded.circuit_breaker_triggered",
      )
      .run(
        state.date,
        state.openingEquity ?? null,
        state.realizedPnl,
        state.lossPercent ?? null,
        state.circuitBreakerTriggered ? 1 : 0,
      );
  }

  // ---------------------------------------------------------------------------
  // Audit + notifications
  // ---------------------------------------------------------------------------

  appendAudit(record: AuditRecord): void {
    this.db()
      .query(
        "INSERT INTO market_audit_logs (correlation_id, event_type, actor_type, actor_id, resource_type, resource_id, action, result, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.correlationId,
        record.eventType,
        record.actorType,
        record.actorId,
        record.resourceType,
        record.resourceId,
        record.action,
        record.result,
        JSON.stringify(record.metadata),
        record.createdAt,
      );
  }

  listAudit(
    options: { correlationId?: string; resourceType?: string; resourceId?: string; limit?: number } = {},
  ): AuditRecord[] {
    // Bounded over-fetch + in-memory filtering keeps the query string static.
    const limit = Math.min(options.limit ?? 200, 1000);
    const rows = this.db()
      .query("SELECT * FROM market_audit_logs ORDER BY id DESC LIMIT ?")
      .all(2000) as Array<Record<string, unknown>>;
    return rows
      .map(r => ({
        id: String(r.id),
        correlationId: String(r.correlation_id),
        eventType: String(r.event_type),
        actorType: String(r.actor_type) as AuditRecord["actorType"],
        actorId: String(r.actor_id),
        resourceType: String(r.resource_type),
        resourceId: String(r.resource_id),
        action: String(r.action),
        result: String(r.result) as AuditRecord["result"],
        metadata: JSON.parse(String(r.metadata_json)) as Record<string, unknown>,
        createdAt: String(r.created_at),
      }))
      .filter(r => (options.correlationId ? r.correlationId === options.correlationId : true))
      .filter(r => (options.resourceType ? r.resourceType === options.resourceType : true))
      .filter(r => (options.resourceId ? r.resourceId === options.resourceId : true))
      .slice(0, limit);
  }

  appendNotification(notification: MarketNotification): void {
    this.db()
      .query(
        "INSERT INTO market_notifications (id, event_type, severity, title, body, correlation_id, resource_type, resource_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        notification.id,
        notification.eventType,
        notification.severity,
        notification.title,
        notification.body,
        notification.correlationId ?? null,
        notification.resourceType ?? null,
        notification.resourceId ?? null,
        notification.createdAt,
      );
  }

  listNotifications(limit = 100): MarketNotification[] {
    const rows = this.db()
      .query("SELECT * FROM market_notifications ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(limit, 500)) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: String(r.id),
      eventType: String(r.event_type) as MarketNotification["eventType"],
      severity: String(r.severity) as MarketNotification["severity"],
      title: String(r.title),
      body: String(r.body),
      correlationId: r.correlation_id === null ? undefined : String(r.correlation_id),
      resourceType: r.resource_type === null ? undefined : String(r.resource_type),
      resourceId: r.resource_id === null ? undefined : String(r.resource_id),
      createdAt: String(r.created_at),
    }));
  }
}
