# URG Inventory InSite ingestion

`urgiis` adds independent yard businesses through one multi-tenant connector. Each physical yard has its own location code, address, coordinates and website. Existing Pratt, Central, Northwest and Allied source behavior is preserved. Shared IIS identity, HTML and quarantine primitives are extracted from Allied.

The source ships disabled. `ingestion-source-urgiis` must be explicitly enabled for rollout.

Every tenant follows its official owner page, published make directory, all make/model links and its enumerable arrivals page. A tenant with no published arrival cards uses its model graph. The connector rereads the owner, makes and all model directories before emission. It requires unchanged ownership claims, literal paths, labels and counts. An arrivals window alone cannot qualify: at least one admitted own-yard donor must come from the fully traversed model graph. Arrivals and models are assessed together, with conflicting VIN/destination claims quarantined before deduplication. A modern VIN must pass its check digit; supported pre-1981 serials are accepted. Native year/make/model and an owned per-vehicle destination are required. No identity is decoded or invented.

No tenant emits until its entire graph, closing evidence, ownership and admission guards pass. Durable reconciliation additionally requires the complete tenant prefix and a terminal cursor. A later tenant failure prevents reconciliation of the source. Rejected valid VIN claims remain presence evidence.

Directory badges are informational, not asserted donor totals. The traversal follows every literal make/model link and accounts for cards or an explicit native empty result. A page with 500 cards is incomplete. An empty model advertising at least 500 is also blocked, since the same native boundary can render an empty result. The connector does not truncate these pages or assume filtering a capped shared pool recovers every owned car. Unknown continuation controls, partial documents, supplier changes and unowned destinations fail closed.

Single-yard catalogs reject unexpected supplier photo codes. Shared-pool tenants require an explicit own-photo filter and exclude unassignable photos. Multi-yard catalogs use agreeing native seller and SKU prefixes, with matching stock/year evidence, then map each supplier to a verified physical yard. A shared image bucket is not a yard location.

Only explicitly qualified part-bin stocks may be excluded when native VIN claims and yard photographs are absent. Older numeric-stock donors with missing VINs remain rejects. A real VIN claim or yard photograph overrides the bin exclusion. Nationwide's requested blank-VIN exclusion is supported independently. Exclusions never dilute the 10% rejection denominator. Duplicates must stay at or below 25%. Each tenant has an absolute floor; multi-yard tenants also require each yard's floor. Published per-yard inventory must retain at least 50% of its preceding persisted, non-missing count. Final durable validation reapplies every physical yard floor after source-wide deduplication. Source-wide validation also repeats the usual floor, duplicate, rejection and preceding-run checks.

Requests use a current browser User-Agent, normal headers, an explicit public verification cookie where qualified, manual redirects, a combined request/body timeout, a 4 MiB body cap, and a shared serial gate that waits at least two seconds after responses, including failures. There are two paced retries with exponential backoff. Each chunk allows three native pages and eight minutes. Whole runs allow 30,000 successful native requests and 8 GiB of response bodies. Retries are additionally bounded per page. Checkpoints are capped at 32 MiB, bind the complete tenant qualification contract and retain only the current tenant's evidence plus the completed prefix. Completed cursors make no further requests.

Run a count-only soak with:

```sh
bun run soak:sources -- --sources=urgiis --max-pages=30000
```

The soak serializes each checkpoint, reports accepted/rejected/excluded/duplicate counts, and writes no canonical inventory. A capped soak stays incomplete. On a failed guard, retain published inventory and inspect the named request, tenant, raw response and checkpoint. Restart after directory or qualification drift. Never force reconciliation from an incomplete cursor.

Qualification uses saved public responses. Tests are offline. Complete replay archives retain separately fetched opening and closing controls; opening controls are never substituted for closing evidence. Replay order follows the connector; acquisition order is recorded in the HTTP receipts. Large archives use Brotli-compressed JSONL so offline tests decode one raw response at a time. Census coordinates come from the yard's published address unless a yard-published point is available.

Qualification began with serial censuses. Later acquisitions allow at most three active tenants, preserve each tenant's own response spacing, and limit combined request starts to one per 3.1 seconds. All tenant sites are conservatively treated as sharing one URG backend for that acquisition limit. The source connector itself traverses tenants serially.

The November 15, 2026 Eagle census followed 37 makes and 284 model pages, then included six arrival observations. It accepted 1,448 unique vehicles, rejected 127 observations, excluded 143 part bins and merged five duplicates. Of 1,717 model cards, 257 had blank VINs (85.0% carried a nonblank VIN). The eligible rejection rate is 127 / 1,580 (8.04%). Its floor is 1,200. The US Census point for 2744 Eagle School Road, Martinsburg, WV 25404 is 39.468480369268, -77.925464629822. The saved geocoder receipt and full 363-response replay are fixtures.

## Qualified yards

| Yard                  | City        | State | Accepted | Rejected | Skipped | Duplicates | Floor |
| --------------------- | ----------- | ----- | -------: | -------: | ------: | ---------: | ----: |
| Eagle Auto Parts      | Martinsburg | WV    |    1,448 |      127 |     143 |          5 | 1,200 |
| Linder's Inc          | Worcester   | MA    |    3,274 |      159 |       0 |         54 | 2,600 |
| Chuckran Auto Parts   | Bridgewater | MA    |    3,671 |      369 |       0 |         13 | 2,900 |
| United Auto Recyclers | Omaha       | NE    |   12,356 |       56 |       0 |          5 | 9,800 |
| Ace Auto Recyclers    | Iowa City   | IA    |    1,524 |      172 |     125 |         56 | 1,200 |
| Ding's Auto Parts     | Litchfield  | CT    |    1,110 |      109 |       0 |         24 |   800 |
| Bishop's Auto Parts   | Middletown  | CT    |    3,362 |       82 |       0 |          0 | 2,600 |

