# Phase 20.5 — Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph

> **Project:** Pao-hubPro  
> **Phase:** 20.5  
> **Status:** Implementation Specification / Codex One-Shot Build Prompt  
> **Depends on:**  
> - Existing Pao Brain Universe / project scanner / session index / graph / search capabilities already present from earlier roadmap work  
> - Phase 19 — Pao AI Generation Studio × ComfyUI Production Orchestrator  
> - Phase 20 — Pao Multi-GPU Generation Grid × RunPod Intelligent Workload Router  
> - Phase 20.1 — Pao ComfyUI Smart Queue × Auto Cloud Burst Scheduler  
> - Phase 20.2 — Pao AI Generation Studio × Spec-Driven AI SDLC Orchestrator  
> - Phase 20.3 — Pao Desktop Vision Control MCP × Local Realtime Agent × Application Skill Engine  
> - Phase 20.4 — Pao Autonomous Engineering Council × Multi-Agent Parallel Worktree Execution  
>
> **Primary Goal:** ยกระดับระบบ Brain/Search/Graph เดิมของ Pao-hubPro ให้กลายเป็น **Living Knowledge Brain** ที่สามารถ ingest แหล่งข้อมูลหลายชนิด, compile ความรู้เป็น Markdown Wiki ที่อ่านและ version ได้, แตกข้อมูลเป็น Entity/Claim/Relation พร้อม provenance, ตรวจ contradiction/staleness, เชื่อม Project/Phase/Decision/Agent/Issue/Tool เข้าด้วยกัน และให้ทุก Agent ใน Pao-hubPro query ความรู้ระยะยาวจากฐานเดียวกันได้อย่าง traceable
>
> **Core Architecture Principle:**  
> `Raw Sources` และ `Canonical Project Data` คือหลักฐานต้นทาง  
> `Living Wiki` คือ curated knowledge artifact ที่ version ได้  
> `Claims/Relations/Search/Embeddings/Graph` เป็น derived indexes ที่ rebuild ได้  
> ไม่มี derived index ใดควรเป็นข้อมูลสำคัญเพียงสำเนาเดียว
>
> **Important:** Phase 20.5 ต้อง **reuse และ evolve Pao Brain Universe เดิม** ห้ามสร้าง Scanner/Search/Graph/Memory subsystem ซ้ำถ้ามีของเดิมอยู่แล้ว

---

# 0. Why Phase 20.5 Exists

เมื่อ Pao-hubPro มี Phase, Agent, Workflow, Project และ Automation จำนวนมาก ปัญหาจะเปลี่ยนจาก:

```text
AI ทำงานไม่เก่งพอ
```

เป็น:

```text
AI รู้ไม่ครบว่าเราเคยทำอะไร
AI จำ decision เก่าไม่ได้
AI เจอเอกสารหลายเวอร์ชันแล้วไม่รู้ว่าอันไหนล่าสุด
AI แนะนำ feature ซ้ำ
AI หา relationship ระหว่าง Phase ไม่เจอ
AI ใช้ข้อมูลเก่าโดยไม่รู้ว่ามัน stale
```

Phase 20.5 ต้องแก้ปัญหานี้

---

# 1. Existing Brain Universe Must Be Reused

ก่อน implement Codex ต้องค้นหา implementation เดิมที่เกี่ยวกับ:

```text
Pao Brain Universe
Project Registry
Project Scanner
Session Indexer
Memory
Search
Graph Engine
Ask Brain
Agent Events
Reviews
Issues
Telemetry
PostgreSQL / pgvector
FTS / embedding index
```

ถ้ามีอยู่แล้ว:

```text
extend
migrate
reuse
```

ห้ามสร้าง service ชุดใหม่ที่ทำหน้าที่เดียวกัน

---

# 2. Evolution from Brain Universe to Living Knowledge Brain

ของเดิมเน้น:

```text
SEE
INDEX
SEARCH
EXPLAIN
```

Phase 20.5 เพิ่ม:

```text
COMPILE
CANONICALIZE
LINK
VERSION
CITE
COMPARE
CONTRADICT
INVALIDATE
REFRESH
LINT
PRUNE
REBUILD
```

---

# 3. Roadmap Position

```text
20.2  SDLC Brain
20.3  Desktop Hands/Eyes
20.4  Multi-Agent Engineering Council
20.5  Shared Long-Term Knowledge Brain
```

ผลลัพธ์:

```text
ทุก Agent
 ↓
ใช้ Knowledge Brain เดียวกัน
 ↓
ตอบจากความรู้สะสม
 ↓
พร้อมที่มา
 ↓
รู้ว่าอะไรใหม่/เก่า/ขัดแย้ง
```

---

# 4. Mission สำหรับ Codex

คุณคือ:

- Principal Knowledge Systems Architect
- Information Retrieval Engineer
- Knowledge Graph Engineer
- LLM/RAG Engineer
- Data Engineer
- Search Engineer
- AI Agent Systems Engineer
- DevSecOps Engineer
- Full-stack Engineer
- SRE
- QA Architect

ทำงานใน repository:

```text
Pao-hubPro
```

ให้ implement:

```text
Phase 20.5
Pao Living Knowledge Brain
×
LLM Wiki
×
Persistent Knowledge Graph
```

แบบ production-grade

---

# 5. Core Concept

จากเดิม:

```text
Question
 ↓
Search raw files
 ↓
Read random chunks
 ↓
LLM answers
```

เป็น:

```text
Raw Sources
 ↓
Ingest
 ↓
Normalize
 ↓
Extract Entities / Claims / Relations
 ↓
Compile Living Wiki
 ↓
Link Pages
 ↓
Contradiction / Freshness Analysis
 ↓
Search Index + Graph + Embeddings
 ↓
Query Planner
 ↓
Wiki-first retrieval
 ↓
Source verification when needed
 ↓
Answer with provenance
```

---

# 6. Target Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                              Pao-hubPro                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Sources                                                                  │
│ ┌────────────┬────────────┬────────────┬───────────┬──────────────────┐ │
│ │ Git/Code   │ Phase Docs │ Sessions   │ Reviews   │ External Docs    │ │
│ │ PDFs/Notes │ Web/GitHub │ Issues     │ Decisions │ Desktop Evidence │ │
│ └─────┬──────┴──────┬─────┴─────┬──────┴─────┬─────┴────────┬─────────┘ │
│       │             │           │            │              │           │
│       └─────────────┴───────────┴────────────┴──────────────┘           │
│                              ▼                                           │
│                       Source Registry                                    │
│                              ▼                                           │
│                       Ingestion Pipeline                                 │
│                              ▼                                           │
│                         Normalization                                    │
│                              ▼                                           │
│                Entity / Claim / Relation Extractor                       │
│                              ▼                                           │
│                       Knowledge Compiler                                 │
│                              ▼                                           │
│                      Living Markdown Wiki                                │
│                              │                                           │
│         ┌────────────────────┼──────────────────────┐                    │
│         ▼                    ▼                      ▼                    │
│      FTS/Search          Knowledge Graph        Embeddings               │
│         │                    │                      │                    │
│         └────────────────────┼──────────────────────┘                    │
│                              ▼                                           │
│                         Query Planner                                    │
│                              ▼                                           │
│             Provenance / Freshness / Contradiction                       │
│                              ▼                                           │
│                          Ask Pao Brain                                   │
│                              │                                           │
│     ┌────────────────────────┼────────────────────────┐                  │
│     ▼                        ▼                        ▼                  │
│ Phase 20.2 SDLC        Phase 20.4 Council       Phase 20.3 Desktop       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# 7. Source-of-Truth Hierarchy

กำหนดชัด:

```text
Source Code / Project Files
= source code truth

Database canonical operational records
= operational truth

Phase/Decision records
= planning/decision truth

Raw source documents
= source evidence

Living Wiki
= curated compiled knowledge

Graph / Search Index / Embeddings
= derived representation
```

Derived data ต้อง rebuild ได้

---

# 8. Non-Negotiable Principles

