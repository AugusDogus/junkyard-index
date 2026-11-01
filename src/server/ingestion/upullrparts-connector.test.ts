import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import images from "./fixtures/upullrparts-images.json";
import partialImages from "./fixtures/upullrparts-partial-images.json";
import {
  UPULLRPARTS_API_URL,
  UpullRPartsProviderError,
} from "./upullrparts-client";
import {
  streamUpullRPartsInventoryWithRequestGate,
  UPULLRPARTS_MAX_CATALOG_RECORDS,
  type UpullRPartsCatalogFetch,
} from "./upullrparts-connector";
import type { UpullRPartsCanonicalVehicle } from "./upullrparts-transform";
import type { UpullRPartsYard } from "./upullrparts-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Production reads the catalog through a browser session. These tests serve
// catalog bodies from the mocked fetch instead.
const mockedCatalog: UpullRPartsCatalogFetch = Effect.tryPromise({
  try: async () => {
    const response = await fetch(UPULLRPARTS_API_URL, {
      method: "POST",
      body: "action=doAaaApiCall&apiAction=getVehicles",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("catalog is not an array");
    return body;
  },
  catch: (cause) => new UpullRPartsProviderError({ cause }),
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
      if (params.get("apiAction") === "getVehicleImages")
        return Response.json(images);
      if (params.get("apiAction") === "getMakes")
        return Response.json(["Ford"]);
      if (params.get("apiAction") === "getModels")
        return Response.json(["FOCUS"]);
      return new Response(body, { status });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

function requestedApiActions(requests: { init: RequestInit | undefined }[]) {
  return requests.map((request) =>
    new URLSearchParams(
      typeof request.init?.body === "string" ? request.init.body : "",
    ).get("apiAction"),
  );
}

describe("U Pull R Parts complete catalog", () => {
  test.each(partialImages)(
    "partial empty photos fail before yard or vehicle callbacks: %j",
    async (responseInit) => {
      mockResponse(JSON.stringify(catalog));
      const upstream = globalThis.fetch;
      let photoRequests = 0;
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const params = new URLSearchParams(
            typeof init?.body === "string" ? init.body : "",
          );
          if (params.get("apiAction") === "getVehicleImages") {
            photoRequests++;
            expect(params.get("action")).toBe("doAaaApiCall");
            return Response.json(
              { success: 1, images: [] },
              {
                status: responseInit.status,
                headers: responseInit.headerName
                  ? { [responseInit.headerName]: responseInit.headerValue }
                  : undefined,
              },
            );
          }
          return upstream(input, init);
        },
        { preconnect: originalFetch.preconnect },
      );
      let batches = 0;
      let yards = 0;
      const result = await Effect.runPromise(
        Effect.either(
          streamUpullRPartsInventoryWithRequestGate(
            {
              onBatch: () =>
                Effect.sync(() => {
                  batches++;
                }),
              onYards: () =>
                Effect.sync(() => {
                  yards++;
                }),
            },
            (request) => request,
            mockedCatalog,
          ),
        ),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left")
        expect(result.left.message).toContain("partial");
      expect(photoRequests).toBe(1);
      expect(batches).toBe(0);
      expect(yards).toBe(0);
    },
  );
  test("enriches photos by stock using the public image action before publication", async () => {
    const requests = mockResponse(JSON.stringify(catalog));
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        (request) => request,
        mockedCatalog,
      ),
    );
    expect(vehicles.map((vehicle) => vehicle.imageUrl)).toEqual(
      catalog.map(
        () =>
          "https://api.aaaparts.com/staticImages/UG072546_6_Facebook_1789479328434.jpg",
      ),
    );
    expect(
      requests.filter(({ init }) =>
        String(init?.body).includes("getVehicleImages"),
      ),
    ).toEqual([
      expect.objectContaining({
        init: expect.objectContaining({
          method: "POST",
          body: "action=doAaaApiCall&apiAction=getVehicleImages&stockID=UG072546",
        }),
      }),
    ]);
  });
  test("rejects a catalog whose third yard is represented only by an unusable record", async () => {
    const healthy = Array.from({ length: 2200 }, (_, i) => ({
      ...fixture,
      Store: (i % 2) + 1,
      VIN: `VIN-${i}`,
    }));
    mockResponse(
      JSON.stringify([...healthy, { ...fixture, Store: 3, Year: null }]),
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
          mockedCatalog,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("missing known yards UPRRP-3");
    expect(batches).toBe(0);
  });
  test("a photo failure emits neither yards nor vehicle batches and leaves cursor zero retryable", async () => {
    mockResponse(JSON.stringify(catalog));
    const upstream = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        if (params.get("apiAction") === "getVehicleImages")
          return new Response("photo service unavailable", { status: 403 });
        return upstream(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    let emitted = 0;
    const onBatch = () =>
      Effect.sync(() => {
        emitted++;
      });
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch, onYards: onBatch },
          (request) => request,
          mockedCatalog,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(emitted).toBe(0);
    globalThis.fetch = upstream;
    const retry = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { startCursor: 0, onBatch },
        (request) => request,
        mockedCatalog,
      ),
    );
    expect(retry).toMatchObject({ status: "complete", cursor: 1, count: 3 });
  });
  test("rejects unusable rows before make enrichment", async () => {
    const invalid = [
      { ...fixture, VIN: null },
      { ...fixture, Year: null },
      { ...fixture, Model: " " },
    ];
    const requests: URLSearchParams[] = [];
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        requests.push(params);
        if (params.get("apiAction") === "getVehicleImages")
          return Response.json(images);
        if (params.get("apiAction") === "getMakes")
          return Response.json([
            "Ford",
            ...Array.from({ length: 55 }, (_, i) => `Make-${i}`),
          ]);
        if (params.get("apiAction") === "getModels")
          return Response.json(params.get("Make") === "Ford" ? ["FOCUS"] : []);
        return Response.json([...catalog, ...invalid]);
      },
      { preconnect: originalFetch.preconnect },
    );
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        (request) => request,
        mockedCatalog,
      ),
    );
    expect(result).toMatchObject({
      status: "complete",
      count: 3,
      accounting: { recordsProcessed: 6, recordsRejected: 3 },
    });
    expect(vehicles.map((vehicle) => vehicle.make)).toEqual([
      "Ford",
      "Ford",
      "Ford",
    ]);
    expect(
      requests.filter((params) => params.get("apiAction") === "getModels"),
    ).toHaveLength(56);
  });
  test("rejects an unusable-only catalog without requesting photos", async () => {
    const requests = mockResponse(
      JSON.stringify(catalog.map((row) => ({ ...row, VIN: null }))),
    );
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          (request) => request,
          mockedCatalog,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(requestedApiActions(requests)).not.toContain("getVehicleImages");
  });
  test.each(["makes", "models"])(
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
                  : "catalog";
            const body =
              kind === "makes"
                ? ["Ford"]
                : kind === "models"
                  ? ["FOCUS"]
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
              mockedCatalog,
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
  test("posts open lookups with the current action, emits yards and completes one atomic checkpoint", async () => {
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
        mockedCatalog,
      ),
    );
    expect(requests).toHaveLength(4);
    expect(requests[2]).toMatchObject({
      url: UPULLRPARTS_API_URL,
      init: {
        method: "POST",
        body: "action=doAaaApiCall&apiAction=getModels&Make=Ford&ModelYear=0",
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
        mockedCatalog,
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
        mockedCatalog,
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
          mockedCatalog,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(emitted).toBe(false);
    expect(requestedApiActions(requests)).not.toContain("getVehicleImages");
  });

  test("propagates a failed batch and leaves the catalog retryable from cursor zero", async () => {
    const requests = mockResponse(JSON.stringify(catalog));
    const failure = new Error("snapshot write failed");
    const result = await Effect.runPromise(
      Effect.either(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch: () => Effect.fail(failure) },
          (request) => request,
          mockedCatalog,
        ),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: failure });
    const retry = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { startCursor: 0, onBatch: () => Effect.void },
        (request) => request,
        mockedCatalog,
      ),
    );
    expect(retry.count).toBe(3);
    expect(requests).toHaveLength(8);
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
          mockedCatalog,
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
        mockedCatalog,
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

  test("counts unresolved makes while retaining the original inventory", async () => {
    mockResponse(JSON.stringify(catalog));
    const upstream = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        if (params.get("apiAction") === "getModels") return Response.json([]);
        return upstream(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      streamUpullRPartsInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        (request) => request,
        mockedCatalog,
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
