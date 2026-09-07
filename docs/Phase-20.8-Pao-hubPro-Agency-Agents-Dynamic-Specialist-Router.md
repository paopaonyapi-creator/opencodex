# Phase 20.8 — Pao-hubPro × Agency Agents Dynamic Specialist Router & AI Team Orchestrator

> **Project:** Pao-hubPro  
> **Phase:** 20.8  
> **Codename:** `Agency Intelligence Layer`  
> **Primary Goal:** ทำให้ Pao-hubPro เลือกผู้เชี่ยวชาญ AI ที่เหมาะกับงานแบบอัตโนมัติ, โหลด Agent แบบ Lazy Loading, สร้างทีมแบบ Dynamic, มอบหมายงานแบบ Parallel/Sequential, รวมผลผ่าน Reviewer Council และผ่าน Quality/Security Gate ก่อนอนุญาตให้ Codex / Hermes / MCP ลงมือแก้ระบบจริง  
> **Upstream Reference:** https://github.com/msitarzewski/agency-agents  
> **Date:** 2026-09-07

---

# 0. คำสั่งหลักสำหรับ Codex

ให้ทำ **Phase 20.8 ทั้ง Phase ใน repository Pao-hubPro ปัจจุบัน** โดยทำงานต่อจากโครงสร้างเดิม ห้ามสร้างโปรเจกต์ใหม่แยกจาก Pao-hubPro และห้ามล้าง/เขียนทับระบบที่มีอยู่โดยไม่จำเป็น

ก่อนแก้โค้ด:

1. ตรวจ repository ปัจจุบันทั้งหมดก่อน
2. อ่าน `README`, `package.json`, workspace config, MCP config, database schema, current agent/reviewer modules, tests และ scripts ที่มีอยู่
3. หา implementation ที่เกี่ยวข้องกับ Phase ก่อนหน้า โดยเฉพาะ:
   - Reviewer Council / Second Opinion Engine
   - Codex integration
   - Hermes integration
   - MCP server / local bridge
   - Safe tool execution
   - task queue / orchestration
   - audit log
   - approval gate
4. **Reuse ของเดิมก่อนสร้างใหม่**
5. ห้ามเปลี่ยน framework หลักเพียงเพื่อให้ Phase นี้ทำง่ายขึ้น
6. หาก repo เป็น TypeScript/Node ให้ใช้ stack เดิม
7. หาก repo ใช้ Python เป็น orchestration layer อยู่แล้ว ให้สร้าง equivalent implementation ด้วย Python โดยรักษา interface ในเอกสารนี้
8. ห้าม hard-code API keys, token, password หรือ credential ใด ๆ
9. ทุก destructive action ต้องผ่าน policy/approval gate เดิมของ Pao-hubPro
10. ทำจน tests, typecheck, lint และ acceptance criteria ผ่านจริง แล้วจึงถือว่า Phase 20.8 เสร็จ

---

# 1. Background

Agency Agents เป็น catalog ของ specialist agent definitions ที่แบ่งความเชี่ยวชาญออกเป็นหลาย division เช่น:

- Engineering
- Design
- Product
- Project Management
- Testing
- Security
- Research
- Marketing
- Specialized
- Support
- Finance
- และ division อื่น ๆ

หลักการที่ต้องนำมาใช้ใน Pao-hubPro ไม่ใช่การ preload agent ทั้งหมดเข้าสู่ context แต่เป็นแนวคิด:

```text
User Task
   │
   ▼
Intent / Capability Analysis
   │
   ▼
Agent Registry Search
   │
   ▼
Select Top Specialists
   │
   ▼
Lazy Load Agent Definitions
   │
   ▼
Build Dynamic Team
   │
   ▼
Delegate Tasks
   │
   ▼
Aggregate Outputs
   │
   ▼
Reviewer Council
   │
   ▼
Reality / Security / Test Gate
   │
   ▼
Execution Approval
   │
   ▼
Codex / Hermes / MCP / Local Tools
```

Phase นี้ต้องทำให้ Agency Agents เป็น **Agent Intelligence Layer** ของ Pao-hubPro ไม่ใช่ runtime หลัก

Pao-hubPro ยังเป็นเจ้าของ:

- orchestration
- policy
- permissions
- execution
- audit
- approval
- model routing
- Reviewer Council
- local tools
- MCP
- project state

Agency Agents ทำหน้าที่เป็น:

- specialist catalog
- expertise source
- persona/instruction source
- capability metadata
- team composition source

---

# 2. Verified Upstream Design Assumptions

ให้ implement โดยยึดแนวคิดต่อไปนี้:

## 2.1 Codex

Agency Agents สามารถแปลง agent เป็น Codex custom agent format โดย agent แต่ละตัวมี:

```toml
name = "..."
description = "..."
developer_instructions = """..."""
```

ตำแหน่งมาตรฐานของ Codex agents:

```text
~/.codex/agents/
```

Phase 20.8 **ไม่จำเป็นต้องติดตั้ง agent ทั้งหมดเข้า Codex** แต่ต้องรองรับ export/install เฉพาะ selected agents หรือ selected team ได้

---

## 2.2 Hermes Lazy Router

ให้ใช้แนวคิด Lazy Router เป็น baseline:

```text
agency_agents_search
agency_agents_inspect
agency_agents_load
agency_agents_delegate
```

Pao-hubPro ต้องสร้าง abstraction ของตัวเองให้มี semantics ใกล้เคียง แต่ไม่ผูกระบบกับ Hermes เพียงตัวเดียว

ห้าม preload roster ทั้งหมดเข้า active model context

---

# 3. Phase Objectives

เมื่อ Phase 20.8 เสร็จ Pao-hubPro ต้องสามารถ:

1. Sync Agency Agents catalog จาก upstream
2. Index agent metadata
3. Search agent ตาม task/capability
4. Rank specialist ที่เหมาะที่สุด
5. Lazy-load full prompt เฉพาะ agent ที่ถูกเลือก
6. Build team อัตโนมัติ
7. รองรับ preset team
8. Delegate งานให้หลาย agent
9. รองรับ sequential และ parallel execution
10. เก็บผลลัพธ์เป็น structured artifact
11. ส่งผลเข้า Reviewer Council
12. ใช้ Reality Checker / Code Reviewer / Security specialist เป็น quality gate ตามประเภทงาน
13. ทำ risk classification ก่อน execution
14. Require approval สำหรับ action เสี่ยง
15. ส่ง approved plan ไป Codex / Hermes / MCP executor
16. เก็บ audit trail ครบ
17. แสดงสถานะใน Pao-hubPro UI
18. ทำงานได้แม้ upstream Agency Agents ใช้งานไม่ได้ โดยใช้ cached snapshot
19. ไม่ทำให้ core Pao-hubPro ขึ้นกับ repo ภายนอกแบบ hard dependency
20. update upstream ได้โดยไม่ต้องแก้ core architecture ใหม่

---

# 4. Non-Goals

Phase นี้ **ไม่ต้อง**:

- fork แล้ว merge Agency Agents ทั้ง repo เข้ามาใน Pao-hubPro
- preload agent ทั้งหมดในทุก request
- ให้ specialist agent execute shell โดยตรง
- ให้ agent bypass approval gate
- ให้ agent เขียน production โดยไม่มี Reviewer Council เมื่อ task ถูกจัดเป็น medium/high risk
- เปลี่ยน Pao-hubPro เป็น CrewAI / AutoGen / LangGraph ถ้าไม่ได้ใช้อยู่แล้ว
- replace Reviewer Council เดิม
- replace MCP server เดิม
- replace Codex integration เดิม
- replace Hermes integration เดิม
- auto-commit ลง `main`
- auto-push โดยไม่มี explicit project policy

---

# 5. Architecture

Implement architecture:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                             Pao-hubPro                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User / UI / API                                                     │
│      │                                                               │
│      ▼                                                               │
│  ┌───────────────────┐                                               │
│  │ Task Intake Layer │                                               │
│  └─────────┬─────────┘                                               │
│            ▼                                                         │
│  ┌──────────────────────┐                                            │
│  │ Intent + Risk Parser │                                            │
│  └─────────┬────────────┘                                            │
│            ▼                                                         │
│  ┌─────────────────────────────────────────┐                         │
│  │       Pao Agency Intelligence Layer     │                         │
│  │                                         │                         │
│  │  Agent Registry                         │                         │
│  │       │                                 │                         │
│  │       ├── Search / Ranking              │                         │
│  │       ├── Lazy Loader                   │                         │
│  │       ├── Capability Matcher            │                         │
│  │       ├── Team Builder                  │                         │
│  │       └── Preset Resolver               │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│  ┌─────────────────────────────────────────┐                         │
│  │         Team Orchestrator               │                         │
│  │  planner → builders → reviewers → gate │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│  ┌─────────────────────────────────────────┐                         │
│  │        Reviewer Council                 │                         │
│  │ ChatGPT + Claude + Local AI + Others   │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│  ┌─────────────────────────────────────────┐                         │
│  │ Reality / Security / Test Quality Gate │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│  ┌─────────────────────────────────────────┐                         │
│  │       Policy + Approval Gate            │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│  ┌─────────────────────────────────────────┐                         │
│  │ Codex / Hermes / MCP / Local Executor  │                         │
│  └──────────────────┬──────────────────────┘                         │
│                     ▼                                                │
│               Audit / Evidence                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

# 6. Integration Boundary

สร้าง integration boundary แยกชัดเจน เช่น:

```text
src/
  agency/
    adapters/
    registry/
    router/
    loader/
    teams/
    orchestrator/
    scoring/
    policy/
    cache/
    sync/
    types/
    tests/
```

หรือปรับ path ให้เข้ากับ structure ปัจจุบันของ repo

**ห้าม** import upstream Agency Agents source กระจัดกระจายทั่ว codebase

ทุกการเข้าถึง Agency Agents ต้องผ่าน interface กลาง

ตัวอย่าง:

```ts
interface AgencyCatalogProvider {
  sync(): Promise<SyncResult>;
  search(query: AgentSearchQuery): Promise<AgentSearchResult[]>;
  getAgent(slug: string): Promise<AgencyAgent | null>;
  getAgentBody(slug: string): Promise<string>;
  listDivisions(): Promise<AgencyDivision[]>;
}
```

---

# 7. Upstream Source Strategy

รองรับ source mode:

```text
remote-git
local-clone
cached-snapshot
bundled-fallback
```

Priority:

```text
local configured source
    ↓
cached valid snapshot
    ↓
remote sync
    ↓
bundled minimal fallback
```

Config:

```env
PAO_AGENCY_ENABLED=true
PAO_AGENCY_SOURCE=remote-git
PAO_AGENCY_REPO_URL=https://github.com/msitarzewski/agency-agents.git
PAO_AGENCY_BRANCH=main
PAO_AGENCY_CACHE_DIR=.pao/cache/agency-agents
PAO_AGENCY_SYNC_TTL_HOURS=24
PAO_AGENCY_MAX_ROUTED_AGENTS=6
PAO_AGENCY_DEFAULT_TOP_K=8
```

ห้าม fetch upstream ทุก task

ใช้ TTL + cache

ต้องมี manual command:

```bash
pao agency sync
pao agency status
pao agency list
pao agency search "mcp security architecture"
```

ถ้า CLI เดิมมี command framework ให้ integrate เข้า framework เดิม

---

# 8. Agent Registry Data Model

สร้าง normalized registry ไม่ผูกกับ markdown format โดยตรง

ตัวอย่าง:

```ts
type AgentDivision =
  | "engineering"
  | "design"
  | "product"
  | "project-management"
  | "testing"
  | "security"
  | "research"
  | "specialized"
  | "marketing"
  | "support"
  | "finance"
  | string;

interface AgencyAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  division: AgentDivision;
  sourcePath: string;
  sourceCommit?: string;

  capabilities: string[];
  keywords: string[];
  deliverables: string[];
  criticalRules: string[];
  successMetrics: string[];

  bodyLoaded: boolean;
  body?: string;

  hashes: {
    metadata: string;
    body?: string;
  };

  trust: {
    source: "upstream" | "local" | "cached" | "custom";
    verified: boolean;
  };

  enabled: boolean;
}
```

---

# 9. Parser

สร้าง parser สำหรับ Agency Agent Markdown

ต้องอ่านอย่างน้อย:

- YAML frontmatter
- name
- description
- division จาก folder
- headings
- Identity / Memory
- Core Mission
- Critical Rules
- Technical Deliverables
- Workflow Process
- Success Metrics