1. ห้ามสร้างความจริงที่ไม่มี source
2. ทุก important claim ต้องมี provenance
3. ห้ามให้ embedding result เป็น source of truth
4. ห้ามให้ graph เป็น source of truth
5. Wiki page ต้องรู้ว่า compile จาก source ไหน
6. source update ต้อง invalidate derived knowledge ที่เกี่ยวข้อง
7. contradiction ต้องถูกแสดง ไม่ใช่ overwrite เงียบ
8. canonical decision เปลี่ยนต้องเก็บ supersession history
9. secret ต้องไม่เข้า index
10. RBAC/ACL ของ source ต้อง propagate ไป query
11. private source ห้าม leak ผ่าน generated wiki
12. local-only mode ต้องรองรับ
13. external LLM optional ไม่ใช่ mandatory
14. ingestion ต้อง incremental
15. ingestion ต้อง resumable
16. parser failure ต้อง isolate
17. large files ต้อง streaming/chunked
18. binary unsupported ต้อง report ไม่ crash
19. duplicate source ต้อง deduplicate
20. source fingerprint ต้อง version ได้
21. generated wiki ต้อง deterministic enough to diff/review
22. LLM-generated content ต้องแยกจาก source quote/evidence
23. query answer ต้องแสดง confidence/freshness เมื่อ relevant
24. stale knowledge ต้องมี flag
25. deleted source ต้อง trigger tombstone/invalidation
26. rebuild index ต้องไม่ทำข้อมูล canonical หาย
27. no hidden mutation of project source
28. Brain default ยังต้อง read/observe oriented
29. action request ต้องไป subsystem ที่มีสิทธิ์ execute
30. knowledge write-back ต้องผ่าน version/audit policy

---

# 9. Phase 20.5 Does Not Replace Phase 15 Brain Universe

ให้ rename/evolve logical branding ได้

แต่ architecture ต้อง reuse:

```text
Project Registry
Scanner
Session Index
Graph
Search
Telemetry
Memory
Review/Issue links
```

Phase 20.5 เพิ่ม Knowledge Compiler layer เหนือ foundation เดิม

---

# 10. Logical Module Layout

ปรับตาม repo:

```text
brain/
  sources/
  ingest/
  parsers/
  normalize/
  entities/
  claims/
  relations/
  compiler/
  wiki/
  provenance/
  freshness/
  contradiction/
  canonical/
  search/
  graph/
  embeddings/
  query/
  lint/
  rebuild/
  retention/
  policy/
  telemetry/
  api/
  mcp/
  ui/
```

หาก modules เดิมมีชื่ออื่น ให้ extend

---

# 11. Core Domain Objects

```text
KnowledgeSource
SourceVersion
SourceArtifact
SourceChunk
KnowledgeEntity
KnowledgeClaim
KnowledgeRelation
WikiPage
WikiRevision
CitationLink
KnowledgeDecision
ContradictionCase
FreshnessState
KnowledgeTag
KnowledgeCollection
IngestionRun
CompilationRun
QuerySession
QueryEvidence
```

---

# 12. KnowledgeSource

Fields:

```text
source_id
source_type
title
uri_or_path
project_id
owner
access_scope
enabled
canonicality
created_at
updated_at
last_ingested_at
metadata
```

---

# 13. Source Types

รองรับอย่างน้อย:

```text
PROJECT_FILE
MARKDOWN
TEXT
PDF
DOC/DOCX parsed representation
JSON
YAML
CSV
LOG
GIT_COMMIT
GIT_DIFF
GITHUB_REPOSITORY_METADATA
GITHUB_ISSUE_OR_PR if connector exists
SESSION_LOG
AGENT_RUN
REVIEW
ISSUE
DECISION
PHASE_SPEC
DESKTOP_EVIDENCE
WEB_SNAPSHOT
MANUAL_NOTE
```

implementation จริงขึ้นกับ connector/parser ที่ repo มี

---

# 14. SourceVersion

```text
source_version_id
source_id
version_number
content_hash
size
modified_at
ingested_at
parser_version
status
```

---

# 15. Source Fingerprint

Fingerprint ใช้:

```text
content hash
path/URI identity
provider revision
commit SHA
ETag/modified time when available
```

ห้ามใช้ modified time อย่างเดียว

---

# 16. Incremental Ingestion

ถ้า fingerprint ไม่เปลี่ยน:

```text
skip expensive recompile
```

ถ้าเปลี่ยน:

```text
parse changed source
invalidate affected claims/pages
recompile impacted neighborhood
```

---

# 17. Ingestion States

```text
DISCOVERED
QUEUED
PARSING
NORMALIZING
EXTRACTING
COMPILED
INDEXED
FAILED
QUARANTINED
DELETED
```

---

# 18. IngestionRun

```text
ingestion_run_id
source_id
source_version_id
status
started_at
ended_at
parser
chunks_created
entities_created
claims_created
pages_impacted
error
```

---

# 19. Parser Interface

```text
can_parse(source)
parse(source_version)
extract_metadata()
stream_chunks()
health()
```

---

# 20. Parser Safety

parser ต้อง:

```text
read-only
bounded memory
bounded file size policy
timeout
no macro execution
no embedded script execution
no arbitrary code execution
```

---

# 21. Archive Handling

ถ้ารองรับ ZIP:

```text
path traversal protection
file count limit
size limit
nested archive limit
```

---

# 22. Secret Exclusion

ก่อน index:

ตรวจ:

```text
.env
private keys
credential files
tokens
password patterns
secret manager exports
```

Reuse secret scanner เดิม

---

# 23. Ignore Rules

รองรับ:

```text
.gitignore
brain ignore config
project scan policy
binary denylist
size limit
secret denylist
generated directory policy
```

---

# 24. Normalized Document

Parser output:

```text
document_id
source_version_id
title
sections
text
metadata
anchors
timestamps
language
```

---

# 25. Chunking

Chunking ต้อง preserve:

```text
section hierarchy
line/page anchors
source offsets
```

ไม่ใช่ตัด token แบบ blind อย่างเดียว

---

# 26. SourceChunk

```text
chunk_id
source_version_id
section_path
start_offset
end_offset
page
line_start
line_end
content_hash
text
```

---

# 27. Entity Types

อย่างน้อย:

```text
PROJECT
PHASE
FEATURE
MODULE
SERVICE
AGENT
MODEL
TOOL
MCP_TOOL
WORKFLOW
PROVIDER
TECHNOLOGY
DATABASE
API
FILE
DECISION
ISSUE
ERROR
SOLUTION
PERSON_OR_ORG_REFERENCE
DOCUMENT
REPOSITORY
```

---

# 28. KnowledgeEntity

```text
entity_id
entity_type
canonical_name
aliases
description
project_id
status
created_at
updated_at
```

---

# 29. Entity Resolution

ต้องรองรับ alias:

```text
Pao-hubPro
Pao hubPro
pao-hubpro
```

แต่ห้าม merge entity จาก fuzzy match อย่าง aggressive

---

# 30. Entity Merge

Entity merge ต้อง:

```text
preview
evidence
audit
reversible mapping
```

---

# 31. KnowledgeClaim

Claim คือ atomic factual/decision statement

Fields:

```text
claim_id
subject_entity_id
predicate
object_value_or_entity
claim_type
status
confidence
source_priority
valid_from
valid_to
created_at
updated_at
```

---

# 32. Claim Types

```text
FACT
DECISION
REQUIREMENT
CAPABILITY
CONFIGURATION
STATUS
DEPENDENCY
OWNERSHIP
LIMITATION
RECOMMENDATION
HISTORICAL
```

---

# 33. Claim Provenance

ทุก claim มี links:

```text
source_version_id
chunk_id
anchor
extractor
extracted_at
```

หนึ่ง claim อาจมีหลาย sources

---

# 34. Claim Status

```text
ACTIVE
SUPERSEDED
DISPUTED
STALE
RETRACTED
UNVERIFIED
```

---

# 35. KnowledgeRelation

```text
relation_id
from_entity_id
relation_type
to_entity_id
source_claim_ids
valid_from
valid_to
status
```

---

# 36. Relation Types

```text
DEPENDS_ON
IMPLEMENTS
EXTENDS
REPLACES
SUPERSEDES
USES
PROVIDES
OWNED_BY
RELATED_TO
GENERATES
REVIEWS
FIXES
CAUSES
BLOCKS
REQUIRES
PART_OF
```

---

# 37. Knowledge Graph Principle

Graph derived from:

```text
entities
claims
relations
source metadata
```

Graph rebuild ได้

---

# 38. No Mandatory Neo4j

Phase 20.5 ไม่ต้องเพิ่ม Graph DB ใหม่ถ้า Postgres/relational graph tables เพียงพอ

Prefer:

```text
existing PostgreSQL
+
relation tables
+
recursive queries
```

ก่อนเพิ่ม infrastructure ใหม่

---

# 39. Living Wiki

Wiki คือ curated Markdown knowledge layer

ตัวอย่าง layout:

