# Phase 20.56 — Pao-hubPro × qxresearch Micro-App Capability Lab

## Python Recipe Registry, Sandboxed Tool Runtime, Automated MCP Skill Conversion & Policy-Governed Capability Factory

**Project:** Pao-hubPro  
**Phase:** 20.56  
**Source inspiration:** `github.com/qxresearch/qxresearch-event-1`  
**Primary objective:** Turn small Python utilities, examples, and GitHub micro-apps into reusable, observable, permission-controlled Pao-hubPro capabilities that can be promoted into MCP tools, Skills, REST actions, workflows, or agent-callable functions.

---

# 1. Executive Summary

Phase 20.56 introduces a **Micro-App Capability Lab** into Pao-hubPro.

The target is not to import qxresearch scripts wholesale. The target is to build a reusable production system that can:

1. discover a Python micro-app or utility,
2. inspect its source code,
3. classify dependencies and side effects,
4. infer inputs and outputs,
5. assign permissions and risk,
6. run it in an isolated sandbox,
7. generate test cases,
8. wrap it behind a stable tool contract,
9. convert it into MCP / Skill / REST adapters,
10. publish an approved version into a Capability Registry,
11. allow agents to discover and call the capability safely,
12. retain provenance, license, audit logs, hashes, versions, and rollback metadata.

The architecture must be generic enough to ingest future repositories beyond qxresearch.

This phase therefore creates a **Capability Factory**, not a one-off integration.

---

# 2. Why This Phase Exists

Pao-hubPro already has or is progressively gaining:

- multi-agent orchestration,
- MCP integration,
- agent skill registries,
- persistent memory,
- policy-governed execution,
- AI gateways,
- browser and device runtimes,
- observability,
- automation systems,
- code-generation and reviewer workflows.

However, one recurring problem remains:

> Useful GitHub repositories often contain many small utilities that are valuable individually, but they are not packaged as production-ready tools.

Examples:

- PDF merge
- image conversion
- screenshot utility
- audio extraction
- file transformation
- web scraping
- speech-to-text
- notifications
- email automation
- local GUI helpers
- metadata extraction
- vector ingestion
- text summarization
- media processing

Without Phase 20.56, each utility requires manual review and integration.

With Phase 20.56, Pao-hubPro gains a repeatable pipeline:

```text
GitHub / Local Recipe
        │
        ▼
Recipe Discovery
        │
        ▼
Static Analysis
        │
        ▼
Capability Manifest Builder
        │
        ▼
Dependency + License + Secret Scan
        │
        ▼
Permission / Risk Classification
        │
        ▼
Sandbox Build
        │
        ▼
Smoke / Contract / Policy Tests
        │
        ▼
Adapter Compiler
 ┌──────────┼───────────┐
 ▼          ▼           ▼
MCP       Skill       REST
        │
        ▼
Capability Registry
        │
        ▼
Agent Discovery / Invocation
```

---

# 3. Core Design Principles

## 3.1 Import capabilities, not repositories

Repository structure is considered source material only.

Pao-hubPro must extract each useful function into a self-contained capability.

## 3.2 Default-deny execution

No imported code gets network, shell, host filesystem, camera, microphone, secrets, device control, or external process access unless explicitly granted.

## 3.3 Human approval before production promotion

The system may auto-ingest and auto-test, but production publication of elevated-risk capabilities requires explicit approval.

## 3.4 Immutable versions

Every published capability version is immutable and content-addressed.

## 3.5 Provenance first

For every imported capability retain:

- source repository,
- source URL,
- source commit SHA,
- original file path,
- original license,
- imported timestamp,
- code hash,
- dependency lock hash,
- generated wrapper hash.

## 3.6 Reproducible sandbox

A capability must be reproducible from its manifest and lockfile.

## 3.7 Observable by default

Every invocation records:

- caller,
- agent,
- capability ID,
- version,
- duration,
- input metadata,
- output metadata,
- status,
- sandbox ID,
- policy decision,
- resource usage,
- trace ID.

## 3.8 Separate build-time trust from runtime trust

Passing static analysis does not imply unrestricted runtime access.

---

# 4. Proposed System Name

Internal subsystem name:

```text
Pao Capability Factory
```

Main modules:

```text
apps/capability-lab
packages/capability-core
packages/capability-registry
packages/capability-scanner
packages/capability-policy
packages/capability-sandbox
packages/capability-compiler
packages/capability-runtime
packages/capability-sdk-python
packages/capability-sdk-typescript
```

Optional command-line alias:

```bash
pao cap
```

---

# 5. Scope

## Included

- ingest local Python folders,
- ingest Git repositories,
- scan `.py` files,
- discover candidate functions/scripts,
- dependency inspection,
- static side-effect inspection,
- secret detection,
- license capture,
- manifest generation,
- risk scoring,
- policy engine,
- sandbox execution,
- test harness,
- adapter compiler,
- MCP adapter generation,
- Skill adapter generation,
- REST adapter generation,
- capability publishing,
- agent discovery,
- execution audit,
- versioning,
- rollback,
- deprecation,
- quarantine.

## Not included in this phase

- arbitrary kernel-level virtualization,
- unrestricted remote code execution,
- auto-publishing unknown code to production,
- auto-installing unreviewed native packages on host,
- privileged Docker socket exposure,
- unrestricted package post-install hooks,
- automatic billing for third-party APIs,
- autonomous secret creation.

---

# 6. Target Workflow

## 6.1 Import

```bash
pao cap import github \
  --repo https://github.com/qxresearch/qxresearch-event-1 \
  --ref main
```

or

```bash
pao cap import local ./recipes/pdf_merge
```

The importer creates an immutable source snapshot.

## 6.2 Analyze

```bash
pao cap analyze <source-id>
```

Analysis output:

```text
Source
Candidates
Dependencies
Imports
Entry points
Filesystem calls
Network calls
Subprocess calls
Environment access
Secrets indicators
Interactive / GUI requirements
Device requirements
License
Risk score
Recommended permissions
```

## 6.3 Build manifest

```bash
pao cap manifest generate <candidate-id>
```

## 6.4 Sandbox test

```bash
pao cap test <capability-id> --sandbox
```

## 6.5 Compile

```bash
pao cap compile <capability-id> --target mcp
pao cap compile <capability-id> --target skill
pao cap compile <capability-id> --target rest
```

## 6.6 Review

```bash
pao cap review <capability-id>
```

## 6.7 Publish

```bash
pao cap publish <capability-id> --channel stable
```

## 6.8 Invoke

```bash
pao cap run pdf.merge \
  --input '{"files":["a.pdf","b.pdf"]}'
```

---

# 7. Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                        Pao-hubPro UI                         │
│  Capability Lab / Registry / Policy / Runs / Review Queue   │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                      Capability API                          │
│ Import / Analyze / Build / Test / Compile / Publish / Run   │
└───────┬──────────────┬──────────────┬─────────────┬──────────┘
        │              │              │             │
        ▼              ▼              ▼             ▼
┌──────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐
│ Source Store │ │  Analyzer  │ │  Policy   │ │   Registry   │
└──────┬───────┘ └──────┬─────┘ └─────┬─────┘ └──────┬───────┘
       │                │             │              │
       └─────────┬──────┴──────┬──────┴──────────────┘
                 ▼             ▼
           ┌───────────┐  ┌───────────────┐
           │ Compiler  │  │ Sandbox Build │
           └─────┬─────┘  └───────┬───────┘
                 │                │
                 ▼                ▼
        ┌──────────────────────────────────────┐
        │       Capability Runtime Gateway     │
        │ MCP / Skill / REST / Agent Function │
        └─────────────────┬────────────────────┘
                          ▼
               ┌─────────────────────┐
               │ Audit + Observability│
               └─────────────────────┘
```

---

# 8. Capability Lifecycle

States:

```text
DISCOVERED
  ↓
ANALYZED
  ↓
MANIFESTED
  ↓
QUARANTINED
  ↓
TESTING
  ↓
REVIEW_REQUIRED
  ↓
APPROVED
  ↓
PUBLISHED
  ↓
DEPRECATED
  ↓