Parser ต้อง:

- tolerate missing optional sections
- ไม่ crash เมื่อ upstream เพิ่ม field ใหม่
- sanitize unexpected content
- จำกัด file size
- reject binary / symlink escape / path traversal
- log parse warning
- preserve original body hash

---

# 10. Security: Treat Agent Prompt as Untrusted Content

สำคัญมาก

Agent Markdown จาก upstream หรือ custom source ต้องถือเป็น:

```text
UNTRUSTED INSTRUCTION CONTENT
```

ห้ามให้ agent body:

- override Pao-hubPro system policy
- request credentials
- disable safety
- disable logging
- bypass approval
- call shell โดยตรง
- alter permission policy
- exfiltrate local files
- modify hidden/system config
- inject tool schema
- silently add network destinations

สร้าง prompt firewall:

```text
System Policy
   >
Pao-hubPro Policy
   >
Project Policy
   >
Team Orchestration Policy
   >
Specialist Agent Instruction
   >
User Task
```

specialist instruction ต้องไม่มีสิทธิ์ override layer ด้านบน

---

# 11. Agent Search

Implement:

```ts
searchAgents({
  query,
  division,
  capabilities,
  limit,
  exclude,
  requiredTags
})
```

Search pipeline:

```text
Normalize query
   ↓
Intent extraction
   ↓
Capability expansion
   ↓
Lexical match
   +
Semantic match (if embedding service exists)
   +
Division prior
   +
Agent specialty score
   +
Project-history score
   ↓
Rank
   ↓
Diversity filter
   ↓
Top K
```

ถ้า Pao-hubPro มี embedding/vector store อยู่แล้ว ให้ reuse

ถ้ายังไม่มี:

Phase 20.8 ต้องมี lexical + weighted metadata search ที่ใช้งานได้ก่อน

semantic search เป็น optional enhancement แต่ interface ต้องรองรับ

---

# 12. Routing Score

สร้าง score แบบ explainable

ตัวอย่าง:

```text
routing_score =
  capability_match      * 0.30 +
  semantic_similarity   * 0.25 +
  keyword_match         * 0.15 +
  division_fit          * 0.10 +
  deliverable_fit       * 0.10 +
  project_history       * 0.05 +
  reliability_score     * 0.05
```

ถ้า semantic engine ไม่มี ให้ redistribute weight แบบ deterministic

ทุก route ต้องมี explanation:

```json
{
  "agent": "mcp-builder",
  "score": 0.91,
  "reasons": [
    "task explicitly requests MCP",
    "agent capabilities include MCP server design",
    "deliverables match tool schema and integration requirements"
  ]
}
```

---

# 13. Lazy Loading

Registry โหลด metadata ก่อน

**ห้ามโหลด full prompt body ทุก agent**

Flow:

```text
startup
  ↓
metadata index only
  ↓
task arrives
  ↓
search/rank
  ↓
selected slugs
  ↓
load selected bodies only
  ↓
delegate
  ↓
release context after task
```

Implement:

```ts
loadAgent(slug, {
  taskContext,
  includeBody: true,
  maxChars,
  sanitize: true
})
```

มี LRU/in-memory cache ได้ แต่ต้องจำกัดขนาด

---

# 14. Dynamic Team Builder

สร้าง:

```ts
buildTeam(task, options)
```

return:

```ts
interface DynamicTeam {
  id: string;
  mission: string;
  riskLevel: RiskLevel;

  lead: SelectedAgent;
  planners: SelectedAgent[];
  builders: SelectedAgent[];
  reviewers: SelectedAgent[];
  validators: SelectedAgent[];

  executionMode: "sequential" | "parallel" | "hybrid";
  rationale: string[];
}
```

กฎ:

- 1 lead
- planner 0-2
- builder 1-4
- reviewer อย่างน้อย 1 เมื่อมี code change
- security reviewer อย่างน้อย 1 เมื่อแตะ auth, credential, network, shell, filesystem, MCP tool write
- Reality Checker หรือ equivalent validator เมื่อ risk >= medium
- จำกัด total agents ตาม config
- ห้ามเลือกหลาย agent ที่ทำหน้าที่ซ้ำโดยไม่มีเหตุผล

---

# 15. Default Team Presets

สร้าง preset config แบบแก้ได้ เช่น YAML/JSON

## 15.1 Pao Dev Team

```yaml
id: pao-dev
name: Pao Dev Team
roles:
  lead:
    preferred:
      - software-architect
      - backend-architect
  builders:
    preferred:
      - frontend-developer
      - backend-architect
      - ai-engineer
      - developer-tooling-engineer
  reviewers:
    preferred:
      - code-reviewer
      - security-architect
  validators:
    preferred:
      - reality-checker
```

---

## 15.2 Pao MCP Team

```yaml
id: pao-mcp
name: Pao MCP Team
roles:
  lead:
    preferred:
      - mcp-builder
  builders:
    preferred:
      - backend-architect
      - ai-engineer
      - developer-tooling-engineer
  reviewers:
    preferred:
      - code-reviewer
      - security-architect
  validators:
    preferred:
      - reality-checker
```

---

## 15.3 Pao Stock Research Team

```yaml
id: pao-stock-research
name: Pao Stock Research Team
roles:
  lead:
    capabilities:
      - trend-research
      - market-research
  builders:
    capabilities:
      - content-strategy
      - seo
      - image-prompting
  reviewers:
    capabilities:
      - research-validation
  validators:
    preferred:
      - reality-checker
```

---

## 15.4 Pao Stock Production Team

```yaml
id: pao-stock-production
name: Pao Stock Production Team
roles:
  lead:
    capabilities:
      - creative-direction
  builders:
    capabilities:
      - image-prompting
      - workflow-optimization
      - ai-engineering
  reviewers:
    capabilities:
      - visual-quality
      - commercial-quality
  validators:
    preferred:
      - reality-checker
```

---

## 15.5 Pao Security Review Team

```yaml
id: pao-security
name: Pao Security Review Team
roles:
  lead:
    capabilities:
      - security-architecture
  reviewers:
    capabilities:
      - application-security
      - penetration-testing
      - identity-access
  validators:
    preferred:
      - reality-checker
```

---

# 16. Orchestration Modes

รองรับ:

