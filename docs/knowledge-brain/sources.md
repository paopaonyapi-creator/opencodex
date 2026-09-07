# Sources, Normalization & Hierarchical Chunking

> **Phase 20.5 Source Ingestion Specification**  
> Idempotent Tracking, Secret Exclusion & Heading-Aware Structural Chunking

---

## 1. Supported Source Types

The Brain ingests multi-modal engineering assets via `src/agent-os/brain/sources.ts`:

- `PHASE_SPEC`: Engineering specifications and phase roadmaps (e.g. `docs/PHASE_*.md`).
- `DECISION`: Architecture Decision Records (ADRs).
- `CODE_REPO`: Local codebase files and interface contracts.
- `SESSION_LOG`: Claude Code and Codex JSONL agent conversation histories.
- `AGENT_RUN`: Structured logs from multi-agent council runs.
- `REVIEW`: Code review findings and security audit reports.
- `ISSUE`: Incident post-mortems and bug reports.
- `DESKTOP_EVIDENCE`: UI screenshots, OCR logs, and Desktop Vision telemetry.
- `MANUAL_NOTE`: Operator-authored scratchpad notes.

---

## 2. Idempotency & Fingerprinting

Every document version is tracked by its SHA-256 content digest:
```typescript
const contentHash = createHash("sha256").update(content).digest("hex");
```

- When `registerSource` or `createSourceVersion` is called with unchanged content, the engine returns `{ status: "UNCHANGED", isNew: false }` without writing duplicate rows to SQLite.
- When content changes, a new row is appended to `source_versions` with an incremented `version_number`. Older versions remain immutable.

---

## 3. Secret Exclusion & Red-Line Security

To guarantee security and privacy compliance (`privacy:scan`), the ingestion pipeline strictly rejects files matching sensitive path patterns before reading them into memory:

```typescript
export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const secretPatterns = [
    /\.env(\..+)?$/,
    /id_rsa/,
    /id_ed25519/,
    /\.pem$/,
    /\.key$/,
    /admin-api-token$/,
    /credentials\.json$/,
    /\.git\/config$/,
  ];
  return secretPatterns.some((pat) => pat.test(lower));
}
```

If a source matches any exclusion pattern:
- It returns status `EXCLUDED`.
- Its content is **never read, hashed, or stored** in SQLite.
- Zero credential leakage occurs.

---

## 4. Hierarchical Chunking Pipeline

Chunks are produced via `src/agent-os/brain/chunks.ts` and `src/agent-os/brain/parsers.ts`:

1. **Parser Pass**:
   - Analyzes Markdown documents into sections based on `#`, `##`, `###` headings.
   - Calculates exact `start_line` and `end_line` line numbers.
   - Preserves exact byte offsets (`start_byte`, `end_byte`).
   - Extracts code blocks (`language`, `code`).

2. **Chunk Creation Pass**:
   - Generates deterministic chunk IDs: `chk_<versionId>_<index>`.
   - Generates unique slug anchors (e.g. `phase-20-3-desktop-vision`).
   - Computes SHA-256 chunk hash.
   - Stores chunk records in `source_chunks` with foreign key linking to `source_versions`.
