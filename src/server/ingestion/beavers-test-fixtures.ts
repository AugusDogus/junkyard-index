import { readFileSync } from "node:fs";
import type { BeaversRecord } from "./beavers-parser";
import { BEAVERS_CATALOG, BEAVERS_ORIGIN } from "./beavers-yard-metadata";

export const beaversFixture = (name: string) =>
  readFileSync(`${import.meta.dir}/beavers-test-fixtures/${name}.html`, "utf8");

// Synthetic identities exercise connector state transitions. Actual source
// field grammar and missing-make behavior are tested with the saved HTML files.
export function beaversTestRecord(index: number): BeaversRecord {
  const vin = "5J8YD3H36JL" + String(100000 + index);
  const stock = String(260000 + index);
  const row = {
    displayYear: "'18",
    model: "MDX",
    stock,
    vin,
    url: `${BEAVERS_ORIGIN}/VehicleDealerShowParts/503/${10000000 + index}`,
  };
  return {
    row,
    url: `${BEAVERS_ORIGIN}/VehiclePartSearch/503/${10000000 + index}`,
    title: "'18 ACURA MDX",
    displayYear: "'18",
    make: "ACURA",
    model: "MDX",
    vin,
    stock,
    inactive: false,
  };
}
const logo = '<a class="hpdcLogo">BeaversCarSalvage</a>';
export function beaversTestCatalog(page: number, total = 260): string {
  const rows = Array.from(
    { length: Math.min(20, total - (page - 1) * 20) },
    (_, offset) => {
      const record = beaversTestRecord((page - 1) * 20 + offset);
      return `<tr><td>'18</td><td>MDX</td><td>${record.stock}</td><td>UTLT</td><td>222,000</td><td>${record.vin}</td><td>1</td><td><a href="${record.row.url}">Parts</a></td></tr>`;
    },
  ).join("");
  const next =
    page < Math.ceil(total / 20)
      ? `<a href="${BEAVERS_CATALOG}?page=${page + 1}">&gt;</a>`
      : "";
  return `<html>${logo}<p>Showing ${total} Vehicles in Inventory</p><table class="table"><thead><tr>${["Year", "Model", "Stock#", "Body Style", "Mileage", "VIN", "# Parts", ""].map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td>${page}${next}</td></tr></tfoot></table></html>`;
}
export function beaversTestDetail(index: number, missingMake = false): string {
  const record = beaversTestRecord(index);
  const title = missingMake ? "'18 MDX" : record.title;
  return `<html>${logo}<h2>Search By: ${title}</h2><h2>${title}</h2><ul><li>VIN ${record.vin}</li><li>Stock# ${record.stock}</li></ul><div class="optionOneTitle">Showing 1 Available Part(s) for this Vehicle</div></html>`;
}
