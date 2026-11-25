# AutoRecycler inventory and owned locations

The November 16 [customer expansion receipt](provider-coverage-ario-vinplus-tpi.md)
adds twelve native Crush-fed yards, including Smith Auto, for 33 allowlisted yards with CFC Recycling.
The daily grouped census remains 37 requests under the unchanged 48/hour budget.
The November 15 baseline and migration evidence below remain historical receipts.

Combined offline replay accepts 32,344 vehicles with 33 publication chunks.
The saved 32-yard opening plus CFC yields 3,295 opening items across all 33 yards.
The full run uses 33 rank windows, one closing check and three discovery/directory
requests, 37 total with eleven requests below the 48/hour cap.

## Preserved yards (November 25)

Preserved yards (undated legacy yards and quarantined Ario yards) keep their
inventory while they lag AutoRecycler's previous accepted publication by at
most 7 days. Days without an accepted AutoRecycler publication do not count,
so an outage never releases a yard. A yard with no publication date is measured
from its cars' newest sighting instead. Once released, its unlisted cars go
missing and depart.

## November 18 failure isolation

The November 18 production runs did not reconcile AutoRecycler. The 07:00 and
12:41 UTC attempts reached the legacy terminal date guard and found six yards
without any parseable addition dates. The 15:04 attempt stopped at Birmingham's
grouped closing check. #176 quarantined admission failures only during saved-yard
publication, after grouped capture had already required every yard to be stable.

Grouped capture now records a changed yard's opening and observed totals and
window counts in its private checkpoint. It stops requesting that yard, emits no
inventory or presence evidence for it, and preserves its preceding inventory and
missing/delete counters using the same quarantine manifest as admission failures.
Other yards still require every rank window and an unchanged closing bookend.
Changes in total during enumeration and first-window changes during closing both
quarantine the entire yard. Ownership, ranks, response shape and pagination
contradictions still fail closed. No additional requests or whole-run retries
are introduced; the 100-rank windows and 48-request rolling-hour cap are unchanged.

At most `floor(configured Ario yards * 10%)` changed yards may quarantine in one
run, currently three of 34. This reuses the existing rejection tolerance at the
yard boundary; a fourth changed yard fails before publication. The per-yard
admission guards, 50% yard drift, 100-vehicle source floor, source rejection and
duplicate limits, eligible-scope drift and stale-customer removal bound remain.

For the legacy crawl, at most 10% of the fully observed yard date-evidence set
may lack dates, and only yards excluded throughout that crawl may quarantine.
These yards are explicitly preserved and warned about, rather than treated as
proven stale. An undated yard eligible to emit inventory, or a larger undated
fraction such as a renamed feed-wide date field, still fails. Dated stale yards
remain in normal missing reconciliation. Deterministic grouped validation and
legacy date-contract failures are now marked for the existing scheduler, which
otherwise mistakes them for transient transport failures. This explains the
three `published_degraded` attempts; the scheduler's two-hour cooldown and
three-attempt transient policy do not need changing.

Read-only production evidence shows the last accepted AutoRecycler run was
November 17 at 07:41:01 UTC, with an old complete cursor lacking a freshness
manifest. Every November 18 new-code attempt was rejected. Santa Maria still
had 4,207 non-missing rows, newest addition August 19, 2026; Santa Paula had three,
newest addition July 19, 2022. No accepted freshness-manifest run had retired
them. The existing 60-day selector is correct. Once a run completes, these dated
stale yards emit no vehicles, metadata or presence evidence and enter ordinary
missing reconciliation. Visibility/deletion still follows the existing grace
policy, rather than an immediate production patch.

The published make-equals-model audit found 1,529 rows across legacy inventory.
The two current legacy fixture yards have no structured model field. Removing
the name parser's make-as-model fallback keeps A-1 at 183 accepted / zero rejected;
JDM changes from 556 accepted / ten rejected to 540 / 26, including 16 newly
rejected valid-VIN rows missing models. Three VIN-less JDM rows remain exclusions:
26 / 566 eligible observations is 4.59%, below the unchanged 10% guard. Ario
continues using its native `ario_model` / `model` fields. Rejected valid VINs keep
existing presence protection; no model is decoded or fabricated. Regression
replays verify the revised 723 accepted legacy donors and unchanged exclusions.

