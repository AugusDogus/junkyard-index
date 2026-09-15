# U Pull R Parts ingestion

Verified read-only on 2026-09-15 from base `6be5c4c`. No database or provider credentials required.

## Public contract

- Page: <https://upullrparts.com/inventory/>
- Shipped script: <https://upullrparts.com/wp-content/plugins/V5.0/vehicle-search.js?ver=1789392219>
- POST <https://upullrparts.com/wp-admin/admin-ajax.php>, URL-encoded form:
  `action=doApiCall&apiAction=getVehicles`.
- No cookies, nonce, authentication, or preliminary page fetch required.
- The shipped vehicle form also sends `site`, `makes=0`, `models=0`, `years=0`,
  `beginDate=`, `endDate=`. `site=1` returns Minnesota stores 1 and 2;
  `site=3` returns Toledo store 3. Omitting the filters returns all three.
- The response is a top-level JSON array, with no total, cursor, next link, or
  pagination envelope. FooTable paginates the downloaded array in the browser.
- All 3,298 live records had `Year` (integer), `Model`, `Color`, `StockNumber`,
  `DateSet`, `DateSetData`, `VIN`, `Odometer` (strings), `Row`, `Store` (integers),
  and `DateSetSort` (object). One original row is checked in as a fixture.
- `DateSetData` is ISO calendar date, not a timestamp. The connector maps it to
  UTC midnight and rejects impossible dates instead of rolling them forward.
- No `Make` field exists in vehicle rows. The connector obtains authoritative
  make membership from the supporting endpoints described below, preserving
  original model labels and catalog ordering.
- The script references AAA image/parts actions separately, including
  `action=doAaaApiCall&apiAction=getVehicleImages&stockID=...`.
  The actual upstream vehicle URL at `api.aaaparts.com` is not exposed or verified.
  Ingestion uses the verified WordPress endpoint and makes no image requests.
- Inventory details link to the working inventory page. The shipped script has
  no per-VIN deep-link reader. No invented image or vehicle URLs.

```sh
curl -fsS --max-time 30 \
  -A 'JunkyardIndex/1.0' \
  --data 'action=doApiCall&apiAction=getVehicles' \
  https://upullrparts.com/wp-admin/admin-ajax.php
```

The shared HTTP client's Chrome 120 user agent reproducibly received HTTP 403.
The truthful `JunkyardIndex/1.0` agent returned HTTP 200, as did the initial curl
and Bun clients. This source supplies its own agent through the existing header
option. HTTP errors remain failures and nonretryable 403s are not retried.

## Authoritative make resolution

Follow-up verification on 2026-09-15 exhausted the shipped make/model actions:

| Action        | Additional form fields                            | Verified response                                     |
| ------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `getMakes`    | none                                              | 56 raw make labels, including `MINI`, `Rover`, `Ram ` |
| `getMakes`    | `ModelYear=2015&Form=searchPartForm`              | 33 labels for that year                               |
| `getModels`   | `Make=Ford&ModelYear=0`                           | 74 all-year model labels                              |
| `getModels`   | `Make=Chevrolet&ModelYear=2015`                   | 23 model labels for that year                         |
| `getYears`    | `Make=Ford&Model=MUSTANG`                         | 1965 through 2023                                     |
| `getVehicles` | `makes=Ford&models=0&years=0&beginDate=&endDate=` | 595 vehicles across all three stores                  |

All actions use the same WordPress endpoint, `action=doApiCall`, the same public
client headers, and top-level JSON arrays. Parameter case matters: `Make` and
`ModelYear` for model lookups, lowercase `makes` and `years` for inventory forms.
Preserve raw make labels in requests, including the trailing space in `Ram `.

```sh
curl -fsS --max-time 30 -A 'JunkyardIndex/1.0' \
  --data 'action=doApiCall&apiAction=getMakes' \
  https://upullrparts.com/wp-admin/admin-ajax.php
curl -fsS --max-time 30 -A 'JunkyardIndex/1.0' \
  --data 'action=doApiCall&apiAction=getModels&Make=MINI&ModelYear=0' \
  https://upullrparts.com/wp-admin/admin-ajax.php
curl -fsS --max-time 30 -A 'JunkyardIndex/1.0' \
  --data 'action=doApiCall&apiAction=getVehicles&makes=Ford&models=0&years=0&beginDate=&endDate=' \
  https://upullrparts.com/wp-admin/admin-ajax.php
```

