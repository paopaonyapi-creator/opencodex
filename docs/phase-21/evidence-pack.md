# Phase 21 — Evidence Pack & Knowledge-First Guard

## 1. Evidence Pack Structure
The Evidence Pack is the canonical, verified grounding artifact constructed prior to code changes:
```json
{
  "taskId": "task_xyz",
  "task": "Add NotebookLM as a knowledge provider",
  "riskLevel": "HIGH",
  "sources": [
    {
      "documentId": "phase-21",
      "path": "knowledge/phases/Phase-21.md",
      "section": "NotebookLM Adapter",
      "confidence": 0.95
    }
  ],
  "relatedComponents": ["knowledge-gateway", "mcp-server"],
  "architectureDecisions": ["ADR-005 — Knowledge Gateway Architecture"],
  "conflicts": [],
  "unknowns": [],
  "recommendation": "Proceed with changes.",
  "allowedToProceed": true
}
```

## 2. Risk Classification
- **LOW**: Typos, documentation formatting, UI labels, simple non-interface refactors.
- **MEDIUM**: New endpoints, new MCP tools, new database tables, worker adjustments.
- **HIGH**: Authentication, permissions, database migrations, remote execution, secrets, review policy, architecture changes.

## 3. Knowledge-First Guardrail
If a task is classified as **HIGH** risk and no verified repository evidence is retrieved with sufficient confidence (confidence $\ge 0.40$), execution is halted with `EVIDENCE_INSUFFICIENT`.
