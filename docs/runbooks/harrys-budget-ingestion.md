# Harry's U-Pull It and Budget U Pull It ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Sources `harrys` and `budget` run unless their pause flags serve false. Their flags are
`ingestion-source-harrys` and `ingestion-source-budget`. Qualification is read-only:
no production persistence, search publication, alerts, deployment or enablement.
No credentials or schema migration are required.

## Required fields and safeguards

Both sources require the native year, make, model and physical yard, plus a
full VIN accepted by `inventoryVinWithCheckDigit` or a genuine pre-1981 serial.
Repeated-character placeholder serials are rejected. Optional color, stock,
photos, inventory date and yard position remain nullable. Missing optional
fields do not reject a donor. No identity, year or location is inferred from VINs.
Harry's uses 1901 as an unknown-year placeholder. All 18 such fixture rows are
rejected, including modern VINs and old Packard, Plymouth and Chevy serials.
Serial text such as `1940PACKARD` does not establish a model year. Valid rejected
identities with a known yard remain presence evidence.

Required-field failures count as rejections, never exclusions. Independently
valid rejected VINs retain presence evidence only when yard attribution is
usable. Conflicting required claims for a VIN reject every conflicting row.
Budget also rejects contradictory claims for the same published stock.
Source admission requires at most 10% rejected and 25% duplicate rows. The
source floors are 1,368 for Harry's and 535 for Budget, roughly one third of
the accepted census. Durable reconciliation
repeats those checks and requires at least 50% of the preceding accepted source
count. Harry's yard floors are 178 for Allentown, 909 for Hazle Township and
281 for Pennsburg, roughly one third of each accepted census, with at most 10%
rejected rows. Final durable validation repeats yard floors after deduplication
and checks each yard against 50% of its persisted, non-missing inventory.

Neither connector emits vehicles or yards until every opening and closing
control passes. Failure preserves previously published inventory and returns
no advanced checkpoint. Restart after confirmed inventory, directory or
ownership drift. Never force completion or weaken admission floors.

## Harry's native inventory

