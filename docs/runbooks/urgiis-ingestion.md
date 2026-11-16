# URG Inventory InSite ingestion

`urgiis` adds independent yard businesses through one multi-tenant connector. Each physical yard has its own location code, address, coordinates and website. Existing Pratt, Central, Northwest and Allied source behavior is preserved. Shared IIS identity, HTML and quarantine primitives are extracted from Allied.

The source ships disabled. `ingestion-source-urgiis` must be explicitly enabled for rollout.

Every tenant follows its official owner page, published make directory, all make/model links and its enumerable arrivals page. A tenant with no published arrival cards uses its model graph. The connector rereads the owner, makes and all model directories before emission. It requires unchanged ownership claims, literal paths, labels and control order. Added or removed models fail even if their badges are zero. Small badge changes are allowed as described below. An arrivals window alone cannot qualify: at least one admitted own-yard donor must come from the fully traversed model graph. Arrivals and models are assessed together, with conflicting VIN/destination claims quarantined before deduplication. A modern VIN must pass its check digit; supported pre-1981 serials are accepted. Native year/make/model and an owned per-vehicle destination are required. No identity is decoded or invented.

No tenant emits until its entire graph, closing evidence, ownership and admission guards pass. Durable reconciliation additionally requires the complete tenant prefix and a terminal cursor. A later tenant failure prevents reconciliation of the source. Rejected valid VIN claims remain presence evidence.

Directory badges are informational, not asserted donor totals. The traversal follows every literal make/model link and accounts for cards or an explicit native empty result. A page with 500 cards is incomplete. An empty model advertising at least 500 is also blocked, since the same native boundary can render an empty result. The connector does not truncate these pages or assume filtering a capped shared pool recovers every owned car. Unknown continuation controls, partial documents, supplier changes and unowned destinations fail closed.

Closing badges allow at most `max(3, floor(enumerated model cards * 0.01))` total absolute count changes per tenant, separately for make badges and model badges across all directories. This matches Hollander's three-vehicle or 1% allowance without counting the same car's make and model badge twice. The denominator uses observed native model cards, including rejected or excluded cards, rather than potentially inflated shared-pool badge totals. Additions and removals in different controls cannot cancel. These badge comparisons cannot detect identity turnover that leaves counts unchanged. Drift totals survive chunk checkpoints. A growing model fails if its closing badge reaches 500 or its observed card count plus badge growth reaches 500, including an empty model whose badge crosses the native boundary. Accepted runs publish the donors actually enumerated, without inventing newly advertised cars or dropping observed cars. Structural changes, excessive badge drift and unsafe cap growth return terminal source failures without retrying closing requests. Restart with fresh opening evidence after inspecting the captures; prior published inventory remains intact.

Single-yard catalogs reject unexpected supplier photo codes. Shared-pool tenants require an explicit own-photo filter and exclude unassignable photos. Multi-yard catalogs use agreeing native seller and SKU prefixes, with matching stock/year evidence and no contradictory native part VIN, then map each supplier to a verified physical yard. A shared image bucket is not a yard location.

Only explicitly qualified part-bin stocks may be excluded when native VIN claims and yard photographs are absent. Older numeric-stock donors with missing VINs remain rejects. A real VIN claim or yard photograph overrides the bin exclusion. Nationwide's requested blank-VIN exclusion is supported independently. Exclusions never dilute the 10% rejection denominator. Duplicates must stay at or below 25%. Each tenant has an absolute floor; multi-yard tenants also require each yard's floor. Published per-yard inventory must retain at least 50% of its preceding persisted, non-missing count. Final durable validation reapplies every physical yard floor after source-wide deduplication. Source-wide validation also repeats the usual floor, duplicate, rejection and preceding-run checks.

Requests use a current browser User-Agent, normal headers, an explicit public verification cookie where qualified, manual redirects, a combined request/body timeout, a 4 MiB body cap, and a shared serial gate that waits at least two seconds after responses, including failures. HTTP requests percent-encode parentheses in model names while checkpoints and destinations retain the published links. There are two paced retries with exponential backoff. Each chunk allows three native pages and eight minutes. Whole runs allow 30,000 successful native requests and 8 GiB of response bodies. Retries are additionally bounded per page. Checkpoints are capped at 32 MiB, bind the complete tenant qualification contract and retain only the current tenant's evidence plus the completed prefix. Completed cursors make no further requests.

Run a count-only soak with:

```sh
bun run soak:sources -- --sources=urgiis --max-pages=30000
```

