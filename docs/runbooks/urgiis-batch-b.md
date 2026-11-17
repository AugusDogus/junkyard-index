# URG batch B qualification

This batch qualifies only the nine businesses assigned to `feat/provider-coverage-urg-batch-b`, against `feat/provider-coverage-urg-tenants` at `c83ecc0502bac0b8859b41c02495a90ac33eb119`. The source remains disabled. Qualification uses public read-only requests, saved raw responses and offline connector replays. No canonical inventory, production configuration or deployment is changed.

For complete censuses, opening and closing ownership, makes and every model directory are captured separately. Replays enforce the connector's existing bounded badge-drift policy, literal graph structure, supplier identity, attribution, duplicate and rejection guards. Each admitted tenant's absolute floor is the integer floor of one third of its accepted census count. The existing 50% preceding-run retention guard is unchanged.

All sites are conservatively treated as sharing a URG backend. Each tenant is serial, with at least 3.5 seconds after its preceding response. At most three tenants are active. Initial acquisitions use a process-wide 3.1-second start gate. After coordination with batches A and C, each request additionally takes an exclusive `flock` on `/tmp/jyi-urg-gate.lock`, waits until 3.1 seconds after the timestamp in `/tmp/jyi-urg-gate.last`, writes a new timestamp and releases the lock before sending. Saved captures are reused without HTTP requests. The receipt ledger records acquisition order, while replay archives follow connector order.

## Review correction, November 17, 2026

The original qualification below missed badged explicit-empty model results. The saved Premier Town & Country page advertises 9, Junior Sinn Town & Country 18 and Town Car 6, and Revolution Equinox 91 and Town & Country 23. These are retained as separate platform-unreachable and intermittent-empty evidence. Historical counts and budgets below describe the original captures; the current policy and combined retry results follow.

Eight serial read-only requests through the shared `flock` gate are retained in `model-route-probes.json.br`, with start/end times, status, final URL and complete response bodies. Revolution's original `/parts/CHEVROLET/EQUINOX/` now returns 91 cards. The prefixed `CHEVROLET_EQUINOX` and percent-encoded `%45QUINOX` variants are empty. The original route reaches the donors, so Revolution remains configured, but its earlier explicit empty is intermittent and must never be accepted as a complete census.

Premier's `TOWN_and__COUNTRY` and `TOWN_%26_COUNTRY` variants and Junior Sinn's `LINCOLN_and__TOWN_CAR`, `LINCOLN_%26_TOWN_CAR` and percent-encoded `BLAZER.JIMMY_%28FULL_SIZE%29` all return explicit empty results. The platform cannot expose these native special-character routes. No guessed slug substitution is enabled.

The owner-approved policy in #172 permits platform-unreachable special-character model badges up to 1% of each tenant’s advertised model total, with named model/count warnings. Above 1%, that tenant blocks. Ordinary explicit-empty pages advertising at least two donors are retried later in the run, then may carry prior accepted evidence under the existing incremental bounds. A cold unresolved ordinary empty blocks only its tenant. Arrivals-only donors retain arrivals-page links. Contract v4 prevents reuse of earlier interpretations.

Premier publishes 2,568 donors with 9/2,689 advertised unreachable donors. Junior Sinn publishes 3,313 with 26/3,602 unreachable. Revolution's recorded retry returns 91 Equinox cards: 90 more pass the existing checks and one is rejected. Its combined replay publishes 5,276 with 96 rejected observations and 25/5,397 advertised unreachable donors. The original archives and all eight probes remain unchanged. These three tenants now total **11,157 accepted donors**. Their original qualification and source-wide budget below are historical; the all-19-tenant evaluation in [urgiis-ingestion.md](urgiis-ingestion.md) is authoritative: **16 publishing tenants, 57,467 accepted donors, three blocked tenants, 10,249 full requests and 2,951.7 incremental requests/day** in the stated scenario.

## Qualification decisions

