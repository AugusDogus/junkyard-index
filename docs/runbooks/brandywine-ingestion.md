# Brandywine ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Status: registered and enabled unless its pause flag serves false. Shared source maps, durable cursor
routing, dispatcher and the 602 minimum are wired. The
`ingestion-source-brandywine` flag pauses the source when it serves false. Implementation and
verification used saved evidence only; they performed no source HTTP,
enablement, production publication or production reconciliation.

## Source contract

Only the native **Brandywine** table binds the supported yard:

- Brandywine U-Pull-It, 14000 Crain Hwy, Brandywine, MD 20613.
- Native root phone: 301-242-9494, published in the Brandywine Auto Parts block.
- Business point: 38.69678, -76.86962, independently bound to the U-Pull-It business.
- The native root states that U-Pull-It shares its headquarters/full-service lot.
- Fort Washington is the separate Savemore yard. Its tables are retained to find
  contradictory stock ownership. Its donors and yard are never emitted.

Required fields are native VIN or supported older serial, full native year,
manufacturer/model lineage, exact stock, verified detail destination and yard
binding. Manufacturer menus supply the make; the VIN never supplies YMM.
Native catalog stock and the exact stockno destination establish stock identity.
An absent or blank optional detail stock field retains that verified catalog
stockNumber; an explicit contradictory stock field rejects the donor.
Optional color, position, inventory date, photos and mechanical metadata may be
null. `FOR-11` is retained as a position, without inferring another yard.
`EOL-LOT` is retained without inferring removal.

Every VIN, destination, YMM, yard and activity conflict is reconciled before an
inactive exclusion. Only exact donor-bound `CRUSHED` and `SOLD` values in
`Row in Yard:` exclude an otherwise valid, conflict-free donor. These exclusions
remove their identities from presence and can permit retirement. Rejected donors
retain every genuine valid identity as presence, without emitting vehicle fields.
`YARD CAR`, `CHECK`, `DOESNOTEXIST` and new unresolved status/removal cues remain
rejects. Ordinary position variants such as `ROW-7` do not gate donors. Invalid,
absent or literal unknown optional positions become null. Placeholder makes and
the unresolved native `AUSTIN/MG/TRIUMPH` lineage reject. Invalid optional color
values, including numeric values, become null.

The source minimum is 602 unique eligible vehicles. The shared 10% rejection,
25% duplicate and 50% prior accepted-count drift limits remain unchanged.
Inactive exclusions are subtracted from the active denominator. Each donor
contributes exactly one eligible occurrence, duplicate, reject or exclusion.

## Native traversal

The exact saved published seed controls are:

1. `https://www.brandywineupullit.com/`
2. `https://www.brandywineupullit.com/veh_manufacturers/`
3. Every literal manufacturer link to `/veh_model_list?modelinput=...`.
4. Every literal model link to `/veh_model_breakdown?vehiclename=...`.
5. `https://www.brandywineupullit.com/incoming-vehicles/`
6. `https://www.brandywineupullit.com/veh_new/`

The detail queue is the complete Brandywine current/fresh stock union. Every
detail URL must be the literal `/veh_single?stockno=...` destination published
for that stock. Incoming-only stocks are outside active inventory. An incoming
claim on an active stock is a conflict. A fresh-only stock requires unambiguous
native manufacturer/model lineage.

All opening controls, including both yards and incoming/fresh membership, are
read again after every donor is classified. Closing required membership must
match opening membership. Optional inventory-date changes do not alter required
membership. This proves a stable observed graph, not an atomic provider snapshot.

Native HTML omits `</a>` in stock cells and before manufacturer `</h6>` labels.
The parser accepts those two inspected, cell-local grammars. Other malformed
tables, unread rows, changed yard headings and unknown continuations fail closed.

The anonymous client uses GET with no cookies or authentication. It accepts
HTTP 200 HTML or one exact HTTP 301 adding a trailing slash to the same native
path while preserving the literal query. It never follows a different stock,
query, host, status or additional hop. Native 301 responses have empty bodies;
their zero-byte receipts are retained. Response cookies are ignored and never
stored or sent. Challenges, partial bodies and content ranges fail. There are no
automatic retries.

## Durable execution and bounds

`streamBrandywineInventoryWithRequestGate` processes one through three logical
controls per chunk. Each logical control uses at most two physical GETs. The
live wrapper waits 1.6 seconds after each physical response body completes and
at each chunk boundary. This is more conservative than the qualification
collector's two-wires-per-second limit. The gate covers headers and the complete
body, including the empty redirect response. Callers must serialize chunks for
a given source run.

The cursor retains opening claims, detail fields and body/transport receipts,
closing claims, the authoritative previous accepted count, scope and checksum.
The static `ready` cursor has `startedAt: null`; its clock starts immediately
before the first logical control. Module warm time never ages a new crawl.
Every running or complete state requires a pinned numeric start time.
It validates exact native URL lineage, donor ordering, complete phase prefixes,
all closing membership and terminal quality. Checksums detect corruption; they
do not authenticate malicious replacement of native evidence.

No vehicles, yards or presence identities are emitted until an explicit validated
`complete` cursor exists. A complete cursor re-entry performs no requests and
emits no duplicate batch. Failures reject the chunk and preserve the last
validated checkpoint and prior inventory. A failed control requires inspection
before resumption. Exhausted whole-run capacity requires a fresh full traversal.