The soak serializes each checkpoint, reports accepted/rejected/excluded/duplicate counts, and writes no canonical inventory. A capped soak stays incomplete. On a failed guard, retain published inventory and inspect the named request, tenant, raw response and checkpoint. Restart after directory or qualification drift. Never force reconciliation from an incomplete cursor.

Qualification uses saved public responses. Tests are offline. Complete replay archives retain separately fetched opening and closing controls; opening controls are never substituted for closing evidence. Replay order follows the connector; acquisition order is recorded in the HTTP receipts. Large archives use Brotli-compressed JSONL so offline tests decode one raw response at a time. Census coordinates come from the yard's published address unless a yard-published point is available.

Qualification began with serial censuses. Later acquisitions allow at most three active tenants, preserve each tenant's own response spacing, and limit combined request starts to one per 3.1 seconds. All tenant sites are conservatively treated as sharing one URG backend for that acquisition limit. The source connector itself traverses tenants serially.

The November 15, 2026 Eagle census followed 37 makes and 284 model pages, then included six arrival observations. It accepted 1,448 unique vehicles, rejected 127 observations, excluded 143 part bins and merged five duplicates. Of 1,717 model cards, 257 had blank VINs (85.0% carried a nonblank VIN). The eligible rejection rate is 127 / 1,580 (8.04%). Its floor is 1,200. The US Census point for 2744 Eagle School Road, Martinsburg, WV 25404 is 39.468480369268, -77.925464629822. The saved geocoder receipt and full 363-response replay are fixtures.

## Qualified yards

| Yard                               | City         | State | Accepted | Rejected | Skipped | Duplicates | Floor |
| ---------------------------------- | ------------ | ----- | -------: | -------: | ------: | ---------: | ----: |
| Eagle Auto Parts                   | Martinsburg  | WV    |    1,448 |      127 |     143 |          5 | 1,200 |
| Linder's Inc                       | Worcester    | MA    |    3,274 |      159 |       0 |         54 | 2,600 |
| Chuckran Auto Parts                | Bridgewater  | MA    |    3,671 |      369 |       0 |         13 | 2,900 |
| United Auto Recyclers              | Omaha        | NE    |   12,356 |       56 |       0 |          5 | 9,800 |
| Ace Auto Recyclers                 | Iowa City    | IA    |    1,524 |      172 |     125 |         56 | 1,200 |
| Lentini Auto Salvage - Ringoes     | Ringoes      | NJ    |    2,429 |   shared |       0 |     shared | 1,900 |
| Lentini Auto Salvage - Port Murray | Port Murray  | NJ    |      924 |   shared |       0 |     shared |   700 |
| Ding's Auto Parts                  | Litchfield   | CT    |    1,110 |      109 |       0 |         24 |   800 |
| Bishop's Auto Parts                | Middletown   | CT    |    3,362 |       82 |       0 |          0 | 2,600 |
| Ace Auto Parts                     | St. Paul     | MN    |    3,015 |      185 |       0 |         54 | 2,400 |
| Chuck's Auto Salvage               | Grand Rapids | MN    |    2,601 |      283 |     480 |         40 | 2,000 |
| Central Auto Recyclers             | Concord      | NH    |    2,477 |      193 |       0 |         52 | 1,900 |

Chuckran's full census follows 43 makes, 407 model pages and 19 arrivals. Its 498-response replay accepts 3,671 donors, rejects 369 observations (9.10%), excludes no rows and merges 13 duplicates. All supplier photographs are MA23. Its floor is 2,900, pacing is 3.5 seconds after responses, and each request has a 90-second timeout. The US Census point for its published Bridgewater address is 41.990325748641, -70.913539837235.

United's full census follows 46 makes, 526 model pages and six arrivals. Its 623-response replay accepts 12,356 donors, rejects 56 observations (0.45%), excludes no rows and merges five duplicates. Every supplier photograph is NE02. Its floor is 9,800. The US Census point for 5702 S 60th St, Omaha, NE 68117 is 41.200697251758, -96.004715979234.

Linder's full census follows 41 makes, 426 model pages and 60 arrivals. It contains 3,427 model cards, with only MA09 supplier photographs. Its eligible rejection rate is 159 / 3,487 (4.56%). The 513-response replay includes separately acquired closing controls. Its US Census point is 42.23811894312, -71.782708739098 for 211 Granite St, Worcester, MA 01607.

