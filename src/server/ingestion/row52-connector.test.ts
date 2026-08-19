import { FetchHttpClient } from "@effect/platform";
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Row52Location, Row52Vehicle } from "~/lib/types";
import {
  buildLocationIdFilter,
  buildVehicleQuery,
  ROW52_LOCATION_FILTER_CHUNK_SIZE,
  selectRow52LocationGroup,
  streamRow52Inventory,
  transformRow52Vehicle,
} from "./row52-connector";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeLocation(id: number): Row52Location {
  return {
    id,
    accountId: "",
    name: "Authoritative Yard",
    code: "Y1",
    address1: "123 Main St",
    address2: null,
    city: "Tulsa",
    zipCode: "74101",
    stateId: 0,
    phone: null,
    hours: "9-5",
    latitude: 36.154,
    longitude: -95.993,
    isActive: true,
    isVisible: true,
    isParticipating: true,
    webUrl: "https://example.com/yard",
    logoUrl: null,
    partsPricingUrl: "https://example.com/prices",
    state: {
      id: 0,
      name: "Oklahoma",
      abbreviation: "OK",
      countryId: 0,
    },
  };
}

function makeVehicle(locationId: number): Row52Vehicle {
  return {
    id: 1,
    vin: "2MEFM75W4XX703938",
    modelId: 10,
    year: 1999,
    locationId,
    row: "1",
    slot: null,
    barCodeNumber: "fc8mq",
    dateAdded: "2016-02-21T00:00:00Z",
    creationDate: "2016-02-21T14:37:48.423Z",
    lastModificationDate: "2016-02-21T14:37:48.423Z",
    isActive: true,
    isVisible: true,
    defaultImage: 0,
    color: "Red",
    engine: null,
    trim: null,
    transmission: null,
    model: {
      id: 10,
      name: "Grand Marquis",
      makeId: 183,
      make: {
        id: 183,
        name: "Mercury",
      },
    },
    location: {
      id: locationId,
      accountId: "stale",
      name: "auto plaza",
      code: "10590",
      address1: "stale",
      address2: null,
      city: "stale",
      zipCode: "00000",
      stateId: 28,
      phone: null,
      hours: "stale",
      latitude: 0,
      longitude: 0,
      isActive: false,
      isVisible: false,
      isParticipating: false,
      webUrl: null,
      logoUrl: null,
      partsPricingUrl: null,
      state: {
        id: 28,
        name: "Missouri",
        abbreviation: "MO",
        countryId: 234,
      },
    },
    images: [],
  };
}

describe("transformRow52Vehicle", () => {
  test("drops vehicles whose locationId is missing from the authoritative location map", () => {
    const vehicle = makeVehicle(10590);

    expect(transformRow52Vehicle(vehicle, new Map())).toBeNull();
  });

  test("uses the authoritative location map instead of the expanded vehicle location", () => {
    const vehicle = makeVehicle(10590);
    const canonical = transformRow52Vehicle(
      vehicle,
      new Map([[10590, makeLocation(10590)]]),
    );

    expect(canonical).not.toBeNull();
    expect(canonical?.locationName).toBe("Authoritative Yard");
    expect(canonical?.locationCity).toBe("Tulsa");
    expect(canonical?.state).toBe("Oklahoma");
    expect(canonical?.stateAbbr).toBe("OK");
  });
});

