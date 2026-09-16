# Washington U-Pull-It images and outbound links

Audited 2026-09-16 against public `go2upullit.com` inventory, starting at `b79e8ba`.

## Verified destination contract

The inventory table's `.iis-upull-search-form` uses GET with `k=1`, `id`,
`view=table`, and `search`. Its search field explicitly supports VIN and stock.
Submitting the Pasco sample VIN in the actual form produced the URL below.
The generated links were then opened in fresh `audit-upullitwa` browser sessions
for each yard. Each showed the selected yard, populated VIN search, and exactly
one visible matching vehicle row. No prior cookies or local filtering were needed.

Before: `https://go2upullit.com/inventory/ANY/ANY/?k=1&id=<yard>&view=table&pagenum=1`.
This was an unfiltered yard page, regardless of the vehicle's current page.

After: the same inventory route with `search=<VIN>` and no `pagenum`.
This is a persistent, vehicle-specific search, not a dedicated vehicle detail page.
The public table links open photo lightboxes, and `iisupull.js` v1.6.6 expands
`data-images` into gallery links. It also exposes `/inventory/search/<stock>`
for the separate stock search. The verified yard+VIN GET form avoids dependence
on that separate route's yard selection. Removed inventory can stop matching.

## Live samples

The images below were preserved unchanged before and after the fix. Each was
decoded by Chromium and visually checked as a vehicle photo in the matching row.
All three use the provider's published `jj65` CDN directory, even at other yards.

| Yard             | Vehicle           | VIN                 | Stock    | Verified destination                                                                                    | Published photo                                                                | Natural size |
| ---------------- | ----------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| Pasco `JJ65`     | 2006 Scion TC     | `JTKDE177660105381` | `2L2241` | [VIN search](https://go2upullit.com/inventory/ANY/ANY/?k=1&id=JJ65&view=table&search=JTKDE177660105381) | [Photo](https://da8h1v3w8q6n5.cloudfront.net/jj65/images/2L2241/2L2241_1.jpg)  | 756 × 1008   |
| Yakima `UU43`    | 2015 Cadillac SRX | `3GYFNBE31FS602685` | `1N1497` | [VIN search](https://go2upullit.com/inventory/ANY/ANY/?k=1&id=UU43&view=table&search=3GYFNBE31FS602685) | [Photo](https://da8h1v3w8q6n5.cloudfront.net/jj65/images/1N1497/1N1497_10.jpg) | 800 × 600    |
| Kennewick `UU44` | 2008 Mazda 3      | `JM1BK343481838384` | `3B0716` | [VIN search](https://go2upullit.com/inventory/ANY/ANY/?k=1&id=UU44&view=table&search=JM1BK343481838384) | [Photo](https://da8h1v3w8q6n5.cloudfront.net/jj65/images/3B0716/3B0716_10.jpg) | 800 × 600    |

Local audit screenshots: `/tmp/opencode/upullitwa-pasco.png`,
`/tmp/opencode/upullitwa-yakima.png`, `/tmp/opencode/upullitwa-kennewick.png`.
The named browser session was closed after verification.

## Image boundary and regression coverage

- Resolve relative `src` against the inventory page, including protocol-relative URLs.
  Previously these became null. Existing HTML entity decoding is covered by tests.
- Empty sources, unsafe protocols, credentials, and no-image placeholders stay null.
  Percent-encoded placeholder query text is now recognized too.
- CSS-only placeholders and gallery links without an image `src` stay null. Do not
  synthesize CDN paths or promote decorative CSS backgrounds into vehicle photos.
- The live missing-photo example was `via.placeholder.com/348x251?text=No+Image+Available`.
  Null remains the correct result when the provider does not publish a real photo.

## Runtime and validation

Zero additional ingestion requests. Image and destination normalization is local.
Native crawl URL validation, pagination, fingerprints, cursor boundaries, and
accounting are untouched. Page 1 returned 379 Pasco, 407 Yakima, and 431 Kennewick
rows during sampling, each advertising two native pages. Browser table pagination
is separate from those native crawl pages.

- `bun test src/server/ingestion/upullitwa-connector.test.ts src/server/ingestion/upullitwa-media-links.test.ts`: 57 pass.
- `bun test src`: 778 pass.
- `bun run check`: lint and typecheck pass.
- Regression tests first reproduced generic links, dropped relative photos, and
  encoded placeholder leakage, then passed with the transform fix.

To recheck, generate canonical vehicles from `parseUpullitwaPage` and
`transformUpullitwaVehicle`, open their `detailsUrl` in a fresh browser, and verify
the yard, search value, VIN/stock row, and image `naturalWidth`/`naturalHeight`.
Inspect the actual photo visually. HTTP 200 alone does not verify the contract.