Ace Iowa follows 42 makes, 376 model pages and 60 arrivals. Its 465-response replay accepts 1,524 donors, rejects 172 observations (9.82%), excludes 125 verified bulk-part-bin observations and merges 56 duplicates. Saved native detail pages show DORMAN, BROCK, NOF, MONTE, DORMN, 114AFT, BERGER and ORDER holding parts across unrelated vehicles. EPL and AER returned empty details and remain rejects, as do unverified stocks and numeric donors. Every supplier photograph is OO76. Its floor is 1,200. The US Census point for 2752 S Riverside Dr, Iowa City, IA 52246 is 41.625474637231, -91.543835183719.

Lentini's complete 3,969-response production connector replay passes. It follows all 39 makes, 336 model pages and 60 arrivals, with per-donor parts pages and separate closing controls fetched after those details. It accepts 2,429 donors for Ringoes and 924 for Port Murray. Its tenant-wide accounting is 375 rejected observations (9.52%), zero exclusions and 211 duplicates across 3,939 observations. Rejections cannot always be assigned to one physical yard, so the table marks those totals as shared. Its tenant floor is 2,600, with separate yard floors of 1,900 and 700. NJ12 and NJ29 map to Ringoes; II08 maps to Port Murray. The shared NJ12 photo bucket is never used to assign a physical yard. Every admitted donor requires agreeing native stock, year, seller and SKU prefix, with no contradictory native part VIN. The native VIN guard was reapplied to all saved details at final admission.

Ringoes publishes 130 US-202, Ringoes, NJ 08551; its Census point is 40.469701869601, -74.861027850067. Port Murray publishes 89 Brickyard Rd., Port Murray, NJ 07865; its Census point is 40.7837265065, -74.91716279734. Separate Census receipts and a filtered public supplier-to-city mapping are fixtures.

Dings follows 36 makes, 246 model pages and 60 arrivals. Its 323-response replay accepts 1,110 donors, rejects 109 observations (8.77%), excludes none and merges 24 duplicates. Every supplier photograph is CT05. Its floor is 800. The US Census point for 99 Little Pitch Road, Litchfield, CT 06759 is 41.725760885077, -73.178934578762.

Bishop's follows all 35 makes and 322 model pages, with no published arrival-card enumeration. Its 396-response replay accepts 3,362 donors, rejects 82 observations (2.38%), excludes none and has no duplicates. Every supplier photo is AA74. Separate closing owner and directory controls pass. Its floor is 2,600. Qualification recovered a slow Spark page with a 90-second timeout and ordinary curl retries; pacing is 3.5 seconds after responses. The US Census point for 120 Stantack Rd, Middletown, CT 06457 is 41.564414369713, -72.749473882561.

Ace St. Paul follows all 38 makes, 342 model pages and 60 arrivals. Its 423-response replay accepts 3,015 donors, rejects 185 observations (5.69%), excludes none and merges 54 duplicates. Every supplier photo is MN25. Its published contact page provides the verified address and JSON-LD point: 754 Rice Street, St. Paul, MN 55117 (44.963964848401794, -93.10545003558208). Its floor is 2,400 and pacing is 3.5 seconds after responses. Literal parentheses in the published New Yorker model path require ordinary percent-encoding for HTTP transport; the native destination is retained.

Chuck's follows all 41 makes, 415 model pages and 43 arrivals. Its 502-response replay accepts 2,601 donors, rejects 283 observations (9.68%), excludes 480 verified part-bin observations and merges 40 duplicates. Each of the 25 explicit NOF stocks has native parts from multiple makes and years, with no donor VIN claims. A native VIN or yard photo overrides the bin exclusion. NEW, RIDE and unverified NOF stocks remain rejects. All supplier photos are PP42. Its floor is 2,000, tenant spacing is 3.5 seconds and the public `urg_hv=1` cookie is required. The Census point for 30187 E. Bass Lake Road, Grand Rapids, MN 55744 is 47.314234240213, -93.604031442421.

Central NH follows all 43 makes, 380 model pages and 60 arrivals. Its 471-response replay accepts 2,477 donors, rejects 193 observations (7.09%), excludes none and merges 52 duplicates. All supplier photos are FF27. Separate closing ownership and directory controls pass. Its floor is 1,900. The Census point for 54 Basin Street, Concord, NH 03301 is 43.190099292255, -71.523265006371.

## Smith qualification, November 16, 2026

