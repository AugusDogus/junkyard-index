# Hollander Stores ingestion

The `hollanderstores` source ships disabled. It covers 51 physical yard locations belonging to 43 businesses in VT, IA, MA, NJ, CT, MN, MS, NY, OR, WI, AR, IN, MO, FL, LA, MI, AL, CA, CO, GA, KY, OK and WA. The November 15 expansion adds 30 locations from 22 businesses and leaves AAA Auto Parts and OK Auto Parts out of the configured tenant registry. It does not alter the existing `beavers` source, tenant 503, or its make policy.

## Initial five-yard qualification on November 15, 2026

| Yard                                | Published address                      | Tenant                 | Published | Accepted | Rejected | Missing native make |
| ----------------------------------- | -------------------------------------- | ---------------------- | --------: | -------: | -------: | ------------------: |
| LeBlanc's Auto                      | 37 Willow Rd, Bennington VT 05201      | leblancsauto / 4573    |       541 |      541 |        0 |                 173 |
| Monster Junkyard                    | 1745 Page Blvd, Springfield MA 01104   | blvdautoparts / 8069   |        83 |       83 |        0 |                  15 |
| Standard Used Auto Parts & Wrecking | 257 Granite St, Worcester MA 01607     | standardauto / 2329    |        85 |       79 |        6 |                  15 |
| Petrillo's Used Auto Parts          | 150 Middletown Ave, New Haven CT 06513 | petrillosauto / 1975   |        61 |       59 |        2 |                   8 |
| Kirchhayn Auto Parts                | W4726 County Road A, Fredonia WI 53021 | kirchhaynautopa / 6549 |       114 |      114 |        0 |                  24 |

The initial five qualify: 876 accepted, eight rejects, no duplicate VINs or destinations. Standard's six rejected VINs include two short VINs and four check-digit failures, 7.1% of its published roster. Petrillo has two check-digit failures. Each yard must independently remain at or below 10% rejects; a larger census cannot conceal a failing smaller yard. Accepted floors are respectively 450, 65, 65, 45 and 90, plus an expanded 30,000-vehicle source floor. Shared validation applies the 50% previous-count drift and 25% duplicate guards. Conflicting duplicate VIN claims are rejected and their structurally valid VINs preserve existing presence.

Two independently captured card rosters per tenant match all parsed rows, counts, VINs, stock numbers, headings and vehicle destinations. Exact response bodies are saved as gzip fixtures with byte counts and SHA-256 receipts. Tests replay them offline. Qualification made ten serial Hollander POSTs, five Census GETs and two business-website GETs (normal website redirects followed), with three-second gaps between requests in each capture. No new vPIC requests were needed: the verified November 15 investigation already decoded all 884 VINs. Its successful VIN-to-make results bootstrap the production cache in `hollanderstores-vpic-seed.json`.

LeBlanc's published inventory contains 461/541 vehicle IDs below 68.24 million, predating approximately early 2025; 48/541 are at least 70.87 million, approximately since early 2026; 32 fall between those ranges. These are record-ID age estimates, not acquired dates. Include all published donors. The platform lists them as current inventory, but on-lot availability of the oldest records remains unverified. Monster's 83 and Petrillo's 61 records are all in the newest range; Standard has 73/85 and Kirchhayn 85/114 in that range. Available dates remain null.

## November 15 coverage expansion

The 21 added yards publish 30,624 records: 30,321 accepted and 303 rejected. Before the Paul's addition, this capture accepted 31,197 records across 26 locations. Every added yard stays below the 10% rejection guard. New accepted floors are 80% of the verified published count, rounded down, with a minimum of one. Source validation requires at least 30,000 accepted vehicles. Rejected structurally valid VINs continue to protect prior presence. No make is inferred from a model name, and a populated native make is retained even when a cached VIN decode disagrees.

| Yard                     | City         | State | Published | Accepted | Rejected |
| ------------------------ | ------------ | ----- | --------: | -------: | -------: |
| Piper Auto Parts         | Bloomfield   | IA    |       570 |      567 |        3 |
| Sun Line                 | Cedar Rapids | IA    |       247 |      247 |        0 |
| Spilman Auto Parts       | Bloomfield   | IA    |       491 |      489 |        2 |
| Robertson's Salvage      | Wareham      | MA    |       752 |      749 |        3 |
| Milford Motors           | West Milford | NJ    |       105 |      103 |        2 |
| Terryville Auto          | Terryville   | CT    |       267 |      266 |        1 |
| A-Abco Auto Parts        | Fridley      | MN    |     5,333 |    5,328 |        5 |
| FLAP Auto Parts          | Annandale    | MN    |     5,737 |    5,639 |       98 |
| Windy Hill Auto Parts    | New London   | MN    |       132 |      127 |        5 |
| Biloxi Auto Recycling    | Biloxi       | MS    |     1,417 |    1,406 |       11 |
| Rogers Auto Parts        | Ellisville   | MS    |       677 |      676 |        1 |
| Lamar Auto Salvage       | Sumrall      | MS    |       559 |      550 |        9 |
| Brothers Pro Parts       | Red Banks    | MS    |        25 |       24 |        1 |
| A-Plus Parts Online      | Lindenhurst  | NY    |     2,866 |    2,838 |       28 |
| North Verde Auto Salvage | Ontario      | OR    |       192 |      191 |        1 |
| B&K Auto Salvage         | La Grande    | OR    |       131 |      123 |        8 |
| Conrads Auto Salvage     | Mondovi      | WI    |     3,237 |    3,227 |       10 |
| Rocki Top Auto           | Glen Flora   | WI    |       250 |      249 |        1 |
| B&M Auto Parts           | Waukesha     | WI    |        55 |       55 |        0 |
| NWA U-Pull-It            | Rogers       | AR    |     7,576 |    7,462 |      114 |
| Branson Salvage          | Fort Smith   | AR    |         5 |        5 |        0 |

