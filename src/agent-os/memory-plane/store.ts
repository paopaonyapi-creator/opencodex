// Phase 20.41 — MemoryStore core: workspaces, projects, agents, memory_items,
// revisions, tags, idempotency keys (schema v41). Literal single-line SQL
// with positional parameters only; upserts are read-then-write against
// unique keys. Derived/operational data lives in ./store-ops.

import { openAgentOsDb } from "../db";
import type { MemoryAgent, MemoryAuthority, MemoryKind, MemoryRecord, MemoryRevisionSnapshot, MemoryTagLink, MemoryWorkspace, MemoryProject } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export class MemoryStore {
  protected db = openAgentOsDb();

  // --- Workspaces ------------------------------------------------------------------

  ensureWorkspace(slug: string, name?: string): MemoryWorkspace {
    const existing = this.db.query("SELECT * FROM memory_workspaces WHERE slug = ?").get(slug) as Record<string, unknown> | null;
    if (existing) return mapWorkspace(existing);
    const id = shortId("mw");
    const now = nowIso();
    this.db
      .query("INSERT INTO memory_workspaces (id, slug, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, slug, name ?? slug, null, "active", now, now);
    return mapWorkspace(this.db.query("SELECT * FROM memory_workspaces WHERE id = ?").get(id) as Record<string, unknown>);
  }

  getWorkspaceBySlug(slug: string): MemoryWorkspace | null {
    const row = this.db.query("SELECT * FROM memory_workspaces WHERE slug = ? AND status = 'active'").get(slug) as Record<string, unknown> | null;
    return row ? mapWorkspace(row) : null;
  }

  listWorkspaces(): MemoryWorkspace[] {
    return (this.db.query("SELECT * FROM memory_workspaces WHERE status = 'active' ORDER BY slug").all() as Array<Record<string, unknown>>).map(mapWorkspace);
  }

  // --- Projects ---------------------------------------------------------------------

  ensureProject(workspaceId: string, slug: string | null, name?: string): MemoryProject | null {
    if (!slug) return null;
    const existing = this.db.query("SELECT * FROM memory_projects WHERE workspace_id = ? AND slug = ?").get(workspaceId, slug) as Record<string, unknown> | null;
    if (existing) return mapProject(existing);
    const id = shortId("mp");
    const now = nowIso();
    this.db
      .query("INSERT INTO memory_projects (id, workspace_id, slug, name, repository_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, workspaceId, slug, name ?? slug, null, "active", now, now);
    return mapProject(this.db.query("SELECT * FROM memory_projects WHERE id = ?").get(id) as Record<string, unknown>);
  }

  getProject(workspaceId: string, slug: string): MemoryProject | null {
    const row = this.db.query("SELECT * FROM memory_projects WHERE workspace_id = ? AND slug = ? AND status = 'active'").get(workspaceId, slug) as Record<string, unknown> | null;
    return row ? mapProject(row) : null;
  }

  listProjects(workspaceId?: string): MemoryProject[] {
    const rows = workspaceId
      ? (this.db.query("SELECT * FROM memory_projects WHERE workspace_id = ? ORDER BY slug").all(workspaceId) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM memory_projects ORDER BY workspace_id, slug").all() as Array<Record<string, unknown>>);
    return rows.map(mapProject);
  }

  // --- Agents (logical writers/readers) --------------------------------------------------

  ensureAgent(workspaceId: string, agentKey: string, name?: string, provider?: string | null, model?: string | null, trustLevel?: MemoryAgent["trustLevel"]): MemoryAgent {
    const existing = this.db.query("SELECT * FROM memory_agents WHERE workspace_id = ? AND agent_key = ?").get(workspaceId, agentKey) as Record<string, unknown> | null;
    if (existing) return mapAgent(existing);
    const id = shortId("mag");
    const now = nowIso();
    this.db
      .query("INSERT INTO memory_agents (id, workspace_id, agent_key, name, provider, model, trust_level, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, workspaceId, agentKey, name ?? agentKey, provider ?? null, model ?? null, trustLevel ?? "standard", "active", now, now);
    return mapAgent(this.db.query("SELECT * FROM memory_agents WHERE id = ?").get(id) as Record<string, unknown>);
  }

  listAgents(workspaceId?: string): MemoryAgent[] {
    const rows = workspaceId
      ? (this.db.query("SELECT * FROM memory_agents WHERE workspace_id = ? ORDER BY agent_key").all(workspaceId) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM memory_agents ORDER BY workspace_id, agent_key").all() as Array<Record<string, unknown>>);
    return rows.map(mapAgent);
  }

  // --- Memories (current canonical pointer) -------------------------------------------------

  insertMemory(record: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "forgottenAt">): MemoryRecord {
    const id = shortId("mem");
    const now = nowIso();
    this.db
      .query("INSERT INTO memory_items (id, workspace_id, project_id, authority, kind, current_revision, current_hash, title, content, source_path, created_by_agent_id, supersedes_memory_id, indexing_state, status, created_at, updated_at, forgotten_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, record.workspaceId, record.projectId, record.authority, record.kind, record.currentRevision, record.currentHash, record.title, record.content, record.sourcePath, record.createdByAgentId, record.supersedesMemoryId, record.indexingState, record.status, now, now, null);
    return this.getMemory(id) as MemoryRecord;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.query("SELECT * FROM memory_items WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapMemory(row) : null;
  }

  findByHash(workspaceId: string, contentHash: string): MemoryRecord | null {
    const row = this.db.query("SELECT * FROM memory_items WHERE workspace_id = ? AND current_hash = ? AND status = 'active' LIMIT 1").get(workspaceId, contentHash) as Record<string, unknown> | null;
    return row ? mapMemory(row) : null;
  }

  listMemories(filter: { workspaceId?: string; projectId?: string; kinds?: string[]; authorities?: string[]; status?: string; search?: string; createdAfter?: string; createdBefore?: string; limit?: number } = {}): MemoryRecord[] {
    const limit = filter.limit ?? 200;
    let rows: Array<Record<string, unknown>>;
    if (filter.workspaceId) {
      rows = this.db.query("SELECT * FROM memory_items WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?").all(filter.workspaceId, filter.status ?? "active", limit) as Array<Record<string, unknown>>;
    } else if (filter.status) {
      rows = this.db.query("SELECT * FROM memory_items WHERE status = ? ORDER BY updated_at DESC LIMIT ?").all(filter.status, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.query("SELECT * FROM memory_items ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    let mapped = rows.map(mapMemory);
    if (filter.projectId) mapped = mapped.filter((memory) => memory.projectId === filter.projectId);
    if (filter.kinds && filter.kinds.length > 0) {
      const allowed = new Set(filter.kinds);
      mapped = mapped.filter((memory) => allowed.has(memory.kind));
    }
    if (filter.authorities && filter.authorities.length > 0) {
      const allowed = new Set(filter.authorities);
      mapped = mapped.filter((memory) => allowed.has(memory.authority));
    }
    if (filter.search && filter.search.length > 0) {
      const needle = filter.search.toLowerCase();
      mapped = mapped.filter((memory) => memory.title.toLowerCase().includes(needle) || memory.content.toLowerCase().includes(needle));
    }
    if (filter.createdAfter) mapped = mapped.filter((memory) => memory.createdAt >= filter.createdAfter!);
    if (filter.createdBefore) mapped = mapped.filter((memory) => memory.createdAt <= filter.createdBefore!);
    return mapped;
  }

  countByAuthority(workspaceId: string): Record<string, number> {
    const rows = this.db.query("SELECT authority, COUNT(*) AS n FROM memory_items WHERE workspace_id = ? AND status = 'active' GROUP BY authority").all(workspaceId) as Array<{ authority: string; n: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.authority] = row.n;
    return out;
  }

  /** Optimistic-concurrency update: only when revision+hash still match. */
  updateMemoryCurrent(id: string, expectedRevision: number, expectedHash: string, next: { title: string; content: string; kind: MemoryKind; authority: MemoryAuthority; hash: string; revision: number; indexingState: string }): boolean {
    const result = this.db
      .query("UPDATE memory_items SET title = ?, content = ?, kind = ?, authority = ?, current_hash = ?, current_revision = ?, indexing_state = ?, updated_at = ? WHERE id = ? AND current_revision = ? AND current_hash = ? AND status = 'active'")
      .run(next.title, next.content, next.kind, next.authority, next.hash, next.revision, next.indexingState, nowIso(), id, expectedRevision, expectedHash);
    return result.changes === 1;
  }

  markIndexing(id: string, state: "ready" | "pending" | "degraded"): void {
    this.db.query("UPDATE memory_items SET indexing_state = ?, updated_at = ? WHERE id = ?").run(state, nowIso(), id);
  }

  markForgotten(id: string): void {
    this.db.query("UPDATE memory_items SET status = 'forgotten', forgotten_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  }

  countMemories(workspaceId?: string): number {
    const row = workspaceId
      ? (this.db.query("SELECT COUNT(*) AS n FROM memory_items WHERE workspace_id = ? AND status = 'active'").get(workspaceId) as { n: number })
      : (this.db.query("SELECT COUNT(*) AS n FROM memory_items WHERE status = 'active'").get() as { n: number });
    return row.n;
  }

  // --- Revisions (immutable) ---------------------------------------------------------------

  insertRevision(snapshot: Omit<MemoryRevisionSnapshot, "id" | "createdAt">): void {
    this.db
      .query("INSERT INTO memory_revisions (id, memory_id, revision, content_hash, title, content, kind, authority, project_id, source_path, created_by_agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("mrv"), snapshot.memoryId, snapshot.revision, snapshot.contentHash, snapshot.title, snapshot.content, snapshot.kind, snapshot.authority, snapshot.projectId, snapshot.sourcePath, snapshot.createdByAgentId, nowIso());
  }

  listRevisions(memoryId: string): MemoryRevisionSnapshot[] {
    const rows = this.db.query("SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision ASC").all(memoryId) as Array<Record<string, unknown>>;
    return rows.map(mapRevision);
  }

  // --- Tags -----------------------------------------------------------------------------------

  ensureTag(workspaceId: string, name: string): { id: string; name: string } {
    const normalized = name.trim().toLowerCase();
    const existing = this.db.query("SELECT * FROM memory_tags WHERE workspace_id = ? AND normalized_name = ?").get(workspaceId, normalized) as Record<string, unknown> | null;
    if (existing) return { id: String(existing.id), name: String(existing.name) };
    const id = shortId("mtg");
    this.db
      .query("INSERT INTO memory_tags (id, workspace_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, workspaceId, name.trim(), normalized, nowIso());
    return { id, name: name.trim() };
  }

  linkTag(memoryId: string, revision: number, tagId: string): void {
    const existing = this.db.query("SELECT memory_id FROM memory_tag_links WHERE memory_id = ? AND memory_revision = ? AND memory_tag_id = ?").get(memoryId, revision, tagId) as Record<string, unknown> | null;
    if (existing) return;
    this.db.query("INSERT INTO memory_tag_links (memory_id, memory_revision, memory_tag_id) VALUES (?, ?, ?)").run(memoryId, revision, tagId);
  }

  tagsForMemory(memoryId: string, revision: number): string[] {
    const rows = this.db.query("SELECT memory_tags.name FROM memory_tag_links JOIN memory_tags ON memory_tags.id = memory_tag_links.memory_tag_id WHERE memory_tag_links.memory_id = ? AND memory_tag_links.memory_revision = ?").all(memoryId, revision) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  listTags(workspaceId: string): Array<{ name: string; count: number }> {
    const rows = this.db.query("SELECT name, normalized_name FROM memory_tags WHERE workspace_id = ? ORDER BY normalized_name").all(workspaceId) as Array<{ name: string; normalized_name: string }>;
    return rows.map((row) => {
      const countRow = this.db.query("SELECT COUNT(*) AS n FROM memory_tag_links WHERE memory_tag_id = (SELECT id FROM memory_tags WHERE workspace_id = ? AND normalized_name = ?)").get(workspaceId, row.normalized_name) as { n: number };
      return { name: row.name, count: countRow.n };
    });
  }

  // --- Idempotency ------------------------------------------------------------------------------

  findIdempotent(workspaceId: string, actorKey: string, keyHash: string): string | null {
    const row = this.db.query("SELECT memory_id FROM memory_idempotency_keys WHERE workspace_id = ? AND actor_key = ? AND key_hash = ?").get(workspaceId, actorKey, keyHash) as { memory_id: string } | null;
    return row ? row.memory_id : null;
  }

  recordIdempotent(workspaceId: string, actorKey: string, keyHash: string, memoryId: string): void {
    const existing = this.db.query("SELECT id FROM memory_idempotency_keys WHERE workspace_id = ? AND actor_key = ? AND key_hash = ?").get(workspaceId, actorKey, keyHash) as Record<string, unknown> | null;
    if (existing) return;
    this.db
      .query("INSERT INTO memory_idempotency_keys (id, workspace_id, actor_key, key_hash, memory_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(shortId("mid"), workspaceId, actorKey, keyHash, memoryId, nowIso());
  }

  // --- Supersession (immutable snapshots) ----------------------------------------------------------

  insertSupersession(memoryId: string, supersedesMemoryId: string, supersededRevision: number, supersededHash: string): void {
    this.db
      .query("INSERT INTO memory_supersession_links (id, memory_id, supersedes_memory_id, superseded_revision, superseded_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(shortId("mss"), memoryId, supersedesMemoryId, supersededRevision, supersededHash, nowIso());
  }

  listSupersession(memoryId: string): Array<{ supersedesMemoryId: string; supersededRevision: number; supersededHash: string; createdAt: string }> {
    return (this.db.query("SELECT * FROM memory_supersession_links WHERE memory_id = ? ORDER BY created_at DESC").all(memoryId) as Array<Record<string, unknown>>).map((row) => ({
      supersedesMemoryId: String(row.supersedes_memory_id),
      supersededRevision: Number(row.superseded_revision),
      supersededHash: String(row.superseded_hash),
      createdAt: String(row.created_at),
    }));
  }

  supersededBy(memoryId: string): Array<{ memoryId: string }> {
    return (this.db.query("SELECT id, memory_id FROM memory_supersession_links WHERE supersedes_memory_id = ?").all(memoryId) as Array<Record<string, unknown>>).map((row) => ({ memoryId: String(row.memory_id) }));
  }
}

// --- mappers ------------------------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value);
}
function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : value == null ? fallback : Number(value);
}

function mapWorkspace(row: Record<string, unknown>): MemoryWorkspace {
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name),
    description: str(row.description),
    status: String(row.status) as MemoryWorkspace["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): MemoryProject {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), slug: String(row.slug), name: String(row.name),
    repositoryUrl: str(row.repository_url),
    status: String(row.status) as MemoryProject["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapAgent(row: Record<string, unknown>): MemoryAgent {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), agentKey: String(row.agent_key), name: String(row.name),
    provider: str(row.provider), model: str(row.model),
    trustLevel: String(row.trust_level) as MemoryAgent["trustLevel"],
    status: String(row.status) as MemoryAgent["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), projectId: str(row.project_id),
    authority: String(row.authority) as MemoryAuthority,
    kind: String(row.kind) as MemoryKind,
    currentRevision: numOr(row.current_revision, 1),
    currentHash: String(row.current_hash),
    title: String(row.title), content: String(row.content),
    sourcePath: str(row.source_path),
    createdByAgentId: str(row.created_by_agent_id),
    supersedesMemoryId: str(row.supersedes_memory_id),
    indexingState: String(row.indexing_state) as MemoryRecord["indexingState"],
    status: String(row.status) as MemoryRecord["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    forgottenAt: str(row.forgotten_at),
  };
}

function mapRevision(row: Record<string, unknown>): MemoryRevisionSnapshot {
  return {
    id: String(row.id), memoryId: String(row.memory_id), revision: numOr(row.revision, 1),
    contentHash: String(row.content_hash), title: String(row.title), content: String(row.content),
    kind: String(row.kind) as MemoryKind, authority: String(row.authority) as MemoryAuthority,
    projectId: str(row.project_id), sourcePath: str(row.source_path),
    createdByAgentId: str(row.created_by_agent_id), createdAt: String(row.created_at),
  };
}

export type { MemoryTagLink };
