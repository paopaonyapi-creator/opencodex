# Phase 20.27 — Architecture Intelligence

The architecture graph surface ships behind `ARCHITECTURE_GRAPH_ENABLED`
(flag on) with the evidence contract defined; the MVP graph builder for the
Pao-hubPro stack is Phase 20.27.x work. What exists today:

- **Node/edge vocabulary** (doc §35-§36): page, route, API, module, service,
  worker, database/table, provider, MCP server, agent, tool, queue, storage,
  deployment target; edges: imports, calls, reads, writes, publishes,
  subscribes, routes_to, depends_on, uses_secret, executes.
- **Evidence contract** (doc §37): every node/edge carries
  `{file, line_start, line_end, confidence}` — filename-only claims are not
  acceptable when evidence is weak.
- **Weak-boundary heuristics** (doc §39): client imports of server-only secret
  modules, missing auth evidence on protected routes, direct DB access
  bypassing the policy layer, agent bypassing the control plane, circular
  dependencies, prod-depends-on-dev — each finding MUST cite evidence and
  suggested actions.
- **Integration point**: findings enter the gate as `file_line` evidence and
  render on the Architecture screen with drill-down to evidence, dependencies,
  findings, recent changes, and agent actions (doc §93).
- **Incremental scanning** (doc §116-§117): cache keyed by git SHA + file
  hash + scanner version; skip binaries/node_modules/generated/oversized;
  progress + partial results + cancellation are required for large repos.
