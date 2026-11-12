# River Valley Truck Parts ingestion

Status on November 12, 2026 UTC: locally qualified from saved public evidence,
disabled and unpublished. No production ingestion, index, alert or directory
write is authorized by this qualification.

## Physical yard and active donor scope

The native [Salvage catalog](https://rivervalleytruckparts.com/new-arrivals/?f-condition=nw)
identifies River Valley Truck Parts at 288 W South Tec Drive, Kankakee IL 60901,
phone 815-936-0406. Its source-linked
[business map pin](https://maps.app.goo.gl/nTFtNTPAkUHRpDHS9) resolves to
41.0852855, -87.8751744 in the business `!3d`/`!4d` fields. The map viewport
longitude differs and is not the yard coordinate.

The native `f-condition=nw` filter selects Salvage. The four advertised Complete
retail units use a separate condition and remain outside this traversal. A
source-linked [donor detail](https://rivervalleytruckparts.com/truck-description/?truck=196762)
explicitly says Now Wrecking and repeats the listing VIN, year, make, model,
lot and physical ownership. This is one active-scope control, not a separate
full inventory. The connector verifies a current first-page donor detail at
the start of each crawl.

The shared `truck-parts-catalog` parser handles the fixed TPI card and
pagination grammar also used by White & Bradstreet. Source-owned wrappers
verify River Valley's physical metadata, exact catalog/detail destinations,
and active detail control. Native photos are accepted only from the
`images.truckpartsinventory.com/trucks/24174/` account. Loading images,
placeholders and other accounts become null. No image filename is invented
and the cached replay does not fetch photos.

## Admission and traversal contract

A source-published valid VIN, or genuine pre-1981 serial with an eligible
native year, and native year/make/model are required. VIN decoding does not
fill missing descriptive fields. Required-field rejects retain independently
valid VINs as presence evidence without emitting listings.

Color, stock, photo, source inventory date and yard position are optional.
Missing values and known placeholders stay null. Native lot numbers and valid
photo URLs are preserved. Color, inventory date and yard position are not
published in this catalog and stay null. Lot numbers, CMS IDs and the new
arrivals page name do not establish an arrival date. Engine model is retained
when provided and meaningful.

The first page and active donor detail consume two requests. Each later
nonterminal page must publish the next native Salvage URL. Header and footer
ranges, selected page, page size, native donor links and conditions must agree.
Every card publishes three matching donor-ID links. Each page carries 25
donors except the terminal page, and the terminal raw ID count must equal the
advertised total. Unexpected retail rows, duplicate native IDs, changed totals,
ignored page numbers, partial responses or ownership changes prevent
completion.

Checkpoints retain native IDs, emission/rejection/duplicate outcomes, valid
VINs, canonical YMM identity hashes and semantic page hashes. A resumed chunk
rechecks the previous native page before advancing. A separate terminal
verification phase then re-reads every processed page hash before completion.
Its verification index persists across bounded chunks without emitting donors
again. Changed boundary or prefix evidence requires inspection and a new crawl. Repeated canonical VINs with consistent
YMM emit once and count as duplicates. Conflicting YMM for the same VIN fails
the crawl.

River Valley has one physical yard. Its cumulative terminal rejection limit
remains 10%, and its separate duplicate limit remains 25%. Neither limit is
weakened for incomplete optional fields. Shared validation requires at least
1,300 unique donors and retains the previous accepted snapshot drift limit.

The default durable chunk permits eight HTTP requests, with an explicit bound
of 2-32. Requests use the shared HTTP client, a 4 MiB complete UTF-8 body
reader, 20-second request/body timeouts, no request retries and a three-minute
chunk timeout. The production request gate permits one request per 1.6
seconds. Native traversal is bounded to 400 pages and 10,000 donors. Callback
failures return no advanced checkpoint.

## Saved qualification and connector replay

The saved public crawl completed all 65 Salvage pages and observed exactly
1,604 distinct native IDs. Applying the app's VIN and make normalization
accepted 1,553 donors, rejected 49 (3.05%) and found two canonical duplicates
(0.12%). Twenty-eight required-metadata rejects retained valid VINs as
presence evidence. The 65 listing bodies and one linked Now Wrecking detail
have verified byte counts and SHA256 hashes.

The actual connector replay used those 66 saved bodies through 18 serialized
eight-request chunks. Its 140 simulated requests include nine prior-page
boundary rechecks and 65 terminal verification reads. It emitted 1,553 donors, rejected 49, counted two duplicates
and preserved the same 28 presence-only VINs. Every emitted native ID/VIN pair
and the entire presence set match the independent audit. Shared source
validation accepted the terminal result without errors. The largest serialized
checkpoint was 227,272 bytes.

All emitted donors have null color, inventory date and yard position. There
are 511 null photos and no null stocks in this saved accepted inventory. These
counts describe the saved responses, not a guarantee about future inventory.
The replay made no public requests and wrote no database, index or alerts.
Only the source-linked map pin was resolved separately for physical metadata.

Source evidence is under
`.scratchpad/coverage/parallel-me-nh-vt/rivervalley-requalification/`:

- `checkpoint.json`, `identity-audit.json` and `integrity-replay.json` record
  complete enumeration, required-field decisions and receipt integrity.
- `page-001` through `page-065` retain raw HTML bodies and JSON receipts.
- `native-active-scope-control.html` and its receipt retain the Now Wrecking proof.
- `shared-parser-field-parity.json` checks all native ID/year/make/model/VIN/lot
  and engine fields after the nested price-heading regression was fixed.

Connector artifacts are under
`.scratchpad/coverage/parallel-mn-ia-ne-sd/rivervalley/`:

- `connector-replay-result.json` records terminal counts, validation and artifact hashes.
- `canonical-inventory.json` contains the 1,553 actual emitted canonical donors.
- `presence-vins.json` contains the 28 actual presence-only VINs.
- `replay-connector.ts` reruns the saved responses without network fallback.
- `native-yard-map.json` and `.body` preserve physical pin evidence.

## Local verification and publication hold

Focused tests cover native traversal, nested listing fields, active ownership,
required identities, genuine older serials, nullable optional fields, duplicate
VINs, conflicting YMM, serialized cumulative quality, changed page boundaries,
native totals and scope, HTTP/body guards, callback failure and partial soaks.
The stale-prefix and resumed-verification quality regressions each failed
before their fixes. Focused verification passes 62 tests, including 15 shared
parser tests. Changed-file lint and formatting pass. Full-project typecheck
remains part of the parent coverage qualification; its latest errors are in
concurrent source work, with no River Valley errors.

The count/discard soak driver is `scripts/soak-rivervalley.ts`. A bounded run
that returns `paused` is incomplete and cannot qualify the source. Preserve its
last validated cursor and counters for recovery. No production rollout or
published Illinois yard-count change follows automatically from this work.
Keep the source disabled until the parent overlap, review and admission work
is complete and publication is separately authorized.
