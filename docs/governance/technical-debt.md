# Pao-hubPro — Technical Debt Ledger

> Managed by Ponytail Minimal-Code Governance Layer.
> Tracks deliberate shortcuts, deferred refactors, and scheduled triggers for re-architecting.

## DEBT-20260907-001

- Date: 2026-09-07
- Area: testing
- Shortcut: Temporary utility function
- Reason: Rapid prototype shortcut
- Risk: low
- Trigger to revisit: Future review
- Related files: none
- Owner: test-agent
- Status: open

## DEBT-20260908-002

- Date: 2026-09-08
- Area: testing
- Shortcut: Temporary utility function
- Reason: Rapid prototype shortcut
- Risk: low
- Trigger to revisit: Future review
- Related files: none
- Owner: test-agent
- Status: open

## DEBT-20260908-003

- Date: 2026-09-08
- Area: testing
- Shortcut: Temporary utility function
- Reason: Rapid prototype shortcut
- Risk: low
- Trigger to revisit: Future review
- Related files: none
- Owner: test-agent
- Status: open

## DEBT-20260923-001

- Date: 2026-09-23
- Area: persistence
- Shortcut: Phase 20.15 cloud sandbox state lives in a sidecar file, cloud-sandbox.sqlite3, not in the versioned central agent-os.sqlite3.
- Reason: The central store is already 181 tables over 3000 lines and is the single-writer contention point. The sidecar still carries a PRAGMA user_version stamp, which the media-memory precedent it follows does not.
- Risk: medium
- Trigger to revisit: When cloud data must be joined with agent_events or approvals, or when a second sidecar appears and the pattern stops being isolated.
- Related files: src/agent-os/cloud-sandbox/db-store.ts, src/agent-os/db.ts
- Owner: Pao-hubPro
- Status: open

## DEBT-20260923-002

- Date: 2026-09-23
- Area: cloud-sandbox
- Shortcut: Docker is reachable only through NullDockerControlPort, which refuses every mutation; the socket-backed port is deferred to milestone M7.
- Reason: The repository has no Docker client and runs on win32, where Docker Desktop exposes a named pipe and must be started by hand. Shipping a Docker-dependent Wave-1 anyway would force the adapter to fake success, which source spec 42 forbids, so fidelity reports UNAVAILABLE instead.
- Risk: medium
- Trigger to revisit: M7, or as soon as CI gains a Docker daemon. Withheld services: lambda, rds, opensearch, ec2, ecs, eks, msk.
- Related files: src/agent-os/cloud-sandbox/docker-control/port.ts, src/agent-os/cloud-sandbox/docker-control/null-port.ts, src/agent-os/cloud-sandbox/capability-registry.ts
- Owner: Pao-hubPro
- Status: open

## DEBT-20260923-003

- Date: 2026-09-23
- Area: cloud-sandbox
- Shortcut: Only MockCloudEmulatorAdapter exists; no Floci adapter is wired, and activateCloudSandboxPlane registers the mock.
- Reason: Every contract the plane depends on (SPI, sidecar store, policy capabilities, trust-zone gates, Docker control port) had to be fixed and tested against a deterministic implementation first, so a real adapter written alongside them would be the thing under test rather than the contracts.
- Risk: low
- Trigger to revisit: M2, which replaces this registration with FlociAwsAdapter and keeps the mock for tests.
- Related files: src/agent-os/cloud-sandbox/index.ts, src/agent-os/cloud-sandbox/adapters/mock.ts
- Owner: Pao-hubPro
- Status: open