REVOKED
```

Possible alternate transitions:

```text
ANALYZED → REJECTED
TESTING → FAILED
PUBLISHED → QUARANTINED
PUBLISHED → REVOKED
```

Production agents may only invoke:

```text
PUBLISHED + enabled + policy-allowed
```

---

# 9. Capability Manifest

Every capability must have a canonical manifest.

Suggested path:

```text
capabilities/<namespace>/<name>/capability.yaml
```

Example:

```yaml
apiVersion: pao.dev/v1
kind: Capability

metadata:
  id: pdf.merge
  namespace: document
  name: Merge PDF
  version: 1.0.0
  description: Merge multiple PDF files into one output file.
  source:
    type: github
    repository: https://github.com/qxresearch/qxresearch-event-1
    ref: main
    commit: "<commit-sha>"
    path: "<original-path>"
  license:
    spdx: MIT
    attribution_required: true

runtime:
  language: python
  python: ">=3.11,<3.13"
  entrypoint: app.main:run
  timeout_seconds: 60
  cpu_limit: "1"
  memory_limit_mb: 512
  pids_limit: 64
  network_mode: none

inputs:
  type: object
  required:
    - files
  properties:
    files:
      type: array
      minItems: 2
      items:
        type: string
        format: workspace-file

outputs:
  type: object
  required:
    - output_file
  properties:
    output_file:
      type: string
      format: workspace-file

permissions:
  filesystem:
    workspace_read: true
    workspace_write: true
    host_read: false
    host_write: false
  network:
    enabled: false
  process:
    spawn: false
  secrets: []
  devices: []

risk:
  level: low
  score: 18
  reasons:
    - writes files inside sandbox workspace

policy:
  approval_required: false
  allowed_callers:
    - agent
    - user
    - workflow

adapters:
  mcp: true
  skill: true
  rest: true

observability:
  log_level: info
  trace: true
  capture_stdout: true
  capture_stderr: true
  redact_inputs: false

integrity:
  source_sha256: "..."
  wrapper_sha256: "..."
  lockfile_sha256: "..."
```

---

# 10. Recipe Registry

A recipe is pre-promotion source material.

Suggested fields:

```text
recipe_id
source_id
name
summary
language
path
candidate_entrypoint
candidate_type
imports
external_dependencies
side_effects
recommended_permissions
risk_score
status
created_at
updated_at
```

Candidate types:

```text
FUNCTION
CLI_SCRIPT
MODULE
HTTP_CLIENT
GUI_APP
MEDIA_PROCESSOR
FILE_TOOL
AUTOMATION
AI_TOOL
DATA_PIPELINE
DEVICE_TOOL
UNKNOWN
```

---

# 11. Capability Registry

The Capability Registry is the production contract layer.

Each registry record must expose:

```text
capability_id
namespace
name
version
status
channel
manifest
input_schema
output_schema
risk_level
permission_set
source_provenance
license
integrity hashes
adapter availability
runtime image
published_at
published_by
deprecation date
replacement capability
```

Channels:

```text
dev
candidate
stable
legacy
```

---

# 12. Static Analysis Pipeline

Analyzer should combine deterministic analyzers first and optionally LLM-assisted classification second.

## 12.1 AST analysis

Use Python AST to inspect:

- imports,
- function definitions,
- classes,
- decorators,
- calls,
- environment usage,
- file access,
- subprocess calls,
- shell=True,
- dynamic eval,
- exec,
- socket usage,
- HTTP clients,
- database clients,
- browser launch,
- GUI libraries,
- camera/mic libraries,
- credential SDKs.

## 12.2 Dependency analysis

Detect:

```text
requirements.txt
pyproject.toml
poetry.lock
Pipfile
setup.py
setup.cfg
conda environment files
```

Generate normalized dependency inventory.

## 12.3 Risk indicators

Examples:

```text
os.system
subprocess
pty
socket
requests
httpx
urllib
boto3
paramiko
fabric
ftplib
smtplib
imaplib
poplib
psutil
win32api
pyautogui
selenium
playwright
opencv camera
pyaudio
sounddevice
open()
pathlib.Path.write_*
shutil.rmtree
os.remove
os.unlink
os.rename
os.environ
keyring
eval
exec
pickle.loads
marshal.loads
ctypes
cffi
```

## 12.4 Dynamic import indicators

Flag:

```text
importlib
__import__
pkgutil
runpy
```

## 12.5 Secret indicators

Flag likely:

```text
API_KEY
TOKEN
PASSWORD
SECRET
PRIVATE_KEY
ACCESS_KEY
client_secret
Bearer
sk-
ghp_
```

Never store secret values in findings.

Only record:

```text
secret_type
file
line
fingerprint
severity
```

---

# 13. Risk Model

Recommended range:

```text
0-24     LOW
25-49    MEDIUM
50-74    HIGH
75-100   CRITICAL
```

Example weights:

| Signal | Weight |
|---|---:|
| Workspace read | +2 |
| Workspace write | +5 |
| Network outbound | +10 |
| Arbitrary network destination | +12 |
| Environment read | +8 |
| Secret access | +15 |
| Subprocess spawn | +15 |
| Shell execution | +25 |
| Host filesystem | +25 |
| Camera | +15 |
| Microphone | +15 |
| Browser automation | +12 |
| Device control | +20 |
| Destructive delete | +25 |
| Dynamic eval/exec | +30 |
| Privileged operation | +35 |

Risk is not only additive. Some combinations should trigger hard rules.

Example:

```text
shell + network + secrets = CRITICAL
```

---

# 14. Policy Engine

Use declarative policy rules.

Recommended policy namespace:

```text
capability.policy.*
```

Example policy:

```yaml
id: deny-critical-autopublish
priority: 100
match:
  risk.level:
    - critical
effect: deny
action:
  - capability.publish.autonomous
reason: Critical capabilities require human approval.
```

Example:

```yaml
id: medium-capability-review
priority: 80
match:
  risk.level:
    - medium
    - high
effect: require_approval
action:
  - capability.publish
```

Example runtime policy:

```yaml
id: network-domain-allowlist
priority: 95
match:
  permissions.network.enabled: true
effect: constrain
constraints:
  domain_allowlist_required: true
```

---

# 15. Permission Model

Canonical permissions:

```text
filesystem.workspace.read
filesystem.workspace.write
filesystem.temp.read
filesystem.temp.write
filesystem.host.read
filesystem.host.write

network.outbound
network.inbound
network.dns
network.domain:<domain>

process.spawn
process.shell

secrets.read:<secret-name>

device.camera
device.microphone
device.audio_output
device.screen_capture
device.android
device.usb

browser.read
browser.navigate
browser.interact
browser.download

email.read
email.send

clipboard.read
clipboard.write
```

Default permission set:

```text
NONE
```

---

# 16. Sandboxed Tool Runtime

The runtime must never execute imported code directly on the Pao-hubPro host by default.

Recommended first implementation:

```text
Docker / Podman isolated container
```

Container restrictions:

```text
non-root user
read-only root filesystem
no-new-privileges
cap-drop ALL
seccomp profile
pids limit
memory limit
CPU limit
execution timeout
network none by default
workspace-only mount
no Docker socket
no host /proc
no host home directory
no SSH agent forwarding
no cloud metadata endpoint access
```

Example execution:

```text
Runtime Gateway
  ↓
Policy decision
  ↓
Create ephemeral workspace
  ↓
Materialize input files
  ↓
Launch sandbox
  ↓
Run wrapper
  ↓
Capture output
  ↓
Validate schema
  ↓
Persist artifacts
  ↓
Destroy sandbox
```

---

# 17. Network Isolation

Modes:

```text
none
allowlist
proxy
unrestricted   # admin-only, discouraged
```

For allowlist mode:

```yaml
network:
  mode: allowlist
  destinations:
    - api.openai.com
```

All network-enabled runs must record:

```text
destination
protocol
port
bytes sent
bytes received
policy rule
```

---

# 18. Dependency Isolation

Every capability gets an isolated dependency environment.

Recommended build flow:

```text
source snapshot
  ↓
requirements detection
  ↓
normalization
  ↓
resolution
  ↓
lock
  ↓
SBOM
  ↓
