# Phase 21 — Pao Stock Autonomous Campaign Planner × Trend-to-Asset Portfolio Intelligence

> **Project:** Pao-hubPro  
> **Phase:** 21  
> **Primary Goal:** Build an end-to-end autonomous stock media campaign planning and production loop that continuously transforms market trend signals into commercially viable, multi-model generative asset portfolios, leveraging the Phase 20 Multi-GPU Workload Router, Phase 19 Production Pipeline, and Phase 20.9 Minimal-Code Governance Layer.  
> **Integration Targets:** Phase 20 GPU Router, Phase 19 AI Studio, Phase 16 Media Factory, Phase 20.9 Desktop Agent Runtime & Reviewer Council  
> **Status:** Architectural Specification & Implementation Blueprint  

---

## 0. Executive Summary

Phase 21 closes the loop between **commercial demand intelligence** and **autonomous generative asset production**. 

In previous phases:
- Phase 16 established Adobe Stock validation rules and review council gates.
- Phase 19 created multi-modal ComfyUI & H3 generation pipelines.
- Phase 20 added intelligent multi-GPU RunPod workload routing and auto cloud-burst scheduling.
- Phase 20.9 added Desktop Agent Runtime with Human-in-the-Loop approval cards and Ponytail minimal-code governance.

Phase 21 introduces the **Autonomous Campaign Planner & Portfolio Intelligence Engine**:
An automated agentic loop that:
1. Detects emerging commercial stock media trends.
2. Evaluates niche viability through multi-factor mathematical scoring.
3. Formulates structured 10–50 asset portfolio campaigns.
4. Generates batch prompt matrices and dispatches them through Phase 20 Workload Routers.
5. Verifies technical visual quality, rights compliance, and metadata through the Reviewer Council.
6. Feeds acceptance and conversion metrics back into portfolio learning.

```text
 ┌──────────────────────────────────────────────────────────────────┐
 │                     PHASE 21 OPERATIONAL LOOP                    │
 └──────────────────────────────────────────────────────────────────┘
                            Trend Signals
                                 │
                                 ▼
                     [1. Trend Signal Ingestion]
                                 │
                                 ▼
                     [2. Niche Scoring Engine]
                  (Viability, Saturation, Velocity)
                                 │
                                 ▼
                    [3. Concept & Campaign Planner]
                     (10-50 Asset Cohesive Matrix)
                                 │
                                 ▼
                   [4. Ponytail Governance Gate]
               (Reuse check, Diff scope, Minimal code)
                                 │
                                 ▼
                    [5. Prompt Matrix Compiler]
                    (ComfyUI / H3 / MPT Configs)
                                 │
                                 ▼
                  [6. Phase 20 GPU Workload Router]
                 (Local RTX 4090 / RunPod Cloud Burst)
                                 │
                                 ▼
                   [7. Stock Technical QC & Rights]
                    (100% Crop, Artifacts, IP Scan)
                                 │
                                 ▼
                  [8. Reviewer Council Authorization]
                     (Multi-model Consensus Verdict)
                                 │
                                 ▼
                  [9. Adobe Stock Metadata Engine]
                    (Hierarchical Tags & Titles)
                                 │
                                 ▼
                  [10. Portfolio Learning Feedback]
                                 │
                    (Feeds back to Trend Ingestion)
```

---

## 1. Domain Architecture & Subsystems

```
src/agent-os/campaign/
├── types.ts                     # Campaign, Niche, Opportunity, Portfolio types
├── index.ts                     # Unified barrel exports
├── trends/
│   ├── signal-collector.ts      # Multi-channel trend signal aggregator
│   ├── keyword-normalizer.ts    # Lemmatization & commercial intent filter
│   └── niche-scorer.ts          # Multi-factor mathematical opportunity index
├── planner/
│   ├── campaign-planner.ts      # Asset matrix & shot diversity generator
│   ├── prompt-matrix.ts         # Multi-model prompt compiler
│   └── portfolio-allocator.ts   # Ratio allocator (stills, motion, isolates)
├── qc/
│   ├── visual-qc-gate.ts        # Sharpness, banding, aspect ratio, frame drops
│   ├── ip-sanitizer.ts          # Trademark, logo, model release checklist
│   └── council-evaluator.ts     # Reviewer Council integration
├── metadata/
│   ├── stock-metadata-engine.ts # SEO title & hierarchical tag generator
│   └── csv-packager.ts          # Adobe Stock batch upload manifest builder
└── learning/
    ├── acceptance-tracker.ts    # Tracks approval vs rejection rates
    └── portfolio-weights.ts     # Self-tuning niche scoring weights
```

---

## 2. Mathematical Niche Scoring Formula

To prevent wasting GPU compute on saturated or low-value keywords, each detected niche is evaluated by the **Niche Viability Score (NVS)**:

$$NVS = \frac{(C \times 0.40) + (V \times 0.35) - (S \times 0.25)}{1 + P_{risk}}$$