Bounds, based on the saved 46-maker, 414-model, 2,027-stock graph:

| Resource                                               | Bound                  |
| ------------------------------------------------------ | ---------------------- |
| Maker menu                                             | 64 manufacturers       |
| Complete model relation graph                          | 512 unique routes      |
| Brandywine donor union                                 | 3,000 stocks           |
| Listing claims across all scopes/yards                 | 12,000                 |
| Opening or closing controls                            | 580                    |
| Physical requests per whole run                        | 8,320                  |
| Combined redirect and final body per logical control   | 512 KiB                |
| Whole-run body bytes                                   | 160 MiB                |
| Serialized cursor                                      | 16 MiB                 |
| Logical control deadline, including gate/redirect/body | 25 seconds             |
| Active chunk / total live chunk deadline               | 90 seconds / 2 minutes |
| Whole run, including pauses                            | 48 hours               |

The largest original audited listing was 46,957 bytes; the largest original
audited detail was 31,590 bytes. The body/run-byte/per-control bounds preserve
the released native qualification limits. Growth beyond a cap fails instead of
truncating.

The crawl lifetime is a bounded allowance, not a production capacity claim.
At the largest admitted graph, 4,160 logical controls at their full 25-second
deadline (including both physical completion gaps), plus the worst 4,160
1.6-second chunk-start gaps, take 30 hours, 44 minutes and 16 seconds. The
48-hour lifetime leaves 17 hours, 15 minutes and 44 seconds for durable pauses.
A run with larger gaps or slow controls still fails safely. Virtual-clock tests
cover delayed first use, redirect/chunk pacing and the shared control deadline.

## Saved verification evidence

The complete frozen oracle contains 2,027 classified stocks:

| Outcome                             |                     Count |
| ----------------------------------- | ------------------------: |
| Eligible unique vehicles            |                     1,807 |
| Consistent duplicate extras         |                         0 |
| Required rejects                    |                        11 |
| Conflict-free inactive exclusions   | 209 (207 CRUSHED, 2 SOLD) |
| Active denominator                  |                     1,818 |
| Active/rejected presence identities |                     1,816 |

Initial seed evidence includes November 11, 2026 captures. The complete stock
opening/closing graph and original detail qualification were captured November 12. The final 58 details were captured November 13. This is an offline frozen
reference, with no newly refreshed membership or atomic availability claim.
The production previous accepted baseline remains unevaluated by this slice.

Independent packets under `.scratchpad/coverage/`:

- `parallel-mt-wy-nd/brandywine-saved-contract-audit20/`: original required-field,
  stock/yard, manufacturer-lineage and inactive-marker audit.
- `parallel-mt-wy-nd/brandywine-inactive-requalification21/`: final 58 native
  details, independent canonical candidates, dispositions, source accounting and
  AK81 review. `report.json` SHA-256:
  `e8385a306c604fefaed408fb20cf13425b93952c390c2af5de755ee7c3472fbe`.
- `parallel-al-ms-la/brandywine-physical271-review59/`: physical binding and alias
  screen. `report.json` SHA-256:
  `304b196c95fe0c538ac638d9f86ef6bffd18bd6ce205fac19523f11cfdda3e67`.

Committed gzip fixtures retain each complete native body and document title,
removing scripts, styles, comments and other head metadata. Original body paths,
sizes and hashes remain in provenance. Fixture transport receipts model the
exact observed redirect shape for those excerpts. The independent canonical
oracle and presence set retain their own source pins. Tests compare every
canonical vehicle field and all presence identities against that oracle.

`brandywine-test-fixtures/original-evidence-map.json.gz` separately maps all
2,955 opening/closing/detail observations to the exact original body path, byte
size, SHA-256, receipt and recorded wire chain. Early redirect body fields remain
null when their receipts did not capture them. This map supports original-body
offline replay without representing fixture excerpts as raw responses.

Run the local source checks without source HTTP:

```sh
bun test src/server/ingestion/brandywine-parser.test.ts src/server/ingestion/brandywine-snapshot.test.ts src/server/ingestion/brandywine-client.test.ts src/server/ingestion/brandywine-connector.test.ts
bunx oxlint src/server/ingestion/brandywine-*.ts
bunx oxfmt --check src/server/ingestion/brandywine-*.ts docs/runbooks/brandywine-ingestion.md
bun run typecheck
```

## Baseline validation and later live runs

Standalone new runs require an explicit authoritative `previousAcceptedCount`,
or explicit `null` after establishing that no accepted source baseline exists.
Resume from the persisted cursor, which pins that direct-call baseline. The
source-local connector performs no database lookup.

Registered durable ingestion starts with a static ready cursor whose local
baseline is null. This does not assert that a production baseline is absent.
Before allowing reconciliation, `validateDurableSourceRuns` independently
queries the latest accepted source run with a non-null `searchPublishedAt` and
applies the unchanged shared 50% drift guard to that authoritative count.

Root owns qualification and enablement. Later authorized live runs must complete
the entire native traversal and matching closing controls, validate the actual
prior baseline and pass all unchanged shared guards. Do not use the frozen
fixture as fresh membership evidence or publish its historical cursor.
