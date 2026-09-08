# Phase 21 — Operations & Maintenance

## 1. Incremental Refresh
Re-index markdown files and ADRs:
```bash
# Via REST
curl -X POST http://localhost:18080/api/knowledge/refresh -H "Authorization: Bearer <admin-token>"

# Via MCP Tool
pao_knowledge_refresh
```

## 2. Health Monitoring
Query provider latencies, active providers, and document counts:
```bash
curl http://localhost:18080/api/knowledge/health -H "Authorization: Bearer <admin-token>"
```

## 3. Database Tables (Schema v19)
- `kg_documents`
- `kg_sections`
- `kg_phase_relations`
- `kg_evidence_packs`
- `kg_audit_events`
