import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { midwayRecordDigest, openMidwayMakeCensus } from "./midway-catalog";
import { streamMidwayInventoryWithRequestGate } from "./midway-connector";
import { MidwayCursor } from "./midway-cursor";
import {
  parseMidwayCatalog,
  parseMidwayMakeDirectory,
  type MidwayRecord,
} from "./midway-parser";
import { midwayTestEmptyPage, midwayTestHome } from "./midway-test-fixtures";
import type { MidwayCanonicalVehicle } from "./midway-transform";
import {
  MIDWAY_YARDS,
  midwayInventoryUrl,
  midwayMakeInventoryUrl,
} from "./midway-yard-metadata";

// Native captures from November 19, 2026. The Muncie broad table stopped at
// 400 rows (newest first, cut mid-date on 2026-09-18). A same-day Muncie
// `search=2026-09-1` table listed 40 donors dated 2026-09-10 to 2026-09-18,
// 35 of them absent from that broad table. The Liberty JEEP make page and a
// Liberty `search=2026-09` table were captured the same day.
const capture = (name: string) =>
  gunzipSync(
    readFileSync(new URL("./midway-test-fixtures/" + name, import.meta.url)),
    { maxOutputLength: 4 * 1024 * 1024 },
  ).toString("utf8");
const muncieBroad = capture("muncie-broad.html.gz");
const muncieSearch = capture("muncie-search-2026-09-1.html.gz");
const libertyJeep = capture("liberty-jeep.html.gz");
const libertySearch = capture("liberty-search-2026-09.html.gz");

/**
 * A search page carries its non-empty search input, which the connector's
 * scope check refuses by design. These tests read its rows only as evidence,
 * so the input is cleared before parsing.
 */
