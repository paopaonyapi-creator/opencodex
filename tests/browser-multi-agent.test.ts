// Phase 20.13: Pao-hubPro Browser Multi-Agent Web Operations — Comprehensive Test Suite
//
// Verifies Database Schema v22, Specialized Web Personas (Research, Metadata,
// Upload Allowlist, QA, Reviewer Council), Cross-Agent Handshakes, Coordinator State Machine,
// Canonical MCP Tools, and Management REST API Endpoints.

import { describe, expect, test, beforeEach } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  getBrowserBridge,
  getBrowserKillSwitch,
  getBrowserApprovalManager,
} from "../src/agent-os/browser";
import {
  ResearchWebAgent,
  MetadataWebAgent,
  UploadWebAgent,
  QAWebAgent,
  ReviewerWebAgent,
  BrowserMultiAgentCoordinator,
  getBrowserMultiAgentCoordinator,
  getMultiAgentMcpTools,
  type MultiAgentMission,
  type ResearchBrief,
  type MetadataPayload,
} from "../src/agent-os/browser/multi-agent";
import { handleMultiAgentRoutes } from "../src/server/management/multi-agent-routes";
import { handleBrowserRoutes } from "../src/server/management/browser-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.13: Pao-hubPro Browser Multi-Agent Web Operations", () => {
  beforeEach(() => {
    getBrowserKillSwitch().reset();
    getBrowserApprovalManager().clearSessionApprovals();
  });

  describe("1. Database Schema v22 Migration", () => {
    test("schema version is bumped to at least 22", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(22);
      const db = openAgentOsDb();
      const row = db
        .query("SELECT value FROM schema_meta WHERE key = 'version'")
        .get() as { value: string };
      expect(parseInt(row.value, 10)).toBeGreaterThanOrEqual(22);
    });

    test("all 4 multi-agent operations tables exist and are queryable", () => {
      const db = openAgentOsDb();
      const tables = [
        "browser_multi_agent_missions",
        "browser_agent_dispatches",
        "browser_web_handshakes",
        "browser_qa_evaluations",
      ];

      for (const table of tables) {
        const check = db
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(table) as { name: string } | null;
        expect(check?.name).toBe(table);
      }
    });
  });

  describe("2. Research Web Agent", () => {
    test("conducts web research, synthesizes competitor listings and trending tags", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://stock.adobe.com");
      bridge.activateTab(tab.id);

      const agent = new ResearchWebAgent();
      const brief = await agent.conductResearch(
        "https://stock.adobe.com/search?k=cyberpunk",
        "Cyberpunk UI",
        tab.id,
      );

      expect(brief.domain).toContain("stock.adobe.com");
      expect(brief.competitorAssets.length).toBeGreaterThan(0);
      expect(brief.recommendedTags.length).toBeGreaterThan(0);
      expect(brief.summary).toContain("Market research completed on");
    });
  });

  describe("3. Metadata Web Agent", () => {
    test("synthesizes SEO titles, descriptions, and keyword tags incorporating research", () => {
      const agent = new MetadataWebAgent();
      const mockResearch: ResearchBrief = {
        domain: "stock.adobe.com",
        competitorAssets: [],
        recommendedTags: ["cyberpunk", "hologram", "futuristic"],
        marketDemandSignals: ["High commercial demand"],
        summary: "Market research",
      };

      const payload = agent.generateMetadata("Sci-Fi HUD Hologram", mockResearch, {
        maxKeywords: 25,
        category: "Technology",
      });

      expect(payload.title).toContain("Sci-Fi HUD Hologram");
      expect(payload.description).toContain("professionally composed");
      expect(payload.keywords).toContain("cyberpunk");
      expect(payload.keywords).toContain("futuristic");
      expect(payload.category).toBe("Technology");
      expect(payload.keywords.length).toBeLessThanOrEqual(25);
    });

    test("autofills synthesized metadata into active tab DOM elements", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://contributor.stock.adobe.com/upload");
      bridge.activateTab(tab.id);

      const agent = new MetadataWebAgent();
      const payload: MetadataPayload = {
        title: "Golden Hour Sunset Over Mountain Lake",
        description: "Spectacular landscape view of mountain reflection during sunset.",
        keywords: ["sunset", "lake", "mountains", "nature", "golden-hour"],
        category: "Landscape",
      };

      const filled = await agent.autofillForm(payload, tab.id);
      expect(filled.url).toContain("stock.adobe.com");
      expect(filled.filled).toBeArray();

      const snapshot = bridge.getSnapshot(tab.id);
      const titleInput = snapshot.elements.find(
        (el) => el.tag === "input" && (el.attributes?.name === "title" || el.id === "title"),
      );
      if (titleInput) {
        expect(titleInput.value).toBe(payload.title);
      }
    });
  });

  describe("4. Upload Web Agent & File Allowlist Security", () => {
    test("permits allowlisted directories and blocks unapproved files", () => {
      const agent = new UploadWebAgent();

      expect(agent.isPathAllowlisted("/approved/assets/photo1.jpg")).toBe(true);
      expect(agent.isPathAllowlisted("C:\\artifacts\\exported_asset.png")).toBe(true);
      expect(agent.isPathAllowlisted("./assets/vector.svg")).toBe(true);

      expect(agent.isPathAllowlisted("C:\\Windows\\System32\\cmd.exe")).toBe(false);
      expect(agent.isPathAllowlisted("/etc/shadow")).toBe(false);
      expect(agent.isPathAllowlisted("~/.ssh/id_rsa")).toBe(false);
    });

    test("executes upload for allowlisted files and rejects non-allowlisted files", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://contributor.freepik.com/upload");
      bridge.activateTab(tab.id);

      const agent = new UploadWebAgent();

      // Unauthorized file throws UNAUTHORIZED_FILE_PATH_VIOLATION
      expect(
        agent.executeUpload(["C:\\Sensitive\\passwords.txt"], undefined, tab.id),
      ).rejects.toThrow("UNAUTHORIZED_FILE_PATH_VIOLATION");

      // Allowlisted file succeeds
      const job = await agent.executeUpload(
        ["/approved/assets/banner_mockup.png"],
        undefined,
        tab.id,
      );
      expect(job.allowlistVerified).toBe(true);
      expect(job.uploadedCount).toBe(1);
    });
  });

  describe("5. QA Web Agent & Form Auditing", () => {
    test("audits form completeness, catches errors, and renders QA evaluation", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://contributor.shutterstock.com/submit");
      bridge.activateTab(tab.id);

      const coordinator = getBrowserMultiAgentCoordinator();
      const mission = coordinator.createMission({
        name: "QA Form Audit Mission",
        targetDomain: "shutterstock.com",
        goal: "Test QA evaluation state audit",
      });

      const agent = new QAWebAgent();
      const evaluation = await agent.evaluateFormState(mission.id, 1, tab.id);

      expect(evaluation.missionId).toBe(mission.id);
      expect(evaluation.url).toContain("shutterstock.com");
      expect(evaluation.checks.length).toBeGreaterThan(0);
      expect(["pass", "warn", "fail"]).toContain(evaluation.verdict);
      expect(evaluation.screenshotB64).toBeDefined();
    });
  });

  describe("6. Reviewer Council Web Agent", () => {
    test("constructs risk-evaluated approval proposal", () => {
      const agent = new ReviewerWebAgent();
      const proposal = agent.evaluateAction(
        "submit_for_review",
        "https://contributor.adobe.com",
        { title: "Test Asset", tagsCount: 20 },
      );

      expect(proposal.action).toBe("submit_for_review");
      expect(proposal.website).toBe("https://contributor.adobe.com");
      expect(["approve", "modify", "reject"]).toContain(proposal.recommendation);
      expect(["CONTROLLED", "CONFIRM_REQUIRED"]).toContain(proposal.riskLevel);
    });

    test("submits formal human supervisor approval request", async () => {
      const agent = new ReviewerWebAgent();
      const proposal = agent.evaluateAction(
        "commercial_listing_publish",
        "https://freepik.com",
        { items: 5 },
      );

      const submissionPromise = agent.submitForHumanApproval(proposal);
      const pending = getBrowserApprovalManager().listPending();
      expect(pending.length).toBeGreaterThan(0);
      getBrowserApprovalManager().approve(pending[0].id, "once", "supervisor");

      const submission = await submissionPromise;
      expect(submission.approvalId).toBeDefined();
      expect(submission.status).toBe("approved_once");
    });
  });

  describe("7. Multi-Agent Operations Coordinator", () => {
    let coordinator: BrowserMultiAgentCoordinator;

    beforeEach(() => {
      coordinator = new BrowserMultiAgentCoordinator();
    });

    test("mission lifecycle: create, get, list, pause, resume, cancel, delete", () => {
      const mission = coordinator.createMission({
        name: "Cyberpunk Stock Asset Campaign",
        targetDomain: "adobe.com",
        goal: "Research, metadata authoring, and QA submission for cyberpunk textures",
        assignedAgents: ["researcher", "metadata", "qa", "reviewer"],
        contextData: { campaignId: "camp_123" },
      });

      expect(mission.id).toBeDefined();
      expect(mission.status).toBe("pending");

      const fetched = coordinator.getMission(mission.id);
      expect(fetched?.name).toBe("Cyberpunk Stock Asset Campaign");
      expect(fetched?.contextData.campaignId).toBe("camp_123");

      const paused = coordinator.pauseMission(mission.id, "Awaiting keyword review");
      expect(paused.status).toBe("pending");
      expect(paused.contextData.pauseReason).toBe("Awaiting keyword review");

      const resumed = coordinator.resumeMission(mission.id);
      expect(resumed.status).toBe("executing");

      const cancelled = coordinator.cancelMission(mission.id, "Budget exhausted");
      expect(cancelled.status).toBe("cancelled");

      const list = coordinator.listMissions({ targetDomain: "adobe.com" });
      expect(list.some((m) => m.id === mission.id)).toBe(true);

      const deleted = coordinator.deleteMission(mission.id);
      expect(deleted).toBe(true);
      expect(coordinator.getMission(mission.id)).toBeNull();
    });

    test("tracks agent dispatches and records cross-agent handshakes", () => {
      const mission = coordinator.createMission({
        name: "Handshake & Dispatch Test",
        targetDomain: "shutterstock.com",
        goal: "Verify dispatches and artifact transfer",
      });

      // Dispatch
      const dispatch = coordinator.createDispatch({
        missionId: mission.id,
        agentRole: "researcher",
        inputPayload: { query: "drone photography" },
      });
      expect(dispatch.status).toBe("running");

      coordinator.completeDispatch(dispatch.id, { resultCount: 42 }, 150);
      const dispatches = coordinator.listDispatches(mission.id);
      expect(dispatches.length).toBe(1);
      expect(dispatches[0].status).toBe("completed");
      expect(dispatches[0].durationMs).toBe(150);

      // Handshake
      const handshake = coordinator.sendHandshake({
        missionId: mission.id,
        fromAgent: "researcher",
        toAgent: "metadata",
        artifactType: "research_brief",
        payload: { topTags: ["drone", "aerial", "4k"] },
      });
      expect(handshake.id).toBeDefined();

      const handshakes = coordinator.getHandshakes(mission.id);
      expect(handshakes.length).toBe(1);
      expect(handshakes[0].artifactType).toBe("research_brief");
      expect(handshakes[0].fromAgent).toBe("researcher");
      expect(handshakes[0].toAgent).toBe("metadata");
    });

    test("executes individual multi-agent steps and supervisor approval gate", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://stock.adobe.com/contributor");
      bridge.activateTab(tab.id);

      const mission = coordinator.createMission({
        name: "Step By Step Orchestration Test",
        targetDomain: "stock.adobe.com",
        goal: "Verify sequential step execution",
      });

      // 1. Research Step
      const brief = await coordinator.runResearchStep(
        mission.id,
        "https://stock.adobe.com/search?k=minimalist",
        "Minimalist Architecture",
        tab.id,
      );
      expect(brief.recommendedTags.length).toBeGreaterThan(0);

      // 2. Metadata Step
      const meta = await coordinator.runMetadataStep(
        mission.id,
        "Modern Minimalist Concrete House",
        { autofillTabId: tab.id },
      );
      expect(meta.title).toContain("Modern Minimalist Concrete House");

      // 3. Upload Step
      const upload = await coordinator.runUploadStep(
        mission.id,
        ["/approved/assets/modern_house_01.jpg"],
        undefined,
        tab.id,
      );
      expect(upload.uploadedCount).toBe(1);

      // 4. QA Step
      const qa = await coordinator.runQAStep(mission.id, 1, tab.id);
      expect(qa.checks.length).toBeGreaterThan(0);

      // 5. Review Step
      const proposal = await coordinator.runReviewStep(
        mission.id,
        "submit_asset_batch",
        "https://stock.adobe.com",
        { count: 1 },
      );
      expect(proposal.recommendation).toBeDefined();

      // Check mission status reached awaiting_approval
      const awaiting = coordinator.getMission(mission.id);
      expect(awaiting?.status).toBe("awaiting_approval");

      // 6. Supervisor Approval Gate
      const approved = coordinator.submitApproval(mission.id, "approve", "session");
      expect(approved.status).toBe("completed");
      expect(approved.contextData.approvalDecision).toBe("approved");
    });

    test("executes end-to-end full mission pipeline", async () => {
      const bridge = getBrowserBridge();
      const tab = bridge.newTab("https://stock.adobe.com/contributor");
      bridge.activateTab(tab.id);

      const mission = coordinator.createMission({
        name: "Full Multi-Agent Pipeline Mission",
        targetDomain: "stock.adobe.com",
        goal: "End-to-end multi-agent execution",
      });

      const result = await coordinator.executeFullMission(mission.id, {
        url: "https://stock.adobe.com/search?k=cyberpunk",
        assetConcept: "Neon Cyberpunk City Alley",
        files: ["/approved/assets/cyberpunk_city.png"],
        tabId: tab.id,
      });

      expect(result.mission.status).toBe("awaiting_approval");
      expect(result.research.summary).toBeDefined();
      expect(result.metadata.title).toContain("Neon Cyberpunk City Alley");
      expect(result.upload?.uploadedCount).toBe(1);
      expect(result.qa.verdict).toBeDefined();
      expect(result.proposal.action).toBe("submit_asset_listing");
    });
  });

  describe("8. Canonical MCP Tools (`browser.agent.*`)", () => {
    test("registers 15 browser.agent.* tools with valid schema and execution", async () => {
      const tools = getMultiAgentMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(15);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("browser.agent.mission.create");
      expect(toolNames).toContain("browser.agent.mission.get");
      expect(toolNames).toContain("browser.agent.mission.list");
      expect(toolNames).toContain("browser.agent.mission.pause");
      expect(toolNames).toContain("browser.agent.mission.resume");
      expect(toolNames).toContain("browser.agent.mission.cancel");
      expect(toolNames).toContain("browser.agent.mission.approve");
      expect(toolNames).toContain("browser.agent.mission.execute");
      expect(toolNames).toContain("browser.agent.research");
      expect(toolNames).toContain("browser.agent.metadata.generate");
      expect(toolNames).toContain("browser.agent.upload");
      expect(toolNames).toContain("browser.agent.qa.evaluate");
      expect(toolNames).toContain("browser.agent.review");
      expect(toolNames).toContain("browser.agent.handshake.send");
      expect(toolNames).toContain("browser.agent.handshake.list");

      // Test handler browser.agent.mission.create
      const createTool = tools.find((t) => t.name === "browser.agent.mission.create")!;
      const created = (await createTool.handler({
        name: "MCP Multi-Agent Mission",
        targetDomain: "adobe.com",
        goal: "Test MCP tool execution",
      })) as MultiAgentMission;

      expect(created.id).toBeDefined();

      // Test handler browser.agent.mission.get
      const getTool = tools.find((t) => t.name === "browser.agent.mission.get")!;
      const details = (await getTool.handler({ id: created.id })) as any;
      expect(details.mission.name).toBe("MCP Multi-Agent Mission");
      expect(details.dispatches).toBeArray();
    });
  });

  describe("9. Management REST API Endpoints", () => {
    function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const init: RequestInit = { method };
      if (body) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const req = new Request(url, init);
      return {
        url,
        req,
        config: {} as any,
      };
    }

    test("REST API: Create, list, retrieve, pause, resume, cancel mission", async () => {
      // 1. POST /api/browser/missions
      const createCtx = makeCtx("/api/browser/missions", "POST", {
        name: "REST API Multi-Agent Mission",
        targetDomain: "freepik.com",
        goal: "Full lifecycle via REST",
        assignedAgents: ["researcher", "metadata", "qa"],
      });
      const createRes = await handleMultiAgentRoutes(createCtx);
      expect(createRes?.status).toBe(201);
      const createData = (await createRes?.json()) as any;
      const missionId = createData.mission.id;
      expect(missionId).toBeDefined();

      // 2. GET /api/browser/missions
      const listCtx = makeCtx("/api/browser/missions?targetDomain=freepik.com");
      const listRes = await handleMultiAgentRoutes(listCtx);
      expect(listRes?.status).toBe(200);
      const listData = (await listRes?.json()) as any;
      expect(listData.missions.some((m: any) => m.id === missionId)).toBe(true);

      // 3. GET /api/browser/missions/:id
      const getCtx = makeCtx(`/api/browser/missions/${missionId}`);
      const getRes = await handleMultiAgentRoutes(getCtx);
      expect(getRes?.status).toBe(200);
      const getData = (await getRes?.json()) as any;
      expect(getData.mission.name).toBe("REST API Multi-Agent Mission");

      // 4. POST /api/browser/missions/:id/pause
      const pauseCtx = makeCtx(`/api/browser/missions/${missionId}/pause`, "POST", {
        reason: "Test pause",
      });
      const pauseRes = await handleMultiAgentRoutes(pauseCtx);
      expect(pauseRes?.status).toBe(200);

      // 5. POST /api/browser/missions/:id/resume
      const resumeCtx = makeCtx(`/api/browser/missions/${missionId}/resume`, "POST");
      const resumeRes = await handleMultiAgentRoutes(resumeCtx);
      expect(resumeRes?.status).toBe(200);

      // 6. POST /api/browser/missions/:id/cancel
      const cancelCtx = makeCtx(`/api/browser/missions/${missionId}/cancel`, "POST", {
        reason: "Test cancel",
      });
      const cancelRes = await handleMultiAgentRoutes(cancelCtx);
      expect(cancelRes?.status).toBe(200);
    });

    test("REST API: Sub-routes for research, metadata, handshakes, approve, and browser-routes delegation", async () => {
      const coordinator = getBrowserMultiAgentCoordinator();
      const mission = coordinator.createMission({
        name: "Sub-routes Verification",
        targetDomain: "stock.adobe.com",
        goal: "Verify REST sub-routes",
      });

      // POST /api/browser/missions/:id/handshakes
      const sendHndCtx = makeCtx(`/api/browser/missions/${mission.id}/handshakes`, "POST", {
        fromAgent: "researcher",
        toAgent: "metadata",
        artifactType: "research_brief",
        payload: { summary: "REST Handshake Test" },
      });
      const sendHndRes = await handleMultiAgentRoutes(sendHndCtx);
      expect(sendHndRes?.status).toBe(201);

      // GET /api/browser/missions/:id/handshakes
      const getHndCtx = makeCtx(`/api/browser/missions/${mission.id}/handshakes`, "GET");
      const getHndRes = await handleMultiAgentRoutes(getHndCtx);
      expect(getHndRes?.status).toBe(200);
      const hndData = (await getHndRes?.json()) as any;
      expect(hndData.handshakes.length).toBe(1);

      // POST /api/browser/missions/:id/approve
      const apprCtx = makeCtx(`/api/browser/missions/${mission.id}/approve`, "POST", {
        decision: "approve",
        scope: "once",
      });
      const apprRes = await handleMultiAgentRoutes(apprCtx);
      expect(apprRes?.status).toBe(200);
      const apprData = (await apprRes?.json()) as any;
      expect(apprData.mission.status).toBe("completed");

      // Verify delegation via handleBrowserRoutes
      const delCtx = makeCtx(`/api/browser/missions/${mission.id}`, "GET");
      const delRes = await handleBrowserRoutes(delCtx);
      expect(delRes?.status).toBe(200);
    });
  });
});
