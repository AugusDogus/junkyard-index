# Kodak Auto inventory

See the current [source flags and census floors](provider-coverage-go-live.md).

Kodak Auto Inc / American Auto Sales & Parts publishes a finite donor roster at
`https://kodakauto.co/pull-a-part`. Its native root identifies the salvage lot at
647 Asheville Hwy, Strawberry Plains, TN 37871 and links that roster. The source
modules do not enable ingestion or write to the database, Algolia, or admission
register. Kodak runs by default; serving false from its source flag pauses it.

The saved 2026-11-12 catalog has 41 cards: 38 accepted, three malformed native
identifiers rejected, no duplicate VINs. The complete snapshot floor is 12.
Required rejection above 10% or benign duplication above 25% blocks completion.
The coordinates 36.0198225, -83.6432872 come from the exact-name, address, phone,
and domain ASYD business JSON-LD. They are a third-party business point.

## Source contract

- Two serial GETs: the HTTPS root, then the exact linked inventory page.
- Each response requires unredirected HTTP 200, HTML MIME, complete UTF-8, a
  complete document, matching canonical URL, native name and primary phone.
- Headers and streamed body share a 20-second deadline and 2 MiB cap. Interruption
  aborts transport and releases the reader; refused responses cancel unread
  bodies. A cancellation failure preserves both the HTTP refusal and cleanup
  error. Chunks are capped at 90 seconds. No retries.
- Each real request is followed by 1.6 seconds of spacing, including failures and
  serialized chunk boundaries.
- Exact GoDaddy `MENU_SECTIONn_ITEMn_TITLE` and `_DESC` fields bind each native
  card. `_IMAGE` and `_PRICE` are optional. Native VIN text outside parsed donor
  descriptions, duplicate field IDs, malformed fields, new inventory/arrival
  links, pagination, forms, and embedded inventory surfaces block completion.
- Card titles supply year, make and model. Decorative section headings do not.
  The MINI donor remains MINI even though it appears in the BMW section.
- `inventoryVin` validates native identifiers with their native years. There is
  no checksum or decoder gate. The native 2016 Dodge Dart description and its VIN
  remain unchanged; the earlier decoder-derived observation is not a repair.
- Every raw variant of a native VIN/YMM conflict is rejected. Valid rejected
  VINs remain presence evidence. Benign duplicates count toward quality guards;
  conflicting optional metadata becomes null.
- The shared inventory roster is the native destination for every donor, as with
  Aero. No donor-specific URLs or synthetic fragments are invented. A shared
  catalog URL is not a claimed one-VIN detail route.
- Printed `#` values are generic menu prices without established stock semantics.
  Stock, date and yard position stay null. Genuine card-bound GoDaddy lazy-image
  URLs and source colors/engine text are retained when usable. Missing or invalid
  optional metadata never rejects a donor.

## Checkpoints and verification

`KodakCursor` has start, inventory and complete phases. A one-request chunk only
verifies root ownership and emits no yards or vehicles. The inventory phase
parses and validates the entire roster before either callback runs. Complete
checkpoints are inert. Checkpoints validate their wire shape; they are not an
authentication mechanism.

`soakKodakInventory` accepts an explicit caller-supplied runner, serializes each
checkpoint, and limits the complete run to two request units. Importing or running
the script alone performs no HTTP and makes no writes.

Run focused checks:

```sh
bun test src/server/ingestion/kodak-*.test.ts
```

Grounded evidence is retained under
`.scratchpad/coverage/parallel-wa-or-id/kodak-saved-donor-review01/` and
`.scratchpad/coverage/parallel-ma-ct-ri/kodak-saved-preflight01/`. Saved replay and
the independent full 25-field oracle are recorded under
`.scratchpad/coverage/parallel-wa-or-id/kodak-source-implementation01/`.
Do not infer missing inventory from a physical-yard census requirement or fetch
new provider pages merely to repeat this saved verification.
