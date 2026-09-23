# Phase 20.15 — Pao-hubPro × Floci Cloud Sandbox Plane

> **Project:** Pao-hubPro  
> **Phase:** 20.15  
> **Codename:** Agent-Native Local Cloud Sandbox Plane (Floci-backed)  
> **Status:** Accepted — §13 resolved 2026-09-23, M1 in progress  
> **Date:** 2026-09-23  
> **Source spec:** `docs/Phase-20.15-source-spec-Floci-Cloud-Sandbox-Plane.md` (82 sections, vendored)  
> **Upstream:** https://github.com/floci-io/floci — MIT, local AWS emulator, default port 4566  
> **Language:** Thai-first, English-compatible  

---

## 1. Executive Summary

Phase 20.15 เพิ่ม **Cloud Sandbox Plane** ให้ Pao-hubPro: Agent ขอ disposable AWS-compatible
sandbox ในเครื่อง local, รัน Terraform/OpenTofu กับ AWS SDK กับ endpoint นั้น, เก็บ evidence,
cleanup อัตโนมัติ และ promote ผ่าน approval gate โดย Agent ไม่เคยเห็น Docker socket หรือ
production credential

**สถาปัตยกรรมและเจตนาของ source spec ถูกยอมรับทั้งหมด** เอกสารนี้ไม่ได้เขียน intent ใหม่
แต่แก้ **8 จุดที่ source spec ขัดกับความเป็นจริงของ repo นี้** ซึ่งถ้าปล่อยไว้จะทำให้โค้ด
ที่เขียนตาม spec รันไม่ได้หรือถูก gate ของ repo ตีตก

ส่วนที่ไม่ได้กล่าวถึงในเอกสารนี้ ให้ยึด source spec เป็น authoritative

---

## 2. Reality Check — source spec → repo fact → resolution

| # | Source spec | Repo fact (verified 2026-09-23) | Resolution |
|---|---|---|---|
| 1 | §32 PostgreSQL schema (`jsonb`, `timestamptz`, partial index) | `bun:sqlite` เท่านั้น — ไม่มี `pg` / `postgres` / `bun:sql` ใน repo | Sidecar SQLite `cloud-sandbox.sqlite3` (§5) |
| 2 | §25 MCP namespace `pao.cloud.sandbox.create` (dotted) | Dotted name ไม่มีอยู่จริง — convention คือ `pao_knowledge_search`, `media_memory_index_video`, `video_analyze` | Flat snake_case `pao_cloud_*` (§8) |
| 3 | §55 layout `apps/`, `services/`, `packages/`, `mcp/`, `config/cloud/` | ทุก Phase 20.x ใช้ `src/agent-os/<subsystem>/` + `gui/src/pages/` + flat `tests/` | `src/agent-os/cloud-sandbox/` (§4) |
| 4 | §40 Testcontainers, §15 Docker socket proxy, §37 `/var/run/docker.sock` | ไม่มี Docker client, ไม่มี `dockerode`, repo เป็น win32 (Docker Desktop ใช้ named pipe ไม่ใช่ unix socket) | Mock-first, Docker deferred (§10) |
| 5 | §68 `features:` YAML flag block | ไม่มี feature-flag framework ใน `src/agent-os/` — ใช้ `process.env.PAO_*` ตรง ๆ (`PAO_MOBILE_ENABLED`, `PAO_KNOWLEDGE_ENABLED`, `VIDEO_INTELLIGENCE_LOCAL_ONLY`) | Env-var flags, default OFF (§9) |
| 6 | §75 Wave-1 รวม Lambda + RDS | ทั้งคู่เป็น **Docker-backed** ตาม §1.3 ของ source spec เอง | Wave-1 = in-process services เท่านั้น (§11) |
| 7 | §14 "isolated execution environment" สำหรับ IaC runner (ของใหม่) | มีอยู่แล้ว: `src/agent-os/desktop-runtime/sandbox/safe-sandbox.ts` — path-bounded `spawn`, timeout, process cap, output truncation | ใช้ `SafeSandbox` แทนการเขียน runner ใหม่ |
| 8 | §51 Reviewer Council (ไม่ระบุตัว) | มี **8 implementation** ที่ไม่เชื่อมกัน (`agent-os/reviewers/`, `ai-gateway/council/`, `video/qc/`, `video-intelligence/`, `agency/review/`, `desktop-runtime/reviewer-council/`, `mobile/`, `sdlc/`, `council/`) | ใช้ `src/agent-os/governance/council-trigger.ts` — ห้ามสร้างตัวที่ 9 |

หมายเหตุ §66: profile ของ Floci (port 4566, MIT, Docker-backed, LocalStack migration path)
ตรงกับ LocalStack ทุกข้อ **ห้าม hardcode assumption ใด ๆ จาก source spec โดยไม่ re-verify**
และห้ามใช้ tag `:latest` — pin digest ตั้งแต่ commit แรก

---

## 3. Reuse map — ของที่มีอยู่แล้ว ห้ามเขียนซ้ำ

