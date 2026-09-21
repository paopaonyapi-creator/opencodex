// Phase 20.98 — Per-agent sandbox fabric & workspace jail (spec §9, §36).
//
// Default restrictions (hard invariants):
//   - Host filesystem → DENY
//   - Docker socket mount → DENY
//   - Privileged container → DENY
//   - Host network → DENY
//   - Arbitrary device mounts → DENY
//   - Credential directories (.ssh, .aws, .opencodex, etc.) → DENY
//   - Unnecessary Linux capabilities → DROP (default cap-drop ALL, add minimal)
//   - Inbound network → DENY
//   - Outbound network → restricted
//
// Workspace boundary directories:
//   /input, /work, /output, /cache, /tmp
//
// Exported artifacts MUST pass policy checks before egress.

import { sha256Hex } from "../agent-runtime/hash";
import { HermitError } from "./types";

export interface SandboxPolicyConfig {
  backend: "docker" | "e2b" | "daytona" | "none";
  image: string;
  memoryLimitMb: number;
  cpuLimitCores: number;
  readOnlyRootfs: boolean;
  dropCapabilities: string[];
  allowedOutboundHosts: string[];
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicyConfig = {
  backend: "docker",
  image: "opencodex-agent-sandbox:latest",
  memoryLimitMb: 1024,
  cpuLimitCores: 2,
  readOnlyRootfs: true,
  dropCapabilities: ["ALL"],
  allowedOutboundHosts: ["api.openai.com", "api.anthropic.com", "github.com"],
};

export interface WorkspaceBoundaries {
  input: string; // /input
  work: string; // /work
  output: string; // /output
  cache: string; // /cache
  tmp: string; // /tmp
}

export const CANONICAL_BOUNDARIES: WorkspaceBoundaries = {
  input: "/input",
  work: "/work",
  output: "/output",
  cache: "/cache",
  tmp: "/tmp",
};

export class SandboxFabric {
  private readonly config: SandboxPolicyConfig;

  constructor(cfg?: Partial<SandboxPolicyConfig>) {
    this.config = { ...DEFAULT_SANDBOX_POLICY, ...(cfg ?? {}) };
  }

  /**
   * Validate container execution parameters against hard security invariants (spec §9).
   * Throws SandboxSecurityError / HermitError if any restriction is violated.
   */
  validateContainerSpec(spec: {
    privileged?: boolean;
    networkMode?: string;
    volumes?: Array<{ hostPath: string; containerPath: string; mode?: string }>;
    devices?: string[];
    capabilities?: string[];
  }): void {
    // 1. Privileged check
    if (spec.privileged === true) {
      throw new HermitError("SANDBOX_POLICY_VIOLATION", "privileged container execution is strictly forbidden");
    }

    // 2. Host network check
    if (spec.networkMode === "host") {
      throw new HermitError("SANDBOX_POLICY_VIOLATION", "host network mode is forbidden; use bridge or none");
    }

    // 3. Volume mounts check (no host root, no docker socket, no credentials)
    if (spec.volumes) {
      const forbiddenHostPaths = [
        "/",
        "/root",
        "/etc",
        "/proc",
        "/sys",
        "/var/run/docker.sock",
        "/run/docker.sock",
        "docker.sock",
        ".ssh",
        ".aws",
        ".config",
        ".opencodex",
      ];

      for (const vol of spec.volumes) {
        const hp = vol.hostPath.toLowerCase();
        for (const f of forbiddenHostPaths) {
          if (hp === f || hp.endsWith(`/${f}`) || hp.includes(f)) {
            throw new HermitError(
              "SANDBOX_POLICY_VIOLATION",
              `volume mount of '${vol.hostPath}' is strictly forbidden by sandbox policy`,
            );
          }
        }
      }
    }

    // 4. Arbitrary device mounts check
    if (spec.devices && spec.devices.length > 0) {
      throw new HermitError("SANDBOX_POLICY_VIOLATION", "arbitrary host device mounts are forbidden in sandbox");
    }
  }

  /**
   * Build the standard Docker CLI invocation flags adhering to least privilege.
   */
  buildDockerArgs(agentId: string, workspaceHostDir: string): string[] {
    return [
      "run",
      "--rm",
      `--name=pao_agent_${agentId}`,
      `--memory=${this.config.memoryLimitMb}m`,
      `--cpus=${this.config.cpuLimitCores}`,
      "--security-opt=no-new-privileges:true",
      "--cap-drop=ALL",
      "--network=none", // default no inbound/outbound network; enable selectively
      `--volume=${workspaceHostDir}/input:${CANONICAL_BOUNDARIES.input}:ro`,
      `--volume=${workspaceHostDir}/work:${CANONICAL_BOUNDARIES.work}:rw`,
      `--volume=${workspaceHostDir}/output:${CANONICAL_BOUNDARIES.output}:rw`,
      `--volume=${workspaceHostDir}/tmp:${CANONICAL_BOUNDARIES.tmp}:rw`,
      this.config.image,
    ];
  }

  /**
   * Validate an artifact exported from the container before allowing it into the host (spec §9).
   */
  validateExportedArtifact(artifact: {
    relativePath: string;
    content: Uint8Array | string;
    sha256?: string;
  }): { valid: boolean; contentHash: string; reason?: string } {
    const p = artifact.relativePath.replace(/\\/g, "/");

    // Path traversal check
    if (p.includes("..") || p.startsWith("/")) {
      throw new HermitError("SANDBOX_EXPORT_DENIED", "path traversal detected in exported artifact");
    }

    // Sensitive file pattern check
    const sensitive = /\.env|id_rsa|private_key|\.key|credential/i;
    if (sensitive.test(p)) {
      throw new HermitError("SANDBOX_EXPORT_DENIED", `export of sensitive file pattern '${p}' is forbidden`);
    }

    const contentStr = typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content);
    const hash = sha256Hex(contentStr);

    if (artifact.sha256 && artifact.sha256 !== hash) {
      throw new HermitError("SANDBOX_EXPORT_DENIED", "artifact hash mismatch (tampering detected)");
    }

    return { valid: true, contentHash: hash };
  }
}
