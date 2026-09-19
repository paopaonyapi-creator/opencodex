import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { getMcpToolGateway } from "../mcp-gateway/gateway";
import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import { defaultAdapters, type FabricAdapter } from "./adapters";
import { maxRisk, riskRank, schemaHash } from "./classify";
import { MCP_FABRIC_FLAGS, mcpFabricEnabled, mcpFabricMockForced } from "./flags";
import { normalizeSource } from "./normalize";
import { scanPromptInjection, shapeResponse } from "./privacy";
import { assertSafeSelect } from "./sql-guard";
import type {
  ConnectorKind,
  ConnectorLifecycle,
  ConnectorRecord,
  CouncilDecision,
  PublicationProfile,
  RiskLevel,
  ToolRecord,
} from "./types";
import { McpFabricError, PUBLICATION_PROFILES, looksLikeSecretPayload, redactSecrets } from "./types";

function now(): string { return new Date().toISOString(); }
function newId(prefix: string): string { return prefix + randomUUID().replace(/-/g, "").slice(0, 12); }

const rate = new Map<string, { n: number; ts: number }>();
const circuit = new Map<string, { fails: number; openUntil: number }>();

export class McpFabricService {
  constructor(private readonly adapters: FabricAdapter[] = defaultAdapters()) {}

  async health(): Promise<Record<string, unknown>> {
    const adapters = [];
    for (const a of this.adapters) adapters.push(await a.probe());
    return {
      ok: mcpFabricEnabled(),
      phase: "20.96",
      flags: {
        autoPublish: MCP_FABRIC_FLAGS.autoPublishEnabled(),
        writes: MCP_FABRIC_FLAGS.writeActionsEnabled(),
        destructive: MCP_FABRIC_FLAGS.destructiveActionsEnabled(),
        failClosed: MCP_FABRIC_FLAGS.sensitiveFailClosed(),
        skillAutoApply: MCP_FABRIC_FLAGS.learnedSkillAutoApply(),
        kgAutoApprove: MCP_FABRIC_FLAGS.knowledgeAutoApprove(),
      },
      adapters,
    };
  }

  async doctor(): Promise<Record<string, unknown>> {
    const health = await this.health();
    return {
      ...health,
      notes: [
        "AnythingMCP is an isolated connector engine; GPL/EE source is not vendored.",
        "Set PAO_ANYTHINGMCP_URL when the local/container bridge is running.",
        "New connectors never auto-publish. R4 requires human approval. DB connectors are SELECT-only.",
      ],
    };
  }

  importConnector(input: { kind: ConnectorKind; name: string; raw: string; environment?: string; credentialRef?: string; actor?: string }): { connector: ConnectorRecord; tools: ToolRecord[] } {
    this.assertEnabled();
    if (looksLikeSecretPayload(input) || /api[_-]?key\s*[:=]|Bearer /i.test(input.raw)) {
      throw new McpFabricError("SECRET_IN_REQUEST", 400, "raw credentials must not appear in import payloads; use secret:// refs");
    }
    if (input.credentialRef && !input.credentialRef.startsWith("secret://")) {
      throw new McpFabricError("SECRET_IN_REQUEST", 400, "credential binding must be a secret:// reference");
    }
    this.assertNoSsrf(input.raw);
    const tools = normalizeSource({ kind: input.kind, name: input.name, raw: input.raw, credentialRef: input.credentialRef });
    const id = newId("con");
    const ts = now();
    const sourceHash = createHash("sha256").update(input.raw).digest("hex");
    const riskMax = tools.reduce((acc, t) => maxRisk(acc, t.risk), "R0" as RiskLevel);
    let lifecycle: ConnectorLifecycle = "IMPORTED";
    openAgentOsDb().run(
      "INSERT INTO amf_connectors (id, name, kind, environment, lifecycle, health, source_hash, source_kind, source_excerpt, credential_ref, risk_max, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?, ?, ?)",
      [id, input.name, input.kind, input.environment ?? "dev", lifecycle, sourceHash, input.kind, redactSecrets(input.raw).slice(0, 400), input.credentialRef ?? null, riskMax, ts, ts],
    );
    this.event(id, null, "connector.imported", input.actor ?? "operator", { kind: input.kind, tools: tools.length });
    const stored: ToolRecord[] = [];
    for (const tool of tools) {
      stored.push(this.insertTool(id, tool, sourceHash));
    }
    lifecycle = "NORMALIZED";
    this.setLifecycle(id, lifecycle);
    this.securityScan(id, input.actor ?? "system");
    if (MCP_FABRIC_FLAGS.autoTestEnabled()) this.testConnector(id, input.actor ?? "system");
    this.setLifecycle(id, "POLICY_REVIEW");
    if (MCP_FABRIC_FLAGS.autoPublishEnabled()) {
      this.approveConnector(id, input.actor ?? "system", "auto-publish flag");
      this.publishConnector(id, "paohub-readonly", input.actor ?? "system");
    }
    return { connector: this.requireConnector(id), tools: this.listTools(id) };
  }

