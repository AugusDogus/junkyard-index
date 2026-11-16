# RTP Pick-A-Part ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Source: `rtp`. The connector admits Lexington KY (native YardSmart ID `595`),
Maiden NC (`1189`), Hebron KY (`232`), Louisville KY (`265`) and Savannah TN
(`298`). It runs unless
`ingestion-source-rtp` serves false. No new yards are counted as published.
The user has directed local-only work. Do not push, open or merge a PR, deploy,
or enable the source without new authorization.

## Public inventory contract

Official inventory pages publish the location directory and public AJAX/CSRF
configuration. Fetch a fresh context for each checkpoint. Use the native
`integrations.yardsmart.yard_id`, which must match the inventory form's hidden
yard field. The site's separate location identifiers are not inventory IDs.
Require active locations, verified native IDs, state and official URLs, complete
address/phone/postal metadata, and valid published coordinates. Email is nullable.

POST `https://upullandsave.com/wp-admin/admin-ajax.php` with URL-encoded
`action=inventory`, `api_call=getInventoryDatatablesArray`, the public nonce,
and native DataTables fields. Request 100 records, ascending `stock_number`,
with the year/make/model/search filters unset and `params[log]=false`.
Use the truthful `User-Agent: JunkyardIndex/1.0`.

Require stable `recordsTotal`, equal `recordsFiltered`, echoed `draw`, exact
page sizes, correct yard identity, distinct page record IDs, and strictly
increasing padded stocks across resumed checkpoints. Reject oversized,
partial, redirected, malformed or contradictory responses. The boundary schema
discards staff identifiers, internal events and notes. Public CSRF state stays
in memory and never enters product data, cursors or logs.

Two native pages form a normal checkpoint. Requests are gated at 1.5 seconds,
time out after 20 seconds, and have at most two bounded retries for retryable
statuses/timeouts. HTTP 403 fails immediately. A checkpoint has a four-minute
outer timeout. Failed checkpoints return no advanced cursor.

## Field quality and reconciliation

Emit only active, set vehicles with valid VINs or genuine pre-1981 serials,
year/make/model and verified physical yard ownership. Color, stock, photo,
source set-date and row are optional. Preserve valid native values and use null
for absent or invalid optional metadata. Photo URLs must match the trusted origin and
`/yardsmart/<yard>/<record>/<image>.jpg`. No URL construction or logo fallback.
Preserve the source calendar date at UTC midnight; its naive set-time does not
establish an acquisition timestamp. Optional engine/trim/transmission and
parts/pricing fields stay null.

Records missing required fields are rejected. Independently valid VINs provide presence
observations only. Explicitly inactive records are excluded without presence
protection. An unrecognized active status cannot emit a listing. Each yard must
finish with complete vehicles and at most 10% rejected available records.
Rejection/exclusion/emission counts survive checkpoint resumes. Existing global
duplicate, rejection and prior-run drift safeguards also apply, with a minimum
of 1,000 unique complete vehicles for this source.

The source stock is also the verified pagination ordering key. A missing or
invalid ordering key fails the checkpoint because complete enumeration cannot
be established. Optional canonical stock does not relax this source-level guard.

The public site provides year/make/model filtered inventory destinations, not
individual donor pages. `detailsUrl` uses the native filter route and the site's
`helpers.encodePath` replacements, followed by URL encoding. A live Lexington
2010 Chevrolet Tahoe filter returned HTTP 200 on November 11. Do not describe
these links as unique donor detail pages.

## November 12, 2026 qualification

The user selected matching the existing required fields. The complete saved
five-yard audit was rerun through the current production parser and transform.
It admitted 3,188 unique vehicles from 3,199 records, with 11 required-field
rejections, no exclusions and no duplicate VINs. Every yard passed the unchanged
10% per-yard limit. Published physical addresses, coordinates, phone numbers and
native URLs are retained in the audit.

| Yard               | Raw records | Accepted | Required-field rejections | Rejection rate |
| ------------------ | ----------: | -------: | ------------------------: | -------------: |
| Hebron KY, 232     |       1,191 |    1,189 |                         2 |          0.17% |
| Louisville KY, 265 |         293 |      292 |                         1 |          0.34% |
| Lexington KY, 595  |         413 |      411 |                         2 |          0.48% |
| Savannah TN, 298   |         491 |      490 |                         1 |          0.20% |
| Maiden NC, 1189    |         811 |      806 |                         5 |          0.62% |

