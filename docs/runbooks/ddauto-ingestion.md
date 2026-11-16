# DD Auto & Salvage ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Status on November 12, 2026: locally qualified for the Logan main parts yard.
The production connector replay emitted 67 unique donors from 68 explicitly
active main-yard rows. One invalid identity was rejected. Shared source
validation accepted this terminal snapshot. No production inventory was written.

## Physical owner and inventory scope

The official [self-service page](https://www.ddautoandsalvage.com/self-service-parts-yard)
identifies DD Auto & Salvage at 1976 West 200 North, Logan UT 84321,
phone 435-787-1204. It links the public
[DD Auto Parts Cars inventory](https://dd-auto-parts-cars.glide.page/dl/17171d)
and describes it as current and upcoming parts cars inventory.

The official Wix SEO context publishes the matching street address and
coordinates together: 41.7355957, -111.8810324. The source and location codes
are `ddauto` and `logan`. Each crawl verifies the official address, coordinates,
phone, inventory claim and Glide destination before accepting inventory.

The native status legend explicitly defines `Parts` as vehicles in the parts
yard that are available to buy parts from. Only that status is admitted.
`Premium Lot` is a separate lot viewed by appointment, so it is excluded from
the qualified main yard. `NOT AVAILABLE` and `Killed` are excluded. Unknown or
missing statuses on nonblank donor rows block the snapshot.

## Native transport and complete enumeration

The public Glide app is `Ws6yVYonyVyaoiyrIvyP`. Its native donor table is
`native-table-hCt5Yx92WXW37h62Gc99`, named `Parts List hotmail`.
The public browser consumes a native GCS baseline plus newer Firestore rows.
The saved GCS baseline contains older inventory and must not be used alone.

The connector performs five gated requests for one atomic catalog checkpoint:

1. Read the official physical-owner page.
2. Read Glide's public `getAppSnapshot` metadata and validate the exact native
   table, public access and required field/count-column bindings.
3. Read its source-published app snapshot and validate disabled authentication,
   the all-vehicle view/table binding and explicit availability legend.
4. Query current public Firestore documents from the exact browser-observed
   donor table using `runQuery`, ordered by native document name.
5. Recheck the public schema/publication signature to block contract drift.

The Firestore query requests 501 documents and accepts at most 500. Reaching
the extra row fails closed. Every result must have the same native `readTime`,
valid source document and row identities, strictly increasing document names
and unique row IDs/indexes. Deleted-state markers, partial responses, unknown
envelopes or missing native versions block the snapshot.

The native make directory independently publishes total, main-yard, Premium
Lot, combined-parts and unavailable/killed counts for every make and for
`Total`. All five counts must reconcile for every make and the complete donor
table. Wholly blank presentation rows are ignored. A partial donor row is
never treated as a blank presentation row. The currently inspected public view
has a 300-row limit, so more than 300 nonblank donors requires requalification.

The fresh native query at `2026-11-12T05:19:49.515828Z` returned 304 native
documents: 264 donor rows and 40 blank presentation documents. Every one of
the 2,376 displayed cells matches the separately saved 264-row browser table.
The browser shows 36 blank rows because its view limit omits four additional
blank native documents. No donor is omitted by that limit in this evidence.

## Field contract and quality

Admission requires a genuine modern VIN or supported older serial, a native
four-digit year from 1886 through 2100, and usable source make/model. The
existing `inventoryVin` contract applies. Source YMM is preserved, including
source-year discrepancies. No VIN-derived year, repaired VIN or guessed model
is substituted.

Color is optional. Valid published values survive normalization; absent or
unusable color becomes null. The native `FYX7j` binding must remain a public,
non-user-specific native string column labeled `Color`. Missing, renamed,
malformed or protected bindings yield null color without rejecting donors.
The inspected table publishes no genuine stock,
yard position or associated donor photo, so these fields remain null. Native
Glide row/document IDs are traversal identities, not stock numbers. Purchased
and estimated available dates are not actual set dates, so `availableDate` is
null. Make logos and Facebook links are not substituted for donor photos or
verified donor details. `detailsUrl` uses the verified all-vehicle inventory.

Duplicate valid active VINs/serials and active/inactive identity contradictions
block the full snapshot. Repeated inactive identities are excluded. A rejected
YMM with an independently valid identity supplies presence evidence only.
The saved invalid 15-character Nissan identity supplies no presence VIN.

The unchanged rejection limit is 10%, measured against active main-yard rows.
Excluded Premium Lot and unavailable/killed rows cannot dilute that denominator.
Shared validation uses a 22-vehicle source minimum and the existing duplicate,
count-drift and reconciliation guards. No partial table can reconcile inventory.

| Native status | Rows | Result                                       |
| ------------- | ---: | -------------------------------------------- |
| Parts         |   68 | 67 admitted, one required-identity rejection |
| Premium Lot   |   20 | Excluded, separate lot unresolved            |
| NOT AVAILABLE |  147 | Excluded                                     |
| Killed        |   29 | Excluded                                     |

## Checkpoints and recovery

The strict cursor has `start` and `complete` phases. The connector validates
the entire read before invoking callbacks and returning a terminal cursor.
A complete cursor performs no requests. Callback failure returns no advanced
checkpoint. A complete catalog reports one processed page.

Requests are gated at 1.6 seconds, with 20-second request/body limits and no
automatic retries. Only complete HTTP 200 responses from the verified endpoints
with the expected MIME are accepted. Redirects, partial ranges, invalid UTF-8,
body-length mismatches and bodies over 4 MiB fail closed. The catalog deadline
is three minutes. On failure, retain prior accepted inventory and inspect the
native source before restarting at `start`.

`scripts/soak-ddauto.ts` runs one full catalog through a caller-supplied
count-and-discard callback. It accepts the shared runner's optional positive
integer page budget, capped at 32 for the connector. Local qualification must
not write inventory to production.

## Saved verification

The current source and replay evidence is under
`.scratchpad/coverage/parallel-az-nm-nv/ddauto/evidence/`:

- `current-rows.json`: current native Firestore query, one consistent read time.
- `snapshot-links.json` and `published-app.jzon`: public field and status contracts.
- `native-browser-parity.json`: exact 264-row, 2,376-cell parity proof.
- `replay-report.json`: complete production connector replay, accounting and
  shared validation. It emitted 67 unique vehicles, rejected one and excluded
  196, with zero duplicates and zero live replay requests.
- `replay-vehicles.json` and `replay-cache-manifest.json`: canonical output and
  input byte counts/SHA-256 hashes.

The replay reuses the saved metadata body for its closing schema check; the
schema-drift failure path is verified separately in focused tests. Its durable
start/complete cursors round-trip through the shared cursor serializer. The
complete cursor is also replayed to verify idempotence.

The independent browser scope/status proof and official coordinate extraction
are under `.scratchpad/coverage/parallel-ut-co-ok/refill-20261112/evidence/`:
`dd-glide-table.json`, `dd-glide-review.json`,
`optional-policy-dd-review.json` and `optional-policy-dd-native-coordinates.json`.
Earlier mandatory-optional-field blockers in that lane are historical.

Focused tests cover required identity, legacy serials, optional nulls, physical
ownership, private or changed app contracts, native counts, read consistency,
query bounds, active duplicates, rejection denominator, callbacks and HTTP/body
boundaries. Scoped lint, formatting and typecheck results are recorded in
`implementation-validation.json` beside the replay evidence.
