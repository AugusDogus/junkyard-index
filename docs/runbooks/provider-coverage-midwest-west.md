# Midwest and West provider sweep, November 17, 2026

Base: `feat/provider-coverage-launch-readiness`, `91dcf455fa9c40f3ccb5882dfa265099d89e14e5` (PR #176). Acquisition is November 17 Central time, November 18 UTC. Business credit follows the supplied tally. This batch adds **Midwest Auto Parts in Oklahoma**, **Flora's Auto Parts in Indiana** and **Horseshoe Auto Wrecking in Washington**. The target of ten providers per state remains unmet.

| State | Supplied count | Added credits | Result | Still needed |
| ----- | -------------: | ------------: | -----: | -----------: |
| WA    |              6 |             1 |      7 |            3 |
| CO    |              6 |             0 |      6 |            4 |
| OK    |              7 |             1 |      8 |            2 |
| MN    |              6 |             0 |      6 |            4 |
| WI    |              7 |             0 |      7 |            3 |
| IL    |              6 |             0 |      6 |            4 |
| KY    |              7 |             0 |      7 |            3 |
| IN    |              7 |             1 |      8 |            2 |
| Total |             52 |             3 |     55 |           25 |

## Admitted providers

All three use the existing default-enabled Hollander source. Existing VIN check-digit, tenant identity, complete enumeration, opening/closing census, duplicate, cross-yard conflict, 10% rejection and 50% previous-count drift checks apply. No connector or transport behavior changes.

| Business                              | Tenant              | Published | Accepted | Rejected | Duplicates | Accepted floor |
| ------------------------------------- | ------------------- | --------: | -------: | -------: | ---------: | -------------: |
| Midwest Auto Parts, Tulsa OK          | `mwas / 7342`       |       224 |      221 |        3 |          0 |             73 |
| Flora's Auto Parts, Leesburg IN       | `florasauto / 7176` |       590 |      588 |        2 |          0 |            196 |
| Horseshoe Auto Wrecking, Bremerton WA | `hsaw / 6605`       |        33 |       33 |        0 |          0 |             11 |
| Added total                           |                     |       847 |      842 |        5 |          0 |            280 |

Each floor is one third of accepted inventory, rounded down. The complete combined production-parser fixture census contains **57,619 published, 56,800 accepted, 819 rejected and zero duplicate vehicles across 54 yards**, with no snapshot errors. The source floor increases from 18,638 to **18,918**. The historical batch-2 expectation file is the existing combined-fixture oracle; its original failed-make receipt is preserved.

Midwest's native [website](https://midwestautoparts.com/) links the exact Hollander tenant. Its profile gives **3815 N Lewis Ave, Tulsa OK 74110**, (918) 551-6000. Census Public_AR_Current gives **36.209247187407, -95.958181153993**. The former `MidwesternAutoSalvage.com` site now redirects to this operator and receives no separate credit.

Flora's native [website](https://www.florasauto.com/) links the exact Hollander tenant and publishes **6233 North State Road 15, Leesburg IN 46538**, with parts phone (574) 253-6000. The Hollander profile confirms the address and has a different contact phone, (574) 253-6661. Census gives **41.323142147077, -85.853812765981**. Metadata uses the native site's parts number and physical address.

Horseshoe's native [website](https://horseshoeautowrecking.com/) links the exact Hollander tenant. Its profile confirms **7360 State Highway 3 SW, Bremerton WA 98312**, (360) 674-2515. Census gives **47.505968517402, -122.749153524785**.

All 847 published VINs pass the check digit. Three Midwest and two Flora's rows have unusable native models and remain rejected, with their VINs retained as presence observations. Models are not invented from vPIC. For example, Flora's native `TCHEV1500` remains unchanged. The added make seeds contain 250 successful decodes: 74 Midwest, 168 Flora's and eight Horseshoe, acquired in seven batches of at most 50. Native makes retain precedence.

### Currency and enumeration

Hollander does not publish native arrival dates. Currency follows the existing Hollander qualification's comparative platform-ID evidence. `availableDate` remains null.

| Business  | Newest record | VIN                 | Stock    | Accepted year/make/model |
| --------- | ------------: | ------------------- | -------- | ------------------------ |
| Midwest   |    72,702,019 | `2LMHJ5ATXDBL57521` | `29168`  | 2013 Lincoln MKT         |
| Flora's   |    72,824,866 | `2GCEK19R4V1197662` | `610168` | 1997 Chevrolet TCHEV1500 |
| Horseshoe |    72,770,928 | `KMHCN46C87U097213` | `9652`   | 2007 Hyundai ACCENT      |

All three exceed the retained Mack's October-stock reference **72,660,508**, stock `261006`, documented in [the existing qualification](hollanderstores-ingestion.md). This supports roughly October/November platform activity within the requested approximately 60-day window. It is an estimate, not a verified arrival date or proof that every older donor remains physically present.

Native `POST /VehicleDealerSearch` with `hdnChangeDisplay=card` returns the entire roster. Each opening count and every tenant-bound destination reconcile. Separately fetched closing rosters match. The three additions require six Hollander requests per normal daily run, with vPIC needed only for newly encountered valid VINs lacking a cached or native make.

The [saved fixture directory](../../src/server/ingestion/hollanderstores-test-fixtures/midwest-west/) contains exact compressed opening, closing, native-site, About Us, Census and vPIC bodies. Its 22 successful-response receipts include URLs, methods, byte counts, SHA-256 hashes, start/end times and decode request VINs. Redirects and rejected discovery requests remain in the broader acquisition log.

## Discovery scope and accounting

The [CSV](provider-coverage-midwest-west.csv) records each deduplicated lead and its disposition with the requested columns. `inventory=y` means a public per-vehicle surface was observed, including incomplete or VIN-less surfaces. Only `result=admitted` earns credit. `inventory=n` means no public donor inventory was established by the recorded inspection, not proof that the business has no inventory. Directory-only, excluded, archived and unsuccessful requests are distinct from new native website checks.

The CSV contains **901 lead rows**, including exclusions and aliases, with no pending disposition. Fresh business checks count distinct native website hosts per state, including failed HTTP/DNS attempts, after excluding existing, owned, previously screened and duplicate operators. Redirects use the final native host where known. Two additional same-host aliases are counted once; Binford/AAA is also consolidated. These counts describe inspected or attempted websites, not 440 complete inventory censuses.

| State | Lead rows | Fresh business checks | Directory-only rows | Archived-only triage |
| ----- | --------: | --------------------: | ------------------: | -------------------: |
| WA    |        85 |                    46 |                  22 |                    0 |
| CO    |        92 |                    49 |                  16 |                    0 |
| OK    |        95 |                    46 |                  31 |                    1 |
| MN    |       128 |                    64 |                  30 |                    7 |
| WI    |       134 |                    66 |                  29 |                    8 |
| IL    |       151 |                    66 |                  41 |                    2 |
| KY    |        96 |                    42 |                  37 |                    1 |
| IN    |       120 |                    61 |                  34 |                    0 |
| Total |       901 |                   440 |                 240 |                   19 |

The retained `business-check-accounting.json` maps each counted lead to its canonical host and disposition. Root request receipts establish actual attempts; host-stopped entries without an HTTP attempt do not add checks. Existing and owned aliases discovered late are disclosed below and excluded from fresh counts.

Discovery combined:

- All 935 entries in the current public ARA directory, retrieved from ten pages of `https://directory.a-r-a.org/wp-json/geodir/v2/members`; 154 target-state entries before excluding industry vendors and associations.
- A hash-verified November 12 Car-Part **business-name directory**, with 523 target-state listings: WA 49, CO 48, OK 41, MN 82, WI 85, IL 95, KY 51 and IN 72. Car-Part parts inventory was not used. A current directory request returned HTTP 403 and stopped that host. Saved directory body SHA-256: `a911b42e14e265b17d6c5b37b311e126f3da0c4a2d36ccdc6ae60ad4afac1833`.
- Google Maps searches for `auto salvage <state>` at depth 100 in each state, plus `heavy truck salvage <state>` at depth 50. These returned 800 and 387 listing entries respectively before geographic/category filtering and deduplication. Retail stores, metal recyclers and duplicate locations are not additional provider credits.
- Wisconsin's 55 full recycler members from `http://carsofwi.com/js/members.js`, Minnesota's 44 public member records, and the ITPA heavy-truck directory. The retained Illinois association response says its member list cannot be displayed. Retained Kentucky and Colorado association attempts could not connect.
- Yahoo web searches of Yelp business listings. Out-of-state results, architectural salvage, furniture, pure vehicle buyers and similar mismatches were discarded. Earlier Google organic calls failed internally, Bing results were irrelevant, and DuckDuckGo presented a CAPTCHA that was not bypassed.

The merged list is broad but cannot be certified as an exhaustive list of every active yard. Directory-only businesses, missing websites, closed sites and inaccessible inventory leave documented gaps. A homepage-only assessment does not prove the absence of an underlying inventory API.

Existing businesses, supplied rejection records, PR #184's self-service CSV, PR #181's mid-state runbook, the supplied URG/AutoPartSearch ownership file, and Vander Haag's were used to exclude known entries. Some aliases were identified after acquisition: Bionic-Milwaukee declares owned supplier WI49, Don Scharf WI02, and Sharp MN22/WI08. CNC's alternate domain is the previously rejected operator; Weller's prior shared-roster rejection also applies to its South Bend listing. Norb's EE91 and A-Z OK09 are already configured; some model requests preceded reconciliation. Their CSV reasons disclose these requests. No additional requests were made after those identities were reconciled. Midwest's three alternate business listings share the admitted Tulsa catalog and earn no additional credit.

## Near misses and deferred qualification

Largest advertised models were sampled before considering a long URG census. No new full URG census was performed. These are deferred qualification cases, not evidence that the yards have no qualifying inventory:

| Business             | State | Observed inventory                                                                   | Remaining qualification gap                                               |
| -------------------- | ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| B&B Auto Parts, OK06 | OK    | F150 badge 264; sample 30 cards and 30 VIN-shaped identities                         | Complete make/model graph, closing census and currency unproven           |
| Morrison's, WI23     | WI    | F150 badge 322; sample 320 cards and 225 VIN-shaped identities                       | Complete graph, identity validation and currency unproven                 |
| Morgan's             | IN    | F150 badge 223; sample 224 cards and 173 VIN-shaped identities                       | Complete graph, identity validation and currency unproven                 |
| Safari, WA24         | WA    | KIA FORTE badge 81; sample 30 cards and 30 VIN-shaped identities                     | Complete graph, closing census and currency unproven                      |
| Auto Works           | WI    | Native donor list and linked Corvette with valid VIN `1G1YF3D79G5117253`, stock 5037 | Complete VIN enumeration and newest arrival within about 60 days unproven |
| Rebuilt Cars         | IL    | Hollander publishes 632 cards; newest platform ID 72,407,357                         | Recent platform activity unproven; no long detail census                  |

Remington WI, A-1 Griffith IN, Adams IN and RZR WI each hit the native 500-card boundary in their largest sampled model. AR1 WA and Baird's KY returned explicit empty results twice despite positive badges. AutoExpert CO's largest advertised Subaru LEGACY model returned 309 VIN-less placeholders; these follow the existing connector's placeholder exclusions. Decatur IL's make directory was not enumerable. Supreme WA's shared supplier pool did not establish per-donor yard attribution. Scott's and H&H Hudson CO had platform hints without captured supplier declarations or qualification.

All American Classics WA's parted-vehicle list has no VIN or old serial. Auto Network IN's inspected Camaro detail truncates the VIN to `1G1FB1RS8K0`. St Cloud U Pull MN's blank/Ford inventory searches expose fresh yard dates, year/make/model, stock and row, but no VIN/serial or public enrichment link. TJ's WI exposes retail vehicle sales, and Wilkins IL exposes HeavyTruckParts parts categories; neither established a complete salvage donor roster.

Playground WI, KUD IL and Northwest Specialty WA expose Shopify collection directories, but subsequent product requests returned HTTP 429 and stopped each host. Northwest Specialty's `complete-cars-for-sale` collection remains unqualified. Rocky Parts MN, Overdrive MN, JDM WA and JD Auto Salvage KY expose parts retail without an established complete donor roster. E-Z WA and Global IL explicitly publish zero Hollander vehicles; Mike's IN redirects to the generic platform.

## Request handling and validation

HTTP acquisition was serial with a normal Chrome User-Agent and at least 3.5 seconds between completed requests, including redirect hops. Only URG Inventory InSite requests use `flock /tmp/jyi-urg-gate.lock`, held for the request itself. There is at most one waiting URG fetch. Each HTTP 403/429 stops that host; no CAPTCHA was defeated. Requests and searches do not identify the project or owner. Captures and logs are retained in this worktree's `.scratchpad/midwest-west/`.

Validation:

- The relevant Hollander and source-validation suite passed 153 tests before Flora's and Horseshoe's additions.
- After all three additions, the new fixture tests, combined batch-2 fixtures and source-validation tests passed 118 tests with zero failures.
- Five focused connector regression tests cover separate yards, failed make lookups, count loss, conflicting identities and VIN check digits.
- Lint and TypeScript checks passed after all three additions.
- Changed-file formatting is checked separately from the repository's pre-existing formatting failures. No live ingestion, production write, deployment or merge was performed.
