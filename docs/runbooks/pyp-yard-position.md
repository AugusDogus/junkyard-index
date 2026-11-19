# PYP yard positions

## Public contract (November 19, 2026)

The existing `GET /DesktopModules/pyp_api/api/Inventory/Filter` response
already contains `Section`, `Row`, and `SpaceNumber`. No additional endpoint
or per-vehicle request is needed. Current main already decodes and maps these
fields to canonical `section`, `row`, and `space`.

The committed PYP tests previously used synthetic records only. The reduced
fixtures in `src/server/ingestion/pyp-test-fixtures/` retain two unmodified
vehicle objects from Riverside's first 500-record JSON page, the response
envelope, and its published directory entry:

- `JHMES96644S020762`, stock `1290-114836`: `LEVEL 1`, row `23`, space `5`.
- `19UUA56823A028973`, stock `1290-114943`: position properties absent.

The full Riverside sample has all three position fields on 481/500 records.
Store `1265` has them on 499/500. These are first-page samples, not a chain-wide
census. Neither JSON sample contains engine or transmission specifications.
The public inventory JavaScript fetches
`/DesktopModules/pyp_vehicleInventory/getVehicleInventory.aspx` per yard;
Riverside's first 25-card HTML response renders Section / Row / Space and has
no engine or transmission specifications. Its `ENGINE_...hood_open.jpg` paths
are photos, not engine descriptions. Engine and transmission remain null.

Five live GETs were made, serially and spaced, with a normal Chrome User-Agent:
the inventory directory, two existing JSON pages (`1265` and `1290`), the
inventory JavaScript, and one Riverside HTML listing page. All returned 200.
There were no retries, detail requests, writes, or publication calls. Original
captures and the local red-test log are under the discovering worktree's
`.scratchpad/pyp-yard-position/`; session cookies and tokens are not committed.

## Mapping and validation

The transform trims position strings and accepts at most 40 characters of
letters, digits, spaces, and common label punctuation. It rejects placeholders
such as N/A, Unknown, TBD, and Not Assigned, punctuation-only values, control
characters, markup, and URLs. An unusable position becomes null without
discarding the vehicle. Zero and alphanumeric positions remain valid.

The original production observation (0/20 positioned PYP records) was not
reproduced against current main with these public responses. The sample's
capture time and ingestion state are unknown. The public data does sometimes
omit positions, so completeness is not guaranteed for every vehicle.

## Requests per ingestion run

Before and after: **P + ceil(P / 30)** successful provider requests for an
uninterrupted durable run. P is the sum of per-yard JSON pages, at 500 vehicles
per page; every yard needs a final short page, including an empty page after
an exact multiple of 500. Each durable chunk fetches one directory page and
at most 30 JSON pages. Equivalently, P = sum(floor(N_yard / 500) + 1) for a
stable inventory. A 60-yard run where every yard has fewer than 500 vehicles
would take 62 requests, before and after. Actual full-run counts were not
measured. Existing transport retries or resumed chunks can add requests.

This change adds **zero** requests per run and keeps the existing transport
and pagination. The investigation's five requests are separate from ingestion.

## Ingestion and search

Normal accepted ingestion updates previously null positions. The fixture test
round-trips the snapshot store, confirms reconciliation schedules the changed
vehicle, and checks Algolia projection. The existing database columns,
projection, and search-card attribute list already retain these fields, so no
Algolia settings change or search schema bump is needed. Current schema stays
at 11. A search-only reindex cannot recover fields absent from stored rows.

No ingestion, reindex, merge, or deployment was triggered for this work.

## Local checks

```sh
bun test src/server/ingestion/pyp-yard-position.test.ts src/server/ingestion/pyp-transform.test.ts src/server/ingestion/pyp-connector.test.ts src/server/ingestion/pyp-direct-session.test.ts
bun run lint
bun run typecheck
```

The new validation tests failed on main before the transform change (31 failed,
3 passed). The captured positive mapping and missing-position cases already
passed on main, consistent with the existing field mapping.

All 53 focused PYP tests, lint, typecheck, changed-file formatting, and
`git diff --check` passed. A local replay of both complete 500-record captures
transformed all 1,000 vehicles and retained all 980 published positions.
CI runs the test shards and browser tests.
