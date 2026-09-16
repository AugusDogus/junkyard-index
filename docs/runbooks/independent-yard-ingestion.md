# iPull-uPull, Washington U-Pull-It, and Parts Galore

All three use public HTTP inventory, without browser sessions or API credentials.
They emit canonical vehicles, yard metadata, raw accounting, and presence evidence
through the existing durable checkpoint contract. No schema migration is required.
See [provider photos and inventory links](provider-media-links.md) for image
enrichment, destination contracts, and manual-search limitations.

## Endpoints and checkpoints

| Source        | Inventory                                                                                                                   | Checkpoint                                                    | Minimum accepted vehicles |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| `ipullupull`  | [Unfiltered CSV](https://ipullupull.com/inventory-pricing/?ipull_export=1&slug=inventory-pricing&type=inventory&format=csv) | Atomic catalog `0` to `1`                                     | 3,000                     |
| `upullitwa`   | [Yard-filtered HTML](https://go2upullit.com/inventory/ANY/ANY/?k=1&id=ANY&view=table&pagenum=1)                             | Two native pages per chunk; stable yard IDs and page evidence | 1,500                     |
| `partsgalore` | [Complete HTML table](https://parts-galore.com/inventory/)                                                                  | Atomic catalog `0` to `1`                                     | 500                       |

iPull-uPull accepts `Available` vehicles, including full-service row 999. Sold
assets and row 300 (pre-pulled engines/transmissions only) are excluded without
presence protection, allowing former whole-vehicle listings to retire. Current
location cards on the public directory establish yard eligibility before any
vehicle can be emitted or observed. Navigation/footer links do not establish it.
Unlisted or unidentified cities receive no presence protection. For listed yards,
unknown statuses, unavailable yard details, and unusable descriptive metadata
preserve independently usable VINs. Directory failures or incomplete/ambiguous
markup abort the catalog; a failed individual yard-details request does not
invalidate its confirmed eligibility. Catalog completeness is checked against
currently listed cities, not a historical city list. Pre-1981 identifiers are retained.
The CSV is limited to 20,000 rows and 4 MiB. CSV, metadata, bulk media enrichment,
and callbacks share a five-minute checkpoint budget. Requests, including retries,
share a one-request-per-second gate. Public card `data-gallery` images join by
stock, VIN, and yard; `data-parts` photos are not vehicle images. Media pages hold
up to 96 cards, bounded to 4 MiB each and 20,000 total assets. Incomplete/drifting pages,
malformed media, or missing emitted-vehicle coverage abort before callbacks;
retry from cursor `0`. Explicit empty galleries retain null images with warnings.
Metadata comes from same-origin directory links and each yard's JSON-LD.

Washington discovers yards from the inventory selector and verifies the selected
yard on every response. Follow validated Next links, never short-page heuristics.
Page-count changes, repeated pages, missing known yards, incomplete markup, and
partial HTTP responses fail closed. The cursor carries traversal evidence, not
VIN inventory; snapshots own cross-chunk deduplication and exact final counts.
Unknown yards preserve usable VINs pending metadata verification.
Published image sources are preserved, including relative URLs; missing/placeholder
images remain null. Outbound links persist yard and VIN search without a page number.

Parts Galore reads exactly one complete `#alldata` table. Its bounded catalog
(10,000 rows, 5 million HTML characters, two-minute budget) is delivered in local
batches of 250 without inventing provider pages. Invalid descriptive metadata
preserves usable VINs; malformed table structure fails closed.
The salvage table publishes no vehicle photos or persistent vehicle links.
`imageUrl` and `detailsUrl` remain null; the UI offers a labeled manual search.

## Yard metadata

- iPull-uPull: Fresno, Pomona, Sacramento, Stockton CA. Address, coordinates,
  and phone come from [public location pages](https://ipullupull.com/locations/).
- Washington: Pasco `JJ65`, Yakima `UU43`, Kennewick `UU44`. Contact blocks at
  [go2upullit.com](https://go2upullit.com/) supply addresses and phone numbers;
  their linked map place pins supply coordinates.
- Parts Galore: Detroit `PG-DETROIT`, 11360 E 8 Mile Rd. The
  [contact page](https://parts-galore.com/contact/) supplies address/phone and its
  embedded map's place pin supplies coordinates. Only one current yard is verified.

## Verification

```sh
bun run soak:sources -- --sources=ipullupull,upullitwa,partsgalore --cycles=1
bun run check
bun test src
```

The soak discards inventory and makes no production persistence, search, or alert
writes. Full read-only observations, not production deployment verification:

| Source               | Observed   | Yards | Unique emitted | HTTP requests | Seconds |
| -------------------- | ---------- | ----: | -------------: | ------------: | ------: |
| iPull-uPull          | 2026-09-16 |     4 |          4,043 |            51 |    62.6 |
| Washington U-Pull-It | 2026-09-15 |     3 |          2,480 |             8 |     8.9 |
| Parts Galore         | 2026-09-15 |     1 |          1,059 |             1 |     0.9 |

iPull-uPull's 51 requests include 45 bulk media pages. Of 4,043 emitted vehicles,
3,880 had photos and 163 had explicit empty galleries. Its 4,286 CSV rows included
38 rejected, 53 unlocated, 137 parts-only, and 15 sold; unlocated records supplied
no presence protection. `pagesProcessed: 1` remains the atomic checkpoint count.
Washington accounted for 2,481 rows including one duplicate; Parts Galore emitted
all 1,059 rows. Measured runs had no rate limits or network errors.

Pre-implementation VIN samples matched neither Row52 active inventory nor
AutoRecycler global search: iPull-uPull 0/80 (20 per yard), Washington 0/45
(15 per yard), Parts Galore 0/40, in each aggregator. Both lookups passed positive
controls. Sample absence does not establish catalog-wide exclusivity.

On schema/pagination errors, inspect the public endpoint before changing parser
contracts or bounds. On unresolved yard warnings, verify public metadata before
adding coordinates. Do not weaken snapshot minimums to accept a collapsed crawl.