OK Auto Parts, Richland MS, tenant `okautoms / 1897`, is left out. Five independent captures publish the same 5,666 rows and vehicle destinations but change the order of duplicate-stock records. The existing ordered opening/closing guard rejects these differences. No partial roster is accepted. The address, geocode, make lookups, initial roster and subsequent captures remain as research evidence.

AAA Auto Parts, Rosemount MN, tenant `aaaparts / 69`, is left out. It publishes 17,884 vehicles, requiring 895 native list pages per pass. The first two independent page requests took 118.7 and 110.3 seconds. A complete opening and closing enumeration cannot be qualified within the two-hour census lifetime at the observed request rate. The independent second page reports 17,883 vehicles, showing count drift as well. No partial roster or guessed accepted/rejected count is published. Its 2871 West 160th Street address and Census point are retained as research evidence only.

The native card view ignores `page`. The new list traversal explicitly posts `hdnChangeDisplay=list` to `/VehicleDealerSearch?page=N`; it validates the current page, next destinations, 20-row page size, final remainder, total, and tenant links. List view publishes year, model, stock and VIN but has no make column. Valid VINs therefore use the same batched cache policy. Partial pages stay in a checked cursor and emit nothing. Offline replay exercises the entire paged state machine with the already-audited LeBlanc roster. AAA's actual first and second pages verify the native grammar and distinct destinations. Paging support does not qualify AAA or add it to the registry.

Piper, Spilman, A-Abco, Rogers and B&M changed their published counts during qualification. Their earlier responses are retained as `*-initial.html.gz`; the configured opening and closing captures use the independently matching newer rosters. `drift-history.json` records each refresh: Piper lost one vehicle, Spilman two, A-Abco three, Rogers two and B&M one. These captures justify a three-vehicle floor for ordinary small-yard turnover; the 1% allowance scales to larger yards while staying stricter than Joliet's 5% disagreement limit. Offline tests now publish the observed opening set using the original drifted captures as well, including one addition and one removal, and reject excessive identity turnover. OK also retains its superseded captures. The vPIC audit tests use the initial candidate rosters, including excluded OK, so every live lookup remains tied to a genuinely missing native make at request time.

### Street addresses and coordinate evidence

