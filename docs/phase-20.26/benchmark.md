# Phase 20.26 — Benchmark (baseline methodology)

Per spec §101, no fabricated numbers: benchmarks require a pinned upstream
checkout and network access, which are not available in this environment.
This document records WHAT to measure and how, so the first production slice
fills it in.

## Baselines to capture (with `DOUYIN_DOWNLOADER_HOME` configured)

| Metric | Method |
|---|---|
| inspect latency | 20x `POST /inspect` on one public video URL; report p50/p95 |
| search latency | 5x `POST /search` (maxItems=20); report p50/p95 |
| hot-board snapshot duration | 5x `POST /hot-board` |
| download throughput | one reference download; bytes/sec from job metrics |
| normalization overhead | in-process timer around `normalizeMediaItem` on fixture payloads (also runnable in CI) |
| DB write throughput | batch `upsertMediaItem` of 100 fixture items |

## In-CI deterministic proxy

The fixture normalizer path is timed in CI to catch gross regressions in the
canonicalization layer (target: <1ms per item on CI hardware; informational
only).

## Results

To be recorded after the first pinned-upstream smoke run:

```text
inspect p50/p95:      __ms / __ms
search p50/p95:       __ms / __ms
hot-board duration:   __ms
download throughput:  __ bytes/sec
normalization (CI):   __ ms/item
db writes:            __ items/sec
```
