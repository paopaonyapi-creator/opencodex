# Claims, Provenance & Temporal Knowledge Lifecycle

> **Phase 20.5 Claims Architecture**  
> Atomic Knowledge Assertions, Fine-Grained Provenance & Lifecycle State Machine

---

## 1. What is a Knowledge Claim?

In the Pao Knowledge Brain, truth is never stored as an unstructured, unverified blob. Truth is decomposed into atomic, verifiable **claims**:

$$\text{Claim} = (\text{Subject Entity}, \text{Predicate}, \text{Object Value}, \text{Confidence}, \text{Provenance}, \text{Temporal Window})$$

### Example Claim:
```json
{
  "id": "clm_7f8190ab",
  "subjectEntityId": "ent_phase_20_3",
  "predicate": "delivers",
  "objectValue": "Native Desktop Vision Control MCP",
  "confidence": 0.99,
  "status": "ACTIVE",
  "sourcePriority": 10,
  "validFrom": "2026-09-01T00:00:00Z",
  "validTo": null,
  "provenance": [
    {
      "sourceVersionId": "ver_98213",
      "chunkId": "chk_98213_0",
      "anchor": "title",
      "source_title": "docs/PHASE_20_3_PAO_DESKTOP_VISION_CONTROL_MCP_LOCAL_REALTIME_AGENT.md",
      "chunk_heading": "Phase 20.3"
    }
  ]
}
```

---

## 2. Claim Lifecycle State Machine

A claim transitions through rigorous lifecycle states defined in `src/agent-os/brain/types.ts`:

```
               +--------------+
               |    DRAFT     |
               +-------+------+
                       | (Verification)
                       v
               +--------------+
      +------->|    ACTIVE    |<-------+
      |        +-------+------+        |
      |                |               | (Ratified ADR)
      | (Dispute)      v (Conflict)    |
+-----+--------+ +-----+--------+ +----+---------+
|   DISPUTED   | | CONTRADICTED | |  VERIFIED    |
+--------------+ +-----+--------+ +--------------+
                       |
                       | (Superseded by newer decision)
                       v
               +--------------+
               |  SUPERSEDED  | (Never deleted!)
               +--------------+
                       | (Explicit retraction)
                       v
               +--------------+
               |   REVOKED    |
               +--------------+
```

### Forensic Non-Destruction Rule
Historical claims are **never deleted**. When a newer roadmap or architecture decision replaces an older claim, the older claim is transitioned to `SUPERSEDED` with a recorded rationale. This preserves complete historical lineage and enables queries like:
- *"What is Phase 20.3?"* -> Returns `ACTIVE` claim (`Native Desktop Vision Control MCP`).
- *"What was originally planned for Phase 20.3?"* -> Returns `SUPERSEDED` claim (`Autonomous Engineering Council`) with original draft citations.
