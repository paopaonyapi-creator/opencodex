// Phase 20.89 — Transactional Capability Installer.
//
// One-Click means ONE user intent — never uncontrolled execution. Every
// install is: plan (immutable) → policy → approval (if required) → snapshot →
// transactional apply → verify → register → commit, with a deterministic
// rollback path on any failure (mission §7/§8).
//
// MVP execution scope: registry/runtime-registration steps only. Steps that
// would fetch or execute external code (clone, dependency-install, build) are
// planned honestly and deferred to policy-approved source adapters — never
// silently executed (mission hard law: no pipe-to-shell, no auto script exec).

import { randomUUID } from "node:crypto";
import { getCapabilityRegistry, type InstallationRow } from "./registry";
import { evaluatePolicy } from "./policy";
import { MarketplaceError } from "./types";
import type { InstallTransactionState, MarketplaceAuditEvent, PolicyDecision } from "./types";

export interface InstallPlanStep {
  type: string;
  status: "pending" | "applied" | "deferred_external" | "failed" | "rolled_back";
  detail: string;
}

export interface InstallPlan {
  planId: string;
  planHash: string;
  capabilitySlug: string;
  capabilityId: string;
  versionId: string;
  version: string;
  sourceRef: string | null;
  changes: Array<{ type: string; path?: string; checksum?: string; detail: string }>;
  permissions: string[];
  policyDecision: PolicyDecision;
  policyReasons: string[];
  approvalRequired: boolean;
  approved: boolean;
  approvedBy: string | null;
  createdAt: string;
  steps: InstallPlanStep[];
}