Smith Auto, Inc. remains excluded. Its full 40-make, 392-model census contains
3,275 model cards and 60 arrivals. The candidate production-connector replay
accepts 2,945 unique identities, rejects 218 observations (6.84%), excludes
148 verified NOF, ASA002 and BROCK part-bin observations and merges 24 duplicates.
Those bins have saved native parts across unrelated makes and years with no
VIN claims; numeric and unverified stocks remain rejects. All observed supplier
photos are NE22, and model pages expose full VINs. Identity quality therefore
has headroom, but it cannot establish complete enumeration.

The published F150 route advertises 163 and renders exactly 30 cards without
an enumerable continuation. A separately paced cache-revalidated request returns
the identical donor fingerprint. Stock 261352, VIN `1FTEW1EP9NKD56443`, appears
in arrivals and its own native detail with matching VIN, stock and NE22 seller,
but is absent from that model page. The public plugin's Browse Vehicles action
returns to the make directory and supplies no model continuation. Do not admit
this partial graph or use arrivals to fill its unmeasured gaps.

Qualification used 492 serial live requests, including five failed or aborted
attempts, cache revalidation, native detail probes and geocoders. The 477-response
candidate replay passes owner, closing, checkpoint and identity-quality checks.
That result does not qualify an independently proven partial native graph.

The full failed-census archive, separate closing controls, part-bin probes,
missing-donor proof and request ledger are retained in the URGIIS fixtures.
No Smith entry or published inventory is created. The small completeness
regression preserves the missing-donor evidence and the exclusion.

## Leads left out

| Yard                          | State   | Reason                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smith Auto, Inc.              | NE      | Published F150 advertises 163 but renders 30 cards with no enumerable continuation. A cache-revalidated read is identical. Its arrivals and native NE22 detail expose stock 261352 / VIN 1FTEW1EP9NKD56443, absent from that model page. Complete enumeration is unproven.                |
| Brown's Auto Salvage          | VT      | The 39,835 badges cover a shared pool. Silverado 1500 advertises 1,325 but returns 500 cards from DD05, BB86, MA06 and AA74. Own-yard filtering cannot repair the cap. Its published `/inventory/` alias returned 404.                                                                    |
| Nordstrom's Automotive        | SD      | The published F150 route advertises 506 but returns an explicit empty result. The ordinary model-name variant also returns empty. Complete enumeration is unproven.                                                                                                                       |
| Nationwide Auto Recycling     | MA      | Both published Mercedes E-Class (502 badge) and C-Class (450 badge) routes return empty. Blank-VIN exclusion is supported, but it cannot recover missing model pages.                                                                                                                     |
| Kosiski Auto Parts            | NE      | F150 stops at 500 shared cards, including AA69 photos. A supplier query does not constrain the pool. Published year search returns parts rather than a complete donor list.                                                                                                               |
| H&H Auto Parts                | NE / CO | NE16, CO26 and CO15 share the NE16 photo bucket. Part details expose supplier prefixes, but official contact information publishes only Cozad and Hudson, and directory searches do not resolve both Colorado supplier mappings. No stock-prefix or physical-yard assignment was guessed. |
| Intermountain Auto Recycling  | ID      | Published model routes are empty or return a capped pool of 500 foreign cars. The normal model-name and supplier-query variants do not reveal a complete own-yard route. Arrivals alone are incomplete.                                                                                   |
| Riverbend Recycled Auto Parts | IA      | The published Ford E250 van model route failed all three spaced attempts: two read timeouts followed by HTTP 500. The interrupted census cannot establish complete enumeration.                                                                                                           |
| EL&M Auto Parts               | NJ      | Explorer reaches 500 shared cards before filtering to NJ15. The 22 NJ15 photos in that truncated result do not prove complete own-yard coverage.                                                                                                                                          |
| Automotive Parts Solutions    | MN      | The published `/parts/ROVER_-_STERLING` make advertises one donor but renders an empty vehicle table instead of a model directory. Two ordinary spaced curl retries return the same incomplete graph. Rockville's MN12 attribution was verified, but arrivals alone cannot qualify.       |
| Metro Auto Salvage            | MN      | The published Ford F150 Pickup model route returns 500 shared cards before the MN06 own-yard filter. Filtering the truncated pool cannot prove complete inventory.                                                                                                                        |
| John's Truck & Auto Salvage   | NH      | Complete enumeration fails the rejection guard: 625 / 2,534 observations rejected (24.66%), largely for missing or invalid VINs. Even skipping every repeated or blank-stock observation would leave rejection above 20%.                                                                 |

