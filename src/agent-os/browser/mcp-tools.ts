// Phase 20.11 — Pao-hubPro Browser MCP Tools
//
// 15+ Canonical MCP tools under the `browser.*` namespace allowing AI agents
// (Codex, Claude, ChatGPT, Local AI) to safely inspect and control the browser runtime.

import { getBrowserBridge } from "./bridge/browser-bridge";
import { getBrowserKillSwitch } from "./security/kill-switch";
import { getBrowserApprovalManager } from "./security/approval-manager";
import { getPageSnapshotEngine } from "./extraction/snapshot";
import { getWorkflowMcpTools } from "./workflow/mcp-tools";
import { getMultiAgentMcpTools } from "./multi-agent/mcp-tools";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<any> | any;
}

export function getBrowserMcpTools(): McpToolDefinition[] {
  const bridge = getBrowserBridge();
  const killSwitch = getBrowserKillSwitch();
  const approvalManager = getBrowserApprovalManager();

  return [
    {
      name: "browser.status",
      description: "Returns the current state of Pao-hubPro Browser runtime, tabs, and safety gates.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: () => bridge.getStatus(),
    },
    {
      name: "browser.list_tabs",
      description: "Lists all currently open tabs in the browser workspace.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: () => bridge.listTabs(),
    },
    {
      name: "browser.new_tab",
      description: "Opens a new tab with the specified URL or blank page.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Initial URL to load" },
        },
      },
      handler: (args: { url?: string }) => bridge.newTab(args?.url),
    },
    {
      name: "browser.close_tab",
      description: "Closes a browser tab by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string", description: "Tab ID to close (defaults to active tab)" },
        },
      },
      handler: (args: { tabId?: string }) => ({ success: bridge.closeTab(args?.tabId) }),
    },
    {
      name: "browser.activate_tab",
      description: "Activates and brings to focus the specified tab.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string", description: "Tab ID to activate" },
        },
        required: ["tabId"],
      },
      handler: (args: { tabId: string }) => ({ success: bridge.activateTab(args.tabId) }),
    },
    {
      name: "browser.navigate",
      description: "Navigates the current or specified tab to a web URL.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL to navigate to" },
          tabId: { type: "string", description: "Optional tab ID" },
        },
        required: ["url"],
      },
      handler: (args: { url: string; tabId?: string }) => bridge.navigate(args.url, args.tabId),
    },
    {
      name: "browser.reload",
      description: "Reloads the current page.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => bridge.reload(args?.tabId),
    },
    {
      name: "browser.get_url",
      description: "Returns the current URL of the active tab.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => {
        const tab = args?.tabId ? bridge.listTabs().find((t) => t.id === args.tabId) : bridge.getActiveTab();
        return { url: tab?.url || "about:blank" };
      },
    },
    {
      name: "browser.get_title",
      description: "Returns the page title of the active tab.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => {
        const tab = args?.tabId ? bridge.listTabs().find((t) => t.id === args.tabId) : bridge.getActiveTab();
        return { title: tab?.title || "" };
      },
    },
    {
      name: "browser.read_page",
      description: "Extracts readable text, links, forms, and buttons from the current page.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => bridge.readPage(args?.tabId),
    },
    {
      name: "browser.snapshot",
      description: "Generates a structured accessibility snapshot with short element refs ([e1], [e2]...) for AI interaction.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => {
        const snapshot = bridge.getSnapshot(args?.tabId);
        const formatted = getPageSnapshotEngine().formatSnapshotText(snapshot);
        return {
          url: snapshot.url,
          title: snapshot.title,
          elements: snapshot.elements,
          formatted,
        };
      },
    },
    {
      name: "browser.click",
      description: "Clicks on an interactive element identified by ref (e.g. 'e2') or role/name.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Snapshot element reference, e.g. 'e1', 'e2'" },
          button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
          tabId: { type: "string" },
        },
        required: ["ref"],
      },
      handler: (args: { ref: string; button?: "left" | "right" | "middle"; tabId?: string }) =>
        bridge.executeAction({
          tool: "browser.click",
          tabId: args.tabId,
          target: args.ref,
          button: args.button || "left",
        }),
    },
    {
      name: "browser.type",
      description: "Types text into a form input or textbox identified by ref.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Snapshot element reference, e.g. 'e3'" },
          text: { type: "string", description: "Text string to type" },
          sensitive: { type: "boolean", description: "If true, hides text from audit logs" },
          tabId: { type: "string" },
        },
        required: ["ref", "text"],
      },
      handler: (args: { ref: string; text: string; sensitive?: boolean; tabId?: string }) =>
        bridge.executeAction({
          tool: "browser.type",
          tabId: args.tabId,
          target: args.ref,
          text: args.text,
          sensitive: args.sensitive,
        }),
    },
    {
      name: "browser.scroll",
      description: "Scrolls the page viewport horizontally and vertically.",
      inputSchema: {
        type: "object",
        properties: {
          deltaX: { type: "number", default: 0 },
          deltaY: { type: "number", default: 300 },
          tabId: { type: "string" },
        },
      },
      handler: (args: { deltaX?: number; deltaY?: number; tabId?: string }) =>
        bridge.executeAction({
          tool: "browser.scroll",
          tabId: args.tabId,
          deltaX: args.deltaX || 0,
          deltaY: args.deltaY || 300,
        }),
    },
    {
      name: "browser.screenshot",
      description: "Captures a screenshot of the active page as base64 PNG data.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" },
        },
      },
      handler: (args: { tabId?: string }) => bridge.captureScreenshot(args?.tabId),
    },
    {
      name: "browser.get_downloads",
      description: "Retrieves list of tracked file downloads and their completion statuses.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: () => bridge.getDownloads(),
    },
    {
      name: "browser.stop_agent",
      description: "Emergency kill switch: stops all active browser agent actions immediately and restores manual human control.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
      },
      handler: (args: { reason?: string }) => {
        killSwitch.trigger(args?.reason || "Invoked via MCP");
        return { success: true, killSwitchActive: true };
      },
    },
    {
      name: "browser.approve_action",
      description: "Supervisor approves a pending Level 3 browser action.",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "Approval request ID" },
          mode: { type: "string", enum: ["once", "session"], default: "once" },
        },
        required: ["approvalId"],
      },
      handler: (args: { approvalId: string; mode?: "once" | "session" }) => ({
        success: approvalManager.approve(args.approvalId, args.mode || "once"),
      }),
    },
    {
      name: "browser.reject_action",
      description: "Supervisor rejects a pending Level 3 browser action.",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "Approval request ID" },
        },
        required: ["approvalId"],
      },
      handler: (args: { approvalId: string }) => ({
        success: approvalManager.reject(args.approvalId),
      }),
    },
    ...getWorkflowMcpTools(),
    ...getMultiAgentMcpTools(),
  ];
}
