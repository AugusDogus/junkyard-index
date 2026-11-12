# Nevada Pic-A-Part ingestion

Source: `nvpap`. North Las Vegas (`1074`) and Henderson (`1075`) remain
disabled through `ingestion-source-nvpap` pending rollout. They are separate
physical yards from published Pick-n-Pull Carson City and Sparks. Neither
candidate is counted as published.

The user has directed local-only work. Do not push, open or merge a PR, deploy,
or enable either Nevada yard without new authorization.

## Enumeration contract

The official [vehicle availability page](https://nvpap.com/part-interchange.html)
POSTs URL-encoded `makes=0`, `models=0`, `years=<year>`, `beginDate=` and
`store=<1074|1075>` to `/wp-json/pt1/v1/vehicle-stock`. Zero means any.
Responses contain six decimal digits, a newline, exactly that many HTML
characters, then JSON `search_results`. HTML and JSON must agree on row count,
year, VIN, make/model, physical store and stock identity.

Broad results cap at 200 and publish no independent total or next-page token.
The native model directory is incomplete: live inventory includes names such
as `FORD E250 VAN`, `FORD F150 RAPTOR` and `CHEVROLET 10 VAN` that are absent
from its model lookup, as well as year 2026 beyond its directory's year range.
The earlier 361-query make/model crawl found 3,299 records but failed to recover
18 known records. Do not reuse that strategy or guess model aliases.

Enumerate every canonical year, 1886 through 2100, separately for each store.
Fail if a year reaches the 200-row cap. At each yard's start, retain the broad
result's stock/VIN identities as positive controls. Every control must recur in
the year union before that yard can finish. Controls include incomplete donors,
so rejecting their fields does not excuse losing them during enumeration.

A full crawl uses 432 native queries: one broad query and 215 years per yard.
Normal checkpoints contain at most 16 native queries and refresh official yard
contact metadata. Queries are gated at 1.6 seconds. Requests time out after 20
seconds, with at most two retries for retryable statuses/timeouts. HTTP 403 fails
immediately. A checkpoint has a three-minute outer timeout. A failed checkpoint
returns no advanced cursor. Empty years require the native explicit empty-state
markup, not an absent table or empty response.

## Field quality and yard identity

Listings require a validated VIN or genuine pre-1981 serial, year, make, known
model and verified physical yard identity. Color, display stock, photo, set-date
and yard position are optional. Preserve valid published values; absent or
unusable optional values become null without rejecting the donor. Unknown or
burnt colors, invalid dates/positions and placeholder or untrusted images do
not become fabricated replacements. Unknown models and invalid VINs still reject.

Photo URLs must match the trusted origin and the donor's native stock under
`/photos/preview_photos/`. Preserve valid source calendar dates at UTC midnight;
they do not establish acquisition timestamps. Native stock remains required
and yard-prefixed in the HTML/JSON protocol because it identifies broad-query
controls and year-partition parity. Nullable display stock does not permit a
missing, duplicated or contradictory traversal identity. Optional engine, trim,
transmission, section, space and parts/pricing links remain null.

Required-identity rejects only provide independently valid VIN presence evidence.
Each yard must finish with available listings and at most 10% rejection. Counters
and unmatched broad controls survive checkpoint resumes. Existing shared
duplicate, rejection and prior-run drift safeguards apply, with a minimum of
2,500 complete vehicles for the two-yard source.

Native `?p=<base64 JSON>` links restore the yard's vehicle-stock search with
any manufacturer/model/year. Payload:
`[store,1,"-2",-1,-1,-1]`. The string `"-2"` is the native all-dates choice.
Preserve raw base64 padding: the source uses `atob` on the URL substring and
does not percent-decode it. Browser QA found that these links restore the yard's
form but display no vehicles: `c1RenderInStockVehiclesByType` returns early when
year and model are unset and no begin-date is present. The shared
`VehicleDestination` helper therefore uses **Search provider inventory** with
make/model, VIN and yard matching instructions on cards, emails and Discord.
The action opens the verified search entry point, consistent with existing
manual-search providers. No result list or individual donor link is promised.
Do not combine any manufacturer/model with a specific year in these links:
the site's `c1selectYear` can switch into parts mode and access a nonexistent
make/model directory entry. The supported all-year payload follows the site's
`c1BuildUrlQueryString` and `c1LoadHistoryItem` code. Executing the published
loader and selector methods with UI methods stubbed restored both yard IDs,
vehicle-stock mode and an empty begin-date, but omitted the rendering guard.
Interactive QA also proved that a published Lincoln / `& TOWN CAR` model link
loads actual donor rows. Such links are not available for all source model names,
so they are not assumed for every donor. Native results retain their 200-row cap.

Official address and phone checks use the structured department directory at
[contact.html](https://nvpap.com/contact.html). The official location modal also
publishes `info@nvpap.com`.

| Yard                  | Official address                                | Phone        | Verified business pin    |
| --------------------- | ----------------------------------------------- | ------------ | ------------------------ |
| North Las Vegas, 1074 | 5100 N. Lamb Blvd. #5, North Las Vegas NV 89115 | 702-643-1776 | 36.2527229, -115.0794377 |
| Henderson, 1075       | 110 W. Rolly Str., Henderson NV 89011           | 702-565-1414 | 36.0565206, -115.0027763 |

Pins were verified November 11 against named Google business results with matching
street addresses and phones. Do not use the modal's map viewport centers.
Henderson's official embed contains a malformed place identifier. An address
lookup returned the matching named business instead. Google labels its postcode
89015; preserve the official site's 89011 and do not silently rewrite it.

## November 11, 2026 qualification under the original field requirements

The exhaustive 432-query audit returned 3,324 unique records and VINs, with no
duplicate yard stocks. No year exceeded 155 records. The union recovered all
3,299 earlier records, every independently observed missing broad result and
both fresh broad control samples.

| Yard                  | Raw records | Complete | Rejected | Rejection rate |
| --------------------- | ----------: | -------: | -------: | -------------: |
| North Las Vegas, 1074 |       2,130 |    2,046 |       84 |          3.94% |
| Henderson, 1075       |       1,194 |    1,084 |      110 |          9.21% |

Failures overlap. North Las Vegas includes 67 missing/invalid colors, nine unknown
models, nine placeholder-photo records and one invalid VIN. Henderson includes
57 unknown colors, 30 unknown models, 19 placeholder-photo records and seven
invalid VINs. Henderson is close to the limit; a quality decline must fail the
source instead of silently omitting that yard.

A fresh overlap check at 10:01 UTC sampled 30 complete records spread across
each yard's year-ordered catalog. None matched Row52 active inventory or
AutoRecycler global inventory. Each exact-VIN filter first returned its own
known live positive control. This sample does not prove catalog-wide
exclusivity. One published donor photo from each yard also returned HTTP 200
with `image/jpeg`.

Scratch evidence: `nv-year-audit-report.json`, `nv-field-audit-report.json` and
`nv-overlap-report.json` under `.scratchpad/coverage/`. The production parser
also successfully decoded all 430 cached year responses.

The full live connector crawl finished through 27 production-sized checkpoints:
3,324 raw records, 3,130 complete listings and 194 rejections, with no duplicate
emissions. North Las Vegas emitted 2,046; Henderson emitted 1,084. All 432 native
queries completed in 701.3 seconds with 459 total requests, including contact
page refreshes, no HTTP 429s and no network errors. The cached response replay
also passed the current shared source-validation policy and durable cursor
round-trips. The final link-restoration correction is separately covered by the
native-loader check and unit tests; it does not change enumeration or admission.

## November 12, 2026 optional-field saved replay

The user confirmed that color, display stock, photos, inventory date and yard
position follow the existing providers' nullable contract. The revised production
parser and connector replayed all 432 saved native responses through 27 serialized
checkpoints and saved official contact metadata, with zero live requests. The
terminal cursor, broad-control recovery, year caps, stock/yard identity and shared
minimum-count, rejection, duplicate and prior-run drift validation all passed.

| Yard                  | Raw records | Available | Required-field rejects | Rejection rate |
| --------------------- | ----------: | --------: | ---------------------: | -------------: |
| North Las Vegas, 1074 |       2,130 |     2,120 |                     10 |          0.47% |
| Henderson, 1075       |       1,194 |     1,158 |                     36 |          3.02% |

The replay emitted 3,278 unique vehicles, with 46 required-identity rejections,
zero duplicate emissions and 38 independently valid rejected VINs retained as
presence evidence. Available listings preserve 123 null colors and 28 null
photos. All available listings retain genuine source stock, row and set-date.
These counts describe the saved November 11 inventory and revised admission
behavior. Both yards remain disabled and unpublished.

Evidence and full emitted records are in
`.scratchpad/coverage/parallel-az-nm-nv/evidence/nvpap-optional-replay-report.json`
and `nvpap-optional-replay-vehicles.json`. The replay manifest verifies the saved
response hashes before loading them; unexpected or repeated native queries fail
instead of reaching the network.

```sh
bun run soak:sources -- --sources=nvpap --cycles=1
bun test src/server/ingestion/nvpap-parser.test.ts src/server/ingestion/nvpap-connector.test.ts
```

Before enabling, inspect the exact deployment diff,
obtain rollout authorization and verify live accepted inventory
and published yard counts. The 50-state ten-yard target remains incomplete.
