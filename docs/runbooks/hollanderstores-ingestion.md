# Hollander Stores ingestion

The `hollanderstores` source ships disabled. It covers 35 physical yard locations belonging to 27 businesses in VT, IA, MA, NJ, CT, MN, MS, NY, OR, WI, AR and IN. The November 15 expansion adds 30 locations from 22 businesses and leaves AAA Auto Parts and OK Auto Parts out of the configured tenant registry. It does not alter the existing `beavers` source, tenant 503, or its make policy.

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

The durable state machine gathers all 35 locations, resolves missing makes in ordered batches, closes every yard, validates per-yard and whole-source quality, then emits one complete vehicle batch and 35 locations. Paused chunks emit no inventory or accounting. Terminal resumes make no requests and emit nothing. Cursors bind the source contract, yard metadata, prior accepted count, ordered decode frontier and completed closing position, with a corruption checksum and 32 MiB serialized bound. A census expires after two hours.

The module-wide semaphore allows one Hollander/vPIC request at a time and holds through cancellation, response cleanup and a three-second gap, including failures. Use current browser headers, manual redirects, a combined five-minute HTML transport/body deadline, a two-minute vPIC deadline, and a 40 MiB HTML response cap (vPIC remains 4 MiB). Temporary `/Message` redirects and transport failures retry twice, with 20 seconds between attempts. A durable chunk permits one logical operation by default and has a twenty-minute deadline. A decode batch satisfied by cache still advances one logical operation. Maximum census size is 25,000 rows per yard, 100,000 rows overall and 5,000 logical operations, each allowing at most three physical attempts. Parser and quality failures do not retry within a chunk.

Run the count-only live soak deliberately:

```sh
bun run soak:sources -- --sources=hollanderstores --cycles=1
```

Its budget counts logical operations, including cached decode batches. Capped runs retain a checked paused cursor. Soak results do not enable `ingestion-source-hollanderstores`. Do not enable, deploy or merge as part of qualification.