The investigation made one paced, locked Linder's GET and read-only production
queries. Captures and count receipts are local to `.scratchpad/source-failures/`.
No ingestion run, production write, deployment or merge was performed.

## CFC qualification, November 16, 2026

CFC Recycling's official inventory page embeds the native Ario customer yard
`cfc-recycling`, UUID `9e650335-4efb-4664-ba19-b4f22a0f1775`, organization
`6ce46a2f-1870-4a07-9f57-52d64f524c68`. Its exact-address LocalBusiness
record supplies 2716 Dowdy Ferry Rd, Dallas, TX 75217 and
32.6619785, -96.6729032. Ario supplies no coordinates for this yard, so this
owned point is the explicit location override. No legacy ID is known.
Native Ario yards use `ario:<yard UUID>` consistently for canonical location,
freshness and published-customer drift protection. Migrated location keys stay
unchanged; no fabricated legacy ID participates in feed selection.

All five 100-rank windows and a separately fetched closing window cover
422 records: 407 accepted, 15 rejected, no exclusions or duplicates (3.55%
rejected). Embedded spaces and Cyrillic look-alikes remain invalid under the
existing VIN policy. No guessed corrections are applied. The complete saved
Ario replay at CFC qualification accepted 19,212 vehicles across twenty current yards; Santa
Maria remains stale in this census.

Qualification used fourteen serial live requests, including owner evidence,
identity discovery, the complete census and a shared 21-yard group probe.
The live group returned all 21 requested yard metadata entries and 2,095
items. CFC's 422 ranks fit inside the existing largest yard's 33 windows,
so the daily budget stays **37 requests against the unchanged 48-request
hourly cap**, with eleven requests of headroom. No quota-exhaustion probe
was made. Group bounds remain exactly 100 items per allowlisted yard.

The CFC-only staging replay used 34 capture chunks, 21 yard publication chunks and
one legacy terminal stand-in, 56 total versus 55 before CFC. Each capture
chunk still reads one grouped window; publication uses saved responses and
adds no HTTP requests. The workflow loops over chunks without a fixed total
step cap. All existing per-request, chunk, rank, retry and rate-limit guards
remain in place. CFC uses the existing `autorecycler` source flag; no flag
was enabled and no production inventory was written.

## Ario migration and freshness, November 15, 2026

Most AutoRecycler customers moved from the Bubble feed to Ario in August 2026.
The old feed still serves frozen rows, including a one-time October 2024 copy
of twelve LKQ yards. Only A-1 Metals (CA) and JDM (NC) still add vehicles there.
The twelve LKQ organization IDs and their children are excluded by the same
ownership policy as Pull-A-Part. Their live inventory belongs to `pyp`.

The `autorecycler` source now reads Ario for twenty verified customer yards,
with nineteen currently fresh. Santa Maria is present but its newest addition
is August 24, so it is hidden. Shelby (November 6) and Lincolnton (November 5)
are current. The 263-yard Ario marketplace also mirrors Pick-N-Pull, Pick Your
Part and Pull-A-Part. Those copies are not AutoRecycler customers and are not
in the explicit customer allowlist. Do not broaden it based on name matches.

The public SPA bundle exposes a browser publishable key and the anonymous
`search-inventory` edge function on `zqfzqcyteuemzbnwtmcr.supabase.co`.
The current search response includes VINs; the detail endpoint returns the same
VIN and is not needed per vehicle. Vehicle links use `/search?yard=SLUG&inv=ID`.
The client discovers the public bundle/key once per run and saves the session and
yard directory in private snapshot storage. Requests are serial and paced at least
2.2 seconds apart, including across chunk boundaries. No credentials or privileged
Supabase access are used.

