# Phase 20.31 — Pao-hubPro × MoneyPrinterTurbo AI Video Production Runtime & Adobe Stock Automation Engine

> **Status:** Covered — mapped onto the existing Phase 20.7 video factory; net-new delta (prompt/IP guard + versioned technical policy) implemented and tested  
> **Reference:** harry0703/MoneyPrinterTurbo (v1.3.6 baseline noted in spec)  
> **Architecture rule honored:** Pao-hubPro remains the control plane; MoneyPrinterTurbo is behind the existing adapter boundary; Adobe Stock Mode gates exist and human review stays mandatory; **no auto-submission**

## Duplication audit (spec §3 "inspect first", §48/§65 non-duplication)

The Phase 20.7 video factory already implements most of this phase's scope. Verified inventory:

| Spec area (20.31) | Existing module (Phase 20.7+) |
|---|---|
| MPT adapter (health/jobs/artifacts/errors) | `src/agent-os/video/adapters/moneyprinterturbo/` (mpt-adapter, mpt-client, mpt-types) |
| Durable job queue + states | `src/agent-os/video/queue/video-job-queue.ts` + `video_production_jobs` tables |
| Provider routing | `src/agent-os/video/routing/` |
| Cost/usage | `src/agent-os/video/cost/` |
| Export packages | `src/agent-os/video/export/` |
| **Adobe Stock Mode policy** | `src/agent-os/video/policy/adobe-stock-policy.ts` |
| **Rights/commercial policy** | `src/agent-os/video/policy/rights-policy.ts` |
| **Technical QC (5–60s, containers, codecs, resolutions)** | `src/agent-os/video/qc/technical-video-qc.ts` |
| **Similarity gate** | `src/agent-os/video/qc/similarity-gate.ts` |
| **Reviewer Council QC gate** | `src/agent-os/video/qc/reviewer-council-gate.ts` |
| Autonomous stock pipeline (QC→curation→human review) | `src/agent-os/stock-pipeline/` (Phase 21.1) |
| Stock export packages + QC reviews | `stock_export_packs` / `stock_qc_reviews` (db v4) |

## Net-new delta implemented in this phase

`src/agent-os/video/policy/prompt-ip-guard.ts` + `tests/prompt-ip-guard.test.ts` (**9/9**):

1. **Prompt/IP guard (doc §39)** — lint layer for Stock-bound prompts: blocks fictional characters/franchises, named artists, real persons; flags artist-style imitation, brands/trademarks, government agencies, fake-news framing, embedded-text/watermark requests. Verdicts clear/flagged/blocked; blocks hold for human compliance review rather than silently rewriting the concept; the audit summary never echoes prompt content.
2. **Versioned Adobe technical policy (doc §16)** — `ADOBE_VIDEO_TECHNICAL_POLICY` as data (containers, 5–60s, 3.9 GB, frame rates, accepted resolutions, ProRes/H.264) with `sourceUrl`/`verifiedAt`/`freshnessDays`; stale policy yields `POLICY_REVIEW_REQUIRED` (`isPolicyStale`) instead of claiming submission readiness; `evaluateTechnicalGate()` produces specific pass/reason lists against one inspection record.

These integrate with the existing `technical-video-qc.ts` and policy modules (same directory, same data-driven pattern).

## Honest accounting

Everything else in the 20.31 spec (adapter, jobs, retry/resume, provider router, artifact lineage, QC/similarity/compliance gates, metadata, human review, export packages, MCP tools, dashboard) **already exists from Phase 20.7 + 21.1** and was verified by inspection above — re-implementing it would violate this phase's own non-duplication rule. Remaining follow-ups: wire the prompt guard into the generation submit path of the existing video factory (one call site), and add the Phase 20.7 upgrade regression checklist to the existing runbook docs.

## Validation

`bun run typecheck` ✅ · `bun test tests/prompt-ip-guard.test.ts` **9/9** ✅ · full connected sweep (ai-router, workflows, governance, cockpit, registry, douyin, media) **154/154** ✅ · lint/build/privacy ✅