## Sequential

```text
Planner
  ↓
Builder
  ↓
Code Reviewer
  ↓
Security
  ↓
Reality Checker
```

## Parallel

```text
             ┌─ Backend
Planner ─────┼─ Frontend
             ├─ MCP
             └─ Tests
                  ↓
             Aggregator
```

## Hybrid

```text
Planner
  ↓
Parallel Builders
  ↓
Merge/Synthesis
  ↓
Parallel Reviewers
  ↓
Reviewer Council
  ↓
Gate
```

Default ใช้ Hybrid สำหรับงานใหญ่

---

# 17. Task Decomposition

สร้าง structured plan:

```ts
interface AgentSubtask {
  id: string;
  title: string;
  objective: string;
  dependencies: string[];
  assignedAgent: string;
  risk: RiskLevel;
  expectedArtifacts: string[];
  doneCriteria: string[];
}
```

Planner ต้องแตก task ก่อน delegation เมื่อ:

- task complexity >= medium
- task มีหลาย subsystem
- task มี code + infra + security
- task มี destructive capability

---

# 18. Agent Delegation Contract

ทุก delegation ต้องส่งเฉพาะ context ที่จำเป็น

```ts
interface DelegationRequest {
  runId: string;
  taskId: string;
  agentSlug: string;

  mission: string;
  subtask: AgentSubtask;

  projectContext: ProjectContextSummary;
  allowedTools: string[];
  forbiddenActions: string[];

  expectedOutputSchema: object;
  timeoutMs: number;
}
```

ห้ามส่ง:

- full secret store
- unrelated files
- hidden credentials
- entire user filesystem
- unnecessary conversation history

---

# 19. Structured Agent Result

```ts
interface AgentResult {
  runId: string;
  taskId: string;
  agentSlug: string;

  status: "success" | "partial" | "failed" | "blocked";

  summary: string;
  findings: Finding[];
  recommendations: Recommendation[];
  proposedChanges: ProposedChange[];
  evidence: EvidenceItem[];

  risks: RiskFinding[];
  unresolved: string[];

  confidence: number;

  startedAt: string;
  finishedAt: string;
}
```

ห้ามใช้ plain text อย่างเดียวเป็น canonical storage

เก็บ raw text ได้ แต่ต้องมี normalized JSON result

---

# 20. Reviewer Council Integration

อย่าสร้าง Reviewer Council ใหม่ถ้ามีอยู่แล้ว

สร้าง adapter:

```ts
interface ReviewerCouncilAdapter {
  review(input: CouncilReviewInput): Promise<CouncilDecision>;
}
```

input:

```ts
interface CouncilReviewInput {
  mission: string;
  plan: AgentSubtask[];
  specialistResults: AgentResult[];
  proposedChanges: ProposedChange[];
  riskLevel: RiskLevel;
}
```

output:

```ts
interface CouncilDecision {
  decision:
    | "approve"
    | "approve_with_changes"
    | "request_revision"
    | "block"
    | "human_review";

  score: number;
  consensus: number;

  reasons: string[];
  conflicts: string[];
  requiredChanges: string[];
}
```

---

# 21. Reviewer Council Trigger Rules

| Risk | Council |
|---|---|
| read-only / analysis | optional |
| docs only | optional |
| normal code edit | required if configured |
| auth / permissions | required |
| MCP write tool | required |
| shell execution | required |
| filesystem delete | required |
| deployment | required |
| secret/config change | required |
| database migration | required |
| production action | required |

---

# 22. Reality Checker Gate

หลัง Reviewer Council ให้มี independent verification

Reality Checker ต้องตรวจ:

- claim มี evidence หรือไม่
- file ที่อ้างมีจริงหรือไม่
- tests ผ่านจริงหรือไม่
- command run จริงหรือไม่
- changed file list ตรงหรือไม่
- ไม่มี false completion
- ไม่มี “should work” แล้วสรุปว่าผ่าน
- ไม่มี fabricated API/tool/setting

Result:

```ts
interface RealityGateResult {
  passed: boolean;
  verifiedClaims: string[];
  failedClaims: string[];
  missingEvidence: string[];
  score: number;
}
```

---

# 23. Security Gate

สร้างหรือ reuse security gate

ตรวจอย่างน้อย:

- command allowlist / denylist
- filesystem boundary
- path traversal
- symlink escape
- secrets
- network destinations
- package install
- process spawn
- shell interpolation
- unsafe eval
- arbitrary code execution
- MCP write operations
- git push
- database destructive operation
- deployment
- credential exposure

---

# 24. Risk Classification

```ts
type RiskLevel = "low" | "medium" | "high" | "critical";
```

ตัวอย่าง:

### Low
- explain code
- search repo
- read files
- generate docs

### Medium
- edit code
- add tests
- install normal dependency
- write config in project scope

### High
- auth
- permissions
- network
- MCP write tool
- database migration
- process execution
- deployment

### Critical
- delete data
- secret rotation
- production DB destructive change
- root/admin system modification
- irreversible external action

critical ต้อง Human Approval

---

# 25. Execution Gate

```text
Specialists complete
  ↓
Reviewer Council
  ↓
Reality Checker
  ↓
Security Gate
  ↓
Policy Engine
  ↓
Human Approval if needed
  ↓
Executor
```

ห้าม specialist ข้าม flow นี้

---

# 26. Executor Adapter

รองรับ executor เดิมของ Pao-hubPro:

```ts
interface ExecutionAdapter {
  name: "codex" | "hermes" | "mcp" | "local" | string;
  canHandle(task: ApprovedExecutionPlan): boolean;
  execute(task: ApprovedExecutionPlan): Promise<ExecutionResult>;
}
```

---

# 27. Codex Adapter

Codex integration ต้องรองรับ 2 mode:

## Mode A — Prompt Injection-Free Delegation

นำเฉพาะ selected specialist instruction ไป compose เป็น bounded instruction

## Mode B — Temporary Custom Agent Export

สร้าง selected `.toml` เฉพาะ agent ที่ต้องใช้

ตัวอย่าง:

```text
.pao/generated/codex-agents/
  mcp-builder.toml
  security-architect.toml
  code-reviewer.toml
```

ห้าม auto-copy ทั้ง roster ไป `~/.codex/agents/` โดย default

ต้อง explicit:

