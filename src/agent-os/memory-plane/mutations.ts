// Phase 20.41 — Preview-before-mutation engine (spec §3.5, §16, §17):
// preview → impact snapshot → signed confirmation receipt → exact
// validation → mutation. Stale state, expiry and replayed receipts are all
// rejected; historical trace/supersession snapshots are preserved. The
// receipt is server-issued and re-verified cryptographically at confirm —
// client-provided impact data is never trusted.

import { createHash } from "node:crypto";
import { signReceipt, verifyReceipt } from "./hashing";
import type { MemoryOpsStore } from "./store-ops";
import type { MutationAction, MutationConfirmResult, MutationPreview } from "./types";

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface ForgetImpact {
  chunks: number;
  embeddings: number;
  tagLinks: number;
  supersessionSnapshotsPreserved: boolean;
  historicalTraceLinksPreserved: boolean;
}

export class MutationEngine {
  constructor(private readonly store: MemoryOpsStore) {}

  /** Stage 1: forget preview. Snapshot the current revision/hash and impact
   *  counts; return a server-signed receipt. */
  previewForget(memoryId: string, workspaceId: string): MutationPreview {
    const memory = this.store.getMemory(memoryId);
    if (!memory) throw new Error("[NOT_FOUND] memory not found: " + memoryId);
    const chunks = this.store.countChunks(memoryId, memory.currentRevision);
    const tagLinks = this.store.tagsForMemory(memoryId, memory.currentRevision).length;
    const impact: ForgetImpact = {
      chunks,
      embeddings: chunks,
      tagLinks,
      supersessionSnapshotsPreserved: true,
      historicalTraceLinksPreserved: true,
    };
    const snapshotHash = "sha256:" + createHash("sha256").update(memory.currentHash + ":" + memory.currentRevision).digest("hex").slice(0, 24);
    const previewId = "mpv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const receipt = signReceipt({
      previewId,
      action: "forget_memory",
      targetId: memoryId,
      expectedRevision: memory.currentRevision,
      expectedSourceHash: memory.currentHash,
      snapshotHash,
      expiresAtMs: Date.now() + PREVIEW_TTL_MS,
    });
    if (!receipt) {
      throw new Error("[SIGNING_SECRET_MISSING] destructive confirmations are disabled without a signing secret");
    }
    this.store.insertPreview(workspaceId, {
      previewId,
      action: "forget_memory",
      targetType: "memory",
      targetId: memoryId,
      expectedRevision: memory.currentRevision,
      expectedSourceHash: memory.currentHash,
      impact: impact as unknown as Record<string, unknown>,
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    return {
      previewId,
      action: "forget_memory",
      targetType: "memory",
      targetId: memoryId,
      expectedRevision: memory.currentRevision,
      expectedSourceHash: memory.currentHash,
      impact: impact as unknown as Record<string, unknown>,
      confirmationReceipt: receipt,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
  }

  /** Stage 2: forget confirm. Validates receipt signature, preview state,
   *  target immutability (revision+hash), then forgets. */
  confirmForget(memoryId: string, receipt: string, workspaceId: string): MutationConfirmResult {
    const payload = verifyReceipt(receipt);
    if (!payload) {
      return { ok: false, status: "not_found", detail: "receipt is invalid or the signing secret is unavailable" };
    }
    if (payload.action !== "forget_memory" || payload.targetId !== memoryId) {
      return { ok: false, status: "stale_preview", detail: "receipt is bound to a different action/target" };
    }
    const previewState = this.store.getPreview(payload.previewId);
    if (!previewState) {
      return { ok: false, status: "not_found", detail: "preview no longer exists" };
    }
    if (previewState.consumed) {
      return { ok: false, status: "already_consumed", detail: "receipt replay rejected — preview already consumed" };
    }
    if (previewState.expired || payload.expiresAtMs < Date.now()) {
      return { ok: false, status: "expired", detail: "preview expired — request a fresh preview" };
    }
    const memory = this.store.getMemory(memoryId);
    if (!memory || memory.status !== "active") {
      return { ok: false, status: "stale_preview", detail: "target no longer active" };
    }
    if (payload.expectedRevision !== memory.currentRevision || payload.expectedSourceHash !== memory.currentHash) {
      // Stale: the source changed after preview (spec §56). No mutation.
      return {
        ok: false,
        status: "stale_preview",
        detail: "source changed after preview (expected revision " + payload.expectedRevision + ", current " + memory.currentRevision + ")",
      };
    }
    this.store.consumePreview(payload.previewId);
    // Forgetting hides the active memory + removes derived chunks; historical
    // trace results and supersession snapshots are NEVER rewritten (§16.3).
    this.store.replaceChunks(memoryId, memory.currentRevision, memory.currentHash, [], null, null);
    this.store.markForgotten(memoryId);
    return {
      ok: true,
      status: "completed",
      detail: "memory forgotten; historical traces and supersession snapshots preserved",
      impact: previewState.preview.impact,
    };
  }

  /** Rebuild preview: bounded report of derived reindexing work. */
  previewRebuild(workspaceId: string, opts: { maxMemories: number; providerId: string; model: string }): MutationPreview {
    const memories = this.store.listMemories({ workspaceId, status: "active", limit: opts.maxMemories });
    let estimatedChunks = 0;
    for (const memory of memories) {
      estimatedChunks += this.store.countChunks(memory.id, memory.currentRevision);
    }
    const previewId = "mpv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const impact = {
      memoriesRequiringRebuild: memories.map((memory) => memory.id).slice(0, opts.maxMemories),
      estimatedChunks,
      provider: opts.providerId,
      model: opts.model,
      batchBounds: { maxMemoriesPerCall: opts.maxMemories, maxChunksPerCall: 256 },
      workClass: estimatedChunks > 256 ? "background_job_recommended" : "inline",
      affectedProjects: [...new Set(memories.map((memory) => memory.projectId).filter((value) => value !== null))],
    };
    const receipt = signReceipt({
      previewId,
      action: "rebuild_index",
      targetId: workspaceId,
      expectedRevision: null,
      expectedSourceHash: "sha256:" + createHash("sha256").update(JSON.stringify(memories.map((memory) => memory.id + ":" + memory.currentRevision))).digest("hex").slice(0, 24),
      snapshotHash: "sha256:rebuild",
      expiresAtMs: Date.now() + PREVIEW_TTL_MS,
    });
    if (!receipt) {
      throw new Error("[SIGNING_SECRET_MISSING] destructive confirmations are disabled without a signing secret");
    }
    this.store.insertPreview(workspaceId, {
      previewId,
      action: "rebuild_index",
      targetType: "index",
      targetId: workspaceId,
      expectedRevision: null,
      expectedSourceHash: null,
      impact,
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    return {
      previewId,
      action: "rebuild_index",
      targetType: "index",
      targetId: workspaceId,
      expectedRevision: null,
      expectedSourceHash: null,
      impact,
      confirmationReceipt: receipt,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
  }
}