  securityScan(connectorId: string, actor: string): void {
    const tools = this.listTools(connectorId);
    for (const tool of tools) {
      if (looksLikeSecretPayload(tool)) throw new McpFabricError("SECRET_IN_REQUEST", 400, "tool metadata contained secrets");
    }
    this.setLifecycle(connectorId, "SECURITY_SCANNED");
    this.event(connectorId, null, "connector.security_scanned", actor, { tools: tools.length });
  }

  testConnector(connectorId: string, actor: string): void {
    const tools = this.listTools(connectorId);
    if (tools.length === 0) throw new McpFabricError("NOT_FOUND", 404, "no tools to test");
    this.setLifecycle(connectorId, "TESTED");
    this.event(connectorId, null, "connector.tested", actor, { tools: tools.length, mock: true });
  }

  reviewConnector(connectorId: string, decision: CouncilDecision, actor: string, reason: string): void {
    openAgentOsDb().run(
      "INSERT INTO amf_reviews (id, connector_id, tool_id, decision, actor, reason, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
      [newId("rev"), connectorId, decision, actor, reason, now()],
    );
    if (decision === "BLOCK") this.setLifecycle(connectorId, "DISABLED");
    else this.setLifecycle(connectorId, "POLICY_REVIEW");
    this.event(connectorId, null, "connector.reviewed", actor, { decision, reason });
  }

  approveConnector(connectorId: string, actor: string, reason: string): ConnectorRecord {
    const con = this.requireConnector(connectorId);
    if (!["TESTED", "POLICY_REVIEW", "SECURITY_SCANNED"].includes(con.lifecycle)) {
      throw new McpFabricError("POLICY_DENIED", 409, "connector is not ready for approval: " + con.lifecycle);
    }
    this.setLifecycle(connectorId, "APPROVED");
    this.event(connectorId, null, "connector.approved", actor, { reason });
    return this.requireConnector(connectorId);
  }

  publishConnector(connectorId: string, profile: PublicationProfile, actor: string): ConnectorRecord {
    const con = this.requireConnector(connectorId);
    if (con.lifecycle !== "APPROVED" && con.lifecycle !== "PUBLISHED") {
      throw new McpFabricError("POLICY_DENIED", 409, "publish requires APPROVED lifecycle");
    }
    const gate = PUBLICATION_PROFILES[profile];
    const gw = getMcpToolGateway();
    gw.registerServer({ id: "mcp_fabric_" + connectorId, name: "Pao MCP Fabric / " + con.name, transport: "stdio", trustScore: 80, status: "active" });
    for (const tool of this.listTools(connectorId)) {
      const allowed = riskRank(tool.risk) <= riskRank(gate.maxRisk) && (gate.writes || riskRank(tool.risk) < 3) && (gate.destructive || !tool.canonicalName.includes("delete"));
      openAgentOsDb().run("UPDATE amf_tools SET published = ?, enabled = ?, profile = ? WHERE id = ?", [allowed ? 1 : 0, allowed ? 1 : 0, profile, tool.id]);
      if (allowed) {
        gw.registerTool({
          name: tool.canonicalName,
          serverId: "mcp_fabric_" + connectorId,
          description: tool.description,
          riskTier: tool.risk,
          mutability: tool.risk === "R4" ? "destructive" : tool.risk === "R3" ? "idempotent_write" : "read_only",
          approvalRequired: riskRank(tool.risk) >= 3,
          enabled: true,
        });
      }
    }
    this.setLifecycle(connectorId, "PUBLISHED");
    this.setLifecycle(connectorId, "MONITORED");
    this.event(connectorId, null, "connector.published", actor, { profile });
    return this.requireConnector(connectorId);
  }

