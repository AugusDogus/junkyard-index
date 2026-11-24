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
  UPULLRPARTS_MAKE_START_BUDGET_MS,
} from "./upullrparts-connector";
import {
  UPULLRPARTS_BLOCK_RETRY_MS,
  UPULLRPARTS_MAX_BLOCK_MS,
  UpullRPartsCursor,
  UpullRPartsCursorSchema,
} from "./upullrparts-cursor";
import {
  UPULLRPARTS_MAX_STEP_SEARCHES,
  UPULLRPARTS_SEARCH_LIMIT,
  type UpullRPartsSearch,
} from "./upullrparts-make-crawl";
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
      if (action === "getYears") return Response.json([]);
      if (action === "getVehicleImages")
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
      if (action === "getVehicles" && options.vehicles)
        return options.vehicles(params);
      return new Response("unexpected action", { status: 500 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return actions;
}

/** Answers searches by make and location; Ford is the canary make. */
function stockedSearch(
  stock: Record<string, Record<string, readonly unknown[]>>,
) {
  const searches: string[] = [];
  const search: UpullRPartsSearch = (params) =>
    Effect.sync(() => {
      searches.push(`${params.site}:${params.makes}`);
      const make = params.makes === "Ford" ? "FORD" : params.makes;
      return stock[params.site]?.[make] ?? [];
    });
  return { search, searches };
}

const minnesota = {
  FORD: [
    fixture,
    { ...fixture, Store: 2, StockNumber: "UG072547", VIN: "5NMSH73E08H227458" },
  ],
};
const toledo = {
  FORD: [
    { ...fixture, Store: 3, StockNumber: "CP000001", VIN: "1FMCU9DG6AKC85849" },
  ],
};

function collect() {
  const vehicles: UpullRPartsCanonicalVehicle[] = [];
  const yards: UpullRPartsYard[] = [];
  return {
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

describe("U Pull R Parts make crawl", () => {
  test("crawls each location in turn and completes once every yard reported", async () => {
    mockDirectory();
    const { search } = stockedSearch({ "1": minnesota, "3": toledo });
    const first = collect();
    const minnesotaChunk = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(first, (request) => request, search),
    );
    expect(minnesotaChunk).toMatchObject({
      status: "paused",
      count: 2,
      cursor: {
        phase: "crawl",
        location: "3",
        afterMake: null,
        storesSeen: [1, 2],
      },
    });
    expect(first.yards.map((yard) => yard.code)).toEqual([
      "UPRRP-1",
      "UPRRP-2",
      "UPRRP-3",
    ]);
    expect(first.vehicles.map((vehicle) => vehicle.make)).toEqual([
      "Ford",
      "Ford",
    ]);
    expect(first.vehicles[0]?.imageUrl).toBe(
      "https://api.aaaparts.com/staticImages/UG072546_6_Facebook_1789479328434.jpg",
    );

    const second = collect();
    const toledoChunk = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        { ...second, startCursor: minnesotaChunk.cursor },
        (request) => request,
        search,
      ),
    );
    expect(toledoChunk).toMatchObject({
      status: "complete",
      count: 1,
      cursor: { phase: "complete", storesSeen: [1, 2, 3] },
    });
    expect(second.yards).toEqual([]);
  });

  test("pauses after the makes it started once the chunk budget is spent", async () => {
    mockDirectory({ makes: ["FORD", "Kia", "Mazda"] });
    const { search } = stockedSearch({ "1": minnesota });
    let clock = 0;
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(),
        (request) => request,
        (params) =>
          search(params).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                clock += UPULLRPARTS_MAKE_START_BUDGET_MS;
              }),
            ),
          ),
        () => clock,
      ),
    );
    expect(result).toMatchObject({
      status: "paused",
      cursor: { phase: "crawl", location: "1", afterMake: "FORD" },
    });
  });

  test("starts fewer steps when the session took part of the chunk's work limit to open", async () => {
    const makes = Array.from({ length: 20 }, (_, i) => `Make${10 + i}`);
    mockDirectory({ makes });
    const { search } = stockedSearch({ "1": minnesota });
    let at = 0;
    let opened = false;
    // Each search is paced 7.5 s; the first one also waits for a slow
    // session open that leaves 150 s of the five-minute work limit.
    const paced: UpullRPartsSearch = (params) =>
      Effect.gen(function* () {
        yield* Effect.sleep(opened ? "7500 millis" : "150 seconds");
        opened = true;
        at = yield* Clock.currentTimeMillis;
        return yield* search(params);
      });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(
            streamUpullRPartsInventoryWithSearch(
              collect(),
              (request) => request,
              paced,
              () => at,
            ),
          ),
        );
        while (fiber.unsafePoll() === null) {
          yield* TestClock.adjust("500 millis");
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 0)),
          );
        }
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result).toMatchObject({
      _tag: "Right",
      right: { status: "paused", cursor: { phase: "crawl", location: "1" } },
    });
  });

  test("rejects a crawl that never saw a known yard and emits nothing", async () => {
    mockDirectory();
    const { search } = stockedSearch({
      "1": minnesota,
      "3": { FORD: [{ ...fixture, Store: 3, Year: null }] },
    });
    const sink = collect();
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(
          {
            ...sink,
            startCursor: {
              source: "upullrparts",
              phase: "crawl",
              location: "3",
              afterMake: null,
              storesSeen: [1, 2],
            },
          },
          (request) => request,
          search,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("known yards UPRRP-3");
    expect(sink.vehicles).toEqual([]);
  });

  test("pauses until a later retry on an empty canary, a blocked IP, before trusting empty makes", async () => {
    const actions = mockDirectory();
    const sink = collect();
    const at = 1_000_000;
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        (request) => request,
        () => Effect.succeed([]),
        () => at,
      ),
    );
    // The workflow sleeps until retryAt, so a block costs one browser
    // session per retry instead of one every deferral delay.
    expect(result).toMatchObject({
      status: "paused",
      count: 0,
      cursor: {
        ...UpullRPartsCursor.initial,
        blockedSince: at,
        retryAt: at + UPULLRPARTS_BLOCK_RETRY_MS,
      },
    });
    expect(result.warnings?.[0]).toContain("blocking this IP");
    expect(actions).not.toContain("getVehicleImages");
    expect(sink.vehicles).toEqual([]);
    expect(sink.yards).toEqual([]);
    expect(UpullRPartsCursorSchema.safeParse(result.cursor).success).toBe(true);
  });

  test("pauses at the same cursor when the IP is blocked partway through", async () => {
    mockDirectory();
    let searches = 0;
    const { search } = stockedSearch({ "1": minnesota });
    const sink = collect();
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        sink,
        (request) => request,
        (params) =>
          Effect.suspend(() =>
            searches++ < 2 ? search(params) : Effect.succeed([]),
          ),
        () => 0,
      ),
    );
    expect(result).toMatchObject({
      status: "paused",
      count: 0,
      cursor: {
        ...UpullRPartsCursor.initial,
        blockedSince: 0,
        retryAt: UPULLRPARTS_BLOCK_RETRY_MS,
      },
    });
    expect(sink.vehicles).toEqual([]);
  });

  test("keeps the first block time and stops once the next retry passes the block limit", async () => {
    mockDirectory();
    const blocked = {
      ...UpullRPartsCursor.initial,
      blockedSince: 0,
      retryAt: UPULLRPARTS_BLOCK_RETRY_MS,
    };
    const again = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        { ...collect(), startCursor: blocked },
        (request) => request,
        () => Effect.succeed([]),
        () => UPULLRPARTS_BLOCK_RETRY_MS,
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
          { ...collect(), startCursor: { ...blocked, retryAt: late } },
          (request) => request,
          () => Effect.succeed([]),
          () => late,
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
    const { search } = stockedSearch({ "1": minnesota, "3": toledo });
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        {
          ...collect(),
          startCursor: {
            ...UpullRPartsCursor.initial,
            blockedSince: 0,
            retryAt: UPULLRPARTS_BLOCK_RETRY_MS,
          },
        },
        (request) => request,
        search,
        () => UPULLRPARTS_BLOCK_RETRY_MS,
      ),
    );
    expect(result.status).toBe("paused");
    expect(result.cursor).not.toHaveProperty("blockedSince");
    expect(result.cursor).not.toHaveProperty("retryAt");
  });

  test.each(partialImages)(
    "partial empty photos fail before yard or vehicle callbacks: %j",
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
      const sink = collect();
      const result = await Effect.runPromise(
        Effect.either(
          streamUpullRPartsInventoryWithSearch(
            sink,
            (request) => request,
            stockedSearch({ "1": minnesota }).search,
          ),
        ),
      );
      expect(result._tag).toBe("Left");
      expect(sink.vehicles).toEqual([]);
      expect(sink.yards).toEqual([]);
    },
  );

  test("accounts rejected, duplicate and unknown-yard rows", async () => {
    mockDirectory();
    const { search } = stockedSearch({
      "1": {
        FORD: [
          ...minnesota.FORD,
          { ...fixture, StockNumber: "UG072548", VIN: null },
          { Store: "bad" },
          { ...fixture, Store: 99, StockNumber: "X1", VIN: " observed-vin " },
        ],
      },
    });
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        collect(),
        (request) => request,
        search,
      ),
    );
    expect(result.count).toBe(2);
    expect(result.accounting).toEqual({
      recordsProcessed: 5,
      recordsExcluded: 1,
      recordsRejected: 2,
      duplicateVehicles: 0,
    });
    expect(result.observedVins).toEqual(["OBSERVED-VIN"]);
    expect(result.warnings?.[0]).toContain("yard 99: skipped 1 vehicles");
  });

  test("bounds callback batches", async () => {
    const makes = ["FORD", "Kia", "Mazda", "Saab", "Volvo", "Jeep"];
    mockDirectory({ makes });
    const stock = Object.fromEntries(
      makes.map((make, m) => [
        make,
        Array.from({ length: 84 }, (_, i) => ({
          ...fixture,
          StockNumber: `S${m}-${i}`,
          VIN: `${m}`.padStart(3, "0") + String(i).padStart(14, "0"),
        })),
      ]),
    );
    const sizes: number[] = [];
    await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              sizes.push(batch.length);
            }),
        },
        (request) => request,
        stockedSearch({ "1": stock }).search,
      ),
    );
    expect(sizes).toEqual([250, 250, 4]);
  });

  test("replays the complete cursor without searching or emitting", async () => {
    const actions = mockDirectory();
    const { search, searches } = stockedSearch({});
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        {
          startCursor: {
            source: "upullrparts",
            phase: "complete",
            storesSeen: [1, 2, 3],
          },
          onBatch: () => Effect.die("must not emit"),
        },
        (request) => request,
        search,
      ),
    );
    expect(result).toMatchObject({ status: "complete", count: 0 });
    expect(actions).toEqual([]);
    expect(searches).toEqual([]);
  });

  test("pauses inside a split make at the chunk's search budget and resumes there", async () => {
    // 40 models of 3 vehicles: the make fills a page and splits by model.
    const models = Array.from(
      { length: 40 },
      (_, i) => `M${String(i).padStart(2, "0")}`,
    );
    const stock = models.flatMap((model, m) =>
      Array.from({ length: 3 }, (_, i) => ({
        ...fixture,
        Model: model,
        StockNumber: `S${m}-${i}`,
        VIN: `1FMCU9DG6A${String(m * 3 + i).padStart(7, "0")}`,
      })),
    );
    mockDirectory({ makes: ["FORD"], models: { FORD: models } });
    let searches = 0;
    const search: UpullRPartsSearch = (params) =>
      Effect.sync(() => {
        searches += 1;
        return stock
          .filter((row) => params.models === "0" || row.Model === params.models)
          .slice(0, UPULLRPARTS_SEARCH_LIMIT);
      });
    const first = collect();
    const paused = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(first, (request) => request, search),
    );
    // Canary and make search, then one model per step while a whole step
    // and the closing canary still fit in the budget.
    const searchedModels =
      UPULLRPARTS_CHUNK_SEARCHES - UPULLRPARTS_MAX_STEP_SEARCHES - 2;
    expect(paused).toMatchObject({
      status: "paused",
      cursor: {
        phase: "split",
        location: "1",
        make: "FORD",
        model: models[searchedModels - 1],
        year: null,
      },
    });
    expect(searches).toBeLessThanOrEqual(UPULLRPARTS_CHUNK_SEARCHES);
    expect(first.vehicles).toHaveLength(searchedModels * 3);

    const second = collect();
    const resumed = await Effect.runPromise(
      streamUpullRPartsInventoryWithSearch(
        { ...second, startCursor: paused.cursor },
        (request) => request,
        search,
      ),
    );
    expect(resumed.cursor).toMatchObject({ phase: "crawl", location: "3" });
    const vins = [...first.vehicles, ...second.vehicles].map(
      (vehicle) => vehicle.vin,
    );
    expect(vins).toHaveLength(120);
    expect(new Set(vins).size).toBe(120);
  });

  test("spends one fresh token per search and retries a failed request with another", async () => {
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
      )({ site: "1", makes: "Ford", models: "0", years: "0" }),
    );
    expect(rows).toEqual([fixture]);
    expect(sent.map((params) => params.get("turnstileToken"))).toEqual([
      "token-1",
      "token-2",
    ]);
    expect(Object.fromEntries(sent[1] ?? [])).toEqual({
      action: "doAaaApiCall",
      apiAction: "getVehicles",
      site: "1",
      makes: "Ford",
      models: "0",
      years: "0",
      beginDate: "",
      endDate: "",
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
            makes: "Ford",
            models: "0",
            years: "0",
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
      UpullRPartsCursorSchema.safeParse({
        ...UpullRPartsCursor.initial,
        ...fields,
      }).success;
    expect(parse({ blockedSince: 10, retryAt: 20 })).toBe(true);
    expect(parse({ retryAt: 20 })).toBe(false);
    expect(parse({ blockedSince: 10 })).toBe(false);
    expect(parse({ blockedSince: 20, retryAt: 20 })).toBe(false);
    expect(
      parse({ blockedSince: 0, retryAt: UPULLRPARTS_MAX_BLOCK_MS + 1 }),
    ).toBe(false);
  });

  test("starts from the first location by default", () => {
    expect(UpullRPartsCursor.initial).toEqual({
      source: "upullrparts",
      phase: "crawl",
      location: "1",
      afterMake: null,
      storesSeen: [],
    });
  });
});
