import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { streamFenixInventoryWithRequestGate } from "./fenix-connector";
import { FenixCursor, FenixCursorSchema } from "./fenix-cursor";
import { FenixDonor } from "./fenix-donor";
import { parseFenixInventory } from "./fenix-parser";
import { FENIX_LOCATION_PREFERENCES, FENIX_YARDS } from "./fenix-yard-metadata";
const saved = z
  .object({
    captures: z.array(
      z.object({
        yard: z.enum(["elmira", "binghamton", "east-syracuse", "moultrie"]),
        order: z.enum(["DESC", "ASC"]),
        page: z.number(),
        raw: z.string(),
        status: z.number(),
        headers: z.record(z.string()),
      }),
    ),
    census: z.object({
      result: z.object({
        addressMatches: z.array(
          z.object({
            matchedAddress: z.string(),
            coordinates: z.object({ x: z.number(), y: z.number() }),
          }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./fenix-test-fixtures/expanded-census.json.gz",
            import.meta.url,
          ),
        ),
        { maxOutputLength: 64 * 1024 * 1024 },
      ).toString("utf8"),
    ),
  );
afterEach(() => spyOn(globalThis, "fetch").mockRestore());

test("all four Fenix yards replay their complete native censuses and Moultrie's Census geography offline", async () => {
  const used = new Set<string>();
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        expect(headers.get("User-Agent")).toBe("JunkyardIndex/1.0");
        expect(init?.redirect).toBe("error");
        const capture = saved.captures.find(
          (c) =>
            headers.get("Cookie") ===
              "fnx_location=" + FENIX_LOCATION_PREFERENCES[c.yard] &&
            c.order === (url.searchParams.get("sort_direction") ?? "DESC") &&
            c.page === Number(url.searchParams.get("pg") ?? "1"),
        );
        if (!capture) throw new Error("Uncaptured Fenix request: " + url.href);
        used.add(`${capture.yard}/${capture.order}/${capture.page}`);
        return new Response(capture.raw, {
          status: capture.status,
          headers: capture.headers,
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  let cursor: FenixCursor = FenixCursor.initial;
  let moultrieAccepted = 0;
  let total = 0;
  for (let chunk = 0; chunk < 40; chunk++) {
    const result = await Effect.runPromise(
      streamFenixInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 32,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              total += vehicles.length;
              const ga = vehicles.filter((v) => v.locationCode === "moultrie");
              moultrieAccepted += ga.length;
              expect(
                ga.every(
                  (v) =>
                    v.stateAbbr === "GA" &&
                    v.state === "Georgia" &&
                    v.lat === FENIX_YARDS.moultrie.lat &&
                    v.lng === FENIX_YARDS.moultrie.lng &&
                    v.detailsUrl?.startsWith(
                      "https://fenixupull.com/inventory/",
                    ),
                ),
              ).toBe(true);
            }),
        },
        (request) => request,
      ),
    );
    cursor = FenixCursorSchema.parse(JSON.parse(JSON.stringify(result.cursor)));
    if (result.status === "complete") break;
  }
  expect(cursor.phase).toBe("complete");
  if (cursor.phase !== "complete")
    throw new Error("Missing completed source proof");
  const donors = cursor.entries.filter((entry) => entry.yard === "moultrie");
  const rejected = donors.filter(
    (entry) => FenixDonor.parse(entry.record).status === "incomplete",
  ).length;
  expect(donors).toHaveLength(1168);
  expect(moultrieAccepted).toBe(1168 - rejected);
  expect(total).toBe(4595 + moultrieAccepted);
  expect(cursor.verified).toEqual([
    "elmira",
    "binghamton",
    "east-syracuse",
    "moultrie",
  ]);
  expect(used.size).toBe(238);
  expect(saved.census.result.addressMatches[0]?.coordinates).toEqual({
    x: FENIX_YARDS.moultrie.lng,
    y: FENIX_YARDS.moultrie.lat,
  });
  expect(saved.census.result.addressMatches[0]?.matchedAddress).toContain(
    "31788",
  );
}, 120000);

test("Moultrie's published legacy stock detail remains donor-bound", () => {
  const capture = saved.captures.find(
    (c) => c.yard === "moultrie" && c.order === "DESC" && c.page === 24,
  );
  if (!capture) throw new Error("Missing captured terminal page");
  const donor = parseFenixInventory(
    capture.raw,
    "moultrie",
    "DESC",
    24,
  ).records.find((r) => r.id === "STK000524");
  expect(donor?.stock).toBe("STK000524");
  expect(() =>
    parseFenixInventory(
      capture.raw.replaceAll("/inventory/STK000524", "/inventory/STK000525"),
      "moultrie",
      "DESC",
      24,
    ),
  ).toThrow("stock ownership");
});
