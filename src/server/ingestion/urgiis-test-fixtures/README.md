These Brotli archives retain public URG Inventory InSite HTML captured on November 15 and 16, 2026. `probes.json.br` is a JSON array of model and detail responses used to verify template variants, shared suppliers, missing VINs, the 500-card boundary and empty large models. It includes unsuccessful qualification leads so parser changes cannot hide their failure modes.

All tests read local files. They never contact a yard, URG, Census or a geocoder. Census receipts and complete qualifying catalogs are retained separately as they qualify. The runbook records admission counts, exclusions, coordinate sources and live request totals.

`eagle.json.br` preserves the full 37-make, 284-model catalog and six arrivals, with separate closing owner and directory responses. It replays 363 native responses: 1,448 accepted unique donors, 127 rejected observations, 143 explicit part-bin exclusions and five duplicates. Among the 1,717 model cards, 257 have blank VINs. Older numeric stocks remain rejects. The exclusion whitelist covers observed generic part-bin codes only when both native VIN claims and yard photographs are absent; the saved `166C` detail probe lists quarter-extension parts under that shared stock.

Replay archives order responses for the connector. Opening make directories were acquired alongside model pages during qualification; closing responses were fetched separately. The HTTP receipt ledger retains acquisition order. `eagle-geocode.json` is the US Census match for the published Martinsburg address.

`linders.json.br` preserves all 41 makes, 426 model pages and 60 arrivals, plus separately fetched closing ownership and directory controls. Its 513-response replay accepts 3,274 unique donors, rejects 159 observations, excludes no rows and merges 54 duplicates. All supplier photographs are MA09; unexpected supplier codes fail qualification. `linders-geocode.json` retains the US Census match for 211 Granite St, Worcester, MA 01607 (42.23811894312, -71.782708739098).

`chuckran.json.br` preserves all 43 makes, 407 model pages and 19 arrivals, plus separately fetched closing owner and directory controls. The 498-response replay accepts 3,671 unique donors, rejects 369 observations (9.10%), excludes no rows and merges 13 duplicates. Every supplier photograph is MA23. Qualification used serial requests with a 3.5-second minimum gap and 90-second timeout. `chuckran-geocode.json` retains the US Census match for the published 1775 Old Plymouth Street address in Bridgewater, MA 02324 (41.990325748641, -70.913539837235).

`united.json.br` preserves all 46 makes, 526 model pages and six arrivals, including separately fetched closing owner and directory responses. Its 623-response replay accepts 12,356 donors, rejects 56 observations (0.45%), excludes no rows and merges five duplicates. Every observed supplier photograph is NE02, and unexpected supplier codes fail qualification. `united-geocode.json` retains the US Census match for the published Omaha yard address (41.200697251758, -96.004715979234).

`ace-iowa.json.br` retains all 42 makes, 376 model pages, 60 arrivals and separate closing controls. Its 465-response replay accepts 1,524 donors, rejects 172 observations, excludes 125 verified bulk-part-bin observations and merges 56 duplicates. The eight explicit bins are DORMAN, BROCK, NOF, MONTE, DORMN, 114AFT, BERGER and ORDER. Native detail probes show each stock spans unrelated vehicles or new aftermarket parts. Empty EPL and AER details remain evidence, not exclusion authority. All supplier photos are OO76. `ace-iowa-geocode.json` retains the published address's Census match.

`dings.jsonl.br` retains all 36 makes, 246 model pages, 60 arrivals and separate closing controls. Its 323-response replay accepts 1,110 donors, rejects 109 observations, excludes none and merges 24 duplicates. All supplier photos are CT05. `dings-geocode.json` retains the published address's Census match.

Large replay archives use Brotli-compressed JSONL: one metadata record (`tenantCode`, `expected`, `responseCount`), then one `{url, html}` record per raw native response. Replays decode one page at a time. Dings exercises this format alongside the original JSON archives. This avoids allocating an entire seller-detail catalog as one JSON string.

`bishops.jsonl.br` retains all 35 makes and 322 model pages, plus separately fetched closing controls. No arrival window is used. Its 396-response replay accepts 3,362 donors, rejects 82 observations, excludes none and has no duplicates. All supplier photos are AA74. `bishops-geocode.json` retains the US Census match for the published Middletown address. The acquisition recovered a slow Spark route using a 90-second timeout and normal curl retries, with 3.5-second tenant spacing.

The probes also retain APS's published Rover make directory entry, its empty vehicle-table response and two separately paced curl retries. No complete model directory is present. Metro's published F150 page retains 500 shared cards before its MN06 filter. Both leads fail complete enumeration and remain out of the source.

`chucks.jsonl.br` retains 41 makes, 415 model pages, 43 arrivals and separately fetched closing controls. Its 502-response replay accepts 2,601 donors, rejects 283 observations, skips 480 explicit part-bin observations and merges 40 duplicates. All supplier photos are PP42. The probes preserve native detail responses for all 25 whitelisted NOF stocks, each containing parts from multiple makes and years without donor VIN claims. Empty NEW and RIDE detail responses remain rejects. Unverified NOF stocks also remain rejects. `chucks-geocode.json` preserves the Census address match.

