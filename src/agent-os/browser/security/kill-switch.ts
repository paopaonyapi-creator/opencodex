// Phase 20.11 — Emergency STOP AGENT Kill Switch
//
// Immediately terminates active automated agent browser commands,
// blocks new MCP control actions, preserves user browser state,
// and ensures manual human browser control is undisturbed.

import { EventEmitter } from "node:events";

export class BrowserKillSwitch extends EventEmitter {
  private active = false;
  private stopReason = "";
  private currentAbortController: AbortController | null = null;

  constructor() {
    super();
  }

  public isActive(): boolean {
    return this.active;
  }

  public getReason(): string {
    return this.stopReason;
  }

  public getAbortSignal(): AbortSignal | undefined {
    return this.currentAbortController?.signal;
  }

  public trigger(reason = "Manual STOP AGENT invoked by human user"): void {
    this.active = true;
    this.stopReason = reason;

    if (this.currentAbortController) {
      this.currentAbortController.abort(new Error("AGENT_STOPPED: " + reason));
    }
    this.currentAbortController = new AbortController();

    this.emit("agent_stopped", { reason, timestamp: new Date().toISOString() });
  }

  public reset(): void {
    this.active = false;
    this.stopReason = "";
    this.currentAbortController = new AbortController();
    this.emit("agent_resumed", { timestamp: new Date().toISOString() });
  }

  public ensureRunning(): void {
    if (this.active) {
      throw new Error(`AGENT_STOPPED: Browser agent control is paused by kill switch (${this.stopReason}).`);
    }
  }
}

let killSwitchInstance: BrowserKillSwitch | null = null;
export function getBrowserKillSwitch(): BrowserKillSwitch {
  if (!killSwitchInstance) {
    killSwitchInstance = new BrowserKillSwitch();
  }
  return killSwitchInstance;
}
