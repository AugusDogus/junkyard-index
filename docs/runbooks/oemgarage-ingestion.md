# oeM Garage

The default-off `oemgarage` source covers oeM Garage / DOV Auto Sales, 5808 Dawson Street, Hollywood FL 33023. It is independent of the Ohio `oem` provider. Native ownership and the complete Vehicles Dismantled catalog were captured on November 15, 2026 UTC.

All 258 native donor destinations have opening and closing details, with matching catalog and operator bookends. The complete census yields 239 accepted donors, 19 required-field rejects (7.3643%), zero duplicates and zero VIN conflicts. All 258 valid observed identities remain presence evidence, including rejected rows. Individual native donor collections are search and alert destinations.

Vehicle, yard and accounting callbacks wait for complete source quality and closing proof. Shared validation enforces a 200-donor floor and the existing rejection, duplicate and previous-count safeguards. Optional metadata stays nullable; changed optional values are cleared during closing reconciliation.

Durable chunks allow eight serial GETs. Each physical request has a combined 20-second request/body deadline, a 4 MiB body limit, manual redirects and zero retries. One shared gate holds through complete body cleanup and a 2.5-second completed gap, including failures. Chunks have a three-minute deadline. Validated checkpoints have a 4 MiB wire limit. Failures preserve prior inventory and the last validated checkpoint.

The yard point, 26.001031334919, -80.203375411824, is an independent exact-address Census street-range interpolation (5800 through 5898), not a rooftop or parcel point.

Evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill04/`. Root verification replays all 520 dated responses through shared durable cursor codecs and source validation, with no live fallback. The result is `oemgarage-root-verification.json` in the goal directory.

The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=oemgarage --cycles=1
```
