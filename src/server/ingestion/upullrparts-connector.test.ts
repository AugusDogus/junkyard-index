import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import { UPULLRPARTS_API_URL } from "./upullrparts-client";
import {
  streamUpullRPartsInventoryWithRequestGate,
  UPULLRPARTS_MAX_CATALOG_RECORDS,
} from "./upullrparts-connector";
import type { UpullRPartsCanonicalVehicle } from "./upullrparts-transform";
import type { UpullRPartsYard } from "./upullrparts-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const catalog = [
  fixture,
  { ...fixture, Store: 2, VIN: "5NMSH73E08H227458" },
  { ...fixture, Store: 3, VIN: "1FMCU9DG6AKC85849" },
];

function mockResponse(body: string, status = 200) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      if (params.get("apiAction") === "getMakes")
        return Response.json(["Ford"]);
      if (params.get("apiAction") === "getModels")
        return Response.json(["FOCUS"]);
      if (params.has("makes")) return Response.json(catalog);
      return new Response(body, { status });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("U Pull R Parts complete catalog", () => {
  test.each(["catalog", "makes", "partition", "models"])(
    "rejects explicit partial %s responses before emitting vehicles",
    async (target) => {
      const variants = [
        {
          status: 206,
          headers: new Headers({ "Content-Range": "items 0-2/3000" }),
        },
        {
          status: 200,
          headers: new Headers({ "Content-Range": "items 0-2/3000" }),
        },
        { status: 200, headers: new Headers({ Link: '</next>; rel="next"' }) },
      ];
      for (const variant of variants) {
        globalThis.fetch = Object.assign(
          async (_input: RequestInfo | URL, init?: RequestInit) => {
            const params = new URLSearchParams(
              typeof init?.body === "string" ? init.body : "",
            );
            const action = params.get("apiAction");
            const kind =
              action === "getMakes"
                ? "makes"
                : action === "getModels"
                  ? "models"
                  : params.has("makes")
                    ? "partition"
                    : "catalog";
            const body =
              kind === "makes"
                ? ["Ford"]
                : kind === "models"
                  ? ["FOCUS"]
                  : kind === "partition"
                    ? []
                    : catalog;
            return Response.json(body, kind === target ? variant : undefined);
          },
          { preconnect: originalFetch.preconnect },
        );
        let batches = 0;
        const result = await Effect.runPromise(
          Effect.either(
            streamUpullRPartsInventoryWithRequestGate(
              {
                onBatch: () =>
                  Effect.sync(() => {
                    batches++;
                  }),
              },
              (request) => request,
            ),
          ),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Left")
          expect(result.left.message).toContain("partial");
        expect(batches).toBe(0);
      }
    },
  );
  test("posts the verified unfiltered form, emits yards and completes one atomic checkpoint", async () => {
    const requests = mockResponse(JSON.stringify(catalog));
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    const yards: UpullRPartsYard[] = [];
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        {
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        (request) => request,
      ),
    );
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      url: UPULLRPARTS_API_URL,
      init: {
        method: "POST",
        body: "action=doApiCall&apiAction=getVehicles",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "JunkyardIndex/1.0",
        },
      },
    });
    expect(result).toMatchObject({
      source: "upullrparts",
      status: "complete",
      cursor: 1,
      count: 3,
      pagesProcessed: 1,
      errors: [],
      warnings: [],
      accounting: {
        recordsProcessed: 3,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    });
    expect(yards.map((yard) => yard.code)).toEqual([
      "UPRRP-1",
      "UPRRP-2",
      "UPRRP-3",
    ]);
    expect(
      vehicles.every((vehicle) =>
        yards.some((yard) => yard.code === vehicle.locationCode),
      ),
    ).toBe(true);
  });

  test("accounts raw, rejected, duplicate and excluded rows without losing unknown-yard observations", async () => {
    mockResponse(
      JSON.stringify([
        ...catalog,
        fixture,
        { ...fixture, VIN: null },
        { Store: "bad" },
        { ...fixture, Store: 99, VIN: " observed-vin " },
        { ...fixture, Store: 99, VIN: "observed-vin" },
      ]),
    );
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        (request) => request,
      ),
    );
    expect(result.count).toBe(3);
    expect(result.accounting).toEqual({
      recordsProcessed: 8,
      recordsExcluded: 2,
      recordsRejected: 2,
      duplicateVehicles: 1,
    });
    expect(result.observedVins).toEqual(["OBSERVED-VIN"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain("yard 99: skipped 2 vehicles");
  });

  test("bounds callback batches and deduplicates across their boundaries", async () => {
    const rows = Array.from({ length: 751 }, (_, i) => ({
      ...fixture,
      VIN: String(i).padStart(17, "0"),
    }));
    mockResponse(JSON.stringify([...catalog, ...rows, rows[0]]));
    const sizes: number[] = [];
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              sizes.push(batch.length);
            }),
        },
        (request) => request,
      ),
    );
    expect(sizes).toEqual([250, 250, 250, 4]);
    expect(result.count).toBe(754);
    expect(result.accounting?.duplicateVehicles).toBe(1);
  });

  test.each([
    ["invalid JSON", "not json", 200],
    ["error envelope", JSON.stringify({ success: false }), 200],
    [
      "unexpected paginated envelope",
      JSON.stringify({ data: catalog, next: 2 }),
      200,
    ],
    ["empty catalog", "[]", 200],
    ["missing known yards", JSON.stringify([fixture]), 200],
    [
      "oversize catalog",
      JSON.stringify(
        Array.from(
          { length: UPULLRPARTS_MAX_CATALOG_RECORDS + 1 },
          () => fixture,
        ),
      ),
      200,
    ],
    ["HTTP failure", "denied", 403],
  ] as const)("fails %s before emitting data", async (_name, body, status) => {
    const requests = mockResponse(body, status);
    let emitted = false;
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                emitted = true;
              }),
          },
          (request) => request,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(emitted).toBe(false);
    expect(requests).toHaveLength(1);
  });

  test("propagates a failed batch and leaves the catalog retryable from cursor zero", async () => {
    const requests = mockResponse(JSON.stringify(catalog));
    const failure = new Error("snapshot write failed");
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch: () => Effect.fail(failure) },
          (request) => request,
        ),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: failure });
    const retry = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { startCursor: 0, onBatch: () => Effect.void },
        (request) => request,
      ),
    );
    expect(retry.count).toBe(3);
    expect(requests).toHaveLength(6);
  });

  test("propagates a yard callback failure before vehicle callbacks", async () => {
    mockResponse(JSON.stringify(catalog));
    let emitted = false;
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          {
            onYards: () => Effect.fail("yard persistence failed"),
            onBatch: () =>
              Effect.sync(() => {
                emitted = true;
              }),
          },
          (request) => request,
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: "yard persistence failed",
    });
    expect(emitted).toBe(false);
  });

  test("replays the terminal cursor without refetching or re-emitting", async () => {
    const requests = mockResponse("must not fetch");
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { startCursor: 1, onBatch: () => Effect.die("must not emit") },
        (request) => request,
      ),
    );
    expect(result).toMatchObject({
      cursor: 1,
      status: "complete",
      count: 0,
      pagesProcessed: 0,
    });
    expect(requests).toHaveLength(0);
  });

  test("keeps original catalog ordering and accounting after reversed make partitions", async () => {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests++;
        const params = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        if (params.get("apiAction") === "getMakes")
          return Response.json(["Toyota", "Ford"]);
        if (params.get("makes") === "Toyota")
          return Response.json([catalog[2]]);
        if (params.get("makes") === "Ford")
          return Response.json([catalog[1], catalog[0]]);
        return Response.json(catalog);
      },
      { preconnect: originalFetch.preconnect },
    );
    const emitted: UpullRPartsCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              expect(requests).toBe(4);
              emitted.push(...batch);
            }),
        },
        (request) => request,
      ),
    );
    expect(emitted.map((row) => row.vin)).toEqual(
      catalog.map((row) => row.VIN),
    );
    expect(emitted.map((row) => row.make)).toEqual(["Ford", "Ford", "Toyota"]);
    expect(result).toMatchObject({
      cursor: 1,
      status: "complete",
      count: 3,
      accounting: {
        recordsProcessed: 3,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    });
  });

  test("counts unresolved makes while retaining the original inventory", async () => {
    mockResponse(JSON.stringify(catalog));
    const upstream = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        if (params.has("makes") || params.get("apiAction") === "getModels")
          return Response.json([]);
        return upstream(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        (request) => request,
      ),
    );
    expect(result.count).toBe(3);
    expect(result.accounting?.recordsRejected).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain(
      "retained 3 vehicles with make Other",
    );
  });
});
