import type { FenixRecord, FenixOrder } from "./fenix-parser";
import {
  FENIX_NATIVE_MAP_COORDINATES,
  FENIX_YARDS,
  type FenixYardCode,
} from "./fenix-yard-metadata";

export const fenixTestRecord = {
  id: "204015747",
  datePlacedInYard: "11/10/26",
  make: "FORD",
  model: "EXPEDITION",
  year: "2004",
  row: "65",
  vin: "1FMFU16LX4LA25851",
  stock: "204015747",
  location: "Elmira, NY",
  photoUrl:
    "https://fenixupull.com/wp-content/uploads/2026/11/204015747_1-150x100.jpg",
} satisfies FenixRecord;
export function fenixTestRow(record: FenixRecord = fenixTestRecord) {
  return `<tr>${[record.datePlacedInYard, record.make, record.model, record.year, record.row, record.vin, record.stock, record.location, `<a href="/inventory/${record.id}">${record.photoUrl ? `<img src="${record.photoUrl}">` : ""}</a>`, `<a href="/inventory/${record.id}">More Info</a>`].map((v) => `<td>${v}</td>`).join("")}</tr>`;
}
export function fenixTestPage(
  rows = fenixTestRow(),
  yard: FenixYardCode = "elmira",
  order: FenixOrder = "DESC",
  page = 1,
  last = 1,
) {
  const opposite = order === "DESC" ? "ASC" : "DESC";
  const url = (n: number) =>
    `/recent-inventory/?sort_column=date_placed&sort_direction=${order}&pg=${n}`;
  const contacts = Object.values(FENIX_YARDS)
    .map((y) => {
      const native = FENIX_NATIVE_MAP_COORDINATES[y.code];
      return `<div class="fnx-ls-location-card"><div>${y.city}</div><div>${y.address}</div><div>${y.city}, ${y.state} ${y.postalCode}</div><a href="https://www.google.com/maps?ll=${native.lat},${native.lng}!3d${native.lat}!4d${native.lng}">Directions</a><a href="tel:${y.phone.slice(2)}">Phone</a><a href="${y.websiteUrl}">Site</a></div>`;
    })
    .join("");
  return `<html><body class="${yard}-${FENIX_YARDS[yard].state.toLowerCase()}">View the full inventory of cars placed in our yard. Our inventory is always being updated.
  <table id="inv-table"><thead><tr><th onclick="window.location.href='/recent-inventory/?sort_column=date_placed&sort_direction=${opposite}&pg=${page}'">Date Placed In Yard</th>${["Make", "Model", "Year", "Row", "VIN", "Stock Number", "Location", "Image", ""].map((v) => `<th>${v}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><div class="fnx-pagination">${page} of ${last} <a href="${url(page + 1)}">&gt;</a><a href="${url(last)}">&gt;&gt;</a></div>${contacts}</body></html>`;
}