Where:
- $C \in [0, 1]$: **Commercial Intent Score** (presence of corporate, editorial, or commercial buyer demand).
- $V \in [0, 1]$: **Search Velocity Delta** (rate of increase in search query frequency over 14 days).
- $S \in [0, 1]$: **Market Saturation Index** (existing asset volume for the target keywords on major stock platforms).
- $P_{risk} \in [0, 1]$: **IP & Trademark Liability Penalty** (risk of accidental copyright or likeness infringement).

**Decision Thresholds:**
- $NVS \ge 0.75$: **High Priority Tier** (Immediate autonomous campaign generation).
- $0.50 \le NVS < 0.75$: **Secondary Tier** (Queued for off-peak cloud compute execution).
- $NVS < 0.50$: **Rejected** (Logged to trend archive; no compute spent).

---

## 3. Database Schema Extensions (Schema v16 Blueprint)

Phase 21 extends SQLite persistence (`agent-os.db`) with 5 dedicated relational tables:

```sql
-- 1. Market Trend Signals & Opportunities
CREATE TABLE IF NOT EXISTS stock_trend_signals (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  search_velocity REAL NOT NULL,
  commercial_intent REAL NOT NULL,
  saturation_index REAL NOT NULL,
  niche_viability_score REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new', 'planned', 'producing', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Planned Asset Campaigns
CREATE TABLE IF NOT EXISTS stock_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  trend_signal_id TEXT REFERENCES stock_trend_signals(id),
  target_platform TEXT NOT NULL DEFAULT 'adobe_stock',
  target_asset_count INTEGER NOT NULL,
  completed_asset_count INTEGER NOT NULL DEFAULT 0,
  budget_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'paused', 'completed')),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Campaign Prompt Matrix Items
CREATE TABLE IF NOT EXISTS stock_campaign_items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES stock_campaigns(id),
  asset_type TEXT NOT NULL CHECK(asset_type IN ('video_4k', 'photo_raw', 'isolated_element')),
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  assigned_provider TEXT NOT NULL,
  gpu_job_id TEXT,
  render_status TEXT NOT NULL CHECK(render_status IN ('pending', 'rendering', 'passed_qc', 'failed_qc')),
  created_at TEXT NOT NULL
);

-- 4. Technical QC & IP Clearances
CREATE TABLE IF NOT EXISTS stock_qc_records (
  id TEXT PRIMARY KEY,
  campaign_item_id TEXT NOT NULL REFERENCES stock_campaign_items(id),
  sharpness_score REAL NOT NULL,
  artifact_penalty REAL NOT NULL,
  ip_clearance_status TEXT NOT NULL CHECK(ip_clearance_status IN ('cleared', 'flagged_trademark', 'flagged_likeness')),
  council_verdict TEXT NOT NULL CHECK(council_verdict IN ('approve', 'human_review', 'reject')),
  verified_at TEXT NOT NULL
);

-- 5. Portfolio Revenue & Feedback Intelligence
CREATE TABLE IF NOT EXISTS stock_portfolio_performance (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES stock_campaigns(id),
  submitted_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  revenue_usd REAL NOT NULL DEFAULT 0.0,
  last_synced_at TEXT NOT NULL
);
```

---

## 4. Integration with Existing Pao-hubPro Systems

| Subsystem | Phase 21 Integration Method |
|---|---|
| **Phase 20 GPU Router** | Dispatches batch prompt requests to `WorkloadRouter.routeWorkload()`, optimizing for lowest $/sec and batch affinity. |
| **Phase 19 AI Studio** | Feeds prompts into Minimax H3 candidate selector and ComfyUI Smart Queue controllers. |
| **Phase 20.9 Governance Gate** | Validates campaign generation code; rejects oversized abstractions; ensures campaign planner adheres to the 7-rung ladder. |
| **Reviewer Council** | Evaluates every generated stock portfolio before export packaging, ensuring 0 copyright violations and full technical quality compliance. |
| **Desktop Agent Runtime** | Exposes campaign planning tools (`mcp__campaign_plan`, `mcp__campaign_launch`) to Chatbox Desktop Agent with interactive approval cards. |

---

## 5. Implementation Roadmap for Phase 21

1. **Sprint 1: Trend Signals & Niche Scoring Engine:**
   - Ingest trend feeds and implement the NVS scoring formula.
   - Implement database migration for Schema v16.
2. **Sprint 2: Campaign Matrix & Shot Diversity Planner:**
   - Build portfolio campaign generator that outputs structured shot lists with diverse lighting and camera angles.
   - Connect prompt matrices to ComfyUI & H3 adapters.
3. **Sprint 3: Quality Control & Reviewer Council Pipeline:**
   - Integrate automated 100% crop validation, contrast inspection, and trademark scanners.
   - Connect Reviewer Council consensus voting to export permits.
4. **Sprint 4: Management API & GUI Dashboard:**
   - Mount `/api/campaign/*` endpoints in `src/server/management/`.
   - Add **Campaign Planner** tab in `gui/src/pages/AiStudio.tsx` and `AgentControlCenter.tsx`.
5. **Sprint 5: End-to-End Verification & Quality Gates:**
   - Author full test suite `tests/stock-campaign-planner.test.ts`.
   - Run typecheck, lint, build, and repository hygiene tests.
