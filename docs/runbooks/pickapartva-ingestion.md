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
validates every physical owner and unfiltered control, recovers donors hidden
by Set Date ties, and closes pages 1, 2 and the terminal page before any
callback. The measured catalog has 15 pages:
500 cards on pages 1 through 14 and 449 on page 15. The terminal page has no
Next link. These controls establish a bounded stable traversal, not an atomic
provider snapshot or a source-published total count.

The safety ceiling is 15 catalog pages, 500 cards per page, 4 MiB per body,
32 requests per chunk (15 pages, at most 14 set-date searches and 3 closing
reads), 25 seconds per request/body read and five minutes of provider work per
chunk. The shared URG host turn is estimated at 24 requests of 8.5 seconds
(204 seconds), which reserves six searches and still grants a turn after the
two-minute queue waits seen at 07:00. Measured reads take longer: about 14
seconds per catalog page at November 19 latency (11 at November 12 latency),
10 per search and 5 per edge-cached closing read, about 286 seconds with six
searches. A turn that waited long reaches the chunk horizon first and the
chunk is deferred whole. A turn that waited under 40 seconds reaches the
five-minute work limit first, so a census needing more than about seven
searches (twelve at November 12 latency) fails with the chunk budget error.
Neither advances a checkpoint, and previous inventory is preserved. At 500 cards per page, a catalog above 7,500 cards
publishes page 16, which the page guard rejects. Requests are serial,
unredirected HTTPS GETs with no retry. Production
requests include a 1,600 ms finalizer delay on success and failure, preserving
spacing across separately created durable chunks.

`streamPickapartvaInventory` accepts `startCursor`, `maxPages`, `onBatch` and
optional `onYards`. `maxPages` counts emitted raw-page partitions, from 1 to 15. Every partial emission chunk still validates the full native census.
Normal ingestion uses 15, requiring 18 controls plus one search per tied date. Three five-page chunks require
54 controls. Prefix pages are rebuilt without repeating inventory callbacks.

`PickapartvaCursorSchema` validates these states:

