# Phase 20.56 — Micro-App Capability Lab

Turns Python micro-apps into policy-governed Pao capabilities. qxresearch is a
seed corpus, not a hardcoded runtime.

## What shipped

- Local/seed import with immutable snapshot + sha256
- Static Python analysis (no execution during discovery)
- Risk scoring + default-deny policy (no autonomous high/critical publish)
- Registry lifecycle including QUARANTINED
- First-party trusted runners for `utility.checksum`, `text.normalize`, `json.transform`
- MCP/Skill/REST adapter compiler (`pao.cap.<id>`)
- API `/api/agent-os/capability-lab/*`, CLI `ocx capability-lab`, dashboard `#/capability-lab`

## Safety

Imported Python is **not** executed on the host. Docker sandbox is documented
but not enabled by default (`PAO_CAPABILITY_SANDBOX_BACKEND=process` only runs
first-party wrappers).

## Verification

```bash
bun test tests/capability-lab.test.ts
```

Live GitHub clone of qxresearch is optional and not vendored.

