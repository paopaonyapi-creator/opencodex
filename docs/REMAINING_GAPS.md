# Pao-hubPro Remaining Gaps & Roadmap Handoff

> **Honest Accounting of Partial Implementations & Blocked Dependencies**  
> **Date:** 2026-09-17

---

## 1. External Binary & Service Dependencies (BLOCKED / PARTIAL)

The following items are architecturally complete with interfaces, adapters, schemas, and test doubles implemented, but require external production binaries, live API keys, or GPU hardware to activate live external executions:

1. **TypeSafe Jev Early-Access API (Phase 20.84):**
   - **Current State:** Fully implemented behind `TypeSafeJevProvider` with calibrated simulation, contract registry, 10-stage policy fusion, and SQLite audit logging.
   - **Blocker:** Official TypeSafe Jev early-access API endpoints and production API keys (`TYPESAFE_API_KEY`) are not yet bound. Marked with `TODO_PROVIDER_SCHEMA` per Phase 20.84 §6.2.
   - **Resolution Path:** When official early-access credentials arrive, bind them in `config/decision-runtime.yaml` or `.env`.

2. **OmniRoute Remote Gateway Service (Phase 20.85):**
   - **Current State:** `PaoModelGateway` master runtime, capability registry, route groups, budget engine, circuit breaker, audit logging, and `DirectGatewayAdapter` are 100% operational in-process. `OmniRouteGatewayAdapter` is implemented.
   - **Blocker:** OmniRoute container is not started locally; `PAO_OMNIROUTE_ENABLED=false` or fallback directs traffic through `DirectGatewayAdapter`.
   - **Resolution Path:** Run `docker-compose -f services/omniroute/docker-compose.yml up -d` on production hosts.

3. **Graft Binary (Phase 20.62) & OpenCodeReview CLI binary (Phase 20.81):**
   - **Current State:** Deterministic diff parsing, rule engine, quality gates, and git-safety execution work out-of-the-box in pure TypeScript.
   - **Blocker:** Native binary compilation for Graft / OCR Rust engines is deferred; TypeScript seams handle all AST and diff parsing.

4. **Live RunPod H3 GPU Cluster (Phase 20 Addendum & 20.69):**
   - **Current State:** Job queues, pricing observations, leasing logic, and Adobe Stock export packaging are fully tested and operational.
   - **Blocker:** Live GPU cluster dispatch requires funded RunPod API credits (`RUNPOD_API_KEY`).

---

## 2. Recommended Next Highest-Value Engineering Action

1. **Bind Live OmniRoute Container:** Deploy the local OmniRoute container on port 9090 to exercise live cross-provider protocol translation.
2. **Headless CLI Verbs:** Implement `pao stock run` and `pao model-gateway status` commands for operator CLI workflows.
3. **Run Full Test Suite:** Execute full repository-wide suite (`bun run test`) on an idle CI runner.