| Tenant                                | Decision | Candidate donors | Rejected observations | Rejection rate | Duplicates | Floor |
| ------------------------------------- | -------- | ---------------: | --------------------: | -------------: | ---------: | ----: |
| Premier Auto & Truck Parts (MI23)     | Admit    |            2,568 |           109 / 2,720 |          4.01% |         43 |   856 |
| Junior Sinn Auto Parts (MO24)         | Admit    |            3,313 |           259 / 3,595 |          7.20% |         23 | 1,104 |
| Revolution Auto Parts (NC74)          | Admit    |            5,186 |            95 / 5,281 |          1.80% |          0 | 1,728 |
| Airport Auto Parts (OH27)             | Exclude  |            3,904 |         1,157 / 5,103 |         22.67% |         42 |   N/A |
| Lambert Auto Salvage (MS06)           | Exclude  |       Incomplete |                   N/A |            N/A |        N/A |   N/A |
| 74 Auto Parts (MO23)                  | Exclude  |            1,259 |           374 / 1,651 |         22.65% |         18 |   N/A |
| Shroyer Auto Parts (LL02)             | Exclude  |              N/A |                   N/A |            N/A |        N/A |   N/A |
| Creston Auto Recycling (II57)         | Exclude  |       Incomplete |                   N/A |            N/A |        N/A |   N/A |
| MARS Auto Parts & Engine Swaps (OH25) | Exclude  |      Unavailable |                   N/A |            N/A |        N/A |   N/A |

Premier follows all 35 makes, 264 models and 60 arrivals. Its 339-response replay passes with separately fetched closing controls, only MI23 supplier photographs, no exclusions, and a maximum of 223 cards on one model page. All arrivals publish dates from October 16 through October 23, 2026. No model returns exactly 30 cards against a larger badge. Its Census point for the published 28 - 17 Mile Road, Cedar Springs, MI 49319 address is 43.219608703141, -85.670858668628. The full replay and Census receipt are fixtures.

Junior Sinn follows all 40 makes, 355 models and 26 arrivals. Its 440-response replay passes with separate closing controls, only MO24 supplier photographs, no exclusions, and a maximum of 154 model cards. Its arrival dates run from October 22 through November 5, 2026. No model returns exactly 30 cards against a larger badge. Its Census point for 588 County Road 649, Cape Girardeau, MO 63701 is 37.377948485995, -89.458919796033. The full replay and Census receipt are fixtures.

74 Auto follows all 45 makes, 274 models and 21 arrivals, with separate closing controls. Its 369-response failed-census replay reaches the admission guard and emits no donors: 374 / 1,651 observations are rejected (22.65%). No bins or blank VINs are excluded. Its largest model contains 123 cards and no model has the suspected 30-card cutoff. All supplier photographs are MO23. The complete failed census is retained, with a regression test proving no publication.

Shroyer publishes 45 makes and 484 models. Its Chevrolet Malibu route advertises 131 but returns exactly 500 shared cards, including only 121 LL02 photographs, alongside MI23, HH56, GG25, NN17, FL29 and MM51 photographs and 160 unassignable images. Filtering that capped pool cannot establish complete LL02 coverage. It is excluded before further model acquisition. Shroyer's `shroyerauto.hollanderstores.com` tenant is the same business and must not be added separately.

Creston publishes 47 makes and 561 models, but its larger models stop at 30 cards. The published Ford F150 page advertises 216 and returns 30. Native arrivals independently publish VJ0809, VIN `1FTPX14556NB44449`, with an II57 yard photograph; its live native detail page agrees on the VIN, stock and II57 seller. That donor is absent from the model result. The model HTML and its published plugin script expose no donor continuation controls. `?page=2` returns HTTP 404; `?paged=2` returns the identical 30 cards; the ordinary `F150_PICKUP` model-name alias is explicitly empty. The published year selectors search parts rather than enumerate donor cars. The interrupted census and probes are retained. Creston remains excluded, with an offline regression test for the verified omission. No partial model graph is published.

MARS fails at the official owner page. An initial connection failure is followed by HTTP 403, and a later separately paced request also returns HTTP 403. Ownership and complete enumeration cannot be established. The final response and all three attempt receipts are retained; no challenge is bypassed.

Revolution follows all 43 makes and 389 models, without published arrival cards or purchase dates. Its 479-response replay passes with separate closing controls, only NC74 supplier photographs, no exclusions, and at most 159 cards on one model page. No model has the 30-card cutoff. The Census point for its published 9001 Stitt St, Monroe, NC 28110 address is 34.984359668092, -80.486378798227.

Revolution's currency evidence uses two own-yard donors independently bound to recent native photographs. NCK26495 (`1HGCV1F15KA072623`) has a photo last modified November 14, 2026 at 01:16:15 UTC. NCK26494 (`3FA6P0K98ER107232`) has a photo last modified November 16 at 01:15:11 UTC. Both photos were read successfully on November 16. Saved native part pages independently agree on stock, year, VIN, NC74 seller and SKU prefix. Official contact/about pages confirm the Monroe business. `revolution-currency.json` and its compressed probe archive retain those responses and HTTP metadata, and an offline test checks the bindings. These timestamps establish recent native inventory activity; they do not become purchase dates. Canonical `availableDate` remains null. Unchanged opening/closing homepage stocks were not used as currency evidence.

