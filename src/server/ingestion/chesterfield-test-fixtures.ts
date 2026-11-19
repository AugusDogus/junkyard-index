import type { ChesterfieldRecord } from "./chesterfield-parser";

const signed = (pur: string) =>
  Buffer.from(
    JSON.stringify({
      _rails: { pur, message: "native-test-" + pur, exp: null },
    }),
  ).toString("base64url") +
  "--" +
  "a".repeat(40);
export const chesterfieldRecord: ChesterfieldRecord = {
  yard: "Fort Lee",
  make: "HONDA",
  model: "Accord",
  year: "1990",
  color: "GOLD",
  body: "Sedan",
  engine: "2.2L 4cyl",
  position: "Import 13 F",
  arrivalDate: "10/20/2026",
  stock: "000000085373",
  vin: "1HGCB7669LA067658",
  images: [
    "https://api.yardsmartapp.com/rails/active_storage/representations/redirect/" +
      signed("blob_id") +
      "/" +
      signed("variation") +
      "/image.jpg",
  ],
};

/**
 * Live /newest-cars row captured 2026-11-19. Its make (AMC) is absent from the
 * native search make directory, so no make/model query can return it.
 */
export const chesterfieldOffDirectoryRecord: ChesterfieldRecord = {
  yard: "Richmond",
  make: "AMC",
  model: "RAMBLER",
  year: "1963",
  color: "BLUE",
  body: "Unknown",
  engine: "",
  position: "Chrysler 9 C",
  arrivalDate: "11/18/2026",
  stock: "000000086897",
  vin: "G246747",
  images: [],
};

export function chesterfieldPage(
  records: ChesterfieldRecord[] = [chesterfieldRecord],
  options: { token?: string; makeId?: string; tableCount?: 1 | 3 } = {},
): string {
  const makeId = options.makeId ?? "298";
  const makeName = makeId === "298" ? "HONDA" : "FORD";
  const form = `<form id="basic-search-form" method="post">
  <select id="selected-make"><option value="${makeId}">${makeName}</option><option value="298">HONDA</option><option value="287">FORD</option></select>
  <select id="selected-model"><option selected value="${makeId === "298" ? "5017" : "9001"}">${makeId === "298" ? "Accord" : "F-150"}</option></select>
  <input name="BasicSearch.BeginYear" min="1962" max="2026" value="1962">
  <input name="BasicSearch.EndYear" min="1962" max="2026" value="2026">
  <input name="__RequestVerificationToken" value="${options.token ?? "public-test-state-1"}"></form>`;
  const headers = [
    "Pics",
    "Store",
    "Make",
    "Model",
    "Year",
    "Color",
    "Body",
    "Engine",
    "Yard Row",
    "Set",
  ]
    .map((h) => `<th>${h}</th>`)
    .join("");
  const rows = records
    .map(
      (r) =>
        `<tr><td><button data-target="#${r.make}${r.vin}">Pics</button></td>${[r.yard, r.make, r.model, r.year, r.color, r.body, r.engine, r.position, r.arrivalDate].map((f) => `<td>${f}</td>`).join("")}</tr>`,
    )
    .join("");
  const table = `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  const modals = records
    .map(
      (r) =>
        `<div class="modal fade" id="${r.make}${r.vin}"><div class="modal-content"><h5 class="modal-title">Images for Stock# ${r.stock}</h5>${r.images.map((src) => `<img class="yard-veh-img" src="${src}">`).join("")}</div></div>`,
    )
    .join("");
  return `<html><body>${form}${table.repeat(options.tableCount ?? 1)}${records.length ? "" : "<h2>Sorry, there aren&#x27;t any matches in our current yard vehicle inventory.</h2>"}${modals}</body></html>`;
}
