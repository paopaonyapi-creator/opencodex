# Phase 20.19 — Pao Universal AI Browser Provider

Status: Universal core implemented and tested. Three of four site adapters are
declaration-only. Extension, side panel, adapter devkit, and dashboard are not built.

## Numbering

The planning document proposed 20.18, but that number is the Grok Production Bridge built
in the previous turn, and 20.17 is the Adaptive LLM Gateway before it. This work is
**20.19**. This is the fifth renumber in the series. The pattern is now consistent enough
to name: each draft arrives numbered one behind the repository, because the drafts are
written against a phase count that the committed work has already advanced.

## What this phase actually changes

Phase 20.18 built one bridge for one site. Most of it was already general — the job state
machine, the selector engine, the bridge protocol, the download safety — but it was filed
under a name that made adding a second site look like writing a second system.

The core of this phase is the boundary that fixes that: a site is a MANIFEST plus an
ADAPTER, and nothing above that layer knows which site it is driving. The concrete test is
that adding a fifth site should touch an adapter file and a fixture set, and nothing else.

## The safety properties, and why each exists

These are the parts worth reviewing, because each closes a specific failure that is not
recoverable by retrying.

### Host claiming is label-aware

`evil-grok.com` and `grok.com.evil.test` do not claim a `grok.com` manifest. A substring
test would let an attacker register either name and receive prompts meant for the trusted
site — the classic suffix confusion, and here it means driving an attacker's page with a
prompt the operator believed was going somewhere safe.

### Ambiguous detection refuses to act

When two adapters score within `AMBIGUITY_MARGIN` the result is `ambiguous` and
`adapterId` is null. Picking the marginally-higher scorer would mean typing into whichever
site happened to score 0.02 higher, and a wrong-site submission cannot be undone.

### Capability is detected, never inferred from a name

`if (provider === 'gemini') enableUpload()` is the pattern the document forbids and the
code makes impossible to write: capability state comes from the manifest's declarations
merged with what was observed on the page. `unknown` stays distinct from `unsupported` —
collapsing `unknown` into `unsupported` would claim a feature is missing when it is merely
unprobed, and collapsing it into `supported` offers a control that fails.

Notably, **no built-in adapter claims video support.** Grok's is `unknown` and the rest are
`unsupported` or `unknown`. Declaring it would be a claim about a UI nobody has loaded.

### Automatic mode is never granted to an unverified adapter

Health and verification are separate questions. Health asks "is it working"; verification
asks "has anyone ever confirmed it works". An adapter can score a perfect 100 on mocks and
still never have loaded the real page, so `degradeExecutionMode` refuses `automatic` while
`liveVerified` is false, regardless of what the manifest declares or how good the numbers
look.

### Results are correlated before they are trusted

The failure this prevents is specific: a chat page still shows the PREVIOUS answer when a
new job starts, and a collector that grabs the first visible response would attach the
wrong text to the job, file it as success, and send it downstream. Nothing about that looks
like an error.

Five checks must pass — a result element existed, it appeared AFTER the submission, it
carries this job's prompt hash, it came from the expected container, and the collector was
confident. A failure produces `needs_review` rather than a rejection, because a mismatched
result may still BE the right result whose marker was misread.

### Resubmission requires proof, not absence of evidence

`canSafelyResubmit` returns true in exactly one case: the job was never submitted. An
indeterminate outcome goes to a human, because the cost of a duplicate generation is real
money and time while the cost of asking is a minute of attention.

### Adapters cannot name a file or execute code

An adapter receives typed actions — `focus`, `set_text`, `click`, `upload`, `wait_for`,
`collect_text`, `collect_media` — and nothing else. There is no `eval`, no `new Function`,
no Chrome API, no `document`, and no filesystem path. Files arrive as grants:

| Grant property | Hole it closes |
| --- | --- |
| Bound to one job | A grant leaked from job A cannot be spent by job B |
| Expiring | A grant captured in a log is worthless shortly after |
| Read-limited | A retry storm fails closed instead of looping |
| Path never exposed | An adapter learns a name and a size, not a location |

### Side-effect actions are named, not flagged

Dry run executes everything except `click`, `set_text`, and `upload`. Separating them by a
table rather than a per-action boolean means a new action type defaults to the safe side:
forgetting to mark something is a compile error, not a silent side effect.

