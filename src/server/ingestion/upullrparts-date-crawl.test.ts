import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  crawlUpullRPartsDayByMake,
  crawlUpullRPartsWindows,
  planUpullRPartsWindows,
  UPULLRPARTS_FIRST_DAY,
  UPULLRPARTS_SEARCH_LIMIT,
  UpullRPartsDay,
  type UpullRPartsSearch,
  type UpullRPartsSearchParams,
  type UpullRPartsWindow,
} from "./upullrparts-date-crawl";

/** A site row; getVehicles rows carry no make, so it is kept beside. */
interface Stock {
  make: string;
  row: {
    Store: number;
    VIN: string;
    StockNumber: string;
    Year: number;
    Model: string;
    DateSetData: string;
  };
}

function stock(day: string, count: number, make = "FORD", store = 1): Stock[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `${day.replaceAll("-", "")}${make.slice(0, 2)}${store}${String(i).padStart(3, "0")}`;
    return {
      make,
      row: {
        Store: store,
        VIN: `1FT${id}`.slice(0, 17).padEnd(17, "0"),
        StockNumber: `S${id}`,
        Year: 2010,
        Model: "F150",
        DateSetData: day,
      },
    };
  });
}

/** Answers like getVehicles: dates and make with AND, the newest 100 by
 * date when more match, those ordered by store. Ford is always stocked, so
 * the canary passes unless `blocked`. */
function site(inventory: readonly Stock[], options: { empty?: number } = {}) {
  const sent: UpullRPartsSearchParams[] = [];
  let empty = options.empty ?? 0;
  const search: UpullRPartsSearch = (params) =>
    Effect.sync(() => {
      sent.push(params);
      const canary = params.beginDate === "" && params.endDate === "";
      if (canary) return [{ ...stock("2026-01-05", 1)[0]?.row }];
      if (empty > 0) {
        empty -= 1;
        return [];
      }
      const matches = inventory
        .filter(
          ({ make, row }) =>
            row.DateSetData >= params.beginDate &&
            row.DateSetData <= params.endDate &&
            (params.makes === "" || params.makes === make),
        )
        .map(({ row }) => row)
        .sort((a, b) => (a.DateSetData < b.DateSetData ? 1 : -1));
      return matches
        .slice(0, UPULLRPARTS_SEARCH_LIMIT)
        .sort((a, b) => a.Store - b.Store);
    });
  return { search, sent };
}

const window = (beginDate: string, endDate: string): UpullRPartsWindow => ({
  beginDate,
  endDate,
  expected: 0,
});

describe("planUpullRPartsWindows", () => {
  test("tiles every day from today back to the first day, packing days with no arrivals into their neighbours", () => {
    const counts = new Map([
      ["2026-11-21", 50], // Saturday, as if a row were dated a weekend
      ["2026-11-20", 30],
      ["2026-11-19", 40],
      ["2026-11-17", 60],
    ]);
    const windows = planUpullRPartsWindows({
      end: "2026-11-24",
      counts,
      unknownFrom: "2026-11-25",
      newDayEstimate: 64,
    });
    expect(windows).toEqual([
      { beginDate: "2026-11-20", endDate: "2026-11-24", expected: 80 },
      { beginDate: "2026-11-18", endDate: "2026-11-19", expected: 40 },
      { beginDate: UPULLRPARTS_FIRST_DAY, endDate: "2026-11-17", expected: 60 },
    ]);
    // Contiguous: each window ends the day before the next newer one begins.
    for (let i = 1; i < windows.length; i++)
      expect(UpullRPartsDay.add(windows[i]?.endDate ?? "", 1)).toBe(
        windows[i - 1]?.beginDate ?? "",
      );
  });

  test("starts the oldest window at a stored day before the first day, without walking every day to it", () => {
    expect(
      planUpullRPartsWindows({
        end: "2026-11-24",
        counts: new Map([
          ["2026-11-20", 30],
          ["0001-01-01", 1],
        ]),
        unknownFrom: "2026-11-25",
        newDayEstimate: 64,
      }),
    ).toEqual([
      { beginDate: "0001-01-01", endDate: "2026-11-24", expected: 31 },
    ]);
  });

  test("expects arrivals on business days the snapshot has not seen, so today gets its own window", () => {
    // Published Saturday, November 21; Monday the 23rd is today.
    const windows = planUpullRPartsWindows({
      end: "2026-11-23",
      counts: new Map([["2026-11-20", 60]]),
      unknownFrom: "2026-11-21",
      newDayEstimate: 64,
    });
    expect(windows).toEqual([
      { beginDate: "2026-11-21", endDate: "2026-11-23", expected: 64 },
      { beginDate: UPULLRPARTS_FIRST_DAY, endDate: "2026-11-20", expected: 60 },
    ]);
  });
});

