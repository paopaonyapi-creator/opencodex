// Phase 20.60 — Social Publishing orchestrator (spec §2, §15).
//
// Two-level model: Pao-hubPro records scheduling intent, policy, approval and
// an idempotent delivery job; OpenPost (external service) owns the durable
// provider-facing queue. Once OpenPost accepts an operation Pao never
// resubmits it — reconciliation owns the outcome from there.
//
// The service is an optional subsystem: it is instantiated lazily by the
// management routes / MCP tools, never imported from the core request path,
// and its background worker registers teardown through the core-owned
// optional-shutdown-hooks registry.

import { createHash, randomUUID } from "node:crypto";
import { getSocialPublishingConfig, type SocialPublishingConfig } from "./config";
import { resolveOpenPostToken, redactSecrets } from "./secrets";
import { newId, nowIso, SocialPublishingStore } from "./store";
import { registerOptionalShutdownHook } from "../../lib/optional-shutdown-hooks";
import {
  SocialPublishingHttpError,
  type ActorType,
  type AnalyticsSnapshot,
  type ApprovalDecision,
  type ApprovalRecord,
  type ApprovalScope,
  type CreatePublicationInput,
  type DeliveryJob,
  type GenerateRenditionsInput,
  type OpenPostInstanceConfig,
  type Publication,
  type PublicationStatus,
  type Rendition,
  type ScheduleInput,
  type SocialAccount,
} from "./types";
import { OpenPostClient, OpenPostRequestError, type RemotePublication } from "./openpost/client";
import { createFetchTransport, type OpenPostTransport } from "./openpost/transport";
import { classifyOpenPostError } from "./openpost/errors";
import { mapAccountCapabilities, mapAnalyticsSummary, mapDeliveryState, mapValidationIssues, summarizeLifecycleEvents } from "./openpost/mapper";
import {
  aggregatePublicationStatus,
  mayResubmit,
  nextBackoffSeconds,
} from "./delivery";
import { computeContentHash, deliveryIdempotencyKey, materialState, scheduleWithinTolerance } from "./content-hash";
import { decideAccountEligibility, decideContentEligibility, decideMutationApproval, decideRenditionDispatchability, decideScheduleTime } from "./policy";
import { planRendition, renditionRowFromPlan, validateRendition } from "./renditions";
import { handoffAssetToOpenPost, inspectLocalAsset } from "./assets";
import { recordAgentEvent } from "../events";

export type TransportFactory = (instance: OpenPostInstanceConfig, token: string) => OpenPostTransport;

const CONTENT_PROFILE_DEFAULT = "default";

export class SocialPublishingService {
  readonly store: SocialPublishingStore;
  private readonly config: SocialPublishingConfig;
  private readonly transportFactory: TransportFactory;
  private workerTimer: ReturnType<typeof setInterval> | null = null;
  private lastAnalyticsSyncAt = 0;

  constructor(options?: { config?: SocialPublishingConfig; store?: SocialPublishingStore; transportFactory?: TransportFactory }) {
    this.config = options?.config ?? getSocialPublishingConfig();
    this.store = options?.store ?? new SocialPublishingStore();
    this.transportFactory = options?.transportFactory ?? ((instance, token) => createFetchTransport({
      baseUrl: instance.baseUrl,
      token,
      requestTimeoutMs: this.config.requestTimeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
    }));
  }

  // --- activation ---

  requireEnabled(): void {
    if (!this.config.enabled) {
      throw new SocialPublishingHttpError("SOCIAL_DISABLED", 409, "social publishing is disabled (PAO_SOCIAL_PUBLISHING_ENABLED != true)");
    }
  }

