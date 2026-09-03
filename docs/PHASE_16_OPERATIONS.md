# Phase 16: Pao AI Media Factory × Huobao Engine — Operations Runbook

**Audience:** Operators, Engineers, and Curators  
**Scope:** Running, configuring, and maintaining the Pao AI Media Factory and Reviewer Council

---

## 1. Running the System

### Starting the Server & Dashboard
```bash
# Install dependencies
bun install

# Run TypeScript typecheck
bun run typecheck

# Run unit and E2E test suites
bun test ./tests/stock-*.test.ts

# Build GUI bundle
bun run build:gui

# Start OpenCodex proxy & Management API (Port 4000 default)
bun run start
```

---

## 2. API Endpoints Reference

Base URL: `http://127.0.0.1:4000/api/agent-os/stock`

| Method | Path | Description | Sample Payload / Params |
|---|---|---|---|
| `GET` | `/rules` | Fetch current Adobe Stock validation rules | None |
| `POST` | `/validate` | Run standalone validator | `{ mode: "jpeg"\|"png"\|"video"\|"metadata", payload: {...} }` |
| `GET` | `/opportunities` | List commercial opportunities | `?projectId=proj_id` |
| `POST` | `/opportunities` | Create opportunity | `{ projectId, title, niche, buyerPersona, score, confidence }` |
| `GET` | `/concepts` | List production concepts | `?projectId=proj_id` |
| `POST` | `/concepts` | Create production concept | `{ projectId, title, commercialUseCase, copySpace, productionMode }` |
| `GET` | `/assets` | List media assets | `?projectId=proj_id&status=GENERATED` |
| `POST` | `/generate` | Dispatch generation job | `{ projectId, conceptId, type: "image"\|"png"\|"video", prompt: {...} }` |
| `POST` | `/review` | Execute 5-Agent Reviewer Council | `{ assetId, commercialContext: {...}, metadata: {...} }` |
| `POST` | `/override` | Human Supervisor Decision | `{ assetId, decision: "APPROVED"\|"REJECTED"\|"RETURNED_FOR_FIX", note: "Reason" }` |
| `POST` | `/export` | Build Adobe Stock submission bundle | `{ projectId, batchId, assetIds: ["ast_1"] }` |

---

## 3. Human Approval & Review Protocol

1. **Reviewer Council Execution:** When an asset is generated, execute `POST /api/agent-os/stock/review`.
2. **Reviewing Held Assets:**
   - If status is `HOLD_COMPLIANCE`, inspect `flaggedTerms` in `qc_reviews`.
   - If the flag is a false positive (e.g. generic shape resembling brand name), the operator calls `POST /api/agent-os/stock/override` with `decision: "APPROVED"` and a detailed explanatory note.
3. **Export Verification:**
   - Call `POST /api/agent-os/stock/export` to generate the ZIP package and CSV metadata.
   - Inspect `adobe_stock_submission.csv` to ensure keywords and categories are aligned before manual marketplace upload.

---

## 4. Troubleshooting & FAQ

- **Q: Generation returns 429 `budget_exceeded`?**  
  *A:* The concept has reached its maximum generation attempts limit (`maxGenerationsPerConcept`). Review the existing generations or create a new concept.
- **Q: Transparent PNG rejected with insufficient transparency?**  
  *A:* Ensure the background removal node (e.g., RMBG) executed properly and transparent pixel ratio is between 5% and 90%.
- **Q: Video duration error?**  
  *A:* Adobe Stock strictly requires clips to be between 5.0 and 60.0 seconds. MiniMax H3 adapter automatically clamps requested durations into this window.
