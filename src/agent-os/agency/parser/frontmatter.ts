// Safe Frontmatter Extractor for Agency Agent Markdown
// Handles single or duplicate YAML blocks, comments, and missing fields without crashing.

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  division?: string;
  source?: string;
  extends?: string;
  capabilities?: string[];
  keywords?: string[];
  tags?: string[];
  customFields: Record<string, string>;
}

export function parseAgentFrontmatter(content: string): {
  frontmatter: ParsedFrontmatter;
  body: string;
} {
  const result: ParsedFrontmatter = {
    customFields: {},
  };

  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: result, body: content };
  }

  // Find closing delimiter
  let rest = trimmed.slice(3);
  let endIndex = rest.indexOf("---");
  if (endIndex === -1) {
    return { frontmatter: result, body: content };
  }

  const rawYaml = rest.slice(0, endIndex).trim();
  let remainingBody = rest.slice(endIndex + 3).trim();

  // If there is a second duplicate frontmatter block (observed in some bundled skills)
  if (remainingBody.startsWith("---")) {
    const secondRest = remainingBody.slice(3);
    const secondEnd = secondRest.indexOf("---");
    if (secondEnd !== -1) {
      const secondYaml = secondRest.slice(0, secondEnd).trim();
      remainingBody = secondRest.slice(secondEnd + 3).trim();
      parseYamlLines(secondYaml, result);
    }
  }

  parseYamlLines(rawYaml, result);

  return {
    frontmatter: result,
    body: remainingBody,
  };
}

function parseYamlLines(yaml: string, out: ParsedFrontmatter): void {
  const lines = yaml.split(/\r?\n/);
  let currentListKey: "capabilities" | "keywords" | null = null;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;

    // Check if line is a list item under an active array key
    if (clean.startsWith("- ") || clean === "-") {
      const item = clean.replace(/^-+\s*/, "").trim().replace(/^['"]|['"]$/g, "");
      if (item && currentListKey) {
        if (currentListKey === "capabilities") {
          out.capabilities = [...(out.capabilities ?? []), item];
        } else {
          out.keywords = [...(out.keywords ?? []), item];
        }
      }
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      currentListKey = null;
      continue;
    }

    const key = line.slice(0, colonIndex).trim().toLowerCase();
    let val = line.slice(colonIndex + 1).trim();

    currentListKey = null;

    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).trim();
    }

    switch (key) {
      case "name":
        out.name = val;
        break;
      case "description":
        out.description = val;
        break;
      case "color":
        out.color = val;
        break;
      case "emoji":
        out.emoji = val;
        break;
      case "vibe":
        out.vibe = val;
        break;
      case "division":
        out.division = val.toLowerCase();
        break;
      case "source":
        out.source = val;
        break;
      case "extends":
        out.extends = val;
        break;
      case "tags":
      case "keywords":
      case "capabilities": {
        currentListKey = key === "capabilities" ? "capabilities" : "keywords";
        if (val) {
          const items = val
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
          if (currentListKey === "capabilities") {
            out.capabilities = [...(out.capabilities ?? []), ...items];
          } else {
            out.keywords = [...(out.keywords ?? []), ...items];
          }
        }
        break;
      }
      default:
        out.customFields[key] = val;
        break;
    }
  }
}
