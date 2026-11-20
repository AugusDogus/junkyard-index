import { Effect } from "effect";
import {
  DENTON_ABOUT,
  DENTON_CONTACT,
  type DentonResponse,
} from "./denton-client";
import { DentonError } from "./denton-html";
import { DENTON_ARRIVALS, DENTON_MAKES } from "./denton-yard-metadata";

export const dentonTestDocument = (body: string) =>
  `<html><body><script>var urgid = 'KS12';</script>${body}</body></html>`;
export const dentonTestInventory = (body: string) =>
  dentonTestDocument(`<div id="iiscont">${body}</div>`);
export const dentonTestVin = (index: number) =>
  `5FRYD4H51HB${String(index).padStart(6, "0")}`;
export function dentonTestCard(
  index: number,
  model = "MDX",
  vin = dentonTestVin(index),
) {
  return `<div class="card-price"><div class="car-details"><b>Stock:</b> S${index}<br><b>Year:</b> 2017<br><b>Make/Model:</b> ACURA ${model}<br><b>Vin:</b> ${vin}<br></div><a href="//dentonauto.com/used-parts/ACURA/${model}/S${index}/2017">See Parts</a></div>`;
}
export function dentonTestGraph(
  options: {
    accepted?: number;
    rejectsPerPage?: number;
    duplicatesPerPage?: number;
    rowsPerPage?: number;
  } = {},
) {
  const accepted = options.accepted ?? 2000,
    rowsPerPage = options.rowsPerPage ?? 400;
  const makes = "https://dentonauto.com/used-parts/ACURA";
  const pages = new Map<string, string>();
  pages.set(
    DENTON_ABOUT,
    dentonTestDocument(
      "all of our inventory to our Carbondale store at 14580 S Topeka Ave in Carbondale KS 66414. Denton Auto Salvage is a second-generation family-owned business established in 1965",
    ),
  );
  pages.set(
    DENTON_CONTACT,
    dentonTestDocument(
      '14580 South Topeka Ave Carbondale, KS 66414 785-437-2223 <iframe src="https://www.google.com/maps/embed?pb=!2d-95.686134!3d38.80331100000001!2sDenton%20Auto%20Salvage%20Inc"></iframe>',
    ),
  );
  pages.set(
    DENTON_MAKES,
    dentonTestInventory(
      `<div class="iisMakesMenu"><a href="${makes}">ACURA <span class="badge">${accepted}</span></a></div>`,
    ),
  );
  const models: string[] = [];
  for (let start = 0; start < accepted; start += rowsPerPage) {
    const model = `MDX${models.length}`,
      url = makes + "/" + model + "/";
    const count = Math.min(rowsPerPage, accepted - start);
    models.push(
      `<a href="${url}">${model} <span class="badge">${count}</span></a>`,
    );
    const rows = Array.from({ length: count }, (_, offset) =>
      dentonTestCard(start + offset, model),
    );
    rows.push(
      ...Array.from({ length: options.rejectsPerPage ?? 0 }, (_, offset) =>
        dentonTestCard(start + offset, model, ""),
      ),
    );
    rows.push(
      ...Array.from({ length: options.duplicatesPerPage ?? 0 }, (_, offset) =>
        dentonTestCard(start + offset, model),
      ),
    );
    pages.set(url, dentonTestInventory(rows.join("")));
  }
  pages.set(
    makes + "/",
    dentonTestInventory(`<div id="menumodellist">${models.join("")}</div>`),
  );
  pages.set(
    DENTON_ARRIVALS,
    dentonTestDocument(
      '<div class="card-deck">No Results Found. Try Browsing Our Parts Or Search Again</div>',
    ),
  );
  const calls: string[] = [];
  const read = (url: string): Effect.Effect<DentonResponse, DentonError> =>
    Effect.suspend((): Effect.Effect<DentonResponse, DentonError> => {
      calls.push(url);
      // The native server answers any unslashed catalog control with its
      // exact slash 301.
      if (!url.endsWith("/") && pages.has(url + "/"))
        return Effect.succeed({
          kind: "redirect",
          url,
          target: url + "/",
          body: "",
        });
      const body = pages.get(url);
      return body === undefined
        ? Effect.fail(DentonError.create("fixture", "No saved page at " + url))
        : Effect.succeed({ kind: "document", url, body });
    });
  return { pages, calls, read };
}
