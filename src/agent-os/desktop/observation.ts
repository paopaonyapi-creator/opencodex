// Phase 20.3 — Desktop Observation & Capture Engine
//
// Normalizes window inspection, screen capture, UI Automation elements,
// screen change detection, and stale screenshot protection.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import { loadDesktopAgentConfig } from "./config";
import type {
  ObservationSnapshot,
  WindowSnapshot,
  UIElementSnapshot,
  DisplayTopology,
  ScreenCapture,
  HealthStatus,
  DesktopErrorCode,
} from "./types";

function generateSnapshotId(): string {
  return `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Capture Provider ─────────────────────────────────────────────────

export interface CaptureProvider {
  name: string;
  captureMonitor(monitorId?: number): Promise<ScreenCapture>;
  captureWindow(windowId: string): Promise<ScreenCapture>;
  captureRegion(region: { x: number; y: number; width: number; height: number }): Promise<ScreenCapture>;
  getTopology(): DisplayTopology;
  health(): HealthStatus;
}

export class MockCaptureProvider implements CaptureProvider {
  public name = "mock";
  private frameCounter = 0;

  public async captureMonitor(monitorId = 0): Promise<ScreenCapture> {
    this.frameCounter++;
    const now = new Date().toISOString();
    const frameId = `frame_${monitorId}_${this.frameCounter}`;
    const hash = createHash("sha256").update(frameId).digest("hex").slice(0, 16);

    return {
      frameId,
      capturedAt: now,
      width: 1920,
      height: 1080,
      dpi: 96,
      monitorId,
      screenHash: hash,
      dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
  }

  public async captureWindow(windowId: string): Promise<ScreenCapture> {
    this.frameCounter++;
    const now = new Date().toISOString();
    const frameId = `frame_win_${windowId}_${this.frameCounter}`;
    const hash = createHash("sha256").update(frameId).digest("hex").slice(0, 16);

    return {
      frameId,
      capturedAt: now,
      width: 1280,
      height: 720,
      dpi: 96,
      monitorId: 0,
      screenHash: hash,
      dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
  }

  public async captureRegion(region: { x: number; y: number; width: number; height: number }): Promise<ScreenCapture> {
    this.frameCounter++;
    const now = new Date().toISOString();
    const frameId = `frame_region_${this.frameCounter}`;
    const hash = createHash("sha256").update(`${frameId}:${region.x},${region.y}`).digest("hex").slice(0, 16);

    return {
      frameId,
      capturedAt: now,
      width: region.width,
      height: region.height,
      dpi: 96,
      monitorId: 0,
      screenHash: hash,
    };
  }

  public getTopology(): DisplayTopology {
    return {
      monitors: [
        {
          id: 0,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1.0,
          dpi: 96,
          isPrimary: true,
        },
      ],
      topologyHash: "topo_primary_1080p",
    };
  }

  public health(): HealthStatus {
    return "HEALTHY";
  }
}

// ─── UI Automation Adapter & Secret Redactor ──────────────────────────

export class UIAAdapter {
  private elements: UIElementSnapshot[] = [];

  constructor(initialElements?: UIElementSnapshot[]) {
    if (initialElements) {
      this.elements = initialElements;
    }
  }

  public setElements(elements: UIElementSnapshot[]): void {
    this.elements = elements.map((el) => this.redactIfSensitive(el));
  }

  public findByAutomationId(autoId: string): UIElementSnapshot | null {
    return this.elements.find((e) => e.automationId === autoId) ?? null;
  }

  public findByName(name: string): UIElementSnapshot | null {
    const lower = name.toLowerCase();
    return this.elements.find((e) => e.name.toLowerCase().includes(lower)) ?? null;
  }

  public findByControlType(controlType: string): UIElementSnapshot[] {
    return this.elements.filter((e) => e.controlType.toLowerCase() === controlType.toLowerCase());
  }

  public query(q: { automationId?: string; name?: string; controlType?: string }): UIElementSnapshot | null {
    if (q.automationId) {
      const el = this.findByAutomationId(q.automationId);
      if (el) return el;
    }
    if (q.name) {
      const el = this.findByName(q.name);
      if (el) return el;
    }
    if (q.controlType) {
      const all = this.findByControlType(q.controlType);
      if (all.length > 0) return all[0];
    }
    return null;
  }

  public redactIfSensitive(el: UIElementSnapshot): UIElementSnapshot {
    const nameLower = el.name.toLowerCase();
    const isPassword =
      el.controlType.toLowerCase() === "password" ||
      nameLower.includes("password") ||
      nameLower.includes("secret") ||
      nameLower.includes("pin") ||
      nameLower.includes("token") ||
      nameLower.includes("api key") ||
      nameLower.includes("credit card");

    if (isPassword) {
      return {
        ...el,
        valueRedacted: true,
      };
    }
    return el;
  }
}

// ─── Screen Change Detector ───────────────────────────────────────────

export class ChangeDetector {
  private lastHash: string | null = null;
  private lastChangeMs = Date.now();

  public detectChange(currentHash: string): {
    changed: boolean;
    changeScore: number;
    stableDurationMs: number;
  } {
    const now = Date.now();
    if (!this.lastHash) {
      this.lastHash = currentHash;
      this.lastChangeMs = now;
      return { changed: true, changeScore: 1.0, stableDurationMs: 0 };
    }

    if (this.lastHash !== currentHash) {
      this.lastHash = currentHash;
      this.lastChangeMs = now;
      return { changed: true, changeScore: 0.85, stableDurationMs: 0 };
    }

    const stableDurationMs = now - this.lastChangeMs;
    return { changed: false, changeScore: 0.0, stableDurationMs };
  }

  public reset(): void {
    this.lastHash = null;
    this.lastChangeMs = Date.now();
  }
}

// ─── Stale Screenshot Guard ───────────────────────────────────────────

export interface FrameMetadata {
  frameId: string;
  capturedAt: string;
  geometryHash: string;
  screenHash: string;
}

export class StaleGuard {
  public static isFresh(
    frame: FrameMetadata,
    currentGeometryHash: string,
    maxAgeMs = 1500,
  ): { fresh: boolean; error?: DesktopErrorCode; reason?: string } {
    const age = Date.now() - new Date(frame.capturedAt).getTime();
    if (age > maxAgeMs) {
      return {
        fresh: false,
        error: "STALE_OBSERVATION",
        reason: `Screenshot is stale (age ${age}ms > max ${maxAgeMs}ms)`,
      };
    }

    if (frame.geometryHash !== currentGeometryHash) {
      return {
        fresh: false,
        error: "STALE_OBSERVATION",
        reason: `Window geometry changed since capture (was ${frame.geometryHash}, now ${currentGeometryHash})`,
      };
    }

    return { fresh: true };
  }
}

// ─── Main Observation Engine ──────────────────────────────────────────

export class ObservationEngine {
  private captureProvider: CaptureProvider;
  private uiaAdapter: UIAAdapter;
  private changeDetector: ChangeDetector;
  private visibleWindows: WindowSnapshot[] = [];
  private foregroundWindow: WindowSnapshot | null = null;

  constructor(captureProvider?: CaptureProvider, uiaAdapter?: UIAAdapter) {
    this.captureProvider = captureProvider ?? new MockCaptureProvider();
    this.uiaAdapter = uiaAdapter ?? new UIAAdapter();
    this.changeDetector = new ChangeDetector();
    this.initDefaultMockWindows();
  }

  private initDefaultMockWindows(): void {
    const now = new Date().toISOString();
    const win1: WindowSnapshot = {
      windowId: "win_explorer_01",
      processId: 1001,
      processName: "explorer.exe",
      title: "File Explorer",
      className: "CabinetWClass",
      bounds: { x: 100, y: 100, width: 1000, height: 700 },
      clientBounds: { x: 108, y: 131, width: 984, height: 661 },
      monitorId: "0",
      dpi: 96,
      isVisible: true,
      isMinimized: false,
      isMaximized: false,
      isForeground: false,
      isAllowed: true,
      capturedAt: now,
    };

    const win2: WindowSnapshot = {
      windowId: "win_comfyui_01",
      processId: 2002,
      processName: "python.exe",
      title: "ComfyUI - [H3 Studio]",
      className: "Chrome_WidgetWin_1",
      bounds: { x: 50, y: 50, width: 1400, height: 900 },
      clientBounds: { x: 58, y: 81, width: 1384, height: 861 },
      monitorId: "0",
      dpi: 96,
      isVisible: true,
      isMinimized: false,
      isMaximized: true,
      isForeground: true,
      isAllowed: true,
      capturedAt: now,
    };

    this.visibleWindows = [win1, win2];
    this.foregroundWindow = win2;
  }

  public setWindows(windows: WindowSnapshot[], foregroundId?: string): void {
    this.visibleWindows = windows;
    if (foregroundId) {
      this.foregroundWindow = windows.find((w) => w.windowId === foregroundId) ?? null;
    } else {
      this.foregroundWindow = windows.find((w) => w.isForeground) ?? windows[0] ?? null;
    }
  }

  public listWindows(): WindowSnapshot[] {
    return this.visibleWindows;
  }

  public getForeground(): WindowSnapshot | null {
    return this.foregroundWindow;
  }

  public setForeground(windowId: string): WindowSnapshot | null {
    for (const w of this.visibleWindows) {
      w.isForeground = w.windowId === windowId;
      if (w.isForeground) {
        this.foregroundWindow = w;
      }
    }
    return this.foregroundWindow;
  }

  public getUIAAdapter(): UIAAdapter {
    return this.uiaAdapter;
  }

  public getCaptureProvider(): CaptureProvider {
    return this.captureProvider;
  }

  public async observe(sessionId: string, persistEvidence = false): Promise<ObservationSnapshot> {
    const config = loadDesktopAgentConfig();
    const monitor = await this.captureProvider.captureMonitor(0);
    const change = this.changeDetector.detectChange(monitor.screenHash);
    const topology = this.captureProvider.getTopology();
    const snapshotId = generateSnapshotId();

    const snapshot: ObservationSnapshot = {
      snapshotId,
      sessionId,
      capturedAt: monitor.capturedAt,
      displayTopologyHash: topology.topologyHash,
      foregroundWindow: this.foregroundWindow,
      visibleWindows: this.visibleWindows,
      uiaTreeHash: null,
      screenHash: monitor.screenHash,
      changeScore: change.changeScore,
      ocrSummary: null,
      visionSummary: null,
      redactionApplied: false,
    };

    if (persistEvidence || config.persistScreenshots) {
      try {
        const db = openAgentOsDb();
        db.query(`INSERT INTO desktop_evidence
          (id, session_id, type, captured_at, source, summary, redacted, hash, artifact_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          snapshotId,
          sessionId,
          "SCREEN_REGION",
          monitor.capturedAt,
          this.captureProvider.name,
          `Screen observation (hash: ${monitor.screenHash})`,
          0,
          monitor.screenHash,
          null,
        );
      } catch {
        // safe fallback
      }
    }

    return snapshot;
  }
}

let observationEngineInstance: ObservationEngine | null = null;

export function getObservationEngine(): ObservationEngine {
  if (!observationEngineInstance) {
    observationEngineInstance = new ObservationEngine();
  }
  return observationEngineInstance;
}

export function resetObservationEngineForTests(): void {
  observationEngineInstance = null;
}
