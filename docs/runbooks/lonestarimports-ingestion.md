# Lonestar Imports ingestion

The default-off `lonestarimports` source covers Lonestar Imports, 6621 Liberty Rd, Houston TX 77028. The native root, about, contact and arrivals pages identify its own 22-acre dismantling yard. The named Google place point is 29.7951041, -95.2997656, rather than the map viewport or placeholder footer embed.

The November 15, 2026 UTC census contains 128 opening and 128 separately captured closing API pages. Both passes contain 2,560 rows: 2,531 accepted donors, nine required-field rejects, 20 explicit sold/crushed exclusions and zero duplicates. Component-only sale notes do not exclude a donor. Native VINs and supported older serials are retained, including the 1967 Mercedes serial. Source category labels require an explicit native vehicle make. No VIN decoding fills missing fields.

Every native page, field, identity, multiplicity and pagination control must match closing. Four ownership/control documents also bookend the census. One vehicle batch and one yard emit only after closing and source quality checks. Valid rejected identities protect presence. Conflicting identities and foreign stock/image joins stop acceptance. Shared validation enforces a 2,000-donor floor, the existing 10% rejection and 25% duplicate ceilings, and the previous-count drift guard. A terminal resume performs no work.

Vehicle destinations use the published stock filter at `/new-arrivals?stock=...`; parts links retain the native manufacturer, model code, year and stock. Optional images remain bound to the same donor GUID.

Chunks allow eight serial GETs with a four-minute deadline. The shared module-wide gate holds through transport/body cleanup and a completed 2.5-second gap, including failures. Requests use manual redirects, no retries, a combined 20-second deadline and a 2 MiB decoded-body cap. The whole census is bounded to 1,008 GETs and 16 MiB of responses; checked cursors are bounded to 16 MiB. Failures preserve prior inventory and the last validated checkpoint.

Evidence lives under `.scratchpad/provider-coverage/nov14-provider-goal/research/ks_ok_nm_tx/`. The independent offline replay validates receipts and fixture bodies, then exercises the production client, shared gate, durable dispatcher, cursor round trips and terminal validation. See `lonestarimports-root-verification.json` and `lonestarimports-local-admission.json` in the goal directory. Only completed gap sleeps are virtualized; no live HTTP is used.

The count-only soak discards inventory and preserves a paused checkpoint at its GET cap:

```sh
bun run soak:sources -- --sources=lonestarimports --cycles=1
```

This command makes live requests. It is an operator diagnostic, not part of offline admission. Qualification does not enable `ingestion-source-lonestarimports`.
