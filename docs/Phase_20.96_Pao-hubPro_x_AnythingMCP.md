# Phase 20.96 — Pao-hubPro × AnythingMCP — Universal API-to-MCP Integration Fabric, No-Code REST/SOAP/GraphQL/SQL Connector Factory, Dynamic Tool Publishing, Knowledge-Graph Tool Intelligence, Adaptive Skill Learning, Credential Brokerage, Response-Shaping Privacy Gateway & Policy-Governed Enterprise Capability Plane

> **Project:** Pao-hubPro  
> **Phase:** 20.96  
> **Status:** Canonical Implementation Blueprint  
> **Date:** 2026-09-19  
> **Upstream:** `HelpCode-ai/anythingmcp`  
> **Primary role:** Universal Connector / API-to-MCP Integration Fabric  
> **Deployment stance:** Local-first, self-hosted, policy-governed, human-approved  
> **Default security posture:** Fail-closed for sensitive data and state-changing actions  
> **License boundary:** Keep AnythingMCP isolated as an upstream service/container; do not copy `ee/` code into Pao-hubPro

---

## 0. Executive Summary

Phase 20.96 turns **AnythingMCP** into the universal integration substrate underneath **Pao-hubPro**.

The goal is not to replace Pao-hubPro with AnythingMCP and not to fork AnythingMCP into the core repository.

Instead, Pao-hubPro will use AnythingMCP as a dedicated **Connector Engine** capable of converting existing systems into MCP tools:

- REST / OpenAPI / Swagger
- SOAP / WSDL
- GraphQL
- Databases
- Existing MCP servers

Pao-hubPro remains the **control plane** above it and owns:

- capability discovery
- connector intake
- policy classification
- secret brokerage
- approval gates
- MCP publication
- model/provider routing
- audit correlation
- observability
- human review
- skill governance
- knowledge-graph governance
- lifecycle/version control
- rollback
- integration with the wider Pao-hubPro agent runtime

The target architecture is:

```text
External Systems
  │
  ├─ REST / OpenAPI
  ├─ SOAP / WSDL
  ├─ GraphQL
  ├─ PostgreSQL / MySQL / MariaDB / MSSQL / Oracle / MongoDB / SQLite
  └─ Existing MCP Servers
        │
        ▼
┌──────────────────────────────────────────────┐
│            AnythingMCP Connector Engine      │
│  Import • Normalize • Auth • Execute • MCP   │
└──────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────┐
│              Pao-hubPro Control Plane        │
│                                              │
│  Discovery      Policy        Credentials    │
│  Risk Scoring   Approval      Tool Registry  │
│  Privacy Gate   KG Review     Skill Review   │
│  Audit          Routing       Observability  │
│  Versioning     Rollback      Health Checks  │
└──────────────────────────────────────────────┘
        │
        ├─ ChatGPT
        ├─ Codex
        ├─ Claude
        ├─ Browser/Agent runtimes
        └─ Internal Pao-hubPro agents
```

The result is a system where **new APIs and internal systems can be onboarded into the agent ecosystem in minutes, but no tool becomes agent-accessible until Pao-hubPro has classified, tested, policy-scoped, and approved it.**

---

# 1. Upstream Baseline Verified for This Phase

This Phase is based on the current upstream state of AnythingMCP as reviewed on 2026-09-19.

## 1.1 Capabilities available upstream now

AnythingMCP currently provides:

- REST connectors
- SOAP connectors
- GraphQL connectors
- database connectors
- MCP-to-MCP bridge
- OpenAPI / Swagger import
- Postman import
- cURL import
- WSDL import
- GraphQL introspection
- tool discovery from running MCP servers
- visual tool editing
- runtime/dynamic tool registration
- per-tool response shaping
- read/write/destructive MCP annotations
- tool whitelisting
- OAuth2
- OAuth2 PKCE
- OAuth2 Client Credentials
- Bearer authentication
- API Key authentication
- Basic authentication
- WS-Security
- client certificates
- OAuth 1.0a
- audit logging
- role-based access control
- SSO
- SCIM
- AES-256-GCM credential encryption
- workspace Knowledge Graph
- optional AI-derived cross-system relationship discovery
- usage-derived AI skills
- MCP publication to multiple clients

Supported database engines documented upstream:

1. PostgreSQL
2. MySQL
3. MariaDB
4. Microsoft SQL Server
5. Oracle
6. MongoDB
7. SQLite

## 1.2 Features that are upstream roadmap items, not assumed as shipped

Pao-hubPro MUST NOT treat the following as guaranteed upstream capabilities until verified at implementation time:

- streaming tool responses
- declarative tool composition
- gRPC connector type
- webhook ingestion
- fine-grained tool versioning
- native MCP elicitation/resources coverage
- OpenTelemetry exporter
- plugin SDK for custom TypeScript/Python transformations
- self-tuning rate limits
- tool A/B testing

These may be implemented by Pao-hubPro independently behind feature flags, but adapters must not depend on upstream roadmap promises.

---

# 2. Problem Statement

Pao-hubPro already has or plans multiple sources of capabilities:

```text
Public API directories
OpenClaw
AI API registries
MCP registries
BrowserSkill
OmniGet
custom local services
internal databases
legacy REST APIs
SOAP systems
GraphQL services
existing MCP servers
```

Without a common integration layer, every new service creates repeated work:

```text
Discover service
→ read docs
→ write SDK
→ build MCP server
→ add auth
→ add secret handling
→ add audit
→ add schema
→ implement retries
→ implement rate limits
→ add policies
→ add UI
→ test
→ deploy
```

This does not scale.

Phase 20.96 changes the default workflow to:

```text
Discover
→ Import
→ Normalize
→ Inspect
→ Policy classify
→ Test
→ Approve
→ Publish
→ Observe
→ Learn
```

---

# 3. Phase Objectives

## 3.1 Primary objectives

### O1 — Universal connector intake

Pao-hubPro must accept:

- OpenAPI documents
- Swagger URLs
- Postman collections
- cURL commands
- WSDL files/URLs
- GraphQL endpoints
- database connection definitions
- MCP server endpoints
- prebuilt AnythingMCP adapter definitions

### O2 — Automatic tool normalization

Every imported operation becomes a canonical Pao-hubPro capability record containing:

- stable tool ID
- display name
- machine name
- description
- parameters
- return schema
- side-effect metadata
- authentication requirements
- risk level
- data classification
- owner
- source
- version
- approval status
- health status

### O3 — Zero-secret model exposure

Credentials must never be passed into LLM context.

Agents reference:

```text
credential_ref
```

not:

```text
api_key
password
client_secret
private_key
token
```

### O4 — Privacy-aware responses

Responses must be shaped before reaching AI clients.

Sensitive tools must default to:

```json
{
  "fallbackToRaw": false
}
```

### O5 — Controlled tool publication

No imported tool is automatically exposed to agents.

Lifecycle:

```text
DRAFT
→ DISCOVERED
→ NORMALIZED
→ SECURITY_SCANNED
→ TESTED
→ POLICY_REVIEW
→ APPROVED
→ PUBLISHED
→ MONITORED
```

### O6 — Knowledge Graph assistance

Agents should be able to understand relationships such as:

```text
Customer
  ↓ customer_id
Order
  ↓ tracking_number
Shipment
  ↓ carrier
Tracking Status
```