`AGENTS.md` บังคับ Ponytail 7-rung ladder; เฟสนี้ตก **rung 7 (new subsystem)** ซึ่งต้อง
justify ว่า rung 1–6 ไม่พอ เหตุผลคือ repo ไม่มี cloud emulation เหลืออยู่เลย
(grep `terraform|opentofu|docker|localstack|floci|4566|testcontainers|pao.cloud` ใน `src/` = 0 match)
แต่ **substrate ด้าน governance มีครบ** และต้อง reuse:

| ความต้องการใน source spec | ใช้ของเดิมที่ | หมายเหตุ |
|---|---|---|
| §17 Policy Engine | `src/agent-os/policy.ts:30` `evaluateCapability()` | deny-by-default อยู่แล้ว; capability ใหม่จะถูก deny จนกว่าจะมี policy row — ถูกต้องตาม fail-closed |
| §50 Human approval | `src/agent-os/gateway.ts` `requestWritePermit` L74 / `issueWritePermit` L92 / `redeemWritePermit` L133 / `decideApproval` L193 | header ของไฟล์ระบุชัดว่า *"code can REQUEST a permit, only a human can grant one"* — ตรงกับ §50 "ห้าม auto-approve production" พอดี |
| §14 fail-closed execution | `src/agent-os/executor.ts:24` `runGuardedTask()` | redeem permit ก่อนเริ่มงาน |
| §22 Promotion pipeline | `src/agent-os/workflow.ts` `pumpWorkflowRun` L112 / `grantWorkflowApproval` L159 | durable versioned step graph + `waiting_approval` state มีอยู่แล้ว |
| §11/§46 Sandbox lifecycle, TTL, lease, orphan leak | `src/agent-os/generation/cloud/lifecycle-manager.ts` + `leases.ts` | RunPod GPU lifecycle — provision / readiness probe / idle auto-stop / safe terminate / emergency kill / orphan-leak detection / restart reconciliation ครบ **เป็น template หลักของ Sandbox Manager** |
| §9 Adapter SPI | `src/agent-os/providers/provider-registry.ts` + `runpod/{client,mock}.ts` | adapter + mock pair = รูปที่ `CloudEmulatorAdapter` ควรลอก |
| §21 Diff Engine | `src/agent-os/governance/diff-guard.ts` `DiffGuard` L7 | |
| §29/§30 Events + audit | `src/agent-os/events.ts:14` `recordAgentEvent()`, `src/agent-os/webmcp.ts:63` `recordWebMcpCall()` | `recordWebMcpCall` hash input เป็น SHA-256 และ redact `sk-`/`ghp_`/`AKIA` อยู่แล้ว → ตอบ §38 secret handling ฟรี |
| §61 Concurrency lock | `src/agent-os/generation/cloud/leases.ts` `LeaseManager` | |
| §62/§64 Metrics / tracing | `src/agent-os/observability.ts` | |

**`policy.ts` import `openAgentOsDb()` จาก central store** — ดังนั้น policy row ของ cloud
capability อยู่ใน `agent-os.sqlite3` แม้ operational state ของ sandbox จะอยู่ sidecar (§5)
นี่เป็นเรื่องปกติ: policy เป็น shared service, ไม่ใช่ข้อมูลของเฟส

---

## 4. Module layout (repo-idiomatic)

```text
src/agent-os/cloud-sandbox/
  index.ts              barrel + lazy singletons (getSandboxManager(), getCloudCapabilityRegistry())
  types.ts              CloudEnvironment, SandboxStatus, RiskLevel, error taxonomy (§58 ของ source spec)
  flags.ts              env-var feature flags (§9)
  db-store.ts           sidecar SQLite (§5) — ตามรอย media-memory/db-store.ts
  adapter-spi.ts        CloudEmulatorAdapter interface (§6)
  adapters/
    floci-aws.ts        FlociAwsAdapter
    mock.ts             MockCloudEmulatorAdapter — ใช้ใน test เสมอ (§10)
  capability-registry.ts
  sandbox-manager.ts    lifecycle / TTL / idempotency / health
  cleanup-controller.ts
  leak-detector.ts
  iac/
    toolchain.ts        detect terraform / tofu binary
    runner.ts           ใช้ SafeSandbox
    provider-overlay.ts generate HCL overlay (§13.3)
    plan-digest.ts      §24
  observer/
    resource-discovery.ts
    resource-graph.ts
    diff-engine.ts
  evidence/
    bundle.ts           §31
  promotion/
    controller.ts
    gates.ts            Gate A–E (§23)
  docker-control/
    port.ts             DockerControlPort interface (§10)
    null-port.ts        default — deny ทุกอย่าง
  mcp-tools.ts          pao_cloud_* (§8)

src/server/management/cloud-sandbox-routes.ts   handleCloudSandboxRoutes(ctx)
gui/src/pages/CloudSandbox.tsx
gui/src/styles/cloud-sandbox.css
scripts/pao-cloud.ts
config/cloud/{capabilities,policies,quotas,service-fidelity}.yaml
tests/cloud-sandbox-*.test.ts                   flat ตาม convention
```

`src/agent-os/control-plane/` ที่มีอยู่เป็น **โฟลเดอร์เปล่า untracked** (มีแต่ `.mimosa/`,
ไม่มีโค้ด, ไม่มีใคร reference) — เฟสนี้ **ไม่ใช้** มัน ดู §13 ข้อ 1