```text
knowledge/
  wiki/
    projects/
    phases/
    technologies/
    workflows/
    decisions/
    tools/
    issues/
    solutions/
    concepts/
  manifests/
  generated/
```

แต่ storage path ต้อง configurable

---

# 40. Wiki Source of Truth Rule

Wiki เป็น canonical curated knowledge artifact สำหรับการอ่าน/ใช้งานของ agent

แต่ factual evidence ยังย้อนกลับไป source provenance ได้เสมอ

---

# 41. WikiPage

```text
page_id
slug
title
page_type
canonical_entity_id
status
current_revision_id
created_at
updated_at
```

---

# 42. WikiRevision

```text
revision_id
page_id
revision_number
content_hash
markdown
compiler_version
source_set_hash
created_at
```

---

# 43. Wiki Page Types

```text
PROJECT
PHASE
TECHNOLOGY
WORKFLOW
DECISION
TOOL
ISSUE
SOLUTION
CONCEPT
TIMELINE
INDEX
```

---

# 44. Wiki Frontmatter

ตัวอย่าง:

```yaml
---
id: phase-20-3
type: phase
title: "Phase 20.3 — Desktop Vision Control MCP"
status: active
updated_at: ...
source_set_hash: ...
entities:
  - pao-hubpro
  - desktop-agent
---
```

---

# 45. Wiki Content Sections

Recommended:

```text
Summary
Current Status
Capabilities
Dependencies
Key Decisions
Architecture
Known Limitations
Related Pages
Source Evidence
Change History
```

ปรับตาม type

---

# 46. Knowledge Compiler

หน้าที่:

```text
collect impacted sources
extract claims/entities
resolve canonical entities
select current claims
detect conflicts
generate/update Markdown
preserve human-managed regions if supported
update indexes
```

---

# 47. Compiler Must Not Blindly Rewrite Human Notes

ถ้า Wiki page มี human-curated section:

ใช้ markers เช่น:

```text
<!-- PAO:HUMAN-START -->
...
<!-- PAO:HUMAN-END -->
```

compiler ห้าม overwrite

---

# 48. Generated vs Human Sections

แยก:

```text
generated
curated
hybrid
```

เพื่อ diff/review ง่าย

---

# 49. Compiler Version

ทุก revision เก็บ:

```text
compiler_version
prompt/template_version
model/provider if LLM used
```

---

# 50. Deterministic Compiler Path

ส่วนที่ทำ deterministic ได้ให้ทำก่อน LLM:

```text
metadata
links
source list
known dependencies
status fields
```

LLM ใช้สำหรับ:

```text
summarization
entity/claim proposal
narrative organization
```

---

# 51. LLM Provider Optionality

รองรับ:

```text
OpenAI-compatible
Local model
Future provider
```

แต่ basic indexing/search/rebuild ต้องทำได้แม้ external LLM unavailable

---

# 52. Local-Only Mode

Config:

```env
PAO_BRAIN_LOCAL_ONLY=true
```

เมื่อเปิด:

```text
no external LLM
no external embedding
no external content upload
```

---

# 53. Knowledge Commands

Logical commands:

```text
/ingest
/compile
/link
/query
/compare
/contradict
/update
/lint
/prune
/rebuild
```

---

# 54. /ingest

รับ source แล้ว:

```text
register
fingerprint
parse
normalize
extract
queue compilation
```

---

# 55. /compile

สร้าง/อัปเดต Living Wiki จาก current source state

---

# 56. /link

ตรวจ/เพิ่ม entity relationships

---

# 57. /query

query knowledge brain โดยมี provenance

---

# 58. /compare

เทียบ:

```text
Phase vs Phase
Version vs Version
Tool vs Existing Capability
Repo vs Existing Architecture
Decision A vs Decision B
```

---

# 59. /contradict

ค้นข้อมูลที่:

```text
subject/predicate เดียวกัน
แต่ object/value/status ขัดกัน
```

---

# 60. /update

refresh source/claim/page ที่ stale

---

# 61. /lint

ตรวจ quality ของ knowledge base

---

# 62. /prune

จัดการ:

```text
orphan pages
dead aliases
stale derived indexes
expired caches
```

ห้ามลบ raw/canonical source โดยอัตโนมัติ

---

# 63. /rebuild

rebuild:

```text
search index
embeddings
graph
generated wiki sections
```

จาก canonical data

---

# 64. Contradiction Example — Phase Numbering

ตัวอย่าง:

เก่า:

```text
Phase 20.3 = Autonomous Engineering Council
```

ใหม่:

```text
Phase 20.3 = Desktop Vision
Phase 20.4 = Autonomous Engineering Council
```

ระบบต้องสร้าง:

```text
ContradictionCase
```

แล้ว resolve ด้วย:

```text
decision timestamp
canonical roadmap
supersession relation
source priority
human confirmation when unclear
```

ห้ามลบ historical claim

---

# 65. ContradictionCase

```text
case_id
subject
predicate
claim_ids
status
severity
detected_at
resolved_at
resolution
canonical_claim_id
```

States:

```text
OPEN
AUTO_RESOLVED
NEEDS_REVIEW
RESOLVED
IGNORED_WITH_REASON
```

---

# 66. Auto-Resolution Rules

Auto resolve ได้เมื่อ:

```text
explicit SUPERSEDES relation
newer canonical decision
same source lineage with higher version
```

ห้าม auto resolve จาก timestamp อย่างเดียวถ้า source priority ต่างกัน

---

# 67. Source Priority

ตัวอย่าง policy:

```text
Explicit canonical decision
> current phase spec
> current source code/config
> reviewed docs
> agent summary
> external note
> unverified web snapshot
```

configurable ตาม domain

---

# 68. Freshness Model

Knowledge มี:

```text
FRESH
AGING
STALE
UNKNOWN
```

---

# 69. Freshness Inputs

```text
source modified time
source version
domain volatility
last verification
dependency changes
superseding claims
```

---

# 70. Domain Freshness Policy

ตัวอย่าง:

```text
API docs
→ shorter freshness window

architectural historical decision
→ longer

current queue/runtime state
→ not stored as durable wiki fact unless timestamped
```

---

# 71. Temporal Claims

Claim ที่เปลี่ยนตามเวลาเก็บ:

```text
valid_from
valid_to
observed_at
```

ห้ามสรุป current state จาก historical snapshot โดยไม่เช็ก freshness

---

# 72. Decision Records

สร้าง first-class:

```text
KnowledgeDecision
```

Fields:

```text
decision_id
title
status
decision
rationale_summary
alternatives
effective_at
supersedes
source_refs
```

---

# 73. Decision Status

```text
PROPOSED
ACCEPTED
SUPERSEDED
REJECTED
REVERSED
```

---

# 74. Architecture Decision Integration

ถ้า repo มี ADR:

```text
ingest ADR
link Decision entity
```

ห้ามสร้าง competing decision store

---

# 75. Phase Knowledge

ทุก Phase page ควรมี:

```text
phase number
name
status
depends on
implements
supersedes
key modules
acceptance
current implementation evidence
known gaps
```

แยก:

```text
Specification status
Implementation status
```

ห้ามถือ phase .md = implemented

---

# 76. Implementation Evidence

เชื่อม:

```text
Phase Spec
→ Commit
→ Tests
→ Review
→ Verification
```

---

# 77. Project Knowledge

Project page:

```text
purpose
architecture
stack
modules
active phases
services
agents
known issues
recent decisions
```

---

# 78. Technology Pages

เช่น:

```text
ComfyUI
RunPod
MCP
PostgreSQL
Git Worktree
```

มี:

```text
How Pao-hubPro uses it
Related phases
Config
Known limitations
Sources
```

---

# 79. Issue / Solution Pages

เมื่อ incident/error เกิด:

```text
Issue
 ↓
Root Cause
 ↓
Fix
 ↓
Verification
 ↓
Solution Page
```

ช่วยไม่แก้ปัญหาเดิมซ้ำ

---

# 80. Error Fingerprint

สร้าง fingerprint จาก:

```text
error code
exception type
normalized message
component
stack signature
```

เพื่อ link known solution

---

# 81. Agent Run Knowledge

Phase 20.4 agent runs สามารถสร้าง knowledge candidate:

```text
task outcome
files changed
test result
review findings
decision
```

แต่ agent output ไม่กลายเป็น canonical fact โดยอัตโนมัติ

---

# 82. Candidate Knowledge Workflow

```text
Agent Output
 ↓
Candidate Claims
 ↓
Source Verification
 ↓
Conflict Check
 ↓
Compile
```

---

# 83. Desktop Evidence Knowledge