  /** Register the configured default instance on first use (idempotent). */
  ensureDefaultInstance(): OpenPostInstanceConfig | null {
    if (!this.config.defaultBaseUrl) return null;
    const existing = this.store.findInstanceByName(this.config.defaultInstanceId);
    if (existing) return existing;
    const instance: OpenPostInstanceConfig = {
      id: newId("spi"),
      name: this.config.defaultInstanceId,
      baseUrl: this.config.defaultBaseUrl,
      authMode: "bearer_token",
      secretRef: this.config.apiTokenSecretRef || "env:PAO_OPENPOST_API_TOKEN",
      mcpEndpoint: this.config.mcpUrl || null,
      mcpScope: this.config.mcpUrl ? "mcp:read" : null,
      transport: this.config.transport,
      status: "unknown",
      version: null,
      lastHealthAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertInstance(instance);
    this.audit("system", "system", "instance.registered", instance.id, { name: instance.name, transport: instance.transport });
    return instance;
  }

  // --- instance registry ---

  listInstances(): OpenPostInstanceConfig[] {
    return this.store.listInstances();
  }

  registerInstance(input: { name: string; baseUrl: string; secretRef?: string; mcpEndpoint?: string | null; mcpScope?: "mcp:read" | "mcp:full" | null; transport?: OpenPostInstanceConfig["transport"]; actorType?: ActorType; actorId?: string }): OpenPostInstanceConfig {
    this.requireEnabled();
    let baseUrl: URL;
    try {
      baseUrl = new URL(input.baseUrl);
    } catch {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 400, "baseUrl is not a valid absolute URL");
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 400, "baseUrl must use http or https");
    }
    if (this.store.findInstanceByName(input.name)) {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "an instance with this name already exists");
    }
    const instance: OpenPostInstanceConfig = {
      id: newId("spi"),
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      authMode: "bearer_token",
      secretRef: input.secretRef || "env:PAO_OPENPOST_API_TOKEN",
      mcpEndpoint: input.mcpEndpoint ?? null,
      mcpScope: input.mcpScope ?? (input.mcpEndpoint ? "mcp:read" : null),
      transport: input.transport ?? "hybrid",
      status: "unknown",
      version: null,
      lastHealthAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertInstance(instance);
    this.audit(input.actorType ?? "human", input.actorId ?? "operator", "instance.registered", instance.id, { name: instance.name });
    return instance;
  }

  async testInstance(instanceId: string): Promise<OpenPostInstanceConfig> {
    const instance = this.requireInstance(instanceId);
    try {
      const client = this.clientFor(instance);
      const health = await client.ready();
      const status = String(health["status"] ?? "").trim() ? "healthy" : "degraded";
      this.store.updateInstanceStatus(instance.id, { status, lastHealthAt: nowIso(), lastErrorCode: null, lastErrorMessage: null });
      this.audit("system", "system", "instance.health_ok", instance.id, {});
    } catch (error) {
      const mapped = this.describeError(error);
      this.store.updateInstanceStatus(instance.id, { status: mapped.status, lastHealthAt: nowIso(), lastErrorCode: mapped.code, lastErrorMessage: redactSecrets(mapped.message) });
      this.audit("system", "system", "instance.health_failed", instance.id, { code: mapped.code });
    }
    return this.requireInstance(instance.id);
  }

  async syncInstance(instanceId: string): Promise<{ instance: OpenPostInstanceConfig; accounts: SocialAccount[] }> {
    const instance = this.requireInstance(instanceId);
    const client = this.clientFor(instance);
    let workspaces: Array<{ id: string; name?: string }> = [];
    try {
      workspaces = await client.listWorkspaces();
    } catch {
      // Workspaces listing is optional context; account sync is the goal.
    }
    const [accounts, capabilities, readiness] = await Promise.all([
      client.listAccounts(),
      client.listCapabilities(),
      client.listProviderReadiness(),
    ]);
    const synced: SocialAccount[] = [];
    for (const remote of accounts) {
      const accountId = String(remote["account_id"] ?? remote["id"] ?? "");
      if (!accountId) continue;
      const platform = String(remote["platform"] ?? "unknown");
      const mapped = mapAccountCapabilities({ platform, isActive: remote["is_active"] as boolean | null | undefined, capabilities, readiness });
      const workspaceRef = remote["workspace_id"] ? String(remote["workspace_id"]) : workspaces[0]?.id ?? "";
      const existing = this.store.findAccountByRemoteRef(instance.id, accountId);
      const account: SocialAccount = {
        id: existing?.id ?? newId("spa"),
        instanceId: instance.id,
        openpostWorkspaceRef: workspaceRef,
        openpostAccountRef: accountId,
        platform,
        displayName: remote["account_avatar_url"] ? remote["account_username"] ?? platform : remote["account_username"] ?? null,
        username: remote["account_username"] ?? null,
        readinessState: mapped.readinessState,
        readinessReason: mapped.readinessReason,
        enabled: existing?.enabled ?? true,
        capabilities: mapped.capabilities,
        lastSyncAt: nowIso(),
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      synced.push(this.store.upsertAccount(account));
    }
    const status = accounts.length === 0 ? "degraded" : "healthy";
    this.store.updateInstanceStatus(instance.id, { status, lastHealthAt: nowIso(), lastErrorCode: null, lastErrorMessage: null });
    this.audit("system", "system", "accounts.synced", instance.id, { count: synced.length });
    return { instance: this.requireInstance(instance.id), accounts: synced };
  }

  deleteInstance(instanceId: string): void {
    this.requireInstance(instanceId);
    const deleted = this.store.deleteInstance(instanceId);
    if (!deleted) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "instance not found");
    this.audit("human", "operator", "instance.deleted", instanceId, {});
  }

  // --- accounts ---

  listAccounts(): SocialAccount[] {
    return this.store.listAccounts();
  }

  async refreshAccountCapabilities(accountId: string): Promise<SocialAccount> {
    const account = this.requireAccount(accountId);
    const instance = this.requireInstance(account.instanceId);
    const client = this.clientFor(instance);
    const [capabilities, readiness] = await Promise.all([client.listCapabilities(), client.listProviderReadiness()]);
    const mapped = mapAccountCapabilities({ platform: account.platform, isActive: true, capabilities, readiness });
    const updated: SocialAccount = {
      ...account,
      readinessState: mapped.readinessState,
      readinessReason: mapped.readinessReason,
      capabilities: mapped.capabilities,
      lastSyncAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertAccount(updated);
    this.audit("system", "system", "capabilities.refreshed", account.id, { platform: account.platform, readiness: mapped.readinessState });
    return this.requireAccount(account.id);
  }

  setAccountEnabled(accountId: string, enabled: boolean): SocialAccount {
    const account = this.requireAccount(accountId);
    this.store.setAccountEnabled(account.id, enabled);
    this.audit("human", "operator", enabled ? "account.enabled" : "account.disabled", account.id, {});
    return this.requireAccount(account.id);
  }

  // --- publications ---

  createPublication(input: CreatePublicationInput): Publication {
    this.requireEnabled();
    const publication: Publication = {
      id: newId("spp"),
      sourceType: input.sourceType,
      assetIds: input.assetIds ?? [],
      masterTitle: input.masterTitle ?? null,
      masterCaption: input.masterCaption ?? null,
      masterDescription: input.masterDescription ?? null,
      masterTags: input.masterTags ?? [],
      metadataJson: input.metadata ?? {},
      status: "draft",
      riskLevel: input.riskLevel ?? "normal",
      approvalMode: this.config.approvalMode,
      scheduledAt: input.scheduledAt ?? null,
      timezone: input.timezone ?? "UTC",
      createdByType: input.actorType ?? "human",
      createdById: input.actorId ?? "operator",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertPublication(publication);
    this.audit(publication.createdByType, publication.createdById, "publication.created", publication.id, {});
    return publication;
  }

  listPublications(filter?: { status?: string }): Publication[] {
    return this.store.listPublications(filter);
  }

  getPublication(publicationId: string): {
    publication: Publication;
    renditions: Rendition[];
    jobs: DeliveryJob[];
    approvals: ApprovalRecord[];
    assets: ReturnType<SocialPublishingStore["listPublicationAssets"]>;
    policyEvaluations: ReturnType<SocialPublishingStore["listPolicyEvaluations"]>;
  } {
    const publication = this.requirePublication(publicationId);
    return {
      publication,
      renditions: this.store.listRenditions(publication.id),
      jobs: this.store.listJobs({ publicationId: publication.id }),
      approvals: this.store.listApprovals(publication.id),
      assets: this.store.listPublicationAssets(publication.id),
      policyEvaluations: this.store.listPolicyEvaluations(publication.id),
    };
  }

  updatePublication(publicationId: string, patch: Partial<Pick<Publication, "masterTitle" | "masterCaption" | "masterDescription" | "masterTags" | "metadataJson" | "riskLevel" | "scheduledAt">>, actor?: { type: ActorType; id: string }): Publication {
    const publication = this.requirePublication(publicationId);
    if (["dispatching", "published", "partial_success"].includes(publication.status)) {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "publication already dispatched; edits are no longer possible");
    }
    this.store.updatePublication(publication.id, patch);
    // Material edits propagate into the planned renditions and invalidate
    // hash-bound approvals (spec §14.3).
    const freshPublication = this.requirePublication(publication.id);
    const assets = this.store.listPublicationAssets(publication.id);
    for (const rendition of this.store.listRenditions(publication.id)) {
      const account = this.store.getAccount(rendition.accountId);
      if (!account) continue;
      const plan = planRendition({
        publication: freshPublication,
        account: { id: account.id, platform: account.platform, openpostAccountRef: account.openpostAccountRef, capabilities: account.capabilities },
        format: rendition.format,
        assets,
      });
      const freshHash = computeContentHash(materialState({ ...rendition, ...plan }, account.openpostAccountRef));
      const latest = this.store.latestApprovalForHash(publication.id, freshHash);
      const stale = !latest || latest.decision !== "approved";
      this.store.updateRendition(rendition.id, {
        title: plan.title,
        caption: plan.caption,
        description: plan.description,
        hashtags: plan.hashtags,
        contentHash: freshHash,
        approvalStatus: stale && rendition.approvalStatus === "approved" ? "stale" : rendition.approvalStatus,
      });
    }
    const updated = this.requirePublication(publication.id);
    if (["approved", "approval_required", "scheduled"].includes(updated.status)) {
      const allApproved = this.store.listRenditions(publication.id).every((r) => r.approvalStatus === "approved");
      this.store.updatePublication(publication.id, { status: allApproved ? "approved" : "approval_required" });
    }
    this.audit(actor?.type ?? "human", actor?.id ?? "operator", "publication.updated", publication.id, {});
    return this.requirePublication(publication.id);
  }

  // --- renditions ---

  async generateRenditions(publicationId: string, input: GenerateRenditionsInput): Promise<Rendition[]> {
    const publication = this.requirePublication(publicationId);
    if (input.accounts.length === 0) {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 400, "no destination accounts selected");
    }
    // Ensure assets are handed off first so rendition hashes include media.
    await this.handoffPublicationAssets(publication);
    const assets = this.store.listPublicationAssets(publication.id);
    const created: Rendition[] = [];
    const now = nowIso();
    for (const accountId of input.accounts) {
      const account = this.store.getAccount(accountId);
      if (!account) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "account not found: " + accountId);
      const existing = this.store.listRenditions(publication.id).find((r) => r.accountId === account.id);
      const plan = planRendition({
        publication,
        account: { id: account.id, platform: account.platform, openpostAccountRef: account.openpostAccountRef, capabilities: account.capabilities },
        format: input.format,
        override: input.overrides?.[account.id],
        assets,
      });
      const row = renditionRowFromPlan({
        publicationId: publication.id,
        plan,
        accountOpenpostRef: account.openpostAccountRef,
        capabilitySnapshot: account.capabilities,
        capabilitySnapshotAt: account.lastSyncAt ?? now,
        renditionId: existing?.id ?? newId("spr"),
      });
      let stored = this.store.getRendition(row.id);
      if (existing && stored) {
        // A regenerated plan is a material edit: refresh fields + hash (which
        // invalidates any prior approval bound to the old hash).
        this.store.updateRendition(stored.id, {
          title: row.title,
          caption: row.caption,
          description: row.description,
          hashtags: row.hashtags,
          providerSettings: row.providerSettings,
          scheduledAt: row.scheduledAt,
          capabilitySnapshot: row.capabilitySnapshot,
          capabilitySnapshotAt: row.capabilitySnapshotAt,
          contentHash: row.contentHash,
        });
        stored = this.store.getRendition(stored.id)!;
      } else {
        stored = this.store.insertRendition(row);
      }
      const validation = validateRendition({ rendition: stored, capabilities: account.capabilities, priorIssues: [...plan.blocked, ...plan.warnings] });
      this.store.updateRendition(stored.id, {
        validationStatus: validation.status,
        validationIssues: validation.issues,
        deliveryStatus: stored.deliveryStatus === "draft" ? "draft" : stored.deliveryStatus,
      });
      created.push(this.store.getRendition(stored.id)!);
    }
    const fresh = this.requirePublication(publication.id);
    if (fresh.status === "draft" || fresh.status === "preparing") {
      this.store.updatePublication(publication.id, { status: "ready_for_review" });
    }
    this.audit(input.actorType ?? "human", input.actorId ?? "operator", "renditions.generated", publication.id, { count: created.length });
    return this.store.listRenditions(publication.id);
  }

  /** Re-run capability validation for every rendition; merges upstream validation when dispatched. */
  async validatePublication(publicationId: string): Promise<Array<{ rendition: Rendition; status: string; issues: unknown[] }>> {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    if (renditions.length === 0) throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "generate renditions before validating");
    const results: Array<{ rendition: Rendition; status: string; issues: unknown[] }> = [];
    const remoteRef = renditions.find((r) => r.openpostPublicationRef)?.openpostPublicationRef ?? null;
    let remoteIssues: ReturnType<typeof mapValidationIssues> = [];
    if (remoteRef) {
      const account = renditions.map((r) => this.store.getAccount(r.accountId)).find(Boolean);
      if (account) {
        try {
          const client = this.clientFor(this.requireInstance(account.instanceId));
          const remote = await client.validatePublication(remoteRef);
          remoteIssues = mapValidationIssues(remote.issues);
        } catch {
          // Upstream validation is advisory; local capability validation remains authoritative.
        }
      }
    }
    for (const rendition of renditions) {
      const account = this.store.getAccount(rendition.accountId);
      if (!account) continue;
      const validation = validateRendition({ rendition, capabilities: account.capabilities, priorIssues: remoteIssues });
      this.store.updateRendition(rendition.id, { validationStatus: validation.status, validationIssues: validation.issues });
      results.push({ rendition: this.store.getRendition(rendition.id)!, status: validation.status, issues: validation.issues });
    }
    this.audit("system", "system", "publication.validated", publication.id, {});
    return results;
  }

  // --- approval gate ---

  requestApproval(publicationId: string, actor?: { type: ActorType; id: string }): Publication {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    if (renditions.length === 0) throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "generate renditions before requesting approval");
    this.store.updatePublication(publication.id, { status: "approval_required" });
    this.audit(actor?.type ?? "agent", actor?.id ?? "agent", "approval.requested", publication.id, {});
    return this.requirePublication(publication.id);
  }

  approve(publicationId: string, input: { decision: ApprovalDecision; approverId: string; approverType?: ActorType; scope?: ApprovalScope; renditionId?: string | null; note?: string | null }): ApprovalRecord {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    if (renditions.length === 0) throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "nothing to approve: no renditions");
    const scope: ApprovalScope = input.scope ?? "publication_all_destinations";
    const targets = input.renditionId ? renditions.filter((r) => r.id === input.renditionId) : renditions;
    if (targets.length === 0) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "rendition not found for approval");
    // One record per rendition, each bound to that rendition's exact current
    // content hash — the executor validates per rendition (spec §8.7).
    const records: ApprovalRecord[] = targets.map((rendition) => ({
      id: newId("spap"),
      publicationId: publication.id,
      renditionId: rendition.id,
      decision: input.decision,
      approverType: input.approverType ?? "human",
      approverId: input.approverId,
      approvalScope: scope,
      contentHash: rendition.contentHash,
      note: input.note ?? null,
      createdAt: nowIso(),
    }));
    for (const record of records) this.store.insertApproval(record);
    if (input.decision === "approved") {
      for (const rendition of targets) {
        this.store.updateRendition(rendition.id, { approvalStatus: "approved" });
      }
      const allApproved = this.store.listRenditions(publication.id).every((r) => r.approvalStatus === "approved");
      this.store.updatePublication(publication.id, { status: allApproved ? "approved" : publication.status });
    } else {
      for (const rendition of targets) this.store.updateRendition(rendition.id, { approvalStatus: "rejected" });
      this.store.updatePublication(publication.id, { status: "rejected" });
    }
    this.audit(input.approverType ?? "human", input.approverId, input.decision === "approved" ? "approval.approved" : "approval.rejected", publication.id, { approvalRefs: records.map((r) => r.id), scope });
    return records[0];
  }

  listPendingApprovals(): Array<{ publication: Publication; renditions: Rendition[] }> {
    const pending = this.store.listPublications({ status: "approval_required" });
    return pending.map((publication) => ({ publication, renditions: this.store.listRenditions(publication.id) }));
  }

  /**
   * Verify server-side that every rendition holds a stored human approval for
   * its exact current content hash (spec §14.1, §37.9). Throws on failure.
   */
  private assertApprovalValid(publication: Publication, renditions: Rendition[], operation: "schedule" | "publish_now"): void {
    for (const rendition of renditions) {
      const latest = this.store.latestApprovalForHash(publication.id, rendition.contentHash);
      if (!latest || latest.decision !== "approved") {
        throw new SocialPublishingHttpError("SOCIAL_APPROVAL_REQUIRED", 403, `human approval is required before ${operation} (rendition ` + rendition.id + ")");
      }
      if (rendition.approvalStatus === "stale") {
        throw new SocialPublishingHttpError("SOCIAL_APPROVAL_STALE", 409, "content changed after approval; request re-approval");
      }
    }
  }

  // --- schedule / publish ---

  async schedulePublication(publicationId: string, input: ScheduleInput): Promise<DeliveryJob> {
    return this.enqueueDispatch(publicationId, "schedule_dispatch", input);
  }

  async publishNow(publicationId: string, actor?: { type: ActorType; id: string }): Promise<DeliveryJob> {
    return this.enqueueDispatch(publicationId, "publish_dispatch", actor);
  }

  private async enqueueDispatch(publicationId: string, jobType: "schedule_dispatch" | "publish_dispatch", extra?: ScheduleInput | { type: ActorType; id: string }): Promise<DeliveryJob> {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    if (renditions.length === 0) throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "no renditions to dispatch");
    if (jobType === "schedule_dispatch") {
      const scheduleInput = extra as ScheduleInput;
      const scheduleDecision = decideScheduleTime({ scheduledAt: scheduleInput.scheduledAt });
      if (scheduleDecision.effect === "deny") {
        const detail = scheduleDecision.ruleResults.find((r) => r.effect === "deny");
        throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 422, detail?.reason ?? "invalid schedule");
      }
      // The schedule time is part of the approved content (spec 14.3): a move
      // outside tolerance invalidates the hash-bound approval, so gate BEFORE
      // mutating anything. Within tolerance (or a first-time schedule on a
      // not-yet-approved publication) the hash stays stable.
      for (const rendition of renditions) {
        if (rendition.scheduledAt && !scheduleWithinTolerance(rendition.scheduledAt, scheduleInput.scheduledAt)) {
          throw new SocialPublishingHttpError("SOCIAL_APPROVAL_STALE", 409, "requested schedule differs from the approved schedule; request re-approval");
        }
      }
      this.store.updatePublication(publication.id, { scheduledAt: scheduleInput.scheduledAt });
      for (const rendition of renditions) {
        if (!rendition.scheduledAt) {
          this.store.updateRendition(rendition.id, {
            scheduledAt: scheduleInput.scheduledAt,
            contentHash: computeContentHash(materialState({ ...rendition, scheduledAt: scheduleInput.scheduledAt }, this.accountRefFor(rendition))),
          });
        }
      }
    }

    const freshPublication = this.requirePublication(publication.id);
    const freshRenditions = this.store.listRenditions(publication.id);

    // Policy: content + account eligibility + dispatchability + approval.
    const contentDecision = decideContentEligibility({ publication: freshPublication });
    if (contentDecision.effect === "deny") {
      throw new SocialPublishingHttpError("SOCIAL_POLICY_DENIED", 403, firstReason(contentDecision), { ruleResults: contentDecision.ruleResults });
    }
    for (const rendition of freshRenditions) {
      const account = this.requireAccount(rendition.accountId);
      const instance = this.requireInstance(account.instanceId);
      const accountDecision = decideAccountEligibility({ account, instance });
      if (accountDecision.effect === "deny") {
        throw new SocialPublishingHttpError("OPENPOST_ACCOUNT_NOT_READY", 409, firstReason(accountDecision), { ruleResults: accountDecision.ruleResults, accountId: account.id });
      }
      const dispatchability = decideRenditionDispatchability({ rendition });
      if (dispatchability.effect === "deny") {
        throw new SocialPublishingHttpError("SOCIAL_POLICY_DENIED", 403, firstReason(dispatchability), { ruleResults: dispatchability.ruleResults, renditionId: rendition.id });
      }
    }
    this.assertApprovalValid(freshPublication, freshRenditions, jobType === "schedule_dispatch" ? "schedule" : "publish_now");
    this.store.insertPolicyEvaluation({ publicationId: publication.id, renditionId: null, effect: "allow", ruleResults: contentDecision.ruleResults, evaluatedBy: "policy-engine" });

    const account = this.store.getAccount(freshRenditions[0].accountId);
    const instance = account ? this.requireInstance(account.instanceId) : null;
    const key = deliveryIdempotencyKey({
      workspaceScope: account?.openpostWorkspaceRef ?? "",
      publicationId: publication.id,
      renditionId: "all",
      contentHash: aggregateHash(freshRenditions),
      operationType: jobType === "schedule_dispatch" ? "schedule" : "publish_now",
      targetSchedule: jobType === "schedule_dispatch" ? (extra as ScheduleInput).scheduledAt : freshPublication.scheduledAt,
    });
    const existingJob = this.store.findJobByIdempotencyKey(key);
    if (existingJob) return existingJob;

    const job: DeliveryJob = {
      id: newId("spj"),
      publicationId: publication.id,
      renditionId: null,
      idempotencyKey: key,
      jobType,
      status: "pending",
      attemptCount: 0,
      maxAttempts: this.config.maxDeliveryAttempts,
      nextAttemptAt: nowIso(),
      lockedAt: null,
      lockedBy: null,
      lastErrorClass: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      remoteOperationRef: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertJob(job);
    this.store.updatePublication(publication.id, { status: jobType === "schedule_dispatch" ? "scheduled" : "dispatching" });
    this.audit((extra as { type?: ActorType })?.type ?? "human", (extra as { id?: string })?.id ?? "operator", jobType === "schedule_dispatch" ? "dispatch.scheduled" : "dispatch.publish_requested", publication.id, { jobId: job.id });
    // Execute inline so the caller observes the dispatch outcome; the worker
    // interval only owns retries and reconciliation.
    await this.processDueJobs(1);
    return this.store.getJob(job.id) ?? job;
  }

  async cancelPublication(publicationId: string, actor?: { type: ActorType; id: string }): Promise<{ publication: Publication; remote: boolean }> {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    const remoteRef = renditions.find((r) => r.openpostPublicationRef)?.openpostPublicationRef ?? null;
    if (remoteRef) {
      const account = renditions.map((r) => this.store.getAccount(r.accountId)).find(Boolean);
      const instance = account ? this.requireInstance(account.instanceId) : null;
      if (instance) {
        const client = this.clientFor(instance);
        const remote = await this.fetchRemotePublication(client, remoteRef);
        await client.cancelPublication(remoteRef, Number(remote["revision"] ?? 0));
      }
    }
    for (const rendition of renditions) {
      if (!["published", "failed_final"].includes(rendition.deliveryStatus)) {
        this.store.updateRendition(rendition.id, { deliveryStatus: "cancelled" });
      }
    }
    this.store.updatePublication(publication.id, { status: "cancelled" });
    this.audit(actor?.type ?? "human", actor?.id ?? "operator", "dispatch.cancelled", publication.id, { remote: Boolean(remoteRef) });
    return { publication: this.requirePublication(publication.id), remote: Boolean(remoteRef) };
  }

  // --- delivery executor ---

  /**
   * Claim and run due jobs. Executed inline after enqueue and on the worker
   * interval for retries/reconciliations. Idempotent by `idempotency_key`;
   * ambiguous outcomes park the job in `reconciliation_required` (spec §17.3).
   * Claiming is atomic (conditional UPDATE), so concurrent callers never
   * execute the same job twice.
   */
  async processDueJobs(limit = 5): Promise<number> {
    const jobs = this.store.claimDueJobs(limit, "sp-worker");
    for (const job of jobs) {
      await this.executeJob(job);
    }
    return jobs.length;
  }

  private async executeJob(job: DeliveryJob): Promise<void> {
    const publication = this.store.getPublication(job.publicationId);
    if (!publication) {
      this.store.updateJob(job.id, { status: "failed_final", lastErrorClass: "non_retryable", lastErrorCode: "SOCIAL_NOT_FOUND", lastErrorMessage: "publication deleted" });
      return;
    }
    const renditions = this.store.listRenditions(publication.id);
    try {
      const { remote, action } = await this.dispatchToOpenPost(publication, renditions, job);
      for (const rendition of renditions) {
        const remoteRendition = (remote["renditions"] as Array<Record<string, unknown>> | null | undefined)?.find(
          (r) => String(r["social_account_id"] ?? "") === this.accountRefFor(rendition),
        );
        this.store.updateRendition(rendition.id, {
          deliveryStatus: job.jobType === "schedule_dispatch" ? "scheduled" : "publishing",
          openpostPublicationRef: String(remote["id"] ?? rendition.openpostPublicationRef ?? ""),
          openpostRenditionRef: remoteRendition ? String(remoteRendition["id"] ?? "") : rendition.openpostRenditionRef,
        });
      }
      this.store.updateJob(job.id, { status: "completed", remoteOperationRef: String(remote["id"] ?? "") + ":" + action });
      this.refreshAggregateStatus(publication.id);
      this.audit("system", "system", job.jobType === "schedule_dispatch" ? "dispatch.scheduled_remote" : "dispatch.published_remote", publication.id, { remoteRef: String(remote["id"] ?? ""), action });
      const reconcileAfterDispatch = this.reconcilePublication(publication.id);
      await reconcileAfterDispatch;
    } catch (error) {
      const { errorClass, code } = classifyOpenPostError(error);
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      const attemptCount = job.attemptCount + 1;
      if (errorClass === "ambiguous") {
        for (const rendition of renditions) {
          if (rendition.deliveryStatus !== "published") this.store.updateRendition(rendition.id, { deliveryStatus: "reconciliation_required" });
        }
        this.store.updateJob(job.id, { status: "reconciliation_required", attemptCount, lastErrorClass: "ambiguous", lastErrorCode: code, lastErrorMessage: message });
        this.refreshAggregateStatus(publication.id);
        this.audit("system", "system", "dispatch.ambiguous", publication.id, { code });
        return;
      }
      if (errorClass === "retryable" && mayResubmit({ attemptCount, maxAttempts: job.maxAttempts, remoteOperationRef: job.remoteOperationRef, status: "failed_retryable" })) {
        const backoff = nextBackoffSeconds(attemptCount, job.maxAttempts);
        this.store.updateJob(job.id, {
          status: "failed_retryable",
          attemptCount,
          nextAttemptAt: new Date(Date.now() + backoff.delaySeconds * 1000).toISOString(),
          lastErrorClass: "retryable",
          lastErrorCode: code,
          lastErrorMessage: message,
        });
        this.audit("system", "system", "dispatch.retry_scheduled", publication.id, { attempt: attemptCount, code });
        return;
      }
      for (const rendition of renditions) {
        if (!["published", "cancelled"].includes(rendition.deliveryStatus)) {
          this.store.updateRendition(rendition.id, { deliveryStatus: "failed_final" });
        }
      }
      this.store.updateJob(job.id, { status: "failed_final", attemptCount, lastErrorClass: errorClass, lastErrorCode: code, lastErrorMessage: message });
      this.refreshAggregateStatus(publication.id);
      this.audit("system", "system", "dispatch.failed", publication.id, { code, final: true });
    }
  }

  /**
   * Ensure the remote publication exists (searching by the pao correlation id
   * first so an ambiguous create is never duplicated), then run the requested
   * upstream action.
   */
  private async dispatchToOpenPost(publication: Publication, renditions: Rendition[], job: DeliveryJob): Promise<{ remote: Record<string, unknown>; action: string }> {
    const account = this.store.getAccount(renditions[0].accountId);
    if (!account) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "rendition account missing");
    const instance = this.requireInstance(account.instanceId);
    const client = this.clientFor(instance);

    let remoteRef = renditions.find((r) => r.openpostPublicationRef)?.openpostPublicationRef ?? null;
    if (!remoteRef) {
      remoteRef = await this.findRemotePublicationRef(client, account.openpostWorkspaceRef, publication.id);
    }
    let remote: Record<string, unknown>;
    if (remoteRef) {
      remote = (await this.fetchRemotePublication(client, remoteRef)) as unknown as Record<string, unknown>;
    } else {
      const created = await client.createPublication(
        {
          workspace_id: account.openpostWorkspaceRef,
          title: publication.masterTitle?.trim() || "Pao publication " + publication.id,
          source_text: publication.masterCaption?.trim() || publication.masterDescription?.trim() || publication.masterTitle?.trim() || "",
          content_profile: CONTENT_PROFILE_DEFAULT,
          intent: renditions[0]?.format === "video" || renditions[0]?.format === "short_video" ? "video" : renditions[0]?.format === "thread" ? "thread" : "post",
          media: this.store.listPublicationAssets(publication.id).map((a) => a.openpostMediaRef).filter((ref): ref is string => Boolean(ref)),
          renditions: renditions.map((rendition) => ({
            social_account_id: this.accountRefFor(rendition),
            body: rendition.caption ?? "",
            title: rendition.title ?? undefined,
            description: rendition.description ?? undefined,
            settings: rendition.providerSettings,
          })),
          scheduled_at: job.jobType === "schedule_dispatch" ? (publication.scheduledAt ?? renditionSchedule(renditions)) : null,
          metadata: { pao_publication_id: publication.id, pao_workspace: "pao-hubpro" },
        },
        publication.id,
      );
      remote = created as unknown as Record<string, unknown>;
      remoteRef = String(created["id"] ?? "");
    }
    const revision = Number(remote["revision"] ?? 0);
    if (job.jobType === "schedule_dispatch") {
      await client.schedulePublication(remoteRef, revision);
      return { remote, action: "schedule" };
    }
    await client.publishNow(remoteRef, revision);
    return { remote, action: "publish_now" };
  }

  /** Correlated lookup so a lost create-response cannot produce a duplicate remote publication. */
  private async findRemotePublicationRef(client: OpenPostClient, workspaceRef: string, publicationId: string): Promise<string | null> {
    try {
      const candidates = await client.listPublications({ workspace_id: workspaceRef || undefined, limit: 50 });
      for (const candidate of candidates) {
        const metadata = candidate["metadata"] as Record<string, unknown> | null | undefined;
        if (metadata && metadata["pao_publication_id"] === publicationId) return String(candidate["id"] ?? "");
      }
    } catch {
      // Lookup failure must not block dispatch; dedupe still holds via local refs.
    }
    return null;
  }

  private async fetchRemotePublication(client: OpenPostClient, remoteRef: string): Promise<RemotePublication> {
    try {
      return await client.getPublication(remoteRef);
    } catch (error) {
      if (error instanceof OpenPostRequestError && error.mapped.code === "OPENPOST_REMOTE_NOT_FOUND") {
        throw error;
      }
      throw error;
    }
  }

  // --- reconciliation ---

  /** Sync delivery state for one publication from remote lifecycle events (spec §18). */
  async reconcilePublication(publicationId: string): Promise<Publication> {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    const remoteRef = renditions.find((r) => r.openpostPublicationRef)?.openpostPublicationRef ?? null;
    if (!remoteRef) return publication;
    const account = renditions.map((r) => this.store.getAccount(r.accountId)).find(Boolean);
    if (!account) return publication;
    const instance = this.requireInstance(account.instanceId);
    const client = this.clientFor(instance);
    let changed = false;
    try {
      const remote = await this.fetchRemotePublication(client, remoteRef);
      const events = await client.listPublicationEvents(remoteRef);
      const summary = summarizeLifecycleEvents(events);
      for (const rendition of renditions) {
        const remoteRenditions = (remote["renditions"] as Array<Record<string, unknown>> | null | undefined) ?? [];
        const match = remoteRenditions.find((r) => String(r["social_account_id"] ?? "") === this.accountRefFor(rendition));
        const delivery = (match?.["delivery"] ?? null) as Record<string, unknown> | null;
        const state = mapDeliveryState(
          String(delivery?.["state"] ?? match?.["status"] ?? ""),
          delivery ? String(delivery["recovery_action"] ?? "none") : undefined,
        );
        const nextStatus = state === "unknown" && summary.latest ? mapDeliveryState(String(summary.latest.status ?? "")) : state;
        if (nextStatus !== "unknown" && nextStatus !== rendition.deliveryStatus) {
          this.store.updateRendition(rendition.id, {
            deliveryStatus: nextStatus,
            openpostRenditionRef: match ? String(match["id"] ?? rendition.openpostRenditionRef ?? "") : rendition.openpostRenditionRef,
          });
          changed = true;
        }
      }
    } catch (error) {
      const { errorClass, code } = classifyOpenPostError(error);
      if (errorClass === "non_retryable") {
        this.audit("system", "system", "reconciliation.blocked", publication.id, { code });
        return this.requirePublication(publication.id);
      }
      return this.requirePublication(publication.id);
    }
    if (changed) {
      this.audit("system", "system", "reconciliation.synced", publication.id, {});
      recordAgentEvent({ kind: "social-publishing.reconciled", payload: { publicationId: publication.id } });
    }
    return this.refreshAggregateStatus(publication.id);
  }

  /** Reconcile every publication with non-terminal renditions (worker tick). */
  async reconcileActivePublications(): Promise<number> {
    const active = this.store
      .listPublications()
      .filter((p) => ["scheduled", "dispatching", "partial_success", "approved"].includes(p.status));
    let count = 0;
    for (const publication of active) {
      const renditions = this.store.listRenditions(publication.id);
      if (renditions.some((r) => r.openpostPublicationRef || r.deliveryStatus === "reconciliation_required")) {
        await this.reconcilePublication(publication.id);
        count += 1;
      }
    }
    return count;
  }

  private refreshAggregateStatus(publicationId: string): Publication {
    const publication = this.requirePublication(publicationId);
    const renditions = this.store.listRenditions(publication.id);
    const aggregate = aggregatePublicationStatus(renditions, publication.status);
    if (aggregate !== publication.status) {
      this.store.updatePublication(publication.id, { status: aggregate });
    }
    return this.requirePublication(publicationId);
  }

  // --- analytics ---

  async syncAnalytics(): Promise<number> {
    let synced = 0;
    for (const account of this.store.listAccounts()) {
      const instance = this.requireInstance(account.instanceId);
      const client = this.clientFor(instance);
      try {
        const overview = await client.analytics(account.openpostWorkspaceRef || undefined);
        const mapped = mapAnalyticsSummary(overview as { summary?: Record<string, unknown> });
        const snapshot: AnalyticsSnapshot = {
          id: newId("spn"),
          publicationId: null,
          renditionId: null,
          accountId: account.id,
          capturedAt: nowIso(),
          views: mapped.views,
          impressions: mapped.impressions,
          reach: mapped.reach,
          engagements: mapped.engagements,
          likes: null,
          comments: null,
          shares: null,
          followersDelta: mapped.followersDelta,
          rawMetrics: overview as unknown as Record<string, unknown>,
        };
        this.store.insertAnalyticsSnapshot(snapshot);
        synced += 1;
      } catch {
        // Analytics availability varies by deployment; skip silently but keep the raw guard.
      }
    }
    if (synced > 0) this.audit("system", "system", "analytics.synced", "accounts", { synced });
    this.lastAnalyticsSyncAt = Date.now();
    return synced;
  }

  listAnalytics(filter?: { publicationId?: string; accountId?: string }): AnalyticsSnapshot[] {
    return this.store.listAnalyticsSnapshots(filter);
  }

  // --- jobs ---

  listJobs(filter?: { status?: string; publicationId?: string }): DeliveryJob[] {
    return this.store.listJobs(filter);
  }

  async retryJob(jobId: string): Promise<DeliveryJob> {
    const job = this.store.getJob(jobId);
    if (!job) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "job not found");
    if (!["failed_retryable", "failed_final", "reconciliation_required"].includes(job.status)) {
      throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "only failed or reconciliation jobs can be retried");
    }
    // Requeue instead of blind-resubmit: the executor resolves ambiguity via
    // the correlated remote lookup before any new mutation (spec 17.3).
    this.store.updateJob(job.id, { status: "pending", nextAttemptAt: nowIso(), lastErrorMessage: null });
    this.audit("human", "operator", "job.retried", job.publicationId, { jobId: job.id });
    await this.processDueJobs(1);
    return this.store.getJob(jobId)!;
  }

  // --- worker ---

  /** Start the reconcile/dispatch worker (idempotent; registers shutdown teardown). */
  startWorker(): void {
    if (this.workerTimer || !this.config.enabled) return;
    const intervalMs = Math.max(10, this.config.reconcileIntervalSec) * 1000;
    this.workerTimer = setInterval(() => {
      void this.processDueJobs(5).catch(() => undefined);
      void this.reconcileActivePublications().catch(() => undefined);
      if (this.config.analyticsSyncEnabled && Date.now() - this.lastAnalyticsSyncAt > this.config.analyticsSyncIntervalMin * 60_000) {
        void this.syncAnalytics().catch(() => undefined);
      }
    }, intervalMs);
    const { registerOptionalShutdownHook } = require("../../lib/optional-shutdown-hooks") as typeof import("../../lib/optional-shutdown-hooks");
    registerOptionalShutdownHook("social-publishing-worker", () => this.stopWorker());
  }

  stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  // --- plumbing ---

  clientFor(instance: OpenPostInstanceConfig): OpenPostClient {
    const token = resolveOpenPostToken(instance.secretRef);
    if (!token) {
      throw new SocialPublishingHttpError("OPENPOST_AUTH_FAILED", 502, "no OpenPost token configured for instance " + instance.name + "; set the secret ref target first");
    }
    return new OpenPostClient({ transport: this.transportFactory(instance, token) });
  }

  private accountRefFor(rendition: Rendition): string {
    const account = this.store.getAccount(rendition.accountId);
    return account?.openpostAccountRef ?? rendition.accountId;
  }

  requireInstance(instanceId: string): OpenPostInstanceConfig {
    const instance = this.store.getInstance(instanceId) ?? this.store.findInstanceByName(instanceId);
    if (!instance) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "OpenPost instance not found");
    return instance;
  }

  requireAccount(accountId: string): SocialAccount {
    const account = this.store.getAccount(accountId);
    if (!account) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "social account not found");
    return account;
  }

  requirePublication(publicationId: string): Publication {
    const publication = this.store.getPublication(publicationId);
    if (!publication) throw new SocialPublishingHttpError("SOCIAL_NOT_FOUND", 404, "publication not found");
    return publication;
  }

  /** Hand every referenced local asset to OpenPost (deduped by SHA-256). */
  private async handoffPublicationAssets(publication: Publication): Promise<void> {
    for (const assetId of publication.assetIds) {
      const existing = this.store.listPublicationAssets(publication.id).find((a) => a.localAssetId === assetId);
      if (existing?.openpostMediaRef) continue;
      const inspected = await inspectLocalAsset(assetId);
      const renditions = this.store.listRenditions(publication.id);
      const account = renditions.length ? this.store.getAccount(renditions[0].accountId) : null;
      const instance = account ? this.requireInstance(account.instanceId) : this.ensureDefaultInstance();
      if (!instance) throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 409, "no OpenPost instance configured for asset handoff");
      const client = this.clientFor(instance);
      const result = await handoffAssetToOpenPost({
        client,
        workspaceRef: account?.openpostWorkspaceRef ?? "",
        publicationId: publication.id,
        inspected,
        existingShaRef: this.store.findAssetBySha(publication.id, inspected.sha256),
      });
      this.store.insertPublicationAsset(result.asset);
      this.store.setAssetRemoteRef(result.asset.id, result.asset.openpostMediaRef!);
      this.audit("system", "system", "asset.handed_off", publication.id, { assetId, deduped: result.deduped, sha256: inspected.sha256 });
    }
  }

  private describeError(error: unknown): { status: "healthy" | "degraded" | "unavailable"; code: string; message: string } {
    if (error instanceof OpenPostRequestError) {
      const code = error.mapped.code;
      if (code === "OPENPOST_AUTH_FAILED" || code === "OPENPOST_PERMISSION_DENIED") return { status: "degraded", code, message: error.mapped.message };
      return { status: "unavailable", code, message: error.mapped.message };
    }
    if (error instanceof SocialPublishingHttpError) {
      return { status: "unavailable", code: error.code, message: error.message };
    }
    return { status: "unavailable", code: "OPENPOST_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) };
  }

  private audit(actorType: ActorType, actorId: string, action: string, resourceId: string, metadata: Record<string, unknown>): void {
    this.store.appendAudit({ actorType, actorId, action, resourceType: action.startsWith("instance") || action.startsWith("account") ? "integration" : "publication", resourceId, metadata });
    recordAgentEvent({ kind: "social-publishing." + action, payload: { resourceId, ...metadata } });
  }
}

