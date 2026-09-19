# Phase 20.95 Integration Audit

Audit of Phase 20.24 and adjacent Pao-hubPro infrastructure. No GPL source was copied from https://github.com/tonhowtf/omniget.

## Phase 20.24 (`src/agent-os/media-acquisition/`)

| Component | Classification | Action |
| --- | --- | --- |
| `url-policy.ts` | KEEP | Reused by `acquisition/classify.ts` and `policy.ts` for SSRF |
| `process-runner.ts` | KEEP | Allowlisted spawn, no shell concat |
| `omniget-adapter.ts` | ADAPT | CLI health probe wrapped by `OmniGetCliAdapter` |
| `ytdlp-adapter.ts` / `native-adapter.ts` | KEEP | Remain on the 20.24 media path |
| `queue-engine.ts` / `service.ts` | KEEP | Legacy `/api/agent-os/media/*` still served |
| `mcp-tools.ts` | KEEP | 20.24 tools stay; 20.95 adds `pao.acquire*` |
| `media-routes.ts` | KEEP | Not deleted |

## Adjacent systems reused

| System | Reuse |
| --- | --- |
| Agent OS SQLite (`src/agent-os/db.ts`) | schema v66 `acq_*` tables |
| MCP gateway | registers `acquisition` server |
| ENZO workspace | `acquire_content` tool, no OmniGet tokens |
| Route registry | deferred-verb owner `docs/PHASE_20.95_ACQUISITION.md` |
| GUI i18n / App routing | `#acquisition` page |
| Canonical phases | `20.95` |

## Not built (by design)

- Parallel downloader, DB, or router
- Vendored OmniGet UI or GPL code
- DRM/paywall bypass
- Hardcoded OmniGet tool count or single MCP port