### 4.1 Optional-subsystem boundary (บังคับ)

`AGENTS.md:31-73` — subsystem ที่ optional ต้องไม่ถูก import จาก core path:

- ห้าม `src/router.ts`, `src/server/lifecycle.ts`, `src/server/responses/core.ts` import
  `src/agent-os/cloud-sandbox/` ทั้งทางตรงและ transitive
- teardown ลงทะเบียนผ่าน `registerOptionalShutdownHook("cloud-sandbox", …)` จาก
  `src/lib/optional-shutdown-hooks.ts:32` เมื่อ activate เท่านั้น
- route lazy-import ใน `handleAgentOsRoutes` ตามรอย media-memory ที่
  `src/server/management/agent-os-routes.ts:48-56`
- **ต้องประกาศทุก route ใน `src/server/management/route-registry.ts:81` `MANAGEMENT_ROUTES`**
  พร้อม `module: "server/management/cloud-sandbox-routes"` — ไฟล์นั้นเป็น pure data,
  `tests/management-route-registry.test.ts` จับ route ที่ไม่ประกาศ
- เพิ่ม `tests/cloud-sandbox-core-boundary.test.ts` เดิน import graph แบบเดียวกับ
  `tests/core-lab-boundary.test.ts`

§73 rollback ("ห้ามผูก startup กับ Floci") ถูก enforce ด้วยข้อนี้ ไม่ใช่ด้วย prose

---

## 5. Persistence — sidecar SQLite

แทน §32 ทั้งหมด ไฟล์ `$OPENCODEX_HOME/cloud/cloud-sandbox.sqlite3` ตามรอย
`src/agent-os/media-memory/db-store.ts` (`customPath` constructor arg สำหรับ test, WAL,
`foreign_keys = ON`)

**เพิ่มสิ่งที่ media-memory ไม่มี:** version stamp ผ่าน `PRAGMA user_version` + `migrate()`
แบบ additive เพราะเฟสนี้มีหลายตารางที่มีความสัมพันธ์กัน และ sidecar ที่ไม่มี migration path
คือ technical debt ตั้งแต่ยังไม่เริ่ม

```sql
CREATE TABLE IF NOT EXISTS cloud_sandboxes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  actor_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  adapter TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  endpoint_json TEXT NOT NULL DEFAULT '{}',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  destroyed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cloud_sandboxes_workspace ON cloud_sandboxes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sandboxes_expiry ON cloud_sandboxes(expires_at);

CREATE TABLE IF NOT EXISTS cloud_resources (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL REFERENCES cloud_sandboxes(id),
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  external_id TEXT,
  name TEXT,
  region TEXT,
  state TEXT,
  fidelity TEXT NOT NULL DEFAULT 'UNKNOWN',
  tags_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT,
  discovered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_sandbox ON cloud_resources(sandbox_id);

CREATE TABLE IF NOT EXISTS cloud_operations (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT REFERENCES cloud_sandboxes(id),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  approval_id TEXT,
  input_digest TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_operations_idem ON cloud_operations(idempotency_key);

CREATE TABLE IF NOT EXISTS cloud_promotions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_sandbox_id TEXT,
  target_environment TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  evidence_bundle_id TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
```

ต่างจาก Postgres ต้นฉบับ: ไม่มี `jsonb` → **ห้าม query เข้าไปใน `*_json`** ถ้าต้อง filter
ให้ดัน field นั้นขึ้นมาเป็นคอลัมน์ (ทำแล้วกับ `fidelity` เพราะ §42 fidelity gate ต้อง query)
`idx_cloud_operations_idem` เป็น `UNIQUE` เพราะ §60 idempotency ต้องเป็น fence ระดับ DB
ไม่ใช่ระดับ application — Agent retry แล้วต้องชน constraint

**Test seam:** commit `a6b97c01b` เพิ่งแก้ EBUSY จากการไม่ปล่อย SQLite handle ก่อน `rmSync`
sidecar store ต้องมี `close()` และ test ต้องเรียกก่อนลบโฟลเดอร์ มิฉะนั้นจะซ้ำรอยบน Windows

---

## 6. Adapter SPI

คง interface จาก source spec §9 แต่ปรับให้ตรงกับ `providers/provider-registry.ts` และเพิ่ม
สิ่งที่ Docker reality (§10) บังคับ:

```ts
export type CloudProvider = "aws" | "azure" | "gcp" | "oci";

export type ServiceFidelity =
  | "IN_PROCESS" | "DOCKER_BACKED" | "STUB" | "PARTIAL"
  | "UNAVAILABLE" | "UNKNOWN";

export interface CloudEmulatorAdapter {
  readonly id: string;
  readonly provider: CloudProvider;

  isAvailable(): Promise<AdapterAvailability>;   // เพิ่ม — docker/toolchain probe
  startSandbox(input: StartSandboxInput): Promise<SandboxRuntime>;
  stopSandbox(sandboxId: string): Promise<void>;
  health(sandboxId: string): Promise<HealthReport>;
  endpoints(sandboxId: string): Promise<CloudEndpointSet>;
  listResources(sandboxId: string): Promise<CloudResource[]>;
  serviceFidelity(sandboxId: string, service: string): Promise<ServiceFidelity>;  // เพิ่ม (§42)
  execute(sandboxId: string, req: CloudActionRequest): Promise<CloudActionResult>;
  collectLogs(sandboxId: string): Promise<LogBundle>;
  destroy(sandboxId: string): Promise<DestroyReport>;
  snapshot?(sandboxId: string): Promise<SnapshotRef>;
  restore?(snap: SnapshotRef): Promise<SandboxRuntime>;
}
```

