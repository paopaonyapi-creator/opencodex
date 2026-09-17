/**
 * Phase 20.64 — Visual Compute Plane (Vercel vgpu) MCP Tools
 * Exposes WebGPU capability reflection, WGSL shader validation, and deterministic execution.
 */

import { MockVisualRuntime } from "./runtimes";
import { validateShaderSource } from "./wgsl";

export interface VgpuMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2";
  inputSchema: Record<string, unknown>;
}

export const VGPU_MCP_TOOLS: VgpuMcpToolDefinition[] = [
  {
    name: "pao.vgpu.capabilities",
    description: "Inspect active WebGPU / vgpu capability snapshot, supported limits, and runtime availability.",
    riskTier: "R0",
    inputSchema: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["mock", "browser", "node"] },
      },
    },
  },
  {
    name: "pao.vgpu.validate_shader",
    description: "Validate a WGSL shader structurally: checks entry points, bind groups, size caps, and import allowlist.",
    riskTier: "R0",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "WGSL source code" },
        maxBytes: { type: "number", description: "Optional size limit in bytes (default 128KB)" },
      },
      required: ["source"],
    },
  },
  {
    name: "pao.vgpu.execute_kernel",
    description: "Execute a visual compute kernel (e.g. solid, gradient, checkerboard, noise) deterministically.",
    riskTier: "R2",
    inputSchema: {
      type: "object",
      properties: {
        kernel: { type: "string", enum: ["solid", "gradient", "checkerboard", "noise"] },
        width: { type: "number", default: 64 },
        height: { type: "number", default: 64 },
        inputs: { type: "object" },
      },
      required: ["kernel"],
    },
  },
];

export async function handleVgpuToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const runtime = new MockVisualRuntime();

  if (toolName === "pao.vgpu.capabilities") {
    return runtime.probe();
  }

  if (toolName === "pao.vgpu.validate_shader") {
    const source = String(args.source || "");
    const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : 128 * 1024;
    return validateShaderSource(source, maxBytes);
  }

  if (toolName === "pao.vgpu.execute_kernel") {
    const kernel = String(args.kernel || "solid");
    const width = typeof args.width === "number" ? Math.min(Math.max(args.width, 1), 512) : 64;
    const height = typeof args.height === "number" ? Math.min(Math.max(args.height, 1), 512) : 64;
    const inputs = (args.inputs && typeof args.inputs === "object" ? args.inputs : {}) as Record<string, unknown>;

    return runtime.render({
      shaderSource: `@compute @workgroup_size(8, 8) fn ${kernel}() {}`,
      name: kernel,
      width,
      height,
      inputs,
    });
  }

  throw new Error(`Unknown vgpu tool '${toolName}'`);
}
