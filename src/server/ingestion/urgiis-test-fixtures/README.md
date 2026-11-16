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

`qualification-requests.jsonl.gz` retains the original sanitized qualification HTTP ledger. `qualification-requests.json` records per-tenant totals, six known unlogged attempts and separate APS browser-map resource accounting. It is not an exhaustive wire log. `qualification-audit.json` records the pre-batch-C baseline of 38,191 unique admitted VINs, zero cross-tenant duplicates and satisfied per-yard floors after conservative duplicate accounting.

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

The original batch A screening retains ten unsuccessful qualifications from November 16, 2026. Higgins subsequently qualifies in the follow-up below. `batch-a-probes.json.br` contains 278 public responses, including the four 30-card cutoff cases, their unchanged broader-page variants, Heritage's omitted native donor, Stadium's shared 500-card pools, malformed Maserati controls, incompatible arrivals titles and Quick Recovery's failed ATS requests. It also retains the large TNT and Borges probes and Borges' published contact evidence. The request ledger and qualification summary are `batch-a-requests.jsonl.gz` and `batch-a-qualification.json`.

`tnt-rejected-census.jsonl.br` and `borges-rejected-census.jsonl.br` preserve complete 331- and 486-response catalogs with independent closing controls. Their metadata's accepted counts describe candidate snapshots, not emitted inventory. Negative connector replays verify zero emission with normal accounting and with optimistic, unverified bin exclusions. TNT rejects 252 / 1,346 observations (18.72%), or 155 / 1,249 (12.41%) after hypothetically excluding AFT, NOF, CPO and DLRS. Borges rejects 460 / 4,167 (11.04%), or 419 / 4,126 (10.15%) after hypothetically excluding MISC, MIS and NEW. None of these bin stocks is qualified for exclusion.

The separate TNT and Borges qualification receipts retain counts, supplier observations and closing badge drift. `tnt-geocode.json` preserves its published address's Census match. `borges-coordinates.json` retains three unsuccessful Census lookups and the explicit place point from the map link published beside its contact address. No yard was registered from that initial screening; the source remains disabled.

`cap-investigation.json.br` retains the November 16 follow-up investigation of the five 30-card tenants. It contains request receipts and response bodies keyed by SHA-256, deduplicating identical assets and query responses. Hashes and sizes describe UTF-8 text after the acquisition reader normalizes line endings. The fourteen common Heritage/Quick Recovery assets and Smith's main script match byte-for-byte in that representation. The archive includes public REST discovery, sitemaps, year and stock probes, parts searches, arrivals variants and Quick Recovery's ATS retries. It excludes the separate census responses and a discarded comparison-host 404. Smith's native 163 badge, 30-card model and valid missing arrival are an offline regression case; Heritage's seven ineffective query variants are another. No live request runs in tests.

`higgins.jsonl.br` retains all 36 makes, 240 model pages, 60 arrivals and independently acquired closing controls. Its 317-response replay accepts 1,477 donors, rejects 51 observations (3.24%), excludes none and merges 48 duplicates. All supplier photographs are CA22. `higgins-qualification.json` records the counts and eight accepted arrivals absent from model results. `higgins-arrivals-only.json.br` retains those eight published detail responses, all explicit empty native parts results. They do not invalidate the donors' valid native arrivals identities. `higgins-geocode.json` preserves the Census exact-address match for the published Bakersfield address. The tenant floor is 492; the source remains disabled.

`cap-investigation-requests.jsonl.gz` preserves 466 follow-up attempts, including the completed Higgins census and interrupted Quick Recovery acquisition. `cap-investigation-qualification.json` records request dispositions, Quick Recovery's handoff to batch C and the combined source audit: 39,668 unique identifiers, zero cross-tenant duplicates, all thirteen yard floors satisfied, a 30,492 source floor, 8,863 successful native responses and 1,597,323,423 response bytes. The earlier qualification summaries remain historical receipts.
Batch B is documented in `docs/runbooks/urgiis-batch-b.md`. `premier.jsonl.br`, `junior-sinn.jsonl.br` and `revolution.jsonl.br` contain complete connector replays, including independently fetched closing controls. Their corresponding `*-geocode.json` files retain Census matches for the published yard addresses. The replay metadata records accepted, rejected, excluded and duplicate counts. Batch-specific tests inspect every admitted model for a 30-card cutoff and the existing 500-card boundary, and verify the one-third floors.

`revolution-currency.json` binds two current native photo Last-Modified timestamps to owned NC74 donor VINs, stocks, years and per-vehicle destinations. `revolution-currency-probes.json.br` preserves the native detail/contact/about pages and successful photo HEAD receipts. The offline currency test rechecks both native seller/SKU and VIN bindings. No photo timestamp is used as canonical `availableDate`.

`74-auto-rejected-census.jsonl.br` and `airport-rejected-census.jsonl.br` preserve complete failed censuses in connector replay format. Their negative replays verify admission failure after separate closing checks and before any donor publication. Airport retains all 46 makes, 489 models and 46 arrivals, with 1,157 / 5,103 rejected observations (22.67%) and no exclusions. `shroyer-excluded-audit.jsonl.br`, `creston-excluded-audit.jsonl.br`, `lambert-excluded-audit.jsonl.br` and `mars-excluded-audit.jsonl.br` are excluded-qualification audit archives: a metadata line followed by raw `{key, url, html, status?}` responses, including available failed responses. They retain the shared 500-card pool, verified 30-card omission and alternate-route probes, exhausted Lambert model route, and inaccessible MARS owner page. They do not claim complete censuses or use the admitted replay loader. Shroyer's Hollander storefront is the same business and must not be added separately.

