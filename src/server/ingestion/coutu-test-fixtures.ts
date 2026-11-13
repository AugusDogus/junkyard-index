import type { CoutuControl, CoutuRecord } from "./coutu-parser";

export const coutuFixtureMake: CoutuControl = {
  path: "/browse/ford",
  label: "FORD",
};
export const coutuFixtureModel: CoutuControl = {
  path: "/browse/ford/f250",
  label: "F250",
};
export const coutuFixtureOtherModel: CoutuControl = {
  path: "/browse/ford/f350",
  label: "F350",
};
export const coutuFixtureRecord = (
  index: number,
  model = "F250",
): CoutuRecord => [
  "1FT" + String(index).padStart(14, "0"),
  "2000",
  "2000",
  "FORD",
  model,
  "FORD",
  model,
  "ST" + index,
  "https://www.truckcountry.us/browse/vehicle/" + index,
  null,
];
export const coutuFixtureDocument = (main: string) =>
  `<html><body><main>${main}</main><footer>Truck Country 1535 W Main St Willimantic, CT 06226 <a href="tel:8604236004">860-423-6004</a></footer></body></html>`;
const crumbs = (make?: CoutuControl, model?: CoutuControl) =>
  `<nav><a href="/">Home</a><a href="/browse">Browse</a>${make ? `<a href="${make.path}">${make.label}</a>` : ""}${model ? `<a href="${model.path}">${model.label}</a>` : ""}</nav>`;
export const coutuFixtureHome = coutuFixtureDocument(
  '<section id="about">About Our Work Truck Parts Yard, shipped from our Willimantic, Connecticut warehouse.</section>',
);
export function coutuFixtureDirectory(
  controls: CoutuControl[],
  parent?: CoutuControl,
) {
  return coutuFixtureDocument(
    `${crumbs(parent)}<h1>${parent ? "Select Model for " + parent.label : "Select Your Vehicle Make"}</h1><div id="view-categories"><div>${controls.map((c) => `<a href="${c.path}"><h3>${c.label}</h3><p>123 in stock</p></a>`).join("")}</div></div>`,
  );
}
export function coutuFixtureModelPage(
  records: CoutuRecord[],
  make = coutuFixtureMake,
  model = coutuFixtureModel,
) {
  return coutuFixtureDocument(
    `${crumbs(make, model)}<h1>Browse ${make.label} ${model.label}</h1><button id="tab-categories">Browse Parts by Category</button><button id="tab-vehicles">Browse by Vehicles (${records.length})</button><div id="view-categories"></div><div id="view-vehicles"><div>${records.map((r) => `<div><div>${r[9] ? `<img src="${r[9]}">` : ""}<div><span>Stock #${r[7]}</span><span>${r[1]}</span></div><h3>${r[2]} ${r[3]} ${r[4]}</h3><div><span>VIN</span><span>${r[0]}</span><span>Mileage</span><span>0</span></div></div><a href="${r[8]}">See Parts</a></div>`).join("")}</div></div>`,
  );
}