Phase 20.3 evidence:

```text
timestamped observation
```

ใช้เป็น evidence ไม่ใช่ durable timeless fact

---

# 84. Generation Knowledge

Phase 19/20/20.1 สามารถสะสม:

```text
workflow characteristics
model requirements
runtime historical stats
known errors
provider behavior
```

แต่ operational metric time-series ควรอยู่ telemetry DB ไม่ใช่ Wiki ทุก sample

---

# 85. Knowledge vs Telemetry Boundary

Wiki:

```text
stable knowledge
decision
architecture
known behavior
summarized finding
```

Telemetry:

```text
per-second/per-job metric
raw event stream
```

Wiki อาจ link summary ไป telemetry query

---

# 86. Query Planner

เมื่อ user/agent query:

```text
classify intent
 ↓
identify entities
 ↓
retrieve wiki pages
 ↓
retrieve claims/relations
 ↓
check freshness/contradiction
 ↓
backfill raw source evidence
 ↓
compose answer
```

---

# 87. Wiki-First Retrieval

Prefer:

```text
Living Wiki
```

เพื่อ context compression

แล้วเปิด raw source เมื่อ:

```text
claim disputed
detail required
freshness uncertain
exact quote/code needed
```

---

# 88. Search Modes

รองรับ:

```text
FTS
Semantic
Entity
Graph
Hybrid
Exact
Temporal
```

---

# 89. Hybrid Search

score จาก:

```text
lexical relevance
semantic relevance
entity match
source priority
freshness
canonicality
```

---

# 90. Search Result Contract

```text
result_id
title
type
summary
score
freshness
canonicality
source_refs
entity_refs
```

---

# 91. Query Evidence

ทุก answer เก็บ optional:

```text
query
selected pages
selected claims
source versions
confidence
contradictions
```

เพื่อ debug

---

# 92. Answer Provenance

Answer ที่อิง knowledge ต้องสามารถบอก:

```text
จาก Wiki page ไหน
Claim ไหน
Source ไหน
Version ไหน
```

---

# 93. Confidence

Confidence ไม่ใช่ "ความมั่นใจของ LLM" อย่างเดียว

คำนวณจาก:

```text
source quality
agreement
freshness
canonicality
contradictions
retrieval coverage
```

---

# 94. Low Confidence Behavior

ถ้า low:

```text
state uncertainty
show conflicting evidence
ask for verification if needed
```

ห้าม fabricate certainty

---

# 95. Citation Link

```text
citation_id
claim_id
source_version_id
chunk_id
anchor
```

---

# 96. Line/Page Anchors

ถ้า source รองรับ:

```text
line
page
section
commit
URL fragment
```

เก็บไว้

---

# 97. Source Deletion

ถ้า source หาย:

```text
mark source tombstoned
invalidate claims
recompile affected pages
```

ห้ามลบ provenance history ทันที

---

# 98. Source Rename

Detect via:

```text
content hash
git rename metadata
project scanner
```

ไม่สร้าง duplicate entity หากชัดเจน

---

# 99. Duplicate Source

Detect:

```text
exact content hash
near-duplicate metadata
same provider ID
```

---

# 100. Human Notes

รองรับ user สร้าง:

```text
manual knowledge note
decision note
project note
```

ต้องมี provenance ว่า human-authored



---

# 101. Wiki Revision Diff

ทุก compile ต้องสามารถดู:

```text
added claims
removed claims
superseded claims
new relations
changed summary
source set changed
```

เพื่อ review

---

# 102. Human Review for Major Knowledge Changes

ถ้า compiler เปลี่ยน:

```text
canonical decision
project architecture
phase status
security policy
```

ให้มี stronger review policy

---

# 103. Knowledge Lint

`/lint` ตรวจอย่างน้อย:

```text
orphan pages
broken links
missing provenance
active claims without source
duplicate canonical entities
contradictions unresolved
stale critical pages
invalid frontmatter
unknown relation types
superseded page still marked current
```

---

# 104. Knowledge Health Score

Dashboard score ได้

แต่ห้ามใช้ score ซ่อน blocking lint

ส่วนประกอบ:

```text
coverage
freshness
provenance completeness
contradiction count
broken links
index health
```

---

# 105. Knowledge Collections

Group เช่น:

```text
Pao-hubPro
Adobe Stock
ComfyUI
RunPod
MCP
AI Research
Wor-Pao internal
```

แต่ ACL ต้องชัด

---

# 106. Project Isolation

Knowledge จาก project A ห้าม leak project B ถ้า user ไม่มี permission

---

# 107. ACL Propagation

Generated Wiki page ที่ใช้ 3 sources:

```text
page access
<=
intersection/strictest applicable source policy
```

อย่าทำ public summary จาก private source โดย default

---

# 108. Query Authorization

ก่อน retrieval:

```text
resolve user identity
filter source/page/claim ACL
then rank
```

ห้าม retrieve secret แล้วค่อย redactทีหลังอย่างเดียว

---

# 109. Secret Scanner

ก่อน ingest/index:

```text
detect
exclude
redact
quarantine
```

ตาม policy

---

# 110. Sensitive Knowledge Types

อาจกำหนด:

```text
SECRET
PRIVATE
INTERNAL
PUBLIC
```

---

# 111. Embedding Privacy

Embedding อาจ encode sensitive text

ดังนั้น:

```text
ACL metadata required
local storage preferred
delete/rebuild on source deletion
```

---

# 112. Embedding Model Versioning

เก็บ:

```text
embedding_model
dimension
version
generated_at
```

เปลี่ยน model → rebuild index

---

# 113. Search Index Rebuild

ต้อง:

```text
build new generation
validate
atomic switch
cleanup old later
```

ลด downtime

---

# 114. Graph Rebuild

Graph rebuild จาก canonical entities/claims/relations

ห้ามต้อง scrape Wiki markdown กลับอย่างเดียว

---

# 115. Wiki Rebuild

Wiki generated sections rebuild จาก claims/source set

human sections preserve

---

# 116. Rebuild State

```text
QUEUED
BUILDING
VALIDATING
READY
ACTIVE
FAILED
SUPERSEDED
```

---

# 117. Ingestion Queue

Reuse job infrastructure เดิม

ต้อง:

```text
retry
backoff
cancel
resume
idempotency
```

---

# 118. Idempotency

same source version:

```text
no duplicate chunks
no duplicate claims
no duplicate wiki revision if identical hash
```

---

# 119. Concurrency

หลาย source ingest ได้พร้อมกัน

แต่ page compile เดียวกันต้อง lock/version compare

---

# 120. Compilation Lock

key:

```text
page_id
source_set_hash
```

ป้องกัน lost update

---

# 121. Race — Source Changes During Compile

ถ้า source version เปลี่ยน:

```text
compiled revision marked stale
queue recompile
```

---

# 122. Event Types

```text
brain.source.discovered
brain.source.updated
brain.source.deleted
brain.ingest.started
brain.ingest.completed
brain.ingest.failed

brain.entity.created
brain.entity.merged
brain.claim.created
brain.claim.superseded
brain.claim.disputed

brain.contradiction.detected
brain.contradiction.resolved

brain.wiki.compiled
brain.wiki.updated
brain.wiki.stale

brain.index.rebuilt
brain.graph.rebuilt

brain.query.completed
brain.query.low_confidence
```

---

# 123. Audit

Audit action เช่น:

```text
manual source add
entity merge
claim override
canonical decision selection
contradiction resolution
human wiki edit
source delete
ACL change
```

---

# 124. Telemetry

Metrics:

```text
sources_total
sources_stale
ingest_queue_depth
ingest_failures
chunks_total
entities_total
claims_total
active_claims
contradictions_open
wiki_pages
wiki_pages_stale
search_latency
query_latency
citation_coverage
embedding_coverage
graph_edges
```

---

# 125. Query Quality Metrics

ถ้า feedback system มี:

```text
answer useful
missing source
wrong source
stale answer
contradiction missed
```

ใช้ปรับ retrieval

ห้าม auto change canonical facts จาก thumbs-up/down

---

# 126. Dashboard — Living Knowledge Brain

เพิ่มหน้า:

```text
Knowledge Brain
```

subsections:

```text
Overview
Sources
Wiki
Entities
Graph
Claims
Contradictions
Decisions
Search
Ingestion
Health
Settings
```

---

# 127. Brain Overview

แสดง:

```text
Sources
Fresh Sources
Stale Sources
Wiki Pages
Open Contradictions
Recent Decisions
Ingestion Queue
Index Health
Graph Health
```