Chuckran's full census follows 43 makes, 407 model pages and 19 arrivals. Its 498-response replay accepts 3,671 donors, rejects 369 observations (9.10%), excludes no rows and merges 13 duplicates. All supplier photographs are MA23. Its floor is 2,900, pacing is 3.5 seconds after responses, and each request has a 90-second timeout. The US Census point for its published Bridgewater address is 41.990325748641, -70.913539837235.

United's full census follows 46 makes, 526 model pages and six arrivals. Its 623-response replay accepts 12,356 donors, rejects 56 observations (0.45%), excludes no rows and merges five duplicates. Every supplier photograph is NE02. Its floor is 9,800. The US Census point for 5702 S 60th St, Omaha, NE 68117 is 41.200697251758, -96.004715979234.

Linder's full census follows 41 makes, 426 model pages and 60 arrivals. It contains 3,427 model cards, with only MA09 supplier photographs. Its eligible rejection rate is 159 / 3,487 (4.56%). The 513-response replay includes separately acquired closing controls. Its US Census point is 42.23811894312, -71.782708739098 for 211 Granite St, Worcester, MA 01607.

Ace Iowa follows 42 makes, 376 model pages and 60 arrivals. Its 465-response replay accepts 1,524 donors, rejects 172 observations (9.82%), excludes 125 verified bulk-part-bin observations and merges 56 duplicates. Saved native detail pages show DORMAN, BROCK, NOF, MONTE, DORMN, 114AFT, BERGER and ORDER holding parts across unrelated vehicles. EPL and AER returned empty details and remain rejects, as do unverified stocks and numeric donors. Every supplier photograph is OO76. Its floor is 1,200. The US Census point for 2752 S Riverside Dr, Iowa City, IA 52246 is 41.625474637231, -91.543835183719.

Dings follows 36 makes, 246 model pages and 60 arrivals. Its 323-response replay accepts 1,110 donors, rejects 109 observations (8.77%), excludes none and merges 24 duplicates. Every supplier photograph is CT05. Its floor is 800. The US Census point for 99 Little Pitch Road, Litchfield, CT 06759 is 41.725760885077, -73.178934578762.

Bishop's follows all 35 makes and 322 model pages, with no published arrival-card enumeration. Its 396-response replay accepts 3,362 donors, rejects 82 observations (2.38%), excludes none and has no duplicates. Every supplier photo is AA74. Separate closing owner and directory controls pass. Its floor is 2,600. Qualification recovered a slow Spark page with a 90-second timeout and ordinary curl retries; pacing is 3.5 seconds after responses. The US Census point for 120 Stantack Rd, Middletown, CT 06457 is 41.564414369713, -72.749473882561.

## Leads left out

| Yard                          | State   | Reason                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brown's Auto Salvage          | VT      | The 39,835 badges cover a shared pool. Silverado 1500 advertises 1,325 but returns 500 cards from DD05, BB86, MA06 and AA74. Own-yard filtering cannot repair the cap. Its published `/inventory/` alias returned 404.                                                                    |
| Nordstrom's Automotive        | SD      | The published F150 route advertises 506 but returns an explicit empty result. The ordinary model-name variant also returns empty. Complete enumeration is unproven.                                                                                                                       |
| Nationwide Auto Recycling     | MA      | Both published Mercedes E-Class (502 badge) and C-Class (450 badge) routes return empty. Blank-VIN exclusion is supported, but it cannot recover missing model pages.                                                                                                                     |
| Kosiski Auto Parts            | NE      | F150 stops at 500 shared cards, including AA69 photos. A supplier query does not constrain the pool. Published year search returns parts rather than a complete donor list.                                                                                                               |
| H&H Auto Parts                | NE / CO | NE16, CO26 and CO15 share the NE16 photo bucket. Part details expose supplier prefixes, but official contact information publishes only Cozad and Hudson, and directory searches do not resolve both Colorado supplier mappings. No stock-prefix or physical-yard assignment was guessed. |
| Intermountain Auto Recycling  | ID      | Published model routes are empty or return a capped pool of 500 foreign cars. The normal model-name and supplier-query variants do not reveal a complete own-yard route. Arrivals alone are incomplete.                                                                                   |
| Riverbend Recycled Auto Parts | IA      | The published Ford E250 van model route returned HTTP 500 on all three spaced attempts. The interrupted census cannot establish complete enumeration.                                                                                                                                     |
| EL&M Auto Parts               | NJ      | Explorer reaches 500 shared cards before filtering to NJ15. The 22 NJ15 photos in that truncated result do not prove complete own-yard coverage.                                                                                                                                          |
| Automotive Parts Solutions    | MN      | The published `/parts/ROVER_-_STERLING` make advertises one donor but renders an empty vehicle table instead of a model directory. Two ordinary spaced curl retries return the same incomplete graph. Rockville's MN12 attribution was verified, but arrivals alone cannot qualify.       |
| Metro Auto Salvage            | MN      | The published Ford F150 Pickup model route returns 500 shared cards before the MN06 own-yard filter. Filtering the truncated pool cannot prove complete inventory.                                                                                                                        |