  disableConnector(connectorId: string, actor: string): ConnectorRecord {
    openAgentOsDb().run("UPDATE amf_tools SET enabled = 0, published = 0 WHERE connector_id = ?", [connectorId]);
    this.setLifecycle(connectorId, "DISABLED");
    this.event(connectorId, null, "connector.disabled", actor, {});
    return this.requireConnector(connectorId);
  }

  detectDrift(connectorId: string, nextRaw: string, actor: string): { breaking: boolean; previousHash: string; nextHash: string } {
    const con = this.requireConnector(connectorId);
    const nextHash = createHash("sha256").update(nextRaw).digest("hex");
    const breaking = nextHash !== con.sourceHash;
    openAgentOsDb().run(
      "INSERT INTO amf_drift (id, connector_id, previous_hash, next_hash, breaking, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [newId("dft"), connectorId, con.sourceHash, nextHash, breaking ? 1 : 0, now()],
    );
    if (breaking) {
      this.setLifecycle(connectorId, "FROZEN");
      this.setLifecycle(connectorId, "DEGRADED");
      openAgentOsDb().run("UPDATE amf_tools SET frozen = 1 WHERE connector_id = ?", [connectorId]);
      this.event(connectorId, null, "connector.drift_breaking", actor, { previous: con.sourceHash, next: nextHash });
    }
    return { breaking, previousHash: con.sourceHash, nextHash };
  }

