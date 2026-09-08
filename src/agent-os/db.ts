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
export const AGENT_OS_SCHEMA_VERSION = 19;

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
    `);
    db.query(
      "INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(AGENT_OS_SCHEMA_VERSION));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
