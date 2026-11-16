# Rohner's Auto Parts ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Source `rohner` reads the native filtered Vehicles catalog at
<https://rohnersautoparts.com/shop/?product-categories=vehicles>.
Yard `willmar` is Rohner's Auto Parts, Inc., 1800 County Road 27 NW,
Willmar, MN 56201, 320-235-4602. Native contact evidence and the named
business marker support 45.2116768, -95.06669989999999. The location page
warns that navigation systems can misroute visitors. Physical review found
no overlap with the 266 previously published or locally admitted entries.

## Published inventory and required identity

The saved catalog has 287 distinct donor articles across twelve native
pages of at most 24 cards. Follow only literal filtered pagination and
article destinations. The generic WordPress `/shop/` canonical is not a
continuation. Every page must reconcile its requested number, displayed
range, total, terminal page and owned card destinations.

Required identity comes from native article fields and agreeing native
titles, structured claims and catalog cards. Preserve native VINs or
supported older serials and native year/make/model. Decode equivalent HTML
entities, including Town & Country, without selecting between conflicting
claims. Do not derive identity from VIN decoding, route tokens or image
names. Conflicting VIN, destination or required identity groups are fully
quarantined. Every valid rejected identity supplies presence only.

The native AA0126 article explicitly says Sold-Rebuilder. Its valid 1977
Toyota Celica serial `RA29076797` is retained as raw evidence and intentionally
excluded from active inventory and presence. Exclusion happens after conflict
quarantine. A conflict still preserves valid VIN presence. The two Scrap
articles remain eligible: that label alone does not prove removal of a
whole donor. No additional per-row residence or parts-availability gate is
imposed on this own-yard donor catalog.

Color, canonical stock, photo, engine, trim, transmission, arrival date and
position are optional. Missing, invalid or conflicting optional values become
null. BuildDate is not an arrival date. Placeholder images do not become
donor photographs. All valid published optional metadata is retained.

## Complete traversal and durable recovery

The connector captures every opening page, each bound donor article, and
then every catalog page again. Closing observations must preserve ordered
membership, native identity claims, status classes and pagination. This is
temporal membership evidence, not an atomic provider-wide snapshot.

No vehicles, yards, presence or accounting are emitted before complete
traversal, closing observations and quality checks pass. The strict cursor
retains the complete native prefix, source, scope, version, checksum,
receipts and phase. An empty or forged terminal cursor fails validation.
The shared validator requires explicit `phase: "complete"`, even when a
source row claims success and already has sufficient staged inventory.

| Bound                          | Limit                |
| ------------------------------ | -------------------- |
| Combined request/body deadline | 20 seconds           |
| Complete UTF-8 HTML body       | 2 MiB                |
| Completion spacing             | At least 1.6 seconds |
| Native GET units per chunk     | 1 to 3               |
| Active chunk deadline          | 90 seconds           |
| Total live chunk deadline      | 2 minutes            |
| Catalog capacity               | 32 pages, 768 donors |
| Total native request capacity  | 832 GET units        |
| Total response capacity        | 256 MiB              |
| Serialized cursor              | 16 MiB               |
| Accepted inventory minimum     | 95 vehicles          |

Requests are serial, with no automatic retries or redirect follows. On a
transport, body, source, quality or closing failure, preserve prior inventory
and the caller's last validated checkpoint. Diagnose the retained error
before resuming. Start again if the source membership or cursor scope changed.
Do not turn a failed control into a successful empty inventory.

The 10% rejection, 25% duplicate and shared count/drift/reconciliation guards
remain intact. Rohner ranks above AutoRecycler mirrors in reconciliation.
An intentional sold exclusion cannot preserve old sold inventory. Rejected
valid identities continue to protect prior metadata.

## Local verification

The complete native census has 287 required identity passes, zero rejects,
zero duplicate extras and one intentional sold exclusion, leaving 286 active
donors. Twelve later live closing pages preserve all ordered claims.

The independent Python/lxml oracle derives all 286 vehicles and all 25
canonical fields directly from native HTML and verified yard metadata.
Its SHA256 is
`9470ce7edc258f91090d65e49a64a9b6e995526f18e7d800fdd2fb431431837f`.
The parent saved-only application proof exercises 311 exact native response
units across 104 serialized durable chunks, including distinct actual
closing bodies. All 7,150 values match in emitted batches, stored snapshots
and persisted vehicles. Real shared source validation and reconciliation
pass in an in-memory libSQL database. Seeded sold and absent vehicles retire.

Evidence is under `.scratchpad/coverage/`:

- `parallel-mn-ia-ne-sd/rohner-final-evidence20/` and
  `rohner-closing21/`: complete native census and later closing observations.
- `parallel-mt-wy-nd/rohner-canonical25-oracle01/`: independent expected values.
- `parent-rohner-final01/replay-report.json`: real shared persistence proof.
- `parallel-mi-oh-wi/rohner-shared-integration-review41/`: shared wiring review.

Checked-in native fixtures support offline tests without ignored scratch
files or network access. `scripts/soak-rohner.ts` is a count-only bounded
runner and does not write inventory or admit a source.

```sh
bun test src/server/ingestion/rohner-*.test.ts
bun run check
```

The source runs unless its pause flag serves false. All work remains local and unpublished under
the user's instruction. Saved replay and memory persistence do not verify
remote snapshot capacity or authorize production source enablement.
