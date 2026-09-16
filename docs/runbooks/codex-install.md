# Runbook: Installing & Configuring OpenAI Codex Runtime

## Windows PC Installation
1. Install Codex via npm globally:
   ```powershell
   npm install -g @openai/codex
   ```
   Or via Cargo:
   ```powershell
   cargo install codex-cli
   ```
2. Verify binary availability:
   ```powershell
   where.exe codex
   codex --version
   ```
3. Run Pao-hubPro detection:
   ```powershell
   bun run scripts/codex-detect.ts
   ```

## Linux VPS Installation
1. Install Node.js / Bun and Cargo:
   ```bash
   npm install -g @openai/codex
   ```
2. Verify installation:
   ```bash
   which codex
   codex --version
   ```
3. Run diagnostic check:
   ```bash
   bun run scripts/codex-health.ts
   ```
