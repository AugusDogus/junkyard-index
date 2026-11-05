import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import {
  crawlUpullRPartsMake,
  crawlUpullRPartsMakes,
  UPULLRPARTS_SEARCH_LIMIT,
  type UpullRPartsSearch,
  type UpullRPartsSearchParams,
} from "./upullrparts-make-crawl";

type Row = typeof fixture;

function rows(count: number, fields: Partial<Row>, prefix: string): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    ...fixture,
    ...fields,
    StockNumber: `${prefix}${i}`,
    VIN: `${prefix}VIN${i}`,
  }));
}

/** Serves an inventory like getVehicles: matching rows, newest 100 only. */
function inventory(
  stock: Row[],
  options: { reject?: (params: UpullRPartsSearchParams) => boolean } = {},
) {
  const calls: UpullRPartsSearchParams[] = [];
  const makeOf = new Map<string, string>();
  const search: UpullRPartsSearch = (params) =>
    Effect.sync(() => {
      calls.push(params);
      if (options.reject?.(params)) return [];
      return stock
        .filter(
          (row) =>
            makeOf.get(row.StockNumber) === params.makes &&
            (params.models === "0" || row.Model === params.models) &&
            (params.years === "0" || String(row.Year) === params.years),
        )
        .slice(0, UPULLRPARTS_SEARCH_LIMIT);
    });
  return {
    calls,
    search,
    assign(make: string, list: Row[]) {
      for (const row of list) makeOf.set(row.StockNumber, make);
      return list;
    },
  };
}

const directory = (models: Record<string, string[]>, years: string[] = []) => ({
  models: (make: string) => Effect.succeed(models[make] ?? []),
  years: () => Effect.succeed(years),
});

describe("crawlUpullRPartsMake", () => {
  test("splits a full make by model and keeps every vehicle", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(80, { Model: "FOCUS" }, "F"),
        ...rows(70, { Model: "ESCAPE" }, "E"),
      ]),
    );
    const result = await Effect.runPromise(
      crawlUpullRPartsMake(
        "3",
        "Ford",
        shop.search,
        directory({ Ford: ["FOCUS", "ESCAPE", "TAURUS"] }),
      ),
    );
    expect(result.vehicles).toHaveLength(150);
    expect(result.vehicles.every((vehicle) => vehicle.make === "Ford")).toBe(
      true,
    );
    expect(shop.calls.map((call) => call.models)).toEqual([
      "0",
      "FOCUS",
      "ESCAPE",
      "TAURUS",
    ]);
  });

  test("searches a model again when it drops a vehicle its make returned", async () => {
    const stock: Row[] = [];
    let rejected = 0;
    const shop = inventory(stock, {
      reject: (params) => params.models === "FOCUS" && rejected++ === 0,
    });
    stock.push(
      ...shop.assign("Ford", [
        ...rows(70, { Model: "FOCUS" }, "F"),
        ...rows(50, { Model: "ESCAPE" }, "E"),
      ]),
    );
    const result = await Effect.runPromise(
      crawlUpullRPartsMake(
        "3",
        "Ford",
        shop.search,
        directory({ Ford: ["FOCUS", "ESCAPE"] }),
      ),
    );
    expect(result.vehicles).toHaveLength(120);
    expect(
      shop.calls.filter(
        (call) => call.models === "FOCUS" && call.years === "0",
      ),
    ).toHaveLength(2);
  });

  test("fails the make when a split keeps dropping known vehicles", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock, {
      reject: (params) => params.models === "FOCUS",
    });
    stock.push(...shop.assign("Ford", rows(100, { Model: "FOCUS" }, "F")));
    const result = await Effect.runPromise(
      Effect.either(
        crawlUpullRPartsMake(
          "3",
          "Ford",
          shop.search,
          directory({ Ford: ["FOCUS"] }),
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("omitted 100 vehicles");
  });

  test("searches models the directory omits by name", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Chevrolet", [
        // Unlisted models are discovered only from the newest page.
        ...rows(5, { Model: "UNKNOWN" }, "U"),
        ...rows(60, { Model: "IMPALA" }, "I"),
        ...rows(45, { Model: "MALIBU" }, "M"),
      ]),
    );
    const result = await Effect.runPromise(
      crawlUpullRPartsMake(
        "1",
        "Chevrolet",
        shop.search,
        directory({ Chevrolet: ["IMPALA", "MALIBU"] }),
      ),
    );
    expect(result.vehicles).toHaveLength(110);
    expect(shop.calls.map((call) => call.models)).toContain("UNKNOWN");
  });

  test("splits a full model by year and rejects a year that is still full", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(60, { Model: "FOCUS", Year: 2015 }, "A"),
        ...rows(60, { Model: "FOCUS", Year: 2016 }, "B"),
      ]),
    );
    const split = await Effect.runPromise(
      crawlUpullRPartsMake(
        "1",
        "Ford",
        shop.search,
        directory({ Ford: ["FOCUS"] }, ["2015", "2016"]),
      ),
    );
    expect(split.vehicles).toHaveLength(120);

    stock.push(
      ...shop.assign("Ford", rows(100, { Model: "FOCUS", Year: 2015 }, "C")),
    );
    const full = await Effect.runPromise(
      Effect.either(
        crawlUpullRPartsMake(
          "1",
          "Ford",
          shop.search,
          directory({ Ford: ["FOCUS"] }, ["2015", "2016"]),
        ),
      ),
    );
    expect(full._tag).toBe("Left");
    if (full._tag === "Left")
      expect(full.left.message).toContain("still returned 100");
  });

  test("confirms an empty make once", async () => {
    const shop = inventory([]);
    const result = await Effect.runPromise(
      crawlUpullRPartsMake("3", "Saab", shop.search, directory({})),
    );
    expect(result.vehicles).toEqual([]);
    expect(shop.calls).toHaveLength(2);
  });
});

describe("crawlUpullRPartsMakes", () => {
  const makes = ["Kia", "Acura", "Ford", "Buick"];
  const empty = inventory([]);

  test("pauses after the last started make once the budget runs out", async () => {
    let checks = 0;
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        afterMake: null,
        search: empty.search,
        directory: directory({}),
        makeConcurrency: 1,
        shouldStartMake: () => checks++ < 1,
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.progress).toEqual({ status: "paused", afterMake: "Buick" });
  });

  test("resumes after a make and completes the location", async () => {
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        afterMake: "Buick",
        search: empty.search,
        directory: directory({}),
        makeConcurrency: 2,
        shouldStartMake: () => true,
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.progress).toEqual({ status: "complete" });
  });

  test("always starts one make so a chunk makes progress", async () => {
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        afterMake: null,
        search: empty.search,
        directory: directory({}),
        makeConcurrency: 3,
        shouldStartMake: () => false,
      }),
    );
    expect(result.progress).toEqual({ status: "paused", afterMake: "Acura" });
  });
});
