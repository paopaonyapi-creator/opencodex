# Phase 16: Pao AI Media Factory × Huobao Engine — Test Report

**Execution Timestamp:** 2026-08-30 21:20:00  
**Runtime:** Bun v1.3.14 on Windows  
**Total Tests Executed:** 64/64 passing across 6 test suites (0 failures, 0 regressions)

---

## 1. Test Suite Results Breakdown

```text
================================================================================
Test Suite Name                          Tests   Pass   Fail   Duration
================================================================================
stock-rules-and-validators.test.ts          22     22      0     380ms
stock-reviewer-council.test.ts              12     12      0     260ms
stock-provider-adapters.test.ts              8      8      0      55ms
stock-routes.test.ts                         9      9      0     210ms
stock-factory-e2e.test.ts                    7      7      0     316ms
gui/tests/webmcp-registry.test.ts            6      6      0     270ms
================================================================================
TOTAL                                       64     64      0    1491ms
================================================================================
```

---

## 2. Key Scenario Validations

### 2.1 Technical Validators
- **JPEG Tests:** Verified resolution range (4MP to 100MP), maximum 45MB file size limit, sRGB color profile detection, and non-JPEG format rejection.
- **PNG Tests:** Verified true alpha channel enforcement, transparent ratio rejection on solid background (<5%) and empty canvas (>95%), subject bounding box warning (<15%), and halo/fringe tolerance threshold.
- **Video Tests:** Verified duration range (5s to 60s), valid container (`mp4`, `mov`), valid codec (`h264`, `prores`, `hevc`), and standard frame rates.
- **Metadata Tests:** Verified keyword count (5–49), deduplication, title length limits (5–200), prohibited brand filters (Apple, Nike, Disney, Marvel), and mandatory AI generation flag.

### 2.2 Reviewer Council Decisions
- **Pass Case:** All 5 agents pass $\to$ `READY_FOR_HUMAN_SUBMISSION_REVIEW` (Asset status: `HUMAN_REVIEW`).
- **Technical/Visual Defect:** Anomaly detected $\to$ `NEEDS_FIXES` (Asset status: `NEEDS_FIXES`).
- **IP / Trademark Risk:** Brand reference flagged $\to$ `HOLD_FOR_COMPLIANCE_REVIEW` (Asset status: `HOLD_COMPLIANCE`).
- **Duplicate Detection:** Near duplicate detected $\to$ `REJECT_INTERNALLY` (Asset status: `REJECT_INTERNAL`).
- **Human Override:** Human supervisor can overturn holding state with mandatory explanatory audit log.

### 2.3 Provider Adapters & Budget Guards
- **ComfyUI:** Verified node graph construction, SDXL/Flux parameterization, and alpha PNG generation.
- **MiniMax H3:** Verified dual routing (`LOCAL` vs `RUNPOD`) and duration clamping.
- **Budget Governor:** Verified that generation attempts exceeding concept quota (e.g. 3 attempts) are rejected safely with code 429 without dropping database state.

### 2.4 End-to-End Workflows
- **Stock JPEG Image E2E:** Full pipeline from Opportunity to Concept, Generation, QC, Human Approval, Metadata, and Export Pack.
- **Transparent PNG E2E:** Cutout workflow with 4-way background inspection and alpha failure blocking.
- **Stock Video E2E:** B-roll video workflow with duration clamping, codec check, and CSV generation.
- **Security:** Verified zero credential leakage and strict input sanitization.
