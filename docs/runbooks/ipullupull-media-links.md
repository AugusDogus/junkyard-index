# iPull-uPull media and vehicle links

Verified against the public provider on 2026-09-16. No database writes.

## Contract and fix

The CSV export contains no image fields. The old transform always emitted
`imageUrl: null` and the unfiltered inventory URL. The public inventory cards
publish real vehicle images in their HTML-encoded JSON `data-gallery` attribute.
`data-parts` contains different, pre-pulled-part photos and is not used.

The provider's public `wp-content/plugins/ipullupull-catalog/assets/frontend/js/catalog.js`
implements persistent `ipull_inventory_pricing_search` and
`ipull_inventory_pricing_filter[yard_city|make|model]` parameters. Searching a stock
number and using Copy Link confirms this contract. Cards open image galleries,
not dedicated vehicle-detail routes. Links now use the stock search plus the raw
yard/make/model filters. Without stock, the narrow yard/make/model filter remains.

Enrichment reads unfiltered server-rendered pages with the supported parameters:
`ipull_inventory_pricing_perpage=96`, `ipull_inventory_pricing_sort=stock_number`,
`ipull_inventory_pricing_order=asc`, and `ipull_inventory_pricing_page=N`.
No nonce, browser, paid service, or per-vehicle request is required in ingestion.

- Require complete pages, consistent totals, exact card counts and unique identities.
- Join photos by stock, VIN and yard, including pre-1981 VINs.
- Require media coverage for every vehicle that will be emitted. Missing coverage,
  failed requests or malformed galleries fail before either callback, preserving
  prior data and images. Retry from cursor 0 after inspecting the reported failure.
- Explicit `data-gallery="[]"` retains the vehicle without an image and emits a
  counted warning. Do not use the site's Coming Soon placeholder or part photos.
- Accept only published optimized asset URLs and stock-scoped original uploads.
  Unknown image paths fail visibly for inspection rather than silently losing media.
- Existing directory eligibility, sold/row-300 exclusions, observed VIN handling,
  CSV accounting, 250-vehicle batches and atomic 0/1 checkpoint remain in force.
- All page requests use the existing one-request-per-second gate and retry policy.
  The five-minute checkpoint deadline remains, with 4 MiB/page and 20,000 assets
  bounding media reads. Catalog drift fails the pass instead of guessing a resume offset.

## Full live read-only run

`streamIPullUPullInventory` with an in-memory batch callback completed in **62,591 ms**:

| Measurement                |                           Result |
| -------------------------- | -------------------------------: |
| HTTP requests              | 51 (6 existing + 45 media pages) |
| CSV records                |                            4,286 |
| Public media cards         |                            4,233 |
| Emitted eligible vehicles  |                            4,043 |
| With real upstream photos  |                            3,880 |
| Explicitly empty galleries |                              163 |
| Excluded records           |                              205 |
| Rejected records           |                               38 |
| Duplicates                 |                                0 |

All 12 Beetle/New Beetle vehicles received real images. Exclusions were 53
unidentified yards, 137 row-300 records and 15 sold vehicles. `pagesProcessed: 1`
continues to represent the atomic CSV checkpoint, not the number of HTTP requests.

## Fresh-browser evidence

Used only named session `audit-ipullupull`, closing/reopening between destinations
and closing it after verification. Each link below retained its parameters and
rendered exactly one card with the listed stock, VIN, model and yard. Gallery
interaction rendered the actual ingested image visibly at **1200 x 900**
(`naturalWidth=1200`, `naturalHeight=900`); catalog thumbnails were 400 pixels wide.

| Yard and vehicle        | Stock     | Visible VIN       | Destination                                                                                                                                                                                                                                                 | Ingested image                                                                                         |
| ----------------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Stockton, 1972 Beetle   | STK057825 | 1122642450        | [Vehicle](https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=STK057825&ipull_inventory_pricing_filter%5Byard_city%5D=STOCKTON&ipull_inventory_pricing_filter%5Bmake%5D=VOLKSWAGEN&ipull_inventory_pricing_filter%5Bmodel%5D=BEETLE)   | [Image](https://ipullupull.com/wp-content/uploads/ipullupull-optimized/1b/1b9b8138b8961f0f-large.webp) |
| Sacramento, 1973 Beetle | SAC048605 | 1132387763        | [Vehicle](https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=SAC048605&ipull_inventory_pricing_filter%5Byard_city%5D=SACRAMENTO&ipull_inventory_pricing_filter%5Bmake%5D=VOLKSWAGEN&ipull_inventory_pricing_filter%5Bmodel%5D=BEETLE) | [Image](https://ipullupull.com/wp-content/uploads/ipullupull-optimized/7e/7ed282ecbe462cfe-large.webp) |
| Pomona, 2001 New Beetle | POM067315 | 3VWCT21C61M406529 | [Vehicle](https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=POM067315&ipull_inventory_pricing_filter%5Byard_city%5D=POMONA&ipull_inventory_pricing_filter%5Bmake%5D=VOLKSWAGEN&ipull_inventory_pricing_filter%5Bmodel%5D=NEW+BEETLE) | [Image](https://ipullupull.com/wp-content/uploads/ipullupull-optimized/28/285c8260a9137370-large.webp) |
| Fresno, 2004 New Beetle | FRE116872 | 3VWCD21YX4M307953 | [Vehicle](https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=FRE116872&ipull_inventory_pricing_filter%5Byard_city%5D=FRESNO&ipull_inventory_pricing_filter%5Bmake%5D=VOLKSWAGEN&ipull_inventory_pricing_filter%5Bmodel%5D=NEW+BEETLE) | [Image](https://ipullupull.com/wp-content/uploads/ipullupull-optimized/f8/f8303843f0e0e2ce-large.webp) |

All four image GETs returned `image/webp` with actual `RIFF`/`WEBP` signatures,
respectively 248,042, 207,110, 172,624 and 199,622 bytes. These checks complement
visible browser rendering, rather than relying on HTTP 200 alone.

The fresh-browser [FRE105890 Mazda](https://ipullupull.com/inventory-pricing/?ipull_inventory_pricing_search=FRE105890&ipull_inventory_pricing_filter%5Byard_city%5D=FRESNO&ipull_inventory_pricing_filter%5Bmake%5D=MAZDA&ipull_inventory_pricing_filter%5Bmodel%5D=B-SERIES)
showed VIN `JM2UF3112H0598494`, `data-gallery="[]"` and the site's Coming Soon
placeholder. We correctly retain that vehicle with no image. Public cards for
SAC038430 and SACDATSUN demonstrate part-only listings can omit VIN labels;
they remain in pagination counts but cannot match an eligible CSV identity.
FRE111479 publishes an original stock-scoped JPEG as its first gallery image,
which is supported alongside optimized WebP variants.

## Regression checks

80 provider tests pass across `ipullupull-{client,connector,media,yard-metadata}.test.ts`.
Coverage includes both captured vintage Beetles, stock-filter links, identity
mismatches, original uploads, empty galleries, partial/truncated/oversized pages,
pagination drift/duplicates, shared gating and pre-callback media failures.
`bun run check` passes (lint and TypeScript). No new dependencies.
