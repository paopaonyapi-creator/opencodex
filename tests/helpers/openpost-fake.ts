// Phase 20.60 test helper — deterministic in-memory OpenPost.
//
// Implements the OpenPostTransport seam (src/agent-os/social-publishing/
// openpost/transport.ts) against the same /api/v1 surface the fetch transport
// speaks, backed by in-memory state and configurable faults. No sockets, no
// randomness, no real social providers, and no network access at any point.

import type { OpenPostRequest, OpenPostResponse, OpenPostTransport } from "../../src/agent-os/social-publishing/openpost/transport";

export interface FakeAccount {
  id: string;
  platform: string;
  username: string;
  is_active: boolean;
}

export interface FakeCapability {
  provider: string;
  profile: string;
  text_limit: number | null;
  title_required: boolean;
  description_required: boolean;
  intents: string[];
  native_scheduling: boolean;
  openpost_queued: boolean;
  requires_app_review: boolean;
  caveats: string[];
}

export interface FakeRendition {
  id: string;
  social_account_id: string;
  body: string;
  title: string;
  description: string;
  status: string;
  delivery: { state: string; recovery_action: string; external_id: string | null; error_code: string | null } | null;
}

export interface FakePublication {
  id: string;
  workspace_id: string;
  title: string;
  source_text: string;
  content_profile: string;
  intent: string;
  status: string;
  revision: number;
  scheduled_at: string | null;
  media: string[];
  renditions: FakeRendition[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  lifecycleEvents?: Array<Record<string, unknown>>;
}

export interface FakeFault {
  /** Substring matched against the request path. */
  match: string;
  status?: number;
  abort?: boolean;
  /** How many matching calls the fault applies to. */
  times: number;
}

const FAKE_UPLOAD_URL = "https://storage.example/openpost/media-bucket";
const FAKE_MEDIA_URL = "https://media.example/openpost/library-object";

export class FakeOpenPost implements OpenPostTransport {
  readonly calls: string[] = [];
  readonly workspaces = [{ id: "ws-1", name: "Pao Workspace", role: "admin" }];
  accounts: FakeAccount[] = [
    { id: "acc-1", platform: "mastodon", username: "pao@social.example", is_active: true },
    { id: "acc-2", platform: "tiktok", username: "paohup", is_active: true },
    { id: "acc-3", platform: "instagram", username: "pao.hub", is_active: false },
  ];
  capabilities: FakeCapability[] = [
    {
      provider: "mastodon",
      profile: "default",
      text_limit: 500,
      title_required: false,
      description_required: false,
      intents: ["post"],
      native_scheduling: true,
      openpost_queued: true,
      requires_app_review: false,
      caveats: [],
    },
    {
      provider: "tiktok",
      profile: "default",
      text_limit: 2200,
      title_required: true,
      description_required: false,
      intents: ["video", "short_video"],
      native_scheduling: false,
      openpost_queued: true,
      requires_app_review: false,
      caveats: ["direct video upload only"],
    },
  ];
  readiness: Array<{ provider: string; state: string; blocking_issues: string[]; accounts: Array<{ account_id: string; state: string }> }> = [
    { provider: "mastodon", state: "ready", blocking_issues: [], accounts: [{ account_id: "acc-1", state: "ready" }] },
    { provider: "tiktok", state: "ready", blocking_issues: [], accounts: [{ account_id: "acc-2", state: "ready" }] },
    { provider: "instagram", state: "requires_reauth", blocking_issues: ["token expired"], accounts: [{ account_id: "acc-3", state: "requires_reauth" }] },
  ];
  publications: FakePublication[] = [];
  mediaShaToId = new Map<string, string>();
  analyticsSummary = {
    published: 1,
    views: { total: 1200 },
    impressions: { total: 3400 },
    reach: null,
    engagement: { total: 87 },
    followers: { total: null },
  };
  faults: FakeFault[] = [];
  /** Every remote mutation observed, for duplicate-mutation assertions. */
  mutationLog: Array<{ method: string; path: string }> = [];
  byteTransfers = 0;

  private nextId = 100;
  private id(prefix: string): string {
    this.nextId += 1;
    return prefix + "-" + String(this.nextId);
  }

  private takeFault(path: string): FakeFault | null {
    for (const fault of this.faults) {
      if (fault.times > 0 && path.includes(fault.match)) {
        fault.times -= 1;
        return fault;
      }
    }
    return null;
  }

