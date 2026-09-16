// Phase 20.64 — WGSL structural validation, reflection, and import policy
// (spec §15, §17).
//
// Deterministic and dependency-free: entry-point/bind-group/override parsing,
// size caps, hashing, and the import allowlist. Full compile-grade validation
// belongs to the pinned VGPU toolchain at execution time; this layer is the
// policy pre-gate that never trusts agent source.

import { createHash } from "node:crypto";
import { VisualComputeError, type ShaderDiagnostic, type ShaderReflection } from "./types";

const ALLOWED_IMPORT_PREFIXES = ["@vgpu/wgsl-std"];

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function assertSourceSize(source: string, maxBytes: number): void {
  if (Buffer.byteLength(source, "utf8") > maxBytes) {
    throw new VisualComputeError("VISUAL_SHADER_TOO_LARGE", 413, "shader source exceeds the configured size cap");
  }
}

/** Extract `import` specifiers from WGSL source (vgpu typed-import style). */
export function extractImports(source: string): string[] {
  const specifiers: string[] = [];
  const plain = /^\s*import\s+"([^"]+)"\s*;?\s*$/gm;
  for (const match of source.matchAll(plain)) {
    specifiers.push(match[1]);
  }
  const typed = /^\s*import\s+[\w*{},\s]+?\s+from\s+"([^"]+)"\s*;?\s*$/gm;
  for (const match of source.matchAll(typed)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Import policy (spec §17): allowlist only; traversal/URL/absolute blocked. */
export function checkImports(source: string): ShaderReflection["imports"] {
  return extractImports(source).map((specifier) => {
    if (specifier.includes("..")) {
      return { specifier, allowed: false, reason: "parent traversal in import specifier" };
    }
    if (/^https?:\/\//i.test(specifier) || /^[a-z]+:\/\//i.test(specifier)) {
      return { specifier, allowed: false, reason: "network imports are blocked" };
    }
    if (specifier.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(specifier)) {
      return { specifier, allowed: false, reason: "absolute filesystem paths are blocked" };
    }
    const allowed = ALLOWED_IMPORT_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(prefix + "/"));
    return { specifier, allowed, reason: allowed ? "approved module" : "unknown package: not on the approved import allowlist" };
  });
}

/**
 * Deterministic structural validation: required entry points, bind-group
 * shape, import policy, and basic syntax anchors. Diagnostics carry line
 * numbers where derivable.
 */
export function validateShaderSource(source: string, maxBytes: number): { valid: boolean; diagnostics: ShaderDiagnostic[]; reflection: ShaderReflection; sourceHash: string } {
  const diagnostics: ShaderDiagnostic[] = [];
  const sourceHash = sha256Hex(source);

  const entryPoints: string[] = [];
  const lineOf = (needle: string): number | undefined => {
    const idx = source.indexOf(needle);
    if (idx === -1) return undefined;
    return source.slice(0, idx).split("\n").length;
  };

  // Entry points: @vertex / @fragment / @compute annotations.
  const entryPattern = /@(vertex|fragment|compute)\s*(?:\(@[\w-]+\))?\s*(?:fn\s+([\w]+))?/g;
  for (const entryMatch of source.matchAll(entryPattern)) {
    entryPoints.push(entryMatch[2] ? entryMatch[1] + ":" + entryMatch[2] : entryMatch[1]);
  }
  if (entryPoints.length === 0) {
    diagnostics.push({ severity: "error", code: "VC_NO_ENTRY_POINT", message: "no @vertex, @fragment, or @compute entry point found" });
  }

  // Bind groups / bindings for reflection.
  const bindings: ShaderReflection["bindings"] = [];
  const bindPattern = /@group\((\d+)\)\s*@binding\((\d+)\)\s*(var<\w+>|var)\s*<\s*([\w,\s]+?)\s*>\s*([\w]+)/g;
  for (const bindMatch of source.matchAll(bindPattern)) {
    const storageClass = bindMatch[3];
    const inner = bindMatch[4].trim();
    const className = storageClass === "var"
      ? (inner.startsWith("uniform") ? "uniform" : inner.startsWith("storage") ? "storage" : inner)
      : inner;
    bindings.push({ group: Number(bindMatch[1]), binding: Number(bindMatch[2]), class: className, name: bindMatch[5] });
  }

  const workgroupDeclared = /@workgroup_size\s*\(/.test(source);
  if (entryPoints.some((e) => e.startsWith("compute")) && !workgroupDeclared) {
    diagnostics.push({ severity: "error", code: "VC_MISSING_WORKGROUP", message: "compute entry points require @workgroup_size", line: lineOf("@compute") });
  }

  // Unbalanced braces are a cheap structural failure signal.
  const opens = (source.match(/\{/g) ?? []).length;
  const closes = (source.match(/\}/g) ?? []).length;
  if (opens !== closes) {
    diagnostics.push({ severity: "error", code: "VC_UNBALANCED_BRACES", message: "unbalanced braces (" + opens + " open / " + closes + " close)" });
  }

  // Import policy.
  const imports = checkImports(source);
  for (const imp of imports) {
    if (!imp.allowed) {
      diagnostics.push({ severity: "error", code: "VC_IMPORT_BLOCKED", message: "import blocked: " + imp.reason, line: lineOf('"' + imp.specifier + '"') });
    }
  }

  if (source.trim().length === 0) {
    diagnostics.push({ severity: "error", code: "VC_EMPTY", message: "shader source is empty" });
  }

  const reflection: ShaderReflection = { entryPoints, bindings, workgroupDeclared, imports };
  const valid = !diagnostics.some((d) => d.severity === "error");
  return { valid, diagnostics, reflection, sourceHash };
}

/**
 * Deterministic job fingerprint (spec §59): shader hash + normalized inputs +
 * output spec + runtime contract version.
 */
export function jobFingerprint(input: { shaderHash: string; inputs: Record<string, unknown>; width: number; height: number; type: string }): string {
  const canonical = JSON.stringify(
    Object.entries(input.inputs ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return "vfp_" + createHash("sha256").update(input.shaderHash + "|" + canonical + "|" + input.width + "x" + input.height + "|" + input.type + "|vc-1").digest("hex").slice(0, 24);
}
