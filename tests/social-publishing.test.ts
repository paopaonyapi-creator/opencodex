// Phase 20.60 — Social Publishing control plane tests.
//
// Covers the spec §30 matrix against a deterministic in-memory OpenPost
// (tests/helpers/openpost-fake.ts): capability mapping, rendition validation,
// hash-bound approvals + invalidation, policy allow/deny, idempotency, retry
// classification, ambiguous-outcome handling, reconciliation, analytics
// null-preservation, secret redaction, and the management API surface.
//
// Flow note (spec §14): the schedule time is part of the approved content, so
// every dispatch test binds the schedule BEFORE approval.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { canonicalJson, computeContentHash, deliveryIdempotencyKey, materialState, scheduleWithinTolerance } from "../src/agent-os/social-publishing/content-hash";
import { aggregatePublicationStatus, nextBackoffSeconds, mayResubmit } from "../src/agent-os/social-publishing/delivery";
import { classifyOpenPostError, mapRemoteStatus, OpenPostRequestError } from "../src/agent-os/social-publishing/openpost/errors";
import { mapAnalyticsSummary, mapDeliveryState, mapReadinessState } from "../src/agent-os/social-publishing/openpost/mapper";
import { redactSecrets } from "../src/agent-os/social-publishing/secrets";
import { validateRendition } from "../src/agent-os/social-publishing/renditions";
import { detectMimeFromBytes } from "../src/agent-os/social-publishing/assets";
import { SocialPublishingService, resetSocialPublishingServiceForTests, setSocialPublishingServiceForTests } from "../src/agent-os/social-publishing/service";
import { SocialPublishingHttpError, type DeliveryStatus, type Rendition } from "../src/agent-os/social-publishing/types";
import { FakeOpenPost } from "./helpers/openpost-fake";
import { handleManagementAPI } from "../src/server/management-api";
import type { OcxConfig } from "../src/types";
import type { SocialPublishingConfig } from "../src/agent-os/social-publishing/config";

// ---------------------------------------------------------------------------
// harness

const tempHomes: string[] = [];

function openFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "social-publishing-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
  return dir;
}

function makeConfig(overrides?: Partial<SocialPublishingConfig>): SocialPublishingConfig {
  return {
    enabled: true,
    defaultInstanceId: "main",
    defaultBaseUrl: "http://127.0.0.1:1",
    apiToken: "",
    apiTokenSecretRef: "",
    mcpUrl: "",
    mcpTokenSecretRef: "",
    transport: "http",
    connectTimeoutMs: 1000,
    requestTimeoutMs: 5000,
    maxResponseBytes: 8 * 1024 * 1024,
    reconcileIntervalSec: 60,
    capabilityCacheTtlSec: 300,
    approvalMode: "human_required",
    maxDeliveryAttempts: 3,
    analyticsSyncEnabled: true,
    analyticsSyncIntervalMin: 60,
    ...overrides,
  };
}

function makeService(fake: FakeOpenPost, overrides?: Partial<SocialPublishingConfig>): SocialPublishingService {
  return new SocialPublishingService({ config: makeConfig(overrides), transportFactory: () => fake });
}

async function fullSetup(service: SocialPublishingService) {
  const instance = service.registerInstance({ name: "main", baseUrl: "http://127.0.0.1:1" });
  const { accounts } = await service.syncInstance(instance.id);
  const mastodon = accounts.find((a) => a.platform === "mastodon")!;
  const tiktok = accounts.find((a) => a.platform === "tiktok")!;
  const instagram = accounts.find((a) => a.platform === "instagram")!;
  return { instance, mastodon, tiktok, instagram };
}

function futureSchedule(): string {
  return new Date(Date.now() + 3600_000).toISOString();
}