Ario explicitly rejects `per_yard_limit` 500 and 1,000 with a maximum of 100.
Use **100 ranks per yard**, grouping all twenty allowlisted yards into each search
and omitting yards once their declared rank bound is exhausted. Read every rank
window, including short or empty windows, because suppressed rows leave holes.
The grouped response's top-level `total` describes its first yard, not the sum;
validate each yard's own metadata. One grouped closing read must match every
publishing yard's opening count and items before any inventory is emitted;
changed yards follow the bounded quarantine policy above. Publishing then
replays the saved windows through the existing per-yard validator. Suppressed and
removed rows are exclusions; malformed VINs or required fields are rejections.

The November 15 census needs **37 Ario requests per daily run**: two for SPA/key
discovery, one directory read, 33 grouped search windows (largest yard: Santa
Maria, 3,297 ranks), and one grouped closing check. This includes the stale yard
so it can return automatically. All nineteen current yards together need only
15 windows, but the stale yard still requires complete enumeration. Legacy Bubble
reads are separate and do not consume this Ario budget.

The earlier research reached HTTP 429 on its 98th search call (request 102
of 108 mixed requests recorded in that session). Ario returned `search_inventory_ip_yard_per_hour`, so this is an
observed hourly restriction, not proof of an exact global 108-request quota.
Use a conservative **48 total Ario requests per rolling hour** cap, including
discovery and failed calls, leaving 11 requests of local headroom on the measured
census and more than half the observed research traffic unused. Larger inventories
pause at that cap instead of bursting through it. Five paced follow-up probes
confirmed the larger-limit rejection and stable grouped 100-rank windows without
hitting 429. Do not probe the quota to exhaustion in production.

Each successful grouped window and the next offset checkpoint together using the
existing private snapshot store. A 429 saves that progress without source errors
or failure attempts. The cursor records `retryAt`, and the ingestion workflow uses
its existing durable `sleep(Date)` before the next chunk. Honor a valid Retry-After
(seconds or HTTP date); absent or malformed headers wait one hour from the 429.
The local cap waits until its hour ends with a one-second margin. After waking,
only the unfinished window is retried; bundle discovery, directory reads and
completed windows are reused. The closing stability check remains mandatory even
after a long pause. If inventory changed, quarantine that yard within the bound
above; beyond that bound, fail validation and preserve the prior published inventory. Snapshot cleanup also removes these private progress blobs.
After 24 consecutive rate-limit pauses (roughly one day at the default hourly
wait), the source fails instead of holding the run open indefinitely. The count
survives checkpoints and resets after a completed rank window. Published inventory
is preserved. Inspect the quota and shared-IP traffic before starting a new run.

A yard qualifies only if a usable vehicle has an added date within the previous
60 days, inclusive, and no later than the run's fixed clock. Sync timestamps,
modification timestamps, missing dates and future additions cannot qualify it.
All inventory from a qualifying yard is included, not only its recent arrivals.
Fresh legacy yards are discovered by a bounded date-filtered keyset traversal
before the Ario reads. If both feeds have a yard, the feed with the newest valid
addition wins, with Ario winning ties. The existing organization location key is
preserved. A stale yard emits neither metadata, vehicles nor VIN observations;
its old vehicles enter normal missing-vehicle reconciliation and it returns
automatically after a recent addition. No production data patch is required.
Listings with no parseable addition dates anywhere in their yard are a provider
contract failure, not evidence that the yard is stale. Ario checks active listings
before emitting the yard. The unfiltered legacy crawl accumulates date evidence
across checkpoints. Undated excluded yards follow the bounded quarantine policy
above. A feed-wide date rename or an undated emitting yard still blocks completion,
including when date-filtered freshness discovery silently returns no rows.

The 100-vehicle overall floor, 10% rejection cap, 25% duplicate cap and 50% drift
ratio remain unchanged. Drift now compares AutoRecycler against the published
inventory of the still-eligible yards. It also checks the 50% limit per eligible
yard, including a yard that unexpectedly emits zero vehicles. This permits
intentional removal of stale or duplicate yards without weakening protection
against a collapsed current yard. The measured eligible baseline is 19,582
vehicles and the new snapshot has 19,544. Comparing to all 54,988 old rows would
incorrectly block the intentional retirements. Old complete checkpoints without
the freshness manifest are rejected. Start a new ingestion run after deployment.

