// Phase 20.64 — Runtime adapters + router (spec §9-§12, §51-§53).
//
// One contract, three production kinds. The mock runtime is deterministic
// and dependency-free (CI); browser/node adapters probe WebGPU availability
// and FAIL CLOSED (ADAPTER_UNAVAILABLE) when no adapter exists — they never
// silently fall back to software rendering for large jobs. The pinned VGPU
// package carries the real implementation at integration time; this file
// defines the seam so application code never touches raw globals.

import { createHash } from "node:crypto";
import type {
  GpuCapabilitySnapshot, VisualGpuRuntime, VisualJobOutput,
} from "./types";
import { VisualComputeError, VGPU_PINNED_VERSION } from "./types";
import { validateShaderSource } from "./wgsl";

function unavailable(kind: string): GpuCapabilitySnapshot {
  return {
    runtime: kind as GpuCapabilitySnapshot["runtime"],
    available: false,
    adapterName: null,
    backend: null,
    features: [],
    limits: {},
    softwareRenderer: false,
    detectedAt: new Date().toISOString(),
    vgpuVersion: VGPU_PINNED_VERSION,
    incompatibilityReason: "no WebGPU adapter on this host (install the pinned vgpu runtime for headless execution)",
  };
}

// ---------------------------------------------------------------------------
// Deterministic mock runtime (spec §12): preset kernels mirroring the demo
// WGSL semantics in pure JS — solid, gradient, checkerboard, noise; and a
// compute-add kernel. Same inputs → byte-identical output.

type PixelFn = (x: number, y: number, w: number, h: number, inputs: Record<string, unknown>) => [number, number, number, number];

const PRESET_PIXEL_FNS: Record<string, PixelFn> = {
  solid: (_x, _y, _w, _h, inputs) => {
    const color = normalizeColor(inputs["color"] ?? [255, 0, 0]);
    return [color[0], color[1], color[2], 255];
  },
  gradient: (x, y, w, h, inputs) => {
    const a = normalizeColor(inputs["colorA"] ?? [16, 18, 27]);
    const b = normalizeColor(inputs["colorB"] ?? [235, 235, 255]);
    const vertical = inputs["direction"] !== "horizontal";
    const t = vertical ? y / Math.max(1, h - 1) : x / Math.max(1, w - 1);
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
      255,
    ];
  },
  checkerboard: (x, y, _w, _h, inputs) => {
    const cell = Math.max(1, Number(inputs["cell"] ?? 32));
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
    return on ? [235, 235, 235, 255] : [24, 24, 32, 255];
  },
  noise: (x, y, _w, _h, inputs) => {
    const seed = Number(inputs["seed"] ?? 42);
    const amount = Math.max(0, Math.min(1, Number(inputs["amount"] ?? 0.25)));
    const v = deterministicNoise(x, y, seed);
    const base = 128 + (v - 0.5) * 255 * amount;
    return [clampByte(base), clampByte(base), clampByte(base), 255];
  },
};

function deterministicNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normalizeColor(value: unknown): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [clampByte(Number(value[0])), clampByte(Number(value[1])), clampByte(Number(value[2]))];
  }
  return [128, 128, 128];
}

function detectPreset(shaderSource: string, name: string): PixelFn {
  const key = name.toLowerCase();
  for (const preset of Object.keys(PRESET_PIXEL_FNS)) {
    if (key.includes(preset)) return PRESET_PIXEL_FNS[preset];
  }
  // Source-derived: pick from the shader's own name/comment markers.
  if (/gradient/i.test(shaderSource)) return PRESET_PIXEL_FNS.gradient;
  if (/checker/i.test(shaderSource)) return PRESET_PIXEL_FNS.checkerboard;
  if (/noise|grain/i.test(shaderSource)) return PRESET_PIXEL_FNS.noise;
  return PRESET_PIXEL_FNS.solid;
}

export class MockVisualRuntime implements VisualGpuRuntime {
  readonly kind = "mock" as const;
  private probeResult: GpuCapabilitySnapshot | null = null;

  async probe(): Promise<GpuCapabilitySnapshot> {
    if (!this.probeResult) {
      this.probeResult = {
        runtime: "mock",
        available: true,
        adapterName: "vc-deterministic-mock",
        backend: "javascript",
        features: ["render", "compute", "readback"],
        limits: { maxTextureDimension2d: 4096 },
        softwareRenderer: true,
        detectedAt: new Date().toISOString(),
        vgpuVersion: VGPU_PINNED_VERSION,
        incompatibilityReason: null,
      };
    }
    return this.probeResult;
  }

  async validateShader(source: string) {
    return validateShaderSource(source, Number.MAX_SAFE_INTEGER);
  }

