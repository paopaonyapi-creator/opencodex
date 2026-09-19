// Agent OS core storage (Phases 02-16 subsystem).
//
// Local-first persistent store for the Agent OS roadmap: agent registry,
// durable task queue, permission policy, memory, skills, workflows, sessions,
// and the Brain Universe observatory. Lives under the existing OPENCODEX_HOME
// config dir like every other opencodex/PaohupByPaoZa ledger — no new process,
// no external database. Derived indexes are rebuildable; this file is the only
// source of truth for Agent OS metadata.

import { Database } from "bun:sqlite";
import { getConfigDir } from "../config";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// v30: media_jobs, media_artifacts, media_sources, media_events, media_provider_health,
// media_permissions, media_presets, media_secret_references
// (Phase 20.24 Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine).
// v31: registry_tools, registry_tool_health, registry_runs, registry_run_steps,
// registry_approvals, registry_audit_events, registry_preferences
// (Phase 20.25 Pao-hubPro × Agentic AI Universal Registry & Toolchain).
// v32: douyin_creators, douyin_media_items, douyin_search_snapshots,
// douyin_hot_board_snapshots, douyin_comments, douyin_transcripts,
// douyin_sessions, douyin_idempotency
// (Phase 20.26 Pao-hubPro × Douyin Media Intelligence & Downloader Engine).
// v29: notification_events, notification_destinations, notification_subscriptions,
// notification_deliveries, notification_attempts, notification_rate_limit_states,
// notification_provider_gates, notification_circuits, notification_aggregations,
// notification_dead_letters, notification_invalid_requests, notification_audit_events
// (Phase 20.23 Pao-hubPro Unified Notification Gateway).
// v26: social_providers, social_tools, social_registry_refreshes, social_research_jobs,
// social_provider_runs, social_usage_records, social_normalized_items,
// social_trend_signals, social_opportunities, social_audit_events
// (Phase 20.20 Pao-hubPro Social Intelligence Engine × Social Media Scraping API Router).
// v25: mobile_devices, mobile_tasks, mobile_task_events, mobile_artifacts, mobile_policy_decisions
// (Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway).
// v24: stock_autonomous_pipeline_runs (End-to-End Autonomous Stock Production & Submission Pipeline).
// v23: browser_remote_workers, browser_remote_job_dispatches
// (Phase 20.14 Pao-hubPro Browser Remote Worker & Cloud VM Fleet).
// v22: browser_multi_agent_missions, browser_agent_dispatches, browser_web_handshakes,
// browser_qa_evaluations (Phase 20.13 Pao-hubPro Browser Multi-Agent Web Operations).
// v21: browser_workflows, browser_workflow_runs, browser_step_logs, browser_task_memories
// (Phase 20.12 Pao-hubPro Browser Workflow Intelligence).
// v20: browser_action_logs, browser_sessions, browser_tabs, browser_downloads,
// browser_approvals (Phase 20.11 Pao-hubPro Browser — Agent-Native Runtime).
// v19: kg_documents, kg_sections, kg_phase_relations, kg_evidence_packs,
// kg_audit_events (Phase 21 Pao Knowledge Layer × Grounded Agent Gateway).
// v18: trend_research_jobs, trend_actor_registry, trend_actor_runs, trend_signals,
// trend_opportunity_scores, trend_stock_concepts, trend_usage_costs (Phase 20.10 Pao Trend Intelligence × Apify MCP × Adobe Stock Research Engine).
// v17: council_runs, council_parallelization_plans, council_agent_profiles,
// council_agent_runs, council_worktrees, council_task_leases, council_changesets,
// council_review_assignments, council_review_results, council_verification_bundles,
// council_conflict_cases, council_merge_candidates, council_integration_runs,
// council_decisions, council_resource_usage (Phase 20.4 Pao Autonomous Engineering Council).
// v16: stock_campaigns, stock_campaign_items, stock_qc_records, stock_portfolio_performance (Phase 21 Pao Stock Campaign Planner).
// v15: desktop_agent_runs, desktop_agent_events, desktop_agent_tool_calls,
// desktop_agent_approvals, desktop_agent_mcp_servers, desktop_agent_skills,
// desktop_agent_provider_configs, desktop_agent_policies (Phase 20.9 Pao-hubPro × Chatbox Agent Desktop Runtime).
// v14: agency_sources, agency_agents, agency_agent_versions, agency_team_presets,
// agency_runs, agency_subtasks, agency_agent_results, agency_reviews,
// agency_evidence (Phase 20.8 Pao-hubPro × Agency Agents Dynamic Specialist Router).
// v13: video_production_jobs, video_production_scenes, video_production_attempts,
// video_production_artifacts, video_technical_qc, video_reviewer_council,
// video_export_packages, video_provider_health (Phase 20.7 Pao AI Video Factory × MoneyPrinterTurbo).
// v12: h3_workflows, h3_presets, h3_models, h3_license_policies, h3_jobs,
// h3_candidates, h3_stock_qc, h3_provenance (Phase 20.6 Pao MiniMax H3 Image Studio).
// v11: knowledge_sources, source_versions, source_chunks, knowledge_entities,
// entity_aliases, knowledge_claims, claim_provenance, knowledge_relations,
// knowledge_decisions, contradiction_cases, wiki_pages, wiki_revisions,
// wiki_source_links, ingestion_runs, compilation_runs, query_evidence,
// index_generations (Phase 20.5 Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph).
// v10: desktop_sessions, desktop_goals, desktop_steps, desktop_actions,
// desktop_action_attempts, desktop_skill_runs, desktop_evidence, desktop_events,
// desktop_profiles, desktop_skill_versions, desktop_approvals,
// desktop_agent_heartbeats (Phase 20.3 Pao Desktop Vision Control MCP).
// v9: sdlc_cycles, sdlc_requirements, sdlc_acceptance_criteria, sdlc_clarifications,
// sdlc_adrs, sdlc_tasks, sdlc_gates, sdlc_reviews, sdlc_evidence, sdlc_approvals,
// sdlc_artifacts, sdlc_locks (Phase 20.2 Pao Spec-Driven AI SDLC Orchestrator).
// v8: gen_queue_snapshots, gen_batch_groups, gen_scale_plans,
// gen_queue_reconciliations, gen_dispatch_leases (Phase 20.1 Pao ComfyUI Smart Queue).
// v7: gen_compute_instances, gen_gpu_profiles, gen_placement_decisions,
// gen_cloud_leases, gen_runpod_pods, gen_runpod_billing, gen_execution_attempts,
// gen_price_observations (Phase 20 Pao Multi-GPU Generation Grid × RunPod Router).
// v6: gen_projects, gen_providers, gen_workflows, gen_models, gen_loras,
// gen_jobs, gen_job_events, gen_assets, gen_reviews, gen_stock_metadata,
// gen_export_packages, gen_audit_log (Phase 19 Pao AI Generation Studio).
// v5: seo_projects, seo_recommendations, seo_runs (Phase 18 Pao SEO Agent OS).
// v4: stock_opportunities, stock_concepts, stock_assets, stock_asset_lineage,
// stock_qc_reviews, stock_export_packs (Phase 16 Pao AI Media Factory).
// v3: brain_files persists latest scan snapshots for Atlas/Universe graphs.
// v2: brain_projects/brain_scans/brain_sessions/brain_session_events
// (Phase 15 Brain Universe), team_runs (Phase 10), remote_nodes (Phase 12),
// reviews (Phase 16 slice), write_permits (Phase 16 gateway). Databases created
// by v1 builds lack these tables; the v2-v4 migrations are additive (CREATE TABLE IF
// NOT EXISTS) and never touch prior data.
// v28: orchestration_runs, orchestration_events, orchestration_checkpoints,
// orchestration_approvals, orchestration_tool_calls, orchestration_mcp_servers
// (Phase 20.22 Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer).
// v27: codex_runtime_nodes, codex_runtime_sessions, codex_runtime_jobs,
// codex_runtime_events, codex_runtime_approvals, codex_runtime_audit_logs,
// codex_runtime_capabilities, codex_runtime_mcp_tools (Phase 20.21 Pao-hubPro x OpenAI Codex Native Runtime Integration).
// v26: social_tools, social_registry_refreshes, social_research_jobs,
// social_provider_runs, social_usage_records, social_normalized_items,
// social_trend_signals, social_opportunities, social_audit_events (Phase 20.20 Social Intelligence Engine).
// v33: speech_jobs, speech_artifacts, voice_profiles, voice_consents,
// model_licenses, speech_policy_checks, speech_runtime_health, speech_audit
// (Phase 20.32 VoiceStudio speech runtime).
// v34: lead_profiles, lead_contact_points, lead_social_profiles,
// lead_source_records, lead_field_evidence, lead_providers,
// lead_provider_health, lead_provider_usage, lead_jobs, lead_pipelines,
// lead_pipeline_runs, lead_suppression, lead_exports, lead_audit
// (Phase 20.34 Lead Intelligence Control Plane).
// v35: unified_providers, unified_provider_health, unified_route_executions,
// unified_workspace_grants, unified_audit (Phase 20.35 unified runtime control plane).
// v36: biz_opportunities, biz_opportunity_versions, biz_sources,
// biz_source_imports, biz_capability_registry, biz_compliance_checks,
// biz_cost_estimates, biz_mvp_specs, biz_experiments, biz_audit
// (Phase 30.36 Pao Business Builder).
// v37: orch_agents, orch_skills, orch_hook_policies, orch_runs,
// orch_tool_calls, orch_approvals, orch_worktrees, orch_memories,
// orch_audit_events (Phase 20.37 Agentic Development OS control plane).
// v38: dv_packages, dv_artifacts, dv_projects, dv_project_items, dv_bundles,
// dv_policy_decisions, dv_audit_events (Phase 20.38 Dependency Vault).
// v39: cc_workspaces, cc_providers, cc_provider_instances, cc_sessions,
// cc_session_events, cc_runs, cc_tool_executions, cc_context_refs,
// cc_approvals, cc_locks, cc_usage, cc_artifacts, cc_audit
// (Phase 20.39 Unified AI Coding Workspace cockpit).
// v40: observability_sessions, observability_events, observability_evidence,
// observability_process_evidence, observability_integrity_checks,
// observability_aliases, observability_alert_rules, observability_alert_events,
// observability_scan_cycles (Phase 20.40 Agent Observability Control Plane).
// v41: memory_workspaces, memory_projects, memory_agents, memories,
// memory_revisions, memory_tags, memory_tag_links, memory_chunks,
// memory_embeddings, memory_observations, memory_observation_sources,
// memory_supersession_links, memory_search_traces, memory_search_trace_results,
// memory_mutation_previews, memory_idempotency_keys, memory_oauth_clients,
// memory_oauth_authorization_codes, memory_oauth_access_tokens,
// memory_oauth_refresh_tokens, memory_oauth_consents
// (Phase 20.41 Trustworthy MCP Memory Plane).
// v42: bw_workspaces, bw_agents, bw_teams, bw_team_members, bw_conversations,
// bw_messages, bw_message_mentions, bw_drafts, bw_provider_bindings,
// bw_runtime_bindings, bw_group_rounds, bw_agent_executions,
// bw_execution_events, bw_approvals, bw_routines, bw_routine_runs,
// bw_audit_events (Phase 20.42 Named AI Teammate Workspace).
// v43: memory_engram_registry, memory_episode_registry, memory_feedback,
// memory_policy_rules, memory_sync_profiles, memory_sync_runs,
// memory_injection_receipts, memory_agent_adapters, memory_approvals,
// memory_conflicts, memory_audit_events (Phase 20.43 PLUR Shared Agent
// Memory Runtime control plane).
// v44: ap_* agent platform (Phase 20.54).
// v45: mobile leases/approvals/traces (Phase 20.55).
// v46: cap_* Micro-App Capability Lab (Phase 20.56).
// v47: sg_* Skill Gate control plane (Phase 20.57).
// v52: cr_* Deterministic Code Review (Phase 20.81).
// v53: cr_sessions parent/revision lineage.
// v54: gw_* Model Gateway (Phase 20.85 OmniRoute), dec_* Decision Runtime (Phase 20.84 TypeSafe Jev) & core_* Durable Persistence.
// v55: sm_* Sensorimotor runtime (Phase 20.82 CortexKit AFT) — perception snapshots, actions, checkpoints.
export const AGENT_OS_SCHEMA_VERSION = 66;

let dbHandle: Database | null = null;
let dbFile = "";

export function agentOsDbPath(dir = getConfigDir()): string {
  return join(dir, "agent-os.sqlite3");
}

/** Open (and lazily migrate) the Agent OS store. One handle per process. */
export function openAgentOsDb(dir = getConfigDir()): Database {
  if (dbHandle) return dbHandle;
  const path = agentOsDbPath(dir);
  mkdirSync(dir, { recursive: true });
  dbHandle = new Database(path, { create: true });
  dbHandle.exec("PRAGMA journal_mode = WAL;");
  dbHandle.exec("PRAGMA foreign_keys = ON;");
  migrate(dbHandle);
  dbHandle.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  dbFile = path;
  return dbHandle;
}

/** Test seam: close and forget the cached handle. */
export function closeAgentOsDbForTests(): void {
  dbHandle?.close();
  dbHandle = null;
  dbFile = "";
}

export function agentOsDbFile(): string {
  return dbFile;
}