- `start`: source `pickapartva` and phase `start`.
- `makes`: the make splits of yard searches that reached the 500-card cap.
  Each holds the Set Date, yard, native make list and the completed make
  searches in that order, with their URLs, hashes and donors. It emits
  nothing. See [Set Date ties](#set-date-ties).
- `pages`: whole-snapshot fingerprint, all ordered page URL/hash receipts,
  the set-date search date/URL/hash receipts (empty in earlier checkpoints),
  the complete make splits those searches used (empty in earlier
  checkpoints), `lastPage`, `nextPage` and cumulative `processed`,
  `emitted`, `rejected` and `duplicates` counters. Rebuilt prefix counters
  must exactly match before another batch is emitted.
- `complete`: source `pickapartva` and phase `complete`. Replaying it performs
  no requests, callbacks or accounting increments.

Changed pages, truncation, foreign/filtered URLs, owner changes, unknown yards,
forged cursors, conflicting required identities or failed closing controls abort
before callbacks and before terminal reconciliation. A failed chunk returns no
advanced checkpoint. Previously accepted inventory stays intact. Inspect the
native contract and restart a fresh run after resolving drift.

## Set Date ties

The catalog sorts by Set Date with LIMIT/OFFSET on that non-unique key, and
each offset orders a date's donors differently. A page boundary that splits a
date can show one donor of that date on both pages and never show another. The
November 12 census repeated 18 cards this way at six dates (2026-11-07,
2026-11-04, 2026-10-28, 2026-10-24, 2026-10-20 and 2026-10-16), so 18 donors
were invisible to every catalog page.

Because dates are strictly ordered across pages, a date's donors fill one
fixed run of catalog slots. Each card of that date repeated on a later page
stands in for exactly one hidden donor of that date. After the page chain, the
connector requests the native search
`https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&search=YYYY-MM-DD` for
every date with repeated cards, in catalog order. A search page must pass the
same owner, footer, yard selector, make selector and `iisupullurgid` checks,
reflect the searched date in its form, publish no pagination, hold 1 to 499
cards (0 to 499 for a make search), and list only donors set on that date.
Together a date's searches must add exactly as many
unseen donors as the catalog repeated for that date. Otherwise the inventory
changed between reads, the census fails, and previous inventory is preserved.
Each recovered donor takes the repeated card's slot, so it is accounted once
instead of as a duplicate, and its details link is the search URL with its
stock fragment. If donors repeat while the catalog is no longer ordered by
Set Date, the census fails because hidden donors cannot be located.

The native search ignores `pagenum` and lists at most 500 cards, newest model
year first. A search that reaches 500 cards is capped and proves nothing
about further matches. A capped unfiltered search is split by yard:
`?k=1&id=TT87&search=YYYY-MM-DD` and `id=UU81`. The unfiltered search is
skipped when the catalog already shows 500 or more donors of that date. On
November 22, 2026, Fredericksburg alone held over 500 donors set on
2026-11-16, so its yard search was capped too. A capped yard search is split
by make, using every value of the native make selector in order:
`/inventory/<MAKE>/ANY/?k=1&id=TT87&search=YYYY-MM-DD`, with spaces in the
make written as underscores (`LAND_ROVER`, verified live). The census stops
at that yard search with a `makes` checkpoint and no closing reads. Later
chunks run the make searches, each in its own shared host turn, and
checkpoint after each one. No new make search starts after 180 seconds of a
chunk. Once every make is searched, the next chunk reads the census again
and takes that yard and date from the saved make searches instead of the
capped searches.

A make search must pass the owner, footer and yard selector checks, carry
exactly one `var setMake` equal to the make path, name only the searched yard
in `var urgID`, and list only donors of that make, date and yard. Its form
action must be the make path. A make with no donors answers with the native
"No Results Found" page, which has no form and cannot reflect the Set Date.
The make split must cover the catalog's native make list exactly. It must
list every donor of that date and yard the catalog shows, so the make totals
add up to the shown donors plus the repeated slots. The selector omits Tesla:
a shown Tesla keeps its catalog slot, and a hidden one leaves the split short
of the repeated slots, so the census fails. A make search that is itself
capped at 500 cards fails the run, because no narrower native split is
verified.

## Required identity and optional metadata

The connector uses the existing `inventoryVin` contract, including supported
pre-1981 serials. Required year, make, model and physical yard stay explicit.
Valid VINs from rejected descriptive metadata remain presence evidence, including
when a serialized prefix is replayed. Every raw card contributes exactly once
to accepted, rejected or duplicate accounting in its emission partition.

The saved census reconciles 7,449 cards to 7,422 unique donors, 7 invalid modern
VINs and 20 duplicate cards. Eighteen of those duplicates are Set Date tie
repeats, so tie recovery accepts 7,440 donors with 2 duplicates. Fredericksburg has 5,168 unique donors and Stafford
has 2,254. Fourteen accepted donors use older serials. Source and per-yard checks
retain the existing 10% rejection and 25% duplicate limits. The measured source
floor in shared registration is 2,474, with the existing prior-run drift
and reconciliation guards retained by shared orchestration.

Eighteen duplicate cards repeat identical native donors at Set Date ties; tie
recovery replaces each with a hidden donor. Two other VIN groups
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

The saved packet has no set-date searches, and its census repeats cards at
six Set Dates. Only the 2026-10-16 search was captured. The supported replay
of this census is `pickapartva-ties.test.ts`, which serves the same catalog
pages and closing reads from `src/server/ingestion/pickapartva-test-fixtures/`
with the captured search and five documented synthetic searches.

Run focused tests with:

```sh
bun test src/server/ingestion/pickapartva-*.test.ts
```

Replay saved pages, closing controls and set-date searches without network or
persistence:

```sh
bun scripts/soak-pickapartva.ts \
  --saved <evidence directory> \
  --searches <directory of search-YYYY-MM-DD.html bodies> \
  --output <local replay directory> \
  --chunk-pages 15
```

`--searches` must hold one saved search body per repeated Set Date. Without
it, or with a date missing, the replay names the search it needs and writes
nothing.

Repeat with `--chunk-pages 5` and a different output directory to exercise three
serialized chunks. The replay uses the real durable cursor codecs and
`connectorChunkMetrics`, verifies every saved catalog body against its receipt, writes
canonical vehicles and exact chunk accounting, and checks terminal replay makes
zero reads/callbacks. The CLI has only saved transport and cannot fall through to
live fetch. The exported soak driver delegates transport to its caller and has no
database, Algolia or Blob persistence.
