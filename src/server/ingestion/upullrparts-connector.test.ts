import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import images from "./fixtures/upullrparts-images.json";
import partialImages from "./fixtures/upullrparts-partial-images.json";
import {
  streamUpullRPartsInventoryWithSearch,
  UPULLRPARTS_MAKE_START_BUDGET_MS,
} from "./upullrparts-connector";
import { UpullRPartsCursor } from "./upullrparts-cursor";
import type { UpullRPartsSearch } from "./upullrparts-make-crawl";
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
    photos?: (params: URLSearchParams) => Response;
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
      if (action === "getModels") return Response.json([]);
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

  test("treats an empty canary as a blocked IP before trusting empty makes", async () => {
    const actions = mockDirectory();
    const sink = collect();
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(
          sink,
          (request) => request,
          () => Effect.succeed([]),
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "UpullRPartsSearchBlockedError" },
    });
    expect(actions).not.toContain("getVehicleImages");
    expect(sink.vehicles).toEqual([]);
  });

  test("fails the chunk when the IP is blocked partway through", async () => {
    mockDirectory();
    let searches = 0;
    const { search } = stockedSearch({ "1": minnesota });
    const sink = collect();
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithSearch(
          sink,
          (request) => request,
          (params) =>
            Effect.suspend(() =>
              searches++ < 2 ? search(params) : Effect.succeed([]),
            ),
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "UpullRPartsSearchBlockedError" },
    });
    expect(sink.vehicles).toEqual([]);
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