## What is built

```text
src/agent-os/browser-provider/universal/
  types.ts        capabilities, manifests, actions, jobs, results, errors
  registry.ts     adapter registry, detection, host claiming, health, degradation
  adapters.ts     grok (migrated), chatgpt, gemini, claude
  file-grants.ts  one-time file grant broker
  state.ts        universal job state machine, correlation, guards
  tab-router.ts   tab bindings, per-adapter concurrency, stale reaping
  planner.ts      dry-run execution plan, mode degradation, output validation
  form-model.ts   capability-driven form fields
apps/pao-universal-ai-extension/   the migrated extension (13 scripts, 3 pages, side panel)
```

## What is NOT built

This is the honest part, and it is most of the document. The spec describes a platform with
~40 sections; the core contracts and their safety properties are implemented and tested,
and the rest is not:

| Spec area | Status |
| --- | --- |
| Universal SDK and registry | **Built** |
| Adapter detection, ambiguity, host claiming | **Built** |
| Capability model and merging | **Built** |
| Typed action vocabulary and policy | **Built** |
| File grant broker | **Built** |
| Universal state machine and correlation | **Built** |
| Adapter health, degradation, loop guard | **Built** |
| Grok adapter migration | **Built** (rules moved, tests still pass) |
| ChatGPT / Gemini / Claude adapters | **Declaration only** — manifest, detection scorer, gate detection, and selector targets. No prepare/execute/observe/collect implementation, because those require a live page to write against. |
| Custom adapter template | Not built |
| Adapter devkit and CLI | Not built |
| Universal Chrome extension with adapter runtime | **Built** — migrated in place; the Grok extension became the universal one |
| Chrome Side Panel | **Built** |
| Tab router and multi-tab control | **Built** (per-adapter concurrency, ambiguity refusal, stale reaping) |
| Typed action executor and dry run | **Built** |
| Per-adapter selector profiles | **Built** (`src/content/selector-profiles.js`) |
| Bridge V2 protocol | Not built — the Phase 20.18 bridge protocol is unchanged |
| Adapter Lab | Not built |
| Dashboard / capability-driven UI | Not built |
| Live smoke tests | Not built |

Two rows deserve a note. The **ChatGPT, Gemini, and Claude adapters** are declaration plus
detection plus gate detection plus a selector profile — everything that can be written
without loading the page. What they lack is the prepare/execute/observe/collect body, and
that is a property of the page rather than of the design.

The **extension** is built, and it is the same extension as Phase 20.18: renamed, moved, and
given an adapter runtime. Two extensions both injecting into the same hosts would both type
into the same prompt field, so duplicating was never an option.

### Why the adapters stop at declaration

A working ChatGPT adapter needs a prepare/execute/observe/collect body written against the
real DOM. That body cannot be authored honestly from a document — it is a series of
observations about which elements exist and how they behave, and writing it without loading
the page would produce code that looks complete and fails on first contact. The declaration
layer is what CAN be built correctly now: it is what the router and UI need in order to know
an adapter exists and what it claims, and it is the shape the implementation will fill in.

Three adapters are marked `liveVerified: false` and their capabilities are mostly `unknown`
for exactly this reason. That is the honest state, and the code enforces the consequence:
they cannot run automatic.

## Validation

```bash
bun test tests/universal-browser-provider.test.ts tests/universal-file-grants.test.ts
  -> 71 pass, 0 fail, 177 assertions
bun test tests/grok-bridge*.test.ts
  -> 68 pass, 0 fail (no migration regression)
bun run typecheck   -> clean
```

### A defect found by testing my own code

I declared `automatic` in Grok's execution modes while marking it `liveVerified: false`.
Both cannot be true as stated, and a test caught the contradiction. The resolution was to
separate the two questions properly: a manifest declares what an adapter CAN do, and the
degradation layer decides what it MAY do. `automatic` is now never granted while an adapter
is unverified, whatever its manifest says or how good its scores look.

## Next step

The gap between this and a working multi-site system is a live page. Load one adapter
against its real site, write the prepare/execute/observe/collect body against what is
actually there, and set `liveVerified: true` when it works. That is one site's worth of
work, and doing it once proves the adapter boundary is real rather than aspirational —
which is the only thing this phase was for.
