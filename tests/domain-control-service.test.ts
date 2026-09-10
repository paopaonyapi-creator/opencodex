import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DomainControlService,
  InMemoryProviderRegistry,
} from "../src/agent-os/domain-control/service";
import { DomainControlStore } from "../src/agent-os/domain-control/store";
import { FakeDomainProvider } from "../src/agent-os/domain-control/providers/fake";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import type { DomainControlConfig } from "../src/agent-os/domain-control/types";

/**
 * These tests exercise the pipeline that Phase 20.15 treats as non-negotiable:
 * dry-run defaulting, allowlist enforcement, approval binding, provider re-read
 * after a write, ambiguous-write handling, idempotency, and auditing.
 *
 * Each test drives the REAL service against the REAL store; only the provider and
 * the clock are injected. A test that stubbed the service would prove nothing
 * about the pipeline, which is the only thing here that matters.
 */

let home: string;
const originalHome = process.env.OPENCODEX_HOME;

function config(overrides: Partial<DomainControlConfig> = {}): DomainControlConfig {
  return {
    enabled: true,
    defaultProvider: "fake",
    allowlist: ["example.com"],
    denylist: [],
    requireApproval: true,
    productionZones: [],
    approvalTtlMs: 60 * 60 * 1000,
    resolvers: ["1.1.1.1", "8.8.8.8"],
    verificationTimeoutMs: 50,
    verificationIntervalMs: 1,
    caddyAdminUrl: null,
    ...overrides,
  };
}

