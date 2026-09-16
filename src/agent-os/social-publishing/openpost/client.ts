// Phase 20.60 — Typed OpenPost HTTP client.
//
// Endpoint contract verified against the upstream OpenAPI document
// (docs.openpo.st/openapi.json, v4.33.0 era, base path /api/v1):
//
//   GET    /health
//   GET    /ready
//   GET    /workspaces
//   GET    /accounts
//   GET    /capabilities
//   GET    /provider-readiness
//   POST   /media/upload-session                     {filename,size,mime_type,client_sha256,workspace_id,...}
//   POST   /media/upload-session/{id}/complete       {workspace_id}
//   GET    /media
//   GET|POST /publications                           {workspace_id,title,source_text,content_profile,intent,media,renditions,social_account_ids,scheduled_at}
//   GET|PUT|DELETE /publications/{id}
//   PUT    /publications/{id}/renditions             {expected_revision,renditions[]}
//   POST   /publications/{id}/schedule               {expected_revision}
//   POST   /publications/{id}/publish-now            {expected_revision}
//   POST   /publications/{id}/cancel                 {expected_revision}
//   POST   /publications/{id}/validate
//   GET    /publications/{id}/events
//   POST   /publications/{id}/renditions/{account_id}/retry
//   GET    /jobs
//   GET    /analytics
//
// Upstream naming wins wherever it differs from the phase spec; differences
// are documented in the phase report (e.g. "rendition" is the upstream word
// for the per-account draft, `expected_revision` is a mandatory optimistic
// concurrency token on mutations, media upload is a two-phase session).

import type { OpenPostTransport } from "./transport";
import { mapRemoteStatus, OpenPostRequestError } from "./errors";

// --- remote response shapes (subset we consume; upstream owns the rest) ---

export interface RemoteHealth {
  status?: string;
  database?: string;
  [key: string]: unknown;
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  role?: string;
  [key: string]: unknown;
}

export interface RemoteAccount {
  id: string;
  account_id?: string;
  platform: string;
  account_username?: string;
  account_avatar_url?: string;
  is_active?: boolean;
  capability_checked_at?: string;
  slug?: string;
  instance_url?: string;
  [key: string]: unknown;
}

export interface RemoteCapability {
  provider: string;
  profile?: string;
  output_profile?: string;
  text_limit?: number | null;
  title_required?: boolean | null;
  description_required?: boolean | null;
  intents?: string[];
  media_shapes?: Record<string, unknown>;
  media?: Record<string, unknown>;
  native_scheduling?: boolean | null;
  openpost_queued?: boolean | null;
  requires_app_review?: boolean | null;
  requires_public_media?: boolean | null;
  unavailable_reason?: string | null;
  caveats?: string[];
  validation_categories?: string[];
  expires_at?: string | null;
  capability_revision?: string | null;
  [key: string]: unknown;
}

export interface RemoteReadinessItem {
  provider: string;
  state?: string;
  connectable?: boolean;
  advertisable?: boolean;
  connected_accounts?: number;
  configured_app_state?: string;
  blocking_issues?: unknown[] | null;
  accounts?: RemoteReadinessAccount[] | null;
  [key: string]: unknown;
}

export interface RemoteReadinessAccount {
  account_id?: string;
  state?: string;
  [key: string]: unknown;
}

export interface RemoteMediaUploadTarget {
  url: string;
  method: string;
  headers?: Record<string, string>;
  object_key?: string;
  expires_at?: string;
}

export interface RemoteCreateMediaUploadSessionResponse {
  media_id: string;
  deduped: boolean;
  upload?: RemoteMediaUploadTarget;
  complete_url?: string;
}

export interface RemoteMediaUploadResult {
  id: string;
  deduped?: boolean;
  mime_type?: string;
  size?: number;
  url?: string;
  processing_status?: string;
  [key: string]: unknown;
}

export interface RemoteRendition {
  id: string;
  social_account_id: string;
  platform?: string;
  body?: string;
  title?: string;
  description?: string;
  status?: string;
  settings?: Record<string, unknown>;
  external_id?: string | null;
  external_url?: string | null;
  error_kind?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  error_retryable?: boolean | null;
  error_retry_at?: string | null;
  delivery?: RemoteDelivery | null;
  schedule_override?: string | null;
  [key: string]: unknown;
}

export interface RemoteDelivery {
  state?: string;
  recovery_action?: "none" | "retry" | "reconcile" | "manual_resolution";
  error_code?: string | null;
  error_kind?: string | null;
  external_id?: string | null;
  current_attempt_number?: number;
  last_reconciled_at?: string | null;
  next_reconciliation_at?: string | null;
  terminal_reason?: string | null;
  [key: string]: unknown;
}

