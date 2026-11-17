# Ario, VinPlus and Holst qualification

Read-only public qualification on November 16, 2026. No source enablement,
production writes, deployment or merge is included. CFC Recycling is retained
from the preceding stack branch. Grandpa John's, Budget
U Pull It and Harry's remain outside this Ario allowlist.

## Ario customer authority and complete census

All twelve additions have native stock identifiers in their own yard-ID bucket.
The live public directory also identifies each as `source=crush_xml_seed` with a
specific Crush client ID, rather than a marketplace operator mirror. These
fields, exact organization/yard identities and owned coordinates are frozen in
`src/server/ingestion/fixtures/ario/yards.json`. This qualification uses native
feed and stock evidence, not name matching or a claim of an official Ario iframe.
Baughman's additionally publishes its stock-bound inventory photos on its own
host. The three Wilbert's yards have distinct yard IDs and stock namespaces.

| Yard                                   | State | Crush client | Advertised |   Accepted | Rejected | Search reads touching yard |
| -------------------------------------- | ----- | -----------: | ---------: | ---------: | -------: | -------------------------: |
| a-1 Crashed Cars, South Sioux City     | NE    |         1062 |      1,124 |      1,112 |       12 |                         13 |
| Wilbert's, Williamson                  | NY    |         1050 |      2,597 |      2,593 |        4 |                         27 |
| Wilbert's, Elma                        | NY    |         1217 |      1,325 |      1,322 |        3 |                         15 |
| Wilbert's, Bath                        | NY    |         1170 |      1,116 |      1,116 |        0 |                         13 |
| Youngstown U-Pull-It                   | OH    |         1140 |      1,557 |      1,499 |       58 |                         17 |
| Milliron Auto Parts, Mansfield         | OH    |         1068 |        701 |        666 |       35 |                          9 |
| Roberts Parts-U-Pick, Moffett          | OK    |         1047 |      1,263 |      1,159 |      104 |                         14 |
| Baughmans U Pull It, York              | PA    |         1143 |      1,120 |      1,087 |       33 |                         13 |
| Barry's U Pull It, Theodore            | AL    |         1039 |        685 |        684 |        1 |                          8 |
| Cash-N-Carry, Savannah                 | GA    |         1031 |        707 |        669 |       38 |                          9 |
| Parts YoU Pull, Amite                  | LA    |         1148 |        481 |        472 |        9 |                          6 |
| Smith Auto inc Self Serve, Pawnee City | NE    |         1134 |        604 |        591 |       13 |                          8 |
| **Total**                              |       |              | **13,280** | **12,970** |  **310** |      Shared requests below |

All yards have zero duplicates and zero exclusions in the captured census.
New Ario yards, including CFC, use `inventoryVinWithCheckDigit`. The twelve
additions reject 162 additional check-digit failures, accepting 12,970 donors
and rejecting 310 (2.33%). Every yard remains under the 10% rejection guard;
Roberts is highest at 104/1,263 (8.23%). Rejections remain explicit accounting.
Addition-date freshness, canonical identity, duplicate and 50% drift rules are
unchanged. The original 20 migrated Ario yards retain their existing VIN behavior:
264 failures among 18,805 fresh-yard candidates, plus 62 in stale Santa Maria.
The complete audit and compatibility decision are in
[`ario-vin-admission.md`](ario-vin-admission.md). No Ario yard flag was added.

Barry's official inventory page links both Alabama and Mississippi businesses.
Its captured table contains exactly 685 stocks and VINs, all matching the 685
records in Ario's Theodore bucket. The directory exposes one Barry's yard, owned
by its own organization and Crush client 1039, with the Theodore address and
coordinates. No Mississippi yard or Mississippi coverage credit is added.
The saved table and request receipts are in `coverage-qualification.json.gz`.
There is no native per-row location column in that table; the configured physical
scope follows Ario's independently identified Theodore bucket.

Smith's proposed direct URG source failed the parent's 30-card model cutoff
qualification. This branch admits its complete Ario feed instead. No direct
Smith source is added. No verified Bubble organization ID was available for
these twelve additions. Their stable location keys use `ario:<yard UUID>`;
existing customers retain their legacy lookup keys. Both key forms participate
in the same eligible-yard and stale-customer drift checks.