function migrate(db: Database): void {
  const current = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
    .get() as { name: string } | undefined;
  let storedVersion = 0;
  if (current) {
    const row = db.query("SELECT value FROM schema_meta WHERE key = 'version'").get() as
      | { value: string }
      | undefined;
    storedVersion = Number(row?.value ?? 0);
  }
  if (storedVersion > AGENT_OS_SCHEMA_VERSION) {
    throw new Error(
      `agent-os.sqlite3 schema version ${storedVersion} is newer than this build supports (${AGENT_OS_SCHEMA_VERSION})`,
    );
  }
  if (storedVersion === AGENT_OS_SCHEMA_VERSION) return;

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Phase 02: Agent Registry -------------------------------------------
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'generalist',
        enabled INTEGER NOT NULL DEFAULT 1,
        permissions_json TEXT NOT NULL DEFAULT '{}',
        health TEXT NOT NULL DEFAULT 'unknown',
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Phase 04: Persistent Task Queue ------------------------------------
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_after_ms INTEGER NOT NULL DEFAULT 0,
        heartbeat_ms INTEGER,
        created_ms INTEGER NOT NULL,
        updated_ms INTEGER NOT NULL,
        result_json TEXT,
        error_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status_runafter ON tasks(status, run_after_ms);

      -- Phase 05: Sandbox / permission policy ------------------------------
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,             -- 'agent' | 'task' | 'global'
        subject_id TEXT,                        -- agent id, task id, or NULL for global
        capability TEXT NOT NULL,               -- e.g. 'fs.read', 'net.fetch', 'shell.exec'
        effect TEXT NOT NULL,                   -- 'allow' | 'deny'
        scope_json TEXT NOT NULL DEFAULT '{}',  -- path prefixes, host allowlists
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_policies_subject ON policies(subject_type, subject_id, capability);

      -- Phase 05: approval ledger (fail-closed, human in the loop) ----------
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending|granted|denied|expired
        requested_ms INTEGER NOT NULL,
        decided_ms INTEGER,
        decided_by TEXT
      );

      -- Phase 07: Memory OS --------------------------------------------------
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,                    -- global|project|agent|decision|failure
        subject_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Phase 08: Skill Store ------------------------------------------------
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '0',
        path TEXT,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',  -- active|deprecated|missing
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      -- Phase 09: Workflow Engine --------------------------------------------
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running',
        state_json TEXT NOT NULL DEFAULT '{}',
        created_ms INTEGER NOT NULL,
        updated_ms INTEGER NOT NULL
      );

      -- Phase 11: Observability (agent-side events; proxy traffic has its own ledgers)
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        task_id TEXT,
        agent_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_agent_events_task ON agent_events(task_id, ts_ms);

      -- Phase 10: Team runs (bounded-parallel children) ----------------------
      CREATE TABLE IF NOT EXISTS team_runs (
        id TEXT PRIMARY KEY,
        team_name TEXT NOT NULL,
        max_parallel INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        task_ids_json TEXT NOT NULL DEFAULT '{}',
        created_ms INTEGER NOT NULL
      );

      -- Phase 12: Remote execution nodes -------------------------------------
      CREATE TABLE IF NOT EXISTS remote_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        max_parallel INTEGER NOT NULL DEFAULT 1,
        last_heartbeat_ms INTEGER NOT NULL
      );

      -- Phase 16 (read-only part): Reviewer Council results ------------------
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        verdict TEXT NOT NULL,
        score INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_subject ON reviews(subject_kind, subject_id);

      -- Phase 15 (Brain Universe): project registry + scans ------------------
      CREATE TABLE IF NOT EXISTS brain_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        scan_enabled INTEGER NOT NULL DEFAULT 1,
        scan_mode TEXT NOT NULL DEFAULT 'standard'
      );
      CREATE TABLE IF NOT EXISTS brain_scans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES brain_projects(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS brain_files (
        scan_id TEXT NOT NULL REFERENCES brain_scans(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES brain_projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        disposition TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        extension TEXT,
        modified_ms INTEGER NOT NULL,
        PRIMARY KEY (scan_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_brain_files_project_scan ON brain_files(project_id, scan_id);
      CREATE TABLE IF NOT EXISTS brain_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        agent_id TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        started_at TEXT,
        ended_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS brain_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES brain_sessions(id) ON DELETE CASCADE,
        ts_ms INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_brain_events_session ON brain_session_events(session_id, ts_ms);

      -- Phase 16: SHA-bound single-use write permits --------------------------
      CREATE TABLE IF NOT EXISTS write_permits (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        token_digest TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'issued'
      );
      CREATE INDEX IF NOT EXISTS idx_write_permits_digest ON write_permits(token_digest);
      -- Phase 16: Pao AI Media Factory (Stock Domain Tables) -----------------
      CREATE TABLE IF NOT EXISTS stock_opportunities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        niche TEXT NOT NULL,
        buyer_persona TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        confidence INTEGER NOT NULL DEFAULT 0,
        evidence_class TEXT NOT NULL DEFAULT 'I',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_opportunities_project ON stock_opportunities(project_id);

      CREATE TABLE IF NOT EXISTS stock_concepts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        opportunity_id TEXT REFERENCES stock_opportunities(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        commercial_use_case TEXT NOT NULL,
        copy_space TEXT NOT NULL,
        differentiation TEXT NOT NULL,
        production_mode TEXT NOT NULL DEFAULT 'stock_image',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_concepts_project ON stock_concepts(project_id);

      CREATE TABLE IF NOT EXISTS stock_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        concept_id TEXT REFERENCES stock_concepts(id) ON DELETE SET NULL,
        batch_id TEXT,
        type TEXT NOT NULL,                     -- 'image' | 'png' | 'video'
        mode TEXT NOT NULL,                     -- 'stock_image' | 'stock_png' | 'stock_video'
        status TEXT NOT NULL DEFAULT 'DRAFT',
        path TEXT NOT NULL,
        preview_path TEXT,
        width INTEGER,
        height INTEGER,
        megapixels REAL,
        duration_seconds REAL,
        fps REAL,
        codec TEXT,
        provider TEXT,
        model TEXT,
        prompt_json TEXT NOT NULL DEFAULT '{}',
        generated_ai INTEGER NOT NULL DEFAULT 1,
        fictional_people_property INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_assets_project_status ON stock_assets(project_id, status);

      CREATE TABLE IF NOT EXISTS stock_asset_lineage (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES stock_assets(id) ON DELETE CASCADE,
        parent_asset_id TEXT REFERENCES stock_assets(id) ON DELETE SET NULL,
        step TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_lineage_asset ON stock_asset_lineage(asset_id);

      CREATE TABLE IF NOT EXISTS stock_qc_reviews (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES stock_assets(id) ON DELETE CASCADE,
        reviewer TEXT NOT NULL,
        verdict TEXT NOT NULL,                  -- 'pass' | 'warn' | 'fail'
        score INTEGER,
        report_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_qc_asset ON stock_qc_reviews(asset_id);

      CREATE TABLE IF NOT EXISTS stock_export_packs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        batch_id TEXT,
        status TEXT NOT NULL DEFAULT 'ready',   -- 'pending' | 'ready' | 'exported'
        manifest_json TEXT NOT NULL DEFAULT '{}',
        package_path TEXT,
        human_review_required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_exports_project ON stock_export_packs(project_id);

      -- Phase 18: SEO Agent OS ---------------------------------------------
      CREATE TABLE IF NOT EXISTS seo_projects (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        display_name TEXT,
        country TEXT,
        language TEXT,
        business_type TEXT,
        business_description TEXT,
        goals_json TEXT NOT NULL DEFAULT '[]',
        primary_topics_json TEXT NOT NULL DEFAULT '[]',
        seed_keywords_json TEXT NOT NULL DEFAULT '[]',
        competitors_json TEXT NOT NULL DEFAULT '[]',
        key_pages_json TEXT NOT NULL DEFAULT '[]',
        brand_terms_json TEXT NOT NULL DEFAULT '[]',
        negative_keywords_json TEXT NOT NULL DEFAULT '[]',
        policy_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_seo_projects_domain ON seo_projects(domain);

      CREATE TABLE IF NOT EXISTS seo_recommendations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
        area TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        impact TEXT NOT NULL DEFAULT 'medium',
        effort TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_seo_recs_project ON seo_recommendations(project_id, status);

      CREATE TABLE IF NOT EXISTS seo_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'succeeded',
        provider TEXT NOT NULL DEFAULT 'mock',
        provenance TEXT NOT NULL DEFAULT 'mock',
        result_json TEXT NOT NULL DEFAULT '{}',
        error_json TEXT,
        started_ms INTEGER NOT NULL,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_seo_runs_project ON seo_runs(project_id, started_ms);

      -- Phase 19: Pao AI Generation Studio ---------------------------------
      CREATE TABLE IF NOT EXISTS gen_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'general',
        default_workflow TEXT,
        default_model TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comfyui',
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 5,
        max_concurrency INTEGER NOT NULL DEFAULT 1,
        timeout_seconds INTEGER NOT NULL DEFAULT 600,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        health_status TEXT NOT NULL DEFAULT 'unknown',
        last_health_check_ms INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_workflows (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'comfyui',
        workflow_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'disabled',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        bindings_json TEXT NOT NULL DEFAULT '{}',
        output_nodes_json TEXT NOT NULL DEFAULT '[]',
        required_inputs_json TEXT NOT NULL DEFAULT '[]',
        optional_inputs_json TEXT NOT NULL DEFAULT '[]',
        parameter_schema_json TEXT NOT NULL DEFAULT '{}',
        model_requirements_json TEXT NOT NULL DEFAULT '{}',
        min_vram_gb REAL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE TABLE IF NOT EXISTS gen_models (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        family TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'checkpoint',
        checkpoint_name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'comfyui',
        min_vram_gb REAL,
        recommended_vram_gb REAL,
        license_notes TEXT NOT NULL DEFAULT '',
        commercial_use_notes TEXT NOT NULL DEFAULT 'unverified',
        enabled INTEGER NOT NULL DEFAULT 1,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_loras (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        base_model_family TEXT NOT NULL,
        trigger_words_json TEXT NOT NULL DEFAULT '[]',
        default_strength REAL NOT NULL DEFAULT 0.8,
        min_strength REAL NOT NULL DEFAULT 0,
        max_strength REAL NOT NULL DEFAULT 1.5,
        commercial_use_notes TEXT NOT NULL DEFAULT 'unverified',
        enabled INTEGER NOT NULL DEFAULT 1,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_jobs (
        id TEXT PRIMARY KEY,
        parent_job_id TEXT REFERENCES gen_jobs(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES gen_projects(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL DEFAULT 'local',
        idempotency_key TEXT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        priority INTEGER NOT NULL DEFAULT 5,
        provider_id TEXT,
        workflow_id TEXT,
        workflow_version INTEGER,
        model_id TEXT,
        prompt TEXT NOT NULL DEFAULT '',
        negative_prompt TEXT NOT NULL DEFAULT '',
        seed INTEGER NOT NULL DEFAULT -1,
        resolved_seed INTEGER,
        width INTEGER NOT NULL DEFAULT 1024,
        height INTEGER NOT NULL DEFAULT 1024,
        batch_size INTEGER NOT NULL DEFAULT 1,
        input_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        loras_json TEXT NOT NULL DEFAULT '[]',
        parameters_json TEXT NOT NULL DEFAULT '{}',
        stock_mode INTEGER NOT NULL DEFAULT 0,
        auto_review INTEGER NOT NULL DEFAULT 1,
        auto_metadata INTEGER NOT NULL DEFAULT 0,
        auto_export INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        run_after_ms INTEGER NOT NULL DEFAULT 0,
        claimed_by TEXT,
        heartbeat_ms INTEGER,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gen_jobs_status_priority
        ON gen_jobs(status, priority DESC, run_after_ms, created_at);
      CREATE INDEX IF NOT EXISTS idx_gen_jobs_parent ON gen_jobs(parent_job_id);
      CREATE INDEX IF NOT EXISTS idx_gen_jobs_project ON gen_jobs(project_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_jobs_idempotency
        ON gen_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS gen_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES gen_jobs(id) ON DELETE CASCADE,
        ts_ms INTEGER NOT NULL,
        type TEXT NOT NULL,
        stage TEXT,
        progress REAL,
        message TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_gen_job_events_job ON gen_job_events(job_id, id);
      CREATE TABLE IF NOT EXISTS gen_assets (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES gen_jobs(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES gen_projects(id) ON DELETE SET NULL,
        asset_type TEXT NOT NULL DEFAULT 'image',
        role TEXT NOT NULL DEFAULT 'generated',
        filename TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_seconds REAL,
        fps REAL,
        file_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        negative_prompt TEXT NOT NULL DEFAULT '',
        seed INTEGER,
        model_id TEXT,
        workflow_id TEXT,
        workflow_version INTEGER,
        provider_id TEXT,
        parent_asset_id TEXT REFERENCES gen_assets(id) ON DELETE SET NULL,
        source_job_id TEXT,
        generation_metadata_json TEXT NOT NULL DEFAULT '{}',
        technical_score REAL,
        visual_score REAL,
        commercial_score REAL,
        policy_score REAL,
        overall_score REAL,
        review_status TEXT NOT NULL DEFAULT 'pending',
        stock_status TEXT NOT NULL DEFAULT 'none',
        metadata_status TEXT NOT NULL DEFAULT 'none',
        export_status TEXT NOT NULL DEFAULT 'none',
        favorite INTEGER NOT NULL DEFAULT 0,
        user_rating INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_assets_project_created ON gen_assets(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gen_assets_sha ON gen_assets(sha256);
      CREATE INDEX IF NOT EXISTS idx_gen_assets_job ON gen_assets(job_id);
      CREATE TABLE IF NOT EXISTS gen_reviews (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES gen_assets(id) ON DELETE CASCADE,
        reviewer TEXT NOT NULL,
        review_type TEXT NOT NULL,
        score REAL,
        verdict TEXT NOT NULL,
        decision TEXT NOT NULL,
        issues_json TEXT NOT NULL DEFAULT '[]',
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        raw_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_reviews_asset ON gen_reviews(asset_id);
      CREATE TABLE IF NOT EXISTS gen_stock_metadata (
        asset_id TEXT PRIMARY KEY REFERENCES gen_assets(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        category INTEGER,
        commercial_intent TEXT NOT NULL DEFAULT 'commercial',
        release_required INTEGER NOT NULL DEFAULT 0,
        ai_generated INTEGER NOT NULL DEFAULT 1,
        editorial INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'en',
        metadata_version TEXT NOT NULL DEFAULT '1.0',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_export_packages (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES gen_assets(id) ON DELETE CASCADE,
        destination TEXT NOT NULL DEFAULT 'local',
        status TEXT NOT NULL DEFAULT 'pending',
        package_path TEXT,
        image_path TEXT,
        metadata_path TEXT,
        manifest_path TEXT,
        csv_path TEXT,
        checksum TEXT,
        mode TEXT NOT NULL DEFAULT 'stock-ready',
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gen_export_asset ON gen_export_packages(asset_id);
      CREATE TABLE IF NOT EXISTS gen_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_gen_audit_ts ON gen_audit_log(ts_ms);

      -- Phase 20: Multi-GPU Generation Grid & RunPod Router -----------------
      CREATE TABLE IF NOT EXISTS gen_compute_instances (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'runpod',
        external_id TEXT,
        name TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'unknown',
        health_state TEXT NOT NULL DEFAULT 'unknown',
        gpu_type TEXT,
        gpu_count INTEGER NOT NULL DEFAULT 1,
        gpu_memory_gb REAL,
        region TEXT,
        datacenter_id TEXT,
        template_id TEXT,
        network_volume_id TEXT,
        base_url TEXT,
        internal_metadata_json TEXT NOT NULL DEFAULT '{}',
        ownership_token TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ready_at TEXT,
        last_seen_at TEXT,
        stopped_at TEXT,
        terminated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gen_compute_instances_provider ON gen_compute_instances(provider_id, lifecycle_state);
      CREATE INDEX IF NOT EXISTS idx_gen_compute_instances_external ON gen_compute_instances(external_id);

      CREATE TABLE IF NOT EXISTS gen_gpu_profiles (
        id TEXT PRIMARY KEY,
        gpu_type_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        vram_gb REAL NOT NULL,
        architecture TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'runpod',
        supports_cuda INTEGER NOT NULL DEFAULT 1,
        allowed_workload_classes_json TEXT NOT NULL DEFAULT '[]',
        observed_price_per_hour REAL,
        price_observed_at TEXT,
        benchmark_score REAL NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_gen_gpu_profiles_vram ON gen_gpu_profiles(vram_gb, enabled);

      CREATE TABLE IF NOT EXISTS gen_placement_decisions (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        selected_provider TEXT NOT NULL,
        selected_instance_id TEXT,
        selected_gpu TEXT,
        decision_score REAL NOT NULL DEFAULT 0,
        estimated_hourly_cost REAL,
        estimated_job_cost REAL,
        cold_start_penalty REAL NOT NULL DEFAULT 0,
        queue_penalty REAL NOT NULL DEFAULT 0,
        model_locality_score REAL NOT NULL DEFAULT 0,
        availability_score REAL NOT NULL DEFAULT 0,
        cost_score REAL NOT NULL DEFAULT 0,
        performance_score REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        alternatives_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_placement_job ON gen_placement_decisions(job_id);

      CREATE TABLE IF NOT EXISTS gen_cloud_leases (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_cloud_leases_resource ON gen_cloud_leases(resource_type, resource_id);

      CREATE TABLE IF NOT EXISTS gen_runpod_pods (
        id TEXT PRIMARY KEY,
        runpod_pod_id TEXT NOT NULL UNIQUE,
        template_id TEXT,
        gpu_type TEXT NOT NULL,
        gpu_count INTEGER NOT NULL DEFAULT 1,
        datacenter_id TEXT,
        network_volume_id TEXT,
        desired_state TEXT NOT NULL DEFAULT 'running',
        actual_state TEXT NOT NULL DEFAULT 'unknown',
        cost_per_hour REAL NOT NULL DEFAULT 0,
        created_by_pao INTEGER NOT NULL DEFAULT 1,
        ownership_marker TEXT NOT NULL,
        current_job_id TEXT,
        last_active_at TEXT,
        idle_since TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_runpod_pods_actual ON gen_runpod_pods(actual_state, created_by_pao);

      CREATE TABLE IF NOT EXISTS gen_runpod_billing (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'runpod',
        pod_id TEXT NOT NULL,
        gpu_type TEXT NOT NULL,
        period TEXT,
        amount REAL NOT NULL DEFAULT 0,
        time_billed_ms INTEGER NOT NULL DEFAULT 0,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_runpod_billing_pod ON gen_runpod_billing(pod_id, observed_at);

      CREATE TABLE IF NOT EXISTS gen_execution_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES gen_jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL DEFAULT 1,
        provider TEXT NOT NULL,
        instance_id TEXT,
        gpu_type TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        runtime_seconds REAL,
        estimated_cost REAL,
        actual_cost REAL,
        status TEXT NOT NULL DEFAULT 'started',
        error_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_gen_execution_attempts_job ON gen_execution_attempts(job_id, attempt);

      CREATE TABLE IF NOT EXISTS gen_price_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL DEFAULT 'runpod',
        gpu_type TEXT NOT NULL,
        price_per_hour REAL NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_price_gpu ON gen_price_observations(gpu_type, observed_at DESC);

      -- Phase 20.1: ComfyUI Smart Queue & Auto Cloud Burst Scheduler --------
      CREATE TABLE IF NOT EXISTS gen_queue_snapshots (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        instance_id TEXT,
        captured_at TEXT NOT NULL,
        running_count INTEGER NOT NULL DEFAULT 0,
        queued_count INTEGER NOT NULL DEFAULT 0,
        total_active INTEGER NOT NULL DEFAULT 0,
        oldest_queued_at TEXT,
        newest_queued_at TEXT,
        estimated_backlog_seconds REAL NOT NULL DEFAULT 0,
        estimated_drain_seconds REAL NOT NULL DEFAULT 0,
        provider_health TEXT NOT NULL DEFAULT 'healthy',
        gpu_utilization REAL,
        vram_used REAL,
        vram_total REAL,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_gen_queue_snapshots_provider ON gen_queue_snapshots(provider_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS gen_batch_groups (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        affinity_key TEXT NOT NULL,
        total_jobs INTEGER NOT NULL DEFAULT 0,
        queued_jobs INTEGER NOT NULL DEFAULT 0,
        running_jobs INTEGER NOT NULL DEFAULT 0,
        completed_jobs INTEGER NOT NULL DEFAULT 0,
        preferred_provider TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_batch_groups_affinity ON gen_batch_groups(affinity_key, project_id);

      CREATE TABLE IF NOT EXISTS gen_scale_plans (
        id TEXT PRIMARY KEY,
        current_local_slots INTEGER NOT NULL DEFAULT 1,
        current_cloud_slots INTEGER NOT NULL DEFAULT 0,
        desired_total_slots INTEGER NOT NULL DEFAULT 1,
        desired_cloud_slots INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        estimated_drain_before REAL NOT NULL DEFAULT 0,
        estimated_drain_after REAL NOT NULL DEFAULT 0,
        estimated_hourly_cost REAL NOT NULL DEFAULT 0,
        estimated_batch_cost REAL NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gen_scale_plans_created ON gen_scale_plans(created_at DESC, status);

      CREATE TABLE IF NOT EXISTS gen_queue_reconciliations (
        id TEXT PRIMARY KEY,
        native_prompt_id TEXT NOT NULL,
        pao_job_id TEXT,
        provider_id TEXT NOT NULL,
        mismatch_type TEXT NOT NULL,
        resolution_status TEXT NOT NULL DEFAULT 'pending',
        details_json TEXT NOT NULL DEFAULT '{}',
        detected_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gen_reconcil_provider ON gen_queue_reconciliations(provider_id, resolution_status);

      CREATE TABLE IF NOT EXISTS gen_dispatch_leases (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        slot_index INTEGER NOT NULL DEFAULT 0,
        job_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_dispatch_slot ON gen_dispatch_leases(provider_id, slot_index);

      -- Phase 20.2: Pao Spec-Driven AI SDLC Orchestrator
      CREATE TABLE IF NOT EXISTS sdlc_cycles (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        feature_key TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        source_idea TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        current_stage TEXT NOT NULL DEFAULT 'DRAFT',
        current_gate TEXT,
        risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
        priority INTEGER NOT NULL DEFAULT 5,
        auto_run_mode TEXT NOT NULL DEFAULT 'GUIDED',
        branch_name TEXT,
        base_branch TEXT NOT NULL DEFAULT 'main',
        worktree_path TEXT,
        repo_head_at_start TEXT,
        latest_commit_sha TEXT,
        constitution_version INTEGER NOT NULL DEFAULT 1,
        policy_version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT 'operator',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_cycles_status ON sdlc_cycles(status, current_stage);
      CREATE INDEX IF NOT EXISTS idx_sdlc_cycles_created ON sdlc_cycles(created_at DESC);

      CREATE TABLE IF NOT EXISTS sdlc_requirements (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'FUNCTIONAL',
        priority INTEGER NOT NULL DEFAULT 5,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_req_cycle ON sdlc_requirements(cycle_id, key);

      CREATE TABLE IF NOT EXISTS sdlc_acceptance_criteria (
        id TEXT PRIMARY KEY,
        requirement_id TEXT NOT NULL REFERENCES sdlc_requirements(id) ON DELETE CASCADE,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        description TEXT NOT NULL,
        verification_type TEXT NOT NULL DEFAULT 'UNIT_TEST',
        status TEXT NOT NULL DEFAULT 'pending',
        verified_by TEXT,
        verified_at TEXT,
        evidence_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_ac_req ON sdlc_acceptance_criteria(requirement_id, key);
      CREATE INDEX IF NOT EXISTS idx_sdlc_ac_cycle ON sdlc_acceptance_criteria(cycle_id, status);

      CREATE TABLE IF NOT EXISTS sdlc_clarifications (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        requirement_id TEXT,
        category TEXT NOT NULL DEFAULT 'ambiguity',
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        question TEXT NOT NULL,
        proposed_resolution TEXT,
        final_resolution TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_clarif_cycle ON sdlc_clarifications(cycle_id, status);

      CREATE TABLE IF NOT EXISTS sdlc_adrs (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        context TEXT NOT NULL,
        decision TEXT NOT NULL,
        consequences TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_adrs_cycle ON sdlc_adrs(cycle_id);

      CREATE TABLE IF NOT EXISTS sdlc_tasks (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'code',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 5,
        assigned_to TEXT,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        target_files_json TEXT NOT NULL DEFAULT '[]',
        acceptance_criteria_keys_json TEXT NOT NULL DEFAULT '[]',
        estimated_minutes INTEGER,
        actual_minutes INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_cycle ON sdlc_tasks(cycle_id, status);

      CREATE TABLE IF NOT EXISTS sdlc_gates (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        gate_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        score REAL NOT NULL DEFAULT 0,
        checklist_results_json TEXT NOT NULL DEFAULT '[]',
        blockers_json TEXT NOT NULL DEFAULT '[]',
        evaluated_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_gates_cycle ON sdlc_gates(cycle_id, gate_type);

      CREATE TABLE IF NOT EXISTS sdlc_reviews (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        reviewer_role TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        verdict TEXT NOT NULL DEFAULT 'PASS',
        summary TEXT NOT NULL,
        findings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_reviews_cycle ON sdlc_reviews(cycle_id, reviewer_role);

      CREATE TABLE IF NOT EXISTS sdlc_evidence (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        acceptance_id TEXT,
        evidence_type TEXT NOT NULL,
        command TEXT,
        exit_code INTEGER,
        summary TEXT NOT NULL,
        output_text TEXT,
        sha256 TEXT,
        verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_evidence_cycle ON sdlc_evidence(cycle_id, acceptance_id);

      CREATE TABLE IF NOT EXISTS sdlc_approvals (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'HIGH',
        status TEXT NOT NULL DEFAULT 'pending',
        token TEXT NOT NULL UNIQUE,
        requested_by TEXT NOT NULL,
        decided_by TEXT,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_approvals_cycle ON sdlc_approvals(cycle_id, status);

      CREATE TABLE IF NOT EXISTS sdlc_artifacts (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sdlc_cycles(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        is_stale INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_artifacts_cycle ON sdlc_artifacts(cycle_id, artifact_type, version);

      CREATE TABLE IF NOT EXISTS sdlc_locks (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        cycle_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_locks_resource ON sdlc_locks(resource_id);

      -- Phase 20.3: Pao Desktop Vision Control MCP × Local Realtime Agent ----
      CREATE TABLE IF NOT EXISTS desktop_sessions (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL DEFAULT 'local',
        machine_id TEXT NOT NULL DEFAULT 'local',
        status TEXT NOT NULL DEFAULT 'CREATED',
        mode TEXT NOT NULL DEFAULT 'ASSISTED',
        created_at TEXT NOT NULL,
        started_at TEXT,
        paused_at TEXT,
        ended_at TEXT,
        current_goal_id TEXT,
        current_app_profile_id TEXT,
        foreground_window_id TEXT,
        emergency_stopped INTEGER NOT NULL DEFAULT 0,
        dry_run INTEGER NOT NULL DEFAULT 0,
        policy_profile TEXT NOT NULL DEFAULT 'default',
        last_heartbeat_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_sessions_status ON desktop_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_desktop_sessions_created ON desktop_sessions(created_at DESC);

      CREATE TABLE IF NOT EXISTS desktop_goals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        goal_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        arguments_json TEXT NOT NULL DEFAULT '{}',
        constraints_json TEXT NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_by TEXT NOT NULL DEFAULT 'operator',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        failure_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_goals_session ON desktop_goals(session_id, status);

      CREATE TABLE IF NOT EXISTS desktop_steps (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES desktop_goals(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        skill_run_id TEXT,
        action_type TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_steps_goal ON desktop_steps(goal_id, step_index);

      CREATE TABLE IF NOT EXISTS desktop_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        goal_id TEXT,
        step_id TEXT,
        action_type TEXT NOT NULL,
        target TEXT,
        arguments_json TEXT NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL DEFAULT 'LOW',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        method_used TEXT,
        expected_postcondition TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        retry_policy TEXT NOT NULL DEFAULT 'SAFE_RETRY',
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        precondition_result INTEGER,
        postcondition_result INTEGER,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_actions_session ON desktop_actions(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_desktop_actions_goal ON desktop_actions(goal_id);

      CREATE TABLE IF NOT EXISTS desktop_action_attempts (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL REFERENCES desktop_actions(id) ON DELETE CASCADE,
        attempt_index INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'RUNNING',
        method_used TEXT,
        target_resolved TEXT,
        precondition_result INTEGER,
        execution_result TEXT,
        postcondition_result INTEGER,
        error_code TEXT,
        error_message TEXT,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_attempts_action ON desktop_action_attempts(action_id, attempt_index);

      CREATE TABLE IF NOT EXISTS desktop_skill_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        goal_id TEXT,
        profile_id TEXT NOT NULL,
        profile_version INTEGER NOT NULL DEFAULT 1,
        skill_id TEXT NOT NULL,
        skill_version INTEGER NOT NULL DEFAULT 1,
        agent_version TEXT NOT NULL,
        protocol_version TEXT NOT NULL,
        policy_version TEXT NOT NULL DEFAULT 'default',
        arguments_json TEXT NOT NULL DEFAULT '{}',
        mode TEXT NOT NULL DEFAULT 'ASSISTED',
        dry_run INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        current_step_index INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_skill_runs_session ON desktop_skill_runs(session_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_desktop_skill_runs_skill ON desktop_skill_runs(skill_id, skill_version);

      CREATE TABLE IF NOT EXISTS desktop_evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        redacted INTEGER NOT NULL DEFAULT 0,
        hash TEXT NOT NULL,
        artifact_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_evidence_session ON desktop_evidence(session_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS desktop_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_events_session ON desktop_events(session_id, ts_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_desktop_events_kind ON desktop_events(kind, ts_ms DESC);

      CREATE TABLE IF NOT EXISTS desktop_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        process_match_json TEXT NOT NULL DEFAULT '{}',
        window_match_json TEXT NOT NULL DEFAULT '{}',
        security_json TEXT NOT NULL DEFAULT '{}',
        states_json TEXT NOT NULL DEFAULT '[]',
        skills_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS desktop_skill_versions (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        arguments_json TEXT NOT NULL DEFAULT '[]',
        preconditions_json TEXT NOT NULL DEFAULT '[]',
        postconditions_json TEXT NOT NULL DEFAULT '[]',
        steps_json TEXT NOT NULL DEFAULT '[]',
        risk_level TEXT NOT NULL DEFAULT 'LOW',
        determinism TEXT NOT NULL DEFAULT 'DETERMINISTIC',
        required_capabilities_json TEXT NOT NULL DEFAULT '[]',
        lifecycle TEXT NOT NULL DEFAULT 'DRAFT',
        timeout_seconds INTEGER NOT NULL DEFAULT 120,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_skill_versions_profile ON desktop_skill_versions(profile_id, version);
      CREATE INDEX IF NOT EXISTS idx_desktop_skill_versions_lifecycle ON desktop_skill_versions(lifecycle);

      CREATE TABLE IF NOT EXISTS desktop_approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        goal_id TEXT,
        action_id TEXT,
        risk_level TEXT NOT NULL DEFAULT 'HIGH',
        reason TEXT NOT NULL,
        preview TEXT NOT NULL DEFAULT '',
        action_fingerprint TEXT NOT NULL DEFAULT '',
        window_fingerprint TEXT NOT NULL DEFAULT '',
        state_fingerprint TEXT NOT NULL DEFAULT '',
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        decision TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_approvals_session ON desktop_approvals(session_id, decision);

      CREATE TABLE IF NOT EXISTS desktop_agent_heartbeats (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        version TEXT NOT NULL,
        protocol_version TEXT NOT NULL,
        machine_id TEXT NOT NULL DEFAULT 'local',
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'HEALTHY',
        foreground_profile TEXT,
        capture_health TEXT NOT NULL DEFAULT 'UNAVAILABLE',
        uia_health TEXT NOT NULL DEFAULT 'UNAVAILABLE',
        input_health TEXT NOT NULL DEFAULT 'UNAVAILABLE',
        emergency_stop INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_heartbeats_agent ON desktop_agent_heartbeats(agent_id, timestamp DESC);

      -- Phase 20.5: Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        title TEXT NOT NULL,
        uri_or_path TEXT NOT NULL,
        project_id TEXT,
        owner TEXT NOT NULL DEFAULT 'local',
        access_scope TEXT NOT NULL DEFAULT 'internal',
        enabled INTEGER NOT NULL DEFAULT 1,
        canonicality TEXT NOT NULL DEFAULT 'canonical',
        fingerprint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'DISCOVERED',
        last_ingested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_project ON knowledge_sources(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sources_uri ON knowledge_sources(uri_or_path);

      CREATE TABLE IF NOT EXISTS source_versions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        parser_version TEXT NOT NULL DEFAULT '1.0.0',
        status TEXT NOT NULL DEFAULT 'INDEXED',
        modified_at TEXT,
        ingested_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_source_versions_source ON source_versions(source_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_source_versions_hash ON source_versions(content_hash);

      CREATE TABLE IF NOT EXISTS source_chunks (
        id TEXT PRIMARY KEY,
        source_version_id TEXT NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        section_path TEXT NOT NULL DEFAULT '',
        start_offset INTEGER NOT NULL DEFAULT 0,
        end_offset INTEGER NOT NULL DEFAULT 0,
        line_start INTEGER,
        line_end INTEGER,
        page INTEGER,
        content_hash TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_source_chunks_version ON source_chunks(source_version_id, chunk_index);

      CREATE TABLE IF NOT EXISTS knowledge_entities (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_canonical ON knowledge_entities(canonical_name);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type ON knowledge_entities(entity_type);

      CREATE TABLE IF NOT EXISTS entity_aliases (
        alias TEXT NOT NULL,
        entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        PRIMARY KEY (alias, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias ON entity_aliases(alias);

      CREATE TABLE IF NOT EXISTS knowledge_claims (
        id TEXT PRIMARY KEY,
        subject_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        predicate TEXT NOT NULL,
        object_value TEXT NOT NULL,
        claim_type TEXT NOT NULL DEFAULT 'FACT',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        confidence REAL NOT NULL DEFAULT 1.0,
        source_priority INTEGER NOT NULL DEFAULT 5,
        valid_from TEXT,
        valid_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_claims_subject ON knowledge_claims(subject_entity_id, status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_claims_predicate ON knowledge_claims(predicate);

      CREATE TABLE IF NOT EXISTS claim_provenance (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
        source_version_id TEXT NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
        chunk_id TEXT REFERENCES source_chunks(id) ON DELETE SET NULL,
        anchor TEXT NOT NULL DEFAULT '',
        extractor TEXT NOT NULL DEFAULT 'deterministic',
        extracted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_claim_provenance_claim ON claim_provenance(claim_id);
      CREATE INDEX IF NOT EXISTS idx_claim_provenance_chunk ON claim_provenance(chunk_id);

      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        to_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        source_claim_ids_json TEXT NOT NULL DEFAULT '[]',
        valid_from TEXT,
        valid_to TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_relations_from ON knowledge_relations(from_entity_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_relations_to ON knowledge_relations(to_entity_id, relation_type);

      CREATE TABLE IF NOT EXISTS knowledge_decisions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACCEPTED',
        decision TEXT NOT NULL,
        rationale_summary TEXT NOT NULL DEFAULT '',
        alternatives_json TEXT NOT NULL DEFAULT '[]',
        effective_at TEXT NOT NULL,
        supersedes_id TEXT,
        source_refs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_decisions_status ON knowledge_decisions(status);

      CREATE TABLE IF NOT EXISTS contradiction_cases (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        claim_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'OPEN',
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        detected_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT,
        canonical_claim_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_contradiction_cases_status ON contradiction_cases(status);

      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        page_type TEXT NOT NULL DEFAULT 'CONCEPT',
        canonical_entity_id TEXT REFERENCES knowledge_entities(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'CURRENT',
        current_revision_id TEXT,
        storage_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug ON wiki_pages(slug);
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_type ON wiki_pages(page_type, status);

      CREATE TABLE IF NOT EXISTS wiki_revisions (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        markdown TEXT NOT NULL,
        compiler_version TEXT NOT NULL DEFAULT '1.0.0',
        source_set_hash TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_revisions(page_id, revision_number DESC);

      CREATE TABLE IF NOT EXISTS wiki_source_links (
        page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        source_version_id TEXT NOT NULL,
        PRIMARY KEY (page_id, source_id)
      );

      CREATE TABLE IF NOT EXISTS ingestion_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        source_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        parser TEXT NOT NULL DEFAULT 'default',
        chunks_created INTEGER NOT NULL DEFAULT 0,
        entities_created INTEGER NOT NULL DEFAULT 0,
        claims_created INTEGER NOT NULL DEFAULT 0,
        pages_impacted INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON ingestion_runs(source_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS compilation_runs (
        id TEXT PRIMARY KEY,
        page_id TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        revisions_created INTEGER NOT NULL DEFAULT 0,
        claims_evaluated INTEGER NOT NULL DEFAULT 0,
        conflicts_detected INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS query_evidence (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        selected_pages_json TEXT NOT NULL DEFAULT '[]',
        selected_claims_json TEXT NOT NULL DEFAULT '[]',
        source_versions_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 1.0,
        contradictions_json TEXT NOT NULL DEFAULT '[]',
        queried_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS index_generations (
        id TEXT PRIMARY KEY,
        index_type TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1,
        item_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL
      );

      -- Phase 20.6: Pao MiniMax H3 Image Studio × Reference Editing × Qwen Detail Refiner
      CREATE TABLE IF NOT EXISTS h3_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        mode TEXT NOT NULL,
        workflow_json TEXT NOT NULL DEFAULT '{}',
        model_stack_json TEXT NOT NULL DEFAULT '[]',
        experimental INTEGER NOT NULL DEFAULT 0,
        stock_safe INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_h3_workflows_mode ON h3_workflows(mode, enabled);

      CREATE TABLE IF NOT EXISTS h3_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        frame_profile INTEGER NOT NULL DEFAULT 5,
        sampling_profile TEXT NOT NULL DEFAULT 'BASE_QUALITY',
        resolution_preset TEXT NOT NULL DEFAULT 'NATIVE_DETAIL',
        default_fidelity REAL NOT NULL DEFAULT 0.6,
        turbo_adapter TEXT,
        stock_safe INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        config_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS h3_models (
        id TEXT PRIMARY KEY,
        model_key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        filename TEXT NOT NULL,
        expected_folder TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        official_or_community TEXT NOT NULL DEFAULT 'official',
        license_name TEXT NOT NULL,
        commercial_use_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        stock_use_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        approved_for_local INTEGER NOT NULL DEFAULT 1,
        approved_for_remote INTEGER NOT NULL DEFAULT 1,
        checksum TEXT,
        status TEXT NOT NULL DEFAULT 'missing',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_h3_models_key ON h3_models(model_key);

      CREATE TABLE IF NOT EXISTS h3_license_policies (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        repo_code_license TEXT NOT NULL,
        model_asset_license TEXT NOT NULL,
        commercial_use_status TEXT NOT NULL,
        stock_use_status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS h3_jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        preset TEXT NOT NULL,
        prompt TEXT NOT NULL,
        structured_prompt_json TEXT NOT NULL DEFAULT '{}',
        resolution TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        frame_profile INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        source_image_path TEXT,
        reference_images_json TEXT NOT NULL DEFAULT '[]',
        detail_refine INTEGER NOT NULL DEFAULT 0,
        stock_mode INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        stage TEXT NOT NULL DEFAULT 'validating',
        progress REAL NOT NULL DEFAULT 0,
        target_execution_node TEXT NOT NULL DEFAULT 'local',
        selected_candidate_index INTEGER,
        output_image_path TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_h3_jobs_status ON h3_jobs(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS h3_candidates (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES h3_jobs(id) ON DELETE CASCADE,
        candidate_index INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        diagnostic_score REAL,
        is_recommended INTEGER NOT NULL DEFAULT 0,
        is_selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_h3_candidates_job ON h3_candidates(job_id, candidate_index);

      CREATE TABLE IF NOT EXISTS h3_stock_qc (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES h3_jobs(id) ON DELETE CASCADE,
        asset_id TEXT,
        license_passed INTEGER NOT NULL DEFAULT 0,
        logo_check_passed INTEGER NOT NULL DEFAULT 0,
        text_check_passed INTEGER NOT NULL DEFAULT 0,
        anatomy_check_passed INTEGER NOT NULL DEFAULT 0,
        ip_check_passed INTEGER NOT NULL DEFAULT 0,
        overall_passed INTEGER NOT NULL DEFAULT 0,
        reviewer_notes TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT,
        reviewed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS h3_provenance (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES h3_jobs(id) ON DELETE CASCADE,
        asset_path TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        workflow_key TEXT NOT NULL,
        preset TEXT NOT NULL,
        seed INTEGER NOT NULL,
        model_manifest_json TEXT NOT NULL DEFAULT '{}',
        reference_roles_json TEXT NOT NULL DEFAULT '[]',
        refinement_used INTEGER NOT NULL DEFAULT 0,
        stock_mode INTEGER NOT NULL DEFAULT 0,
        knowledge_sync_status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL
      );

      -- Phase 20.7: Pao AI Video Factory × MoneyPrinterTurbo Native AI Video Orchestrator
      CREATE TABLE IF NOT EXISTS video_production_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        concept_id TEXT,
        mode TEXT NOT NULL DEFAULT 'adobe_stock',
        status TEXT NOT NULL DEFAULT 'QUEUED',
        stage TEXT NOT NULL DEFAULT 'validating',
        prompt TEXT NOT NULL,
        script TEXT NOT NULL DEFAULT '',
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        resolution TEXT NOT NULL DEFAULT '1080P',
        target_duration_seconds REAL NOT NULL DEFAULT 8.0,
        voiceover_enabled INTEGER NOT NULL DEFAULT 0,
        subtitles_enabled INTEGER NOT NULL DEFAULT 0,
        music_mode TEXT NOT NULL DEFAULT 'none',
        selected_provider TEXT,
        external_provider_job_id TEXT,
        client_request_id TEXT UNIQUE,
        request_json TEXT NOT NULL DEFAULT '{}',
        routing_json TEXT NOT NULL DEFAULT '{}',
        cost_guard_state TEXT NOT NULL DEFAULT 'FREE',
        estimated_cost REAL,
        actual_cost REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        pricing_observed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_production_jobs(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_video_jobs_client_req ON video_production_jobs(client_request_id);

      CREATE TABLE IF NOT EXISTS video_production_scenes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        scene_index INTEGER NOT NULL,
        buyer_story TEXT NOT NULL DEFAULT '',
        script_segment TEXT NOT NULL DEFAULT '',
        visual_prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        provider TEXT,
        model TEXT,
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        duration_seconds REAL NOT NULL DEFAULT 4.0,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        source_type TEXT NOT NULL DEFAULT 'ai_generated',
        source_asset_id TEXT,
        output_asset_id TEXT,
        qc_status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_scenes_job ON video_production_scenes(job_id, scene_index);

      CREATE TABLE IF NOT EXISTS video_production_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        provider TEXT NOT NULL,
        provider_model TEXT,
        external_provider_job_id TEXT,
        status TEXT NOT NULL DEFAULT 'SUBMITTING',
        error_code TEXT,
        error_message TEXT,
        submitted_at TEXT,
        finished_at TEXT,
        usage_json TEXT NOT NULL DEFAULT '{}',
        cost_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_attempts_job ON video_production_attempts(job_id, attempt_number);

      CREATE TABLE IF NOT EXISTS video_production_artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        attempt_id TEXT REFERENCES video_production_attempts(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES video_production_scenes(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT,
        width INTEGER,
        height INTEGER,
        duration_ms INTEGER,
        fps REAL,
        file_size_bytes INTEGER,
        container_format TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        lineage_json TEXT NOT NULL DEFAULT '{}',
        qc_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_artifacts_job ON video_production_artifacts(job_id, type);

      CREATE TABLE IF NOT EXISTS video_technical_qc (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        artifact_id TEXT REFERENCES video_production_artifacts(id) ON DELETE CASCADE,
        passed INTEGER NOT NULL DEFAULT 0,
        container_format TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        width INTEGER,
        height INTEGER,
        aspect_ratio TEXT,
        fps REAL,
        duration_seconds REAL,
        bitrate_kbps REAL,
        file_size_bytes INTEGER,
        checks_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        failures_json TEXT NOT NULL DEFAULT '[]',
        inspected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_technical_qc_job ON video_technical_qc(job_id);

      CREATE TABLE IF NOT EXISTS video_reviewer_council (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        artifact_id TEXT REFERENCES video_production_artifacts(id) ON DELETE CASCADE,
        decision TEXT NOT NULL DEFAULT 'READY_FOR_HUMAN_SUBMISSION_REVIEW',
        composite_score REAL NOT NULL DEFAULT 0.0,
        technical_score REAL NOT NULL DEFAULT 0.0,
        commercial_score REAL NOT NULL DEFAULT 0.0,
        visual_score REAL NOT NULL DEFAULT 0.0,
        similarity_score REAL NOT NULL DEFAULT 0.0,
        compliance_score REAL NOT NULL DEFAULT 0.0,
        similarity_flag TEXT NOT NULL DEFAULT 'LOW',
        rights_status TEXT NOT NULL DEFAULT 'VERIFIED',
        notes TEXT NOT NULL DEFAULT '',
        evaluated_by TEXT NOT NULL DEFAULT 'reviewer_council',
        evaluated_at TEXT NOT NULL,
        human_approved_by TEXT,
        human_approved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_video_reviewer_council_job ON video_reviewer_council(job_id);

      CREATE TABLE IF NOT EXISTS video_export_packages (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES video_production_jobs(id) ON DELETE CASCADE,
        artifact_id TEXT REFERENCES video_production_artifacts(id) ON DELETE CASCADE,
        package_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL DEFAULT '{}',
        csv_content TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        lineage_json TEXT NOT NULL DEFAULT '{}',
        rights_json TEXT NOT NULL DEFAULT '{}',
        is_valid INTEGER NOT NULL DEFAULT 0,
        exported_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_export_packages_job ON video_export_packages(job_id);

      CREATE TABLE IF NOT EXISTS video_provider_health (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'unknown',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        latency_ms REAL NOT NULL DEFAULT 0,
        last_checked_at TEXT NOT NULL,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_video_provider_health_id ON video_provider_health(provider_id);

      -- v14: Phase 20.8 Pao-hubPro × Agency Agents Dynamic Specialist Router
      CREATE TABLE IF NOT EXISTS agency_sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT,
        branch TEXT,
        cache_path TEXT,
        commit_hash TEXT,
        agent_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'idle',
        error_message TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_sources_type ON agency_sources(type);

      CREATE TABLE IF NOT EXISTS agency_agents (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        division TEXT NOT NULL,
        source_id TEXT REFERENCES agency_sources(id) ON DELETE SET NULL,
        source_path TEXT NOT NULL,
        source_commit TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        deliverables_json TEXT NOT NULL DEFAULT '[]',
        critical_rules_json TEXT NOT NULL DEFAULT '[]',
        success_metrics_json TEXT NOT NULL DEFAULT '[]',
        metadata_hash TEXT NOT NULL,
        body_hash TEXT,
        trust_source TEXT NOT NULL DEFAULT 'bundled',
        prompt_safety_status TEXT NOT NULL DEFAULT 'clean',
        safety_findings_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        is_custom INTEGER NOT NULL DEFAULT 0,
        extends_slug TEXT,
        color TEXT,
        emoji TEXT,
        vibe TEXT,
        runs_count INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 1.0,
        avg_latency_ms REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_agents_slug ON agency_agents(slug);
      CREATE INDEX IF NOT EXISTS idx_agency_agents_division ON agency_agents(division);
      CREATE INDEX IF NOT EXISTS idx_agency_agents_enabled ON agency_agents(enabled, prompt_safety_status);

      CREATE TABLE IF NOT EXISTS agency_agent_versions (
        id TEXT PRIMARY KEY,
        agent_slug TEXT NOT NULL,
        source_commit TEXT,
        source_path TEXT NOT NULL,
        metadata_hash TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_agent_versions_slug ON agency_agent_versions(agent_slug);

      CREATE TABLE IF NOT EXISTS agency_team_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        lead_roles_json TEXT NOT NULL DEFAULT '[]',
        planner_roles_json TEXT NOT NULL DEFAULT '[]',
        builder_roles_json TEXT NOT NULL DEFAULT '[]',
        reviewer_roles_json TEXT NOT NULL DEFAULT '[]',
        validator_roles_json TEXT NOT NULL DEFAULT '[]',
        max_agents INTEGER NOT NULL DEFAULT 6,
        default_mode TEXT NOT NULL DEFAULT 'hybrid',
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_team_presets_id ON agency_team_presets(id);

      CREATE TABLE IF NOT EXISTS agency_runs (
        id TEXT PRIMARY KEY,
        mission TEXT NOT NULL,
        team_id TEXT,
        team_preset_id TEXT,
        risk_level TEXT NOT NULL DEFAULT 'low',
        execution_mode TEXT NOT NULL DEFAULT 'hybrid',
        status TEXT NOT NULL DEFAULT 'CREATED',
        team_composition_json TEXT NOT NULL DEFAULT '{}',
        routing_explanations_json TEXT NOT NULL DEFAULT '[]',
        plan_json TEXT NOT NULL DEFAULT '[]',
        council_decision TEXT,
        reality_gate_passed INTEGER,
        security_gate_passed INTEGER,
        approval_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
        approved_by TEXT,
        approved_at TEXT,
        executor_adapter TEXT,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_runs_status ON agency_runs(status);
      CREATE INDEX IF NOT EXISTS idx_agency_runs_risk ON agency_runs(risk_level);

      CREATE TABLE IF NOT EXISTS agency_subtasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agency_runs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        assigned_agent_slug TEXT NOT NULL,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        risk_level TEXT NOT NULL DEFAULT 'low',
        expected_artifacts_json TEXT NOT NULL DEFAULT '[]',
        done_criteria_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        output_summary TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_subtasks_run ON agency_subtasks(run_id);
      CREATE INDEX IF NOT EXISTS idx_agency_subtasks_agent ON agency_subtasks(assigned_agent_slug);

      CREATE TABLE IF NOT EXISTS agency_agent_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agency_runs(id) ON DELETE CASCADE,
        subtask_id TEXT NOT NULL REFERENCES agency_subtasks(id) ON DELETE CASCADE,
        agent_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        summary TEXT NOT NULL,
        findings_json TEXT NOT NULL DEFAULT '[]',
        recommendations_json TEXT NOT NULL DEFAULT '[]',
        proposed_changes_json TEXT NOT NULL DEFAULT '[]',
        risks_json TEXT NOT NULL DEFAULT '[]',
        unresolved_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 1.0,
        latency_ms REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_agent_results_run ON agency_agent_results(run_id);

      CREATE TABLE IF NOT EXISTS agency_reviews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agency_runs(id) ON DELETE CASCADE,
        reviewer_type TEXT NOT NULL,
        decision TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0.0,
        consensus REAL NOT NULL DEFAULT 1.0,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        conflicts_json TEXT NOT NULL DEFAULT '[]',
        required_changes_json TEXT NOT NULL DEFAULT '[]',
        details_json TEXT NOT NULL DEFAULT '{}',
        evaluated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_reviews_run ON agency_reviews(run_id);

      CREATE TABLE IF NOT EXISTS agency_evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agency_runs(id) ON DELETE CASCADE,
        subtask_id TEXT REFERENCES agency_subtasks(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        reference TEXT NOT NULL,
        summary TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        verification_details TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agency_evidence_run ON agency_evidence(run_id);

      -- Phase 20.9: Pao-hubPro × Chatbox Agent Desktop Runtime
      CREATE TABLE IF NOT EXISTS desktop_agent_runs (
        id TEXT PRIMARY KEY,
        mission TEXT NOT NULL,
        agent_mode TEXT NOT NULL DEFAULT 'ask',
        provider_id TEXT,
        model_id TEXT,
        status TEXT NOT NULL DEFAULT 'IDLE',
        active_tools_json TEXT NOT NULL DEFAULT '[]',
        active_skills_json TEXT NOT NULL DEFAULT '[]',
        current_task TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_runs_status ON desktop_agent_runs(status);
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_runs_mode ON desktop_agent_runs(agent_mode);

      CREATE TABLE IF NOT EXISTS desktop_agent_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES desktop_agent_runs(id) ON DELETE CASCADE,
        actor TEXT NOT NULL DEFAULT 'agent',
        event_type TEXT NOT NULL,
        tool TEXT,
        risk TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_events_run ON desktop_agent_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_events_type ON desktop_agent_events(event_type);

      CREATE TABLE IF NOT EXISTS desktop_agent_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES desktop_agent_runs(id) ON DELETE CASCADE,
        tool_id TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'builtin',
        name TEXT NOT NULL,
        risk TEXT NOT NULL DEFAULT 'low',
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        error_message TEXT,
        latency_ms REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_tool_calls_run ON desktop_agent_tool_calls(run_id);
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_tool_calls_name ON desktop_agent_tool_calls(name);

      CREATE TABLE IF NOT EXISTS desktop_agent_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES desktop_agent_runs(id) ON DELETE CASCADE,
        tool_call_id TEXT REFERENCES desktop_agent_tool_calls(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        risk TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        decided_by TEXT,
        decided_at TEXT,
        reason TEXT,
        requested_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_approvals_run ON desktop_agent_approvals(run_id);
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_approvals_decision ON desktop_agent_approvals(decision);

      CREATE TABLE IF NOT EXISTS desktop_agent_mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL DEFAULT 'stdio',
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        env_whitelist_json TEXT NOT NULL DEFAULT '[]',
        cwd TEXT,
        trust_level TEXT NOT NULL DEFAULT 'untrusted',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_health_check TEXT,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_mcp_servers_enabled ON desktop_agent_mcp_servers(enabled);

      CREATE TABLE IF NOT EXISTS desktop_agent_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '1.0.0',
        source_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        validation_status TEXT NOT NULL DEFAULT 'valid',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_skills_enabled ON desktop_agent_skills(enabled);

      CREATE TABLE IF NOT EXISTS desktop_agent_provider_configs (
        id TEXT PRIMARY KEY,
        provider_type TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT,
        default_model TEXT,
        api_key_ref TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_provider_configs_type ON desktop_agent_provider_configs(provider_type);

      CREATE TABLE IF NOT EXISTS desktop_agent_policies (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'global',
        policy_type TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_agent_policies_scope ON desktop_agent_policies(scope);

      -- Phase 21: Pao Stock Autonomous Campaign Planner (Schema v16)
      CREATE TABLE IF NOT EXISTS stock_trend_signals (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        search_velocity REAL NOT NULL,
        commercial_intent REAL NOT NULL,
        saturation_index REAL NOT NULL,
        niche_viability_score REAL NOT NULL,
        priority_tier TEXT NOT NULL DEFAULT 'secondary',
        status TEXT NOT NULL CHECK(status IN ('new', 'planned', 'producing', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_trend_signals_nvs ON stock_trend_signals(niche_viability_score DESC);
      CREATE INDEX IF NOT EXISTS idx_stock_trend_signals_status ON stock_trend_signals(status);

      CREATE TABLE IF NOT EXISTS stock_campaigns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        trend_signal_id TEXT REFERENCES stock_trend_signals(id) ON DELETE SET NULL,
        target_platform TEXT NOT NULL DEFAULT 'adobe_stock',
        target_asset_count INTEGER NOT NULL,
        completed_asset_count INTEGER NOT NULL DEFAULT 0,
        budget_cents INTEGER NOT NULL DEFAULT 0,
        spent_cents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'paused', 'completed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_campaigns_status ON stock_campaigns(status);

      CREATE TABLE IF NOT EXISTS stock_campaign_items (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES stock_campaigns(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('video_4k', 'photo_raw', 'isolated_element')),
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        lighting TEXT NOT NULL DEFAULT 'natural',
        angle TEXT NOT NULL DEFAULT 'eye_level',
        assigned_provider TEXT NOT NULL DEFAULT 'comfyui',
        gpu_job_id TEXT,
        render_status TEXT NOT NULL CHECK(render_status IN ('pending', 'rendering', 'passed_qc', 'failed_qc')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_campaign_items_camp ON stock_campaign_items(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_stock_campaign_items_status ON stock_campaign_items(render_status);

      CREATE TABLE IF NOT EXISTS stock_qc_records (
        id TEXT PRIMARY KEY,
        campaign_item_id TEXT NOT NULL REFERENCES stock_campaign_items(id) ON DELETE CASCADE,
        sharpness_score REAL NOT NULL,
        artifact_penalty REAL NOT NULL,
        ip_clearance_status TEXT NOT NULL CHECK(ip_clearance_status IN ('cleared', 'flagged_trademark', 'flagged_likeness')),
        council_verdict TEXT NOT NULL CHECK(council_verdict IN ('approve', 'human_review', 'reject')),
        verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_qc_records_item ON stock_qc_records(campaign_item_id);

      CREATE TABLE IF NOT EXISTS stock_portfolio_performance (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES stock_campaigns(id) ON DELETE CASCADE,
        submitted_count INTEGER NOT NULL DEFAULT 0,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        downloads_count INTEGER NOT NULL DEFAULT 0,
        revenue_usd REAL NOT NULL DEFAULT 0.0,
        last_synced_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_portfolio_camp ON stock_portfolio_performance(campaign_id);

      -- v17: Phase 20.4 Pao Autonomous Engineering Council.
      -- Additive only. Phase 20.2 owns cycles/tasks/gates/approvals; these
      -- tables only add parallel execution, worktree lifecycle and merge state.
      CREATE TABLE IF NOT EXISTS council_runs (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'CREATED',
        current_stage TEXT NOT NULL DEFAULT 'created',
        base_branch TEXT NOT NULL,
        base_commit_sha TEXT NOT NULL,
        parallelism_limit INTEGER NOT NULL DEFAULT 4,
        max_parallel_high_risk INTEGER NOT NULL DEFAULT 1,
        policy_profile TEXT NOT NULL DEFAULT 'default',
        budget_profile TEXT NOT NULL DEFAULT 'BALANCED',
        execution_mode TEXT NOT NULL DEFAULT 'PLAN_ONLY',
        integration_mode TEXT NOT NULL DEFAULT 'SEQUENTIAL_APPLY',
        failure_reason TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_council_runs_cycle ON council_runs(cycle_id, status);

      CREATE TABLE IF NOT EXISTS council_parallelization_plans (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        cycle_id TEXT NOT NULL,
        task_keys_json TEXT NOT NULL DEFAULT '[]',
        parallel_groups_json TEXT NOT NULL DEFAULT '[]',
        serialized_groups_json TEXT NOT NULL DEFAULT '[]',
        conflict_risks_json TEXT NOT NULL DEFAULT '[]',
        resource_estimate_json TEXT NOT NULL DEFAULT '{}',
        generator TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        plan_hash TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_plans_run ON council_parallelization_plans(council_run_id);

      CREATE TABLE IF NOT EXISTS council_agent_profiles (
        profile_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model TEXT,
        roles_json TEXT NOT NULL DEFAULT '[]',
        handles_json TEXT NOT NULL DEFAULT '[]',
        languages_json TEXT NOT NULL DEFAULT '[]',
        max_context INTEGER NOT NULL DEFAULT 128000,
        supports_tools INTEGER NOT NULL DEFAULT 1,
        supports_patch INTEGER NOT NULL DEFAULT 1,
        supports_shell INTEGER NOT NULL DEFAULT 0,
        supports_tests INTEGER NOT NULL DEFAULT 0,
        cost_class TEXT NOT NULL DEFAULT 'medium',
        speed_class TEXT NOT NULL DEFAULT 'medium',
        is_reviewer INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS council_agent_runs (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'implementer',
        worktree_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt INTEGER NOT NULL DEFAULT 1,
        current_stage TEXT,
        heartbeat_ms INTEGER,
        tokens_used INTEGER,
        estimated_cost_usd REAL,
        failure_reason TEXT,
        report_json TEXT,
        started_at TEXT,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_council_agent_runs_run ON council_agent_runs(council_run_id, status);
      CREATE INDEX IF NOT EXISTS idx_council_agent_runs_task ON council_agent_runs(council_run_id, task_key, attempt);

      CREATE TABLE IF NOT EXISTS council_worktrees (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        cycle_id TEXT NOT NULL,
        task_key TEXT,
        path TEXT NOT NULL,
        branch TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        head_sha TEXT,
        status TEXT NOT NULL DEFAULT 'CREATING',
        is_integration INTEGER NOT NULL DEFAULT 0,
        cleanup_status TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_worktrees_run ON council_worktrees(council_run_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_council_worktrees_branch ON council_worktrees(branch);

      CREATE TABLE IF NOT EXISTS council_task_leases (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        agent_run_id TEXT,
        worktree_id TEXT,
        owner TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
      );
      -- One active lease per (run, task): enforced in SQL, not just in code.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_council_leases_active
        ON council_task_leases(council_run_id, task_key)
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_council_leases_expiry ON council_task_leases(status, expires_at);

      CREATE TABLE IF NOT EXISTS council_changesets (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        agent_run_id TEXT,
        base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        diff_hash TEXT NOT NULL,
        files_changed_json TEXT NOT NULL DEFAULT '[]',
        insertions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        generated_files_json TEXT NOT NULL DEFAULT '[]',
        migration_files_json TEXT NOT NULL DEFAULT '[]',
        risk TEXT NOT NULL DEFAULT 'MEDIUM',
        scope_drift INTEGER NOT NULL DEFAULT 0,
        scope_drift_paths_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_changesets_run ON council_changesets(council_run_id, task_key, revision);

      CREATE TABLE IF NOT EXISTS council_review_assignments (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        changeset_id TEXT NOT NULL,
        reviewer_profile TEXT NOT NULL,
        reviewer_agent_run_id TEXT,
        required INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        round INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_reviewasg_cs ON council_review_assignments(changeset_id, status);

      CREATE TABLE IF NOT EXISTS council_review_results (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL,
        changeset_id TEXT NOT NULL,
        reviewer_profile TEXT NOT NULL,
        decision TEXT NOT NULL,
        severity_counts_json TEXT NOT NULL DEFAULT '{}',
        findings_json TEXT NOT NULL DEFAULT '[]',
        required_fixes_json TEXT NOT NULL DEFAULT '[]',
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        evidence TEXT,
        reviewed_diff_hash TEXT NOT NULL,
        reviewed_head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_reviewres_cs ON council_review_results(changeset_id, decision);

      CREATE TABLE IF NOT EXISTS council_verification_bundles (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        changeset_id TEXT,
        integration_run_id TEXT,
        commit_sha TEXT NOT NULL,
        checks_json TEXT NOT NULL DEFAULT '[]',
        passed INTEGER NOT NULL DEFAULT 0,
        bundle_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_verif_run ON council_verification_bundles(council_run_id, scope);

      CREATE TABLE IF NOT EXISTS council_conflict_cases (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        changeset_ids_json TEXT NOT NULL DEFAULT '[]',
        files_json TEXT NOT NULL DEFAULT '[]',
        base_sha TEXT NOT NULL,
        conflict_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolver TEXT,
        resolution_changeset_id TEXT,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_conflicts_run ON council_conflict_cases(council_run_id, status);

      CREATE TABLE IF NOT EXISTS council_merge_candidates (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        changeset_ids_json TEXT NOT NULL DEFAULT '[]',
        target_base_sha TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        conflict_status TEXT NOT NULL DEFAULT 'NONE',
        verification_status TEXT NOT NULL DEFAULT 'NOT_RUN',
        review_status TEXT NOT NULL DEFAULT 'PENDING',
        approval_status TEXT NOT NULL DEFAULT 'not_required',
        score INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_mergecand_run ON council_merge_candidates(council_run_id, status, position);

      CREATE TABLE IF NOT EXISTS council_integration_runs (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        worktree_id TEXT,
        strategy TEXT NOT NULL DEFAULT 'SEQUENTIAL_APPLY',
        base_sha TEXT NOT NULL,
        head_sha TEXT,
        candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        applied_changeset_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'PENDING',
        verification_bundle_id TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_council_integ_run ON council_integration_runs(council_run_id, status);

      CREATE TABLE IF NOT EXISTS council_decisions (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        options_json TEXT NOT NULL DEFAULT '[]',
        dissent_json TEXT NOT NULL DEFAULT '[]',
        decided_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_decisions_run ON council_decisions(council_run_id, created_at);

      CREATE TABLE IF NOT EXISTS council_resource_usage (
        id TEXT PRIMARY KEY,
        council_run_id TEXT NOT NULL,
        agent_run_id TEXT,
        provider_id TEXT,
        model TEXT,
        task_key TEXT,
        role TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        estimated_cost_usd REAL,
        duration_ms INTEGER,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_council_usage_run ON council_resource_usage(council_run_id, recorded_at);

      -- v18: Phase 20.10 Pao Trend Intelligence × Apify MCP × Adobe Stock Research Engine.
      CREATE TABLE IF NOT EXISTS trend_research_jobs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        market TEXT NOT NULL DEFAULT 'US',
        asset_type TEXT NOT NULL DEFAULT 'all',
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        requested_sources_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trend_research_jobs_status ON trend_research_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_trend_research_jobs_market ON trend_research_jobs(market);

      CREATE TABLE IF NOT EXISTS trend_actor_registry (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        category TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        health_score REAL NOT NULL DEFAULT 100.0,
        pricing_json TEXT NOT NULL DEFAULT '{}',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trend_actor_reg_provider ON trend_actor_registry(provider, enabled);

      CREATE TABLE IF NOT EXISTS trend_actor_runs (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES trend_research_jobs(id) ON DELETE CASCADE,
        actor_registry_id TEXT NOT NULL,
        provider_run_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'timed_out')),
        result_count INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0.0,
        actual_cost REAL NOT NULL DEFAULT 0.0,
        runtime_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trend_actor_runs_job ON trend_actor_runs(research_job_id);

      CREATE TABLE IF NOT EXISTS trend_signals (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES trend_research_jobs(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        keywords_json TEXT NOT NULL DEFAULT '[]',
        hashtags_json TEXT NOT NULL DEFAULT '[]',
        published_at TEXT,
        views INTEGER,
        likes INTEGER,
        comments_count INTEGER,
        shares INTEGER,
        downloads INTEGER,
        engagement_rate REAL,
        ai_generated INTEGER DEFAULT 0,
        source_url TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trend_signals_job ON trend_signals(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_trend_signals_source ON trend_signals(source);

      CREATE TABLE IF NOT EXISTS trend_opportunity_scores (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES trend_research_jobs(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        demand_score REAL NOT NULL,
        momentum_score REAL NOT NULL,
        buyer_intent_score REAL NOT NULL,
        competition_score REAL NOT NULL,
        competition_gap_score REAL NOT NULL,
        freshness_score REAL NOT NULL,
        production_feasibility_score REAL NOT NULL,
        ai_saturation_score REAL NOT NULL,
        opportunity_score REAL NOT NULL,
        recommendation TEXT NOT NULL CHECK(recommendation IN ('MUST_PRODUCE', 'GOOD_OPPORTUNITY', 'EXPLORE', 'AVOID')),
        reasoning_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trend_opp_job ON trend_opportunity_scores(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_trend_opp_rec ON trend_opportunity_scores(recommendation);

      CREATE TABLE IF NOT EXISTS trend_stock_concepts (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES trend_research_jobs(id) ON DELETE CASCADE,
        opportunity_score_id TEXT REFERENCES trend_opportunity_scores(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        buyer_json TEXT NOT NULL DEFAULT '{}',
        asset_types_json TEXT NOT NULL DEFAULT '[]',
        visual_direction TEXT NOT NULL,
        must_include_json TEXT NOT NULL DEFAULT '[]',
        must_avoid_json TEXT NOT NULL DEFAULT '[]',
        commercial_use_cases_json TEXT NOT NULL DEFAULT '[]',
        production_difficulty REAL NOT NULL DEFAULT 5.0,
        status TEXT NOT NULL DEFAULT 'draft',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trend_concepts_job ON trend_stock_concepts(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_trend_concepts_status ON trend_stock_concepts(status);

      CREATE TABLE IF NOT EXISTS trend_usage_costs (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES trend_research_jobs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        provider_run_id TEXT,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        units REAL NOT NULL DEFAULT 0.0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trend_usage_job ON trend_usage_costs(research_job_id);

      -- v19: Phase 21 Pao Knowledge Layer × Grounded Agent Gateway.
      CREATE TABLE IF NOT EXISTS kg_documents (
        id TEXT PRIMARY KEY,
        doc_type TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        source_priority INTEGER NOT NULL DEFAULT 50,
        tags_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_docs_type ON kg_documents(doc_type);
      CREATE INDEX IF NOT EXISTS idx_kg_docs_path ON kg_documents(path);
      CREATE INDEX IF NOT EXISTS idx_kg_docs_status ON kg_documents(status);

      CREATE TABLE IF NOT EXISTS kg_sections (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES kg_documents(id) ON DELETE CASCADE,
        heading TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL DEFAULT 1,
        end_line INTEGER NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_sections_doc ON kg_sections(document_id);
      CREATE INDEX IF NOT EXISTS idx_kg_sections_heading ON kg_sections(heading);

      CREATE TABLE IF NOT EXISTS kg_phase_relations (
        id TEXT PRIMARY KEY,
        source_phase TEXT NOT NULL,
        target_phase TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        evidence_document_id TEXT REFERENCES kg_documents(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_phase_rel_src ON kg_phase_relations(source_phase);
      CREATE INDEX IF NOT EXISTS idx_kg_phase_rel_tgt ON kg_phase_relations(target_phase);

      CREATE TABLE IF NOT EXISTS kg_evidence_packs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        task TEXT NOT NULL,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
        recommendation TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_evidence_task ON kg_evidence_packs(task_id);
      CREATE INDEX IF NOT EXISTS idx_kg_evidence_risk ON kg_evidence_packs(risk_level);

      CREATE TABLE IF NOT EXISTS kg_audit_events (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        action TEXT NOT NULL,
        query TEXT NOT NULL DEFAULT '',
        sources_json TEXT NOT NULL DEFAULT '[]',
        result TEXT NOT NULL DEFAULT '',
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_audit_agent ON kg_audit_events(agent, created_at);
      CREATE INDEX IF NOT EXISTS idx_kg_audit_action ON kg_audit_events(action, created_at);

      -- v20: Phase 20.11 Pao-hubPro Browser — Agent-Native Runtime.
      CREATE TABLE IF NOT EXISTS browser_action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        agent TEXT NOT NULL,
        workflow_id TEXT,
        tab_id TEXT,
        session_id TEXT,
        tool TEXT NOT NULL,
        arguments_json TEXT NOT NULL DEFAULT '{}',
        url TEXT,
        risk_level TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'not_required',
        result TEXT NOT NULL DEFAULT 'success',
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_logs_agent ON browser_action_logs(agent, created_at);
      CREATE INDEX IF NOT EXISTS idx_browser_logs_tool ON browser_action_logs(tool);
      CREATE INDEX IF NOT EXISTS idx_browser_logs_risk ON browser_action_logs(risk_level);

      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace TEXT NOT NULL DEFAULT 'default',
        profile_dir TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        cookies_encrypted TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_workspace ON browser_sessions(workspace);
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_status ON browser_sessions(status);

      CREATE TABLE IF NOT EXISTS browser_tabs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New Tab',
        url TEXT NOT NULL DEFAULT 'about:blank',
        active INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_tabs_session ON browser_tabs(session_id);
      CREATE INDEX IF NOT EXISTS idx_browser_tabs_active ON browser_tabs(session_id, active);

      CREATE TABLE IF NOT EXISTS browser_downloads (
        id TEXT PRIMARY KEY,
        tab_id TEXT REFERENCES browser_tabs(id) ON DELETE SET NULL,
        filename TEXT NOT NULL,
        url TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'started',
        local_path TEXT,
        initiating_agent TEXT,
        workflow_id TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_browser_dl_status ON browser_downloads(status);
      CREATE INDEX IF NOT EXISTS idx_browser_dl_tab ON browser_downloads(tab_id);

      CREATE TABLE IF NOT EXISTS browser_approvals (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        action_tool TEXT NOT NULL,
        website TEXT NOT NULL,
        reason TEXT NOT NULL,
        affected_data_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_browser_appr_status ON browser_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_browser_appr_agent ON browser_approvals(agent, created_at);

      -- v21: Phase 20.12 Pao-hubPro Browser Workflow Intelligence.
      CREATE TABLE IF NOT EXISTS browser_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        dsl_json TEXT NOT NULL DEFAULT '{}',
        parameters_schema_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_wf_name ON browser_workflows(name);

      CREATE TABLE IF NOT EXISTS browser_workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES browser_workflows(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        current_step_index INTEGER NOT NULL DEFAULT 0,
        variables_json TEXT NOT NULL DEFAULT '{}',
        checkpoints_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        initiating_agent TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_wfr_workflow ON browser_workflow_runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_browser_wfr_status ON browser_workflow_runs(status);

      CREATE TABLE IF NOT EXISTS browser_step_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES browser_workflow_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        step_name TEXT NOT NULL,
        action_tool TEXT NOT NULL,
        arguments_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'success',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        validation_result_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_step_run ON browser_step_logs(run_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_browser_step_status ON browser_step_logs(status);

      CREATE TABLE IF NOT EXISTS browser_task_memories (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        task_pattern TEXT NOT NULL,
        element_signatures_json TEXT NOT NULL DEFAULT '{}',
        success_rate REAL NOT NULL DEFAULT 1.0,
        last_used_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_tm_domain ON browser_task_memories(domain);

      -- v22: Phase 20.13 Pao-hubPro Browser Multi-Agent Web Operations.
      CREATE TABLE IF NOT EXISTS browser_multi_agent_missions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_domain TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_agents_json TEXT NOT NULL DEFAULT '[]',
        context_data_json TEXT NOT NULL DEFAULT '{}',
        evidence_pack_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_mission_status ON browser_multi_agent_missions(status);
      CREATE INDEX IF NOT EXISTS idx_browser_mission_domain ON browser_multi_agent_missions(target_domain);

      CREATE TABLE IF NOT EXISTS browser_agent_dispatches (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES browser_multi_agent_missions(id) ON DELETE CASCADE,
        agent_role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        tab_id TEXT,
        input_payload_json TEXT NOT NULL DEFAULT '{}',
        output_payload_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_browser_dispatch_mission ON browser_agent_dispatches(mission_id);
      CREATE INDEX IF NOT EXISTS idx_browser_dispatch_role ON browser_agent_dispatches(agent_role);

      CREATE TABLE IF NOT EXISTS browser_web_handshakes (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES browser_multi_agent_missions(id) ON DELETE CASCADE,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_handshake_mission ON browser_web_handshakes(mission_id);

      CREATE TABLE IF NOT EXISTS browser_qa_evaluations (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES browser_multi_agent_missions(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL DEFAULT 0,
        url TEXT NOT NULL,
        screenshot_b64 TEXT,
        checks_json TEXT NOT NULL DEFAULT '[]',
        verdict TEXT NOT NULL DEFAULT 'pass',
        issues_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_qa_mission ON browser_qa_evaluations(mission_id);

      -- v23: Phase 20.14 Pao-hubPro Browser Remote Worker & Cloud VM Fleet.
      CREATE TABLE IF NOT EXISTS browser_remote_workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint_url TEXT NOT NULL,
        auth_token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'online', -- 'online' | 'busy' | 'draining' | 'offline'
        geo_region TEXT NOT NULL DEFAULT 'global',
        max_concurrent_jobs INTEGER NOT NULL DEFAULT 3,
        active_jobs INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        last_heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_worker_status ON browser_remote_workers(status);
      CREATE INDEX IF NOT EXISTS idx_browser_worker_geo ON browser_remote_workers(geo_region);
      CREATE INDEX IF NOT EXISTS idx_browser_worker_hb ON browser_remote_workers(last_heartbeat_at);

      CREATE TABLE IF NOT EXISTS browser_remote_job_dispatches (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL REFERENCES browser_remote_workers(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL, -- 'action' | 'workflow' | 'mission'
        target_domain TEXT,
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled'
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_browser_job_worker ON browser_remote_job_dispatches(worker_id);
      CREATE INDEX IF NOT EXISTS idx_browser_job_status ON browser_remote_job_dispatches(status);

      -- v24: End-to-End Autonomous Stock Production & Submission Pipeline.
      CREATE TABLE IF NOT EXISTS stock_autonomous_pipeline_runs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        market TEXT NOT NULL DEFAULT 'US',
        target_asset_count INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'pending',
        current_stage INTEGER NOT NULL DEFAULT 1,
        trend_job_id TEXT,
        campaign_id TEXT,
        browser_mission_id TEXT,
        approval_id TEXT,
        concept_summary_json TEXT NOT NULL DEFAULT '{}',
        campaign_summary_json TEXT NOT NULL DEFAULT '{}',
        qc_summary_json TEXT NOT NULL DEFAULT '{}',
        browser_summary_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_stock_pipe_status ON stock_autonomous_pipeline_runs(status);
      CREATE INDEX IF NOT EXISTS idx_stock_pipe_created ON stock_autonomous_pipeline_runs(created_at);

      -- v25: Pao-hubPro × Google ARTEMIS Mobile Agent Gateway (Phase 20.12).
      CREATE TABLE IF NOT EXISTS mobile_devices (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL DEFAULT 'artemis',
        provider_device_id TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'emulator',
        trust_level TEXT NOT NULL DEFAULT 'test',
        status TEXT NOT NULL DEFAULT 'ready',
        allow_agent INTEGER NOT NULL DEFAULT 1,
        allow_shell INTEGER NOT NULL DEFAULT 0,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        labels_json TEXT NOT NULL DEFAULT '[]',
        last_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_device_alias ON mobile_devices(alias);
      CREATE INDEX IF NOT EXISTS idx_mobile_device_status ON mobile_devices(status);
      CREATE INDEX IF NOT EXISTS idx_mobile_device_trust ON mobile_devices(trust_level);

      CREATE TABLE IF NOT EXISTS mobile_tasks (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'auto',
        verification_level TEXT NOT NULL DEFAULT 'final',
        risk_level TEXT NOT NULL DEFAULT 'R1',
        status TEXT NOT NULL DEFAULT 'NEW',
        provider_task_id TEXT,
        trace_id TEXT,
        requested_by_type TEXT NOT NULL DEFAULT 'agent',
        requested_by_id TEXT NOT NULL DEFAULT 'codex',
        approved_by TEXT,
        error_message TEXT,
        result_summary_json TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_task_device ON mobile_tasks(device_id);
      CREATE INDEX IF NOT EXISTS idx_mobile_task_status ON mobile_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_mobile_task_created ON mobile_tasks(created_at);

      CREATE TABLE IF NOT EXISTS mobile_task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_event_task ON mobile_task_events(task_id);

      CREATE TABLE IF NOT EXISTS mobile_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_artifact_task ON mobile_artifacts(task_id);

      CREATE TABLE IF NOT EXISTS mobile_policy_decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        decision TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_policy_task ON mobile_policy_decisions(task_id);

      -- v26: Phase 20.20 Pao-hubPro Social Intelligence Engine.
      CREATE TABLE IF NOT EXISTS social_providers (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        base_url TEXT,
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        status TEXT NOT NULL DEFAULT 'unknown',
        last_health_check_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_providers_slug ON social_providers(slug);

      CREATE TABLE IF NOT EXISTS social_tools (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        owner TEXT,
        name TEXT NOT NULL,
        title TEXT,
        description TEXT,
        url TEXT,
        platform TEXT NOT NULL DEFAULT 'unknown',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        categories_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        enabled_source TEXT NOT NULL DEFAULT 'auto',
        verified INTEGER NOT NULL DEFAULT 0,
        pricing_state TEXT NOT NULL DEFAULT 'unknown',
        pricing_model TEXT,
        estimated_unit_cost REAL,
        currency TEXT,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        timeout_count INTEGER NOT NULL DEFAULT 0,
        cancel_count INTEGER NOT NULL DEFAULT 0,
        avg_duration_ms REAL,
        p95_duration_ms REAL,
        durations_json TEXT NOT NULL DEFAULT '[]',
        last_success_at TEXT,
        last_failure_at TEXT,
        last_health_check_at TEXT,
        external_created_at TEXT,
        external_modified_at TEXT,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider_id, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_social_tools_provider ON social_tools(provider_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_social_tools_platform ON social_tools(platform);
      CREATE INDEX IF NOT EXISTS idx_social_tools_pricing ON social_tools(pricing_state);

      CREATE TABLE IF NOT EXISTS social_registry_refreshes (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        discovered INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        marked_stale INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        detail_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_refresh_provider ON social_registry_refreshes(provider_id, started_at);

      CREATE TABLE IF NOT EXISTS social_research_jobs (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'any',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        query TEXT,
        max_items INTEGER NOT NULL DEFAULT 100,
        max_cost_usd REAL NOT NULL DEFAULT 0.10,
        freshness TEXT NOT NULL DEFAULT 'cached_ok',
        state TEXT NOT NULL DEFAULT 'draft',
        selected_tool_id TEXT,
        estimated_cost REAL,
        approved_max_usd REAL,
        approval_token_hash TEXT,
        approval_expires_at TEXT,
        fallback_history_json TEXT NOT NULL DEFAULT '[]',
        result_summary_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_social_jobs_state ON social_research_jobs(state);
      CREATE INDEX IF NOT EXISTS idx_social_jobs_platform ON social_research_jobs(platform);
      CREATE INDEX IF NOT EXISTS idx_social_jobs_created ON social_research_jobs(created_at);

      CREATE TABLE IF NOT EXISTS social_provider_runs (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES social_research_jobs(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        provider_run_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        fallback_index INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        estimated_cost REAL,
        actual_cost REAL,
        item_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        fallback_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_social_runs_job ON social_provider_runs(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_social_runs_tool ON social_provider_runs(tool_id);
      CREATE INDEX IF NOT EXISTS idx_social_runs_status ON social_provider_runs(status);

      CREATE TABLE IF NOT EXISTS social_usage_records (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        estimated_cost REAL NOT NULL DEFAULT 0.0,
        actual_cost REAL,
        currency TEXT,
        input_item_count INTEGER NOT NULL DEFAULT 0,
        output_item_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_usage_job ON social_usage_records(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_social_usage_created ON social_usage_records(created_at);

      CREATE TABLE IF NOT EXISTS social_normalized_items (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES social_research_jobs(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'other',
        external_id TEXT,
        source_tool_id TEXT NOT NULL,
        source_url TEXT,
        author_external_id TEXT,
        author_display_name TEXT,
        title TEXT,
        text TEXT,
        description TEXT,
        published_at TEXT,
        observed_at TEXT NOT NULL,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        hashtags_json TEXT NOT NULL DEFAULT '[]',
        mentions_json TEXT NOT NULL DEFAULT '[]',
        language TEXT,
        duplicate_of TEXT,
        provenance_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_social_items_job ON social_normalized_items(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_social_items_platform_external ON social_normalized_items(platform, external_id);
      CREATE INDEX IF NOT EXISTS idx_social_items_observed ON social_normalized_items(observed_at);

      CREATE TABLE IF NOT EXISTS social_trend_signals (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES social_research_jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        platforms_json TEXT NOT NULL DEFAULT '[]',
        occurrences INTEGER NOT NULL DEFAULT 0,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        stats_json TEXT NOT NULL DEFAULT '{}',
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_signals_job ON social_trend_signals(research_job_id);
      CREATE INDEX IF NOT EXISTS idx_social_signals_kind ON social_trend_signals(kind, occurrences DESC);

      CREATE TABLE IF NOT EXISTS social_opportunities (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL REFERENCES social_research_jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        buyer_problem TEXT NOT NULL,
        commercial_use_cases_json TEXT NOT NULL DEFAULT '[]',
        observed_themes_json TEXT NOT NULL DEFAULT '[]',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        evidence_confidence REAL NOT NULL DEFAULT 0.0,
        opportunity_score REAL,
        score_basis TEXT NOT NULL DEFAULT '',
        risks_json TEXT NOT NULL DEFAULT '[]',
        suggested_directions_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_opportunities_job ON social_opportunities(research_job_id);

      CREATE TABLE IF NOT EXISTS social_audit_events (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        research_job_id TEXT,
        tool_id TEXT,
        provider_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_social_audit_event ON social_audit_events(event, created_at);
      CREATE INDEX IF NOT EXISTS idx_social_audit_job ON social_audit_events(research_job_id, created_at);

      -- Phase 20.21: OpenAI Codex Native Runtime Integration ----------------
      CREATE TABLE IF NOT EXISTS codex_runtime_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        hostname TEXT NOT NULL,
        codex_version TEXT,
        runtime_mode TEXT NOT NULL DEFAULT 'auto',
        connection_state TEXT NOT NULL DEFAULT 'offline',
        last_seen TEXT,
        capability_report_json TEXT NOT NULL DEFAULT '{}',
        policy_profile TEXT NOT NULL DEFAULT 'NORMAL',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codex_nodes_platform ON codex_runtime_nodes(platform);
      CREATE INDEX IF NOT EXISTS idx_codex_nodes_state ON codex_runtime_nodes(connection_state);

      CREATE TABLE IF NOT EXISTS codex_runtime_sessions (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        workspace_root TEXT NOT NULL,
        node_id TEXT NOT NULL REFERENCES codex_runtime_nodes(id),
        runtime_mode TEXT NOT NULL DEFAULT 'auto',
        status TEXT NOT NULL DEFAULT 'idle',
        policy_profile TEXT NOT NULL DEFAULT 'NORMAL',
        title TEXT,
        active_turn_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codex_sessions_status ON codex_runtime_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_codex_sessions_node ON codex_runtime_sessions(node_id);
      CREATE INDEX IF NOT EXISTS idx_codex_sessions_thread ON codex_runtime_sessions(thread_id);

      CREATE TABLE IF NOT EXISTS codex_runtime_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES codex_runtime_sessions(id) ON DELETE CASCADE,
        turn_id TEXT,
        node_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'turn',
        state TEXT NOT NULL DEFAULT 'queued',
        priority INTEGER NOT NULL DEFAULT 0,
        prompt TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_codex_jobs_session ON codex_runtime_jobs(session_id);
      CREATE INDEX IF NOT EXISTS idx_codex_jobs_state ON codex_runtime_jobs(state);

      CREATE TABLE IF NOT EXISTS codex_runtime_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES codex_runtime_sessions(id) ON DELETE CASCADE,
        turn_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codex_events_session ON codex_runtime_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_codex_events_turn ON codex_runtime_events(turn_id);
      CREATE INDEX IF NOT EXISTS idx_codex_events_time ON codex_runtime_events(timestamp);

      CREATE TABLE IF NOT EXISTS codex_runtime_approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES codex_runtime_sessions(id) ON DELETE CASCADE,
        turn_id TEXT,
        node_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        command TEXT,
        path TEXT,
        network_intent TEXT,
        risk_level TEXT NOT NULL DEFAULT 'high',
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        decided_by TEXT,
        decided_at TEXT,
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codex_approvals_session ON codex_runtime_approvals(session_id);
      CREATE INDEX IF NOT EXISTS idx_codex_approvals_status ON codex_runtime_approvals(status);

      CREATE TABLE IF NOT EXISTS codex_runtime_audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        session_id TEXT,
        turn_id TEXT,
        node_id TEXT,
        action TEXT NOT NULL,
        risk TEXT NOT NULL DEFAULT 'low',
        result TEXT NOT NULL DEFAULT 'ok',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_codex_audit_action ON codex_runtime_audit_logs(action, timestamp);
      CREATE INDEX IF NOT EXISTS idx_codex_audit_session ON codex_runtime_audit_logs(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS codex_runtime_capabilities (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL REFERENCES codex_runtime_nodes(id) ON DELETE CASCADE,
        codex_installed INTEGER NOT NULL DEFAULT 0,
        codex_version TEXT,
        python_sdk_available INTEGER NOT NULL DEFAULT 0,
        app_server_available INTEGER NOT NULL DEFAULT 0,
        exec_server_available INTEGER NOT NULL DEFAULT 0,
        daemon_available INTEGER NOT NULL DEFAULT 0,
        remote_control_available INTEGER NOT NULL DEFAULT 0,
        mcp_available INTEGER NOT NULL DEFAULT 0,
        experimental_api_enabled INTEGER NOT NULL DEFAULT 0,
        platform TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codex_cap_node ON codex_runtime_capabilities(node_id);

      CREATE TABLE IF NOT EXISTS codex_runtime_mcp_tools (
        id TEXT PRIMARY KEY,
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        description TEXT,
        risk TEXT NOT NULL DEFAULT 'low',
        approval_behavior TEXT NOT NULL DEFAULT 'auto',
        source TEXT NOT NULL DEFAULT 'mcp',
        health TEXT NOT NULL DEFAULT 'healthy',
        last_error TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(server_name, tool_name)
      );
      CREATE INDEX IF NOT EXISTS idx_codex_mcp_server ON codex_runtime_mcp_tools(server_name);
      CREATE INDEX IF NOT EXISTS idx_codex_mcp_risk ON codex_runtime_mcp_tools(risk);

      -- v28: Orchestration Subsystem (Phase 20.22 Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer)
      CREATE TABLE IF NOT EXISTS orchestration_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        workflow_id TEXT,
        runtime_type TEXT NOT NULL DEFAULT 'langchain',
        status TEXT NOT NULL DEFAULT 'queued',
        prompt TEXT NOT NULL,
        resolved_prompt TEXT,
        primary_model TEXT NOT NULL,
        fallback_model TEXT,
        model_call_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        total_input_tokens INTEGER NOT NULL DEFAULT 0,
        total_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0.0,
        max_model_calls INTEGER NOT NULL DEFAULT 25,
        max_tool_calls INTEGER NOT NULL DEFAULT 50,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        output_text TEXT,
        structured_output_json TEXT,
        error_text TEXT,
        error_code TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_runs_status ON orchestration_runs(status);
      CREATE INDEX IF NOT EXISTS idx_orch_runs_session ON orchestration_runs(session_id);
      CREATE INDEX IF NOT EXISTS idx_orch_runs_created ON orchestration_runs(created_at);

      CREATE TABLE IF NOT EXISTS orchestration_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
        sequence_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        agent_role TEXT,
        tool_name TEXT,
        input_payload_json TEXT,
        output_payload_json TEXT,
        duration_ms INTEGER,
        tokens_used INTEGER,
        cost_usd REAL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_events_run_seq ON orchestration_events(run_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_orch_events_timestamp ON orchestration_events(timestamp);

      CREATE TABLE IF NOT EXISTS orchestration_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
        step_number INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        state_json TEXT NOT NULL,
        pending_action_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, step_number)
      );
      CREATE INDEX IF NOT EXISTS idx_orch_checkpoints_run ON orchestration_checkpoints(run_id, step_number);

      CREATE TABLE IF NOT EXISTS orchestration_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        tool_args_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orch_approvals_run ON orchestration_approvals(run_id);
      CREATE INDEX IF NOT EXISTS idx_orch_approvals_status ON orchestration_approvals(status, expires_at);

      CREATE TABLE IF NOT EXISTS orchestration_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        server_name TEXT NOT NULL DEFAULT 'builtin',
        risk_level TEXT NOT NULL DEFAULT 'R1',
        input_args_json TEXT NOT NULL,
        output_result_json TEXT,
        status TEXT NOT NULL DEFAULT 'executing',
        execution_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_tool_calls_run ON orchestration_tool_calls(run_id);
      CREATE INDEX IF NOT EXISTS idx_orch_tool_calls_tool ON orchestration_tool_calls(tool_name);

      CREATE TABLE IF NOT EXISTS orchestration_mcp_servers (
        id TEXT PRIMARY KEY,
        server_name TEXT NOT NULL UNIQUE,
        trust_level TEXT NOT NULL DEFAULT 'approved_third_party',
        transport TEXT NOT NULL DEFAULT 'stdio',
        endpoint_or_command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        tool_count INTEGER NOT NULL DEFAULT 0,
        last_heartbeat TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_mcp_trust ON orchestration_mcp_servers(trust_level);
      CREATE INDEX IF NOT EXISTS idx_orch_mcp_status ON orchestration_mcp_servers(status);

      -- v29: Unified Notification Gateway (Phase 20.23) --------------------
      CREATE TABLE IF NOT EXISTS notification_destinations (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        environment TEXT NOT NULL DEFAULT 'all',
        channel_class TEXT NOT NULL DEFAULT 'general',
        secret_ref TEXT NOT NULL,
        health TEXT NOT NULL DEFAULT 'unknown',
        invalid_reason TEXT,
        rate_limit_state_key TEXT,
        last_success_at TEXT,
        last_failure_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_destinations_enabled
        ON notification_destinations(enabled, provider);

      CREATE TABLE IF NOT EXISTS notification_events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        severity TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT,
        progress REAL,
        entity_type TEXT,
        entity_id TEXT,
        dedupe_key TEXT,
        aggregation_key TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        requested_destinations_json TEXT NOT NULL DEFAULT '[]',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_events_type
        ON notification_events(event_type, created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_notification_events_source
        ON notification_events(source, created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_notification_events_dedupe
        ON notification_events(dedupe_key, created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS notification_subscriptions (
        id TEXT PRIMARY KEY,
        event_pattern TEXT NOT NULL,
        destination_id TEXT NOT NULL REFERENCES notification_destinations(id) ON DELETE CASCADE,
        source TEXT,
        min_severity TEXT,
        max_priority TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(event_pattern, destination_id, source)
      );
      CREATE INDEX IF NOT EXISTS idx_notification_subscriptions_destination
        ON notification_subscriptions(destination_id, enabled);

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
        destination_id TEXT NOT NULL REFERENCES notification_destinations(id),
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        priority TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        available_at_ms INTEGER NOT NULL,
        reserved_by TEXT,
        reserved_at_ms INTEGER,
        lease_expires_at_ms INTEGER,
        sent_at TEXT,
        delivered_at TEXT,
        provider_message_id TEXT,
        last_status_code INTEGER,
        last_error_code TEXT,
        last_error_message TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_queue
        ON notification_deliveries(status, available_at_ms, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event
        ON notification_deliveries(event_id);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_destination
        ON notification_deliveries(destination_id, status, available_at_ms);

      CREATE TABLE IF NOT EXISTS notification_attempts (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        status_code INTEGER,
        error_code TEXT,
        retry_after_ms INTEGER,
        bucket_id TEXT,
        rate_limit_remaining INTEGER,
        rate_limit_reset_after_ms INTEGER,
        global_rate_limited INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_notification_attempts_delivery
        ON notification_attempts(delivery_id, attempt);

      CREATE TABLE IF NOT EXISTS notification_rate_limit_states (
        state_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        destination_id TEXT,
        bucket_id TEXT,
        scope TEXT,
        limit_value INTEGER,
        remaining INTEGER,
        reset_after_ms INTEGER,
        blocked_until_ms INTEGER,
        observed_at TEXT,
        last_request_at_ms INTEGER,
        lease_owner TEXT,
        lease_expires_at_ms INTEGER,
        rate_limited_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_notification_rate_limit_destination
        ON notification_rate_limit_states(destination_id, provider);
      CREATE INDEX IF NOT EXISTS idx_notification_rate_limit_blocked
        ON notification_rate_limit_states(provider, blocked_until_ms);

      CREATE TABLE IF NOT EXISTS notification_provider_gates (
        provider TEXT PRIMARY KEY,
        blocked_until_ms INTEGER,
        reason TEXT,
        observed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notification_circuits (
        destination_id TEXT PRIMARY KEY REFERENCES notification_destinations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'CLOSED',
        failure_count INTEGER NOT NULL DEFAULT 0,
        opened_until_ms INTEGER,
        reason TEXT,
        probe_owner TEXT,
        probe_expires_at_ms INTEGER,
        last_failure_at TEXT,
        last_success_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_circuits_state
        ON notification_circuits(state, opened_until_ms);

      CREATE TABLE IF NOT EXISTS notification_aggregations (
        id TEXT PRIMARY KEY,
        aggregation_key TEXT NOT NULL,
        destination_id TEXT NOT NULL REFERENCES notification_destinations(id) ON DELETE CASCADE,
        root_event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'OPEN',
        event_count INTEGER NOT NULL DEFAULT 1,
        summary_json TEXT NOT NULL DEFAULT '{}',
        flush_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_aggregations_open
        ON notification_aggregations(aggregation_key, destination_id)
        WHERE status = 'OPEN';
      CREATE INDEX IF NOT EXISTS idx_notification_aggregations_flush
        ON notification_aggregations(status, flush_at_ms);

      CREATE TABLE IF NOT EXISTS notification_dead_letters (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE REFERENCES notification_deliveries(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        last_error_code TEXT,
        attempts INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notification_dead_letters_status
        ON notification_dead_letters(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS notification_invalid_requests (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        destination_id TEXT,
        status_code INTEGER NOT NULL,
        error_code TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_invalid_requests_window
        ON notification_invalid_requests(provider, occurred_at_ms DESC);

      CREATE TABLE IF NOT EXISTS notification_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        event_id TEXT,
        delivery_id TEXT,
        destination_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_audit_type
        ON notification_audit_events(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notification_audit_delivery
        ON notification_audit_events(delivery_id, created_at);

      -- v30: Media Acquisition Engine (Phase 20.24) --------------------
      CREATE TABLE IF NOT EXISTS media_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'download',
        provider TEXT NOT NULL,
        source_url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        priority TEXT NOT NULL DEFAULT 'P2',
        preset TEXT NOT NULL DEFAULT 'best',
        progress_percent REAL NOT NULL DEFAULT 0,
        download_speed_bytes_sec REAL,
        eta_seconds REAL,
        downloaded_bytes INTEGER,
        total_bytes INTEGER,
        output_path TEXT,
        output_artifact_id TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        requested_by TEXT NOT NULL DEFAULT 'agent',
        usage_class TEXT NOT NULL DEFAULT 'research_reference',
        export_to_stock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_media_jobs_status
        ON media_jobs(status, priority, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_media_jobs_url
        ON media_jobs(normalized_url);

      CREATE TABLE IF NOT EXISTS media_artifacts (
        artifact_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES media_jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_platform TEXT NOT NULL,
        title TEXT NOT NULL,
        local_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        duration_sec REAL,
        width INTEGER,
        height INTEGER,
        thumbnail_path TEXT,
        transcript_path TEXT,
        usage_class TEXT NOT NULL DEFAULT 'research_reference',
        export_to_stock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        derived_from_artifact_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_media_artifacts_job
        ON media_artifacts(job_id);
      CREATE INDEX IF NOT EXISTS idx_media_artifacts_sha
        ON media_artifacts(sha256);
      CREATE INDEX IF NOT EXISTS idx_media_artifacts_created
        ON media_artifacts(created_at DESC);

      CREATE TABLE IF NOT EXISTS media_sources (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        preferred_provider TEXT NOT NULL DEFAULT 'omniget',
        rate_limit_per_min INTEGER NOT NULL DEFAULT 30,
        requires_auth INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_events (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES media_jobs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_events_job
        ON media_events(job_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS media_provider_health (
        provider TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        available INTEGER NOT NULL DEFAULT 1,
        version TEXT,
        binary_path TEXT,
        latency_ms REAL,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        last_checked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_permissions (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        tier INTEGER NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        reason TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        ffmpeg_args_json TEXT NOT NULL DEFAULT '[]',
        description TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS media_secret_references (
        ref_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        label TEXT NOT NULL,
        domain TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );

      -- v31: Universal Agent Capability Registry (Phase 20.25) -------------
      CREATE TABLE IF NOT EXISTS registry_tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        input_types_json TEXT NOT NULL DEFAULT '[]',
        output_types_json TEXT NOT NULL DEFAULT '[]',
        auth_json TEXT NOT NULL DEFAULT '{}',
        auth_status TEXT NOT NULL DEFAULT 'none',
        runtime_json TEXT NOT NULL DEFAULT '{}',
        risk_level INTEGER NOT NULL DEFAULT 0,
        permission_class TEXT NOT NULL DEFAULT 'read_only',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        cost_json TEXT NOT NULL DEFAULT '{}',
        limits_json TEXT NOT NULL DEFAULT '{}',
        quality_json TEXT NOT NULL DEFAULT '{}',
        source_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        executable INTEGER NOT NULL DEFAULT 0,
        health TEXT NOT NULL DEFAULT 'unknown',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_registry_tools_type ON registry_tools(type);
      CREATE INDEX IF NOT EXISTS idx_registry_tools_status ON registry_tools(status);
      CREATE INDEX IF NOT EXISTS idx_registry_tools_slug ON registry_tools(slug);

      CREATE TABLE IF NOT EXISTS registry_tool_health (
        tool_id TEXT NOT NULL REFERENCES registry_tools(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        checked_at TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY (tool_id, checked_at)
      );

      CREATE TABLE IF NOT EXISTS registry_runs (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'balanced',
        mode TEXT NOT NULL DEFAULT 'execute',
        status TEXT NOT NULL DEFAULT 'planned',
        plan_json TEXT NOT NULL,
        risk_level INTEGER NOT NULL DEFAULT 0,
        approval_required INTEGER NOT NULL DEFAULT 0,
        estimated_cost TEXT NOT NULL DEFAULT 'unknown',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_registry_runs_status ON registry_runs(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS registry_run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES registry_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        capability TEXT NOT NULL,
        tool_id TEXT,
        tool_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        input_summary TEXT NOT NULL DEFAULT '',
        output_summary TEXT,
        error_code TEXT,
        started_at TEXT,
        finished_at TEXT,
        latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_registry_steps_run ON registry_run_steps(run_id, step_index);

      CREATE TABLE IF NOT EXISTS registry_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        step_id TEXT,
        tool_id TEXT NOT NULL,
        tool_name TEXT,
        action TEXT NOT NULL,
        risk_level INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'once',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_registry_approvals_status ON registry_approvals(status, requested_at DESC);

      CREATE TABLE IF NOT EXISTS registry_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        run_id TEXT,
        step_id TEXT,
        tool_id TEXT,
        actor TEXT NOT NULL DEFAULT 'agent',
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ok',
        input_summary TEXT NOT NULL DEFAULT '',
        output_summary TEXT NOT NULL DEFAULT '',
        error_code TEXT,
        permission_class TEXT,
        risk_level INTEGER,
        approval_id TEXT,
        latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_registry_audit_ts ON registry_audit_events(ts_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_registry_audit_run ON registry_audit_events(run_id);

      CREATE TABLE IF NOT EXISTS registry_preferences (
        user_id TEXT NOT NULL DEFAULT 'local',
        tool_id TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, tool_id)
      );

      -- v32: Douyin Media Intelligence provider (Phase 20.26) --------------
      CREATE TABLE IF NOT EXISTS douyin_creators (
        id TEXT PRIMARY KEY,
        provider_creator_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        statistics_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at TEXT NOT NULL,
        last_synced_at TEXT,
        last_sync_cursor TEXT
      );

      CREATE TABLE IF NOT EXISTS douyin_media_items (
        id TEXT PRIMARY KEY,
        provider_item_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'video',
        canonical_url TEXT NOT NULL,
        creator_provider_id TEXT,
        creator_name TEXT,
        title TEXT NOT NULL,
        description TEXT,
        published_at TEXT,
        duration_ms INTEGER,
        tags_json TEXT NOT NULL DEFAULT '[]',
        statistics_json TEXT NOT NULL DEFAULT '{}',
        raw_metadata_ref TEXT,
        rights_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_douyin_items_creator ON douyin_media_items(creator_provider_id);
      CREATE INDEX IF NOT EXISTS idx_douyin_items_created ON douyin_media_items(created_at DESC);

      CREATE TABLE IF NOT EXISTS douyin_search_snapshots (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        item_ids_json TEXT NOT NULL DEFAULT '[]',
        source_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_douyin_search_query ON douyin_search_snapshots(query, fetched_at DESC);

      CREATE TABLE IF NOT EXISTS douyin_hot_board_snapshots (
        id TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        rank INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        score REAL,
        raw_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_douyin_hot_captured ON douyin_hot_board_snapshots(captured_at DESC, rank);

      CREATE TABLE IF NOT EXISTS douyin_comments (
        id TEXT PRIMARY KEY,
        provider_comment_id TEXT NOT NULL,
        media_item_id TEXT NOT NULL,
        parent_comment_id TEXT,
        author_name TEXT,
        text TEXT NOT NULL,
        published_at TEXT,
        statistics_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (provider_comment_id, media_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_douyin_comments_item ON douyin_comments(media_item_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS douyin_transcripts (
        id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        language TEXT,
        text TEXT NOT NULL,
        segments_json TEXT NOT NULL DEFAULT '[]',
        artifact_ref TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_douyin_transcripts_item ON douyin_transcripts(media_item_id);

      CREATE TABLE IF NOT EXISTS douyin_sessions (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL UNIQUE,
        secret_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inactive',
        last_verified_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS douyin_idempotency (
        key TEXT PRIMARY KEY,
        job_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- v33: VoiceStudio speech runtime (Phase 20.32) ----------------------
      CREATE TABLE IF NOT EXISTS speech_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        engine TEXT,
        model_id TEXT,
        voice_id TEXT,
        request_json TEXT NOT NULL,
        policy_snapshot_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error_code TEXT,
        error_message TEXT,
        output_artifact_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_speech_jobs_project ON speech_jobs(project_id);
      CREATE INDEX IF NOT EXISTS idx_speech_jobs_status ON speech_jobs(status);

      CREATE TABLE IF NOT EXISTS speech_artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        raw_path TEXT,
        final_path TEXT,
        sha256 TEXT,
        duration_ms INTEGER,
        sample_rate INTEGER,
        channels INTEGER,
        manifest_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_speech_artifacts_project ON speech_artifacts(project_id);

      CREATE TABLE IF NOT EXISTS voice_profiles (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_profile_id TEXT,
        name TEXT NOT NULL,
        language TEXT,
        purposes_json TEXT NOT NULL DEFAULT '[]',
        origin TEXT NOT NULL DEFAULT 'synced',
        status TEXT NOT NULL DEFAULT 'unreviewed',
        commercial_use_status TEXT NOT NULL DEFAULT 'unknown',
        consent_status TEXT NOT NULL DEFAULT 'none',
        license_status TEXT NOT NULL DEFAULT 'unknown',
        impersonates_public_figure INTEGER NOT NULL DEFAULT 0,
        stock_approved_at TEXT,
        created_from_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS voice_consents (
        id TEXT PRIMARY KEY,
        voice_id TEXT,
        subject_type TEXT NOT NULL,
        subject_alias TEXT NOT NULL,
        consent_basis TEXT NOT NULL,
        consent_document_ref TEXT,
        allowed_uses_json TEXT NOT NULL DEFAULT '[]',
        commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
        stock_use_allowed INTEGER NOT NULL DEFAULT 0,
        voice_clone_allowed INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_licenses (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        engine TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_version TEXT,
        code_license TEXT,
        weights_license TEXT,
        commercial_use INTEGER NOT NULL DEFAULT 0,
        stock_use INTEGER NOT NULL DEFAULT 0,
        attribution_required INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unknown',
        source_url TEXT,
        verified_at TEXT,
        verified_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS speech_policy_checks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT,
        required_action TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_speech_policy_checks_job ON speech_policy_checks(job_id);

      CREATE TABLE IF NOT EXISTS speech_runtime_health (
        id TEXT PRIMARY KEY,
        checked_at TEXT NOT NULL,
        state TEXT NOT NULL,
        provider TEXT NOT NULL,
        version_detected TEXT,
        version_pin TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS speech_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_speech_audit_ts ON speech_audit(ts DESC);

      -- v34: Lead Intelligence Control Plane (Phase 20.34) ------------------
      CREATE TABLE IF NOT EXISTS lead_profiles (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'raw',
        confidence REAL NOT NULL DEFAULT 0.3,
        canonical_key TEXT NOT NULL,
        company_json TEXT,
        person_json TEXT,
        score_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_profiles_key ON lead_profiles(canonical_key);
      CREATE INDEX IF NOT EXISTS idx_lead_profiles_status ON lead_profiles(status);
      CREATE INDEX IF NOT EXISTS idx_lead_profiles_kind ON lead_profiles(kind);

      CREATE TABLE IF NOT EXISTS lead_contact_points (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        source_provider_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        verification_status TEXT NOT NULL DEFAULT 'unknown',
        verified_at TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead ON lead_contact_points(lead_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_contacts_unique ON lead_contact_points(lead_id, type, normalized_value);

      CREATE TABLE IF NOT EXISTS lead_social_profiles (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        source_provider_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_social_lead ON lead_social_profiles(lead_id);

      CREATE TABLE IF NOT EXISTS lead_source_records (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_run_id TEXT,
        source_url TEXT,
        raw_ref TEXT,
        collected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_sources_lead ON lead_source_records(lead_id);

      CREATE TABLE IF NOT EXISTS lead_field_evidence (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value_preview TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        collected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_evidence_lead ON lead_field_evidence(lead_id);

      CREATE TABLE IF NOT EXISTS lead_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT NOT NULL,
        pricing_model TEXT NOT NULL DEFAULT 'unknown',
        cost_per_1000 REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        timeout_ms INTEGER NOT NULL DEFAULT 60000,
        max_concurrency INTEGER NOT NULL DEFAULT 2,
        quality_score REAL NOT NULL DEFAULT 0.5,
        reliability_score REAL NOT NULL DEFAULT 0.5,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        secret_ref TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lead_provider_health (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        last_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lead_health_provider ON lead_provider_health(provider_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS lead_provider_usage (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        units INTEGER,
        estimated_cost REAL NOT NULL DEFAULT 0,
        actual_cost REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_usage_provider ON lead_provider_usage(provider_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS lead_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'BALANCED',
        budget_json TEXT NOT NULL,
        selected_providers_json TEXT NOT NULL DEFAULT '[]',
        estimated_cost REAL NOT NULL DEFAULT 0,
        actual_cost REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lead_jobs_status ON lead_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_lead_jobs_type ON lead_jobs(type);

      CREATE TABLE IF NOT EXISTS lead_pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lead_pipeline_runs (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        estimated_cost REAL NOT NULL DEFAULT 0,
        actual_cost REAL NOT NULL DEFAULT 0,
        error_code TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lead_runs_pipeline ON lead_pipeline_runs(pipeline_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS lead_suppression (
        id TEXT PRIMARY KEY,
        match_type TEXT NOT NULL,
        match_value TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_suppression_value ON lead_suppression(match_type, match_value);

      CREATE TABLE IF NOT EXISTS lead_exports (
        id TEXT PRIMARY KEY,
        format TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        filters_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lead_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_lead_audit_ts ON lead_audit(ts DESC);

      -- v35: Unified AI runtime control plane (Phase 20.35) -----------------
      CREATE TABLE IF NOT EXISTS unified_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_local INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL,
        routing_json TEXT NOT NULL,
        limits_json TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unified_provider_health (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        state TEXT NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        circuit_state TEXT NOT NULL DEFAULT 'CLOSED',
        message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_unified_health_provider ON unified_provider_health(provider_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS unified_route_executions (
        id TEXT PRIMARY KEY,
        virtual_model TEXT NOT NULL,
        mode TEXT NOT NULL,
        selected_provider TEXT,
        fallbacks_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        execution_class TEXT NOT NULL DEFAULT 'provider_mode',
        workspace_id TEXT,
        total_ms INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        error_code TEXT,
        request_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_unified_exec_provider ON unified_route_executions(selected_provider, created_at DESC);

      CREATE TABLE IF NOT EXISTS unified_workspace_grants (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        grants_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unified_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        risk TEXT NOT NULL,
        decision TEXT NOT NULL,
        workspace_id TEXT,
        execution_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_unified_audit_ts ON unified_audit(ts DESC);

      -- v36: Pao Business Builder (Phase 30.36) ------------------------------
      CREATE TABLE IF NOT EXISTS biz_opportunities (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'imported',
        edited_manually INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biz_opps_slug ON biz_opportunities(slug);
      CREATE INDEX IF NOT EXISTS idx_biz_opps_status ON biz_opportunities(status);

      CREATE TABLE IF NOT EXISTS biz_opportunity_versions (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        edited_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biz_versions_opp ON biz_opportunity_versions(opportunity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS biz_sources (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL UNIQUE,
        url TEXT,
        license TEXT NOT NULL DEFAULT 'LICENSE_UNKNOWN',
        source_commit TEXT,
        last_import_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS biz_source_imports (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        dry_run INTEGER NOT NULL DEFAULT 0,
        files_seen INTEGER NOT NULL DEFAULT 0,
        opportunities_created INTEGER NOT NULL DEFAULT 0,
        opportunities_updated INTEGER NOT NULL DEFAULT 0,
        skipped_duplicates INTEGER NOT NULL DEFAULT 0,
        conflicts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS biz_capability_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        derived_from TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS biz_compliance_checks (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        dimensions_json TEXT NOT NULL,
        overall TEXT NOT NULL,
        requires_review INTEGER NOT NULL DEFAULT 1,
        reviewed_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biz_compliance_opp ON biz_compliance_checks(opportunity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS biz_cost_estimates (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        prototype_cost REAL NOT NULL DEFAULT 0,
        monthly_fixed_cost REAL NOT NULL DEFAULT 0,
        cost_per_customer REAL NOT NULL DEFAULT 0,
        suggested_price REAL NOT NULL DEFAULT 0,
        gross_margin REAL NOT NULL DEFAULT 0,
        break_even_customers INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biz_costs_opp ON biz_cost_estimates(opportunity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS biz_mvp_specs (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        output_dir TEXT NOT NULL DEFAULT '',
        artifacts_json TEXT NOT NULL DEFAULT '{}',
        blocked INTEGER NOT NULL DEFAULT 0,
        block_reasons_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biz_mvp_opp ON biz_mvp_specs(opportunity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS biz_experiments (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        hypothesis TEXT NOT NULL DEFAULT '',
        customer_segment TEXT NOT NULL DEFAULT '',
        offer TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        acquisition_channel TEXT NOT NULL DEFAULT '',
        landing_page_url TEXT,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        conversion_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'running',
        decision TEXT NOT NULL DEFAULT 'PENDING',
        decision_reasons_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_biz_experiments_opp ON biz_experiments(opportunity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS biz_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_biz_audit_ts ON biz_audit(ts DESC);

      -- v37: Agentic Development OS control plane (Phase 20.37) -------------
      CREATE TABLE IF NOT EXISTS orch_agents (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        runtime_kind TEXT NOT NULL,
        risk_ceiling INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        tools_allow_json TEXT NOT NULL DEFAULT '[]',
        tools_deny_json TEXT NOT NULL DEFAULT '[]',
        skills_json TEXT NOT NULL DEFAULT '[]',
        routing_json TEXT NOT NULL DEFAULT '{}',
        limits_json TEXT NOT NULL DEFAULT '{}',
        manifest_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orch_skills (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        risk_level INTEGER NOT NULL DEFAULT 0,
        trigger_terms_json TEXT NOT NULL DEFAULT '[]',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        required_tools_json TEXT NOT NULL DEFAULT '[]',
        optional_tools_json TEXT NOT NULL DEFAULT '[]',
        workflow_json TEXT NOT NULL DEFAULT '{}',
        manifest_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orch_hook_policies (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        event TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        mode TEXT NOT NULL DEFAULT 'enforce',
        action TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        when_json TEXT NOT NULL DEFAULT '{}',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_hooks_event_priority ON orch_hook_policies(event, enabled, priority);

      CREATE TABLE IF NOT EXISTS orch_runs (
        id TEXT PRIMARY KEY,
        workflow_slug TEXT NOT NULL DEFAULT 'auto',
        requested_by TEXT,
        source TEXT NOT NULL DEFAULT 'internal',
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        risk_level INTEGER NOT NULL DEFAULT 0,
        route_json TEXT,
        input_summary TEXT,
        output_summary TEXT,
        concern_summary TEXT,
        approval_id TEXT,
        worktree_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orch_runs_status_created ON orch_runs(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS orch_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_slug TEXT,
        tool_name TEXT NOT NULL,
        tool_kind TEXT NOT NULL,
        risk_level INTEGER NOT NULL DEFAULT 0,
        policy_decision TEXT NOT NULL,
        request_summary TEXT,
        response_summary TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_tool_calls_run ON orch_tool_calls(run_id, created_at);

      CREATE TABLE IF NOT EXISTS orch_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        approval_type TEXT NOT NULL DEFAULT 'tool_execution',
        risk_level INTEGER NOT NULL,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT,
        decided_by TEXT,
        expires_at TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_approvals_pending ON orch_approvals(status, created_at);

      CREATE TABLE IF NOT EXISTS orch_worktrees (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        repo_root TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch_name TEXT,
        base_revision TEXT,
        status TEXT NOT NULL DEFAULT 'ALLOCATING',
        is_dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orch_worktrees_status ON orch_worktrees(status, created_at);

      CREATE TABLE IF NOT EXISTS orch_memories (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        memory_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL,
        source_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (scope, key)
      );

      CREATE TABLE IF NOT EXISTS orch_audit_events (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        actor_ref TEXT,
        target_type TEXT,
        target_ref TEXT,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_audit_run_created ON orch_audit_events(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_orch_audit_type_created ON orch_audit_events(event_type, created_at);

      -- v38: Dependency Vault (Phase 20.38) ---------------------------------
      CREATE TABLE IF NOT EXISTS dv_packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        registry TEXT NOT NULL,
        package_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dv_packages_name ON dv_packages(name);

      CREATE TABLE IF NOT EXISTS dv_artifacts (
        id TEXT PRIMARY KEY,
        package_key TEXT NOT NULL,
        tarball_url TEXT,
        registry_origin TEXT NOT NULL DEFAULT '',
        integrity TEXT,
        sha512 TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_path TEXT,
        trust_state TEXT NOT NULL DEFAULT 'DISCOVERED',
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_by TEXT,
        verified_at TEXT,
        downloaded_at TEXT,
        last_accessed_at TEXT,
        quarantine_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dv_artifacts_sha512 ON dv_artifacts(sha512) WHERE sha512 IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_dv_artifacts_package ON dv_artifacts(package_key);
      CREATE INDEX IF NOT EXISTS idx_dv_artifacts_trust ON dv_artifacts(trust_state);

      CREATE TABLE IF NOT EXISTS dv_projects (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL UNIQUE,
        project_path TEXT,
        package_manager TEXT NOT NULL DEFAULT 'npm',
        lockfile_type TEXT,
        lockfile_hash TEXT,
        last_resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dv_project_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        integrity TEXT,
        direct INTEGER NOT NULL DEFAULT 0,
        dev INTEGER NOT NULL DEFAULT 0,
        optional INTEGER NOT NULL DEFAULT 0,
        peer INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_dv_items_project ON dv_project_items(project_id);

      CREATE TABLE IF NOT EXISTS dv_bundles (
        id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        output_path TEXT NOT NULL,
        package_count INTEGER NOT NULL DEFAULT 0,
        total_size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dv_policy_decisions (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        policy_rule TEXT,
        actor TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dv_decisions_subject ON dv_policy_decisions(subject_type, subject_key);

      CREATE TABLE IF NOT EXISTS dv_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor_type TEXT,
        actor_id TEXT,
        project_key TEXT,
        package_key TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dv_audit_type ON dv_audit_events(event_type, created_at DESC);

      -- v39: Unified AI Coding Workspace (Phase 20.39) ------------------------
      CREATE TABLE IF NOT EXISTS cc_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        root_path TEXT NOT NULL,
        normalized_root_path TEXT NOT NULL UNIQUE,
        git_remote_url TEXT,
        git_branch TEXT,
        git_head_sha TEXT,
        trust_level TEXT NOT NULL DEFAULT 'STANDARD',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );

      CREATE TABLE IF NOT EXISTS cc_providers (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cc_provider_instances (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        instance_key TEXT NOT NULL,
        version TEXT,
        status TEXT NOT NULL DEFAULT 'UNKNOWN',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        last_probe_at TEXT,
        metadata_json TEXT,
        UNIQUE (provider_id, instance_key)
      );

      CREATE TABLE IF NOT EXISTS cc_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        native_session_id TEXT,
        parent_session_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DISCOVERED',
        mode TEXT NOT NULL DEFAULT 'CHAT',
        writer_state TEXT NOT NULL DEFAULT 'NONE',
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        native_metadata_json TEXT,
        capabilities_json TEXT,
        resume_token_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_sessions_workspace ON cc_sessions(workspace_id, COALESCE(last_activity_at, updated_at) DESC);
      CREATE INDEX IF NOT EXISTS idx_cc_sessions_native ON cc_sessions(provider_id, native_session_id);
      CREATE INDEX IF NOT EXISTS idx_cc_sessions_status ON cc_sessions(status);

      CREATE TABLE IF NOT EXISTS cc_session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        raw_ref TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_cc_events_session ON cc_session_events(session_id, sequence);

      CREATE TABLE IF NOT EXISTS cc_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RUNNING',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        error_summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cc_runs_session ON cc_runs(session_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS cc_tool_executions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RUNNING',
        risk_score INTEGER,
        approval_request_id TEXT,
        input_json TEXT,
        output_summary TEXT,
        exit_code INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cc_tools_session ON cc_tool_executions(session_id, started_at);

      CREATE TABLE IF NOT EXISTS cc_context_refs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        workspace_id TEXT,
        target_id TEXT,
        path TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_ctx_workspace ON cc_context_refs(workspace_id, type);

      CREATE TABLE IF NOT EXISTS cc_approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        normalized_input_json TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'PENDING',
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cc_approvals_status ON cc_approvals(status, requested_at DESC);

      CREATE TABLE IF NOT EXISTS cc_locks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_locks_active ON cc_locks(workspace_id) WHERE status = 'ACTIVE';
      CREATE INDEX IF NOT EXISTS idx_cc_locks_expiry ON cc_locks(status, expires_at);

      CREATE TABLE IF NOT EXISTS cc_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        reported_cost_usd REAL,
        estimated_cost_usd REAL,
        source TEXT NOT NULL DEFAULT 'UNKNOWN',
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_usage_recorded ON cc_usage(recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cc_usage_session ON cc_usage(session_id);

      CREATE TABLE IF NOT EXISTS cc_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        relative_path TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_artifacts_run ON cc_artifacts(run_id);

      CREATE TABLE IF NOT EXISTS cc_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        workspace_id TEXT,
        session_id TEXT,
        run_id TEXT,
        provider_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        action TEXT NOT NULL,
        decision TEXT,
        risk_score INTEGER,
        summary TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_audit_created ON cc_audit(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cc_audit_session ON cc_audit(session_id, created_at DESC);

      -- v40: Agent Observability Control Plane (Phase 20.40, read-only) -----
      CREATE TABLE IF NOT EXISTS observability_sessions (
        id TEXT PRIMARY KEY,
        source_session_id TEXT,
        runtime TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'unknown',
        project_id TEXT,
        project_name TEXT,
        working_directory_hash TEXT,
        parent_session_id TEXT,
        root_session_id TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'session',
        activity_state TEXT NOT NULL DEFAULT 'unknown',
        process_state TEXT NOT NULL DEFAULT 'unknown',
        execution_state TEXT NOT NULL DEFAULT 'unknown',
        health_state TEXT NOT NULL DEFAULT 'unknown',
        integrity_state TEXT NOT NULL DEFAULT 'unchecked',
        confidence REAL NOT NULL DEFAULT 0,
        started_at TEXT,
        last_recorded_event_at TEXT,
        last_file_modified_at TEXT,
        explicit_ended_at TEXT,
        latest_event_type TEXT,
        latest_role TEXT,
        latest_tool_name TEXT,
        source_path_hash TEXT,
        source_revision TEXT,
        source_size_bytes INTEGER,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_sessions_runtime ON observability_sessions(runtime);
      CREATE INDEX IF NOT EXISTS idx_obs_sessions_observed ON observability_sessions(last_observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_sessions_health ON observability_sessions(health_state);
      CREATE INDEX IF NOT EXISTS idx_obs_sessions_activity ON observability_sessions(activity_state);

      CREATE TABLE IF NOT EXISTS observability_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        runtime TEXT NOT NULL,
        kind TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'unknown',
        recorded_at TEXT,
        observed_at TEXT NOT NULL,
        tool_name TEXT,
        summary TEXT,
        content_preview TEXT,
        source_offset INTEGER,
        source_revision TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        malformed INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_events_recorded ON observability_events(COALESCE(recorded_at, observed_at) DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_events_session ON observability_events(session_id, COALESCE(recorded_at, observed_at) DESC);

      CREATE TABLE IF NOT EXISTS observability_evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        observation_cycle_id TEXT,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        value_json TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_evidence_session ON observability_evidence(session_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS observability_process_evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        runtime TEXT,
        pid INTEGER NOT NULL,
        process_name TEXT,
        match_type TEXT NOT NULL,
        match_confidence REAL NOT NULL DEFAULT 0,
        command_hash TEXT,
        observed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_process_session ON observability_process_evidence(session_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_process_expiry ON observability_process_evidence(expires_at);

      CREATE TABLE IF NOT EXISTS observability_integrity_checks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        algorithm TEXT NOT NULL DEFAULT 'sha256',
        fingerprint TEXT,
        source_revision TEXT,
        status TEXT NOT NULL,
        forced INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_integrity_session ON observability_integrity_checks(session_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS observability_aliases (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        alias TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observability_alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        scope_json TEXT NOT NULL,
        condition_type TEXT NOT NULL,
        condition_json TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_seconds INTEGER NOT NULL DEFAULT 300,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observability_alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        session_id TEXT,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        details_json TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resolved_at TEXT,
        notification_state TEXT NOT NULL DEFAULT 'local'
      );
      CREATE INDEX IF NOT EXISTS idx_obs_alerts_unresolved ON observability_alert_events(resolved_at, first_seen_at DESC);

      CREATE TABLE IF NOT EXISTS observability_scan_cycles (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        scan_ms INTEGER NOT NULL DEFAULT 0,
        sources_seen INTEGER NOT NULL DEFAULT 0,
        sources_changed INTEGER NOT NULL DEFAULT 0,
        events_emitted INTEGER NOT NULL DEFAULT 0,
        errors_count INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_cycles_started ON observability_scan_cycles(started_at DESC);

      -- v41: Trustworthy MCP Memory Plane (Phase 20.41) ------------------------
      CREATE TABLE IF NOT EXISTS memory_workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        repository_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug)
      );

      CREATE TABLE IF NOT EXISTS memory_agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        trust_level TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_key)
      );

      -- v41 note: the legacy Phase-18 memories table (line ~257) is left
      -- untouched per spec section 48; the Memory Plane canonical table is
      -- memory_items.
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        authority TEXT NOT NULL DEFAULT 'observed',
        kind TEXT NOT NULL DEFAULT 'note',
        current_revision INTEGER NOT NULL DEFAULT 1,
        current_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_path TEXT,
        created_by_agent_id TEXT,
        supersedes_memory_id TEXT,
        indexing_state TEXT NOT NULL DEFAULT 'pending',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        forgotten_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_items_workspace ON memory_items(workspace_id, status);
      CREATE INDEX IF NOT EXISTS idx_memory_items_kind ON memory_items(kind, authority);

      CREATE TABLE IF NOT EXISTS memory_revisions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        authority TEXT NOT NULL,
        project_id TEXT,
        source_path TEXT,
        created_by_agent_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (memory_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory ON memory_revisions(memory_id, revision DESC);

      CREATE TABLE IF NOT EXISTS memory_tags (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, normalized_name)
      );

      CREATE TABLE IF NOT EXISTS memory_tag_links (
        memory_id TEXT NOT NULL,
        memory_revision INTEGER NOT NULL,
        memory_tag_id TEXT NOT NULL,
        PRIMARY KEY (memory_id, memory_revision, memory_tag_id)
      );

      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        memory_revision INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_hash TEXT NOT NULL,
        token_count INTEGER,
        embedding_provider TEXT,
        embedding_model TEXT,
        embedding_version TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (memory_id, memory_revision, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_memory ON memory_chunks(memory_id, memory_revision);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_ref TEXT,
        vector_blob TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (chunk_id, provider, model)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chunk ON memory_embeddings(chunk_id);

      CREATE TABLE IF NOT EXISTS memory_observations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        observation_text TEXT NOT NULL,
        confidence REAL,
        created_by_agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_observation_sources (
        observation_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        memory_revision INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        evidence_json TEXT,
        PRIMARY KEY (observation_id, memory_id, memory_revision)
      );

      CREATE TABLE IF NOT EXISTS memory_supersession_links (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        supersedes_memory_id TEXT NOT NULL,
        superseded_revision INTEGER NOT NULL,
        superseded_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_search_traces (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        actor_agent_id TEXT,
        requested_mode TEXT NOT NULL,
        actual_mode TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        query_length INTEGER,
        provider TEXT,
        model TEXT,
        degraded INTEGER NOT NULL DEFAULT 0,
        degrade_reason TEXT,
        result_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_traces_created ON memory_search_traces(created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_search_trace_results (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        memory_revision INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        rank INTEGER NOT NULL,
        keyword_rank INTEGER,
        semantic_rank INTEGER,
        keyword_score REAL,
        semantic_score REAL,
        fused_score REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_trace_results_trace ON memory_search_trace_results(trace_id, rank);

      CREATE TABLE IF NOT EXISTS memory_mutation_previews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        expected_revision INTEGER,
        expected_source_hash TEXT,
        impact_json TEXT NOT NULL,
        actor_agent_id TEXT,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_previews_open ON memory_mutation_previews(expires_at, consumed_at);

      CREATE TABLE IF NOT EXISTS memory_idempotency_keys (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_key TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, actor_key, key_hash)
      );

      CREATE TABLE IF NOT EXISTS memory_oauth_clients (
        id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        client_secret_hash TEXT,
        redirect_uris_json TEXT NOT NULL,
        grant_types_json TEXT NOT NULL,
        scope TEXT NOT NULL,
        token_endpoint_auth TEXT NOT NULL DEFAULT 'client_secret_basic',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_oauth_authorization_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_oauth_access_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        family_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_oauth_refresh_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        family_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        rotated_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_oauth_consents (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (client_id, scope)
      );

      -- v42: Named AI Teammate Workspace (Phase 20.42) ------------------------
      CREATE TABLE IF NOT EXISTS bw_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bw_agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        avatar_ref TEXT,
        description TEXT,
        role TEXT NOT NULL DEFAULT 'custom',
        system_instructions TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        visibility TEXT NOT NULL DEFAULT 'visible',
        provider_binding_id TEXT,
        runtime_binding_id TEXT,
        default_model TEXT,
        context_policy_json TEXT NOT NULL DEFAULT '{}',
        capability_policy_json TEXT NOT NULL DEFAULT '{}',
        approval_policy_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_bw_agents_workspace ON bw_agents(workspace_id, status);

      CREATE TABLE IF NOT EXISTS bw_teams (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        lead_agent_id TEXT,
        orchestration_mode TEXT NOT NULL DEFAULT 'ordered',
        default_recipient_order_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, slug)
      );

      CREATE TABLE IF NOT EXISTS bw_team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        role_in_team TEXT,
        is_required INTEGER NOT NULL DEFAULT 1,
        can_delegate INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (team_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bw_team_members ON bw_team_members(team_id, position);

      CREATE TABLE IF NOT EXISTS bw_conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        agent_id TEXT,
        team_id TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_message_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_conversations_ws ON bw_conversations(workspace_id, COALESCE(last_message_at, updated_at) DESC);

      CREATE TABLE IF NOT EXISTS bw_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        role TEXT NOT NULL DEFAULT 'unknown',
        content_json TEXT NOT NULL,
        reply_to_message_id TEXT,
        parent_execution_id TEXT,
        client_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'final',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_messages_conv ON bw_messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS bw_message_mentions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        mentioned_agent_id TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        mention_token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_mentions_message ON bw_message_mentions(message_id);

      CREATE TABLE IF NOT EXISTS bw_drafts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        content_json TEXT NOT NULL,
        selected_agent_ids_json TEXT NOT NULL DEFAULT '[]',
        attachment_refs_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        UNIQUE (conversation_id, owner_key)
      );

      CREATE TABLE IF NOT EXISTS bw_provider_bindings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        name TEXT NOT NULL,
        endpoint TEXT,
        model TEXT,
        credential_ref TEXT,
        settings_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'unverified',
        last_healthcheck_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bw_runtime_bindings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        runtime_type TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'unverified',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bw_group_rounds (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        initiating_message_id TEXT NOT NULL,
        orchestration_mode TEXT NOT NULL,
        requested_agent_order_json TEXT NOT NULL,
        resolved_agent_order_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        current_position INTEGER NOT NULL DEFAULT 0,
        failure_policy TEXT NOT NULL DEFAULT 'stop_on_failure',
        stop_reason TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_rounds_conv ON bw_group_rounds(conversation_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS bw_agent_executions (
        id TEXT PRIMARY KEY,
        group_round_id TEXT,
        routine_run_id TEXT,
        agent_id TEXT NOT NULL,
        provider_binding_id TEXT,
        runtime_binding_id TEXT,
        model TEXT,
        position INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'created',
        input_snapshot_ref TEXT,
        output_message_id TEXT,
        error_code TEXT,
        error_message_safe TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_exec_round ON bw_agent_executions(group_round_id, position, attempt);
      CREATE INDEX IF NOT EXISTS idx_bw_exec_agent ON bw_agent_executions(agent_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS bw_execution_events (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (execution_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_bw_events_exec ON bw_execution_events(execution_id, sequence);

      CREATE TABLE IF NOT EXISTS bw_approvals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        execution_id TEXT,
        requested_by_agent_id TEXT,
        action_type TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        action_fingerprint TEXT NOT NULL,
        request_payload_redacted_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decision_by TEXT,
        decision_reason TEXT,
        expires_at TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_approvals_status ON bw_approvals(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS bw_routines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        owner_agent_id TEXT,
        owner_team_id TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        trigger_config_json TEXT NOT NULL DEFAULT '{}',
        instruction_template TEXT NOT NULL,
        skill_slug TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_running',
        approval_policy_json TEXT NOT NULL DEFAULT '{}',
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_routines_due ON bw_routines(status, next_run_at);

      CREATE TABLE IF NOT EXISTS bw_routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        root_execution_id TEXT,
        idempotency_key TEXT,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message_safe TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_routine_runs ON bw_routine_runs(routine_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bw_routine_runs_idem ON bw_routine_runs(routine_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS bw_audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        outcome TEXT NOT NULL DEFAULT 'ok',
        metadata_redacted_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bw_audit_ws ON bw_audit_events(workspace_id, created_at DESC);

      -- v43: PLUR Shared Agent Memory Runtime control plane (Phase 20.43) ----
      CREATE TABLE IF NOT EXISTS memory_engram_registry (
        id TEXT PRIMARY KEY,
        engine_engram_id TEXT UNIQUE,
        content_hash TEXT NOT NULL,
        title TEXT,
        content TEXT,
        memory_type TEXT NOT NULL,
        domain TEXT,
        scope TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'project',
        polarity TEXT,
        source_kind TEXT NOT NULL DEFAULT 'explicit',
        source_agent_id TEXT,
        source_session_id TEXT,
        source_run_id TEXT,
        project_id TEXT,
        workspace_id TEXT,
        owner_user_id TEXT,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        secret_scan_status TEXT NOT NULL DEFAULT 'clean',
        policy_decision TEXT NOT NULL DEFAULT 'allow',
        state TEXT NOT NULL DEFAULT 'active',
        confidence REAL,
        last_recalled_at TEXT,
        last_feedback_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        positive_feedback_count INTEGER NOT NULL DEFAULT 0,
        negative_feedback_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        retired_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mem_engram_scope ON memory_engram_registry(scope, state);
      CREATE INDEX IF NOT EXISTS idx_mem_engram_project ON memory_engram_registry(project_id, state);
      CREATE INDEX IF NOT EXISTS idx_mem_engram_agent ON memory_engram_registry(source_agent_id);
      CREATE INDEX IF NOT EXISTS idx_mem_engram_hash ON memory_engram_registry(content_hash);

      CREATE TABLE IF NOT EXISTS memory_episode_registry (
        id TEXT PRIMARY KEY,
        plur_episode_id TEXT,
        summary TEXT NOT NULL,
        agent_id TEXT,
        session_id TEXT,
        run_id TEXT,
        channel TEXT,
        project_id TEXT,
        workspace_id TEXT,
        severity TEXT,
        event_type TEXT NOT NULL,
        happened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_mem_episode_time ON memory_episode_registry(happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mem_episode_agent ON memory_episode_registry(agent_id);

      CREATE TABLE IF NOT EXISTS memory_feedback (
        id TEXT PRIMARY KEY,
        engram_registry_id TEXT NOT NULL,
        engine_engram_id TEXT,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        signal TEXT NOT NULL,
        reason TEXT,
        source_task_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mem_feedback_engram ON memory_feedback(engram_registry_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_policy_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 50,
        action TEXT NOT NULL,
        operation TEXT NOT NULL,
        matcher_json TEXT NOT NULL DEFAULT '{}',
        effect_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_sync_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 0,
        remote_type TEXT NOT NULL DEFAULT 'personal',
        remote_ref TEXT,
        allowed_scope_patterns_json TEXT NOT NULL DEFAULT '[]',
        denied_scope_patterns_json TEXT NOT NULL DEFAULT '[]',
        require_secret_scan INTEGER NOT NULL DEFAULT 1,
        require_approval INTEGER NOT NULL DEFAULT 1,
        last_sync_at TEXT,
        last_sync_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_sync_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        dry_run INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        pushed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        blocked_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        summary_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS memory_injection_receipts (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        run_id TEXT,
        agent_id TEXT,
        project_id TEXT,
        query_hash TEXT NOT NULL,
        scope_set_json TEXT NOT NULL,
        requested_budget_tokens INTEGER NOT NULL,
        used_tokens INTEGER NOT NULL,
        injected_count INTEGER NOT NULL,
        injected_engram_ids_json TEXT NOT NULL DEFAULT '[]',
        policy_filtered_count INTEGER NOT NULL DEFAULT 0,
        secret_filtered_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mem_receipts_created ON memory_injection_receipts(created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_agent_adapters (
        id TEXT PRIMARY KEY,
        adapter_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        auto_inject INTEGER NOT NULL DEFAULT 0,
        auto_learn INTEGER NOT NULL DEFAULT 0,
        default_scope TEXT,
        trust_level TEXT NOT NULL DEFAULT 'standard',
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_approvals (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        decision TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_conflicts (
        id TEXT PRIMARY KEY,
        engram_a_id TEXT NOT NULL,
        engram_b_id TEXT,
        conflict_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolution TEXT,
        detected_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_audit_events (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        agent_id TEXT,
        scope TEXT,
        decision TEXT NOT NULL,
        engram_registry_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mem_audit_corr ON memory_audit_events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_mem_audit_created ON memory_audit_events(created_at DESC);

      -- v44: Pao Agent Platform (Phase 20.54)
      CREATE TABLE IF NOT EXISTS ap_agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, owner TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, manifest_json TEXT NOT NULL, registered_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_capabilities (id TEXT PRIMARY KEY, description TEXT NOT NULL, risk_level TEXT NOT NULL, mutability TEXT NOT NULL, approval_default TEXT NOT NULL, sandbox_required INTEGER NOT NULL DEFAULT 0, receipt_required INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ap_agent_capabilities (agent_id TEXT NOT NULL, capability_id TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (agent_id, capability_id));
      CREATE TABLE IF NOT EXISTS ap_platform_tasks (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, goal TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_tool_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, tool_id TEXT NOT NULL, capability_id TEXT NOT NULL, arguments_hash TEXT, status TEXT NOT NULL, result_hash TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_policy_decisions (id TEXT PRIMARY KEY, task_id TEXT, agent_id TEXT, capability_id TEXT, decision TEXT NOT NULL, reason_code TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_platform_approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, capability_id TEXT NOT NULL, target TEXT, arguments_hash TEXT, risk_level TEXT NOT NULL, status TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, requested_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_audit_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, task_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_crypto_receipts (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, signature TEXT NOT NULL, signing_key_id TEXT NOT NULL, previous_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ap_receipts_agent ON ap_crypto_receipts(agent_id, created_at);
      CREATE TABLE IF NOT EXISTS ap_agent_memories (id TEXT PRIMARY KEY, memory_type TEXT NOT NULL, scope TEXT NOT NULL, content TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL, sensitivity TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ap_agent_evaluations (id TEXT PRIMARY KEY, suite TEXT NOT NULL, passed INTEGER NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL);

      -- v45: Mobile runtime (Phase 20.55)
      CREATE TABLE IF NOT EXISTS mobile_approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, device_id TEXT, risk_level TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT, resolved_by TEXT, reason TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_mobile_approvals_task ON mobile_approvals(task_id);
      CREATE TABLE IF NOT EXISTS mobile_trace_events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, trace_id TEXT, step INTEGER, event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_mobile_trace_task ON mobile_trace_events(task_id);
      CREATE TABLE IF NOT EXISTS mobile_device_leases (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, task_id TEXT NOT NULL, owner TEXT NOT NULL, acquired_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, released_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_mobile_leases_device ON mobile_device_leases(device_id, released_at);

      -- v46: Micro-App Capability Lab (Phase 20.56)
      CREATE TABLE IF NOT EXISTS cap_sources (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, local_path TEXT NOT NULL, snapshot_path TEXT NOT NULL, source_sha256 TEXT NOT NULL, license_spdx TEXT, imported_by TEXT, imported_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS cap_recipes (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, name TEXT NOT NULL, file_path TEXT NOT NULL, entrypoint TEXT, candidate_type TEXT NOT NULL, summary TEXT, status TEXT NOT NULL, analysis_json TEXT NOT NULL, risk_score INTEGER, risk_level TEXT, recommendation TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cap_capabilities (id TEXT PRIMARY KEY, capability_key TEXT NOT NULL UNIQUE, namespace TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL, recipe_id TEXT, version TEXT NOT NULL, channel TEXT NOT NULL, manifest_json TEXT NOT NULL, adapters_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cap_reviews (id TEXT PRIMARY KEY, capability_key TEXT NOT NULL, reviewer_id TEXT, decision TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cap_runs (id TEXT PRIMARY KEY, capability_key TEXT NOT NULL, version TEXT NOT NULL, caller_type TEXT NOT NULL, status TEXT NOT NULL, policy_decision TEXT, output_json TEXT, error_code TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS cap_artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, uri TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER, mime_type TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_cap_recipes_source ON cap_recipes(source_id);
      CREATE INDEX IF NOT EXISTS idx_cap_runs_key ON cap_runs(capability_key, started_at);

      -- v47: Skill Gate control plane (Phase 20.57)
      CREATE TABLE IF NOT EXISTS sg_sources (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, display_name TEXT NOT NULL, repository_url TEXT, default_ref TEXT, trust_level TEXT NOT NULL DEFAULT 'unknown', enabled INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sg_skills (id TEXT PRIMARY KEY, namespace TEXT NOT NULL, slug TEXT NOT NULL, display_name TEXT NOT NULL, description TEXT, source_id TEXT, status TEXT NOT NULL, current_version TEXT, publisher TEXT, license_spdx TEXT, trust_level TEXT NOT NULL DEFAULT 'unknown', risk_level TEXT, tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(namespace, slug));
      CREATE INDEX IF NOT EXISTS idx_sg_skills_status ON sg_skills(status);
      CREATE INDEX IF NOT EXISTS idx_sg_skills_source ON sg_skills(source_id);
      CREATE TABLE IF NOT EXISTS sg_skill_versions (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version TEXT NOT NULL, source_ref TEXT, source_commit TEXT, source_path TEXT, manifest_json TEXT NOT NULL, content_sha256 TEXT NOT NULL, snapshot_dir TEXT NOT NULL, scanner_version TEXT, scan_status TEXT NOT NULL DEFAULT 'pending', risk_score INTEGER, risk_level TEXT, approval_status TEXT NOT NULL DEFAULT 'not_required', immutable INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, published_at TEXT, published_by TEXT, UNIQUE(skill_id, version));
      CREATE INDEX IF NOT EXISTS idx_sg_versions_skill ON sg_skill_versions(skill_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sg_skill_files (id TEXT PRIMARY KEY, skill_version_id TEXT NOT NULL, relative_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(skill_version_id, relative_path));
      CREATE INDEX IF NOT EXISTS idx_sg_files_version ON sg_skill_files(skill_version_id);
      CREATE TABLE IF NOT EXISTS sg_scan_findings (id TEXT PRIMARY KEY, skill_version_id TEXT NOT NULL, rule_id TEXT NOT NULL, severity TEXT NOT NULL, file_path TEXT, line_start INTEGER, line_end INTEGER, evidence_hash TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sg_findings_version ON sg_scan_findings(skill_version_id);
      CREATE TABLE IF NOT EXISTS sg_agents (id TEXT PRIMARY KEY, agent_type TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, adapter_version TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, detected INTEGER NOT NULL DEFAULT 0, capabilities_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sg_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'ssh', hostname TEXT, port INTEGER, username TEXT, auth_ref TEXT, host_key_fingerprint TEXT, environment TEXT, status TEXT NOT NULL DEFAULT 'unknown', allowed_roots_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sg_deployments (id TEXT PRIMARY KEY, skill_version_id TEXT NOT NULL, node_id TEXT, agent_type TEXT NOT NULL, scope TEXT NOT NULL, project_path TEXT, target_path TEXT NOT NULL, desired_sha256 TEXT NOT NULL, actual_sha256 TEXT, status TEXT NOT NULL, managed INTEGER NOT NULL DEFAULT 1, deployed_by TEXT, deployed_at TEXT, verified_at TEXT, plan_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sg_deploy_skill ON sg_deployments(skill_version_id);
      CREATE INDEX IF NOT EXISTS idx_sg_deploy_status ON sg_deployments(status);
      CREATE TABLE IF NOT EXISTS sg_snapshots (id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, reason TEXT NOT NULL, file_index_json TEXT NOT NULL, snapshot_dir TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sg_snapshots_deploy ON sg_snapshots(deployment_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sg_drift_events (id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, drift_type TEXT NOT NULL, expected_sha256 TEXT, actual_sha256 TEXT, details_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open', detected_at TEXT NOT NULL, resolved_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_sg_drift_deploy ON sg_drift_events(deployment_id, detected_at DESC);
      CREATE TABLE IF NOT EXISTS sg_reviews (id TEXT PRIMARY KEY, skill_version_id TEXT NOT NULL, requested_action TEXT NOT NULL, requested_targets_json TEXT NOT NULL DEFAULT '[]', risk_snapshot_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT NOT NULL, reviewed_by TEXT, decision_reason TEXT, constraints_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, decided_at TEXT, expires_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_sg_reviews_version ON sg_reviews(skill_version_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sg_audit (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, skill_id TEXT, skill_version_id TEXT, deployment_id TEXT, node_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sg_audit_created ON sg_audit(created_at DESC);

      -- v48: Social Publishing control plane (Phase 20.60, OpenPost integration)
      CREATE TABLE IF NOT EXISTS sp_openpost_instances (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, auth_mode TEXT NOT NULL DEFAULT 'bearer_token', secret_ref TEXT NOT NULL, mcp_endpoint TEXT, mcp_scope TEXT, transport TEXT NOT NULL DEFAULT 'hybrid', status TEXT NOT NULL DEFAULT 'unknown', version TEXT, last_health_at TEXT, last_error_code TEXT, last_error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sp_accounts (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, openpost_workspace_ref TEXT NOT NULL, openpost_account_ref TEXT NOT NULL, platform TEXT NOT NULL, display_name TEXT, username TEXT, readiness_state TEXT NOT NULL DEFAULT 'unknown', readiness_reason TEXT, enabled INTEGER NOT NULL DEFAULT 1, capability_json TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(instance_id, openpost_account_ref));
      CREATE INDEX IF NOT EXISTS idx_sp_accounts_instance ON sp_accounts(instance_id, platform);
      CREATE TABLE IF NOT EXISTS sp_publications (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, asset_ids_json TEXT NOT NULL DEFAULT '[]', master_title TEXT, master_caption TEXT, master_description TEXT, master_tags_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', risk_level TEXT NOT NULL DEFAULT 'normal', approval_mode TEXT NOT NULL DEFAULT 'human_required', scheduled_at TEXT, timezone TEXT NOT NULL DEFAULT 'UTC', created_by_type TEXT NOT NULL, created_by_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sp_publications_status ON sp_publications(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS sp_publication_assets (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, local_asset_id TEXT NOT NULL, openpost_media_ref TEXT, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER, provenance_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(publication_id, local_asset_id));
      CREATE INDEX IF NOT EXISTS idx_sp_assets_publication ON sp_publication_assets(publication_id);
      CREATE TABLE IF NOT EXISTS sp_renditions (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, account_id TEXT NOT NULL, platform TEXT NOT NULL, format TEXT NOT NULL, title TEXT, caption TEXT, description TEXT, hashtags_json TEXT NOT NULL DEFAULT '[]', asset_refs_json TEXT NOT NULL DEFAULT '[]', provider_settings_json TEXT NOT NULL DEFAULT '{}', scheduled_at TEXT, capability_snapshot_json TEXT NOT NULL DEFAULT '{}', capability_snapshot_at TEXT NOT NULL, validation_status TEXT NOT NULL DEFAULT 'unvalidated', validation_issues_json TEXT NOT NULL DEFAULT '[]', approval_status TEXT NOT NULL DEFAULT 'pending', content_hash TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'draft', openpost_publication_ref TEXT, openpost_rendition_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(publication_id, account_id));
      CREATE INDEX IF NOT EXISTS idx_sp_renditions_publication ON sp_renditions(publication_id);
      CREATE INDEX IF NOT EXISTS idx_sp_renditions_delivery ON sp_renditions(delivery_status);
      CREATE TABLE IF NOT EXISTS sp_policy_evaluations (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, rendition_id TEXT, policy_version TEXT NOT NULL, effect TEXT NOT NULL, rule_results_json TEXT NOT NULL, evaluated_by TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sp_policy_publication ON sp_policy_evaluations(publication_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sp_approvals (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, rendition_id TEXT, decision TEXT NOT NULL, approver_type TEXT NOT NULL, approver_id TEXT NOT NULL, approval_scope TEXT NOT NULL, content_hash TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sp_approvals_publication ON sp_approvals(publication_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sp_delivery_jobs (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, rendition_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, job_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, next_attempt_at TEXT, locked_at TEXT, locked_by TEXT, last_error_class TEXT, last_error_code TEXT, last_error_message TEXT, remote_operation_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sp_jobs_status ON sp_delivery_jobs(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_sp_jobs_publication ON sp_delivery_jobs(publication_id);
      CREATE TABLE IF NOT EXISTS sp_analytics_snapshots (id TEXT PRIMARY KEY, publication_id TEXT, rendition_id TEXT, account_id TEXT NOT NULL, captured_at TEXT NOT NULL, views INTEGER, impressions INTEGER, reach INTEGER, engagements INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, followers_delta INTEGER, raw_metrics_json TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS idx_sp_analytics_account ON sp_analytics_snapshots(account_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sp_analytics_publication ON sp_analytics_snapshots(publication_id, captured_at DESC);
      CREATE TABLE IF NOT EXISTS sp_audit (id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, policy_effect TEXT, approval_ref TEXT, instance_id TEXT, remote_ref TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sp_audit_created ON sp_audit(created_at DESC);

      -- v49: Agent Runtime control plane (Phase 20.61, amux integration)
      CREATE TABLE IF NOT EXISTS ar_tasks (id TEXT PRIMARY KEY, parent_task_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, acceptance_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', priority INTEGER NOT NULL DEFAULT 50, role TEXT NOT NULL DEFAULT 'implementer', claim_owner TEXT, claim_token TEXT, claim_version INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, lease_expires_at TEXT, heartbeat_at TEXT, attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, runtime_provider TEXT, runtime_task_id TEXT, runtime_session_id TEXT, policy_profile TEXT NOT NULL DEFAULT 'restricted-dev', requires_human_approval INTEGER NOT NULL DEFAULT 1, repo_root TEXT, worktree_path TEXT, branch TEXT, checkpoint_json TEXT NOT NULL DEFAULT '{}', created_by_type TEXT NOT NULL DEFAULT 'human', created_by_id TEXT NOT NULL DEFAULT 'operator', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ar_tasks_status ON ar_tasks(status, priority);
      CREATE TABLE IF NOT EXISTS ar_workers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, roles_json TEXT NOT NULL DEFAULT '[]', capabilities_json TEXT NOT NULL DEFAULT '[]', max_concurrency INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'unknown', runtime_worker_id TEXT, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ar_sessions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, worker_id TEXT NOT NULL, runtime_session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, heartbeat_at TEXT, ended_at TEXT, exit_reason TEXT);
      CREATE INDEX IF NOT EXISTS idx_ar_sessions_task ON ar_sessions(task_id);
      CREATE TABLE IF NOT EXISTS ar_task_evidence (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, evidence_type TEXT NOT NULL, uri TEXT, sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ar_evidence_task ON ar_task_evidence(task_id);
      CREATE TABLE IF NOT EXISTS ar_approval_requests (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL, risk_level TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, decision_reason TEXT, payload_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ar_approvals_task ON ar_approval_requests(task_id, status);
      CREATE TABLE IF NOT EXISTS ar_execution_audit (id TEXT PRIMARY KEY, task_id TEXT, session_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, decision TEXT NOT NULL, request_hash TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ar_audit_created ON ar_execution_audit(created_at DESC);
      CREATE TABLE IF NOT EXISTS ar_idempotency_keys (key TEXT PRIMARY KEY, operation TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT, status TEXT NOT NULL DEFAULT 'completed', expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ar_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, task_id TEXT, session_id TEXT, source TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ar_events_task ON ar_events(task_id, occurred_at DESC);

      -- v50: Code Intelligence control plane (Phase 20.62, Graft integration)
      CREATE TABLE IF NOT EXISTS ci_repositories (id TEXT PRIMARY KEY, name TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE, repo_type TEXT NOT NULL DEFAULT 'single', vcs_type TEXT NOT NULL DEFAULT 'git', remote_url TEXT, default_branch TEXT, trust_level TEXT NOT NULL DEFAULT 'trusted', sensitivity TEXT NOT NULL DEFAULT 'normal', indexing_enabled INTEGER NOT NULL DEFAULT 1, deep_enrichment_enabled INTEGER NOT NULL DEFAULT 0, provider_key TEXT NOT NULL DEFAULT 'graft', graph_state TEXT NOT NULL DEFAULT 'uninitialized', last_build_at TEXT, last_fingerprint TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ci_workspace_repositories (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repository_id TEXT NOT NULL, alias TEXT, cross_repo_trace_enabled INTEGER NOT NULL DEFAULT 0, trust_boundary TEXT NOT NULL DEFAULT 'trusted', created_at TEXT NOT NULL, UNIQUE(workspace_id, repository_id));
      CREATE TABLE IF NOT EXISTS ci_graph_builds (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, provider TEXT NOT NULL, provider_version TEXT, build_mode TEXT NOT NULL DEFAULT 'structural', status TEXT NOT NULL DEFAULT 'started', fingerprint TEXT, started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, indexed_files INTEGER, indexed_symbols INTEGER, error_code TEXT, error_summary TEXT);
      CREATE INDEX IF NOT EXISTS idx_ci_builds_repo ON ci_graph_builds(repository_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS ci_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, graph_build_id TEXT, operation TEXT NOT NULL, request_fingerprint TEXT NOT NULL, request_json TEXT NOT NULL DEFAULT '{}', result_digest TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', freshness_state TEXT NOT NULL DEFAULT 'unavailable', provider TEXT NOT NULL, provider_version TEXT, actor_id TEXT NOT NULL, task_id TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ci_evidence_repo ON ci_evidence(repository_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ci_impact_reports (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, task_id TEXT, worktree_path TEXT, requested_by TEXT NOT NULL, target_type TEXT NOT NULL, target_ref TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'in', depth INTEGER NOT NULL DEFAULT 2, graph_build_id TEXT, freshness_state TEXT NOT NULL DEFAULT 'missing', fingerprint TEXT, direct_dependency_count INTEGER NOT NULL DEFAULT 0, transitive_dependency_count INTEGER NOT NULL DEFAULT 0, cross_repo_dependency_count INTEGER NOT NULL DEFAULT 0, affected_tests_json TEXT NOT NULL DEFAULT '[]', protected_json TEXT NOT NULL DEFAULT '[]', risk_score INTEGER NOT NULL DEFAULT 0, risk_level TEXT NOT NULL DEFAULT 'low', policy_decision TEXT NOT NULL DEFAULT 'allow', factors_json TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT 'graft', reduced_confidence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ci_impact_repo ON ci_impact_reports(repository_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ci_impact_risk ON ci_impact_reports(risk_level);
      CREATE TABLE IF NOT EXISTS ci_provider_status (id TEXT PRIMARY KEY, provider_key TEXT NOT NULL, repository_id TEXT, detected_version TEXT, expected_version_range TEXT, runtime_version TEXT, status TEXT NOT NULL DEFAULT 'unavailable', last_health_check_at TEXT, last_success_at TEXT, last_error_code TEXT, last_error_summary TEXT, capabilities_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ci_audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, decision TEXT NOT NULL, repository_id TEXT, actor_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_ci_audit_created ON ci_audit(created_at DESC);

      -- v51: External Capability Registry (Phase 20.63, Public APIs integration)
      CREATE TABLE IF NOT EXISTS eap_sources (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, source_url TEXT NOT NULL, parser_version TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eap_snapshots (id TEXT PRIMARY KEY, source_key TEXT NOT NULL, upstream_revision TEXT NOT NULL, content_sha256 TEXT NOT NULL, parse_status TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0, category_count INTEGER NOT NULL DEFAULT 0, warnings_json TEXT NOT NULL DEFAULT '{}', last_known_good INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL, UNIQUE(source_key, content_sha256));
      CREATE TABLE IF NOT EXISTS eap_providers (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT, homepage_url TEXT, docs_url TEXT, hostname TEXT NOT NULL, source_category TEXT, categories_json TEXT NOT NULL DEFAULT '[]', auth_label TEXT, auth_type TEXT NOT NULL DEFAULT 'none', upstream_https INTEGER, upstream_cors TEXT, lifecycle TEXT NOT NULL DEFAULT 'discovered', health TEXT NOT NULL DEFAULT 'unknown', trust_score INTEGER, risk_score INTEGER, trust_confidence INTEGER, source_presence TEXT NOT NULL DEFAULT 'active', source_snapshot_id TEXT, raw_json TEXT NOT NULL DEFAULT '{}', aliases_json TEXT NOT NULL DEFAULT '[]', circuit TEXT NOT NULL DEFAULT 'closed', last_observed_at TEXT, approved_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_eap_providers_lifecycle ON eap_providers(lifecycle, hostname);
      CREATE TABLE IF NOT EXISTS eap_operations (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, operation_key TEXT NOT NULL, http_method TEXT NOT NULL, path_template TEXT NOT NULL, server_url TEXT, summary TEXT, mutating INTEGER NOT NULL DEFAULT 0, auth_required INTEGER NOT NULL DEFAULT 0, data_classes_json TEXT NOT NULL DEFAULT '[]', risk_level TEXT NOT NULL DEFAULT 'high', lifecycle TEXT NOT NULL DEFAULT 'discovered', capabilities_json TEXT NOT NULL DEFAULT '[]', spec_snapshot_id TEXT, request_schema_json TEXT, response_schema_json TEXT, cacheable INTEGER NOT NULL DEFAULT 0, cache_ttl_seconds INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider_id, operation_key));
      CREATE INDEX IF NOT EXISTS idx_eap_operations_provider ON eap_operations(provider_id);
      CREATE TABLE IF NOT EXISTS eap_credential_profiles (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, auth_type TEXT NOT NULL, secret_ref TEXT, scopes_json TEXT NOT NULL DEFAULT '[]', environment TEXT NOT NULL DEFAULT 'test', owner_type TEXT NOT NULL DEFAULT 'workspace', owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', header_name TEXT NOT NULL DEFAULT 'Authorization', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eap_tools (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, tool_name TEXT NOT NULL UNIQUE, display_name TEXT, input_schema_json TEXT NOT NULL DEFAULT '{}', risk_level TEXT NOT NULL, mutating INTEGER NOT NULL DEFAULT 0, approval_mode TEXT NOT NULL DEFAULT 'always', enabled INTEGER NOT NULL DEFAULT 0, spec_snapshot_id TEXT, policy_version TEXT NOT NULL, contract_tested INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eap_health_checks (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, latency_ms INTEGER, error_code TEXT, url TEXT, checked_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_eap_health_provider ON eap_health_checks(provider_id, checked_at DESC);
      CREATE TABLE IF NOT EXISTS eap_runtime_calls (id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, provider_id TEXT NOT NULL, operation_id TEXT NOT NULL, tool_id TEXT, policy_decision TEXT NOT NULL, outcome TEXT NOT NULL, http_status INTEGER, latency_ms INTEGER, request_json TEXT NOT NULL DEFAULT '{}', response_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_eap_calls_provider ON eap_runtime_calls(provider_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS eap_audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, decision TEXT NOT NULL, provider_id TEXT, actor_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_eap_audit_created ON eap_audit(created_at DESC);

      -- v52: Deterministic code review runtime (GOLD slice on the Phase 20.81 contract)
      CREATE TABLE IF NOT EXISTS cr_sessions (id TEXT PRIMARY KEY, repository_path TEXT NOT NULL, mode TEXT NOT NULL, from_ref TEXT, to_ref TEXT, commit_sha TEXT, head_sha TEXT, diff_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', gate TEXT, critical_count INTEGER NOT NULL DEFAULT 0, high_count INTEGER NOT NULL DEFAULT 0, medium_count INTEGER NOT NULL DEFAULT 0, protected_path_changed INTEGER NOT NULL DEFAULT 0, policy_version TEXT NOT NULL, rule_hash TEXT NOT NULL, error_code TEXT, requested_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, parent_session_id TEXT, revision INTEGER NOT NULL DEFAULT 1, delegated_findings INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS idx_cr_sessions_diff ON cr_sessions(repository_path, mode, diff_hash);
      CREATE INDEX IF NOT EXISTS idx_cr_sessions_created ON cr_sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cr_sessions_parent ON cr_sessions(parent_session_id);
      CREATE TABLE IF NOT EXISTS cr_findings (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, unit_id TEXT, path TEXT NOT NULL, start_line INTEGER, end_line INTEGER, category TEXT NOT NULL, subcategory TEXT, severity TEXT NOT NULL, confidence REAL NOT NULL, title TEXT NOT NULL, description TEXT, evidence TEXT, suggestion TEXT, status TEXT NOT NULL DEFAULT 'open', source TEXT NOT NULL DEFAULT 'deterministic', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_cr_findings_session ON cr_findings(session_id);
      CREATE TABLE IF NOT EXISTS cr_gate_results (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, gate TEXT NOT NULL, reasons_json TEXT NOT NULL DEFAULT '[]', decided_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_cr_gate_session ON cr_gate_results(session_id);

      -- v54: Model Gateway (Phase 20.85 OmniRoute), Decision Runtime (Phase 20.84 TypeSafe Jev) & Core Persistence Layer
      CREATE TABLE IF NOT EXISTS gw_providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, family TEXT NOT NULL, endpoint_url TEXT NOT NULL, auth_type TEXT NOT NULL, is_local INTEGER NOT NULL DEFAULT 0, health_status TEXT NOT NULL DEFAULT 'healthy', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gw_models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, model_family TEXT NOT NULL, is_local INTEGER NOT NULL DEFAULT 0, context_window INTEGER NOT NULL, input_price_per_m REAL, output_price_per_m REAL, pricing_status TEXT NOT NULL DEFAULT 'known', status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gw_model_capabilities (model_id TEXT NOT NULL, capability TEXT NOT NULL, PRIMARY KEY(model_id, capability));
      CREATE TABLE IF NOT EXISTS gw_routes (route_group TEXT PRIMARY KEY, policy_type TEXT NOT NULL, candidates_json TEXT NOT NULL, required_capabilities TEXT NOT NULL, max_budget_usd REAL, local_only INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gw_routing_decisions (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT NOT NULL, task_type TEXT NOT NULL, route_group TEXT NOT NULL, resolved_provider TEXT NOT NULL, resolved_model TEXT NOT NULL, model_family TEXT NOT NULL, data_class TEXT NOT NULL, local_only INTEGER NOT NULL DEFAULT 0, candidate_scores_json TEXT, decision_reasons_json TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_gw_routing_req ON gw_routing_decisions(request_id);
      CREATE TABLE IF NOT EXISTS gw_usage (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT NOT NULL, workspace_id TEXT, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_gw_usage_req ON gw_usage(request_id);
      CREATE TABLE IF NOT EXISTS gw_costs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, task_id TEXT, actor_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, cost_usd REAL NOT NULL, is_retry INTEGER NOT NULL DEFAULT 0, is_fallback INTEGER NOT NULL DEFAULT 0, pricing_status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_gw_costs_task ON gw_costs(task_id);
      CREATE TABLE IF NOT EXISTS gw_quotas (provider_id TEXT PRIMARY KEY, quota_type TEXT NOT NULL, remaining REAL, reset_at TEXT, last_synced_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gw_circuits (provider TEXT PRIMARY KEY, state TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, opened_at TEXT, cooldown_until TEXT, last_reason TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gw_task_attempts (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, error_class TEXT, error_message TEXT, latency_ms INTEGER NOT NULL, cost_usd REAL NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_gw_task_attempts_task ON gw_task_attempts(task_id);
      CREATE TABLE IF NOT EXISTS gw_audit_records (request_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, workspace_id TEXT, task_type TEXT NOT NULL, route_group TEXT NOT NULL, resolved_provider TEXT NOT NULL, resolved_model TEXT NOT NULL, model_family TEXT, data_class TEXT NOT NULL, local_only INTEGER NOT NULL DEFAULT 0, attempts_count INTEGER NOT NULL DEFAULT 1, attempts_json TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL NOT NULL DEFAULT 0.0, pricing_status TEXT NOT NULL, latency_ms INTEGER NOT NULL, status TEXT NOT NULL, policy_decision_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_gw_audit_created ON gw_audit_records(created_at DESC);

      -- Decision Intelligence Runtime (Phase 20.84 TypeSafe Jev)
      CREATE TABLE IF NOT EXISTS dec_contracts (contract_id TEXT PRIMARY KEY, version TEXT NOT NULL, category TEXT NOT NULL, risk_tier TEXT NOT NULL, threshold_profile TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'shadow', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dec_audit_records (request_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, contract_id TEXT NOT NULL, contract_version TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, state_hash TEXT NOT NULL, state_json TEXT NOT NULL, selected_choice TEXT NOT NULL, confidence REAL NOT NULL, candidates_json TEXT NOT NULL, disposition TEXT NOT NULL, hard_policy_denied INTEGER NOT NULL DEFAULT 0, hard_policy_reasons TEXT, latency_ms INTEGER NOT NULL, cost_usd REAL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_dec_audit_contract ON dec_audit_records(contract_id);
      CREATE TABLE IF NOT EXISTS dec_calibration_stats (contract_id TEXT NOT NULL, profile TEXT NOT NULL, sample_count INTEGER NOT NULL, brier_score REAL NOT NULL, ece REAL NOT NULL, accuracy REAL NOT NULL, false_allow_rate REAL NOT NULL, false_deny_rate REAL NOT NULL, last_evaluated_at TEXT NOT NULL, PRIMARY KEY(contract_id, profile));

      -- Core Durable Persistence Layer
      CREATE TABLE IF NOT EXISTS core_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'developer', display_name TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, policy_profile TEXT NOT NULL DEFAULT 'standard', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_sessions (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, actor_id TEXT NOT NULL, session_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_agent_runs (id TEXT PRIMARY KEY, session_id TEXT, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', prompt TEXT, result_json TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS core_task_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, worker_id TEXT, status TEXT NOT NULL, error_details TEXT, started_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE IF NOT EXISTS core_tools (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, capability TEXT NOT NULL, risk_level TEXT NOT NULL, mutability TEXT NOT NULL, approval_required INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, transport TEXT NOT NULL DEFAULT 'stdio', command TEXT, url TEXT, trust_score INTEGER NOT NULL DEFAULT 100, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_tool_executions (id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, server_id TEXT, actor_id TEXT NOT NULL, task_id TEXT, arguments_hash TEXT, arguments_json TEXT, status TEXT NOT NULL, result_json TEXT, execution_time_ms INTEGER NOT NULL, approved_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_secrets_metadata (id TEXT PRIMARY KEY, key_name TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, vault_ref TEXT NOT NULL, algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM', owner_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, rotated_at TEXT);
      CREATE TABLE IF NOT EXISTS core_reviewer_runs (id TEXT PRIMARY KEY, diff_hash TEXT NOT NULL, request_source TEXT NOT NULL, reviewer_identities_json TEXT NOT NULL, distinct_families_count INTEGER NOT NULL, correlated INTEGER NOT NULL DEFAULT 0, consensus_verdict TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_reviewer_votes (id TEXT PRIMARY KEY, reviewer_run_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, model_family TEXT NOT NULL, verdict TEXT NOT NULL, findings_count INTEGER NOT NULL, confidence REAL NOT NULL, vote_weight REAL NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_artifacts (id TEXT PRIMARY KEY, session_id TEXT, task_id TEXT, name TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_jobs (id TEXT PRIMARY KEY, job_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 50, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

      -- v55: Sensorimotor runtime (Phase 20.82 CortexKit AFT) — perception → plan → act → observe loop
      CREATE TABLE IF NOT EXISTS sm_sessions (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', goal TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sm_perceptions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, workspace_root TEXT NOT NULL, files_json TEXT NOT NULL, symbol_count INTEGER NOT NULL DEFAULT 0, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sm_perceptions_session ON sm_perceptions(session_id, created_at);
      CREATE TABLE IF NOT EXISTS sm_actions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, perception_id TEXT, kind TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 3, checkpoint_json TEXT NOT NULL DEFAULT '{}', error_code TEXT, error_message TEXT, timeout_ms INTEGER NOT NULL DEFAULT 30000, verified INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sm_actions_session ON sm_actions(session_id, created_at);
      CREATE TABLE IF NOT EXISTS sm_observations (id TEXT PRIMARY KEY, action_id TEXT NOT NULL, session_id TEXT NOT NULL, outcome TEXT NOT NULL, health_delta_json TEXT NOT NULL DEFAULT '{}', content_hash TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sm_observations_action ON sm_observations(action_id);
      CREATE TABLE IF NOT EXISTS sm_checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action_id TEXT, snapshot_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sm_checkpoints_session ON sm_checkpoints(session_id, created_at);
      CREATE TABLE IF NOT EXISTS sm_audit (id TEXT PRIMARY KEY, session_id TEXT, action_id TEXT, actor_id TEXT NOT NULL, event TEXT NOT NULL, decision TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sm_audit_created ON sm_audit(created_at);
      -- v56: AFT idempotency ledger — one terminal outcome per caller-supplied idempotency key
      CREATE TABLE IF NOT EXISTS sm_idempotency (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, action_id TEXT NOT NULL, created_at TEXT NOT NULL);

      -- v57: Phase 20.89 Capability Hub (Bubble) — registry-first capability supply chain.
      -- Prefix mk_* (marketplace): the cap_* namespace is owned by the LIVE Phase 20.56
      -- Micro-App Capability Lab (cap_capabilities/cap_sources/cap_recipes/cap_runs at
      -- schema v46) — reusing it would collide with a working subsystem (mission §31:
      -- reuse > refactor > rewrite; never break working implementation).
      -- Reused from earlier schemas, never duplicated here: policies, approvals,
      -- core_secrets_metadata, gw_providers/gw_models (20.85), core_mcp_servers (20.74).
      CREATE TABLE IF NOT EXISTS mk_capabilities (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, phase_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, summary TEXT, status TEXT NOT NULL DEFAULT 'DISCOVERED', visibility TEXT NOT NULL DEFAULT 'private', icon_url TEXT, homepage_url TEXT, repository_url TEXT, license_spdx TEXT, publisher_name TEXT, trust_state TEXT NOT NULL DEFAULT 'unverified', risk_class TEXT NOT NULL DEFAULT 'unknown', latest_version_id TEXT, blueprint_path TEXT, blueprint_status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_capability_versions (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, version TEXT NOT NULL, source_ref TEXT, manifest_json TEXT NOT NULL, manifest_hash TEXT NOT NULL, checksum_sha256 TEXT, release_notes TEXT, created_at TEXT NOT NULL, UNIQUE(capability_id, version));
      CREATE TABLE IF NOT EXISTS mk_capability_sources (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, source_type TEXT NOT NULL, source_url TEXT, source_repository TEXT, source_commit TEXT, source_release TEXT, imported_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'ok');
      CREATE TABLE IF NOT EXISTS mk_capability_dependencies (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'MISSING');
      CREATE TABLE IF NOT EXISTS mk_capability_permissions (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, permission TEXT NOT NULL, scope TEXT, origin TEXT NOT NULL DEFAULT 'manifest');
      CREATE TABLE IF NOT EXISTS mk_capability_manifests (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, manifest_hash TEXT NOT NULL, yaml_text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_capability_installations (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, version_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'INSTALLING', enabled INTEGER NOT NULL DEFAULT 0, installed_at TEXT NOT NULL, last_health_state TEXT NOT NULL DEFAULT 'UNKNOWN', last_health_at TEXT, snapshot_ref TEXT);
      CREATE TABLE IF NOT EXISTS mk_install_transactions (id TEXT PRIMARY KEY, installation_id TEXT, plan_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PLANNED', steps_json TEXT NOT NULL DEFAULT '[]', snapshot_ref TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_snapshots (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_rollback_records (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, installation_id TEXT NOT NULL, restored_state TEXT NOT NULL, reason TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_capability_health (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, check_type TEXT NOT NULL, state TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_capability_audits (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor TEXT NOT NULL, capability_slug TEXT, version TEXT, operation TEXT NOT NULL, plan_id TEXT, policy_decision TEXT, approval_id TEXT, result TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_collections (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'manual', description TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_collection_items (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, capability_id TEXT NOT NULL, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_favorites (id TEXT PRIMARY KEY, actor TEXT NOT NULL, capability_id TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_phase_blueprints (id TEXT PRIMARY KEY, phase_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, blueprint_path TEXT NOT NULL, blueprint_status TEXT NOT NULL DEFAULT 'DRAFT', capability_id TEXT, supersedes_phase TEXT, superseded_by_phase TEXT, note TEXT, scanned_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mk_phase_imports (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_mk_capabilities_phase ON mk_capabilities(phase_id);
      CREATE INDEX IF NOT EXISTS idx_mk_capabilities_status ON mk_capabilities(status);
      CREATE INDEX IF NOT EXISTS idx_mk_audits_created ON mk_capability_audits(created_at);
      CREATE INDEX IF NOT EXISTS idx_mk_health_capability ON mk_capability_health(capability_id, created_at);

      -- v58: Phase 20.91b Engineering Skill Runtime (Addy Osmani Agent Skills; proposed
      -- renumber 20.93 — collision with 20.91a Apra Fleet pending user decision).
      -- Prefix esk_* (engineering skills): additive to the Phase 08 Skill Store (sk_*
      -- owned by SkillsGate) and the marketplace mk_* namespace — no reuse, no collision.
      CREATE TABLE IF NOT EXISTS esk_packs (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_url TEXT, source_type TEXT NOT NULL, version TEXT, resolved_commit TEXT NOT NULL, license TEXT, trust_status TEXT NOT NULL DEFAULT 'quarantined', lifecycle_status TEXT NOT NULL DEFAULT 'QUARANTINED', manifest_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS esk_pack_versions (id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, version TEXT NOT NULL, resolved_commit TEXT NOT NULL, manifest_hash TEXT NOT NULL, lifecycle_status TEXT NOT NULL, skills_json TEXT NOT NULL DEFAULT '[]', note TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS esk_skills (id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT, entrypoint TEXT NOT NULL, lifecycle_stage_json TEXT NOT NULL, triggers_json TEXT NOT NULL, capabilities_json TEXT NOT NULL, permissions_json TEXT NOT NULL, meta_json TEXT NOT NULL DEFAULT '{}', risk_level TEXT NOT NULL, source_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(pack_id, slug));
      CREATE TABLE IF NOT EXISTS esk_workflows (id TEXT PRIMARY KEY, task_id TEXT, title TEXT NOT NULL, task_text TEXT NOT NULL, status TEXT NOT NULL, current_stage TEXT NOT NULL, provider TEXT, model TEXT, route_json TEXT NOT NULL, risk_level TEXT NOT NULL, stop_reason TEXT, rollback_target TEXT, started_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS esk_workflow_steps (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, skill_id TEXT, stage TEXT NOT NULL, status TEXT NOT NULL, input_hash TEXT, output_hash TEXT, started_at TEXT, completed_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_esk_steps_workflow ON esk_workflow_steps(workflow_id, started_at);
      CREATE TABLE IF NOT EXISTS esk_evidence (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, step_id TEXT, type TEXT NOT NULL, producer TEXT NOT NULL, command TEXT, exit_code INTEGER, artifact_uri TEXT, sha256 TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_esk_evidence_workflow ON esk_evidence(workflow_id, created_at);
      CREATE TABLE IF NOT EXISTS esk_review_findings (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, reviewer_type TEXT NOT NULL, reviewer_identity TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL, blocking INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, detail TEXT, location_json TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, resolved_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_esk_findings_workflow ON esk_review_findings(workflow_id, created_at);
      CREATE TABLE IF NOT EXISTS esk_policy_decisions (id TEXT PRIMARY KEY, workflow_id TEXT, policy_id TEXT NOT NULL, action TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, input_hash TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_esk_decisions_workflow ON esk_policy_decisions(workflow_id, created_at);
      CREATE TABLE IF NOT EXISTS esk_audit (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor TEXT NOT NULL, pack_id TEXT, skill_id TEXT, workflow_id TEXT, operation TEXT NOT NULL, result TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_esk_audit_created ON esk_audit(created_at);

      -- v59: Phase 20.92 AI Script-to-Video Studio — semantic director layer on top of
      -- the Phase 20.7 video factory. Prefix vs_* (video studio): video_production_* /
      -- gen_* namespaces are owned by live subsystems — no reuse, no collision.
      CREATE TABLE IF NOT EXISTS vs_projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', aspect_ratio TEXT NOT NULL DEFAULT '16:9', fps INTEGER NOT NULL DEFAULT 30, language TEXT NOT NULL DEFAULT 'en', quality TEXT NOT NULL DEFAULT 'BALANCED', source_type TEXT NOT NULL DEFAULT 'script', raw_input TEXT NOT NULL DEFAULT '', brand_kit_id TEXT, budget_json TEXT, target_duration_sec REAL, prefs_json TEXT, script_hash TEXT, plans_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vs_project_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL, reason TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_versions_project ON vs_project_versions(project_id, revision);
      CREATE TABLE IF NOT EXISTS vs_scenes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scene_order INTEGER NOT NULL, scene_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, scene_order));
      CREATE INDEX IF NOT EXISTS idx_vs_scenes_project ON vs_scenes(project_id, scene_order);
      CREATE TABLE IF NOT EXISTS vs_assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, uri TEXT NOT NULL, checksum TEXT NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER, mime_type TEXT, tags_json TEXT NOT NULL DEFAULT '[]', source_kind TEXT NOT NULL, provider TEXT, model TEXT, source_url TEXT, license_type TEXT, project_id TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_assets_checksum ON vs_assets(checksum);
      CREATE TABLE IF NOT EXISTS vs_asset_usage (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, project_id TEXT NOT NULL, scene_id TEXT, used_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vs_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL DEFAULT 'auto_build', status TEXT NOT NULL DEFAULT 'QUEUED', current_step TEXT, quality TEXT NOT NULL DEFAULT 'BALANCED', idempotency_base TEXT NOT NULL, budget_json TEXT, pause_reason TEXT, error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_jobs_project ON vs_jobs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS vs_job_steps (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', input_hash TEXT, config_hash TEXT, idempotency_key TEXT, output_json TEXT NOT NULL DEFAULT '{}', started_at TEXT, finished_at TEXT, UNIQUE(job_id, step));
      CREATE INDEX IF NOT EXISTS idx_vs_steps_job ON vs_job_steps(job_id, started_at);
      CREATE TABLE IF NOT EXISTS vs_brand_kits (id TEXT PRIMARY KEY, name TEXT NOT NULL, kit_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vs_approvals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'REQUESTED', approver TEXT, decided_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vs_provenance (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scene_id TEXT, origin TEXT NOT NULL, provider TEXT, model TEXT, prompt_hash TEXT, input_hash TEXT, output_hash TEXT, license TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_provenance_project ON vs_provenance(project_id, created_at);
      CREATE TABLE IF NOT EXISTS vs_cost_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scene_id TEXT, provider TEXT NOT NULL, operation TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_cost_project ON vs_cost_events(project_id, created_at);
      CREATE TABLE IF NOT EXISTS vs_audit_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor TEXT NOT NULL, project_id TEXT, scene_id TEXT, operation TEXT NOT NULL, result TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_audit_created ON vs_audit_events(created_at);

      -- v60: Phase 20.92 GOLD — provider executions (structured observability +
      -- retry accounting) and batch parent linkage on vs_jobs.
      CREATE TABLE IF NOT EXISTS vs_provider_executions (id TEXT PRIMARY KEY, project_id TEXT, job_id TEXT, scene_id TEXT, capability TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, operation TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_vs_pexec_project ON vs_provider_executions(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_vs_pexec_provider ON vs_provider_executions(provider, created_at);

      -- v62: Phase 20.93 Workflow Studio — visual orchestration layer. Prefix wfs_*
      -- (workflow studio): the legacy Phase 11 workflows/workflow_runs tables are
      -- owned by that subsystem — no reuse, no collision.
      CREATE TABLE IF NOT EXISTS wfs_workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wfs_versions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', graph_json TEXT NOT NULL, plan_json TEXT, plan_hash TEXT, export_hash TEXT, created_at TEXT NOT NULL, UNIQUE(workflow_id, version));
      CREATE TABLE IF NOT EXISTS wfs_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', plan_hash TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'manual', memory_json TEXT NOT NULL DEFAULT '{}', cost_total REAL NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_wfs_runs_workflow ON wfs_runs(workflow_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS wfs_node_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, node_type TEXT NOT NULL, effective_node_type TEXT, failover_node_type TEXT, max_attempts INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'PENDING', attempt INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, duration_ms INTEGER, output_json TEXT, error_json TEXT, provider TEXT, model TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, UNIQUE(run_id, node_id, attempt));
      CREATE INDEX IF NOT EXISTS idx_wfs_noderuns_run ON wfs_node_runs(run_id, started_at);
      CREATE TABLE IF NOT EXISTS wfs_events (id TEXT PRIMARY KEY, run_id TEXT, node_id TEXT, type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_wfs_events_run ON wfs_events(run_id, created_at);
      CREATE TABLE IF NOT EXISTS wfs_artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, name TEXT NOT NULL, uri TEXT NOT NULL, mime_type TEXT, sha256 TEXT NOT NULL, size_bytes INTEGER, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wfs_approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, node_type TEXT NOT NULL, proposed_action TEXT NOT NULL, payload_json TEXT NOT NULL, risk_level TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', reviewer TEXT, reviewer_note TEXT, created_at TEXT NOT NULL, decided_at TEXT);
     CREATE INDEX IF NOT EXISTS idx_wfs_approvals_run ON wfs_approvals(run_id, status);

      -- v64: Phase 20.94 ENZO unified workspace (composition plane). Prefix enzo_*
      -- so existing agents/approvals/skills/memories tables stay owned by their phases.
      CREATE TABLE IF NOT EXISTS enzo_agents (id TEXT PRIMARY KEY, slug TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, blueprint_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', drafted_by TEXT, created_by TEXT, created_at TEXT NOT NULL, UNIQUE(slug, version));
      CREATE INDEX IF NOT EXISTS idx_enzo_agents_slug ON enzo_agents(slug, version);
      CREATE TABLE IF NOT EXISTS enzo_runs (id TEXT PRIMARY KEY, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', request_text TEXT NOT NULL, agent_id TEXT, policy_profile TEXT NOT NULL DEFAULT 'safe-personal', budget_json TEXT NOT NULL DEFAULT '{}', usage_json TEXT NOT NULL DEFAULT '{}', plan_json TEXT NOT NULL DEFAULT '{}', started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, error TEXT);
      CREATE INDEX IF NOT EXISTS idx_enzo_runs_created ON enzo_runs(created_at DESC);
      CREATE TABLE IF NOT EXISTS enzo_run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(run_id, seq));
      CREATE INDEX IF NOT EXISTS idx_enzo_events_run ON enzo_run_events(run_id, seq);
      CREATE TABLE IF NOT EXISTS enzo_approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action_type TEXT NOT NULL, risk_level TEXT NOT NULL, request_payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL, expires_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_enzo_approvals_run ON enzo_approvals(run_id, status);
      CREATE TABLE IF NOT EXISTS enzo_lessons (id TEXT PRIMARY KEY, agent_slug TEXT NOT NULL, domain TEXT NOT NULL, statement TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]', run_refs_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, last_validated_at TEXT, expires_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_enzo_lessons_slug ON enzo_lessons(agent_slug, status);
      CREATE TABLE IF NOT EXISTS enzo_artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, uri TEXT NOT NULL, sha256 TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS enzo_leases (id TEXT PRIMARY KEY, secret_ref TEXT NOT NULL, run_id TEXT NOT NULL, principal TEXT NOT NULL, scopes_json TEXT NOT NULL DEFAULT '[]', issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, max_uses INTEGER NOT NULL DEFAULT 8, uses INTEGER NOT NULL DEFAULT 0, provider TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS enzo_secrets (id TEXT PRIMARY KEY, secret_ref TEXT NOT NULL UNIQUE, provider TEXT, scopes_json TEXT NOT NULL DEFAULT '[]', secret_hash TEXT NOT NULL, envelope_json TEXT, created_at TEXT NOT NULL, rotated_at TEXT);
      CREATE TABLE IF NOT EXISTS acq_jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, request_id TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, intent TEXT NOT NULL, source_kind TEXT NOT NULL, source_value_json TEXT NOT NULL, source_host TEXT, selected_adapter TEXT, selected_capability TEXT, auth_class TEXT, policy_decision TEXT, state TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, error_class TEXT, error_message_redacted TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, request_json TEXT, plan_json TEXT);
      CREATE INDEX IF NOT EXISTS idx_acq_jobs_created ON acq_jobs(created_at DESC);
      CREATE TABLE IF NOT EXISTS acq_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_no INTEGER NOT NULL, adapter TEXT NOT NULL, external_job_ref TEXT, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, error_class TEXT, diagnostics_json TEXT);
      CREATE TABLE IF NOT EXISTS acq_artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, parent_artifact_id TEXT, artifact_type TEXT NOT NULL, relative_path TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER, sha256 TEXT, source_url TEXT, source_host TEXT, source_id TEXT, authenticated INTEGER NOT NULL DEFAULT 0, commercial_rights TEXT NOT NULL DEFAULT 'unknown', metadata_json TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_acq_artifacts_job ON acq_artifacts(job_id);
      CREATE TABLE IF NOT EXISTS acq_session_refs (id TEXT PRIMARY KEY, provider TEXT NOT NULL, domain_scope_json TEXT NOT NULL, owner_actor_id TEXT NOT NULL, external_secret_ref TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS acq_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_acq_events_job ON acq_events(job_id, created_at);
      CREATE TABLE IF NOT EXISTS enzo_policy_decisions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action TEXT NOT NULL, risk TEXT NOT NULL, decision TEXT NOT NULL, rules_json TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_enzo_policy_run ON enzo_policy_decisions(run_id, created_at);
   `);

    // Incremental column upgrades for pre-v53 databases
    if (storedVersion > 0 && storedVersion < 53) {
      try { db.exec("ALTER TABLE cr_sessions ADD COLUMN parent_session_id TEXT;"); } catch {}
      try { db.exec("ALTER TABLE cr_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;"); } catch {}
      try { db.exec("ALTER TABLE cr_sessions ADD COLUMN delegated_findings INTEGER NOT NULL DEFAULT 0;"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_cr_sessions_parent ON cr_sessions(parent_session_id);"); } catch {}
    }

    // v56: AFT post-action verification flag + idempotency ledger (Phase 20.82)
    if (storedVersion > 0 && storedVersion < 56) {
      try { db.exec("ALTER TABLE sm_actions ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;"); } catch {}
    }

    // v60: batch parent linkage on vs_jobs (Phase 20.92 GOLD)
    if (storedVersion > 0 && storedVersion < 60) {
      try { db.exec("ALTER TABLE vs_jobs ADD COLUMN parent_id TEXT;"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_vs_jobs_parent ON vs_jobs(parent_id, created_at);"); } catch {}
    }

    // v61: Video Studio INPUT preferences (target duration, template, provider prefs)
    if (storedVersion > 0 && storedVersion < 61) {
      try { db.exec("ALTER TABLE vs_projects ADD COLUMN target_duration_sec REAL;"); } catch {}
      try { db.exec("ALTER TABLE vs_projects ADD COLUMN prefs_json TEXT;"); } catch {}
    }

    // v63: Workflow Studio cost/usage accounting, retry policy + failover, export hash
    if (storedVersion > 0 && storedVersion < 63) {
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN cost_usd REAL;"); } catch {}
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN input_tokens INTEGER;"); } catch {}
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN output_tokens INTEGER;"); } catch {}
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;"); } catch {}
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN failover_node_type TEXT;"); } catch {}
      try { db.exec("ALTER TABLE wfs_node_runs ADD COLUMN effective_node_type TEXT;"); } catch {}
      try { db.exec("ALTER TABLE wfs_runs ADD COLUMN cost_total REAL NOT NULL DEFAULT 0;"); } catch {}
      try { db.exec("ALTER TABLE wfs_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;"); } catch {}
      try { db.exec("ALTER TABLE wfs_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;"); } catch {}
     try { db.exec("ALTER TABLE wfs_versions ADD COLUMN export_hash TEXT;"); } catch {}
   }

    // v65: Phase 20.94 AES-256-GCM envelopes for workspace secrets
    if (storedVersion > 0 && storedVersion < 65) {
      try { db.exec("ALTER TABLE enzo_secrets ADD COLUMN envelope_json TEXT;"); } catch {}
    }

    // v66: Phase 20.95 stored request/plan for approval resume on already-created acq_jobs
    try { db.exec("ALTER TABLE acq_jobs ADD COLUMN request_json TEXT;"); } catch {}
    try { db.exec("ALTER TABLE acq_jobs ADD COLUMN plan_json TEXT;"); } catch {}

   db.query(
      "INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(AGENT_OS_SCHEMA_VERSION));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
