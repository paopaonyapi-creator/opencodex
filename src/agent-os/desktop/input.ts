// Phase 20.3 — Desktop Virtual Input Engine
//
// Controlled virtual mouse and keyboard operations with active key/button ledger
// and fail-safe release guarantees on emergency stop or finally blocks.

import { getEmergencyStop, getSafetyPolicyEvaluator } from "./safety";

export class MouseController {
  private heldButtons = new Set<string>();
  private currentPosition = { x: 0, y: 0 };
  private history: { action: string; x?: number; y?: number; button?: string; ts: number }[] = [];

  constructor() {
    // Register with emergency stop controller
    getEmergencyStop().registerReleaseCallback(() => this.releaseAll());
  }

  public getPosition(): { x: number; y: number } {
    return { ...this.currentPosition };
  }

  public getHeldButtons(): string[] {
    return Array.from(this.heldButtons);
  }

  public getHistory(): typeof this.history {
    return [...this.history];
  }

  public move(x: number, y: number, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const rate = getSafetyPolicyEvaluator().checkRateLimit(false);
    if (!rate.allowed) throw new Error(rate.reason);

    this.currentPosition = { x, y };
    this.history.push({ action: "move", x, y, ts: Date.now() });

    if (!dryRun) {
      // OS input dispatch simulation / native bridge hook
    }
  }

  public click(x?: number, y?: number, button = "left", dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const rate = getSafetyPolicyEvaluator().checkRateLimit(true);
    if (!rate.allowed) throw new Error(rate.reason);

    const targetX = x ?? this.currentPosition.x;
    const targetY = y ?? this.currentPosition.y;
    this.currentPosition = { x: targetX, y: targetY };

    this.history.push({ action: "click", x: targetX, y: targetY, button, ts: Date.now() });

    if (!dryRun) {
      // Emulate press and release
      this.buttonDown(button, true);
      this.buttonUp(button, true);
    }
  }

  public doubleClick(x?: number, y?: number, button = "left", dryRun = false): void {
    this.click(x, y, button, dryRun);
    this.click(x, y, button, dryRun);
    this.history.push({ action: "double_click", x: this.currentPosition.x, y: this.currentPosition.y, button, ts: Date.now() });
  }

  public drag(fromX: number, fromY: number, toX: number, toY: number, dryRun = false): void {
    this.move(fromX, fromY, dryRun);
    this.buttonDown("left", dryRun);
    this.move(toX, toY, dryRun);
    this.buttonUp("left", dryRun);
    this.history.push({ action: "drag", x: toX, y: toY, ts: Date.now() });
  }

  public scroll(deltaX: number, deltaY: number, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const rate = getSafetyPolicyEvaluator().checkRateLimit(false);
    if (!rate.allowed) throw new Error(rate.reason);

    this.history.push({ action: "scroll", x: deltaX, y: deltaY, ts: Date.now() });
  }

  public buttonDown(button = "left", dryRun = false): void {
    this.heldButtons.add(button);
  }

  public buttonUp(button = "left", dryRun = false): void {
    this.heldButtons.delete(button);
  }

  public releaseAll(): void {
    this.heldButtons.clear();
    this.history.push({ action: "release_all_mouse", ts: Date.now() });
  }

  public clearHistory(): void {
    this.history = [];
  }
}

export class KeyboardController {
  private heldKeys = new Set<string>();
  private history: { action: string; key?: string; text?: string; ts: number }[] = [];

  constructor() {
    getEmergencyStop().registerReleaseCallback(() => this.releaseAll());
  }

  public getHeldKeys(): string[] {
    return Array.from(this.heldKeys);
  }

  public getHistory(): typeof this.history {
    return [...this.history];
  }

  public keyDown(key: string, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    this.heldKeys.add(key.toLowerCase());
    this.history.push({ action: "key_down", key, ts: Date.now() });
  }

  public keyUp(key: string, dryRun = false): void {
    this.heldKeys.delete(key.toLowerCase());
    this.history.push({ action: "key_up", key, ts: Date.now() });
  }

  public press(key: string, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const rate = getSafetyPolicyEvaluator().checkRateLimit(false);
    if (!rate.allowed) throw new Error(rate.reason);

    this.keyDown(key, dryRun);
    this.keyUp(key, dryRun);
    this.history.push({ action: "press", key, ts: Date.now() });
  }

  public hotkey(combo: string, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const parts = combo.split("+").map((p) => p.trim());

    // Press all keys down
    for (const p of parts) {
      this.keyDown(p, dryRun);
    }
    // Release all in reverse
    for (let i = parts.length - 1; i >= 0; i--) {
      this.keyUp(parts[i], dryRun);
    }

    this.history.push({ action: "hotkey", key: combo, ts: Date.now() });
  }

  public typeText(text: string, dryRun = false): void {
    if (getEmergencyStop().isStopped()) throw new Error("Input halted: Emergency stop active");
    const rate = getSafetyPolicyEvaluator().checkRateLimit(false);
    if (!rate.allowed) throw new Error(rate.reason);

    this.history.push({ action: "type_text", text, ts: Date.now() });
  }

  public releaseAll(): void {
    this.heldKeys.clear();
    this.history.push({ action: "release_all_keys", ts: Date.now() });
  }

  public clearHistory(): void {
    this.history = [];
  }
}

let mouseInstance: MouseController | null = null;
let keyboardInstance: KeyboardController | null = null;

export function getMouseController(): MouseController {
  if (!mouseInstance) {
    mouseInstance = new MouseController();
  }
  return mouseInstance;
}

export function getKeyboardController(): KeyboardController {
  if (!keyboardInstance) {
    keyboardInstance = new KeyboardController();
  }
  return keyboardInstance;
}

export function resetInputControllersForTests(): void {
  mouseInstance = null;
  keyboardInstance = null;
}
