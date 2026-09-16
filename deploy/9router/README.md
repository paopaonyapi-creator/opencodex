# 9Router gateway sidecar — deployment notes (Phase 20.51)

9Router (https://github.com/decolua/9router) runs as a local multi-provider AI
gateway sidecar. Pao-hubPro's AI Gateway talks to it over the
OpenAI-compatible `/v1` surface and adds policy, quota-aware routing, bounded
fallback, circuit breaking, and audit on top. 9Router owns provider
connections, credentials, protocol translation, and upstream inference.

## Bring-up

```bash
cd deploy/9router
cp .env.9router.example .env.9router   # fill in if the gateway needs a key
docker compose -f docker-compose.9router.yml up -d
curl http://127.0.0.1:20128/v1/models   # smoke check
```

Then in the repository:

1. Set `PAO_AI_GATEWAY_NINE_ROUTER_BASE_URL=http://127.0.0.1:20128/v1`.
2. Add models to `config/ai-gateway/models.yaml` whose `provider` is
   `nine-router-gateway`; the `model` value is the upstream model string
   (e.g. `antigravity/gemini-2.5-pro`).
3. Enable the provider in `config/ai-gateway/providers.yaml`
   (`nine-router-gateway: enabled: true`) and set `enabled: true` in
   `config/ai-gateway/nine-router.yaml` (create it from
   `docs/phases/phase-20.51-9router.md` §config).
4. Restart the gateway (`PAO_AI_GATEWAY_ENABLED=true`).
5. Verify with `GET /api/gateway/quotas` and `POST /api/gateway/simulate`.

## Pinning and rollback

The compose file ships with `latest` for first bring-up only. Upstream changes
quickly and has published security advisories, so a production deployment
must pin:

1. Pick a release tag from the upstream changelog and soak-test it locally:

   ```bash
   docker pull decolua/9router:vX.Y.Z
   # edit docker-compose.9router.yml -> image: decolua/9router:vX.Y.Z
   docker compose -f docker-compose.9router.yml up -d
   ```

2. Record the pinned tag (or digest) here and in the operator changelog:

   > Pinned version: **(fill in after the first soak test)**

   A digest pin (`decolua/9router@sha256:...`) is preferred where the registry
   exposes one, because tags are mutable.

3. Rollback procedure:

   ```bash
   docker compose -f docker-compose.9router.yml down
   # restore the previous pinned image line
   docker compose -f docker-compose.9router.yml up -d
   curl http://127.0.0.1:20128/v1/models
   ```

   The `9router-data` volume is left intact on rollback, so provider
   connections and their credentials survive. Pao-hubPro needs no rollback of
   its own: disable routing governance with `PAO_AI_GATEWAY_GOVERNANCE=false`
   (requests fall back to the ungoverned path) while keeping the sidecar.

## Security posture

- The compose file binds `127.0.0.1` only. Do not replace it with `0.0.0.0`
  or a LAN interface without adding TLS + strong auth in front.
- Provider OAuth tokens and API keys live inside the 9Router volume, never in
  Pao-hubPro config or ledgers.
- Keep the sidecar image updated to a *pinned* recent build; older builds have
  known advisories (upstream `SECURITY.md` / advisories page).
