import { readFileSync } from "node:fs";
import type { RightwayRecord } from "./rightway-parser";

export const rightwayTestRecord: RightwayRecord = {
  dateAdded: "1/3/2025",
  year: "2014",
  make: "Ford",
  model: "Focus",
  stock: "01-01-25",
  color: "Blue",
  vin: "1FADP3F29EL130149",
  nativeUrl:
    "https://rightwayautorecycling.com/vehicle-search/?inventory_id=556",
};
export const rightwayTestHome = `<html><body>
  Rightway Auto Recycling is a you-pull-it yard
  Vehicle List Inventory changes daily
  We are located at 7945 TN 100 W. Decaturville, TN 38329
  731-549-3179
  <a href="https://rightwayautorecycling.com/vehicle-search/">Vehicle Search</a>
  <a href="https://rightwayautorecycling.com/price-list/">Price List</a>
</body></html>`;
export const rightwayTestScript = readFileSync(
  new URL("./rightway-inventory-script.fixture.txt", import.meta.url),
  "utf8",
);
export const rightwayTestColumns = [
  ["inventory_date_added", "Date Added"],
  ["inventory_year", "Year"],
  ["inventory_make", "Make"],
  ["inventory_model", "Model"],
  ["inventory_number", "Stock #"],
  ["inventory_fob", "Color"],
  ["inventory_serial", "VIN"],
] as const;

export function rightwayTestRow(record: RightwayRecord = rightwayTestRecord) {
  const id = new URL(record.nativeUrl).searchParams.get("inventory_id");
  const values = [
    record.dateAdded,
    record.year,
    record.make,
    record.model,
    record.stock,
    record.color,
    record.vin,
  ];
  return (
    `<tr class="wpinventory_item wpinventoryitem-${id} wpinventoryitem-category-Car">` +
    rightwayTestColumns
      .map(
        ([field], index) =>
          `<td class="${field}"><a href="${record.nativeUrl}">${values[index] ?? ""}</a>`,
      )
      .join("") +
    "</td></tr>"
  );
}
export function rightwayTestPage(rows = rightwayTestRow()) {
  return `<html><body>
  As a self-service yard, we invite you to come by and check which parts are still available on each vehicle.
  7945 TN-100 Decaturville, TN 38329 731-549-3179
  <table class="wpinventory_loop wpinventory_loop_all wpinventory_loop_all_table">
    <thead><tr>${rightwayTestColumns.map(([field, label]) => `<th class="wpinventory_label wpinventory_title ${field}">${label}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script id="wpinventory-common-js" src="https://rightwayautorecycling.com/wp-content/plugins/wp-inventory-manager/js/wpinventory.js?ver=2.5.10"></script>
  </body></html>`;
}
