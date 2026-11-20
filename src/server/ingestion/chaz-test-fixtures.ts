import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  chazHash,
  ChazControlSchema,
  type ChazControl,
  type ChazPage,
  type ChazRecord,
} from "./chaz-parser";
import { CHAZ_IMAGE_PREFIX, CHAZ_ORIGIN } from "./chaz-yard-metadata";

export const chazFixtureMake: ChazControl = {
  path: "/parts/ACURA",
  label: "ACURA",
  count: 901,
};
export const chazFixtureModel: ChazControl = {
  path: "/parts/ACURA/ILX/",
  label: "ILX",
  count: 901,
};
export const chazFixtureRecord = (number: number): ChazRecord => [
  "1HGCM82633A" + String(number).padStart(6, "0"),
  "2003",
  "ACURA ILX",
  "ST" + number,
  "/parts/ACURA/ILX/ST" + number + "/2003",
  null,
  null,
];
export const chazFixturePage = (records: ChazRecord[]): ChazPage => ({
  records,
  hash: chazHash(records),
});
const escape = (raw: string) =>
  raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
export const chazFixtureDocument = (
  body: string,
  title = "Chaz&#039;s Used Auto Parts &amp; Towing",
) =>
  `<html><head><title>${title}</title></head><body><a href="tel:888-212-8775">Call</a><p>6035 Taneytown Pike</p><script>var urgid = 'MD08';</script>${body}</body></html><!-- native cache footer -->`;
export function chazFixtureCard(record: ChazRecord) {
  const [vin, year, title, stock, destination, image, date] = record;
  return `<div id="${escape(stock)}" class="card card-price"><div class="card-img">${image ? `<img src="https://www.chazsauto.com/no-image-min.webp" data-src="${escape(image.includes(":") ? image : CHAZ_IMAGE_PREFIX + image)}">` : ""}</div><div class="card-body"><div class="car-details">${date ? `<b>Enter Date:</b> ${escape(date)}<br/>` : ""}<b>Stock:</b> ${escape(stock)}<br/><b>Year:</b> ${escape(year)}<br/><b>Make/Model :</b> ${escape(title)}<br/><b>Vin :</b> ${escape(vin)}<br/><b>Miles :</b> 999999<br/></div><a href="${escape(destination.startsWith("/") ? CHAZ_ORIGIN + destination : destination)}">See Parts</a><button data-vehicle="${escape(`${year} ${title} - VIN ${vin}`)}">Inquire</button></div></div>`;
}
export function chazFixtureDirectory(
  controls: ChazControl[],
  kind: "makes" | "models",
) {
  return chazFixtureDocument(
    `<div id="iiscont">${kind === "makes" ? '<div class="iisMakesMenu">' : ""}${controls.map((control) => `<a class="btn btn-primary btn-block iis-center-block" href="${escape(CHAZ_ORIGIN + control.path)}">${escape(control.label)} <span class="badge badge-light">${control.count}</span></a>`).join("")}${kind === "makes" ? "</div>" : ""}</div>`,
  );
}
const scope =
  "Some vehicles may not show parts available if we haven't parted them out yet.";
export function chazFixtureModelPage(
  records: ChazRecord[],
  heading = "Used ACURA ILX",
) {
  return chazFixtureDocument(
    `<h2>${escape(heading)}</h2><div id="iiscont">${records.length ? `<p>${scope}</p><input id="dev-table-filter"><div class="card-deck">${records.map(chazFixtureCard).join("")}</div>` : "<h3>No Results Found. Try Browsing Our Parts Or Search Again</h3>"}</div>`,
  );
}
export const chazFixtureRoot = (records: ChazRecord[]) =>
  chazFixtureDocument(
    `<h1>Recent Arrivals</h1><div class="card-deck">${records.map(chazFixtureCard).join("")}</div>`,
    "Recent Arrivals - Chaz&#039;s Used Auto Parts &amp; Towing",
  );
export const chazFixtureContact = chazFixtureDocument(
  `<p>Taneytown, MD 21787</p><a href="tel:410-876-7815">Call</a><iframe src="https://www.google.com/maps/embed?pb=!2sChaz's%20Used%20Auto%20Parts%20%26%20Towing%20Inc"></iframe>`,
);

/** The published graph of the Nov 18, 2026 production run (its saved cursor
 * after 205 GETs): 35 makes and 240 models with their menu badges. Its 167 read
 * model pages list exactly their badge except the dead TOWN & COUNTRY route
 * (badge 8, explicit empty); LINCOLN & TOWN CAR (badge 1) failed that run on
 * the same dead `&` route. */
export const chazFixtureNov18Graph = z
  .array(ChazControlSchema.extend({ models: z.array(ChazControlSchema) }))
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./chaz-test-fixtures/nov18-graph.json.gz", import.meta.url),
        ),
      ).toString("utf8"),
    ),
  );
