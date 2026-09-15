# Wrench-A-Part ingestion

Verified read-only on 2026-09-15, against public production endpoints. No provider writes, database credentials, paid services, or production ingestion were used.

## Discovery and API contract

The public homepage loads `https://wrenchapart.com/js/wrench-www.es.js`. Its endpoint map and `hm` vehicle loader establish:

- `GET https://api.wrenchapart.com/locations`: bare array of public yard metadata. IDs, names, slugs, street/city/state/ZIP, public phone, `geoLat`, and `geoLng`. Seven yards, 3,168 decoded JSON bytes.
- `GET https://api.wrenchapart.com/v1/vehicles`: bare complete inventory array. 11,460 rows, 4,457,047 decoded JSON bytes.
- `GET https://api.wrenchapart.com/v1/vehicles?locationId=2`: one complete yard array. The website also sends `makeId`, `modelId`, and `days`; ingestion deliberately omits these narrowing filters.
- No page, offset, total-count envelope, next link, or continuation token is used by the public client. Vehicle-search's global catalog loader also requests the unfiltered endpoint directly.
- All seven filtered yard responses were compared with the global response by VIN. Their union exactly equaled the global catalog: zero missing, extra, or wrong-yard rows. Thus the connector uses actual yard partitions, not invented API pagination.

Vehicle fields: numeric `yard`, `modelYear`; nested `make.name` and `model.name`; `vin`, `stockNumber`, `color`, `photo`, nullable `dateAdded`; nullable `row` with `id` and optional string coordinates. The provider additionally sends make/model IDs, nested model make, and sometimes thumbnails. Only consumed fields are decoded. Vehicle row coordinates are not used as yard coordinates.

The API has no authentication requirement. Requests use the shared provider HTTP client, a 1,100 ms request gate, 30-second request timeout, and two retries for transient statuses/timeouts. No network-error retry. A changed envelope, invalid field types, partial response, pagination Link header, empty/duplicate-ID directory, or ignored location filter fails the chunk.

## Live coverage and public yard metadata

Codes are the provider's numeric IDs serialized as strings, scoped by `source: "wrenchapart"`. Names never determine overlap.

| ID    | Public yard           | Vehicles | Yard JSON bytes | Row52 matches | AutoRecycler matches |
| ----- | --------------------- | -------: | --------------: | ------------: | -------------------: |
| 2     | Austin                |    1,796 |         679,214 |          0/20 |                 0/20 |
| 3     | Lubbock               |    2,121 |         845,440 |          0/20 |                 0/20 |
| 4     | Belton (Budget)       |    2,400 |         967,245 |          0/20 |                 0/20 |
| 5     | San Antonio           |    1,557 |         632,239 |          0/20 |                 0/20 |
| 8     | Holland (Late Model)  |    1,035 |         316,720 |          0/20 |                 0/20 |
| 9     | Austin Primo          |    1,051 |         421,238 |          0/20 |                 0/20 |
| 10    | San Antonio Roosevelt |    1,500 |         594,963 |          0/20 |                 0/20 |
| Total | Seven Texas yards     |   11,460 |       4,457,059 |         0/140 |                0/140 |

Payload sizes measure decoded response text, including each response's framing.

| ID  | Public street, city, ZIP                  |           Latitude |           Longitude |
| --- | ----------------------------------------- | -----------------: | ------------------: |
| 2   | 5055 Hwy 71 East, Del Valle, 78617        | 30.189065919182337 |  -97.56529557236925 |
| 3   | 4210 E. Slaton Highway, Lubbock, 79404    |  33.51859831959455 | -101.77823714349435 |
| 4   | 4497 US Hwy 190 West, Belton, 76513       | 31.051947483722792 |  -97.51810604352379 |
| 5   | 5814 Interstate 10 E., San Antonio, 78219 | 29.438652440432083 |   -98.3760299588843 |
| 8   | 24759 State Hwy 95, Holland, 76534        |  30.86314113088208 |  -97.39782722818366 |
| 9   | 5021 E. Highway 71, Del Valle, 78617      |           30.18905 |           -97.56783 |
| 10  | 10606 Roosevelt Ave, San Antonio, 78221   |           29.31181 |           -98.47346 |

