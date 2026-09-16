# Phase 20.27 — Context Plane (`.pao/`)

Native Pao-hubPro context root (replaces upstream's `.viberaven/` concept).

## Layout

```text
.pao/
  README.md · project-context.md · architecture.json/.md · agent-context.md
  agents.json · permissions.json · capability-snapshot.json
  provider-status.json · release-context.md · production-context.md
  gate-result.json · gate-report.md · tasklist.md · evidence-index.json
  reviewer-summary.md · execution-history.jsonl
  snapshots/<id>.json · evidence/<id>.json · reviewers/<run>.json · gates/<run>.json
```

## Rules (doc §30-§31, §100, §125-§126)

- Every generated artifact carries `schema_version: 1` + `generated_at`;
  readers fail loudly on unknown versions.
- Classify artifacts: committable (architecture, gate reports, review
  summaries) vs local-only (raw terminal output, execution history). A
  `.pao/.gitignore` may exclude ephemeral paths.
- **Never plaintext secrets** — secret references only
  (`vault://provider/profile`).
- `production-context.md` holds hosting/DB/webhook/rollback facts, not keys.

## Snapshots

`createContextSnapshot(attachments)` persists an immutable snapshot bound to
git SHA, branch, policy hash, and attachment refs (architecture node, release,
provider status, gate finding, file set, review finding). Sessions and review
runs reference the snapshot they used. Freshness = age < 24h (and surfaced in
the UI).

## Writer safety

`writeContextArtifact` is traversal-guarded: the resolved target must stay
inside the root (sep-aware prefix check, Windows-safe). Artifact writes are
whole-file (no partial JSON).
