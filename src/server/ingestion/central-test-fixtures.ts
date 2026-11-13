import {
  centralHash,
  type CentralControl,
  type CentralPage,
  type CentralRecord,
} from "./central-parser";
import { CENTRAL_IMAGE_PREFIX, CENTRAL_ORIGIN } from "./central-yard-metadata";
export const centralFixtureMake: CentralControl = {
  path: "/used-parts/ACURA",
  label: "ACURA",
  count: 5000,
};
export const centralFixtureModel: CentralControl = {
  path: "/used-parts/ACURA/ILX",
  label: "ILX",
  count: 5000,
};
export const centralFixtureRecord = (
  number: number,
  model = "ILX",
): CentralRecord => [
  "1HGCM82633A" + String(number).padStart(6, "0"),
  "2003",
  "ACURA " + model,
  "ST" + number,
  "/used-parts/ACURA/" + model + "/ST" + number + "/2003",
  null,
];
export const centralFixturePage = (records: CentralRecord[]): CentralPage => ({
  records,
  hash: centralHash(records),
});
const escape = (raw: string) =>
  raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
export const centralFixtureDocument = (body: string) =>
  `<html><body><h1>Central Auto Liquidators</h1><a href="tel:9738273696">Call</a><p>245 Davis Road, Franklin NJ 07416. Thousands of Late Model Cars and Parts On-Site</p><a href="${CENTRAL_ORIGIN}/used-parts/">Parts</a><script>var urgid = 'DD15';</script>${body}</body></html>`;
export const centralFixtureRoot = centralFixtureDocument("");
export function centralFixtureDirectory(
  controls: CentralControl[],
  kind: "makes" | "models",
) {
  return centralFixtureDocument(
    controls
      .map(
        (control) =>
          `<a class="${kind === "makes" ? "aps-make-link" : "aps-model-link"}" href="${escape(CENTRAL_ORIGIN + control.path)}"><span class="aps-make-link__label">${escape(control.label)}</span><span class="aps-make-link__count">${control.count}</span></a>`,
      )
      .join(""),
  );
}
export function centralFixtureCard(record: CentralRecord) {
  const [vin, year, title, stock, destination, image] = record;
  return `<div class="aps-la-card-wrapper"><div class="aps-la-card-premium">${image ? `<div class="aps-la-img-wrap-premium"><img class="aps-la-img-premium" src="${escape(CENTRAL_IMAGE_PREFIX + image)}"></div>` : ""}<a class="aps-la-card-link-premium" href="${escape(destination.startsWith("/") ? CENTRAL_ORIGIN + destination : destination)}"><h3 class="aps-la-title-premium">${escape(title)}</h3><p class="aps-la-subtitle-premium--vin">VIN: ${escape(vin)}</p><div class="aps-la-right-val-premium"><span>Year</span>${escape(year)}</div><div class="aps-la-stat--stock"><div class="aps-la-stat-value">${escape(stock)}</div></div></a></div></div>`;
}
export function centralFixtureModelPage(
  records: CentralRecord[],
  make = centralFixtureMake,
  model = centralFixtureModel,
) {
  return centralFixtureDocument(
    `<h1>Used ${escape(make.label)} ${escape(model.label)}</h1><a class="breadcrumb-item" href="${CENTRAL_ORIGIN + model.path}/">${escape(model.label)}</a><div class="aps-la-grid">${records.map(centralFixtureCard).join("")}</div>`,
  );
}