without copying real customer values into the graph.

### O7 — Adaptive skills with human governance

Repeated successful patterns may create skill candidates.

They MUST NOT become production instructions automatically by default.

Flow:

```text
observed successful usage
→ pattern extraction
→ skill candidate
→ policy scan
→ Reviewer Council
→ human approval
→ promoted skill
```

---

# 4. Explicit Non-Goals

Phase 20.96 does NOT:

- replace OmniRoute
- replace MCPProxy
- replace BrowserSkill
- replace OmniGet
- become a new LLM client
- become a code execution sandbox
- allow arbitrary shell execution from connector definitions
- bypass SkillsGate
- bypass Reviewer Council
- auto-enable destructive tools
- auto-apply learned skills in production
- expose upstream admin interfaces directly to the public Internet
- store raw secrets in Pao-hubPro tool metadata
- let agents create arbitrary database write queries without policy checks

---

# 5. Responsibility Boundaries

| Component | Responsibility |
|---|---|
| AnythingMCP | API/DB/MCP connector execution and protocol conversion |
| Pao-hubPro Capability Registry | canonical tool metadata |
| Pao-hubPro Policy Engine | allow/deny/approval rules |
| Credential Broker | secret storage and runtime resolution |
| MCPProxy | MCP routing / federation boundary |
| OmniRoute | model/provider routing |
| BrowserSkill | logged-in browser execution |
| OmniGet | content/media acquisition |
| SkillsGate | skill validation and promotion |
| Reviewer Council | multi-agent + human review |
| OpenCodeReview / AFT | code quality and implementation review |
| Audit Service | cross-system audit correlation |
| Observability Service | metrics, health, latency, errors |
| AnythingMCP Knowledge Graph | connector relationship discovery source |
| Pao Knowledge Layer | curated canonical relationship/skill knowledge |

---

# 6. Target Architecture

```text
                           ┌──────────────────────┐
                           │   Pao-hubPro UI      │
                           │ Capability Studio    │
                           └──────────┬───────────┘
                                      │
                         import / approve / publish
                                      │
                                      ▼
┌───────────────┐        ┌──────────────────────────────┐
│ API Discovery │───────▶│ Connector Intake Controller │
└───────────────┘        └──────────────┬───────────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ AnythingMCP Adapter  │
                            │      Gateway         │
                            └──────────┬───────────┘
                                       │
                ┌──────────────────────┼────────────────────┐
                │                      │                    │
                ▼                      ▼                    ▼
             REST/SOAP              GraphQL             DB / MCP
                │                      │                    │
                └──────────────────────┼────────────────────┘
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ Canonical Tool Model │
                            └──────────┬───────────┘
                                       │
                   ┌───────────────────┼─────────────────────┐
                   ▼                   ▼                     ▼
             Risk Classifier     Privacy Classifier    Auth Classifier
                   │                   │                     │
                   └───────────────────┼─────────────────────┘
                                       ▼
                            ┌──────────────────────┐
                            │ Policy / Approval    │
                            │       Engine         │
                            └──────────┬───────────┘
                                       │
                           Approved capabilities only
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │ MCP Publication     │
                            │ Layer / MCPProxy    │
                            └──────────┬───────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
              ChatGPT                Codex                 Claude
                 │                     │                     │
                 └─────────────────────┼─────────────────────┘
                                       ▼
                            ┌──────────────────────┐
                            │ Tool Call Gateway    │
                            ├──────────────────────┤
                            │ policy re-check      │
                            │ credential resolve   │
                            │ request transform    │
                            │ execute              │
                            │ response shaping     │
                            │ audit                │
                            │ metrics              │
                            └──────────────────────┘
```

---

# 7. New Pao-hubPro Modules

Create the following logical modules.

```text
apps/
  web/
    capability-studio/
    connector-studio/
    policy-studio/
    audit-explorer/
    knowledge-graph/
    skill-review/

services/
  anythingmcp-bridge/
  connector-intake/
  capability-registry/
  credential-broker/
  policy-engine/
  approval-engine/
  response-privacy-gateway/
  tool-runtime-gateway/
  tool-health-service/
  knowledge-governance/
  skill-learning-gateway/
  audit-service/

packages/
  capability-schema/
  connector-schema/
  policy-schema/
  risk-engine/
  data-classification/
  tool-annotations/
  audit-sdk/
  anythingmcp-client/
  secret-ref-sdk/
```

If the existing Pao-hubPro monorepo uses different conventions, preserve existing project conventions and map these logical modules into the current structure rather than forcing a new layout.

---

# 8. Canonical Connector Model

```ts
type ConnectorType =
  | "rest"
  | "soap"
  | "graphql"
  | "database"
  | "mcp";

type ConnectorStatus =
  | "draft"
  | "discovered"
  | "normalizing"
  | "testing"
  | "review"
  | "approved"
  | "published"
  | "degraded"
  | "disabled"
  | "archived";

interface ConnectorRecord {
  id: string;
  workspaceId: string;

  name: string;
  slug: string;
  description?: string;

  type: ConnectorType;
  sourceType:
    | "anythingmcp_adapter"
    | "openapi"
    | "postman"
    | "curl"
    | "wsdl"
    | "graphql_introspection"
    | "database"
    | "mcp_discovery";

  sourceUri?: string;
  sourceHash?: string;

  upstreamConnectorId?: string;

  ownerTeam?: string;
  ownerUserId?: string;

  credentialRef?: string;

  environment:
    | "development"
    | "staging"
    | "production";

  status: ConnectorStatus;

  riskLevel: 0 | 1 | 2 | 3 | 4;
  dataClassifications: string[];

  createdAt: string;
  updatedAt: string;
}
```

---

# 9. Canonical Tool Model

```ts
interface CanonicalTool {
  id: string;
  connectorId: string;

  canonicalName: string;
  upstreamName: string;

  displayName: string;
  description: string;

  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;

  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };

  sideEffect:
    | "none"
    | "read"
    | "create"
    | "update"
    | "delete"
    | "financial"
    | "identity"
    | "security"
    | "external_communication";

  riskLevel: 0 | 1 | 2 | 3 | 4;

  requiresApproval: boolean;
  approvalPolicyId?: string;

  responseProfileId?: string;

  enabled: boolean;
  published: boolean;

  version: number;
  schemaHash: string;

  createdAt: string;
  updatedAt: string;
}
```

---

# 10. Risk Classification

## R0 — Public / harmless read

Examples:

- public weather API
- public documentation lookup
- package tracking with non-sensitive test data

Policy:

```text
auto-run allowed
no human approval
normal audit
```

## R1 — Internal read

Examples:

- project metadata
- internal inventory
- non-sensitive status APIs

Policy:

```text
authenticated agent required
workspace authorization
normal audit
```

## R2 — Sensitive read

Examples:

- customer records
- employee data
- financial reports
- private database queries

Policy:

```text
explicit tool allowlist
response shaping mandatory
fallbackToRaw=false
enhanced audit
data classification required
```

## R3 — Reversible write

Examples:

- create draft record
- update non-critical metadata
- add internal label
- create non-sent message draft

Policy:

```text
policy check
human confirmation or scoped standing approval
idempotency when supported
before/after audit
```

## R4 — Destructive / financial / security-critical