const searchRecords = (html: string, code: "MO38" | "MO09") =>
  parseMidwayCatalog(
    html.replace(/(name="search" value=")[^"]*"/, '$1"'),
    code,
    undefined,
    true,
  );

/** Each native `<tr>` donor row of a page with its parsed record, in order. */
function nativeRows(html: string, records: readonly MidwayRecord[]) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const rows = [...body.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(
    (match) => match[0],
  );
  expect(rows).toHaveLength(records.length);
  return records.map((record, index) => ({ record, row: rows[index] ?? "" }));
}

const broadRecords = parseMidwayCatalog(muncieBroad, "MO38", undefined, true);
const broadDigests = new Set(broadRecords.map(midwayRecordDigest));
const searchOnly = nativeRows(
  muncieSearch,
  searchRecords(muncieSearch, "MO38"),
).filter(({ record }) => !broadDigests.has(midwayRecordDigest(record)));
/** Every Muncie donor seen in either capture, as native rows. */
const muncieUnion = [...nativeRows(muncieBroad, broadRecords), ...searchOnly];

/**
 * A Muncie make page rendered from the real broad document: its table body
 * holds the native rows of that make from the union of both captures, and its
 * form and scope script name the make. Makes without donors get the native
 * explicit empty response.
 */
function muncieMakePage(make: string) {
  const rows = muncieUnion.filter(({ record }) => record.make === make);
  if (!rows.length) return midwayTestEmptyPage("MO38", make);
  const path = new URL(midwayMakeInventoryUrl("MO38", make)).pathname;
  return muncieBroad
    .replace(
      /<tbody>[\s\S]*?<\/tbody>/,
      `<tbody>${rows.map((r) => r.row).join("")}</tbody>`,
    )
    .replace('action="/inventory/ANY/ANY/"', `action="${path}"`)
    .replace('var setMake = "ANY"', `var setMake = "${make}"`);
}

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

/** Serves home, the captured Muncie broad table and `makePage` responses. */
function serveMuncie(makePage: (make: string) => Response) {
  const requests: string[] = [];
  const makes = new Map(
    parseMidwayMakeDirectory(muncieBroad, "MO38").map((make) => [
      midwayMakeInventoryUrl("MO38", make),
      make,
    ]),
  );
  const html = (body: string) =>
    new Response(body, {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://midwayupull.com/") return html(midwayTestHome);
        if (url === midwayInventoryUrl("MO38")) return html(muncieBroad);
        const make = makes.get(url);
        if (make === undefined)
          throw new Error("Uncaptured Midway request: " + url);
        return makePage(make);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  return requests;
}

const runMuncie = (
  vehicles: MidwayCanonicalVehicle[],
  yards: (typeof MIDWAY_YARDS)[keyof typeof MIDWAY_YARDS][],
) =>
  Effect.runPromise(
    streamMidwayInventoryWithRequestGate(
      {
        startCursor: MidwayCursor.initial,
        maxPages: 1,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (values) =>
          Effect.sync(() => {
            yards.push(...values);
          }),
      },
      (request) => request,
    ),
  );

test("the captured 400-row Muncie broad table is only a capped witness, never a complete census", async () => {
  // Without make pages nothing from the broad table is staged or published.
  const requests = serveMuncie(
    () =>
      new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
  );
  const vehicles: MidwayCanonicalVehicle[] = [];
  const yards: (typeof MIDWAY_YARDS)[keyof typeof MIDWAY_YARDS][] = [];
  await expect(runMuncie(vehicles, yards)).rejects.toThrow(
    "previous inventory is preserved",
  );
  expect(vehicles).toEqual([]);
  expect(yards).toEqual([]);
  expect(broadRecords).toHaveLength(400);
  const census = openMidwayMakeCensus(muncieBroad, "MO38");
  expect(census.openingRows).toBe(400);
  expect(census.makes).toHaveLength(59);
  expect(requests).toEqual([
    "https://midwayupull.com/",
    midwayInventoryUrl("MO38"),
    midwayMakeInventoryUrl("MO38", census.makes[0] ?? ""),
  ]);
});

test("the Muncie make census recovers the 35 donors the capped broad table lacked", async () => {
  expect(searchOnly).toHaveLength(35);
  const requests = serveMuncie(
    (make) =>
      new Response(muncieMakePage(make), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
  );
  const vehicles: MidwayCanonicalVehicle[] = [];
  const yards: (typeof MIDWAY_YARDS)[keyof typeof MIDWAY_YARDS][] = [];
  const result = await runMuncie(vehicles, yards);
  expect(result).toMatchObject({
    status: "paused",
    pagesProcessed: 1,
    cursor: { phase: "opening", yardCode: "MO09" },
    count: 434,
    accounting: { recordsProcessed: 435, recordsRejected: 1 },
  });
  expect(yards).toEqual([MIDWAY_YARDS.MO38]);
  const admitted = new Set(vehicles.map((v) => v.vin));
  expect(searchOnly.filter(({ record }) => !admitted.has(record.vin))).toEqual(
    [],
  );
  expect(vehicles).toHaveLength(434);
  expect(vehicles.every((v) => v.stateAbbr === "KS")).toBe(true);
  // Home, opening, each of the 59 make controls once, closing.
  expect(requests).toHaveLength(62);
  expect(
    requests.filter((url) => url === midwayInventoryUrl("MO38")),
  ).toHaveLength(2);
});

test("the real Liberty JEEP make page lists every September Jeep the Liberty date search found", () => {
  const jeeps = parseMidwayCatalog(libertyJeep, "MO09", "JEEP");
  expect(jeeps).toHaveLength(26);
  const september = searchRecords(libertySearch, "MO09");
  expect(september).toHaveLength(209);
  const septemberJeeps = september.filter((r) => r.make === "JEEP");
  expect(septemberJeeps).toHaveLength(13);
  const listed = new Set(jeeps.map(midwayRecordDigest));
  expect(septemberJeeps.every((r) => listed.has(midwayRecordDigest(r)))).toBe(
    true,
  );
});