`isAvailable()` และ `serviceFidelity()` คือกลไกที่ทำให้ §42 "ห้ามสรุป local passed =
production guaranteed" เป็น **ข้อมูลที่ query ได้** ไม่ใช่คำเตือนในเอกสาร — `UNAVAILABLE`
เป็น answer ที่ถูกต้องเมื่อไม่มี Docker ดีกว่าการให้ adapter แกล้งสำเร็จ

`MockCloudEmulatorAdapter` ต้อง implement interface นี้ครบ และเป็นที่ที่ test §39.3
(sandbox A ≠ sandbox B) รันได้ deterministic โดยไม่ต้องมี Docker

---

## 7. Policy & approval integration

เพิ่มเข้าไปใน union ที่ `src/agent-os/policy.ts:9` (เป็น additive — row เดิมไม่กระทบ):

```ts
export type Capability =
  | "fs.read" | "fs.write" | "net.fetch" | "shell.exec" | "git.push" | "deploy"
  | "cloud.sandbox"          // create/destroy local sandbox
  | "cloud.iac.local"        // fmt/validate/plan/apply/destroy ใน sandbox
  | "cloud.staging.apply"
  | "cloud.production.apply";
```

และเพิ่ม `cloud.staging.apply` + `cloud.production.apply` เข้า `APPROVAL_REQUIRED`
(`policy.ts:18`) คู่กับ `deploy` ที่มีอยู่ — นี่คือ §17.2 risk tier "Critical → Human approval"
ในรูปที่ enforce จริง

`policy.ts` เป็น security-boundary file ตาม `AGENTS.md` review guidelines → **เปลี่ยนแล้วต้อง
ผ่าน security review** และเป็น high-risk task ตาม `AGENTS.md:355-357` → **ต้อง trigger
Reviewer Council ผ่าน `governance/council-trigger.ts` ห้าม bypass ด้วยเหตุผล minimal-code**

Risk mapping (§17.2) → `webmcp.ts` risk tier ที่มีอยู่:

| Source spec | Tier | Approval |
|---|---|---|
| low (S3/DynamoDB local) | R1 | none |
| medium (Lambda/RDS local) | R2 | none + quota |
| high (EKS/EC2 local + network) | R3 | conditional → `gateway.requestWritePermit` |
| critical (staging/production apply) | R4 | required → `gateway.decideApproval` โดยมนุษย์ |

§24 plan digest lock: store digest ใน `cloud_promotions.plan_digest`, Gate E ต้อง
recompute จาก IaC bundle + provider config + variables + module lock + policy version +
execution target แล้วเทียบ **ก่อน** redeem permit — ถ้าไม่ตรง throw
`PROMOTION_DIGEST_MISMATCH` และห้าม retry (§59)

---

## 8. MCP tool surface

ใช้ shape จาก `src/agent-os/media-memory/mcp-tools.ts:7` (`McpToolDefinition` —
`inputSchema` + `handler`) เพราะ §26 ของ source spec ต้องการ `inputSchema` จริง
และ risk tier ส่งผ่าน `recordWebMcpCall()` แทนการฝังใน definition

| Source spec §25 | ชื่อจริง | Risk | readOnly |
|---|---|---|---|
| `pao.cloud.sandbox.create` | `pao_cloud_sandbox_create` | R2 | false |
| `pao.cloud.sandbox.get` | `pao_cloud_sandbox_get` | R0 | true |
| `pao.cloud.sandbox.list` | `pao_cloud_sandbox_list` | R0 | true |
| `pao.cloud.sandbox.destroy` | `pao_cloud_sandbox_destroy` | R2 | false |
| `pao.cloud.sandbox.extend_ttl` | `pao_cloud_sandbox_extend_ttl` | R1 | false |
| `pao.cloud.resource.list/get/graph` | `pao_cloud_resource_list` / `_get` / `_graph` | R0 | true |
| `pao.cloud.iac.validate` | `pao_cloud_iac_validate` | R1 | true |
| `pao.cloud.iac.plan` | `pao_cloud_iac_plan` | R1 | true |
| `pao.cloud.iac.apply_local` | `pao_cloud_iac_apply_local` | R2 | false |
| `pao.cloud.iac.destroy_local` | `pao_cloud_iac_destroy_local` | R2 | false |
| `pao.cloud.test.run` | `pao_cloud_test_run` | R2 | false |
| `pao.cloud.logs.query` | `pao_cloud_logs_query` | R0 | true |
| `pao.cloud.snapshot.create/restore` | `pao_cloud_snapshot_create` / `_restore` | R2 | false |
| `pao.cloud.promotion.prepare` | `pao_cloud_promotion_prepare` | R2 | false |
| `pao.cloud.promotion.request_approval` | `pao_cloud_promotion_request_approval` | R3 | false |
| `pao.cloud.promotion.apply_staging` | `pao_cloud_promotion_apply_staging` | R4 | false |
| `pao.cloud.promotion.apply_production` | `pao_cloud_promotion_apply_production` | R4 | false |

