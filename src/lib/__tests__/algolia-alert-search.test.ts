import { describe, expect, test } from "bun:test";

import {
  algoliaHitToVehicle,
  buildAlertFiltersString,
} from "~/lib/algolia-alert-search";

describe("algolia alert search helpers", () => {
  test("builds timestamp and numeric year constraints", () => {
    const filters = buildAlertFiltersString(
      { minYear: 2012, maxYear: 2018 },
      new Date("2026-01-01T00:00:01.999Z"),
    );

    expect(filters).toContain("firstSeenAt > 1767225601");
    expect(filters).toContain("year >= 2012");
    expect(filters).toContain("year <= 2018");
  });

  test("builds OR facets for multi-value filters", () => {
    const filters = buildAlertFiltersString(
      {
        makes: ["Honda", "Toyota"],
        states: ["California", "Nevada"],
        sources: ["pyp", "row52", "ignore-me"],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).toContain('(state:"California" OR state:"Nevada")');
    expect(filters).toContain('(source:"pyp" OR source:"row52")');
    expect(filters).not.toContain("ignore-me");
  });

  test("drops empty and whitespace facet values", () => {
    const filters = buildAlertFiltersString(
      {
        makes: ["Honda", "", "   ", "Toyota"],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).not.toContain('make:""');
  });

  test("handles finite and inverted year ranges safely", () => {
    const filters = buildAlertFiltersString(
      {
        minYear: Number.POSITIVE_INFINITY,
        maxYear: Number.NaN,
      },
      null,
    );
    expect(filters).toBeUndefined();

    const swappedRange = buildAlertFiltersString(
      {
        minYear: 2020,
        maxYear: 2015,
      },
      null,
    );
    expect(swappedRange).toContain("year >= 2015");
    expect(swappedRange).toContain("year <= 2020");
  });

  test("maps algolia hits to Vehicle shape", () => {
    const vehicle = algoliaHitToVehicle({
      objectID: "VIN123",
      year: 2015,
      make: "Honda",
      model: "Civic",
      source: "pyp",
      locationName: "PYP Sun Valley",
      locationCode: "SV",
      state: "California",
      stateAbbr: "CA",
      _geoloc: { lat: 34.2, lng: -118.3 },
      imageUrl: "https://example.com/image.jpg",
    });

    expect(vehicle.vin).toBe("VIN123");
    expect(vehicle.make).toBe("Honda");
    expect(vehicle.location.name).toBe("PYP Sun Valley");
    expect(vehicle.location.lat).toBe(34.2);
    expect(vehicle.images[0]?.url).toBe("https://example.com/image.jpg");
  });
});
