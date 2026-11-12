# Millerstown Pic-A-Part ingestion

Status on November 12, 2026: implementation, independent source review,
saved-fixture verification and one bounded live qualification are complete.
The native PDF has
1,122 rows across 34 pages, yielding 1,087 accepted unique donors and 35 required
field rejects. One rejected donor retains a valid identity as presence evidence.
No production inventory was written. The source remains disabled by default.
This records local source qualification only; parent yard admission and
production enablement remain separate decisions.

The source code is `millerstown`, and its single yard code is `tarentum`.
The native [root](http://picapartyard.com/) identifies a self-service salvage
yard at 3148 Lardintown Road, Tarentum, PA 15084, phone 724-224-4777.
The [Vehicles on Premises page](http://picapartyard.com/vehicles-on-premises/)
publishes one downloadable inventory PDF and embeds the same PDF through a
Google viewer. The connector fetches the native PDF directly. It never fetches
the viewer. The D & D pickup contact does not establish another yard or alias.

Coordinates 40.6712657, -79.7982583 come from ARA member 3298's matching
exact-address business point. They are third-party directory coordinates,
independently checked against the native address, not a native map pin or city
centroid. The manual-search destination is the native inventory page.

## Complete native snapshot

Every run discovers the current published PDF link. No filename, publication
date or fixture hash is pinned in production. A supported link is a direct
same-origin `/wp-content/uploads/` PDF without credentials, query or fragment.
Exactly one download link and one matching Google viewer are required.

One logical catalog chunk performs exactly five serial public GET requests:

1. Root page, validating physical owner, self-service scope and inventory link.
2. Opening inventory page, validating owner, canonical URL, full-inventory title,
   heading, PDF download link and matching embedded viewer.
3. Complete published PDF, parsing every page and every eleven-column source row.
4. Closing inventory page, revalidating the same normalized owner, title and link.
5. Complete PDF at the same link, comparing SHA-256 over all opening/closing bytes.

No yard or donor callback runs until all five reads and source quality checks
pass. A changing link, physical owner, title, source layout or PDF byte anywhere
fails the whole catalog. Irrelevant HTML markup can change without invalidating
the normalized ownership proof. A failure returns no advanced checkpoint.

The PDF grammar is source-specific: US-letter landscape, zero rotation, one
content stream per page, Calibri/Calibri-Bold TrueType WinAnsi fonts, the exact
eleven headings and native column anchors, supported literal text operators and
continuous row grids. It expects 30 rows on a non-final first page, 34 on every
interior page and a supported partial final page. Page-tree counts, parents,
cycles and repeated/orphan pages are checked. Unknown operators, font mappings,
coordinates, duplicate cells or gaps block the source rather than guessing.

## Field contract

Admission requires the actual source VIN or supported older serial through
the existing `inventoryVin` contract, plus usable native year, make and model.
There is no VIN decoding, checksum enforcement, year correction or inferred
model repair. All valid identities must be unique across every source row,
including rejected donors. A valid rejected identity supplies presence only.

Stock, color, engine, trim and transmission are optional. Their absence never
rejects an otherwise valid donor. Stock is display metadata, not identity or a
join key: source stock `2503033` belongs to two distinct valid donors. Blank or
literal `N/A` optional text becomes null. Internal native text is preserved,
with existing shared make/color normalization. The saved PDF has three literal
`N/A` engine/transmission cells, retained raw and converted to canonical null.

Image, arrival date, section, row, space, detail link, parts link and prices link
are absent and stay null. PDF page/row/baseline are parser provenance only,
never physical yard positions. The PDF filename/publication date is never an
arrival date. The saved accepted donors contain nine supported older serials.

## Bounds, checkpoints and recovery

The strict cursor contains only `source` and `phase`, either `start` or
`complete`. It stores no PDF bytes, page offsets or partial checkpoint. The
source is atomic with a central chunk size of one and a minimum of 900 accepted
unique donors. The source accepts a logical catalog budget of 1 through 32,
default one, and completes one catalog. The read-only soak driver requires one.
A complete cursor performs no reads and no callbacks. Both phases round-trip
through the actual shared durable serializer/parser.

The unchanged shared 10% required-field rejection cap, duplicate checks,
50% prior-count drift guard and reconciliation policy still apply. No paused or
failed read authorizes reconciliation. The fixture accounting is 1,122 processed,
zero excluded, 35 rejected, zero duplicates and 1,087 emitted. The valid rejected
identity is `1HTMMAAM93H572593`, giving 1,088 total valid presence identities.

HTTP uses one shared serial request gate at 1.6 seconds, no automatic retries,
20-second request/body deadlines and a two-minute catalog deadline. Only exact
HTTP 200 responses at the requested final URL with the expected HTML/PDF MIME
are accepted. Redirects, partial ranges, mismatched lengths, invalid HTML UTF-8,
HTML over 4 MiB, PDF over 8 MiB and missing PDF signatures fail closed.

The bounded parser uses public `pdf-lib@1.17.1` APIs with built-in bounded zlib
inflation before inherited object-stream/xref decoding. It accepts direct
matching stream lengths and only direct FlateDecode or no filter, without
DecodeParms. It limits 512 streams, 1 MiB decoded per stream, 16 MiB decoded
aggregate, 100,000 final indirect objects/largest object number/compressed
declarations, 1,000 compressed entries per stream, 1,000,000 parsed values,
200,000 raw integer operations, depth 64 and a cooperative 20-second parse
deadline. Object-stream intervals must contain exactly one dictionary or array;
nested streams, scalar compressed objects and percent/comment syntax in decoded
object streams are unsupported. Xref streams require the reviewed direct bounded
Size and native `[1,4,2]` widths without Index. Input bytes are copied before
asynchronous parsing. Page limits are 128 leaves, 256 tree nodes, depth 64 and
10,000 total rows. These are cooperative parser/work and decoded-byte controls,
not a hard process memory or CPU sandbox.

On failure, prior accepted inventory is preserved. Inspect the native root,
inventory page and PDF, retain the last accepted inventory, then retry from
`start` after the source settles or the format is reviewed. Never combine
partial PDFs, accept a changed closing hash, weaken shared guards or reuse an
unproven checkpoint. Callback failures also return no complete cursor; supplied
start cursors remain unchanged. Callback consumption cannot alter validated
terminal counters.

`scripts/soak-millerstown.ts` is a read-only count/discard driver. The caller
provides the actual connector, callbacks and request gate. It does not write
inventory, enable the source or start live requests on import. Coordinate a
separate bounded live soak before using it against native HTTP.

## Saved and live verification

Saved fixtures are the complete losslessly compressed native PDF, native
root/inventory HTML and full raw/canonical/rejection oracle under
`src/server/ingestion/fixtures/millerstown-*`. The binary fixture is fingerprinted
before tests. Its SHA-256 is
`9e4cd7f6c823648bc7fa18091cb2515c6fffb4c58235fc9be8ae43cbd6f54897`.
The accepted canonical output hash is
`e0250853b7688f8827be4831aaecafd9b4b6775de47c7c2b421ef036b3ca6837`.

The saved parser/transform tests compare all 1,122 by 11 raw cells and 1,087 by
25 canonical fields. The production connector replay compares all canonical
fields, rejected identities, yard and terminal accounting.
It uses the actual shared durable codec and exactly five saved requests with
zero live calls. Negative controls cover ownership/scope/link/viewer drift,
middle/tail PDF drift, transport incompleteness, format/resource bounds,
duplicate identity, rejection cap, accepted-count floor, callback failure and
immutable supplied cursors. Three independent parser canaries preserve the
cross-object comment lookahead, mutable Buffer alias and swallowed raw-integer
resource failure regressions.

Run the focused checks without native HTTP:

```sh
bun test src/server/ingestion/millerstown-*.test.ts
bun run typecheck
bunx oxlint --deny-warnings src/server/ingestion/millerstown-*.ts scripts/soak-millerstown.ts
bunx oxfmt --check src/server/ingestion/millerstown-*.ts scripts/soak-millerstown.ts docs/runbooks/millerstown-ingestion.md
```

Frozen plan/oracle/resource review and actual parser execution evidence are in
`.scratchpad/coverage/parallel-ak-hi/millerstown-plan/` and
`.scratchpad/coverage/parallel-ak-hi/millerstown-runtime/`. Independent source
format/protocol review passed 126 controls with no unresolved findings in the
PA lane. The KY lane passed full canonical, physical-tuple and actual connector
runtime parity against the reviewed production source pins.

Exactly one live qualification ran from `2026-11-12T08:58:19.691Z` through
`2026-11-12T08:58:26.237Z`. It made five serial native GET requests through the
1.6-second gate, with no retries, redirects or additional requests. All five
responses returned HTTP 200. It processed 1,122 rows, accepted 1,087 unique
donors, rejected 35, excluded none and found zero duplicates. The valid rejected
identity remained presence evidence. Callbacks ran only after all five complete
reads and wrote local qualification artifacts only.

All five retained raw response bodies are byte-identical to the reviewed root,
inventory HTML and PDF fixtures. Both full PDF bodies contain 1,181,159 bytes
and have the frozen native SHA-256 above. The live canonical output is also
byte-identical to the reviewed saved production replay. Reviewed source,
fixture-helper and soak-driver pins matched before and after the run.

The live evidence is retained in
`.scratchpad/coverage/parallel-ak-hi/millerstown-runtime/`:

- `live-soak-report.json`: exact destinations, observed timestamps, response
  metadata, raw body paths/hashes, callbacks, canonical hash and terminal counts.
- `live-soak-response-0.body` through `live-soak-response-4.body`: all five bounded
  response bodies, saved inside the request gate before callbacks.
- `live-soak-canonical.json`: the complete 1,087-record live canonical array.
- `live-soak-verification.json`: disk body/hash checks, reviewed source pins and
  full PDF/canonical equality.
- `live-soak-full-fixture-parity.json`: exact byte equality of every live response
  against its reviewed fixture, with no additional HTTP requests.

The parent final sweep in
`.scratchpad/coverage/parent-next-four-final-suite.log` passed 2,538 tests with
zero failures, including all 146 Millerstown tests. The full-native-PDF mutation
tests use an explicit 20-second harness budget; production parser limits remain
unchanged. The live receipt records native availability at the observed time.
Future runs must rediscover the published link and repeat the complete protocol.
