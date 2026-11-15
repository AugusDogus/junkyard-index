import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { streamMidwayInventoryWithRequestGate } from "./midway-connector";
import { parseMidwayCatalog, parseMidwayMakeDirectory } from "./midway-parser";
import { MIDWAY_YARDS } from "./midway-yard-metadata";

const capture = z.object({
  url: z.string(),
  status: z.number(),
  headers: z.record(z.string()),
  raw: z.string(),
});
const saved = z
  .object({
    captures: z.array(capture),
    opening: capture,
    closing: capture,
    previous: z.array(
      z.object({ vin: z.string(), stockNumber: z.string().nullable() }),
    ),
    census: z.object({
      result: z.object({
        addressMatches: z.array(
          z.object({ coordinates: z.object({ x: z.number(), y: z.number() }) }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./midway-test-fixtures/tulsa-census.json.gz",
            import.meta.url,
          ),
        ),
        { maxOutputLength: 16 * 1024 * 1024 },
      ).toString("utf8"),
    ),
  );
afterEach(() => spyOn(globalThis, "fetch").mockRestore());

test("Tulsa replays all 59 production make controls, closing and rejection accounting offline", async () => {
  const used = new Set<string>();
  let broad = 0;
  let batches = 0;
  let yards = 0;
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const response =
          url === saved.opening.url
            ? ++broad === 1
              ? saved.opening
              : saved.closing
            : saved.captures.find((c) => c.url === url);
        if (!response) throw new Error("Uncaptured Midway request: " + url);
        expect(new Headers(init?.headers).get("User-Agent")).toContain(
          "Chrome/120",
        );
        expect(new Headers(init?.headers).get("Accept")).toBe(
          "application/json,text/html;q=0.9,*/*;q=0.8",
        );
        used.add(url);
        return new Response(response.raw, {
          status: response.status,
          headers: response.headers,
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const result = await Effect.runPromise(
    streamMidwayInventoryWithRequestGate(
      {
        startCursor: {
          source: "midway",
          phase: "yard",
          yardCode: "OO95",
          observedVins: saved.previous.map((r) => r.vin),
          stocks: saved.previous.flatMap((r) =>
            r.stockNumber ? [r.stockNumber] : [],
          ),
        },
        maxPages: 1,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches++;
            expect(vehicles).toHaveLength(1064);
            expect(
              vehicles.every(
                (v) =>
                  v.stateAbbr === "OK" &&
                  v.detailsUrl === MIDWAY_YARDS.OO95.websiteUrl,
              ),
            ).toBe(true);
          }),
        onYards: (values) =>
          Effect.sync(() => {
            yards++;
            expect(values).toEqual([MIDWAY_YARDS.OO95]);
          }),
      },
      (request) => request,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.accounting).toEqual({
    recordsProcessed: 1083,
    recordsRejected: 19,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(batches).toBe(1);
  expect(yards).toBe(1);
  expect(broad).toBe(2);
  expect(used.size).toBe(61);
  const makes = parseMidwayMakeDirectory(saved.opening.raw, "OO95");
  const counts = makes.map((make) => {
    const response = saved.captures.find(
      (c) =>
        new URL(c.url).pathname === `/inventory/${make.replace(" ", "_")}/ANY/`,
    );
    if (!response) throw new Error("Missing make " + make);
    return parseMidwayCatalog(response.raw, "OO95", make).length;
  });
  expect(counts).toHaveLength(59);
  expect(Math.max(...counts)).toBeLessThan(500);
  expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1083);
  expect(saved.census.result.addressMatches[0]?.coordinates).toEqual({
    x: MIDWAY_YARDS.OO95.lng,
    y: MIDWAY_YARDS.OO95.lat,
  });
});

test("a captured empty make needs the exact native yard and make controls", () => {
  const empty = saved.captures.find((c) => c.url.includes("ALFA_ROMEO"));
  if (!empty) throw new Error("Missing empty response");
  expect(parseMidwayCatalog(empty.raw, "OO95", "ALFA ROMEO")).toEqual([]);
  expect(() => parseMidwayCatalog(empty.raw, "OO95", "FORD")).toThrow(
    "selected make and yard",
  );
  expect(() =>
    parseMidwayCatalog(
      empty.raw.replace('var urgID = "OO95"', 'var urgID = "MO09"'),
      "OO95",
      "ALFA ROMEO",
    ),
  ).toThrow();
});
