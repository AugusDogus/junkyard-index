# HeavyTruckParts.net salvage suppliers

`heavytruckparts` ships disabled (`ingestion-source-heavytruckparts`). It adds one marketplace credit in each of seven states. Dutchers (NY) and C&S (SD) retain their existing source keys, behavior and enumeration policies. No enablement, deployment or merge is included.

## Qualified census

The November 15, 2026 public census reconciles both complete native year orders and closing store counts. Each supplier has its own physical yard, item destinations and quality floor.

| Supplier                        | City         | State        | Supplier/store | Store count | Accepted | Rejected | Excluded | Duplicates |
| ------------------------------- | ------------ | ------------ | -------------- | ----------: | -------: | -------: | -------: | ---------: |
| Rydemore Heavy Duty Truck Parts | Fitchburg    | MA           | 4594927/1      |          45 |        8 |        0 |       37 |          0 |
| West Side Truck Parts           | Owensboro    | KY           | 7641244/1      |         620 |      565 |       12 |       43 |          0 |
| B & W Truck Center              | Aiken        | SC           | 1586091/1      |          30 |       19 |        0 |       11 |          0 |
| All County Truck Parts          | Chattanooga  | TN           | 7712369/1      |          42 |       40 |        0 |        1 |          1 |
| Crest Truck Parts               | Cartersville | GA           | 2251343/1      |         238 |      218 |        8 |        1 |         11 |
| CA Truck Parts                  | Opa-Locka    | FL           | 297005/1       |           4 |        4 |        0 |        0 |          0 |
| American Truck Salvage          | Phoenix      | AZ           | 3857491/1      |         176 |        3 |        0 |      173 |          0 |
| **Total**                       |              | **7 states** |                |   **1,155** |  **857** |   **20** |  **266** |     **12** |

A salvage or dismantling yard's Complete Vehicle and Vehicle For Sale listings may qualify. Explicit retail stock, equipment, attachments, trailers, boats and golf carts do not. Numeric prices and running/ready-to-work sales language are excluded unless the listing explicitly establishes salvage or non-running status. This deliberately withholds ambiguous priced stock. Exclusions remain visible in raw accounting and are separate from identity rejects.

Rydemore describes a demanufacturing facility; only eight non-running or incomplete units survive the retail filter. West Side's mixed roster includes passenger vehicles and motorcycles as well as trucks. CAT CT660 road trucks remain eligible; CAT loaders do not. B&W describes its used/recycled parts facility; eleven retail listings are excluded, while its truck needing an injection pump remains eligible. All County loses one priced retail truck and has one benign duplicate. Crest explicitly specializes in late-model salvage and lists dismantled donors. CA Truck Parts labels its four units Salvage. American describes separate dealership and parts operations: only items 542292, 542296 and 542297, explicitly marked “This truck can not be sold complete,” qualify. Its generic USED listings do not establish salvage scope.

Required identity is a native VIN or pre-1981 manufacturer serial, year, make and model. Modern VINs also pass the standard check digit. Blank/placeholder identity is rejected without deriving make/model from a VIN or description. Each accepted record links to its supplier/store/category-bound native item. Optional stock, arrival, color and yard position stay null; vendor logos become null images. Rejected format-valid identities protect observed presence. Conflicting duplicate claims or cross-yard VIN ownership stop the entire source.

## Suppliers left out

| Supplier                                 | State                  | Result and reason                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vriens Truck Parts, Salt Lake City       | UT                     | Complete 164-item census: 129 candidates, 24 identity rejects, 11 equipment/retail exclusions. Rejection is 24/153 (15.7%), above 10%; the entire supplier stays out. Includes truncated VINs, a 2112 year and check-digit failures.                                                                                                                   |
| WM. Cohen & Sons, Thorndale              | PA                     | Complete 27-item census: eight candidates, two missing-model rejects, 17 equipment/retail exclusions. Rejection is 2/10 (20%); the entire supplier stays out. The Grove crane is equipment. Native UNKNOWN models are never replaced from descriptions.                                                                                                |
| High Mountain Horsepower, Spokane Valley | WA                     | Two priced retail listings: a $39,995 Peterbilt with hood damage/unknown mechanical condition and an $8,995 fleet-maintained F550. Neither explicitly establishes salvage or a non-running parts unit. No qualifying roster.                                                                                                                           |
| Bobby Johnson Equipment, Oil City        | LA                     | All four current listings are priced retail trucks ($24,500 to $125,000), including “READY TO GO” and “READY TO WORK.” Parts-sales business text does not establish these units as salvage.                                                                                                                                                            |
| Vander Haags KC                          | MO                     | Complete Vehicle results are retail-priced Truck listings, not Parts-Unit donors. Store count 22 but the normalized result page exposes 13 Truck cards, so it also lacks reconciliation.                                                                                                                                                               |
| Vander Haags DM / CB / SP                | IA                     | Retail truck results, mixed with other categories. Parts-Unit searches for all three stores and KC return store pages with no donor roster. No Parts-Unit search option or independent count appears in these stores. Partial sitemap item URLs cannot prove complete active salvage enumeration. Left out pending an enumerable public donor catalog. |
| Sam's Riverside                          | IA                     | Memo identifies Used Trucks resale stock, including retail prices and rebuilt-title sales. Not added.                                                                                                                                                                                                                                                  |
| LKQ resale stores                        | CO, IL, MD, MN, MS, OH | Memo identifies Whole Truck For Resale stock. Excluded without another live crawl.                                                                                                                                                                                                                                                                     |
| Vander Haags Winamac / NLI Sales         | IN, AL                 | Memo identifies retail trucks or trucks/trailers for sale without a proven enumerable salvage roster. Not added.                                                                                                                                                                                                                                       |

