# Phase 21 — Knowledge Sources & Source Priorities

## 1. Directory Layout
```text
knowledge/
├── phases/           # Roadmap phase specifications
├── architecture/     # Living architectural specs
├── decisions/        # Architecture Decision Records (ADRs)
├── specifications/   # API contracts & tool specs
├── research/         # Technical investigation notes
├── operations/       # Runbooks and deployment guides
├── integrations/     # Third-party integration notes
└── generated/        # Derived indexes and graphs
```

## 2. Source Priority Hierarchy
When factual claims or architectural constraints conflict, the following priority order is observed:
1. **100** — Current Source Code & Active Config
2. **95** — Accepted Architecture Decision Records (ADRs)
3. **90** — Current Architecture Specifications
4. **80** — Active Phase Documents
5. **70** — Operations & Runbooks
6. **60** — Research Notes
7. **50** — General Documentation
8. **0** — Unverified Model Memory (Forbidden for HIGH risk)