A fresh read-only run of the actual connector then completed 35 native pages
through 18 production-sized checkpoints. It read 3,207 records and emitted
3,195 unique vehicles, with 12 rejections (0.37%), no exclusions and no duplicate
emissions. Each yard passed its terminal quality guard. Accepted live counts
were Hebron 1,179, Louisville 286, Lexington 412, Savannah 508 and Maiden 810.
The run took 76.583 seconds and 55 HTTP requests, with no HTTP 429s or network
failures. All five official yard contexts passed metadata and identity checks.
No source flag, publication or production state changed.

Evidence is saved locally under
`.scratchpad/coverage/parallel-ky-tn-ar/evidence/`:
`rtp-revised-required-field-audit.json`, `rtp-revised-cached-vehicles.json` and
`rtp-revised-live-soak.log`. The revised cached snapshot passed shared source
validation, including the existing inventory floor and prior-run drift guard.

The three added yards have no normalized-address or phone matches in the saved
213-yard published directory. Their nearest published yards are 24.975 km from
Hebron, 3.037 km from Louisville and 126.882 km from Savannah. A bounded fresh
overlap check queried 30 stock-spread cached accepted VINs per added yard
(90 total) against public Row52 active and AutoRecycler visible inventories.
All 18 exact-filter requests returned working positive controls and no sampled
VIN matches. Saved response hashes and byte counts pass. This sample does not
prove catalog-wide exclusivity or current availability of the cached sample.
Evidence: `rtp-revised-physical-overlap.json` and `rtp-revised-overlap/report.json`
under the same local evidence directory.

## Earlier qualification under the superseded field requirements

The initial full public audit fetched five inventory pages and 34 native pages
(39 requests), enumerating 3,199 source records. All were active and set. Stocks
were ordered and unique per yard; VINs were unique across the five yards.

| Yard               | Raw records | Complete | Rejected | Rejection rate | Decision                             |
| ------------------ | ----------: | -------: | -------: | -------------: | ------------------------------------ |
| Hebron KY, 232     |       1,191 |      922 |      269 |         22.59% | Defer, mostly missing donor photos   |
| Louisville KY, 265 |         293 |      252 |       41 |         13.99% | Defer, missing/invalid colors        |
| Lexington KY, 595  |         413 |      373 |       40 |          9.69% | Pass field-quality audit             |
| Savannah TN, 298   |         491 |      335 |      156 |         31.77% | Defer, mostly missing/invalid colors |
| Maiden NC, 1189    |         811 |      778 |       33 |          4.07% | Pass field-quality audit             |

Color qualification also rejects misplaced model names, years, uncertain colors
and unrecognized spellings. It does not infer corrections. The table reflects
this stricter check, including overlapping failures.

The actual connector then completed all 14 native pages through seven
production-sized checkpoints: 1,224 raw records, 1,151 complete vehicles, 73
rejections (5.96%), no exclusions and no duplicate emissions. Lexington emitted
373 and Maiden 778. It took 28.535 seconds and 22 requests, with no HTTP 429s or
network failures. Both yard addresses are distinct from the published directory.
This is read-only evidence, not production publication.

A fresh overlap check at 09:42 UTC sampled 30 complete VINs evenly through each
yard's stock order. None of the 60 sampled VINs matched Row52 active inventory
or AutoRecycler global inventory. Each exact VIN filter first returned its own
known live positive control. This sample does not establish catalog-wide
exclusivity. One published donor photo from each yard returned HTTP 200 with
`image/jpeg`. The Lexington filtered destination restored all three year,
make and model selections.

The resulting snapshot passed the existing shared source-validation policy.
These earlier rejection rates included optional metadata failures and no longer
govern yard eligibility. A required-field quality decline must still reject the
source rather than silently omit a yard.

```sh
bun run soak:sources -- --sources=rtp --cycles=1
bun test src/server/ingestion/rtp-connector.test.ts src/server/ingestion/rtp-transform.test.ts
```

Before enabling: review fresh overlap evidence with working positive controls,
review the exact deployment diff, and verify live accepted inventory and yard
counts after the authorized rollout. The overall target remains at least ten
qualified published yards in each of the 50 states.