export interface RemotePublication {
  id: string;
  workspace_id: string;
  title: string;
  source_text?: string;
  status?: string;
  revision?: number;
  scheduled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  media?: RemoteMediaSummary[] | null;
  renditions?: RemoteRendition[] | null;
  [key: string]: unknown;
}

export interface RemoteMediaSummary {
  id: string;
  mime_type?: string;
  size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  url?: string;
  [key: string]: unknown;
}

export interface RemoteLifecycleEvent {
  id?: string;
  type?: string;
  status?: string;
  platform?: string | null;
  rendition_id?: string | null;
  created_at?: string;
  summary?: string;
  delivery?: RemoteDelivery | null;
  error?: { code?: string; message?: string; kind?: string } | null;
  [key: string]: unknown;
}

export interface RemoteJob {
  id: string;
  type?: string;
  status?: string;
  attempts?: number;
  max_attempts?: number;
  run_at?: string;
  last_error?: string | null;
  publication_id?: string | null;
  [key: string]: unknown;
}

export interface RemoteValidationIssue {
  code?: string;
  severity?: string;
  message?: string;
  fallback_message?: string;
  field?: string;
  provider?: string;
  profile?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface RemoteValidationResult {
  valid: boolean;
  issues: RemoteValidationIssue[] | null;
}

export interface RemoteActionOutput {
  message?: string;
  job_id?: string | null;
  publication_id?: string | null;
  revision?: number | null;
  [key: string]: unknown;
}

export interface RemoteAnalyticsOverview {
  summary?: {
    published?: number;
    views?: { total?: number | null } & Record<string, unknown>;
    impressions?: { total?: number | null } & Record<string, unknown>;
    reach?: { total?: number | null } & Record<string, unknown>;
    engagement?: { total?: number | null } & Record<string, unknown>;
    followers?: { total?: number | null } & Record<string, unknown>;
  } & Record<string, unknown>;
  publications?: unknown[] | null;
  accounts?: unknown[] | null;
  coverage?: Record<string, unknown> | null;
  generated_at?: string;
  [key: string]: unknown;
}

// --- request body shapes ---

export interface CreateRemoteRenditionInput {
  social_account_id: string;
  body: string;
  title?: string;
  description?: string;
  settings?: Record<string, unknown>;
  schedule_override?: string | null;
}

export interface CreateRemotePublicationInput {
  workspace_id: string;
  title: string;
  source_text: string;
  content_profile: string;
  intent?: "post" | "thread" | "story" | "short_video" | "video";
  creation_preset?: string;
  media?: string[];
  social_account_ids?: string[];
  renditions?: CreateRemoteRenditionInput[];
  scheduled_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateMediaUploadSessionInput {
  workspace_id: string;
  filename: string;
  size: number;
  mime_type?: string;
  client_sha256?: string;
  asset_kind?: "library" | "brand_asset" | "brand_font" | "design_preview" | "template_preview" | "project_asset";
  retention_class?: "library" | "temporary";
  alt_text?: string;
  source?: string;
}

// --- the client ---

export interface OpenPostClientOptions {
  transport: OpenPostTransport;
  /** Default workspace used when a call does not pin one. */
  defaultWorkspaceId?: string;
}

export class OpenPostClient {
  private readonly transport: OpenPostTransport;

  constructor(options: OpenPostClientOptions) {
    this.transport = options.transport;
  }

  private async call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts?: {
    body?: unknown;
    query?: Record<string, string>;
    correlationId?: string;
  }): Promise<T> {
    const response = await this.transport.request({ method, path, body: opts?.body, query: opts?.query, correlationId: opts?.correlationId });
    // The fetch transport maps >=400 already; this guard keeps injected
    // transports (tests, future MCP bridge) on the same error contract.
    if (response.status >= 400) {
      const preview = typeof response.body === "object" && response.body !== null ? JSON.stringify(response.body) : "";
      throw new OpenPostRequestError(mapRemoteStatus(response.status, preview));
    }
    return response.body as T;
  }

  // health / discovery

  health(): Promise<RemoteHealth> {
    return this.call("GET", "/health");
  }

  ready(): Promise<RemoteHealth> {
    return this.call("GET", "/ready");
  }

  listWorkspaces(): Promise<RemoteWorkspace[]> {
    return this.call<{ items: RemoteWorkspace[] | null }>("GET", "/workspaces").then((r) => r.items ?? []);
  }

  listAccounts(workspaceId?: string): Promise<RemoteAccount[]> {
    return this.call<{ items: RemoteAccount[] | null }>("GET", "/accounts", {
      query: workspaceId ? { workspace_id: workspaceId } : undefined,
    }).then((r) => r.items ?? []);
  }

