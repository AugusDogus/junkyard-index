# McCauley ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`mccauley` reads the native Parts Vehicles index and current part-out list for
McCauley's Auto LLC, 5156 Rt 66, New Bethlehem, PA 16242. Yard code is
`new-bethlehem`. Native contact text establishes physical ownership. Coordinates
`41.07134, -79.31888` come from the retained ASYD physical-yard row, rather than a
native map pin. Serving false from its source flag pauses ingestion.

## Native scope and required identity

The official category is `https://www.mccauleysauto.com/parts-vehicles`. Its linked
donor pages use the exact published HTTP host
`http://mccauleysautocom.fatcow.com/mccauleysauto/parts-*.html`. The second native
list is `https://www.mccauleysauto.com/pick-a-part-list-of-parts-vehicles`, headed
"Here are current vehicles we are parting out." Both lists contribute inventory.
The current list is not an exclusive subset declaration for the official Parts
Vehicles category. Native part-out language establishes donor scope. Component
sales, limited parts and missing components do not remove a whole donor.

Required VIN, year, make and model come from native donor text. `inventoryVin`
applies the existing VIN contract without checksum gating or VIN decoding.
No identity comes from URL slugs, images or inferred model years. Conflicting
required VIN/YMM observations abort the census. Native detail headings and their
identity paragraphs must agree, including abbreviated paragraph titles that
preserve the fuller Silverado 2500HD heading.

The frozen census contains 20 detail routes, 21 named detail observations and
five current-list observations. Two list observations duplicate detail donors.
The MDX page describes one additional unnamed 2003 MDX twice. Those sentences
describe the same extra donor and contribute one required-identity rejection.
Changed or contradictory whole-vehicle cardinality claims require inspection.

Exact accounting is **27 observations = 24 accepted donors + two duplicates +
one required-identity rejection**. The 3.7037% rejection and 7.4074% duplicate
ratios satisfy the unchanged 10% and 25% limits. The source floor is 8 donors.
Shared prior-run drift and reconciliation guards remain applicable.

Only native labelled transmission is retained, with 18 Automatic values in the
frozen census. The two Calibers have native Red and Silver descriptions. Other
colors, stock, photos, inventory dates, engine, trim and yard positions remain
null. No image bytes, retail catalog, accounts, carts or contact actions are used.
Detail-backed donors retain their published detail destination. The three
current-only donors use the native current list with generic View inventory text.

## Bounded traversal and durable checkpoints

`streamMccauleyInventory` accepts `startCursor`, `maxPages`, `onBatch` and optional
`onYards`. A unit is one native GET. The default is eight units per chunk, with
a 24-unit chunk ceiling. Every census opens both lists, visits every ordered
unique detail destination, then closes both lists. The frozen census needs
24 GETs, or three eight-unit chunks. Requests are serial and unredirected, with
no retries and a 1,600 ms finalizer delay after success or failure, including
serialized chunk boundaries. Each request and body read has a 20-second limit.
Each document has a 2 MiB source limit, within the shared reader's 4 MiB limit.
The entire chunk has a two-minute limit.

`MccauleyCursorSchema` validates these discriminated phases:

- `start`: no retained source evidence.
- `current-list`: opening catalog evidence.
- `details`: both opening lists and an exact native detail-prefix projection.
- `verify-index`: all native details, awaiting the closing index.
- `verify-current`: closing index passed, awaiting the closing current list.
- `complete`: terminal and idle, with zero further requests or callbacks.

The index allows at most 100 unique destinations, and the current list at most
100 cards. Empty native formatting anchors may only alias a labelled destination.
Unexpected pagination, foreign destinations, malformed cards, unaccounted VIN
text, whole-donor removal language and incomplete documents fail closed.

Checkpoints retain raw-response SHA256 values and separate canonical projection
fingerprints for every list and detail. Reconstructed native prefix order and
required identity must validate on resume. No stored accounting counter is
trusted. Serialized cursors are capped at 512 KiB. The measured maximum with
single-request chunks is 17,219 bytes. Closing controls compare ordered native
destinations/labels and current donor headings. They establish a stable bounded
traversal, rather than an atomic provider snapshot.

Paused chunks emit no yards, canonical vehicles, presence or accounting. Only
the completed census emits its canonical batch after both closing controls and
quality guards pass. Consumer mutation cannot change source metadata or reported
counts. A request, parser, guard or callback failure returns no advanced
checkpoint. Prior inventory remains preserved. Inspect the native source and
restart the census after resolving drift.

## Saved validation

Run the source regression tests:

```sh
bun test src/server/ingestion/mccauley-*.test.ts
```

The frozen native packet is
`.scratchpad/coverage/parallel-pa-md-wv/mccauley-required-qualification/`.
Its original verification SHA256 is
`0ddd4864e7ff9225159f2d4b8e842ce564b3859fe50e6ca7f6f150bf12d0d183`.
The semantic clarification and independent reviews are additive artifacts under
`addenda/source-semantics`, `parallel-ny-nj-de/mccauley-scope-review` and
`parallel-mi-oh-wi/mccauley-canonical-review`.

Replay the original saved HTML without native HTTP or persistence:

```sh
bun .scratchpad/coverage/parallel-pa-md-wv/mccauley-required-qualification/implementation/replay.ts
```

The replay verifies all 24 saved body pins, uses the actual connector and shared
durable cursor codecs, exercises one-, eight- and 24-unit chunks and compares all
25 canonical fields for every donor against the independent MI oracle. It adapts
only the oracle's proposed source and yard-code placeholders. It checks final-only
emission, 18 Automatic transmissions, exact accounting and an idle terminal replay.
Saved transport rejects unknown requests and cannot fall through to live fetch.

`soakMccauleyInventory` in `scripts/soak-mccauley.ts` is a count/discard driver.
The caller owns transport and staging. Its total budget is at most 104 GETs
(100 detail routes plus four opening/closing controls), with default eight-unit
chunks. It neither writes the database, Algolia or Blob nor enables the source.
