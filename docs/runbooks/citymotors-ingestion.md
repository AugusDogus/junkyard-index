# City Motors ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`citymotors` reads the native Cars catalog at
`https://citymotorsparts.com/used-car-parts/cars/`. The physical yard is City
Motors Chicago, 2150 West St, River Grove, IL 60171, 708-395-5602. Yard code is
`river-grove`. Native `AutoPartsStore` JSON-LD supplies coordinates
`41.9274, -87.8398` and agrees with the visible physical identity. The independent
256-yard screen found no observed accepted-yard alias. Shared registration is
enabled unless its pause flag serves false; the shared minimum is 57 unique donors.

## Native population and identity

Follow the exact published Cars pagination anchors and each distinct card's
`/cars/<slug>/` destination. Equal titles do not collapse distinct destinations.
The qualified catalog has six pages containing `32, 32, 32, 32, 32, 31` cards.
All six closing pages retain the same ordered population and pagination.
This proves the finite published directory, not an atomic backend snapshot.

Each donor's primary `h1.product-page-title` excludes the Item Number/SKU span.
Required fields come from the single `.right-product-description` table:
`Year`, `Manufacturer`, `Model` and `VIN`. All repeated native field pairs remain
in the cursor. Primary title and card identity must agree. The separate
`.product-description-block` establishes own-warehouse dismantling, removal and
quality checks in-house, and River Grove pickup. Four native status spans are
absent; their affirmative active donor prose and catalog membership remain
required. A present status must say `Available`.

`Available Parts For The Model`, retail recommendations, compatibility ranges
and component pagination never supply donor identity. URL slugs, Item Numbers,
images, VIN decoding and check-digit inference never reconstruct required data.
`inventoryVin` applies the existing modern VIN and explicit pre-1981 serial
contract. No O/0 or l/I substitutions, missing-prefix fixes or preferred model
claim selection are permitted.

Native primary manufacturer and model spellings remain intact, including
`M-Benz`, `Chevrolette`, `Ferrary`, `MINI Cooper` / `S Hardtop` and `ROLLS ROYCE`.
Comparison accepts only the reviewed Mercedes abbreviations, Mercedes-Maybach
and Mercedes-AMG title wording, Ferrary/Ferrari spelling, the make-omitted
Corvette title, M8 COMP/COMPETITION, 330i and X7 40I xDrive additions, A6 S-Line
and GLC63S AMG. These comparisons do not rewrite the primary output values.
The native full-title Year cell `2016 BMW X1` is accepted because its explicit
year and complete wording agree with the primary/card title.

Five actual model conflicts remain rejects: ordinal 135 (`535XI` / `35XI`),
162 and 174 (`X5 M50I` / `X5 M50l`), 168 (`X3 M40i` / `X3 M40l`) and 177
(`320I` / `320l`). Six other rows have malformed native VINs. Exact accounting
is **191 observations = 171 unique candidates + nine duplicate extras +
11 required-field rejects**. Five rejected observations preserve four unique
valid VINs as presence evidence. The rejection ratio is 5.7592%, and the duplicate
ratio is 4.7120%, within the unchanged 10% and 25% limits.

Compatible same-VIN/YMM observations are benign duplicates. Conflicting eligible
YMM claims, or a valid rejected VIN also having an eligible claim, stop the
snapshot. Optional color and bound own-host card photos are retained only when
unambiguous. Repeated conflicting colors, differing duplicate photos and opening
versus closing photo changes become null. Stock, inventory date, yard position,
engine, trim and transmission remain null. Optional fields never repair identity.

## Durable traversal and transport

`streamCitymotorsInventory` and `streamCitymotorsInventoryWithRequestGate` accept
`startCursor`, `maxPages`, `onBatch` and optional `onYards`. One request unit is
one serial native GET. The connector default is eight, with a 32-request
ceiling. Durable ingestion runs three GETs per chunk so three worst-case
requests fit the three-minute chunk limit and catalog progress is checkpointed
every three pages. The qualified census needs 203 GETs: six opening pages, 191
details, six closing pages. A three-request chunking completes in 68 chunks.

The cursor phases are `catalog`, `details`, `closing` and `complete`. Contiguous
literal page links, page numbers, complete card counts, unique destinations,
exact detail-prefix bindings, checksums and source scope validate at every
checkpoint. Limits are 32 catalog pages, 1,024 donors, 1,088 total requests and
1 MiB of serialized cursor data. The saved single-request replay peaks at
278,401 bytes. `CitymotorsCursor.initial`, `.parse` and `.serialize` are the
shared durable codec interface.

Paused chunks emit no vehicles, yards, presence or accounting. The completed
snapshot emits only after all closing pages and full-population quality guards
pass. A failed parser, guard or callback returns no advanced checkpoint. A GET
that times out or answers HTTP 5xx is sent once more if a full request budget
still fits. A GET answered with HTTP 429 is sent once more after the longer of
its Retry-After and 15 seconds, if that wait and a full request budget still
fit. If that wait does not fit, or the resend is rate-limited again, the chunk
returns its last validated checkpoint with `retryAt` set to the end of that
wait, and the durable Workflow sleeps until then before the next chunk sends
the GET. A wait over 10 minutes, or a rate limit on the first GET right after
a cooldown, fails the attempt as a transient rejection that retries after the
usual delay. When a timed-out or 5xx GET fails again, a chunk that already validated pages returns that
checkpoint as paused and logs a warning naming the URL and cause, and one that
has not fails without advancing. Prior accepted inventory remains preserved. A
complete cursor performs no HTTP or callbacks when replayed.

Requests use normal HTTPS, manual redirects, a combined 45-second
request/body deadline and a 2 MiB document limit. The origin can take 12 to 14
seconds to first byte, so the earlier 20-second budget failed whole chunks.
Responses must be complete, unredirected HTTP 200 HTML, without content ranges.
The entire chunk has a three-minute limit. Before each GET the connector pauses
at the current checkpoint unless one full request budget, its 1,600 ms gap and
a 10-second completion reserve for census validation and callbacks still fit
that limit. A 1,600 ms finalizer delay follows success and failure,
including serialized chunk boundaries. No images, scripts, carts or forms are
requested.

## Saved verification

Source contract and independent source review:

- `.scratchpad/coverage/parallel-al-ms-la/citymotors-source-ready-01/source-contract.json`
- `.scratchpad/coverage/parallel-ma-ct-ri/citymotors-terminal-review01/report.json`
- `.scratchpad/coverage/parallel-ma-ct-ri/citymotors-terminal-review01/explicit-wording-and-field-rulings.json`

Run focused tests and the actual connector's saved replay:

```sh
bun test src/server/ingestion/citymotors-*.test.ts
bun .scratchpad/coverage/parallel-pa-md-wv/citymotors-application01/replay.ts
```

The replay verifies all 203 body pins, independently checks every row's reviewed
accept/reject decision, compares all 171 emitted required identities to the
corrected native oracle and preserves the four rejected VINs. Request budgets
one, eight and 32 exercise serialized resume, exact request counts, final-only
emission and idle terminal replay. Unknown mocked requests throw before any
network fallback. Reports are retained beside the replay. Shared registration,
soak integration and final admission are owned by the parent task.
