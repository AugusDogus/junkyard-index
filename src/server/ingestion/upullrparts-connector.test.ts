import { afterEach, describe, expect, test } from "bun:test";
import { Clock, Duration, Effect, Fiber, TestClock, TestContext } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import images from "./fixtures/upullrparts-images.json";
import partialImages from "./fixtures/upullrparts-partial-images.json";
import {
  makeUpullRPartsSearchGate,
  makeUpullRPartsTokenSearch,
  streamUpullRPartsInventoryWithSearch,
  UPULLRPARTS_CHUNK_SEARCHES,
  type UpullRPartsChunkDeps,
} from "./upullrparts-connector";
import {
  UPULLRPARTS_BLOCK_RETRY_MS,
  UPULLRPARTS_MAX_BLOCK_MS,
  UpullRPartsCursor,
  UpullRPartsCursorSchema,
} from "./upullrparts-cursor";
import {
  UPULLRPARTS_SEARCH_LIMIT,
  UpullRPartsDay,
  type UpullRPartsLocation,
  type UpullRPartsSearch,
  type UpullRPartsSearchParams,
} from "./upullrparts-date-crawl";
import {
  UpullRPartsHistory,
  type UpullRPartsKnownVehicle,
} from "./upullrparts-history";
import type { UpullRPartsDirectory } from "./upullrparts-makes";
import type { UpullRPartsTokens } from "./upullrparts-turnstile";
import type { UpullRPartsCanonicalVehicle } from "./upullrparts-transform";
import type { UpullRPartsYard } from "./upullrparts-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Serves the token-free directory and photo actions. */
function mockDirectory(
  options: {
    makes?: string[];
    models?: Record<string, string[]>;
    photos?: (params: URLSearchParams) => Response;
    vehicles?: (params: URLSearchParams) => Response;
  } = {},
) {
  const actions: string[] = [];
  const photoStocks: string[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      const action = params.get("apiAction") ?? "";
      actions.push(action);
      if (action === "getMakes")
        return Response.json(options.makes ?? ["FORD", "Kia"]);
      if (action === "getModels")
        return Response.json(options.models?.[params.get("Make") ?? ""] ?? []);
      if (action === "getVehicleImages") {
        photoStocks.push(params.get("stockID") ?? "");
        return (
          options.photos?.(params) ??
          Response.json(
            JSON.parse(
              JSON.stringify(images).replaceAll(
                "UG072546",
                params.get("stockID") ?? "",
              ),
            ),
          )
        );
      }
      if (action === "getVehicles" && options.vehicles)
        return options.vehicles(params);
      return new Response("unexpected action", { status: 500 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { actions, photoStocks };
}

const TODAY = "2026-11-24";
const NOW = Date.parse(`${TODAY}T12:00:00.000Z`);
const DIRECTORY: UpullRPartsDirectory = {
  version: 1,
  makes: ["FORD", "Kia", "SHELBY"],
  models: { FORD: ["FOCUS", "MUSTANG"], Kia: ["SOUL"], SHELBY: ["MUSTANG"] },
};
const STATE_PATH = "ingestion/run/upullrparts/directory.json";
const loadState = async (path: string) =>
  path === STATE_PATH ? DIRECTORY : undefined;

function crawlAt(
  location: UpullRPartsLocation,
  fields: Partial<Extract<UpullRPartsCursor, { phase: "crawl" }>> = {},
): UpullRPartsCursor {
  return {
    source: "upullrparts",
    phase: "crawl",
    location,
    today: TODAY,
    end: TODAY,
    statePath: STATE_PATH,
    storesSeen: [],
    ...fields,
  };
}

let serial = 0;
/** A site row and the make it is listed under; rows carry no make. */
function car(
  store: number,
  day: string,
  fields: {
    make?: string;
    Model?: string;
    VIN?: string;
    StockNumber?: string;
    Year?: number | null;
  } = {},
) {
  serial += 1;
  const id = String(serial).padStart(6, "0");
  return {
    make: fields.make ?? "FORD",
    row: {
      ...fixture,
      Year: fields.Year === undefined ? fixture.Year : fields.Year,
      Store: store,
      DateSetData: day,
      Model: fields.Model ?? "FOCUS",
      VIN: fields.VIN ?? `1FADP3F20FL${id}`,
      StockNumber: fields.StockNumber ?? `UG${id}`,
    },
  };
}
type Car = ReturnType<typeof car>;

/** Answers like getVehicles at each location: dates and make with AND, the
 * newest 100 by date when more match. */
function site(inventory: readonly Car[]) {
  const sent: UpullRPartsSearchParams[] = [];
  const search: UpullRPartsSearch = (params) =>
    Effect.sync(() => {
      sent.push(params);
      const location = (store: number) => (store === 3 ? "3" : "1");
      return inventory
        .filter(
          ({ make, row }) =>
            location(row.Store) === params.site &&
            (params.beginDate === "" || row.DateSetData >= params.beginDate) &&
            (params.endDate === "" || row.DateSetData <= params.endDate) &&
            (params.makes === "" ||
              params.makes.toUpperCase() === make.toUpperCase()),
        )
        .map(({ row }) => row)
        .sort((a, b) => (a.DateSetData < b.DateSetData ? 1 : -1))
        .slice(0, UPULLRPARTS_SEARCH_LIMIT);
    });
  return { search, sent };
}

function history(
  fields: {
    counts?: Partial<Record<UpullRPartsLocation, Record<string, number>>>;
    publishedDay?: string | null;
    known?: Record<string, UpullRPartsKnownVehicle>;
  } = {},
): UpullRPartsHistory {
  return {
    counts: {
      "1": new Map(Object.entries(fields.counts?.["1"] ?? {})),
      "3": new Map(Object.entries(fields.counts?.["3"] ?? {})),
    },
    publishedDay: fields.publishedDay ?? null,
    known: new Map(Object.entries(fields.known ?? {})),
  };
}

function deps(
  search: UpullRPartsSearch,
  fields: Partial<UpullRPartsChunkDeps<never>> & {
    history?: UpullRPartsHistory;
  } = {},
) {
  const opened: number[] = [];
  const value: UpullRPartsChunkDeps<
    Effect.Effect.Error<ReturnType<UpullRPartsSearch>>
  > = {
    requestGate: (request) => request,
    openSearch: (tokens) =>
      Effect.sync(() => {
        opened.push(tokens);
        return search;
      }),
    loadHistory: Effect.succeed(fields.history ?? UpullRPartsHistory.empty),
    decodeVins: () => Effect.succeed(new Map()),
    now: () => NOW,
    ...fields,
  };
  return { deps: value, opened };
}

function collect(startCursor?: UpullRPartsCursor) {
  const vehicles: UpullRPartsCanonicalVehicle[] = [];
  const yards: UpullRPartsYard[] = [];
  return {
    startCursor,
    loadState,
    vehicles,
    yards,
    onBatch: (batch: UpullRPartsCanonicalVehicle[]) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    onYards: (batch: UpullRPartsYard[]) =>
      Effect.sync(() => {
        yards.push(...batch);
      }),
  };
}

/** `count` vehicles a day on the business days before `end`, newest first. */
function businessDays(end: string, count: number): string[] {
  const days: string[] = [];
  for (let day = end; days.length < count; day = UpullRPartsDay.add(day, -1))
    if (UpullRPartsDay.isBusinessDay(day)) days.push(day);
  return days;
}

describe("U Pull R Parts date crawl", () => {
  test("loads the make directory once in its own chunk, dates the run and opens no browser", async () => {
    const { actions } = mockDirectory({
      makes: ["FORD", "Kia"],
      models: { FORD: ["FOCUS"], Kia: ["SOUL"] },
    });
    const { deps: chunkDeps, opened } = deps(site([]).search);
    const sink = collect();
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(sink, chunkDeps),
    );
    expect(result).toMatchObject({
      status: "paused",
      count: 0,
      cursor: {
        phase: "crawl",
        location: "1",
        today: TODAY,
        end: TODAY,
        statePath: null,
      },
      checkpointState: {
        version: 1,
        makes: ["FORD", "Kia"],
        models: { FORD: ["FOCUS"], Kia: ["SOUL"] },
      },
    });
    expect(actions).toEqual(["getMakes", "getModels", "getModels"]);
    expect(opened).toEqual([]);
    expect(sink.yards.map((yard) => yard.code)).toEqual([
      "UPRRP-1",
      "UPRRP-2",
      "UPRRP-3",
    ]);
  });

  test("crawls each location's windows up to today and completes once every yard reported", async () => {
    const { actions } = mockDirectory();
    const { search, sent } = site([
      car(1, "2026-11-23"),
      car(2, "2026-11-20"),
      car(3, "2026-11-23"),
    ]);
    const first = collect(crawlAt("1"));
    const minnesota = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(first, deps(search).deps),
    );
    expect(minnesota).toMatchObject({
      status: "paused",
      count: 2,
      cursor: { phase: "crawl", location: "3", end: TODAY, storesSeen: [1, 2] },
    });
    expect(first.vehicles.map((vehicle) => vehicle.make)).toEqual([
      "Ford",
      "Ford",
    ]);
    // The window's end is today, explicitly; the canaries leave dates open.
    expect(sent.filter((params) => params.makes === "")).toEqual([
      { site: "1", beginDate: "2000-01-01", endDate: TODAY, makes: "" },
    ]);
    expect(actions).not.toContain("getMakes");
    expect(actions).not.toContain("getModels");

    const toledo = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(minnesota.cursor),
        deps(search).deps,
      ),
    );
    expect(toledo).toMatchObject({
      status: "complete",
      count: 1,
      cursor: { phase: "complete", storesSeen: [1, 2, 3] },
    });
  });

  test("mints tokens for the chunk's planned windows, not a fixed count", async () => {
    mockDirectory();
    const days = businessDays("2026-11-23", 5);
    const { search } = site(days.map((day) => car(1, day)));
    const { deps: chunkDeps, opened } = deps(search, {
      history: history({
        counts: { "1": Object.fromEntries(days.map((day) => [day, 80])) },
        publishedDay: TODAY,
      }),
    });
    await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(collect(crawlAt("1")), chunkDeps),
    );
    // Today plus five 80-vehicle days in 6 windows; both canaries with a
    // retry each; an empty window's canary, retried, and re-search; and two
    // transit retries.
    expect(opened).toEqual([6 + 2 * 2 + 3 + 2]);
    expect(opened[0]).toBeLessThan(UPULLRPARTS_CHUNK_SEARCHES + 2);
  });

  test("reuses known VINs' makes and photos, looking up only new stock and known stock without a photo", async () => {
    const { photoStocks } = mockDirectory();
    const { search } = site([
      car(1, "2026-11-23", { VIN: "1MEFM50U01A000001", StockNumber: "KNOWN1" }),
      car(1, "2026-11-23", {
        VIN: "1FAFP34N05W000002",
        StockNumber: "NOPHOTO",
      }),
      car(1, "2026-11-23", { VIN: "1FAFP34N05W000003", StockNumber: "MOVED" }),
      car(2, "2026-11-23", { VIN: "1FAFP34N05W000004", StockNumber: "NEW1" }),
    ]);
    const sink = collect(crawlAt("1"));
    await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        deps(search, {
          history: history({
            known: {
              "1MEFM50U01A000001": {
                make: "Mercury",
                stockNumber: "KNOWN1",
                imageUrl:
                  "https://api.aaaparts.com/staticImages/KNOWN1_6_x.jpg",
              },
              "1FAFP34N05W000002": {
                make: "Ford",
                stockNumber: "NOPHOTO",
                imageUrl: null,
              },
              "1FAFP34N05W000003": {
                make: "Ford",
                stockNumber: "OLDSTOCK",
                imageUrl:
                  "https://api.aaaparts.com/staticImages/OLDSTOCK_6_x.jpg",
              },
            },
          }),
        }).deps,
      ),
    );
    expect(photoStocks.sort()).toEqual(["MOVED", "NEW1", "NOPHOTO"]);
    const byStock = new Map(
      sink.vehicles.map((vehicle) => [vehicle.stockNumber, vehicle]),
    );
    expect(byStock.get("KNOWN1")).toMatchObject({
      make: "Mercury",
      imageUrl: "https://api.aaaparts.com/staticImages/KNOWN1_6_x.jpg",
    });
    expect(byStock.get("NEW1")?.imageUrl).toContain("NEW1_6_");
    expect(byStock.get("NEW1")?.make).toBe("Ford");
  });

  test("resolves a new vehicle of a model two makes list with one search of its day and each make", async () => {
    mockDirectory();
    const { search, sent } = site([
      car(1, "2026-11-23", { make: "SHELBY", Model: "MUSTANG" }),
      // Every location stocks Fords, which the canaries look for.
      car(2, "2026-11-20"),
    ]);
    const sink = collect(crawlAt("1"));
    await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(sink, deps(search).deps),
    );
    expect(sink.vehicles.map((vehicle) => vehicle.make)).toEqual([
      "Shelby",
      "Ford",
    ]);
    expect(
      sent
        .filter((params) => params.beginDate === "2026-11-23")
        .map((params) => params.makes),
    ).toEqual(["FORD", "SHELBY"]);
  });

  test("a chunk of new VINs stays within its work limit: no directory requests, and windows stop in time for the tail", async () => {
    const { actions } = mockDirectory();
    const days = businessDays("2026-11-23", 40);
    const inventory = days.map((day) => car(1, day));
    const { search: answer } = site(inventory);
    let at = NOW;
    let sent = 0;
    // Each search is paced 7.5 s, as in production.
    const paced: UpullRPartsSearch = (params) =>
      Effect.gen(function* () {
        yield* Effect.sleep("7500 millis");
        sent += 1;
        at = NOW + (yield* Clock.currentTimeMillis);
        return yield* answer(params);
      });
    const { deps: chunkDeps } = deps(paced, {
      now: () => at,
      history: history({
        counts: { "1": Object.fromEntries(days.map((day) => [day, 85])) },
        publishedDay: TODAY,
      }),
    });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(
            streamUpullRPartsInventoryWithSearch(
              collect(crawlAt("1")),
              chunkDeps,
            ),
          ),
        );
        while (fiber.unsafePoll() === null) {
          yield* TestClock.adjust("500 millis");
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 0)),
          );
        }
        const result = yield* Fiber.join(fiber);
        return { result, elapsed: yield* Clock.currentTimeMillis };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(outcome.result).toMatchObject({
      _tag: "Right",
      right: { status: "paused", cursor: { phase: "crawl", location: "1" } },
    });
    expect(outcome.elapsed).toBeLessThan(Duration.toMillis("5 minutes"));
    expect(sent).toBeLessThanOrEqual(UPULLRPARTS_CHUNK_SEARCHES);
    expect(actions).not.toContain("getMakes");
    expect(actions).not.toContain("getModels");
  });

  test("splits a day that alone fills a search by make in its own chunk, then crawls on from the day before", async () => {
    mockDirectory();
    const day = "2026-11-23";
    const inventory = [
      car(1, TODAY),
      ...Array.from({ length: 60 }, () => car(1, day)),
      ...Array.from({ length: 50 }, () =>
        car(2, day, { make: "Kia", Model: "SOUL" }),
      ),
    ];
    const { search } = site(inventory);
    const first = collect(crawlAt("1"));
    const paused = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        first,
        deps(search, {
          history: history({
            counts: { "1": { [day]: 95 } },
            publishedDay: TODAY,
          }),
        }).deps,
      ),
    );
    expect(paused.cursor).toMatchObject({
      phase: "split",
      location: "1",
      day,
      afterMake: null,
    });
    expect(
      paused.cursor.phase === "split" ? paused.cursor.missing : [],
    ).toHaveLength(UPULLRPARTS_SEARCH_LIMIT);
    const second = collect(paused.cursor);
    const { deps: splitDeps, opened } = deps(search);
    const split = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(second, splitDeps),
    );
    // Its makes, both canaries with a retry each, and two transit retries.
    expect(opened).toEqual([DIRECTORY.makes.length + 2 * 2 + 2]);
    expect(split.cursor).toMatchObject({
      phase: "crawl",
      location: "1",
      end: "2026-11-22",
    });
    const makes = new Map<string, number>();
    for (const vehicle of second.vehicles)
      makes.set(vehicle.make, (makes.get(vehicle.make) ?? 0) + 1);
    expect(Object.fromEntries(makes)).toEqual({ Ford: 60, Kia: 50 });
  });

  test("rejects a crawl that never saw a known yard and emits nothing", async () => {
    mockDirectory();
    const { search } = site([car(3, "2026-11-23", { Year: null })]);
    const sink = collect(crawlAt("3", { storesSeen: [1, 2] }));
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(sink, deps(search).deps),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("known yards UPRRP-3");
    expect(sink.vehicles).toEqual([]);
  });

  test("pauses until a later retry on an empty canary, a blocked IP, before trusting empty windows", async () => {
    const { actions } = mockDirectory();
    const sink = collect(crawlAt("1"));
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        deps(() => Effect.succeed([]), { now: () => NOW }).deps,
      ),
    );
    // The workflow sleeps until retryAt, so a block costs one browser
    // session per retry instead of one every deferral delay.
    expect(result).toMatchObject({
      status: "paused",
      count: 0,
      cursor: {
        ...crawlAt("1"),
        blockedSince: NOW,
        retryAt: NOW + UPULLRPARTS_BLOCK_RETRY_MS,
      },
    });
    expect(result.warnings?.[0]).toContain("blocking this IP");
    expect(actions).not.toContain("getVehicleImages");
    expect(sink.vehicles).toEqual([]);
    expect(UpullRPartsCursorSchema.safeParse(result.cursor).success).toBe(true);
  });

  test("searches an empty canary once more with a fresh token, since one rejected token also returns nothing", async () => {
    mockDirectory();
    const { search, sent } = site([car(1, "2026-11-23"), car(2, "2026-11-20")]);
    let rejected = 1;
    const sink = collect(crawlAt("1"));
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        deps((params) => (rejected-- > 0 ? Effect.succeed([]) : search(params)))
          .deps,
      ),
    );
    expect(result).toMatchObject({ status: "paused", count: 2 });
    expect(result.cursor).not.toHaveProperty("retryAt");
    expect(sent[0]).toMatchObject({ beginDate: "", makes: "Ford" });
    expect(sink.vehicles).toHaveLength(2);
  });

  test("pauses at the same cursor when the closing canary finds the IP blocked", async () => {
    mockDirectory();
    const { search } = site([car(1, "2026-11-23")]);
    let searches = 0;
    const sink = collect(crawlAt("1"));
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        deps((params) =>
          Effect.suspend(() =>
            searches++ < 2 ? search(params) : Effect.succeed([]),
          ),
        ).deps,
      ),
    );
    expect(result).toMatchObject({
      status: "paused",
      count: 0,
      cursor: { ...crawlAt("1"), blockedSince: NOW },
    });
    expect(sink.vehicles).toEqual([]);
  });

  test("keeps the first block time and stops once the next retry passes the block limit", async () => {
    mockDirectory();
    const blocked = crawlAt("1", {
      blockedSince: 0,
      retryAt: UPULLRPARTS_BLOCK_RETRY_MS,
    });
    const again = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(blocked),
        deps(() => Effect.succeed([]), {
          now: () => UPULLRPARTS_BLOCK_RETRY_MS,
        }).deps,
      ),
    );
    expect(again.cursor).toMatchObject({
      blockedSince: 0,
      retryAt: 2 * UPULLRPARTS_BLOCK_RETRY_MS,
    });
    const late = UPULLRPARTS_MAX_BLOCK_MS - UPULLRPARTS_BLOCK_RETRY_MS + 1;
    const stopped = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(
          collect(crawlAt("1", { blockedSince: 0, retryAt: late })),
          deps(() => Effect.succeed([]), { now: () => late }).deps,
        ),
      ),
    );
    expect(stopped).toMatchObject({
      _tag: "Left",
      left: { _tag: "UpullRPartsStreamError" },
    });
    if (stopped._tag === "Left")
      expect(stopped.left.message).toContain("prior inventory is preserved");
  });

  test("clears the block once a chunk's canaries pass", async () => {
    mockDirectory();
    const { search } = site([car(1, "2026-11-23"), car(2, "2026-11-23")]);
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(
          crawlAt("1", {
            blockedSince: 0,
            retryAt: UPULLRPARTS_BLOCK_RETRY_MS,
          }),
        ),
        deps(search).deps,
      ),
    );
    expect(result.status).toBe("paused");
    expect(result.cursor).not.toHaveProperty("blockedSince");
    expect(result.cursor).not.toHaveProperty("retryAt");
  });

  test("fails clearly, emitting nothing, when the checkpoint names no stored directory", async () => {
    mockDirectory();
    const sink = collect(crawlAt("1", { statePath: null }));
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(sink, deps(site([]).search).deps),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("restart the run");
    expect(sink.vehicles).toEqual([]);
  });

  test.each(partialImages)(
    "partial empty photos fail before vehicle callbacks: %j",
    async (responseInit) => {
      mockDirectory({
        photos: () =>
          Response.json(
            { success: 1, images: [] },
            {
              status: responseInit.status,
              headers: responseInit.headerName
                ? { [responseInit.headerName]: responseInit.headerValue }
                : undefined,
            },
          ),
      });
      const sink = collect(crawlAt("1"));
      const result = await Effect.runPromise(
        Effect.either(
          streamUpullRPartsInventoryWithSearch(
            sink,
            deps(site([car(1, "2026-11-23")]).search).deps,
          ),
        ),
      );
      expect(result._tag).toBe("Left");
      expect(sink.vehicles).toEqual([]);
    },
  );

  test("accounts rejected, duplicate and unknown-yard rows", async () => {
    mockDirectory();
    const kept = car(1, "2026-11-23");
    const rows = [
      kept,
      car(2, "2026-11-23"),
      { ...kept, row: { ...kept.row, StockNumber: "UGDUP" } },
      car(1, "2026-11-23", { VIN: "" }),
      {
        make: "FORD",
        row: {
          ...kept.row,
          Store: 99,
          VIN: " observed-vin ",
          StockNumber: "X1",
        },
      },
    ];
    const answer = site(rows.filter((entry) => entry.row.Store !== 99)).search;
    const search: UpullRPartsSearch = (params) =>
      answer(params).pipe(
        Effect.map((found) =>
          params.makes === "" && params.beginDate !== ""
            ? [...found, { Store: "bad" }, rows[4]?.row]
            : found,
        ),
      );
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(crawlAt("1")),
        deps(search).deps,
      ),
    );
    expect(result.count).toBe(2);
    expect(result.accounting).toEqual({
      recordsProcessed: 6,
      recordsExcluded: 1,
      recordsRejected: 2,
      duplicateVehicles: 1,
    });
    expect(result.observedVins).toEqual(["OBSERVED-VIN"]);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("yard 99: skipped 1 vehicles"),
    );
  });

  test("bounds callback batches", async () => {
    mockDirectory();
    const days = businessDays("2026-11-23", 6);
    const inventory = days.flatMap((day) =>
      Array.from({ length: 84 }, () => car(1, day)),
    );
    const sizes: number[] = [];
    await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        {
          startCursor: crawlAt("1"),
          loadState,
          onBatch: (batch) =>
            Effect.sync(() => {
              sizes.push(batch.length);
            }),
        },
        deps(site(inventory).search, {
          history: history({
            counts: { "1": Object.fromEntries(days.map((day) => [day, 84])) },
            publishedDay: TODAY,
          }),
        }).deps,
      ),
    );
    expect(sizes).toEqual([250, 250, 4]);
  });

  test("replays the complete cursor without searching or emitting", async () => {
    const { actions } = mockDirectory();
    const { search, sent } = site([]);
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        {
          startCursor: {
            source: "upullrparts",
            phase: "complete",
            storesSeen: [1, 2, 3],
          },
          loadState,
          onBatch: () => Effect.die("must not emit"),
        },
        deps(search).deps,
      ),
    );
    expect(result).toMatchObject({ status: "complete", count: 0 });
    expect(actions).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("spends one fresh token per search, sends its dates and make, and retries a failed request with another token", async () => {
    const sent: URLSearchParams[] = [];
    let failures = 1;
    mockDirectory({
      vehicles: (params) => {
        sent.push(params);
        return failures-- > 0
          ? new Response("busy", { status: 502 })
          : Response.json([fixture]);
      },
    });
    let minted = 0;
    const tokens: UpullRPartsTokens = {
      take: Effect.sync(() => `token-${++minted}`),
    };
    const rows = await Effect.runPromise(
      makeUpullRPartsTokenSearch(
        tokens,
        (request) => request,
      )({
        site: "3",
        beginDate: "2026-11-19",
        endDate: TODAY,
        makes: "",
      }),
    );
    expect(rows).toEqual([fixture]);
    expect(sent.map((params) => params.get("turnstileToken"))).toEqual([
      "token-1",
      "token-2",
    ]);
    expect(Object.fromEntries(sent[1] ?? [])).toEqual({
      action: "doAaaApiCall",
      apiAction: "getVehicles",
      site: "3",
      makes: "",
      models: "0",
      years: "0",
      beginDate: "2026-11-19",
      endDate: TODAY,
      turnstileToken: "token-2",
    });
  });

  test("starts a search's pacing slot only once its token is in hand, so a slow first token cannot make two searches back to back", async () => {
    let sent = 0;
    mockDirectory({
      vehicles: () => {
        sent += 1;
        return Response.json([]);
      },
    });
    let minted = 0;
    // The first token comes 20 s after the search asks, as from a browser
    // still loading; later ones are ready.
    const tokens: UpullRPartsTokens = {
      take: Effect.gen(function* () {
        minted += 1;
        if (minted === 1) yield* Effect.sleep("20 seconds");
        return `token-${minted}`;
      }),
    };
    const settle = Effect.promise(
      () => new Promise((resolve) => setTimeout(resolve, 5)),
    );
    const sentAt = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const search = makeUpullRPartsTokenSearch(
            tokens,
            yield* makeUpullRPartsSearchGate,
          );
          const params = {
            site: "1",
            beginDate: "",
            endDate: "",
            makes: "Ford",
          } as const;
          const fiber = yield* Effect.fork(
            Effect.zipRight(search(params), search(params)),
          );
          const counts: number[] = [];
          for (const step of [
            Duration.seconds(20),
            Duration.seconds(7),
            Duration.millis(500),
          ]) {
            yield* TestClock.adjust(step);
            yield* settle;
            yield* settle;
            counts.push(sent);
          }
          yield* Fiber.join(fiber);
          return counts;
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    );
    // At 20 s the first search is sent; the second waits a full interval
    // after it, not after the first search asked for its slot.
    expect(sentAt).toEqual([1, 1, 2]);
  });

  test("accepts a block wait only with its start time and inside the block limit", () => {
    const parse = (fields: object) =>
      UpullRPartsCursorSchema.safeParse({ ...crawlAt("1"), ...fields }).success;
    expect(parse({ blockedSince: 10, retryAt: 20 })).toBe(true);
    expect(parse({ retryAt: 20 })).toBe(false);
    expect(parse({ blockedSince: 10 })).toBe(false);
    expect(parse({ blockedSince: 20, retryAt: 20 })).toBe(false);
    expect(
      parse({ blockedSince: 0, retryAt: UPULLRPARTS_MAX_BLOCK_MS + 1 }),
    ).toBe(false);
  });

  test("starts each run by loading the directory", () => {
    expect(UpullRPartsCursor.initial).toEqual({
      source: "upullrparts",
      phase: "directory",
      storesSeen: [],
    });
  });
});