function firstReason(decision: { ruleResults: Array<{ effect: string; reason: string }> }): string {
  const denied = decision.ruleResults.find((r) => r.effect === "deny");
  return denied?.reason ?? "policy denied the operation";
}

function renditionSchedule(renditions: Rendition[]): string | null {
  return renditions.find((r) => r.scheduledAt)?.scheduledAt ?? null;
}

/** Deterministic aggregate hash across renditions (sorted so order is stable). */
export function aggregateHash(renditions: Array<Pick<Rendition, "contentHash" | "id">>): string {
  const combined = renditions.map((r) => r.id + ":" + r.contentHash).sort().join("|");
  return createHash("sha256").update(combined).digest("hex");
}

// --- singleton ---

let singleton: SocialPublishingService | null = null;

export function getSocialPublishingService(): SocialPublishingService {
  if (!singleton) {
    singleton = new SocialPublishingService();
    if (getSocialPublishingConfig().enabled) singleton.startWorker();
  }
  return singleton;
}

export function resetSocialPublishingServiceForTests(): void {
  if (singleton) singleton.stopWorker();
  singleton = null;
}

/** Route tests inject a service wired to a fake transport through this hook. */
export function setSocialPublishingServiceForTests(service: SocialPublishingService): void {
  if (singleton) singleton.stopWorker();
  singleton = service;
}