---

# 128. Source Explorer

ผู้ใช้ดู:

```text
source
latest version
fingerprint
ingestion state
pages impacted
claims
ACL
```

---

# 129. Wiki UI

ต้องรองรับ:

```text
browse
search
backlinks
source evidence
revision history
diff
related entities
```

---

# 130. Entity UI

แสดง:

```text
canonical name
aliases
type
related claims
relations
wiki page
source coverage
```

---

# 131. Graph UI

Graph visualization เป็น optional UI enhancement

อย่าให้ visualization complexity block core phase

ต้อง filter:

```text
entity type
relation type
project
phase
time
```

---

# 132. Contradiction Inbox

แสดง:

```text
subject
conflicting claims
sources
timestamps
source priority
suggested resolution
```

actions:

```text
Resolve
Mark Historical
Supersede
Keep Disputed
```

ตาม permission

---

# 133. Decision Timeline

timeline:

```text
decision proposed
accepted
superseded
implemented
verified
```

---

# 134. Phase Timeline

ตัวอย่าง:

```text
Phase 19
→ 20
→ 20.1
→ 20.2
→ 20.3
→ 20.4
→ 20.5
```

พร้อม status spec/implementation แยก

---

# 135. Ask Pao Brain

Query UI:

```text
question
scope
project
time
include external
local-only
```

answer:

```text
summary
evidence
related pages
contradictions
freshness
```

---

# 136. Agent Knowledge API

ทุก agent ใช้ interface เดียว:

```text
search_knowledge
get_wiki_page
get_entity
get_claims
get_relations
compare_entities
get_decisions
check_contradictions
```

---

# 137. MCP Tools

Logical tools:

```text
brain_search
brain_query
brain_get_page
brain_get_page_history
brain_get_entity
brain_get_claims
brain_get_relations

brain_ingest_source
brain_refresh_source
brain_compile_page
brain_compile_impacted

brain_compare
brain_find_contradictions
brain_resolve_contradiction

brain_lint
brain_rebuild_search
brain_rebuild_graph
brain_rebuild_embeddings
brain_get_health
```

---

# 138. MCP Permission Model

```text
brain.read
brain.search
brain.ingest
brain.compile
brain.curate
brain.admin
```

---

# 139. Write Tool Safety

`brain_resolve_contradiction` และ `brain.curate` ต้อง stronger permission

---

# 140. REST API

Logical:

```text
GET  /api/brain/health
GET  /api/brain/sources
POST /api/brain/sources
POST /api/brain/sources/:id/refresh

GET  /api/brain/wiki
GET  /api/brain/wiki/:slug
GET  /api/brain/wiki/:slug/revisions
POST /api/brain/wiki/:slug/compile

GET  /api/brain/entities
GET  /api/brain/entities/:id
GET  /api/brain/claims
GET  /api/brain/relations

GET  /api/brain/contradictions
POST /api/brain/contradictions/:id/resolve

POST /api/brain/query
POST /api/brain/compare
POST /api/brain/lint
POST /api/brain/rebuild
```

ปรับตาม repo

---

# 141. Realtime Events

```text
brain.ingest.state
brain.compile.state
brain.contradiction
brain.page.updated
brain.index.state
brain.health
```

---

# 142. Database Tables

Logical:

```text
knowledge_sources
source_versions
source_chunks
knowledge_entities
entity_aliases
knowledge_claims
claim_provenance
knowledge_relations
wiki_pages
wiki_revisions
wiki_source_links
knowledge_decisions
contradiction_cases
ingestion_runs
compilation_runs
query_evidence
index_generations
```

reuse existing Phase 15 tables where possible

---

# 143. Migration Strategy from Brain Universe

Codex ต้อง:

```text
inventory old schema
map old project/session/memory/graph/search records
add new tables/columns
backfill references
preserve IDs where practical
avoid destructive migration
```

---

# 144. Existing Graph Compatibility

ถ้ามี old graph schema:

```text
adapter/migration
```

ห้ามสร้าง second graph disconnected

---

# 145. Existing Search Compatibility

ถ้ามี FTS/pgvector:

```text
reuse index infra
```

เพิ่ม:

```text
wiki pages
claims
entities
```

เป็น document types

---

# 146. Existing Session Indexer

Phase 20.5 ingest session summaries/events ผ่าน adapter

ห้าม reparse raw session format หลายชุดซ้ำถ้ามี canonical parser แล้ว

---

# 147. Existing Project Scanner

เพิ่ม source events จาก scanner

เช่น:

```text
file.created
file.modified
file.deleted
```

→ source registry

---

# 148. Existing Review / Issue Integration

link:

```text
Review Finding
→ Issue Entity
→ Fix Commit
→ Solution Page
```

---

# 149. Phase 20.2 Integration

เมื่อ cycle converge:

```text
Spec
Decision
Task outcomes
Verification
Known limitations
```

ส่ง candidate knowledge ไป Brain

---

# 150. Phase 20.4 Integration

หลัง CouncilRun:

```text
changesets
review findings
merge readiness
integration result
```

สร้าง knowledge candidates

---

# 151. Phase 20.3 Integration

Desktop evidence:

```text
timestamped observation
```

เก็บ link เข้ากับ task/issue/page ที่เกี่ยวข้อง

---

# 152. Phase 19/20/20.1 Integration

สร้าง knowledge summary เช่น:

```text
Workflow compatibility
Model requirements
Provider characteristics
Known queue issue
Known RunPod setup
```

ไม่ ingest secret runtime config

---

# 153. Git Integration

สำหรับ repo source:

```text
commit SHA
branch
file path
line anchor
```

ใช้ provenance ได้

---

# 154. Git History Knowledge

ไม่ต้อง ingest commit ทุก commit แบบหนักโดย default

config:

```text
current tree
important commits
phase commits
decision-linked commits
```

---

# 155. Git Diff Knowledge

เมื่อ Phase 20.4 changeset complete:

diff metadata สามารถใช้ link "implemented by"

---

# 156. External Web/GitHub Sources

ถ้ามี connector:

```text
store source metadata
snapshot/fingerprint
ingest permitted content
```

ต้องเคารพ license/access/policy

---

# 157. External Source Freshness

ต้องมี refresh policy

เช่น:

```text
manual
daily
weekly
on-demand
```

แต่ Phase นี้ไม่จำเป็นต้องสร้าง external scheduler ใหม่ถ้า job/automation infra มีอยู่

---

# 158. Source Trust

Metadata:

```text
OFFICIAL
PRIMARY
INTERNAL
COMMUNITY
UNVERIFIED
```

ใช้ในการ ranking/contradiction

---

# 159. No Truth by Popularity

หลาย low-quality sources ไม่ควรชนะ official source แค่จำนวนเยอะ

---

# 160. Provenance Coverage Gate

Wiki page critical ต้องมี threshold:

```text
key claims have source links
```

ถ้าขาด:

```text
mark NEEDS_EVIDENCE
```

---

# 161. Page Status

```text
CURRENT
STALE
NEEDS_EVIDENCE
DISPUTED
ARCHIVED
DRAFT
```

---

# 162. Page Invalidation

trigger จาก:

```text
source update
claim superseded
decision changed
entity merged
dependency changed
manual invalidation
```

---

# 163. Impact Graph

ต้องหา:

```text
Source
→ Claim
→ Page
→ Related Page
```

เพื่อ recompile เฉพาะ impacted

---

# 164. Avoid Full Rebuild on Every Change

Incremental default

full rebuild เป็น admin operation

---

# 165. Knowledge Pruning

`/prune` ทำ:

```text
remove obsolete derived cache
archive unreachable generated revisions
collapse unused aliases after review
cleanup superseded index generations
```

ห้ามลบ canonical source historyโดย silent

---

# 166. Backup

Backup อย่างน้อย:

```text
canonical DB
wiki/human content
source registry metadata
decision records
manual notes
```

Derived:

```text
embeddings
search index
graph materialization
```

rebuild ได้

---

# 167. Restore

Restore flow:

```text
restore canonical DB/wiki
validate sources
rebuild graph/search/embeddings
run knowledge lint
```

---

# 168. Disaster Recovery Test

ต้องมี test/documented drill สำหรับ:

```text
index lost
graph lost
embedding table lost
```

และ rebuild ได้

---

# 169. Parser Failure Recovery

resume/checkpoint ตาม source

---

# 170. Compiler Failure Recovery

เก็บ previous active wiki revision

ไม่ publish partial revision

---

# 171. Atomic Wiki Publish