Examples:

- delete record
- send money
- issue refund
- revoke account
- modify permissions
- send external communication with legal/business impact
- production database writes with destructive semantics

Policy:

```text
human approval REQUIRED
no autonomous bypass
full audit
reason required
preview required
transaction guard when possible
rollback instructions required
```

---

# 11. Tool Import Pipeline

```text
01 DISCOVER
02 FETCH SOURCE
03 HASH SOURCE
04 PARSE
05 CREATE CONNECTOR DRAFT
06 DISCOVER OPERATIONS
07 NORMALIZE TOOL NAMES
08 NORMALIZE SCHEMAS
09 DETECT AUTH
10 DETECT SIDE EFFECTS
11 RISK CLASSIFY
12 DATA CLASSIFY
13 GENERATE RESPONSE PROFILE
14 GENERATE TEST CASES
15 RUN SANDBOX/SAFE TESTS
16 SECURITY REVIEW
17 REVIEWER COUNCIL
18 HUMAN APPROVAL
19 PUBLISH
20 HEALTH MONITOR
21 LEARN
22 VERSION / ROLLBACK
```

Every transition must be persisted.

---

# 12. Connector Intake Sources

## 12.1 OpenAPI

Input:

```text
URL or uploaded JSON/YAML
```

Process:

```text
validate spec
→ resolve references
→ inspect authentication
→ enumerate operations
→ map operationId
→ infer read/write semantics
→ generate candidate tools
```

Rules:

- GET is not automatically considered safe if parameters can trigger side effects.
- DELETE defaults to R4.
- PUT/PATCH defaults to at least R3.
- POST defaults to R3 unless explicitly classified as read-only.
- payment, refund, transfer, credential, permission, deletion keywords escalate to R4.

## 12.2 Postman

Extract:

- base URLs
- variables
- headers
- auth definitions
- request bodies
- examples

Never import raw secrets from shared collections into plaintext metadata.

## 12.3 cURL

Parse into:

- method
- URL
- query parameters
- headers
- request body
- auth hints

Any token observed in the pasted command must be immediately converted to a secret reference and redacted from logs.

## 12.4 SOAP/WSDL

Map:

```text
service
→ port
→ operation
→ request schema
→ response schema
```

WS-Security or client cert material must remain inside the credential boundary.

## 12.5 GraphQL

Use schema introspection when allowed.

Separate:

```text
query → read
mutation → write
subscription → unsupported/feature-gated unless runtime supports it safely
```

## 12.6 Database

Database connector onboarding must require:

- environment
- network target
- database engine
- role/user
- read-only declaration
- allowed schemas
- allowed tables/collections
- query timeout
- row limit
- statement type allowlist
- credential reference

Production DB default:

```text
READ ONLY
LIMIT enforced
statement timeout enforced
DDL denied
DML denied
multi-statement denied
```

## 12.7 Existing MCP Server

Flow:

```text
connect
→ discover tools
→ import metadata
→ preserve upstream tool names
→ namespace
→ classify risk
→ apply Pao policy wrapper
→ republish through Pao MCP surface
```

---

# 13. Tool Naming Rules

Canonical tool name:

```text
<connector_slug>.<domain>.<action>
```

Examples:

```text
shopware.orders.get
dhl.shipments.track
postgres.inventory.find_products
erp.invoice.create_draft
crm.customer.get
```

Never expose opaque names such as:

```text
operation_42
doThing
apiCall1
queryData
```

unless unavoidable.

Descriptions must specify:

1. what the tool does
2. what it does not do
3. side effects
4. required identifiers
5. sensitivity
6. approval behavior

---

# 14. Credential Brokerage

AnythingMCP can encrypt credentials at rest, but Pao-hubPro should establish an independent secret-reference abstraction.

Canonical reference:

```text
secret://workspace/<workspace_id>/<provider>/<credential_id>
```

Examples:

```text
secret://workspace/main/dhl/prod
secret://workspace/main/postgres/inventory-readonly
secret://workspace/main/shopware/admin-api
```

Agents only receive:

```json
{
  "credential_ref": "secret://workspace/main/dhl/prod"
}
```

Runtime sequence:

```text
agent call
→ policy check
→ credential entitlement check
→ broker resolves secret
→ inject into upstream connector
→ execute
→ destroy in-memory request context
```

## Secret rules

MUST:

- encrypt secrets at rest
- avoid plaintext database columns
- redact from logs
- redact from error traces
- prevent model-visible interpolation
- restrict secrets by connector/tool/environment
- support rotation
- record secret version, not secret value, in audit events

MUST NOT:

- put API keys in tool descriptions
- put OAuth refresh tokens into agent context
- persist decrypted values in job payloads
- expose `.env` through admin/debug endpoints

---

# 15. AnythingMCP Encryption Key Handling

AnythingMCP uses `ENCRYPTION_KEY` for stored connector credentials.

Pao-hubPro deployment requirements:

```text
ENCRYPTION_KEY
JWT_SECRET
COOKIE_SECRET
```

must be stored in the Pao-hubPro secret management layer or protected deployment secret store.

Never commit them.

Rotation procedure must be documented before production launch.

A backup of AnythingMCP without a recoverable encryption key is insufficient for credential recovery.

---

# 16. Response-Shaping Privacy Gateway

Every tool receives a response policy.

Example:

```json
{
  "mode": "select",
  "fallbackToRaw": false,
  "exclude": [
    "customer.iban",
    "customer.taxId",
    "customer.passwordHash",
    "access_token",
    "refresh_token"
  ],
  "select": {
    "id": "$.id",
    "name": "$.customer.name",
    "status": "$.status",
    "total": "$.amount.total"
  }
}
```

## Phase 20.96 override

Pao-hubPro MUST override permissive defaults for R2-R4.

```text
R0  → fallback configurable
R1  → fallback configurable
R2  → fallbackToRaw=false
R3  → fallbackToRaw=false
R4  → fallbackToRaw=false
```

If transformation fails for sensitive tools:

```text
FAIL THE TOOL CALL
```

not:

```text
RETURN RAW RESPONSE
```

---

# 17. Data Classification

Minimum classes:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
PII
FINANCIAL
CREDENTIAL
SECURITY
HEALTH
LEGAL
CUSTOMER_SECRET
EMPLOYEE_PRIVATE
```

Tool output schema fields may carry labels:

```json
{
  "path": "customer.email",
  "classification": "PII",
  "handling": "mask"
}
```

Handling modes:

```text
allow
mask
hash
drop
placeholder
aggregate
deny
```

---

# 18. Request-Side Safety

Privacy enforcement is not only output-side.

Request parameters must also be checked.

Example:

```text
DELETE /customers/{id}
```

must not execute simply because a valid ID exists.

Pre-execution sequence:

```text
validate schema
→ normalize arguments
→ parameter policy
→ resource scope policy
→ side-effect policy
→ approval check
→ credential entitlement
→ rate limit
→ execute
```

---

# 19. Approval Engine

Approval request record:

```ts
interface ToolApprovalRequest {
  id: string;
  workspaceId: string;
  toolId: string;
  actorId: string;
  agentId?: string;

  reason: string;

  argumentsPreview: Record<string, unknown>;
  redactedArguments: Record<string, unknown>;

  riskLevel: number;
  expiresAt: string;

  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "cancelled";