  async request(req: OpenPostRequest): Promise<OpenPostResponse> {
    if (req.raw) {
      // Storage-byte transfer target: recorded, never dialed.
      this.calls.push("STORAGE_PUT recorded");
      this.byteTransfers += 1;
      return { status: 200, body: null };
    }
    const path = req.path;
    this.calls.push(req.method + " " + path);
    const fault = this.takeFault(path);
    if (fault?.abort) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (fault?.status) {
      return { status: fault.status, body: { error: "injected" } };
    }
    return this.route(req);
  }

  private route(req: OpenPostRequest): OpenPostResponse {
    const method = req.method;
    const path = req.path;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (method === "GET" && path === "/health") return { status: 200, body: { status: "ok" } };
    if (method === "GET" && path === "/ready") return { status: 200, body: { status: "ready", database: "ok" } };
    if (method === "GET" && path === "/workspaces") return { status: 200, body: { items: this.workspaces } };
    if (method === "GET" && path === "/accounts") return { status: 200, body: { items: this.accounts.map((a) => ({ ...a, account_id: a.id })) } };
    if (method === "GET" && path === "/capabilities") return { status: 200, body: { capabilities: this.capabilities, profiles: [] } };
    if (method === "GET" && path === "/provider-readiness") return { status: 200, body: { providers: this.readiness } };

    if (method === "POST" && path === "/media/upload-session") {
      const sha = String(body["client_sha256"] ?? "");
      const existing = this.mediaShaToId.get(sha);
      if (existing) {
        return { status: 200, body: { media_id: existing, deduped: true } };
      }
      const mediaId = this.id("media");
      this.mediaShaToId.set(sha, mediaId);
      return {
        status: 200,
        body: {
          media_id: mediaId,
          deduped: false,
          upload: { url: FAKE_UPLOAD_URL, method: "PUT", headers: { "content-type": String(body["mime_type"] ?? "application/octet-stream") }, object_key: mediaId, expires_at: "2030-01-01T00:00:00Z" },
          complete_url: "/api/v1/media/upload-session/complete",
        },
      };
    }
    if (method === "POST" && path.startsWith("/media/upload-session/") && path.endsWith("/complete")) {
      const mediaId = path.slice("/media/upload-session/".length, -"/complete".length);
      return {
        status: 200,
        body: { id: mediaId, deduped: false, mime_type: "image/png", size: 100, url: FAKE_MEDIA_URL, processing_status: "ready", analysis_status: "ready" },
      };
    }

    if (method === "GET" && path === "/publications") {
      const workspace = req.query?.["workspace_id"];
      const items = this.publications.filter((p) => !workspace || p.workspace_id === workspace);
      return { status: 200, body: { items } };
    }
    if (method === "POST" && path === "/publications") {
      this.mutationLog.push({ method, path });
      const publication: FakePublication = {
        id: this.id("pub"),
        workspace_id: String(body["workspace_id"] ?? "ws-1"),
        title: String(body["title"] ?? ""),
        source_text: String(body["source_text"] ?? ""),
        content_profile: String(body["content_profile"] ?? "default"),
        intent: String(body["intent"] ?? "post"),
        status: body["scheduled_at"] ? "scheduled" : "draft",
        revision: 1,
        scheduled_at: body["scheduled_at"] ? String(body["scheduled_at"]) : null,
        media: Array.isArray(body["media"]) ? body["media"].map(String) : [],
        renditions: (Array.isArray(body["renditions"]) ? body["renditions"] : []).map((r) => {
          const input = r as Record<string, unknown>;
          return {
            id: this.id("rend"),
            social_account_id: String(input["social_account_id"] ?? ""),
            body: String(input["body"] ?? ""),
            title: String(input["title"] ?? ""),
            description: String(input["description"] ?? ""),
            status: "draft",
            delivery: null,
          };
        }),
        metadata: (body["metadata"] ?? {}) as Record<string, unknown>,
        created_at: "2026-09-16T00:00:00.000Z",
        updated_at: "2026-09-16T00:00:00.000Z",
      };
      this.publications.push(publication);
      return { status: 201, body: publication };
    }
    if (method === "GET" && path.startsWith("/publications/") && !path.slice("/publications/".length).includes("/")) {
      const id = path.slice("/publications/".length);
      const found = this.publications.find((p) => p.id === id);
      return found ? { status: 200, body: found } : { status: 404, body: { error: "not found" } };
    }
    if (method === "DELETE" && path.startsWith("/publications/")) {
      const id = path.slice("/publications/".length);
      this.publications = this.publications.filter((p) => p.id !== id);
      return { status: 200, body: { deleted: true } };
    }
    if ((method === "GET" || method === "POST") && path.startsWith("/publications/") && path.endsWith("/events")) {
      const id = path.slice("/publications/".length, -"/events".length);
      const found = this.publications.find((p) => p.id === id);
      return found ? { status: 200, body: { items: found.lifecycleEvents ?? [] } } : { status: 404, body: { error: "not found" } };
    }
    if (method === "POST" && path.startsWith("/publications/") && path.endsWith("/validate")) {
      const id = path.slice("/publications/".length, -"/validate".length);
      const found = this.publications.find((p) => p.id === id);
      if (!found) return { status: 404, body: { error: "not found" } };
      const issues = found.renditions
        .filter((r) => r.body.length > 10000)
        .map((r) => ({ code: "text_limit", severity: "error", message: "body too long" }));
      return { status: 200, body: { valid: issues.length === 0, issues } };
    }
    if (method === "POST" && path.includes("/renditions/") && path.endsWith("/retry")) {
      const withoutSuffix = path.slice("/publications/".length, -"/retry".length);
      const [pubId, accountId] = withoutSuffix.split("/renditions/");
      const found = this.publications.find((p) => p.id === pubId);
      const rendition = found?.renditions.find((r) => r.social_account_id === accountId);
      if (found && rendition) {
        rendition.delivery = { state: "publishing", recovery_action: "reconcile", external_id: null, error_code: null };
        found.revision += 1;
        return { status: 200, body: { message: "retrying" } };
      }
      return { status: 404, body: { error: "rendition not found" } };
    }
    if (method === "POST" && path.startsWith("/publications/") && (path.endsWith("/schedule") || path.endsWith("/publish-now") || path.endsWith("/cancel") || path.endsWith("/retry-failed"))) {
      const id = path.slice("/publications/".length, path.lastIndexOf("/"));
      const found = this.publications.find((p) => p.id === id);
      if (!found) return { status: 404, body: { error: "not found" } };
      this.mutationLog.push({ method, path });
      if (Number(body["expected_revision"] ?? 0) !== found.revision) {
        return { status: 409, body: { error: "revision conflict" } };
      }
      const action = path.slice(path.lastIndexOf("/") + 1);
      if (action === "schedule") {
        found.status = "scheduled";
        found.scheduled_at = String(body["scheduled_at"] ?? found.scheduled_at ?? "");
        for (const rendition of found.renditions) {
          rendition.status = "scheduled";
          rendition.delivery = { state: "scheduled", recovery_action: "none", external_id: null, error_code: null };
        }
        this.pushEvent(found, "publication.scheduled", "scheduled");
        found.revision += 1;
        return { status: 200, body: { message: "scheduled", job_id: this.id("job"), publication_id: found.id, revision: found.revision } };
      }
      if (action === "publish-now") {
        found.status = "published";
        for (const rendition of found.renditions) {
          rendition.status = "published";
          rendition.delivery = { state: "published", recovery_action: "none", external_id: this.id("ext"), error_code: null };
        }
        this.pushEvent(found, "publication.published", "published");
        found.revision += 1;
        return { status: 200, body: { message: "published", job_id: this.id("job"), publication_id: found.id, revision: found.revision } };
      }
      if (action === "cancel") {
        found.status = "cancelled";
        for (const rendition of found.renditions) {
          rendition.status = "cancelled";
          rendition.delivery = { state: "cancelled", recovery_action: "none", external_id: null, error_code: null };
        }
        found.revision += 1;
        return { status: 200, body: { message: "cancelled", publication_id: found.id, revision: found.revision } };
      }
      return { status: 200, body: { message: "retrying", publication_id: found.id, revision: found.revision } };
    }
    if (method === "GET" && path === "/jobs") return { status: 200, body: { items: [] } };
    if (method === "GET" && path === "/analytics") {
      return { status: 200, body: { summary: this.analyticsSummary, publications: [], accounts: [], generated_at: "2026-09-16T00:00:00.000Z" } };
    }
    return { status: 404, body: { error: "no such endpoint: " + method + " " + path } };
  }

  private pushEvent(publication: FakePublication, type: string, status: string): void {
    const events = publication.lifecycleEvents ?? [];
    events.unshift({
      id: this.id("evt"),
      type,
      status,
      publication_id: publication.id,
      created_at: "2026-09-16T00:00:00.000Z",
      summary: type,
      superseded: false,
    });
    publication.lifecycleEvents = events;
  }

  /** Force one account's readiness for degraded-path tests. */
  setReadiness(accountId: string, state: string): void {
    const row = this.readiness.find((r) => r.accounts.some((a) => a.account_id === accountId));
    if (row) {
      row.state = state;
      row.accounts = row.accounts.map((a) => (a.account_id === accountId ? { ...a, state } : a));
    }
  }
}
