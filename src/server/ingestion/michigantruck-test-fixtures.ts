import type { MichigantruckRecord } from "./michigantruck-record";
import {
  MICHIGANTRUCK_CATALOG,
  MICHIGANTRUCK_SALVAGE,
} from "./michigantruck-yard-metadata";

export const michigantruckTestOwnership =
  '<footer>38658 Ford Rd, Westland, MI 48185<a href="tel:+1734-722-3800">734-722-3800</a></footer>';
export function michigantruckTestRecord(
  id: number,
  changes: Partial<MichigantruckRecord> = {},
): MichigantruckRecord {
  return {
    id: String(id),
    year: "2011",
    make: "Freightliner",
    model: "M2 106",
    vin: `1FVACXDT6B${String(id).padStart(7, "0")}`,
    stockNumber: String(id),
    imageUrl: `https://images.truckpartsinventory.com/trucks/6/photo-${id}.webp`,
    detailsUrl: `https://michigantruck.com/truck-details/2011-freightliner-m2-106-truck-delivery-${id}`,
    condition: "Salvage",
    engine: "ISB 175",
    ...changes,
  };
}
export function michigantruckTestCard(record: MichigantruckRecord): string {
  const fields = [
    ["Truck Make", record.make],
    ["Truck Model", record.model],
    ["Body Style", "Truck Delivery"],
    ["Vin Number", record.vin],
    ["Lot Number", record.stockNumber ?? ""],
    ["Condition", record.condition],
    ["Engine Make", "Cummins"],
    ["Engine Model", record.engine ?? ""],
  ];
  return `<div class="list-item"><a href="${record.detailsUrl}"><h2>${record.condition === "Salvage" ? "Salvage" : "Used"} ${record.year} ${record.make} ${record.model} Truck Delivery</h2></a><a href="${record.detailsUrl}"><img data-src="${record.imageUrl ?? ""}"></a>${fields.map(([name, value]) => `<div><h6>${name}:</h6></div><div><p>${value}</p></div>`).join("")}<a href="${record.detailsUrl}">Click for full truck details</a></div>`;
}
export function michigantruckTestPage(
  records: readonly MichigantruckRecord[],
  page: number,
  selected = false,
): string {
  const included = selected
    ? records.filter((record) => record.condition === "Salvage")
    : records;
  const total = included.length,
    last = Math.ceil(total / 25),
    start = (page - 1) * 25;
  const base = selected
    ? MICHIGANTRUCK_SALVAGE + "&"
    : MICHIGANTRUCK_CATALOG + "?";
  const pager = `<ul class="pagination"><li><span class="pagination-info">${start + 1}-${Math.min(start + 25, total)} of ${total}</span></li><li class="active"><a href="#">${page}</a></li>${page < last ? `<li><a href="${base}page_number=${page + 1}">Next Page</a></li><li><a href="${base}page_number=${last}">Last Page</a></li>` : ""}</ul>`;
  const salvage = records.filter(
    (record) => record.condition === "Salvage",
  ).length;
  return `<html><body>${selected ? '<div class="filter-title">Current Filters</div><div class="current-filter-list"><b>Condition:</b> Salvage</div>' : ""}<div class="filter-list" id="conditionFilter"><div class="filter-option">Salvage <div>${salvage}</div></div>${selected ? "" : `<div class="filter-option">Complete <div>${total - salvage}</div></div>`}</div>${pager}${included
    .slice(start, start + 25)
    .map(michigantruckTestCard)
    .join("")}${pager}${michigantruckTestOwnership}</body></html>`;
}
export function michigantruckTestDetail(record: MichigantruckRecord): string {
  const fields = [
    ["Year", record.year],
    ["Make", record.make],
    ["Model", record.model],
    ["VIN", record.vin],
    ["Lot Number", record.stockNumber ?? ""],
    ["Engine Model", record.engine ?? ""],
  ];
  return `<html><body><script type="application/ld+json">${JSON.stringify([{ name: "Salvage", item: MICHIGANTRUCK_SALVAGE }])}</script><div class="desc-title"><h1>Salvage ${record.year} ${record.make} ${record.model} - Lot #${record.stockNumber}</h1></div>${fields.map(([name, value]) => `<div class="tpi-portal-plugin__detail-title"><b>${name}</b></div><div class="tpi-portal-plugin__detail-description"><span>${value}</span></div>`).join("")}${michigantruckTestOwnership}</body></html>`;
}
