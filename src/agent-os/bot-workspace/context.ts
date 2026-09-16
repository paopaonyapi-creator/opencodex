// Phase 20.42 — Mention resolver + ContextBuilder (spec §5.7, §28).
// Mentions resolve to STABLE agent IDs (never route by display name after
// resolution); ContextBuilder assembles a deterministic, size-bounded
// context package — never a blind dump of database history.

import type { BwAgent, BwMessage, MentionMatch } from "./types";

export interface MentionResolverDeps {
  workspaceId: string;
  findAgentsByName: (workspaceId: string, name: string) => BwAgent[];
}

/** Parse @Name mentions and resolve to stable agent ids via longest-prefix
 *  word matching (supports multi-word display names like "Codex Coder").
 *  Duplicate display names produce an ambiguous match that must be
 *  disambiguated by explicit selection — never guessed. Disabled/archived
 *  agents do not resolve (mention spoofing / stale names stay inert). */
export function parseMentions(deps: MentionResolverDeps, text: string): { matches: MentionMatch[]; ambiguous: Array<{ token: string; candidates: string[] }> } {
  const matches: MentionMatch[] = [];
  const ambiguous: Array<{ token: string; candidates: string[] }> = [];
  const startPattern = /@([A-Za-z0-9][A-Za-z0-9 _-]{0,79})/g;
  const consumedRanges: Array<[number, number]> = [];
  for (const match of text.matchAll(startPattern)) {
    const start = match.index;
    if (consumedRanges.some((range) => start >= range[0] && start < range[1])) continue;
    // Candidate words after @ (up to 5); punctuation/line ends a name.
    const words = match[1].trim().split(/\s+/).filter((word) => word.length > 0).slice(0, 5);
    let resolved = false;
    for (let take = words.length; take >= 1 && !resolved; take -= 1) {
      const name = words.slice(0, take).join(" ");
      const end = start + 1 + name.length;
      const candidates = deps.findAgentsByName(deps.workspaceId, name).filter((agent) => agent.status === "active");
      if (candidates.length === 1) {
        matches.push({ agentId: candidates[0].id, agentName: candidates[0].name, token: "@" + name, startOffset: start, endOffset: end });
        consumedRanges.push([start, end]);
        resolved = true;
      } else if (candidates.length > 1) {
        ambiguous.push({ token: "@" + name, candidates: candidates.map((agent) => agent.id) });
        consumedRanges.push([start, end]);
        resolved = true;
      }
    }
  }
  return { matches, ambiguous };
}

export interface NormalizedExecutionContext {
  order: string[];
  sections: Array<{ heading: string; text: string }>;
  approxTokens: number;
  truncated: boolean;
}

export interface ContextBuilderInput {
  initiatingMessage: string;
  agent: BwAgent;
  teamInstructions: string | null;
  conversationHistory: BwMessage[];
  previousRoundOutputs: Array<{ agentName: string; text: string }>;
  replyTarget: { agentName: string; text: string } | null;
  skillInstructions: string | null;
  policyConstraints: string[];
  maxChars: number;
}

/** Deterministic context assembly with an explicit character budget
 *  (spec §28). Order: system role → team instructions → skill → policy →
 *  initiating message → prior outputs (same round) → bounded recent
 *  history → reply target. Newest history entries are kept when trimming. */
export function buildExecutionContext(input: ContextBuilderInput): NormalizedExecutionContext {
  const sections: Array<{ heading: string; text: string }> = [];
  if (input.agent.systemInstructions) {
    sections.push({ heading: "Your instructions", text: input.agent.systemInstructions });
  }
  if (input.teamInstructions) {
    sections.push({ heading: "Team instructions", text: input.teamInstructions });
  }
  if (input.skillInstructions) {
    sections.push({ heading: "Skill instructions", text: input.skillInstructions });
  }
  if (input.policyConstraints.length > 0) {
    sections.push({ heading: "Safety and policy constraints", text: input.policyConstraints.join("\n") });
  }
  sections.push({ heading: "User task", text: input.initiatingMessage });
  for (const output of input.previousRoundOutputs) {
    sections.push({ heading: "Output from " + output.agentName, text: output.text });
  }

  const fixedChars = sections.reduce((total, section) => total + section.heading.length + section.text.length + 4, 0);
  const historyBudget = Math.max(0, input.maxChars - fixedChars - 400);
  const history: string[] = [];
  let used = 0;
  for (let index = input.conversationHistory.length - 1; index >= 0 && used < historyBudget; index -= 1) {
    const message = input.conversationHistory[index];
    const text = message.senderType + ": " + message.blocks.map((block) => block.text ?? "").join(" ").slice(0, 400);
    if (used + text.length > historyBudget) break;
    history.unshift(text);
    used += text.length;
  }
  if (history.length > 0) {
    sections.push({ heading: "Recent conversation", text: history.join("\n") });
  }
  if (input.replyTarget) {
    sections.push({ heading: "You are replying to " + input.replyTarget.agentName, text: input.replyTarget.text.slice(0, 1200) });
  }

  const order = sections.map((section) => section.heading);
  const totalChars = sections.reduce((total, section) => total + section.heading.length + section.text.length + 4, 0);
  return {
    order,
    sections,
    approxTokens: Math.ceil(totalChars / 4),
    truncated: input.conversationHistory.length > 0 && history.length < input.conversationHistory.length,
  };
}

export function renderContextText(context: NormalizedExecutionContext): string {
  return context.sections.map((section) => "## " + section.heading + "\n" + section.text).join("\n\n");
}