The 56 all-year model responses contain 1,278 distinct labels. Model relations
alone resolve 3,275 vehicles: 21 rows have cross-make model collisions and two
rows have model `UNKNOWN`. Do not guess from names such as MUSTANG or FORD E250
VAN. The provider maps MUSTANG to both Dodge and Ford, and FORD E250/E350 VAN to
both Ford and Mercedes-Benz. Year filters do not solve every collision:
`getYears` returns 1975 through 2014 for FORD E250 VAN under both makes.

The implemented resolution order is:

1. Fetch the original unfiltered catalog once and keep its row ordering.
2. Fetch `getMakes`, then each make's complete `getVehicles` partition. Join only
   matching original rows by store, stock number, VIN, year, and model. Require
   unique make membership; helper responses cannot add, remove, or reorder rows.
3. If any original rows are unmatched, fetch `getModels&ModelYear=0` for **every**
   make. Accept a model relation only when it has exactly one normalized make.
   A conflicting partition is not overridden using the model directory.
4. Unresolved rows remain inventory with `Other` and counted warnings. Failed or
   malformed supporting requests fail the checkpoint rather than becoming empty
   results or manufactured makes. No WMI, VIN decoding, or model-name heuristic.

Measured final attribution:

| Method                | Resolved vehicles | Evidence                                                        |
| --------------------- | ----------------: | --------------------------------------------------------------- |
| Unique make partition |             3,295 | 56 partitions, 3,295 distinct original identities, no conflicts |
| Unique model relation |                 3 | LR2: 1 under `Rover`; MINI COOPER: 2 under `MINI`               |
| Unresolved            |             **0** | No `Other` values or warnings                                   |

The `Rover` group is retained as the provider names it, not renamed to Land Rover.
The two `UNKNOWN` model rows resolve directly to Chevrolet (`NG067546`) and Honda
(`CP017842`). The final catalog has 41 normalized make labels. This resolution
is live each run, not a hardcoded vehicle or model mapping. The captured MINI
model response is a decoder/regression fixture only.

## Measured coverage

| Store / stable ID | Yard            | Raw / nonempty VIN | Standard 17-character VIN | Row52 sample matches | AutoRecycler sample matches |
| ----------------- | --------------- | -----------------: | ------------------------: | -------------------: | --------------------------: |
| 1 / UPRRP-1       | Rosemount, MN   |              1,276 |                     1,273 |                 0/20 |                        0/20 |
| 2 / UPRRP-2       | East Bethel, MN |              1,126 |                     1,123 |                 0/20 |                        0/20 |
| 3 / UPRRP-3       | Toledo, OH      |                896 |                       893 |                 0/20 |                        0/20 |
| Total             | 3 yards         |              3,298 |                     3,289 |                 0/60 |                        0/60 |

All nonempty VINs were unique. Nine short identifiers include pre-1981 vehicles
and apparently incomplete newer VINs. They remain source identities, consistent
with the existing connectors' nonempty-VIN policy; they were excluded from overlap
sampling. No checksum claim is made for the standard-length identifiers.

Sampled 20 evenly spaced unique standard-length VINs in provider order from each
yard (`floor(i * uniqueCount / 20)`, `i=0..19`). This is evidence of net-new
coverage, not a claim that the entire catalog has zero overlap.

Positive controls ran first:

- AutoRecycler: read 100 global records, then constrained to known VIN
  `1HGFA16518L047209`; returned one matching record with `at_end=true`.
- Row52: read 100 active records (`@odata.count=140791`), then queried known VIN
  `1GNDT13W2X2112254`; returned two matching records and `@odata.count=2`.
- AutoRecycler samples used `buildGlobalMsearchBody(0, 100)` and
  `postAutorecyclerElasticsearchMsearch`, appending
  `{key: "vin_text", value: vins, constraint_type: "in"}` to `search.constraints`.
  Responses had `responses[0].hits.hits`, **no total field**, and `at_end=true`
  for all three sample queries. Missing/invalid response shapes failed validation.
- Row52 used six requests, at most 10 VIN predicates each. All returned a valid
  `value` array, `@odata.count=0`, and no next link. Failed requests were never
  treated as zero matches.

```sh
curl -fsS --get --max-time 45 'https://api.row52.com/odata/Vehicles' \
  --data-urlencode '$filter=isActive eq true and (vin eq '\''1FADP3F20FL287649'\'' or vin eq '\''4M2ZV1116WDJ27644'\'')' \
  --data-urlencode '$top=100' --data-urlencode '$count=true'
```