Opening enumeration visits every 100-rank window through each yard's advertised
bound. Independently fetched closing inventory agrees after the production
schema projection. Combined connector replay accepts 32,170 Ario vehicles across
the expanded 33-yard allowlist, including CFC and the previously qualified customers;
stale Santa Maria remains excluded by freshness.

### Request budget

Initial qualification cost 29 serial Ario requests: two public SPA/key reads,
26 grouped windows across eleven additions, and one grouped closing read.
Smith and the live expanded-group check cost eleven more: two SPA/key reads,
one directory read, one **32-yard opening request returning 3,195 items**, six
remaining Smith windows, and one Smith closing read. Total: **40 requests**, with
at least the production client's 2.2-second pacing. No Ario 429 occurred. The
extra expanded-group opening read touches every earlier addition once more than
the census reads in the table. Public operator requests are separate and logged.

The whole allowlist still needs **33 grouped rank windows**, bounded by stale
Santa Maria's live opening bound of 3,297 ranks. Williamson has 2,597 and Smith has 604. Thus a
normal daily run remains **37 requests**: two discovery, one directory, 33 windows
and one grouped closing check. This fits one 48-request rolling-hour allowance,
leaving eleven requests of headroom. No new schedule or rate increase is needed.
The 32-yard opening capture and CFC's separate 422-rank census establish this
combined 33-yard budget. Offline replay verifies 34 capture chunks, 33 publication
chunks and one legacy terminal stand-in, 68 chunks total. Publication adds no
provider requests. These captures do not claim a
new complete opening/closing census of all existing yards. Larger future counts still
pause durably at 48/hour; 24 consecutive provider pauses still fail. Shared-IP
traffic and provider outages can delay a run beyond this nominal estimate.

The per-yard gzip files preserve all captured item records and totals. For the
initial eleven-yard capture, `returned`, `truncated` and `next_offset` envelope
fields were reconstructed from saved item counts, offsets and total bounds for
offline replay. They are not original response bytes and do not prove coverage.
Coverage follows every rank bound and the independent unchanged closing items.
Smith's envelopes and `expanded-opening.json.gz` preserve native responses.
`coverage-requests.json` and `smith-requests.json` record actual HTTP requests,
statuses, timing and byte counts without public key material.

## Indy U-Pull-It on VinPlus

Indy's official site publishes 940 W 16th St, Indianapolis IN 46202 and its
inventory page. Its public app/config identifies `indy_u_pull_it`, the exact
Indy U-Pull-It business, America/New_York timezone, six-digit Crush stocks and
one physical location. Census Public_AR_Current uniquely matches the address at
39.788722423552, -86.175452072595. These are street-range interpolated coordinates.
Original operator, inventory and Census evidence is in
`vinplus-test-fixtures/indy-qualification.json.gz`.

The complete protocol costs **154 serial requests**, including actual closing
reads. It reconciles all **1,333** advertised rows, accepts **1,316**, rejects
**17**, and finds zero duplicates or unreachable rows. Five structurally valid
rejected VINs supply presence only. One accepted vehicle has an eligible pre-1981
serial. Modern accepted VINs pass the existing check-digit validator. Years 2012
and 2013 exceed 100 records and require make partitions and observed-make
supplements. No complete partition reaches the silent 100-result cap.

The new accepted floor is **400**, approximately one third of the census. Source
minimum increases from 5,250 to 5,650, preserving existing tenants' floors.
The 50% drift, 10% rejection and 25% duplicate guards remain unchanged. Cards
and yard links use the searchable app as a manual-search destination.
`indy.json.gz` stores the complete original 154-response sequence;
`indy-requests.json` records requests and timings. Total frozen replay is now
7,621 accepted, 101 rejected and zero duplicates across seven tenants.
One separate initial public yard-info probe preceded this census.

## Holst Truck Parts: blocked, not admitted

The public TPI catalog at `https://holsttruck.com/trucks/` advertises 2,372
Salvage records and 24 Complete retail records. Its native Salvage link is
`?f-condition=nw`, TPI photo account 22216. The footer distinguishes the main
office (10209 N Yellowstone Hwy, Idaho Falls ID 83401) from trailer sales, the
install shop and driveline centre. A unique Census address match was obtained,
but this alone does not establish donor ownership across those facilities.