describe("Row52 filtered crawl helpers", () => {
  test("uses the measured maximum location filter chunk size", () => {
    expect(ROW52_LOCATION_FILTER_CHUNK_SIZE).toBe(19);
  });

  test("resumes after a stable yard ID when earlier yards disappear", () => {
    const currentLocationIds = Array.from(
      { length: 38 },
      (_, index) => index + 2,
    );
    expect(
      selectRow52LocationGroup(
        {
          source: "row52",
          afterLocationId: 19,
          locationIds: [],
          skip: 0,
        },
        currentLocationIds,
      ),
    ).toEqual(Array.from({ length: 19 }, (_, index) => index + 20));
  });

  test("preserves the active yard group across topology changes", () => {
    const activeLocationIds = [20, 21, 22];
    expect(
      selectRow52LocationGroup(
        {
          source: "row52",
          afterLocationId: 19,
          locationIds: activeLocationIds,
          skip: 1000,
        },
        [1, 20, 22, 23, 24],
      ),
    ).toEqual(activeLocationIds);
  });

  test("builds a vehicle filter constrained to authoritative location ids", () => {
    expect(buildLocationIdFilter([99, 10798, 88])).toBe(
      "isActive eq true and (locationId eq 99 or locationId eq 10798 or locationId eq 88)",
    );
  });

  test("builds chunked vehicle queries with count on the first page only", () => {
    const firstPageQuery = buildVehicleQuery(0, true, [99, 10798]);
    const laterPageQuery = buildVehicleQuery(1000, false, [99, 10798]);

    expect(firstPageQuery).toContain(
      "%24filter=isActive+eq+true+and+%28locationId+eq+99+or+locationId+eq+10798%29",
    );
    expect(firstPageQuery).toContain("%24count=true");
    expect(firstPageQuery).toContain("%24skip=0");
    expect(laterPageQuery).not.toContain("%24count=true");
    expect(laterPageQuery).toContain("%24skip=1000");
  });
});

describe("Row52 durable cursor transitions", () => {
  test("resumes the exact yard group after topology changes without probing page zero", async () => {
    let currentLocationIds = Array.from(
      { length: 20 },
      (_, index) => index + 1,
    );
    const vehicleSkips: number[] = [];
    const vehicleFilters: string[] = [];
    const firstPageVehicle = makeVehicle(2);

    globalThis.fetch = (async (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname.includes("/odata/Locations/Row52.Search")) {
        return Response.json({
          "@odata.context": "test",
          "@odata.count": currentLocationIds.length,
          value: currentLocationIds.map((locationId) => ({
            locationId,
            name: `Yard ${locationId}`,
            code: String(locationId),
            address1: "123 Main St",
            address2: null,
            state: "Oklahoma",
            stateAbbreviation: "OK",
            hours: "9-5",
            phone: null,
            city: "Tulsa",
            zipCode: "74101",
            latitude: 36.154,
            longitude: -95.993,
            webUrl: null,
            logoUrl: null,
            partsPricingUrl: null,
            isParticipating: true,
            isPublishable: true,
          })),
        });
      }
      if (url.pathname === "/odata/Vehicles") {
        const skip = Number(url.searchParams.get("$skip") ?? "0");
        vehicleSkips.push(skip);
        vehicleFilters.push(url.searchParams.get("$filter") ?? "");
        return Response.json({
          "@odata.context": "test",
          "@odata.count": 1001,
          value:
            skip === 0
              ? Array.from({ length: 1000 }, () => firstPageVehicle)
              : [firstPageVehicle],
        });
      }
      throw new Error(`Unexpected Row52 request: ${url.href}`);
    }) as typeof fetch;

    const first = await Effect.runPromise(
      streamRow52Inventory({
        onBatch: () => Effect.void,
        maxPages: 1,
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    );
    expect(first.cursor).toEqual({
      source: "row52",
      afterLocationId: 0,
      locationIds: Array.from({ length: 19 }, (_, index) => index + 1),
      skip: 1000,
    });

    currentLocationIds = Array.from({ length: 19 }, (_, index) => index + 2);
    const resumed = await Effect.runPromise(
      streamRow52Inventory({
        onBatch: () => Effect.void,
        cursor: first.cursor,
        maxPages: 1,
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    );

    expect(vehicleSkips).toEqual([0, 1000]);
    expect(vehicleFilters[1]).toContain("locationId eq 1");
    expect(resumed.cursor).toEqual({
      source: "row52",
      afterLocationId: 19,
      locationIds: [],
      skip: 0,
    });
    expect(resumed.status).toBe("paused");
  });
});