  listCapabilities(): Promise<RemoteCapability[]> {
    return this.call<{ capabilities: RemoteCapability[] | null }>("GET", "/capabilities").then((r) => r.capabilities ?? []);
  }

  listProviderReadiness(): Promise<RemoteReadinessItem[]> {
    return this.call<{ providers: RemoteReadinessItem[] | null }>("GET", "/provider-readiness").then((r) => r.providers ?? []);
  }

  // media (two-phase upload with upstream-side sha256 dedupe)

  createMediaUploadSession(input: CreateMediaUploadSessionInput): Promise<RemoteCreateMediaUploadSessionResponse> {
    return this.call("POST", "/media/upload-session", { body: input });
  }

  async uploadMediaBytes(session: RemoteCreateMediaUploadSessionResponse, bytes: Uint8Array): Promise<void> {
    const target = session.upload;
    if (!target) return; // deduped uploads skip the byte transfer
    await this.transport.request({
      method: "PUT",
      path: "/__raw__",
      raw: { url: target.url, method: target.method || "PUT", headers: target.headers ?? {}, body: bytes },
    });
  }

  completeMediaUploadSession(sessionId: string, workspaceId: string): Promise<RemoteMediaUploadResult> {
    return this.call("POST", "/media/upload-session/" + encodeURIComponent(sessionId) + "/complete", {
      body: { workspace_id: workspaceId },
    });
  }

  // publications

  createPublication(input: CreateRemotePublicationInput, correlationId?: string): Promise<RemotePublication> {
    return this.call("POST", "/publications", { body: input, correlationId });
  }

  getPublication(id: string): Promise<RemotePublication> {
    return this.call("GET", "/publications/" + encodeURIComponent(id));
  }

  listPublications(query?: { workspace_id?: string; status?: string; limit?: number; cursor?: string }): Promise<RemotePublication[]> {
    const clean: Record<string, string> = {};
    if (query?.workspace_id) clean.workspace_id = query.workspace_id;
    if (query?.status) clean.status = query.status;
    if (query?.limit) clean.limit = String(query.limit);
    if (query?.cursor) clean.cursor = query.cursor;
    return this.call<{ items: RemotePublication[] | null }>("GET", "/publications", { query: clean }).then((r) => r.items ?? []);
  }

  putRenditions(publicationId: string, expectedRevision: number, renditions: CreateRemoteRenditionInput[]): Promise<RemotePublication> {
    return this.call("PUT", "/publications/" + encodeURIComponent(publicationId) + "/renditions", {
      body: { expected_revision: expectedRevision, renditions },
    });
  }

  schedulePublication(publicationId: string, expectedRevision: number, executionIntent: "production" | "certification_test" = "production"): Promise<RemoteActionOutput> {
    return this.call("POST", "/publications/" + encodeURIComponent(publicationId) + "/schedule", {
      body: { expected_revision: expectedRevision, execution_intent: executionIntent },
    });
  }

  publishNow(publicationId: string, expectedRevision: number, executionIntent: "production" | "certification_test" = "production"): Promise<RemoteActionOutput> {
    return this.call("POST", "/publications/" + encodeURIComponent(publicationId) + "/publish-now", {
      body: { expected_revision: expectedRevision, execution_intent: executionIntent },
    });
  }

  cancelPublication(publicationId: string, expectedRevision: number): Promise<RemoteActionOutput> {
    return this.call("POST", "/publications/" + encodeURIComponent(publicationId) + "/cancel", {
      body: { expected_revision: expectedRevision },
    });
  }

  validatePublication(publicationId: string): Promise<RemoteValidationResult> {
    return this.call("POST", "/publications/" + encodeURIComponent(publicationId) + "/validate", { body: {} });
  }

  listPublicationEvents(publicationId: string): Promise<RemoteLifecycleEvent[]> {
    return this.call<{ items: RemoteLifecycleEvent[] | null }>("GET", "/publications/" + encodeURIComponent(publicationId) + "/events").then(
      (r) => r.items ?? [],
    );
  }

  retryRendition(publicationId: string, accountId: string): Promise<RemoteActionOutput> {
    return this.call("POST", "/publications/" + encodeURIComponent(publicationId) + "/renditions/" + encodeURIComponent(accountId) + "/retry", {
      body: {},
    });
  }

  // queue / analytics

  listJobs(publicationId?: string): Promise<RemoteJob[]> {
    return this.call<{ items: RemoteJob[] | null }>("GET", "/jobs", {
      query: publicationId ? { publication_id: publicationId } : undefined,
    }).then((r) => r.items ?? []);
  }

  analytics(workspaceId?: string): Promise<RemoteAnalyticsOverview> {
    return this.call("GET", "/analytics", { query: workspaceId ? { workspace_id: workspaceId } : undefined });
  }
}

export { OpenPostRequestError };
