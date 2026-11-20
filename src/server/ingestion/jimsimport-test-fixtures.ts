import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  JimsimportControlSchema,
  JimsimportMenuSchema,
  JimsimportPageSchema,
  type JimsimportMenu,
  type JimsimportPage,
} from "./jimsimport-parser";
import { JIMSIMPORT_ORIGIN } from "./jimsimport-yard-metadata";

function read(name: string): unknown {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./jimsimport-test-fixtures/" + name + ".json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  );
}
const native = z
  .record(
    z.string(),
    z.object({
      body: z.string(),
      url: z.string(),
      status: z.literal(200),
      capturedAt: z.string(),
    }),
  )
  .parse(read("native"));
export function jimsimportFixture(name: string) {
  const capture = native[name];
  if (!capture)
    throw new Error("Missing actual native Jim's Import capture: " + name);
  return capture;
}
export function jimsimportOpeningFixture() {
  return z
    .object({
      makes: z.array(JimsimportControlSchema),
      menus: z.array(JimsimportMenuSchema),
      pages: z.array(JimsimportPageSchema),
    })
    .strict()
    .parse(read("opening"));
}

/** Renders a saved opening page as native model HTML, from the CL capture. */
export function nativeModelPage(page: JimsimportPage) {
  const body = jimsimportFixture("cl").body;
  const start = body.indexOf('<div class="aps-la-card-wrapper">');
  let end = body.indexOf("See Inventory</a>");
  for (let closed = 0; closed < 3; closed++)
    end = body.indexOf("</div>", end) + "</div>".length;
  const card = body.slice(start, end);
  const literal = (value: string) => () => value;
  const cards = page.records.map((record) => {
    const [link, parts] = record.destinations;
    if (!link || !parts || record.destinations.length !== 2 || !record.image)
      throw new Error("Fixture renderer covers two links and one image only");
    return card
      .replace('id="2F572"', literal(`id="${record.id}"`))
      .replace(
        /https:\/\/jimsimport\.com\/used-parts\/ACURA\/CL\/2F572\/1999/,
        literal(link),
      )
      .replace(
        /https:\/\/jimsimport\.com\/used-parts\/ACURA\/CL\/2F572\/1999/,
        literal(parts),
      )
      .replaceAll("ACURA CL", literal(record.title))
      .replace("VIN: -", literal("VIN: " + (record.vin ?? "")))
      .replace(
        /(Year<\/span>\s*)1999/,
        (_, label: string) => label + record.year,
      )
      .replace(
        '<div class="aps-la-stat-value">2F572</div>',
        literal(`<div class="aps-la-stat-value">${record.stock}</div>`),
      )
      .replace(/src="[^"]*"/, literal(`src="${record.image}"`));
  });
  return body.slice(0, start) + cards.join("") + body.slice(end);
}

/** Renders a make's model menu as native HTML, from the ACURA capture. */
export function nativeModelMenu(menu: JimsimportMenu) {
  const body = jimsimportFixture("acura").body;
  const open = body.indexOf("<ul", body.indexOf('id="menumodellist"'));
  const start = body.indexOf(">", open) + 1;
  const end = body.indexOf("</ul>", start);
  const rows = menu.models.map(
    (model) =>
      `<li class="iis-col-md-3" id="${model.label}"><a href="${JIMSIMPORT_ORIGIN + model.path}" target="_self" class="btn aps-model-link"><span class="aps-make-link__label">${model.label.replaceAll("_", " ")}</span><span class="badge badge-light aps-make-link__count">${model.count}</span></a></li>`,
  );
  return body.slice(0, start) + rows.join("") + body.slice(end);
}
