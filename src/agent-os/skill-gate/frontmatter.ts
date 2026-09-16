// Phase 20.57 — SKILL.md frontmatter reader. Imported metadata is parsed as
// data only; it never configures runtime behavior.

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  license?: string;
}

/** Minimal `key: value` frontmatter reader for the four fields we capture. */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return {};
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return {};
  const block = normalized.slice(4, end);
  const parsed: ParsedFrontmatter = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim().replace(/^["']|["']$/g, "");
    if (key === "name") parsed.name = value;
    else if (key === "description") parsed.description = value;
    else if (key === "version") parsed.version = value;
    else if (key === "license") parsed.license = value;
  }
  return parsed;
}
