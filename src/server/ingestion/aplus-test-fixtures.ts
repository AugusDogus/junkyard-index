import {
  aplusHash,
  type AplusControl,
  type AplusPage,
  type AplusRecord,
} from "./aplus-parser";
import { APLUS_IMAGE_PREFIX, APLUS_ORIGIN } from "./aplus-yard-metadata";

export const aplusFixtureMake: AplusControl = {
  path: "/parts/ACURA",
  label: "ACURA",
  count: 1000,
};
export const aplusFixtureModel: AplusControl = {
  path: "/parts/ACURA/ILX/",
  label: "ILX",
  count: 1000,
};
export const aplusFixtureRecord = (number: number): AplusRecord => [
  "1HGCM82633A" + String(number).padStart(6, "0"),
  "2003",
  "ACURA ILX",
  "ST" + number,
  "/parts/ACURA/ILX/ST" + number + "/2003",
  null,
  null,
];
export const aplusFixturePage = (records: AplusRecord[]): AplusPage => ({
  records,
  hash: aplusHash(records),
});
const escape = (raw: string) =>
  raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
export const aplusFixtureDocument = (body: string, title = "A Plus Auto LLC") =>
  `<html><head><title>${title}</title></head><body><a href="tel:+18594213043">Call</a><p>2125 Catnip Hill Rd</p><script>var urgid = 'QQ91';</script>${body}</body></html><!-- native cache footer -->`;
export function aplusFixtureCard(record: AplusRecord) {
  const [vin, year, title, stock, destination, image, date] = record;
  return `<div id="${escape(stock)}" class="card card-price"><div class="card-img">${image ? `<img src="https://aplusauto.parts/no-image-min.webp" data-src="${escape(image.includes(":") ? image : APLUS_IMAGE_PREFIX + image)}">` : ""}</div><div class="card-body"><div class="car-details">${date ? `<b>Enter Date:</b> ${escape(date)}<br/>` : ""}<b>Stock:</b> ${escape(stock)}<br/><b>Year:</b> ${escape(year)}<br/><b>Make/Model :</b> ${escape(title)}<br/><b>Vin :</b> ${escape(vin)}<br/><b>Miles :</b> 999999<br/></div><a href="${escape(destination.startsWith("/") ? APLUS_ORIGIN + destination : destination)}">See Parts</a><button data-vehicle="${escape(`${year} ${title} - VIN ${vin}`)}">Inquire</button></div></div>`;
}
export function aplusFixtureDirectory(
  controls: AplusControl[],
  kind: "makes" | "models",
) {
  return aplusFixtureDocument(
    `<div id="iiscont">${kind === "makes" ? '<div class="iisMakesMenu">' : ""}${controls.map((control) => `<a class="btn btn-primary btn-block iis-center-block" href="${escape(APLUS_ORIGIN + control.path)}">${escape(control.label)} <span class="badge badge-light">${control.count}</span></a>`).join("")}${kind === "makes" ? "</div>" : ""}</div>`,
  );
}
const scope =
  "Some vehicles may not show parts available if we haven&#8217;t parted them out yet.";
export function aplusFixtureModelPage(
  records: AplusRecord[],
  heading = "Used ACURA ILX Parts",
) {
  return aplusFixtureDocument(
    `<h1>${escape(heading)}</h1><div id="iiscont">${records.length ? `<p>${scope}</p><input id="dev-table-filter"><div class="card-deck">${records.map(aplusFixtureCard).join("")}</div>` : "<h3>No Results Found. Try Browsing Our Parts Or Search Again</h3>"}</div>`,
  );
}
export const aplusFixtureRoot = (records: AplusRecord[]) =>
  aplusFixtureDocument(
    `<h1>Latest Arrivals</h1><div class="card-deck">${records.map(aplusFixtureCard).join("")}</div>`,
    "Latest Arrivals | A Plus Auto LLC",
  );
export const aplusFixtureContact = aplusFixtureDocument(
  `<p>Nicholasville, KY 40356</p><a href="tel:+18597106294">Call</a>`,
);
