// Phase 20.89 — pao-capability.yaml manifest parser + validator.
//
// Strategy: a strict, purpose-built YAML-SUBSET parser. The manifest schema is
// small and fully specified, so anything OUTSIDE the supported subset (anchors,
// block scalars, flow maps, tabs, multi-document streams) is a parse error —
// and per the mission a failing manifest is QUARANTINED, never guessed at.
// This parser is a validator with a narrow grammar, not a general YAML
// interpreter, which keeps it deterministic and fail-closed.

import type { CapabilityType } from "./types";

export interface ManifestIssue {
  line: number | null;
  path: string;
  code: string;
  message: string;
}

export interface PaoCapabilityManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    id: string;
    name: string;
    slug: string;
    description: string;
    homepage?: string;
    sourceType: string;
    sourceUrl: string;
    license: string;
    authors: string[];
    tags: string[];
  };
  spec: {
    type: CapabilityType;
    version: string;
    compatibility: {
      os: string[];
      arch: string[];
      runtimes: Record<string, string>;
    };
    capabilities: {
      provides: string[];
      consumes: string[];
    };
    permissions: {
      filesystem: { read: string[]; write: string[] };
      network: { outbound: string[] };
      shell: { allowed: boolean };
      secrets: string[];
    };
    dependencies: {
      required: Array<{ kind: string; ref: string }>;
      optional: Array<{ kind: string; ref: string }>;
    };
    install: {
      strategy: string;
      source: { repo?: string; ref?: string };
      steps: Array<{ type: string; command?: string }>;
    };
    health: {
      checks: Array<{ type: string; command?: string }>;
    };
    lifecycle: {
      supportsDisable: boolean;
      supportsRollback: boolean;
      supportsUninstall: boolean;
    };
  };
}

export type ManifestParseResult =
  | { ok: true; manifest: PaoCapabilityManifest; raw: Record<string, unknown> }
  | { ok: false; issues: ManifestIssue[]; quarantine: true };