Stale customer removals also cannot exceed **50% of the previously published
customer inventory in one run**. This reuses the existing drift tolerance and
permits an ordinary single-yard retirement while blocking a feed-wide collapse.
The baseline includes all twenty verified Ario customers, A-1, JDM and any other
currently eligible yard, even when a known customer is now stale. Previously
missing rows do not count. Intentional LKQ and unsupported legacy retirements stay
outside this customer baseline, so the initial migration remains possible.

Birmingham overrides Ario's downtown placeholder using the official
[yard address](https://ezpullnpay.com/birmingham-location/), **1849 Ruffner Rd,
Birmingham, AL 35210**. The business marker in the official
[locations page](https://ezpullnpay.com/locations/)'s Google Maps embed is
**33.5567534, -86.6903392** (place `0x888911363df54255:0xad30c48e8a2ff36a`,
verified November 15, 2026). These are the marker coordinates, not the embed's
viewport center. The same override supplies vehicle coordinates and yard metadata.

On the saved November 15 census, nineteen Ario yards supply 18,805 valid unique
vehicles, and the two legacy yards supply 739, for 19,544 total. The supplied
published baseline is 54,988. Reconciliation will retire roughly 35,406 rows
from other yards: 16,819 LKQ copies and 18,587 closed, stale or unsupported yard
rows (including Santa Maria, Paul's and Ryan's). The nineteen migrated yards'
18,843 frozen rows are replaced by 18,805 current vehicles. The net source
count falls by about 35,444. Some replacement VINs already exist, so 18,805 is
current replacement inventory, not a claim of that many newly inserted VINs.
Visibility follows the existing missing-run policy, not an immediate hard delete.
Other directly ingested providers continue to own their live yards.

Counts below compare the supplied per-yard published evidence with the complete
saved replay. A-1 and JDM's before counts match their current accepted legacy
inventories. Totals may drift before deployment.

| Yard                                                               | State | Before | After | Result                   |
| ------------------------------------------------------------------ | ----- | -----: | ----: | ------------------------ |
| EZ Pull N Pay Birmingham                                           | AL    |    567 |   725 | Ario, current            |
| EZ Pull N Pay Decatur                                              | AL    |    998 | 1,010 | Ario, current            |
| EZ Pull N Pay Montgomery                                           | AL    |    995 | 1,078 | Ario, current            |
| A&S Auto Wrecking Inc.                                             | CA    |      1 |     0 | Stale, hidden            |
| A-1 METALS & AUTO SALVAGE INC                                      | CA    |    183 |   183 | Legacy, current          |
| Ajax Auto Dismantlers                                              | CA    |     95 |     0 | Stale, hidden            |
| Paso Robles Auto Wrecking                                          | CA    |      2 |     0 | Stale, hidden            |
| Pick The Part                                                      | CA    |      3 |     0 | Stale, hidden            |
| SAMSON AUTO SALVAGE                                                | CA    |    370 |   283 | Ario, current            |
| San Luis Auto Salvage                                              | CA    |      1 |     0 | Stale, hidden            |
| SANTA MARIA RECYCLING CENTER                                       | CA    |  4,207 |     0 | Ario also stale, hidden  |
| Timos Auto Wrecking                                                | CA    |      3 |     0 | Stale, hidden            |
| A & A Auto Recycling                                               | FL    |  1,106 | 1,134 | Ario, current            |
| KIKER'S U PULL IT                                                  | FL    |    226 |     0 | Stale, hidden            |
| EZ Pull N Pay Atlanta                                              | GA    |  1,032 | 1,043 | Ario, current            |
| EZ Pull N Pay Columbus                                             | GA    |    936 |   940 | Ario, current            |
| EZ Pull N Pay Stockbridge                                          | GA    |  1,111 | 1,104 | Ario, current            |
| EZ Pull N Pay Warner Robins                                        | GA    |  1,176 | 1,158 | Ario, current            |
| LKQ - FAYETTEVILLE                                                 | GA    |  1,031 |     0 | Duplicate, pyp owns yard |
| LKQ - SAVANNAH                                                     | GA    |  1,651 |     0 | Duplicate, pyp owns yard |
| Paul's - Elkhart                                                   | IN    |    857 |     0 | Stale, hidden            |
| Paul's - Gary                                                      | IN    |    586 |     0 | Stale, hidden            |
| Paul's - Knox                                                      | IN    |    425 |     0 | Stale, hidden            |
| Paul's - Lake Station                                              | IN    |  1,210 |     0 | Stale, hidden            |
| Paul's - Logansport                                                | IN    |    273 |     0 | Stale, hidden            |
| Paul's - Westville                                                 | IN    |  1,428 |     0 | Stale, hidden            |
| Paul's' - DeMotte                                                  | IN    |    509 |     0 | Stale, hidden            |
| Pauls - Fort Wayne                                                 | IN    |  1,454 |     0 | Stale, hidden            |
| Pauls - Merrilville                                                | IN    |  1,368 |     0 | Stale, hidden            |
| Pauls's- South Bend                                                | IN    |  1,631 |     0 | Stale, hidden            |
| AB Auto Salvage                                                    | LA    |     33 |     0 | Stale, hidden            |
| Ryan's Pick-a-Part                                                 | MI    |  1,351 |     0 | Stale, hidden            |
| Universal Auto and Recycling Group                                 | MO    |      3 |     0 | Stale, hidden            |
| Auto Parts U Pull - Lincolnton                                     | NC    |    843 |   839 | Ario, current            |
| Auto Parts U Pull - Shelby                                         | NC    |  1,968 | 1,315 | Ario, current            |
| Foss Havelock                                                      | NC    |    553 |   504 | Ario, current            |
| Foss Jacksonville                                                  | NC    |  1,136 | 1,137 | Ario, current            |
| Foss La Grange                                                     | NC    |    968 |   968 | Ario, current            |
| Foss Wilson                                                        | NC    |    741 |   713 | Ario, current            |
| Foss Winston-Salem                                                 | NC    |  1,333 | 1,343 | Ario, current            |
| Gaston Towing & Recovery                                           | NC    |      1 |     0 | Stale, hidden            |
| JDM AUTOMOTIVE & RECYCLING                                         | NC    |    556 |   556 | Legacy, current          |
| L AND L U-PULL AUTO PARTS                                          | NC    |  1,165 | 1,445 | Ario, current            |
| LKQ - CHARLOTTE                                                    | NC    |  1,676 |     0 | Duplicate, pyp owns yard |
| LKQ - DURHAM                                                       | NC    |  1,484 |     0 | Duplicate, pyp owns yard |
| LKQ - EAST NC                                                      | NC    |    879 |     0 | Duplicate, pyp owns yard |
| LKQ - GREENSBORO                                                   | NC    |  1,099 |     0 | Duplicate, pyp owns yard |
| SOUTHERN AUTO SALVAGE                                              | NC    |    934 |     0 | Stale, hidden            |
| U-Pull Auto Parts (AutoRecycler org name DIS & DAT AUTO RECYCLING) | NV    |    251 |     0 | Stale, hidden            |
| A-Z U-PULL-IT USED AUTO PARTS INC.                                 | PA    |    764 |     0 | Stale, hidden            |
| LKQ - CHARLESTON                                                   | SC    |    737 |     0 | Duplicate, pyp owns yard |
| LKQ - GREER                                                        | SC    |  1,522 |     0 | Duplicate, pyp owns yard |
| Pick Your Part - Greenville                                        | SC    |  1,001 |     0 | Duplicate, pyp owns yard |
| LKQ - CHATTANOOGA                                                  | TN    |  2,326 |     0 | Duplicate, pyp owns yard |
| LKQ - MEMPHIS                                                      | TN    |  1,580 |     0 | Duplicate, pyp owns yard |
| LKQ - NASHVILLE                                                    | TN    |  1,833 |     0 | Duplicate, pyp owns yard |
| American Parts Center                                              | TX    |      2 |     0 | Stale, hidden            |
| ARIO AUTO PARTS (AutoRecycler house org, not a real yard)          | TX    |      2 |     0 | Stale, hidden            |
| Gulf Bank Used Auto Parts                                          | TX    |      1 |     0 | Stale, hidden            |
| Prestige Pull Your Part                                            | TX    |  1,033 | 1,305 | Ario, current            |
| Sam's Auto Salvage                                                 | TX    |      2 |     0 | Stale, hidden            |
| Foss Chesapeake                                                    | VA    |    812 |   761 | Ario, current            |
| Long's Auto Recycling                                              | VA    |     23 |     0 | Stale, hidden            |
| Yank A Part                                                        | WA    |    941 |     0 | Stale, hidden            |

Offline fixtures and the full live request ledger are in
`src/server/ingestion/fixtures/ario/`. In-bound pages and closing pages are saved
responses. The legacy fixtures omit unrelated organization/account fields.
Research stopped on Ario's hourly HTTP 429 limit; no challenge was bypassed.
Tests never make network requests. Provider clients remain outside Workflow
imports; cursor schemas import only the pure freshness state schema.

## Earlier owned-location and legacy traversal work

Yard geography must come from the yard's own organization or website record.
Inventory GPS can name the requested organization while pointing to its parent
yard. Parent and partner relationships do not establish physical-yard ownership.

Organization references have the form `<digits>__LOOKUP__<digits>x<digits>`.
The resolver requests the bare record ID after `__LOOKUP__` with `mget`, then
checks the returned organization identity and type. Bare and full lookup IDs
are accepted in responses. If needed, an exactly owned website address or an
exact organization row in details `init/data` can supply the location. Inventory
GPS and vehicle SEO descriptions are never used for yard geography or names.

## Source ownership

Pull-A-Part and U-Pull-&-Pay inventory comes from the direct `pullapart` connector.
AutoRecycler's mirrored operator is organization `1761169592468x394558876247902400`.
The connector checks each organization's current parent reference before using
cached geography. That organization and its children emit neither canonical
vehicles, yard metadata, nor observed VINs. Names and partner lists do not establish
ownership. Ownership decisions are cached within a chunk and rechecked next chunk.
Missing organization records remain unresolved; failed or malformed ownership
responses fail the page without emitting its inventory.

The September 19 audit found all 35 direct operator locations already published.
For six audited yards, all 6,964 live direct VINs matched published inventory.
Only one of 4,879 AutoRecycler mirror VINs remained in the live direct feed, and
none of the mirrors was published under AutoRecycler. All 35 mirrored organizations'
latest arrivals were October 21–22, 2025. Do not recover coordinates for these stale
copies or let their observations keep vehicles available after the direct feed
removes them.

Migration `0009_autorecycler_geo_provenance.sql` adds `resolution_version` with
default `0`, leaving existing data intact. The resolver rechecks every legacy
cache row, including those with populated cities. Only an owned address with a
non-placeholder city is persisted at version `1`. Subsequent resolver instances
reuse that verified cache. Blank or `Unknown` cities are refreshed at any version.

City comes from structured geographic components or the organization's city
field, never the first segment of a street address. A successful refresh replaces
the cached name with the owned record's name, so prior wrong-branch names can also
be corrected. Normal ingestion updates yard metadata and reconciles vehicle
geography into the search index. Apply the migration before running the repaired
ingestion code. No direct production data patch or hardcoded yard list is needed.

An unresolved location skips only that organization's canonical vehicle updates.
Its valid observed VINs preserve existing inventory through checkpoint and
reconciliation; known yards continue, and warnings identify unresolved yards.
The unresolved result is cached only within the chunk and retried next chunk/run.
Existing geographic and yard metadata is not overwritten by an unresolved result.

Malformed AutoRecycler responses, identity mismatches, source transport failures,
and persistence failures still fail the chunk. These failures never mark cached
geography verified. Previously published inventory is preserved.

The public catalog also contains identifiable inventory entries without VINs
(confirmed in both search and inventory-detail records). The VIN-keyed catalog
cannot represent them, so they are counted as explicit exclusions and emit no
observations. Nonempty invalid VINs and malformed records remain rejections.
Minimum inventory, drift, duplicate, and rejection limits remain unchanged.

Validation must traverse the complete provider feed and run source validation,
not start from the organizations already published in the homepage directory.

The global search has a confirmed 50,000-row result ceiling. Its empty page or
`at_end` at that boundary does not prove feed completion: organization queries
still return inventory outside the global result. Inventory queries now sort by
the unique search record `_id` descending and request `_id` less than the last
returned ID, always from offset zero. This covers the full visible, non-deleted
feed, including large organizations and organization-less records. Existing
ownership, VIN, location and quality checks still determine which rows can enter
the canonical inventory. Newer record IDs are visited first; duplicate VINs retain
the first usable record, as in the existing snapshot policy. This replaces the
provider's image/date sort with a unique ordering suitable for checkpoints.

Every page must have valid, strictly decreasing IDs below its checkpoint. The
connector ignores nonempty `at_end` flags and requires an empty follow-up query
after the final ID before marking the cursor complete. Missing, repeated or
out-of-order IDs and malformed responses fail the chunk and preserve previously
published inventory. Queries remain bounded to 400 rows and chunks to ten pages.

Record-ID checkpoints use JSON with `phase: "page"` and `beforeId`, or
`phase: "complete"`. Legacy numeric offset checkpoints cannot establish what
record-ID ranges were visited and are rejected. Start a new ingestion run after
deploying this change; do not resume a legacy run or reinterpret its offset.
Source validation requires the explicit complete cursor. No migration or direct
production data patch is needed, and validation limits remain unchanged.

## Complete-feed validation

On November 12, 2026 (Linux, Bun 1.4.1), public native queries confirmed both
descending `_id` sorting and the strict `less than` constraint. An offset query
at 50,000 returned no rows, while an ID-bounded query reached the immediately
adjacent record outside that result window. Ascending and descending traversals
both covered 106,570 visible, non-deleted records, including 1,276 records without
an organization.

The connector's descending traversal, resumed through serialized ten-page
checkpoints, completed in 27 chunks and 268 pages. It produced 54,761 canonical
VINs across 63 organizations. Source validation accepted the snapshot with the
existing limits. It excluded 44,631 rows and rejected 4,709 rows under the existing
ownership, VIN and location rules. Inventory batches were counted and discarded;
geography used an in-memory libSQL database. No production writes were made.

Focused tests cover traversal beyond 50,000 rows within a single organization,
organization-less rows, serialized resume, explicit empty-query completion,
ignored `at_end` hints, malformed and non-progressing responses, legacy offset
rejection, and source validation. Existing reconciliation tests still prove
unresolved independent VIN preservation and direct-provider mirror retirement.

```sh
bun test src/server/ingestion/autorecycler-pagination.test.ts src/server/ingestion/autorecycler-cursor.test.ts src/server/ingestion/autorecycler-validation.test.ts
bun test src/server/ingestion/durable-reconciliation.test.ts
bun run check
bun test src
```

## Reproduction receipt

Confirmed on Linux, Bun 1.4.1, against `origin/main` at
`103e7487f8601d600d1114f04de3882e66decc7e` using public provider reads:

- Organization: `1348695171700984260__LOOKUP__1726602417880x199387504054651780`
- Inventory seed: `1787737161109x728407258643232400`
- Seed `mget`: `custom.inventory`, organization parser returned `null`.
- Details fallback: Columbus name, Atlanta city, `(33.7877874, -84.4842809)`,
  `1172 Field Rd NW, Atlanta, GA 30318, USA`.
- Bare organization `mget`: `custom.organization`, Columbus city,
  `(32.44405100000001, -84.9404565)`, `3843 Aldridge Rd, Columbus, GA 31903, USA`.

The focused ownership regression failed four tests before the repair: bare ID
without self-partner membership, parent ownership, partner ownership, and
inventory GPS rejection. All five ownership tests pass after the repair. Cache
tests decrypt the actual outgoing request to assert the bare organization ID,
then verify legacy populated-city repair, persisted provenance, cache reuse,
fallback shapes, migration preservation, and provider/write failure preservation.

```sh
bun test src/server/ingestion/autorecycler-geo-ownership.test.ts src/server/ingestion/autorecycler-geo-cache.test.ts src/server/ingestion/autorecycler-geo.test.ts
bun test src/server/migration-chain.test.ts
bun run check
bun test src
```