  approvedBy?: string;
  approvedAt?: string;
}
```

UI must show:

```text
Tool
Connector
Environment
Action
Target resource
Arguments
Sensitive fields
Predicted side effect
Rollback possibility
Requesting agent
Reason
```

---

# 20. Dynamic MCP Publishing

AnythingMCP supports runtime tool registration.

Pao-hubPro must add a publication gate.

```text
AnythingMCP tool exists
         │
         ▼
Pao capability imported
         │
         ▼
Policy approved?
    ├─ no  → hidden
    └─ yes
         │
         ▼
Published through Pao MCP surface
```

Never let "exists upstream" mean "available to all agents".

---

# 21. MCP Server Profiles

Create named publication profiles.

Examples:

```text
paohub-readonly
paohub-development
paohub-stock-workflow
paohub-admin
paohub-research
paohub-browser
```

Each profile defines:

```yaml
id: paohub-readonly
tools:
  allow:
    - "crm.customer.get"
    - "erp.invoice.get"
    - "dhl.shipments.track"
  deny:
    - "*.delete"
    - "*.refund"
    - "*.transfer"
risk:
  max_without_approval: 2
credentials:
  environment: production
response_policy:
  sensitive_fail_closed: true
```

---

# 22. MCP Tool Annotation Reconciliation

When upstream annotation conflicts with Pao policy:

```text
Pao policy wins.
```

Example:

```text
upstream: destructiveHint=false
Pao classifier: sideEffect=delete
```

Final:

```text
destructiveHint=true
R4
approval required
```

Never trust upstream annotation as the sole security signal.

---

# 23. Knowledge Graph Integration

AnythingMCP's Knowledge Graph can identify structural relationships across connectors.

Pao-hubPro should ingest only governance-safe metadata.

Allowed graph content:

```text
entity names
field names
relation types
join hints
semantic descriptions
connector ownership
tool paths
confidence
source
```

Disallowed by default:

```text
actual customer names
account numbers
emails
passwords
tokens
raw row values
payment card data
session values
```

Canonical relation:

```ts
interface KnowledgeRelation {
  id: string;
  workspaceId: string;

  fromEntity: string;
  toEntity: string;

  relationType:
    | "foreign_key"
    | "identifier_mapping"
    | "derived"
    | "semantic"
    | "workflow";

  sourceConnectorId?: string;
  targetConnectorId?: string;

  sourceField?: string;
  targetField?: string;

  confidence: number;

  discoveredBy:
    | "schema"
    | "heuristic"
    | "anythingmcp_ai"
    | "paohub_ai"
    | "human";

  approved: boolean;
}
```

---

# 24. Knowledge-Graph Review

Suggested relationships never become canonical silently.

Flow:

```text
candidate relation
→ confidence score
→ sensitive-data scan
→ duplicate detection
→ human/reviewer review
→ approved relation
```

Confidence is advisory, not permission.

---

# 25. Cross-Connector Chaining

Example task:

```text
"Find an order and get the current shipment status."
```

Possible planning:

```text
shopware.orders.search
  ↓ order.id
shopware.orders.get
  ↓ tracking_number
dhl.shipments.track
```

The graph provides hints.

The runtime still evaluates policy independently for every step.

A safe first call never grants permission to later calls.

---

# 26. Adaptive Skill Learning

Input signals:

- tool invocation sequence
- success/failure
- user correction
- repeated intent
- accepted output
- approval decisions
- tool argument patterns
- relationship path

Skill candidate example:

```yaml
name: track-shopware-order
intent: "Track shipment for a Shopware order"
steps:
  - tool: shopware.orders.get
  - map: result.tracking_number -> tracking_number
  - tool: dhl.shipments.track
constraints:
  - read_only: true
  - max_risk: 2
```

---

# 27. Skill Governance

Default:

```text
AUTO_APPLY=false
```

Promotion workflow:

```text
candidate
→ deduplicate
→ security scan
→ policy scan
→ dry-run replay
→ Reviewer Council
→ human approval
→ versioned skill
→ SkillsGate
→ production
```

A high confidence score MUST NOT bypass this path for production.

---

# 28. Tool Versioning

Because upstream fine-grained tool versioning is currently a roadmap item, Pao-hubPro must maintain its own canonical versions.

Version identity:

```text
connector_id
tool_id
schema_hash
response_profile_hash
policy_hash
```

Example:

```text
crm.customer.get@3
```

Publish immutable versions.

Alias:

```text
crm.customer.get@stable
```

may point to version 3.

Agents with reproducibility requirements should pin exact versions.

---

# 29. Drift Detection

Poll or observe connector definitions.

Detect:

- endpoint added
- endpoint removed
- input schema changed
- output schema changed
- auth changed
- required parameter changed
- operation semantics changed
- upstream MCP tool changed

On incompatible drift:

```text
mark connector DEGRADED
freeze affected publication
create review task
do not silently migrate production tools
```

---

# 30. Database Schema

Recommended tables:

```text
connectors
connector_sources
connector_import_runs
connector_health

capabilities
capability_versions
capability_annotations
capability_publications

credential_refs
credential_bindings

response_profiles
data_classification_rules

policies
policy_bindings
policy_evaluations

approval_requests
approval_events

mcp_server_profiles
mcp_server_profile_tools

tool_call_runs
tool_call_events
tool_call_errors

kg_entities
kg_relations
kg_relation_candidates

skill_candidates
skill_versions
skill_reviews

audit_events

health_samples
latency_samples
rate_limit_events
```

---

# 31. SQL Sketch

```sql
CREATE TABLE connectors (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    type TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_uri TEXT,
    source_hash TEXT,
    upstream_connector_id TEXT,
    credential_ref TEXT,
    environment TEXT NOT NULL,
    status TEXT NOT NULL,
    risk_level INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, slug)
);