These coordinates come from `/locations`, not geocoded ZIPs or estimates. New IDs are discovered from that response without an allowlist. Incomplete names/cities/states or unusable coordinates exclude affected vehicles with counts, warnings, and normalized `observedVins`, protecting existing inventory observations. Public yard contact metadata can still be emitted with null coordinates.

## Overlap evidence

Before implementation, take the global response in its returned order. For each yard, retain VINs matching `^[A-HJ-NPR-Z0-9]{17}$`. Select 20 evenly spaced records at indices `floor(i * (length - 1) / 19)`, for `i = 0..19`. This samples newest through oldest, rather than one make or recent arrivals only.

| Yard ID | First sampled VIN | Last sampled VIN  |
| ------- | ----------------- | ----------------- |
| 2       | 1N4AA5AP3AC800856 | 1GTFC24K6NZ508811 |
| 3       | 1FTNW20L3YEA05637 | JF2SHABC3CH462817 |
| 4       | 1FTYR10UX5PA48363 | 1FDKE37FXTHB61771 |
| 5       | 5FNYF4H55AB021616 | 5NPDH4AE4FH569103 |
| 8       | 1FADP3F21EL172668 | WAUJ8GFF5H1056262 |
| 9       | 1G1ZD5ST0LF058684 | 1FM5K8AR2FGB84333 |
| 10      | 1FMZU63K24ZA91247 | 2A4RR2D15AR422925 |

Row52: `GET https://api.row52.com/odata/Vehicles`, `$filter=isActive eq true and (vin eq 'VIN1' or ...)`, at most 10 predicates per request, `$count=true`. All 14 sample requests returned zero rows and zero count, with no `@odata.nextLink`. A separate active positive control, `1GNDT13W2X2112254`, returned exactly two matching records, count 2, no next link.

AutoRecycler: use `buildGlobalMsearchBody(0, 100)` and `postAutorecyclerElasticsearchMsearch` from `src/server/ingestion/autorecycler-client.ts`. Append `{ key: "vin_text", value: vins, constraint_type: "in" }` to the first search's existing constraints. Positive control `1HGFA16518L047209`, obtained from the first 100 global records, returned exactly that VIN, total 1, `at_end: true`. All seven 20-VIN queries returned zero hits, total 0, `at_end: true`. Responses were checked against requested VINs and their totals, and none reached the requested 100-hit limit. No silent truncation was observed. Requests were separated by at least 1,100 ms.

Conclusion: 140/140 sampled VINs were absent from both existing providers. This establishes sampled net-new coverage, not an exhaustive claim about all 11,460 records.

Example read-only endpoint checks:

```sh
curl --fail --silent --show-error https://api.wrenchapart.com/locations
sleep 1.1
curl --fail --silent --show-error 'https://api.wrenchapart.com/v1/vehicles?locationId=2'
sleep 1.1
curl --fail --silent --show-error --get 'https://api.row52.com/odata/Vehicles' \
  --data-urlencode '$filter=isActive eq true and (vin eq '\''1N4AA5AP3AC800856'\'')' \
  --data-urlencode '$count=true'
```

## Connector and integration recommendations

- Entry point: `streamWrenchApartInventory({ startCursor, maxPages, onBatch, onYards })` in `wrenchapart-connector.ts`.
- Cursor schema: `WrenchApartCursorSchema`. Initial value: `{ source: "wrenchapart", afterLocationId: 0 }`. Register with the shared JSON cursor helper, serializing `{ "afterLocationId": 0 }` as the starting payload. Pass the resulting cursor directly back to `startCursor`.
- `maxPagesPerChunk: 1`, also the connector default. A page means one complete yard, not one record page. Seven chunks complete this catalog; each chunk fetches the current directory and one yard.
- Cursor advances only after callbacks finish and is based on the completed yard's stable ID. Directory reordering or removal of an already processed ID does not shift the next yard. Newly discovered larger IDs join this run; IDs below the cursor are picked up next run, matching the Row52 high-watermark approach.
- Suggested initial `minimumCount: 9000`, with the existing prior-accepted-count drop guard and accounting validation. Baseline is 11,460. This is a recommendation for parent registration, not implemented shared policy.
- Keep chunk accounting and `observedVins` when wiring `toFetchedChunk`. Warnings are also logged. Deduplication is within each chunk; the existing durable snapshot/checkpoint layer handles cross-chunk VIN uniqueness.
- No shared source registration, cursor registry, error union, source validation, reconciliation, UI, soak runner, schema, dependency, or lock files are changed here.

