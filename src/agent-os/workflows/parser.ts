// Phase 20.29 — WORKFLOW.md parser + static security scan (doc §5, §19-§20).
//
// Pragmatic front-matter subset parser: nested maps, scalars, inline numbers/
// booleans, and lists of scalars or single-key maps — enough for the documented
// WORKFLOW.md format without a YAML dependency. Unknown constructs fail the
// parse (fail closed) rather than being guessed.

import { createHash } from "node:crypto";
import type { ParsedWorkflow, WorkflowFrontMatter } from "./types";

const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  [/curl[^|]*\|\s*(ba)?sh/i, "remote script execution (curl | bash)"],
  [/wget[^|]*\|\s*(ba)?sh/i, "remote script execution (wget | sh)"],
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\.\/)?(\/|~)/i, "recursive forced delete at root/home"],
  [/\bsudo\b/i, "sudo escalation"],
  [/chmod\s+777/i, "chmod 777"],
  [/credential[_\s-]*(dump|export)|env\s+dump/i, "credential/env dump"],
  [/id_rsa|id_ed25519|\.ssh\//i, "private key / ssh material access"],
  [/cookie[_\s-]*(dump|steal)|browser[_\s-]*cookie/i, "browser cookie dump"],
  [/secret[_\s-]*export/i, "secret export"],
  [/mkfs|dd\s+if=/i, "disk destruction"],
];

export class WorkflowParseError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("[WORKFLOW_PARSE_FAILED] " + reason);
    this.name = "WorkflowParseError";
    this.reason = reason;
  }
}

/** Dangerous-instruction scan (doc §20). Returns the first match or null. */
export function scanDangerousPatterns(raw: string): string | null {
  for (const [pattern, why] of DANGEROUS_PATTERNS) {
    if (pattern.test(raw)) return why;
  }
  return null;
}

/** Minimal YAML-subset parser: maps, scalars, lists (scalars + 1-key maps). */
function parseYamlSubset(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  // Each stack frame knows how to store a value into its parent, so an
  // omitted-value key (`paths:`) can lazily materialize as a map OR convert
  // into a list when its first child line is a `- ` item.
  interface Frame {
    indent: number;
    isList: boolean;
    isPlaceholder: boolean;
    list: unknown[];
    map: Record<string, unknown>;
    write(value: unknown): void;
  }

  const stack: Frame[] = [{
    indent: -1,
    isList: false,
    isPlaceholder: false,
    list: [],
    map: root,
    write: () => {
      void root;
    },
  }];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

    const frame = stack[stack.length - 1];

    if (line.startsWith("- ")) {
      const itemText = line.slice(2).trim();
      // Lazy typing: a placeholder key whose first child is a list item
      // converts to a list in its parent (by reference) right here.
      if (frame.isPlaceholder) {
        frame.isList = true;
        frame.write(frame.list);
        frame.isPlaceholder = false;
      }
      if (!frame.isList) {
        throw new WorkflowParseError("list item outside a list at: " + line);
      }
      const mapMatch = itemText.match(/^([\w-]+):\s*(.*)$/);
      if (mapMatch) {
        const item: Record<string, unknown> = { [mapMatch[1]]: coerce(mapMatch[2]) };
        frame.list.push(item);
        stack.push({
          indent,
          isList: false,
          isPlaceholder: false,
          list: [],
          map: item,
          write: (value) => {
            item[mapMatch[1]] = value;
          },
        });
      } else {
        frame.list.push(coerce(itemText));
      }
      continue;
    }

    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) throw new WorkflowParseError("unrecognized line: " + line);
    const [, key, rawValue] = kv;
    if (rawValue === "") {
      // Value omitted: default to a map assigned by reference; if the first
      // child turns out to be a list item, the placeholder converts above.
      const childMap: Record<string, unknown> = {};
      frame.map[key] = childMap;
      stack.push({
        indent,
        isList: false,
        isPlaceholder: true,
        list: [],
        map: childMap,
        write: (value) => {
          frame.map[key] = value;
        },
      });
      continue;
    }
    frame.map[key] = coerce(rawValue);
  }

  return root;
}

function resolvePlaceholders(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(resolvePlaceholders);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.__placeholder) {
      // A placeholder with no children becomes an empty map.
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "__placeholder" || k === "__parentKey") continue;
        copy[k] = resolvePlaceholders(v);
      }
      return copy;
    }
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      copy[k] = resolvePlaceholders(v);
    }
    return copy;
  }
  return node;
}

function coerce(value: string): unknown {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

const REQUIRED_FIELDS = ["id", "name", "version", "trigger", "runtime", "permissions"] as const;
const KNOWN_TRIGGER = new Set(["manual", "schedule", "webhook", "filesystem", "git", "api", "event", "pipeline"]);

/** Parse a WORKFLOW.md document into a validated ParsedWorkflow. */
export function parseWorkflowMarkdown(raw: string): ParsedWorkflow {
  const frontMatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontMatterMatch) throw new WorkflowParseError("missing YAML front matter block");
  const parsed = parseYamlSubset(frontMatterMatch[1]) as unknown as WorkflowFrontMatter;

  for (const field of REQUIRED_FIELDS) {
    if (parsed[field as keyof WorkflowFrontMatter] === undefined) {
      throw new WorkflowParseError("missing required front-matter field: " + field);
    }
  }
  if (typeof parsed.id !== "string" || !/^[\w-]+$/.test(parsed.id)) {
    throw new WorkflowParseError("invalid workflow id");
  }
  if (typeof parsed.trigger !== "object" || !KNOWN_TRIGGER.has(parsed.trigger?.type)) {
    throw new WorkflowParseError("unsupported trigger type: " + String(parsed.trigger?.type));
  }
  if (typeof parsed.permissions !== "object") {
    throw new WorkflowParseError("permissions block is required (deny-by-default)");
  }

  const body = frontMatterMatch[2] ?? "";
  const stepsSection = body.match(/^##\s+Steps\s*$/im);
  const steps: string[] = [];
  if (stepsSection && stepsSection.index !== undefined) {
    const after = body.slice(stepsSection.index + stepsSection[0].length);
    const nextHeading = after.search(/^##\s+/im);
    const stepsBody = nextHeading === -1 ? after : after.slice(0, nextHeading);
    for (const line of stepsBody.split(/\r?\n/)) {
      const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (numbered) steps.push(numbered[1].trim());
    }
  }

  const checksum = "sha256:" + createHash("sha256").update(raw).digest("hex");
  return { frontMatter: parsed, body, steps, checksum };
}