| Yard                     | Physical street address                       | Coordinates (lat, lng)   | Coordinate source              |
| ------------------------ | --------------------------------------------- | ------------------------ | ------------------------------ |
| Piper Auto Parts         | 607 S East Street, Bloomfield IA 52537        | 40.7465341, -92.4095994  | US Census Public_AR_Current    |
| Sun Line                 | 4400 6th Street SW, Cedar Rapids IA 52404     | 41.9336726, -91.6763311  | US Census Public_AR_Current    |
| Spilman Auto Parts       | 20311 Old Highway 2, Bloomfield IA 52537      | 40.7502367, -92.4287022  | US Census Public_AR_Current    |
| Robertson's Salvage      | 2680 Cranberry Highway, Wareham MA 02571      | 41.7697907, -70.7039861  | US Census Public_AR_Current    |
| Milford Motors           | 112 Weaver Road, West Milford NJ 07480        | 41.0438818, -74.3737133  | US Census Public_AR_Current    |
| Terryville Auto          | 35 Fall Mountain Rd., Terryville CT 06786     | 41.6442074, -72.9867090  | US Census Public_AR_Current    |
| A-Abco Auto Parts        | 7300 Old Central Ave., Fridley MN 55432       | 45.1011654, -93.2381724  | US Census Public_AR_Current    |
| FLAP Auto Parts          | 3531 Co Rd 3 NW, Annandale MN 55302           | 45.2010343, -94.1854038  | US Census Public_AR_Current    |
| Windy Hill Auto Parts    | 9200 240th Ave NE, New London MN 56273        | 45.3515026, -94.9182793  | US Census Public_AR_Current    |
| Biloxi Auto Recycling    | 13464 Scruggs Ln., Biloxi MS 39532            | 30.4840971, -88.9083495  | Marker in business website map |
| Rogers Auto Parts        | 5222 Highway 11 N, Ellisville MS 39437        | 31.6292412, -89.1830886  | Marker in business website map |
| Lamar Auto Salvage       | 8575 US Highway 98, Sumrall MS 39482          | 31.2900748, -89.5888783  | US Census Public_AR_Current    |
| Brothers Pro Parts       | 4162 Highway 178, Red Banks MS 38661          | 34.8287881, -89.5664650  | US Census Public_AR_Current    |
| A-Plus Parts Online      | 640 West Hoffman Avenue, Lindenhurst NY 11757 | 40.6830773, -73.3873798  | US Census Public_AR_Current    |
| North Verde Auto Salvage | 2001 North Verde Drive, Ontario OR 97914      | 44.0456630, -116.9855574 | US Census Public_AR_Current    |
| B&K Auto Salvage         | 64190 Ore. Highway 203, La Grande OR 97850    | 45.2808807, -118.0158765 | US Census Public_AR_Current    |
| Conrads Auto Salvage     | E9889 10th Avenue, Mondovi WI 54755           | 44.6853766, -91.6617765  | OpenStreetMap Nominatim        |
| Rocki Top Auto           | W3095 Walrath Road, Glen Flora WI 54526       | 45.4357150, -90.8488725  | US Census Public_AR_Current    |
| B&M Auto Parts           | W227 S2698 Racine Ave., Waukesha WI 53186     | 42.9960090, -88.1998275  | OpenStreetMap Nominatim        |
| NWA U-Pull-It            | 600 West Price Lane, Rogers AR 72758          | 36.2969277, -94.1178591  | US Census Public_AR_Current    |
| Branson Salvage          | 2615 North 17th, Fort Smith AR 72904          | 35.4057186, -94.4138087  | US Census Public_AR_Current    |

Piper's own contact page publishes 607 S East Street. Iowa Automotive Recyclers publishes Spilman's 20311 Old Highway 2. Windy Hill's own site publishes 9200 240th Ave NE. OK's own contact page maps 771 Highway 49 South and 530 Old Highway 49 South, both in Richland; its Hollander phone matches the first store. Its research metadata uses that primary business address and does not invent per-vehicle lot assignments. Rogers' dealer directory gives 5222 Highway 11 North and its matching 601-428-0411 phone. Its own map resolves the same 5222 US-11 business. Rocki Top's own site publishes W3095 Walrath Road, correcting Hollander's Walthrath spelling. Brothers' Census match uses the postal spelling Red Banks.

B&M's Nominatim match is the exact W227S2698 building. Conrad's match is the named industrial yard parcel with house number E9889. Biloxi and Rogers use the actual business markers returned by maps embedded on their own websites, with matching street addresses and phone numbers. Map camera centers are not used as yard coordinates. Successful and empty Census/OSM responses, map responses, address pages and response receipts are saved alongside the rosters.

### Capture and request accounting

This expansion made 327 logical live requests: 80 Hollander requests, 200 vPIC POSTs, 28 Census GETs, 11 Nominatim GETs and eight business-site or map requests. Full URLs, timings, request bodies and response receipts are in `expansion/requests.json`. Requests were serial with three-second gaps; ordinary website redirects were followed. This includes the failed FLAP address request, the initial Nominatim 429, and two refused HTTPS connections to business sites that publish HTTP URLs. FLAP succeeded on retry. A normal application User-Agent resolved the Nominatim response; the published HTTP business pages worked. North Verde's closing inventory also timed out once and succeeded on retry. Six earlier saved address responses and the original five-yard audit were reused without new requests.

The 200 new vPIC POSTs covered 9,975 unique check-digit-valid VINs with missing native makes, at most 50 per request. Successful results extend the existing permanent VIN seed; failed lookups remain explicit rejects and are not seeded. Tests replay compressed HTTP bodies, check byte counts and SHA-256 receipts, and never contact Hollander, vPIC, Census, OSM or Redis. Opening and closing rosters must pass the bounded turnover and surviving-record checks described below before acceptance.

## Paul's Auto Yard: nine Indiana locations

Paul's is one business with nine separately registered physical locations. Its own [inventory page](https://www.paulsautosalvage.com/used-auto-parts-inventory) links each of these tenants. The legacy AutoRecycler inventory stopped updating in October 2025. No old AutoRecycler arrival dates are copied: Hollander publishes no arrival date, and `availableDate` stays null.