  async execute(input: {
    toolId?: string;
    canonicalName?: string;
    args: Record<string, unknown>;
    actor: string;
    agentId?: string;
    profile?: PublicationProfile;
    approvalId?: string;
    fallbackToRaw?: boolean;
  }): Promise<Record<string, unknown>> {
    this.assertEnabled();
    if (looksLikeSecretPayload(input.args)) throw new McpFabricError("SECRET_IN_REQUEST", 400, "arguments must not contain raw secrets");
    const tool = input.toolId ? this.requireTool(input.toolId) : this.requireToolByName(String(input.canonicalName));
    const con = this.requireConnector(tool.connectorId);
    if (con.lifecycle === "DISABLED") throw new McpFabricError("POLICY_DENIED", 403, "connector disabled");
    if (con.lifecycle === "FROZEN" || tool.frozen) throw new McpFabricError("FROZEN", 409, "tool frozen due to schema drift");
    if (!tool.published || !tool.enabled) throw new McpFabricError("UNPUBLISHED", 403, "tool is not published to this profile");
    const profile = input.profile ?? "paohub-readonly";
    const gate = PUBLICATION_PROFILES[profile];
    if (riskRank(tool.risk) > riskRank(gate.maxRisk)) throw new McpFabricError("POLICY_DENIED", 403, "profile " + profile + " forbids " + tool.risk);
    this.rateLimit(input.actor + ":" + tool.id);
    this.assertCircuit(tool.connectorId);
    this.assertNoSsrf(JSON.stringify(input.args));
    if (typeof input.args.sql === "string") assertSafeSelect(input.args.sql);

    if (riskRank(tool.risk) >= 3 && !input.approvalId) {
      if (tool.risk !== "R4" && !MCP_FABRIC_FLAGS.writeActionsEnabled()) {
        throw new McpFabricError("WRITE_DISABLED", 403, "write actions are disabled (TOOL_WRITE_ACTIONS_ENABLED=false)");
      }
      if (tool.risk === "R4" && !MCP_FABRIC_FLAGS.destructiveActionsEnabled()) {
        const approval = this.createApproval(tool, input.args, input.actor, input.agentId);
        throw new McpFabricError("APPROVAL_REQUIRED", 403, "R4 requires explicit human approval", { approvalId: approval.id, risk: tool.risk });
      }
      const approval = this.createApproval(tool, input.args, input.actor, input.agentId);
      throw new McpFabricError("APPROVAL_REQUIRED", 403, "human approval required", { approvalId: approval.id, risk: tool.risk });
    }
    if (input.approvalId) this.consumeApproval(input.approvalId, tool.id);
    if (riskRank(tool.risk) >= 3) this.assertAuditWritable();

    const correlationId = newId("corr");
    const started = Date.now();
    const adapter = await this.pickAdapter();
    let payload: unknown;
    try {
      const result = await adapter.execute({ tool: tool.canonicalName, args: input.args });
      payload = result.payload;
      circuit.set(tool.connectorId, { fails: 0, openUntil: 0 });
    } catch (err) {
      this.tripCircuit(tool.connectorId);
      const execId = this.recordExecution(tool, input, correlationId, "failed", Date.now() - started, null, err instanceof Error ? err.message : String(err));
      throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "connector engine failed", { executionId: execId, correlationId });
    }
    const shaped = shapeResponse({ risk: tool.risk, payload, fallbackToRaw: input.fallbackToRaw });
    const text = JSON.stringify(shaped.visible);
    const injected = scanPromptInjection(text);
    const visible = injected
      ? { trust: "untrusted_external_content", warning: "prompt_injection_candidate", content: shaped.visible }
      : { trust: "untrusted_external_content", content: shaped.visible };
    const execId = this.recordExecution(tool, input, correlationId, "success", Date.now() - started, shaped.actions, null);
    this.maybeLearnSkill(tool, input.actor);
    this.maybeKnowledge(tool, shaped.visible, input.actor);
    return {
      ok: true,
      executionId: execId,
      correlationId,
      tool: tool.canonicalName,
      version: tool.version,
      risk: tool.risk,
      privacy: shaped.actions,
      result: visible,
    };
  }

  privacyPreview(toolId: string, payload: unknown): Record<string, unknown> {
    const tool = this.requireTool(toolId);
    const shaped = shapeResponse({ risk: tool.risk, payload, fallbackToRaw: false });
    return { rawWithheld: true, modelVisible: shaped.visible, actions: shaped.actions };
  }

  createApproval(tool: ToolRecord, args: Record<string, unknown>, actor: string, agentId?: string): { id: string } {
    const id = newId("apr");
    const redacted = JSON.parse(redactSecrets(JSON.stringify(args)));
    openAgentOsDb().run(
      "INSERT INTO amf_approvals (id, tool_id, connector_id, actor, agent_id, args_redacted_json, risk, side_effect, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)",
      [id, tool.id, tool.connectorId, actor, agentId ?? null, JSON.stringify(redacted), tool.risk, tool.canonicalName, now(), new Date(Date.now() + 30 * 60 * 1000).toISOString()],
    );
    this.event(tool.connectorId, tool.id, "approval.requested", actor, { approvalId: id, risk: tool.risk });
    return { id };
  }

  decideApproval(id: string, approve: boolean, actor: string, reason?: string): { id: string; status: string } {
    const row = openAgentOsDb().query("SELECT * FROM amf_approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "approval not found");
    if (String(row.status) !== "PENDING") throw new McpFabricError("POLICY_DENIED", 409, "approval already resolved");
    const status = approve ? "APPROVED" : "DENIED";
    openAgentOsDb().run("UPDATE amf_approvals SET status = ?, approver = ?, reason = ?, decided_at = ? WHERE id = ?", [status, actor, reason ?? null, now(), id]);
    return { id, status };
  }

  listApprovals(): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM amf_approvals ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  }

  listConnectors(): ConnectorRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM amf_connectors ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToConnector(row));
  }

  listTools(connectorId?: string): ToolRecord[] {
    const rows = (connectorId
      ? openAgentOsDb().query("SELECT * FROM amf_tools WHERE connector_id = ?").all(connectorId)
      : openAgentOsDb().query("SELECT * FROM amf_tools").all()) as Array<Record<string, unknown>>;
    return rows.map(rowToTool);
  }

  listKnowledge(): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM amf_kg_candidates ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  }

  decideKnowledge(id: string, approve: boolean, actor: string): void {
    if (MCP_FABRIC_FLAGS.knowledgeAutoApprove()) approve = true;
    openAgentOsDb().run("UPDATE amf_kg_candidates SET status = ?, reviewer = ?, decided_at = ? WHERE id = ?", [approve ? "approved" : "rejected", actor, now(), id]);
  }

  listSkills(): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM amf_skill_candidates ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  }

  promoteSkill(id: string, actor: string): Record<string, unknown> {
    if (MCP_FABRIC_FLAGS.learnedSkillAutoApply()) {
      throw new McpFabricError("POLICY_DENIED", 403, "LEARNED_SKILL_AUTO_APPLY is forbidden in this control plane; SkillsGate promotion is explicit");
    }
    const row = openAgentOsDb().query("SELECT * FROM amf_skill_candidates WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "skill candidate not found");
    openAgentOsDb().run("UPDATE amf_skill_candidates SET status = 'promoted', reviewer = ?, decided_at = ? WHERE id = ?", [actor, now(), id]);
    return { ok: true, status: "promoted", skillGate: "pending-human", id };
  }

  metrics(): Record<string, unknown> {
    const db = openAgentOsDb();
    const connectors = (db.query("SELECT COUNT(*) AS n FROM amf_connectors").get() as { n: number }).n;
    const tools = (db.query("SELECT COUNT(*) AS n FROM amf_tools").get() as { n: number }).n;
    const execs = (db.query("SELECT COUNT(*) AS n FROM amf_executions").get() as { n: number }).n;
    const denials = (db.query("SELECT COUNT(*) AS n FROM amf_executions WHERE status = 'denied'").get() as { n: number }).n;
    const approvals = (db.query("SELECT COUNT(*) AS n FROM amf_approvals WHERE status = 'PENDING'").get() as { n: number }).n;
    return { connectors, tools, executions: execs, denials, pendingApprovals: approvals };
  }

  requireConnector(id: string): ConnectorRecord {
    const row = openAgentOsDb().query("SELECT * FROM amf_connectors WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "connector not found");
    return this.rowToConnector(row);
  }

  requireTool(id: string): ToolRecord {
    const row = openAgentOsDb().query("SELECT * FROM amf_tools WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "tool not found");
    return rowToTool(row);
  }

  requireToolByName(name: string): ToolRecord {
    const row = openAgentOsDb().query("SELECT * FROM amf_tools WHERE canonical_name = ? ORDER BY version DESC").get(name) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "tool not found: " + name);
    return rowToTool(row);
  }

  private insertTool(connectorId: string, tool: import("./types").NormalizedTool, sourceHash: string): ToolRecord {
    const id = newId("tol");
    const hash = schemaHash([tool.canonicalName, tool.inputSchema, tool.outputSchema, tool.risk]);
    const ts = now();
    openAgentOsDb().run(
      "INSERT INTO amf_tools (id, connector_id, canonical_name, upstream_name, description, method, path, input_schema_json, output_schema_json, risk, side_effect, data_classes_json, destructive_hint, enabled, published, frozen, version, schema_hash, source_hash, credential_ref, health, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, ?, ?, 'unknown', NULL, ?, ?)",
      [id, connectorId, tool.canonicalName, tool.upstreamName, tool.description, tool.method ?? null, tool.path ?? null, JSON.stringify(tool.inputSchema), JSON.stringify(tool.outputSchema), tool.risk, tool.sideEffect, JSON.stringify(tool.dataClasses), tool.destructiveHint ? 1 : 0, hash, sourceHash, tool.credentialRef ?? null, ts, ts],
    );
    openAgentOsDb().run(
      "INSERT INTO amf_tool_versions (id, tool_id, version, schema_hash, policy_hash, created_at) VALUES (?, ?, 1, ?, ?, ?)",
      [newId("ver"), id, hash, schemaHash([tool.risk, tool.sideEffect]), ts],
    );
    return this.requireTool(id);
  }

  private setLifecycle(id: string, lifecycle: ConnectorLifecycle): void {
    openAgentOsDb().run("UPDATE amf_connectors SET lifecycle = ?, updated_at = ? WHERE id = ?", [lifecycle, now(), id]);
  }

  private event(connectorId: string | null, toolId: string | null, type: string, actor: string, payload: unknown): void {
    openAgentOsDb().run(
      "INSERT INTO amf_events (id, connector_id, tool_id, event_type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newId("evt"), connectorId, toolId, type, actor, redactSecrets(JSON.stringify(payload ?? {})), now()],
    );
  }

  private recordExecution(tool: ToolRecord, input: { args: Record<string, unknown>; actor: string; agentId?: string }, correlationId: string, status: string, durationMs: number, privacy: unknown, error: string | null): string {
    const id = newId("exc");
    openAgentOsDb().run(
      "INSERT INTO amf_executions (id, tool_id, connector_id, actor, agent_id, correlation_id, status, risk, duration_ms, args_redacted_json, privacy_json, error_redacted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, tool.id, tool.connectorId, input.actor, input.agentId ?? null, correlationId, status, tool.risk, durationMs, redactSecrets(JSON.stringify(input.args)), JSON.stringify(privacy ?? []), error ? redactSecrets(error) : null, now()],
    );
    return id;
  }

  private consumeApproval(id: string, toolId: string): void {
    const row = openAgentOsDb().query("SELECT * FROM amf_approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new McpFabricError("NOT_FOUND", 404, "approval not found");
    if (String(row.status) !== "APPROVED") throw new McpFabricError("APPROVAL_REQUIRED", 403, "approval is not APPROVED");
    if (String(row.tool_id) !== toolId) throw new McpFabricError("POLICY_DENIED", 403, "approval does not match tool");
    if (row.expires_at && String(row.expires_at) < now()) throw new McpFabricError("APPROVAL_REQUIRED", 403, "approval expired");
  }

  private assertEnabled(): void {
    if (!mcpFabricEnabled()) throw new McpFabricError("DISABLED", 403, "Phase 20.96 MCP fabric disabled");
  }

  private assertNoSsrf(blob: string): void {
    const urls = blob.match(/https?:\/\/[^\s"']+/g) ?? [];
    for (const url of urls) {
      try { validateAndNormalizeUrl(url); }
      catch (err) { throw new McpFabricError("SSRF", 400, err instanceof Error ? err.message : "ssrf blocked"); }
    }
  }

  private assertAuditWritable(): void {
    try { openAgentOsDb().query("SELECT 1").get(); }
    catch { throw new McpFabricError("AUDIT_UNAVAILABLE", 503, "audit store unavailable; R3/R4 denied"); }
  }

  private rateLimit(key: string): void {
    const rec = rate.get(key) ?? { n: 0, ts: Date.now() };
    if (Date.now() - rec.ts > 10_000) { rec.n = 0; rec.ts = Date.now(); }
    rec.n++;
    rate.set(key, rec);
    if (rec.n > 40) throw new McpFabricError("RATE_LIMITED", 429, "rate limit exceeded");
  }

  private assertCircuit(connectorId: string): void {
    const rec = circuit.get(connectorId);
    if (rec && rec.openUntil > Date.now()) throw new McpFabricError("CIRCUIT_OPEN", 503, "connector circuit open");
  }

  private tripCircuit(connectorId: string): void {
    const rec = circuit.get(connectorId) ?? { fails: 0, openUntil: 0 };
    rec.fails++;
    if (rec.fails >= 5) rec.openUntil = Date.now() + 15_000;
    circuit.set(connectorId, rec);
  }

  private async pickAdapter(): Promise<FabricAdapter> {
    if (mcpFabricMockForced()) return this.adapters.find((a) => a.id === "mock")!;
    for (const a of this.adapters) {
      const h = await a.probe();
      if (h.status === "healthy" && a.id === "anythingmcp") return a;
    }
    const mock = this.adapters.find((a) => a.id === "mock");
    if (mock) return mock;
    throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "no connector engine available");
  }

  private maybeLearnSkill(tool: ToolRecord, actor: string): void {
    if (!MCP_FABRIC_FLAGS.skillCaptureEnabled()) return;
    const id = newId("skc");
    openAgentOsDb().run(
      "INSERT INTO amf_skill_candidates (id, title, workflow_json, status, actor, created_at) VALUES (?, ?, ?, 'candidate', ?, ?)",
      [id, "Observed " + tool.canonicalName, JSON.stringify({ tools: [tool.canonicalName] }), actor, now()],
    );
  }

  private maybeKnowledge(tool: ToolRecord, visible: unknown, actor: string): void {
    if (!MCP_FABRIC_FLAGS.kgImportEnabled()) return;
    const blob = JSON.stringify(visible);
    if (/email|token|password|card/i.test(blob) && /@|sk-/.test(blob)) return;
    const id = newId("kgc");
    openAgentOsDb().run(
      "INSERT INTO amf_kg_candidates (id, connector_id, tool_id, relation, confidence, status, created_at) VALUES (?, ?, ?, ?, 0.4, 'candidate', ?)",
      [id, tool.connectorId, tool.id, tool.canonicalName + " observes entity", now()],
    );
    void actor;
  }

  private rowToConnector(row: Record<string, unknown>): ConnectorRecord {
    const toolCount = (openAgentOsDb().query("SELECT COUNT(*) AS n FROM amf_tools WHERE connector_id = ?").get(String(row.id)) as { n: number }).n;
    return {
      id: String(row.id),
      name: String(row.name),
      kind: String(row.kind) as ConnectorKind,
      environment: String(row.environment),
      lifecycle: String(row.lifecycle) as ConnectorLifecycle,
      health: String(row.health),
      sourceHash: String(row.source_hash),
      toolCount,
      riskMax: String(row.risk_max) as RiskLevel,
      credentialRef: row.credential_ref ? String(row.credential_ref) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

function rowToTool(row: Record<string, unknown>): ToolRecord {
  return {
    id: String(row.id),
    connectorId: String(row.connector_id),
    canonicalName: String(row.canonical_name),
    upstreamName: String(row.upstream_name),
    description: String(row.description),
    risk: String(row.risk) as RiskLevel,
    sideEffect: row.side_effect as ToolRecord["sideEffect"],
    dataClasses: JSON.parse(String(row.data_classes_json || "[]")),
    enabled: Boolean(row.enabled),
    published: Boolean(row.published),
    version: Number(row.version),
    schemaHash: String(row.schema_hash),
    health: String(row.health),
    credentialRef: row.credential_ref ? String(row.credential_ref) : null,
    frozen: Boolean(row.frozen),
  };
}

let singleton: McpFabricService | null = null;
export function getMcpFabricService(): McpFabricService {
  if (!singleton) singleton = new McpFabricService();
  return singleton;
}
export function resetMcpFabricServiceForTests(): void { singleton = null; }
