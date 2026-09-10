// Phase 20.16 — Multi-AI Control Plane: AI router.
//
// One AI does not do every job. This module decides which role leads a task and
// which role reviews it, so the same agent never both authors and approves — the
// reviewer independence that makes the council worth having.
//
// Routing is DATA, not code, so a change of provider is a config change.

import { type AgentIdentity, type AgentRole, type TaskType } from "./types";

export interface RouteDefinition {
  readonly primary: AgentIdentity;
  /** Reviewer, when the role is distinct from the author. */
  readonly reviewer?: AgentIdentity;
  /** Second reviewer for high-stakes work. */
  readonly secondReviewer?: AgentIdentity;
  /** True when local execution needs an approval before it may run. */
  readonly approvalRequired?: boolean;
}

/**
 * Default routing table.
 *
 * The reviewer is ALWAYS a different identity from the primary. A single model
 * reviewing its own work reproduces its own blind spots, which is the failure mode
 * this table exists to prevent.
 */
export const DEFAULT_ROUTES: Readonly<Record<string, RouteDefinition>> = {
  research: { primary: "supergrok", reviewer: "chatgpt" },
  architecture: { primary: "chatgpt", reviewer: "grok-expert" },
  coding: { primary: "codex", reviewer: "grok-expert", secondReviewer: "chatgpt" },
  security_review: { primary: "grok-expert", reviewer: "chatgpt" },
  image_concept: { primary: "grok-imagine", reviewer: "chatgpt" },
  video_concept: { primary: "grok-imagine", reviewer: "chatgpt" },
  local_execution: { primary: "pao-hubpro", approvalRequired: true },
};

/** Maps a task type onto a routing key. */
const TASK_TYPE_TO_ROUTE: Readonly<Record<TaskType, string>> = {
  research: "research",
  architecture: "architecture",
  feature: "coding",
  bugfix: "coding",
  refactor: "coding",
  test: "coding",
  review: "architecture",
  security_review: "security_review",
  image_concept: "image_concept",
  video_concept: "video_concept",
  local_execution: "local_execution",
  other: "architecture",
};

export interface RoutingDecision {
  readonly routeKey: string;
  readonly primary: AgentIdentity;
  readonly reviewers: readonly AgentIdentity[];
  readonly approvalRequired: boolean;
  readonly reason: string;
}

export function routeTask(
  taskType: TaskType,
  options: { routes?: Readonly<Record<string, RouteDefinition>> } = {},
): RoutingDecision {
  const routes = options.routes ?? DEFAULT_ROUTES;
  const routeKey = TASK_TYPE_TO_ROUTE[taskType] ?? "architecture";
  const definition = routes[routeKey];

  if (!definition) {
    // An unrouted task still has to land somewhere explicit. Defaulting to the
    // strongest reviewer pair is the safe direction: more scrutiny, not less.
    return {
      routeKey,
      primary: "codex",
      reviewers: ["grok-expert", "chatgpt"],
      approvalRequired: true,
      reason: "No route is configured for " + routeKey + "; defaulting to codex with dual review.",
    };
  }

  const reviewers: AgentIdentity[] = [];
  if (definition.reviewer) reviewers.push(definition.reviewer);
  if (definition.secondReviewer) reviewers.push(definition.secondReviewer);

  // An author never reviews its own work, even if a route configuration asks for it.
  const independent = reviewers.filter((reviewer) => reviewer !== definition.primary);

  return {
    routeKey,
    primary: definition.primary,
    reviewers: independent,
    approvalRequired: definition.approvalRequired ?? false,
    reason:
      "Task type " + taskType + " routes to " + routeKey + ": " + definition.primary +
      (independent.length > 0 ? " with review by " + independent.join(", ") : " with no separate reviewer configured") +
      ".",
  };
}

/** Convert a reviewer identity into the council role it plays. */
export function reviewerRole(identity: AgentIdentity): AgentRole {
  if (identity === "chatgpt") return "planner";
  if (identity === "grok-expert") return "reviewer";
  if (identity === "supergrok") return "researcher";
  if (identity === "grok-imagine") return "creative";
  return "reviewer";
}