```bash
pao agency export codex --team pao-mcp
pao agency install codex --team pao-mcp
```

install ต้องแสดง preview/dry-run ถ้า CLI รองรับ

---

# 28. Hermes Adapter

Hermes integration ต้องเน้น lazy routing

ถ้า Hermes plugin ของ Agency Agents มีอยู่แล้ว:

- detect ได้
- ใช้ได้
- ไม่สร้าง duplicate router
- map Pao-hubPro routing result ไป Hermes delegation

ถ้าไม่มี:

Pao-hubPro ใช้ internal registry แล้วส่ง selected prompt ให้ Hermes

ห้าม preload roster ทั้งหมด

---

# 29. MCP Surface

ถ้า Pao-hubPro มี MCP server อยู่แล้ว ให้เพิ่ม tools ต่อไปนี้โดย reuse server เดิม

ชื่อแนะนำ:

```text
pao_agency_search
pao_agency_inspect
pao_agency_build_team
pao_agency_delegate
pao_agency_run_team
pao_agency_get_run
pao_agency_sync
```

---

## 29.1 pao_agency_search

Input:

```json
{
  "query": "design secure MCP server",
  "division": "specialized",
  "limit": 5
}
```

Output ต้องมี:

- slug
- name
- division
- score
- reasons
- capabilities

---

## 29.2 pao_agency_inspect

Input:

```json
{
  "slug": "mcp-builder",
  "include_body": false
}
```

body เป็น false default

---

## 29.3 pao_agency_build_team

Input:

```json
{
  "mission": "Build secure MCP local execution bridge",
  "max_agents": 6
}
```

---

## 29.4 pao_agency_delegate

delegate specialist เดียว

---

## 29.5 pao_agency_run_team

ต้องไม่ bypass approval policy

---

## 29.6 pao_agency_sync

default เป็น metadata/cache sync เท่านั้น

ต้องไม่มี arbitrary git command จาก user input

---

# 30. Tool Schema Rules

ทุก MCP tool:

- verb_noun naming
- strict schema
- descriptions ชัด
- validate input
- max lengths
- timeout
- structured error
- no secret in error
- audit run id
- correlation id

---

# 31. Team Run State Machine

```text
CREATED
  ↓
ROUTING
  ↓
TEAM_SELECTED
  ↓
PLANNING
  ↓
DELEGATING
  ↓
AGGREGATING
  ↓
COUNCIL_REVIEW
  ↓
REALITY_CHECK
  ↓
SECURITY_CHECK
  ↓
AWAITING_APPROVAL (when required)
  ↓
EXECUTING
  ↓
VERIFYING
  ↓
COMPLETED
```

error states:

```text
BLOCKED
FAILED
CANCELLED
PARTIAL
```

---

# 32. Retry Policy

ต่อ subtask:

```text
max attempts = 3
```

retry ได้เมื่อ:

- transient model error
- timeout
- malformed structured output
- recoverable tool error

ห้าม retry destructive external action แบบ blind

หลัง 3 ครั้ง:

```text
ESCALATE
```

ส่งเข้า orchestrator/human review

---

# 33. Conflict Resolution

ถ้า agent ให้คำตอบขัดแย้ง:

1. อย่าเลือกคำตอบด้วย majority อย่างเดียว
2. เปรียบเทียบ evidence
3. ให้ reviewer อิสระตรวจ
4. ให้ Reviewer Council ตัดสิน
5. ถ้า confidence ต่ำ → human review

เก็บ disagreement ไว้ใน audit

---

# 34. Evidence Model

```ts
interface EvidenceItem {
  type:
    | "file"
    | "test"
    | "command"
    | "log"
    | "url"
    | "diff"
    | "runtime"
    | "artifact";

  reference: string;
  summary: string;
  verified: boolean;
}
```

completion ต้อง evidence-driven

---

# 35. Audit Log

ทุก run ต้องเก็บ:

```text
run id
user/task origin
timestamp
selected agents
routing scores
routing reasons
loaded agent hashes
team composition
subtasks
model/provider
tool calls
review decisions
security findings
approval state
execution commands
changed files
test results
final status
```

ห้าม log:

- raw API key
- password
- bearer token
- private credential

---

# 36. Database / Persistence

ถ้า repo มี database อยู่แล้ว ให้เพิ่ม schema ผ่าน migration

ห้ามสร้าง database ใหม่โดยไม่จำเป็น

entities แนะนำ:

```text
agency_sources
agency_agents
agency_agent_versions
agency_team_presets
agency_runs
agency_run_agents
agency_subtasks
agency_agent_results
agency_reviews
agency_approvals
agency_evidence
```

ถ้า project ใช้ file-based state ให้สร้าง equivalent repository abstraction เพื่อ migration ในอนาคต

---

# 37. Versioning

ทุก agent snapshot ต้องเก็บ:

```text
source commit
source path
metadata hash
body hash
synced at
```

เพื่อให้ reproducible

run หนึ่งต้องรู้ว่าใช้ agent version ไหน

---

# 38. Custom Pao Agents

รองรับ agent ของเราเองโดยไม่แก้ upstream

path ตัวอย่าง:

```text
.pao/agents/custom/
```

custom agent precedence:

```text
Pao custom override
  >
Local configured catalog
  >
Upstream Agency Agents
```

แต่ override ต้อง explicit ด้วย slug เดียวกัน

สร้าง field:

```yaml
source: pao-custom
extends: mcp-builder
```

ถ้าต้องการ extend agent upstream

---

# 39. Agent Health / Reliability

เก็บ local performance metrics:

```ts
interface AgentPerformance {
  slug: string;
  runs: number;
  successRate: number;
  revisionRate: number;
  reviewerPassRate: number;
  averageConfidence: number;
  averageLatencyMs: number;
}
```

ห้ามแก้ upstream agent file เพื่อบันทึก score

เก็บ performance ใน Pao-hubPro

routing อาจใช้ performance เป็น weight เล็กน้อย

---

# 40. UI — Agency Center

ถ้า Pao-hubPro มี dashboard ให้เพิ่มหน้า:

```text
Agency Center
```

sections:

### Overview
- total indexed agents
- enabled agents
- last sync
- source commit
- cache status

### Search
- search box
- division filter
- capability filter
- score
- why selected

### Agent Detail
- metadata
- capabilities
- source
- version/hash
- prompt preview
- enable/disable