John's NH completed 45 makes, 386 model pages and seven arrivals, with separate closing controls. It has 1,903 candidate donors, 625 rejected observations and six duplicates out of 2,534 observations (24.66% rejected). There are 611 missing or invalid native VIN observations, including 60 missing stock/destination fields. Even hypothetically skipping all 135 repeated or blank-stock observations leaves 490 / 2,399 rejected (20.43%). No placeholder stocks were excluded. The tenant remains out. The fixture receipt and complete 481-response raw census retain this failure for offline inspection.

## Live qualification requests

The saved ledger records 10,378 HTTP attempts, including geocoding and retries. Six known unlogged attempts bring the recorded-plus-known count to 10,384: two initial Eagle requests, one Kosiski plugin script and three early Metro timeouts. Redirect hops are not counted separately, so this is not an exhaustive wire total. One shared public supplier-directory attempt is included in the ledger outside the per-tenant rows.

| Tenant                           | Recorded HTTP attempts | Known unlogged attempts |
| -------------------------------- | ---------------------: | ----------------------: |
| Eagle Auto Parts                 |                    368 |                       2 |
| Brown's Auto Salvage             |                      9 |                       0 |
| Nordstrom's Automotive           |                      7 |                       0 |
| Nationwide Auto Recycling        |                      9 |                       0 |
| Linder's Inc                     |                    519 |                       0 |
| Chuckran Auto Parts              |                    505 |                       0 |
| United Auto Recyclers            |                    626 |                       0 |
| Kosiski Auto Parts               |                      8 |                       1 |
| H&H Auto Parts (Cozad)           |                     16 |                       0 |
| Riverbend Recycled Auto Parts    |                     34 |                       0 |
| Ace Auto Recyclers               |                    479 |                       0 |
| Intermountain Auto Recycling     |                      6 |                       0 |
| Lentini Auto Salvage             |                  4,029 |                       0 |
| EL & M Auto Parts                |                      4 |                       0 |
| Dings Auto Sales and Salvage     |                    326 |                       0 |
| Bishop's Auto Parts              |                    404 |                       0 |
| Ace Auto Parts & Salvage         |                    436 |                       0 |
| Automotive Parts Solutions (APS) |                  1,080 |                       0 |
| Chuck's Auto Salvage             |                    542 |                       0 |
| Metro Auto Salvage               |                     10 |                       3 |
| Central Auto Recyclers           |                    476 |                       0 |
| John's Truck & Auto Salvage      |                    484 |                       0 |

A separate anonymous browser visit to APS's published Google map observed 112 HTTP resources and 78 non-HTTP resources. These are recorded separately from the HTTP ledger. The receipt retains sanitized public URLs, HTTP status where known and timing where recorded; browser tracking parameters and freeform error strings are omitted. Raw browser resource logs are not committed.

## Validation

Final qualification admits 38,191 unique vehicle identifiers across eleven tenants and twelve physical yards, with zero cross-tenant duplicates. The source floor is 30,000 and every physical-yard floor holds. All eleven complete connector replays pass across 8,546 separately captured native responses.

Lint, typecheck and formatting of all 63 changed text files pass. The affected set passes 58 tests. The full `bun test --timeout 15000 src` run passes 4,394 tests across 409 files with zero failures in 860.44 seconds, using CI's pinned Bun 1.4.1. Lentini's full replay completes in 336.56 seconds under its explicit 600-second per-test timeout. Tests use local responses only. No lockfile changed after the machine's global Bun upgrade.

`SKIP_ENV_VALIDATION=1 bunx next build` compiles 117 steps, four workflows and the Next application without `workflow-node-module-error`. Later page collection stops on a missing local PostHog API key. The source remains disabled; no inventory was enabled.

## Batch A qualification, November 16, 2026

None of the ten screened batch A tenants qualifies. They remain outside `URGIIS_TENANTS`; no new inventory floors or exclusion whitelists are registered. The source stays disabled and the 50% previous-run drift guard is unchanged.