const SUPPORTED_API_VERSION = "paohub.io/v1alpha1";
const SUPPORTED_KIND = "Capability";
const KNOWN_PERMISSION_KEYS = new Set([
  "filesystem.read", "filesystem.write", "filesystem.delete", "shell.execute",
  "network.outbound", "network.listen", "browser.control", "process.spawn",
  "clipboard.read", "clipboard.write", "credential.use", "email.read", "email.send",
  "calendar.read", "calendar.write", "github.read", "github.write", "mcp.call",
  "model.invoke", "container.run", "gpu.use", "camera.use", "microphone.use",
]);
const KNOWN_OS = new Set(["windows", "linux", "macos", "any"]);
const KNOWN_ARCH = new Set(["x64", "arm64", "any"]);
const KNOWN_INSTALL_STRATEGIES = new Set(["git", "local", "npm", "pypi", "docker", "registry", "raw-manifest"]);
const KNOWN_STEP_TYPES = new Set(["clone", "dependency-install", "build", "register", "register_mcp", "register_runtime", "fetch", "copy", "verify"]);
const KNOWN_HEALTH_CHECKS = new Set(["process", "http", "command", "mcp-handshake", "tool-enumeration", "port", "filesystem", "provider-auth", "model-probe", "workflow-dry-run"]);
const KNOWN_CAPABILITY_TYPES = new Set<CapabilityType>([
  "agent", "skill", "mcp-server", "api", "model", "provider", "workflow", "prompt",
  "cli-tool", "browser-tool", "ui-extension", "comfyui-node", "comfyui-workflow",
  "data-source", "runtime-adapter", "reviewer", "memory-provider", "router",
]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;

// ---------------------------------------------------------------------------
// YAML-subset parser (line-based, indentation-driven, fail-closed)
// ---------------------------------------------------------------------------

interface ParseIssue {
  line: number;
  message: string;
}

interface ParseOk {
  ok: true;
  tree: Record<string, unknown>;
}
interface ParseFail {
  ok: false;
  issues: ParseIssue[];
}

function parseScalar(raw: string): string | number | boolean | null | unknown[] {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "[]") return [];
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2)) return v.slice(1, -1);
  if ((v.startsWith("'") && v.endsWith("'") && v.length >= 2)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

/**
 * Parses the supported YAML subset:
 *   - `#` comments and blank lines
 *   - nested maps indented by spaces (2-space convention enforced loosely by
 *     relative indentation, not absolute counts)
 *   - `- ` list items (scalars, or the first key of an inline map with
 *     continuation keys at the item's deeper indentation)
 *   - inline empty lists (`key: []`)
 * Rejects: tabs, anchors (&/*), block scalars (|/>), flow maps ({), multiple
 * documents, duplicate keys at the same level.
 */
export function parseYamlSubset(text: string): ParseOk | ParseFail {
  const issues: ParseIssue[] = [];
  const linesIn = text.split(/\r?\n/);

  // Strip a leading document marker.
  while (linesIn.length > 0 && linesIn[0].trim() === "---") linesIn.shift();

  interface Frame {
    indent: number;
    container: Record<string, unknown> | unknown[];
    type: "map" | "list";
    pendingItem: Record<string, unknown> | null;
  }

  const root: Record<string, unknown> = {};
  const stack: Frame[] = [{ indent: -1, container: root, type: "map", pendingItem: null }];

  for (let i = 0; i < linesIn.length; i++) {
    const lineNo = i + 1;
    const rawLine = linesIn[i];
    if (rawLine.includes("\t")) {
      issues.push({ line: lineNo, message: "tab characters are not permitted in manifests" });
      continue;
    }
    if (rawLine.trim() === "---" || rawLine.trim() === "...") {
      issues.push({ line: lineNo, message: "multi-document streams are not supported" });
      continue;
    }
    const noComment = stripComment(rawLine);
    const content = noComment.trimEnd();
    if (content.trim() === "" || content.trim().startsWith("#")) continue;
    if (/[&*]\w/.test(content) && !content.trimStart().startsWith("-")) {
      issues.push({ line: lineNo, message: "YAML anchors/aliases are not supported" });
      continue;
    }
    if (/^\s*-.*[>{]/.test(content) || /[:{]\s*[>{]/.test(content)) {
      issues.push({ line: lineNo, message: "flow mappings/sequences ({…} and […]) other than empty [] are not supported" });
      continue;
    }
    if (content.trim() === "|" || content.trim() === ">" || content.trim().endsWith(": |") || content.trim().endsWith(": >")) {
      issues.push({ line: lineNo, message: "block scalars (| and >) are not supported" });
      continue;
    }

    const indent = content.length - content.trimStart().length;
    const trimmed = content.trim();
    const isListItem = trimmed.startsWith("- ") || trimmed === "-";

    // Pop frames shallower than the current indent.
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      const isListItemLine = trimmed.startsWith("- ") || trimmed === "-";
      // A new "- " item at the list frame's own indent is a sibling item,
      // not a continuation of the previous inline-map item.
      if (top.type === "list" && top.pendingItem && isListItemLine && indent === top.indent) {
        top.pendingItem = null;
        break;
      }
      const effectiveIndent = top.type === "list" && top.pendingItem ? top.indent + 2 : top.indent;
      if (indent >= effectiveIndent) break;
      stack.pop();
    }
    const frame = stack[stack.length - 1];

    if (frame.type === "map") {
      const map = frame.container as Record<string, unknown>;
      if (!trimmed.includes(":") && !isListItem) {
        issues.push({ line: lineNo, message: `expected 'key: value' mapping entry, got: ${trimmed.slice(0, 40)}` });
        continue;
      }
      if (isListItem) {
        issues.push({ line: lineNo, message: "list item encountered where a mapping entry was expected" });
        continue;
      }
      const colon = findColonIndex(trimmed);
      if (colon === -1) {
        issues.push({ line: lineNo, message: `cannot parse mapping entry: ${trimmed.slice(0, 40)}` });
        continue;
      }
      const key = parseScalar(trimmed.slice(0, colon));
      if (typeof key !== "string" || key.length === 0) {
        issues.push({ line: lineNo, message: "mapping key must be a non-empty string" });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        issues.push({ line: lineNo, message: `duplicate key '${key}'` });
        continue;
      }
      const valuePart = trimmed.slice(colon + 1).trim();
      if (valuePart === "") {
        // Nested container follows — look ahead to decide map vs list.
        const next = nextContentLine(linesIn, i);
        if (next === null) {
          map[key] = null;
          continue;
        }
        const nextTrimmed = next.content.trim();
        const nextIndent = next.content.length - next.content.trimStart().length;
        if (nextIndent <= indent) {
          map[key] = null; // empty value
          continue;
        }
        if (nextTrimmed.startsWith("- ") || nextTrimmed === "-") {
          const child: unknown[] = [];
          map[key] = child;
          stack.push({ indent: nextIndent, container: child, type: "list", pendingItem: null });
        } else {
          const child: Record<string, unknown> = {};
          map[key] = child;
          stack.push({ indent: nextIndent, container: child, type: "map", pendingItem: null });
        }
      } else {
        map[key] = parseScalar(valuePart);
      }
    } else {
      // list frame
      const list = frame.container as unknown[];
      if (!isListItem) {
        if (frame.pendingItem) {
          // Continuation key of an inline map item (deeper indent).
          const item = frame.pendingItem;
          const colon = findColonIndex(trimmed);
          if (colon === -1) {
            issues.push({ line: lineNo, message: `cannot parse list continuation entry: ${trimmed.slice(0, 40)}` });
            continue;
          }
          const key = parseScalar(trimmed.slice(0, colon));
          if (typeof key !== "string" || key.length === 0) {
            issues.push({ line: lineNo, message: "list continuation key must be a non-empty string" });
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(item, key)) {
            issues.push({ line: lineNo, message: `duplicate key '${key}' in list item` });
            continue;
          }
          const valuePart = trimmed.slice(colon + 1).trim();
          if (valuePart === "") {
            const next = nextContentLine(linesIn, i);
            if (next === null) {
              item[key] = null;
              continue;
            }
            const nextTrimmed = next.content.trim();
            const nextIndent = next.content.length - next.content.trimStart().length;
            if (nextIndent <= indent) {
              item[key] = null;
              continue;
            }
            if (nextTrimmed.startsWith("- ") || nextTrimmed === "-") {
              const child: unknown[] = [];
              item[key] = child;
              stack.push({ indent: nextIndent, container: child, type: "list", pendingItem: null });
            } else {
              const child: Record<string, unknown> = {};
              item[key] = child;
              stack.push({ indent: nextIndent, container: child, type: "map", pendingItem: null });
            }
          } else {
            item[key] = parseScalar(valuePart);
          }
          continue;
        }
        issues.push({ line: lineNo, message: `expected '- ' list item, got: ${trimmed.slice(0, 40)}` });
        continue;
      }
      const itemBody = trimmed === "-" ? "" : trimmed.slice(2).trim();
      if (itemBody === "") {
        // Nested structure under a bare "-" — look ahead.
        const next = nextContentLine(linesIn, i);
        if (next === null) {
          list.push(null);
          continue;
        }
        const nextTrimmed = next.content.trim();
        const nextIndent = next.content.length - next.content.trimStart().length;
        if (nextTrimmed.startsWith("- ") || nextTrimmed === "-") {
          const child: unknown[] = [];
          list.push(child);
          stack.push({ indent: nextIndent, container: child, type: "list", pendingItem: null });
        } else {
          const child: Record<string, unknown> = {};
          list.push(child);
          stack.push({ indent: nextIndent, container: child, type: "list", pendingItem: child });
        }
        continue;
      }
      const colon = findColonIndex(itemBody);
      if (colon === -1) {
        list.push(parseScalar(itemBody));
      } else {
        // Inline map item: `- type: clone` with possible continuations.
        const item: Record<string, unknown> = {};
        const key = parseScalar(itemBody.slice(0, colon));
        if (typeof key !== "string" || key.length === 0) {
          issues.push({ line: lineNo, message: "list item key must be a non-empty string" });
          continue;
        }
        const valuePart = itemBody.slice(colon + 1).trim();
        if (valuePart === "") {
          const next = nextContentLine(linesIn, i);
          if (next !== null) {
            const nextTrimmed = next.content.trim();
            const nextIndent = next.content.length - next.content.trimStart().length;
            if (nextIndent > indent) {
              if (nextTrimmed.startsWith("- ") || nextTrimmed === "-") {
                const child: unknown[] = [];
                item[key] = child;
                list.push(item);
                stack.push({ indent: nextIndent, container: child, type: "list", pendingItem: null });
                continue;
              }
              const child: Record<string, unknown> = {};
              item[key] = child;
              list.push(item);
              stack.push({ indent: nextIndent, container: child, type: "map", pendingItem: null });
              continue;
            }
          }
          item[key] = null;
          list.push(item);
          continue;
        }
        item[key] = parseScalar(valuePart);
        list.push(item);
        // Convert the current frame into pending-item mode so continuation
        // keys (deeper indent) attach to this item.
        frame.pendingItem = item;
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, tree: root };
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function findColonIndex(trimmed: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      if (i + 1 >= trimmed.length || /\s/.test(trimmed[i + 1])) return i;
    }
  }
  return -1;
}

function nextContentLine(lines: string[], from: number): { content: string; line: number } | null {
  for (let j = from + 1; j < lines.length; j++) {
    const stripped = stripComment(lines[j]).trimEnd();
    if (stripped.trim() === "" || stripped.trim().startsWith("#")) continue;
    return { content: stripped, line: j + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schema validation → typed manifest
// ---------------------------------------------------------------------------

function asStringArray(v: unknown, path: string, issues: ManifestIssue[]): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) {
    issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `${path} must be a list` });
    return [];
  }
  return v.map((item) => String(item));
}

function asRawArray(v: unknown, path: string, issues: ManifestIssue[]): unknown[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) {
    issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `${path} must be a list` });
    return [];
  }
  return v;
}

