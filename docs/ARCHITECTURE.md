# Pao-hubPro System Architecture

> **Canonical System Overview & Topology**  
> **Updated:** 2026-09-17 (Autonomous GOLD Productionization Run)

## 1. System Vision & Architecture Principles

Pao-hubPro is a unified, agent-native operating environment and AI gateway built on Bun-native TypeScript. It consolidates 29 modular phase specifications into a coherent, high-reliability control plane designed around authority separation:

```text
                              User / Workflow
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │      Pao-hubPro Control Plane    │
                    │ ├── Identity & RBAC             │
                    │ ├── Data Classification         │
                    │ ├── Policy Engine               │
                    │ ├── Budget Authority            │
                    │ └── Master Audit                │
                    └───────────────┬─────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
   ┌───────────────────────┐                 ┌───────────────────────┐
   │   Pao Model Gateway   │                 │   Pao Tool Gateway    │
   │      (Phase 20.85)    │                 │      (Phase 20.74)    │
   │ ├── Capability Router │                 │ ├── Tool Trust Score  │
   │ ├── OmniRoute Adapter │                 │ ├── Path Sandbox      │
   │ ├── Direct Fallback   │                 │ ├── Command Shield    │
   │ ├── Cumulative Budget │                 │ └── MCPProxy Hub      │
   │ └── Local-Only Gate   │                 └───────────┬───────────┘
   └───────────┬───────────┘                             │
               │                                         ▼
               ▼                               Federated MCP Servers &
   Approved Cloud & Local LLMs                 Sandboxed Local Tools
```

### Core Architecture Invariant
`Pao-hubPro governs. Adapters execute.`  
No external provider, tool runtime, or inference gateway can bypass Pao-hubPro's deterministic security policies, budget ceilings, workspace containment, or human approval gates.

---

## 2. Subsystem Topology

1. **AI Model Gateway (Phase 20.85 & Phase 20.84):**
   - Implemented in `src/agent-os/model-gateway/` and `src/agent-os/decision/`.
   - Normalizes all model access behind the `ModelGateway` interface.
   - Routes by capability and semantic route groups (`coding-high`, `coding-cheap`, `private-local`, `reviewer-independent`).
   - Implements two-layer hard budget governance: cumulative cost tallies all retry and fallback attempts.
   - Enforces physical local-only boundaries: `localOnly: true` or `restricted` data strictly forbids cloud fallback.
   - Connects to Phase 20.84 TypeSafe Jev Decision Runtime for sub-second intent and risk triage.

2. **Tool Gateway & Sandbox (Phase 20.74 MCPProxy & 20.57 SkillsGate):**
   - Implemented in `src/agent-os/mcp-gateway/` and `src/agent-os/skill-gate/`.
   - ToolExecutionSandbox enforces path traversal defense (`assertSafeWorkspacePath`) and dangerous command blocking (`assertSafeCommand`).
   - Secrets are automatically redacted before tools execute.
   - R4 destructive operations enforce mandatory human confirmation.

3. **Sensorimotor Execution Runtime & Safe PTY (Phase 20.82 AFT & 20.61 amux):**
   - Implemented in `src/agent-os/execution-runtime/` and `src/agent-os/council/git-safety.ts`.
   - Safe git operations with strict option injection prevention (`assertSafeRef`).
   - Transactional file mutations and recoverable session checkpoints.

4. **Deterministic Code Review Runtime (Phase 20.81 OpenCodeReview):**
   - Implemented in `src/agent-os/code-review/`.
   - Pure string-based diff parsing without vulnerable regexes.
   - Semantic review units, line-anchored defect findings, gate results (`PASS`, `WARN`, `REQUIRE_FIX`, `BLOCK`).
   - Revision lineage (`parent_session_id`, `revision`) tracking fix loops.

5. **Reviewer Council & Correlation Guard (Phase 20.85 §43 & 20.4):**
   - Implemented in `src/agent-os/council/reviewers.ts` and `src/agent-os/council/correlation-guard.ts`.
   - Ensures multi-agent consensus evaluates distinct `model_family` identities.
   - Correlated aliases sharing weights are automatically detected, flagged, and diluted.

6. **Security Plane & Encrypted Credential Vault (Phases 20.58 & 20.59):**
   - Implemented in `src/security/` and `src/credentials/`.
   - Hardware/AES-256-GCM encrypted credential vault (`AesGcmVault`).
   - Dynamic credential leases, zero-trust token issuance, authorized security campaigns.

7. **Web Dashboard & User Interface:**
   - Implemented in `gui/` (React 19 + Vite + oxlint).
   - Live telemetry, Model Gateway management, Skills Gate, Security, Credentials, and Code Review workspaces.
   - Fully localized across 10 international languages with fallback to English.
