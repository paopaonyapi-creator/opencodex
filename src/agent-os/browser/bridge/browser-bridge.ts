// Phase 20.11 — Browser Bridge Automation Engine
//
// Core orchestration engine linking MCP commands, safety policy,
// element resolution, tab management, and browser interaction.

import { EventEmitter } from "node:events";
import { openAgentOsDb } from "../../db";
import { getBrowserConfig } from "../config";
import { getPageReader } from "../extraction/page-reader";
import { getPageSnapshotEngine } from "../extraction/snapshot";
import { getElementResolver } from "../extraction/element-resolver";
import { getBrowserPolicyEngine } from "../security/policy-engine";
import { getBrowserRiskClassifier } from "../security/risk-classifier";
import { getBrowserApprovalManager } from "../security/approval-manager";
import { getBrowserKillSwitch } from "../security/kill-switch";
import { getBrowserAuditLogger } from "../security/audit-log";
import type {
  ActionProposal,
  BrowserStatus,
  BrowserTab,
  DownloadItem,
  ElementTarget,
  PageSnapshot,
} from "../types";

export interface BridgeTabState {
  tab: BrowserTab;
  html: string;
  snapshot: PageSnapshot | null;
}

export class BrowserBridge extends EventEmitter {
  private tabs = new Map<string, BridgeTabState>();
  private activeTabId: string | null = null;
  private currentWorkspace = "default";
  private running = true;
  private tabCounter = 1;
  private dlCounter = 1;

  constructor() {
    super();
    this.initDefaultSessionAndTab();
  }

  private initDefaultSessionAndTab(): void {
    const db = openAgentOsDb();
    const now = Date.now();

    // Ensure default session exists
    db.query(`
      INSERT INTO browser_sessions (id, name, workspace, status, created_at, updated_at)
      VALUES ('session_default', 'Default Session', 'default', 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(now, now);

    // Create initial tab
    const initialTabId = "tab_001";
    const initialTab: BrowserTab = {
      id: initialTabId,
      sessionId: "session_default",
      title: "New Tab",
      url: "about:blank",
      active: true,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };

    db.query(`
      INSERT INTO browser_tabs (id, session_id, title, url, active, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = excluded.updated_at
    `).run(
      initialTab.id,
      initialTab.sessionId,
      initialTab.title,
      initialTab.url,
      1,
      initialTab.status,
      now,
      now,
    );

    const defaultHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>New Tab</title></head>
        <body>
          <h1>Pao-hubPro Browser</h1>
          <p>Agent-Native Browser Runtime is active.</p>
        </body>
      </html>
    `;

    const snapshot = getPageSnapshotEngine().generateSnapshot(
      defaultHtml,
      initialTab.url,
      initialTab.title,
    );

    this.tabs.set(initialTabId, {
      tab: initialTab,
      html: defaultHtml,
      snapshot,
    });
    this.activeTabId = initialTabId;
  }

  public getStatus(): BrowserStatus {
    const config = getBrowserConfig();
    const killSwitch = getBrowserKillSwitch();

    return {
      running: this.running,
      version: config.version,
      activeWorkspace: this.currentWorkspace,
      activeTabId: this.activeTabId,
      tabs: this.tabs.size,
      killSwitchActive: killSwitch.isActive(),
      bridgePort: config.bridgePort,
      connectedAgents: ["codex", "claude", "pao-orchestrator"],
    };
  }

  // --- TAB MANAGEMENT ---

  public listTabs(): BrowserTab[] {
    return Array.from(this.tabs.values()).map((t) => t.tab);
  }

  public getActiveTab(): BrowserTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId)?.tab || null;
  }

  public newTab(url = "about:blank"): BrowserTab {
    getBrowserKillSwitch().ensureRunning();
    const id = `tab_${String(++this.tabCounter).padStart(3, "0")}`;
    const now = Date.now();

    // Deactivate others
    for (const item of this.tabs.values()) {
      item.tab.active = false;
    }

    const tab: BrowserTab = {
      id,
      sessionId: "session_default",
      title: "New Tab",
      url,
      active: true,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };

    const initialHtml = `<html><head><title>New Tab</title></head><body><h1>${url}</h1></body></html>`;
    const snapshot = getPageSnapshotEngine().generateSnapshot(initialHtml, url, "New Tab");

    this.tabs.set(id, { tab, html: initialHtml, snapshot });
    this.activeTabId = id;

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_tabs (id, session_id, title, url, active, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tab.sessionId, tab.title, tab.url, 1, tab.status, now, now);

    this.emit("tab.created", tab);
    return tab;
  }

  public closeTab(tabId?: string): boolean {
    getBrowserKillSwitch().ensureRunning();
    const id = tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) return false;

