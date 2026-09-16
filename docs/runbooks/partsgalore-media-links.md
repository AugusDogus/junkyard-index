# Parts Galore media and vehicle-link audit

Verified 2026-09-16 against `b79e8ba`, using public read-only requests and the
isolated `agent-browser --session audit-partsgalore` browser.

## Verdict

The existing salvage adapter is the best verified public integration:
`imageUrl: null` and `detailsUrl: https://parts-galore.com/inventory/`.
The destination works, but is a generic inventory search, not a vehicle detail
page or persistent filtered search. Users must select the make/model themselves.
No supported VIN, stock, make/model query parameters or vehicle detail routes
were found in the inspected inventory markup, controls, links, or JavaScript.

## Evidence

- [Inventory](https://parts-galore.com/inventory/) contains all 1,059 salvage
  vehicles in `#alldata`. Columns: Year, Make, Model, VIN, Color, Yard Date, Row.
  There is no stock number or photo column. Across the whole table there are zero
  images and zero anchors; row attributes contain only `data-make` and
  `data-model`. Cells contain plain text, without detail URLs or photo metadata.
- The page's six image elements are site/association logos and a Facebook icon.
  Its structured-data image is the generic `basic-page-header.jpg`, not a
  vehicle photo. Its `partsgalore.lndo.site` canonical is a stale development URL.
- [Inventory JavaScript](https://parts-galore.com/content/js/inventory-search.js)
  hides `table#alldata` on load and attaches change handlers to `#ddlmake`,
  `#ddlmodel`, and `#ddlmodel2`. Those handlers show/hide rows by their data
  attributes. It neither reads/writes URL parameters nor fetches vehicle data.
  The controls are not inside a form. Browser network inspection during filtering
  showed only analytics/recaptcha XHR/fetch traffic, no inventory or media API.
- Selecting make/model leaves the URL at `/inventory/`. Closing the browser and
  opening that URL again resets both selections and hides every inventory row.
  A successful HTTP response alone would not establish a filtered destination.
- The homepage uses the same salvage table. The linked
  [Cheap Used Cars](https://parts-galore.com/used-cars-for-sale/) page is a separate
  20-row retail catalog with prices, stock numbers and some photos, but no VINs.
  Example: stock `PGE073263`, 1980 Dodge D150 Pickup, has
  `/usedcars/vehicleimages/pg1/PGE073263_thumb.jpg`. Other retail rows use
  `/usedcars/vehicleimages/no-image.png`. Neither these stock-keyed photos nor the
  placeholder can be associated with the salvage VINs: the salvage table has no
  stock numbers, and the retail page contains none of the three sampled VINs.
  Matching only year/make/model would not establish vehicle identity.

## Fresh-browser vehicle verification

For each sample, closed the named browser, opened the actual canonical
`detailsUrl`, and selected the published make/model options. Confirmed the exact
VIN in a **visible** row, not merely in hidden HTML. All destinations remained
`https://parts-galore.com/inventory/`; none persisted the selected filters.

| Vehicle                      | VIN/provider identifier  | Row | Visible rows after filtering | Stock / image        |
| ---------------------------- | ------------------------ | --- | ---------------------------- | -------------------- |
| 1979 Oldsmobile Eighty Eight | `3N69R9M338069` (legacy) | 101 | 2                            | Not published / none |
| 1985 Buick Riviera           | `1G4EZ57Y7FE454760`      | 77  | 2                            | Not published / none |
| 2014 Chrysler Town & Country | `2C4RC1CG6ER328677`      | 39  | 20                           | Not published / none |

Reproduction example, starting with a closed session:

```sh
agent-browser --session audit-partsgalore open https://parts-galore.com/inventory/
agent-browser --session audit-partsgalore select '#ddlmake' OLDSMOBILE
agent-browser --session audit-partsgalore select '#ddlmodel2' 'EIGHTY EIGHT'
agent-browser --session audit-partsgalore eval 'JSON.stringify({url:location.href,visibleRows:Array.from(document.querySelectorAll("#alldata tbody tr")).filter(r=>r.getClientRects().length).map(r=>r.innerText)})'
agent-browser --session audit-partsgalore close
```

## Validation and runtime impact

- `bun install --frozen-lockfile`: passed; no dependency changes.
- Live `fetchPartsGaloreCatalog()` plus `transformPartsGaloreVehicle()` parsed
  1,059 rows with zero parser rejections and reproduced all three sample VINs,
  rows, null stock/image fields, and the generic destination above.
- `bun test src/server/ingestion/partsgalore-parser.test.ts src/server/ingestion/partsgalore-transform.test.ts src/server/ingestion/partsgalore-connector.test.ts`:
  48 passed, zero failed. Existing coverage includes legacy IDs, null image and
  generic destination, malformed/truncated catalogs, partial HTTP responses,
  atomic callbacks, accounting, and terminal checkpoints.
- Documentation-only audit: no runtime or request-volume change, no parser or
  accounting guard changes, and no production writes. A future media/link change
  needs upstream evidence of salvage-VIN-associated photos or a fresh-browser
  persistent destination before implementation.