container layer
```

Store:

```text
requirements.in
requirements.lock
sbom.json
image digest
```

Do not share mutable global Python environments.

---

# 19. Package Security

At minimum:

- reject direct `file://` dependency by default,
- flag Git URL dependencies,
- flag editable installs,
- flag unpinned dependencies in production,
- restrict package indexes,
- capture hashes,
- produce SBOM,
- optionally integrate vulnerability scanner.

Suggested future integrations:

```text
pip-audit
OSV Scanner
Trivy
Syft
Grype
```

---

# 20. Automated MCP Conversion

MCP compiler should generate:

```text
server registration
input schema
output schema
tool metadata
permission metadata
runtime proxy
error mapping
tracing hooks
```

Generated MCP adapter should NOT embed imported source directly.

Instead:

```text
MCP Tool
  ↓
Capability Runtime Gateway
  ↓
Registry version resolution
  ↓
Policy
  ↓
Sandbox
```

Example generated MCP tool metadata:

```json
{
  "name": "pdf.merge",
  "description": "Merge multiple PDF files into one PDF.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "files": {
        "type": "array",
        "items": {"type": "string"},
        "minItems": 2
      }
    },
    "required": ["files"]
  }
}
```

---

# 21. Automated Skill Conversion

Skill generation should produce a Skill wrapper with:

```text
skill.md
manifest metadata
examples
input constraints
runtime command
permission summary
failure modes
safety guidance
```

Suggested generated layout:

```text
skills/generated/pdf-merge/
├── skill.md
├── capability.yaml
├── examples/
└── tests/
```

Generated Skill must reference the registered capability rather than duplicating code.

---

# 22. REST Adapter

REST route example:

```text
POST /api/v1/capabilities/pdf.merge:invoke
```

Request:

```json
{
  "version": "1.0.0",
  "input": {
    "files": ["file-a", "file-b"]
  }
}
```

Response:

```json
{
  "run_id": "run_...",
  "status": "succeeded",
  "output": {
    "output_file": "artifact_..."
  },
  "trace_id": "trace_..."
}
```

---

# 23. Agent Tool Discovery

Agents should query the registry instead of receiving every capability automatically.

Example discovery:

```text
find capabilities for:
"merge multiple PDF documents"
```

Registry search returns:

```json
[
  {
    "id": "pdf.merge",
    "version": "1.0.0",
    "risk": "low",
    "description": "Merge multiple PDF files",
    "allowed": true
  }
]
```

Discovery ranking factors:

```text
semantic relevance
status
channel
risk
success rate
latency
policy eligibility
version freshness
user preference
```

---

# 24. Capability Invocation Contract

Common internal function:

```ts
invokeCapability({
  capabilityId,
  version,
  caller,
  agentId,
  workflowId,
  input,
  requestedPermissions,
  traceId,
})
```

Expected pipeline:

```text
resolve version
validate caller
load manifest
validate input
policy check
permission intersection
create run
start sandbox
invoke wrapper
capture logs
validate output
persist artifacts
update metrics
return result
```

---

# 25. Failure Taxonomy

Canonical error codes:

```text
CAPABILITY_NOT_FOUND
CAPABILITY_DISABLED
CAPABILITY_VERSION_NOT_FOUND
CAPABILITY_POLICY_DENIED
CAPABILITY_APPROVAL_REQUIRED
CAPABILITY_INPUT_INVALID
CAPABILITY_OUTPUT_INVALID
CAPABILITY_BUILD_FAILED
CAPABILITY_DEPENDENCY_FAILED
CAPABILITY_TIMEOUT
CAPABILITY_MEMORY_LIMIT
CAPABILITY_CPU_LIMIT
CAPABILITY_NETWORK_DENIED
CAPABILITY_PERMISSION_DENIED
CAPABILITY_RUNTIME_FAILED
CAPABILITY_SANDBOX_FAILED
CAPABILITY_ARTIFACT_FAILED
CAPABILITY_QUARANTINED
CAPABILITY_REVOKED
```

---

# 26. Database Schema

Use the project database conventions already present in Pao-hubPro.

If PostgreSQL is present, use PostgreSQL.

Suggested tables below.

## `capability_sources`

