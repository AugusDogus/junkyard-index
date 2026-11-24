# Pick-A-Part Virginia ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

The `pickapartva` connector reads the native global donor inventory for two
verified physical yards: Fredericksburg (`TT87`, 9001 Patriot Hwy) and Stafford
(`UU81`, 164 Norman Rd.). Native selectors and footer text establish ownership.
Saved U-Pull Scan JSON-LD maps corroborate coordinates at those exact addresses.
Full-service rows remain eligible donor inventory. No contact, account, cart,
image download, alternative host, inferred VIN or guessed detail route is used.

## Native protocol and checkpoints

Each census chunk enumerates the complete literal native Next chain from
page 1, validates every physical owner and unfiltered control, and finds the
donors Set Date ties hid. When every tie date already has recovered donors
(see [Set Date ties](#set-date-ties)), it closes pages 1, 2 and the terminal
page before any callback. The measured catalog has 15 pages: 500 cards on
pages 1 through 14 and 449 on page 15 (9 on November 24, 2026). The terminal
page has no Next link. These controls establish a bounded stable traversal,
not an atomic provider snapshot or a source-published total count.

The safety ceiling is 15 catalog pages, 500 cards per page, 4 MiB per body,
18 requests per census chunk (15 pages and 3 closing reads), 25 seconds per
request/body read and five minutes of provider work per chunk. The shared URG
host turn is estimated at 18 requests of 8.5 seconds (153 seconds), so a turn
is still granted after the two-minute queue waits seen at 07:00. Measured
reads take longer: about 14 seconds per catalog page at November 19 latency
(11 at November 12, 10 to 21 on November 24) and 5 per edge-cached closing
read, about 225 seconds. A turn that waited long reaches the chunk horizon
first and the chunk is deferred whole. Set-date searches take about 10
seconds each, so the six tie dates of November 24 could not also fit the
census's five-minute work limit; they run in their own chunks. No failed
chunk advances a checkpoint, and previous inventory is preserved. At 500 cards
per page, a catalog above 7,500 cards publishes page 16, which the page guard
rejects. Requests are serial, unredirected HTTPS GETs with no retry.
Production requests include a 1,600 ms finalizer delay on success and
failure, preserving spacing across separately created durable chunks.

`streamPickapartvaInventory` accepts `startCursor`, `maxPages`, `onBatch` and
optional `onYards`. `maxPages` counts emitted raw-page partitions, from 1 to 15. Every partial emission chunk still validates the full native census.
Normal ingestion uses 15. Three five-page chunks require 54 controls. Prefix
pages are rebuilt without repeating inventory callbacks.

`PickapartvaCursorSchema` validates these states:

- `start`: source `pickapartva` and phase `start`.
- `searches`: one recovery per tie date of the census that planned them. Each
  holds the Set Date, its repeated slots, the card keys of its shown donors,
  the epoch milliseconds of that catalog read (`startedAt`), the searches run
  so far (yard, make, URL, hash and whether it was capped), the hidden donors
  they found with the search that listed each, and the searches still
  pending. It emits nothing.
- `pages`: whole-snapshot fingerprint, all ordered page URL/hash receipts,
  the set-date search date/URL/hash receipts, the resolved recoveries those
  searches came from, `lastPage`, `nextPage` and cumulative `processed`,
  `emitted`, `rejected` and `duplicates` counters. Rebuilt prefix counters
  must exactly match before another batch is emitted.
- `complete`: source `pickapartva` and phase `complete`. Replaying it performs
  no requests, callbacks or accounting increments.

A checkpoint written by the earlier `makes` phase no longer parses; start that
run again from `start`.

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
were invisible to every catalog page. The November 24 census repeated 25 cards
at six dates, two of them set past the 500-card search cap in Fredericksburg
alone (568 donors on 2026-11-21 and 715 on 2026-11-16).

Because dates are strictly ordered across pages, a date's donors fill one
fixed run of catalog slots. Each card of that date repeated on a later page
stands in for exactly one hidden donor of that date. So with the inventory
unchanged, any donor of that date a native search lists and no catalog page
showed is one of the hidden donors, and once a date's searches list as many
such donors as the catalog repeated, every hidden donor of the date is found.
This holds whether or not a search reached the cap.

The census that finds unrecovered tie dates plans one recovery per date and
stops before its closing reads with a `searches` checkpoint. Later chunks run
the pending searches, each in its own shared host turn. No new search starts
after 180 seconds of a chunk, and a turn deferred after at least one search
ends the chunk too. The checkpoint is written when the chunk ends, so a
failed search discards that chunk's searches and the retry starts from the
chunk's starting checkpoint. Once every recovery is resolved, the next chunk
reads the catalog again. A recovery answers for that census only when the
catalog shows its date with the same repeated slots and the same shown
donors, and when it is at most 60 minutes old; any other tie date is planned
again from that read. The published census then replaces each repeated slot
with one recovered donor of its date and closes pages 1, 2 and the terminal
page.

Each date's searches escalate and stop as soon as the date is recovered:

1. The native search across every yard,
   `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&search=YYYY-MM-DD`.
   It is skipped when the catalog already shows 500 or more donors of that
   date, since it would be capped.
2. If that search was capped (or skipped), each yard in turn:
   `?k=1&id=TT87&search=YYYY-MM-DD` and `id=UU81`. A yard that set no donors
   that day answers with the native "No Results Found" page, as Stafford did
   for 2026-11-21 on November 24, 2026.
3. For each capped yard search, one search per value of its native make
   selector: `/inventory/<MAKE>/ANY/?k=1&id=TT87&search=YYYY-MM-DD`, with
   spaces in the make written as underscores (`LAND_ROVER`, verified live).
   Makes run in order of how many donors the capped search listed, most
   first, then in native order, so the makes most likely to hold an unlisted
   donor run first.

The native search ignores `pagenum` and lists at most 500 cards, newest model
year first (the capped 2026-11-21 search lists model years 2024 down to
2007). A capped search proves nothing about further matches, but every donor
it lists is a real donor of that date and scope, so it still counts. The
form's single search term matches stock, year, Set Date and VIN as
substrings and cannot combine a date with a stock prefix (November 24, 2026:
`2026-11-21 PAP1764` returns no results), so make searches are the narrowest
verified split. A make search that is itself capped fails the run, because no
narrower native split is verified.

A search page must pass the same owner, footer, yard selector, make selector
and `iisupullurgid` checks, reflect the searched date in its form, publish no
pagination, and list only donors set on that date in its yard and make. A
yard or make search must carry exactly one `var setMake` equal to its make
path (`ANY` for a yard search) and name only the searched yard in
`var urgID`. A yard or make with no donors answers with the native "No
Results Found" page, which has no form and cannot reflect the Set Date. The
search across every yard may not answer empty.

Searches that list more unseen donors of a date than the catalog repeated, or
run out of pending searches with fewer, mean the inventory changed between
reads: the rejection is transient and a crawl later in the day can pass. If
donors repeat while the catalog is no longer ordered by Set Date, the census
fails because hidden donors cannot be located. Each recovered donor takes the
repeated card's slot, so it is accounted once instead of as a duplicate, and
its details link is the search that listed it with its stock fragment.

A date that stops early is not cross-checked against the scopes it did not
search. Its recovered donors are trusted for 60 minutes, and only while the
census that publishes shows the date with the same repeated slots and shown
donors; that census still closes pages 1, 2 and the terminal page.

The native make selector omits Tesla. A hidden Tesla donor is found only if a
search across every yard or one yard lists it; otherwise its date runs out
of searches and the rejection is transient.

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
with the captured search and five documented synthetic searches. Its tie
dates fit one search each, so the replay plans them in one census, runs them
in one search chunk and publishes from a second census.
`pickapartva-recovery.test.ts` covers a date set past the search cap: a
capped yard search, an empty yard and make searches that stop at the make
listing the hidden donor.

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
nothing. The replay serves only searches across every yard; a date that
needs yard or make searches cannot be replayed from saved evidence.

Repeat with `--chunk-pages 5` and a different output directory to exercise three
serialized chunks. The replay uses the real durable cursor codecs and
`connectorChunkMetrics`, verifies every saved catalog body against its receipt, writes
canonical vehicles and exact chunk accounting, and checks terminal replay makes
zero reads/callbacks. The CLI has only saved transport and cannot fall through to
live fetch. The exported soak driver delegates transport to its caller and has no
database, Algolia or Blob persistence.
