import { describe, expect, test } from "bun:test";
import { toAlgoliaRecord } from "../types";
import type { CanonicalVehicle } from "../types";

describe("toAlgoliaRecord", () => {
  test("maps a canonical vehicle to an Algolia record correctly", () => {
    const vehicle: CanonicalVehicle = {
      vin: "1FADP3F29FL123456",
      source: "row52",
      year: 2015,
      make: "FORD",
      model: "FOCUS",
      color: "Red",
      stockNumber: "BC12345",
      imageUrl: "https://cdn.row52.com/images/abc.JPG",
      availableDate: "2026-01-15T10:00:00.000Z",
      locationCode: "42",
      locationName: "PICK-n-PULL Sacramento",
      state: "California",
      stateAbbr: "CA",
      lat: 38.5816,
      lng: -121.4944,
      section: null,
      row: "A",
      space: "15",
      detailsUrl: "https://row52.com/Vehicle/Index/1FADP3F29FL123456",
      partsUrl: "https://row52.com/parts",
      pricesUrl: "https://row52.com/prices",
      engine: "2.0L I4",
      trim: "SE",
      transmission: "Automatic",
    };

    const firstSeenAt = new Date("2026-01-15T10:00:00.000Z");
    const record = toAlgoliaRecord(vehicle, firstSeenAt);

    expect(record.objectID).toBe("1FADP3F29FL123456");
    expect(record.source).toBe("row52");
    expect(record.year).toBe(2015);
    expect(record.make).toBe("FORD");
    expect(record.model).toBe("FOCUS");
    expect(record.color).toBe("Red");
    expect(record._geoloc).toEqual({ lat: 38.5816, lng: -121.4944 });
    expect(record.availableDateTs).toBe(
      Math.floor(new Date("2026-01-15T10:00:00.000Z").getTime() / 1000),
    );
    expect(record.firstSeenAt).toBe(
      Math.floor(firstSeenAt.getTime() / 1000),
    );
    expect(record.engine).toBe("2.0L I4");
    expect(record.trim).toBe("SE");
    expect(record.transmission).toBe("Automatic");
  });

  test("handles null availableDate with timestamp 0", () => {
    const vehicle: CanonicalVehicle = {
      vin: "ABC123",
      source: "pyp",
      year: 2020,
      make: "HONDA",
      model: "CIVIC",
      color: null,
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      locationCode: "1229",
      locationName: "PYP Sun Valley",
      state: "California",
      stateAbbr: "CA",
      lat: 34.0,
      lng: -118.0,
      section: null,
      row: null,
      space: null,
      detailsUrl: null,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    };

    const record = toAlgoliaRecord(vehicle, new Date("2026-02-21T00:00:00Z"));

    expect(record.availableDateTs).toBe(0);
    expect(record.color).toBeNull();
    expect(record.imageUrl).toBeNull();
  });
});