ทุก tool ที่ `readOnly: false` ต้องรับ `Idempotency-Key` (§60) และ record ผ่าน
`recordWebMcpCall()` — ห้าม log raw input, เก็บแต่ SHA-256 + redacted summary
(กลไกนี้มีอยู่แล้วใน `webmcp.ts:40-59`)

สอง tool สุดท้ายต้อง return `CLOUD_APPROVAL_REQUIRED` เสมอเมื่อ flag §9 ปิดอยู่
และต้องไม่รับ approval token เป็น argument — token ออกผ่าน `gateway.ts` เท่านั้น

---

## 9. Feature flags

ตาม convention `process.env.PAO_*` ที่ใช้จริงใน `src/agent-os/` (`PAO_MOBILE_ENABLED`,
`PAO_KNOWLEDGE_ENABLED`, `VIDEO_INTELLIGENCE_LOCAL_ONLY`) — **default OFF ทุกตัว**

```ts
PAO_CLOUD_SANDBOX_ENABLED              // default false — master switch
PAO_CLOUD_SANDBOX_LOCAL_ONLY           // default true  — block staging/production โดยสิ้นเชิง
PAO_CLOUD_FLOCI_IMAGE                  // ไม่มี default; ต้องเป็น pinned digest, ปฏิเสธ ":latest"
PAO_CLOUD_FLOCI_ENDPOINT               // default http://127.0.0.1:4566
PAO_CLOUD_DOCKER_CONTROL_ENABLED       // default false (§10)
PAO_CLOUD_IAC_ENABLED                  // default false (ต้องมี terraform/tofu binary)
PAO_CLOUD_PRODUCTION_PROMOTION_ENABLED // default false — เปิดเป็นขั้นสุดท้าย (§68)
PAO_CLOUD_MULTI_CLOUD_ENABLED          // default false (§53)
PAO_CLOUD_SANDBOX_DB                   // test override path เท่านั้น
```

`PAO_CLOUD_SANDBOX_LOCAL_ONLY` เป็น **deny-by-default สองชั้น**: ต่อให้เปิด
`PRODUCTION_PROMOTION_ENABLED` แต่ถ้า `LOCAL_ONLY` ยังเป็น true (default) ต้องปฏิเสธ
การสลับต้องตั้งใจสองครั้ง — ตรงกับ §5.6 "Production is a Different Trust Zone"

---

## 10. Docker — ข้อจำกัดจริง และการเลื่อน milestone

Source spec §15, §37, §40 สมมติ Linux + Docker daemon + unix socket ความจริง:

1. repo นี้ **ไม่มี Docker client และไม่มี `dockerode`** — การเพิ่ม dependency ต้องผ่าน
   `governance/dependency-guard.ts`
2. platform เป็น **win32** — Docker Desktop ใช้ named pipe `//./pipe/docker_engine`
   ไม่ใช่ `/var/run/docker.sock` โค้ดที่ hardcode path ตาม §37 จะไม่ทำงานบนเครื่อง dev นี้
3. Docker Desktop บนเครื่องนี้ **ต้อง start daemon เอง** — CI และ dev container
   ห้ามสมมติว่ามี Docker
4. §1.3 ของ source spec เองระบุว่า Lambda / RDS / Neptune / ElastiCache / MSK / ECS /
   EC2 / EKS / OpenSearch / CodeBuild เป็น **Docker-backed** — service เหล่านั้น
   **ส่งมอบไม่ได้** ในสภาพแวดล้อมที่ไม่มี Docker

**Resolution:**

```ts
export interface DockerControlPort {
  isReachable(): Promise<boolean>;
  createContainer(spec: ContainerSpec): Promise<string>;   // validate §37 ก่อนเสมอ
  startContainer(id: string): Promise<void>;
  inspectContainer(id: string): Promise<ContainerInfo>;
  stopContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  listByLabel(label: string): Promise<ContainerInfo[]>;    // §47 leak detection
}
```

- `NullDockerControlPort` = default, `isReachable()` → false, ทุก mutation throw
  `ADAPTER_UNAVAILABLE` ใช้ใน test และในเครื่องที่ไม่มี Docker
- `SocketDockerControlPort` (deferred) = ตัวจริง, ต้อง resolve socket path ต่อ platform,
  และ enforce allowlist §15.1 + reject `privileged`/`network_mode: host`/`pid: host`/
  `ipc: host` + reject bind mount `/`, `/etc`, `/root`, `/home`, `docker.sock`, `~/.ssh`,
  credential dirs (§37) — validation ต้องอยู่ใน port ไม่ใช่ใน adapter
