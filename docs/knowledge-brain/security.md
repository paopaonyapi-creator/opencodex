# Security, Privacy & Air-Gapped Guarantees

> **Phase 20.5 Security Policy & Compliance**  
> Local-First Hardening, Air-Gapped Execution, Secret Scans & Access Boundaries

---

## 1. Local-First & Air-Gapped Architectural Guarantees

The Living Knowledge Brain operates with zero external cloud dependencies:
- **Zero Cloud LLM Indexing**: Embeddings and indexing run locally in-process.
- **Zero External Vector Stores**: SQLite3 on NVMe storage replaces Pinecone, Chroma, or Weaviate.
- **Zero Telemetry Exfiltration**: Ingestion, compilation, and querying do not transmit network packets.

---

## 2. Red-Line Secret Exclusion

In accordance with repo hygiene and `bun run privacy:scan`, the scanner enforces fail-safe path and content filtering:

### Path Exclusion List:
- `.env`, `.env.local`, `.env.*`
- `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- `admin-api-token`, `credentials.json`
- `.git/config`
- `node_modules/`, `.git/`

### Content Redaction:
If an operator note or ingested log contains suspected secrets (e.g. `sk-proj-*`, Bearer tokens, private keys), strings are sanitized before SQLite persistence.

---

## 3. Management API & Origin Protection

The REST Management routes in `src/server/management/brain-routes.ts` are protected by OpenCodex core management defenses:
- **Loopback Origin Verification**: Cross-origin requests from non-loopback origins are blocked (HTTP 403).
- **Admin Token Authentication**: Operations require administrative authentication.
- **Payload Size Limits**: Request bodies exceeding 2MB are rejected (HTTP 413) to prevent denial-of-service memory exhaustion.
