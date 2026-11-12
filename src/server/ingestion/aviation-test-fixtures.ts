import {
  aviationHash,
  type AviationControl,
  type AviationPage,
  type AviationRecord,
} from "./aviation-parser";
import {
  AVIATION_IMAGE_PREFIX,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
} from "./aviation-yard-metadata";

export const aviationFixtureMake: AviationControl = {
  path: "/used-parts/ACURA",
  label: "ACURA",
  count: 20,
};
export const aviationFixtureModel: AviationControl = {
  path: "/used-parts/ACURA/ILX",
  label: "ILX",
  count: 20,
};
export const aviationFixtureVin = (number: number) =>
  "1HGCM82633A" + String(number).padStart(6, "0");
export const aviationFixtureRecord = (number: number): AviationRecord => [
  aviationFixtureVin(number),
  "2003",
  "ACURA ILX",
  "ST" + number,
  "/used-parts/ACURA/ILX/ST" + number + "/2003",
  null,
  null,
];
export const aviationFixturePage = (
  records: AviationRecord[],
): AviationPage => ({ records, hash: aviationHash(records) });
export const aviationFixtureDocument = (body: string) =>
  `<html><body><h1>Aviation Auto</h1><a href="tel:520-574-1700">520-574-1700</a>${body}</body></html><!-- cache footer -->`;
const escape = (raw: string) =>
  raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
export function aviationFixtureCard(record: AviationRecord) {
  const [vin, year, title, stock, destination, image, date] = record;
  return `<div class="aps-la-card-premium"><a class="aps-la-card-link-premium" href="${escape(destination.startsWith("/") ? AVIATION_ORIGIN + destination : destination)}"><h3 class="aps-la-title-premium">${escape(title)}</h3><p class="aps-la-subtitle-premium--vin">VIN: ${escape(vin)}</p><div class="aps-la-right-val-premium"><span>Year</span>${escape(year)}</div><div class="aps-la-stat--stock"><div class="aps-la-stat-value">${escape(stock)}</div></div>${date ? `<div class="aps-la-stat--arrive"><div class="aps-la-stat-value">${escape(date)}</div></div>` : ""}</a>${image ? `<img class="aps-la-img-premium" src="${escape(image.includes(":") ? image : AVIATION_IMAGE_PREFIX + image)}">` : ""}</div>`;
}
export function aviationFixtureDirectory(
  controls: AviationControl[],
  kind: "makes" | "models",
) {
  return aviationFixtureDocument(
    `<div class="aps-parts-main" data-type="${kind}">${controls.map((c) => `<a class="${kind === "makes" ? "aps-make-link" : "aps-model-link"}" href="${AVIATION_ORIGIN + c.path}"><span class="aps-make-link__label">${escape(c.label)}</span><span class="aps-make-link__count">${c.count}</span></a>`).join("")}</div>`,
  );
}
export function aviationFixtureModelPage(
  records: AviationRecord[],
  model = aviationFixtureModel,
) {
  return aviationFixtureDocument(
    `<a href="${AVIATION_ORIGIN + model.path}/">${escape(model.label)}</a><div class="aps-parts-main" data-type="vehicles"><p>Some vehicles may not show parts available if we haven't parted them out yet. If you're interested in a specific vehicle, give us a call for more info.</p>${records.map(aviationFixtureCard).join("")}</div>`,
  );
}
export function aviationFixtureRoot(records: AviationRecord[]) {
  return aviationFixtureDocument(
    `<h2>Latest Arrivals</h2><div class="aps-latest-arrivals">${records.map(aviationFixtureCard).join("")}</div><script>var apsFrontend={"makesBrowseUrl":"${AVIATION_MAKES}#aps-search-by-makes"};</script>`,
  );
}
export const aviationFixtureContact = aviationFixtureDocument(
  '<p>5231 East Drexel Tucson, AZ 85706</p><iframe src="https://maps.google.com/maps?q=Aviation%20Auto%20Salvage%20Recycle%205231%20E%20Drexel%20Rd%2C%20Tucson%2C%20AZ%2085706&amp;t=m"></iframe>',
);
