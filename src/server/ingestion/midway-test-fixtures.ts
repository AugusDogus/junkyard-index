import type { MidwayRecord } from "./midway-parser";
import type { MidwayYardCode } from "./midway-yard-metadata";

export const midwayTestRecord = {
  year: "2016",
  make: "CHRYSLER",
  model: "200",
  row: "DR 04- 08",
  arrived: "2026-10-23",
  vin: "1C3CCCAB6GN125544",
  stock: "2604445",
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

export function midwayTestPage(
  rows = midwayTestRow(),
  code: MidwayYardCode = "MO38",
) {
  return `<html><body>
<select class="upullsimpleLocation"><option value="ANY">ANY</option>
<option value="${code}" selected>${code === "MO38" ? "Muncie" : "Liberty"} U-Pull</option></select>
<form action="/inventory/ANY/ANY/" class="iis-upull-search-form" method="get">
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
<script src="//unpkg.com/bootstrap-table@1.21.4/dist/bootstrap-table.min.js?ver=1.8"></script>
</body></html>`;
}
