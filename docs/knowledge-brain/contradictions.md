# Contradiction Detection & Non-Destructive Resolution

> **Phase 20.5 Contradiction Engine**  
> Conflict Detection, ADR Auto-Resolution & Canonical Roadmap Case Study

---

## 1. The Contradiction Problem

In large software projects and long-running AI agent operations, documentation and proposals frequently contradict one another:
- Early drafts propose architecture A.
- Later architecture reviews adopt architecture B.
- Naive retrieval systems ingest both and return hallucinatory or contradictory answers.

The **Pao Contradiction Engine** (`src/agent-os/brain/contradictions.ts`) identifies, scores, and resolves semantic divergences automatically without deleting historical context.

---

## 2. Detection Algorithm

The engine monitors the `knowledge_claims` table for pairs of claims sharing the same `subject_entity_id` and `predicate`, where both claims claim `status = 'ACTIVE'` but possess differing `object_value` strings.

```sql
SELECT subject_entity_id, predicate, COUNT(*) as cnt
FROM knowledge_claims
WHERE status = 'ACTIVE'
GROUP BY subject_entity_id, predicate
HAVING cnt > 1;
```

When conflicting active claims are detected:
1. A new `contradiction_cases` row is created with status `OPEN`.
2. Severity is classified (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
3. Conflicting claim IDs are tracked in `claim_ids_json`.

---

## 3. Resolution Strategies & ADR Integration

When a contradiction case is reviewed, the engine checks for:
1. **Ratified ADRs**: An explicit decision in `knowledge_decisions` referencing the subject entity.
2. **Source Priority Dominance**: Canonical specifications (priority 10) dominate unverified or legacy drafts (priority < 5).
3. **Temporal Validity**: Claims whose `valid_to` has expired are superseded.
4. **Manual Operator Resolution**: An engineer resolves the contradiction via the GUI Observatory or REST API.

### Non-Destructive Resolution Execution
When resolution occurs:
- The winning claim remains `ACTIVE`.
- The losing claim transitions to `SUPERSEDED` with an explanatory note.
- The case status updates to `AUTO_RESOLVED` or `RESOLVED`.
- Historical provenance is fully preserved.

---

## 4. Case Study: Phase 20.3 vs Phase 20.4 Roadmap Realignment

### Historical Background
- In August 2026 early drafts, Phase 20.3 was temporarily drafted as *"Autonomous Engineering Council"*.
- In September 2026, the architectural council ratified that **Desktop Vision Control MCP** must precede autonomous worktrees to provide local agent sensory capabilities.
- Consequently, Phase 20.3 was ratified as **Desktop Vision Control MCP**, and the Autonomous Engineering Council was promoted to **Phase 20.4**.

### System Processing
1. During bootstrap (`bootstrapKnowledgeBrain`), the legacy roadmap draft and canonical phase specs are ingested.
2. Contradiction detection flags conflicting active claims for `(Phase 20.3, topic)`.
3. Architecture Decision `ADR-2026-09` is discovered:
   - *"Assign Phase 20.3 to Desktop Vision Control MCP and Phase 20.4 to Autonomous Engineering Council."*
4. Auto-resolution marks the legacy claim as `SUPERSEDED`.
5. The Brain Health Score registers 100/100 with 0 unresolved contradictions.