compile:

```text
build draft revision
validate
lint
commit DB/file transaction as practical
activate
```

---

# 172. Markdown Storage Strategy

ถ้าใช้ filesystem:

```text
atomic temp write + rename
```

และ normalize filename/slug

---

# 173. Wiki Git Tracking

Optional:

wiki generated artifactsอาจ track Git

แต่ห้ามบังคับถ้าทำให้ repo noisy

policy:

```text
DB-only
Filesystem
Git-tracked
Hybrid
```

---

# 174. Recommended Default

สำหรับ Pao-hubPro:

```text
Markdown files
+
DB metadata
+
search/graph indexes
```

แต่ adapt ตาม architecture เดิม

---

# 175. Query Context Compression

Wiki page มีประโยชน์เพื่อ:

```text
ลด raw chunks
ลด repeated retrieval
ให้ context สม่ำเสมอ
```

---

# 176. Source Backfill

ถ้าคำถามต้อง detail:

```text
retrieve raw chunk linked by claim
```

ไม่ rely summary อย่างเดียว

---

# 177. Compare Engine

`/compare` output:

```text
shared capabilities
differences
overlap
conflicts
missing capability
recommendation
sources
```

---

# 178. Duplicate Feature Detection

เมื่อ ingest repo/tool ใหม่:

```text
extract capabilities
compare Pao-hubPro entities
identify overlap
```

ช่วยไม่สร้าง Phase ซ้ำ

---

# 179. Phase Recommendation

Brain สามารถเสนอ:

```text
extend existing Phase
new subphase
new Phase
no action
```

แต่ proposal ไม่แก้ roadmap อัตโนมัติ

---

# 180. Recommendation Provenance

ต้องบอก:

```text
based on which existing capabilities
which gaps
which sources
```

---

# 181. Historical Query

รองรับ:

```text
"Phase 20.3 เคยถูกวางแผนเป็นอะไร?"
```

ตอบจาก superseded claims/timeline

---

# 182. Current Query

รองรับ:

```text
"Phase 20.3 ตอนนี้คืออะไร?"
```

เลือก ACTIVE canonical claim

---

# 183. Temporal Query

```text
"ณ วันที่ X architecture เป็นแบบไหน?"
```

ใช้ valid_from/valid_to เท่าที่มี

---

# 184. Knowledge Snapshot

สามารถสร้าง:

```text
snapshot_id
as_of
source_set
wiki_revision_set
index_generation
```

เพื่อ reproducible agent run

---

# 185. Phase 20.4 Knowledge Pinning

CouncilRun อาจ pin knowledge snapshot เพื่อไม่ให้ context เปลี่ยนกลาง run

---

# 186. Query Cache

cache ได้ตาม:

```text
query hash
scope
knowledge generation
ACL
```

knowledge generation เปลี่ยน → invalidate

---

# 187. Cache Privacy

cache key ต้องรวม permission context

---

# 188. Knowledge Generation ID

ทุก major publish มี:

```text
knowledge_generation_id
```

ผูก:

```text
active wiki revisions
graph generation
search generation
embedding generation
```

---

# 189. Consistency Check

ก่อน mark generation ACTIVE:

```text
indexes refer valid entities
wiki links resolve
claim provenance exists
ACL metadata exists
```

---

# 190. Local-Only Search

ต้องทำได้ด้วย:

```text
Postgres FTS
local embeddings optional
graph
wiki
```

ไม่ require cloud

---

# 191. Offline Mode

ถ้า external source unavailable:

```text
query existing knowledge
show source may be stale
```

---

# 192. Model Failure

ถ้า LLM compiler unavailable:

```text
deterministic ingest/index continues
queue narrative compile
```

---

# 193. Embedding Failure

FTS/entity/graph search ยังทำงาน

---

# 194. Graph Failure

Wiki/FTS ยังทำงาน

---

# 195. Graceful Degradation

Health แยก components:

```text
source registry
ingest
compiler
wiki
search
embedding
graph
query
```

---

# 196. Health Status

```text
HEALTHY
DEGRADED
UNAVAILABLE
REBUILDING
```

---

# 197. Performance Targets

ไม่ hard-failจาก hardware variation แต่ design baseline:

```text
wiki page lookup < 200ms typical local
FTS query < 500ms typical
hybrid query < 2s typical excluding external LLM
incremental source detection fast enough for repo use
```

---

# 198. Scale Targets

รองรับอย่างน้อย:

```text
multiple projects
tens of thousands of files metadata
large session/event history
thousands of wiki pages
hundreds of thousands of claims/chunks
```

architecture ต้อง paginate/stream

---

# 199. Large Source Handling

ห้ามโหลดทั้ง file ใหญ่เข้า memory ถ้าไม่จำเป็น

---

# 200. Pagination

API/UI list:

```text
sources
claims
entities
revisions
contradictions
events
```

ต้อง paginate



---

# 201. Test Strategy

ต้องมี:

```text
Unit
Parser
Fingerprint
Chunking
Entity Resolution
Claim Extraction
Provenance
Wiki Compiler
Contradiction
Freshness
Search
Graph
Embeddings
ACL
Incremental Ingestion
Rebuild
Recovery
MCP/API
Migration
```

---

# 202. Parser Tests

fixtures:

```text
Markdown
Text
JSON
YAML
PDF parsed text fixture
session log
phase spec
bad encoding
large file
unsupported binary
```

---

# 203. Fingerprint Tests

```text
same content same hash
changed content new version
rename detection
provider revision change
```

---

# 204. Chunk Anchor Tests

ต้อง verify:

```text
page
line
section
offset
```

ไม่หายหลัง normalization

---

# 205. Secret Exclusion Tests

fixtures ที่มี fake secrets

Expected:

```text
not indexed
redacted/quarantined
audit/metric
```

ห้ามใช้ real secret

---

# 206. Entity Resolution Tests

```text
Pao-hubPro
Pao hubPro
pao-hubpro
```

ควร resolve ตาม rules

แต่:

```text
Pao-hubPro
Pao AI Generation Studio
```

ห้าม merge เพียงชื่อใกล้กัน

---

# 207. Claim Tests

ตรวจ:

```text
provenance required
status transitions
supersession
temporal validity
```

---

# 208. Contradiction Tests

Case:

```text
Phase 20.3 = Council
vs
Phase 20.3 = Desktop Vision
```

Expected:

```text
contradiction detected
new canonical roadmap supersedes old placeholder
history preserved
```

---

# 209. Wiki Compiler Tests

```text
new page
update page
no-op identical compile
human section preserved
broken source
source removed
```

---

# 210. Atomic Publish Tests

compiler crash ก่อน activate:

```text
previous revision remains active
```

---

# 211. Search Tests

```text
exact
FTS
semantic if enabled
entity
hybrid
ACL-filtered
stale ranking
```

---

# 212. Graph Tests

```text
edge creation
edge supersession
cycle query
rebuild
orphan cleanup
```

---

# 213. ACL Tests

User ไม่มี access source:

```text
must not receive page/claim/snippet derived solely from source
```

---

# 214. Local-Only Tests

เมื่อ:

```text
PAO_BRAIN_LOCAL_ONLY=true
```

ต้อง assert:

```text
external LLM not called
external embedding not called
```

---

# 215. Rebuild Tests

ลบ derived index fixture:

```text
rebuild from canonical data
```

ผล:

```text
equivalent search/graph generation
```

---

# 216. Incremental Tests

เปลี่ยน source 1 จาก 100:

```text
only impacted chunks/pages reprocess
```

เท่าที่ architecture รองรับ

---

# 217. Recovery Tests

simulate restart ระหว่าง:

```text
ingest
compile
index rebuild
```

resume/idempotent

---

# 218. Migration Tests

old Brain Universe data:

```text
project
session
memory/search metadata
graph records
```

ต้องยัง query ได้หลัง migration เท่าที่ schema map ได้

---

# 219. Acceptance Scenario 1 — Ask Existing Capability

Question:

```text
เราเคยทำ Smart Queue หรือยัง?
```

Expected:

```text
resolve Pao-hubPro
find Phase 20.1
show current capability
show source/evidence
```

---

# 220. Acceptance Scenario 2 — New GitHub Tool

Ingest external repository metadata/docs

Then:

```text
extract capabilities
compare existing entities
identify overlap/gap
propose extend/new phase
```

ไม่แก้ roadmapเอง

---

# 221. Acceptance Scenario 3 — Contradictory Roadmap

มี old + new Phase 20.3

Expected:

