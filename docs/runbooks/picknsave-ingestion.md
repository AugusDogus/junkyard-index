# Pick-n-Save Virginia qualification

Status on November 11, 2026: implemented locally, qualification incomplete.
The source defaults to disabled, including when flag evaluation fails. Enable
`ingestion-source-picknsave` only after a complete live catalog passes the source
guards and a fresh overlap sample is recorded. No production ingestion or search
publication has been performed.

## Verified locations

| Yard                                            | Official address                    | Phone        | Coordinates             |
| ----------------------------------------------- | ----------------------------------- | ------------ | ----------------------- |
| [Lynchburg](https://pick-n-save.net/lynchburg/) | 10786 Wards Road, Rustburg VA 24588 | 434-338-6700 | 37.277841, -79.1706823  |
| [Roanoke](https://pick-n-save.net/roanoke/)     | 3002 Sleepy Ln NE, Roanoke VA 24012 | 800-227-7315 | 37.2994744, -79.8985253 |

Coordinates come from the Google business pins linked by the official location
pages: [Lynchburg](https://maps.app.goo.gl/97ZkBomyWLUfVfZG6) and
[Roanoke](https://maps.app.goo.gl/k1cW1aHnExtXTGys7). Neither address matches
Virginia's currently published Foss Chesapeake and Pick-n-Pull Virginia Beach
yards. This supports two candidate locations, not two published additions or
catalog-wide exclusivity.

## Inventory and data quality

The public WordPress endpoint is `https://pick-n-save.net/wp-json/wp/v2/product`.
Fetch 25 products per page with `orderby=id&order=asc&status=publish`. Require
native `X-WP-Total` and `X-WP-TotalPages` headers, exact page lengths, stable
product totals, and strictly increasing product IDs. The catalog advertises
1,692 products, not a validated count of available, complete vehicles.

Each accepted donor requires VIN or supported older serial, year, make, model,
verified yard and active availability. Color, stock, row, photos and product
inventory date are optional under the user-confirmed existing-provider contract.
Missing or invalid optional metadata becomes null. Only real calendar dates at
the observed midnight format are retained. Retained donor photos must match both
product ID and the stock-specific S3 image directory. Without a usable stock,
the photo is null. The site's Open Graph logo is not used.

The observed HTML fixture keeps its native layout and is excluded from
formatting. Parser regression tests mutate that source markup directly.

Records missing required identity fields are rejected. A usable VIN
can provide presence evidence for an existing record. Explicit out-of-stock
products provide neither listings nor presence protection. Availability uses
the provider's `instock` / `outofstock` state. Paperwork notes are not interpreted
as evidence that a vehicle is physically gone.

Engine, trim, transmission, section, space, parts/pricing links, and yard email
remain nullable under the existing canonical contract when unpublished. Both
verified yards must have complete vehicles before a terminal checkpoint.

## Bounded operation

Production checkpoints process two catalog pages, fetching details serially
behind a 1.1-second request gate. The hard chunk timeout is four minutes.
Requests time out after 20 seconds, with two bounded retries for retryable HTTP
statuses/timeouts. HTTP 403 fails immediately. Failed chunks return no advanced
checkpoint. Resume the last durable checkpoint after resolving the failure.

The full read-only soak runs those same two-page checkpoints repeatedly:

```sh
bun run soak:sources -- --sources=picknsave --max-pages=1
bun run soak:sources -- --sources=picknsave --cycles=1
```

Batches are counted and discarded. This does not exercise production persistence,
search publication, reconciliation, or alert delivery. Snapshot acceptance also
requires at least 1,000 unique vehicles, at most 10% rejected vehicles, at most
25% duplicates, and the existing previous-run drift guard. Do not weaken these
guards to make qualification pass.

## Live evidence, November 11, 2026

- Initial one-page check: 25 products, 24 complete listings, one rejected,
  26 requests, 27.963 seconds, zero rate limits or network errors.
- First full attempt: two pages yielded 47 complete listings, three rejected,
  and both yards (21 Lynchburg, 26 Roanoke). Product 5595 stopped the next
  checkpoint because the source omitted its entire Make heading. Its public
  title is `2025 UNKNOWN`, with an invalid modern VIN `2R27S105606`. The parser
  now rejects suppressed descriptive headings as incomplete records while
  retaining identity/template checks. No year or make is inferred.
- Second full attempt: 24 complete listings in one page before vehicle 5312
  returned HTTP 403. It stopped after 30 requests and 32 seconds, without
  retrying the denied response. Full completeness, rejection ratio, global
  duplicates and final yard totals remain unverified. No terminal checkpoint
  was obtained.
- A later single-request reachability canary against the connector's exact
  first-page catalog URL also returned HTTP 403. No detail request or retry
  followed. Receipt: `.scratchpad/coverage/pns-reachability-canary.json`.
- A further single standard first-page request at 17:57 UTC returned HTTP 403
  in 0.546 seconds, with no pagination headers. No details, retries or alternate
  routes followed. Receipt:
  `.scratchpad/coverage/pns-reachability-retest-nov11.json`.
- A single first-page reachability check at 23:41 UTC also returned HTTP 403,
  without pagination headers, in 0.588 seconds. No detail requests, retries or
  alternate routes followed. Receipt:
  `.scratchpad/coverage/pns-reachability-retest-nov11-late.json`.

The optional-field parser and terminal connector regression suite passes 32
tests, including an active donor with all five optional fields null. This does
not resolve the historical HTTP 403 or qualify either yard. Do not retry the
denied public route without a changed access condition.

Next after restored access: complete the crawl, audit remaining template variants, sample VIN overlap
across both yards and the catalog with active Row52 and AutoRecycler positive
controls, then review publication readiness. The September 0/10 overlap sample
is historical and insufficient for this step.
