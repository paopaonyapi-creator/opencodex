# OpenPost integration (Phase 20.60)

OpenPost (`https://github.com/getopenpost/openpost`, AGPL-3.0-only) is deployed
as a **separate external service**. Pao-hubPro never vendors OpenPost source;
it only speaks HTTP to `POST_BASE_URL/api/v1` (see
`src/agent-os/social-publishing/`). This directory only carries deployment
assets, mirroring `integrations/open-webui/`.

## Upstream

- Repository: https://github.com/getopenpost/openpost
- Docs: https://docs.openpo.st — API reference: https://docs.openpo.st/api-reference (OpenAPI: `/openapi.json`)
- License: **AGPL-3.0-only**. See `docs/legal/openpost-integration.md` for the
  boundary that keeps Pao-hubPro core code separate.

## Pinned version

`VERSION` records the pinned release (`4.33.0`, released 2026-09-15). The
compose file pins the image tag; **do not use `latest` in production**. Upgrade
deliberately: pull the new release, start, verify `/api/v1/ready`, then run a
Pao-hubPro integration test (register instance → health → account sync) before
re-enabling mutation.

## Deployment

```bash
cd integrations/openpost
mkdir -p data/db data/media
cp env.example .env      # then set OPENPOST_JWT_SECRET / OPENPOST_ENCRYPTION_KEY
docker compose -f docker-compose.openpost.yml up -d
curl http://localhost:8080/api/v1/ready   # expect {"status":"ready","database":"ok"}
```

- One container, SQLite at `data/db/openpost.db`, media at `data/media`.
- Behind a reverse proxy, forward `/api/v1/` and `/media/` unchanged.
- Non-amd64 hosts require emulation (upstream publishes amd64 images).

## Connecting Pao-hubPro

1. In OpenPost: create an account, then Settings → Personal → Developer →
   create an API token with `api:read` + `api:write` scoped to the workspace.
2. Store the token where the secret ref can find it — either
   `PAO_OPENPOST_API_TOKEN` in Pao's environment, or a file at
   `$OPENCODEX_HOME/social-publishing/secrets/openpost/main/api-token`
   (the `secret_ref` default). Tokens are resolved at call time and are never
   persisted in Pao's SQLite database or logs.
3. Enable the subsystem: `PAO_SOCIAL_PUBLISHING_ENABLED=true` and set
   `PAO_OPENPOST_BASE_URL` (default `http://openpost:8080`).
4. Verify: dashboard → Social Publishing → instance health, or
   `POST /api/agent-os/social-publishing/instances/main/test`.

## Required secrets

| Secret | Where | Purpose |
|---|---|---|
| `OPENPOST_JWT_SECRET` | OpenPost `.env` | session signing (OpenPost side) |
| `OPENPOST_ENCRYPTION_KEY` | OpenPost `.env` | encrypts provider OAuth tokens at rest (OpenPost side) |
| OpenPost API token | Pao secret ref | machine-to-machine API/MCP access (Pao side) |

Provider OAuth credentials (X, Mastodon, TikTok, …) live **only** inside
OpenPost. Pao-hubPro stores references and readiness state, never tokens.

## Persistence

- Database: `integrations/openpost/data/db/` (bind mount)
- Media: `integrations/openpost/data/media/` (bind mount)

Back up both. SQLite hot copies are unsafe — stop the container or use
`sqlite3 .backup` inside the container before archiving.

## Upgrades and rollback

1. Note the running image tag (`docker ps --format '{{.Image}}'`).
2. `docker compose -f docker-compose.openpost.yml pull && docker compose -f docker-compose.openpost.yml up -d`
3. Verify `/api/v1/ready`, then run the Pao-hubPro instance health + account
   sync checks.
4. Rollback: pin the previous tag in `docker-compose.openpost.yml` and repeat.
   Migrations are upstream-owned; if a release migrated the DB forward, test
   the rollback on a copy of `data/db` first.

## Health verification

- OpenPost: `GET {base}/api/v1/ready` → `{"status":"ready","database":"ok"}`
- Pao-hubPro: `GET /api/agent-os/social-publishing/health`
- Account/provider readiness: `POST /api/agent-os/social-publishing/instances/main/sync`

## Boundary reminders

- Account/provider setup (connecting X, TikTok, …) is an OpenPost
  responsibility; Pao-hubPro only reads accounts/readiness via the API.
- Publishing execution, provider queues, and retries inside providers are
  OpenPost-owned. Pao-hubPro owns intent, policy, approval, idempotent
  handoff, reconciliation, and audit.
