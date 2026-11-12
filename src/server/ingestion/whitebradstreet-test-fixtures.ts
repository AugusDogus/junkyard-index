import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import { WHITEBRADSTREET_ORIGIN } from "./whitebradstreet-yard-metadata";

export const whitebradstreetContact = `<header><a href="https://maps.app.goo.gl/Ufxo1ycqWZjpHmtX8">1020 Weeks Mills Rd, Augusta, ME 04330, United States</a><a href="tel:207-622-2622">207-622-2622</a></header>`;
export const whitebradstreetRecord: TruckPartsCatalogRecord = {
  id: "193589",
  year: "2010",
  make: "Peterbilt",
  model: "386",
  vin: "1XPHD49X0AD113809",
  stockNumber: "471B",
  imageUrl: null,
  detailsUrl: WHITEBRADSTREET_ORIGIN + "/truck-description/?truck=193589",
  condition: "Salvage",
  engine: null,
};
export function whitebradstreetCard(record: TruckPartsCatalogRecord): string {
  const field = (name: string, value: string) =>
    `<div class='label'><h6>${name} :</h6></div><div class='value'><p>${value}</p></div>`;
  const path = "/truck-description/?truck=" + record.id;
  return `<div class='list-item'><div class='header-list-item'><a href=' ${path}'><h2>${record.year} ${record.make} ${record.model}</h2></a></div>
    <div class='body-list-item'><a href='${path}'><img src='loading.svg'></a>
    ${field("Truck Make", record.make)}${field("Truck Model", record.model)}${field("Vin Number", record.vin)}${field("Lot Number", record.stockNumber ?? "")}${field("Condition", record.condition)}</div>
    <div class='footer-list-item'><a href='${path}'>Click for full truck details</a></div></div>`;
}

export function whitebradstreetPage(
  page = 1,
  total = 26,
  patch?: (
    record: TruckPartsCatalogRecord,
    offset: number,
  ) => TruckPartsCatalogRecord,
): string {
  const start = (page - 1) * 25 + 1;
  const end = Math.min(page * 25, total);
  const last = Math.ceil(total / 25);
  const url = (number: number) =>
    WHITEBRADSTREET_ORIGIN +
    "/trucks/?f-condition=nw&#038;page_number=" +
    number;
  const cards = Array.from({ length: end - start + 1 }, (_, index) => {
    const offset = start + index - 1;
    const record = {
      ...whitebradstreetRecord,
      id: String(193589 - offset),
      vin: "1XPHD49X0AD" + String(113809 - offset),
      stockNumber: String(471 - offset) + "B",
    };
    return whitebradstreetCard(patch ? patch(record, offset) : record);
  }).join("");
  const pager = `<ul class='pagination'><li><span class='pagination-info'>${start}-${end} of ${total}</span></li><li class='active'><a href='#'>${page}</a></li>
    ${page < last ? `<li><a href='${url(page + 1)}'>Next Page</a></li><li><a href='${url(last)}'>Last Page</a></li>` : ""}</ul>`;
  return `<!doctype html><html><body>${whitebradstreetContact}<div class='filter-title'>Current Filters</div><div class='filter-list'><div>Condition: Salvage <a href='/trucks/'>reset</a></div></div><div class='well'></div>${pager}${cards}${pager}</body></html>`;
}

export function whitebradstreetControl(record = whitebradstreetRecord): string {
  const field = (label: string, value: string) =>
    `<div class='detail-title'><p><b>${label}</b></p></div><div class='detail-description'><p>${value}</p></div>`;
  return `<!doctype html><html><body>${whitebradstreetContact}<h1>Lot #${record.stockNumber ?? ""} - Now Wrecking</h1>
    ${field("Year", record.year)}${field("Make", record.make)}${field("Model", record.model)}${field("VIN", record.vin)}${field("Lot Number", record.stockNumber ?? "")}</body></html>`;
}