function build(options: {
  provider?: FakeDomainProvider;
  config?: Partial<DomainControlConfig>;
  now?: () => number;
} = {}): { service: DomainControlService; provider: FakeDomainProvider; store: DomainControlStore } {
  const provider = options.provider ?? new FakeDomainProvider();
  const registry = new InMemoryProviderRegistry();
  registry.register(provider);
  const store = new DomainControlStore();
  const service = new DomainControlService({
    store,
    config: config(options.config),
    registry,
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, provider, store };
}

/**
 * Request-then-grant helper, mirroring the real operator workflow.
 *
 * requireApproval defaults to true, and that gate applies to EVERY actor — a
 * non-agent actor is trusted to act, not trusted to skip the approval. Tests that
 * want an applied write therefore have to walk the same path an operator does.
 */
async function approved(
  service: DomainControlService,
  hostname: string,
  intent: { name: string; type: "A" | "AAAA" | "CNAME" | "TXT"; content: string; ttl?: number },
  envelope: { actor?: "user" | "chatgpt" | "codex" | "agent"; dry_run?: boolean; idempotency_key?: string; request_id?: string } = {},
) {
  const request = await service.applyRecord(hostname, intent, {
    actor: envelope.actor ?? "user",
    ...(envelope.request_id ? { request_id: envelope.request_id } : {}),
  });
  const approvalId = request.approval!.id;
  service.decideApproval(approvalId, "grant", "pao");
  return service.applyRecord(hostname, intent, {
    actor: envelope.actor ?? "user",
    approval_id: approvalId,
    ...(envelope.dry_run === undefined ? {} : { dry_run: envelope.dry_run }),
    ...(envelope.idempotency_key ? { idempotency_key: envelope.idempotency_key } : {}),
    ...(envelope.request_id ? { request_id: envelope.request_id } : {}),
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dc-test-"));
  process.env.OPENCODEX_HOME = home;
});

afterEach(() => {
  closeAgentOsDbForTests();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("Phase 20.15 — dry-run defaulting", () => {
  test("an agent mutation without approval is a dry run and never reaches the provider", async () => {
    const { service, provider } = build();
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt" },
    );
    expect(outcome.status).toBe("approval_required");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("a caller-supplied dry_run true produces a diff without writing", async () => {
    const { service, provider } = build();
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user", dry_run: true },
    );
    expect(outcome.status).toBe("dry_run");
    expect(outcome.diff?.counts.create).toBe(1);
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("a caller cannot disable the agent dry-run default with dry_run false", async () => {
    const { service, provider } = build();
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "codex", dry_run: false },
    );
    expect(outcome.status).toBe("approval_required");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });
});

describe("Phase 20.15 — allowlist enforcement", () => {
  test("a domain outside the allowlist is refused before any provider call", async () => {
    const { service, provider } = build();
    const outcome = await service.applyRecord(
      "evil.other-domain.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user", approval_id: "whatever" },
    );
    expect(outcome.status).toBe("denied");
    expect(outcome.error?.code).toBe("DOMAIN_NOT_ALLOWED");
    expect(provider.calls).toHaveLength(0);
  });

  test("an empty allowlist freezes every mutation", async () => {
    const { service, provider } = build({ config: { allowlist: [] } });
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user" },
    );
    expect(outcome.error?.code).toBe("DOMAIN_NOT_ALLOWED");
    expect(provider.calls).toHaveLength(0);
  });

  test("a denylisted subdomain is refused even though its zone is allowlisted", async () => {
    const { service } = build({ config: { denylist: ["mail.example.com"] } });
    const outcome = await service.applyRecord(
      "mail.example.com",
      { name: "mail", type: "A", content: "203.0.113.10" },
      { actor: "user" },
    );
    expect(outcome.error?.code).toBe("DOMAIN_NOT_ALLOWED");
  });
});

describe("Phase 20.15 — approval gate", () => {
  test("a granted approval bound to the same operation and resource lets the write through", async () => {
    const { service, provider } = build();
    const request = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt", request_id: "req_1" },
    );
    expect(request.status).toBe("approval_required");
    const approvalId = request.approval!.id;
    service.decideApproval(approvalId, "grant", "pao");

    const applied = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt", approval_id: approvalId, request_id: "req_1" },
    );
    expect(applied.status).toBe("applied");
    expect(provider.calls.filter((call) => call.operation === "createRecord")).toHaveLength(1);
  });

  test("an approval for one hostname does not authorize a different hostname", async () => {
    const { service, provider } = build();
    const request = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt" },
    );
    service.decideApproval(request.approval!.id, "grant", "pao");

    const other = await service.applyRecord(
      "staging.example.com",
      { name: "staging", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt", approval_id: request.approval!.id },
    );
    expect(other.status).toBe("denied");
    expect(other.error?.code).toBe("APPROVAL_REQUIRED");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("an expired approval is refused even when it was granted", async () => {
    let clock = 1_000_000;
    const { service, provider } = build({
      config: { approvalTtlMs: 1000 },
      now: () => clock,
    });
    const request = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt" },
    );
    service.decideApproval(request.approval!.id, "grant", "pao");
    clock += 5000;

    const applied = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt", approval_id: request.approval!.id },
    );
    expect(applied.status).toBe("denied");
    expect(applied.error?.code).toBe("APPROVAL_EXPIRED");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("a denied approval cannot be re-decided", async () => {
    const { service } = build();
    const request = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt" },
    );
    service.decideApproval(request.approval!.id, "deny", "pao");
    expect(() => service.decideApproval(request.approval!.id, "grant", "pao")).toThrow();
  });
});

describe("Phase 20.15 — record type scope", () => {
  test("a record type outside the first-release set is refused", async () => {
    const { service, provider } = build();
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "MX", content: "10 mail.example.com" },
      { actor: "user", dry_run: false },
    );
    expect(outcome.error?.code).toBe("UNSUPPORTED_RECORD_TYPE");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("A, AAAA, CNAME, and TXT are all accepted as autonomously mutable", async () => {
    for (const [type, content] of [
      ["A", "203.0.113.10"],
      ["AAAA", "2001:db8::1"],
      ["CNAME", "target.example.com"],
      ["TXT", "verification=abc123"],
    ] as const) {
      const { service } = build();
      const outcome = await service.applyRecord(
        "dev.example.com",
        { name: "dev", type, content },
        { actor: "user", dry_run: true },
      );
      expect(outcome.status).toBe("dry_run");
      expect(outcome.diff?.counts.create).toBe(1);
      // A preview reports that an approval WILL be needed without creating a
      // pending approval row for it.
      expect(outcome.approvalRequired).toBe(true);
      expect(outcome.approval).toBeUndefined();
    }
  });
});

describe("Phase 20.15 — provider re-read and ambiguous writes", () => {
  test("state is re-read after a successful write and reported as settled", async () => {
    const { service, provider } = build();
    const request = await approved(service, "dev.example.com", {
      name: "dev",
      type: "A",
      content: "203.0.113.10",
    });
    expect(request.status).toBe("applied");
    expect(provider.calls.filter((call) => call.operation === "listRecords").length).toBeGreaterThan(0);
    expect((request.verification as { settled: boolean }).settled).toBe(true);
  });

  test("a lost write response is reported as ambiguous and never retried", async () => {
    const provider = new FakeDomainProvider({ timeoutAfterMutation: 1 });
    const { service } = build({ provider });
    const outcome = await approved(service, "dev.example.com", {
      name: "dev",
      type: "A",
      content: "203.0.113.10",
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.error?.code).toBe("AMBIGUOUS_MUTATION");
    expect(outcome.error?.retryable).toBe(false);
    expect(outcome.requiresStateReread).toBe(true);
    // Exactly one write attempt: the ambiguity must not have produced a retry.
    expect(provider.calls.filter((call) => call.operation === "createRecord")).toHaveLength(1);
  });

  test("provider auth failure surfaces PROVIDER_AUTH_FAILED", async () => {
    const provider = new FakeDomainProvider({ failAuth: true });
    const { service } = build({ provider });
    // The provider rejects the credential, so the Observe read fails before any
    // approval can be requested. That ordering is correct: a broken credential must
    // surface as an auth error, not as an approval prompt nobody can satisfy.
    const outcome = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user", dry_run: false },
    );
    expect(outcome.error?.code).toBe("PROVIDER_AUTH_FAILED");
  });
});

describe("Phase 20.15 — idempotency", () => {
  test("the same key with the same payload replays the previous result", async () => {
    const { service, provider } = build();
    const first = await approved(
      service,
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { idempotency_key: "key-1", dry_run: false },
    );
    expect(first.status).toBe("applied");
    const second = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "agent", dry_run: false, idempotency_key: "key-1" },
    );
    expect(second.status).toBe("applied");
    // The replay must not have produced a second provider write.
    expect(provider.calls.filter((call) => call.operation === "createRecord")).toHaveLength(1);
  });

  test("the same key with a different payload is rejected", async () => {
    const { service } = build();
    await approved(
      service,
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { idempotency_key: "key-2", dry_run: false },
    );
    const conflicting = await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "198.51.100.7" },
      { actor: "user", dry_run: false, idempotency_key: "key-2" },
    );
    expect(conflicting.status).toBe("denied");
    expect(conflicting.error?.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("Phase 20.15 — audit trail", () => {
  test("a dry run, a refusal, and an applied write each produce an audit row", async () => {
    const { service, provider } = build();
    await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user", dry_run: true, request_id: "audit-dry" },
    );
    await service.applyRecord(
      "evil.other-domain.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "user", request_id: "audit-deny" },
    );
    const applied = await approved(
      service,
      "dev.example.com",
      { name: "dev", type: "A", content: "198.51.100.7" },
      { dry_run: false, request_id: "audit-apply" },
    );
    expect(applied.status).toBe("applied");

    const events = service.listAudit({ limit: 50 });
    const requestIds = events.map((event) => event.requestId);
    expect(requestIds).toContain("audit-dry");
    expect(requestIds).toContain("audit-deny");
    expect(requestIds).toContain("audit-apply");

    const denied = events.find((event) => event.requestId === "audit-deny")!;
    expect(denied.result).toBe("failure");
    expect(denied.errorCode).toBe("DOMAIN_NOT_ALLOWED");

    const appliedEvent = events.find((event) => event.requestId === "audit-apply")!;
    expect(appliedEvent.result).toBe("success");
    // This write CREATED the record, so there is correctly no before-state. A
    // fabricated "before" here would misrepresent the provider's prior condition.
    expect(appliedEvent.before).toBeNull();
    expect(appliedEvent.after).toBeTruthy();
    expect(provider.calls.length).toBeGreaterThan(0);
  });

  test("an update records both the before and after state", async () => {
    const { service } = build();
    await approved(service, "dev.example.com", {
      name: "dev",
      type: "A",
      content: "203.0.113.10",
    });
    const updated = await approved(
      service,
      "dev.example.com",
      { name: "dev", type: "A", content: "198.51.100.7" },
      { request_id: "audit-update", dry_run: false },
    );
    expect(updated.status).toBe("applied");
    const event = service.listAudit({ requestId: "audit-update" })[0]!;
    expect((event.before as { content: string }).content).toBe("203.0.113.10");
    expect((event.after as { content: string }).content).toBe("198.51.100.7");
  });

  test("audit records the actor that acted", async () => {
    const { service } = build();
    await service.applyRecord(
      "dev.example.com",
      { name: "dev", type: "A", content: "203.0.113.10" },
      { actor: "chatgpt", request_id: "actor-check" },
    );
    const event = service.listAudit({ requestId: "actor-check" })[0]!;
    expect(event.actor).toBe("chatgpt");
  });
});

describe("Phase 20.15 — delete and rollback", () => {
  test("deleting an existing record is critical risk and needs approval", async () => {
    const provider = new FakeDomainProvider();
    const seeded = provider.seedRecord("1", {
      name: "old",
      type: "A",
      content: "203.0.113.5",
      ttl: 300,
    });
    const { service } = build({ provider });

    const blocked = await service.deleteRecord("old.example.com", seeded.id, { actor: "chatgpt" });
    expect(blocked.status).toBe("approval_required");
    expect(blocked.risk.level).toBe("critical");
    expect(provider.calls.some((call) => call.operation === "deleteRecord")).toBe(false);

    service.decideApproval(blocked.approval!.id, "grant", "pao");
    const applied = await service.deleteRecord("old.example.com", seeded.id, {
      actor: "chatgpt",
      approval_id: blocked.approval!.id,
    });
    expect(applied.status).toBe("applied");
    expect((applied.verification as { removed: boolean }).removed).toBe(true);
  });

  test("rollback is a new audited mutation, not a silent undo", async () => {
    const provider = new FakeDomainProvider();
    const seeded = provider.seedRecord("1", {
      name: "dev",
      type: "A",
      content: "198.51.100.9",
      ttl: 300,
    });
    const { service } = build({ provider });

    const rollback = await service.restoreRecord(
      "dev.example.com",
      { id: seeded.id, name: "dev", type: "A", content: "198.51.100.9" },
      { actor: "chatgpt" },
    );
    // Refused pending approval like any other mutation, and it recorded a diff.
    expect(rollback.status).toBe("approval_required");
    expect(rollback.diff).not.toBeNull();
    const events = service.listAudit({ resource: "dev.example.com", limit: 10 });
    expect(events.length).toBeGreaterThan(0);
  });
});
