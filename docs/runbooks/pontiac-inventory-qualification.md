# U-Pull and Save Pontiac qualification

See the current [source flags and census floors](provider-coverage-go-live.md).

Status on November 11, 2026: locally qualified and unpublished.
Under the current optional-field contract, replaying the saved audit emits
1,307 donors, rejects none and excludes four missing detail endpoints. The
historical fresh crawl emitted 1,303 donors and rejected three for color under
the earlier mandatory-field contract. These are separate observations of
changing public inventory. Michigan's published yard count has not changed.

## Yard and public donor contract

The official [Pontiac location page](https://u-pullandsave.com/used-car-parts-pontiac)
publishes 240 E. Columbia, Pontiac MI 48340, phone 248-618-5000. Its directions
link identifies the business pin at 42.6684624, -83.2932624. The map iframe's
initial viewport center is different and must not be used as the yard pin.
Mason is explicitly vehicle-purchasing only, with parts-yard selection disabled;
it is not a second qualifying yard.

The native [inventory search](https://u-pullandsave.com/used-car-parts) uses:

```text
GET /api/vehicles/years
GET /api/vehicles/make/<year>
GET /api/vehicles/model/<year>/<make>
GET /api/vehicles/search/?store=105&year=<year>&make=<make>&model=<hollanderModel>
GET /api/vehicles/<vehicleID>
```

Search results carry donor IDs, stock, year, make/model, color and row. Details
add VIN, source yard timestamp, availability and donor images. The native
`/vehicles/<vehicleID>` page accepts only `YARD` donors; resale vehicles use a
different route. The inspected donor page publishes that same vehicle ID in
its canonical URL.

Each image has a `referenceID` matching the donor. Use published
`imageMedium` URLs under `https://static.u-pullandsave.com/medium/`, not
constructed filenames or resale images. Two stock-spread sample URLs returned
HTTP 200 `image/jpeg` and were visually checked as actual vehicles. Original
photos can exceed 2 MB; their published medium versions were 216,297 and
171,713 bytes. These observations do not verify every image.

## Qualification evidence

- All 15 native recent-arrival controls were recovered through their published
  year/make/model searches. This is a positive control, not a full catalog.
- Cherokee searches using native years 1990 and 2000 return the same five
  donors spanning 1998-2014. Grand Cherokee searches using 2000 and 2014 return
  the same eleven donors spanning 2003-2016. Search year is therefore not an
  exact donor-year partition.
- A stock-spread 60-donor sample drawn from a partial union of 501 search
  donors passed field checks without rejections or unavailable records. Each
  has a valid VIN, year/make/model, known color, native stock, numbered yard row,
  exact source yard timestamp and a published donor-photo URL tied to its ID.
  This is a sample, not the full-catalog rejection rate.
- Nineteen earlier sample VINs matched neither Row52 active inventory nor
  AutoRecycler global inventory. Each exact-VIN filter returned its own live
  positive control. Refresh the sample across the completed catalog before
  admission; zero sampled matches do not prove exclusivity.

## Completed directory and donor audit

The complete year directory spans 1961-2027, with empty make directories for
2026 and 2027. All 3,204 year/make directories were traversed, yielding 25,233
model mappings. These are interchange directories, not an independent donor
inventory total.

The final base search traversed 2,383 make/Hollander-model filters. Grouping by
`make`, `hollanderModel`, `trueModel`, `mmdCD` and `mmdCategory` yields 3,131
mapping variants, represented by 3,130 distinct native queries. All 747
additional mapping queries finished. They added no donor outside the base union
of 1,311 IDs, and all 15 recent-arrival controls were recovered.

Mapping variants must still be retained in a connector. Individual model
result sets differ across them, including Caprice and Impreza; a representative
year per make/Hollander model is insufficient. Sixty additional earliest/middle
year controls within unchanged mappings returned no new IDs. This does not
establish universal year equivalence or independently verify a provider total.
The largest observed result has 56 donors. Investigate any future search
reaching 100 rows; that remains an audit guard, not a proven provider cap.

All 1,311 observed IDs were checked. Four detail endpoints returned HTTP 404
and remain excluded without fabricated fields. The other 1,307 explicitly
report `YardLocation: "YARD"`; their required search/detail identities and
descriptive fields agree. Under the original mandatory-field contract, 1,304
passed all field checks. Two publish `UNKNOWN` color and one publishes null
color, producing a historical rejection rate of 3/1,307 (0.23%). The current
optional-field contract admits all 1,307, with null color on those three. No
duplicate VIN or stock was found. The selected medium-photo URLs are also unique.
An absent image display order is optional metadata and does not invalidate
otherwise verified donor-photo references.

A fresh stock-spread sample of 60 complete donors matched neither Row52 active
inventory nor AutoRecycler's exact-VIN search on November 11. Both public
positive controls succeeded. This sample does not establish catalog-wide
exclusivity. The earlier visual checks cover two real donor photos, not every
image in the union.

## Connector and validation

The `pontiac` source runs by default. `ingestion-source-pontiac` pauses it
when it serves false. Absent, malformed and failed flag evaluations keep it enabled.

The connector first verifies official yard contact metadata and recent-arrival
controls, then enumerates years, year/make model directories, all distinct
mapping queries and donor details. Checkpoints retain mapping variants, the
deduplicated donor union, VIN/photo identities and quality counters. Identical
mapping tuples use their latest native year. This implements the observed native
mapping contract, not an independently declared provider inventory total.

Each durable chunk permits 16 requests, with a configurable bound of 1-32.
Requests use the shared HTTP retry helpers and bounded 4 MiB UTF-8 reader,
20-second request/body timeouts and a three-minute chunk timeout. The production
request gate allows one request per 1.6 seconds. Years and make lists must stay
below 150 entries, model lists below 300, and control/search lists below 100.
These are conservative audit guards, not proven provider result caps. Cursor
collections are limited to 10,000 pairs, mappings, queries or donors.

Partial HTTP responses, redirects, unexpected MIME types, invalid JSON,
contradictory donor/stock identities, missing positive controls and exhausted
bounds prevent completion. Only native detail HTTP 404 and explicitly non-yard
donors are unavailable. A valid native VIN or genuine pre-1981 serial and
year/make/model remain required. Color, stock, photo, inventory date and yard
position are optional. Missing values stay null, unknown color stays null and
unusable or future dates stay null. Valid detail metadata takes precedence,
with native search metadata retained when detail omits it. Repeated search
results enrich optional metadata without erasing known values. Conflicting
known stock, color or row still fails. Provided photos must retain the trusted
source URL and donor reference; a nonempty photo list without a valid matching
photo remains rejected. Provided stock remains unique, including stock first
seen in detail responses. VIN and provided-photo uniqueness persist across
serialized checkpoints.

Incomplete active donors supply valid VIN presence evidence but cannot emit
listings. Completion retains the unchanged 10% rejection guard. Shared source
validation also requires at least 435 complete donors and the existing
previous-snapshot drift limit.

The historical cached connector replay under the original mandatory-field
contract made 7,715 simulated public requests across serialized 16-request
checkpoints. It emitted 1,304 complete donors, rejected three and excluded four
HTTP-404 details, matching the audit exactly. Shared
source validation accepted its terminal result. The largest observed serialized
checkpoint was 445,715 bytes. This is a cached replay, not fresh public crawl
qualification.

A new offline replay under the optional-field contract traversed the same saved
responses through 7,715 simulated requests and serialized 16-request checkpoints.
It emitted 1,307 donors, rejected none and excluded the same four native 404
details. Shared source validation accepted the terminal result without errors.
Three emitted donors have null color; the saved responses provide all other
optional fields. The largest checkpoint remained 445,715 bytes. No public
requests, database writes, search-index writes or alert writes were made.
This verifies the saved evidence with the revised admission contract, not a
new observation of live inventory.

The historical fresh public crawl under the original mandatory-field contract
completed at 16:17:58 UTC on November 11, after starting at 12:51:55 UTC. Its
7,710 requests traversed the native catalog and all 1,306
observed donor details through serialized checkpoints. It emitted 1,303 complete
donors, rejected three and excluded none. The rejection rate was 3/1,306
(0.23%), below the unchanged 10% limit. Shared source validation accepted the
terminal `complete` result with no errors. No previous accepted snapshot was
supplied, so this does not establish production count drift. Batches were
counted and discarded, with no database, search-index or alert writes. The
largest serialized checkpoint was 445,713 bytes.

Historical validation before the optional-field update on November 11:
35 focused Pontiac tests passed, `bun run check` passed, and `bun test src`
passed 1,263 tests. The optional-field update passes 45 focused Pontiac tests,
changed-file lint and formatting, and `git diff --check`. Full-project validation
of the combined coverage work remains pending. Tests cover serialized traversal,
mapping variants, positive controls, native search boundaries, identity conflicts, VIN/photo
deduplication across resumes, missing details, rejection counts, malformed
responses, body limits and pause flags.

Run the public read-only soak with:

```sh
bun run soak:sources -- --sources=pontiac
```

The default 10,000-request budget covers the observed native traversal. A
smaller `--max-pages` budget returns `paused`; it does not qualify the source.
Inventory batches are counted and discarded. For interruption recovery, retain
the last serialized durable cursor and metrics, and resume that checkpoint.
Do not skip requests, erase quality counters or substitute an arrival feed for
the full mapping traversal. Failed requests return no advanced checkpoint.
If a recent-arrival control disappeared during traversal, first verify its
current official status. An unavailable control requires a new source traversal
with fresh controls, not removing it from the saved checkpoint.

The completed fresh crawl's cursor and counters are saved in
`.scratchpad/coverage/pontiac-live-connector-state.json`; its log is
`pontiac-live-connector.log` in the same directory. The terminal receipt is
`pontiac-live-connector-result.json`. Do not report a later partial or failed
refresh as qualified. The cached replay receipt is
`.scratchpad/coverage/pontiac-connector-replay-result.json`. The optional-field
replay receipt is
`.scratchpad/coverage/parallel-mn-ia-ne-sd/pontiac-optional-fields-replay-result.json`.

## Remaining admission work

Fresh public crawl qualification is complete. The connector requires native VIN
and year/make/model, preserves nullable optional metadata, verifies
donor/stock/store identity and provided photo
references, handles missing details explicitly and retains the unchanged
rejection limits. A request bound pauses honestly; an unsafe result boundary
fails instead of accepting a partial
catalog. Optional unpublished specifications remain null.
The user's local-only hold remains in effect. A separately authorized production
rollout and confirmation in the live directory are still required before adding
Pontiac to Michigan's published count. Serve false from its source flag to pause ingestion when needed.

Scratch receipts are under `.scratchpad/coverage/`: `pontiac-overlap-report.json`,
`pontiac-field-union-report.json`, `pontiac-mapping-coverage-report.json` and
`new-leads/pontiac-details-manifest.json`. The directory, search, variant and
year-control manifests are in `new-leads/pontiac-controls/`. Cached requests
record their exact public request paths and JSON responses so interrupted audits
can resume without refetching completed work.
