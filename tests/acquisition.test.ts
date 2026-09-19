// Phase 20.95 — Content Acquisition Gateway. Mock-only: no live OmniGet.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  AcquisitionError,
  classifySource,
  createAcquisitionMcpTools,
  getAcquisitionGateway,
  inferIntent,
  resetAcquisitionGatewayForTests,
  resolveAcquisitionPath,
} from "../src/agent-os/acquisition";
import { createEnzoWorkspaceMcpTools } from "../src/agent-os/enzo-workspace/mcp-tools";

const tmp = mkdtempSync(join(tmpdir(), "acq-2095-"));
const prevRoot = process.env.PAO_ACQUISITION_ROOT;

function req(overrides: Record<string, unknown> = {}) {
  return {
    actor: { type: "user" as const, id: "tester" },
    source: { kind: "url" as const, value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    intent: "research" as const,
    options: { transcribe: true, summarize: true, ingestKnowledge: true, preserveOriginal: true },
    policyContext: { workspaceId: "default", purpose: "research" as const },
    ...overrides,
  };
}

beforeAll(() => {
  process.env.PAO_ACQUISITION_ROOT = tmp;
  resetAcquisitionGatewayForTests();
});

afterAll(() => {
  if (prevRoot === undefined) delete process.env.PAO_ACQUISITION_ROOT;
  else process.env.PAO_ACQUISITION_ROOT = prevRoot;
  resetAcquisitionGatewayForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe("phase 20.95 — schema", () => {
  it("migrates Agent OS schema to v66 with acq_* tables", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(66);
    const db = openAgentOsDb();
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'acq_%'").all() as { name: string }[]).map((r) => r.name);
    for (const name of ["acq_jobs", "acq_attempts", "acq_artifacts", "acq_session_refs", "acq_events"]) {
      expect(tables).toContain(name);
    }
  });
});

describe("phase 20.95 — security policy", () => {
  it("reuses 20.24 SSRF policy for loopback, metadata, and file://", () => {
    expect(() => classifySource("http://127.0.0.1/media")).toThrow(/SSRF/i);
    expect(() => classifySource("http://169.254.169.254/latest/meta-data/")).toThrow(/SSRF/i);
    expect(() => classifySource("file:///C:/Windows/System32/calc.exe")).toThrow(/forbidden|INVALID/i);
  });

  it("rejects raw cookies on the request", async () => {
    const gw = getAcquisitionGateway();
    await expect(gw.plan(req({ authContext: { cookies: "sid=abc" } }))).rejects.toBeInstanceOf(AcquisitionError);
    try {
      await gw.plan(req({ authContext: { cookies: "sid=abc" } }));
    } catch (err) {
      expect((err as AcquisitionError).code).toBe("SECRET_IN_REQUEST");
    }
  });

  it("denies DRM hosts such as netflix", async () => {
    const gw = getAcquisitionGateway();
    const result = await gw.submit(req({ source: { kind: "url", value: "https://www.netflix.com/watch/123" }, intent: "download", options: {} }));
    expect(result.policy.decision).toBe("deny");
    expect(result.job.state).toBe("BLOCKED");
    expect(result.policy.reasonCodes.join(" ")).toMatch(/drm/i);
  });

  it("requires approval for authenticated course hosts (udemy)", async () => {
    const gw = getAcquisitionGateway();
    const result = await gw.submit(req({ source: { kind: "url", value: "https://www.udemy.com/course/foo" }, intent: "archive", options: {} }));
    expect(result.policy.decision).toBe("require_approval");
    expect(result.job.state).toBe("WAITING_APPROVAL");
  });

  it("rejects path traversal", () => {
    expect(() => resolveAcquisitionPath(tmp, "../secret.txt")).toThrow(/PATH|escape/i);
    try {
      resolveAcquisitionPath(tmp, "../secret.txt");
    } catch (err) {
      expect((err as AcquisitionError).code).toBe("PATH_ESCAPE");
    }
  });
});

describe("phase 20.95 — scenario A research youtube", () => {
  it("plans subtitle-first research and stores hashed untrusted artifacts", async () => {
    expect(inferIntent("เอาลิงก์นี้มาศึกษา ถอดเสียง สรุป เก็บต้นฉบับ และเพิ่มเข้าคลังความรู้")).toBe("research");
    const gw = getAcquisitionGateway();
    const result = await gw.submit(req());
    expect(result.plan.preferSubtitles).toBe(true);
    expect(result.plan.selectedAdapter).toBe("mock");
    expect(result.plan.commercialRightsDefault).toBe("unknown");
    expect(result.job.state).toBe("COMPLETED");
    const detail = gw.getJob(result.job.id);
    const types = detail.artifacts.map((a) => a.type);
    expect(types).toContain("subtitle");
    expect(types).toContain("transcript");
    expect(types).toContain("research");
    expect(detail.artifacts.every((a) => a.commercialRights === "unknown")).toBe(true);
    expect(detail.artifacts.every((a) => String(a.sha256).length === 64)).toBe(true);
    expect(detail.artifacts.some((a) => (a.metadata as { trust?: string })?.trust === "untrusted_external_content")).toBe(true);
    const events = detail.events.map((e) => e.type);
    expect(events).toContain("acquisition.queued");
    expect(events).toContain("acquisition.completed");
    expect(events).toContain("artifact.acquired");
    expect(events).toContain("artifact.knowledge_ingested");
    const research = detail.artifacts.find((a) => a.type === "research");
    expect(research).toBeTruthy();
  });
});

describe("phase 20.95 — scenario C gallery", () => {
  it("acquires a bounded gallery index", async () => {
    const gw = getAcquisitionGateway();
    const result = await gw.submit(req({
      source: { kind: "url", value: "https://www.instagram.com/p/example" },
      intent: "gallery",
      options: {},
    }));
    expect(result.job.state).toBe("COMPLETED");
    const detail = gw.getJob(result.job.id);
    expect(detail.artifacts.some((a) => String(a.relativePath).includes("gallery-index.json"))).toBe(true);
  });
});

describe("phase 20.95 — scenario D batch limit", () => {
  it("denies batches over maxItems", async () => {
    const gw = getAcquisitionGateway();
    const urls = ["https://www.youtube.com/watch?v=1", "https://www.youtube.com/watch?v=2", "https://www.youtube.com/watch?v=3"];
    const result = await gw.submit(req({
      source: { kind: "batch", value: urls },
      intent: "batch",
      options: { maxItems: 2 },
    }));
    expect(result.policy.decision).toBe("deny");
    expect(result.job.state).toBe("BLOCKED");
    expect(result.policy.reasonCodes).toContain("batch_limit");
  });
});

describe("phase 20.95 — sessions and approval resume", () => {
  it("issues and revokes opaque session refs", () => {
    const gw = getAcquisitionGateway();
    const session = gw.issueSession({
      provider: "browser",
      domains: ["udemy.com"],
      ownerActorId: "tester",
      secretRef: "secret://browser/session-store",
    });
    expect(session.id.startsWith("sess")).toBe(true);
    expect(session.secretRef.startsWith("secret://")).toBe(true);
    gw.revokeSession(session.id);
    const listed = gw.listSessions().find((s) => s.id === session.id);
    expect(listed?.revokedAt).toBeTruthy();
    expect(() => gw.issueSession({ provider: "browser", domains: ["x.com"], ownerActorId: "tester", secretRef: "Cookie: a=b" })).toThrow(/SECRET/i);
  });

  it("resumes an approved udemy job from stored request JSON", async () => {
    const gw = getAcquisitionGateway();
    const submitted = await gw.submit(req({ source: { kind: "url", value: "https://www.udemy.com/course/bar" }, intent: "archive", options: { preserveOriginal: true } }));
    expect(submitted.job.state).toBe("WAITING_APPROVAL");
    const approved = await gw.decideApproval(submitted.job.id, true, "reviewer");
    expect(approved.state).toBe("COMPLETED");
  });
});

describe("phase 20.95 — MCP facade", () => {
  it("pao.acquire rejects cookies and acquire_content hides OmniGet tokens", async () => {
    const tools = createAcquisitionMcpTools();
    const acquire = tools.find((t) => t.name === "pao.acquire");
    expect(acquire).toBeTruthy();
    const denied = await acquire!.handler({ source: "https://www.youtube.com/watch?v=1", cookies: "sid=1" });
    expect(denied.ok).toBe(false);
    expect((denied.error as { code: string }).code).toBe("SECRET_IN_REQUEST");

    const enzo = createEnzoWorkspaceMcpTools();
    const acq = enzo.find((t) => t.name === "acquire_content");
    expect(acq).toBeTruthy();
    const hidden = await acq!.handler({ source: "https://www.youtube.com/watch?v=1", omnigetToken: "raw-token" });
    expect(hidden.ok).toBe(false);
  });
});