Lambert publishes 47 makes and 512 models. The census acquired 323 model pages without a 30-card or 500-card boundary before the required `/parts/HUMMER/HUMMER_H2/` route exhausted three attempts: a 90-second timeout, HTTP 500, then HTTP 500. Qualification stops at that incomplete graph. The raw partial census, both error documents and timed request receipts are retained. No partial inventory or floor is added.

Airport follows all 46 makes, 489 models and 46 arrivals. Its model graph contains 5,057 cards, with a maximum of 231 on one page and no 30-card cutoff. The complete assessment finds 3,904 candidate donors, 1,157 rejected observations and 42 duplicates across 5,103 observations (22.67% rejected). No stocks or blank VINs are excluded. Older numeric-stock donors remain rejects. Its complete 586-response negative replay passes separate closing ownership and directory checks, reaches the expected rejection guard and publishes zero donors. Only OH27 supplier photographs occur. The full rejected census is retained as a fixture.

## Daily source budget

This branch adds 11,067 accepted donors through three tenants and three physical yards. The combined source has 49,258 distinct VINs across fourteen tenants and fifteen physical yards, with zero cross-tenant duplicates. The combined floor is 33,688. Every physical-yard floor holds after conservative source-wide duplicate accounting. `batch-b-source-audit.json` records the counts, per-yard bounds and complete replay sizes. These totals include the original base and batch B only; sibling batches must repeat the combined audit when restacked.

A normal complete run needs 9,804 native responses (32.68% of the 30,000-request budget), totaling 1,644,515,174 bytes (19.14% of the 8 GiB budget). Retries are separately bounded per page. Mandatory serial pacing totals 7.10 hours, compared with 5.88 hours before this batch. Extrapolating each tenant's mean successful qualification HTTP duration to its replay count gives 13.34 hours of HTTP time, or 20.44 hours including mandatory pacing. The audit retains sample sizes and means; Eagle has only one timed sample, so this is an estimate. Workflow overhead and future retries are additional. One extra second per response would add 2.72 hours. Daily wall time therefore has limited headroom even though request and byte budgets are comfortable. The parent must recompute the combined budget after sibling batches are restacked, and an enabled rollout needs a measured complete soak. The three additions' successful qualification HTTP time totals about 28 minutes, excluding gate waits; that is consistent with their measured one to two second median responses. Lambert's slow routes are excluded and do not enter the daily estimate. This is a budget estimate, not a live enabled-source soak.

## Live qualification requests

`batch-b-requests.jsonl.gz` retains 2,747 recorded attempts, including retries, qualification probes and geocoding. `batch-b-qualification.json` records per-tenant decisions, graph sizes, replay accounting, cutoff checks and request totals. One Lambert attempt is counted from its pre-send log because its completion receipt is unavailable; its outcome is unknown. An abrupt early restart to adopt the shared file gate occurred before pre-send logging existed. At most one interrupted attempt each for Premier, Junior Sinn and 74 Auto may be unrecorded. This is not an exhaustive wire or redirect-hop count.

| Tenant                         | Recorded attempts | Maximum unrecorded interrupted attempts |
| ------------------------------ | ----------------: | --------------------------------------: |
| Premier Auto & Truck Parts     |               340 |                                       1 |
| Shroyer Auto Parts             |                49 |                                       0 |
| Junior Sinn Auto Parts         |               441 |                                       1 |
| 74 Auto Parts                  |               370 |                                       1 |
| Lambert Auto Salvage           |               381 |                                       0 |
| Revolution Auto Parts          |               486 |                                       0 |
| Creston Auto Recycling         |                91 |                                       0 |
| MARS Auto Parts & Engine Swaps |                 3 |                                       0 |
| Airport Auto Parts             |               586 |                                       0 |

## Validation

`bun test --timeout 15000 src` passes 4,574 tests across 431 files with zero failures in 1,585.62 seconds on Bun 1.4.4. This includes all fourteen configured tenant replays, the admitted-model cutoff checks, Revolution currency proof, 74 Auto's rejection replay and Creston's verified omission. That full run preceded completion of Airport's fixture. After adding Airport, `bun test --timeout 15000 src/server/ingestion/urgiis-batch-b.test.ts src/server/ingestion/urgiis-revolution-currency.test.ts` passes all seven final qualification tests, including both complete rejection replays, in 46.09 seconds. Lint, typecheck and formatting of changed text files pass. All tests use saved local responses.
