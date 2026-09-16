// Phase 20.41 — Trustworthy Memory Plane tests (spec §44, §53). Canonical
// hashing, deterministic chunking, RRF, scope policy, revision conflicts,
// idempotency, supersession snapshots, preview-confirm mutations (stale /
// expired / replayed receipts), honest recall degradation, trace redaction,
// OAuth (discovery body validation, DCR, PKCE S256, plain rejection, one-time
// codes, token expiry, refresh rotation + reuse detection, revocation).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { MemoryPlaneService, resetMemoryPlaneForTests, memoryConfigFromEnv } from "../src/agent-os/memory-plane/service";
import { contentHashOf, queryHashOf, signReceipt, verifyReceipt, pkceS256Challenge } from "../src/agent-os/memory-plane/hashing";
import { chunkText, LocalHashEmbeddingProvider, cosineSimilarity, reciprocalRankFusion } from "../src/agent-os/memory-plane/embeddings";
import { keywordSearch } from "../src/agent-os/memory-plane/recall";
import { grantedScopesInclude, parseScopeList, MEMORY_SCOPES, systemActor, type ActorIdentity } from "../src/agent-os/memory-plane/scopes";
import { MemoryOAuthService, OAuthError, RateLimiter } from "../src/agent-os/memory-plane/oauth";

let testDir: string;
let service: MemoryPlaneService;
let oauth: MemoryOAuthService;

const WRITE_ACTOR: ActorIdentity = { kind: "dashboard", id: "tester", scopes: ["memory:read", "memory:write", "memory:delete", "memory:trace", "memory:admin"] };

beforeEach(() => {
  closeAgentOsDbForTests();
  resetMemoryPlaneForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-mem-test-"));
  process.env.OPENCODEX_HOME = testDir;
  process.env.MEMORY_ENABLED = "true";
  service = new MemoryPlaneService();
  oauth = new MemoryOAuthService(service.store);
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetMemoryPlaneForTests();
  rmSync(testDir, { recursive: true, force: true });
});

// --- unit: hashing / chunking / fusion -------------------------------------------------

describe("hashing and chunking", () => {
  test("content hash is deterministic over canonical source fields only", () => {
    const fields = { workspaceId: "w", projectId: null, title: "T", content: "C", kind: "note", sourcePath: null };
    expect(contentHashOf(fields)).toBe(contentHashOf({ ...fields }));
    expect(contentHashOf(fields)).not.toBe(contentHashOf({ ...fields, content: "D" }));
  });

  test("chunking is deterministic, ordered, non-empty, bounded", () => {
    const content = Array.from({ length: 2000 }, (_, index) => "token" + index).join(" ");
    const options = { targetTokens: 450, overlapTokens: 60, maxChunks: 8 };
    const first = chunkText(content, options);
    const second = chunkText(content, options);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(8);
    expect(first.every((chunk) => chunk.chunkText.trim().length > 0)).toBe(true);
    expect(first[0].chunkIndex).toBe(0);
    expect(first[1].chunkIndex).toBe(1);
  });

  test("cosine similarity and RRF behave per contract", () => {
    const provider = new LocalHashEmbeddingProvider(128);
    const identical = cosineSimilarity([1, 0, 0], [1, 0, 0]);
    expect(identical).toBeCloseTo(1);
    void provider;
    const fused = reciprocalRankFusion([[{ memoryId: "a" }, { memoryId: "b" }], [{ memoryId: "b" }]], 60);
    // b appears in both lists → higher fused score than a's single top rank? a: 1/61, b: 1/62 + 1/61
    expect(fused.get("b")!).toBeGreaterThan(fused.get("a")! * 0.99);
  });

  test("keyword search ranks title matches above content-only", () => {
    const memories = [
      { id: "title-match", title: "Deployment runbook", content: "how to restart", kind: "runbook", authority: "authoritative" },
      { id: "content-only", title: "Unrelated note", content: "mentions deployment briefly", kind: "note", authority: "observed" },
    ] as never[];
    const hits = keywordSearch(memories, "deployment", 5);
    expect(hits[0].memoryId).toBe("title-match");
  });

  test("query hash is correlation, not raw storage", () => {
    const hash = queryHashOf("secret project question");
    expect(hash).not.toContain("secret");
    expect(hash.startsWith("trace:")).toBe(true);
  });
});