- **ตัด Testcontainers ออกจาก scope** (§40) — Bun-native repo, เพิ่ม dependency โดยไม่จำเป็น
  ขัด rung 5 ของ Ponytail; isolation test ทำผ่าน `MockCloudEmulatorAdapter` + sidecar DB
  แยกไฟล์ต่อ test ซึ่ง deterministic กว่า
- Floci ต้องถูก treat เป็น privileged runtime (§1.3) → Floci container เองก็สร้างผ่าน
  `DockerControlPort` เท่านั้น Agent ไม่มีทางถึง Docker engine โดยตรง (§15 topology)

---

## 11. Service waves — แก้จาก §75 / §41

| Wave | Services | ต้องการ Docker |
|---|---|---|
| **1** (M2) | S3, DynamoDB, SQS, SNS, Secrets Manager, SSM, CloudWatch Logs | ไม่ — `IN_PROCESS` |
| **2a** (M2/M4) | EventBridge, Step Functions, API Gateway | ไม่ — `PARTIAL` |
| **2b** (M7, gated) | Lambda, RDS, OpenSearch | ใช่ — `DOCKER_BACKED` |
| **3** (flag-off) | EC2, ECS, EKS, MSK | ใช่ + approval `conditional`/`required` |
| **4** (ไม่อยู่ในเฟสนี้) | Bedrock / SageMaker surface | — |

แยก 2a/2b เพราะ source spec §1.3 ไม่เคยจัด EventBridge / Step Functions / API Gateway เป็น
Docker-backed — การยัดรวมไว้ในกลุ่ม "ต้องการ Docker" ทำให้เลื่อน service ที่ส่งมอบได้จริง
ออกไปโดยไม่มีเหตุ ตารางนี้คือ `SERVICE_DEFINITIONS` ใน `capability-registry.ts` ไม่ใช่ตาราง
ประกอบเอกสาร — test `cloud-sandbox-capabilities.test.ts` ผูกไว้

Wave-1 ถูกตัด Lambda และ RDS ออกเพราะเป็น Docker-backed ทุก service ในคอลัมน์ `fidelity`
ของ `cloud_resources` ต้องเติมจริงจาก `adapter.serviceFidelity()` และ service ที่ไม่มี
daemon รองรับต้องรายงาน `UNAVAILABLE` ไม่ใช่ผลลัพธ์ที่แกล้งสำเร็จ (§42)

---

## 12. Milestones (re-sequenced)

Source spec §69/§70 เรียงตาม ideal environment ลำดับนี้เรียงตามสิ่งที่ repo นี้รันได้จริง

| M | Scope | Gate ที่ต้องผ่าน |
|---|---|---|
| **M0** | เอกสารนี้ + sign-off §13 | — |
| **M1** Foundation ✅ | `types.ts`, `flags.ts`, `db-store.ts` (+`user_version`), `adapter-spi.ts`, `MockCloudEmulatorAdapter`, `NullDockerControlPort`, capability registry, error taxonomy, policy wiring, boundary test | `bun run typecheck` + focused tests |
| **M2** Floci in-process | `FlociAwsAdapter` start/stop/health/endpoint injection/log collect, Wave-1 smoke tests, TTL, cleanup controller, leak detector | isolation test: sandbox A ≠ sandbox B |
| **M3** IaC | toolchain detect, `SafeSandbox`-based runner, provider overlay, fmt/validate/plan/apply/destroy, plan digest, evidence bundle | `IAC_TOOLCHAIN_MISSING` degrade อย่างสุภาพ |
| **M4** Observer | resource discovery, normalized inventory, graph, diff engine, MCP tools, management routes + `route-registry.ts` declaration | `tests/management-route-registry.test.ts` เขียว |
| **M5** Dashboard | `CloudSandbox.tsx`, css, `App.tsx`, `app-routing.ts`, **i18n ครบ 10 locale** (`en,de,fr,ja,ko,ru,th,tr,zh,zh-TW`), `gui/tests/integrations-routing.test.ts` | `bun run lint:gui` + `bun run build:gui` |
| **M6** Promotion | staging path, digest lock, Gate A–E, `council-trigger.ts`, human gate ผ่าน `gateway.ts` | digest mismatch block apply (test) |
| **M7** Docker-backed | `SocketDockerControlPort` (Linux + Windows named pipe), Wave-2 services | **ต้องมี Docker จริง** — ห้าม merge ถ้า CI ไม่มี |
| **M8** Multi-cloud | `floci-az` / `floci-gcp` / `floci-oci` adapter contracts (§53) | flag-off |

**Production promotion ปิดตลอดเฟส** เปิดเป็น phase แยกหลัง M6 ผ่านและมีการ review

ก่อน PR-ready: `bun run typecheck` + `bun run test` + `bun run privacy:scan`
(เฟสนี้แตะ credential handling และ logging → privacy scan บังคับ)

### 12.1 M1 delivered — 2026-09-23

อยู่บน branch `feat/cloud-sandbox-plane`