## Enumeration and failure behavior

The generic source uses per-supplier ID, store, item category, native owner/geography, published address and yard coordinates. It reuses the existing shared HTP HTTP client and card parser. The new cursor graph imports only pure schemas, metadata and census validation. HTTP, HTML parsing and Effect stay outside its Workflow import graph.

For each configured supplier, read the opening independent store count, every descending-year page, every ascending-year page, then the closing store count. Require exact native Next/Last controls, page sizes, item ownership, item metadata agreement across repeated IDs, equal per-year counts and a union matching the independent store total. Repeated destinations across sort pages are traversal overlap; distinct items sharing one consistent VIN are source duplicates. No vehicles, yards, presence or accounting emit until all seven suppliers close and validate.

A normal unchanged census costs 114 serial GETs. Checkpoints bind supplier order, scope/config, prior accepted count, request/byte accounting and the exact page frontier. Terminal resume fetches and emits nothing. Each chunk admits at most eight physical GETs, pauses after 60 seconds between requests and has a four-minute deadline. Whole runs stop at 512 requests or one hour. Responses are limited to 2 MiB and checkpoints to 8 MiB.

Per-supplier minimum accepted counts are 5/450/15/30/175/3/2 in the table's order. Each supplier independently enforces the unchanged 10% rejection and 25% duplicate ceilings, excluding intentional out-of-scope rows from those denominators. Whole-source validation requires at least 700 unique vehicles and the existing 50% prior-run drift guard. An invalid count, drift, malformed page, ownership change, block or quality failure preserves previous inventory and the last committed checkpoint. Inspect saved evidence before restarting; do not raise a guard to admit bad data.

HTP robots.txt publishes Crawl-delay 4 and disallows `page=` URLs. Explicit native pagination is used for these count-checked full catalogs, as in Dutchers: West Side alone spans 25 pages and requires a complete unfiltered roster, including older and malformed-year rows that year-range controls cannot prove. The shared process-wide HTP semaphore covers complete response bodies and four completed seconds, including failures. Requests have no retries, manual redirects, a 25-second response deadline and a separate 25-second body deadline. Dutchers and C&S continue using that same semaphore.

## Evidence and diagnostics

Qualification made **174 live requests: 157 HTP GETs and 17 geocoder GETs**, all serial. Every HTP response was HTTP 200. Request receipts prove a minimum 4.200-second completed gap across all requests, including the production-client store smoke check. No ordinary HTTP filtering changes were necessary. Two initial Nominatim requests returned 429; later identifying-User-Agent structured address requests succeeded. These failures are retained.

Five coordinates are unique Census Public_AR_Current address-range interpolations, not rooftop points. Crest and American use unique OpenStreetMap Nominatim house-address matches (ways 546691786 and 274202609). Census did not match Crest. A broadened Census Phoenix query incorrectly returned **East** Broadway, so that point was discarded; Nominatim matched 2850 **West** Broadway Road and ZIP 85041. The saved responses ground every admitted coordinate.

`src/server/ingestion/heavytruckparts-test-fixtures/native.json.gz` is a lossless base64 line dictionary plus per-response line indexes. It preserves original response bytes, including shared scripts and styles, without repeating page chrome. `receipts.json` records every URL, status, final URL, byte count and request timing. Offline tests reconstruct the captured responses and never contact the network.

```sh
bun test src/server/ingestion/heavytruckparts-connector.test.ts src/server/ingestion/cstruck-client.test.ts
bun run soak:sources -- --sources=heavytruckparts --cycles=1 --max-pages=114
```

The soak is a live, count-only diagnostic. It discards vehicles, uses the same pacing and preserves an incomplete checked cursor at its physical-GET cap. Do not run it in offline tests.

Local verification: typecheck, lint, changed-file oxfmt and 282 affected tests pass. `bun test --timeout 15000 src` passes all 4,333 tests across 403 files. Repository-wide formatting still encounters existing formatting issues and the malformed Parts Galore HTML fixture. `SKIP_ENV_VALIDATION=1 bunx next build` compiled all 117 steps and four workflows without `workflow-node-module-error`, then failed collecting `/api/unsubscribe` because the local PostHog API key was absent.
