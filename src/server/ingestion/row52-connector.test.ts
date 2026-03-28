import { describe, expect, test } from "bun:test";
import type { Row52Location, Row52Vehicle } from "~/lib/types";
import {
  buildLocationIdFilter,
  buildVehicleQuery,
  chunkLocationIds,
  ROW52_LOCATION_FILTER_CHUNK_SIZE,
  transformRow52Vehicle,
} from "./row52-connector";

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

  test("chunks location ids at the configured node-count-safe size", () => {
    const locationIds = Array.from({ length: 40 }, (_, index) => index + 1);

    expect(
      chunkLocationIds(locationIds, ROW52_LOCATION_FILTER_CHUNK_SIZE).map(
        (chunk) => chunk.length,
      ),
    ).toEqual([19, 19, 2]);
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