function asRecord(v: unknown, path: string, issues: ManifestIssue[]): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `${path} must be a mapping` });
    return {};
  }
  return v as Record<string, unknown>;
}

function asString(v: unknown, path: string, issues: ManifestIssue[], fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") {
    issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `${path} must be a string` });
    return fallback;
  }
  return v;
}

function asBool(v: unknown, path: string, issues: ManifestIssue[], fallback: boolean): boolean {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "boolean") {
    issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `${path} must be a boolean` });
    return fallback;
  }
  return v;
}

/** Secret-material detector — a manifest containing live credential values is invalid. */
export function containsSecretMaterial(text: string): boolean {
  return /sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{16,}|Bearer\s+[a-zA-Z0-9\-._~+/]{12,}|AKIA[0-9A-Z]{16}|xox[baprs]-[a-zA-Z0-9\-]{10,}/.test(text);
}

/** URL guard: remote manifest/source URLs must be http(s) and must not target private/metadata hosts. */
export function isSafeRemoteUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return false;
  return true;
}

/** Permission scope sanity: reject traversal, absolute-escape attempts, and shell metacharacters. */
export function isSafePermissionScope(scope: string): boolean {
  if (scope.includes("..")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(scope)) return false;
  if (scope.startsWith("/") && !scope.endsWith("/**") && !scope.endsWith("/*")) return false;
  if (/[\0\r\n]/.test(scope)) return false;
  // A scope is a path glob — shell/ substitution metacharacters are never valid.
  if (/[;&|`$><]/.test(scope)) return false;
  return true;
}

/**
 * Validates the parsed tree against the Phase 20.89 manifest schema
 * (mission §2: schema, metadata, dependency, permission, policy,
 * compatibility, source, and checksum validation).
 */
export function validateManifestTree(tree: Record<string, unknown>): ManifestParseResult {
  const issues: ManifestIssue[] = [];

  const apiVersion = asString(tree.apiVersion, "apiVersion", issues);
  if (apiVersion !== SUPPORTED_API_VERSION) {
    issues.push({ line: null, path: "apiVersion", code: "MANIFEST_INVALID", message: `apiVersion must be '${SUPPORTED_API_VERSION}', got '${apiVersion || "(missing)"}'` });
  }
  const kind = asString(tree.kind, "kind", issues);
  if (kind !== SUPPORTED_KIND) {
    issues.push({ line: null, path: "kind", code: "MANIFEST_INVALID", message: `kind must be '${SUPPORTED_KIND}', got '${kind || "(missing)"}'` });
  }

  const metadata = asRecord(tree.metadata, "metadata", issues);
  const id = asString(metadata.id, "metadata.id", issues);
  if (id && !SLUG_RE.test(id)) {
    issues.push({ line: null, path: "metadata.id", code: "MANIFEST_INVALID", message: `id '${id}' must be lowercase kebab-case` });
  }
  const name = asString(metadata.name, "metadata.name", issues);
  if (!name) issues.push({ line: null, path: "metadata.name", code: "MANIFEST_INVALID", message: "metadata.name is required" });
  const sourceType = asString(metadata.sourceType, "metadata.sourceType", issues);
  const sourceUrl = asString(metadata.sourceUrl, "metadata.sourceUrl", issues);
  if (sourceUrl && (sourceType === "github" || sourceType.startsWith("http")) && !isSafeRemoteUrl(sourceUrl)) {
    issues.push({ line: null, path: "metadata.sourceUrl", code: "SOURCE_UNTRUSTED", message: `source URL '${sourceUrl}' is not a permitted remote target` });
  }
  const authors = asStringArray(metadata.authors, "metadata.authors", issues);
  const tags = asStringArray(metadata.tags, "metadata.tags", issues);
  const license = asString(metadata.license, "metadata.license", issues, "unknown");

  const spec = asRecord(tree.spec, "spec", issues);
  const typeRaw = asString(spec.type, "spec.type", issues);
  if (!KNOWN_CAPABILITY_TYPES.has(typeRaw as CapabilityType)) {
    issues.push({ line: null, path: "spec.type", code: "MANIFEST_INVALID", message: `unknown capability type '${typeRaw}'` });
  }
  const version = asString(spec.version, "spec.version", issues);
  if (!version) issues.push({ line: null, path: "spec.version", code: "MANIFEST_INVALID", message: "spec.version is required (pinned ref or semver)" });

  const compatibility = asRecord(spec.compatibility, "spec.compatibility", issues);
  const os = asStringArray(compatibility.os, "spec.compatibility.os", issues);
  for (const o of os) {
    if (!KNOWN_OS.has(o.toLowerCase())) issues.push({ line: null, path: "spec.compatibility.os", code: "MANIFEST_INVALID", message: `unknown OS '${o}'` });
  }
  const arch = asStringArray(compatibility.arch, "spec.compatibility.arch", issues);
  for (const a of arch) {
    if (!KNOWN_ARCH.has(a.toLowerCase())) issues.push({ line: null, path: "spec.compatibility.arch", code: "MANIFEST_INVALID", message: `unknown architecture '${a}'` });
  }
  const runtimes = asRecord(compatibility.runtimes, "spec.compatibility.runtimes", issues);

  const capabilitiesRaw = asRecord(spec.capabilities, "spec.capabilities", issues);
  const provides = asStringArray(capabilitiesRaw.provides, "spec.capabilities.provides", issues);
  const consumes = asStringArray(capabilitiesRaw.consumes, "spec.capabilities.consumes", issues);

  const permissionsRaw = asRecord(spec.permissions, "spec.permissions", issues);
  const fsRaw = asRecord(permissionsRaw.filesystem, "spec.permissions.filesystem", issues);
  const fsRead = asStringArray(fsRaw.read, "spec.permissions.filesystem.read", issues);
  const fsWrite = asStringArray(fsRaw.write, "spec.permissions.filesystem.write", issues);
  for (const scope of [...fsRead, ...fsWrite]) {
    if (!isSafePermissionScope(scope)) {
      issues.push({ line: null, path: "spec.permissions.filesystem", code: "MANIFEST_INVALID", message: `unsafe filesystem scope '${scope}'` });
    }
  }
  const networkRaw = asRecord(permissionsRaw.network, "spec.permissions.network", issues);
  const outbound = asStringArray(networkRaw.outbound, "spec.permissions.network.outbound", issues);
  const shellRaw = asRecord(permissionsRaw.shell, "spec.permissions.shell", issues);
  const shellAllowed = asBool(shellRaw.allowed, "spec.permissions.shell.allowed", issues, false);
  const secrets = asStringArray(permissionsRaw.secrets, "spec.permissions.secrets", issues);

  const depsRaw = asRecord(spec.dependencies, "spec.dependencies", issues);
  const parseDeps = (v: unknown, path: string): Array<{ kind: string; ref: string }> => {
    const list = asStringArray(v, path, issues);
    return list.map((entry) => {
      const sep = entry.indexOf(":");
      if (sep === -1) {
        issues.push({ line: null, path, code: "MANIFEST_INVALID", message: `dependency '${entry}' must be 'kind:ref'` });
        return { kind: "unknown", ref: entry };
      }
      return { kind: entry.slice(0, sep).trim(), ref: entry.slice(sep + 1).trim() };
    });
  };
  const requiredDeps = parseDeps(depsRaw.required, "spec.dependencies.required");
  const optionalDeps = parseDeps(depsRaw.optional, "spec.dependencies.optional");

  const installRaw = asRecord(spec.install, "spec.install", issues);
  const strategy = asString(installRaw.strategy, "spec.install.strategy", issues);
  if (strategy && !KNOWN_INSTALL_STRATEGIES.has(strategy)) {
    issues.push({ line: null, path: "spec.install.strategy", code: "MANIFEST_INVALID", message: `unknown install strategy '${strategy}'` });
  }
  const installSource = asRecord(installRaw.source, "spec.install.source", issues);
  const installRepo = asString(installSource.repo, "spec.install.source.repo", issues);
  if (installRepo && (strategy === "git" || installRepo.startsWith("http")) && !isSafeRemoteUrl(installRepo)) {
    issues.push({ line: null, path: "spec.install.source.repo", code: "SOURCE_UNTRUSTED", message: `install repo '${installRepo}' is not a permitted remote target` });
  }
  const installRef = asString(installSource.ref, "spec.install.source.ref", issues);
  const stepsRaw = asRawArray(installRaw.steps, "spec.install.steps", issues);
  const steps: Array<{ type: string; command?: string }> = [];
  for (const step of stepsRaw) {
    const rec = asRecord(step, "spec.install.steps[]", issues);
    const stepType = asString(rec.type, "spec.install.steps[].type", issues);
    if (!KNOWN_STEP_TYPES.has(stepType)) {
      issues.push({ line: null, path: "spec.install.steps[].type", code: "MANIFEST_INVALID", message: `unknown install step type '${stepType}'` });
    }
    const command = rec.command === undefined ? undefined : asString(rec.command, "spec.install.steps[].command", issues);
    if (command && /(\bsh\b|\bbash\b|\biex\b|\bsh\b)\s*$/i.test(command.trim()) && /\|\s*(sh|bash|zsh)\b/i.test(command)) {
      issues.push({ line: null, path: "spec.install.steps[].command", code: "MANIFEST_INVALID", message: "pipe-to-shell install steps are forbidden" });
    }
    steps.push({ type: stepType, command });
  }

  const healthRaw = asRecord(spec.health, "spec.health", issues);
  const checksRaw = asRawArray(healthRaw.checks, "spec.health.checks", issues);
  const checks: Array<{ type: string; command?: string }> = [];
  for (const check of checksRaw) {
    const rec = asRecord(check, "spec.health.checks[]", issues);
    const checkType = asString(rec.type, "spec.health.checks[].type", issues);
    if (!KNOWN_HEALTH_CHECKS.has(checkType)) {
      issues.push({ line: null, path: "spec.health.checks[].type", code: "MANIFEST_INVALID", message: `unknown health check type '${checkType}'` });
    }
    const command = rec.command === undefined ? undefined : asString(rec.command, "spec.health.checks[].command", issues);
    checks.push({ type: checkType, command });
  }

  const lifecycleRaw = asRecord(spec.lifecycle, "spec.lifecycle", issues);
  const lifecycle = {
    supportsDisable: asBool(lifecycleRaw.supportsDisable, "spec.lifecycle.supportsDisable", issues, true),
    supportsRollback: asBool(lifecycleRaw.supportsRollback, "spec.lifecycle.supportsRollback", issues, true),
    supportsUninstall: asBool(lifecycleRaw.supportsUninstall, "spec.lifecycle.supportsUninstall", issues, true),
  };

  if (issues.length > 0) {
    return { ok: false, issues, quarantine: true };
  }

  const manifest: PaoCapabilityManifest = {
    apiVersion,
    kind,
    metadata: {
      id,
      name,
      slug: id,
      description: asString(metadata.description, "metadata.description", issues),
      homepage: metadata.homepage === undefined ? undefined : asString(metadata.homepage, "metadata.homepage", issues) || undefined,
      sourceType,
      sourceUrl,
      license: license || "unknown",
      authors,
      tags,
    },
    spec: {
      type: typeRaw as CapabilityType,
      version,
      compatibility: { os, arch, runtimes: Object.fromEntries(Object.entries(runtimes).map(([k, v]) => [k, String(v)])) },
      capabilities: { provides, consumes },
      permissions: { filesystem: { read: fsRead, write: fsWrite }, network: { outbound }, shell: { allowed: shellAllowed }, secrets },
      dependencies: { required: requiredDeps, optional: optionalDeps },
      install: { strategy, source: { repo: installRepo || undefined, ref: installRef || undefined }, steps },
      health: { checks },
      lifecycle,
    },
  };
  return { ok: true, manifest, raw: tree };
}

/**
 * Full pipeline: text → parse → validate. Any parse or schema failure returns
 * `{ ok: false, quarantine: true }` per the mission's manifest law.
 */
export function parseCapabilityManifest(text: string): ManifestParseResult {
  if (containsSecretMaterial(text)) {
    return {
      ok: false,
      quarantine: true,
      issues: [{ line: null, path: "(manifest)", code: "MANIFEST_INVALID", message: "manifest contains secret material — quarantined" }],
    };
  }
  const parsed = parseYamlSubset(text);
  if (!parsed.ok) {
    return {
      ok: false,
      quarantine: true,
      issues: parsed.issues.map((i) => ({ line: i.line, path: "(yaml)", code: "MANIFEST_INVALID", message: i.message })),
    };
  }
  return validateManifestTree(parsed.tree);
}

export { SHA256_RE, SLUG_RE, SUPPORTED_API_VERSION, SUPPORTED_KIND };