The serial crawl stopped immediately at **HTTP 429 on Salvage page 21**. No retry,
challenge bypass or alternate endpoint was attempted. Twenty saved pages cover
500 of 2,372 advertised rows, with 471 structurally valid full 17-character VIN
candidates and 29 partial/invalid identities. These are preliminary identity
counts, not accepted donor counts. The sampled catalog also contains buses,
vans, a loader and a motorhome. They must not silently become physical salvage
truck credit. Partial VINs and older serials cannot pass the requested full
17-character Holst identity rule.

Holst has **zero admitted vehicles**. No source, floor, flag or production
connector is registered from this incomplete evidence. Qualification requires a
fresh complete census after the provider allows access, physical truck scope
classification, source-linked active donor/ownership controls, stable closing
reads, and the existing rejection/duplicate/drift guards. Do not resume by
skipping page 21 or infer the remaining 1,872 rows.

Requests: one robots read, one unfiltered catalog read, one initial Salvage page,
then 21 attempted Salvage census reads (20 HTTP 200 and one HTTP 429), **24 Holst
requests total**. One separate Census request obtained the main-office match.
`holst-test-fixtures/incomplete-census.json.gz` preserves all twenty successful
census bodies; `requests.json` retains the failed request as well. The saved
partial catalog and 429 do not claim terminal qualification.

### Holst request investigation, November 17

Holst remains a retained blocked candidate, with no admitted inventory. This follow-up fixes Stricker independently; it does not remove Holst from the research record or invent an enabled connector from a partial crawl.

A fresh Salvage page advertises **2,374 records**, 95 pages of 25. Discovery inspected the three native TPI scripts and the public WordPress REST directory. The scripts perform navigation/cart work and expose no inventory API or feed; the REST directory has no TPI/inventory route. The script's `per_page` parameter does exist, but an explicit `per_page=2500` probe still returns **1-25 of 2374**, not a bulk census. No hidden feed is claimed absent merely because these discovery paths did not expose one.

The new crawl used a normal Chrome User-Agent, Accept and Accept-Language headers, a retained PHP session cookie, serial requests and **ten seconds after each completed response**. Pages 1-19 returned HTTP 200, covering 475 rows. Page 20 returned HTTP 429 after about four minutes of traversal. The exact WordPress error says **"For security reasons, we limit the number of requests per minute."** and **"Too many requests. Please wait a moment before trying again."** Its **`Retry-After: 300`** is now preserved. This establishes an origin rate-limit response, rather than evidence of missing browser headers or a missing session cookie. The configured rate window and shared-IP contribution remain unknown; ten-second pacing does not establish a safe daily rate.

No immediate retry occurred. One page-20 recovery GET started more than 300 seconds after the 429 and returned HTTP 200, covering rows 476-500. It used a fresh session, so it is not a controlled proof that cooldown alone caused recovery. It confirms that the previously blocked page is publicly readable. The partial opening census still lacks **1,874 rows**, every closing page and the active donor/physical truck-scope/ownership controls. It cannot pass complete enumeration or supply an accepted count or floor.

This investigation made **27 Holst requests**: six discovery reads, twenty attempted census reads (nineteen 200s and one 429), and one delayed recovery read. A complete daily HTML protocol at the observed size would need **190 roster requests** (95 opening plus 95 closing), plus any independently qualified ownership/control reads. That is a projected request count, not a successful daily-run measurement. A production connector still needs a measured rate contract or an underlying complete feed, durable handling of the provider's five-minute Retry-After, a full stable census, truck-scope classification and the unchanged quality safeguards. No rate-limit bypass, tight retry loop, provider removal, production flag or data mutation was used.

Exact discovery responses, 19 successful census bodies, the 429 body/header receipt and recovery body are in `holst-test-fixtures/rate-limit/`. `requests.json` records start/end timestamps, byte counts, SHA-256 and Retry-After without session credentials. Discovery timestamps were not retained and are explicitly marked as such in `probes.json`. The offline qualification test reconciles all nineteen page ranges against the advertised bound, rejects the 429 as a roster and verifies the recovery respected the advertised cooldown. These fixtures preserve the remaining blocker for the next repair without claiming Holst is qualified.

The [subsequent bulk-feed and marketplace investigation](holst-inventory-discovery.md)
identifies this catalog as TPI, rather than Hollander Stores, retains the blocked
provider and records the remaining alternatives and conditional daily budget.