function seedPngAsset(dir: string, bytes: Uint8Array): string {
  const path = join(dir, "asset-" + randomUUID().slice(0, 8) + ".png");
  writeFileSync(path, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const id = "ga_" + randomUUID().slice(0, 12);
  openAgentOsDb()
    .query(
      "INSERT INTO gen_assets (id, filename, storage_path, mime_type, file_size, sha256, asset_type, width, height, duration_seconds, prompt, negative_prompt, generation_metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    const ts = new Date().toISOString();
  openAgentOsDb()
    .query(
      "INSERT INTO gen_assets (id, filename, storage_path, mime_type, file_size, sha256, asset_type, width, height, duration_seconds, prompt, negative_prompt, generation_metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, "generated.png", path, "image/png", bytes.length, sha, "image", 32, 32, null, "test prompt", "", "{}", ts, ts);
  return id;
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
}

// ---------------------------------------------------------------------------
// pure-function units

describe("phase 20.60 content hashing", () => {
  test("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 2] } })).toBe(canonicalJson({ a: { c: [3, 2], d: 2 }, b: 1 }));
  });

  test("material edits change the hash; processing-only fields never participate", () => {
    const base: Rendition = {
      id: "r1", publicationId: "p1", accountId: "a1", platform: "mastodon", format: "post",
      title: "t", caption: "hello", description: null, hashtags: ["#x"], assetRefs: ["sha-1"],
      providerSettings: {}, scheduledAt: null,
      capabilitySnapshot: { textLimit: 500, titleRequired: false, descriptionRequired: false, intents: ["post"], mediaShapes: {}, nativeScheduling: true, openpostQueued: true, requiresAppReview: false, requiresPublicMedia: null, unavailableReason: null, caveats: [], known: true, raw: {} },
      capabilitySnapshotAt: "2026-01-01", validationStatus: "valid", validationIssues: [], approvalStatus: "approved",
      contentHash: "", deliveryStatus: "published", openpostPublicationRef: "pub-9", openpostRenditionRef: "rend-9",
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    };
    const h1 = computeContentHash(materialState(base, "acc-ref"));
    expect(computeContentHash(materialState({ ...base, caption: "hello!" }, "acc-ref"))).not.toBe(h1);
    expect(computeContentHash(materialState({ ...base, assetRefs: ["sha-2"] }, "acc-ref"))).not.toBe(h1);
    expect(computeContentHash(materialState(base, "acc-other"))).not.toBe(h1);
    expect(computeContentHash(materialState({ ...base, deliveryStatus: "draft", openpostPublicationRef: null }, "acc-ref"))).toBe(h1);
  });

  test("schedule tolerance: one minute drift keeps approval valid", () => {
    expect(scheduleWithinTolerance("2026-09-16T10:00:00Z", "2026-09-16T10:00:30Z")).toBe(true);
    expect(scheduleWithinTolerance("2026-09-16T10:00:00Z", "2026-09-16T10:05:00Z")).toBe(false);
    expect(scheduleWithinTolerance(null, "2026-09-16T10:00:00Z")).toBe(false);
  });

  test("idempotency keys are stable per operation scope and differ per operation", () => {
    const args = { workspaceScope: "ws-1", publicationId: "p1", renditionId: "all", contentHash: "h", operationType: "schedule" as const, targetSchedule: "2026-09-17T10:00:00Z" };
    expect(deliveryIdempotencyKey(args)).toBe(deliveryIdempotencyKey({ ...args }));
    expect(deliveryIdempotencyKey(args)).not.toBe(deliveryIdempotencyKey({ ...args, operationType: "publish_now" as const }));
    expect(deliveryIdempotencyKey(args)).not.toBe(deliveryIdempotencyKey({ ...args, targetSchedule: "2026-09-17T11:00:00Z" }));
  });
});

describe("phase 20.60 delivery math", () => {
  test("backoff is bounded and exhausts at max attempts", () => {
    const first = nextBackoffSeconds(1, 5);
    expect(first.delaySeconds).toBeGreaterThanOrEqual(12);
    expect(first.delaySeconds).toBeLessThanOrEqual(18);
    expect(nextBackoffSeconds(9, 5).exhausted).toBe(true);
  });

  test("aggregate status: published only when every rendition published", () => {
    const r = (deliveryStatus: DeliveryStatus) => ({ deliveryStatus });
    expect(aggregatePublicationStatus([r("published"), r("published")], "dispatching")).toBe("published");
    expect(aggregatePublicationStatus([r("published"), r("failed_final")], "dispatching")).toBe("partial_success");
    expect(aggregatePublicationStatus([r("failed_final"), r("failed_final")], "dispatching")).toBe("failed");
    expect(aggregatePublicationStatus([r("scheduled")], "approved")).toBe("scheduled");
  });

  test("no resubmission once a remote ref exists (OpenPost owns the queue)", () => {
    expect(mayResubmit({ attemptCount: 1, maxAttempts: 5, remoteOperationRef: "pub-1", status: "failed_retryable" })).toBe(false);
    expect(mayResubmit({ attemptCount: 1, maxAttempts: 5, remoteOperationRef: null, status: "failed_retryable" })).toBe(true);
    expect(mayResubmit({ attemptCount: 9, maxAttempts: 5, remoteOperationRef: null, status: "pending" })).toBe(false);
  });
});

describe("phase 20.60 error classification and mapping", () => {
  test("remote statuses map to stable error classes", () => {
    expect(mapRemoteStatus(401, "").code).toBe("OPENPOST_AUTH_FAILED");
    expect(mapRemoteStatus(429, "").code).toBe("OPENPOST_RATE_LIMITED");
    expect(mapRemoteStatus(422, "bad").code).toBe("OPENPOST_VALIDATION_ERROR");
    expect(mapRemoteStatus(500, "").code).toBe("OPENPOST_UNAVAILABLE");
    expect(mapRemoteStatus(404, "").code).toBe("OPENPOST_REMOTE_NOT_FOUND");
  });

  test("classification: retryable vs non-retryable vs ambiguous", () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    expect(classifyOpenPostError(abortError).errorClass).toBe("ambiguous");
    expect(classifyOpenPostError(new OpenPostRequestError(mapRemoteStatus(503, ""))).errorClass).toBe("retryable");
    expect(classifyOpenPostError(new OpenPostRequestError(mapRemoteStatus(401, ""))).errorClass).toBe("non_retryable");
    expect(classifyOpenPostError(new SocialPublishingHttpError("SOCIAL_POLICY_DENIED", 403, "denied")).errorClass).toBe("non_retryable");
  });

  test("bearer tokens are redacted from operator-facing text", () => {
    const text = redactSecrets("Authorization: Bearer abc123def and Authorization: Bearer sk-live-xyz");
    expect(text).not.toContain("abc123def");
    expect(text).toContain("***");
  });
});

describe("phase 20.60 upstream mapping", () => {
  test("delivery states map with unknown fallback and reconciliation recovery", () => {
    expect(mapDeliveryState("published")).toBe("published");
    expect(mapDeliveryState("SCHEDULED")).toBe("scheduled");
    expect(mapDeliveryState("failed_retryable")).toBe("failed_retryable");
    expect(mapDeliveryState("weird_future_state", "reconcile")).toBe("reconciliation_required");
    expect(mapDeliveryState("weird_future_state", null)).toBe("unknown");
    expect(mapDeliveryState(null)).toBe("unknown");
  });

  test("readiness states map", () => {
    expect(mapReadinessState("ready")).toBe("ready");
    expect(mapReadinessState("requires_reauth")).toBe("requires_reauth");
    expect(mapReadinessState("mystery")).toBe("unknown");
  });

  test("missing analytics metrics stay null, never zero", () => {
    const mapped = mapAnalyticsSummary({ summary: { views: { total: 1200 }, impressions: { total: 3400 }, reach: null, engagement: {}, followers: {} } });
    expect(mapped.views).toBe(1200);
    expect(mapped.impressions).toBe(3400);
    expect(mapped.reach).toBeNull();
    expect(mapped.engagements).toBeNull();
    expect(mapped.followersDelta).toBeNull();
  });

  test("MIME detection uses magic bytes", () => {
    expect(detectMimeFromBytes(pngBytes())).toBe("image/png");
    expect(detectMimeFromBytes(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });
});

describe("phase 20.60 rendition validation (capability driven)", () => {
  test("unknown capability is a warning, never treated as a satisfied limit", () => {
    const caps = { textLimit: null, titleRequired: null, descriptionRequired: null, intents: [], mediaShapes: {}, nativeScheduling: null, openpostQueued: null, requiresAppReview: null, requiresPublicMedia: null, unavailableReason: null, caveats: [], known: false, raw: {} };
    const result = validateRendition({ rendition: { title: null, caption: "x".repeat(9000), description: null, format: "post", hashtags: [], assetRefs: [] }, capabilities: caps, priorIssues: [] });
    expect(result.status).toBe("valid");
    expect(result.issues.some((i) => i.code === "capability.unknown")).toBe(true);
  });

  test("known limits are enforced", () => {
    const caps = { textLimit: 500, titleRequired: false, descriptionRequired: true, intents: ["post"], mediaShapes: {}, nativeScheduling: true, openpostQueued: true, requiresAppReview: false, requiresPublicMedia: null, unavailableReason: null, caveats: [], known: true, raw: {} };
    const over = validateRendition({ rendition: { title: null, caption: "x".repeat(501), description: null, format: "post", hashtags: [], assetRefs: [] }, capabilities: caps, priorIssues: [] });
    expect(over.status).toBe("invalid");
    const missingDescription = validateRendition({ rendition: { title: null, caption: "ok", description: null, format: "post", hashtags: [], assetRefs: [] }, capabilities: caps, priorIssues: [] });
    expect(missingDescription.status).toBe("invalid");
    expect(missingDescription.issues.some((i) => i.code === "content.description_required")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration against the in-memory OpenPost

describe("phase 20.60 service integration (fake OpenPost)", () => {
  let fake: FakeOpenPost;
  let service: SocialPublishingService;
  let home: string;

  beforeEach(() => {
    home = openFreshDb();
    process.env.PAO_OPENPOST_API_TOKEN = "test-token-not-real";
    fake = new FakeOpenPost();
    service = makeService(fake);
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    delete process.env.PAO_OPENPOST_API_TOKEN;
    resetSocialPublishingServiceForTests();
  });

  test("instance health reports ready and failure paths update status", async () => {
    const instance = service.registerInstance({ name: "main", baseUrl: "http://127.0.0.1:1" });
    const healthy = await service.testInstance(instance.id);
    expect(healthy.status).toBe("healthy");

    fake.faults.push({ match: "/ready", status: 401, times: 1 });
    const degraded = await service.testInstance(instance.id);
    expect(degraded.status).toBe("degraded");
    expect(degraded.lastErrorCode).toBe("OPENPOST_AUTH_FAILED");
  });

  test("account sync persists readiness and capability data per account", async () => {
    const { mastodon, instagram } = await fullSetup(service);
    expect(mastodon.readinessState).toBe("ready");
    expect(mastodon.capabilities.known).toBe(true);
    expect(mastodon.capabilities.textLimit).toBe(500);
    expect(instagram.readinessState).toBe("requires_reauth");
    // adapter presence does not imply READY for the disconnected account:
    expect(instagram.readinessState).not.toBe("ready");
  });

  test("asset handoff uploads once and dedupes the second identical sha", async () => {
    const { mastodon } = await fullSetup(service);
    const assetId = seedPngAsset(home, pngBytes());
    const publication = service.createPublication({ sourceType: "image", assetIds: [assetId], masterCaption: "hello world", masterTags: ["pao"] });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    const assets = service.store.listPublicationAssets(publication.id);
    expect(assets).toHaveLength(1);
    expect(assets[0].openpostMediaRef).toBeTruthy();
    expect(assets[0].mimeType).toBe("image/png"); // sniffed from bytes
    const transfersAfterFirst = fake.byteTransfers;
    expect(transfersAfterFirst).toBe(1);

    // second publication with the same bytes reuses the upstream media id
    const publication2 = service.createPublication({ sourceType: "image", assetIds: [assetId], masterCaption: "again" });
    await service.generateRenditions(publication2.id, { accounts: [mastodon.id] });
    const assets2 = service.store.listPublicationAssets(publication2.id);
    expect(assets2[0].openpostMediaRef).toBe(assets[0].openpostMediaRef);
    expect(fake.byteTransfers).toBe(1); // deduped: no second byte transfer
  });

  test("capability-driven planning blocks unsupported intents and requires titles", async () => {
    const { tiktok } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "text only" });
    const renditions = await service.generateRenditions(publication.id, { accounts: [tiktok.id], format: "post" });
    expect(renditions[0].validationStatus).toBe("invalid");
    const issues = renditions[0].validationIssues;
    expect(issues.some((i) => i.code === "capability.intent_unsupported")).toBe(true);
    expect(issues.some((i) => i.code === "content.title_required")).toBe(true);
  });

  test("full approve → schedule → publish flow dispatches exactly once per step", async () => {
    const { mastodon } = await fullSetup(service);
    const scheduledAt = futureSchedule();
    const publication = service.createPublication({ sourceType: "text", masterCaption: "hello fediverse", scheduledAt });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    const job = await service.schedulePublication(publication.id, { scheduledAt });
    expect(job.status).toBe("completed");
    expect(job.remoteOperationRef).toContain("pub-");
    expect(fake.mutationLog.filter((m) => m.path === "/publications" && m.method === "POST")).toHaveLength(1);
    expect(fake.mutationLog.some((m) => m.path.endsWith("/schedule"))).toBe(true);

    let state = service.getPublication(publication.id);
    expect(state.renditions[0].deliveryStatus).toBe("scheduled");
    expect(state.publication.status).toBe("scheduled");

    const publishJob = await service.publishNow(publication.id, { type: "human", id: "operator-1" });
    expect(publishJob.status).toBe("completed");
    state = service.getPublication(publication.id);
    expect(state.renditions[0].deliveryStatus).toBe("published");
    expect(state.publication.status).toBe("published");
    expect(fake.mutationLog.filter((m) => m.path === "/publications" && m.method === "POST")).toHaveLength(1); // still one remote publication
  });

  test("scheduling twice reuses the same job (idempotency, no duplicate remote mutation)", async () => {
    const { mastodon } = await fullSetup(service);
    const scheduledAt = futureSchedule();
    const publication = service.createPublication({ sourceType: "text", masterCaption: "idempotent", scheduledAt });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    const job1 = await service.schedulePublication(publication.id, { scheduledAt });
    const mutationsAfterFirst = fake.mutationLog.length;
    const job2 = await service.schedulePublication(publication.id, { scheduledAt });
    expect(job2.id).toBe(job1.id);
    expect(fake.mutationLog.length).toBe(mutationsAfterFirst);
  });

  test("editing approved content invalidates the hash-bound approval and blocks publish", async () => {
    const { mastodon } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "original" });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    service.updatePublication(publication.id, { masterCaption: "edited after approval" });
    const state = service.getPublication(publication.id);
    expect(state.renditions[0].approvalStatus).toBe("stale");
    await expect(service.publishNow(publication.id)).rejects.toThrow(/approval/i);
  });

  test("moving the schedule outside tolerance after approval is blocked", async () => {
    const { mastodon } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "reschedule test", scheduledAt: futureSchedule() });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    const moved = new Date(Date.now() + 48 * 3600_000).toISOString();
    await expect(service.schedulePublication(publication.id, { scheduledAt: moved })).rejects.toThrow(/re-approval/);
  });

  test("publish without any approval is blocked", async () => {
    const { mastodon } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "no approval" });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    await expect(service.publishNow(publication.id)).rejects.toThrow(SocialPublishingHttpError);
  });

  test("non-ready accounts are blocked before dispatch", async () => {
    const { instagram } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "instagram test", scheduledAt: futureSchedule() });
    await service.generateRenditions(publication.id, { accounts: [instagram.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });
    await expect(service.publishNow(publication.id)).rejects.toThrow(/requires_reauth|readiness/);
  });

  test("validation failures block dispatch even with approval", async () => {
    const { mastodon } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "x".repeat(600), scheduledAt: futureSchedule() });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    expect(service.getPublication(publication.id).renditions[0].validationStatus).toBe("invalid");
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });
    await expect(service.publishNow(publication.id)).rejects.toThrow(/exceeds the account text limit/);
  });

  test("retryable upstream failure backs off, then a manual retry completes", async () => {
    const { mastodon } = await fullSetup(service);
    const scheduledAt = futureSchedule();
    const publication = service.createPublication({ sourceType: "text", masterCaption: "flaky upstream", scheduledAt });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    // two faults: the correlated lookup swallows the first, the create consumes the second
    fake.faults.push({ match: "/publications", status: 503, times: 2 });
    const job = await service.schedulePublication(publication.id, { scheduledAt });
    expect(job.status).toBe("failed_retryable");
    expect(job.attemptCount).toBe(1);
    expect(job.nextAttemptAt).toBeTruthy();

    const retried = await service.retryJob(job.id);
    expect(retried.status).toBe("completed");
    expect(fake.mutationLog.filter((m) => m.path === "/publications" && m.method === "POST")).toHaveLength(1);
  });

  test("ambiguous timeout parks the job in reconciliation; correlated retry recovers without duplicating", async () => {
    const { mastodon } = await fullSetup(service);
    const scheduledAt = futureSchedule();
    const publication = service.createPublication({ sourceType: "text", masterCaption: "ambiguous", scheduledAt });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });

    fake.faults.push({ match: "/publications", abort: true, times: 2 });
    const job = await service.schedulePublication(publication.id, { scheduledAt });
    expect(job.status).toBe("reconciliation_required");
    expect(job.lastErrorClass).toBe("ambiguous");

    const resolved = await service.retryJob(job.id);
    expect(resolved.status).toBe("completed");
    // the aborted create never landed; the retry creates exactly one remote publication
    expect(fake.mutationLog.filter((m) => m.path === "/publications" && m.method === "POST")).toHaveLength(1);
    expect(service.getPublication(publication.id).publication.status).toBe("scheduled");
  });

  test("reconciliation syncs remote delivery state into renditions", async () => {
    const { mastodon } = await fullSetup(service);
    const scheduledAt = futureSchedule();
    const publication = service.createPublication({ sourceType: "text", masterCaption: "reconcile me", scheduledAt });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });
    await service.schedulePublication(publication.id, { scheduledAt });

    const remoteId = service.getPublication(publication.id).renditions[0].openpostPublicationRef!;
    const remote = fake.publications.find((p) => p.id === remoteId)!;
    remote.renditions[0].delivery = { state: "retry_scheduled", recovery_action: "retry", external_id: null, error_code: "provider_down" };

    await service.reconcilePublication(publication.id);
    const state = service.getPublication(publication.id);
    expect(state.renditions[0].deliveryStatus).toBe("failed_retryable");
  });

  test("analytics sync stores null for missing metrics and keeps the raw payload", async () => {
    await fullSetup(service);
    const synced = await service.syncAnalytics();
    expect(synced).toBe(3);
    const snapshots = service.listAnalytics();
    expect(snapshots.length).toBe(3);
    const snapshot = snapshots[0];
    expect(snapshot.views).toBe(1200);
    expect(snapshot.reach).toBeNull();
    expect(snapshot.followersDelta).toBeNull();
    expect(snapshot.rawMetrics["summary"]).toBeTruthy();
  });

  test("audit trail records high-impact operations", async () => {
    const { mastodon } = await fullSetup(service);
    const publication = service.createPublication({ sourceType: "text", masterCaption: "audited" });
    await service.generateRenditions(publication.id, { accounts: [mastodon.id] });
    service.requestApproval(publication.id);
    service.approve(publication.id, { decision: "approved", approverId: "operator-1" });
    const actions = service.store.listAudit(50).map((e) => e.action);
    expect(actions).toContain("publication.created");
    expect(actions).toContain("approval.approved");
  });

  test("disabled module refuses mutations", () => {
    const disabled = new SocialPublishingService({ config: makeConfig({ enabled: false }), transportFactory: () => fake });
    expect(() => disabled.requireEnabled()).toThrow(/disabled/);
  });
});