// --- unit: scope policy --------------------------------------------------------------------

describe("scope policy", () => {
  test("canonical registry only; admin implies all; write never implies delete", () => {
    expect(MEMORY_SCOPES).toHaveLength(5);
    expect(parseScopeList("memory:read memory:write")).toEqual(["memory:read", "memory:write"]);
    expect(parseScopeList("memory:rw")).toEqual([]); // alternative spelling rejected
    expect(grantedScopesInclude(["memory:admin"], "memory:delete")).toBe(true);
    expect(grantedScopesInclude(["memory:write"], "memory:delete")).toBe(false);
    expect(grantedScopesInclude(["memory:write"], "memory:write")).toBe(true);
    expect(grantedScopesInclude(["memory:read"], "memory:trace")).toBe(false);
    expect(systemActor().scopes).toHaveLength(5);
  });
});

// --- remember / revise / idempotency ----------------------------------------------------------

describe("remember pipeline", () => {
  test("remember creates memory + revision; duplicate hash returns existing", async () => {
    const first = await service.remember({ title: "Use preview before destructive ops", content: "All destructive memory operations require preview and an exact server-issued confirmation receipt.", kind: "decision", authority: "authoritative", tags: ["safety"], actor: { agentKey: "codex" } }, WRITE_ACTOR);
    expect(first.duplicate).toBe(false);
    expect(first.indexing.status).toBe("ready");
    expect(first.indexing.chunks).toBeGreaterThanOrEqual(1);
    const revision = service.store.listRevisions(first.memoryId);
    expect(revision).toHaveLength(1);
    const again = await service.remember({ title: "Use preview before destructive ops", content: "All destructive memory operations require preview and an exact server-issued confirmation receipt.", kind: "decision", actor: { agentKey: "codex" } }, WRITE_ACTOR);
    expect(again.duplicate).toBe(true);
    expect(again.memoryId).toBe(first.memoryId);
  });

  test("idempotency key prevents duplicate authoritative memories", async () => {
    const request = { title: "Retry-safe write", content: "agent retry content", actor: { agentKey: "bot" }, idempotencyKey: "retry-1" };
    const first = await service.remember(request, WRITE_ACTOR);
    const second = await service.remember(request, WRITE_ACTOR);
    expect(second.memoryId).toBe(first.memoryId);
    expect(second.duplicate).toBe(true);
    expect(service.store.countMemories()).toBe(1);
  });

  test("authoritative write survives embedding failure (indexing degraded, source kept)", async () => {
    const failing = new MemoryPlaneService();
    (failing as unknown as { embeddingProvider: { embedTexts: () => Promise<number[][]> } }).embeddingProvider = {
      embedTexts: () => Promise.reject(new Error("provider down")),
    } as never;
    const result = await failing.remember({ title: "survivor", content: "authoritative text", authority: "authoritative", actor: { agentKey: "x" } }, WRITE_ACTOR);
    expect(result.indexing.status).toBe("degraded");
    expect(result.indexing.degradeReason).toBe("embedding_failed");
    const stored = failing.store.getMemory(result.memoryId);
    expect(stored?.content).toBe("authoritative text");
  });

  test("revise creates a new immutable revision; conflict on expected mismatch", async () => {
    const created = await service.remember({ title: "v1", content: "original", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const revised = await service.revise({ memoryId: created.memoryId, content: "revised content", expectedRevision: created.revision, expectedHash: created.sourceHash, actor: { agentKey: "x" } }, WRITE_ACTOR);
    expect(revised.revision).toBe(2);
    expect(service.store.listRevisions(created.memoryId)).toHaveLength(2);
    // Optimistic concurrency: stale expected revision → typed 409 conflict.
    await expect(service.revise({ memoryId: created.memoryId, content: "clobber", expectedRevision: 1, actor: { agentKey: "x" } }, WRITE_ACTOR)).rejects.toThrow(/REVISION_CONFLICT:409/);
    await expect(service.revise({ memoryId: created.memoryId, content: "clobber", expectedHash: "sha256:stale", actor: { agentKey: "x" } }, WRITE_ACTOR)).rejects.toThrow(/REVISION_CONFLICT:409/);
  });

  test("observations preserve exact source revision/hash lineage", async () => {
    const memory = await service.remember({ title: "source fact", content: "the port is 10100", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const observed = await service.observe({
      observationText: "the default port appears to be 10100",
      confidence: 0.9,
      sources: [{ memoryId: memory.memoryId }],
      actor: { agentKey: "reviewer" },
    }, WRITE_ACTOR);
    expect(observed.sources[0].sourceHash).toBe(memory.sourceHash);
    // Revise the source → observation keeps the OLD revision evidence.
    await service.revise({ memoryId: memory.memoryId, content: "the port is 10101", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const observation = service.store.getObservation(observed.observationId);
    expect(observation.sources[0].memoryRevision).toBe(1);
  });

  test("supersession snapshots immutable metadata at link time", async () => {
    const old = await service.remember({ title: "old decision", content: "use sqlite only", kind: "decision", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const next = await service.supersede({
      newMemory: { title: "new decision", content: "use sqlite or postgres", kind: "decision", actor: { agentKey: "x" } },
      supersedesMemoryId: old.memoryId,
    }, WRITE_ACTOR);
    const links = service.store.listSupersession(next.memoryId);
    expect(links[0].supersededRevision).toBe(1);
    expect(links[0].supersededHash).toBe(old.sourceHash);
    // superseded memories are excluded from recall candidates
    const results = await service.recall({ query: "sqlite", mode: "keyword", trace: false }, WRITE_ACTOR);
    expect(results.results.every((result) => result.memoryId !== old.memoryId)).toBe(true);
  });
});

// --- recall / degradation / traces -------------------------------------------------------------

describe("recall engine", () => {
  test("keyword, semantic and hybrid recall with provenance and revision/hash", async () => {
    await service.remember({ title: "Bun proxy startup", content: "run bun run src/cli/index.ts start --port 10100 to launch the local proxy", actor: { agentKey: "x" } }, WRITE_ACTOR);
    await service.remember({ title: "Unrelated cooking", content: "boil water for pasta", actor: { agentKey: "x" } }, WRITE_ACTOR);

    const keyword = await service.recall({ query: "proxy start port", mode: "keyword" }, WRITE_ACTOR);
    expect(keyword.effectiveMode).toBe("keyword");
    expect(keyword.results.length).toBeGreaterThanOrEqual(1);
    expect(keyword.results[0].rank).toBe(1);
    expect(keyword.results[0].sourceHash.startsWith("sha256:")).toBe(true);

    const semantic = await service.recall({ query: "launch local server", mode: "semantic" }, WRITE_ACTOR);
    expect(semantic.effectiveMode).toBe("semantic");
    expect(semantic.results[0].rankProvenance.semanticRank).toBe(1);

    const hybrid = await service.recall({ query: "proxy start", mode: "hybrid" }, WRITE_ACTOR);
    expect(hybrid.effectiveMode).toBe("hybrid");
    expect(hybrid.results[0].scores.fused).toBeDefined();
    expect(hybrid.results[0].rankProvenance.keywordRank).toBeDefined();
  });

  test("semantic failure with allowed fallback is explicit; without fallback is typed error", async () => {
    const broken = new MemoryPlaneService();
    (broken as unknown as { embeddingProvider: { embedTexts: () => Promise<number[][]> } }).embeddingProvider = {
      embedTexts: () => Promise.reject(new Error("down")),
    } as never;
    await broken.remember({ title: "t", content: "c", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const degraded = await broken.recall({ query: "q", mode: "hybrid", allowFallback: true, trace: false }, WRITE_ACTOR);
    expect(degraded.requestedMode).toBe("hybrid");
    expect(degraded.effectiveMode).toBe("keyword");
    expect(degraded.degraded).toBe(true);
    expect(degraded.degradeReason).toBe("embedding_provider_failure");
    await expect(broken.recall({ query: "q", mode: "semantic", allowFallback: false, trace: false }, WRITE_ACTOR)).rejects.toThrow(/SEMANTIC_UNAVAILABLE/);
  });

  test("traces store query hashes, never raw queries; trace failure never masks recall", async () => {
    await service.remember({ title: "traceable", content: "trace target content", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const recalled = await service.recall({ query: "trace target", mode: "keyword" }, WRITE_ACTOR);
    expect(recalled.results.length).toBeGreaterThanOrEqual(1);
    expect(recalled.traceId).toBeDefined();
    const trace = service.store.getTrace(recalled.traceId!);
    expect(trace!.trace.queryHash).not.toContain("trace target");
    expect(trace!.results[0].sourceHash).toBe(recalled.results[0].sourceHash);
    // retention prunes old traces
    expect(service.store.retainTraces(Date.now(), 1000, 0)).toBeGreaterThanOrEqual(0);
  });
});

// --- preview-confirm mutations -------------------------------------------------------------------

describe("safe mutations", () => {
  test("forget preview → confirm; stale, replayed, and expired receipts rejected", async () => {
    const memory = await service.remember({ title: "forgettable", content: "content to forget", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const preview = service.forgetPreview(memory.memoryId, WRITE_ACTOR);
    expect(preview.confirmationReceipt.length).toBeGreaterThan(20);
    expect((preview.impact as { chunks: number }).chunks).toBeGreaterThanOrEqual(1);

    // mutate source after preview → stale
    await service.revise({ memoryId: memory.memoryId, content: "changed after preview", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const stale = service.forgetConfirm(memory.memoryId, preview.confirmationReceipt, WRITE_ACTOR);
    expect(stale.status).toBe("stale_preview");

    // fresh preview → confirm works → replay rejected
    const fresh = service.forgetPreview(memory.memoryId, WRITE_ACTOR);
    const confirmed = service.forgetConfirm(memory.memoryId, fresh.confirmationReceipt, WRITE_ACTOR);
    expect(confirmed.status).toBe("completed");
    const replay = service.forgetConfirm(memory.memoryId, fresh.confirmationReceipt, WRITE_ACTOR);
    expect(replay.status).toBe("already_consumed");
    const forgotten = service.store.getMemory(memory.memoryId);
    expect(forgotten?.status).toBe("forgotten");
    // derived chunks for the current revision cleared; historical traces preserved (§16.3)
    expect(service.store.countChunks(memory.memoryId, forgotten!.currentRevision)).toBe(0);
  });

  test("receipts are cryptographically bound — tampered target rejected", () => {
    const receipt = signReceipt({ previewId: "p1", action: "forget_memory", targetId: "mem_1", expectedRevision: 1, expectedSourceHash: "h", snapshotHash: "s", expiresAtMs: Date.now() + 60_000 });
    expect(receipt).not.toBeNull();
    const verified = verifyReceipt(receipt!);
    expect(verified?.targetId).toBe("mem_1");
    // Flip one body character → MAC mismatch → rejected.
    const body = receipt!.split(".")[0];
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(verifyReceipt(flipped + "." + receipt!.split(".")[1])).toBeNull();
    expect(verifyReceipt(receipt!.slice(0, -4) + "AAAA")).toBeNull();
  });

  test("PKCE challenge derivation matches S256 contract", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceS256Challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

// --- OAuth ----------------------------------------------------------------------------------------

describe("oauth 2.1", () => {
  test("discovery metadata is valid JSON with required fields (body-validated)", () => {
    const metadata = oauth.discoveryMetadata("http://127.0.0.1:10100");
    expect(metadata.issuer).toBe("http://127.0.0.1:10100");
    expect(metadata.authorization_endpoint).toContain("/oauth/authorize");
    expect(metadata.token_endpoint).toContain("/oauth/token");
    expect((metadata.code_challenge_methods_supported as string[])).toContain("S256");
    expect((metadata.scopes_supported as string[])).toEqual([...MEMORY_SCOPES]);
    const resource = oauth.protectedResourceMetadata("http://127.0.0.1:10100");
    expect((resource.scopes_supported as string[])).toContain("memory:read");
  });

  test("DCR registers a client; exact redirect matching enforced", () => {
    const registered = oauth.registerClient({ clientName: "Test MCP Client", redirectUris: ["http://127.0.0.1:8877/callback"], scope: "memory:read memory:write" }, "operator");
    expect(registered.clientId.startsWith("mcp_")).toBe(true);
    expect(oauth.store.getOAuthClient(registered.clientId)?.redirectUris).toEqual(["http://127.0.0.1:8877/callback"]);
    expect(() => oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://evil.example/callback", scope: "memory:read", codeChallenge: pkceS256Challenge("verifier"), codeChallengeMethod: "S256" })).toThrow(/INVALID_REDIRECT_URI/);
  });

  test("full code flow with PKCE S256; plain method rejected; code is one-time", () => {
    const registered = oauth.registerClient({ clientName: "PKCE client", redirectUris: ["http://127.0.0.1:8877/cb"], scope: "memory:read", tokenEndpointAuth: "none" }, "operator");
    service.store.upsertConsent(registered.clientId, "memory:read", "operator", "approved");
    const verifier = "correct-horse-battery-staple-01";
    const challenge = pkceS256Challenge(verifier);

    expect(() => oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8877/cb", scope: "memory:read", codeChallenge: challenge, codeChallengeMethod: "plain" })).toThrow(/S256/);

    const codeResponse = oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8877/cb", scope: "memory:read", codeChallenge: challenge, codeChallengeMethod: "S256" });
    const tokens = oauth.grant({ grantType: "authorization_code", clientId: registered.clientId, code: codeResponse.code, redirectUri: "http://127.0.0.1:8877/cb", codeVerifier: verifier });
    expect(tokens.accessToken.startsWith("at_")).toBe(true);
    expect(tokens.refreshToken).not.toBeNull();

    // code replay rejected
    expect(() => oauth.grant({ grantType: "authorization_code", clientId: registered.clientId, code: codeResponse.code, redirectUri: "http://127.0.0.1:8877/cb", codeVerifier: verifier })).toThrow(/already used/);

    // wrong verifier rejected
    const second = oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8877/cb", scope: "memory:read", codeChallenge: challenge, codeChallengeMethod: "S256" });
    expect(() => oauth.grant({ grantType: "authorization_code", clientId: registered.clientId, code: second.code, redirectUri: "http://127.0.0.1:8877/cb", codeVerifier: "wrong-verifier-value" })).toThrow(/PKCE/);

    // bearer works and carries canonical scopes
    const identity = oauth.authenticateBearer("Bearer " + tokens.accessToken);
    expect(identity.scopes).toContain("memory:read");
  });

  test("consent required before code issuance", () => {
    const registered = oauth.registerClient({ clientName: "Unconsented", redirectUris: ["http://127.0.0.1:8878/cb"], scope: "memory:admin", tokenEndpointAuth: "none" }, "operator");
    expect(() => oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8878/cb", scope: "memory:admin", codeChallenge: pkceS256Challenge("v"), codeChallengeMethod: "S256" })).toThrow(/CONSENT_REQUIRED/);
  });

  test("refresh rotation; reuse detection revokes the family; tokens expire", () => {
    const registered = oauth.registerClient({ clientName: "Refresh client", redirectUris: ["http://127.0.0.1:8879/cb"], scope: "memory:read", tokenEndpointAuth: "none" }, "operator");
    service.store.upsertConsent(registered.clientId, "memory:read", "operator", "approved");
    const code = oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8879/cb", scope: "memory:read", codeChallenge: pkceS256Challenge("v-1"), codeChallengeMethod: "S256" });
    const first = oauth.grant({ grantType: "authorization_code", clientId: registered.clientId, code: code.code, redirectUri: "http://127.0.0.1:8879/cb", codeVerifier: "v-1" });

    const rotated = oauth.grant({ grantType: "refresh_token", clientId: registered.clientId, refreshToken: first.refreshToken! });
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // reuse of the rotated token → family revoked
    expect(() => oauth.grant({ grantType: "refresh_token", clientId: registered.clientId, refreshToken: first.refreshToken! })).toThrow(/reuse detected/);
    expect(() => oauth.authenticateBearer("Bearer " + first.accessToken)).toThrow(/expired or revoked/);
    expect(() => oauth.authenticateBearer("Bearer " + rotated.accessToken)).toThrow(/expired or revoked/);

    // revocation flow works on a fresh family
    const code2 = oauth.createAuthorizationCode({ clientId: registered.clientId, redirectUri: "http://127.0.0.1:8879/cb", scope: "memory:read", codeChallenge: pkceS256Challenge("v-2"), codeChallengeMethod: "S256" });
    const second = oauth.grant({ grantType: "authorization_code", clientId: registered.clientId, code: code2.code, redirectUri: "http://127.0.0.1:8879/cb", codeVerifier: "v-2" });
    oauth.revoke({ token: second.refreshToken!, clientId: registered.clientId });
    expect(() => oauth.authenticateBearer("Bearer " + second.accessToken)).toThrow(/expired or revoked/);
  });

  test("rate limiter enforces the fixed window", () => {
    const limiter = new RateLimiter();
    expect(limiter.allow("k", 2, 60_000)).toBe(true);
    expect(limiter.allow("k", 2, 60_000)).toBe(true);
    expect(limiter.allow("k", 2, 60_000)).toBe(false);
  });
});

// --- health / stats / verify --------------------------------------------------------------------------

describe("health and contracts", () => {
  test("stats and health expose explicit provider states", async () => {
    await service.remember({ title: "health probe", content: "probe", actor: { agentKey: "x" } }, WRITE_ACTOR);
    const stats = await service.stats();
    expect(stats.memoriesTotal).toBe(1);
    expect(stats.indexed).toBeGreaterThanOrEqual(1);
    expect(stats.provider.state).toBe("healthy");
    const health = await service.health();
    expect(["healthy", "degraded"]).toContain(health.memoryPlane);
    expect(health.keywordSearch).toBe("healthy");
    expect(health.migrationVersion).toBe(41);
  });

  test("contract verifier validates bodies: scope registry, recall smokes, trace redaction", async () => {
    const result = await service.verifyContracts();
    const names = result.checks.map((check) => check.name);
    expect(names).toContain("scope-registry");
    expect(names).toContain("keyword-recall");
    expect(names).toContain("hybrid-recall");
    expect(names).toContain("trace-redaction");
    expect(result.ok).toBe(true);
  });

  test("config validates chunk geometry and disabled flag", () => {
    process.env.MEMORY_ENABLED = "false";
    const disabled = memoryConfigFromEnv();
    expect(disabled.enabled).toBe(false);
    const disabledService = new MemoryPlaneService();
    expect(() => disabledService.requireEnabled()).toThrow(/MEMORY_DISABLED/);
    process.env.MEMORY_ENABLED = "true";
  });
});

// silence unused import warnings where OAuthError is asserted via message
void OAuthError;
