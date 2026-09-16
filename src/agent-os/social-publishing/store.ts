// Phase 20.60 — Social Publishing store (sp_* tables).
//
// Same access style as the other agent-os stores: per-call prepared queries
// against the shared agent-os SQLite database, snake_case rows mapped to
// camelCase domain objects, JSON in *_json TEXT columns, TEXT ISO timestamps.
// Every statement is a short static SQL literal with bound parameters; there
// is no dynamic SQL construction and no SQL string concatenation anywhere.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  AccountCapabilities,
  ActorType,
  AnalyticsSnapshot,
  ApprovalDecision,
  ApprovalRecord,
  ApprovalScope,
  DeliveryJob,
  DeliveryJobStatus,
  DeliveryJobType,
  DeliveryStatus,
  OpenPostInstanceConfig,
  Publication,
  PublicationAsset,
  PublicationStatus,
  ReadinessState,
  Rendition,
  RiskLevel,
  SocialAccount,
  SocialAuditInput,
  ValidationIssue,
} from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

// --- row mappers ---

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

function numOrNull(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return Number(value);
}

function json<T>(row: Row, key: string, fallback: T): T {
  const raw = row[key];
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function fallbackCapabilities(): AccountCapabilities {
  return {
    textLimit: null,
    titleRequired: null,
    descriptionRequired: null,
    intents: [],
    mediaShapes: {},
    nativeScheduling: null,
    openpostQueued: null,
    requiresAppReview: null,
    requiresPublicMedia: null,
    unavailableReason: null,
    caveats: [],
    known: false,
    raw: {},
  };
}

function rowToInstance(row: Row): OpenPostInstanceConfig {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    baseUrl: str(row, "base_url"),
    authMode: str(row, "auth_mode") as OpenPostInstanceConfig["authMode"],
    secretRef: str(row, "secret_ref"),
    mcpEndpoint: strOrNull(row, "mcp_endpoint"),
    mcpScope: strOrNull(row, "mcp_scope") as OpenPostInstanceConfig["mcpScope"],
    transport: str(row, "transport") as OpenPostInstanceConfig["transport"],
    status: str(row, "status") as OpenPostInstanceConfig["status"],
    version: strOrNull(row, "version"),
    lastHealthAt: strOrNull(row, "last_health_at"),
    lastErrorCode: strOrNull(row, "last_error_code"),
    lastErrorMessage: strOrNull(row, "last_error_message"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToAccount(row: Row): SocialAccount {
  return {
    id: str(row, "id"),
    instanceId: str(row, "instance_id"),
    openpostWorkspaceRef: str(row, "openpost_workspace_ref"),
    openpostAccountRef: str(row, "openpost_account_ref"),
    platform: str(row, "platform"),
    displayName: strOrNull(row, "display_name"),
    username: strOrNull(row, "username"),
    readinessState: str(row, "readiness_state") as ReadinessState,
    readinessReason: strOrNull(row, "readiness_reason"),
    enabled: Number(row["enabled"] ?? 0) === 1,
    capabilities: json<AccountCapabilities>(row, "capability_json", fallbackCapabilities()),
    lastSyncAt: strOrNull(row, "last_sync_at"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToPublication(row: Row): Publication {
  return {
    id: str(row, "id"),
    sourceType: str(row, "source_type") as Publication["sourceType"],
    assetIds: json<string[]>(row, "asset_ids_json", []),
    masterTitle: strOrNull(row, "master_title"),
    masterCaption: strOrNull(row, "master_caption"),
    masterDescription: strOrNull(row, "master_description"),
    masterTags: json<string[]>(row, "master_tags_json", []),
    metadataJson: json<Record<string, unknown>>(row, "metadata_json", {}),
    status: str(row, "status") as PublicationStatus,
    riskLevel: str(row, "risk_level") as RiskLevel,
    approvalMode: str(row, "approval_mode") as Publication["approvalMode"],
    scheduledAt: strOrNull(row, "scheduled_at"),
    timezone: str(row, "timezone"),
    createdByType: str(row, "created_by_type") as ActorType,
    createdById: str(row, "created_by_id"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToAsset(row: Row): PublicationAsset {
  return {
    id: str(row, "id"),
    publicationId: str(row, "publication_id"),
    localAssetId: str(row, "local_asset_id"),
    openpostMediaRef: strOrNull(row, "openpost_media_ref"),
    sha256: str(row, "sha256"),
    mimeType: str(row, "mime_type"),
    byteSize: Number(row["byte_size"] ?? 0),
    width: numOrNull(row, "width"),
    height: numOrNull(row, "height"),
    durationMs: numOrNull(row, "duration_ms"),
    provenance: json<Record<string, unknown>>(row, "provenance_json", {}),
    createdAt: str(row, "created_at"),
  };
}

function rowToRendition(row: Row): Rendition {
  return {
    id: str(row, "id"),
    publicationId: str(row, "publication_id"),
    accountId: str(row, "account_id"),
    platform: str(row, "platform"),
    format: str(row, "format") as Rendition["format"],
    title: strOrNull(row, "title"),
    caption: strOrNull(row, "caption"),
    description: strOrNull(row, "description"),
    hashtags: json<string[]>(row, "hashtags_json", []),
    assetRefs: json<string[]>(row, "asset_refs_json", []),
    providerSettings: json<Record<string, unknown>>(row, "provider_settings_json", {}),
    scheduledAt: strOrNull(row, "scheduled_at"),
    capabilitySnapshot: json<AccountCapabilities>(row, "capability_snapshot_json", fallbackCapabilities()),
    capabilitySnapshotAt: str(row, "capability_snapshot_at"),
    validationStatus: str(row, "validation_status") as Rendition["validationStatus"],
    validationIssues: json<ValidationIssue[]>(row, "validation_issues_json", []),
    approvalStatus: str(row, "approval_status") as Rendition["approvalStatus"],
    contentHash: str(row, "content_hash"),
    deliveryStatus: str(row, "delivery_status") as DeliveryStatus,
    openpostPublicationRef: strOrNull(row, "openpost_publication_ref"),
    openpostRenditionRef: strOrNull(row, "openpost_rendition_ref"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToJob(row: Row): DeliveryJob {
  return {
    id: str(row, "id"),
    publicationId: str(row, "publication_id"),
    renditionId: strOrNull(row, "rendition_id"),
    idempotencyKey: str(row, "idempotency_key"),
    jobType: str(row, "job_type") as DeliveryJobType,
    status: str(row, "status") as DeliveryJobStatus,
    attemptCount: Number(row["attempt_count"] ?? 0),
    maxAttempts: Number(row["max_attempts"] ?? 5),
    nextAttemptAt: strOrNull(row, "next_attempt_at"),
    lockedAt: strOrNull(row, "locked_at"),
    lockedBy: strOrNull(row, "locked_by"),
    lastErrorClass: strOrNull(row, "last_error_class"),
    lastErrorCode: strOrNull(row, "last_error_code"),
    lastErrorMessage: strOrNull(row, "last_error_message"),
    remoteOperationRef: strOrNull(row, "remote_operation_ref"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToApproval(row: Row): ApprovalRecord {
  return {
    id: str(row, "id"),
    publicationId: str(row, "publication_id"),
    renditionId: strOrNull(row, "rendition_id"),
    decision: str(row, "decision") as ApprovalDecision,
    approverType: str(row, "approver_type") as ActorType,
    approverId: str(row, "approver_id"),
    approvalScope: str(row, "approval_scope") as ApprovalScope,
    contentHash: str(row, "content_hash"),
    note: strOrNull(row, "note"),
    createdAt: str(row, "created_at"),
  };
}

function rowToSnapshot(row: Row): AnalyticsSnapshot {
  return {
    id: str(row, "id"),
    publicationId: strOrNull(row, "publication_id"),
    renditionId: strOrNull(row, "rendition_id"),
    accountId: str(row, "account_id"),
    capturedAt: str(row, "captured_at"),
    views: numOrNull(row, "views"),
    impressions: numOrNull(row, "impressions"),
    reach: numOrNull(row, "reach"),
    engagements: numOrNull(row, "engagements"),
    likes: numOrNull(row, "likes"),
    comments: numOrNull(row, "comments"),
    shares: numOrNull(row, "shares"),
    followersDelta: numOrNull(row, "followers_delta"),
    rawMetrics: json<Record<string, unknown>>(row, "raw_metrics_json", {}),
  };
}

// --- store ---

export interface UpsertRenditionRow {
  id: string;
  publicationId: string;
  accountId: string;
  platform: string;
  format: string;
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  assetRefs: string[];
  providerSettings: Record<string, unknown>;
  scheduledAt: string | null;
  capabilitySnapshot: AccountCapabilities;
  capabilitySnapshotAt: string;
  contentHash: string;
}

export class SocialPublishingStore {
  // --- instances ---

  listInstances(): OpenPostInstanceConfig[] {
    const rows = openAgentOsDb().query("SELECT * FROM sp_openpost_instances ORDER BY created_at").all();
    return (rows as Row[]).map(rowToInstance);
  }

  getInstance(id: string): OpenPostInstanceConfig | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_openpost_instances WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToInstance(row);
  }

  findInstanceByName(name: string): OpenPostInstanceConfig | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_openpost_instances WHERE name = ?").get(name) as Row | null;
    if (!row) return null;
    return rowToInstance(row);
  }

  insertInstance(instance: OpenPostInstanceConfig): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_openpost_instances (id, name, base_url, auth_mode, secret_ref, mcp_endpoint, mcp_scope, transport, status, version, last_health_at, last_error_code, last_error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        instance.id,
        instance.name,
        instance.baseUrl,
        instance.authMode,
        instance.secretRef,
        instance.mcpEndpoint,
        instance.mcpScope,
        instance.transport,
        instance.status,
        instance.version,
        instance.lastHealthAt,
        instance.lastErrorCode,
        instance.lastErrorMessage,
        instance.createdAt,
        instance.updatedAt,
      );
  }

  updateInstanceStatus(
    id: string,
    patch: {
      status?: string;
      version?: string | null;
      lastHealthAt?: string | null;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
      mcpEndpoint?: string | null;
      mcpScope?: string | null;
    },
  ): void {
    const instance = this.getInstance(id);
    if (!instance) return;
    const status = patch.status ?? instance.status;
    const version = patch.version !== undefined ? patch.version : instance.version;
    const lastHealthAt = patch.lastHealthAt !== undefined ? patch.lastHealthAt : instance.lastHealthAt;
    const lastErrorCode = patch.lastErrorCode !== undefined ? patch.lastErrorCode : instance.lastErrorCode;
    const lastErrorMessage = patch.lastErrorMessage !== undefined ? patch.lastErrorMessage : instance.lastErrorMessage;
    const mcpEndpoint = patch.mcpEndpoint !== undefined ? patch.mcpEndpoint : instance.mcpEndpoint;
    const mcpScope = patch.mcpScope !== undefined ? patch.mcpScope : instance.mcpScope;
    openAgentOsDb()
      .query("UPDATE sp_openpost_instances SET status = ?, version = ?, last_health_at = ?, last_error_code = ?, last_error_message = ? WHERE id = ?")
      .run(status, version, lastHealthAt, lastErrorCode, lastErrorMessage, id);
    openAgentOsDb()
      .query("UPDATE sp_openpost_instances SET mcp_endpoint = ?, mcp_scope = ?, updated_at = ? WHERE id = ?")
      .run(mcpEndpoint, mcpScope, nowIso(), id);
  }

  updateInstance(id: string, patch: { name?: string; baseUrl?: string; secretRef?: string; transport?: string }): void {
    const instance = this.getInstance(id);
    if (!instance) return;
    const name = patch.name ?? instance.name;
    const baseUrl = patch.baseUrl ?? instance.baseUrl;
    const secretRef = patch.secretRef ?? instance.secretRef;
    const transport = patch.transport ?? instance.transport;
    openAgentOsDb()
      .query("UPDATE sp_openpost_instances SET name = ?, base_url = ?, secret_ref = ?, transport = ?, updated_at = ? WHERE id = ?")
      .run(name, baseUrl, secretRef, transport, nowIso(), id);
  }

  deleteInstance(id: string): boolean {
    const result = openAgentOsDb().query("DELETE FROM sp_openpost_instances WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  // --- accounts ---

  listAccounts(instanceId?: string): SocialAccount[] {
    if (instanceId) {
      const scoped = openAgentOsDb()
        .query("SELECT * FROM sp_accounts WHERE instance_id = ? ORDER BY platform, username")
        .all(instanceId);
      return (scoped as Row[]).map(rowToAccount);
    }
    const rows = openAgentOsDb().query("SELECT * FROM sp_accounts ORDER BY platform, username").all();
    return (rows as Row[]).map(rowToAccount);
  }

  getAccount(id: string): SocialAccount | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_accounts WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToAccount(row);
  }

  findAccountByRemoteRef(instanceId: string, openpostAccountRef: string): SocialAccount | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sp_accounts WHERE instance_id = ? AND openpost_account_ref = ?")
      .get(instanceId, openpostAccountRef) as Row | null;
    if (!row) return null;
    return rowToAccount(row);
  }

  /** Insert or refresh a synced account; returns the stored row (id stable across syncs). */
  upsertAccount(account: SocialAccount): SocialAccount {
    const existing = this.findAccountByRemoteRef(account.instanceId, account.openpostAccountRef);
    if (existing) {
      const stored: SocialAccount = { ...account, id: existing.id, createdAt: existing.createdAt };
      this.updateAccountRow(stored);
      return stored;
    }
    this.insertAccountRow(account);
    return account;
  }

  private insertAccountRow(account: SocialAccount): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_accounts (id, instance_id, openpost_workspace_ref, openpost_account_ref, platform, display_name, username, readiness_state, readiness_reason, enabled, capability_json, last_sync_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        account.id,
        account.instanceId,
        account.openpostWorkspaceRef,
        account.openpostAccountRef,
        account.platform,
        account.displayName,
        account.username,
        account.readinessState,
        account.readinessReason,
        account.enabled ? 1 : 0,
        JSON.stringify(account.capabilities),
        account.lastSyncAt,
        account.createdAt,
        account.updatedAt,
      );
  }

  private updateAccountRow(account: SocialAccount): void {
    openAgentOsDb()
      .query(
        "UPDATE sp_accounts SET openpost_workspace_ref = ?, platform = ?, display_name = ?, username = ?, readiness_state = ?, readiness_reason = ?, enabled = ?, capability_json = ?, last_sync_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        account.openpostWorkspaceRef,
        account.platform,
        account.displayName,
        account.username,
        account.readinessState,
        account.readinessReason,
        account.enabled ? 1 : 0,
        JSON.stringify(account.capabilities),
        account.lastSyncAt,
        account.updatedAt,
        account.id,
      );
  }

  setAccountEnabled(id: string, enabled: boolean): void {
    const flag = enabled ? 1 : 0;
    openAgentOsDb().query("UPDATE sp_accounts SET enabled = ?, updated_at = ? WHERE id = ?").run(flag, nowIso(), id);
  }

  // --- publications ---

  insertPublication(publication: Publication): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_publications (id, source_type, asset_ids_json, master_title, master_caption, master_description, master_tags_json, metadata_json, status, risk_level, approval_mode, scheduled_at, timezone, created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publication.id,
        publication.sourceType,
        JSON.stringify(publication.assetIds),
        publication.masterTitle,
        publication.masterCaption,
        publication.masterDescription,
        JSON.stringify(publication.masterTags),
        JSON.stringify(publication.metadataJson),
        publication.status,
        publication.riskLevel,
        publication.approvalMode,
        publication.scheduledAt,
        publication.timezone,
        publication.createdByType,
        publication.createdById,
        publication.createdAt,
        publication.updatedAt,
      );
  }

  getPublication(id: string): Publication | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_publications WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToPublication(row);
  }

  listPublications(filter?: { status?: string }): Publication[] {
    if (filter?.status) {
      const scoped = openAgentOsDb()
        .query("SELECT * FROM sp_publications WHERE status = ? ORDER BY updated_at DESC")
        .all(filter.status);
      return (scoped as Row[]).map(rowToPublication);
    }
    const rows = openAgentOsDb().query("SELECT * FROM sp_publications ORDER BY updated_at DESC").all();
    return (rows as Row[]).map(rowToPublication);
  }

  updatePublication(
    id: string,
    patch: Partial<
      Pick<Publication, "status" | "masterTitle" | "masterCaption" | "masterDescription" | "masterTags" | "metadataJson" | "scheduledAt" | "riskLevel">
    >,
  ): void {
    const publication = this.getPublication(id);
    if (!publication) return;
    const status = patch.status ?? publication.status;
    const masterTitle = patch.masterTitle !== undefined ? patch.masterTitle : publication.masterTitle;
    const masterCaption = patch.masterCaption !== undefined ? patch.masterCaption : publication.masterCaption;
    const masterDescription = patch.masterDescription !== undefined ? patch.masterDescription : publication.masterDescription;
    const masterTagsJson = JSON.stringify(patch.masterTags ?? publication.masterTags);
    const metadataJson = JSON.stringify(patch.metadataJson ?? publication.metadataJson);
    const scheduledAt = patch.scheduledAt !== undefined ? patch.scheduledAt : publication.scheduledAt;
    const riskLevel = patch.riskLevel ?? publication.riskLevel;
    openAgentOsDb()
      .query("UPDATE sp_publications SET status = ?, master_title = ?, master_caption = ?, master_description = ?, master_tags_json = ? WHERE id = ?")
      .run(status, masterTitle, masterCaption, masterDescription, masterTagsJson, id);
    openAgentOsDb()
      .query("UPDATE sp_publications SET metadata_json = ?, scheduled_at = ?, risk_level = ?, updated_at = ? WHERE id = ?")
      .run(metadataJson, scheduledAt, riskLevel, nowIso(), id);
  }

  // --- publication assets ---

  listPublicationAssets(publicationId: string): PublicationAsset[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sp_publication_assets WHERE publication_id = ? ORDER BY created_at")
      .all(publicationId);
    return (rows as Row[]).map(rowToAsset);
  }

  findAssetBySha(publicationId: string, sha256: string): PublicationAsset | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sp_publication_assets WHERE publication_id = ? AND sha256 = ?")
      .get(publicationId, sha256) as Row | null;
    if (!row) return null;
    return rowToAsset(row);
  }

  insertPublicationAsset(asset: PublicationAsset): void {
    openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO sp_publication_assets (id, publication_id, local_asset_id, openpost_media_ref, sha256, mime_type, byte_size, width, height, duration_ms, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        asset.id,
        asset.publicationId,
        asset.localAssetId,
        asset.openpostMediaRef,
        asset.sha256,
        asset.mimeType,
        asset.byteSize,
        asset.width,
        asset.height,
        asset.durationMs,
        JSON.stringify(asset.provenance),
        asset.createdAt,
      );
  }

  setAssetRemoteRef(id: string, openpostMediaRef: string): void {
    openAgentOsDb().query("UPDATE sp_publication_assets SET openpost_media_ref = ? WHERE id = ?").run(openpostMediaRef, id);
  }

  // --- renditions ---

  insertRendition(rendition: UpsertRenditionRow): Rendition {
    const ts = nowIso();
    openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO sp_renditions (id, publication_id, account_id, platform, format, title, caption, description, hashtags_json, asset_refs_json, provider_settings_json, scheduled_at, capability_snapshot_json, capability_snapshot_at, validation_status, validation_issues_json, approval_status, content_hash, delivery_status, openpost_publication_ref, openpost_rendition_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        rendition.id,
        rendition.publicationId,
        rendition.accountId,
        rendition.platform,
        rendition.format,
        rendition.title,
        rendition.caption,
        rendition.description,
        JSON.stringify(rendition.hashtags),
        JSON.stringify(rendition.assetRefs),
        JSON.stringify(rendition.providerSettings),
        rendition.scheduledAt,
        JSON.stringify(rendition.capabilitySnapshot),
        rendition.capabilitySnapshotAt,
        "unvalidated",
        "[]",
        "pending",
        rendition.contentHash,
        "draft",
        null,
        null,
        ts,
        ts,
      );
    const created = this.getRendition(rendition.id);
    if (!created) throw new Error("rendition insert failed");
    return created;
  }

  getRendition(id: string): Rendition | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_renditions WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToRendition(row);
  }

  listRenditions(publicationId: string): Rendition[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sp_renditions WHERE publication_id = ? ORDER BY created_at")
      .all(publicationId);
    return (rows as Row[]).map(rowToRendition);
  }

  updateRendition(
    id: string,
    patch: Partial<
      Pick<
        Rendition,
        | "title"
        | "caption"
        | "description"
        | "hashtags"
        | "providerSettings"
        | "scheduledAt"
        | "validationStatus"
        | "validationIssues"
        | "approvalStatus"
        | "contentHash"
        | "deliveryStatus"
        | "openpostPublicationRef"
        | "openpostRenditionRef"
        | "capabilitySnapshot"
        | "capabilitySnapshotAt"
      >
    >,
  ): void {
    const rendition = this.getRendition(id);
    if (!rendition) return;
    const title = patch.title !== undefined ? patch.title : rendition.title;
    const caption = patch.caption !== undefined ? patch.caption : rendition.caption;
    const description = patch.description !== undefined ? patch.description : rendition.description;
    const hashtagsJson = JSON.stringify(patch.hashtags ?? rendition.hashtags);
    const providerSettingsJson = JSON.stringify(patch.providerSettings ?? rendition.providerSettings);
    const scheduledAt = patch.scheduledAt !== undefined ? patch.scheduledAt : rendition.scheduledAt;
    const capabilitySnapshotJson = JSON.stringify(patch.capabilitySnapshot ?? rendition.capabilitySnapshot);
    const capabilitySnapshotAt = patch.capabilitySnapshotAt ?? rendition.capabilitySnapshotAt;
    const validationStatus = patch.validationStatus ?? rendition.validationStatus;
    const validationIssuesJson = JSON.stringify(patch.validationIssues ?? rendition.validationIssues);
    const approvalStatus = patch.approvalStatus ?? rendition.approvalStatus;
    const contentHash = patch.contentHash ?? rendition.contentHash;
    const deliveryStatus = patch.deliveryStatus ?? rendition.deliveryStatus;
    const openpostPublicationRef = patch.openpostPublicationRef !== undefined ? patch.openpostPublicationRef : rendition.openpostPublicationRef;
    const openpostRenditionRef = patch.openpostRenditionRef !== undefined ? patch.openpostRenditionRef : rendition.openpostRenditionRef;
    openAgentOsDb()
      .query(
        "UPDATE sp_renditions SET title = ?, caption = ?, description = ?, hashtags_json = ?, provider_settings_json = ?, scheduled_at = ?, capability_snapshot_json = ?, capability_snapshot_at = ? WHERE id = ?",
      )
      .run(title, caption, description, hashtagsJson, providerSettingsJson, scheduledAt, capabilitySnapshotJson, capabilitySnapshotAt, id);
    openAgentOsDb()
      .query(
        "UPDATE sp_renditions SET validation_status = ?, validation_issues_json = ?, approval_status = ?, content_hash = ?, delivery_status = ?, openpost_publication_ref = ?, openpost_rendition_ref = ?, updated_at = ? WHERE id = ?",
      )
      .run(validationStatus, validationIssuesJson, approvalStatus, contentHash, deliveryStatus, openpostPublicationRef, openpostRenditionRef, nowIso(), id);
  }

  // --- policy evaluations ---

  insertPolicyEvaluation(entry: { publicationId: string; renditionId: string | null; effect: string; ruleResults: unknown[]; evaluatedBy: string }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_policy_evaluations (id, publication_id, rendition_id, policy_version, effect, rule_results_json, evaluated_by, created_at) VALUES (?, ?, ?, 'sp-1', ?, ?, ?, ?)",
      )
      .run(newId("spe"), entry.publicationId, entry.renditionId, entry.effect, JSON.stringify(entry.ruleResults), entry.evaluatedBy, nowIso());
  }

  listPolicyEvaluations(publicationId: string): Array<{
    id: string;
    publicationId: string;
    renditionId: string | null;
    policyVersion: string;
    effect: string;
    ruleResults: unknown[];
    evaluatedBy: string;
    createdAt: string;
  }> {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sp_policy_evaluations WHERE publication_id = ? ORDER BY created_at DESC")
      .all(publicationId);
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      publicationId: str(row, "publication_id"),
      renditionId: strOrNull(row, "rendition_id"),
      policyVersion: str(row, "policy_version"),
      effect: str(row, "effect"),
      ruleResults: json<unknown[]>(row, "rule_results_json", []),
      evaluatedBy: str(row, "evaluated_by"),
      createdAt: str(row, "created_at"),
    }));
  }

  // --- approvals ---

  insertApproval(approval: ApprovalRecord): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_approvals (id, publication_id, rendition_id, decision, approver_type, approver_id, approval_scope, content_hash, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approval.id,
        approval.publicationId,
        approval.renditionId,
        approval.decision,
        approval.approverType,
        approval.approverId,
        approval.approvalScope,
        approval.contentHash,
        approval.note,
        approval.createdAt,
      );
  }

  latestApprovalForHash(publicationId: string, contentHash: string): ApprovalRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sp_approvals WHERE publication_id = ? AND content_hash = ? ORDER BY created_at DESC LIMIT 1")
      .get(publicationId, contentHash) as Row | null;
    if (!row) return null;
    return rowToApproval(row);
  }

  listApprovals(publicationId?: string): ApprovalRecord[] {
    if (publicationId) {
      const scoped = openAgentOsDb()
        .query("SELECT * FROM sp_approvals WHERE publication_id = ? ORDER BY created_at DESC")
        .all(publicationId);
      return (scoped as Row[]).map(rowToApproval);
    }
    const rows = openAgentOsDb().query("SELECT * FROM sp_approvals ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Row[]).map(rowToApproval);
  }

  // --- delivery jobs ---

  findJobByIdempotencyKey(key: string): DeliveryJob | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_delivery_jobs WHERE idempotency_key = ?").get(key) as Row | null;
    if (!row) return null;
    return rowToJob(row);
  }

  getJob(id: string): DeliveryJob | null {
    const row = openAgentOsDb().query("SELECT * FROM sp_delivery_jobs WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToJob(row);
  }

  insertJob(job: DeliveryJob): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO sp_delivery_jobs (id, publication_id, rendition_id, idempotency_key, job_type, status, attempt_count, max_attempts, next_attempt_at, locked_at, locked_by, last_error_class, last_error_code, last_error_message, remote_operation_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.id,
        job.publicationId,
        job.renditionId,
        job.idempotencyKey,
        job.jobType,
        job.status,
        job.attemptCount,
        job.maxAttempts,
        job.nextAttemptAt,
        job.lockedAt,
        job.lockedBy,
        job.lastErrorClass,
        job.lastErrorCode,
        job.lastErrorMessage,
        job.remoteOperationRef,
        job.createdAt,
        job.updatedAt,
      );
    return Number(result.changes) > 0;
  }

  updateJob(
    id: string,
    patch: Partial<
      Pick<DeliveryJob, "status" | "attemptCount" | "nextAttemptAt" | "lockedAt" | "lockedBy" | "lastErrorClass" | "lastErrorCode" | "lastErrorMessage" | "remoteOperationRef">
    >,
  ): void {
    const job = this.getJob(id);
    if (!job) return;
    const status = patch.status ?? job.status;
    const attemptCount = patch.attemptCount ?? job.attemptCount;
    const nextAttemptAt = patch.nextAttemptAt !== undefined ? patch.nextAttemptAt : job.nextAttemptAt;
    const lockedAt = patch.lockedAt !== undefined ? patch.lockedAt : job.lockedAt;
    const lockedBy = patch.lockedBy !== undefined ? patch.lockedBy : job.lockedBy;
    const lastErrorClass = patch.lastErrorClass !== undefined ? patch.lastErrorClass : job.lastErrorClass;
    const lastErrorCode = patch.lastErrorCode !== undefined ? patch.lastErrorCode : job.lastErrorCode;
    const lastErrorMessage = patch.lastErrorMessage !== undefined ? patch.lastErrorMessage : job.lastErrorMessage;
    const remoteOperationRef = patch.remoteOperationRef !== undefined ? patch.remoteOperationRef : job.remoteOperationRef;
    openAgentOsDb()
      .query(
        "UPDATE sp_delivery_jobs SET status = ?, attempt_count = ?, next_attempt_at = ?, locked_at = ?, locked_by = ?, last_error_class = ?, last_error_code = ?, last_error_message = ?, remote_operation_ref = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, attemptCount, nextAttemptAt, lockedAt, lockedBy, lastErrorClass, lastErrorCode, lastErrorMessage, remoteOperationRef, nowIso(), id);
  }

  claimDueJobs(limit: number, lockToken: string): DeliveryJob[] {
    const db = openAgentOsDb();
    const now = nowIso();
    const due = db
      .query(
        "SELECT * FROM sp_delivery_jobs WHERE status IN ('pending', 'failed_retryable') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?",
      )
      .all(now, limit) as Row[];
    const claimed: DeliveryJob[] = [];
    for (const row of due) {
      const job = rowToJob(row);
      const result = db
        .query(
          "UPDATE sp_delivery_jobs SET status = 'in_progress', locked_at = ?, locked_by = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed_retryable')",
        )
        .run(now, lockToken, now, job.id);
      if (Number(result.changes) > 0) {
        claimed.push({ ...job, status: "in_progress", lockedAt: now, lockedBy: lockToken });
      }
    }
    return claimed;
  }

  listJobs(filter?: { status?: string; publicationId?: string }): DeliveryJob[] {
    if (filter?.status && filter.publicationId) {
      const both = openAgentOsDb()
        .query("SELECT * FROM sp_delivery_jobs WHERE status = ? AND publication_id = ? ORDER BY created_at DESC LIMIT 500")
        .all(filter.status, filter.publicationId);
      return (both as Row[]).map(rowToJob);
    }
    if (filter?.status) {
      const byStatus = openAgentOsDb()
        .query("SELECT * FROM sp_delivery_jobs WHERE status = ? ORDER BY created_at DESC LIMIT 500")
        .all(filter.status);
      return (byStatus as Row[]).map(rowToJob);
    }
    if (filter?.publicationId) {
      const byPublication = openAgentOsDb()
        .query("SELECT * FROM sp_delivery_jobs WHERE publication_id = ? ORDER BY created_at DESC LIMIT 500")
        .all(filter.publicationId);
      return (byPublication as Row[]).map(rowToJob);
    }
    const rows = openAgentOsDb().query("SELECT * FROM sp_delivery_jobs ORDER BY created_at DESC LIMIT 500").all();
    return (rows as Row[]).map(rowToJob);
  }

  // --- analytics ---

  insertAnalyticsSnapshot(snapshot: AnalyticsSnapshot): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_analytics_snapshots (id, publication_id, rendition_id, account_id, captured_at, views, impressions, reach, engagements, likes, comments, shares, followers_delta, raw_metrics_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        snapshot.id,
        snapshot.publicationId,
        snapshot.renditionId,
        snapshot.accountId,
        snapshot.capturedAt,
        snapshot.views,
        snapshot.impressions,
        snapshot.reach,
        snapshot.engagements,
        snapshot.likes,
        snapshot.comments,
        snapshot.shares,
        snapshot.followersDelta,
        JSON.stringify(snapshot.rawMetrics),
      );
  }

  latestAnalyticsSnapshot(accountId: string): AnalyticsSnapshot | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sp_analytics_snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1")
      .get(accountId) as Row | null;
    if (!row) return null;
    return rowToSnapshot(row);
  }

  listAnalyticsSnapshots(filter?: { publicationId?: string; accountId?: string; limit?: number }): AnalyticsSnapshot[] {
    const limit = filter?.limit ?? 200;
    if (filter?.publicationId && filter.accountId) {
      const both = openAgentOsDb()
        .query("SELECT * FROM sp_analytics_snapshots WHERE publication_id = ? AND account_id = ? ORDER BY captured_at DESC LIMIT ?")
        .all(filter.publicationId, filter.accountId, limit);
      return (both as Row[]).map(rowToSnapshot);
    }
    if (filter?.publicationId) {
      const byPublication = openAgentOsDb()
        .query("SELECT * FROM sp_analytics_snapshots WHERE publication_id = ? ORDER BY captured_at DESC LIMIT ?")
        .all(filter.publicationId, limit);
      return (byPublication as Row[]).map(rowToSnapshot);
    }
    if (filter?.accountId) {
      const byAccount = openAgentOsDb()
        .query("SELECT * FROM sp_analytics_snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT ?")
        .all(filter.accountId, limit);
      return (byAccount as Row[]).map(rowToSnapshot);
    }
    const rows = openAgentOsDb().query("SELECT * FROM sp_analytics_snapshots ORDER BY captured_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map(rowToSnapshot);
  }

  // --- audit ---

  appendAudit(input: SocialAuditInput): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sp_audit (id, actor_type, actor_id, action, resource_type, resource_id, policy_effect, approval_ref, instance_id, remote_ref, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newId("spa"),
        input.actorType,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.policyEffect ?? null,
        input.approvalRef ?? null,
        input.instanceId ?? null,
        input.remoteRef ?? null,
        JSON.stringify(input.metadata ?? {}),
        nowIso(),
      );
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM sp_audit ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      actorType: str(row, "actor_type"),
      actorId: strOrNull(row, "actor_id"),
      action: str(row, "action"),
      resourceType: str(row, "resource_type"),
      resourceId: str(row, "resource_id"),
      policyEffect: strOrNull(row, "policy_effect"),
      approvalRef: strOrNull(row, "approval_ref"),
      instanceId: strOrNull(row, "instance_id"),
      remoteRef: strOrNull(row, "remote_ref"),
      metadata: json<Record<string, unknown>>(row, "metadata_json", {}),
      createdAt: str(row, "created_at"),
    }));
  }
}