```text
show current canonical
preserve old historical
explain supersession
```

---

# 222. Acceptance Scenario 4 — Stale Source

Official source version changed

Expected:

```text
old claim/page marked stale
refresh queued
query warns until current evidence available
```

---

# 223. Acceptance Scenario 5 — Deleted Source

Expected:

```text
tombstone
invalidate claim
recompile
history retained
```

---

# 224. Acceptance Scenario 6 — Local-Only

Expected:

```text
no cloud request
local search/query works
```

---

# 225. Acceptance Scenario 7 — Brain Universe Reuse

Existing project scanner/search/graph present

Expected:

```text
Phase 20.5 extends them
no duplicate service tree
```

---

# 226. Acceptance Scenario 8 — Phase 20.4 Knowledge

CouncilRun completes

Expected:

```text
verified implementation facts become candidates
review findings linked
phase page refreshes after canonical evidence
```

---

# 227. Acceptance Scenario 9 — Human Curated Wiki

Compiler refreshes page

Expected:

```text
human-managed section remains unchanged
generated section updates
```

---

# 228. Acceptance Scenario 10 — ACL

Private source contributes to internal page

Unauthorized user query:

```text
no leakage
```

---

# 229. Implementation Order

```text
1  Inspect existing Brain Universe implementation
2  Map scanner/search/graph/session/memory schema
3  Define source/version/provenance model
4  Add migration compatibility
5  Build source registry + versioning
6  Extend incremental ingestion
7  Add normalized document/chunk anchors
8  Add entity/claim/relation model
9  Add provenance layer
10 Add canonical/supersession rules
11 Add contradiction engine
12 Add freshness/invalidation
13 Add Living Wiki page/revision model
14 Add compiler + human section preservation
15 Extend FTS/search
16 Extend graph
17 Extend embeddings if already available/desired
18 Build hybrid query planner
19 Add compare/lint/rebuild
20 Integrate Phase 20.2/20.3/20.4
21 Add MCP/API/realtime
22 Add dashboard
23 Add tests
24 Add docs/config
25 Run migration/rebuild verification
```

---

# 230. Repository Inspection Checklist

ก่อน coding:

```text
existing brain-universe services
project registry
scanner
session indexer
graph engine
search engine
pgvector
FTS
memory schema
review/issues
agent events
PostgreSQL migrations
asset/file storage
MCP
RBAC
event bus
job queue
dashboard
```

---

# 231. No Duplicate Service Rule

ห้ามสร้าง:

```text
living-brain-new-search
knowledge-graph-v2
wiki-scanner-new
```

ถ้าของเดิม extend ได้

---

# 232. Backward Compatibility

Existing:

```text
Ask Brain
Search
Graph
Project Registry
Sessions
```

ต้องยังใช้ได้หรือมี migration/adapter ชัดเจน

---

# 233. Feature Flags

Example:

```env
PAO_LIVING_BRAIN_ENABLED=false
PAO_BRAIN_WIKI_ENABLED=true
PAO_BRAIN_CLAIMS_ENABLED=true
PAO_BRAIN_CONTRADICTION_ENABLED=true
PAO_BRAIN_LOCAL_ONLY=false
PAO_BRAIN_EXTERNAL_LLM_ENABLED=true
PAO_BRAIN_EMBEDDINGS_ENABLED=true
PAO_BRAIN_AUTO_COMPILE=true
```

ปรับกับ settings เดิม

---

# 234. Safe Default

Brain สามารถ:

```text
read
index
compile derived knowledge
```

แต่ห้ามใช้ความรู้เพื่อ execute destructive action โดยตรง

การ act ต้องไป:

```text
Phase 20.2/20.3/20.4
```

พร้อม policy

---

# 235. Brain-to-Agent Contract

Brain returns:

```text
knowledge
evidence
confidence
freshness
contradictions
```

Agent เป็นผู้ตัดสิน action ตาม subsystem policy

---

# 236. No Silent Roadmap Rewrite

Brain พบ contradiction:

```text
propose resolution
```

ห้าม rewrite canonical roadmap โดยไม่มี rule/approval

---

# 237. Manual Curation

Curator สามารถ:

```text
choose canonical entity
resolve contradiction
mark claim superseded
add decision
edit human note
```

ทุก action audited

---

# 238. Knowledge Review Roles

อาจมี:

```text
Knowledge Curator
Architecture Reviewer
Security Reviewer
Project Owner
```

---

# 239. Critical Knowledge Changes

เช่น:

```text
security rule
production architecture
phase identity
canonical provider config
```

ต้อง stronger review/approval policy ถ้า write-back มีผลสูง

---

# 240. Source Licensing / Copyright

เก็บเท่าที่ระบบมีสิทธิ์เข้าถึง

สำหรับ external source:

```text
prefer metadata
summary
short evidence anchors
source link/reference
```

ไม่ต้อง duplicate full third-party content โดยไม่มีเหตุผล

---

# 241. Raw Source Retention

ถ้า source เป็น external snapshot:

retention configurable

ถ้า source เป็น project file:

repo เป็น canonical source ไม่ต้อง duplicate full contentหลายสำเนา

---

# 242. Storage Efficiency

ใช้:

```text
content hashes
dedup chunks
compressed logs
index generations
```

ตาม stack

---

# 243. Data Retention Settings

```text
source versions
wiki revisions
query evidence
ingestion logs
embedding generations
```

แยก retention

---

# 244. Query Evidence Privacy

Query history อาจ sensitive

ต้อง:

```text
RBAC
retention
optional disable
```

---

# 245. Documentation

สร้าง/อัปเดต:

```text
docs/knowledge-brain/README.md
docs/knowledge-brain/architecture.md
docs/knowledge-brain/sources.md
docs/knowledge-brain/wiki.md
docs/knowledge-brain/claims.md
docs/knowledge-brain/contradictions.md
docs/knowledge-brain/search.md
docs/knowledge-brain/security.md
docs/knowledge-brain/migration-from-brain-universe.md
docs/knowledge-brain/rebuild-recovery.md
```

---

# 246. Operator Quick Start

```text
1 Enable Living Brain
2 Verify existing Brain migration
3 Register/scan Pao-hubPro
4 Ingest Phase docs
5 Compile project/phase wiki
6 Run knowledge lint
7 Resolve open contradiction
8 Ask Pao Brain
9 Inspect source provenance
10 Test rebuild
```

---

# 247. Bootstrap Existing Phase Docs

Initial bootstrap ควร ingest:

```text
Phase 19
Phase 20
Phase 20.1
Phase 20.2
Phase 20.3
Phase 20.4
```

และ older Brain Universe phase docs ที่เกี่ยวข้อง

---

# 248. Bootstrap Canonical Roadmap

สร้าง/อัปเดต current roadmap claims:

```text
19     AI Generation Studio
20     Multi-GPU / RunPod Router
20.1   Smart Queue / Cloud Burst
20.2   Spec-Driven SDLC
20.3   Desktop Vision Control
20.4   Autonomous Engineering Council
20.5   Living Knowledge Brain
```

แต่ status ต้อง derive จาก actual evidence ไม่ใช่แค่ file existence

---

# 249. Spec vs Implementation Status

ทุก phase:

```text
SPEC_DRAFT
SPEC_READY
IMPLEMENTING
IMPLEMENTED_UNVERIFIED
VERIFIED
PARTIAL
BLOCKED
```

ห้าม infer `VERIFIED` จากชื่อเอกสาร

---

# 250. Verification Evidence Link

`VERIFIED` ต้อง link:

```text
test/build report
commit
review
final verification
```

---

# 251. Knowledge Lint Exit Gate

Phase completion อย่างน้อย:

```text
[ ] no active claim without provenance where required
[ ] wiki links valid
[ ] current roadmap has no unresolved blocking contradiction
[ ] core project page current
[ ] core phase pages current
[ ] search index healthy
[ ] graph healthy/rebuildable
[ ] ACL tests pass
[ ] local-only test pass
```

---

# 252. Definition of Done — Foundation

```text
[ ] existing Brain Universe audited/reused
[ ] source registry versioned
[ ] incremental ingestion
[ ] source chunks anchored
[ ] entity model
[ ] claim model
[ ] provenance
[ ] relations
[ ] canonical/supersession
```

---

# 253. Definition of Done — Living Wiki

```text
[ ] wiki pages
[ ] revisions
[ ] compiler
[ ] source links
[ ] human section preservation
[ ] invalidation
[ ] atomic publish
[ ] history/diff
```

---

# 254. Definition of Done — Intelligence

