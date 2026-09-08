# Phase 21: Pao Stock Autonomous Campaign Planner × Trend-to-Asset Portfolio Intelligence — Completion Report

**Status:** Completed & Certified  
**Date:** September 8, 2026  
**Architecture Line:** Bun-Native TypeScript (`dev` integration branch)  
**Schema Version:** Agent OS Schema v16  
**Verification Suite:** 49 / 49 passing tests (`tests/stock-campaign-planner.test.ts`) + 27 / 27 passing tests (`tests/chatbox-agent-desktop-runtime.test.ts`) + 17 / 17 boundary checks  

---

## 1. Executive Summary

Phase 21 achieves full operational closure of the loop between **commercial demand intelligence** and **autonomous generative asset production**. 

Building on the Phase 19 Production Pipeline (ComfyUI & MiniMax H3 adapters), Phase 20 Multi-GPU Workload Router, and Phase 20.9 Desktop Agent Runtime with Ponytail minimal-code governance, Phase 21 establishes an autonomous stock media campaign engine. It continuously transforms emerging market trend signals into commercially viable, multi-model asset portfolios (4K Video, RAW Photography, Isolated Graphic Elements) governed by the Reviewer Council and compliant with Adobe Stock specifications.

```text
 ┌──────────────────────────────────────────────────────────────────┐
 │                     PHASE 21 OPERATIONAL PIPELINE                │
 └──────────────────────────────────────────────────────────────────┘
                            Trend Signals
                                 │
                                 ▼
                     [1. Trend Signal Ingestion]
                     (Multi-channel seeds scan)
                                 │
                                 ▼
                     [2. Niche Scoring Engine]
                  NVS = (0.4C + 0.35V - 0.25S) / (1+P)
                                 │
                                 ▼
                    [3. Campaign Matrix Planner]
                     (10-50 Asset Dynamic Mix)
                                 │
                                 ▼
                   [4. Queue Dispatcher & Sync]
                    (Dispatches to gen_jobs)
                                 │
                                 ▼
                   [5. Stock Technical QC & IP]
                    (4MP min, Sharpness, Brands)
                                 │
                                 ▼
                  [6. Reviewer Council Approval]
                   (Council consensus verdict)
                                 │
                                 ▼
                  [7. Adobe Stock Metadata Engine]
                   (RFC 4180 CSV Export Manifest)
```

---

## 2. Core Architectural Guarantees & Invariants

1. **Deterministic Niche Viability Scoring (NVS):** Every prospective niche is mathematically scored before any GPU compute is spent:
   $$NVS = \frac{(C \times 0.40) + (V \times 0.35) - (S \times 0.25)}{1 + P_{risk}}$$
   Clamped strictly to $[0, 1]$. Niches with $NVS < 0.50$ are rejected; $0.50 \le NVS < 0.75$ are secondary/off-peak; $NVS \ge 0.75$ trigger immediate autonomous campaign generation.
2. **Zero Schema Foreign Key Violations:** Queue batch items link cleanly to `gen_jobs` with project isolation, preserving SQLite foreign key invariants across disparate subsystems.
3. **Adobe Stock Strict Conformance:** Titles are strictly constrained to $<70$ characters; keyword density guarantees 25–45 hierarchical tags with commercial category defaults; minimum resolution is strictly $\ge 4.0$ Megapixels ($1824 \times 1024$ for 16:9, $1024 \times 1024$ for 1:1, $3840 \times 2160$ for 4K video).
4. **Clean Commercial Rights & Sanitization:** Automated IP sanitizer scans for prohibited corporate trademarks and unauthorized celebrity likenesses, triggering mandatory human review or rejection before packaging.
5. **Reviewer Council Sovereignty:** Export bundles require Reviewer Council consensus (`approve` or explicit `human_review` permit); no unverified or flagged assets reach export manifests.
6. **Core-Lab Boundary Decoupling:** Phase 21 modules stay strictly outside the core request path (`src/router.ts`, `src/server/lifecycle.ts`, `src/server/responses/core.ts`); zero imports from `src/lab/`.
7. **Ponytail Minimal-Code Governance:** Adheres to the 7-rung decision ladder. Zero external dependencies added; uses Bun native primitives, SQLite `openAgentOsDb()`, and existing type utilities.

---

## 3. Subsystems Delivered

### 3.1 Database Persistence (Schema Version 16)
Location: `src/agent-os/db.ts`
- Added 5 relational tables:
  - `stock_trend_signals`: Search velocity, commercial intent, saturation index, NVS score, priority tiers.
  - `stock_campaigns`: Campaign metadata, target platforms, asset counts, progress tracking, budget.
  - `stock_campaign_items`: Asset matrix items (`video_4k`, `photo_raw`, `isolated_element`), prompts, negative prompts, aspect ratios, provider bindings, GPU job linkages, render statuses.
  - `stock_qc_records`: Sharpness scores, artifact penalties, IP clearance status, Reviewer Council verdicts, audit timestamps.
  - `stock_portfolio_performance`: Revenue, downloads, acceptance/rejection tracking for feedback loops.

