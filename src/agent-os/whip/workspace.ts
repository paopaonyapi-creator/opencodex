// Phase 20.99 — Terminal Gateway & Remote SFTP/File Workspace (§11, §12).
//
// Key principles:
// - Terminal isolation: one terminal failure must not collapse host control stream.
// - SFTP atomic file transfer: upload to temp sibling → verify → atomic rename into destination.
// - Path-traversal defense: strict boundary checks on all file operations.
// - Bounded previews: cap text previews at 1MB, diff previews at 2MB.

import { sha256Hex } from "../agent-runtime/hash";
import { newWhipId, nowIso, WhipStore } from "./store";
import {
  type RemoteFileEntry,
  type RemoteGitStatus,
  type WhipTerminalSession,
  WhipError,
} from "./types";

export class TerminalGateway {
  private readonly store: WhipStore;

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  openTerminal(input: {
    hostId: string;
    agentId?: string | null;
    sessionId?: string | null;
    paneId?: string | null;
    cwd?: string | null;
  }): WhipTerminalSession {
    const term: WhipTerminalSession = {
      id: newWhipId("whptm"),
      hostId: input.hostId,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      paneId: input.paneId ?? null,
      cwd: input.cwd ?? "/work",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertTerminal(term);
    return term;
  }

  getTerminal(id: string): WhipTerminalSession | null {
    return this.store.getTerminal(id);
  }

  listTerminals(hostId?: string): WhipTerminalSession[] {
    return this.store.listTerminals(hostId);
  }
}

export class RemoteFileWorkspace {
  private readonly files = new Map<string, { content: string; modifiedAt: string }>();

  /**
   * Validate path against directory traversal attacks (spec §12.4, §35.5).
   */
  validatePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.startsWith("/") || normalized.startsWith("~")) {
      throw new WhipError(
        "SFTP_TRAVERSAL_DENIED",
        `path traversal attempt detected in '${relativePath}'`,
      );
    }
    return normalized;
  }

  /**
   * Atomic file upload simulation: temp sibling → sync → finalize rename (spec §12.2).
   */
  async uploadFile(
    destinationPath: string,
    content: string,
  ): Promise<{ path: string; sizeBytes: number; contentHash: string; atomicFinalized: boolean }> {
    const validPath = this.validatePath(destinationPath);
    const tempPath = `${validPath}.whip_tmp_${Date.now()}`;
    const hash = sha256Hex(content);

    // 1. Stage in temp sibling
    this.files.set(tempPath, { content, modifiedAt: nowIso() });

    // 2. Atomic finalize rename into destination
    this.files.delete(tempPath);
    this.files.set(validPath, { content, modifiedAt: nowIso() });

    return {
      path: validPath,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      contentHash: hash,
      atomicFinalized: true,
    };
  }

  /**
   * Bounded text preview with max 1MiB limit (spec §12.3).
   */
  readTextPreview(path: string, maxBytes = 1024 * 1024): { content: string; truncated: boolean; totalBytes: number } {
    const validPath = this.validatePath(path);
    const entry = this.files.get(validPath);
    if (!entry) {
      throw new WhipError("FILE_NOT_FOUND", `remote file not found: ${path}`);
    }

    const totalBytes = Buffer.byteLength(entry.content, "utf8");
    if (totalBytes > maxBytes) {
      return {
        content: entry.content.slice(0, maxBytes),
        truncated: true,
        totalBytes,
      };
    }

    return {
      content: entry.content,
      truncated: false,
      totalBytes,
    };
  }

  listFiles(): RemoteFileEntry[] {
    const list: RemoteFileEntry[] = [];
    for (const [path, data] of this.files.entries()) {
      list.push({
        name: path.split("/").pop() ?? path,
        path,
        isDirectory: false,
        sizeBytes: Buffer.byteLength(data.content, "utf8"),
        modifiedAt: data.modifiedAt,
      });
    }
    return list;
  }
}