Exact sampled VINs:

```text
Rosemount:
1FADP3F20FL287649 4M2ZV1116WDJ27644 1GHDT13S842114585 1G1PC5SBXE7388184
1J4GL48K34W232317 1G4HP57218U159158 5FNYF4H43BB011305 1HGCM66527A101408
3G5DA03E94S588069 2FMDK49CX7BA68049 5FNYF4H64AB012396 2B3HD56F6TH306699
1GCEK19T04E231136 WDBJF82J42X068611 5LMFU28A0YLJ40138 5XYKWDA77EG442849
1FTFW1ETXEFB61347 3GNAL2EK2ES642955 3GYFNCEYXAS547454 1FTNE24W46DA26510
East Bethel:
5NMSH73E08H227458 1G2WP52K8YF195909 3FADP4EJ0BM125172 5J6YH28573L051029
1C4RDJDG5EC502498 1FMCU9EG2BKB24270 1G3HN52K7V4814419 2HKRL1867XH530573
1J8FF47W37D422740 1G1AL58F987266923 1FAHP2HW2BG187020 1G8ZG5281WZ113747
1FTRX18L12NB93854 2GCEK19T331160823 1J4GW58N54C270723 1GKKVPEDXBJ140685
1GKS2CE05CR264719 2GNFLEEK1E6197534 JHMGD38497S054762 1N4BA41E08C806640
Toledo:
1FMCU9DG6AKC85849 1B3LC56D19N515683 1C4NJRFBXHD152386 1HGCP2F68CA037037
SHSRD78863U112749 1GNDT13S222464515 JHLRD68596C021809 1C3CCBBB9EN172069
1G1ZB5E11BF178511 1G4GC5ED2BF266209 1G1ZG57B79F212579 1ZVFT80N975364634
3GKALPEX7JL281328 2CNFLPEY3A6310642 3GSCL53748S689396 1D7HU18D25S347187
1G1AK55F577321342 1C6RR7GT7GS184039 5XYKTCA65EG463628 4S3BMBK61C3005768
```

## Yard provenance

Contact details: <https://upullrparts.com/contact/>. Coordinates are public map
pins, not city or ZIP centroids.

| Yard        | Address                                   |   Latitude |   Longitude | Map query                            |
| ----------- | ----------------------------------------- | ---------: | ----------: | ------------------------------------ |
| Rosemount   | 2985 160th St W, Rosemount MN 55068       | 44.7183045 | -93.1261146 | U Pull R Parts Rosemount MN          |
| East Bethel | 20418 Highway 65 NE, East Bethel MN 55011 | 45.3397588 | -93.2380204 | 20418 MN-65                          |
| Toledo      | 5650 N Detroit Ave, Toledo OH 43612       | 41.7186651 | -83.5355032 | 5650 N Detroit Ave, Toledo, OH 43612 |

Use `https://maps.google.com/maps?q=<encoded query>&t=m&z=12&output=embed&iwloc=near`
to reproduce. Read the returned place pin, not the viewport center. The contact
body lists an inconsistent Rosemount address (2871); its footer and named business
map pin agree on 2985. The unqualified 2871 embedded query was ambiguous and was
not used for coordinates. East Bethel and Toledo queries are the site's own map
embeds and return the exact addresses. Phones are in the metadata module.

## Pipeline integration

- Source `upullrparts` is registered in durable ingestion, validation,
  reconciliation, search filters, and the local soak runner.
- Cursor is `0 | 1`: start `0`, complete `1`. One atomic catalog chunk, maximum
  chunks per run `1`. `pagesProcessed=1` means the complete catalog was processed.
  Replaying `1` performs no fetch or callbacks. Persist `1` only after all batches
  and observations succeed. A failed write retries the entire catalog at `0`.
- There is no provider pagination or intra-catalog resume. No `maxPages` option
  is needed. Do not emulate pagination by repeatedly fetching a changing catalog.
- Measured unfiltered response: **964,136 UTF-8 bytes**, 3,298 rows. Filtered
  responses: Minnesota 702,352 bytes / 2,402 rows; Toledo 261,785 bytes / 896 rows.
  Counts exactly matched the unfiltered union, with no measured truncation.
