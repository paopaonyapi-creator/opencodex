// Phase 20.99 — Whip database store over whip_* SQLite tables.
// Follows strict parameterized SQL syntax with single-line statements and ? placeholders.

import { openAgentOsDb } from "../db";
import { canonicalJson } from "../agent-runtime/hash";
import type {
  KeyTrustStatus,
  QueuedIntent,
  QueuedIntentState,
  RemoteFileEntry,
  RemoteGitStatus,
  TranscriptTurn,
  TrustedHostKey,
  WhipApprovalRequest,
  WhipApprovalStatus,
  WhipAuditEvent,
  WhipDevice,
  WhipHost,
  WhipRiskClass,
  WhipTerminalSession,
  WhipTranscript,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newWhipId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class WhipStore {
  // -------------------------------------------------------------------------
  // Hosts
  // -------------------------------------------------------------------------

  insertHost(host: WhipHost): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_hosts (id, display_name, host, port, username, credential_ref, jump_route_json, tailscale_ip, status, runtime_generation, last_connected_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        host.id,
        host.displayName,
        host.host,
        host.port,
        host.username,
        host.credentialRef,
        JSON.stringify(host.jumpRoute),
        host.tailscaleIp,
        host.status,
        host.runtimeGeneration,
        host.lastConnectedAt,
        host.createdAt,
        host.updatedAt,
      );
  }

  getHost(id: string): WhipHost | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM whip_hosts WHERE id = ?")
      .get(id) as
      | {
          id: string;
          display_name: string;
          host: string;
          port: number;
          username: string;
          credential_ref: string | null;
          jump_route_json: string;
          tailscale_ip: string | null;
          status: string;
          runtime_generation: number;
          last_connected_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      displayName: r.display_name,
      host: r.host,
      port: r.port,
      username: r.username,
      credentialRef: r.credential_ref,
      jumpRoute: JSON.parse(r.jump_route_json || "[]"),
      tailscaleIp: r.tailscale_ip,
      status: r.status as WhipHost["status"],
      runtimeGeneration: r.runtime_generation,
      lastConnectedAt: r.last_connected_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listHosts(): WhipHost[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM whip_hosts ORDER BY updated_at DESC")
      .all() as Array<{
      id: string;
      display_name: string;
      host: string;
      port: number;
      username: string;
      credential_ref: string | null;
      jump_route_json: string;
      tailscale_ip: string | null;
      status: string;
      runtime_generation: number;
      last_connected_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      host: r.host,
      port: r.port,
      username: r.username,
      credentialRef: r.credential_ref,
      jumpRoute: JSON.parse(r.jump_route_json || "[]"),
      tailscaleIp: r.tailscale_ip,
      status: r.status as WhipHost["status"],
      runtimeGeneration: r.runtime_generation,
      lastConnectedAt: r.last_connected_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateHostStatus(id: string, status: WhipHost["status"], incrementGeneration = false): WhipHost | null {
    const cur = this.getHost(id);
    if (!cur) return null;
    const nextGen = cur.runtimeGeneration + (incrementGeneration ? 1 : 0);
    const now = nowIso();
    openAgentOsDb()
      .query(
        "UPDATE whip_hosts SET status = ?, runtime_generation = ?, last_connected_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, nextGen, now, now, id);
    return this.getHost(id);
  }

  // -------------------------------------------------------------------------
  // Host Keys & Strict Trust (§2.5, §17)
  // -------------------------------------------------------------------------

  upsertTrustedKey(key: TrustedHostKey): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_trusted_keys (id, host_id, hop_index, algorithm, fingerprint_sha256, trust_status, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(host_id, hop_index, fingerprint_sha256) DO UPDATE SET trust_status = excluded.trust_status, approved_at = excluded.approved_at, approved_by = excluded.approved_by",
      )
      .run(
        key.id,
        key.hostId,
        key.hopIndex,
        key.algorithm,
        key.fingerprintSha256,
        key.trustStatus,
        key.approvedAt,
        key.approvedBy,
      );
  }

  getTrustedKeys(hostId: string): TrustedHostKey[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM whip_trusted_keys WHERE host_id = ? ORDER BY hop_index ASC")
      .all(hostId) as Array<{
      id: string;
      host_id: string;
      hop_index: number;
      algorithm: string;
      fingerprint_sha256: string;
      trust_status: string;
      approved_at: string;
      approved_by: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      hostId: r.host_id,
      hopIndex: r.hop_index,
      algorithm: r.algorithm,
      fingerprintSha256: r.fingerprint_sha256,
      trustStatus: r.trust_status as KeyTrustStatus,
      approvedAt: r.approved_at,
      approvedBy: r.approved_by,
    }));
  }

  // -------------------------------------------------------------------------
  // Devices & Pairing (§15, §16)
  // -------------------------------------------------------------------------

  insertDevice(dev: WhipDevice): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_devices (id, label, public_key, platform, device_model_hint, biometric_enabled, status, policy_scope_json, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        dev.id,
        dev.label,
        dev.publicKey,
        dev.platform,
        dev.deviceModelHint,
        dev.biometricEnabled ? 1 : 0,
        dev.status,
        JSON.stringify(dev.policyScope),
        dev.createdAt,
        dev.lastSeenAt,
        dev.revokedAt,
      );
  }

  getDevice(id: string): WhipDevice | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM whip_devices WHERE id = ?")
      .get(id) as
      | {
          id: string;
          label: string;
          public_key: string;
          platform: string;
          device_model_hint: string | null;
          biometric_enabled: number;
          status: string;
          policy_scope_json: string;
          created_at: string;
          last_seen_at: string | null;
          revoked_at: string | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      label: r.label,
      publicKey: r.public_key,
      platform: r.platform as WhipDevice["platform"],
      deviceModelHint: r.device_model_hint,
      biometricEnabled: r.biometric_enabled === 1,
      status: r.status as WhipDevice["status"],
      policyScope: JSON.parse(r.policy_scope_json || "[]"),
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      revokedAt: r.revoked_at,
    };
  }

  revokeDevice(id: string): void {
    openAgentOsDb()
      .query("UPDATE whip_devices SET status = 'revoked', revoked_at = ? WHERE id = ?")
      .run(nowIso(), id);
  }

  insertPairingSession(sess: {
    id: string;
    pairingCode: string;
    verificationPhrase: string;
    hostHint: string;
    port: number;
    ephemeralPublicKey: string;
    nonce: string;
    createdAt: string;
    expiresAt: string;
  }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_pairing_sessions (id, pairing_code, verification_phrase, host_hint, port, ephemeral_public_key, nonce, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      )
      .run(
        sess.id,
        sess.pairingCode,
        sess.verificationPhrase,
        sess.hostHint,
        sess.port,
        sess.ephemeralPublicKey,
        sess.nonce,
        sess.createdAt,
        sess.expiresAt,
      );
  }

  getPairingSession(code: string): {
    id: string;
    pairingCode: string;
    verificationPhrase: string;
    hostHint: string;
    port: number;
    ephemeralPublicKey: string;
    nonce: string;
    state: string;
    createdAt: string;
    expiresAt: string;
  } | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM whip_pairing_sessions WHERE pairing_code = ?")
      .get(code) as any;
    if (!r) return null;
    return {
      id: r.id,
      pairingCode: r.pairing_code,
      verificationPhrase: r.verification_phrase,
      hostHint: r.host_hint,
      port: r.port,
      ephemeralPublicKey: r.ephemeral_public_key,
      nonce: r.nonce,
      state: r.state,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }

  markPairingCompleted(id: string): void {
    openAgentOsDb().query("UPDATE whip_pairing_sessions SET state = 'paired' WHERE id = ?").run(id);
  }

  // -------------------------------------------------------------------------
  // Transcripts (§10)
  // -------------------------------------------------------------------------

  upsertTranscript(transcript: WhipTranscript): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_transcripts (id, agent_id, session_id, runtime, revision, source_state, turns_json, checkpoint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id, session_id) DO UPDATE SET revision = excluded.revision, source_state = excluded.source_state, turns_json = excluded.turns_json, checkpoint = excluded.checkpoint, updated_at = excluded.updated_at",
      )
      .run(
        transcript.id,
        transcript.agentId,
        transcript.sessionId,
        transcript.runtime,
        transcript.revision,
        transcript.sourceState,
        JSON.stringify(transcript.turns),
        transcript.checkpoint,
        transcript.updatedAt,
      );
  }

  getTranscript(agentId: string, sessionId: string): WhipTranscript | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM whip_transcripts WHERE agent_id = ? AND session_id = ?")
      .get(agentId, sessionId) as any;
    if (!r) return null;
    return {
      id: r.id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      runtime: r.runtime,
      revision: r.revision,
      sourceState: r.source_state,
      turns: JSON.parse(r.turns_json || "[]"),
      checkpoint: r.checkpoint,
      updatedAt: r.updated_at,
    };
  }

  // -------------------------------------------------------------------------
  // Terminals (§11)
  // -------------------------------------------------------------------------

  insertTerminal(term: WhipTerminalSession): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_terminals (id, host_id, agent_id, session_id, pane_id, cwd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        term.id,
        term.hostId,
        term.agentId ?? null,
        term.sessionId ?? null,
        term.paneId ?? null,
        term.cwd ?? null,
        term.status,
        term.createdAt,
        term.updatedAt,
      );
  }

  getTerminal(id: string): WhipTerminalSession | null {
    const r = openAgentOsDb().query("SELECT * FROM whip_terminals WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      hostId: r.host_id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      paneId: r.pane_id,
      cwd: r.cwd,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listTerminals(hostId?: string): WhipTerminalSession[] {
    const db = openAgentOsDb();
    const rows = (hostId
      ? db.query("SELECT * FROM whip_terminals WHERE host_id = ? ORDER BY created_at DESC").all(hostId)
      : db.query("SELECT * FROM whip_terminals ORDER BY created_at DESC").all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      hostId: r.host_id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      paneId: r.pane_id,
      cwd: r.cwd,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Offline Command Queue (§13)
  // -------------------------------------------------------------------------

  insertQueuedIntent(intent: QueuedIntent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_queued_intents (id, host_id, device_id, target_ref_json, semantic_action, payload_hash, encrypted_payload_ref, context_revision, risk_class, state, rejection_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        intent.id,
        intent.hostId,
        intent.deviceId,
        intent.targetRefJson,
        intent.semanticAction,
        intent.payloadHash,
        intent.encryptedPayloadRef,
        intent.contextRevision,
        intent.riskClass,
        intent.state,
        intent.rejectionReason ?? null,
        intent.createdAt,
        intent.updatedAt,
      );
  }

  getQueuedIntent(id: string): QueuedIntent | null {
    const r = openAgentOsDb().query("SELECT * FROM whip_queued_intents WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      hostId: r.host_id,
      deviceId: r.device_id,
      targetRefJson: r.target_ref_json,
      semanticAction: r.semantic_action,
      payloadHash: r.payload_hash,
      encryptedPayloadRef: r.encrypted_payload_ref,
      contextRevision: r.context_revision,
      riskClass: r.risk_class,
      state: r.state,
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listQueuedIntents(filter?: { hostId?: string; state?: QueuedIntentState }): QueuedIntent[] {
    const db = openAgentOsDb();
    let rows: any[];
    if (filter?.hostId && filter?.state) {
      rows = db
        .query("SELECT * FROM whip_queued_intents WHERE host_id = ? AND state = ? ORDER BY created_at ASC")
        .all(filter.hostId, filter.state);
    } else if (filter?.hostId) {
      rows = db
        .query("SELECT * FROM whip_queued_intents WHERE host_id = ? ORDER BY created_at ASC")
        .all(filter.hostId);
    } else if (filter?.state) {
      rows = db.query("SELECT * FROM whip_queued_intents WHERE state = ? ORDER BY created_at ASC").all(filter.state);
    } else {
      rows = db.query("SELECT * FROM whip_queued_intents ORDER BY created_at ASC").all();
    }
    return rows.map((r) => ({
      id: r.id,
      hostId: r.host_id,
      deviceId: r.device_id,
      targetRefJson: r.target_ref_json,
      semanticAction: r.semantic_action,
      payloadHash: r.payload_hash,
      encryptedPayloadRef: r.encrypted_payload_ref,
      contextRevision: r.context_revision,
      riskClass: r.risk_class,
      state: r.state,
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateQueuedIntentState(id: string, state: QueuedIntentState, rejectionReason?: string | null): void {
    openAgentOsDb()
      .query(
        "UPDATE whip_queued_intents SET state = ?, rejection_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(state, rejectionReason ?? null, nowIso(), id);
  }

  // -------------------------------------------------------------------------
  // Approvals (§14)
  // -------------------------------------------------------------------------

  insertApproval(appr: WhipApprovalRequest): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_approvals (id, host_id, device_id, agent_id, session_id, action, target, human_summary, exact_payload_hash, risk, status, biometric_verified, policy_version, expires_at, decided_by, decided_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        appr.id,
        appr.hostId,
        appr.deviceId,
        appr.agentId ?? null,
        appr.sessionId ?? null,
        appr.action,
        appr.target,
        appr.humanSummary,
        appr.exactPayloadHash,
        appr.risk,
        appr.status,
        appr.biometricVerified ? 1 : 0,
        appr.policyVersion,
        appr.expiresAt,
        appr.decidedBy ?? null,
        appr.decidedAt ?? null,
        appr.reason ?? null,
        appr.createdAt,
      );
  }

  getApproval(id: string): WhipApprovalRequest | null {
    const r = openAgentOsDb().query("SELECT * FROM whip_approvals WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      hostId: r.host_id,
      deviceId: r.device_id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      action: r.action,
      target: r.target,
      humanSummary: r.human_summary,
      exactPayloadHash: r.exact_payload_hash,
      risk: r.risk,
      status: r.status,
      biometricVerified: r.biometric_verified === 1,
      policyVersion: r.policy_version,
      expiresAt: r.expires_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      reason: r.reason,
      createdAt: r.created_at,
    };
  }

  listApprovals(status?: WhipApprovalStatus): WhipApprovalRequest[] {
    const db = openAgentOsDb();
    const rows = (status
      ? db.query("SELECT * FROM whip_approvals WHERE status = ? ORDER BY created_at DESC").all(status)
      : db.query("SELECT * FROM whip_approvals ORDER BY created_at DESC").all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      hostId: r.host_id,
      deviceId: r.device_id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      action: r.action,
      target: r.target,
      humanSummary: r.human_summary,
      exactPayloadHash: r.exact_payload_hash,
      risk: r.risk,
      status: r.status,
      biometricVerified: r.biometric_verified === 1,
      policyVersion: r.policy_version,
      expiresAt: r.expires_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  decideApproval(
    id: string,
    decision: "approved" | "denied",
    decidedBy: string,
    reason?: string,
    biometric = false,
  ): WhipApprovalRequest | null {
    openAgentOsDb()
      .query(
        "UPDATE whip_approvals SET status = ?, decided_by = ?, decided_at = ?, reason = ?, biometric_verified = ? WHERE id = ? AND status = 'pending'",
      )
      .run(decision, decidedBy, nowIso(), reason ?? null, biometric ? 1 : 0, id);
    return this.getApproval(id);
  }

  // -------------------------------------------------------------------------
  // Audit Events (§28)
  // -------------------------------------------------------------------------

  appendAudit(event: WhipAuditEvent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO whip_audit_events (id, event_type, host_id, device_id, agent_id, session_id, action, risk, approval_id, policy_version, payload_hash, result, correlation_id, sanitized_payload_json, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.eventType,
        event.hostId,
        event.deviceId ?? null,
        event.agentId ?? null,
        event.sessionId ?? null,
        event.action,
        event.risk,
        event.approvalId ?? null,
        event.policyVersion ?? null,
        event.payloadHash ?? null,
        event.result,
        event.correlationId,
        canonicalJson(event.sanitizedPayload ?? {}),
        event.timestamp,
      );
  }

  listAuditEvents(filter?: { hostId?: string; correlationId?: string; limit?: number }): WhipAuditEvent[] {
    const limit = Math.min(200, Math.max(1, filter?.limit ?? 50));
    const db = openAgentOsDb();
    let rows: any[];
    if (filter?.correlationId) {
      rows = db
        .query("SELECT * FROM whip_audit_events WHERE correlation_id = ? ORDER BY timestamp DESC LIMIT ?")
        .all(filter.correlationId, limit);
    } else if (filter?.hostId) {
      rows = db
        .query("SELECT * FROM whip_audit_events WHERE host_id = ? ORDER BY timestamp DESC LIMIT ?")
        .all(filter.hostId, limit);
    } else {
      rows = db.query("SELECT * FROM whip_audit_events ORDER BY timestamp DESC LIMIT ?").all(limit);
    }
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      hostId: r.host_id,
      deviceId: r.device_id,
      agentId: r.agent_id,
      sessionId: r.session_id,
      action: r.action,
      risk: r.risk,
      approvalId: r.approval_id,
      policyVersion: r.policy_version,
      payloadHash: r.payload_hash,
      result: r.result,
      correlationId: r.correlation_id,
      sanitizedPayload: JSON.parse(r.sanitized_payload_json || "{}"),
      timestamp: r.timestamp,
    }));
  }
}
