# Phase 20.96 — Pao-hubPro × AnythingMCP MCP Fabric

**Status:** IMPLEMENTED (control plane — connector intake, canonical tools, privacy gateway, approvals, versioning/drift, KG/skill candidates, REST/MCP/GUI)
**Blueprint:** `docs/Phase_20.96_Pao-hubPro_x_AnythingMCP.md`
**Law:** AnythingMCP is a replaceable connector/protocol engine. Pao-hubPro owns policy, secrets, privacy, approval, versioning, audit, knowledge, and skills. Enterprise Edition source is not vendored.

## Architecture law

1. **AnythingMCP is not the control plane.** Agents never talk to it directly.
2. **Never auto-publish.** `CONNECTOR_AUTO_PUBLISH_ENABLED` defaults false.
3. **Secrets stay in `secret://` refs.** Credential values never enter model context, logs, or GUI.
4. **R2–R4 privacy fail-closed.** Raw upstream is withheld if shaping fails.
5. **R4 requires a human-approved request.** Production DB connectors are SELECT-only.
6. **Pao risk overrides weaker upstream annotations.** `destructiveHint=false` on DELETE still becomes R4.

## Feature flags (conservative production defaults)

`PHASE_20_96_ENABLED` / `PAO_MCP_FABRIC_ENABLED` (on), `ANYTHINGMCP_BRIDGE_ENABLED`, `CONNECTOR_AUTO_PUBLISH_ENABLED=false`, `TOOL_WRITE_ACTIONS_ENABLED=false`, `TOOL_DESTRUCTIVE_ACTIONS_ENABLED=false`, `SENSITIVE_RESPONSE_FAIL_CLOSED=true`, `LEARNED_SKILL_AUTO_APPLY=false`, `KNOWLEDGE_AUTO_APPROVE=false`.

## Honest gaps

- Live AnythingMCP HTTP execute fails closed until `PAO_ANYTHINGMCP_URL` points at a healthy bridge. Tests use a labeled mock engine.
- Streaming, gRPC, webhook ingestion, OpenTelemetry exporter, and other unreleased upstream roadmap items are not assumed.