// ---------------------------------------------------------------------------
// management API surface

describe("phase 20.60 management routes", () => {
  let fake: FakeOpenPost;
  let home: string;

  beforeEach(() => {
    home = openFreshDb();
    process.env.PAO_OPENPOST_API_TOKEN = "test-token-not-real";
    fake = new FakeOpenPost();
    setSocialPublishingServiceForTests(makeService(fake));
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    delete process.env.PAO_OPENPOST_API_TOKEN;
    resetSocialPublishingServiceForTests();
  });

  function baseConfig(): OcxConfig {
    return { port: 10100, hostname: "127.0.0.1", defaultProvider: "a", providers: [] } as unknown as OcxConfig;
  }

  async function api(method: string, path: string, body?: unknown): Promise<Response> {
    const url = new URL("http://127.0.0.1:10100" + path);
    const response = await handleManagementAPI(
      new Request(url, { method, headers: { Host: url.host }, body: body === undefined ? undefined : JSON.stringify(body) }),
      url,
      baseConfig(),
      { saveConfigPreservingClaudeCode: () => {} },
    );
    expect(response).not.toBeNull();
    return response!;
  }

  test("health endpoint reports the phase and counters", async () => {
    const response = await api("GET", "/api/agent-os/social-publishing/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["phase"]).toBe("20.60");
    expect(body["publications"]).toBe(0);
  });

  test("instance registration, listing, sync, and mcp tool catalogue", async () => {
    const created = await api("POST", "/api/agent-os/social-publishing/instances", { name: "main", baseUrl: "http://127.0.0.1:1" });
    expect(created.status).toBe(201);
    const listed = await api("GET", "/api/agent-os/social-publishing/instances");
    const body = (await listed.json()) as { instances: Array<{ name: string }> };
    expect(body.instances.some((i) => i.name === "main")).toBe(true);

    const tools = await api("GET", "/api/agent-os/social-publishing/mcp-tools");
    const toolBody = (await tools.json()) as { tools: Array<{ name: string; riskTier: string }> };
    expect(toolBody.tools.some((t) => t.name === "social_publish_publication" && t.riskTier === "R3")).toBe(true);
    expect(toolBody.tools.some((t) => t.name === "social_list_accounts" && t.riskTier === "R0")).toBe(true);

    const sync = await api("POST", "/api/agent-os/social-publishing/instances/main/sync");
    expect(sync.status).toBe(200);
    const accounts = (await sync.json()) as { accounts: Array<{ platform: string }> };
    expect(accounts.accounts.map((a) => a.platform)).toContain("mastodon");
  });

  test("full publication flow through the API", async () => {
    await api("POST", "/api/agent-os/social-publishing/instances", { name: "main", baseUrl: "http://127.0.0.1:1" });
    await api("POST", "/api/agent-os/social-publishing/instances/main/sync");
    const accountsResponse = await api("GET", "/api/agent-os/social-publishing/accounts");
    const accounts = (await accountsResponse.json()) as { accounts: Array<{ id: string; platform: string }> };
    const mastodon = accounts.accounts.find((a) => a.platform === "mastodon")!;

    const scheduledAt = futureSchedule();
    const created = await api("POST", "/api/agent-os/social-publishing/publications", {
      sourceType: "text",
      masterCaption: "route flow",
      scheduledAt,
      actorType: "human",
    });
    expect(created.status).toBe(201);
    const publication = ((await created.json()) as { publication: { id: string } }).publication;

    const renditions = await api("POST", "/api/agent-os/social-publishing/publications/" + publication.id + "/generate-renditions", { accounts: [mastodon.id] });
    expect(renditions.status).toBe(200);

    await api("POST", "/api/agent-os/social-publishing/publications/" + publication.id + "/request-approval", {});
    const approved = await api("POST", "/api/agent-os/social-publishing/publications/" + publication.id + "/approve", { decision: "approved", approverId: "operator-1" });
    expect(approved.status).toBe(201);

    const scheduled = await api("POST", "/api/agent-os/social-publishing/publications/" + publication.id + "/schedule", { scheduledAt });
    expect(scheduled.status).toBe(202);
    const job = (await scheduled.json()) as { job: { status: string } };
    expect(job.job.status).toBe("completed");

    const detail = await api("GET", "/api/agent-os/social-publishing/publications/" + publication.id);
    const detailBody = (await detail.json()) as { publication: { status: string }; renditions: Array<{ deliveryStatus: string }> };
    expect(detailBody.publication.status).toBe("scheduled");
    expect(detailBody.renditions[0].deliveryStatus).toBe("scheduled");

    const audit = await api("GET", "/api/agent-os/social-publishing/audit");
    expect(audit.status).toBe(200);
  });

  test("unknown routes 404 inside the namespace", async () => {
    const response = await api("GET", "/api/agent-os/social-publishing/definitely-not-a-route");
    expect(response.status).toBe(404);
  });
});