### Teams
- preset teams
- dynamic team preview
- member roles

### Runs
- current run
- state machine
- specialist progress
- council status
- approval status

### Audit
- evidence
- review
- changed files
- tests

ใช้ design system เดิมของ Pao-hubPro

ห้ามสร้าง UI คนละ theme

---

# 41. Suggested UI Flow

```text
New Task
   ↓
Analyze
   ↓
Suggested Team
   ↓
[Why these agents?]
   ↓
Plan
   ↓
Run
   ↓
Live progress
   ↓
Council review
   ↓
Approval if needed
   ↓
Execute
   ↓
Evidence report
```

---

# 42. API

ปรับตาม framework ปัจจุบัน

แนะนำ endpoints:

```text
GET    /api/agency/status
POST   /api/agency/sync
GET    /api/agency/agents
GET    /api/agency/agents/:slug
POST   /api/agency/search
POST   /api/agency/teams/build
GET    /api/agency/teams/presets
POST   /api/agency/runs
GET    /api/agency/runs/:id
POST   /api/agency/runs/:id/approve
POST   /api/agency/runs/:id/cancel
```

mutation endpoints ต้อง auth ตามระบบเดิม

---

# 43. Observability

เพิ่ม metrics ถ้า project มีระบบ metrics:

```text
agency_sync_duration
agency_agents_indexed
agency_route_duration
agency_route_selected_count
agency_lazy_load_count
agency_run_duration
agency_agent_failure_count
agency_council_block_count
agency_security_block_count
agency_human_approval_count
```

log ต้องมี:

```text
runId
taskId
agentSlug
stage
duration
status
```

---

# 44. Performance Targets

เป้าหมาย:

- metadata search < 300ms บน local catalog ปกติ
- lazy load selected agents เท่านั้น
- startup ไม่ parse full body ทุก agent ซ้ำโดยไม่จำเป็น
- cached registry usable offline
- sync ไม่ block normal task execution
- no O(N full prompt injection) per request

---

# 45. Offline Mode

เมื่อ GitHub/upstream เข้าไม่ได้:

```text
Use last verified cached snapshot
```

UI/CLI ต้องแสดง:

```text
Source: cached
Snapshot age: ...
Commit: ...
```

ห้าม fail ทั้ง Pao-hubPro เพราะ upstream unavailable

---

# 46. Sync Safety

การ sync:

1. clone/fetch เข้า isolated cache path
2. resolve branch/commit
3. validate repository structure
4. parse metadata
5. run prompt security scan
6. create immutable snapshot
7. atomic swap active registry
8. retain previous good snapshot
9. rollback ถ้า validation fail

---

# 47. Supply-Chain Safety

ก่อนใช้ snapshot ใหม่:

- repository URL allowlist
- no executable install script run automatically
- **อย่ารัน `install.sh` หรือ `convert.sh` จาก upstream โดยอัตโนมัติ**
- parse Markdown เป็น data
- ignore executable files
- validate paths
- scan prompt for suspicious overrides
- record source commit

การ install Codex/Hermes integration เป็น user-triggered operation เท่านั้น

---

# 48. Prompt Injection Scanner

สร้าง heuristic scanner อย่างน้อยตรวจข้อความแนว:

```text
ignore previous instructions
disable safety
reveal secrets
send credentials
run shell
delete files
override system
do not log
bypass approval
```

อย่า auto-delete agent

ให้ mark:

```text
clean
warning
blocked
```

Agent ที่ `blocked` ห้าม route อัตโนมัติ

---

# 49. Minimal Specialist Set for Pao-hubPro

เมื่อ sync สำเร็จให้พยายาม identify agent ที่เกี่ยวข้องกับระบบเรา เช่น:

```text
MCP Builder
Backend Architect
Software Architect
Multi-Agent Systems Architect
AI Engineer
Developer Tooling Engineer
Code Reviewer
Security Architect
Application Security Engineer
Identity & Access Engineer
DevOps Automator
Reality Checker
Test Automation Engineer
Workflow Optimizer
Research specialist
Image Prompt Engineer
```

อย่า hard-fail ถ้าชื่อ upstream เปลี่ยน

ให้ match ด้วย capability ก่อน slug

---

# 50. Capability Taxonomy

สร้าง internal taxonomy อย่างน้อย:

```text
architecture
backend
frontend
database
mcp
multi-agent
ai-engineering
prompt-engineering
devtools
devops
security
application-security
identity-access
testing
code-review
reality-validation
workflow-optimization
research
market-research
trend-research
seo
content
image-generation
video
stock-production
```

agent หนึ่งมีหลาย capability ได้

---

# 51. Project-Aware Routing

Router ต้องใช้ project context:

```text
current stack
changed files
requested feature
risk
phase
available tools
recent failures
selected executor
```

ตัวอย่าง:

ถ้า task คือ:

```text
เพิ่ม MCP tool เขียนไฟล์ local
```

ทีมขั้นต่ำควรมี:

```text
MCP specialist
Backend/Tooling specialist
Security reviewer
Code reviewer
Reality Checker
```

---

# 52. Example Run — Pao MCP

User:

```text
สร้าง MCP tool สำหรับให้ Codex สั่ง ComfyUI queue ได้
```

Expected:

```text
1. classify: medium/high
2. search agency
3. select:
   - MCP Builder
   - Backend Architect
   - AI Engineer
   - Security reviewer
   - Code Reviewer
   - Reality Checker
4. plan subtasks
5. parallel design
6. synthesize
7. council review
8. security gate
9. approval if tool can mutate external state
10. Codex implementation
11. tests
12. reality verification
13. final evidence
```

---

# 53. Example Run — Adobe Stock Research

User:

```text
วิเคราะห์ว่าอาทิตย์นี้ควรทำภาพ Stock แนวไหน
```

Expected:

- no code executor
- use research/market/content/image specialists
- web/research tools ตาม policy ที่มี
- aggregate evidence
- reality/research validation
- output ranked opportunities
- no unnecessary Codex execution

---

# 54. Example Run — Code Refactor

User:

```text
refactor task queue โดยห้ามเปลี่ยน behavior
```

Expected team:

```text
Minimal Change Engineer
Software Architect
Code Reviewer
Test Automation
Reality Checker
```