`batch-b-source-audit.json` audits the original base plus these three additions: 49,258 distinct VINs, zero cross-tenant duplicates, all physical-yard floors satisfied, and 9,804 daily native responses. Sibling batches are outside this audit and require a new combined audit when restacked.

`batch-b-qualification.json` records all nine decisions, complete and interrupted graph sizes, rejected-census replay proofs and per-tenant request accounting. `batch-b-requests.jsonl.gz` retains 2,747 recorded attempts, including one Lambert start whose completion receipt is unavailable. At most three early interrupted attempts (one each for Premier, Junior Sinn and 74 Auto) may be unrecorded. Redirect hops are not counted separately. The qualification ledger is separate from daily-run request counts.

`batch-c-excluded.jsonl.br` retains 561 saved partial responses for A-Z, Transwest, Lake Point, Norb's and Southwest, plus their request receipts. A-Z's complete 27-make, 183-model directory stops after 162 model pages when Sportage times out after 90 seconds on all three attempts. No closing controls were reached. Its saved arrivals page supports the exact known title variant and identifies vehicles waiting to be parted out. Transwest's Titan badge is 38 but its page renders 30 cards without continuation; `page=2` returns 404 three times and `paged=2` repeats the same records. Lake Point omits inline supplier declarations on all four checked pages; the exact verified external-bundle variant is now recognized as described below. Norb's exposes a complete 51-make, 672-model directory, but its Taurus route fails DNS resolution on all three paced attempts. Southwest's 45-make, 372-model graph stops after 129 model pages when Grand Marquis returns HTTP 500, a 90-second timeout and HTTP 500. HTTP failure bodies are retained; attempts without an HTTP response retain only their receipts. These are excluded-lead audit captures, not complete connector replay archives.

`batch-c-requests.jsonl.gz` retains 573 sanitized HTTP attempt receipts. `batch-c-qualification.json` records the five exclusions, one known unlogged A-Z home request and the unchanged whole-source daily budget. Earlier attempts used separate batch gates; later receipts explicitly identify the shared cross-process file gate. None of these partial censuses is admitted as inventory.

`lakepoint-supplier-bundles.json.br` preserves six public LiteSpeed JavaScript bundles referenced literally by Lake Point's home, contact, search, directory, model and arrivals pages. Each filename equals the script's MD5 content hash, and every native supplier declaration is UU23 with `iisHomeUrl='lakepointauto.com'`. These exact script references are the ownership exception; changed hashes, versions or additional optimized bundles require requalification. Scripts are inspected as text and never executed by tests.

`retry-probes.json.br` preserves the slower isolated rechecks of A-Z Sportage, Southwest Grand Marquis, Norb's Taurus, Quick Recovery ATS and Riverbend E250, with response times, status and sanitized response headers. Every route recovers in probes spaced at least two minutes apart and succeeds with both browser-style and plain curl headers. Quick Recovery's first new HTTP 500 body explicitly reports an unreachable or misconfigured Redis connection. Lake Point probes retain the live directory, model and arrivals markup referencing its verified supplier bundles. These probes establish recovery and parser support, not complete inventory admission.

`az.jsonl.br` preserves the slower fresh 27-make, 183-model census, 60 arrivals and 29 independent closing controls. Its 242-response production replay accepts 1,739 donors, rejects 54 observations, excludes none and merges 39 duplicates. The Sportage route succeeds within this complete run. `az-geocode.json` retains the published address's Census match.

The retry probes also retain Lambert's three successful spaced Hummer H2 responses and MARS's two controlled Chrome/Firefox owner-page comparisons. MARS's Cloudflare block pages have the client IP redacted. The Firefox responses retain the native OH25 declaration; an actual production-client attempt also succeeds after one transport failure. These comparisons support a per-tenant User-Agent profile without weakening request pacing or ownership checks.

`retry-requests.jsonl.gz` records all 511 fresh attempts, including transport failures, asset requests, geocoding and the published-map redirect. `retry-qualification.json` records per-tenant diagnoses, outcomes, source-wide VIN overlap bounds and daily budget. Only A-Z qualified before the parent stopped full censuses for a separate backend API investigation. Seven tenants are ready for a census, with no final donor accounting claimed.

`retry-diagnostics.jsonl.br` retains diagnostic and failed-attempt captures with sanitized receipt headers. Failed transports without a response retain null HTML. MARS block pages redact the client IP. `retry-interrupted.jsonl.br` retains Southwest's 212 successful responses from the fresh run stopped on instruction, including the in-flight request that completed after the traversal stopped. There are no closing controls. This audit archive is not an admitted connector replay. The original exclusion archives and summaries remain historical records.

`lambert-retry-failures.json.br` extracts the two historical H2 HTTP 500 bodies from PR #171, with source revision and path. They explicitly name Redis and database connection errors. They are existing captures, not additional requests in the fresh ledger.

The fresh one-time seven-tenant qualification is recorded in
`fresh-census-qualification.json`. `fresh-census-requests.jsonl.gz` preserves every
fresh attempt, including transient failures and the three separate iPull GETs,
with sanitized response headers, hashes and shared-gate timestamps.
`fresh-census-cap-photo.json` records complete model counts, maximum card counts,
30-card checks and own supplier-photo codes for every admitted census. New
`<code>.jsonl.br` connector replays contain complete graphs and separately fetched
closing controls. Coordinate fixtures preserve the retry diagnosis's published
address or business-map proof. `fresh-census-excluded.jsonl.br` retains complete
failed-quality censuses, any interrupted prefixes and failed HTTP bodies as audit
evidence. These excluded captures never become inventory. Original batch and retry
summaries remain historical and are not rewritten.
