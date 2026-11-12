# Clear Salvage ingestion

Source `clearsalvage`, yard `dubois`, uses the public inventory on
`https://clearsalvage.com`. The retained public identity is Clear Salvage LLC.
Its native notice says it is now Sims Metal, DuBois, with the same people and
service. The physical yard is 2608 Carson Hill Road, DuBois, PA 15801,
814-583-5128. Coordinates 41.0776428, -78.7537367 come from the native named
business directions target, not its map viewport. Accuracy is unstated.

## Native census and identity

The native WordPress API index declares the public `inventory` collection and
its page, per-page and ordering parameters. Opening requests use
`/wp-json/wp/v2/inventory?per_page=100&page=1&orderby=id&order=asc`, then the
literal native next links. Each complete response must agree with
`X-WP-Total`, `X-WP-TotalPages`, ascending native IDs, publish/inventory scope,
page size and exact native previous/next links. The API's ACF values are empty;
they do not supply donor YMM or VIN.

Each literal owned donor destination must return complete HTML with the
matching canonical URL and body `postid`. Only primary title and dedicated
`acf_year`, `acf_model`, `acf_vin`, `acf_stock` and `acf_description` spans
outside related `article` cards are collected. Missing primary fields are not
filled from related cards, slugs, publication dates or descriptions.

The title provides the native maker claim. A title merely repeating the
dedicated model provides no separate manufacturer assertion and is rejected.
There is no manufacturer whitelist. Native `NISSIAN` and `OLDMOBILE` spelling
is preserved in the claims; canonical display uses the existing make normalizer.
Model text stays unexpanded. VIN validation uses `inventoryVin` without
decoding a make, year or check digit. Stock is optional; ambiguous stock is null.
Photos, color, arrival date, position, engine, trim and transmission remain null.

## Checkpoints and completion

`ClearsalvageCursor` progresses through start, catalog, details, closing and
complete. It retains typed native page membership, primary claims and body
receipts, with a scope checksum and a 4 MiB wire limit. The persisted one-hour
clock and 128 MiB total retained-body allowance survive pauses. Each serial
GET has a combined 20-second request/body deadline and a 2 MiB body cap,
lowered to the remaining total allowance. Redirects and automatic retries are
disabled. Default chunks contain eight GETs. The supported bounds are 32
catalog pages, 100 donors per page, and all 32 closing pages.

Every opening page is fetched again after all primary details. Ordered native
IDs, titles, literal destinations, counts and pagination must match. No yard or
vehicle callback runs before full closure and the unchanged 10% rejection and
25% duplicate guards pass. A fully closed checkpoint can emit offline. Callback
failures propagate unchanged, and no advanced cursor is returned on failure.
All occurrences of conflicting VIN/YMM identities are quarantined. Valid VINs
from rejected records remain presence evidence. Benign duplicate observations
are counted separately, with optional stock conflicts resolved to null.

The parent workflow owns source registration, default-off enablement, the
minimum count of 150, previous-run drift, cross-source reconciliation and soak.
Do not run new provider requests without the workflow's authorization.

## Saved verification

The 2026-11-12 source qualification captured 183 published inventory posts,
all primary bodies, and stable closing pages. It yields 177 unique donors,
zero benign duplicates and six required-field rejects (3.2787%). Four modern
VINs have invalid lengths, one primary has blank model and VIN, and post 5229
has title/model `PATHFINDER` without a manufacturer assertion. Its valid VIN
`5N1AR18B08C603476` is retained as rejected presence evidence.

`fixtures/clearsalvage-census.json.gz` retains all 183 actual primary headers,
one actual related article per donor, both raw opening/closing API pages and
the original source body hashes. HTML serialization normalizes newlines while
preserving native field values. Tests replay all 187 production controls
(two opening, 183 details, two closing), resume serialized chunks, and cover
required identity, transport/bounds, closing drift and callback failure.

```sh
bun test src/server/ingestion/clearsalvage-parser.test.ts src/server/ingestion/clearsalvage-transform.test.ts src/server/ingestion/clearsalvage-connector.test.ts
```
