// Phase 20.82 — Sensorimotor Management Routes Integration Test
// Exercises the REST surface end-to-end: health, session lifecycle,
// transactional action execution, and outcome retrieval.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPolicy, clearPolicies } from "../src/agent-os/policy";
import { openAgentOsDb } from "../src/agent-os/db";
import { handleSensorimotorRoutes } from "../src/server/management/sensorimotor-routes";
import type { ManagementContext } from "../src/server/management/context";

function makeCtx(method: string, path: string, body?: unknown): ManagementContext {
  const req = new Request(`http://localhost:10100${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  // Direct-dispatch test: config/deps/convergence callbacks stay stubs; the
  // sensorimotor dispatcher reads only req and url.
  return {
    req,
    url: new URL(req.url),
    config: {} as never,
    deps: {} as never,
  } as unknown as ManagementContext;
}

function grantApproval(capability: string): void {
  openAgentOsDb().run(
    "INSERT INTO approvals (id, capability, reason, status, requested_ms, decided_ms, decided_by) VALUES (?, ?, ?, 'granted', ?, ?, 'test')",
    [`appr_it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, capability, "integration", Date.now(), Date.now()],
  );
}

describe("Phase 20.82 — Sensorimotor management routes", () => {
  let wsRoot: string;

  beforeEach(() => {
    wsRoot = mkdtempSync(join(tmpdir(), "pao-aft-routes-"));
    clearPolicies();
    openAgentOsDb().exec("DELETE FROM approvals");
  });

  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("reports health over REST", async () => {
    const res = await handleSensorimotorRoutes(makeCtx("GET", "/api/agent-os/sensorimotor/health"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; policyVersion: string };
    expect(body.ok).toBe(true);
    expect(body.policyVersion).toBe("aft-1");
  });

  it("creates a session, executes a transactional write, and reads the outcome back", async () => {
    addPolicy({ subjectType: "global", capability: "fs.write", effect: "allow" });
    grantApproval("fs.write");

    // 1. create session
    const createRes = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/sessions", { workspaceRoot: wsRoot, actorId: "rest-tester" }),
    );
    expect(createRes!.status).toBe(200);
    const { session } = (await createRes!.json()) as { session: { id: string } };

    // 2. execute transactional write
    const actionRes = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/actions", {
        sessionId: session.id,
        kind: "fs.write",
        target: "rest-written.txt",
        content: "via-rest",
      }),
    );
    expect(actionRes!.status).toBe(200);
    const actionBody = (await actionRes!.json()) as { ok: boolean; outcome: { actionId: string; status: string } };
    expect(actionBody.ok).toBe(true);
    expect(actionBody.outcome.status).toBe("succeeded");

    // 3. read outcome detail back
    const detailRes = await handleSensorimotorRoutes(
      makeCtx("GET", `/api/agent-os/sensorimotor/actions/${actionBody.outcome.actionId}`),
    );
    expect(detailRes!.status).toBe(200);
    const detail = (await detailRes!.json()) as { outcome: { status: string; sessionId: string } };
    expect(detail.outcome.status).toBe("succeeded");
    expect(detail.outcome.sessionId).toBe(session.id);

    // 4. close session
    const closeRes = await handleSensorimotorRoutes(
      makeCtx("POST", `/api/agent-os/sensorimotor/sessions/${session.id}/close`, { status: "closed" }),
    );
    expect(closeRes!.status).toBe(200);
  });

  it("rejects unknown action kinds with 400", async () => {
    const res = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/actions", { kind: "fs.explode", target: "x" }),
    );
    expect(res!.status).toBe(400);
  });

  it("returns 404 for unknown session close", async () => {
    const res = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/sessions/sms_does_not_exist/close", { status: "closed" }),
    );
    expect(res!.status).toBe(404);
  });

  it("returns null for non-matching paths (dispatcher pass-through)", async () => {
    const res = await handleSensorimotorRoutes(makeCtx("GET", "/api/agent-os/other-plane/health"));
    expect(res).toBeNull();
  });
});
