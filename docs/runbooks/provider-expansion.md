# Pull-N-Save and Tear-A-Part ingestion

These sources use the existing VIN identity and durable ingestion pipeline.
They report yard metadata independently of vehicle batches. Apply migration
`0008_vehicle_observations.sql` before deployment; the Vercel build migration
wrapper applies it automatically. No new provider credentials are required.

## Local verification

Run a bounded provider check first:

```sh
bun run soak:sources -- --sources=pullnsave,tearapart --max-pages=2
```

Run the full catalogs:

```sh
bun run soak:sources -- --sources=pullnsave,tearapart --cycles=1
```

The soak counts and discards inventory without writing production data, Algolia
records, or alerts. `paused` is expected when a page cap cuts a catalog short.
It verifies live transport and transforms, not the complete publication workflow.
Unit/integration tests separately exercise local SQLite checkpoint persistence,
replay handling, yard attribution, cursors, and source validation.

Do not confuse the soak with `RUN_INGESTION_SMOKE=1 bun run test:ingestion`:
that opt-in test invokes the full ingestion lifecycle against configured services,
including publication and alert delivery.

## Validation evidence (September 15, 2026)

| Source                                           | Full catalog result                                                                   | Requests | Time        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------- | ----------- |
| Pull-N-Save                                      | 11,721 emitted vehicles, 560 without yard metadata, zero rejected rows, one duplicate | 125      | 188 seconds |
| Tear-A-Part                                      | 1,671 vehicles across two stores                                                      | 6        | 1.2 seconds |
| U Pull-It Nebraska (shared TAP regression check) | 2,536 vehicles across four stores                                                     | 10       | 3.9 seconds |

No rate-limit responses or network errors were observed in these completed runs.
Counts and timings are observations, not guarantees.

- Pull-N-Save uses 100-record pages, with one request per 1.5 seconds. Eight
  previously verified locations are retained as a metadata cache, not an allowlist.
  Other IDs are looked up automatically through the public inventory directory.
  A resolved new yard gets a stable `PNS-{number}` code. Vehicle distance searches
  use a ZIP centroid when precise coordinates are unavailable; the yard directory
  does not present that centroid as the yard entrance.
- IDs lacking public location metadata are skipped with a per-yard vehicle count
  and reason in the connector logs and soak summary. They do not reject the known
  yards' inventory. Their observed VINs are checkpointed transactionally in
  `vehicle_observation` with the same cursor guard as full snapshots. Missing
  reconciliation considers that evidence only for accepted sources in the current
  run, so a metadata outage cannot age a still-observed VIN toward deletion.
  These observations are not published as vehicles and do not inflate accepted
  snapshot counts. They are cleaned up with snapshots after the run is released.
  Discovered yard metadata is reloaded from the persistent yard table in later
  chunks/runs. Discovery queries the whole yard, independent of the first vehicle's
  year/make. Missing metadata is retried in later chunks/runs.
  There is no permanent exclusion for store 8: its current public response lacks
  name/address/ZIP fields, so its 560 rows still cannot be located.
- Tear-A-Part uses the shared TAP client. Its endpoint rejected the old Chrome
  user-agent but accepted `JunkyardIndex/1.0`. Three valid records lacked a row;
  row and arrival date may be absent without invalidating the vehicle.
- Initial minimum accepted inventories are 5,000 for Pull-N-Save and 500 for
  Tear-A-Part. Both also use the existing previous-run drift and error checks.
- Pull-N-Save reports raw, unlocated, rejected, and duplicate row
  counts separately. Durable checkpoints persist the eligible processed count
  (raw minus rows without a yard location), rejection count, and duplicate count.
  Invalid vehicles at known yards count toward the rejection guard. Vehicles at
  yards whose location cannot be identified are reported separately and do not
  count as malformed vehicles.
- New sources rank below existing direct sources and above AutoRecycler during
  VIN reconciliation.

## Overlap sample

A bounded live sample queried 90 VINs against AutoRecycler and active Row52
inventory: ten per yard from seven configured Pull-N-Save yards and both
Tear-A-Part stores. Springville was not represented in the sampled pages.
AutoRecycler returned zero matches; Row52 returned one (in the Salt Lake City
Pull-N-Save sample). The AutoRecycler VIN filter was checked with a positive
control from its own live inventory.

This supports adding these sources but is not an exhaustive overlap audit or a
claim of 13,392 net-new vehicles. Sample incumbent coverage before implementing
additional provider candidates.
