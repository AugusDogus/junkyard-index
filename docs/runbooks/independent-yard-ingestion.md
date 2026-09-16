# iPull-uPull, Washington U-Pull-It, and Parts Galore

All three use public HTTP inventory, without browser sessions or API credentials.
They emit canonical vehicles, yard metadata, raw accounting, and presence evidence
through the existing durable checkpoint contract. No schema migration is required.

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
The CSV is limited to 20,000 rows, 4 MiB, and a five-minute checkpoint budget.
Metadata comes from same-origin directory links and each yard's JSON-LD.

Washington discovers yards from the inventory selector and verifies the selected
yard on every response. Follow validated Next links, never short-page heuristics.
Page-count changes, repeated pages, missing known yards, incomplete markup, and
partial HTTP responses fail closed. The cursor carries traversal evidence, not
VIN inventory; snapshots own cross-chunk deduplication and exact final counts.
Unknown yards preserve usable VINs pending metadata verification.

Parts Galore reads exactly one complete `#alldata` table. Its bounded catalog
(10,000 rows, 5 million HTML characters, two-minute budget) is delivered in local
batches of 250 without inventing provider pages. Invalid descriptive metadata
preserves usable VINs; malformed table structure fails closed.

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
writes. September 15, 2026 full crawl:

| Source               | Yards | Unique emitted | HTTP requests | Seconds |
| -------------------- | ----: | -------------: | ------------: | ------: |
| iPull-uPull          |     4 |          4,033 |             6 |     5.2 |
| Washington U-Pull-It |     3 |          2,480 |             8 |     8.9 |
| Parts Galore         |     1 |          1,059 |             1 |     0.9 |

No 429s or network errors. iPull-uPull accounted for 4,275 rows: 4,033 emitted,
37 rejected, 53 unlocated, 137 parts-only, and 15 sold. Washington accounted for
2,481 rows, including one duplicate. Parts Galore emitted all 1,059 rows.

After the eligibility change, the September 16 iPull-uPull crawl emitted 4,043
vehicles from four listed yards in six requests (5.2 seconds). Its 4,286 rows
included 38 rejected, 53 without an identifiable yard, 137 parts-only, and 15 sold.
There were no rate limits or network errors. The unlocated records did not supply
presence protection.

Pre-implementation VIN samples matched neither Row52 active inventory nor
AutoRecycler global search: iPull-uPull 0/80 (20 per yard), Washington 0/45
(15 per yard), Parts Galore 0/40, in each aggregator. Both lookups passed positive
controls. Sample absence does not establish catalog-wide exclusivity.

On schema/pagination errors, inspect the public endpoint before changing parser
contracts or bounds. On unresolved yard warnings, verify public metadata before
adding coordinates. Do not weaken snapshot minimums to accept a collapsed crawl.