### 3.2 Commercial Keyword Normalizer & Intent Classifier
Location: `src/agent-os/campaign/trends/keyword-normalizer.ts`
- Normalizes raw search queries, trims punctuation and noise terms.
- Classifies 9 commercial market categories (`technology`, `clean_tech`, `business_finance`, `healthcare`, `industrial_manufacturing`, `lifestyle_wellness`, `food_beverage`, `education_learning`, `general`).
- Extracts commercial intent indicators (`commercial`, `corporate`, `educational`, `lifestyle`, `editorial`).

### 3.3 Niche Viability Scoring Engine (NVS Formula)
Location: `src/agent-os/campaign/trends/niche-scorer.ts`
- Implements the multi-factor NVS formula with IP risk damping.
- Filters and sorts signals descending by viability score.
- Categorizes signals into `high_priority`, `secondary`, and `rejected` tiers.

### 3.4 Trend Signal Collector & Seeds
Location: `src/agent-os/campaign/trends/signal-collector.ts`
- Ingests commercial trend feeds and persists signals to SQLite.
- Seed database of vetted commercial topics (Green hydrogen logistics, humanoid warehouse robots, agricultural drones, carbon capture, solid-state battery manufacturing, etc.).

### 3.5 Dynamic Asset Portfolio Allocator
Location: `src/agent-os/campaign/planner/portfolio-allocator.ts`
- Dynamically allocates asset type distributions (`video_4k`, `photo_raw`, `isolated_element`) based on target counts and category preferences.
- Ensures total counts sum precisely to target without rounding drift.

### 3.6 Campaign Matrix Planner
Location: `src/agent-os/campaign/planner/campaign-planner.ts`
- Assembles multi-shot campaign portfolios with systematic angle diversity (`wide_establishing`, `medium_action`, `macro_detail`, `top_down_flatlay`, `low_angle_hero`) and lighting setups (`golden_hour`, `soft_studio`, `dramatic_chiaroscuro`, `clean_commercial_high_key`, `cinematic_neon`).
- Automatically balances providers (e.g. Minimax H3 for video, ComfyUI/FLUX for raw photos and isolates).

### 3.7 Queue Batch Dispatcher & Status Synchronizer
Location: `src/agent-os/campaign/execution/campaign-dispatcher.ts`
- Dispatches campaign items into the persistent `gen_jobs` table with appropriate resolution dimensions.
- Synchronizes status from job outcomes, updating item render statuses and campaign progress counters.

### 3.8 Visual QC Gate & IP Sanitizer
Locations:
- `src/agent-os/campaign/qc/visual-qc-gate.ts`
- `src/agent-os/campaign/qc/ip-sanitizer.ts`
- `src/agent-os/campaign/qc/council-evaluator.ts`
- Enforces Adobe Stock minimum resolution ($\ge 4.0$ MP), sharpness threshold ($\ge 0.70$), and artifact limits ($\le 0.15$).
- Prohibits trademark brand names and likeness infringements.
- Reviewer Council evaluates multi-lens consensus and records decisions to `stock_qc_records`.

### 3.9 Adobe Stock Metadata Engine & CSV Packager
Locations:
- `src/agent-os/campaign/metadata/stock-metadata-engine.ts`
- `src/agent-os/campaign/metadata/csv-packager.ts`
- Generates concise, professional titles ($<70$ chars).
- Generates 25–45 hierarchical keyword tags with category fallback pools.
- Packages RFC 4180 compliant CSV upload manifests.

### 3.10 REST Management API Endpoints
Location: `src/server/management/campaign-routes.ts`
Mounted under `/api/campaign/*` (and aliased under `/api/agent-os/campaign/*`):
- `GET /api/campaign/trends` — List scored trend signals.
- `POST /api/campaign/trends/scan` — Trigger market trend scan and NVS scoring.
- `POST /api/campaign/plan` — Formulate new campaign portfolio.
- `GET /api/campaign/list` — List planned campaigns.
- `GET /api/campaign/:id` — Retrieve campaign details and prompt matrix items.
- `POST /api/campaign/:id/dispatch` — Batch dispatch items to generation queue.
- `POST /api/campaign/:id/sync` — Synchronize execution status against generation jobs.
- `POST & GET /api/campaign/items/:id/qc` — Run and retrieve technical QC evaluation.
- `GET /api/campaign/:id/export?format=csv` — Export Adobe Stock CSV manifest.

