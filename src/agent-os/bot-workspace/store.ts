// Phase 20.42 — BotWorkspace store (schema v42): workspaces, agents, teams,
// members, conversations, messages, mentions, drafts, provider/runtime
// bindings. Literal single-line SQL with positional parameters; upserts are
// read-then-write against unique keys. Rounds/executions/approvals/routines
// live in ./store-ops.

import { openAgentOsDb } from "../db";
import type { BwAgent, BwConversation, BwDraft, BwMessage, BwProviderBinding, BwRuntimeBinding, BwTeam, BwTeamMember, BwWorkspace, ContentBlock, WorkspaceAgentRole } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function blocksToJson(blocks: ContentBlock[]): string {
  return JSON.stringify({ blocks });
}

export function jsonToBlocks(contentJson: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(contentJson) as { blocks?: ContentBlock[] };
    return Array.isArray(parsed.blocks) ? parsed.blocks : [{ type: "text", text: contentJson }];
  } catch {
    return [{ type: "text", text: contentJson }];
  }
}

export class BotWorkspaceStore {
  protected db = openAgentOsDb();

  // --- Workspace ---------------------------------------------------------------------

  ensureWorkspace(slug: string, name?: string): BwWorkspace {
    const existing = this.db.query("SELECT * FROM bw_workspaces WHERE slug = ?").get(slug) as Record<string, unknown> | null;
    if (existing) return mapWorkspace(existing);
    const id = shortId("bww");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_workspaces (id, name, slug, description, status, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, name ?? slug, slug, null, "active", "{}", now, now);
    return mapWorkspace(this.db.query("SELECT * FROM bw_workspaces WHERE id = ?").get(id) as Record<string, unknown>);
  }