describe("crawlUpullRPartsWindows", () => {
  test("never uses a full result: a full multi-day window is halved by date until each half fits", async () => {
    const inventory = [
      ...stock("2026-11-24", 62),
      ...stock("2026-11-21", 70),
      ...stock("2026-11-20", 55),
    ];
    const { search, sent } = site(inventory);
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [window("2026-11-20", "2026-11-24")],
        search,
        mayStart: () => true,
        mayRecheck: () => true,
      }),
    );
    expect(crawl.progress).toEqual({ status: "complete" });
    const keys = crawl.results.flatMap((result) =>
      result.records.map((record) => record.StockNumber),
    );
    expect(keys).toHaveLength(inventory.length);
    expect(new Set(keys).size).toBe(inventory.length);
    for (const result of crawl.results)
      expect(result.records.length).toBeLessThan(UPULLRPARTS_SEARCH_LIMIT);
    expect(sent[0]).toEqual({
      site: "1",
      beginDate: "2026-11-20",
      endDate: "2026-11-24",
      makes: "",
    });
  });

  test("bisects a stale snapshot's large newest window, as after the November 11 publication", async () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      UpullRPartsDay.add("2026-11-11", i),
    ).filter(UpullRPartsDay.isBusinessDay);
    const inventory = days.flatMap((day) => stock(day, 60));
    const { search } = site(inventory);
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [window(UPULLRPARTS_FIRST_DAY, "2026-11-24")],
        search,
        mayStart: () => true,
        mayRecheck: () => true,
      }),
    );
    expect(crawl.progress).toEqual({ status: "complete" });
    expect(
      crawl.results.reduce((total, result) => total + result.records.length, 0),
    ).toBe(inventory.length);
  });

  test("an empty window runs the canary, is searched once more, and keeps the second result", async () => {
    const { search, sent } = site(stock("2026-11-24", 3), { empty: 1 });
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [window("2026-11-24", "2026-11-24")],
        search,
        mayStart: () => true,
        mayRecheck: () => true,
      }),
    );
    expect(sent.map((params) => params.makes || params.beginDate)).toEqual([
      "2026-11-24",
      "Ford",
      "2026-11-24",
    ]);
    expect(crawl.results[0]?.records).toHaveLength(3);
    expect(crawl.searches).toBe(3);
  });

  test("today's window, empty on a business day the snapshot expects arrivals, is accepted empty only after the canary and one re-search", async () => {
    const [newest] = planUpullRPartsWindows({
      end: "2026-11-23",
      counts: new Map([["2026-11-20", 60]]),
      unknownFrom: "2026-11-21",
      newDayEstimate: 64,
    });
    expect(newest?.expected).toBe(64);
    const { search, sent } = site([]);
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: newest ? [newest] : [],
        search,
        mayStart: () => true,
        mayRecheck: () => true,
      }),
    );
    expect(sent.map((params) => params.makes || params.endDate)).toEqual([
      "2026-11-23",
      "Ford",
      "2026-11-23",
    ]);
    expect(crawl).toMatchObject({
      progress: { status: "complete" },
      results: [{ records: [] }],
    });
  });

  test("an empty window whose canary is empty fails as a blocked IP", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        crawlUpullRPartsWindows({
          site: "3",
          windows: [window("2026-11-24", "2026-11-24")],
          search: () => Effect.succeed([]),
          mayStart: () => true,
          mayRecheck: () => true,
        }),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "UpullRPartsSearchBlocked", when: "during" },
    });
  });

  test("pauses before a window it may not start, at that window's end", async () => {
    const { search } = site([
      ...stock("2026-11-24", 5),
      ...stock("2026-11-20", 5),
    ]);
    let started = 0;
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [
          window("2026-11-22", "2026-11-24"),
          window("2026-11-19", "2026-11-21"),
        ],
        search,
        mayStart: () => started++ < 0,
        mayRecheck: () => true,
      }),
    );
    expect(crawl.progress).toEqual({ status: "paused", end: "2026-11-21" });
    expect(crawl.results).toHaveLength(1);
  });

  test("an empty window with no budget left for its canary and re-search pauses at it, unaccepted", async () => {
    const { search, sent } = site(stock("2026-11-24", 5));
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [
          window("2026-11-24", "2026-11-24"),
          window("2026-11-21", "2026-11-23"),
        ],
        search,
        mayStart: () => true,
        mayRecheck: () => false,
      }),
    );
    // The next chunk searches 2026-11-21..23 again instead of trusting [].
    expect(crawl.progress).toEqual({ status: "paused", end: "2026-11-23" });
    expect(crawl.results).toHaveLength(1);
    expect(sent.map((params) => params.makes || params.beginDate)).toEqual([
      "2026-11-24",
      "2026-11-21",
    ]);
  });

  test("stops for a make split when one day alone fills a search", async () => {
    const inventory = [
      ...stock("2026-11-24", 60, "FORD"),
      ...stock("2026-11-24", 50, "KIA"),
      ...stock("2026-11-25", 5),
    ];
    const { search } = site(inventory);
    const crawl = await Effect.runPromise(
      crawlUpullRPartsWindows({
        site: "1",
        windows: [
          window("2026-11-25", "2026-11-25"),
          window("2026-11-24", "2026-11-24"),
        ],
        search,
        mayStart: () => true,
        mayRecheck: () => true,
      }),
    );
    expect(crawl.progress).toMatchObject({
      status: "split",
      day: "2026-11-24",
    });
    expect(
      crawl.progress.status === "split" ? crawl.progress.sample : [],
    ).toHaveLength(UPULLRPARTS_SEARCH_LIMIT);
    expect(crawl.results).toHaveLength(1);
  });
});

