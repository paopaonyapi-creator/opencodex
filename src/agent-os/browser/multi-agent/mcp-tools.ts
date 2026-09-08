// Phase 20.13 — Pao-hubPro Browser Multi-Agent MCP Tools
//
// Exposes 15 canonical `browser.agent.*` MCP tools allowing AI models
// (Codex, Claude, ChatGPT, Local AI) to orchestrate multi-agent web operations,
// dispatch specialized personas, audit form state, and execute coordinated pipelines.

import type { McpToolDefinition } from "../mcp-tools";
import { getBrowserMultiAgentCoordinator } from "./coordinator";
import type { AgentRole, HandshakeArtifactType, MissionStatus } from "./types";

export function getMultiAgentMcpTools(): McpToolDefinition[] {
  const coordinator = getBrowserMultiAgentCoordinator();

  return [
    // Mission Management
    {
      name: "browser.agent.mission.create",
      description: "Creates and saves a new multi-agent web operations mission.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable name of the mission" },
          targetDomain: { type: "string", description: "Target website or platform domain" },
          goal: { type: "string", description: "Primary operational objective of the mission" },
          assignedAgents: {
            type: "array",
            items: {
              type: "string",
              enum: ["researcher", "metadata", "uploader", "qa", "reviewer", "coordinator"],
            },
            description: "Agent roles participating in this mission",
          },
          contextData: { type: "object", description: "Initial mission context metadata" },
          evidencePackId: { type: "string", description: "Optional evidence pack ID" },
        },
        required: ["name", "targetDomain", "goal"],
      },
      handler: (args: {
        name: string;
        targetDomain: string;
        goal: string;
        assignedAgents?: AgentRole[];
        contextData?: Record<string, unknown>;
        evidencePackId?: string;
      }) => coordinator.createMission(args),
    },
    {
      name: "browser.agent.mission.get",
      description: "Fetches full details of a multi-agent mission including dispatches, handshakes, and QA reports.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mission ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => {
        const mission = coordinator.getMission(args.id);
        if (!mission) return { error: `Mission '${args.id}' not found` };
        const dispatches = coordinator.listDispatches(args.id);
        const handshakes = coordinator.getHandshakes(args.id);
        const qaEvaluations = coordinator.getQAEvaluations(args.id);
        return {
          mission,
          dispatches,
          handshakes,
          qaEvaluations,
        };
      },
    },
    {
      name: "browser.agent.mission.list",
      description: "Lists multi-agent missions with optional domain and status filters.",
      inputSchema: {
        type: "object",
        properties: {
          targetDomain: { type: "string", description: "Filter by target domain" },
          status: {
            type: "string",
            enum: [
              "pending",
              "researching",
              "drafting",
              "uploading",
              "qa_evaluating",
              "awaiting_approval",
              "executing",
              "completed",
              "failed",
              "cancelled",
            ],
            description: "Filter by mission status",
          },
          limit: { type: "number", description: "Maximum records to return", default: 50 },
        },
      },
      handler: (args: { targetDomain?: string; status?: MissionStatus; limit?: number }) =>
        coordinator.listMissions(args),
    },
    {
      name: "browser.agent.mission.pause",
      description: "Pauses an in-flight multi-agent mission.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mission ID" },
          reason: { type: "string", description: "Reason for pausing" },
        },
        required: ["id"],
      },
      handler: (args: { id: string; reason?: string }) => coordinator.pauseMission(args.id, args.reason),
    },
    {
      name: "browser.agent.mission.resume",
      description: "Resumes a paused multi-agent mission.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mission ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => coordinator.resumeMission(args.id),
    },
    {
      name: "browser.agent.mission.cancel",
      description: "Cancels a multi-agent mission.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mission ID" },
          reason: { type: "string", description: "Cancellation reason" },
        },
        required: ["id"],
      },
      handler: (args: { id: string; reason?: string }) => coordinator.cancelMission(args.id, args.reason),
    },
    {
      name: "browser.agent.mission.approve",
      description: "Supervisor records approval decision ('approve' | 'reject' | 'stop_agent') for a mission awaiting confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Mission ID" },
          decision: {
            type: "string",
            enum: ["approve", "reject", "stop_agent"],
            description: "Supervisor gate decision",
          },
          scope: {
            type: "string",
            enum: ["once", "session"],
            description: "Approval duration scope",
            default: "once",
          },
        },
        required: ["id", "decision"],
      },
      handler: (args: { id: string; decision: "approve" | "reject" | "stop_agent"; scope?: "once" | "session" }) =>
        coordinator.submitApproval(args.id, args.decision, args.scope || "once"),
    },
    {
      name: "browser.agent.mission.execute",
      description: "Runs the complete multi-agent web operations pipeline end-to-end.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Target mission ID" },
          url: { type: "string", description: "Target web URL" },
          assetConcept: { type: "string", description: "Asset concept or subject" },
          files: { type: "array", items: { type: "string" }, description: "Asset files to upload (must be allowlisted)" },
          targetSelector: { type: "string", description: "DOM selector for file input" },
          tabId: { type: "string", description: "Target tab ID" },
        },
        required: ["missionId", "url", "assetConcept"],
      },
      handler: (args: {
        missionId: string;
        url: string;
        assetConcept: string;
        files?: string[];
        targetSelector?: string;
        tabId?: string;
      }) => coordinator.executeFullMission(args.missionId, args),
    },

    // Specialized Persona Tools
    {
      name: "browser.agent.research",
      description: "Dispatches the Research Web Agent to survey domain, extract competitors, and synthesize trending tags.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Associated mission ID" },
          url: { type: "string", description: "Target research destination URL" },
          topic: { type: "string", description: "Research topic or commercial asset category" },
          tabId: { type: "string", description: "Optional browser tab ID" },
        },
        required: ["missionId", "url"],
      },
      handler: (args: { missionId: string; url: string; topic?: string; tabId?: string }) =>
        coordinator.runResearchStep(args.missionId, args.url, args.topic, args.tabId),
    },
    {
      name: "browser.agent.metadata.generate",
      description: "Dispatches Metadata Web Agent to generate commercial titles, descriptions, keyword tags, and autofill forms.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Associated mission ID" },
          assetConcept: { type: "string", description: "Asset concept or subject keywords" },
          maxKeywords: { type: "number", description: "Maximum number of keywords (default: 30)" },
          category: { type: "string", description: "Target commercial category" },
          autofillTabId: { type: "string", description: "Optional tab ID to autofill into active form" },
        },
        required: ["missionId", "assetConcept"],
      },
      handler: (args: {
        missionId: string;
        assetConcept: string;
        maxKeywords?: number;
        category?: string;
        autofillTabId?: string;
      }) => coordinator.runMetadataStep(args.missionId, args.assetConcept, args),
    },
    {
      name: "browser.agent.upload",
      description: "Dispatches Upload Web Agent to upload assets with strict File Allowlist validation.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Associated mission ID" },
          filePaths: { type: "array", items: { type: "string" }, description: "File paths to upload" },
          targetSelector: { type: "string", description: "DOM selector of file input element" },
          tabId: { type: "string", description: "Optional tab ID" },
        },
        required: ["missionId", "filePaths"],
      },
      handler: (args: { missionId: string; filePaths: string[]; targetSelector?: string; tabId?: string }) =>
        coordinator.runUploadStep(args.missionId, args.filePaths, args.targetSelector, args.tabId),
    },
    {
      name: "browser.agent.qa.evaluate",
      description: "Dispatches QA Web Agent to audit form fields, completeness, validation errors, and capture screenshot evidence.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Associated mission ID" },
          stepIndex: { type: "number", description: "Current step index", default: 1 },
          tabId: { type: "string", description: "Optional tab ID" },
        },
        required: ["missionId"],
      },
      handler: (args: { missionId: string; stepIndex?: number; tabId?: string }) =>
        coordinator.runQAStep(args.missionId, args.stepIndex || 1, args.tabId),
    },
    {
      name: "browser.agent.review",
      description: "Dispatches Reviewer Council Web Agent to evaluate action safety and formulate structured approval proposals.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Associated mission ID" },
          action: { type: "string", description: "Proposed browser action" },
          url: { type: "string", description: "Target website URL" },
          affectedData: { type: "object", description: "Summary of data being mutated" },
        },
        required: ["missionId", "action", "url"],
      },
      handler: (args: {
        missionId: string;
        action: string;
        url: string;
        affectedData?: Record<string, unknown>;
      }) => coordinator.runReviewStep(args.missionId, args.action, args.url, args.affectedData || {}),
    },

    // Handshakes
    {
      name: "browser.agent.handshake.send",
      description: "Sends and records a structured cross-agent handshake artifact between roles.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Mission ID" },
          fromAgent: {
            type: "string",
            enum: ["researcher", "metadata", "uploader", "qa", "reviewer", "coordinator"],
          },
          toAgent: {
            type: "string",
            enum: ["researcher", "metadata", "uploader", "qa", "reviewer", "coordinator"],
          },
          artifactType: {
            type: "string",
            enum: [
              "research_brief",
              "metadata_payload",
              "upload_receipt",
              "qa_report",
              "approval_proposal",
              "custom",
            ],
          },
          payload: { type: "object", description: "Artifact payload data" },
        },
        required: ["missionId", "fromAgent", "toAgent", "artifactType", "payload"],
      },
      handler: (args: {
        missionId: string;
        fromAgent: AgentRole;
        toAgent: AgentRole;
        artifactType: HandshakeArtifactType;
        payload: Record<string, unknown>;
      }) => coordinator.sendHandshake(args),
    },
    {
      name: "browser.agent.handshake.list",
      description: "Retrieves all cross-agent handshake artifacts recorded for a mission.",
      inputSchema: {
        type: "object",
        properties: {
          missionId: { type: "string", description: "Mission ID" },
        },
        required: ["missionId"],
      },
      handler: (args: { missionId: string }) => coordinator.getHandshakes(args.missionId),
    },
  ];
}
