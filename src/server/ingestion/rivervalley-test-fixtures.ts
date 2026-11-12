import { RIVERVALLEY_ORIGIN } from "./rivervalley-yard-metadata";

export const rivervalleyContact = `<header><a href="https://maps.app.goo.gl/nTFtNTPAkUHRpDHS9">288 W South Tec Drive, Kankakee, IL 60901</a><a href="tel:815-936-0406">815-936-0406</a></header>`;
export const rivervalleyRecord = {
  id: "196762",
  year: "2014",
  make: "IC Corporation",
  model: "PB105",
  vin: "4DRBUAAN0EB485230",
  stockNumber: "260645",
  condition: "Salvage",
  imageUrl: null,
  engine: "International DT466",
  detailsUrl: RIVERVALLEY_ORIGIN + "/truck-description/?truck=196762",
} as const;

interface FixtureRecord {
  id: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  stockNumber: string | null;
  condition?: string;
}
const field = (name: string, value: string) =>
  `<div class='col-lg-4'><h6>${name} :</h6></div><div class='col-lg-8'><p class='mb-0'>${value}</p></div>`;
export function rivervalleyCard(record: FixtureRecord): string {
  const path = "/truck-description/?truck=" + record.id;
  return `<div class='list-item'><div class='header-list-item'><div class='row'><div class='col-lg-10'><a href=' ${path}'><h2>${record.year} ${record.make} ${record.model}</h2></a></div><div class='col-lg-2'><h6>To be quoted</h6></div></div></div>
    <div class='body-list-item'><a href=' ${path}'><img class='thumb-crop lazy' src='${RIVERVALLEY_ORIGIN}/wp-content/plugins/tpi-portal/shortcodes/img/loading.svg' data-src='${RIVERVALLEY_ORIGIN}/wp-content/plugins/tpi-portal/shortcodes/img/no_image_placeholder.png'></a>
    ${field("Truck Make", record.make)}${field("Truck Model", record.model)}${field("Lot Number", record.stockNumber ?? "")}${field("Vin Number", record.vin)}${field("Condition", record.condition ?? "Salvage")}${field("Engine Make", "International")}${field("Engine Model", "DT466")}</div>
    <div class='footer-list-item'><a href='${path}'>Click for full truck details</a></div></div>`;
}

export function rivervalleyPage(
  page = 1,
  total = 26,
  patch?: (record: FixtureRecord, index: number) => FixtureRecord,
): string {
  const start = (page - 1) * 25 + 1;
  const end = Math.min(page * 25, total);
  const last = Math.ceil(total / 25);
  const url = (number: number) =>
    RIVERVALLEY_ORIGIN +
    "/new-arrivals/?f-condition=nw&#038;page_number=" +
    number;
  const rows = Array.from({ length: end - start + 1 }, (_, index) => {
    const offset = start + index - 1;
    const record: FixtureRecord =
      offset === 0
        ? rivervalleyRecord
        : {
            ...rivervalleyRecord,
            id: String(196762 - offset),
            stockNumber: String(260645 - offset),
            vin: "4DRBUAAN0EB" + String(485230 - offset),
          };
    return rivervalleyCard(patch ? patch(record, offset) : record);
  }).join("");
  const pagination = `<ul class='pagination pagination-sm'><li><span class='pagination-info'>${start}-${end} of ${total}</span></li><li class='active'><a href='#'>${page}</a></li>
    ${page > 1 ? `<li><a href='${url(page - 1)}' data-original-title='Go to previous page'>Previous Page</a></li>` : ""}
    ${page < last ? `<li><a href='${url(page + 1)}' data-original-title='Go to next page'>Next Page</a></li><li><a href='${url(last)}' data-original-title='Go to last page'>Last Page</a></li>` : ""}
    </ul>`;
  return `<!doctype html><html><body>${rivervalleyContact}<div class='tpi-portal-plugin'>
    <div class='filter-title'>Current Filters</div><div class='filter-list'><div><div>Condition: Salvage <a href='${RIVERVALLEY_ORIGIN}/new-arrivals/?'>reset</a></div></div></div>
    <div class='well'><div id='conditionFilter' class='filter-list'><div><div>Salvage<div class='btn-count text-white'>${total}</div></div></div></div></div>
    ${pagination}${rows}${pagination}</div></body></html>`;
}

export function rivervalleyControl(): string {
  const field = (label: string, value: string) =>
    `<div class='detail-title'><p><b>${label}</b></p></div><div class='detail-description'><p>${value}</p></div>`;
  return `<!doctype html><html><body>${rivervalleyContact}<h1>Truck Description</h1><div class='tpi-portal-plugin'><div class='desc-title'><h1>Lot #260645 - Now Wrecking</h1></div><div class='details'>${field("Year", rivervalleyRecord.year)}${field("Make", rivervalleyRecord.make)}${field("Model", rivervalleyRecord.model)}${field("VIN", rivervalleyRecord.vin)}${field("Lot Number", rivervalleyRecord.stockNumber)}</div></div></body></html>`;
}