These nine rosters publish 10,010 records: 9,673 accepted and 337 rejected. Each location independently satisfies the existing VIN, complete-enumeration, 10% rejection, accepted-floor, duplicate, and opening/closing drift guards. The complete source now accepts 40,870 vehicles across 35 locations. Every Paul's location has the shared operator `Paul's Auto Yard`, a distinct location name, its own tenant-bound vehicle links, street address and coordinates.

| Location                         | Tenant           | Physical address                        | Coordinates (lat, lng)  | Accepted | Rejected |
| -------------------------------- | ---------------- | --------------------------------------- | ----------------------- | -------: | -------: |
| Paul's Auto Yard - South Bend    | paulsouin / 8559 | 3300 S Main Street, South Bend IN 46614 | 41.6418300, -86.2514900 |      742 |       37 |
| Paul's Auto Yard - Fort Wayne    | paulsfwin / 8504 | 2901 Brooklyn Ave, Fort Wayne IN 46809  | 41.0582100, -85.1647300 |    2,033 |       40 |
| Paul's Auto Yard - Westville     | paulswvin / 8517 | 651 W State Road 2, Westville IN 46391  | 41.5273300, -86.9395100 |    1,560 |       59 |
| Paul's Auto Yard - Merrillville  | paulmerin / 8370 | 6530 Broadway, Merrillville IN 46410    | 41.4997900, -87.3362400 |    1,279 |       52 |
| Paul's Auto Yard - Lake Station  | paulslkin / 8818 | 1501 Lake St, Lake Station IN 46405     | 41.5870090, -87.2660551 |    1,314 |       86 |
| Paul's Auto Yard - Elkhart North | paulelkin / 8554 | 29332 County Road 10, Elkhart IN 46514  | 41.7149400, -86.0314000 |    1,040 |       25 |
| Paul's Auto Yard - DeMotte       | pauldemin / 8518 | 901 Orchid Street, DeMotte IN 46310     | 41.1942800, -87.1769300 |      732 |       20 |
| Paul's Auto Yard - Knox          | paulsknox / 8511 | 10775 IN-8, Knox IN 46534               | 41.2877157, -86.4902489 |      457 |        8 |
| Paul's Auto Yard - Logansport    | paullogin / 8634 | 1834 18th Street, Logansport IN 46947   | 40.7446100, -86.3455300 |      516 |       10 |

Logansport's Hollander About Us profile publishes PO Box 49 in Westville, which is a mailing address. Paul's own [Logansport contact page](https://www.paulsautosalvage.com/logansport-in) publishes 1834 18th Street, Logansport IN 46947 and 574-753-3644. These replace the mailing address, city and phone. Elkhart North is the 29332 County Road 10 location linked from Paul's inventory page. It is distinct from the Elkhart South location on Lusher Avenue.

Eight points come from explicit map markers on Paul's own contact pages, each tied to the full physical address and an enabled marker icon. Knox's own map names only E IN-8 without a house number and places a generic road marker about 9 km from the exact-address Census match. Knox therefore uses the US Census Public_AR_Current point for 10775 IN-8; its two road-name aliases have exactly the same coordinates. All nine Census responses are retained as cross-checks. Westville's Census match changes the published W direction to E, so its matching business-published street address and marker are preferred. An independent Nominatim business-name lookup returned no match and is retained as evidence.

Paul's qualification made 101 additional serial live requests with three-second gaps, including 53 vPIC POSTs for 2,627 unique valid VINs with missing native makes that were absent from the previous seed. Prior successful makes were reused. One exploratory contact URL returned HTTP 404; the actual Logansport page linked by the business succeeded. Every successful decode extends the permanent seed. Opening, closing, address, Census, empty Nominatim, vPIC and error responses are saved under `hollanderstores-test-fixtures/pauls`, with exact byte counts and SHA-256 receipts. Tests replay all responses offline.

## November 16 second tenant batch

This batch qualifies 16 businesses in MO, FL, LA, MI, AL, CA, CO, GA, IN, KY, OK and WA: 15,088 accepted from 15,254 published rows, with 166 rejects. The configured source now has 51 locations and accepts 55,958 vehicles in fixture replay. New floors are `max(1, floor(published / 3))`, a broken-page sanity check. The source floor stays 30,000; the 50% previous-run drift guard and 10% per-yard rejection guard are unchanged. Shroyer is deliberately absent because URG owns that tenant.

| Tenant                                         | State | Published | Accepted | Rejected (%) | Floor | Hollander / vPIC requests |
| ---------------------------------------------- | ----- | --------: | -------: | -----------: | ----: | ------------------------: |
| Mack's Auto Parts (`macksautoparts / 1626`)    | MO    |     1,160 |    1,155 |    5 (0.43%) |   386 |                     3 / 6 |
| ALS Auto Salvage (`alsautosalvage / 257`)      | MO    |       714 |      703 |   11 (1.54%) |   238 |                     3 / 4 |
| AA Auto Salvage (`aaautosalvage / 5074`)       | FL    |       341 |      340 |    1 (0.29%) |   113 |                     3 / 3 |
| Jake's Auto Parts (`jakesautoparts / 5628`)    | LA    |       214 |      213 |    1 (0.47%) |    71 |                     3 / 1 |
| Go Go Auto Parts (`gogoautoparts / 1201`)      | MI    |       171 |      171 |    0 (0.00%) |    57 |                     3 / 1 |
| Bobby's Auto Parts (`bobbysauto / 5695`)       | AL    |       293 |      291 |    2 (0.68%) |    97 |                     3 / 1 |
| MST Recycling (`mstrecycling / 5587`)          | CA    |       233 |      224 |    9 (3.86%) |    77 |                     3 / 1 |
| Foreign Used Parts (`foreignusedpart / 1111`)  | CO    |     2,157 |    2,124 |   33 (1.53%) |   719 |                    3 / 12 |
| M&K Used Auto Parts (`mkauto / 1779`)          | FL    |     2,018 |    2,009 |    9 (0.45%) |   672 |                    3 / 11 |
| Hart's Parts & Recycling (`hartsparts / 7627`) | GA    |       393 |      367 |   26 (6.62%) |   131 |                     3 / 2 |
| Veldman's Auto Parts (`veldmans / 2518`)       | IN    |       473 |      471 |    2 (0.42%) |   157 |                     3 / 3 |
| Davis Salvage (`davissalvageky / 907`)         | KY    |       297 |      297 |    0 (0.00%) |    99 |                     3 / 5 |
| Champion Auto Parts (`champion / 4427`)        | MI    |        72 |       72 |    0 (0.00%) |    24 |                     3 / 1 |
| Rainbow Auto Salvage (`rainbowauto / 2050`)    | OK    |       328 |      304 |   24 (7.32%) |   109 |                     3 / 3 |
| Pasco Auto Wrecking (`pascoauto / 1950`)       | WA    |     6,179 |    6,146 |   33 (0.53%) | 2,059 |                    3 / 49 |
| All West Coast Auto Wrecking (`awcaw / 249`)   | WA    |       211 |      201 |   10 (4.74%) |    70 |                     3 / 2 |

Stricker Auto Parts (`strickerauto / 2364`, Batavia OH) is excluded. Both full censuses reconcile 12,456 cards, unique destinations, VINs, stocks and headings, with no changes. Each body is 47,899,239 bytes, above the existing 40 MiB HTML cap. Production parsing correctly rejects it. Do not accept a partial roster or raise the cap as part of this batch. Its 423 records in the 2026 ID range establish currency, but do not overcome the transport bound. Qualification used two roster POSTs and one About Us GET.

### Currency and roster evidence

All 18 opening/closing pairs match without turnover or surviving-record changes. Production still permits only `max(3, floor(opening * 0.01))` changed identities, and preserves survivor fields and relative order. Every configured tenant has current record IDs or stock-prefix evidence; none of the 17 looks stale under the runbook test. The 70,870,000 boundary is the existing approximate early-2026 record-ID reference, not an arrival date. Keep every published donor and leave `availableDate` null.

| Tenant            | Maximum record ID | IDs at least 70,870,000 | Additional currency evidence                                                                                                                        |
| ----------------- | ----------------: | ----------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `macksautoparts`  |        72,660,508 |              55 / 1,160 | Latest stock 261006 (October 2026); 69 numeric 2026 month prefixes                                                                                  |
| `alsautosalvage`  |        72,801,457 |               710 / 714 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `aaautosalvage`   |        72,734,039 |               101 / 341 | Latest stock 261166 (November 2026); 106 numeric 2026 month prefixes                                                                                |
| `jakesautoparts`  |        72,792,414 |               214 / 214 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `gogoautoparts`   |        72,799,081 |               141 / 171 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `bobbysauto`      |        72,742,732 |                58 / 293 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `mstrecycling`    |        72,808,935 |               233 / 233 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `foreignusedpart` |        72,800,449 |             371 / 2,157 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `mkauto`          |        72,748,714 |             448 / 2,018 | Latest stock 261114 (November 2026); 519 numeric 2026 month prefixes                                                                                |
| `hartsparts`      |        72,798,840 |               393 / 393 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `veldmans`        |        72,781,573 |               473 / 473 | Latest stock 260818 (August 2026); all 473 numeric 2026 month prefixes                                                                              |
| `davissalvageky`  |        72,786,901 |               290 / 297 | Latest stock 261115 (November 2026); 293 numeric 2026 month prefixes                                                                                |
| `champion`        |        72,781,631 |                 72 / 72 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `rainbowauto`     |        72,533,886 |                 6 / 328 | Six 2026-range IDs; published stocks 26K424 and 26E420 support 2026 activity. Most of this roster is older; on-lot availability remains unverified. |
| `pascoauto`       |        72,744,792 |             156 / 6,179 | Recent record IDs; no date inferred from the stock number                                                                                           |
| `awcaw`           |        72,809,891 |               211 / 211 | Recent record IDs; no date inferred from the stock number                                                                                           |

Champion qualifies despite its 72-row roster: all IDs are in the 2026 range, the newest is 72,781,631, both captures match and no rows are rejected. The runbook has no minimum candidate roster size; its new accepted floor is 24. Rainbow has the tightest rejection margin at 7.32%, still 2.68 percentage points below the guard. Hart's 6.62% includes 24 conflicting VIN claims. Shared duplicate quarantine is retained. `rejections.json` records invalid VIN, missing model and conflicting-claim counts (categories can overlap).

Weller Auto Parts (`wellerauto / 2561`) is excluded after location review. Its shared tenant serves Grand Rapids and Kalamazoo. Both saved 2,192-card rosters contain heading/year/make/model, mileage, available-parts count, VIN, stock, image and `/VehicleDealerShowParts/2561/{id}` links, but no per-vehicle yard, branch, address, location identifier or verified stock-to-yard mapping. The only card hidden input is `hdnImgPath`; the response scripts provide no location mapping. The About Us profile supplies the business address at 2525 Chicago Dr, Grand Rapids, which cannot attribute every donor to that yard. Do not infer a yard from stock numbers or assign the combined roster to Grand Rapids. Separate Paul's tenants establish physical-yard attribution; there is no established shared-tenant fallback for geographically separate yards. All original Weller rosters, address/geocode responses, 14 vPIC batches and receipts remain research evidence. Its 2,138 accepted identities and 54 conflicting-claim rejects are excluded from configured totals. Requalification requires reliable per-vehicle location evidence. The exclusion and regression are recorded in `batch-2/candidates.json` and `hollanderstores-batch-2.test.ts`. No new provider requests were made for this review.

### Location evidence

Thirteen configured yards use exact-address Census points, all matching state and postal code. All West Coast publishes "60th East Anthony Road"; Census resolves the house-number spelling to 60 E Anthony Rd, Grapeview WA 98546, which is stored as the physical address. Mack's, Bobby's and Davis return empty Census results for both one-line and structured address requests. OSM street matches for Mack's and Davis are road centroids and are rejected. Bobby's OSM business node has a conflicting ZIP and is retained only as a cross-check.

The three unresolved Census locations use named Google business markers with the full physical street address, state and ZIP. Mack's and Bobby's marker phones match Hollander. Their own sites confirm their addresses; Davis's contact page confirms 4745 Cumberland Falls Hwy. Mack's business marker (38.5483659, -90.2728385) is preferred over its site's inconsistent JSON-LD point and the generic building marker returned by an address-only query. Map camera centers are never used. `locations.json` binds every configured point to its response and address evidence.

### Requests, replay and daily budgets

The audit made 214 logical live requests: 54 Hollander requests (36 complete roster POSTs and 18 About Us GETs), 119 vPIC POSTs for 5,510 new unique check-digit-valid missing-make VINs, and 41 address, map, business-site and geocoder requests. Requests were serial with at least three seconds between completed responses and the next request. Ordinary Google Maps and Bobby's website redirects were followed; 301 discovery responses are retained. All response bodies, including empty geocoder/search results, have exact byte counts and SHA-256 receipts in `batch-2/requests.json`. All 5,510 decodes returned usable makes, extending the permanent seed. Prior successful seed entries are reused, no populated native make was sent for decoding, and the existing one unresolved decode remains an explicit reject.

The daily source remains default-off. No production DB, Redis, Algolia, flags, deployment or notification action was invoked. Offline tests replay full opening/closing bodies through the production HTTP adapter, cache and durable state machine; per-yard snapshots, locations, currency, receipts, vPIC membership, no-partial-publication and terminal resume guards are verified.

The configured census is 56,772 rows, below 100,000, with a 10,740,390-byte ready census state (10,740,393 at `complete`), below 32 MiB. The one-operation chunk yields 102 Hollander requests plus 310 logical decode batches for 15,458 unique missing-make VINs: 412 source-fetch workflow steps, versus 283 before this batch and 427 before Weller's exclusion. Cached batches advance logical operations without HTTP requests. With the committed seed and the fixture's unresolved VIN still uncached, a run needs 102 Hollander requests and one vPIC POST, 103 provider requests before retries. If all 310 decode batches needed transport, it would make 412 provider requests. Source chunk workflow retries remain two, transport attempts at most three, chunk deadline twenty minutes and census lifetime two hours. No budget was raised.

Selected receipts time 92 of the 102 HTML requests: 1,300.728 seconds total, maximum 176.1 seconds. The original ten HTML timings were not retained. The 119 audit vPIC requests average 2.555 seconds, maximum 5.092. Including the three-second request gate gives approximately 1,612.3 seconds (26.9 minutes) with seeds plus the unresolved decode, or 3,328.8 seconds (55.5 minutes) if every logical decode needed transport. These estimates omit the original ten HTML response times, workflow scheduling, parsing, Redis, blob/DB I/O, retries and publication. They are transport estimates, not production completion guarantees. `daily-budget.json` records the measured inputs. This change adds 412 snapshot writes and 411 snapshot loads during fetching; later validation/reconciliation reads and normal cleanup also apply. These blob costs are outside the provider request count and timing estimate.

### Workflow payload and replay audit

The previous durable codec (`durable-cursor.ts`) serialized the full `HollanderstoresCursor`. `durable-source-fetch.ts` returned it without `checkpointState`, and the repository stored it in `next_cursor`. `runDurableSourceChunkStep` passed that same full cursor as its input and returned it in `DurableSourceChunkResult`. Vehicle snapshot blobs did not externalize this census state. Thus large step payloads were real, although multiplying the final JSON cursor by all steps does not measure stored event bytes or prove a daily failure.

The installed Workflow 5.4.0 runtime stores `dehydrateStepReturnValue` bytes in `step_completed.eventData.result` (`@workflow/core/dist/runtime/spec9/step-executor.js`). Inputs use `dehydrateWorkflowReturnValue` for the corresponding `step_created` event. Its Devalue codec deduplicates repeated values within a payload; `serialization/step.js` compresses before optional encryption. Compression starts at 1,024 bytes, normally Zstandard on supported Node versions, with gzip fallback and a disable override. `@workflow/world-vercel/dist/events.js` sends opaque payload bytes in v4 frames. Storage references and compression do not turn an ordinary cursor object into our private ingestion snapshot reference.

A size model of the original 52-yard, 427-operation frontiers produces approximately 4.68 GB of Devalue step-result bytes, or 884.7 MB with Zstandard. Step inputs add approximately 4.67 GB uncompressed or 882.7 MB compressed. This model uses the saved opening fixtures, fixed-width checksums and zero terminal metrics; it excludes event metadata/encryption and is an approximate baseline, not a captured production log. The review's roughly 4.4 GB corresponds to JSON output volume, not compressed event storage. More directly, serializing the fully validated 51-yard terminal state with actual terminal metrics produces 11,424,704 result bytes, compressed to 2,192,457 bytes with Zstandard (Workflow 5.4.0, Node 26.13.1, no encryption). These measurements confirm repeated bulky payloads while avoiding a claim of inevitable production failure. Both measurements are recorded in `daily-budget.json`.

Replay is also more nuanced than the review's claim: `runtime/helpers.js` requests `resolveData: 'skip-step-inputs'`, so recorded step inputs are omitted from replay reads. Step outputs are hydrated into the VM (`step.js` and `runtime/quickjs-runtime.js`). Retained VMs, incremental event loads and durable VM snapshots can avoid replaying the entire history; fallback full replay still reads the output payloads. The default replay budget is 240,000 ms (`runtime/constants.js`), excluding step body execution. The installed client exposes a server-supplied event-count ceiling, a 64 MiB VM snapshot-envelope limit (fallback is full replay), and transport frame limits; it provides no universal application step-result byte limit that justifies declaring this particular run guaranteed to fail. No production replay was invoked or timed.

Hollander now follows the existing AutoRecycler `checkpointState` protocol. The source adapter loads a checked census from `IngestionSnapshotStore`, runs one chunk, and returns the full state only in `checkpointState`. The repository writes that state to a private gzip blob before atomically storing its pathname with the next cursor. Lost-race/failed-checkpoint deletion and normal run cleanup use the existing snapshot lifecycle. Workflow inputs, outputs and the DB cursor carry only version, contract scope, phase, operation frontier, checksum and pathname. Loading validates the full state checksum and matches its phase/frontier/checksum to the reference before any provider work. Legacy, missing, corrupt and substituted state fail closed, preserving prior inventory.

Offline measurement of all 412 ordered operation frontiers through Workflow 5.4's actual input/result serializers, using a 36-byte run UUID and 112-byte snapshot pathname, gives at most 307 input bytes, 413 result bytes and 242 cursor JSON bytes per chunk. Totals are 126,102 input bytes plus 167,475 result bytes (293,577 combined). These payloads fall below the compression threshold. Counts exclude event metadata, optional encryption framing, initialization, validation and reconciliation, whose sizes depend on runtime configuration. Fixed-width checksum/path contents do not change these uncompressed sizes. Tests use the real repository and codecs, and bound the expanded-census payload with a maximum-length pathname below 2 KiB. Full offline replay verifies resumed inventory, closing guards and terminal no-provider-work behavior.

## Identity, location and links

Each tenant's `hpdcLogo` must match its verified business name, and each native per-vehicle link must remain on that tenant and its numeric tenant ID. Phone evidence from the investigation ties each tenant to its business. [Monster's website](https://monsterjunkyard.com/) publishes 1745 Page Blvd, resolving conflicting directory numbers. [Kirchhayn's website](https://www.kirchhayn.com/) publishes W4726 County Road A. [Petrillo's website](https://petrillosauto.com/) links its Hollander tenant. LeBlanc's published address and Standard's published address were verified in the supplied investigation.

The original five coordinates come from US Census `locations/onelineaddress`, benchmark `Public_AR_Current`, for each published street address. Full matched responses are fixtures. Census matched Kirchhayn's street as W4726 CO HWY A. Every vehicle and yard uses its own matched point, address, name and state. Website fallbacks resolve each individual tenant, and vehicle links use the published `/VehicleDealerShowParts/{tenantId}/{vehicleId}` route. The site redirects these routes to matching vehicle parts results. No generic platform inventory link replaces a vehicle destination.

## Make and VIN policy

The platform's make lookup is incomplete. Empty makes are a platform display problem, not bad yard input. Preserve the native year and Hollander model code. Expand the two-digit year to its latest valid century under the canonical vehicle-year range.

Only rows with a missing make and a valid 17-character VIN need a vPIC decode. Modern VINs must pass the ISO 3779 check digit in this provider only. Batch at most 50 unique VINs per POST to `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/`, using `format=json` and semicolon-separated `data`. Require exact response VIN membership and multiplicity. An empty or placeholder decoded make is a row reject, never a guessed make. A transport, malformed response or cache failure stops the chunk, preserving prior inventory and checkpoint.

Successful decoded makes are cached permanently per VIN under `hollanderstores:vpic-make:v1:` in the existing Upstash Redis. The verified audit seed avoids repeating past government lookups, including known conflicting native makes. Failed decodes are not cached across runs. Newly decoded values also persist in the durable cursor, so resume does not repeat completed batches. Cache reads for populated native makes never trigger decoding.

If a published make contradicts an available decoded make, retain the published make and report the VIN and both makes in warnings. The current audit reports LeBlanc's H3 as published American Motors versus NHTSA Hummer, and LeBlanc's Nitro as published Jeep versus NHTSA Dodge. Normalize the Alfa-Romeo spelling difference without a conflict. These diagnostics do not silently rewrite the yard's published make. The vPIC label `SPRINTER (DODGE OR FREIGHTLINER)` describes a model family rather than a make. For missing native makes, `WD2` maps to Freightliner, the concrete make returned alongside the ambiguous label by [NHTSA DecodeWMI](https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/WD2?format=json). This is a fallback classification, not proof of the original badge. The exact response is saved as `wd2-wmi.json`, from one NHTSA request on November 16, 2026; no new Hollander request was needed. Other WMIs with this ambiguous label remain unresolved. Raw audited seed values remain intact; normalization occurs when creating the snapshot, covering seeded, cached and fresh decodes. Published native makes still take priority.

## Enumeration and operation

POST `/VehicleDealerSearch` with `hdnChangeDisplay=card`, the site's own Card View form, once per configured yard for the opening pass and once per yard for the closing pass. Each configured tenant currently uses the complete card view. Reuse Beaver's HTML parsing helpers and the shared complete-response reader. Reconcile the published count against every card and enforce exact tenant destinations. Missing or duplicate destinations and truncation stop acceptance. Closing checks allow at most the larger of three vehicles or 1% of the opening yard roster (rounded down) in total additions plus removals. The bound counts changed identities, even when the net published count is unchanged. Surviving records must retain their parsed fields, destinations and relative order. Accepted runs publish the complete opening set that was enumerated and decoded; closing-only additions enter on the next run. Per-yard floors, rejection limits and source validation still apply. Excessive turnover or changed surviving records returns a terminal failed source result, preserving previous inventory and the last validated checkpoint without re-POSTing through workflow retries. Restart with a fresh opening census after inspecting the captures.

The durable state machine gathers all 51 locations, resolves missing makes in ordered batches, closes every yard, validates per-yard and whole-source quality, then emits one complete vehicle batch and 51 locations. Paused chunks emit no inventory or accounting. Terminal resumes make no requests and emit nothing. Cursors bind the source contract, yard metadata, prior accepted count, ordered decode frontier and completed closing position, with a corruption checksum and 32 MiB serialized bound. A census expires after two hours.

The module-wide semaphore allows one Hollander/vPIC request at a time and holds through cancellation, response cleanup and a three-second gap, including failures. Use current browser headers, manual redirects, a combined five-minute HTML transport/body deadline, a two-minute vPIC deadline, and a 40 MiB HTML response cap (vPIC remains 4 MiB). Temporary `/Message` redirects and transport failures retry twice, with 20 seconds between attempts. A durable chunk permits one logical operation by default and has a twenty-minute deadline. A decode batch satisfied by cache still advances one logical operation. Maximum census size is 25,000 rows per yard, 100,000 rows overall and 5,000 logical operations, each allowing at most three physical attempts. Parser and quality failures do not retry within a chunk.

Run the count-only live soak deliberately:

```sh
bun run soak:sources -- --sources=hollanderstores --cycles=1
```

Its budget counts logical operations, including cached decode batches. Capped runs retain a checked paused cursor. Soak results do not enable `ingestion-source-hollanderstores`. Do not enable, deploy or merge as part of qualification.