| Tenant                      | URG owner | Recorded attempts | Exclusion                                                                                                                                                        |
| --------------------------- | --------- | ----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heritage Auto Parts         | NN36      |                43 | Ford F250SD returns 30 cards against badge 74. Two valid own-yard arrivals are missing. Maserati also publishes an unlabeled `/parts/MASERATI//` control.        |
| I-17 Used Auto Parts        | AZ29      |                10 | Lexus GS300 returns 30 cards against badge 52. Its native arrivals title also fails the identity guard.                                                          |
| Higgins Auto Parts          | CA22      |                 9 | The published arrivals page has donor cards but fails the native HTML title guard. Three model probes return 67, 28 and 37 cards, without a 30-card cutoff.      |
| Stadium Auto Parts          | CO10      |                16 | F150 and Dodge 1500 return 500 shared cards from CC24 and CO10. Own-photo filtering cannot recover the truncated pool.                                           |
| Tom's Auto Salvage          | TT68      |                32 | Maserati publishes an unlabeled `/parts/MASERATI//` model control advertising one donor. The model graph is not enumerable. F150 returns 47 cards.               |
| Speedway Auto Parts         | IL22      |                43 | Equinox returns 30 cards against badge 86, with MI34 photos despite IL22 ownership.                                                                              |
| Quick Recovery Auto Salvage | QQ32      |               110 | All 43 makes expose 474 models, but Cadillac ATS returns HTTP 500 on three paced attempts. Only 58 model pages complete. Large probes return more than 30 cards. |
| TNT Auto Parts              | UU50      |               336 | Complete census rejects 252 / 1,346 observations (18.72%).                                                                                                       |
| Borges Foreign Auto Parts   | MA15      |               494 | Complete census rejects 460 / 4,167 observations (11.04%).                                                                                                       |
| iDrive Auto Parts           | MI47      |                10 | Ford F150 returns 30 cards against badge 83.                                                                                                                     |

All four 30-card cases have no published continuation controls. Their `?page=2` variants return HTTP 404 on three attempts each; `?per_page=500` repeats the identical 30 records. Heritage's missing F250SD stocks are 260444 (2014) and 260443 (2012). Both have valid native VINs and NN36 photos in arrivals, and 260444 still resolves at its native parts destination. No partial inventory is admitted.

TNT traverses 35 makes, 256 model pages and 60 arrivals. Its 331-response replay contains 1,286 model cards, 1,043 candidate donors, 252 rejects, zero exclusions and 51 duplicates. Every supplier photo is UU50. Even hypothetically excluding all 97 AFT, NOF, CPO and DLRS bin observations leaves 155 / 1,249 rejected (12.41%). Those stocks are not qualified for exclusion. Older donor stocks with missing VINs remain rejects.

Borges traverses 41 makes, 399 model pages and 60 arrivals. Its 486-response replay contains 4,107 model cards, 3,660 candidate donors, 460 rejects, zero exclusions and 47 duplicates. Every supplier photo is MA15. Even hypothetically excluding all 41 MISC, MIS and NEW observations leaves 419 / 4,126 rejected (10.15%). Those stocks are not qualified for exclusion. Both complete catalogs have separately acquired closing owner and directory controls; normal and optimistic negative replays emit zero inventory.

The 1,103 recorded attempts include native pages, recovery probes, retries, two interrupted requests, geocoding and the yard-published map redirect. `batch-a-requests.jsonl.gz` preserves acquisition order, status, timing where recorded and response sizes. `batch-a-qualification.json` records each outcome and source budgets. Replay ordering follows the connector, without substituting opening responses for closing evidence.

Initial acquisition used a within-batch gate. After parent coordination, tenant requests used the shared cross-process `flock` gate on `/tmp/jyi-urg-gate.lock`, with epoch seconds in `/tmp/jyi-urg-gate.last`, a 3.1-second start gap and 3.5-second per-tenant response spacing. One known exception is retained: resuming a paused Borges crawler released a stale reservation, placing the contact request and model-135 starts 155 ms apart on November 16 at 15:02:40 UTC. Pausing around queued requests was discontinued. Both responses and the exception are recorded.

No tenants are added to daily ingestion. The baseline offline audit remains 38,191 unique identifiers, zero cross-tenant duplicates, a 30,000 source floor and all twelve physical-yard floors satisfied. A complete source run still needs 8,546 successful native requests and 1,458,598,956 response bytes, below the 30,000-request and 8 GiB limits. Configured response spacing contributes 5.88 hours; serial wall time is approximately 8.25 hours at one second per response or 17.75 hours at five seconds per response. These are explicit latency scenarios, not a new live whole-source soak.

Batch A validation passes lint, typecheck, changed-file formatting and `bun test --timeout 15000 src`: 4,574 tests across 431 files, zero failures in 1,718.47 seconds on Bun 1.4.4. The twelve new offline tests cover cutoff evidence and complete negative replays. Lentini's existing full replay completes in 490.85 seconds under its explicit 600-second timeout.
