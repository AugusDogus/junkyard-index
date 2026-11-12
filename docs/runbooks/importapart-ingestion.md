# Importapart inventory

Importapart publishes its current donor inventory at `https://importapart.com/blogs/part-outs`. The native heading says `CURRENT INVENTORY`, and the introduction says these are vehicles currently being parted out. A component marked `SOLD` does not establish that the whole donor is inactive.

The single physical yard is Importapart, 7373 Hazelwood Ave, Hazelwood, MO 63042, 314-502-3104. Native `AutoPartsStore` JSON-LD establishes the address and phone on listing and donor pages. Donor descriptions repeat the address. Current descriptions call the business a full-service salvage yard and describe parts pulled to order and local pickup. Older descriptions use `Hazelwood Avenue, Hazelwood MO 63042`. The coordinate pair `38.77462, -90.34407` comes from the separately saved ASYD `importapart-hazelwood-mo` directory map row. Coordinates are not claimed to be native map evidence.

## Traversal and checkpoints

The connector follows native page links from the first listing through the terminal page. Every nonterminal page must publish 12 complete donor cards. Each card supplies its detail URL and title. Detail URLs must remain on the exact HTTPS native `/blogs/part-outs/<slug>` route, without query, credentials or fragment. URL slugs never supply year, make or model.

One request unit is a listing page, donor detail or ordered bookend. The default chunk processes up to 16 units, with a two-minute budget and a gate of one request per 1.6 seconds. Each request and response body has a 25-second limit. Responses must be complete, unredirected HTTP 200 HTML. The shared bounded reader rejects oversized, invalid UTF-8 or truncated bodies. Requests are never retried by this connector.

The durable cursor progresses through `catalog`, `details`, `verify` and `complete`. It retains the enumerated native pages and thin donor header records so resume validation can recompute observed VIN uniqueness, required-field acceptance and record ordering. Previously accepted donor details are not fetched again. Completion requires unchanged ordered first and last listing pages, at least one accepted donor and no more than 10% required-field rejection across the full census. Duplicate native URLs or valid VINs fail the traversal, including VINs belonging to rejected records.

## Native identity and optional metadata

Year comes from the specific native listing/detail title. The description header explicitly supplies make and model, including posts whose display title omits make. A specific description year must agree with the title. Native shorthand year ranges must include the specific title year. Published make and primary model must agree across title and description, while native trim and chassis detail may vary. Descriptive chassis or trim tokens before an explicit make are allowed. Parts compatibility paragraphs never supply donor identity.

The parser reads the first description paragraph. Two native posts place their labelled VIN and scalar fields in an immediately adjacent second paragraph, which is accepted only when that paragraph starts with `VIN:`. A standalone native 17-character VIN is accepted without requiring a label. `inventoryVin` validates the source-published identity. No checksum, decoded-year, filename, URL or stock inference supplies missing required metadata.

Color, stock, photos, inventory date and yard position are optional. The connector retains a validated native stock when available. Color, photos, date and position remain null. Article publication, build date and an unlabeled `Date:` do not become inventory dates. Unverified optional scalar text does not reject an otherwise complete donor.

The native BMW Z4 post ending `2004-bmw-z4-3-0l-convertible-139k-miles-part-out` publishes a 2004 listing/detail title and a 2003 description header. It is rejected for that direct source conflict. Its valid native VIN, `4USBT53433LU05343`, is retained as presence evidence. The VIN is not decoded to choose a replacement year.

## Saved qualification and verification

The saved census contains seven listing pages with counts `12, 12, 12, 12, 12, 12, 4`, 76 distinct donor posts, 75 accepted unique donors, one required rejection (1.32%) and no duplicate VINs. Fresh saved first/last bookends match the original ordered URL/title pairs. The actual connector replay completes 85 saved requests across six resumable chunks with 85 verified body hashes. It performs zero live HTTP requests and zero production writes.

Authoritative source receipts and body mapping:

- `.scratchpad/coverage/parallel-sc-platforms/importapart-requalification/catalog-audit.json`
- `.scratchpad/coverage/parallel-sc-platforms/importapart-requalification/records.json`
- `.scratchpad/coverage/parallel-sc-platforms/importapart-requalification/enumeration-plan.json`
- `.scratchpad/coverage/parallel-mn-ia-ne-sd/refill01/evidence/asyd-global-map-data.body`, with its adjacent receipt, for directory coordinate provenance.

Actual connector replay evidence:

- `.scratchpad/coverage/parallel-il-mo-ks/requalification/evidence/importapart-provider-replay.json`
- `.scratchpad/coverage/parallel-il-mo-ks/requalification/evidence/importapart-qualified-vehicles.json`
- `.scratchpad/coverage/parallel-il-mo-ks/requalification/evidence/importapart-rejected-presence-vins.json`
- `.scratchpad/coverage/parallel-il-mo-ks/requalification/helpers/replay_importapart.ts`

Run `bun test src/server/ingestion/importapart` for focused checks. The count-only `scripts/soak-importapart.ts` harness accepts a caller-provided chunk runner, aggregates accounting and presence, and does not persist inventory. Use the saved replay for deterministic verification. A live soak requires the normal authorized read scope and never implies production publication.
