# Pick-A-Part Virginia ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

The `pickapartva` connector reads the native global donor inventory for two
verified physical yards: Fredericksburg (`TT87`, 9001 Patriot Hwy) and Stafford
(`UU81`, 164 Norman Rd.). Native selectors and footer text establish ownership.
Saved U-Pull Scan JSON-LD maps corroborate coordinates at those exact addresses.
Full-service rows remain eligible donor inventory. No contact, account, cart,
image download, alternative host, inferred VIN or guessed detail route is used.

## Native protocol and checkpoints

Each chunk enumerates the complete literal native Next chain from page 1,
validates every physical owner and unfiltered control, and closes pages 1, 2
and the terminal page before any callback. The measured catalog has 15 pages:
500 cards on pages 1 through 14 and 449 on page 15. The terminal page has no
Next link. These controls establish a bounded stable traversal, not an atomic
provider snapshot or a source-published total count.

The safety ceiling is 15 catalog pages, 500 cards per page, 4 MiB per body,
18 requests per chunk, 25 seconds per request/body read and three minutes per
chunk. Requests are serial, unredirected HTTPS GETs with no retry. Production
requests include a 1,600 ms finalizer delay on success and failure, preserving
spacing across separately created durable chunks.

`streamPickapartvaInventory` accepts `startCursor`, `maxPages`, `onBatch` and
optional `onYards`. `maxPages` counts emitted raw-page partitions, from 1 to 15. Every partial emission chunk still validates the full native census.
Normal ingestion uses 15, requiring 18 controls. Three five-page chunks require
54 controls. Prefix pages are rebuilt without repeating inventory callbacks.

`PickapartvaCursorSchema` validates these states:

- `start`: source `pickapartva` and phase `start`.
- `pages`: whole-snapshot fingerprint, all ordered page URL/hash receipts,
  `lastPage`, `nextPage` and cumulative `processed`, `emitted`, `rejected` and
  `duplicates` counters. Rebuilt prefix counters must exactly match before
  another batch is emitted.
- `complete`: source `pickapartva` and phase `complete`. Replaying it performs
  no requests, callbacks or accounting increments.

Changed pages, truncation, foreign/filtered URLs, owner changes, unknown yards,
forged cursors, conflicting required identities or failed closing controls abort
before callbacks and before terminal reconciliation. A failed chunk returns no
advanced checkpoint. Previously accepted inventory stays intact. Inspect the
native contract and restart a fresh run after resolving drift.

## Required identity and optional metadata

The connector uses the existing `inventoryVin` contract, including supported
pre-1981 serials. Required year, make, model and physical yard stay explicit.
Valid VINs from rejected descriptive metadata remain presence evidence, including
when a serialized prefix is replayed. Every raw card contributes exactly once
to accepted, rejected or duplicate accounting in its emission partition.

The saved census reconciles 7,449 cards to 7,422 unique donors, 7 invalid modern
VINs and 20 duplicate cards. Fredericksburg has 5,168 unique donors and Stafford
has 2,254. Fourteen accepted donors use older serials. Source and per-yard checks
retain the existing 10% rejection and 25% duplicate limits. The measured source
floor in shared registration is 2,474, with the existing prior-run drift
and reconciliation guards retained by shared orchestration.

Eighteen duplicate cards repeat identical native donors. Two other VIN groups
agree on all required identity and yard fields while their stock/date values
disagree; one also disagrees on row. The connector merges all occurrences before
emitting, setting only conflicting optional stock, date, row and image fields to
null. Required identity or yard disagreements abort. Identical same-stock repeats
keep the first source page/card destination. Different-stock variants use the
previously verified common unfiltered native catalog destination:
`https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY`.

Color is null because it is unpublished. Missing, invalid or conflicting optional
stock, row, date and image references remain null. Genuine photos require the
native stock/lightbox binding and exact official CloudFront yard/stock path.
Logos, foreign references and mismatched optional photo bindings are null. No
image bytes are requested. Native model text stays intact, including repeated
make text such as `TESLA MODEL X`. The native make selector omits Tesla, so the
existing first-token make/model fallback applies to its explicit donor card.

## Saved deterministic validation

The frozen source packet is under
`.scratchpad/coverage/parallel-mn-ia-ne-sd/pickapartva-requalification/`.
Its report SHA256 is
`f15000f316690195e97783f8b08fa10ed4305822ac6a0fabbc13494cb8e28d96`;
the 76-artifact manifest SHA256 is
`8e8f1d6ad1257649fd3c3fe5bbd8a98175786c5642e49919ce23b526d44232f3`.
The original bare-ANY control is `new-leads/pickapartva-any.html`, SHA256
`42476557198a07761f212a86bddaf0b66aadcc4cda5c964782004476f410c988`,
with its exact HTTP 200 receipt in `new-leads/va-wa-native-field-screen.json`.
It establishes the common destination used for conflicting-stock variants.

Run focused tests with:

```sh
bun test src/server/ingestion/pickapartva-*.test.ts
```

Replay all real saved pages and closing controls without network or persistence:

```sh
bun scripts/soak-pickapartva.ts \
  --saved .scratchpad/coverage/parallel-mn-ia-ne-sd/pickapartva-requalification/evidence \
  --output .scratchpad/coverage/parallel-mn-ia-ne-sd/pickapartva-implementation-replay/full \
  --chunk-pages 15
```

Repeat with `--chunk-pages 5` and a different output directory to exercise three
serialized chunks. The replay uses the real durable cursor codecs and
`connectorChunkMetrics`, verifies every saved body against its receipt, writes
canonical vehicles and exact chunk accounting, and checks terminal replay makes
zero reads/callbacks. The CLI has only saved transport and cannot fall through to
live fetch. The exported soak driver delegates transport to its caller and has no
database, Algolia or Blob persistence.