  getWorkspace(id: string): BwWorkspace | null {
    const row = this.db.query("SELECT * FROM bw_workspaces WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapWorkspace(row) : null;
  }

  // --- Agents ---------------------------------------------------------------------------

  insertAgent(agent: Omit<BwAgent, "id" | "createdAt" | "updatedAt">): BwAgent {
    const id = shortId("bwa");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_agents (id, workspace_id, name, slug, avatar_ref, description, role, system_instructions, status, visibility, provider_binding_id, runtime_binding_id, default_model, context_policy_json, capability_policy_json, approval_policy_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, agent.workspaceId, agent.name, agent.slug, agent.avatarRef, agent.description, agent.role, agent.systemInstructions, agent.status, agent.visibility, agent.providerBindingId, agent.runtimeBindingId, agent.defaultModel, agent.contextPolicyJson, agent.capabilityPolicyJson, agent.approvalPolicyJson, agent.metadataJson, now, now);
    return this.getAgent(id) as BwAgent;
  }

  getAgent(id: string): BwAgent | null {
    const row = this.db.query("SELECT * FROM bw_agents WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapAgent(row) : null;
  }

  listAgents(workspaceId: string, includeArchived = false): BwAgent[] {
    const rows = includeArchived
      ? (this.db.query("SELECT * FROM bw_agents WHERE workspace_id = ? ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM bw_agents WHERE workspace_id = ? AND status != 'archived' ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>);
    return rows.map(mapAgent);
  }

  updateAgent(id: string, patch: Partial<Omit<BwAgent, "id" | "workspaceId" | "createdAt">>): BwAgent {
    const existing = this.getAgent(id);
    if (!existing) throw new Error("[NOT_FOUND] agent not found");
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .query("UPDATE bw_agents SET name = ?, avatar_ref = ?, description = ?, role = ?, system_instructions = ?, status = ?, visibility = ?, provider_binding_id = ?, runtime_binding_id = ?, default_model = ?, context_policy_json = ?, capability_policy_json = ?, approval_policy_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.avatarRef, next.description, next.role, next.systemInstructions, next.status, next.visibility, next.providerBindingId, next.runtimeBindingId, next.defaultModel, next.contextPolicyJson, next.capabilityPolicyJson, next.approvalPolicyJson, next.metadataJson, next.updatedAt, id);
    return this.getAgent(id) as BwAgent;
  }

  findAgentsByName(workspaceId: string, name: string): BwAgent[] {
    return (this.db.query("SELECT * FROM bw_agents WHERE workspace_id = ? AND lower(name) = lower(?) AND status = 'active' ORDER BY created_at ASC").all(workspaceId, name) as Array<Record<string, unknown>>).map(mapAgent);
  }

  // --- Teams / members -----------------------------------------------------------------------

  insertTeam(team: Omit<BwTeam, "id" | "createdAt" | "updatedAt">): BwTeam {
    const id = shortId("bwt");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_teams (id, workspace_id, name, slug, description, lead_agent_id, orchestration_mode, default_recipient_order_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, team.workspaceId, team.name, team.slug, team.description, team.leadAgentId, team.orchestrationMode, team.defaultRecipientOrderJson, team.status, now, now);
    return this.getTeam(id) as BwTeam;
  }

  getTeam(id: string): BwTeam | null {
    const row = this.db.query("SELECT * FROM bw_teams WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapTeam(row) : null;
  }

  listTeams(workspaceId: string): BwTeam[] {
    return (this.db.query("SELECT * FROM bw_teams WHERE workspace_id = ? AND status = 'active' ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>).map(mapTeam);
  }

  updateTeam(id: string, patch: Partial<Omit<BwTeam, "id" | "workspaceId" | "createdAt">>): BwTeam {
    const existing = this.getTeam(id);
    if (!existing) throw new Error("[NOT_FOUND] team not found");
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .query("UPDATE bw_teams SET name = ?, description = ?, lead_agent_id = ?, orchestration_mode = ?, default_recipient_order_json = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.description, next.leadAgentId, next.orchestrationMode, next.defaultRecipientOrderJson, next.status, next.updatedAt, id);
    return this.getTeam(id) as BwTeam;
  }

  addTeamMember(teamId: string, agentId: string, position: number, roleInTeam: string | null, isRequired: boolean, canDelegate: boolean): BwTeamMember {
    const existing = this.db.query("SELECT * FROM bw_team_members WHERE team_id = ? AND agent_id = ?").get(teamId, agentId) as Record<string, unknown> | null;
    if (existing) {
      this.db.query("UPDATE bw_team_members SET position = ?, role_in_team = ? WHERE id = ?").run(position, roleInTeam, String(existing.id));
      return mapMember(this.db.query("SELECT * FROM bw_team_members WHERE id = ?").get(String(existing.id)) as Record<string, unknown>);
    }
    const id = shortId("bwm");
    this.db
      .query("INSERT INTO bw_team_members (id, team_id, agent_id, position, role_in_team, is_required, can_delegate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, teamId, agentId, position, roleInTeam, isRequired ? 1 : 0, canDelegate ? 1 : 0, nowIso());
    return mapMember(this.db.query("SELECT * FROM bw_team_members WHERE id = ?").get(id) as Record<string, unknown>);
  }

  listMembers(teamId: string): BwTeamMember[] {
    return (this.db.query("SELECT * FROM bw_team_members WHERE team_id = ? ORDER BY position ASC").all(teamId) as Array<Record<string, unknown>>).map(mapMember);
  }

  removeTeamMember(teamId: string, agentId: string): boolean {
    return this.db.query("DELETE FROM bw_team_members WHERE team_id = ? AND agent_id = ?").run(teamId, agentId).changes > 0;
  }

  // --- Conversations ---------------------------------------------------------------------------

  insertConversation(conversation: Omit<BwConversation, "id" | "createdAt" | "updatedAt" | "lastMessageAt">): BwConversation {
    const id = shortId("bwc");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_conversations (id, workspace_id, kind, agent_id, team_id, title, status, last_message_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, conversation.workspaceId, conversation.kind, conversation.agentId, conversation.teamId, conversation.title, conversation.status, null, "{}", now, now);
    return this.getConversation(id) as BwConversation;
  }

  getConversation(id: string): BwConversation | null {
    const row = this.db.query("SELECT * FROM bw_conversations WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapConversation(row) : null;
  }

  listConversations(workspaceId: string): BwConversation[] {
    return (this.db.query("SELECT * FROM bw_conversations WHERE workspace_id = ? AND status = 'active' ORDER BY COALESCE(last_message_at, updated_at) DESC").all(workspaceId) as Array<Record<string, unknown>>).map(mapConversation);
  }

  touchConversation(id: string): void {
    this.db.query("UPDATE bw_conversations SET last_message_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  }

  // --- Messages -----------------------------------------------------------------------------------

  insertMessage(message: Omit<BwMessage, "id" | "createdAt" | "updatedAt" | "blocks">): BwMessage {
    const id = shortId("bwm");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_messages (id, conversation_id, sender_type, sender_id, role, content_json, reply_to_message_id, parent_execution_id, client_message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, message.conversationId, message.senderType, message.senderId, message.role, message.contentJson, message.replyToMessageId, message.parentExecutionId, message.clientMessageId, message.status, now, now);
    return this.getMessage(id) as BwMessage;
  }

  getMessage(id: string): BwMessage | null {
    const row = this.db.query("SELECT * FROM bw_messages WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapMessage(row) : null;
  }

  updateMessageStatus(id: string, status: BwMessage["status"], contentJson?: string): void {
    if (contentJson !== undefined) {
      this.db.query("UPDATE bw_messages SET status = ?, content_json = ?, updated_at = ? WHERE id = ?").run(status, contentJson, nowIso(), id);
      return;
    }
    this.db.query("UPDATE bw_messages SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  }

  appendMessageBlock(id: string, block: ContentBlock): void {
    const message = this.getMessage(id);
    if (!message) return;
    const blocks = [...message.blocks, block];
    this.db.query("UPDATE bw_messages SET content_json = ?, status = ?, updated_at = ? WHERE id = ?").run(blocksToJson(blocks), "final", nowIso(), id);
  }

  listMessages(conversationId: string, limit = 200): BwMessage[] {
    return (this.db.query("SELECT * FROM bw_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?").all(conversationId, limit) as Array<Record<string, unknown>>).map(mapMessage);
  }

  findMessageByClientKey(conversationId: string, clientMessageId: string): BwMessage | null {
    const row = this.db.query("SELECT * FROM bw_messages WHERE conversation_id = ? AND client_message_id = ? LIMIT 1").get(conversationId, clientMessageId) as Record<string, unknown> | null;
    return row ? mapMessage(row) : null;
  }

  // --- Mentions ----------------------------------------------------------------------------------------

  insertMention(messageId: string, mentionedAgentId: string, token: string, startOffset: number | null, endOffset: number | null): void {
    this.db
      .query("INSERT INTO bw_message_mentions (id, message_id, mentioned_agent_id, start_offset, end_offset, mention_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("bwmen"), messageId, mentionedAgentId, startOffset, endOffset, token, nowIso());
  }

  mentionsForMessage(messageId: string): Array<{ mentionedAgentId: string; token: string }> {
    return (this.db.query("SELECT mentioned_agent_id, mention_token FROM bw_message_mentions WHERE message_id = ?").all(messageId) as Array<Record<string, unknown>>).map((row) => ({
      mentionedAgentId: String(row.mentioned_agent_id),
      token: String(row.mention_token),
    }));
  }

  // --- Drafts --------------------------------------------------------------------------------------------

  saveDraft(draft: Omit<BwDraft, "updatedAt">): BwDraft {
    const existing = this.db.query("SELECT id FROM bw_drafts WHERE conversation_id = ? AND owner_key = ?").get(draft.conversationId, draft.ownerKey) as Record<string, unknown> | null;
    if (existing) {
      this.db
        .query("UPDATE bw_drafts SET content_json = ?, selected_agent_ids_json = ?, attachment_refs_json = ?, updated_at = ? WHERE id = ?")
        .run(draft.contentJson, JSON.stringify(draft.selectedAgentIds), JSON.stringify(draft.attachmentRefs), nowIso(), String(existing.id));
    } else {
      this.db
        .query("INSERT INTO bw_drafts (id, conversation_id, owner_key, content_json, selected_agent_ids_json, attachment_refs_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("bwd"), draft.conversationId, draft.ownerKey, draft.contentJson, JSON.stringify(draft.selectedAgentIds), JSON.stringify(draft.attachmentRefs), nowIso());
    }
    return this.getDraft(draft.conversationId, draft.ownerKey) as BwDraft;
  }

  getDraft(conversationId: string, ownerKey: string): BwDraft | null {
    const row = this.db.query("SELECT * FROM bw_drafts WHERE conversation_id = ? AND owner_key = ?").get(conversationId, ownerKey) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      conversationId: String(row.conversation_id),
      ownerKey: String(row.owner_key),
      contentJson: String(row.content_json),
      selectedAgentIds: JSON.parse(String(row.selected_agent_ids_json)) as string[],
      attachmentRefs: JSON.parse(String(row.attachment_refs_json)) as string[],
      updatedAt: String(row.updated_at),
    };
  }

  // --- Provider / runtime bindings ----------------------------------------------------------------------------

  insertProviderBinding(binding: Omit<BwProviderBinding, "id" | "createdAt" | "updatedAt" | "lastHealthcheckAt">): BwProviderBinding {
    const id = shortId("bwp");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_provider_bindings (id, workspace_id, provider_type, name, endpoint, model, credential_ref, settings_json, status, last_healthcheck_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, binding.workspaceId, binding.providerType, binding.name, binding.endpoint, binding.model, binding.credentialRef, binding.settingsJson, binding.status, null, now, now);
    return this.getProviderBinding(id) as BwProviderBinding;
  }

  getProviderBinding(id: string): BwProviderBinding | null {
    const row = this.db.query("SELECT * FROM bw_provider_bindings WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapProviderBinding(row) : null;
  }

  listProviderBindings(workspaceId: string): BwProviderBinding[] {
    return (this.db.query("SELECT * FROM bw_provider_bindings WHERE workspace_id = ? ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>).map(mapProviderBinding);
  }

  updateProviderBindingStatus(id: string, status: BwProviderBinding["status"]): void {
    this.db.query("UPDATE bw_provider_bindings SET status = ?, last_healthcheck_at = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), nowIso(), id);
  }

  insertRuntimeBinding(binding: Omit<BwRuntimeBinding, "id" | "createdAt" | "updatedAt">): BwRuntimeBinding {
    const id = shortId("bwr");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_runtime_bindings (id, workspace_id, runtime_type, name, config_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, binding.workspaceId, binding.runtimeType, binding.name, binding.configJson, binding.status, now, now);
    return this.getRuntimeBinding(id) as BwRuntimeBinding;
  }

  getRuntimeBinding(id: string): BwRuntimeBinding | null {
    const row = this.db.query("SELECT * FROM bw_runtime_bindings WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRuntimeBinding(row) : null;
  }

  listRuntimeBindings(workspaceId: string): BwRuntimeBinding[] {
    return (this.db.query("SELECT * FROM bw_runtime_bindings WHERE workspace_id = ? ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>).map(mapRuntimeBinding);
  }
}

// --- mappers ------------------------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value);
}
function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : value == null ? fallback : Number(value);
}
function bool(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

function mapWorkspace(row: Record<string, unknown>): BwWorkspace {
  return { id: String(row.id), name: String(row.name), slug: String(row.slug), description: str(row.description), status: String(row.status) as BwWorkspace["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapAgent(row: Record<string, unknown>): BwAgent {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), name: String(row.name), slug: String(row.slug),
    avatarRef: str(row.avatar_ref), description: str(row.description),
    role: String(row.role) as WorkspaceAgentRole,
    systemInstructions: str(row.system_instructions),
    status: String(row.status) as BwAgent["status"],
    visibility: String(row.visibility) as BwAgent["visibility"],
    providerBindingId: str(row.provider_binding_id), runtimeBindingId: str(row.runtime_binding_id),
    defaultModel: str(row.default_model),
    contextPolicyJson: String(row.context_policy_json ?? "{}"),
    capabilityPolicyJson: String(row.capability_policy_json ?? "{}"),
    approvalPolicyJson: String(row.approval_policy_json ?? "{}"),
    metadataJson: String(row.metadata_json ?? "{}"),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapTeam(row: Record<string, unknown>): BwTeam {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), name: String(row.name), slug: String(row.slug),
    description: str(row.description), leadAgentId: str(row.lead_agent_id),
    orchestrationMode: String(row.orchestration_mode) as BwTeam["orchestrationMode"],
    defaultRecipientOrderJson: String(row.default_recipient_order_json ?? "[]"),
    status: String(row.status) as BwTeam["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapMember(row: Record<string, unknown>): BwTeamMember {
  return {
    id: String(row.id), teamId: String(row.team_id), agentId: String(row.agent_id),
    position: numOr(row.position, 0), roleInTeam: str(row.role_in_team),
    isRequired: bool(row.is_required), canDelegate: bool(row.can_delegate), createdAt: String(row.created_at),
  };
}

function mapConversation(row: Record<string, unknown>): BwConversation {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id),
    kind: String(row.kind) as BwConversation["kind"],
    agentId: str(row.agent_id), teamId: str(row.team_id), title: str(row.title),
    status: String(row.status) as BwConversation["status"],
    lastMessageAt: str(row.last_message_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): BwMessage {
  const contentJson = String(row.content_json);
  return {
    id: String(row.id), conversationId: String(row.conversation_id),
    senderType: String(row.sender_type) as BwMessage["senderType"],
    senderId: str(row.sender_id),
    role: String(row.role) as BwMessage["role"],
    contentJson,
    blocks: jsonToBlocks(contentJson),
    replyToMessageId: str(row.reply_to_message_id),
    parentExecutionId: str(row.parent_execution_id),
    clientMessageId: str(row.client_message_id),
    status: String(row.status) as BwMessage["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapProviderBinding(row: Record<string, unknown>): BwProviderBinding {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id),
    providerType: String(row.provider_type) as BwProviderBinding["providerType"],
    name: String(row.name), endpoint: str(row.endpoint), model: str(row.model),
    credentialRef: str(row.credential_ref),
    settingsJson: String(row.settings_json ?? "{}"),
    status: String(row.status) as BwProviderBinding["status"],
    lastHealthcheckAt: str(row.last_healthcheck_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapRuntimeBinding(row: Record<string, unknown>): BwRuntimeBinding {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id),
    runtimeType: String(row.runtime_type) as BwRuntimeBinding["runtimeType"],
    name: String(row.name), configJson: String(row.config_json ?? "{}"),
    status: String(row.status) as BwRuntimeBinding["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
