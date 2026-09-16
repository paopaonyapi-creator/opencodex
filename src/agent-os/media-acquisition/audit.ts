// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Media Acquisition Audit Logger

import { redactMediaSecrets } from "./vault";

export interface MediaAuditEvent {
  id: string;
  actor: string;
  tool: string;
  action: string;
  domain?: string;
  jobId?: string;
  permissionDecision: "allowed" | "denied";
  provider?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export class MediaAuditLogger {
  private events: MediaAuditEvent[] = [];
  private maxHistory = 1000;

  log(event: Omit<MediaAuditEvent, "id" | "timestamp">): MediaAuditEvent {
    const fullEvent: MediaAuditEvent = {
      ...event,
      id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      details: event.details ? JSON.parse(redactMediaSecrets(JSON.stringify(event.details))) : undefined,
    };

    this.events.unshift(fullEvent);
    if (this.events.length > this.maxHistory) {
      this.events.pop();
    }
    return fullEvent;
  }

  getEvents(limit = 100): MediaAuditEvent[] {
    return this.events.slice(0, limit);
  }
}