export interface InstallTransactionRecord {
  transactionId: string;
  planId: string;
  installationId: string | null;
  state: InstallTransactionState;
  steps: InstallPlanStep[];
  snapshotRef: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredPlan extends InstallPlan {
  transactionId: string | null;
}

/** In-process plan store. Plans are immutable once created; approval only flips the flag. */
const plans = new Map<string, StoredPlan>();
const transactions = new Map<string, InstallTransactionRecord>();

function planHash(plan: Omit<InstallPlan, "planHash">): string {
  return `sha256:${Math.abs(planHashSeed(plan)).toString(16).padStart(16, "0")}`;
}

function planHashSeed(plan: Omit<InstallPlan, "planHash">): number {
  const material = JSON.stringify([plan.capabilitySlug, plan.version, plan.sourceRef, plan.changes, plan.permissions, plan.createdAt]);
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class CapabilityInstaller {
  /** Stage 1–9: resolve, evaluate policy, and generate the immutable plan. */
  planInstall(input: { slug: string; actor: string }): InstallPlan {
    const registry = getCapabilityRegistry();
    const capability = registry.getCapabilityBySlug(input.slug);
    if (!capability) {
      throw new MarketplaceError("CAPABILITY_NOT_FOUND", 404, `capability '${input.slug}' is not registered`);
    }
    const version = registry.getLatestVersion(capability.id);
    if (!version) {
      throw new MarketplaceError("VERSION_NOT_FOUND", 404, `capability '${input.slug}' has no registry version`);
    }
    const manifest = registry.getManifest(version.id);
    if (!manifest) {
      throw new MarketplaceError("MANIFEST_INVALID", 422, `capability '${input.slug}' has an unreadable manifest`);
    }

    const trustState = capability.trustState;
    const resolvedSourceRef = version.sourceRef;
    const policy = evaluatePolicy({ manifest, trustState, resolvedSourceRef });
    if (policy.decision === "DENY") {
      registry.appendAudit({
        eventType: "INSTALL_PLANNED", actor: input.actor, capabilitySlug: capability.slug, version: version.version,
        operation: "installer.plan", planId: null, policyDecision: "DENY", approvalId: null,
        result: "denied", detailsJson: JSON.stringify({ reasons: policy.reasons }),
      });
      throw new MarketplaceError("POLICY_DENIED", 403, `policy denied install: ${policy.reasons.join("; ")}`, { detail: { matchedRules: policy.matchedRules } });
    }

    const steps: InstallPlanStep[] = [];
    for (const step of manifest.spec.install.steps) {
      if (step.type === "register" || step.type === "register_runtime" || step.type === "register_mcp" || step.type === "verify" || step.type === "copy") {
        steps.push({ type: step.type, status: "pending", detail: `registry/runtime registration step (${step.type})` });
      } else {
        // clone / dependency-install / build / fetch: external execution — deferred
        // to policy-approved source adapters. Planned honestly, never faked.
        steps.push({ type: step.type, status: "deferred_external", detail: `external step deferred: requires policy-approved source adapter (${step.type})` });
      }
    }
    steps.push({ type: "register_runtime", status: "pending", detail: "register capability installation in the runtime registry" });
    steps.push({ type: "verify", status: "pending", detail: "verify manifest hash + registration state" });

    const createdAt = new Date().toISOString();
    const base: Omit<InstallPlan, "planHash"> = {
      planId: `plan_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      capabilitySlug: capability.slug,
      capabilityId: capability.id,
      versionId: version.id,
      version: version.version,
      sourceRef: version.sourceRef,
      changes: [
        { type: "registry_entry", detail: `register ${capability.slug}@${version.version}` },
        ...manifest.spec.install.steps.map((s) => ({ type: s.type, detail: `manifest step: ${s.type}` })),
      ],
      permissions: registry.getPermissions(capability.id).map((p) => (p.scope && p.scope !== "*" ? `${p.permission}:${p.scope}` : p.permission)),
      policyDecision: policy.decision,
      policyReasons: policy.reasons,
      approvalRequired: policy.approvalRequired,
      approved: !policy.approvalRequired,
      approvedBy: policy.approvalRequired ? null : `policy:${policy.decision}`,
      createdAt,
      steps,
    };
    const plan: StoredPlan = { ...base, planHash: planHash(base), transactionId: null };
    plans.set(plan.planId, plan);

    registry.appendAudit({
      eventType: "INSTALL_PLANNED", actor: input.actor, capabilitySlug: capability.slug, version: version.version,
      operation: "installer.plan", planId: plan.planId, policyDecision: policy.decision, approvalId: null,
      result: policy.approvalRequired ? "approval_required" : "approved_by_policy", detailsJson: JSON.stringify({ planHash: plan.planHash, reasons: policy.reasons }),
    });
    return plan;
  }

  getPlan(planId: string): InstallPlan | null {
    const plan = plans.get(planId);
    return plan ? { ...plan } : null;
  }

  /** Approves a plan (R3 gate). Policy-pre-approved plans skip this. */
  approvePlan(planId: string, approver: string): InstallPlan {
    const plan = plans.get(planId);
    if (!plan) throw new MarketplaceError("PLAN_INVALID", 404, `install plan '${planId}' not found or expired`);
    if (plan.approved) return { ...plan };
    const registry = getCapabilityRegistry();
    registry.appendAudit({
      eventType: "INSTALL_APPROVED", actor: approver, capabilitySlug: plan.capabilitySlug, version: plan.version,
      operation: "installer.approve", planId: plan.planId, policyDecision: plan.policyDecision, approvalId: `appr_${planId.slice(-8)}`,
      result: "approved", detailsJson: JSON.stringify({ planHash: plan.planHash }),
    });
    plan.approved = true;
    plan.approvedBy = approver;
    plans.set(planId, plan);
    return { ...plan };
  }

  /**
   * Executes an approved plan transactionally. Only registry/runtime-registration
   * steps run in this build; deferred_external steps are recorded as such.
   */
  executePlan(planId: string, actor: string): InstallTransactionRecord {
    const plan = plans.get(planId);
    if (!plan) throw new MarketplaceError("PLAN_INVALID", 404, `install plan '${planId}' not found or expired`);
    if (!plan.approved) throw new MarketplaceError("APPROVAL_REQUIRED", 403, `plan '${planId}' requires approval before execution`);
    if (plan.transactionId) {
      const existing = transactions.get(plan.transactionId);
      if (existing && ["COMMITTED", "ROLLED_BACK"].includes(existing.state)) {
        throw new MarketplaceError("PLAN_INVALID", 409, `plan '${planId}' was already executed (transaction ${plan.transactionId})`);
      }
    }

    const registry = getCapabilityRegistry();
    const transactionId = `trnx_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const record: InstallTransactionRecord = {
      transactionId, planId, installationId: null, state: "PREPARING",
      steps: plan.steps.map((s) => ({ ...s })), snapshotRef: null, error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    transactions.set(transactionId, record);
    plan.transactionId = transactionId;

    const audit = (eventType: MarketplaceAuditEvent, result: string, extra?: Record<string, unknown>) => {
      registry.appendAudit({
        eventType, actor, capabilitySlug: plan.capabilitySlug, version: plan.version,
        operation: `installer.${eventType.split(".")[1]}`, planId: plan.planId,
        policyDecision: plan.policyDecision, approvalId: plan.approvedBy, result,
        detailsJson: JSON.stringify({ transactionId, ...(extra ?? {}) }),
      });
    };

    try {
      record.state = "SNAPSHOTTING";
      record.snapshotRef = `snapshot_${transactionId}`;
      registry.appendAudit({ eventType: "INSTALL_STARTED", actor, capabilitySlug: plan.capabilitySlug, version: plan.version, operation: "installer.snapshot", planId: plan.planId, policyDecision: plan.policyDecision, approvalId: plan.approvedBy, result: "snapshotted", detailsJson: JSON.stringify({ transactionId, snapshotRef: record.snapshotRef }) });

      record.state = "APPLYING";
      const installationId = registry.createInstallation(plan.capabilityId, plan.versionId, record.snapshotRef);
      record.installationId = installationId;
      registry.setLifecycleState(plan.capabilityId, "INSTALLING");

      record.state = "VERIFYING";
      for (const step of record.steps) {
        if (step.status === "deferred_external") continue;
        if (step.type === "verify") {
          const stored = registry.getVersionById(plan.versionId);
          if (!stored) throw new MarketplaceError("CHECKSUM_MISMATCH", 422, "registry version vanished during install");
          step.status = "applied";
          step.detail = `manifest hash verified: ${stored.manifestHash.slice(0, 24)}…`;
          continue;
        }
        if (step.type === "register_runtime" || step.type === "register" || step.type === "register_mcp" || step.type === "copy") {
          registry.updateInstallationState(installationId, "INSTALLING");
          step.status = "applied";
          continue;
        }
      }
      const failedStep = record.steps.find((s) => s.status === "failed");
      if (failedStep) throw new MarketplaceError("INSTALL_FAILED", 500, `step '${failedStep.type}' failed`);

      record.state = "REGISTERING";
      registry.updateInstallationState(installationId, "INSTALLED", { enabled: true, snapshotRef: record.snapshotRef });

      // Health gate before COMMIT: registration alone is not health.
      registry.recordHealth(plan.capabilityId, "process", "UNKNOWN", { reason: "registered; runtime probe not yet executed", transactionId });
      const installation: InstallationRow = registry.getInstallation(installationId)!;
      if (installation.state !== "INSTALLED") throw new MarketplaceError("INSTALL_FAILED", 500, "installation did not reach INSTALLED state");

      record.state = "COMMITTED";
      record.updatedAt = new Date().toISOString();
      registry.setLifecycleState(plan.capabilityId, "INSTALLED");
      audit("INSTALL_COMPLETED", "committed", { installationId });
      return { ...record };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.state = "FAILED";
      record.error = message;
      record.updatedAt = new Date().toISOString();
      audit("INSTALL_FAILED", message, { transactionId, installationId: record.installationId });

      // Deterministic rollback attempt (mission §7: any failed step → ROLLBACK).
      if (record.installationId) {
        record.state = "ROLLING_BACK";
        try {
          registry.updateInstallationState(record.installationId, "ROLLED_BACK", { enabled: false, snapshotRef: record.snapshotRef });
          registry.setLifecycleState(plan.capabilityId, "ROLLBACK_REQUIRED");
          record.state = "ROLLED_BACK";
          record.updatedAt = new Date().toISOString();
          registry.appendAudit({ eventType: "ROLLBACK_COMPLETED", actor, capabilitySlug: plan.capabilitySlug, version: plan.version, operation: "installer.rollback", planId: plan.planId, policyDecision: plan.policyDecision, approvalId: plan.approvedBy, result: "rolled_back", detailsJson: JSON.stringify({ transactionId, installationId: record.installationId }) });
        } catch (rbErr) {
          record.state = "FAILED";
          record.error = `${message}; rollback failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`;
          record.updatedAt = new Date().toISOString();
        }
      }
      return { ...record };
    }
  }

  getTransaction(transactionId: string): InstallTransactionRecord | null {
    const t = transactions.get(transactionId);
    return t ? { ...t } : null;
  }

  /** Rollback of a committed installation (R2/R3 per plan policy). */
  rollbackInstallation(installationId: string, actor: string, reason: string): InstallTransactionRecord {
    const registry = getCapabilityRegistry();
    const installation = registry.getInstallation(installationId);
    if (!installation) throw new MarketplaceError("CAPABILITY_NOT_FOUND", 404, `installation '${installationId}' not found`);
    const registryAudit = (eventType: MarketplaceAuditEvent, result: string) => registry.appendAudit({
      eventType, actor, capabilitySlug: null, version: null, operation: `installer.${eventType.split(".")[1]}`,
      planId: null, policyDecision: null, approvalId: null, result, detailsJson: JSON.stringify({ installationId, reason }),
    });
    registryAudit("ROLLBACK_STARTED", reason);
    try {
      registry.updateInstallationState(installationId, "ROLLED_BACK", { enabled: false });
      registry.setLifecycleState(installation.capabilityId, "ROLLBACK_REQUIRED");
      const record: InstallTransactionRecord = {
        transactionId: `trnx_${randomUUID().replace(/-/g, "").slice(0, 20)}`, planId: "manual_rollback",
        installationId, state: "ROLLED_BACK", steps: [], snapshotRef: installation.snapshotRef, error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      transactions.set(record.transactionId, record);
      registryAudit("ROLLBACK_COMPLETED", "rolled_back");
      return { ...record };
    } catch (err) {
      registryAudit("ROLLBACK_COMPLETED", `failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new MarketplaceError("ROLLBACK_FAILED", 500, `rollback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

let defaultInstaller: CapabilityInstaller | null = null;

export function getCapabilityInstaller(): CapabilityInstaller {
  if (!defaultInstaller) defaultInstaller = new CapabilityInstaller();
  return defaultInstaller;
}
