// Phase 20.60 — Pao-owned WebMCP tools for the social publishing control plane.
//
// Agent-facing surface per spec §22. Nothing here hands an agent raw OpenPost
// access or credentials: every tool resolves through the service, whose
// executor verifies policy + approval against persisted state server-side
// regardless of what the MCP client claims (spec §22 "High-impact mutation",
// §37.9). High-impact tools (schedule/publish) are R3; read-only R0; the two
// non-publishing mutations R1.

import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { getSocialPublishingService } from "./service";
import { SocialPublishingHttpError } from "./types";

function service() {
  return getSocialPublishingService();
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new SocialPublishingHttpError("SOCIAL_INVALID_INPUT", 400, "missing required string argument: " + key);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export const SOCIAL_PUBLISHING_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "social_list_accounts",
    description: "List OpenPost-connected social accounts with readiness and capability state. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const accounts = service().listAccounts();
      const instanceId = optionalString(args, "instance_id");
      return {
        accounts: (instanceId ? accounts.filter((a) => a.instanceId === instanceId) : accounts).map((a) => ({
          id: a.id,
          platform: a.platform,
          username: a.username,
          readinessState: a.readinessState,
          enabled: a.enabled,
          lastSyncAt: a.lastSyncAt,
        })),
      };
    },
  },
  {
    name: "social_get_account_readiness",
    description: "Read the current readiness state, reason, and capability snapshot for one account. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const account = service().requireAccount(requireString(args, "account_id"));
      return {
        id: account.id,
        platform: account.platform,
        readinessState: account.readinessState,
        readinessReason: account.readinessReason,
        capabilities: account.capabilities,
        lastSyncAt: account.lastSyncAt,
      };
    },
  },
  {
    name: "social_get_publication",
    description: "Read one publication with renditions, delivery state, approvals, and jobs. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => service().getPublication(requireString(args, "publication_id")),
  },
  {
    name: "social_list_publications",
    description: "List master publications, optionally filtered by status. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ publications: service().listPublications({ status: optionalString(args, "status") }) }),
  },
  {
    name: "social_preview_renditions",
    description: "Preview the destination-specific renditions planned for a publication without validating or dispatching. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const publication = service().getPublication(requireString(args, "publication_id"));
      return {
        publication: publication.publication,
        renditions: publication.renditions.map((r) => ({
          id: r.id,
          platform: r.platform,
          format: r.format,
          title: r.title,
          caption: r.caption,
          hashtags: r.hashtags,
          contentHash: r.contentHash,
          validationStatus: r.validationStatus,
        })),
      };
    },
  },
  {
    name: "social_validate_publication",
    description: "Re-run capability-driven validation for a publication's renditions. Mutating (stores validation state) but never publishes.",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) => await service().validatePublication(requireString(args, "publication_id")),
  },
  {
    name: "social_request_approval",
    description: "Move a publication into the human approval queue. Mutating but non-publishing.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) =>
      service().requestApproval(requireString(args, "publication_id"), { type: "agent", id: optionalString(args, "actor_id") ?? "agent" }),
  },
  {
    name: "social_get_approval_status",
    description: "Read the approval records bound to a publication's content hashes. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ approvals: service().getPublication(requireString(args, "publication_id")).approvals }),
  },
  {
    name: "social_schedule_publication",
    description:
      "Schedule an approved publication through OpenPost. High-impact: requires a stored human approval bound to the exact content hash; policy and approval are re-verified server-side.",
    riskTier: "R3",
    readOnly: false,
    execute: async (args) => {
      const job = await service().schedulePublication(requireString(args, "publication_id"), {
        scheduledAt: requireString(args, "scheduled_at"),
        actorType: "agent",
        actorId: optionalString(args, "actor_id") ?? "agent",
      });
      return { job };
    },
  },
  {
    name: "social_publish_publication",
    description:
      "Publish an approved publication now through OpenPost. High-impact: requires a stored human approval bound to the exact content hash; policy and approval are re-verified server-side.",
    riskTier: "R3",
    readOnly: false,
    execute: async (args) => {
      const job = await service().publishNow(requireString(args, "publication_id"), {
        type: "agent",
        id: optionalString(args, "actor_id") ?? "agent",
      });
      return { job };
    },
  },
  {
    name: "social_get_delivery_status",
    description: "Read delivery jobs and per-rendition delivery state for a publication. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const state = service().getPublication(requireString(args, "publication_id"));
      return {
        status: state.publication.status,
        renditions: state.renditions.map((r) => ({ id: r.id, platform: r.platform, deliveryStatus: r.deliveryStatus, remoteRef: r.openpostPublicationRef })),
        jobs: state.jobs,
      };
    },
  },
  {
    name: "social_get_analytics",
    description: "Read the latest normalized analytics snapshots, optionally scoped to a publication or account. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({
      snapshots: service().listAnalytics({ publicationId: optionalString(args, "publication_id"), accountId: optionalString(args, "account_id") }),
    }),
  },
];