    this.tabs.delete(id);
    const db = openAgentOsDb();
    db.query("DELETE FROM browser_tabs WHERE id = ?").run(id);

    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.keys());
      this.activeTabId = remaining.length > 0 ? remaining[0] : null;
      if (this.activeTabId) {
        const next = this.tabs.get(this.activeTabId);
        if (next) next.tab.active = true;
      }
    }

    this.emit("tab.closed", { id });
    return true;
  }

  public activateTab(tabId: string): boolean {
    getBrowserKillSwitch().ensureRunning();
    if (!this.tabs.has(tabId)) return false;

    for (const [id, item] of this.tabs.entries()) {
      item.tab.active = id === tabId;
    }
    this.activeTabId = tabId;

    const db = openAgentOsDb();
    db.query("UPDATE browser_tabs SET active = CASE WHEN id = ? THEN 1 ELSE 0 END").run(tabId);

    this.emit("tab.changed", { id: tabId });
    return true;
  }

  // --- NAVIGATION ---

  public async navigate(url: string, tabId?: string): Promise<{ success: boolean; url: string; title: string }> {
    getBrowserKillSwitch().ensureRunning();
    const startMs = Date.now();
    const id = tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) {
      throw new Error("TAB_NOT_FOUND");
    }

    const state = this.tabs.get(id)!;
    const policy = getBrowserPolicyEngine().evaluateAction("navigate", url);
    if (policy.status === "deny") {
      throw new Error(`SECURITY_POLICY_DENIED: ${policy.reason}`);
    }

    // Update state
    state.tab.status = "loading";
    state.tab.url = url;

    // Simulate or load page DOM
    let pageTitle = "Example Page";
    let bodyContent = `
      <div class="header">
        <a href="/">Dashboard</a>
        <a href="/stock">Adobe Stock</a>
      </div>
      <div class="content">
        <h1>Welcome to ${url}</h1>
        <form action="/submit" method="POST">
          <input type="text" name="title" placeholder="Title" value="" />
          <input type="text" name="keywords" placeholder="Keywords" value="" />
          <button type="submit">Submit</button>
          <button type="button">Upload</button>
        </form>
      </div>
    `;

    if (url.includes("adobe")) {
      pageTitle = "Adobe Stock Contributor";
      bodyContent = `
        <header><a href="/">Adobe Stock</a></header>
        <main>
          <h2>Contributor Portal</h2>
          <button id="upload-btn">Upload</button>
          <input name="asset_title" placeholder="Title" />
          <input name="keywords" placeholder="Keywords" />
          <button type="submit" id="submit-btn">Submit</button>
        </main>
      `;
    }

    const html = `<!DOCTYPE html><html><head><title>${pageTitle}</title></head><body>${bodyContent}</body></html>`;
    state.html = html;
    state.tab.title = pageTitle;
    state.tab.status = "ready";
    state.tab.updatedAt = Date.now();
    state.snapshot = getPageSnapshotEngine().generateSnapshot(html, url, pageTitle);

    const db = openAgentOsDb();
    db.query("UPDATE browser_tabs SET title = ?, url = ?, status = ?, updated_at = ? WHERE id = ?").run(
      pageTitle,
      url,
      "ready",
      Date.now(),
      id,
    );

    getBrowserAuditLogger().record({
      timestamp: new Date().toISOString(),
      agent: "agent",
      tabId: id,
      tool: "browser.navigate",
      arguments: { url },
      url,
      riskLevel: "LOW",
      approvalStatus: "not_required",
      result: "success",
      durationMs: Date.now() - startMs,
    });

    this.emit("navigation.completed", { id, url, title: pageTitle });
    return { success: true, url, title: pageTitle };
  }

  public reload(tabId?: string): Promise<{ success: boolean; url: string; title: string }> {
    const id = tabId || this.activeTabId;
    const tab = id ? this.tabs.get(id)?.tab : null;
    return this.navigate(tab?.url || "about:blank", id || undefined);
  }

  // --- EXTRACTION ---

  public readPage(tabId?: string): Record<string, unknown> {
    getBrowserKillSwitch().ensureRunning();
    const id = tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) throw new Error("TAB_NOT_FOUND");

    const state = this.tabs.get(id)!;
    const extracted = getPageReader().extractFromHtml(state.html, state.tab.url);
    return extracted as unknown as Record<string, unknown>;
  }

  public getSnapshot(tabId?: string): PageSnapshot {
    getBrowserKillSwitch().ensureRunning();
    const id = tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) throw new Error("TAB_NOT_FOUND");

    const state = this.tabs.get(id)!;
    if (!state.snapshot) {
      state.snapshot = getPageSnapshotEngine().generateSnapshot(state.html, state.tab.url, state.tab.title);
    }
    return state.snapshot;
  }

  // --- ACTIONS & EXECUTION ---

  public async executeAction(proposal: ActionProposal): Promise<{ success: boolean; message?: string; url?: string }> {
    getBrowserKillSwitch().ensureRunning();
    const startMs = Date.now();
    const id = proposal.tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) throw new Error("TAB_NOT_FOUND");

    const state = this.tabs.get(id)!;
    const agent = proposal.agent || "codex";

    // 1. Policy check
    const policyResult = getBrowserPolicyEngine().evaluateAction(proposal.tool, state.tab.url);
    if (policyResult.status === "deny") {
      getBrowserAuditLogger().record({
        timestamp: new Date().toISOString(),
        agent,
        tabId: id,
        tool: proposal.tool,
        arguments: proposal as any,
        url: state.tab.url,
        riskLevel: "CONTROLLED",
        approvalStatus: "rejected",
        result: "denied",
        error: policyResult.reason,
        durationMs: Date.now() - startMs,
      });
      throw new Error(`SECURITY_POLICY_DENIED: ${policyResult.reason}`);
    }

    // 2. Risk classification
    const riskLevel = getBrowserRiskClassifier().classify(proposal);

    // 3. Human approval gate if CONFIRM_REQUIRED or Policy Requires Confirmation
    let approvalStatus: "not_required" | "approved_once" | "approved_session" | "rejected" = "not_required";
    if (riskLevel === "CONFIRM_REQUIRED" || policyResult.status === "confirm") {
      const approval = await getBrowserApprovalManager().requestApproval(
        agent,
        proposal.tool,
        state.tab.url,
        `Action '${proposal.tool}' classified as high risk (${riskLevel})`,
        { target: proposal.target, text: proposal.text },
      );

      if (approval.status === "rejected") {
        getBrowserAuditLogger().record({
          timestamp: new Date().toISOString(),
          agent,
          tabId: id,
          tool: proposal.tool,
          arguments: proposal as any,
          url: state.tab.url,
          riskLevel,
          approvalStatus: "rejected",
          result: "rejected",
          error: "ACTION_REJECTED by human supervisor",
          durationMs: Date.now() - startMs,
        });
        throw new Error("ACTION_REJECTED: Action was rejected by supervisor.");
      }
      approvalStatus = approval.status;
    }

    // 4. Resolve element if target specified
    if (proposal.target) {
      const snapshot = this.getSnapshot(id);
      const resolved = getElementResolver().resolve(proposal.target, snapshot);
      if (!resolved) {
        throw new Error("ELEMENT_NOT_FOUND: Could not resolve target element on current page.");
      }
    }

    // 5. Execute simulated interaction
    if (proposal.tool === "browser.type" && proposal.text && proposal.target) {
      // update value in snapshot
      const snapshot = this.getSnapshot(id);
      const resolved = getElementResolver().resolve(proposal.target, snapshot);
      if (resolved) {
        resolved.element.value = proposal.text;
      }
    }

    getBrowserAuditLogger().record({
      timestamp: new Date().toISOString(),
      agent,
      tabId: id,
      tool: proposal.tool,
      arguments: proposal as any,
      url: state.tab.url,
      riskLevel,
      approvalStatus,
      result: "success",
      durationMs: Date.now() - startMs,
    });

    return { success: true, url: state.tab.url };
  }

  // --- SCREENSHOT ---

  public captureScreenshot(tabId?: string): { mimeType: string; dataBase64: string } {
    getBrowserKillSwitch().ensureRunning();
    const id = tabId || this.activeTabId;
    if (!id || !this.tabs.has(id)) throw new Error("TAB_NOT_FOUND");

    // Returns a valid 1x1 base64 transparent PNG
    const dummyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    return {
      mimeType: "image/png",
      dataBase64: dummyPngBase64,
    };
  }

  // --- DOWNLOADS ---

  public getDownloads(): DownloadItem[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM browser_downloads ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      tabId: r.tab_id ? String(r.tab_id) : undefined,
      filename: String(r.filename),
      url: String(r.url),
      mimeType: r.mime_type ? String(r.mime_type) : undefined,
      sizeBytes: Number(r.size_bytes),
      status: String(r.status) as any,
      localPath: r.local_path ? String(r.local_path) : undefined,
      initiatingAgent: r.initiating_agent ? String(r.initiating_agent) : undefined,
      workflowId: r.workflow_id ? String(r.workflow_id) : undefined,
      createdAt: Number(r.created_at),
      completedAt: r.completed_at ? Number(r.completed_at) : undefined,
    }));
  }

  public addDownload(item: Omit<DownloadItem, "id" | "createdAt">): DownloadItem {
    const id = `dl_${String(++this.dlCounter).padStart(3, "0")}`;
    const now = Date.now();
    const dl: DownloadItem = { id, ...item, createdAt: now };

    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_downloads (id, tab_id, filename, url, mime_type, size_bytes, status, local_path, initiating_agent, workflow_id, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      dl.tabId || null,
      dl.filename,
      dl.url,
      dl.mimeType || null,
      dl.sizeBytes,
      dl.status,
      dl.localPath || null,
      dl.initiatingAgent || null,
      dl.workflowId || null,
      now,
      dl.completedAt || null,
    );

    this.emit("download.started", dl);
    return dl;
  }
}

let browserBridgeInstance: BrowserBridge | null = null;
export function getBrowserBridge(): BrowserBridge {
  if (!browserBridgeInstance) {
    browserBridgeInstance = new BrowserBridge();
  }
  return browserBridgeInstance;
}