### 3.11 Desktop Agent Runtime Integration
Location: `src/agent-os/desktop-runtime/tools/tool-registry.ts`
Exposes 5 built-in tools for Chatbox Desktop Agent missions:
- `builtin__campaign_scan_trends` (`read_only`)
- `builtin__campaign_plan` (`low`)
- `builtin__campaign_dispatch` (`medium`, requires human approval)
- `builtin__campaign_sync` (`read_only`)
- `builtin__campaign_export` (`read_only`)

### 3.12 GUI Dashboard & Control Center
Locations:
- `gui/src/pages/AiStudio.tsx` (New `CampaignPlannerTab`)
- `gui/src/styles/stock-campaign.css` (Glassmorphism design tokens)
- `gui/src/pages/AgentControlCenter.tsx` (Quick Campaign Mission presets)

Features:
- **Trend Signal Scanner:** Interactive cards with real-time NVS meters, commercial intent, search velocity, and priority badges.
- **Campaign Matrix Formulator:** Interactive sliders for 4K video, RAW photo, and isolated element ratios, with target asset count selectors.
- **Matrix Items & Dispatch Manager:** Item status badges, prompt inspection, queue dispatch, and progress sync.
- **QC & Council Inspector:** Visual QC metrics, Council verdict banners, and one-click evaluation.
- **Adobe Stock Manifest Export:** Live RFC 4180 CSV preview and export.

---

## 4. Verification & Quality Gates

| Gate / Check | Target | Result | Status |
|---|---|---|---|
| **Campaign Planner Test Suite** | `tests/stock-campaign-planner.test.ts` | 49 / 49 passing (261 assertions) | **PASSED** |
| **Desktop Runtime Test Suite** | `tests/chatbox-agent-desktop-runtime.test.ts` | 27 / 27 passing (149 assertions) | **PASSED** |
| **Core-Lab Separation Guard** | `tests/core-lab-boundary.test.ts` | 17 / 17 passing | **PASSED** |
| **TypeScript Typecheck** | `bun run typecheck` (`tsc --noEmit`) | 0 errors | **PASSED** |
| **GUI Linter** | `bun run lint:gui` (`oxlint .`) | 0 warnings, 0 errors | **PASSED** |
| **GUI Production Build** | `bun run build:gui` (`vite build`) | 273 modules transformed in 664ms | **PASSED** |
| **Privacy & Security Scan** | `bun run privacy:scan` | Clean, 0 leaks | **PASSED** |

---

## 5. Summary of Files Delivered

### Core Subsystem (`src/agent-os/campaign/`)
- `types.ts` — TypeScript domain interfaces for trends, campaigns, items, QC, and API.
- `index.ts` — Unified barrel exports.
- `trends/keyword-normalizer.ts` — Normalizer, category classifier, intent extractor.
- `trends/niche-scorer.ts` — Mathematical NVS calculation formula & priority tiering.
- `trends/signal-collector.ts` — SQLite persistence and trend scanning.
- `planner/portfolio-allocator.ts` — Asset mix ratio allocator.
- `planner/campaign-planner.ts` — Matrix formulation with angle/lighting diversity.
- `execution/campaign-dispatcher.ts` — `gen_jobs` queue dispatcher & sync engine.
- `qc/visual-qc-gate.ts` — Technical 4MP minimum, sharpness, and artifact gate.
- `qc/ip-sanitizer.ts` — Commercial clearance and trademark scanner.
- `qc/council-evaluator.ts` — Multi-lens Reviewer Council evaluator.
- `metadata/stock-metadata-engine.ts` — Titles (<70 chars) and 25–45 hierarchical tags.
- `metadata/csv-packager.ts` — RFC 4180 CSV manifest export generator.

### Server API & Agent Runtime
- `src/server/management/campaign-routes.ts` — REST management endpoints.
- `src/server/management-api.ts` — Route dispatcher mounting `/api/campaign/*`.
- `src/agent-os/desktop-runtime/tools/tool-registry.ts` — Campaign tools registration.

### GUI & Styling
- `gui/src/pages/AiStudio.tsx` — `CampaignPlannerTab` component & navigation.
- `gui/src/styles/stock-campaign.css` — Glassmorphism styles and responsive grid.
- `gui/src/pages/AgentControlCenter.tsx` — Mission Launcher campaign presets.

### Tests & Documentation
- `tests/stock-campaign-planner.test.ts` — 49 comprehensive unit & integration tests.
- `docs/PHASE_21_PAO_STOCK_AUTONOMOUS_CAMPAIGN_PLANNER.md` — Architectural blueprint.
- `docs/PHASE_21_COMPLETION_REPORT.md` — This certified completion report.
