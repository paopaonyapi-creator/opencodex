import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import type { AcquisitionPlan, AcquisitionRequest, PolicyDecision } from "./types";
import { AcquisitionError } from "./types";
import { classifySource, primarySource } from "./classify";

export function decideAcquisitionPolicy(req: AcquisitionRequest, plan: AcquisitionPlan): PolicyDecision {
  const source = primarySource(req);
  if (req.source.kind === "url" || req.source.kind === "batch") {
    const urls = Array.isArray(req.source.value) ? req.source.value : [source];
    for (const url of urls) {
      try {
        validateAndNormalizeUrl(url);
      } catch (err) {
        throw new AcquisitionError("INVALID_SOURCE", 400, err instanceof Error ? err.message : "invalid source");
      }
    }
  }

  const classified = classifySource(source);
  const reasons: string[] = ["actor:" + req.actor.type, "auth:" + classified.authClass];

  if (classified.authClass === "BLOCKED_OR_DRM") {
    return { decision: "deny", reasonCodes: [...reasons, "drm_or_protected"] };
  }

  if (classified.authClass === "ACCOUNT_WRITE_CAPABLE") {
    return { decision: "require_approval", reasonCodes: [...reasons, "account_write"] };
  }

  if (classified.authClass === "SESSION_REQUIRED" || req.authContext?.browserSessionRef) {
    return {
      decision: "require_approval",
      reasonCodes: [...reasons, "authenticated_retrieval"],
      constraints: { allowAuthentication: true, allowKnowledgeIngest: Boolean(req.options?.ingestKnowledge) },
    };
  }

  const items = Array.isArray(req.source.value) ? req.source.value.length : 1;
  const maxItems = req.options?.maxItems ?? 100;
  if (items > maxItems) {
    return { decision: "deny", reasonCodes: [...reasons, "batch_limit"], constraints: { maxItems } };
  }

  if (req.options?.ingestKnowledge && req.policyContext.purpose === "stock_research") {
    return {
      decision: "allow_with_limits",
      reasonCodes: [...reasons, "knowledge_opt_in", "commercial_unknown"],
      constraints: { allowKnowledgeIngest: true, maxItems, maxBytes: 20 * 1024 * 1024 * 1024 },
    };
  }

  if (plan.riskClass === "blocked") {
    throw new AcquisitionError("POLICY_DENIED", 403, "plan is blocked");
  }

  return {
    decision: "allow",
    reasonCodes: [...reasons, "public_source"],
    constraints: {
      maxItems,
      maxBytes: 20 * 1024 * 1024 * 1024,
      allowAuthentication: false,
      allowKnowledgeIngest: Boolean(req.options?.ingestKnowledge),
      allowedOutputRoot: "runtime/acquisition",
    },
  };
}
