# Rusty Hook Pittsburgh inventory

See the current [source flags and census floors](provider-coverage-go-live.md).

This connector covers only the native Pittsburgh catalog at `http://salvage.rustyhooktowing.com/`. The official Rusty Hook root separately publishes Pittsburgh and Harmony catalogs. Each catalog separates its Yard from Loose Parts. Native Pittsburgh details publish VIN, year, make, model and donor condition or parts notes. Catalog membership establishes donor scope; old notes, copyright years and individual sold components do not establish donor removal.

The physical yard is Rusty Hook Auto Salvage, 3015 Mt. Troy Rd., Pittsburgh, PA 15212, base phone 412-657-9522. The catalog header says ext. 2 and the contact body says Extension 3. This discrepancy remains unresolved; metadata retains only the consistent base number.

Coordinates `40.47834, -79.98681` come from the saved ASYD exact-business row `/rows/669`, slug `rusty-hook-auto-salvage-in-pittsburgh-pittsburgh-pa`. The saved ASYD map module explicitly maps row columns 5 and 4 into a GeoJSON Point, and the same slug's saved Pennsylvania card supplies the exact native street and city. These are third-party business coordinates, not a surveyed boundary or native map pin. The latest saved alias screen covers 213 published plus 40 local yards and found no street, phone, name or proximity candidates. The nearest published Pittsburgh yard is Pull-A-Part, approximately 14.06 km away at a different address.

Geography provenance is pinned in `.scratchpad/coverage/parallel-ky-tn-ar/rustyhook-geography-review/geography-gate.json` and `register-40-delta-addendum.json`. No new HTTP or search was needed for that gate.

## Traversal and durable checkpoints

Traversal starts with the exact catalog root. It follows the next numeric page's literal published anchor, then reads every distinct published donor detail once and closes every listing page using its opening URL. Current page counts are `12, 12, 2`, totaling 26 distinct donors including `ID=0`. The highest ID never supplies the count. Nonterminal pages must retain all 12 cards, numeric pagination must be contiguous, and top/bottom controls must agree.

`Next` is a JavaScript form pseudo-link, so it is not executed or converted into a guessed route. Numeric anchors supply native GET destinations. Later pages publish `index.php?SPage=0` as the first-page alias; the verified opening root remains `/`. This traversal never needs to fetch the `SPage=0` alias. The cursor preserves the actual opening URL and published directory, and closing checks compare the same URL, ordered donor labels, membership and pagination. No host upgrade, query repair, guessed ID or guessed continuation is allowed.

The cursor progresses through `catalog`, `details`, `closing` and `complete`. It retains thin native field maps, headings, literal posts, bound image references and body hash/byte receipts. Validation reconstructs the entire contiguous prefix, including rejected identities and optional metadata. Its checksum detects corruption and does not authenticate an externally supplied cursor. Serialized input is capped at 1 MiB before JSON parsing. A run is bounded to 32 listing pages, 384 donors, 448 requests and 32 MiB of response bytes. Growth beyond a bound fails without advancing the returned checkpoint.

No vehicle or yard callback runs until all opening pages, details and closing pages validate. Completion requires at least one accepted donor and no more than the unchanged 10% required-field rejection limit. Duplicate URLs, native identities across donors (including rejected identities), or accepted stock numbers fail the traversal. Shared minimum-count, previous-run drift and cross-source overlap guards remain separate and must still pass. The parent owns source registration and minimum 8; this source runs unless its pause flag serves false.

One unit is one serial GET. A chunk accepts 1 through 3 units. Live calls wait 30 seconds before their first request and use a one-per-30-second limiter, preserving spacing across serial resumes. Active traversal is capped at 90 seconds, with a two-minute total live limit. The loop reserves 55 seconds for the next gate plus request and can pause after fewer units. Each request and complete body has one combined 25-second deadline. Responses must be unredirected HTTP 200 HTML without `Content-Range`, with the exact requested final URL. The bounded shared reader rejects invalid UTF-8, oversized bodies and mismatched uncompressed content length. Requests are never retried.

## Required and optional fields

The literal listing label must match the native detail heading. Native labelled year, make and model must agree with that heading. A usable source VIN or supported older serial is validated by the existing `inventoryVin` helper without check-digit, decoded-year, stock-tail or photo-folder inference. Existing make/color normalization applies after native values are retained.

The 1958 Buick `ID=0` retains `XXXX00000E1031782`, which the existing helper accepts. Its padded-looking prefix remains source provenance uncertainty. No depadding or manufacturer authentication is inferred.

The 2015 Equinox `ID=8` publishes labelled `2GNFLGE35F622462x` and notes `2GNFLGE35F6224627 Actual Vin`. It is a counted `conflicting_native_vin` rejection, with neither identity selected for emission. Both syntax-valid identities supply presence evidence. Exact source fields, including lowercase `x`, remain in the cursor and frozen source packet. This is one rejection out of 26 (3.846%), below the unchanged 10% limit.

Color, stock, images, inventory date and yard position are optional. Native stock strings retain leading zeros. Placeholder `NA` becomes null. Direct image references are retained only when the native host and literal donor VIN folder bind them; no images are fetched. Inventory date, trim and yard position remain null because no source value establishes them. Dates in notes remain notes. Specific sold parts and past parting before testing do not remove the donor; explicit whole-donor removal is rejected.

## Saved verification and operation

Run `bun test src/server/ingestion/rustyhook` for focused parser, transform, checkpoint, traversal, drift, duplicate, response and callback checks.

The saved qualification packet is `.scratchpad/coverage/parallel-mt-wy-nd/rustyhook-requalification/qualification-01/`. It contains the 30 newly authorized qualification GETs, exact 26-row accounting and three closing pages. Opening pages two and three reuse the immediate `release-01` captures. Qualification plus that three-control release used 33 new Rusty Hook GETs. Earlier held landing-route evidence remains frozen.

The actual connector replay is `.scratchpad/coverage/parallel-mt-wy-nd/rustyhook-implementation/replay-saved.ts`. It verifies every frozen qualification manifest entry and each served body hash, blocks unmapped requests, round-trips the actual cursor after each chunk and compares all accepted source fields with the independent frozen oracle. Run it with Bun. It completes 32 logical saved reads (three opening pages, 26 details, three closing pages) across 11 chunks, emits 25 donors once, rejects the one VIN conflict and makes zero live requests. The largest saved cursor is 48,473 bytes. Outputs are `saved-replay.json`, `actual-canonical.json`, `actual-yard.json` and `actual-terminal-cursor.json` in that directory.

The count-only `scripts/soak-rustyhook.ts` harness takes a caller-supplied chunk runner, defaults to the 448-request run bound, clamps each call to three units, validates serialized checkpoints and performs no persistence. A live soak requires a separate authorized source-read scope. This implementation does not authorize publication or production writes.

The five-array overlap screen covers 6,561 frozen rows and found no matches to all 27 observed labelled/note identities. It is bounded saved evidence, not a global or production exclusivity claim. Full source scope, notes and candidate parity were independently reviewed under `.scratchpad/coverage/parallel-ma-ct-ri/rustyhook-source-review/`.

Harmony remains outside this connector. The earlier `https://rustyhookautosalvage.com/inventory/` request ended at `https://rustyhookautosalvage.com/parts-tires/` with native 404 content. Neither failed route is used or retried. Any future Harmony work needs a separately scoped successful literal published control path.