CREATE TABLE capabilities (
    id UUID PRIMARY KEY,
    connector_id UUID NOT NULL REFERENCES connectors(id),
    canonical_name TEXT NOT NULL,
    upstream_name TEXT NOT NULL,
    description TEXT NOT NULL,
    side_effect TEXT NOT NULL,
    risk_level INTEGER NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    response_profile_id UUID,
    enabled BOOLEAN NOT NULL DEFAULT false,
    published BOOLEAN NOT NULL DEFAULT false,
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE capability_versions (
    id UUID PRIMARY KEY,
    capability_id UUID NOT NULL REFERENCES capabilities(id),
    version INTEGER NOT NULL,
    schema_hash TEXT NOT NULL,
    input_schema JSONB NOT NULL,
    output_schema JSONB,
    annotations JSONB NOT NULL,
    policy_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(capability_id, version)
);
```

Use existing Pao-hubPro ORM/migration conventions if they differ.

---

# 32. Pao-hubPro API Surface

## Connector APIs

```text
POST   /api/connectors/import
POST   /api/connectors/import/openapi
POST   /api/connectors/import/postman
POST   /api/connectors/import/curl
POST   /api/connectors/import/wsdl
POST   /api/connectors/import/graphql
POST   /api/connectors/import/database
POST   /api/connectors/import/mcp

GET    /api/connectors
GET    /api/connectors/:id
PATCH  /api/connectors/:id
POST   /api/connectors/:id/test
POST   /api/connectors/:id/approve
POST   /api/connectors/:id/publish
POST   /api/connectors/:id/disable
POST   /api/connectors/:id/sync
```

## Capability APIs

```text
GET    /api/capabilities
GET    /api/capabilities/:id
PATCH  /api/capabilities/:id
POST   /api/capabilities/:id/test
POST   /api/capabilities/:id/publish
POST   /api/capabilities/:id/disable
GET    /api/capabilities/:id/versions
POST   /api/capabilities/:id/rollback
```

## Policy APIs

```text
POST   /api/policies/evaluate
GET    /api/policies
POST   /api/policies
PATCH  /api/policies/:id
```

## Approval APIs

```text
GET    /api/approvals
POST   /api/approvals/:id/approve
POST   /api/approvals/:id/reject
```

## Knowledge APIs

```text
GET    /api/knowledge/entities
GET    /api/knowledge/relations
GET    /api/knowledge/candidates
POST   /api/knowledge/candidates/:id/approve
POST   /api/knowledge/candidates/:id/reject
```

## Skill APIs

```text
GET    /api/skills/candidates
POST   /api/skills/candidates/:id/review
POST   /api/skills/candidates/:id/promote
POST   /api/skills/:id/disable
```

---

# 33. Internal Events

Use the existing event bus where available.

Recommended events:

```text
connector.discovered
connector.imported
connector.normalized
connector.tested
connector.approved
connector.published
connector.disabled
connector.drift_detected
connector.health_degraded

capability.created
capability.changed
capability.approved
capability.published
capability.disabled
capability.rollback

tool.call.requested
tool.call.policy_allowed
tool.call.policy_denied
tool.call.approval_required
tool.call.executed
tool.call.failed

response.redacted
response.mapping_failed

knowledge.relation_candidate
knowledge.relation_approved

skill.candidate_created
skill.reviewed
skill.promoted
skill.disabled

credential.used
credential.rotation_due
credential.rotation_completed
```

---

# 34. Policy DSL

Example:

```yaml
policy:
  id: production-customer-data
  match:
    connector_environment: production
    data_classification:
      any:
        - PII
        - FINANCIAL

  execution:
    require_authenticated_actor: true
    require_workspace_membership: true

  response:
    fallback_to_raw: false
    redact:
      - "*.password*"
      - "*.token*"
      - "*.secret*"
      - "*.iban"
      - "*.taxId"

  approval:
    when:
      risk_gte: 3

  audit:
    level: enhanced
```

---

# 35. Policy Evaluation Result

```json
{
  "decision": "allow_with_approval",
  "risk": 3,
  "policy_ids": [
    "production-customer-data"
  ],
  "required_actions": [
    "human_approval",
    "enhanced_audit"
  ],
  "response_profile": "customer-safe-v2"
}
```

---

# 36. Tool Runtime Flow

```text
Agent
  │
  ▼
Pao MCP Gateway
  │
  ▼
Resolve canonical tool
  │
  ▼
Resolve exact tool version
  │
  ▼
Policy evaluation
  │
  ├─ DENY ───────────────▶ audit + error
  │
  ├─ APPROVAL REQUIRED ──▶ approval queue
  │
  └─ ALLOW
       │
       ▼
Credential entitlement
       │
       ▼
Resolve secret
       │
       ▼
AnythingMCP execute
       │
       ▼
Response privacy mapping
       │
       ├─ mapping error + sensitive
       │       └─ fail closed
       │
       ▼
Data-loss / secret scan
       │
       ▼
Audit
       │
       ▼
Return to agent
```

---

# 37. Audit Model

Every tool call must have a correlation ID.

```text
paohub_run_id
agent_run_id
tool_call_id
anythingmcp_call_id
approval_id
```

Audit event:

```json
{
  "event": "tool.call.executed",
  "tool": "erp.invoice.get",
  "version": 4,
  "actor": "agent:researcher",
  "workspace": "main",
  "risk": 2,
  "duration_ms": 483,
  "status": "success",
  "credential_version": "prod-v7",
  "response_profile": "invoice-safe-v3"
}
```

Never place raw secrets in this event.

---

# 38. Audit Data Retention

Separate:

```text
operational logs
security audit
upstream raw response evidence
agent-visible transformed response
```

Retention policies may differ.

Raw upstream responses containing PII/financial data require stricter retention, access, and deletion rules than ordinary metrics.

---

# 39. Observability

Required metrics:

```text
connector_import_total
connector_import_failed_total

connector_health_status
connector_sync_duration_ms

tool_call_total
tool_call_error_total
tool_call_latency_ms

tool_policy_denied_total
tool_approval_required_total

response_mapping_failure_total
response_redaction_total

credential_resolution_failure_total

mcp_publish_total
mcp_publish_failure_total

knowledge_relation_candidate_total
skill_candidate_total
```

Dashboards:

1. Connector Health
2. Tool Reliability
3. Policy Decisions
4. Approval Queue
5. Privacy/Redaction Failures
6. Credential Errors
7. MCP Publishing
8. Learned Knowledge/Skills

---

# 40. Rate Limiting

Apply rate limiting at multiple layers:

```text
workspace
actor
agent
connector
tool
credential
upstream host
```

Do not depend on only one global limiter.

Example policy:

```yaml
tool: erp.invoice.search
limits:
  per_actor:
    rpm: 30
  per_connector:
    rpm: 300
  burst: 10
```

---

# 41. Retry Policy

Retry only safe/idempotent operations automatically.

```text
GET / read-only       → retry allowed
idempotent PUT        → conditional
POST create           → do not blindly retry
DELETE                → never blind retry
financial operation   → never blind retry
```

Use idempotency keys where supported.

---

# 42. Timeout Policy

Every connector/tool must have:

```text
connect timeout
request timeout
overall execution timeout
DB statement timeout
```

Long-running operations must not hold unbounded worker resources.

Until upstream streaming is verified as shipped, long jobs should use Pao-hubPro's own durable job mechanism when applicable.

---

# 43. Circuit Breaker

Per connector:

```text
CLOSED
OPEN
HALF_OPEN
```

Trip conditions may include:

- upstream timeout rate
- authentication failures
- 5xx rate
- schema mismatch
- repeated response mapping failures

For security-sensitive mapping failures, immediately disable the affected publication if leakage cannot be ruled out.

---

# 44. Capability Studio UI

Main screens:

## Screen A — Connector Catalog

Columns:

```text
Name
Type
Source
Environment
Tools
Risk
Health
Status
Last Sync
```

Actions:

```text
Import
Test
Review
Approve
Publish
Disable
Sync
```

## Screen B — Tool Inspector

Show:

```text
canonical name
upstream operation
description
input schema
output schema
side-effect classification
risk
MCP annotations
response shaping
data classifications
credential binding
test history
versions
audit samples
```

## Screen C — Response Privacy Preview

Two panes:

```text
RAW UPSTREAM
       vs
MODEL-VISIBLE
```

Highlight removed/masked fields.

## Screen D — Approval Queue

Show highest risk first.

## Screen E — Knowledge Graph

Visualize:

```text
entity
field relation
connector
tool path
confidence
approval status
```

## Screen F — Skill Candidates

Actions:

```text
Apply
Edit
Reject
Replay Test
Send to Reviewer Council
```

Production default must not show a one-click unsafe auto-apply mode.

---

# 45. AnythingMCP Deployment Boundary

Recommended:

```text
Docker network: paohub_internal

pao-web
pao-api
pao-policy
pao-secrets
pao-mcp-gateway
anythingmcp-web
anythingmcp-api
anythingmcp-postgres
redis
```

AnythingMCP admin UI:

```text
NOT public by default
```

AnythingMCP MCP endpoint:

```text
internal network or authenticated reverse-proxy only
```

Preferred external path:

```text
AI Client
→ Pao MCP Gateway
→ policy
→ AnythingMCP
```

Avoid:

```text
AI Client
→ AnythingMCP directly
```

for production Pao-hubPro-managed capabilities.

---

# 46. Example Docker Networking

Conceptual only:

```yaml
services:
  anythingmcp:
    networks:
      - paohub_internal
    expose:
      - "4000"

  paohub_mcp_gateway:
    networks:
      - paohub_internal
      - paohub_edge

networks:
  paohub_internal:
    internal: true

  paohub_edge:
```

Do not bind AnythingMCP port `4000` publicly unless required and protected.

---

# 47. Security Requirements

## Mandatory

- HTTPS at external boundaries
- OAuth2 where supported
- workspace isolation
- connector-level authorization
- tool-level authorization
- secret encryption
- response shaping
- audit logging
- rate limiting
- schema validation
- SSRF protections for connector import/fetch
- URL allow/deny policies
- DNS rebinding defenses where applicable
- DB read-only defaults
- SQL statement restrictions
- query timeout
- output size limits
- input size limits
- file size limits
- connector health checks
- human approval for R4
- no raw secret logging

---

# 48. SSRF Defense

Importers can fetch arbitrary URLs; therefore treat them as SSRF-sensitive.

Default deny:

```text
127.0.0.0/8
169.254.0.0/16
metadata service IPs
private network ranges
localhost names
unix sockets
file://
gopher://
```

Allow explicit private/internal hosts through admin-managed allowlists.

Re-resolve DNS before connection if the HTTP stack does not already mitigate rebinding.

---

# 49. SQL Safety

For read-only database connectors:

Allow:

```text
SELECT
WITH ... SELECT
safe aggregation
```

Deny:

```text
INSERT
UPDATE
DELETE
DROP
ALTER
TRUNCATE
CREATE
GRANT
REVOKE
COPY PROGRAM
EXEC
xp_cmdshell
multi-statement payloads
```

Database-engine-specific checks are required.

Do not rely only on regex.

Use a read-only DB account in addition to query inspection.

---

# 50. Prompt Injection / Tool Injection Handling

External tool outputs are untrusted data.

A tool response containing:

```text
"Ignore previous instructions..."
```

is data, not instruction.

The gateway must mark external response content as untrusted.

Agents must not gain new permissions from tool-returned text.

No connector may dynamically expand its own policy privileges.

---

# 51. OAuth and Identity

For user-delegated operations, preserve actor identity when possible.

Distinguish:

```text
service credential
user delegated credential
workspace credential
agent credential
```

Audit must record which credential class was used.

---

# 52. SSO/SCIM Integration

If upstream SSO/SCIM is enabled, Pao-hubPro remains the authority for Pao roles.

Role mapping flow:

```text
Identity Provider
→ Pao identity
→ Pao role
→ Pao tool policy
→ upstream connector access
```

Do not assume upstream role membership automatically equals Pao tool entitlement.

---

# 53. Integration with MCPProxy

Recommended relationship:

```text
AnythingMCP
= connector conversion engine

MCPProxy
= routing / federation boundary
```

Path:

```text
AnythingMCP MCP endpoint
→ MCPProxy
→ Pao Policy Wrapper
→ Agent-specific virtual MCP surface
```

Exact ordering may be adapted to the existing Pao-hubPro architecture, but policy enforcement must not be bypassable by directly addressing an upstream endpoint.

---

# 54. Integration with OmniRoute

OmniRoute selects:

```text
model/provider
```

AnythingMCP selects/executes:

```text
tool capability
```

These must remain separate.

Example:

```text
Task
→ Planner
→ OmniRoute chooses model
→ model requests tool
→ Pao policy
→ AnythingMCP executes tool
```

---

# 55. Integration with OpenClaw / API Directory

Target automation:

```text
API discovered
→ spec URL found
→ trust score
→ import candidate
→ AnythingMCP connector draft
→ generated Pao tools
→ policy review
```

Discovery never equals publication.

---

# 56. Integration with BrowserSkill

Decision rule:

```text
API exists and is adequate
→ prefer AnythingMCP connector

No usable API / web-only workflow
→ BrowserSkill
```

This reduces fragile browser automation.

---

# 57. Integration with OmniGet

```text
OmniGet
= content acquisition

AnythingMCP
= structured system/API integration
```

Example:

```text
OmniGet downloads a research PDF
AnythingMCP queries a metadata API
Pao-hubPro combines both into a workflow
```

---

# 58. Integration with SkillsGate

AnythingMCP-produced usage patterns become:

```text
skill candidates
```

not:

```text
trusted production skills
```

SkillsGate remains the promotion boundary.

---

# 59. Integration with Reviewer Council

Review areas:

```text
tool naming
schema quality
side effects
risk score
response privacy
approval policy
secret handling
test coverage
knowledge relation
skill candidate
```

Council output:

```text
PASS
PASS_WITH_CHANGES
BLOCK
HUMAN_DECISION_REQUIRED
```

---

# 60. Capability Health Score

Do not use health score to override policy.

Possible operational score:

```text
availability
error rate
latency
schema stability
auth health
rate-limit health
```

Used for routing/fallback only.

---

# 61. Connector Trust Metadata

```ts
interface ConnectorTrust {
  sourceVerified: boolean;
  specVerified: boolean;
  ownerVerified: boolean;
  authReviewed: boolean;
  privacyReviewed: boolean;
  writeActionsReviewed: boolean;
  productionApproved: boolean;
}
```

---

# 62. Publishing States

```text
PRIVATE_DRAFT
TEAM_TEST
STAGING
PRODUCTION_READONLY
PRODUCTION_CONTROLLED_WRITE
DISABLED
```

New connectors should not jump directly to production.

---

# 63. Safe Default Onboarding

Default settings for unknown connector:

```yaml
status: PRIVATE_DRAFT
publish: false
risk_floor: 2
allow_write: false
allow_destructive: false
response_fallback_to_raw: false
human_review: true
```

---

# 64. Test Strategy

## Unit tests

Test:

- tool name normalization
- risk classification
- side-effect inference
- response mapping
- secret redaction
- policy evaluation
- version hashing
- schema diff
- database statement classification

## Integration tests

Test:

- REST import
- SOAP import
- GraphQL import
- database connector
- MCP bridge
- credential resolution
- policy deny
- approval flow
- dynamic publication
- response privacy
- audit correlation

## E2E tests

Use disposable local/mock systems.

Do not run destructive E2E tests against real production services.

---

# 65. Security Test Cases

Must include:

```text
secret in header
secret in URL query
secret in JSON output
secret in nested array
mapping expression failure
malformed OpenAPI
malicious WSDL URL
SSRF attempt
GraphQL introspection abuse
SQL injection attempt
tool-name collision
schema drift
credential revoked
OAuth refresh failure
upstream timeout
destructive operation mislabeled read-only
prompt injection in tool output
```

---

# 66. Privacy Regression Test

Given raw:

```json
{
  "customer": {
    "name": "Example",
    "email": "example@example.invalid",
    "iban": "REDACTED_TEST_IBAN"
  },
  "access_token": "TEST_SECRET"
}
```

Expected model response:

```json
{
  "customer": {
    "name": "Example"
  }
}
```

Test must fail if:

```text
email
iban
access_token
```

are model-visible under the active policy.

---

# 67. Destructive-Action Regression Test

If imported API says:

```text
DELETE /users/{id}
```

Expected:

```text
risk=4
destructiveHint=true
approval required
```

even if upstream metadata incorrectly claims read-only.

---

# 68. Schema Drift Test

Version 1:

```json
{
  "id": "string"
}
```

Version 2:

```json
{
  "id": "number"
}
```

Expected:

```text
breaking drift detected
new version created
stable alias remains on old version
review required
```

---

# 69. Failure Modes

## AnythingMCP unavailable

Behavior:

```text
circuit open
return structured tool unavailable error
no fallback to unsafe direct API call
```

## Secret broker unavailable

```text
fail closed
```

## Policy engine unavailable

```text
fail closed for production
```

## Audit service unavailable

For R3/R4:

```text
deny execution unless explicit break-glass policy exists
```

For R0/R1:

configurable.

## Response shaping unavailable

For R2-R4:

```text
fail closed
```

---

# 70. Break-Glass Mode

Optional admin emergency mode.

Requirements:

- explicit admin action
- reason
- short expiration
- enhanced audit
- notification
- no silent activation
- never reveal secrets to model

Break-glass should be difficult by design.

---

# 71. Rollback

Every publication must support rollback.

Rollback targets:

```text
tool version
policy version
response profile
connector configuration
skill version
knowledge relation approval
```

Rollback must not restore expired/revoked credentials automatically.

---

# 72. License Architecture

Upstream repository currently uses:

```text
AGPL-3.0-only
```

for the main repository, with separate commercial licensing for `ee/` directories.

Recommended boundary:

```text
Pao-hubPro
   │
   │ HTTP / MCP API boundary
   ▼
AnythingMCP container/service
```

Avoid:

```text
copy AnythingMCP source directly into proprietary Pao core
```

unless the licensing implications are intentionally reviewed.

This Phase document is engineering guidance, not legal advice.

---

# 73. Source Provenance

Store upstream provenance:

```json
{
  "repo": "https://github.com/HelpCode-ai/anythingmcp",
  "branch": "main",
  "source_type": "upstream_service",
  "verified_date": "2026-09-19"
}
```

If deployment pins a commit or release, record the exact commit SHA/tag.

---

# 74. Upstream Upgrade Procedure

Before upgrade:

```text
1. read changelog
2. diff config/environment changes
3. inspect migrations
4. run security tests
5. run connector compatibility suite
6. verify MCP schema
7. verify response shaping
8. verify credential decryption
9. verify audit behavior
10. deploy to staging
11. canary
12. production rollout
```

Never auto-upgrade production AnythingMCP without validation.

---

# 75. Feature Flags

Recommended:

```text
PHASE_20_96_ENABLED

ANYTHINGMCP_BRIDGE_ENABLED
ANYTHINGMCP_KG_IMPORT_ENABLED
ANYTHINGMCP_AI_SKILL_CAPTURE_ENABLED

CONNECTOR_AUTO_TEST_ENABLED
CONNECTOR_AUTO_PUBLISH_ENABLED=false

TOOL_WRITE_ACTIONS_ENABLED=false
TOOL_DESTRUCTIVE_ACTIONS_ENABLED=false

SENSITIVE_RESPONSE_FAIL_CLOSED=true
LEARNED_SKILL_AUTO_APPLY=false

KNOWLEDGE_AUTO_APPROVE=false
```

Production defaults intentionally conservative.

---

# 76. MVP Scope

## MVP-1

Implement:

- AnythingMCP bridge client
- connector registry
- REST/OpenAPI intake
- canonical tool model
- tool risk classification
- response privacy profiles
- credential references
- read-only MCP publication
- audit correlation
- basic UI

## MVP-2

Add:

- SOAP
- GraphQL
- database connectors
- MCP-to-MCP import
- approval workflow
- versioning
- schema drift
- health monitoring

## MVP-3

Add:

- knowledge graph governance
- learned skill candidates
- Reviewer Council integration
- SkillsGate integration
- advanced policy DSL
- routing/fallback analytics

---

# 77. Implementation Priority

## P0 — Required

- secure deployment boundary
- connector bridge
- canonical schemas
- policy engine integration
- secret reference integration
- response shaping
- risk classification
- audit
- read-only publication
- tests

## P1 — Important

- approvals
- versions
- drift
- database restrictions
- health dashboards
- Knowledge Graph review
- skill candidates

## P2 — Advanced

- connector marketplace abstraction
- declarative composition
- webhook/event integration
- streaming integration
- OpenTelemetry
- custom plugin SDK
- A/B tool versions

P2 items must be feature-gated and should not block P0/P1 delivery.

---

# 78. Definition of Done

Phase 20.96 is complete when:

- [ ] AnythingMCP runs as an isolated self-hosted service
- [ ] Pao-hubPro can connect to its API/MCP interface
- [ ] OpenAPI import creates connector drafts
- [ ] REST tools are normalized into canonical capability records
- [ ] SOAP import works
- [ ] GraphQL import works
- [ ] database connector works with read-only default
- [ ] existing MCP server import works
- [ ] no connector auto-publishes
- [ ] tools receive risk classifications
- [ ] sensitive outputs default to fail-closed mappings
- [ ] secrets never appear in model context
- [ ] credential references are auditable
- [ ] R3 actions require policy approval
- [ ] R4 actions require explicit human approval
- [ ] tool calls receive correlation IDs
- [ ] policy denies are audited
- [ ] response mapping failures are audited
- [ ] schema drift creates a new version
- [ ] broken drift does not silently replace stable production version
- [ ] tools can be disabled immediately
- [ ] rollback works
- [ ] Knowledge Graph candidates require review
- [ ] learned skill candidates require review
- [ ] SkillsGate controls skill promotion
- [ ] Reviewer Council integration exists
- [ ] production endpoints are not publicly exposed without authenticated gateway controls
- [ ] security regression suite passes
- [ ] docs explain upstream license boundary
- [ ] deployment/backup/secret rotation runbooks exist

---

# 79. Acceptance Scenarios

## Scenario A — REST

Given:

```text
OpenAPI URL
```

When:

```text
Admin imports
```

Then:

```text
connector draft appears
tools generated
risk assigned
none published yet
```

After review:

```text
read tools publish
write tools remain controlled
```

## Scenario B — Sensitive customer API

Given output contains:

```text
customer email
tax ID
bank account
```

Then model-visible response contains only approved fields.

If mapping fails:

```text
call fails
raw response is not returned
```

## Scenario C — Production database

Given:

```text
PostgreSQL production
```

Then:

```text
read-only DB credential
statement timeout
row limit
DML denied
DDL denied
audit enabled
```

## Scenario D — Destructive action

Given:

```text
delete_invoice
```

Then:

```text
R4
destructiveHint=true
human approval
```

## Scenario E — Learned workflow

Given repeated successful calls:

```text
order.get
→ shipment.track
```

Then:

```text
skill candidate created
not auto-applied
review required
```

---

# 80. Operational Runbook

## Startup

```text
1. database ready
2. redis ready
3. AnythingMCP ready
4. Pao credential broker ready
5. Pao policy engine ready
6. Pao MCP gateway ready
7. health checks green
8. publication enabled
```

## Shutdown

Drain active tool calls before stopping connector runtime where possible.

## Backup

Back up:

- Pao database
- AnythingMCP database
- connector metadata
- policies
- response profiles
- skill versions
- knowledge metadata
- secret-store metadata
- encryption keys via secure key backup procedure

Do not put raw secret exports in routine plaintext backups.

---

# 81. Recommended Initial Production Policy

```yaml
production:
  default_publish: false

  max_autonomous_risk: 2

  writes:
    enabled: true
    require_approval: true

  destructive:
    enabled: true
    require_human: true

  secrets:
    model_visible: false

  response:
    sensitive_fallback_to_raw: false

  learned_skills:
    auto_apply: false

  knowledge_relations:
    auto_approve: false

  database:
    default_read_only: true

  audit:
    required: true
```

---

# 82. Recommended First Connectors for Pao-hubPro

Use low-risk examples first:

1. a public REST API
2. a local mock OpenAPI service
3. a development PostgreSQL database with read-only account
4. a development MCP server
5. a non-production GraphQL service

Only after the full policy/audit/privacy path works should production credentials be added.

---

# 83. Implementation Guardrails for Codex

Codex MUST:

- inspect the current Pao-hubPro architecture before editing
- preserve existing conventions
- reuse existing auth/policy/audit primitives
- avoid duplicate registries
- use migrations
- add tests with every module
- create feature flags
- use interfaces around AnythingMCP
- avoid hard-coding upstream adapter counts
- treat adapter catalog size as dynamic
- record source version/provenance
- preserve current functionality
- implement rollback
- update docs

Codex MUST NOT:

- expose upstream ports publicly by default
- commit credentials
- copy `ee/` code
- silently enable writes
- silently auto-apply learned skills
- trust upstream destructive hints blindly
- allow raw sensitive response fallback
- run destructive tests against production
- bypass Reviewer Council / SkillsGate

---

# 84. Suggested Internal Interface

```ts
interface AnythingMcpBridge {
  health(): Promise<HealthResult>;

  importOpenApi(input: OpenApiImport): Promise<ImportResult>;
  importPostman(input: PostmanImport): Promise<ImportResult>;
  importCurl(input: CurlImport): Promise<ImportResult>;
  importWsdl(input: WsdlImport): Promise<ImportResult>;
  importGraphql(input: GraphqlImport): Promise<ImportResult>;
  importDatabase(input: DatabaseImport): Promise<ImportResult>;
  importMcp(input: McpImport): Promise<ImportResult>;

  listConnectors(): Promise<UpstreamConnector[]>;
  listTools(connectorId: string): Promise<UpstreamTool[]>;

  testTool(input: ToolTestRequest): Promise<ToolTestResult>;
  executeTool(input: ToolExecuteRequest): Promise<ToolExecuteResult>;

  getKnowledgeGraph(workspaceId: string): Promise<UpstreamKnowledgeGraph>;
  getSkillCandidates(workspaceId: string): Promise<UpstreamSkillCandidate[]>;
}
```

This interface protects Pao-hubPro from upstream implementation churn.

---

# 85. Architecture Decision Records

Create ADRs:

```text
ADR-20.96-001 AnythingMCP as isolated integration service
ADR-20.96-002 Pao policy engine remains authoritative
ADR-20.96-003 Sensitive response mappings fail closed
ADR-20.96-004 Learned skills require promotion
ADR-20.96-005 Canonical Pao tool versioning independent of upstream
ADR-20.96-006 Secrets referenced, never model-visible
ADR-20.96-007 Production databases are read-only by default
ADR-20.96-008 Existing MCP tools are re-governed on import
```

---

# 86. Final Architecture Principle

AnythingMCP should answer:

> **"How do we connect this API/database/system to MCP?"**

Pao-hubPro should answer:

> **"Should this capability exist, who can use it, with which credentials, what may the model see, when is approval required, which version is active, and what happened when it ran?"**

That separation is the core design rule of Phase 20.96.

---

# 87. Canonical End State

```text
                 ┌─────────────────────────────┐
                 │      CAPABILITY SOURCES     │
                 ├─────────────────────────────┤
                 │ REST • SOAP • GraphQL • DB  │
                 │ MCP • SaaS • Internal APIs  │
                 └──────────────┬──────────────┘
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │         AnythingMCP         │
                 │ Connector / Conversion Layer│
                 └──────────────┬──────────────┘
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │         Pao-hubPro          │
                 │    Capability Control Plane │
                 ├─────────────────────────────┤
                 │ Registry                    │
                 │ Policy                      │
                 │ Secrets                     │
                 │ Privacy                     │
                 │ Approval                    │
                 │ Versioning                  │
                 │ Knowledge                   │
                 │ Skills                      │
                 │ Audit                       │
                 │ Observability               │
                 └──────────────┬──────────────┘
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │     POLICY-GOVERNED MCP     │
                 └──────────────┬──────────────┘
                                │
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
        ChatGPT               Codex                Claude
           │                    │                    │
           └────────────────────┼────────────────────┘
                                ▼
                     Pao-hubPro Agent Fleet
```

---

# 88. Phase Completion Statement

After Phase 20.96, **Pao-hubPro gains a universal capability ingestion plane**.

Adding a new business system should no longer mean "build another MCP server."

The new standard becomes:

```text
Find it
→ import it
→ normalize it
→ classify it
→ secure it
→ test it
→ approve it
→ publish it
→ monitor it
→ learn from it
```

with Pao-hubPro maintaining final authority over:

```text
identity
policy
secrets
privacy
approval
version
audit
knowledge
skills
agent access
```

This makes AnythingMCP a highly useful **integration engine**, while Pao-hubPro remains the **policy-governed operating plane** for the complete agent ecosystem.

---

# 89. Upstream References

- Repository: https://github.com/HelpCode-ai/anythingmcp
- README: https://github.com/HelpCode-ai/anythingmcp/blob/main/README.md
- Roadmap: https://github.com/HelpCode-ai/anythingmcp/blob/main/ROADMAP.md
- Security: https://github.com/HelpCode-ai/anythingmcp/blob/main/SECURITY.md
- Licensing: https://github.com/HelpCode-ai/anythingmcp/blob/main/LICENSING.md
- MCP project: https://github.com/modelcontextprotocol/modelcontextprotocol

---

# 90. Next Command

Recommended next artifact after this Phase:

```text
/gold Phase 20.96
```

Its purpose should be to turn this blueprint into a **single canonical Codex implementation command** that:

- audits the current Pao-hubPro repository
- maps this Phase to the existing architecture
- creates migrations
- implements bridge/adapters
- implements policy and privacy gates
- adds UI
- adds tests
- runs validation
- repairs failures
- produces a final implementation report
- leaves the repository in a working, reviewable state
