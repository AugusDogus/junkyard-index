import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamPullapartInventory,
  streamPullapartInventoryWithRequestGate,
} from "./pullapart-connector";
import type { CanonicalVehicle } from "./types";

const originalFetch = globalThis.fetch;

const locationsResponse = [
  {
    idNumber: 3,
    nameItem: "Atlanta South",
    locationID: 3,
    locationName: "Atlanta South",
    address1: "1540 Henrico Road",
    address2: "",
    cityName: "Conley",
    stateName: "GA",
    zipCode: "30288",
    siteTypeID: 3,
    phone: "770-242-8844",
    phoneCarBuying: "770-800-3118",
    phoneUsedCar: "404-600-1307",
    distanceInMiles: 0,
    taxRate: 0.08,
    warrantyDays: 32,
    coreDays: 32,
    allowsCashReturns: 0,
    email: "Atlanta@pullapart.com",
    passcodeForMiscItems: false,
    retailEmail: "atl1Retail@pullapart.com",
    environmentalFeeRate: 0.1,
    environmentalFeeCap: 1000000,
    locationShortName: "atl1",
  },
];

const makesResponse = [
  {
    makeID: 6,
    makeName: "ACURA",
    rareFind: false,
    dateModified: "2026-01-22T00:00:00Z",
    dateCreated: "2026-01-22T00:00:00Z",
  },
];

const vehicleSearchResponse = [
  {
    locationID: 3,
    exact: [
      {
        vinID: 1236492,
        ticketID: 1191613,
        lineID: 12,
        locID: 3,
        locName: "Atlanta South",
        makeID: 6,
        makeName: "ACURA",
        modelID: 10,
        modelName: "MDX",
        modelYear: 2006,
        row: 304,
        vin: "2HNYD18866H537719",
        dateYardOn: "2026-01-22T12:46:20.98",
        vinDecodedId: 13226,
        extendedInfo: null,
      },
    ],
    other: [],
    inventory: null,
  },
];

