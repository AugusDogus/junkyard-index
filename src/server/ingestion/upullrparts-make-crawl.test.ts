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
    // Models are searched in label order, so a paused make resumes by label.
    expect(shop.calls.map((call) => call.models)).toEqual([
      "0",
      "ESCAPE",
      "FOCUS",
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

  test("pauses inside a split make and resumes after its last searched model", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(40, { Model: "FOCUS" }, "F"),
        ...rows(40, { Model: "ESCAPE" }, "E"),
        ...rows(40, { Model: "TAURUS" }, "T"),
      ]),
    );
    const models = directory({ Ford: ["TAURUS", "FOCUS", "ESCAPE"] });
    let checks = 0;
    const first = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: null,
        shouldContinue: () => checks++ < 1,
      }),
    );
    // Models run in label order; the first search of a chunk is always sent.
    expect(first.progress).toEqual({
      status: "paused",
      at: { model: "FOCUS", year: null },
    });
    if (first.progress.status !== "paused") throw new Error("not paused");
    const second = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: first.progress.at,
        shouldContinue: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    const stocks = [...first.vehicles, ...second.vehicles].map(
      (vehicle) => vehicle.record.StockNumber,
    );
    expect(stocks).toHaveLength(120);
    expect(new Set(stocks).size).toBe(120);
    expect(shop.calls.map((call) => call.models)).toEqual([
      "0",
      "ESCAPE",
      "FOCUS",
      "0",
      "TAURUS",
    ]);
  });

  test("resumes a year split after its last searched year", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(50, { Model: "FOCUS", Year: 2014 }, "A"),
        ...rows(50, { Model: "FOCUS", Year: 2015 }, "B"),
        ...rows(50, { Model: "FOCUS", Year: 2016 }, "C"),
      ]),
    );
    const models = directory({ Ford: ["FOCUS"] }, ["2016", "2014", "2015"]);
    const first = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: null,
        shouldContinue: () => false,
      }),
    );
    expect(first.progress).toEqual({
      status: "paused",
      at: { model: "FOCUS", year: "2014" },
    });
    if (first.progress.status !== "paused") throw new Error("not paused");
    const second = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: first.progress.at,
        shouldContinue: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    const stocks = [...first.vehicles, ...second.vehicles].map(
      (vehicle) => vehicle.record.StockNumber,
    );
    expect(new Set(stocks).size).toBe(150);
    expect(stocks).toHaveLength(150);
    expect(
      shop.calls.filter((call) => call.years !== "0").map((call) => call.years),
    ).toEqual(["2014", "2015", "2016"]);
  });

  test("a resumed make that is no longer full emits only vehicles past the cursor", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(60, { Model: "ESCAPE" }, "E"),
        ...rows(50, { Model: "FOCUS" }, "F"),
      ]),
    );
    const models = directory({ Ford: ["ESCAPE", "FOCUS"] });
    const first = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: null,
        shouldContinue: () => false,
      }),
    );
    expect(first.progress).toEqual({
      status: "paused",
      at: { model: "ESCAPE", year: null },
    });
    if (first.progress.status !== "paused") throw new Error("not paused");
    // 20 FOCUS sell between chunks, so the make search is no longer full.
    stock.splice(60, 20);
    const second = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: first.progress.at,
        shouldContinue: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    const stocks = [...first.vehicles, ...second.vehicles].map(
      (vehicle) => vehicle.record.StockNumber,
    );
    expect(new Set(stocks).size).toBe(90);
    expect(stocks).toHaveLength(90);
  });

  test("a resumed model that is no longer full emits only years past the cursor", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(50, { Model: "FOCUS", Year: 2014 }, "A"),
        ...rows(50, { Model: "FOCUS", Year: 2015 }, "B"),
        ...rows(10, { Model: "ESCAPE", Year: 2015 }, "E"),
      ]),
    );
    const models = directory({ Ford: ["ESCAPE", "FOCUS"] }, ["2014", "2015"]);
    let checks = 0;
    const first = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: null,
        shouldContinue: () => checks++ < 2,
      }),
    );
    expect(first.progress).toEqual({
      status: "paused",
      at: { model: "FOCUS", year: "2014" },
    });
    if (first.progress.status !== "paused") throw new Error("not paused");
    // 5 of the 2015 FOCUS sell, so FOCUS is no longer full but the make is.
    stock.splice(50, 5);
    const second = await Effect.runPromise(
      crawlUpullRPartsMake("1", "Ford", shop.search, models, {
        after: first.progress.at,
        shouldContinue: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    const stocks = [...first.vehicles, ...second.vehicles].map(
      (vehicle) => vehicle.record.StockNumber,
    );
    expect(new Set(stocks).size).toBe(105);
    expect(stocks).toHaveLength(105);
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
  const start = { phase: "crawl", afterMake: null } as const;

  test("pauses after the last finished make once the budget runs out", async () => {
    let checks = 0;
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        resume: start,
        search: empty.search,
        directory: directory({}),
        shouldContinue: () => checks++ < 1,
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.progress).toEqual({
      status: "paused",
      resume: { phase: "crawl", afterMake: "Buick" },
    });
  });

  test("resumes after a make and completes the location", async () => {
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        resume: { phase: "crawl", afterMake: "Buick" },
        search: empty.search,
        directory: directory({}),
        shouldContinue: () => true,
      }),
    );
    expect(result.results).toHaveLength(2);
    expect(result.progress).toEqual({ status: "complete" });
  });

  test("pauses inside a make and resumes it before the next make", async () => {
    const stock: Row[] = [];
    const shop = inventory(stock);
    stock.push(
      ...shop.assign("Ford", [
        ...rows(60, { Model: "ESCAPE" }, "E"),
        ...rows(60, { Model: "FOCUS" }, "F"),
      ]),
      ...shop.assign("Kia", rows(3, { Model: "RIO" }, "K")),
    );
    const models = directory({ Ford: ["ESCAPE", "FOCUS"] });
    const first = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes: ["Kia", "Ford"],
        resume: start,
        search: shop.search,
        directory: models,
        shouldContinue: () => false,
      }),
    );
    expect(first.progress).toEqual({
      status: "paused",
      resume: { phase: "split", make: "Ford", model: "ESCAPE", year: null },
    });
    if (first.progress.status !== "paused") throw new Error("not paused");
    const second = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes: ["Kia", "Ford"],
        resume: first.progress.resume,
        search: shop.search,
        directory: models,
        shouldContinue: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    const stocks = [...first.results, ...second.results].flatMap((result) =>
      result.vehicles.map((vehicle) => vehicle.record.StockNumber),
    );
    expect(stocks).toHaveLength(123);
    expect(new Set(stocks).size).toBe(123);
  });

  test("always finishes one step so a chunk makes progress", async () => {
    const result = await Effect.runPromise(
      crawlUpullRPartsMakes({
        site: "1",
        makes,
        resume: start,
        search: empty.search,
        directory: directory({}),
        shouldContinue: () => false,
      }),
    );
    expect(result.progress).toEqual({
      status: "paused",
      resume: { phase: "crawl", afterMake: "Acura" },
    });
  });
});