`central-nh.jsonl.br` retains all 43 makes, 380 model pages, 60 arrivals and separately fetched closing controls. Its 471-response replay accepts 2,477 donors, rejects 193 observations, excludes none and merges 52 duplicates. All supplier photos are FF27. `central-nh-geocode.json` preserves the Census match for the published Concord address.

`ace-st-paul.jsonl.br` retains all 38 makes, 342 model pages, 60 arrivals and separate closing controls, including the published contact page. Its 423-response replay accepts 3,015 donors, rejects 185 observations, excludes none and merges 54 duplicates. All supplier photos are MN25. `ace-st-paul-coordinates.json` preserves the contact page's yard-published JSON-LD place and coordinates. Model transport encodes parentheses while graph paths stay literal.

`johns-qualification.json` records the complete failed NH census: 45 makes, 386 model pages, seven arrivals, 1,903 candidate donors, 625 rejects, six duplicates and no placeholder exclusions. The 24.66% rejection rate exceeds the 10% guard. `johns-rejected-census.jsonl.br` retains 481 raw native responses for offline audit: metadata with the receipt, site and published menus, followed by `{key, html}` records. This is an audit archive for an excluded tenant, separate from admitted connector replay archives. The existing John's template probe also retains its native missing-VIN cards.

`lentini.jsonl.br` retains 3,969 raw responses for the complete NJ catalog, native seller details and separately fetched closing controls after detail collection. It accepts 2,429 Ringoes donors and 924 Port Murray donors, rejects 375 observations, excludes none and merges 211 duplicates. `lentini-ringoes-geocode.json` and `lentini-port-murray-geocode.json` retain separate Census matches. `lentini-supplier-mapping.json` preserves only the three relevant public supplier records; directory coordinates are not used for yard placement. The final replay reapplies the native part VIN guard.

`qualification-requests.jsonl.gz` retains the sanitized qualification HTTP ledger. `qualification-requests.json` records per-tenant totals, six known unlogged attempts and separate APS browser-map resource accounting. It is not an exhaustive wire log. `qualification-audit.json` records 38,191 unique admitted VINs, zero cross-tenant duplicates and satisfied per-yard floors after conservative duplicate accounting.

`smith-qualification.json` records a complete but excluded NE22 census:
40 makes, 392 model pages, 3,275 model cards, 60 arrivals and separate closing
owner, makes and all 40 model directories. Its 477-response candidate connector
replay, including durable serialization after each three-page chunk, yields
2,945 candidate identities, 218 rejects (6.84%), 148 qualified part-bin exclusions
and 24 duplicates. These candidates are not admitted to the source.

`smith-rejected-census.jsonl.br` retains the full failed census in connector
order, with audit metadata followed by raw `{url, html}` responses. This is
an excluded qualification archive, not an admitted `UrgiisReplayArchive`.
`smith-part-bins.json.br` retains native NOF, ASA002 and BROCK details spanning
unrelated vehicles without VIN claims. `smith-geocode.json` retains both the
unsuccessful Census query and the ArcGIS exact-address PointAddress match.

`smith-completeness.json.br` retains the published Ford directory, F150 page,
a separately fetched cache-revalidation, arrivals and a native donor detail.
F150 advertises 163 but returns 30 cards with no enumerable continuation.
The revalidation has the same donor fingerprint. Own-yard stock 261352,
VIN `1FTEW1EP9NKD56443`, exists in arrivals and a native NE22 part detail but
is absent from that model page. A regression preserves this exclusion. `smith-public-plugin.js.br` retains the
public Browse Vehicles action, which returns to the make directory.
`smith-qualification-requests.jsonl.gz` records all 492 live requests, including
477 successful replay responses, ten supplemental successes and five failed or
aborted attempts. Two early attempts have no retained exact start time.
No failed request is counted as a successful native replay response.
Batch A retains ten unsuccessful qualifications from November 16, 2026. `batch-a-probes.json.br` contains 278 public responses, including the four 30-card cutoff cases, their unchanged broader-page variants, Heritage's omitted native donor, Stadium's shared 500-card pools, malformed Maserati controls, incompatible arrivals titles and Quick Recovery's failed ATS requests. It also retains the large TNT and Borges probes and Borges' published contact evidence. The request ledger and qualification summary are `batch-a-requests.jsonl.gz` and `batch-a-qualification.json`.

`tnt-rejected-census.jsonl.br` and `borges-rejected-census.jsonl.br` preserve complete 331- and 486-response catalogs with independent closing controls. Their metadata's accepted counts describe candidate snapshots, not emitted inventory. Negative connector replays verify zero emission with normal accounting and with optimistic, unverified bin exclusions. TNT rejects 252 / 1,346 observations (18.72%), or 155 / 1,249 (12.41%) after hypothetically excluding AFT, NOF, CPO and DLRS. Borges rejects 460 / 4,167 (11.04%), or 419 / 4,126 (10.15%) after hypothetically excluding MISC, MIS and NEW. None of these bin stocks is qualified for exclusion.

The separate TNT and Borges qualification receipts retain counts, supplier observations and closing badge drift. `tnt-geocode.json` preserves its published address's Census match. `borges-coordinates.json` retains three unsuccessful Census lookups and the explicit place point from the map link published beside its contact address. No yard is registered or enabled from this batch.
