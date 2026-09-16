# Runbook: Upgrading Codex & Synchronizing Protocol Schemas

## Upgrade Procedures
1. Upgrade the local Codex package:
   ```bash
   npm update -g @openai/codex
   ```
2. Re-detect capabilities and check compatibility manifest:
   ```bash
   bun run scripts/codex-detect.ts
   ```
3. Synchronize TypeScript bindings and JSON schemas:
   ```bash
   bun run scripts/codex-schema-sync.ts
   ```
4. Run regression smoke test:
   ```bash
   bun run scripts/phase-20.21-smoke.ts
   ```
5. If compatibility issues occur with an unverified upstream revision:
   - Check `config/codex-compatibility.json`.
   - Revert Codex or set `PAO_CODEX_NATIVE_RUNTIME=false` until updated bindings are generated and validated.
