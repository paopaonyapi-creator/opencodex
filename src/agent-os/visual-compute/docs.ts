// Phase 20.64 — VGPU docs gateway (spec §27-§28).
//
// Local version-aligned docs are preferred; hosted access is optional and
// gated. Example downloads default to disabled and are sandbox-rooted with
// relative destinations only. Docs are DATA: any instruction-like text in
// upstream content never carries authority.

import { VisualComputeError, type DocsEntry } from "./types";
import type { VisualComputeConfig } from "./config";

/** Local, version-aligned docs corpus (pinned vgpu@0.4.1 surface). */
const LOCAL_DOCS: DocsEntry[] = [
  {
    path: "getting-started",
    title: "VGPU Getting Started",
    excerpt: "Typed WGSL imports with a small GPU-first API shared across browser, headless Node, and mock/test runtimes. Explicit render frames; no implicit frame loops.",
  },
  {
    path: "targets",
    title: "Render Targets & Readback",
    excerpt: "Create a target, render a frame, read pixels back as RGBA. Readback is bounded by the resource budget engine before dispatch.",
  },
  {
    path: "compute",
    title: "Compute Passes",
    excerpt: "Dispatch compute shaders with typed buffers; results are read back through the same bounded path. @workgroup_size is required on compute entry points.",
  },
  {
    path: "wgsl-imports",
    title: "Typed WGSL Imports",
    excerpt: "import syntax pulls shader modules at build time. Pao-hubPro allows only the approved module allowlist (@vgpu/wgsl-std, project-owned modules).",
  },
  {
    path: "mock-testing",
    title: "Mock Runtime & Testing",
    excerpt: "A deterministic mock adapter powers CI without a physical GPU; identical inputs produce byte-identical outputs.",
  },
  {
    path: "cli-check",
    title: "Shader Validation (vgpu check)",
    excerpt: "Shader validation runs through the controlled tooling wrapper — argument arrays, no shell interpolation, controlled temp directories, bounded output.",
  },
  {
    path: "limits",
    title: "Resource Limits",
    excerpt: "Pao-hubPro enforces application-level caps (shader size, texture dimensions, buffers, readback, execution time, concurrency, queue quota) before any GPU dispatch.",
  },
  {
    path: "mcp-docs",
    title: "Agent Documentation Access",
    excerpt: "Docs lookup is exposed as read-only MCP tools behind Pao-hubPro policy and audit; raw upstream MCP is never exposed directly.",
  },
];

/** Search the local corpus; hosted fallback only when explicitly enabled. */
export function searchDocs(config: VisualComputeConfig, query: string): DocsEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return LOCAL_DOCS.slice(0, 10);
  return LOCAL_DOCS.filter((entry) => (entry.title + " " + entry.excerpt + " " + entry.path).toLowerCase().includes(needle)).slice(0, 10);
}

export function readDoc(config: VisualComputeConfig, path: string): DocsEntry {
  const normalized = path.trim().replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new VisualComputeError("VISUAL_INVALID_INPUT", 400, "docs path traversal rejected");
  }
  const entry = LOCAL_DOCS.find((e) => e.path === normalized);
  if (!entry) {
    if (config.docsProvider === "hosted" && config.remoteDocsEnabled) {
      throw new VisualComputeError("VISUAL_NOT_FOUND", 404, "docs entry not found in the local corpus (hosted provider is not wired in this phase)");
    }
    throw new VisualComputeError("VISUAL_NOT_FOUND", 404, "docs entry not found: " + normalized);
  }
  return entry;
}

/**
 * Example download guard (spec §28): disabled by default; when enabled the
 * destination must be a relative child of the dedicated sandbox root.
 */
export function assertExampleDownloadAllowed(config: VisualComputeConfig, destination: string): string {
  if (!config.docsExampleDownload) {
    throw new VisualComputeError("VISUAL_POLICY_DENIED", 403, "example download is disabled by default");
  }
  const normalized = destination.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new VisualComputeError("VISUAL_INVALID_INPUT", 400, "example destination must be a relative path under the sandbox root");
  }
  return "visual-gpu/examples/" + normalized;
}

export function listDocs(): DocsEntry[] {
  return LOCAL_DOCS;
}