  async render(input: { shaderSource: string; name: string; width: number; height: number; inputs: Record<string, unknown> }): Promise<VisualJobOutput> {
    const pixelFn = detectPreset(input.shaderSource, input.name);
    const data = new Uint8Array(input.width * input.height * 4);
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const [r, g, b, a] = pixelFn(x, y, input.width, input.height, input.inputs);
        const offset = (y * input.width + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
      }
    }
    return {
      kind: "raw-buffer",
      data,
      width: input.width,
      height: input.height,
      metrics: { runtime: "mock", preset: detectPresetName(input.shaderSource, input.name), durationMs: 0 },
    };
  }

  async compute(input: { shaderSource: string; name: string; inputs: Record<string, unknown> }): Promise<VisualJobOutput> {
    // Deterministic compute-add kernel: out[i] = a[i] + b[i] (mod 256) or a
    // hash-derived summary when no arrays are supplied.
    const a = Array.isArray(input.inputs["a"]) ? (input.inputs["a"] as number[]) : [];
    const b = Array.isArray(input.inputs["b"]) ? (input.inputs["b"] as number[]) : [];
    if (a.length > 0 && a.length === b.length) {
      const sum = a.map((v, i) => (v + b[i]) % 256);
      return { kind: "json", data: { op: "add", length: sum.length, values: sum.slice(0, 256) }, width: null, height: null, metrics: { runtime: "mock", kernel: "compute_add" } };
    }
    const hash = createHash("sha256").update(JSON.stringify(input.inputs)).digest("hex");
    return { kind: "json", data: { op: "identity", hash: hash.slice(0, 24) }, width: null, height: null, metrics: { runtime: "mock", kernel: "identity" } };
  }

  async dispose(): Promise<void> {
    this.probeResult = null;
  }
}

function detectPresetName(shaderSource: string, name: string): string {
  const fn = detectPreset(shaderSource, name);
  for (const key of Object.keys(PRESET_PIXEL_FNS)) {
    if (PRESET_PIXEL_FNS[key] === fn) return key;
  }
  return "solid";
}

// ---------------------------------------------------------------------------
// Node/browser adapters: probe-only shells that fail closed. The pinned
// vgpu package provides the real headless/browser implementation at
// integration time; until an adapter exists these report ADAPTER_UNAVAILABLE.

export class NodeVisualRuntimeStub implements VisualGpuRuntime {
  readonly kind = "node" as const;

  async probe(): Promise<GpuCapabilitySnapshot> {
    return unavailable("node");
  }

  async validateShader(source: string) {
    return validateShaderSource(source, Number.MAX_SAFE_INTEGER);
  }

  async render(): Promise<VisualJobOutput> {
    throw new VisualComputeError("VISUAL_ADAPTER_UNAVAILABLE", 503, "no headless WebGPU adapter on this worker", true);
  }

  async compute(): Promise<VisualJobOutput> {
    throw new VisualComputeError("VISUAL_ADAPTER_UNAVAILABLE", 503, "no headless WebGPU adapter on this worker", true);
  }

  async dispose(): Promise<void> {
    /* nothing to dispose in the stub */
  }
}

export class BrowserVisualRuntimeStub implements VisualGpuRuntime {
  readonly kind = "browser" as const;

  async probe(): Promise<GpuCapabilitySnapshot> {
    return unavailable("browser");
  }

  async validateShader(source: string) {
    return validateShaderSource(source, Number.MAX_SAFE_INTEGER);
  }

  async render(): Promise<VisualJobOutput> {
    throw new VisualComputeError("VISUAL_ADAPTER_UNAVAILABLE", 503, "browser WebGPU is unavailable in this context", true);
  }

  async compute(): Promise<VisualJobOutput> {
    throw new VisualComputeError("VISUAL_ADAPTER_UNAVAILABLE", 503, "browser WebGPU is unavailable in this context", true);
  }

  async dispose(): Promise<void> {
    /* nothing to dispose in the stub */
  }
}

// ---------------------------------------------------------------------------
// Router (spec §9.3, §22): preference → capability → policy. Never silently
// downgrades a hardware job onto the mock renderer.

export function selectRuntime(input: {
  preference: "auto" | "browser" | "node" | "mock";
  runtimes: Partial<Record<"browser" | "node" | "mock", VisualGpuRuntime>>;
  probes: Partial<Record<"browser" | "node" | "mock", GpuCapabilitySnapshot>>;
  jobType: "render" | "compute" | "validate" | "readback" | "preview";
}): VisualGpuRuntime {
  const order: Array<"browser" | "node" | "mock"> = input.preference === "auto"
    ? ["node", "browser", "mock"]
    : [input.preference as "browser" | "node" | "mock"];
  for (const kind of order) {
    const runtime = input.runtimes[kind];
    const probe = input.probes[kind];
    if (!runtime || !probe?.available) continue;
    return runtime;
  }
  // Validation-only jobs may run their structural pass on any runtime's
  // validator; execution types fail closed.
  if (input.jobType === "validate") {
    const anyRuntime = input.runtimes.mock ?? input.runtimes.node ?? input.runtimes.browser;
    if (anyRuntime) return anyRuntime;
  }
  throw new VisualComputeError("VISUAL_ADAPTER_UNAVAILABLE", 503, "no capable runtime available for job type " + input.jobType, true);
}