describe("crawlUpullRPartsDayByMake", () => {
  const inventory = [
    ...stock("2026-11-24", 60, "FORD"),
    ...stock("2026-11-24", 50, "KIA"),
  ];
  const sample = async () => {
    const { search } = site(inventory);
    const rows = await Effect.runPromise(
      search({
        site: "1",
        beginDate: "2026-11-24",
        endDate: "2026-11-24",
        makes: "",
      }),
    );
    return rows.flatMap((row) =>
      typeof row === "object" && row !== null && "StockNumber" in row
        ? [String(row.StockNumber)]
        : [],
    );
  };

  test("finds every vehicle of a full day under its make, checking the full search's rows are all covered", async () => {
    const { search } = site(inventory);
    const crawl = await Effect.runPromise(
      crawlUpullRPartsDayByMake({
        site: "1",
        day: "2026-11-24",
        makes: ["KIA", "FORD", "MAZDA"],
        from: { afterMake: null, missing: await sample() },
        search,
        mayStart: () => true,
      }),
    );
    expect(crawl.progress).toEqual({ status: "complete" });
    expect(
      crawl.results.map((result) => [result.make, result.records.length]),
    ).toEqual([
      ["FORD", 60],
      ["KIA", 50],
      ["MAZDA", 0],
    ]);
  });

  test("pauses between makes and carries what is still missing", async () => {
    const { search } = site(inventory);
    const missing = await sample();
    let starts = 0;
    const first = await Effect.runPromise(
      crawlUpullRPartsDayByMake({
        site: "1",
        day: "2026-11-24",
        makes: ["FORD", "KIA"],
        from: { afterMake: null, missing },
        search,
        mayStart: () => starts++ < 0,
      }),
    );
    expect(first.progress).toMatchObject({
      status: "paused",
      afterMake: "FORD",
    });
    const rest = first.progress.status === "paused" ? first.progress : null;
    expect(rest?.missing.length).toBeLessThan(missing.length);
    const second = await Effect.runPromise(
      crawlUpullRPartsDayByMake({
        site: "1",
        day: "2026-11-24",
        makes: ["FORD", "KIA"],
        from: rest ?? { afterMake: null, missing },
        search,
        mayStart: () => true,
      }),
    );
    expect(second.progress).toEqual({ status: "complete" });
    expect(second.results.map((result) => result.make)).toEqual(["KIA"]);
  });

  test("fails when the makes never cover a vehicle of the full search", async () => {
    const { search } = site(inventory);
    const result = await Effect.runPromise(
      Effect.either(
        crawlUpullRPartsDayByMake({
          site: "1",
          day: "2026-11-24",
          makes: ["FORD"],
          from: { afterMake: null, missing: await sample() },
          search,
          mayStart: () => true,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("never found");
  });

  test("fails clearly when one make of one day still fills a search", async () => {
    const { search } = site(stock("2026-11-24", 120, "FORD"));
    const result = await Effect.runPromise(
      Effect.either(
        crawlUpullRPartsDayByMake({
          site: "1",
          day: "2026-11-24",
          makes: ["FORD"],
          from: { afterMake: null, missing: [] },
          search,
          mayStart: () => true,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("still returned 100 vehicles");
  });
});