```text
src/agent-os/cloud-sandbox/
  types.ts  errors.ts  flags.ts  adapter-spi.ts
  db-store.ts  capability-registry.ts  index.ts
  adapters/mock.ts
  docker-control/port.ts  docker-control/null-port.ts
tests/cloud-sandbox-{flags,docker-guard,capabilities,mock-adapter,db-store,core-boundary}.test.ts
tests/agent-os-policy.test.ts        (เพิ่ม describe block ของ phase 20.15)
src/agent-os/policy.ts               (4 capability + 2 เข้า APPROVAL_REQUIRED)
```

 Verification: **110 pass / 0 fail / 390 expect()** across 7 files,
`bun run typecheck` clean, `bun run privacy:scan` clean.

**Boundary guard ถูกขับให้แดงแล้วจริง** ตามมาตรฐานที่ `AGENTS.md` ใช้กับ repo-hygiene
guards: เติม `import "../agent-os/cloud-sandbox";` ลงใน `src/server/management-api.ts`
ชั่วคราว แล้ว both guards fail (import-graph walk + direct-name scan) จากนั้น revert
ไม่มี guard ใดในไฟล์นี้ที่ยังไม่เคยถูกพิสูจน์ว่า fail ได้

สองสิ่งที่ test จับได้ระหว่างทาง ไม่ใช่ stylistic nit:

1. `isForbiddenBind` ปล่อย `C:\Users\me` ผ่าน — §37 มีแต่ path ฝั่ง POSIX จึงไม่มีทางจับ
   Windows profile แก้ด้วย `homedir()` + `WINDOWS_PROFILES_ROOT`
2. `parseBindSource` ใช้ `bind.split(":")[0]` ได้ `"C"` จาก `C:\Users\me:/workspace`
   ซึ่งไม่ตรงกับ forbidden list ใดเลย เท่ากับ mount home directory ทั้งลูกผ่านเงียบ ๆ

Performance note: import-graph walk เคยใช้เวลา 8.8s และ **timeout ที่ 5s** ทำให้ guard
รายงานตัวมันเองว่าพัง `extractSpecs` cache ต่อไฟล์ลดเหลือ 446ms — ถ้าจะแก้ให้
`core-lab-boundary.test.ts` ด้วย ต้องเพิ่ม cache แบบเดียวกันไม่ใช่เพิ่ม timeout

**ยังไม่ได้ commit** — รออนุญาตตาม `AGENTS.md`

---

## 13. Decisions — resolved 2026-09-23

1. **`src/agent-os/control-plane/`** — **ไม่แตะ, ไม่ใช้** เป็นโฟลเดอร์เปล่า untracked
   ที่ไม่มีใคร reference การลบเป็น destructive action ต่อ state ที่อาจเป็นงานค้างของผู้อื่น
   โค้ดเฟสนี้ลง `src/agent-os/cloud-sandbox/`
2. **Source spec** — **vendor แล้ว** ที่ `docs/Phase-20.15-source-spec-Floci-Cloud-Sandbox-Plane.md`
   เหตุผล: path เดิมอยู่ใน `~/Downloads` ซึ่งจะหาย และเอกสารนี้ยกให้ source spec เป็น
   authoritative ในส่วนที่ไม่ได้กล่าวทับ ตรวจ `AGENTS.md` "Security working notes" แล้ว —
   §15/§37/§74 ของ source spec เป็น **hardening design ของ subsystem ที่ยังไม่มีอยู่**
   ไม่ใช่ open finding หรือ reproduction step ของช่องโหว่ที่มีจริง จึงลง `docs/` ได้
   และไม่ใช่ `devlog/`
3. **Wave-1 ไม่มี Lambda + RDS** — **ยอมรับ** (§11) ทั้งคู่เป็น Docker-backed ตาม §1.3
   ของ source spec เอง การแกล้งส่งมอบโดยไม่มี Docker จะละเมิด §42 fidelity gate
4. **แก้ `src/agent-os/policy.ts`** — **อนุมัติ** (§7) เป็น additive: เพิ่ม 4 capability
   และ 2 เข้า `APPROVAL_REQUIRED` row เดิมไม่กระทบ และ capability ใหม่ถูก deny-by-default
   จนกว่าจะมี policy row → fail-closed ถูกต้อง **ยังเป็น security-boundary change ที่ต้อง
   ผ่าน security review ก่อน merge** และ trigger Reviewer Council ผ่าน
   `governance/council-trigger.ts` ตาม `AGENTS.md:355-357`
5. **Branch** — `feat/cloud-sandbox-plane` จาก `dev` (`e7be56876`) **ไม่ใช่** จาก
   `fix/server-live-ebusy` ซึ่ง ahead 1 ด้วย commit `a6b97c01b`
   หมายเหตุ: commit นั้นคือ fix "release agent-os SQLite handle before rmSync" ซึ่งเกี่ยวกับ
   SQLite เหมือนกัน แต่เป็น fix ใน `tests/` — ไม่ได้ rebase มา และโค้ดเฟสนี้ปฏิบัติตาม
   pattern เดียวกันด้วยตัวเอง (§5 test seam)

---

## 14. Governance record

Three shortcuts are logged in `docs/governance/technical-debt.md` as of M1:

- **DEBT-20260923-001** — sidecar `cloud-sandbox.sqlite3` แยกจาก `agent-os.sqlite3`
  (181 ตาราง / 3020 บรรทัด / schema v25) เพื่อไม่ขยาย single-writer contention
  Trigger: เมื่อต้อง join กับ `agent_events` หรือ `approvals`