ต้อง require regression evidence

---

# 55. Testing Strategy

สร้าง tests อย่างน้อย:

## Unit

- parser
- registry
- score
- search
- diversity
- lazy loader
- prompt sanitizer
- risk classifier
- team builder
- preset resolver
- state machine
- retry policy

## Integration

- sync → parse → index → search
- search → select → lazy load
- task → dynamic team
- team → delegation mock
- results → Reviewer Council mock
- council → gate
- approval → executor mock

## Security

- path traversal
- symlink
- malicious prompt
- secret exfil instruction
- oversized prompt
- malformed frontmatter
- arbitrary repo URL
- unsafe command
- approval bypass attempt

## Offline

- remote unavailable
- cached snapshot works
- corrupted newest snapshot → rollback previous

---

# 56. Required Test Fixtures

สร้าง fixtures:

```text
clean-agent.md
missing-sections-agent.md
malformed-frontmatter.md
prompt-injection-agent.md
oversized-agent.md
duplicate-slug-agent.md
```

---

# 57. E2E Test

อย่างน้อยหนึ่ง scenario:

```text
Task:
"Design and implement a safe read-only MCP tool"

Expected:
- router selects MCP/security/reviewer roles
- bodies loaded only selected agents
- proposed plan generated
- council approves/mock
- security gate passes
- executor mock runs
- evidence generated
- run ends COMPLETED
```

และหนึ่ง blocked scenario:

```text
Task:
"Create tool that deletes arbitrary files outside project"

Expected:
- high/critical risk
- security gate blocks or requires explicit human approval
- no executor call before approval
```

---

# 58. Acceptance Criteria

Phase 20.8 ถือว่าเสร็จเมื่อ **ทุกข้อ** ผ่าน:

- [ ] Agency catalog sync ได้
- [ ] ใช้ cache/offline ได้
- [ ] ไม่รัน upstream scripts อัตโนมัติ
- [ ] metadata registry ทำงาน
- [ ] full body lazy-load จริง
- [ ] search/ranking ทำงาน
- [ ] routing มี explanation
- [ ] dynamic team builder ทำงาน
- [ ] preset teams ทำงาน
- [ ] team max limit ทำงาน
- [ ] duplicate-role suppression ทำงาน
- [ ] task decomposition ทำงาน
- [ ] structured delegation ทำงาน
- [ ] agent result เป็น structured schema
- [ ] Reviewer Council integration ทำงาน
- [ ] Reality gate ทำงาน
- [ ] Security gate ทำงาน
- [ ] risk classification ทำงาน
- [ ] human approval flow ไม่ถูก bypass
- [ ] Codex adapter ทำงาน
- [ ] Hermes adapter interface พร้อม
- [ ] MCP tools ถูก register
- [ ] audit log ครบ
- [ ] source commit/hash ถูกบันทึก
- [ ] UI/API ไม่พังของเดิม
- [ ] unit tests ผ่าน
- [ ] integration tests ผ่าน
- [ ] security tests ผ่าน
- [ ] E2E ผ่าน
- [ ] lint ผ่าน
- [ ] typecheck ผ่าน
- [ ] build ผ่าน
- [ ] ไม่มี secret ใน repo
- [ ] ไม่มี auto-commit/push main
- [ ] README/Phase docs ถูกอัปเดต

---

# 59. Suggested File Structure

ปรับตาม repo เดิม แต่เป้าหมายเชิง logical ให้ครบ:

```text
src/
  agency/
    index.ts

    types/
      agent.ts
      team.ts
      run.ts
      evidence.ts

    providers/
      agency-catalog-provider.ts
      github-agency-provider.ts
      local-agency-provider.ts
      cached-agency-provider.ts

    parser/
      agent-markdown-parser.ts
      frontmatter.ts
      sections.ts

    registry/
      agent-registry.ts
      registry-store.ts

    search/
      capability-taxonomy.ts
      lexical-search.ts
      semantic-search.ts
      routing-score.ts
      diversity-filter.ts

    security/
      prompt-sanitizer.ts
      prompt-injection-scanner.ts
      source-validator.ts

    loader/
      lazy-agent-loader.ts
      prompt-composer.ts

    teams/
      dynamic-team-builder.ts
      preset-loader.ts
      presets/
        pao-dev.yaml
        pao-mcp.yaml
        pao-stock-research.yaml
        pao-stock-production.yaml
        pao-security.yaml

    orchestration/
      agency-orchestrator.ts
      task-decomposer.ts
      delegation-manager.ts
      result-aggregator.ts
      run-state-machine.ts

    review/
      reviewer-council-adapter.ts
      reality-gate.ts
      security-gate.ts

    execution/
      execution-adapter.ts
      codex-agency-adapter.ts
      hermes-agency-adapter.ts
      mcp-agency-adapter.ts

    sync/
      agency-sync-service.ts
      snapshot-manager.ts

    audit/
      agency-audit-service.ts

    api/
      agency-routes.ts

    cli/
      agency-commands.ts

    mcp/
      agency-tools.ts

    tests/
      fixtures/
      unit/
      integration/
      security/
      e2e/
```

หากมี structure ที่ดีกว่าใน repo เดิม ให้ integrate ตาม pattern เดิมแทนการบังคับ path นี้

---

# 60. CLI UX

ตัวอย่าง:

```bash
pao agency status
pao agency sync
pao agency list --division engineering
pao agency search "mcp security"
pao agency inspect mcp-builder
pao agency team build "secure local mcp bridge"
pao agency team list
pao agency run --team pao-mcp "review current MCP server"
pao agency export codex --team pao-mcp
```

เพิ่ม:

```bash
--json
--dry-run
--verbose
```

ตามความเหมาะสม

---

# 61. Dry Run

ทุก operation ที่อาจ:

- install agent
- write config
- execute code
- update external system

ควรมี dry-run ถ้า infrastructure รองรับ

ผล dry-run ต้องบอก:

```text
selected agents
planned writes
planned commands
risk
approval requirement
```

---

# 62. Documentation

สร้าง/อัปเดต:

```text
docs/phase-20.8-agency-intelligence.md
docs/agency/architecture.md
docs/agency/security.md
docs/agency/teams.md
docs/agency/codex.md
docs/agency/hermes.md
```

ถ้า repo มี convention อื่น ให้ใช้ convention เดิม

