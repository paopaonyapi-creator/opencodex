# Migration 20.24 → 20.95

Do not delete Phase 20.24. Traffic switch is additive.

## Sequence

1. Inventory 20.24 (this audit).
2. Compatibility wrapper: `LegacyPhase2024Adapter` + CLI health via `OmniGetAdapter`.
3. Canonical CAG contracts in `src/agent-os/acquisition/`.
4. New `acq_*` tables; 20.24 media history stays in place.
5. New REST `/api/agent-os/acquisition/*`. Legacy `/api/agent-os/media/*` remains.
6. Verify `tests/media-acquisition.test.ts` and `tests/acquisition.test.ts`.
7. Deprecate legacy submit-through-20.24 only after a later cutover phase.

## Rollback

- Set `PAO_ACQUISITION_ENABLED=0`.
- 20.24 media routes and tables continue to operate.
- No destructive migration of historical media jobs.

## Caller guidance

Replace direct `omniget.download(url)` with:

```ts
const { plan, policy } = await getAcquisitionGateway().plan(req);
await getAcquisitionGateway().submit(req);
```