```sql
CREATE TABLE capability_sources (
  id UUID PRIMARY KEY,
  source_type VARCHAR(32) NOT NULL,
  repository_url TEXT,
  source_ref TEXT,
  commit_sha VARCHAR(128),
  local_path TEXT,
  snapshot_uri TEXT,
  source_sha256 VARCHAR(64) NOT NULL,
  license_spdx VARCHAR(64),
  imported_by TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

## `capability_recipes`

```sql
CREATE TABLE capability_recipes (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES capability_sources(id),
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  entrypoint TEXT,
  candidate_type VARCHAR(64) NOT NULL,
  summary TEXT,
  status VARCHAR(32) NOT NULL,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_score INT,
  risk_level VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## `capabilities`

```sql
CREATE TABLE capabilities (
  id UUID PRIMARY KEY,
  capability_key TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status VARCHAR(32) NOT NULL,
  default_channel VARCHAR(32) NOT NULL DEFAULT 'dev',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## `capability_versions`

```sql
CREATE TABLE capability_versions (
  id UUID PRIMARY KEY,
  capability_id UUID NOT NULL REFERENCES capabilities(id),
  recipe_id UUID REFERENCES capability_recipes(id),
  version VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  manifest JSONB NOT NULL,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  permissions JSONB NOT NULL,
  risk JSONB NOT NULL,
  source_sha256 VARCHAR(64) NOT NULL,
  wrapper_sha256 VARCHAR(64) NOT NULL,
  lockfile_sha256 VARCHAR(64),
  runtime_image_digest TEXT,
  published_by TEXT,
  published_at TIMESTAMPTZ,
  deprecated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE(capability_id, version)
);
```

## `capability_adapters`

```sql
CREATE TABLE capability_adapters (
  id UUID PRIMARY KEY,
  capability_version_id UUID NOT NULL REFERENCES capability_versions(id),
  adapter_type VARCHAR(32) NOT NULL,
  adapter_config JSONB NOT NULL,
  generated_path TEXT,
  generated_sha256 VARCHAR(64),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capability_version_id, adapter_type)
);
```

## `capability_permissions`

```sql
CREATE TABLE capability_permissions (
  id UUID PRIMARY KEY,
  capability_version_id UUID NOT NULL REFERENCES capability_versions(id),
  permission TEXT NOT NULL,
  constraint_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capability_version_id, permission)
);
```

## `capability_policy_rules`

```sql
CREATE TABLE capability_policy_rules (
  id UUID PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  effect VARCHAR(32) NOT NULL,
  rule JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## `capability_reviews`

```sql
CREATE TABLE capability_reviews (
  id UUID PRIMARY KEY,
  capability_version_id UUID NOT NULL REFERENCES capability_versions(id),
  reviewer_type VARCHAR(32) NOT NULL,
  reviewer_id TEXT,
  decision VARCHAR(32) NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## `capability_runs`

```sql
CREATE TABLE capability_runs (
  id UUID PRIMARY KEY,
  capability_version_id UUID NOT NULL REFERENCES capability_versions(id),
  caller_type VARCHAR(32) NOT NULL,
  caller_id TEXT,
  agent_id TEXT,
  workflow_id TEXT,
  trace_id TEXT,
  sandbox_id TEXT,
  status VARCHAR(32) NOT NULL,
  policy_decision JSONB,
  input_meta JSONB,
  output_meta JSONB,
  resource_usage JSONB,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
```

## `capability_artifacts`

```sql
CREATE TABLE capability_artifacts (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES capability_runs(id),
  artifact_type VARCHAR(32) NOT NULL,
  name TEXT,
  uri TEXT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  size_bytes BIGINT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 27. API Surface

Suggested API endpoints:

```text
POST   /api/v1/capability-sources/import/github
POST   /api/v1/capability-sources/import/local
GET    /api/v1/capability-sources
GET    /api/v1/capability-sources/:id

POST   /api/v1/capability-sources/:id/analyze
GET    /api/v1/capability-recipes
GET    /api/v1/capability-recipes/:id
POST   /api/v1/capability-recipes/:id/manifest
POST   /api/v1/capability-recipes/:id/test

GET    /api/v1/capabilities
POST   /api/v1/capabilities
GET    /api/v1/capabilities/:key
GET    /api/v1/capabilities/:key/versions
POST   /api/v1/capabilities/:key/compile
POST   /api/v1/capabilities/:key/review
POST   /api/v1/capabilities/:key/publish
POST   /api/v1/capabilities/:key/deprecate
POST   /api/v1/capabilities/:key/revoke
POST   /api/v1/capabilities/:key/invoke

GET    /api/v1/capability-runs
GET    /api/v1/capability-runs/:id
GET    /api/v1/capability-runs/:id/logs
GET    /api/v1/capability-runs/:id/artifacts

GET    /api/v1/capability-policy
POST   /api/v1/capability-policy
PATCH  /api/v1/capability-policy/:id
```

---

# 28. UI — Capability Lab

Create a new Pao-hubPro navigation item:

```text
Capabilities
```

Subpages:

```text
Overview
Sources
Recipes
Registry
Review Queue
Policies
Runs
Artifacts
Settings
```

---

# 29. UI — Overview

Cards:

```text
Sources imported
Recipes discovered
Capabilities published
Awaiting review
Quarantined
Failed builds
Runs today
Success rate
```

Charts:

```text
runs by capability
runs by risk
failure rate
median latency
sandbox resource usage
publish activity
```

---

# 30. UI — Source Detail

Display:

```text
Repository URL
Ref
Commit
License
Snapshot hash
Import time
Importer
Files
Detected Python version
Dependency files
Candidate recipe count
Findings
```

Actions:

```text
Re-analyze
Create snapshot
Compare source revision
Archive
```

---

# 31. UI — Recipe Detail

Panels:

```text
Summary
Entrypoint
Imports
Dependencies
Side effects
Permissions
Risk
Secrets findings
License
Source code preview
Generated manifest preview
Tests
```

Actions:

```text
Generate manifest
Edit manifest
Run sandbox test
Compile adapter
Send to review
Reject
```

---

# 32. UI — Registry Detail

Display:

```text
Capability ID
Description
Version
Channel
Status
Risk
Permissions
Input schema
Output schema
Adapters
Source provenance
Integrity hashes
Usage metrics
Recent runs
Reviews
```

Buttons:

```text
Invoke
Test
Promote
Deprecate
Disable
Revoke
Rollback
```

---

# 33. UI — Review Queue

Reviewer sees:

```text
Source provenance
Static findings
Risk score
Permission diff
Dependency diff
Generated wrapper diff
Test results
Network requirements
Secret requirements
License
```

Decisions:

```text
Approve
Approve with constraints
Request changes
Reject
Quarantine
```

---

# 34. Automated Test Generation

For each capability generate:

```text
manifest validation test
input schema test
output schema test
smoke test
sandbox isolation test
permission-denied test
timeout test
invalid input test
artifact integrity test
MCP contract test
REST contract test
```

Where feasible also generate property tests.

---

# 35. Sandbox Escape Tests

Add negative tests:

```text
cannot read host /etc/passwd
cannot read host HOME
cannot access Docker socket
cannot write outside workspace
cannot reach network when network=none
cannot spawn shell when process.shell=false
cannot access arbitrary env secrets
cannot exceed pids limit
cannot persist processes after run
```

---

# 36. License and Attribution

Every source import must detect and store license evidence.

For MIT-derived capability, retain attribution in:

```text
capability provenance
generated NOTICES
source metadata
build artifacts
```

If license is unknown:

```text
license.status = UNKNOWN
publish = blocked by default
```

If license conflicts with project policy:

```text
publish = denied
```

---

# 37. Source Update / Drift Detection

Add source refresh job:

```text
source repository
  ↓
latest selected ref
  ↓
compare commit
  ↓
identify changed recipes
  ↓
re-analyze
  ↓
produce compatibility report
```

Never silently upgrade a published capability.

New source revision must result in a new candidate capability version.

---

# 38. Capability Versioning

Use SemVer where practical.

Rules:

```text
PATCH
implementation change without contract change

MINOR
backward-compatible input/output addition

MAJOR
breaking contract or permission change
```

Any new permission should force explicit review even if the semantic version is minor or patch.

---

# 39. Integrity Model

Hash:

```text
source snapshot
selected source files
manifest
wrapper
lockfile
SBOM
runtime image
```

At runtime verify expected digests before execution.

---

# 40. Quarantine Model

A capability enters quarantine when:

```text
unexpected permission use
integrity mismatch
sandbox failure
malware/secret finding
source provenance mismatch
policy violation
unexpected network destination
output contract repeated failures
manual security action
```

Quarantined capabilities cannot be invoked by agents.

---

# 41. Observability

Emit metrics:

```text
capability_runs_total
capability_run_failures_total
capability_run_duration_seconds
capability_sandbox_start_seconds
capability_cpu_seconds
capability_memory_peak_bytes
capability_network_bytes
capability_artifact_bytes
capability_policy_denials_total
capability_reviews_total
capability_quarantines_total
```

Structured log example:

```json
{
  "event": "capability.run.completed",
  "run_id": "run_123",
  "capability": "pdf.merge",
  "version": "1.0.0",
  "status": "succeeded",
  "duration_ms": 942,
  "trace_id": "trace_abc"
}
```

---

# 42. Audit Events

Emit audit events for:

```text
source.imported
source.analyzed
recipe.discovered
manifest.generated
manifest.updated
sandbox.test.started
sandbox.test.completed
capability.created
capability.compiled
capability.reviewed
capability.approved
capability.published
capability.invoked
capability.failed
capability.deprecated
capability.revoked
capability.quarantined
policy.created
policy.updated
```

---

# 43. AI-Assisted Analysis

LLM can help with:

```text
summarizing source
identifying intended inputs/outputs
suggesting tool names
writing descriptions
generating schemas
writing tests
explaining risks
suggesting permission set
creating wrappers
```

LLM must not be authoritative for:

```text
security approval
license determination
permission enforcement
runtime isolation
integrity verification
```

Deterministic controls remain authoritative.

---

# 44. Reviewer Council Integration

If Pao-hubPro already has Reviewer Council / Second Opinion Engine, integrate capability review.

Suggested reviewers:

```text
Security Reviewer
Runtime Reviewer
API Contract Reviewer
License Reviewer
Agent UX Reviewer
```

Review output:

```json
{
  "decision": "approve_with_constraints",
  "risk": "medium",
  "required_changes": [],
  "constraints": [
    "network allowlist only"
  ]
}
```

Human approval remains required where configured.

---

# 45. GitHub Ingestion

Do not execute repository scripts during discovery.

Safe import flow:

```text
fetch metadata
clone/fetch source snapshot
resolve selected commit
read source files
read dependency files
read LICENSE
calculate hashes
static analyze
```

Never run:

```text
setup.py
Makefile
install scripts
post-install hooks
repository bootstrap scripts
```

until sandbox stage.

---

# 46. qxresearch Seed Import

Use qxresearch repository as a seed corpus.

Do not promise exact recipe count because repository can evolve.

Importer should:

1. snapshot the selected commit,
2. discover Python mini-app directories/files,
3. create one or more recipe candidates,
4. classify each candidate,
5. flag interactive GUI apps separately,
6. detect API-key requirements,
7. detect local-device requirements,
8. recommend whether each recipe is:

```text
GOOD_CANDIDATE
NEEDS_REFACTOR
INTERACTIVE_ONLY
DEVICE_BOUND
UNSAFE
DUPLICATE
IGNORE
```

---

# 47. Seed Capability Categories

Suggested initial categories:

```text
document
image
audio
video
web
automation
notification
system
text
data
ai
vector
email
utility
```

---

# 48. Initial Promotion Targets

Prefer low-risk, deterministic utilities first.

Good first targets:

```text
file metadata reader
PDF merge
text transformation
image format conversion
audio extraction
checksum utility
archive creation
simple calendar/date helpers
safe local text utilities
```

Avoid auto-promoting first:

```text
email sending
browser automation
system notification with host integration
camera
microphone
OS automation
shell-based utilities
credential-dependent tools
unrestricted web scraping
```

---

# 49. Wrapper Standard

Python wrapper contract:

```python
from pao_capability import capability, CapabilityContext

@capability("pdf.merge")
def run(input: dict, ctx: CapabilityContext) -> dict:
    files = input["files"]

    output_path = ctx.workspace / "merged.pdf"

    # imported/refactored recipe logic

    return {
        "output_file": ctx.artifacts.register(output_path)
    }
```

The wrapper must use Pao SDK helpers instead of direct host integrations where possible.

---

# 50. Capability SDK

Python SDK should include:

```text
CapabilityContext
workspace helper
artifact helper
logger
trace helper
secret accessor
network client wrapper
policy-aware subprocess helper
validation helpers
```

Example:

```python
api_key = ctx.secrets.get("openai")
```

instead of:

```python
os.environ["OPENAI_API_KEY"]
```

---

# 51. Artifact Handling

All output files leave the sandbox through an artifact broker.

Flow:

```text
sandbox output path
  ↓
size / mime validation
  ↓
sha256
  ↓
malware scan hook
  ↓
artifact storage
  ↓
artifact ID
```

Never expose arbitrary sandbox host paths to agents.

---

# 52. Secrets Broker

Capabilities never receive the full application environment.

They request named secrets.

Example:

```yaml
permissions:
  secrets:
    - name: openai_api_key
      purpose: summarization
```

Runtime injects only explicitly approved secrets.

Audit records secret name, not value.

---

# 53. User Approval Flow

For high-impact capabilities:

```text
Agent requests capability
  ↓
Policy says approval required
  ↓
UI shows:
  - requested action
  - capability
  - permissions
  - destination
  - affected resources
  ↓
User approves / denies
  ↓
single-use approval token
  ↓
run
```

---

# 54. MCP Tool Naming

Use deterministic names.

Format:

```text
<namespace>.<verb>
```

Examples:

```text
pdf.merge
image.convert
media.extract_audio
text.summarize
web.extract_text
file.hash
archive.create
```

Avoid repository-specific tool names.

---

# 55. Capability Search

Support filters:

```text
text
namespace
status
risk
permission
source repository
license
adapter type
channel
version
```

Semantic search can be added using the project's existing embedding/vector infrastructure if available.

---

# 56. Local-First Behavior

Core functionality must work without an external AI provider:

```text
source import
AST analysis
risk rules
manifest validation
sandbox build
registry
runtime
policy
MCP adapter
REST adapter
```

LLM augmentation is optional.

---

# 57. CLI

Implement:

```bash
pao cap source import
pao cap source list
pao cap source inspect
pao cap source analyze

pao cap recipe list
pao cap recipe inspect
pao cap recipe manifest

pao cap build
pao cap test
pao cap compile
pao cap review
pao cap publish
pao cap deprecate
pao cap revoke
pao cap quarantine

pao cap list
pao cap inspect
pao cap run
pao cap logs
pao cap artifacts

pao cap policy list
pao cap policy test
```

Support JSON output:

```bash
pao cap list --json
```

---

# 58. Suggested Monorepo Structure

Codex must first inspect the actual repository and adapt this layout to current conventions.

Do not create duplicate infrastructure if equivalents already exist.

Target conceptual structure:

```text
apps/
└── capability-lab/
    ├── app/
    ├── components/
    ├── pages/
    └── lib/

packages/
├── capability-core/
│   ├── src/
│   │   ├── types/
│   │   ├── schemas/
│   │   ├── errors/
│   │   └── lifecycle/
│   └── tests/
│
├── capability-scanner/
│   ├── src/
│   │   ├── python/
│   │   ├── dependency/
│   │   ├── license/
│   │   ├── secret/
│   │   └── risk/
│   └── tests/
│
├── capability-policy/
│   ├── src/
│   └── tests/
│
├── capability-registry/
│   ├── src/
│   └── tests/
│
├── capability-sandbox/
│   ├── src/
│   ├── images/
│   ├── profiles/
│   └── tests/
│
├── capability-compiler/
│   ├── src/
│   │   ├── mcp/
│   │   ├── skill/
│   │   ├── rest/
│   │   └── wrapper/
│   └── tests/
│
├── capability-runtime/
│   ├── src/
│   └── tests/
│
├── capability-sdk-python/
│   └── pao_capability/
│
└── capability-sdk-typescript/
    └── src/

services/
└── capability-worker/

migrations/
└── <phase-20.56 migrations>

docs/
└── capability-lab/
    ├── architecture.md
    ├── manifest.md
    ├── policy.md
    ├── sandbox.md
    ├── mcp-compiler.md
    └── operations.md
```

---

# 59. Background Worker

Long operations should use the project job system if one exists.

Jobs:

```text
SOURCE_IMPORT
SOURCE_ANALYZE
RECIPE_ANALYZE
SANDBOX_BUILD
CAPABILITY_TEST
CAPABILITY_COMPILE
CAPABILITY_PUBLISH
SOURCE_DRIFT_SCAN
```

If there is no worker infrastructure, add a minimal durable queue compatible with the current stack.

Do not create a second queue system if Pao-hubPro already has one.

---

# 60. Event Bus

Emit events compatible with existing Pao-hubPro event infrastructure.

Suggested events:

```text
capability.source.imported
capability.recipe.discovered
capability.analysis.completed
capability.test.completed
capability.review.requested
capability.review.completed
capability.published
capability.run.started
capability.run.completed
capability.run.failed
capability.quarantined
```

---

# 61. Security Requirements

Mandatory:

- No direct host execution for imported code by default.
- No Docker socket mounted into capability sandbox.
- No secrets copied into logs.
- No production publish of unknown-license code by default.
- No automatic privilege escalation.
- No automatic network enablement.
- No arbitrary host filesystem mounts.
- No auto-approval based only on LLM output.
- No source code mutation during immutable version execution.
- No hidden fallback to host execution if sandbox unavailable.

If the sandbox cannot start:

```text
FAIL CLOSED
```

---

# 62. Privacy Requirements

- Minimize persisted input/output payload content.
- Prefer metadata and hashes in run logs.
- Allow manifests to mark input/output fields as sensitive.
- Redact configured fields before logging.
- Do not persist secret values.
- Provide retention configuration for logs and artifacts.

---

# 63. Performance Targets

Initial targets:

```text
registry lookup p95       < 100 ms
policy decision p95       < 100 ms
warm sandbox startup      < 2 s where feasible
cold sandbox startup      < 10 s where feasible
low-risk utility overhead < 25% above direct execution where practical
```

Do not compromise isolation to meet latency targets.

---

# 64. Caching

Allowed caches:

```text
source snapshots
dependency resolution
container image layers
static analysis
manifest generation
adapter generation
semantic embeddings
```

Never cache secrets.

Runtime output caching must be opt-in and capability-specific.

---

# 65. Backward Compatibility

Phase 20.56 must not break existing Pao-hubPro MCP, agent, workflow, or tool systems.

Use adapters.

Existing tools should continue to work.

Capability Registry is an additional control plane.

Future migration may wrap legacy tools as capabilities, but not as a forced migration in this phase.

---

# 66. Migration Strategy

## Step 1

Add schema and core types.

## Step 2

Add source importer + scanner.

## Step 3

Add registry + manifest validation.

## Step 4

Add sandbox.

## Step 5

Add runtime gateway.

## Step 6

Add MCP compiler.

## Step 7

Add Skill compiler.

## Step 8

Add UI.

## Step 9

Seed qxresearch source import.

## Step 10

Promote 2-5 low-risk example capabilities.

---

# 67. Seed Demonstration

The implementation must include at least three demo capabilities.

Recommended:

```text
file.hash
text.normalize
pdf.merge
```

If PDF dependencies are unavailable in the current environment, replace `pdf.merge` with another low-risk deterministic utility.

At least one demo must originate from or be inspired by the qxresearch seed import so the full provenance pipeline is exercised.

---

# 68. Test Matrix

## Unit

- manifest validator
- AST analyzer
- dependency parser
- permission inference
- risk engine
- policy engine
- version resolver
- schema validator
- hash utility

## Integration

- source import → recipe
- recipe → manifest
- manifest → sandbox
- sandbox → artifact
- manifest → MCP
- MCP → runtime gateway
- runtime → audit
- policy denial
- approval required
- quarantine

## End-to-end

```text
Import qxresearch
→ discover candidate
→ generate manifest
→ run sandbox test
→ review
→ publish
→ discover from agent
→ invoke
→ produce artifact
→ inspect trace
```

---

# 69. Acceptance Checklist

Phase 20.56 is complete only when ALL applicable items pass.

## Source ingestion

- [ ] GitHub repository import works.
- [ ] Local source import works.
- [ ] Source commit/ref is persisted.
- [ ] Source snapshot hash is persisted.
- [ ] License evidence is stored.
- [ ] Import does not execute repository code.

## Discovery / analysis

- [ ] Python candidate discovery works.
- [ ] AST import detection works.
- [ ] subprocess/shell detection works.
- [ ] network library detection works.
- [ ] environment access detection works.
- [ ] file side-effect detection works.
- [ ] secret indicators are detected without storing secret values.
- [ ] dependency files are parsed.
- [ ] risk score is generated.
- [ ] recommended permissions are generated.

## Manifest

- [ ] Canonical manifest schema exists.
- [ ] Invalid manifests are rejected.
- [ ] Input/output JSON Schema is validated.
- [ ] permission set is explicit.
- [ ] source provenance is present.
- [ ] integrity hashes are present.

## Sandbox

- [ ] Capability runs as non-root.
- [ ] root filesystem is read-only where supported.
- [ ] workspace is isolated.
- [ ] network is disabled by default.
- [ ] no Docker socket exposure.
- [ ] timeout is enforced.
- [ ] memory limit is enforced.
- [ ] CPU/resource limits are configured.
- [ ] run workspace is cleaned after execution.

## Policy

- [ ] Default-deny policy exists.
- [ ] high/critical risk approval works.
- [ ] unauthorized permission request is denied.
- [ ] policy decisions are audited.
- [ ] capability can be quarantined.
- [ ] revoked capability cannot execute.

## Registry

- [ ] Capability registry API works.
- [ ] versions are immutable.
- [ ] channels work.
- [ ] deprecation works.
- [ ] rollback/version selection works.
- [ ] provenance can be inspected.

## Compiler

- [ ] MCP adapter generation works.
- [ ] generated MCP tool calls Runtime Gateway, not raw source.
- [ ] Skill adapter generation works.
- [ ] REST invocation works.
- [ ] generated artifacts are hashed.

## Runtime

- [ ] input schema validation works.
- [ ] output schema validation works.
- [ ] artifact broker works.
- [ ] run status is persisted.
- [ ] trace ID is propagated.
- [ ] failure codes are normalized.

## UI

- [ ] Capability navigation exists.
- [ ] Sources page works.
- [ ] Recipes page works.
- [ ] Registry page works.
- [ ] Review Queue works.
- [ ] Policies page works.
- [ ] Runs page works.
- [ ] user can inspect permissions and risk before publish.

## Observability

- [ ] structured logs exist.
- [ ] run metrics exist.
- [ ] policy denial metrics exist.
- [ ] audit events exist.
- [ ] no secret values appear in logs.

## Demo

- [ ] qxresearch seed repository can be imported.
- [ ] at least one candidate from seed corpus reaches sandbox testing.
- [ ] at least three demo capabilities are available.
- [ ] at least one demo can be invoked through MCP.
- [ ] at least one demo produces an artifact.

## Quality

- [ ] lint passes.
- [ ] type check passes.
- [ ] unit tests pass.
- [ ] integration tests pass.
- [ ] existing tests remain green.
- [ ] documentation is added.
- [ ] no placeholder-only implementation remains in core path.

---

# 70. Definition of Done

The phase is done when Pao-hubPro can take a small Python recipe from a source repository, analyze it, build a manifest, determine risk and permissions, test it in isolation, compile it into an agent-callable adapter, publish an immutable approved version, and invoke it through the normal Pao-hubPro runtime with full policy enforcement and auditability.

The implementation must prove this using the qxresearch repository as a seed source, without coupling the subsystem specifically to qxresearch.

---

# 71. Non-Negotiable Engineering Rules

1. Inspect the existing Pao-hubPro repository before changing architecture.
2. Reuse existing database, auth, queue, event bus, MCP, logging, tracing, UI, and policy infrastructure where possible.
3. Do not duplicate an existing subsystem just because this document suggests a package name.
4. Keep new abstractions minimal and composable.
5. Keep source-derived code isolated from control-plane code.
6. Do not run imported code on the host by default.
7. Keep default-deny permissions.
8. Fail closed.
9. Do not weaken existing security to make demos pass.
10. Add tests before declaring completion.
11. Preserve backward compatibility.
12. Document all configuration and environment variables.
13. Avoid hard-coded source repository assumptions.
14. Never commit real secrets.
15. Do not silently ignore failed security checks.

---

# 72. Suggested Environment Variables

Adapt names to existing project conventions.

```env
PAO_CAPABILITY_ENABLED=true
PAO_CAPABILITY_SOURCE_DIR=./data/capability-sources
PAO_CAPABILITY_ARTIFACT_DIR=./data/capability-artifacts
PAO_CAPABILITY_SANDBOX_BACKEND=docker
PAO_CAPABILITY_DEFAULT_NETWORK_MODE=none
PAO_CAPABILITY_DEFAULT_TIMEOUT_SECONDS=60
PAO_CAPABILITY_DEFAULT_MEMORY_MB=512
PAO_CAPABILITY_MAX_ARTIFACT_MB=100
PAO_CAPABILITY_REQUIRE_LICENSE=true
PAO_CAPABILITY_REQUIRE_REVIEW_HIGH_RISK=true
PAO_CAPABILITY_REQUIRE_REVIEW_CRITICAL_RISK=true
```

Do not invent parallel configuration mechanisms if a central config service already exists.

---

# 73. Operational Runbook

Document:

```text
how to import a source
how to inspect findings
how to edit a manifest
how to test in sandbox
how to approve/reject
how to publish
how to invoke
how to inspect logs
how to quarantine
how to revoke
how to roll back
how to update a source
how to clean old sandboxes
how to clean build caches
```

---

# 74. Future Extensions

Explicitly leave extension points for future phases:

```text
JavaScript / TypeScript recipe ingestion
Rust/WASM capability runtime
WASI sandbox
Firecracker microVM backend
gVisor backend
remote sandbox pool
GPU capability runtime
Android capability adapter
browser capability adapter
GUI automation capability
capability marketplace
organization trust policies
signed publisher identities
capability signatures
remote attestation
reputation scoring
usage-based cost model
AI-selected tool composition
automatic workflow synthesis
capability dependency graph
self-healing adapter regeneration
```

---

# 75. One-Shot Codex Implementation Prompt

Copy everything inside the following block and give it to Codex from the root of the Pao-hubPro repository.

```text
You are implementing Phase 20.56 in my existing Pao-hubPro repository.

PHASE NAME
Phase 20.56 — Pao-hubPro × qxresearch Micro-App Capability Lab — Python Recipe Registry, Sandboxed Tool Runtime, Automated MCP Skill Conversion & Policy-Governed Capability Factory

MISSION
Build a generic Capability Factory that can ingest small Python utilities from GitHub or local source, discover candidate recipes, statically analyze them, infer permissions and risk, generate capability manifests, run them inside an isolated sandbox, compile approved capabilities into MCP/Skill/REST adapters, publish immutable versions into a Capability Registry, and allow Pao-hubPro agents/workflows/users to invoke them through a policy-governed Runtime Gateway.

Use https://github.com/qxresearch/qxresearch-event-1 only as a seed corpus and demonstration source. Do NOT couple the architecture specifically to qxresearch.

IMPORTANT EXECUTION RULE
Do not ask me for routine confirmation. Inspect the repository, infer the current architecture, create a concrete implementation plan, and implement the phase end-to-end. If the repository differs from assumptions below, adapt to the real codebase while preserving the phase goals.

BEFORE WRITING CODE
1. Inspect repository structure.
2. Identify framework, package manager, database/ORM, migration system, auth model, job queue, event bus, MCP implementation, agent registry, tool registry, tracing, logging, test stack, UI stack, config system, and container tooling.
3. Reuse existing infrastructure wherever possible.
4. Search for existing concepts named tool, capability, skill, registry, permission, policy, sandbox, artifact, run, job, audit, MCP, executor, worker, or plugin.
5. Do not create duplicate subsystems if equivalent infrastructure exists.
6. Produce a short internal implementation map, then proceed.

NON-NEGOTIABLE SECURITY
- Imported code must not execute directly on the host by default.
- Sandbox must run non-root.
- Drop Linux capabilities where supported.
- No Docker socket in sandbox.
- Default network mode is none.
- Default permission model is deny-all.
- No host home directory mounts.
- No implicit secrets injection.
- No hidden host-execution fallback.
- Sandbox failure must fail closed.
- LLM output cannot authorize security decisions.
- Unknown license blocks production publishing by default.
- Every published version must be immutable.
- Every run must be auditable.

IMPLEMENT THESE DOMAIN OBJECTS
- CapabilitySource
- CapabilityRecipe
- Capability
- CapabilityVersion
- CapabilityAdapter
- CapabilityPermission
- CapabilityPolicyRule
- CapabilityReview
- CapabilityRun
- CapabilityArtifact

CAPABILITY LIFECYCLE
DISCOVERED
ANALYZED
MANIFESTED
QUARANTINED
TESTING
REVIEW_REQUIRED
APPROVED
PUBLISHED
DEPRECATED
REVOKED
FAILED
REJECTED

SOURCE INGESTION
Support:
1. GitHub/Git repository URL + ref.
2. Local directory source.

For source imports persist:
- source type
- repo URL
- ref
- resolved commit SHA
- snapshot location
- SHA-256
- license metadata
- importer
- timestamp

Do not execute source during import.

PYTHON ANALYZER
Build deterministic Python static analysis using AST and file/dependency inspection.
Detect at least:
- imports
- functions/classes
- candidate entrypoints
- requirements.txt
- pyproject.toml
- setup.py/setup.cfg
- Pipfile
- conda env files where easy
- filesystem access
- subprocess
- shell execution
- os.system
- eval/exec
- environment access
- HTTP/network libraries
- sockets
- browser automation
- camera/microphone libraries
- GUI-only libraries
- destructive file operations
- credential/secret access patterns
- dynamic imports

Never store discovered secret values. Store only finding type, location, severity, and fingerprint.

RISK MODEL
Implement risk score 0-100 and levels:
0-24 LOW
25-49 MEDIUM
50-74 HIGH
75-100 CRITICAL

Use deterministic signals and allow hard-rule escalation.
Examples:
- workspace read +2
- workspace write +5
- network +10
- arbitrary destination +12
- env read +8
- secret access +15
- subprocess +15
- shell +25
- host filesystem +25
- device access +15 to +20
- destructive delete +25
- eval/exec +30
- privileged operation +35
- shell + network + secrets should become CRITICAL

PERMISSION MODEL
Support canonical permissions or map them into the existing project model:
filesystem.workspace.read
filesystem.workspace.write
filesystem.temp.read
filesystem.temp.write
filesystem.host.read
filesystem.host.write
network.outbound
network.inbound
network.dns
network.domain:<domain>
process.spawn
process.shell
secrets.read:<name>
device.camera
device.microphone
device.audio_output
device.screen_capture
device.android
device.usb
browser.read
browser.navigate
browser.interact
browser.download
email.read
email.send
clipboard.read
clipboard.write

MANIFEST
Implement a versioned canonical manifest schema similar to:
apiVersion: pao.dev/v1
kind: Capability
metadata:
  id
  namespace
  name
  version
  description
  source provenance
  license
runtime:
  language
  python version
  entrypoint
  timeout
  cpu
  memory
  network mode
inputs: JSON Schema
outputs: JSON Schema
permissions
risk
policy
adapters
observability
integrity hashes

Store/validate manifests using strict schema validation.

SANDBOX
Implement the best sandbox backend supported by the current repo/environment, initially Docker or Podman if available.
Required isolation:
- non-root
- read-only root filesystem where practical
- no-new-privileges
- cap-drop ALL
- pids limit
- CPU limit
- memory limit
- execution timeout
- default network none
- workspace-only mount
- no Docker socket
- no host HOME
- ephemeral run workspace

Add negative isolation tests.

DEPENDENCIES
- isolate per capability/version
- create deterministic lock where feasible
- hash lockfile
- generate SBOM hook/structure
- do not use a mutable shared global Python environment
- flag Git dependencies, editable installs, unpinned production dependencies

POLICY ENGINE
Reuse an existing policy engine if present; otherwise implement a small declarative policy layer.
Must support:
- allow
- deny
- require_approval
- constrain

Seed rules:
- deny autonomous publishing of CRITICAL capabilities
- require approval for HIGH/CRITICAL publishing
- require explicit allowlist for networked capabilities
- block unknown license in stable channel
- deny capabilities requesting undeclared runtime permissions

REVIEW
Create a review record and UI/API flow.
Decisions:
- approve
- approve_with_constraints
- request_changes
- reject
- quarantine

If a reviewer council exists, integrate it as advisory reviewers but do not let LLM reviewers override deterministic policy/human gates.

CAPABILITY REGISTRY
Implement searchable registry with:
- capability key
- namespace
- name
- description
- status
- versions
- channels: dev/candidate/stable/legacy
- risk
- permissions
- input/output schema
- adapters
- provenance
- license
- integrity hashes
- usage metrics
- deprecation/replacement metadata

Versions must be immutable.

RUNTIME GATEWAY
Create one canonical invocation path.
Pseudo flow:
resolve capability/version
validate input
load manifest
policy evaluation
permission intersection
create run record
create ephemeral workspace
materialize inputs
start sandbox
invoke wrapper
capture stdout/stderr
validate output
register artifacts
collect resource usage
write metrics/audit
clean sandbox
return result

Never let MCP/Skill/REST wrappers bypass this gateway.

NORMALIZED ERRORS
Implement or map:
CAPABILITY_NOT_FOUND
CAPABILITY_DISABLED
CAPABILITY_VERSION_NOT_FOUND
CAPABILITY_POLICY_DENIED
CAPABILITY_APPROVAL_REQUIRED
CAPABILITY_INPUT_INVALID
CAPABILITY_OUTPUT_INVALID
CAPABILITY_BUILD_FAILED
CAPABILITY_DEPENDENCY_FAILED
CAPABILITY_TIMEOUT
CAPABILITY_MEMORY_LIMIT
CAPABILITY_CPU_LIMIT
CAPABILITY_NETWORK_DENIED
CAPABILITY_PERMISSION_DENIED
CAPABILITY_RUNTIME_FAILED
CAPABILITY_SANDBOX_FAILED
CAPABILITY_ARTIFACT_FAILED
CAPABILITY_QUARANTINED
CAPABILITY_REVOKED

ARTIFACT BROKER
Output files must pass through an artifact broker.
For each artifact store:
- artifact ID
- run ID
- type
- name
- URI/path in approved storage
- SHA-256
- size
- MIME type

Do not expose arbitrary sandbox filesystem paths to callers.

SECRETS
Capabilities request named secrets through the runtime context.
Do not inject the application's full environment.
Audit secret names only, never values.

CAPABILITY SDK
Add a minimal Python SDK/wrapper API.
Conceptually:
@capability("pdf.merge")
def run(input, ctx): ...

ctx should expose policy-aware helpers for:
- workspace
- artifacts
- logging
- trace
- secrets
- optional restricted network client
- optional restricted subprocess helper

MCP COMPILER
Generate MCP tool adapter metadata and wiring from approved manifests.
MCP tool invocation MUST call Runtime Gateway.
Generate tool name, description, input schema, output mapping, and capability version resolution metadata.

SKILL COMPILER
Generate a Skill adapter/folder referencing the registered capability, containing:
- skill.md
- capability metadata
- examples
- permissions
- failure modes
- tests or test references
Do not duplicate imported code into Skills.

REST ADAPTER
Expose a versioned invoke endpoint similar to:
POST /api/v1/capabilities/:key/invoke
Return run_id, status, output, trace_id.

API
Implement or map equivalents for:
POST /api/v1/capability-sources/import/github
POST /api/v1/capability-sources/import/local
GET  /api/v1/capability-sources
GET  /api/v1/capability-sources/:id
POST /api/v1/capability-sources/:id/analyze
GET  /api/v1/capability-recipes
GET  /api/v1/capability-recipes/:id
POST /api/v1/capability-recipes/:id/manifest
POST /api/v1/capability-recipes/:id/test
GET  /api/v1/capabilities
GET  /api/v1/capabilities/:key
GET  /api/v1/capabilities/:key/versions
POST /api/v1/capabilities/:key/compile
POST /api/v1/capabilities/:key/review
POST /api/v1/capabilities/:key/publish
POST /api/v1/capabilities/:key/deprecate
POST /api/v1/capabilities/:key/revoke
POST /api/v1/capabilities/:key/invoke
GET  /api/v1/capability-runs
GET  /api/v1/capability-runs/:id
GET  /api/v1/capability-runs/:id/logs
GET  /api/v1/capability-runs/:id/artifacts

DATABASE
Use the existing database and migration system.
Create normalized equivalents of:
capability_sources
capability_recipes
capabilities
capability_versions
capability_adapters
capability_permissions
capability_policy_rules
capability_reviews
capability_runs
capability_artifacts

Important constraints:
- unique capability key
- unique capability_id + version
- immutable published version records
- timestamps
- JSON/JSONB for manifest/findings where appropriate
- indexes for capability key, status, source, risk, channel, run date, trace ID

UI
Add a "Capabilities" section using the existing UI design system.
Pages:
- Overview
- Sources
- Recipes
- Registry
- Review Queue
- Policies
- Runs
- Artifacts
- Settings

Overview cards:
- sources imported
- recipes discovered
- capabilities published
- awaiting review
- quarantined
- failed builds
- runs today
- success rate

Recipe detail must show:
- source
- entrypoint
- imports
- dependencies
- side effects
- permissions
- risk
- secret findings
- license
- source preview
- generated manifest
- tests

Registry detail must show:
- ID/version/channel/status
- permissions/risk
- schemas
- adapters
- provenance
- hashes
- metrics
- recent runs
- reviews

Review queue must show diffs and allow:
approve
approve with constraints
request changes
reject
quarantine

CLI
If the project has a CLI, integrate commands equivalent to:
pao cap source import
pao cap source list
pao cap source inspect
pao cap source analyze
pao cap recipe list
pao cap recipe inspect
pao cap recipe manifest
pao cap build
pao cap test
pao cap compile
pao cap review
pao cap publish
pao cap deprecate
pao cap revoke
pao cap quarantine
pao cap list
pao cap inspect
pao cap run
pao cap logs
pao cap artifacts
pao cap policy list
pao cap policy test

Support machine-readable JSON output where appropriate.

OBSERVABILITY
Integrate with current logging/tracing/metrics.
Track at least:
capability_runs_total
capability_run_failures_total
capability_run_duration_seconds
capability_sandbox_start_seconds
capability_cpu_seconds
capability_memory_peak_bytes
capability_network_bytes
capability_artifact_bytes
capability_policy_denials_total
capability_reviews_total
capability_quarantines_total

Every run must carry trace_id.

AUDIT EVENTS
Emit equivalents of:
capability.source.imported
capability.source.analyzed
capability.recipe.discovered
capability.manifest.generated
capability.test.started
capability.test.completed
capability.review.requested
capability.review.completed
capability.published
capability.run.started
capability.run.completed
capability.run.failed
capability.deprecated
capability.revoked
capability.quarantined
capability.policy.created
capability.policy.updated

SOURCE UPDATE / DRIFT
Add architecture and implementation support to re-check the selected source ref and detect a new commit.
Never silently update a published capability.
A source change must produce a new candidate version and compatibility report.

QXRESEARCH SEED
Integrate https://github.com/qxresearch/qxresearch-event-1 as a seed source in development/demo tooling.
The importer should discover Python micro-app candidates and classify them:
GOOD_CANDIDATE
NEEDS_REFACTOR
INTERACTIVE_ONLY
DEVICE_BOUND
UNSAFE
DUPLICATE
IGNORE

Do not hard-code an exact recipe count.
Prefer promoting low-risk deterministic utilities first.

DEMO CAPABILITIES
Provide at least three demo capabilities through the new runtime.
Recommended:
- file.hash
- text.normalize
- pdf.merge
If PDF dependencies are unsuitable, use another low-risk deterministic utility.
At least one demo should exercise provenance from the qxresearch seed import.
At least one demo must be callable via generated MCP adapter.
At least one demo must produce an artifact.

TESTS
Add unit, integration, and end-to-end tests.
Mandatory tests:
- manifest validation
- AST analyzer
- dependency parser
- permission inference
- risk engine
- policy engine
- version resolver
- input/output schema validation
- source import to recipe
- recipe to manifest
- manifest to sandbox
- sandbox to artifact
- manifest to MCP
- MCP to runtime gateway
- runtime to audit
- policy denial
- approval required
- quarantine
- revoked capability denied
- sandbox cannot read host protected files
- sandbox cannot write outside workspace
- sandbox cannot reach network when network=none
- sandbox cannot access Docker socket
- timeout enforcement
- memory/resource enforcement where CI permits

BACKWARD COMPATIBILITY
Do not break existing MCP servers, skills, agents, tools, workflows, APIs, or UI routes.
Use adapters and additive migrations.

DOCUMENTATION
Add docs for:
- architecture
- manifest schema
- security model
- sandbox
- policies
- MCP compiler
- Skill compiler
- source import
- operational runbook
- troubleshooting

QUALITY GATES
Before finishing:
1. format
2. lint
3. type-check
4. unit tests
5. integration tests
6. existing regression suite
7. build production artifacts
8. inspect git diff
9. verify no secrets added
10. verify no broad host privileges added

FINAL RESPONSE
When implementation is complete, report:
- architecture implemented
- files created/changed
- migrations
- APIs
- UI pages
- CLI commands
- sandbox/security model
- generated adapters
- qxresearch seed results
- demo capabilities
- tests executed and exact results
- known limitations
- recommended Phase 20.56.x follow-ups

Do not stop at planning. Implement the working vertical slice end-to-end.
```

---

# 76. Recommended Implementation Order for Codex

If Codex needs to sequence the work, use:

```text
1. repository architecture inspection
2. domain types + manifest schema
3. migrations
4. source importer
5. Python static analyzer
6. risk + permission inference
7. policy engine integration
8. registry
9. sandbox runner
10. runtime gateway
11. artifact broker
12. MCP adapter compiler
13. Skill adapter compiler
14. REST API
15. UI
16. qxresearch seed importer
17. demo capabilities
18. tests
19. docs
20. final regression verification
```

---

# 77. Recommended Follow-up Phases

Possible extensions after this phase:

```text
Phase 20.56.1 — Signed Capability Supply Chain
Phase 20.56.2 — WASM/WASI Capability Runtime
Phase 20.56.3 — Remote Sandbox Worker Pool
Phase 20.56.4 — Capability Reputation & Trust Scoring
Phase 20.56.5 — Autonomous Capability Composition Engine
Phase 20.56.6 — Capability Marketplace & Organization Sharing
```

---

# 78. Final Outcome

After Phase 20.56, Pao-hubPro should no longer treat useful GitHub utility code as ad-hoc snippets.

It should treat them as a governed software supply chain:

```text
SOURCE
  ↓
RECIPE
  ↓
ANALYSIS
  ↓
MANIFEST
  ↓
POLICY
  ↓
SANDBOX
  ↓
TEST
  ↓
REVIEW
  ↓
VERSIONED CAPABILITY
  ↓
MCP / SKILL / REST ADAPTER
  ↓
AGENT INVOCATION
  ↓
TRACE + AUDIT + METRICS
```

That turns Pao-hubPro from a system that merely connects tools into a system that can **discover, manufacture, govern, version, and safely operate new capabilities**.

