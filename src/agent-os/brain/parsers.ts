// Phase 20.5 — Parsers & Normalization Engine

export interface ParsedSection {
  title: string;
  level: number;
  content: string;
  lineStart: number;
  lineEnd: number;
  subsections: ParsedSection[];
}

export interface NormalizedDocument {
  title: string;
  sourceType: string;
  sections: ParsedSection[];
  rawText: string;
  metadata: Record<string, unknown>;
  detectedLanguage?: string;
}

const MAX_PARSEABLE_SIZE = 10 * 1024 * 1024; // 10MB limit for safe in-memory parsing

export function parseMarkdown(text: string, titleHint = "Document"): NormalizedDocument {
  if (text.length > MAX_PARSEABLE_SIZE) {
    throw new Error(`File exceeds maximum parseable size of ${MAX_PARSEABLE_SIZE} bytes`);
  }

  const lines = text.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = {
    title: titleHint,
    level: 0,
    content: "",
    lineStart: 1,
    lineEnd: 1,
    subsections: [],
  };

  let title = titleHint;
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i]!;

    // Frontmatter check
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
        continue;
      }
      frontmatterLines.push(line);
      continue;
    }

    // Heading match
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Close previous section if it had content, was an actual heading, or prior sections exist
      if (currentSection.content.trim() !== "" || currentSection.level > 0 || sections.length > 0) {
        currentSection.lineEnd = Math.max(currentSection.lineStart, lineNum - 1);
        sections.push(currentSection);
      }

      const level = headingMatch[1]!.length;
      const headingText = headingMatch[2]!.trim();
      if (level === 1 && title === titleHint) {
        title = headingText;
      }

      currentSection = {
        title: headingText,
        level,
        content: "",
        lineStart: lineNum,
        lineEnd: lineNum,
        subsections: [],
      };
    } else {
      currentSection.content += (currentSection.content ? "\n" : "") + line;
    }
  }

  if (currentSection.content.trim() !== "" || currentSection.level > 0 || sections.length === 0) {
    currentSection.lineEnd = lines.length;
    sections.push(currentSection);
  }

  // Parse frontmatter metadata if present
  let metadata: Record<string, unknown> = {};
  if (frontmatterLines.length > 0) {
    for (const fLine of frontmatterLines) {
      const idx = fLine.indexOf(":");
      if (idx > 0) {
        const key = fLine.slice(0, idx).trim();
        const val = fLine.slice(idx + 1).trim();
        metadata[key] = val;
      }
    }
  }

  return {
    title,
    sourceType: "MARKDOWN",
    sections,
    rawText: text,
    metadata,
  };
}

export function parsePlainText(text: string, titleHint = "Text Document"): NormalizedDocument {
  if (text.length > MAX_PARSEABLE_SIZE) {
    throw new Error(`File exceeds maximum parseable size of ${MAX_PARSEABLE_SIZE} bytes`);
  }
  const lines = text.split(/\r?\n/);
  return {
    title: titleHint,
    sourceType: "TEXT",
    sections: [
      {
        title: titleHint,
        level: 1,
        content: text,
        lineStart: 1,
        lineEnd: lines.length,
        subsections: [],
      },
    ],
    rawText: text,
    metadata: {},
  };
}

export function parseJsonDocument(text: string, titleHint = "JSON Data"): NormalizedDocument {
  if (text.length > MAX_PARSEABLE_SIZE) {
    throw new Error(`File exceeds maximum parseable size of ${MAX_PARSEABLE_SIZE} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines = text.split(/\r?\n/);
  const metadata = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { payload: parsed };

  return {
    title: (metadata.title as string) ?? (metadata.name as string) ?? titleHint,
    sourceType: "JSON",
    sections: [
      {
        title: titleHint,
        level: 1,
        content: text,
        lineStart: 1,
        lineEnd: lines.length,
        subsections: [],
      },
    ],
    rawText: text,
    metadata,
  };
}

export function parseYamlDocument(text: string, titleHint = "YAML Config"): NormalizedDocument {
  if (text.length > MAX_PARSEABLE_SIZE) {
    throw new Error(`File exceeds maximum parseable size of ${MAX_PARSEABLE_SIZE} bytes`);
  }

  const lines = text.split(/\r?\n/);
  const metadata: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    const idx = trimmed.indexOf(":");
    if (idx > 0 && !trimmed.startsWith("-")) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      metadata[k] = v;
    }
  }

  return {
    title: (metadata.name as string) ?? (metadata.title as string) ?? titleHint,
    sourceType: "YAML",
    sections: [
      {
        title: titleHint,
        level: 1,
        content: text,
        lineStart: 1,
        lineEnd: lines.length,
        subsections: [],
      },
    ],
    rawText: text,
    metadata,
  };
}

export function parseDocument(text: string, filenameOrUri: string): NormalizedDocument {
  const lower = filenameOrUri.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return parseMarkdown(text, filenameOrUri);
  }
  if (lower.endsWith(".json")) {
    return parseJsonDocument(text, filenameOrUri);
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return parseYamlDocument(text, filenameOrUri);
  }
  return parsePlainText(text, filenameOrUri);
}
