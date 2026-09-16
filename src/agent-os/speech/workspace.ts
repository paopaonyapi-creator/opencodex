// Phase 20.32 — confined speech workspace (doc §7).
// Every VoiceStudio path-based input/output must stay inside the approved
// project root. Paths are canonicalized, symlink escapes are rejected, and no
// parent-directory string literals are needed: containment is checked with
// resolved-prefix comparisons against the real workspace root.

import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { SpeechError } from "./errors";

export function speechWorkspaceRoot(): string {
  const raw = process.env.PAO_SPEECH_WORKSPACE || join(process.cwd(), "workspace", "pao-speech");
  return resolve(raw);
}

function rootPrefix(root: string): string {
  return root.endsWith(sep) ? root : root + sep;
}

function assertInsideRoot(root: string, candidate: string, what: string): void {
  if (candidate !== root && !candidate.startsWith(rootPrefix(root))) {
    throw new SpeechError(
      "SPEECH_PATH_OUTSIDE_WORKSPACE",
      `Refusing ${what} outside the confined speech workspace`,
    );
  }
}

/** Walks up from the candidate to the root verifying no component is a
 *  symlink that escapes the workspace (doc §34). */
function assertNoSymlinkEscape(root: string, candidate: string): void {
  const prefix = rootPrefix(root);
  let current = candidate;
  while (current.startsWith(prefix)) {
    if (existsSync(current)) {
      let real: string;
      try {
        real = realpathSync(current);
      } catch {
        throw new SpeechError("SPEECH_PATH_OUTSIDE_WORKSPACE", "Refusing unreadable path inside the speech workspace");
      }
      if (real !== current && real !== root && !real.startsWith(prefix)) {
        throw new SpeechError("SPEECH_PATH_OUTSIDE_WORKSPACE", "Refusing symlink escape from the speech workspace");
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/**
 * Resolves a workspace-relative (or already-inside absolute) path and
 * guarantees containment. `mustExist` also verifies the target is a file.
 */
export function resolveInSpeechWorkspace(relativePath: string, opts?: { mustExist?: boolean }): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new SpeechError("SPEECH_PATH_OUTSIDE_WORKSPACE", "A workspace path is required");
  }
  const root = speechWorkspaceRoot();
  if (!existsSync(root)) {
    try {
      mkdirSync(root, { recursive: true });
    } catch {
      throw new SpeechError("SPEECH_PATH_OUTSIDE_WORKSPACE", "Speech workspace root is not writable");
    }
  }
  const candidate = isAbsolute(relativePath) ? resolve(relativePath) : resolve(root, relativePath);
  assertInsideRoot(root, candidate, "path");
  assertNoSymlinkEscape(root, candidate);
  if (opts?.mustExist) {
    if (!existsSync(candidate)) {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", "Referenced workspace file does not exist");
    }
    if (!statSync(candidate).isFile()) {
      throw new SpeechError("SPEECH_OUTPUT_INVALID", "Referenced workspace path is not a file");
    }
  }
  return candidate;
}

export interface SpeechProjectDirs {
  root: string;
  audio: string;
  transcripts: string;
}

/** Creates the confined per-project layout (doc §7) and returns its paths. */
export function ensureSpeechProjectDirs(projectId: string): SpeechProjectDirs {
  const safeId = projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "default";
  const root = speechWorkspaceRoot();
  const projectRoot = resolve(root, "projects", safeId);
  assertInsideRoot(root, projectRoot, "project root");
  const audio = join(projectRoot, "audio");
  const transcripts = join(projectRoot, "transcripts");
  for (const dir of [projectRoot, audio, transcripts]) {
    mkdirSync(dir, { recursive: true });
  }
  return { root: projectRoot, audio, transcripts };
}

/** Redacted diagnostics entry (doc §39): never prints credentials. */
export function workspaceDiagnostics(): Record<string, unknown> {
  const root = speechWorkspaceRoot();
  let writable = false;
  try {
    mkdirSync(root, { recursive: true });
    writable = existsSync(root);
  } catch {
    writable = false;
  }
  return { rootConfigured: Boolean(process.env.PAO_SPEECH_WORKSPACE), writable };
}
