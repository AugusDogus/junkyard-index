# AWAP ingestion

`awap` reads Alabama Wholesale Auto Parts' native Cars at Yard catalog:
`https://www.alwholesaleautoparts.com/cars-at-yard/`. The yard code is
`birmingham`. Native About binds Birmingham, AL 35211, phone `205-538-2538`
and the official domain. Native street is unpublished. The matching public
Maps business item supplies **120 Princeton Pkwy**, Birmingham, AL 35211 and
the business point **33.502776, -86.8482328**, with accuracy unstated. Its
place ID is `ChIJL2jNYdkdiYgRwAfdVKFRRuk`. These are named-business item
coordinates, not a viewport or ZIP centroid. Canonical metadata retains the
supported public street with separate provenance. Independent screening found
no overlap among the then-current 256 accepted physical yards.

## Native inventory contract

The native heading says `Cars at Yard – Available Donor Vehicles`; its subtitle
describes donor vehicles currently being dismantled. Each `article.awap-cy-card`
has a native dismantling status and a same-domain donor destination. These
explicit own-yard donor claims establish the full-service inventory scope.
The catalog assertion also covers cards whose status span is absent. Consistent
repeated status claims are accepted; contradictory native status fails globally.

Required VIN, four-digit year, make and model come from the published
`a.awap-cy-inquiry` href's query metadata. The same-card `a.awap-cy-view` query
must independently agree on VIN. Native `a.awap-cy-card-title` wording must agree
with explicit year, make and model, ignoring case only. Those controls are
parsed from the HTML; neither inquiry nor parts endpoints are requested.
The card's donor href supplies `detailsUrl`, without fetching donor details.
Slugs, filenames, SKU claims, VIN decoding and check-digit inference never
reconstruct required fields.

Native modern VINs and genuine explicitly pre-1981 serials use the existing
`inventoryVin` contract. Missing or malformed required metadata counts as a
reject. Independently valid VINs from rejected rows remain presence evidence.
Contradictory native VIN/YMM claims, repeated donor destinations or reused valid
identities across distinct cards fail the source globally. A completed yard
must contain eligible donors and stay within the unchanged 10% rejection limit.
Shared source validation retains minimum-count, duplicate and previous-run
drift guards; the configured AWAP minimum is 160 against 183 qualified donors.

Native color, image, engine and transmission values are optional. Unambiguous
valid values remain intact, including combined color labels and literal photo
paths. Missing, malformed, unsupported or contradictory optional values become
null. Optional changes between opening and closing become null without
invalidating the donor. Native SKU is retained separately as `skuClaim`; its
yard-stock semantics are unestablished, so `stockNumber` stays null. Arrival
date, yard position and trim also stay null. No dates come from CMS metadata,
upload paths or model year. Image references do not assert fetched-image liveness.

## Traversal, checkpoints and transport

The qualified census is eight pages: `25, 25, 25, 25, 25, 25, 25, 8`, advertising
183 donors. Follow only literal native next hrefs. Canonical URL, active page
marker, next/previous edges, advertised count, exact page cardinality and
terminal absence of next are validated. No hidden or constructed continuation
route is requested. Every opening page is reread through its retained literal
URL before publication. Required identity, order, count and pagination must
remain stable across closing pages. This is finite source-boundary evidence,
not an atomic backend snapshot.

`streamAwapInventory` and `streamAwapInventoryWithRequestGate` accept
`startCursor`, `maxPages`, `onBatch` and optional `onYards`. One request unit
is one About, opening catalog or closing catalog GET. Default and maximum chunk
size is eight requests. The saved replay needs 17 GETs and three chunks:
one About identity check, eight openings and eight closings.

`AwapCursor.initial`, `.parse` and `.serialize` provide the durable codec.
Phases are `identity`, `catalog`, `closing` and `complete`. Checkpoints bind
the source and physical metadata scope, checksum, contiguous literal page
prefix, native rows and closing prefix. Bounds are 32 pages, 800 donor cards,
`AWAP_MAX_REQUESTS` of 65 and 2 MiB of serialized cursor data. A malformed or
inconsistent checkpoint stops before HTTP. Complete cursors make no requests
or callbacks.

Paused chunks emit no vehicles, yards, presence or accounting. Only the complete
validated closing census invokes callbacks. Request, parser, quality or callback
failure returns no advanced checkpoint; prior accepted inventory is preserved.

Transport uses the existing provider client and bounded UTF-8 response reader:
normal HTTPS, manual redirects, no retry, complete unredirected HTTP 200 HTML,
no content ranges and a 2 MiB cumulative body cap. The combined request/body
deadline is 20 seconds, with a three-minute chunk ceiling. A 1,600 ms finalizer
delay follows success and failure, including serialized chunk boundaries.
No images, scripts, inquiry forms, parts controls or donor details are requested.

## Saved verification

```sh
bun test src/server/ingestion/awap-*.test.ts
```

`awap-test-fixtures/saved-census.json.gz` retains the native About body, all eight
listing bodies and MI's independent 183-row oracle. `source-pins.json` records
input hashes. Tests compare every required identity and optional native photo
and color reference, exercise request budgets one and eight with serialized
resume, verify final-only callbacks, and cover required contradictions, missing
metadata, the rejection limit, optional uncertainty, cursor corruption, source
drift, transport denials and streaming/body completeness.

Source handoff: `.scratchpad/coverage/parallel-me-nh-vt/al-native-discovery01/awap-census01/source-ready-handoff02.json`.
Independent source and physical review: `.scratchpad/coverage/parallel-mn-ia-ne-sd/awap-independent-review01/report.json`.
The captured first page was explicitly reused with later captured pages; all
183 identities reconcile, without a claim that capture was atomic. Application
replays use saved bodies only and issue no provider HTTP. Shared registration,
soak integration, enablement and admission remain owned by the parent task.
