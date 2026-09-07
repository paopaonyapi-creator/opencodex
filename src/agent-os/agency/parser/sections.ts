// Markdown Sections Extractor for Agency Agents
// Extracts structured lists and paragraphs from standard Agent sections.

export interface ParsedAgentSections {
  identity: string[];
  coreMission: string[];
  criticalRules: string[];
  deliverables: string[];
  workflowProcess: string[];
  successMetrics: string[];
  capabilities: string[];
  keywords: string[];
}

export function parseAgentSections(body: string): ParsedAgentSections {
  const result: ParsedAgentSections = {
    identity: [],
    coreMission: [],
    criticalRules: [],
    deliverables: [],
    workflowProcess: [],
    successMetrics: [],
    capabilities: [],
    keywords: [],
  };

  const lines = body.split(/\r?\n/);
  let currentSection: keyof ParsedAgentSections | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for markdown headers (# or ## or ###)
    const headerMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (headerMatch) {
      const headerTitle = headerMatch[1].toLowerCase();
      if (headerTitle.includes("identity") || headerTitle.includes("memory") || headerTitle.includes("persona")) {
        currentSection = "identity";
      } else if (headerTitle.includes("mission") || headerTitle.includes("purpose") || headerTitle.includes("objective")) {
        currentSection = "coreMission";
      } else if (headerTitle.includes("critical rule") || headerTitle.includes("rules") || headerTitle.includes("guardrail")) {
        currentSection = "criticalRules";
      } else if (headerTitle.includes("deliverable") || headerTitle.includes("output") || headerTitle.includes("artifact")) {
        currentSection = "deliverables";
      } else if (headerTitle.includes("workflow") || headerTitle.includes("process") || headerTitle.includes("steps")) {
        currentSection = "workflowProcess";
      } else if (headerTitle.includes("metric") || headerTitle.includes("success") || headerTitle.includes("criteria")) {
        currentSection = "successMetrics";
      } else if (headerTitle.includes("capabilit") || headerTitle.includes("skill") || headerTitle.includes("expert")) {
        currentSection = "capabilities";
      } else {
        currentSection = null;
      }
      continue;
    }

    if (!currentSection) continue;

    // Check if line is a bullet item (- or * or numbered 1.)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      const itemText = bulletMatch[1].replace(/\*\*/g, "").trim();
      if (itemText) {
        result[currentSection].push(itemText);
      }
    } else if (trimmed.length > 0 && !trimmed.startsWith("```")) {
      // Non-bullet substantive sentence under a section
      if (currentSection === "coreMission" || currentSection === "identity") {
        result[currentSection].push(trimmed.replace(/\*\*/g, ""));
      }
    }
  }

  // Derive extra keywords from deliverables and critical rules
  const derivedKeywords = new Set<string>();
  const extractWords = (text: string) => {
    const words = text.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [];
    for (const w of words) {
      if (!["and", "the", "for", "with", "this", "that", "from", "your", "must"].includes(w)) {
        derivedKeywords.add(w);
      }
    }
  };

  result.criticalRules.forEach(extractWords);
  result.deliverables.forEach(extractWords);
  result.coreMission.forEach(extractWords);
  result.keywords = Array.from(derivedKeywords).slice(0, 30);

  return result;
}