- The full array is materialized, enriched, and deduplicated in memory;
  `onBatch` gets at most 250 vehicles. A hard 20,000-row bound fails before
  callbacks, rather than slicing and claiming success. Supporting partitions are
  separately capped at 20,000 rows. The make decoder allows at most 64 nonempty,
  uniquely normalized make labels; model responses allow at most 500 labels each.
- Make lookup requires 58 requests without fallback, **114 measured requests**
  with fallback (catalog + make directory + 56 partitions + 56 model lists).
  Absolute maximum is 130 logical requests at the 64-make bound, with two retries
  per retryable request. HTTP timeout is 30 seconds. The existing Effect rate
  limiter permits one request start per 1.5 seconds, sequentially, including retries.
  A **four-minute whole-checkpoint timeout** fails with no terminal cursor. Parent
  execution must allow this budget (for example, 300 seconds); it is no longer a
  three-second source. No per-VIN requests or invented provider pagination.
- The provider supplies no independent total. Empty catalogs, oversized catalogs,
  non-array responses, and missing known stores fail. Partial loss within a store
  still requires the shared minimum-count and previous-run drift checks.
- Minimum accepted unique inventory is **2,000**, plus the existing 50% drift,
  duplicate, and rejection checks.
- Source-specific types reuse `CanonicalVehicle`, `Yard`, and
  `ConnectorChunkResult` with the registered source identifier.
- Public signature remains `streamUpullRPartsInventory<E, R>(options:
UpullRPartsStreamOptions<E, R>)`. Options are `startCursor?: 0 | 1`, `onBatch`,
  and optional `onYards`, both callbacks returning `Effect<void, E, R>`. Result is
  `Effect<UpullRPartsStreamResult, E | UpullRPartsProviderError |
UpullRPartsMakeError | UpullRPartsStreamError, R>`. No new durable cursor fields.
  The direct transform now also requires `UpullRPartsMakeResolution`.
- `onYards` emits the three verified yards. New unknown store IDs are excluded
  with counted warnings and normalized `observedVins`, preserving prior inventory
  via the shared observation path while known yards continue. Review metadata
  before enabling a new store. No coordinates are invented.

## Verification

```sh
bun test src/server/ingestion/upullrparts-connector.test.ts src/server/ingestion/upullrparts-transform.test.ts src/server/ingestion/upullrparts-makes.test.ts
bun run check
bun -e 'import {Effect} from "effect"; import {streamUpullRPartsInventory} from "./src/server/ingestion/upullrparts-connector"; console.log(await Effect.runPromise(streamUpullRPartsInventory({onBatch: () => Effect.void, onYards: () => Effect.void})));'
```

Final make-aware live smoke: complete cursor `1`, 3,298 vehicles, three yards,
41 makes, **zero Other**, 14 discarded batches, maximum batch 250, **170,905 ms**.
Raw=3,298; rejected, duplicate, excluded, warnings, and errors all zero. No
production writes. An initial fixed-delay smoke also resolved all rows but took
239,521 ms; the existing rate limiter removed avoidable post-response delay.

Targeted regressions cover response envelopes, empty/oversized/missing-yard
catalogs, callback failures and replay, accounting and unknown-yard observations,
batch boundaries, identity/date normalization, missing coordinates, authoritative
partition joins, raw make filters, unique/colliding model relations, unknown model
labels with known makes, lookup bounds/failures, and unchanged inventory ordering.

Provider-specific checks: 45 tests passed, zero failed; `bun run check` passed
with zero lint warnings/errors and no type errors. Local SQLite integration tests
also cover persisted fixture vehicles, yard metadata, and checkpoint replay.

The later integrated read-only soak returned 3,303 vehicles (five more than
the earlier sample), 14 batches, 114 requests, in 170.3 seconds, with no warnings
or errors:

```sh
bun run soak:sources -- --sources=upullrparts --cycles=1
```

## Review checkpoint

Round 1 found explicit partial-response handling and unnecessary display-field
validation in supporting make partitions. Commits `fb947af` and `1b7bbe8` fix
those independently, with regressions for all request kinds and join fields.

Round 2 reviewed the complete branch at `1b7bbe8`; correctness/security and
maintainability passes both returned no actionable findings. The full suite
passed 576 tests, and lint, typecheck, and branch whitespace checks passed.
The final read-only soak repeated 3,303 vehicles and 114 requests in 170.3 seconds,
with no warnings/errors. Production publication and external alert delivery
were not invoked.