```text
[ ] contradiction detector
[ ] freshness
[ ] compare
[ ] hybrid query
[ ] source backfill
[ ] confidence/provenance
[ ] duplicate capability detection foundation
```

---

# 255. Definition of Done — Derived Systems

```text
[ ] FTS/Search integration
[ ] graph integration
[ ] embedding integration or graceful disable
[ ] rebuild generations
[ ] health
```

---

# 256. Definition of Done — Integrations

```text
[ ] Phase 20.2 knowledge candidates
[ ] Phase 20.3 evidence links
[ ] Phase 20.4 Council outcome links
[ ] Phase 19/20/20.1 knowledge links
[ ] MCP
[ ] REST API
[ ] Realtime events
[ ] Dashboard
```

---

# 257. Definition of Done — Safety

```text
[ ] secret exclusion
[ ] ACL propagation
[ ] local-only
[ ] no source mutation
[ ] no silent action
[ ] no derived index as only truth
[ ] rebuild tested
[ ] audit
```

---

# 258. Definition of Done — Engineering

```text
[ ] migrations
[ ] backfill
[ ] parser tests
[ ] knowledge tests
[ ] search tests
[ ] ACL tests
[ ] recovery tests
[ ] docs
[ ] .env.example
[ ] final report
```

---

# 259. Codex Must Not Finish With

ห้ามจบเพียง:

```text
Vector DB added
Graph prototype
RAG endpoint
Wiki scaffold
Embedding search works
```

Phase 20.5 ต้องมีครบ:

```text
Provenance
Versioning
Canonical Claims
Contradiction
Freshness
Living Wiki
Rebuild
Security
```

---

# 260. Known Anti-Patterns

ห้าม:

```text
embed every file and call it memory
use vector similarity as truth
overwrite conflicting facts silently
generate wiki with no source links
store secrets in embeddings
rebuild whole corpus for every file change
duplicate Phase 15 scanner/search/graph
let Agent output become fact automatically
```

---

# 261. Manual Smoke Checklist

```text
[ ] existing project scanner discovered
[ ] ingest Phase 20.3
[ ] ingest Phase 20.4
[ ] compile project page
[ ] compile phase pages
[ ] search "Desktop Vision"
[ ] compare Phase 20.3 vs 20.4
[ ] contradiction old/new 20.3 detected
[ ] canonical current roadmap correct
[ ] source evidence opens
[ ] human section survives compile
[ ] local-only prevents external provider
[ ] rebuild search works
[ ] rebuild graph works
[ ] ACL prevents restricted result
```

---

# 262. Final Verification Report Format

Codex ต้องตอบ:

```text
Phase 20.5 Implementation Complete

1. Existing Brain Universe inspected
2. Existing components reused
3. Architecture implemented
4. Files added
5. Files modified
6. Database migrations
7. Migration/backfill from Brain Universe
8. Source registry/versioning
9. Parsers/normalization
10. Incremental ingestion
11. Entity model
12. Claim model
13. Provenance
14. Relation/graph integration
15. Living Wiki
16. Wiki revisions/compiler
17. Human-curated preservation
18. Contradiction engine
19. Freshness/invalidation
20. Canonical/supersession rules
21. Search/FTS
22. Embeddings
23. Query planner
24. Compare/lint/rebuild
25. Phase 20.2 integration
26. Phase 20.3 integration
27. Phase 20.4 integration
28. MCP tools
29. API endpoints
30. Realtime events
31. Dashboard
32. Security/ACL/local-only
33. Tests added
34. Commands actually executed
35. Test results
36. Migration result
37. Rebuild result
38. Build result
39. Known limitations
40. Manual setup
41. Backup/recovery
42. Recommended next phase
```

ห้ามรายงาน PASS ถ้าไม่ได้รันจริง

---

# 263. Recommended Next Direction — DO NOT IMPLEMENT

หลัง 20.5 เสถียร อาจต่อ:

```text
Pao Self-Improving Skill Foundry
```

แนวคิด:

```text
Incidents
Agent Outcomes
Desktop Runs
Knowledge Brain
 ↓
detect repeated workflow
 ↓
propose reusable Skill
 ↓
test
 ↓
review
 ↓
human approve
 ↓
publish
```

แต่ต้องไม่ auto-publish autonomous skill โดยไม่มี gate

---

# 264. Alternative Future Direction

```text
Pao Portfolio Intelligence
```

ให้ Knowledge Brain วิเคราะห์หลาย project/repo พร้อมกัน

---

# 265. Final Command to Codex

```text
Implement Phase 20.5 now in the existing Pao-hubPro repository.

Do not create a new repository.

This phase MUST inspect and reuse the existing Pao Brain Universe, Project Registry, Project Scanner, Session Indexer, Search, Graph, Memory, Review/Issue, PostgreSQL/pgvector/FTS, MCP, event, auth/RBAC, job, audit, telemetry, and dashboard infrastructure wherever it already exists.

Do not build a duplicate knowledge platform.

Evolve the existing Brain foundation into:

Pao Living Knowledge Brain
× LLM Wiki
× Persistent Knowledge Graph

Implement:

- versioned Source Registry
- source fingerprinting
- incremental/resumable ingestion
- normalized documents and anchored chunks
- entity resolution
- atomic Knowledge Claims
- claim provenance
- typed relations
- canonical/supersession rules
- temporal validity
- contradiction detection/resolution
- freshness/staleness/invalidation
- versioned Living Markdown Wiki
- generated vs human-curated sections
- atomic Wiki publication
- source-linked revisions and diffs
- FTS/search integration
- graph integration
- optional embeddings with model/version tracking
- hybrid Query Planner
- wiki-first retrieval with raw-source backfill
- /ingest
- /compile
- /link
- /query
- /compare
- /contradict
- /update
- /lint
- /prune
- /rebuild
- ACL propagation
- secret exclusion
- LOCAL_ONLY mode
- derived-index rebuildability
- backup/recovery
- MCP tools
- REST API
- realtime events
- Knowledge Brain dashboard
- migrations/backfill
- tests
- docs
- .env.example
- Final Verification Report

Integrate current roadmap and knowledge from:

Phase 19
Phase 20
Phase 20.1
Phase 20.2
Phase 20.3
Phase 20.4

The system must correctly preserve historical knowledge while identifying the current canonical roadmap. In particular, it must be able to represent that an older plan assigned Autonomous Engineering Council to Phase 20.3, while the current roadmap supersedes that with Desktop Vision as 20.3 and Engineering Council as 20.4.

Never infer "implemented" merely because a phase specification file exists. Keep specification status and implementation/verification status separate.

Do not use embeddings, graph edges, LLM summaries, or agent output as the sole source of truth.

All important claims must be traceable to source evidence.

If external LLM or embedding providers are unavailable, deterministic ingestion, FTS, canonical metadata, provenance, Wiki storage, linting, and rebuild operations must degrade gracefully and remain usable where feasible.

Run the repository's real migrations, tests, lint, typecheck, and build commands.
Fix Phase-20.5-related failures.
Document pre-existing failures separately.

Protect existing user work and existing Brain Universe data.

Finish only after producing the Phase 20.5 Final Verification Report.
```

---

# End of Phase 20.5 Specification

**Phase 20.5 — Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph**

เป้าหมายสูงสุด:

```text
ไม่ใช่แค่ให้ AI "ค้นไฟล์เก่งขึ้น"

แต่ให้ Pao-hubPro มี
ความรู้สะสม
ที่มีโครงสร้าง
มีเวอร์ชัน
มีที่มา
รู้ว่าอะไรปัจจุบัน
รู้ว่าอะไรเก่า
รู้ว่าอะไรขัดกัน
และทุก Agent ใช้ร่วมกันได้
```

สถาปัตยกรรมสุดท้าย:

```text
RAW SOURCES
     ↓
INGEST
     ↓
NORMALIZE
     ↓
ENTITY + CLAIM + RELATION
     ↓
PROVENANCE
     ↓
LIVING WIKI
     ↓
SEARCH + GRAPH + EMBEDDINGS
     ↓
FRESHNESS + CONTRADICTION
     ↓
PAO KNOWLEDGE BRAIN
     ↓
┌──────────────┬──────────────┬──────────────┐
│ Phase 20.2   │ Phase 20.3   │ Phase 20.4   │
│ SDLC         │ Desktop      │ Council      │
└──────────────┴──────────────┴──────────────┘
```

ด้วยหลัก:

```text
Source First
Provenance Always
Derived Data Rebuildable
Contradictions Visible
Human Control Preserved
```
