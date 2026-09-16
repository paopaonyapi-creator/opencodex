// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Permission Model & Risk Tier Evaluator

import type { PermissionTier } from "./types";
import { MediaError } from "./errors";

export interface PermissionEvaluation {
  allowed: boolean;
  tier: PermissionTier;
  reason?: string;
}

export class MediaPermissionEngine {
  private authenticatedSessionsEnabled = false;

  setAuthenticatedSessions(enabled: boolean): void {
    this.authenticatedSessionsEnabled = enabled;
  }

  evaluateAction(action: string, context?: { url?: string; secretRef?: string }): PermissionEvaluation {
    switch (action) {
      // Tier 0: Read / Inspect
      case "inspect":
      case "status":
      case "health":
      case "list_jobs":
      case "get_job":
      case "get_metadata":
      case "get_transcript":
      case "list_artifacts":
        return { allowed: true, tier: 0 };

      // Tier 1: Local Processing
      case "transcribe":
      case "convert":
      case "extract_audio":
      case "thumbnail":
        return { allowed: true, tier: 1 };

      // Tier 2: Public Network Acquisition
      case "download":
      case "download_batch":
        if (context?.secretRef && !this.authenticatedSessionsEnabled) {
          return {
            allowed: false,
            tier: 3,
            reason: "Authenticated media acquisition is disabled by default. Enable via security settings.",
          };
        }
        return { allowed: true, tier: 2 };

      // Tier 3: Sensitive Acquisition
      case "authenticated_download":
      case "use_cookie":
        if (!this.authenticatedSessionsEnabled) {
          return {
            allowed: false,
            tier: 3,
            reason: "Authenticated session access is currently disabled.",
          };
        }
        return { allowed: true, tier: 3 };

      // Tier 4: Forbidden Capabilities
      case "export_cookies":
      case "dump_vault":
      case "bypass_drm":
      case "arbitrary_shell":
      default:
        return {
          allowed: false,
          tier: 4,
          reason: `Action '${action}' is forbidden by media acquisition zero-trust policy.`,
        };
    }
  }

  assertAllowed(action: string, context?: { url?: string; secretRef?: string }): void {
    const res = this.evaluateAction(action, context);
    if (!res.allowed) {
      throw new MediaError(
        "MEDIA_PERMISSION_DENIED",
        res.reason || `Permission denied for action '${action}' (Tier ${res.tier}).`,
      );
    }
  }
}
