/**
 * Phase 20.64 — Visual Compute Plane (Vercel vgpu) Test Suite
 */

import { describe, expect, it } from "bun:test";
import { MockVisualRuntime } from "../src/agent-os/visual-compute/runtimes";
import { validateShaderSource, checkImports } from "../src/agent-os/visual-compute/wgsl";
import { handleVgpuToolCall } from "../src/agent-os/visual-compute/mcp-tools";

describe("Phase 20.64 — Visual Compute Plane (Vercel vgpu)", () => {
  it("probes GPU capability snapshot deterministically in mock runtime", async () => {
    const runtime = new MockVisualRuntime();
    const snapshot = await runtime.probe();

    expect(snapshot.available).toBe(true);
    expect(snapshot.adapterName).toBe("vc-deterministic-mock");
    expect(snapshot.features).toContain("render");
    expect(snapshot.features).toContain("compute");
  });

  it("validates WGSL shaders and blocks path traversal / network imports", () => {
    const safeShader = `
      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      }
    `;

    const validation = validateShaderSource(safeShader, 128 * 1024);
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics.length).toBe(0);

    // Forbidden parent directory import traversal
    const badImports = checkImports(`import "../secret.wgsl";`);
    expect(badImports[0].allowed).toBe(false);
    expect(badImports[0].reason).toContain("parent traversal");

    // Forbidden network URL import
    const networkImports = checkImports(`import "https://evil.test/shader.wgsl";`);
    expect(networkImports[0].allowed).toBe(false);
    expect(networkImports[0].reason).toContain("network imports are blocked");
  });

  it("executes visual compute kernel deterministically via MCP tools", async () => {
    const result = (await handleVgpuToolCall("pao.vgpu.execute_kernel", {
      kernel: "gradient",
      width: 16,
      height: 16,
    })) as { width: number; height: number; data: Uint8Array };

    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.data.length).toBe(16 * 16 * 4); // RGBA8
  });
});
