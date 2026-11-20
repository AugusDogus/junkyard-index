import type { MidwayRecord } from "./midway-parser";
import {
  midwayMakeInventoryUrl,
  type MidwayYardCode,
} from "./midway-yard-metadata";

export const midwayTestRecord = {
  year: "2016",
  make: "CHRYSLER",
  model: "200",
  row: "DR 04- 08",
  arrived: "2026-10-23",
  vin: "1C3CCCAB6GN125544",
  stock: "2604445",
  imageUrl: null,
} satisfies MidwayRecord;

export const midwayTestHome = `<html><body>
Providing Fresh Inventory at a Fair Price is What We Do Best.
Self-Serve Locations Visiting our self-serve locations
Midway U Pull - Muncie 6345 Kansas Ave Kansas City, KS 66111 913-287-6185
Midway U Pull - Liberty 1101 Old State Hwy 210 Liberty, MO 64068 816-781-4886
Midway U Pull - Tulsa 13802 E Apache St Tulsa, OK 74116 918-234-4444
</body></html>`;

export function midwayTestRow(record: MidwayRecord = midwayTestRecord) {
  return `<tr><th scope="row"><img src="/logo.png"></th>${[
    record.year,
    record.make,
    record.model,
    record.row,
    record.arrived,
    record.vin,
    record.stock,
    "",
  ]
    .map((value) => `<td>${value}</td>`)
    .join("")}</tr>`;
}

const yardLabel = (code: MidwayYardCode) =>
  ({ MO38: "Muncie", MO09: "Liberty", OO95: "Tulsa" })[code] + " U-Pull";
const locationSelect = (code: MidwayYardCode) =>
  `<select class="upullsimpleLocation"><option value="ANY">ANY</option>
<option value="${code}" selected>${yardLabel(code)}</option></select>`;
const scopeScript = (code: MidwayYardCode, make: string | undefined) =>
  `<script>var setMake = "${(make ?? "ANY").replace(" ", "_").replace("/", ".")}"
var setModel = "ANY"
var urgID = "${code}"</script>`;

/**
 * A native table page. Without `make` it is the yard's broad view, whose make
 * menu lists `makes`; with `make` it is that make control's page.
 */
export function midwayTestPage(
  rows = midwayTestRow(),
  code: MidwayYardCode = "MO38",
  options: { make?: string; makes?: readonly string[] } = {},
) {
  const action = options.make
    ? new URL(midwayMakeInventoryUrl(code, options.make)).pathname
    : "/inventory/ANY/ANY/";
  const menu = (options.makes ?? [])
    .map((make) => `<option value="${make}">${make}</option>`)
    .join("");
  return `<html><body>
${locationSelect(code)}
<select class="upullsimpleMake"><option>Choose Make...</option><option value="ANY">ANY</option>${menu}</select>
<form action="${action}" class="iis-upull-search-form" method="get">
<input name="k" value="1"><input name="id" value="${code}"><input name="view" value="table"><input name="search" value=""></form>
Some vehicles may not show parts available if we haven't parted them out yet.
<table class="table IISUpullTable" data-toggle="table" data-search="true" data-pagination="true"><thead><tr>${[
    "Image",
    "Year",
    "Make",
    "Model",
    "Row",
    "Date",
    "Vin",
    "Stock #",
    "Fresh Set",
  ]
    .map((heading) => `<th>${heading}</th>`)
    .join("")}</tr></thead><tbody>${rows}</tbody></table>
${scopeScript(code, options.make)}
<script src="//unpkg.com/bootstrap-table@1.21.4/dist/bootstrap-table.min.js?ver=1.8"></script>
</body></html>`;
}

/** A make control's explicit native empty response. */
export function midwayTestEmptyPage(code: MidwayYardCode, make: string) {
  return `<html><body>
${locationSelect(code)}
No Results Found. Try Browsing Our Parts Or Search Again
${scopeScript(code, make)}
</body></html>`;
}
