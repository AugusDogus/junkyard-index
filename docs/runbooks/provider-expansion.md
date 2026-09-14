# Pull-N-Save and Tear-A-Part ingestion

These sources use the existing VIN identity and durable ingestion pipeline.
They report yard metadata independently of vehicle batches. No additional
database migration or provider credentials are required.

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

## Validation evidence (September 14, 2026)

| Source                                           | Full catalog result                       | Requests | Time        |
| ------------------------------------------------ | ----------------------------------------- | -------- | ----------- |
| Pull-N-Save                                      | 11,721 emitted vehicles, 560 skipped rows | 123      | 185 seconds |
| Tear-A-Part                                      | 1,671 vehicles across two stores          | 7        | 1.4 seconds |
| U Pull-It Nebraska (shared TAP regression check) | 2,536 vehicles across four stores         | 11       | 4.8 seconds |

No rate-limit responses or network errors were observed in these completed runs.
Counts and timings are observations, not guarantees.

- Pull-N-Save uses 100-record pages, with one request per 1.5 seconds. Eight
  configured yards are supported. Store number 8 remains excluded because its
  public business identity/address have not been established.
- Tear-A-Part uses the shared TAP client. Its endpoint rejected the old Chrome
  user-agent but accepted `JunkyardIndex/1.0`. Three valid records lacked a row;
  row and arrival date may be absent without invalidating the vehicle.
- Initial minimum accepted inventories are 5,000 for Pull-N-Save and 500 for
  Tear-A-Part. Both also use the existing previous-run drift and error checks.
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