const zipGeoResponse = {
  places: [
    {
      latitude: "33.6477",
      longitude: "-84.3372",
      "place name": "Conley",
      state: "Georgia",
      "state abbreviation": "GA",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function installPullapartFetchMock(options?: {
  detailResponse?: () => Response | Promise<Response>;
  imageResponse?: () => Response | Promise<Response>;
  makesResponse?: unknown;
  vehicleSearchResponse?: unknown;
}) {
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/interchange/GetLocations")) {
      return jsonResponse(locationsResponse);
    }

    if (url.includes("/Make/OnYard")) {
      return jsonResponse(options?.makesResponse ?? makesResponse);
    }

    if (url.includes("/Vehicle/Search")) {
      return jsonResponse(
        options?.vehicleSearchResponse ?? vehicleSearchResponse,
      );
    }

    if (url.includes("zippopotam.us")) {
      return jsonResponse(zipGeoResponse);
    }

    if (url.includes("/VehicleExtendedInfo/")) {
      return options?.detailResponse?.() ?? jsonResponse({}, 404);
    }

    if (url.includes("retrieveimage")) {
      return (
        options?.imageResponse?.() ??
        jsonResponse(
          {
            webPath: "Error retrieving image",
            filePath: "",
          },
          200,
        )
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("streamPullapartInventory enrichment handling", () => {
  test("pauses at a bounded make chunk and resumes from its cursor", async () => {
    const firstMake = makesResponse[0];
    if (!firstMake) throw new Error("Pull-A-Part make fixture is missing");
    installPullapartFetchMock({
      makesResponse: [
        ...makesResponse,
        {
          ...firstMake,
          makeID: 7,
          makeName: "AUDI",
        },
      ],
    });

    const first = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: () => Effect.succeed(undefined),
        maxPages: 1,
      }),
    );
    const resumed = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: () => Effect.succeed(undefined),
        startAfter: first.cursor,
        maxPages: 1,
      }),
    );

    expect(first.status).toBe("paused");
    expect(first.cursor.makeId).toBe(6);
    expect(resumed.status).toBe("complete");
    expect(resumed.cursor.makeId).toBe(7);
  });

  test("resumes by stable make ID when an earlier make disappears", async () => {
    const firstMake = makesResponse[0];
    if (!firstMake) throw new Error("Pull-A-Part make fixture is missing");
    const secondMake = { ...firstMake, makeID: 7, makeName: "AUDI" };
    installPullapartFetchMock({ makesResponse: [firstMake, secondMake] });

    const first = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: () => Effect.succeed(undefined),
        maxPages: 1,
      }),
    );

    installPullapartFetchMock({ makesResponse: [secondMake] });
    const resumed = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: () => Effect.succeed(undefined),
        startAfter: first.cursor,
        maxPages: 1,
      }),
    );

    expect(first.cursor.makeId).toBe(6);
    expect(resumed.cursor.makeId).toBe(7);
    expect(resumed.count).toBe(1);
    expect(resumed.status).toBe("complete");
  });

  test("routes every inventory request through the shared gate", async () => {
    const searchGroup = vehicleSearchResponse[0];
    const baseVehicle = searchGroup?.exact[0];
    if (!searchGroup || !baseVehicle) {
      throw new Error("Pull-A-Part search fixture is incomplete");
    }

    const exact = Array.from({ length: 5 }, (_, index) => ({
      ...baseVehicle,
      vinID: 1236492 + index,
      ticketID: 1191613 + index,
      vin: `2HNYD18866H5377${19 + index}`,
    }));
    installPullapartFetchMock({
      vehicleSearchResponse: [{ ...searchGroup, exact }],
    });

    let gatedRequests = 0;
    const result = await Effect.runPromise(
      streamPullapartInventoryWithRequestGate(
        { onBatch: () => Effect.succeed(undefined) },
        (request) =>
          Effect.sync(() => {
            gatedRequests += 1;
          }).pipe(Effect.zipRight(request)),
      ),
    );

    expect(result.count).toBe(5);
    expect(gatedRequests).toBe(7);
  });

  test("keeps rows when enrichment endpoints return expected no-data responses", async () => {
    installPullapartFetchMock();
    const batches: CanonicalVehicle[][] = [];

    const result = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.count).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]?.[0]?.vin).toBe("2HNYD18866H537719");
    expect(batches[0]?.[0]?.imageUrl).toBeNull();
    expect(batches[0]?.[0]?.engine).toBeNull();
    expect(batches[0]?.[0]?.trim).toBeNull();
    expect(batches[0]?.[0]?.transmission).toBeNull();
  });

  test("reuses enrichment for the same yard ticket without provider requests", async () => {
    let detailRequests = 0;
    let imageRequests = 0;
    installPullapartFetchMock({
      detailResponse: () => {
        detailRequests += 1;
        return jsonResponse({}, 500);
      },
      imageResponse: () => {
        imageRequests += 1;
        return jsonResponse({}, 500);
      },
    });
    const batches: CanonicalVehicle[][] = [];

    const result = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
        loadCachedEnrichments: (vehicles) =>
          Effect.succeed(
            new Map(
              vehicles.map((vehicle) => [
                vehicle.vin,
                {
                  color: "Silver",
                  imageUrl: "https://images.example/vehicle.jpg",
                  engine: "3.5L V6",
                  trim: "Touring",
                  transmission: "Automatic",
                },
              ]),
            ),
          ),
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.count).toBe(1);
    expect(detailRequests).toBe(0);
    expect(imageRequests).toBe(0);
    expect(batches[0]?.[0]).toMatchObject({
      color: "Silver",
      imageUrl: "https://images.example/vehicle.jpg",
      engine: "3.5L V6",
      trim: "Touring",
      transmission: "Automatic",
    });
  });

  test("skips rows and records errors when enrichment transport fails", async () => {
    installPullapartFetchMock({
      detailResponse: () => jsonResponse({ message: "upstream error" }, 500),
    });
    const batches: CanonicalVehicle[][] = [];

    const result = await Effect.runPromise(
      streamPullapartInventory({
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
      }),
    );

    expect(result.count).toBe(0);
    expect(batches).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Vehicle enrichment failed");
    expect(result.errors[0]).toContain("loc=3");
    expect(result.errors[0]).toContain("ticket=1191613");
    expect(result.errors[0]).toContain("line=12");
    expect(result.errors[0]).toContain("API error: 500");
  });
});