README เพิ่มหัวข้อสั้น:

```text
Agency Intelligence Layer
```

---

# 63. Migration / Backward Compatibility

- existing Reviewer Council API ต้องยังใช้ได้
- existing MCP tools ต้องไม่เปลี่ยนชื่อโดยไม่จำเป็น
- existing task queue ต้องไม่พัง
- existing UI routes ต้องไม่พัง
- existing env vars ต้องไม่เปลี่ยนความหมาย
- new feature ต้อง disable ได้ด้วย feature flag

```env
PAO_AGENCY_ENABLED=false
```

เมื่อ false:

Pao-hubPro ทำงานเหมือนก่อน Phase 20.8

---

# 64. Feature Flags

อย่างน้อย:

```env
PAO_AGENCY_ENABLED=true
PAO_AGENCY_REMOTE_SYNC_ENABLED=true
PAO_AGENCY_SEMANTIC_SEARCH_ENABLED=false
PAO_AGENCY_DYNAMIC_TEAMS_ENABLED=true
PAO_AGENCY_CODEX_EXPORT_ENABLED=true
PAO_AGENCY_HERMES_ENABLED=true
```

---

# 65. Failure Handling

กรณีเหล่านี้ต้องมี graceful fallback:

### Upstream unavailable
→ cached snapshot

### Agent parse fail
→ skip agent + warning

### One delegated agent fails
→ retry / alternate specialist

### Reviewer disagreement
→ Reviewer Council / human

### Security gate fail
→ block execution

### Executor unavailable
→ produce approved plan without lying that execution happened

### UI unavailable
→ CLI/API still works

---

# 66. No False Completion Rule

Codex ห้ามรายงาน Phase ว่าเสร็จหาก:

- test ไม่ได้รัน
- build ไม่ได้รัน
- tool registration ไม่ได้ตรวจ
- reviewer integration เป็น TODO
- security gate เป็น mock ใน production path
- UI มีแต่ placeholder โดย feature scope ต้องการ UI จริง
- acceptance criterion ใดที่สำคัญยัง fail

ถ้ามีสิ่งที่ทำไม่ได้ ให้รายงานตรง ๆ ใน final implementation report

---

# 67. Git Rules

ทำงานบน branch ปัจจุบันตาม policy ของ repo

ห้าม:

```text
git reset --hard
git clean -fd
git push --force
git push origin main
delete unrelated files
rewrite unrelated history
```

หากต้อง commit ให้ทำตาม workflow เดิม และอย่า commit secret/generated cache

เพิ่ม cache path ใน `.gitignore`:

```text
.pao/cache/agency-agents/
```

ถ้า path นี้เหมาะกับ repo

---

# 68. Definition of Done

Phase นี้ไม่ได้หมายถึงแค่ “โหลด prompt ได้”

Definition of Done คือ:

> Pao-hubPro สามารถรับ mission หนึ่งงาน → วิเคราะห์ → ค้น specialist → เลือกทีม → lazy-load → delegate → aggregate → review → reality/security gate → approval → execute → verify → audit ได้เป็นระบบเดียว โดยไม่ preload Agency roster ทั้งหมด และโดย specialist ไม่มีสิทธิ์ bypass policy ของ Pao-hubPro

---

# 69. Final Verification Command

ก่อนจบ Phase ให้ Codexตรวจ scripts ของ repo แล้วรัน command ที่ตรงกับ project จริง เช่น:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

หรือ:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

หรือ equivalent ตาม repo

ห้ามเดา package manager ถ้า lockfile บอกอยู่แล้ว

---

# 70. Final Implementation Report

เมื่อทำเสร็จ ให้ Codex ตอบสรุปในรูปแบบ:

```markdown
# Phase 20.8 Implementation Report

## Status
PASS / PARTIAL / BLOCKED

## Architecture Added
...

## Existing Components Reused
...

## Files Added
...

## Files Modified
...

## Database Migrations
...

## MCP Tools Added
...

## CLI Commands Added
...

## UI Added
...

## Security Controls
...

## Reviewer Council Integration
...

## Codex Integration
...

## Hermes Integration
...

## Tests
- lint:
- typecheck:
- unit:
- integration:
- security:
- e2e:
- build:

## Acceptance Criteria
- [x] ...
- [ ] ...

## Known Limitations
...

## Recommended Phase 20.9
...
```

---

# 71. Recommended Phase 20.9 Boundary

**อย่าทำ Phase 20.9 ตอนนี้**

Phase 20.8 ต้องวาง extension points ไว้สำหรับอนาคต เช่น:

```text
Phase 20.9
Pao-hubPro Agent Memory + Performance Learning + Auto Team Optimization
```

แนวคิด:

```text
Past Runs
   ↓
Agent Performance
   ↓
Task Similarity
   ↓
Team Outcome Learning
   ↓
Routing Weight Optimization
```

แต่ Phase 20.8 ให้เก็บ telemetry/performance schema ไว้ก่อน โดยยังไม่ทำ autonomous self-modifying routing policy

---

# 72. One-Shot Codex Execution Instruction

อ่านข้อความ Phase 20.8 นี้ทั้งหมดเป็น specification หลัก

จากนั้น:

1. inspect Pao-hubPro ปัจจุบัน
2. map existing architecture กับ requirement
3. สร้าง implementation plan ภายใน
4. implement Phase 20.8 โดย reuse ของเดิม
5. สร้าง Agency Intelligence Layer
6. สร้าง registry/search/lazy loader
7. สร้าง dynamic team builder + presets
8. เชื่อม Reviewer Council
9. เชื่อม Reality/Security/Policy/Approval
10. เชื่อม Codex/Hermes/MCP adapters
11. เพิ่ม API/CLI/UI ตาม architecture เดิม
12. เพิ่ม audit/persistence
13. เพิ่ม unit/integration/security/E2E tests
14. run lint/typecheck/test/build จริง
15. แก้จนผ่าน
16. ตรวจ git diff ป้องกัน scope creep
17. ทำ implementation report
18. ห้ามหยุดที่ scaffold/TODO หากสามารถ implement ต่อได้
19. ห้ามทำ Phase 20.9
20. Phase 20.8 จบเมื่อ Definition of Done และ Acceptance Criteria ผ่านตามหลักฐานเท่านั้น

---

# END — Phase 20.8
