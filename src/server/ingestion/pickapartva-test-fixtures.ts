import type { PickapartvaRecord } from "./pickapartva-parser";

export const pickapartvaTestRecord: PickapartvaRecord = {
  cardId: "PAP100000",
  stock: "PAP100000",
  year: "2010",
  make: "FORD",
  model: "FOCUS",
  vin: "1FAHP3FN0AW100000",
  yardCode: "TT87",
  row: "621",
  setDate: "2026-11-10",
  imageUrl: null,
};

const escape = (raw: string) =>
  raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function pickapartvaTestCard(record = pickapartvaTestRecord): string {
  return `<div class="card card-price" id="${escape(record.cardId ?? "")}"><div class="card-img" data-vstock-no="${escape(record.stock)}"><a data-lightbox="${escape(record.stock)}" href="${escape(record.imageUrl ?? "/wp-content/uploads/2025/10/Pick-A-Part-logo-placeholder-1.png")}"><img src="loading.gif"></a></div><div class="card-body"><div class="car-details-uPull"><b>Stock:</b> ${escape(record.stock)}<br><b>Year:</b> ${escape(record.year)}<br><b>Make/Model :</b> ${escape(record.make)} ${escape(record.model)}<br><b>Vin :</b> ${escape(record.vin)}<br><b>Location: </b> ${record.yardCode === "TT87" ? "Fredericksburg" : "Stafford"}<br><b>Row: </b> ${escape(record.row)}<br><b>Set Date: </b> ${escape(record.setDate)}<br><i style="display:none;">Fresh Set</i></div></div></div>`;
}

export function pickapartvaTestRecords(count = 500, offset = 0) {
  return Array.from(
    { length: count },
    (_, index): PickapartvaRecord => ({
      ...pickapartvaTestRecord,
      stock: `PAP${100000 + offset + index}`,
      cardId: `PAP${100000 + offset + index}`,
      vin: `1FAHP3FN0AW${100000 + offset + index}`,
      yardCode: index % 2 === 0 ? "TT87" : "UU81",
    }),
  );
}

const header = `<h1>Search Our Vehicles</h1><h2>U-Pull-It Inventory</h2><p>Vehicles listed in rows 700 - 799, rows 900 &#8211; 999 and rows 1-99 are not U-Pick vehicles.</p>`;
const footer = `<footer>Pick-A-Part Recycled Auto Parts Our Locations Fredericksburg 540-693-1028 9001 Patriot Hwy Fredericksburg, VA 22407 Stafford 540-659-6800 164 Norman Rd. Stafford, VA 22554</footer>`;

/** A native set-date search answer in the live format: the date in the form,
 * empty pagination toolbars and the applied make and yard in the native
 * scripts, or the native "No Results Found" page without a form. */
export function pickapartvaTestSearch(
  records: readonly PickapartvaRecord[],
  date: string,
  id: "ANY" | "TT87" | "UU81" = "ANY",
  make = "ANY",
  makes: readonly string[] = ["FORD", "LAND ROVER"],
): string {
  const path = make.replaceAll(" ", "_");
  const yard = (value: string, label: string) =>
    `<option value="${value}"${value === id ? " selected" : ""}>${label}</option>`;
  const listing = records.length
    ? `<form action="/inventory/${path}/ANY/" class="iis-upull-search-form" method="get"><input name="k" value="1"><input name="id" value="${id}"><input name="search" value="${date}"></form><div class="iis-upull-toolbar-pagination"></div>${records.map(pickapartvaTestCard).join("")}`
    : "<p>No Results Found. Try Browsing Our Parts Or Search Again</p>";
  return `<html><body>${header}<select class="upullsimpleMake"><option value="ANY">ANY</option>${makes.map((value) => `<option value="${value}">${value}</option>`).join("")}</select><select class="upullsimpleLocation">${yard("ANY", "ANY")}${yard("TT87", "Fredericksburg")}${yard("UU81", "Stafford")}</select>${listing}${footer}<script>var iisupullurgid = 'TT87,UU81'; var setMake = "${path}"; var urgID = "${id}";</script></body></html>`;
}

export function pickapartvaTestPage(
  records = [pickapartvaTestRecord],
  page = 1,
  lastPage = 1,
): string {
  const link = (number: number, label = String(number)) =>
    `<a class="page-link" href="/inventory/ANY/ANY/?k=1&amp;id=ANY&amp;pagenum=${number}">${label}</a>`;
  const numbers = Array.from({ length: lastPage }, (_, index) => index + 1);
  return `<html><body><h1>Search Our Vehicles</h1><h2>U-Pull-It Inventory</h2><p>Vehicles listed in rows 700 - 799, rows 900 &#8211; 999 and rows 1-99 are not U-Pick vehicles.</p><select class="upullsimpleMake"><option value="ANY">ANY</option><option value="FORD">FORD</option><option value="LAND ROVER">LAND ROVER</option></select><select class="upullsimpleLocation"><option value="ANY" selected>ANY</option><option value="TT87">Fredericksburg</option><option value="UU81">Stafford</option></select><form action="/inventory/ANY/ANY/" class="iis-upull-search-form" method="get"><input name="k" value="1"><input name="id" value="ANY"><input name="search" value=""></form><ul class="pagination">${page > 1 ? `<li>${link(page - 1, "« Previous")}</li>` : ""}${numbers.map((number) => `<li class="page-item${number === page ? " active" : ""}">${link(number)}</li>`).join("")}${page < lastPage ? `<li>${link(page + 1, "Next »")}</li>` : ""}</ul>${records.map(pickapartvaTestCard).join("")}<footer>Pick-A-Part Recycled Auto Parts Our Locations Fredericksburg 540-693-1028 9001 Patriot Hwy Fredericksburg, VA 22407 Stafford 540-659-6800 164 Norman Rd. Stafford, VA 22554</footer><script>var iisupullurgid = 'TT87,UU81';</script></body></html>`;
}
