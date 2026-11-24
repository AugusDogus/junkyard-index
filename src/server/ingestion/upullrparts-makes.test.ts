import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type {
  UpullRPartsSearch,
  UpullRPartsSearchParams,
} from "./upullrparts-date-crawl";
import {
  resolveUpullRPartsMakes,
  UpullRPartsDirectory,
  type UpullRPartsMakeQuery,
  type UpullRPartsVinMakes,
} from "./upullrparts-makes";

// MUSTANG and FORD E250 VAN are listed by two makes, as on the live site.
const directory = UpullRPartsDirectory.index({
  version: 1,
  makes: ["FORD", "Ford", "SHELBY", "CHEVROLET", "Kia"],
  models: {
    FORD: ["MUSTANG", "F150 PICKUP", "FORD E250 VAN"],
    Ford: ["FOCUS"],
    SHELBY: ["MUSTANG"],
    CHEVROLET: ["SILVERADO 1500 PICKUP", "FORD E250 VAN"],
    Kia: [" soul "],
  },
});

const vehicle = (
  vin: string,
  model: string,
  day: string | null = "2026-11-23",
): UpullRPartsMakeQuery => ({ vin, year: 2010, model, day });

const noDecode: UpullRPartsVinMakes = () => Effect.succeed(new Map());

/** Day and make searches answered from `stock`, by `${day}|${raw make}`. */
function searches(stock: Record<string, string[]>) {
  const sent: UpullRPartsSearchParams[] = [];
  const search: UpullRPartsSearch = (params) =>
    Effect.sync(() => {
      sent.push(params);
      return (stock[`${params.beginDate}|${params.makes}`] ?? []).map(
        (vin) => ({ Store: 1, VIN: vin }),
      );
    });
  return { search, sent };
}

describe("UpullRPartsDirectory.index", () => {
  test("lists each model under its canonical makes, merging spellings of one make", () => {
    expect([...(directory.get("MUSTANG")?.keys() ?? [])]).toEqual([
      "Ford",
      "Shelby",
    ]);
    expect([...(directory.get("FOCUS")?.keys() ?? [])]).toEqual(["Ford"]);
    expect([...(directory.get("F150 PICKUP")?.entries() ?? [])]).toEqual([
      ["Ford", "FORD"],
    ]);
    expect([...(directory.get("SOUL")?.keys() ?? [])]).toEqual(["Kia"]);
  });
});

describe("resolveUpullRPartsMakes", () => {
  test("reuses a known VIN's stored make and matches a model one make lists, without a search", async () => {
    const { search, sent } = searches({});
    const result = await Effect.runPromise(
      resolveUpullRPartsMakes({
        site: "1",
        vehicles: [vehicle("KNOWN", "MUSTANG"), vehicle("NEW", "f150 pickup ")],
        known: new Map([["KNOWN", "Ford"]]),
        index: directory,
        search,
        searchBudget: 5,
        decodeVins: noDecode,
      }),
    );
    expect([...result.makes]).toEqual([
      ["KNOWN", "Ford"],
      ["NEW", "Ford"],
    ]);
    expect(sent).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("resolves a model two makes list with one search per arrival day and candidate make", async () => {
    const { search, sent } = searches({
      "2026-11-23|FORD": ["MUST1", "VAN1"],
      "2026-11-23|CHEVROLET": [],
      "2026-11-23|SHELBY": ["MUST2"],
      "2026-11-20|FORD": [],
      "2026-11-20|SHELBY": ["MUST3"],
    });
    const result = await Effect.runPromise(
      resolveUpullRPartsMakes({
        site: "3",
        vehicles: [
          vehicle("MUST1", "MUSTANG"),
          vehicle("MUST2", "MUSTANG"),
          vehicle("VAN1", "FORD E250 VAN"),
          vehicle("MUST3", "MUSTANG", "2026-11-20"),
        ],
        known: new Map(),
        index: directory,
        search,
        searchBudget: 10,
        decodeVins: noDecode,
      }),
    );
    expect(Object.fromEntries(result.makes)).toEqual({
      MUST1: "Ford",
      MUST2: "Shelby",
      VAN1: "Ford",
      MUST3: "Shelby",
    });
    expect(
      sent.map(
        (params) =>
          `${params.site} ${params.beginDate}..${params.endDate} ${params.makes}`,
      ),
    ).toEqual([
      "3 2026-11-23..2026-11-23 CHEVROLET",
      "3 2026-11-23..2026-11-23 FORD",
      "3 2026-11-23..2026-11-23 SHELBY",
      "3 2026-11-20..2026-11-20 FORD",
      "3 2026-11-20..2026-11-20 SHELBY",
    ]);
    expect(result.searches).toBe(5);
  });

  test("decodes the VIN of a model no make lists, or one whose searches did not fit the budget", async () => {
    const decoded: string[] = [];
    const { search, sent } = searches({});
    const result = await Effect.runPromise(
      resolveUpullRPartsMakes({
        site: "1",
        vehicles: [vehicle("UNLISTED", "UNKNOWN"), vehicle("MUST", "MUSTANG")],
        known: new Map(),
        index: directory,
        search,
        searchBudget: 0,
        decodeVins: (vehicles) =>
          Effect.sync(() => {
            decoded.push(...vehicles.map((entry) => entry.vin));
            return new Map([
              ["UNLISTED", "Toyota"],
              ["MUST", "Ford"],
            ]);
          }),
      }),
    );
    expect(sent).toEqual([]);
    expect(decoded).toEqual(["UNLISTED", "MUST"]);
    expect(Object.fromEntries(result.makes)).toEqual({
      UNLISTED: "Toyota",
      MUST: "Ford",
    });
    expect(result.warnings[0]).toContain(
      "did not fit this chunk's search budget",
    );
  });

  test("lists a vehicle nothing resolves under Other with a warning naming it", async () => {
    const result = await Effect.runPromise(
      resolveUpullRPartsMakes({
        site: "1",
        vehicles: [vehicle("MYSTERY", "UNKNOWN", null)],
        known: new Map([["MYSTERY", "Other"]]),
        index: directory,
        search: searches({}).search,
        searchBudget: 5,
        decodeVins: noDecode,
      }),
    );
    expect(result.makes.get("MYSTERY")).toBe("Other");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("MYSTERY (UNKNOWN)");
    expect(result.warnings[0]).toContain("listed under Other");
  });
});
