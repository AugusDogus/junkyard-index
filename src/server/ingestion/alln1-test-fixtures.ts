import type { Alln1Record } from "./alln1-parser";
export const alln1TestOwner =
  '<html><head><meta name="description" content="All-N-1 Auto Parts is a used auto parts store &amp; self-service junkyard in Kansas City, MO with online part locator tool."></head><body>2408 Blue Ridge Blvd Kansas City, MO 64129 816-252-3930</body></html>';
export const alln1TestRecord = {
  year: "2015",
  make: "CHEVROLET",
  model: "EQUINOX",
  position: "MM-22",
  setDate: "2026-10-19",
  vin: "2GNALCEK8F6347168",
  stock: "262303",
  freshSet: "",
  imageUrl:
    "https://da8h1v3w8q6n5.cloudfront.net/mo42/images/262303/262303_152040.jpg",
} as const satisfies Alln1Record;
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
export function alln1TestRecords(count: number): Alln1Record[] {
  return Array.from({ length: count }, (_, index) => ({
    ...alln1TestRecord,
    vin: "2GNALCEK8F" + String(6000000 + index),
    stock: String(260000 + index),
    imageUrl: null,
  }));
}
export function alln1TestPage(
  records: readonly Alln1Record[] = [alln1TestRecord],
  page = 1,
  lastPage = 1,
): string {
  const link = (target: number, label: string, active = false) =>
    '<li class="page-item' +
    (active ? " active" : "") +
    '"><a href="/inventory/ANY/ANY/?k=1&amp;view=table&amp;pagenum=' +
    target +
    '">' +
    label +
    "</a></li>";
  const nav =
    '<nav class="iis-upull-pagination-wrapper"><ul>' +
    (page > 1 ? link(page - 1, "&laquo; Previous") : "") +
    Array.from({ length: lastPage }, (_, index) =>
      link(index + 1, String(index + 1), index + 1 === page),
    ).join("") +
    (page < lastPage ? link(page + 1, "Next &raquo;") : "") +
    "</ul></nav>";
  const headers = [
    "Image",
    "Year",
    "Make",
    "Model",
    "Row",
    "Date",
    "Vin",
    "Stock #",
    "Fresh Set",
  ];
  return (
    '<html><body><script>var iisupullurgid = \'MO42\';</script><p>Some vehicles may not show parts available if we haven\'t parted them out yet.</p><form method="get" action="/inventory/ANY/ANY/" class="iis-upull-search-form"><input name="k" value="1"><input name="view" value="table"><input name="search" value=""></form>' +
    nav +
    nav +
    '<table class="IISUpullTable" data-toggle="table" data-pagination="true"><thead><tr>' +
    headers.map((name) => "<th>" + name + "</th>").join("") +
    "</tr></thead><tbody>" +
    records
      .map((record) => {
        const image =
          record.imageUrl ??
          "https://via.placeholder.com/348x251?text=No+Image+Available";
        return (
          '<tr><th><a href="' +
          escape(image) +
          '"><img class="main-vehicle-img" src="' +
          escape(image) +
          '"></a></th>' +
          [
            record.year,
            record.make,
            record.model,
            record.position,
            record.setDate,
            record.vin,
            record.stock,
            record.freshSet,
          ]
            .map((value) => "<td>" + escape(value) + "</td>")
            .join("") +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table></body></html>"
  );
}
