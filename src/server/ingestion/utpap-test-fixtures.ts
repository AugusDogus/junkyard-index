import type { UtpapRecord } from "./utpap-parser";

export const utpapTestRecord: UtpapRecord = {
  S3CLIENTID: "1064",
  YARD_NAME: "UTAH PIC-A-PART OGDEN",
  YARD_CITY: "OGDEN",
  YARD_STATE: "UT",
  STOCKNUMBER: "A039820",
  iSTATUS: "0",
  LOCATION: "YARD",
  iYEAR: "2004",
  MAKE: "ACURA",
  MODEL: "MDX",
  VEHICLE_ROW: "128",
  YARD_DATE: "2026-10-28T13:05:49.677",
  COLOR: "GRAY",
  VIN: "2HNYD18664H504098",
  REFERENCE: "V6 3.5L",
};
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function utpapTestXml(
  records: readonly UtpapRecord[] = [utpapTestRecord],
) {
  return (
    '<?xml version="1.0" standalone="yes"?><INVENTORY>' +
    records
      .map(
        (record) =>
          "<ASSET>" +
          Object.entries(record)
            .map(
              ([key, value]) =>
                "<" + key + ">" + escape(value) + "</" + key + ">",
            )
            .join("") +
          "</ASSET>",
      )
      .join("") +
    "</INVENTORY>"
  );
}
export function utpapTestPage(
  options: { stock?: string; photo?: string; date?: string } = {},
) {
  const stock = options.stock ?? utpapTestRecord.STOCKNUMBER;
  return (
    '<html><body><select id="makeSelect"><option value="ACURA">ACURA</option></select>' +
    '<table id="cars-table"><tr>' +
    [
      "Year",
      "Make",
      "Model",
      "Stock#",
      "Engine",
      "Vehicle Row",
      "Date Set",
      "Image",
    ]
      .map((h) => "<th>" + h + "</th>")
      .join("") +
    "</tr><tr>" +
    [
      "2004",
      "ACURA",
      "MDX",
      stock,
      "V6 3.5L",
      "128",
      options.date ?? "10.28.26",
    ]
      .map((c) => "<td>" + c + "</td>")
      .join("") +
    '<td><a href="Ogden-inventory-photos/' +
    stock +
    '.jpeg"><img src="' +
    (options.photo ?? "Ogden-inventory-photos/" + stock + ".jpeg") +
    '"></a></td></tr></table></body></html>'
  );
}
export const utpapTestContact =
  "<html><body>555 W. 17th Street Ogden, UT 84404 (801)612-6446" +
  "255 S. Geneva Road Orem, UT 84058 (801)756-5878" +
  '<a href="https://utpap.com/ogden-inventory/">Ogden</a>' +
  '<a href="https://utpap.com/orem-inventory/">Orem</a></body></html>';