- **DEBT-20260923-002** — `NullDockerControlPort` เป็น port เดียวที่มี, Docker-backed
  services เลื่อนไป M7 Trigger: CI มี Docker daemon หรือถึง M7
- **DEBT-20260923-003** — มีแค่ `MockCloudEmulatorAdapter`, ยังไม่มี Floci adapter
  Trigger: M2

sidecar store ของเฟสนี้ stamp `PRAGMA user_version` ด้วย ซึ่งเป็นสิ่งที่
`media-memory/db-store.ts` และ `video-intelligence/db-store.ts` ไม่มี — ถ้าจะรวม sidecar
เป็น pattern ของ repo ควรเพิ่ม version stamp ที่สองไฟล์นั้นด้วย

`AGENTS.md:355-357` — เฟสนี้แตะ **database schema + permissions + destructive operations**
พร้อมกันสามอย่าง จึง trigger Reviewer Council แบบ bypass ไม่ได้
M1 ใช้ `governance/council-trigger.ts` ตัวเดิม ไม่ได้สร้าง council ตัวที่ 9

---

## 15. Found while building M1 — defects in the Phase 20.9 debt ledger

Three defects in `src/agent-os/governance/debt-ledger.ts`, all pre-existing (Phase 20.9), none
caused by this phase. M1 only surfaced them by writing entries long enough to notice.

1. **`recordDebt()` loses multi-line field values.** `parseMarkdown().getField` uses
   `- <Label>:\s*(.+)` (`debt-ledger.ts:65-68`), and `.` does not cross a newline, so only the
   first line of each field parses; `saveMarkdown()` (`:93-124`) then rewrites the **entire**
   file from that lossy model (`:52-53`). Every continuation line of every entry in
   `docs/governance/technical-debt.md` is destroyed the first time anything calls
   `recordDebt()`. Confirmed by observation: three Phase 20.15 entries authored as multi-line
   fields came back truncated mid-sentence.
2. **A test mutates a tracked file.** `getDebtLedger()` defaults its path to
   `join(process.cwd(), "docs", "governance", "technical-debt.md")` (`:12`, `:129-134`), and
   `POST /api/desktop-agent/governance/debt` calls it with no path
   (`src/server/management/desktop-agent-routes.ts:426,446`). Verified reproduction —
   `bun test tests/chatbox-agent-desktop-runtime.test.ts` appends `DEBT-20260923-007` to the
   tracked file (12 lines added, 27 tests pass). The three `Owner: test-agent` boilerplate
   entries already committed, dated 2026-09-07 and 2026-09-08, are earlier output of the same
   path, so this has been dirtying contributor trees for a while.
3. **Debt ids are count-based, not history-based.** `nextSeq = existing.length + 1` (`:42`)
   means the sequence depends on how many entries survive at the moment of writing — six
   present produced `-007`. Deleting an entry shifts every later id, and the date prefix is
   the run date rather than the entry's own, so ids are neither stable nor collision-free.

**Mitigation applied here, not a fix:** the three Phase 20.15 entries are authored with every
field on a single line, which is the only shape `parseMarkdown` round-trips intact. Proven by
simulating a `recordDebt()` against a copy of the file: 6 entries parsed, no empty fields, 0
lines lost. `tests/chatbox-agent-desktop-runtime.test.ts` still re-appends its probe entry
after this change, which is expected while defect 2 stands.

**Why this is recorded in `docs/` rather than scratch:** `AGENTS.md` allows a tracked write-up
once the weakness is already public, and all three mechanisms are plain source in a public
repository (`debt-ledger.ts` is not secret). None of them touches authentication, credential
handling, or token exposure — this is data integrity and test isolation, so `SECURITY.md:46`
(non-sensitive hardening is fine publicly) applies rather than the private advisory channel.

Suggested fix, in order: give `recordDebt()` a per-test path override or move the default under
`$OPENCODEX_HOME`; make `getField` capture to the next `- Label:` or blank line instead of to
end-of-line; derive the id from max existing sequence for that date.

**Filed upstream as <https://github.com/lidge-jun/opencodex/issues/5650>** on 2026-09-23 with the
verified reproduction and all three defects. This phase deliberately does not fix it: the ledger is
Phase 20.9 surface, and a fix wants its own regression test asserting
`saveMarkdown(parseMarkdown(x)) === x` over the committed ledger.

## 16. Final Architecture Statement

คง §82 ของ source spec ทั้งหมด — execution hierarchy ที่เฟสนี้ส่งมอบ:

```text
Prompt / Task → Agent / Codex → Plan → Policy (policy.ts)
  → Local Code Sandbox (SafeSandbox)
  → Local Cloud Sandbox (Floci, in-process services)
  → Tests + Evidence (sidecar SQLite + evidence bundle)
  → Reviewer Council (governance/council-trigger.ts)
  → Staging Cloud (flag-gated, digest-locked)
  → Human Approval (gateway.decideApproval — human only)
  → Production Cloud (flag-off ในเฟสนี้)
```

```text
agent autonomy
without
unbounded authority
```
