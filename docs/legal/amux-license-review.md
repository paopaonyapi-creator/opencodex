# amux license review (Phase 20.61)

**Status:** engineering record, reviewed 2026-09-16 at pinned commit
`3a205a41a60ea790dfae48a5056ef70d6f9361e9`. Not legal advice.

## Findings

1. **License identifier.** The upstream README states **"MIT + Commons
   Clause"**; GitHub's license API classifies the file as `Other`
   (`NOASSERTION`), i.e. a custom license text. The Commons Clause restricts
   **selling** the software; it does not restrict running it, modifying it, or
   integrating with it over an API.
2. **Integration shape.** Pao-hubPro integrates with amux exactly like it
   integrates with OpenPost (Phase 20.60): a separately deployed external
   service reached over its HTTP API. Pao-hubPro source contains no amux code,
   no fork, and no vendored artifacts (`src/agent-os/agent-runtime/adapter/`
   is an original client for amux's published REST surface).
3. **Commercial-use gate (spec §26).** Commons Clause explicitly requires
   "a separate license" for **commercial resale**. Shipping Pao-hubPro with
   this integration enabled is *not* resale of amux: amux remains a separate
   program obtained from upstream. Nevertheless:
   - commercial enablement of the agent-runtime integration stays behind
     `PAO_AGENT_RUNTIME_ENABLED=false` by default;
   - before offering any paid feature whose value materially depends on amux,
     re-inspect the license text at the then-pinned commit and obtain written
     upstream permission where in doubt.
4. **Attribution.** Operators self-hosting amux preserve upstream notices by
   deploying the unmodified upstream binary. No amux notice obligations attach
   to Pao-hubPro's original adapter code.
5. **Renaming/forking/wrapping.** Consistent with spec §26.6: none of those
   change license obligations. This integration deliberately does none of
   them.

## Re-review triggers

- changing the pinned upstream commit or version,
- vendoring or forking any amux code,
- distributing amux itself with Pao-hubPro,
- enabling any paid/commercial feature that depends on this integration.
