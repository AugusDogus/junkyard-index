# Littleton U-Pull-It ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Status on November 12, 2026: locally qualified with 1,079 accepted unique
vehicles, 11 required-identity rejects and zero duplicates. Saved production
connector replays with query budgets 1, 16 and 32 produce identical canonical
output through the shared durable cursor codec. No production inventory was
written; the source runs unless its pause flag serves false.

Littleton is a single self-service yard at 8571 US Hwy. 85 N, Littleton CO
80125, phone 303-791-1380. The official root states that its entire inventory
is on stands and customers bring tools and pull their own parts. The official
[inventory page](https://littletonupullit.com/vehicle-inventory) describes current
used vehicle inventory updated daily and publishes the same physical provider.
Both pages embed `https://vinplus.texnrewards.com/parts/littleton`.

The source and yard codes are `littleton`. Coordinates 39.48691, -104.99796
come from the matching saved ASYD business pin, `/rows/122`, in
`.scratchpad/coverage/parallel-mn-ia-ne-sd/refill01/evidence/asyd-global-map-data.body`.
The official pages do not publish coordinates. This directory provenance must
remain explicit; the pin is not presented as native source metadata.

## Complete native traversal

The official page publishes one complete six-column table: Year, Make, Model,
Stock#, Vehicle Row and Date Set in Yard. The connector derives every exact
make/model pair from that complete table, then searches each pair using the
public browser's normal search protocol. It does not use blank searches,
wildcards, VIN lookups or the earlier generic group-discovery queries.

The API origin is
`https://inventory-search-api-581547763015.us-central1.run.app`.
Each search is `POST /searchVehicleHttp` with this exact body shape:

```json
{
  "yard_id": "littleton_u_pull_it",
  "year_min": null,
  "year_max": null,
  "make": "<exact official table make>",
  "model": "<exact official table model>",
  "language": "en",
  "location_id": null
}
```

Every response must echo the requested yard and exact criteria, report success,
and have `match_count` equal to the complete returned array. Every native stock
must join an official table stock at the same source year. Each pair's response
must include all stocks assigned to that exact official table pair, even if
some were already returned by a broader overlapping search. Missing stocks,
foreign stocks, duplicate stocks within one response, valid VIN conflicts and
conflicting repeated source records block the snapshot.

The connector revalidates four contexts at the start of every chunk:

1. The official root's physical owner, self-service claim and embedded app.
2. The complete official inventory table, collection/provider metadata and app.
3. `GET /api/yard-info/littleton`, proving the exact single-yard identity,
   disabled demo synthesis, enabled search, disabled photos and Denver timezone.
4. `GET /api/analytics/year-distribution?yard_id=littleton_u_pull_it`.

Every native year bucket and the total count must exactly reconcile with the
official table. A stable digest binds these contexts across durable chunks.
The terminal query repeats all four context reads before accepting completion.

The saved November 12 qualification has 1,090 unique source stocks across
289 exact official pairs. All stocks occur in their own exact pair search.
The 289 responses contain 1,384 hits, including 294 identical cross-query
coverage repeats. Native current count and all 40 year buckets reconcile with
the complete official table and native stock union.

## Field contract

Admission requires a source modern VIN or supported pre-1981 serial and usable
native year, make and model. The existing `inventoryVin` contract applies.
Malformed identity or required make/model rejects the donor, while an
independently valid rejected identity remains presence evidence.

Canonical YMM preserves the complete API tuple. The official table and API use
different make/model representations for 186 stocks. Stock/year joins prove
source identity, not semantic model equivalence. No hybrid tuple, guessed
model repair or VIN-derived year is substituted. Both native representations
remain in qualification evidence. `detailsUrl` uses the unfiltered official
inventory page because API model labels are not necessarily official filter
labels.

Color, position, source date and photo are optional. Missing or unusable values
become null without rejecting an otherwise valid donor. Photos remain null
because the source disables them. Native stock is required for traversal and
complete-enumeration joins, and its genuine value is also displayed as stock.
Source IDs and query indexes are never substituted for missing metadata.

Native `dateAdded` has no UTC offset. A valid timestamp contributes its
calendar date only, for example `2026-11-04`; no UTC instant is inferred. The
official table explicitly labels this field Date Set in Yard and its saved
dates match the API dates. API/table position or calendar-date disagreements
block the source when both values are usable. Missing optional values do not
break that required stock/year join.

## Checkpoints, accounting and recovery

The strict cursor has `start`, `queries` and `complete` phases. A query cursor
stores the context digest, next pair index, per-query receipts and cumulative
stock states with stable record fingerprints, valid identity/presence and first
query index. An integrity digest binds every resume-relevant field and is
validated before any reads. This checksum detects corruption in trusted
internal durable state; it does not authenticate an arbitrarily rewritten
cursor. The cursor validates unique native stocks and valid identities,
receipt accounting, sequential coverage and every prior own-query stock join.
Each chunk processes 1 through 32 queries, default 16. All chunk validation
finishes before callbacks; callback failure returns no advanced checkpoint.
A complete cursor performs no requests or callbacks.

The source retains the unchanged 10% cumulative required-field rejection cap,
50% prior-count drift limit and shared duplicate/reconciliation guards. The
source floor is 359 accepted unique vehicles. A paused or failed read cannot
reconcile inventory. The saved source contains 1,079 accepted identities,
including three supported old serials, and 11 malformed modern VIN rejects.

Cross-query coverage repeats are `recordsExcluded`, not duplicate vehicles.
Expected full-snapshot accounting is 1,384 processed, 294 excluded, 11 rejected
and 1,079 unique emitted. This gives 1,090 eligible source stocks and zero
duplicate vehicles under shared connector metrics. Overlapping hits cannot
dilute the rejection denominator.

All HTTP requests use the shared gate at 1.6 seconds, no automatic retries,
20-second request/body limits and a three-minute chunk deadline. Only complete
HTTP 200 responses from the exact endpoint with the correct MIME are accepted.
Redirects, partial ranges, length mismatches, invalid UTF-8 and bodies over
4 MiB fail closed. On failure, retain prior accepted inventory, inspect the
native source and resume only from the last validated checkpoint. A changed
context requires a new complete crawl rather than combining snapshots.

`scripts/soak-littleton.ts` is the count-and-discard driver. Its caller supplies
the connector and callbacks; it does not write inventory. Its total query
budget is 1 through 2,000. Production enablement remains a separate decision.

## Saved verification

Native query receipts and bodies are under
`.scratchpad/coverage/parallel-ut-co-ok/refill-20261112/evidence/`:
`littleton-native-all-receipts.json`, `littleton-year-distribution.body` and
`littleton-table-driven-contract-proof.json`. The receipt manifest records
every request body, saved body path, bytes and SHA-256.

Independent native stock/year/identity proof is under
`.scratchpad/coverage/parallel-pa-md-wv/littleton-review/`, including all
native model differences and exact own-query coverage. It verifies all 301
inputs and 292 declared response hashes without HTTP.

The implementation replay driver is
`.scratchpad/coverage/parallel-az-nm-nv/littleton/replay-littleton.ts`.
It rejects unsaved requests and round-trips each chunk through the actual
shared durable serializer/parser. Its evidence directory holds per-budget
replay reports, canonical vehicles, serialized cursor samples and input hashes.
The 1, 16 and 32 query budgets use 289, 19 and 10 chunks respectively, with
1,449, 369 and 333 cached calls and zero live calls. Their canonical SHA-256
is `c0a55b7d07bf7e1ccae385681ae630ad7dfd0813425982aa5215cb9d8e454614`.
Opening and closing contexts reuse saved bodies; focused tests independently
exercise scope drift and callback failure.
