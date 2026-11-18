# Vander Haag's donor ingestion

The enabled `vanderhaags` source reads the native `Parts Unit: Truck` catalog.
Full-service heavy-truck donors meet the existing admission policy. Every
published truck belongs to one physical yard, established by its catalog card,
detail location link and single-unit quantity table.

## Qualification, November 17-18, 2026

The [native catalog](https://www.vanderhaags.com/New-Salvage.php?inventorytype=parts-unit&order=new-salvage&items=500)
contains five pages and 2,116 unique donor IDs across seven yards. The native
search parameters have no yard filter and select active truck parts units.
Its advertised inventory-date window is November 18, 2025 through
November 11, 2026. This is the site's finite new-salvage catalog, not a claim to
enumerate older inventory outside that window.

| Physical yard                 | State | Catalog donors | Floor |
| ----------------------------- | ----- | -------------: | ----: |
| Sioux Falls                   | SD    |            287 |    95 |
| Spencer                       | IA    |            140 |    46 |
| Des Moines                    | IA    |            231 |    77 |
| Council Bluffs                | IA    |            340 |   113 |
| Kansas City                   | MO    |            284 |    94 |
| Winamac                       | IN    |            534 |   178 |
| London (marketed as Columbus) | OH    |            300 |   100 |

The complete detail audit accepts 1,995 donors and quarantines 121 (5.72%),
with zero repeated VINs. Every yard remains below the 10% rejection ceiling.

The source floor is 703, the sum of the physical-yard floors. IA, IN, MO and OH
add four state credits to #186; SD retains its existing credit. Multiple Iowa
yards still contribute one state credit.

The [official locations map](https://www.vanderhaags.com/map.php) establishes
addresses, phones and coordinates. Its Columbus location is physically in
London, OH. The explicit alias binds catalog `London, OH` to detail
`store=Columbus`; it does not geocode trucks to central Columbus.

Indianapolis, Louisville (KY), Dallas (TX), St Louis and Stephenville (TX) have
no attributed donor cards in this complete catalog. Their retail/component
inventory and chain-wide access to other yards' parts do not qualify them.
KY and TX are not admitted. TX would add no credit because it is already at 10.
No undiscovered location parameter or older-inventory completeness is claimed.

Modern VINs must pass ISO 3779 check digits. Existing pre-1981 serial handling
is preserved, including Sioux Falls' 1978 Ottawa YT, stock `78MI012`, serial
`51564`. Every accepted donor has native year, make, model, stock, yard and a
`/detailview.php?part=<id>` destination. Make/model is never inferred from a
VIN or repaired to reconcile conflicting native descriptions.

Each yard has a stock-matched native donor video published within 60 days:
Spencer on October 12, Des Moines and Council Bluffs on November 9, Winamac,
Kansas City and Sioux Falls on November 10, and London on November 9. The
[qualification receipt](vanderhaags-qualification.json) records the donor,
stock, destination, video and publication timestamp. Video publication proves
recent inventory activity, not an arrival date; `availableDate` stays null.

The first 2,112-donor opening census crossed the native UTC date rollover.
Its closing census had 12 additions and eight removals, for 2,116 donors.
Qualification refreshed those details and required another complete matching
opening and closing census.

## Incremental detail reads

A completed cursor retains each detail path's catalog identity hash, validated
VIN/description specifications, availability and successful read time. Only the
five fields used by the canonical vehicle are cached. Stock, title and physical
yard remain bound to the fresh catalog identity. Images come from today's card.

The durable adapter seeds this cache only from a successful, accepted,
search-published run. Failed, rejected and unpublished runs cannot seed carry.
Missing history starts a cold census. Corrupt, incompatible or pre-incremental
history starts cold with a warning. Corrupt active checkpoints fail instead of
restarting over already emitted batches. The cache has a contract version, qualification scope,
checksum and an 8 MiB cursor ceiling; it needs no additional Blob lifecycle.

Every run enumerates the entire catalog. New paths and changed title, stock or
yard identities fetch details immediately. Unchanged identities carry their
validated details. Removed catalog paths disappear from both the emitted
snapshot and the next cache, so normal removal reconciliation still applies.
Rejected listings retain only usable VIN presence evidence.

A six-way UTC-day ordinal sweep re-reads roughly one sixth of known details per
daily run. Evidence at or above six days must be fetched independently of its
slice, including after missed runs or catalog reorderings. Carries never reset
the successful read time. One fixed run-start clock dates all reads and carry
decisions. Active runs expire before one day, reserving the remaining day below
the seven-day evidence ceiling. Request failures do not refresh or defer stale
detail evidence.

## Transport and request budget

Plain HTTP encounters AWS WAF 202. A normal Hyperbrowser browser navigation
loads its JavaScript cookie, using stealth, accepted cookies and `us-west`.
CAPTCHA solving is explicitly disabled. A 403 or 429 stops the session's host
requests. The first rendered catalog is reused; later documents use same-origin
browser fetch. Requests are serial with a 1.6-second gap.

Each checkpoint permits 12 detail requests by default (maximum 24), plus a fresh
five-page national catalog enumeration, within four minutes. Carried records do
not spend the detail budget. The final checkpoint rereads the five catalog
pages as a closing fence.

At the qualified 2,116-donor census, the default budgets are:

| Run                                  | Detail reads | Opening catalog reads | Closing reads | Total inventory documents |
| ------------------------------------ | -----------: | --------------------: | ------------: | ------------------------: |
| Cold or six-day backlog              |        2,116 | 885 (177 checkpoints) |             5 |                     3,006 |
| Typical daily, unchanged identities  |      352-353 |  150 (30 checkpoints) |             5 |                   507-508 |
| Unchanged repeat on the same UTC day |            0 |    5 (one checkpoint) |             5 |                        10 |

New or changed listings, shifted slices and age-bound catch-up can add reads.
For `d` detail requests at this census, the total is
`d + 5 * max(1, ceil(d / 12)) + 5`. Browser assets, session setup and challenge
traffic are additional. For comparison, the original Sioux Falls-only cold run
needed 412 documents; its daily sweep now needs about 72-73.

The observed UTC rollover's 12 additions and eight removals project to 363
detail reads with a warm cache, plus 155 opening and five closing catalog
reads: 523 inventory documents. This uses the captured identity changes and
the production carry decision, rather than a second live census.

Qualification captures and offline replay are separate from a second full live
production-checkpoint run. Saved-response tests exercise all checkpoint and
closing-census logic, including cursor serialization between checkpoints.

## Reconciliation safeguards

Every page must match native record counts, selected donor scope, current page
and expected page length. All national donor IDs must be unique. Each admitted
yard must meet its census floor and have unique stock identities. Closing
identities, title, stock and yard must match the opening census.

Detail inventory ID and stock must agree with the requested card. Conflicting
physical yards, multiple quantities, repeated VINs, invalid cursors, incomplete
documents and closing drift stop completion. Native empty quantity tables or
explicit zero quantities are individual rejects and never publish as available
trucks. Unknown or conflicting required descriptions and invalid VINs are also
quarantined. Usable rejected VINs supply presence evidence without guessed
vehicle descriptions.

Both the whole source and each yard enforce the 10% rejection ceiling. Shared
validation checks accepted physical-yard floors and the 50% previous-run drift
guard per yard, as well as the source-wide floor and drift guard. Earlier valid
batches cannot authorize removal after any later failure. Failures preserve
previous inventory.

Native specifications legally omit a Price row's closing `tr` tag. Complete
cells and their enclosing table remain required. Western Star's headline can
truncate `4900EX` to `4900E`; catalog title and specifications must agree on
`4900EX`, with native ID, stock and yard still bound.

## Verification and operation

Fixtures preserve minimized native catalog/detail markup. Tests cover cold
reads, new/changed/removed listings, carry, rolling verification, the independent
age bound, cache corruption, unavailable quantity evidence, duplicate VINs
across fresh and carried records, complete enumeration, floors, cumulative
rejects, closing fences and published-history selection.

Lint, typecheck and formatting of changed text files pass. The 337 focused
tests across 12 files pass, including the full captured census, both daily
sweep sizes, durable cursor round trips and the ingestion orchestrators.

This command is a live diagnostic, not an offline test:

```sh
bun run soak:sources -- --sources=vanderhaags --cycles=1 --max-pages=12
```

`--max-pages` counts detail requests for this source. Every checkpoint also
reads the national catalog. The diagnostic starts cold unless its caller
supplies accepted history. Missing pause flags leave the provider enabled;
`ingestion-source-vanderhaags=false` pauses it. No production flag, database,
deployment or merge is changed during qualification.