The official [inventory](https://wegotused.com/our-inventory/) is rendered by the
WordPress `inventory-7lt` plugin. Angular's native model/year/parts requests
populate selectors, not a bulk vehicle API. Its search action loads the same
server-rendered `#_results` table. Tested `inv[per_page]`, `inv[limit]`,
`inv[page_size]`, `inv[items_per_page]`, `inv[perpage]`, top-level `limit`,
`per_page` and `posts_per_page` parameters all retained the native 15-row size.
No cheaper complete route was established. Per-yard queries would still
require the sum of each yard's pages and add rounding and ownership controls.

Use the native all-yard, zero-based page sequence with every empty filter and
both native sort settings retained. Every page must publish the expected
`Showing ... records` range, the same total, exactly the corresponding rows,
the qualified three-yard selector and the correct owned previous/next links.
Traversal follows the complete native count, never a short-page heuristic.
Every donor has a native `item-<id>` traversal identity, unique across the full
census. A second, separately fetched complete census must agree on every page,
row, field, order and multiplicity. Ownership closes with the official contact
page after both traversals. The cursor retains the opening records and checked
closing prefix. It contains no raw HTML or cookie.

A fresh process can receive Sucuri's HTTP307 JavaScript cookie challenge.
`harrysChallengeCookie` decodes base64 as data and accepts only the qualified
literal-concatenation grammar, printable `String.fromCharCode` terms, matching
assignment variable, exact cookie attributes and expected cookie name/value
shape. It never evaluates remote JavaScript. Unexpected grammar fails with a
named recovery error. One paced cookie retry is allowed per native request.
The public cookie lasts at most its advertised day, remains process-local and
uses the same fixed `Mozilla/5.0` User-Agent on the challenge and retry.
Repeated challenges fail closed; arbitrary redirects are not followed.

The official [contact page](https://wegotused.com/contact/) establishes each
inventory city and address. Saved US Census exact-address receipts supply
address-range coordinates, not the embedded maps' viewport centers.

| Inventory city | Native yard code | Address                                      | Coordinates                       |
| -------------- | ---------------- | -------------------------------------------- | --------------------------------- |
| ALLENTOWN      | `allentown`      | 1510 East Jonathan Street, Allentown PA      | 40.631513622519, -75.434136996739 |
| HAZLE TOWNSHIP | `hazle-township` | 1010 Winters Avenue, Hazle Township PA 18202 | 40.95642495259, -76.011302055883  |
| PENNSBURG      | `pennsburg`      | 2557 Geryville Pike, Pennsburg PA 18073      | 40.381185778706, -75.46222132057  |

The contact page also mentions Plains. The native inventory selector lists
only the three qualified cities. Plains is not assigned another yard's
inventory or counted as a qualified inventory yard. Unknown row cities reject;
a changed selector requires requalification.

Native `item-<id>` detail links use dense import row numbers that can be
reassigned to different vehicles or yards when the feed reloads. The saved
`item-298` control agrees with its table row only at acquisition time and does
not establish a stable vehicle destination. No stable VIN/stock URL is verified
in the saved pages. Canonical `detailsUrl` is null. Search and alerts, including
stored row-ID links, use **Search provider inventory** at the official inventory
page and explain how to select make/model/yard and match VIN and yard row.
The list supplies no verified vehicle photos or stock number, so those remain
null. Manufacturer is not silently repurposed as engine/trim.

Requests are serial with a 3.5-second completion gap, a combined 25-second
request/body deadline and a 2 MiB HTML limit (16 KiB for challenges). There are
at most 500 native pages per pass, two owner controls and one challenge retry
per native request: at most 1,002 native GETs and 2,004 HTTP attempts. A chunk
allows eight native GETs, stops starting new ones after two minutes and has a
five-minute outer deadline. Each cursor is capped at 8 MiB. A normal 4,283-row
run needs 286 pages twice plus two owner controls: 574 native GETs, usually
575 HTTP attempts with a fresh cookie. Additional cold-process challenges are
bounded separately. The daily run takes roughly 37 minutes at the qualified
pace, including response time, without requests for individual donor details.

## Budget native inventory

The official [current inventory](https://budgetupullit.com/current-inventory/)
contains one complete server-rendered table per selected make. Each donor has
its own `tbody`; DataTables is a client-side dependency, not a native HTTP
page contract. There is no supported wildcard make or proven JSON vehicle API.
Missing/empty make returns an empty table and the complete directory.

Enumerate every literal value of `#makeSelect`, with `model=` empty. Reconcile
the make values and labels against the separately published `modelMap` JSON
keys on every response. Every observed make/model must belong to its requested
partition and the map. At completion, every published model must have recurred
in its make's rows, including rows rejected for unusable VINs. Reject an
unexpectedly empty make, changed directory/update marker, malformed table,
unknown continuation or incomplete document. Re-fetch the directory and every
make as a closing census; require identical donor fields, ordering and counts.
An absent make in either directory representation or a lost model fails closed.
No completeness claim depends on a hardcoded historic make list.

Qualification found an ordinary cached Ford URL with an older update date and
inventory. Requests therefore use `Mozilla/5.0`, `Cache-Control: no-cache` and
an ignored unique `ji_census` query value. Checkpoints and outbound destinations
retain the stable native make query, without this transport-only cache key.
Python's default User-Agent received HTTP403 on the unfiltered URL; the fixed
provider User-Agent and cache handling returned the current native documents.
No source was dropped because of that request filter.

Every row belongs to the single published yard: Budget U Pull It, 881 South 9th
Street, Winter Garden FL 34787, phone 407-656-4707. The inventory page publishes
this address and the map marker 28.553931, -81.574973. Ownership is checked on
every response. Stock, row and yard date are preserved when usable; photos and
color remain null. Outbound destinations preserve the native make filter and
use **Search provider inventory**, instructing the user to match VIN, stock and
row. There is no fabricated vehicle permalink.

Requests are serial with a 3.5-second completion gap, combined 20-second
request/body deadline and 4 MiB body cap. Redirects, partial responses, HTTP
pagination and unexpected MIME types fail closed. There are no automatic
network retries. A chunk allows eight native GETs and four minutes. At most
100 makes yield 202 native GETs for opening and closing directories and makes.
Each cursor is capped at 8 MiB. The qualified 38-make run uses 78 HTTP requests.

## November 16, 2026 qualification

Budget's separately acquired 78-response opening and closing replay accepts
1,606 unique donors, rejects 13 of 1,619 rows (0.80%), excludes none and has no
duplicates. All 38 native makes and every native model reconcile. Its update
marker is November 16. Required-identity rejection includes the known malformed
Chevrolet VINs; no VIN was repaired or decoded. The maximum serialized cursor
was 356,923 bytes. This adds one qualified Florida yard; it does not
change the count of published yards.

Harry's 4,283 native rows accept 4,105 unique donors, reject 177 (4.13%),
exclude none and merge one benign duplicate. The 286-page opening and separately
acquired 286-page closing census agree on every parsed donor field, native ID,
order, multiplicity and total. Both ownership controls pass. The newest published
yard date is November 12. The serialized checkpoint stays below 750,000 bytes.

| Physical yard  | Native rows | Accepted | Rejected | Duplicates |
| -------------- | ----------: | -------: | -------: | ---------: |
| Allentown      |         556 |      535 |       20 |          1 |
| Hazle Township |       2,863 |    2,727 |      136 |          0 |
| Pennsburg      |         864 |      843 |       21 |          0 |

Both providers satisfy their source floors, rejection and duplicate guards.
No eligible inventory was excluded to improve those ratios. Modern VINs were
validated as published, never repaired. Harry's adds three qualified
Pennsylvania yards; Budget adds the tenth qualified Florida provider on this
stack. Neither changes published inventory until separately approved rollout.

The saved acquisition ledger contains 656 HTTP responses: 575 Harry's responses
(including both detail-link redirect controls), 78 Budget responses and three
Census geocodes. Initial qualification separately used ten Harry's requests
(including opening ownership) and seven Budget requests. One interrupted
acquisition may have issued an additional unlogged in-flight GET, so these are
saved-response counts rather than an exhaustive wire-attempt total. Daily-run
counts remain 574 native Harry's GETs plus bounded challenges, and 78 Budget
GETs. `harrys-test-fixtures/qualification-requests.json.br` retains the ledger;
each native fixture also records its own acquisition receipt.

Fixtures retain separately acquired raw opening and closing responses and
verify SHA-256 receipts before replay. Tests inject a fixture reader that fails
on unexpected requests. They never fall through to the network. Transport
tests replace fetch entirely. Geocoding and challenge controls are saved too.

```sh
bun run soak:sources -- --sources=harrys,budget --cycles=1
bun run lint
bun run typecheck
bun test --timeout 15000 src
```

The soak serializes every checkpoint and discards vehicles. It does not publish
or modify production. `--max-pages` bounds native requests and returns paused
for an incomplete census; it excludes Sucuri challenge overhead.
