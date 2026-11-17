# SC, NV, NH, NJ and ID yard sweep

November 17, 2026. Base: `feat/provider-coverage-launch-readiness` (PR #176).
Holst is excluded because a separate agent owns its qualification.

The [CSV](provider-sweep-sc-nv-nh-nj-id.csv) records each deduplicated candidate
business/location checked, including historical directory records and scrap,
towing, component and retail businesses. It is a discovery census, not a claim
that every record is a currently operating salvage yard. Separate physical
branches remain separate rows; the statewide Nevada Pic A Part and Pick-n-Pull
umbrella records are represented by their listed branches.

| State | Business/location records checked | New provider credits | Accepted new donors |
| ----- | --------------------------------: | -------------------: | ------------------: |
| SC    |                               231 |                    1 |                 969 |
| NV    |                                78 |                    0 |                   0 |
| NH    |                                94 |                    0 |                   0 |
| NJ    |                               284 |                    1 |                  77 |
| ID    |                               105 |                    1 |                 111 |
| Total |                               792 |                    3 |               1,157 |

Zero additions in NV and NH does **not** prove no qualifying public inventory
exists. Access failures, unresolved identities and incomplete public catalogs
remain explicit in the CSV. No HTTP block is classified as empty inventory.

## Discovery and evidence

The sweep unions the legacy Car-Part state yard-name lists and saved modern
national directory roster (202 target-state names), the public ARA member
GeoDirectory API (SC 13, NV 8, NH 7, NJ 15, ID 4), statewide salvage Maps searches,
regional and heavy-truck Maps searches, and a complete 32-page Salvage-Parts
state-directory pass (308 listing rows before deduplication). Individual Maps
lookups recover current websites for missing-site and Car-Part-only records.
Earlier JunkyardMap, JunkyardsNearMe, AutoSalvageYards and specialty-business
checks supplement the current directory passes. Prior semantic findings are
identified as prior evidence, not represented as new live censuses.

State association discovery was also checked: the South Carolina site is
parked, the old New Hampshire Weebly directory is 404 and its current domain
fails DNS, and New Jersey's active-members page exposes no member roster.
Neither an unavailable association directory nor missing website establishes
closure. Car-Part is used for yard identities only; its component results are
not crawled or counted as donors. Map queries exclude unrelated similar-name
results when matching a native site.

Readable homepages, native inventory controls, published scripts and public
read-only APIs are inspected before considering page traversal. A design
agency footer does not identify the inventory platform. Component fitment VIN
search, rebuildable retail advertisements and global truck-platform results
do not establish an owned donor census. Full-service and heavy-truck donors
are eligible. Photos, stock, color, row and arrival dates remain optional.

The CSV's `inventory found (y/n)` means a public per-vehicle surface was
established, including a nonqualifying retail/partial surface. `n` on an
unresolved row means no surface was established, not that the business has
none. The qualification result and reason control interpretation. Unknown
cities and websites stay blank instead of being invented. Existing-provider
rows receive no new credit.

[Business evidence](provider-sweep-sc-nv-nh-nj-id-evidence/business-evidence.json)
links every row to source descriptions, aliases, original listing IDs and
capture labels. The compressed request ledger records URL, final URL, status,
redirect hops, timings, byte counts and SHA-256 for the paced HTTP captures.
It excludes search-service calls and browser-generated subresource traffic.
The adjacent summary supplies exact counts for that ledger. Selected native
near-miss captures and discovery inputs are retained compressed alongside it.
Full crawl captures and working scripts remain under
`.scratchpad/provider-sweep/`, not `/tmp`. Prior evidence is recoverable under
the discovering worktree's `investigate-nov15` and `nov14-provider-goal`
research folders. Those prior archives are not falsely presented as fresh
November 17 fetches.

Live HTTP requests use a normal browser User-Agent and are serial and paced.
The follow-up helper uses a 3.2-second completion gap and two-second redirect
gaps. URG reads hold
`flock /tmp/jyi-urg-gate.lock`. Ordinary native redirects, modern HTTPS,
published URL corrections, native public cookies and normal browser sessions
are used for request recovery. Persistent failures remain unresolved, with
response evidence retained.

## Qualified integrations and request budgets

All three additions ship enabled. Pausing uses existing source flags. No
production flag or production data was changed.

| Provider                         | State | Platform         | Accepted / published | Floor | Requests per complete runtime census                                                     |
| -------------------------------- | ----- | ---------------- | -------------------: | ----: | ---------------------------------------------------------------------------------------- |
| Spartan Auto & Heavy Truck Parts | SC    | Custom JSON API  |            969 / 981 |   323 | 166 GETs, two complete typed API passes and two owner reads                              |
| CarsAndPartsHub / Recycar        | NJ    | Shopify          |              77 / 77 |    25 | Four GETs, collection/API/API/collection                                                 |
| Crossroads Salvage               | ID    | Hollander Stores |            111 / 111 |    37 | Two roster POSTs added to the shared source; its 34 missing makes are permanently seeded |

See [Spartan](spartan-ingestion.md),
[CarsAndPartsHub](carsandparts-ingestion.md) and
[Crossroads](hollanderstores-ingestion.md#crossroads-salvage-november-17-2026)
for complete contracts, location and freshness evidence, exact receipts,
fail-closed guards and local recovery commands.

The expanded Hollander source covers 52 locations and 44 businesses. Its full
saved census needs 104 HTML requests and one unresolved vPIC POST with the
committed seed, 105 HTTP requests before retries. There are 414 logical source
operations including 310 decode batches; seeded decode operations perform no
HTTP. A wholly unseeded census could require 414 HTTP requests. These shared
source totals must not be reported as the incremental Crossroads cost.

All additions require valid VIN check digits (or supported pre-1981 serials),
YMM, physical yard attribution, native destinations, complete enumeration and
current inventory. Independent opening/closing reads must agree before
publication. Existing rejection, duplicate and previous-run drift guards are
preserved. Per-yard floors are approximately one third of the accepted census.

## Best remaining leads

| Business                         | State | Public evidence                                                                                                                                             | What would unblock it                                                                    |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Shaw Auto Parts                  | ID    | URG ID02 root and plugin load. Prior partial graph advertises 6,048 donors; current makes directory remains WP Remote Firewall 403 after ordinary recovery. | Readable complete public graph/API, followed by full closing and quality checks.         |
| Busbee Truck Parts               | SC    | Native site and actual TPI company route remain challenged. Search snippet advertises nine trucks.                                                          | Working public donor/API access and complete VIN, location, freshness and closing proof. |
| Big Junkyard                     | NJ    | Ordinary browser recovers 607 donors with native valid-VIN examples. Sitemap newest modification is March 25, 2026. Displayed current date is JavaScript.   | Actual recent arrivals/publication evidence, then complete census qualification.         |
| John's Truck & Auto Parts        | NH    | Prior complete 481-response census rejects 24.66% of observations, largely invalid VINs.                                                                    | Corrected public identities sufficient to pass the existing 10% guard.                   |
| Force 5 Automotive               | NH    | Native site explicitly describes a representative sample. Prior 72 rows have only three 17-character VIN candidates.                                        | Complete catalog with full valid identities.                                             |
| EL&M Auto Parts                  | NJ    | Fresh Ford F150 badge says 20; native model page returns 500 shared cards. Arrivals show 60 own-yard donors.                                                | Complete supplier-scoped public inventory, without shared-pool truncation.               |
| Acres Auto Parts                 | NJ    | Fresh arrivals explicitly replace VIN with Available Upon Request; public make directory is not usable.                                                     | Public full identities and complete per-yard inventory.                                  |
| Dis & Dat                        | NV    | Native U-Pull and Reserve categories advertise 230 and 78 vehicles. Inspected categories/details have YMM and stock but no VIN.                             | Public VIN-bearing donor API or details and a complete current census.                   |
| Adams Scrap Recycling            | SC    | Published WordPress YardSmart AJAX action returns 323 Chevrolet donors without VIN/serial fields.                                                           | Public identity-bearing response and donor destinations.                                 |
| Blue & Gold, C&C, Sunshine       | SC    | Current public per-vehicle tables/posts, but no supported identities/destinations established.                                                              | Public VIN/serial-bearing donor feed or details.                                         |
| Trusty, Jalopy Jungle, Auto Farm | ID    | Public forms/categories show YMM or grouped parts cars, without full identities and discrete complete membership.                                           | Public VIN/old-serial donor records and complete enumeration.                            |

No optional-field requirement is used to reject a candidate. Unresolved access
is a follow-up lead, not a declaration that a state has no public inventory.

## Verification

Local lint and TypeScript checks pass. The focused suite passes 409 tests
across 11 files, including all three additions, source/cursor registries,
durable orchestration and reconciliation, quality floors, shared transport
and soak behavior. Native opening/closing fixture receipts verify exact bytes
and SHA-256. Full `bun test src` is left to CI.
