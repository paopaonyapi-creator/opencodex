// Phase 20.61 — Agent Runtime configuration.
//
// Feature-flagged off by default (spec §23 staged rollout). amux connection
// settings mirror the upstream server env (AMUX_RS_PORT 8824, AMUX_AUTH_TOKEN
// bearer). All values validated against the pinned runtime at health time —
// the adapter fails closed on a version mismatch.

import type { WorkerRole } from "./types";

export interface AgentRuntimeConfig {
  enabled: boolean;
  provider: string;
  amuxBaseUrl: string;
  amuxToken: string;
  amuxTokenSecretRef: string;
  requestTimeoutMs: number;
  pinnedRuntimeCommit: string;
  /** Comma-separated upstream API families the adapter may rely on. */
  allowedApiFamilies: string[];
  leaseSeconds: number;
  heartbeatSeconds: number;
  recoveryGraceSeconds: number;
  maxAttempts: number;
  workspaceRoot: string;
  defaultPolicyProfile: string;
  networkDefault: "deny" | "allow";
  protectedBranches: string[];
  dispatchEnabled: boolean;
  recoveryEnabled: boolean;
  workerRoles: WorkerRole[];
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  const networkDefault = process.env.PAO_AGENT_RUNTIME_NETWORK_DEFAULT?.trim();
  return {
    enabled: process.env.PAO_AGENT_RUNTIME_ENABLED === "true",
    provider: process.env.PAO_AGENT_RUNTIME_PROVIDER?.trim() || "amux",
    amuxBaseUrl: (process.env.PAO_AMUX_BASE_URL?.trim() || "https://127.0.0.1:8824").replace(/\/+$/, ""),
    amuxToken: process.env.PAO_AMUX_TOKEN?.trim() || process.env.AMUX_TOKEN?.trim() || "",
    amuxTokenSecretRef: process.env.PAO_AMUX_TOKEN_SECRET_REF?.trim() || "",
    requestTimeoutMs: intEnv("PAO_AMUX_REQUEST_TIMEOUT_MS", 10_000, 500, 120_000),
    // Pinned upstream commit (spec §25). Recorded in docs/integrations/amux-compatibility.md.
    pinnedRuntimeCommit: process.env.PAO_AMUX_PINNED_COMMIT?.trim() || "3a205a41a60ea790dfae48a5056ef70d6f9361e9",
    allowedApiFamilies: (process.env.PAO_AMUX_API_FAMILIES?.trim() || "health,board,sessions,sync").split(",").map((s) => s.trim()).filter(Boolean),
    leaseSeconds: intEnv("PAO_AGENT_RUNTIME_LEASE_SECONDS", 60, 10, 3_600),
    heartbeatSeconds: intEnv("PAO_AGENT_RUNTIME_HEARTBEAT_SECONDS", 15, 5, 600),
    recoveryGraceSeconds: intEnv("PAO_AGENT_RUNTIME_RECOVERY_GRACE_SECONDS", 30, 0, 3_600),
    maxAttempts: intEnv("PAO_AGENT_RUNTIME_MAX_ATTEMPTS", 3, 1, 10),
    workspaceRoot: process.env.PAO_AGENT_RUNTIME_WORKSPACE_ROOT?.trim() || "",
    defaultPolicyProfile: process.env.PAO_AGENT_RUNTIME_DEFAULT_POLICY?.trim() || "restricted-dev",
    networkDefault: networkDefault === "allow" ? "allow" : "deny",
    protectedBranches: (process.env.PAO_AGENT_RUNTIME_PROTECTED_BRANCHES?.trim() || "main,master,dev").split(",").map((s) => s.trim()).filter(Boolean),
    dispatchEnabled: process.env.PAO_AGENT_RUNTIME_DISPATCH_ENABLED === "true",
    recoveryEnabled: process.env.PAO_AGENT_RUNTIME_RECOVERY_ENABLED !== "false",
    workerRoles: (process.env.PAO_AGENT_RUNTIME_ROLES?.trim() || "planner,implementer,tester,reviewer,recovery-controller,release-controller")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as WorkerRole[],
  };
}