Working links: inventory uses `https://wrenchapart.com/vehicle-search.html`; price links are derived from public slugs as `https://wrenchapart.com/<slug>-price-list.html`. All eight URLs were checked live and returned HTTP 200 after redirects to extensionless paths. No unsupported VIN-specific deep link is fabricated.

### Work and checkpoint size

The API supports yard grouping, so a one-shot full-catalog checkpoint is unnecessary. Measured largest yard: Belton, 2,400 raw rows, 967,245 decoded response bytes, 1,629,917 canonical batch JSON bytes. The live seven-chunk smoke took 16.5 seconds, including request gates, with callbacks discarding inventory. The largest canonical batch size is a proxy for checkpoint payload size, not a measurement of SQL transaction overhead.

There is no verified within-yard pagination. An individual yard must be fetched and checkpointed whole; `maxPages=1` bounds yard requests, not future vehicle growth. No inventory array is sliced. Parent should start at one yard per chunk and measure actual checkpoint time before increasing it.

## Verification

Final targeted checks: 25 tests passed (80 assertions), `bun run check` passed with zero lint warnings/errors and a clean TypeScript check, and all nine changed files passed formatting. Tests cover decoding, metadata gaps, accounting, stable-ID resume, full-yard handling, changed filters, and callback failure/replay.

```sh
bun test src/server/ingestion/wrenchapart-client.test.ts src/server/ingestion/wrenchapart-transform.test.ts src/server/ingestion/wrenchapart-connector.test.ts
bun run check
bunx --no-install oxfmt --check src/server/ingestion/wrenchapart-*.ts src/server/ingestion/fixtures/wrenchapart-sample.json docs/runbooks/wrenchapart-ingestion.md
```

Read-only full smoke, no DB or services beyond the public provider:

```sh
bun -e '
import { Effect } from "effect";
import { streamWrenchApartInventory, WrenchApartCursor } from "./src/server/ingestion/wrenchapart-connector";
let cursor = { ...WrenchApartCursor.initial };
let count = 0;
for (let chunk = 0; chunk < 30; chunk++) {
  const result = await Effect.runPromise(streamWrenchApartInventory({
    startCursor: cursor,
    maxPages: 1,
    onBatch: () => Effect.void,
    onYards: () => Effect.void,
  }));
  console.log(result);
  count += result.count;
  cursor = result.cursor;
  if (result.status === "complete") { console.log({ count }); break; }
  if (chunk === 29) throw new Error("Smoke did not reach completion");
}'
```

Measured smoke: 11,460 processed and emitted, 11,460 unique VINs; zero excluded, rejected, duplicates, warnings, or observed-only VINs. The terminal cursor was `{ source: "wrenchapart", afterLocationId: 10 }`.

## Limitations

- All rows have nonempty VINs; 11,433 match modern 17-character VIN syntax. The remaining 27 include older identifiers and some short identifiers on newer vehicles. Preserve the provider's identity after trimming/uppercasing, consistent with existing connectors; do not invent or repair VINs.
- The provider does not expose an independent total or snapshot token. Exact global-versus-yard equality was verified live, but future silent server-side caps cannot be ruled out by array decoding alone. Repeat the global/yard comparison if inventory drops or the public client changes.
- Directory discovery cannot find inventory for an ID omitted entirely from `/locations`. None existed in the live global comparison. Changes during a multi-chunk run are not an atomic snapshot; the parent snapshot count/drop guards remain important.
- Production persistence and reconciliation were not exercised. Shared registration and the soak-runner integration are owned by the parent task.
