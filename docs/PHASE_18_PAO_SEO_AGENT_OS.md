# Phase 18 — Pao SEO Agent OS × OpenSEO MCP Intelligence Layer

Phase 18 adds an agentic SEO layer to PaohupByPaoZa's existing Agent OS.
OpenSEO stays an **external provider**: Pao-hubPro owns orchestration,
project context, policy, the recommendation inbox, Reviewer Council wiring,
and the dashboard; OpenSEO (or the built-in mock) owns SEO data acquisition.

## Architecture

```text
Dashboard (#seo page)
   |
   v
/api/agent-os/seo/*  (src/server/management/seo-routes.ts)
   |
   v
SEO Orchestrator (src/agent-os/seo/seo-orchestrator.ts)
   | policy gate (SeoPolicy) + capability discovery
   v
SeoProvider contract (src/agent-os/seo/types.ts)
   |-- MockSeoProvider  (default, provenance=mock, zero cost)
   `-- OpenSeoProvider  (OpenSeoMcpClient -> MCP tools/list + tools/call)
   |
   v
Agent OS store (agent-os.sqlite3, schema v5: seo_projects,
seo_recommendations, seo_runs) + Reviewer Council reviews table
```

## OpenSEO integration

Configure through environment variables — never commit credentials:

```env
OPENSEO_ENABLED=true
OPENSEO_MODE=mcp            # mcp | local | mock
OPENSEO_MCP_URL=https://example/mcp
OPENSEO_LOCAL_BASE_URL=http://127.0.0.1:3001   # local mode
OPENSEO_API_KEY=...
```

- tools/list is discovered at health-check time and normalized into stable
  internal capabilities (keyword_research, serp_analysis, backlink_overview,
  ...). Unknown upstream tools are ignored, never crash.
- mode=local appends /mcp to the local base URL and never exposes the
  instance publicly: a public endpoint without an API key is reported as
  CRITICAL security state, a loopback one as WARNING.
- API keys are sent only as an Authorization header, never logged, never
  returned by any endpoint, and never embedded in error messages.
- Upstream MCP payloads are treated as untrusted data and defensively
  normalized before agents see them.

## Safety & policy

Default project policy is safe by construction: research, analysis, drafts
and suggestions are allowed; automatic code changes, deployment and indexing
requests are disabled; human approval is required before any write or deploy.
The orchestrator records one seo_run per execution (including policy_denied
runs) and emits recommendations with requiresApproval flags; nothing in
Phase 18 modifies a website.

## Agents (slice 1)

The orchestrator runs the analysis lane: domain intelligence, keyword
research, competitor analysis, and backlinks - each capability-gated.
Keyword quick-wins and competitor-overlap insights land in the
recommendation inbox with impact/effort scores and evidence (including
provenance). Cluster/SERP/content-gap/technical/GSC/local/AEO agents follow
the same contract and register behind capability discovery in later slices.

## Dashboard

#seo in the dashboard shows provider health (status, mode, latency,
security state, capabilities), project CRUD, one-click baseline/analysis
runs, and the recommendation inbox with approve/dismiss actions. Everything
is translated in all 10 UI locales.

## Testing

bun test tests/seo-phase18-core.test.ts     # providers, MCP discovery, store, orchestrator
bun test tests/seo-phase18-routes.test.ts   # management API surface

MCP discovery is tested against an in-process JSON-RPC server, including the
credential-leak guard. bun x tsc --noEmit and bun run build must stay green.

## Headless CLI

`ocx seo` mirrors the dashboard's Phase 18/18.1 read, analysis, audit,
council, and report paths. It uses the live management API rather than editing
the SQLite database or provider config directly. No CLI subcommand applies or
deploys a website change.
