import type { AeroRecord } from "./aero-parser";

export const aeroTestRecord: AeroRecord = {
  year: "2004",
  make: "NISSAN",
  model: "TITAN",
  engine: "V8, 5.6L GOOD MOTOR/ GOOD TRAN",
  color: "GRAY",
  vin: "1N6AA06A04N539158",
  stock: "STK004808",
  row: "19",
  arrived: "10/28/26",
  images: ["/inventoryphotos/STK004808-A.jpeg"],
};

export function aeroTestRow(
  record: AeroRecord = aeroTestRecord,
  recent = false,
): string {
  const fields = [
    ["Year", record.year],
    ["Make", record.make],
    ["Model", record.model],
    ["Engine", record.engine],
    ["Color", record.color],
    ...(!recent ? [["VIN", record.vin]] : []),
    ["StockNumber", record.stock],
    ["Row", record.row],
    ...(!recent ? [["Arrived", record.arrived]] : []),
  ];
  return (
    "<tr>" +
    fields
      .map(([key, value]) => `<td data-label="${key}">${value}</td>`)
      .join("") +
    (recent
      ? ""
      : Array.from({ length: 5 }, (_, i) => {
          const image = record.images[i];
          // Native photo cells omit their closing td tags.
          return `<td data-label="Img">${record.stock}${image ? `<a href="${image}"><img src="${image}"></a>` : "<img src='/inventoryphotos/default.png'>"}`;
        }).join("")) +
    "</tr>"
  );
}

export function aeroTestPage(rows: string, recent = false): string {
  const headings = recent
    ? ["Year", "Make", "Model", "Engine", "Color", "Stock #", "Row"]
    : [
        "Year",
        "Make",
        "Model",
        "Engine",
        "Color",
        "VIN",
        "Stock#",
        "Row#",
        "Arrival Date",
        ...Array.from({ length: 5 }, () => "Img"),
      ];
  return `<html><body>Updated: 11/11/26
    <script>$(document).ready(function() { $("#vehicles").dataTable({
      bLengthChange: true, "iDisplayLength": 10, bInfo: false, responsive: true,
      "bAutoWidth": false, "pagingType": "full_numbers", "order": [[6, "desc"]]
    }); });</script>
    <table id="vehicles"><thead><tr>${headings.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
}

export const aeroTestHome = aeroTestPage(
  aeroTestRow(aeroTestRecord, true),
  true,
).replace(
  "<body>",
  "<body>Aero Auto Parts LLC is not affiliated with UAPI. This is a standalone location. 318-227-1010",
);
export const aeroTestDirections =
  "<html><body>Aero Auto Salvage is located at 707 Aero Drive, Shreveport LA 71107 <a href='https://maps.app.goo.gl/6znwuqWSmu21Fy1YA'>Map</a></body></html>";
